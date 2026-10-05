'use strict';
const Decimal = require('decimal.js');
const pool = require('../database');
const D = value => new Decimal(value == null ? 0 : value);
const qty = value => D(value).toDecimalPlaces(3).toFixed(3);
const money = value => D(value).toDecimalPlaces(3).toFixed(3);
const cost = value => value == null ? null : D(value).toDecimalPlaces(6).toFixed(6);
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
function positive(value, name = 'Cantidad', integer = false) {
    if (!/^(\d+)(\.\d{1,3})?$/.test(String(value)) || !D(value).gt(0) || D(value).gt(9999999) || (integer && !D(value).isInteger())) {
        throw new Error(`${name}: ingrese un número positivo${integer ? ' entero' : ' con hasta tres decimales'}.`);
    }
    return D(value);
}
function validDate(value) {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) !== value) throw new Error('Fecha inválida.');
    return value;
}
const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Lima', year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function query(connection, sql, params = []) {
    if (!connection) return pool.query(sql, params);
    return new Promise((resolve,reject) => connection.query(sql,params,(err,result) => err ? reject(err) : resolve(result)));
}
async function transaction(fn) {
    const c = await new Promise((resolve,reject) => pool.getConnection((e,c) => e ? reject(e) : resolve(c)));
    try {
        await new Promise((resolve,reject) => c.beginTransaction(e => e ? reject(e) : resolve()));
        const result = await fn(c);
        await new Promise((resolve,reject) => c.commit(e => e ? reject(e) : resolve()));
        return result;
    } catch (e) {
        await new Promise(resolve => c.rollback(resolve));
        throw e;
    } finally { c.release(); }
}
async function lockProducts(c, ids) {
    const unique = [...new Set(ids.map(Number))].sort((a,b)=>a-b);
    const result = new Map();
    for (const id of unique) {
        if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Producto inválido.');
        const [p] = await query(c,'SELECT * FROM Productos WHERE id_producto=? FOR UPDATE',[id]);
        if (!p) throw new Error('Uno de los productos ya no existe.');
        const [s] = await query(c,'SELECT COALESCE(SUM(inventario),0) stock FROM Fechas_vencimiento WHERE id_producto=?',[id]);
        p.stock = D(s.stock);
        result.set(id,p);
    }
    return result;
}
function weightedCost(stock, oldCost, quantity, newCost) {
    if (D(stock).isZero()) return cost(newCost);
    if (oldCost == null || newCost == null) return null;
    return cost(D(stock).mul(oldCost).plus(D(quantity).mul(newCost)).div(D(stock).plus(quantity)));
}
async function updateState(c,p) {
    const estado = p.stock.lte(0) ? 3 : p.stock.lte(p.cantidad_limite || 0) ? 2 : 1;
    await query(c,'UPDATE Productos SET estado_producto=?, costo_promedio=?, costo_estimado=? WHERE id_producto=?',
        [estado,p.costo_promedio,p.costo_estimado,p.id_producto]);
    await query(c,`DELETE FROM Notificaciones WHERE id_producto=? AND existencias IN (2,3) AND existencias <> ?`,[p.id_producto,estado]);
}
async function movement(c,p,lote,amount,unitCost,estimated,meta) {
    const n = D(amount);
    p.stock = p.stock.plus(n);
    if (p.stock.lt(0)) throw new Error('Stock insuficiente.');
    await query(c,`INSERT INTO Movimientos_inventario
      (fecha,tipo,id_producto,id_fechavencimiento,id_compra,id_venta,id_ajuste,id_usuario,usuario_nombre,entrada,salida,saldo,costo_unitario,costo_estimado,observacion,nombre_unidad,factor_unidad,cantidad_presentacion)
      VALUES (CONVERT_TZ(UTC_TIMESTAMP(6),'+00:00','-05:00'),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [meta.tipo,p.id_producto,lote,meta.id_compra||null,meta.id_venta||null,meta.id_ajuste||null,
       meta.user ? meta.user.id_usuario : null,meta.user ? meta.user.nombre : null,
       qty(n.gt(0)?n:0),qty(n.lt(0)?n.neg():0),qty(p.stock),cost(unitCost),estimated,meta.observacion||null,meta.nombre_unidad||'Unidad base',meta.factor_unidad||1,n.abs().div(meta.factor_unidad||1).toFixed(6)]);
}
async function enter(c,p,quantity,unitCost,fecha,meta,estimated=0,existingLot=null) {
    const n = positive(quantity);
    let lot;
    if (existingLot) {
        [lot] = await query(c,'SELECT * FROM Fechas_vencimiento WHERE id_fechavencimiento=? AND id_producto=? FOR UPDATE',[existingLot,p.id_producto]);
        if (!lot) throw new Error('El lote original no existe.');
    } else {
        [lot] = await query(c,`SELECT * FROM Fechas_vencimiento WHERE id_producto=? AND fecha_vencimiento <=> ? ORDER BY id_fechavencimiento LIMIT 1 FOR UPDATE`,[p.id_producto,fecha]);
    }
    if (!lot) {
        const insert = await query(c,'INSERT INTO Fechas_vencimiento (id_producto,fecha_vencimiento,inventario) VALUES (?,?,0)',[p.id_producto,fecha]);
        lot={id_fechavencimiento:insert.insertId};
    }
    p.costo_promedio=weightedCost(p.stock,p.costo_promedio,n,unitCost);
    p.costo_estimado=p.stock.isZero()?estimated:Math.max(Number(p.costo_estimado),estimated);
    await query(c,'UPDATE Fechas_vencimiento SET inventario=COALESCE(inventario,0)+? WHERE id_fechavencimiento=?',[qty(n),lot.id_fechavencimiento]);
    await movement(c,p,lot.id_fechavencimiento,n,unitCost,estimated,meta);
    await updateState(c,p);
    return [{lot:lot.id_fechavencimiento,quantity:qty(n),cost:cost(unitCost)}];
}
async function leave(c,p,quantity,meta,lotId=null) {
    let remaining=positive(quantity);
    if (p.stock.lt(remaining)) throw new Error(`Stock insuficiente: ${p.nombre_producto}.`);
    const lots=await query(c,`SELECT * FROM Fechas_vencimiento WHERE id_producto=? AND inventario>0 ${lotId?'AND id_fechavencimiento=?':''}
      ORDER BY fecha_vencimiento IS NULL,fecha_vencimiento,id_fechavencimiento FOR UPDATE`,lotId?[p.id_producto,lotId]:[p.id_producto]);
    if (lots.reduce((s,l)=>s.plus(l.inventario),D(0)).lt(remaining)) throw new Error('El lote seleccionado no tiene stock suficiente.');
    const parts=[];
    for (const lot of lots) {
        if (remaining.isZero()) break;
        const used=Decimal.min(remaining,D(lot.inventario));
        await query(c,'UPDATE Fechas_vencimiento SET inventario=inventario-? WHERE id_fechavencimiento=?',[qty(used),lot.id_fechavencimiento]);
        // Un lote agotado se conserva: lo referencian los movimientos históricos.
        if (used.eq(lot.inventario)) await query(c,'DELETE FROM Notificaciones WHERE id_fecha_vencimiento=?',[lot.id_fechavencimiento]);
        await movement(c,p,lot.id_fechavencimiento,used.neg(),p.costo_promedio,p.costo_estimado,meta);
        parts.push({lot:lot.id_fechavencimiento,quantity:qty(used),cost:cost(p.costo_promedio)});
        remaining=remaining.minus(used);
    }
    await updateState(c,p);
    return parts;
}
function token(value) {
    if (!/^[a-zA-Z0-9-]{20,64}$/.test(String(value||''))) throw new Error('Formulario vencido. Recargue la página e intente nuevamente.');
    return value;
}
async function register(kind,body,user) {
    const purchase=kind==='compra';
    const table=purchase?'Compras':'Ventas';
    const idField=purchase?'id_compra':'id_venta';
    const key=token(body.token_operacion);
    const products=array(body.producto), prices=array(purchase?body.preciocompra:body.precioventa), amounts=array(body.cantidad), dates=array(body.fecha_vencimiento);
    if (!products.length || products.length>300 || products.length!==prices.length || products.length!==amounts.length) throw new Error('Revise los productos y cantidades de la operación.');
    try {
        return await transaction(async c=>{
            const [previous]=await query(c,`SELECT ${idField} id FROM ${table} WHERE token_operacion=?`,[key]);
            if (previous) return previous.id;
            const locked=await lockProducts(c,products);
            const lines=new Map();
            for(let i=0;i<products.length;i++) {
                const amount=positive(amounts[i],'Cantidad',true);
                const priceId=positive(prices[i],'Presentación',true).toNumber();
                const [price]=await query(c,`SELECT pp.*,u.cantidad factor,u.nombre unidad FROM Precios_productos pp JOIN Unidades u ON u.id_unidad=pp.id_unidad WHERE pp.id_precio=? AND pp.id_producto=? FOR UPDATE`,[priceId,Number(products[i])]);
                if (!price) throw new Error('Presentación inválida.');
                const value=purchase?price.precio_compra:price.precio_venta;
                positive(price.factor,'Equivalencia'); positive(value,'Precio');
                const date=purchase?validDate(dates[i]):null;
                if (date && date<today()) throw new Error('Una compra no puede ingresar mercadería ya vencida.');
                const lineKey=`${price.id_producto}:${price.id_unidad}:${date||''}`;
                if(lines.has(lineKey)) lines.get(lineKey).amount=lines.get(lineKey).amount.plus(amount);
                else lines.set(lineKey,{...price,amount,value,date});
            }
            const rawContact=body[purchase?'id_proveedor':'id_cliente'];
            const cid=rawContact?positive(rawContact,'Cliente/proveedor',true).toNumber():null;
            let contact=null;
            if(cid) {
                [contact]=await query(c,`SELECT * FROM ${purchase?'Proveedores':'Clientes'} WHERE ${purchase?'id_proveedor':'id_cliente'}=? AND activo=1 FOR UPDATE`,[cid]);
                if(!contact) throw new Error('El cliente o proveedor seleccionado no está activo.');
            }
            const total=[...lines.values()].reduce((s,l)=>s.plus(l.amount.mul(l.value)),D(0));
            if(total.gt('9999999.999')) throw new Error('El monto supera el límite permitido.');
            const header=await query(c,`INSERT INTO ${table} (fecha_${kind},monto_total,${purchase?'id_proveedor':'id_cliente'},id_usuario,usuario_nombre,contacto_nombre,contacto_documento,token_operacion)
              VALUES(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','-05:00'),?,?,?,?,?,?,?)`,[money(total),cid,user.id_usuario,user.nombre,contact&&contact.nombre,contact&&contact.documento,key]);
            for(const l of lines.values()) {
                const p=locked.get(Number(l.id_producto));
                const base=l.amount.mul(l.factor);
                const common=[l.id_producto,l.id_unidad,header.insertId,l.amount.toFixed(0),money(l.amount.mul(l.value)),l.factor,l.unidad,p.nombre_producto];
                const meta={tipo:purchase?'COMPRA':'VENTA',[idField]:header.insertId,user,nombre_unidad:l.unidad,factor_unidad:l.factor};
                if(purchase) {
                    await query(c,`INSERT INTO Detalle_compra (id_producto,id_unidad,id_compra,cantidad_producto,precio_parcial,factor_unidad,nombre_unidad_historico,nombre_producto_historico,fecha_vencimiento) VALUES(?,?,?,?,?,?,?,?,?)`,[...common,l.date]);
                    await enter(c,p,base,l.amount.mul(l.value).div(base),l.date,meta,0);
                } else {
                    await query(c,`INSERT INTO Detalle_venta (id_producto,id_unidad,id_venta,cantidad_producto,precio_parcial,factor_unidad,nombre_unidad_historico,nombre_producto_historico,costo_unitario_base,costo_estimado) VALUES(?,?,?,?,?,?,?,?,?,?)`,[...common,p.costo_promedio,p.costo_estimado]);
                    await leave(c,p,base,meta);
                }
            }
            return header.insertId;
        });
    } catch(e) {
        if(e.code==='ER_DUP_ENTRY') {
            const [previous]=await query(null,`SELECT ${idField} id FROM ${table} WHERE token_operacion=?`,[key]);
            if(previous) return previous.id;
        }
        throw e;
    }
}
module.exports={D,qty,money,cost,array,positive,validDate,today,query,transaction,lockProducts,weightedCost,movement,enter,leave,updateState,token,register};
