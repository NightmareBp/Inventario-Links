'use strict';
const router=require('express').Router();
const {randomUUID}=require('crypto');
const {isLoggedIn,isLoggedInAdmin}=require('../lib/auth');
const S=require('../lib/stock');
const pool=require('../database');
const {period,safe}=require('../lib/gestion');
const q=(sql,params=[])=>S.query(null,sql,params);
const admin=(req,res,next)=>Number(req.user.tipo)===1?next():res.status(403).json({error:'Solo el gerente puede realizar esta operación.'});
function contactData(body) {
    const row={};
    for(const [field,max] of Object.entries({nombre:150,tipo_documento:10,documento:25,telefono:30,direccion:250,correo:150,contacto:150})) {
        row[field]=String(body[field]||'').trim()||null;
        if(row[field] && row[field].length>max) throw new Error(`El campo ${field} excede ${max} caracteres.`);
    }
    if(!row.nombre) throw new Error('Ingrese el nombre o razón social.');
    if(row.documento) {
        if(!['DNI','RUC','CE','OTRO'].includes(row.tipo_documento)) throw new Error('Seleccione el tipo de documento.');
        row.documento=row.documento.toUpperCase();
        if(row.tipo_documento==='DNI' && !/^\d{8}$/.test(row.documento)) throw new Error('El DNI debe tener ocho dígitos.');
        if(row.tipo_documento==='RUC' && !/^\d{11}$/.test(row.documento)) throw new Error('El RUC debe tener once dígitos.');
    } else row.tipo_documento=null;
    if(row.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.correo)) throw new Error('Correo inválido.');
    return row;
}
// Una misma conexión mantiene el bloqueo hasta terminar la escritura en autocommit.
// Incluye clientes inactivos para que se reactive el registro en lugar de duplicarlo.
async function saveContact(table,id,row,editId=null) {
    const write=c=>editId===null
        ? S.query(c,`INSERT INTO ${table} SET ?`,row)
        : S.query(c,`UPDATE ${table} SET ? WHERE ${id}=?`,[row,editId]);
    if(table!=='Clientes' || row.documento) return write(null);
    const c=await new Promise((resolve,reject)=>pool.getConnection((e,c)=>e?reject(e):resolve(c)));
    let locked=false;
    try {
        const [lock]=await S.query(c,"SELECT GET_LOCK('inventario_cliente_sin_documento',10) acquired");
        if(Number(lock.acquired)!==1) throw new Error('No se pudo validar el cliente. Intente nuevamente.');
        locked=true;
        const name=row.nombre.replace(/\s+/gu,' ').trim();
        const matches=await S.query(c,`SELECT id_cliente FROM Clientes
            WHERE (documento IS NULL OR TRIM(documento)='')
              AND REGEXP_REPLACE(TRIM(nombre),'[[:space:]]+',' ') COLLATE utf8mb4_unicode_ci = ?
              AND (? IS NULL OR id_cliente<>?) LIMIT 1`,[name,editId,editId]);
        if(matches.length) throw new Error('Ya existe un cliente sin documento con ese nombre. Búsquelo o reactive el registro; si es otra persona, agregue su documento.');
        return await write(c);
    } finally {
        try {if(locked) await S.query(c,"SELECT RELEASE_LOCK('inventario_cliente_sin_documento')");}
        finally {c.release();}
    }
}
for(const config of [{path:'clientes',table:'Clientes',id:'id_cliente',kind:'venta',title:'Clientes'}, {path:'proveedores',table:'Proveedores',id:'id_proveedor',kind:'compra',title:'Proveedores'}]) {
    const {path,table,id,kind,title}=config;
    const access=path==='proveedores'?isLoggedInAdmin:isLoggedIn;
    router.get('/'+path,access,(req,res)=>res.render('gestion/contactos',{path,title,esAdmin:Number(req.user.tipo)===1}));
    router.get('/'+path+'/buscar',access,safe(async(req,res)=>{
        const term=String(req.query.q||'').trim().slice(0,150);
        if(term.length<2) return res.json([]);
        res.json(await q(`SELECT ${id} id,nombre,tipo_documento,documento FROM ${table} WHERE activo=1 AND (nombre LIKE ? OR documento LIKE ?) ORDER BY nombre LIMIT 12`,['%'+term+'%','%'+term+'%']));
    }));
    router.get('/'+path+'/datos',access,safe(async(req,res)=>{
        const term=String(req.query.q||'').trim().slice(0,150),page=Math.max(1,parseInt(req.query.page)||1);
        const where='WHERE (nombre LIKE ? OR documento LIKE ?)'; const args=['%'+term+'%','%'+term+'%'];
        const [count]=await q(`SELECT COUNT(*) total FROM ${table} ${where}`,args);
        const rows=await q(`SELECT *,${id} id FROM ${table} ${where} ORDER BY activo DESC,nombre LIMIT 30 OFFSET ?`,[...args,(page-1)*30]);
        res.json({rows,total:count.total,page});
    }));
    router.post('/'+path,access,safe(async(req,res)=>{
        const row=contactData(req.body);
        try {const result=await saveContact(table,id,row);res.json({id:result.insertId,...row});}
        catch(e){if(e.code==='ER_DUP_ENTRY') throw new Error('Ya existe un registro con ese tipo y número de documento. Búsquelo o reactive el registro.');throw e;}
    }));
    router.post('/'+path+'/:id/editar',access,admin,safe(async(req,res)=>{
        const row=contactData(req.body);row.activo=req.body.activo===false||req.body.activo==='0'?0:1;
        try {const result=await saveContact(table,id,row,req.params.id);if(!result.affectedRows) throw new Error('Registro inexistente.');res.json({ok:true});}
        catch(e){if(e.code==='ER_DUP_ENTRY') throw new Error('El documento ya está registrado.');throw e;}
    }));
    router.get('/'+path+'/:id/historial',access,safe(async(req,res)=>{
        const fechas=period(req.query),conditions=[`${id}=?`],params=[req.params.id];
        if(fechas.desde){conditions.push(`fecha_${kind}>=?`);params.push(fechas.desde);}
        if(fechas.hasta){conditions.push(`fecha_${kind}<DATE_ADD(?,INTERVAL 1 DAY)`);params.push(fechas.hasta);}
        const tableOp=kind==='compra'?'Compras':'Ventas',where=conditions.join(' AND ');
        const [total]=await q(`SELECT COUNT(*) operaciones,COALESCE(SUM(monto_total),0) total FROM ${tableOp} WHERE ${where}`,params);
        const page=Math.max(1,parseInt(req.query.page)||1);
        const rows=await q(`SELECT id_${kind} id,DATE_FORMAT(fecha_${kind},'%d/%m/%Y %H:%i:%s') fecha,monto_total,usuario_nombre FROM ${tableOp} WHERE ${where} ORDER BY fecha_${kind} DESC,id_${kind} DESC LIMIT 50 OFFSET ?`,[...params,(page-1)*50]);
        res.json({rows,...total,...fechas,page,base:kind==='compra'?'/compras':'/ventas'});
    }));
}
router.get('/inventario/kardex/:id',isLoggedIn,safe(async(req,res)=>{
    const [product]=await q('SELECT id_producto,nombre_producto FROM Productos WHERE id_producto=?',[req.params.id]);
    if(!product) return res.status(404).send('Producto no encontrado.');
    res.render('gestion/kardex',{product,esAdmin:Number(req.user.tipo)===1});
}));
router.get('/inventario/kardex/:id/datos',isLoggedIn,safe(async(req,res)=>{
    const fechas=period(req.query,false),where=['m.id_producto=?'],params=[req.params.id];
    if(fechas.desde){where.push('m.fecha>=?');params.push(fechas.desde);}
    if(fechas.hasta){where.push('m.fecha<DATE_ADD(?,INTERVAL 1 DAY)');params.push(fechas.hasta);}
    if(req.query.tipo){where.push('m.tipo=?');params.push(String(req.query.tipo));}
    const page=Math.max(1,parseInt(req.query.page)||1);
    const [count]=await q(`SELECT COUNT(*) total FROM Movimientos_inventario m WHERE ${where.join(' AND ')}`,params);
    const rows=await q(`SELECT m.*,DATE_FORMAT(m.fecha,'%d/%m/%Y %H:%i:%s') fecha_mostrar,
      DATE_FORMAT(f.fecha_vencimiento,'%d/%m/%Y') vencimiento FROM Movimientos_inventario m
      JOIN Fechas_vencimiento f ON f.id_fechavencimiento=m.id_fechavencimiento WHERE ${where.join(' AND ')}
      ORDER BY m.fecha DESC,m.id_movimiento DESC LIMIT 50 OFFSET ?`,[...params,(page-1)*50]);
    if(Number(req.user.tipo)!==1) rows.forEach(r=>{delete r.costo_unitario;delete r.costo_estimado;});
    const [balance]=await q('SELECT COALESCE(SUM(inventario),0) saldo FROM Fechas_vencimiento WHERE id_producto=?',[req.params.id]);
    const [opening]=await q("SELECT DATE_FORMAT(fecha,'%d/%m/%Y %H:%i:%s') fecha FROM Migraciones_inventario WHERE version='20261004_control_v1'");
    res.json({rows,total:count.total,page,saldo:balance.saldo,apertura:opening&&opening.fecha});
}));
router.get('/inventario/ajustes',isLoggedInAdmin,(req,res)=>res.render('gestion/ajustes',{token:randomUUID()}));
router.get('/inventario/ajustes/productos',isLoggedInAdmin,safe(async(req,res)=>{
    const term=String(req.query.q||'').trim().slice(0,100);
    if(term.length<2) return res.json([]);
    res.json(await q(`SELECT id_producto id,nombre_producto nombre FROM Productos WHERE nombre_producto LIKE ? OR EXISTS (SELECT 1 FROM Precios_productos pp WHERE pp.id_producto=Productos.id_producto AND pp.codigo_barras LIKE ?) ORDER BY nombre_producto LIMIT 15`,['%'+term+'%','%'+term+'%']));
}));
router.get('/inventario/ajustes/productos/:id',isLoggedInAdmin,safe(async(req,res)=>{
    const unidades=await q(`SELECT DISTINCT u.id_unidad,u.nombre,u.cantidad FROM Unidades u JOIN Precios_productos pp ON pp.id_unidad=u.id_unidad WHERE pp.id_producto=? ORDER BY u.cantidad`,[req.params.id]);
    const lotes=await q("SELECT id_fechavencimiento,inventario,DATE_FORMAT(fecha_vencimiento,'%Y-%m-%d') fecha FROM Fechas_vencimiento WHERE id_producto=? AND inventario>0 ORDER BY fecha_vencimiento IS NULL,fecha_vencimiento",[req.params.id]);
    res.json({unidades,lotes});
}));
router.get('/inventario/ajustes/datos',isLoggedInAdmin,safe(async(req,res)=>{
    const fechas=period(req.query),where=[],params=[];
    if(fechas.desde){where.push('a.fecha>=?');params.push(fechas.desde);}
    if(fechas.hasta){where.push('a.fecha<DATE_ADD(?,INTERVAL 1 DAY)');params.push(fechas.hasta);}
    const condition=where.length?'WHERE '+where.join(' AND '):'';
    const page=Math.max(1,parseInt(req.query.page)||1);
    const [count]=await q(`SELECT COUNT(*) total FROM Ajustes_inventario a ${condition}`,params);
    const rows=await q(`SELECT a.*,DATE_FORMAT(a.fecha,'%d/%m/%Y %H:%i:%s') fecha_mostrar,r.id_ajuste revertido_por
      FROM Ajustes_inventario a LEFT JOIN Ajustes_inventario r ON r.reversa_de=a.id_ajuste ${condition}
      ORDER BY a.fecha DESC,a.id_ajuste DESC LIMIT 50 OFFSET ?`,[...params,(page-1)*50]);
    res.json({rows,total:count.total,page,...fechas});
}));
router.get('/inventario/ajustes/:id/detalle',isLoggedInAdmin,safe(async(req,res)=>{
    res.json(await q(`SELECT d.*,p.nombre_producto,COALESCE(d.nombre_unidad_historico,u.nombre) unidad,DATE_FORMAT(f.fecha_vencimiento,'%d/%m/%Y') vencimiento
      FROM Detalle_ajuste d JOIN Productos p ON p.id_producto=d.id_producto
      LEFT JOIN Unidades u ON u.id_unidad=d.id_unidad JOIN Fechas_vencimiento f ON f.id_fechavencimiento=d.id_fechavencimiento
      WHERE d.id_ajuste=?`,[req.params.id]));
}));
async function adjustmentDetails(c,id,p,unit,factor,parts,unitName='Unidad base') {
    for(const part of parts) await S.query(c,`INSERT INTO Detalle_ajuste (id_ajuste,id_producto,id_unidad,id_fechavencimiento,cantidad,factor_unidad,cantidad_base,costo_unitario,nombre_unidad_historico) VALUES(?,?,?,?,?,?,?,?,?)`,
      [id,p.id_producto,unit,part.lot,S.qty(S.D(part.quantity).div(factor)),factor,part.quantity,part.cost,unitName]);
}
router.post('/inventario/ajustes',isLoggedIn,admin,safe(async(req,res)=>{
    const body=req.body,key=S.token(body.token_operacion);
    if(!['ENTRADA','SALIDA'].includes(body.tipo)) throw new Error('Seleccione entrada o salida.');
    const motivo=String(body.motivo||'').trim(),obs=String(body.observacion||'').trim();
    if(!motivo||motivo.length>100||!obs||obs.length>500) throw new Error('Indique motivo y observación (máximo 500 caracteres).');
    if(!Array.isArray(body.lineas)||!body.lineas.length||body.lineas.length>100) throw new Error('Agregue entre 1 y 100 productos.');
    let id;
    try {id=await S.transaction(async c=>{
        const [previous]=await S.query(c,'SELECT id_ajuste FROM Ajustes_inventario WHERE token_operacion=?',[key]);
        if(previous) return previous.id_ajuste;
        const products=await S.lockProducts(c,body.lineas.map(l=>l.id_producto));
        const result=await S.query(c,`INSERT INTO Ajustes_inventario (tipo,motivo,observacion,fecha,id_usuario,usuario_nombre,token_operacion) VALUES(?,?,?,CONVERT_TZ(UTC_TIMESTAMP(6),'+00:00','-05:00'),?,?,?)`,[body.tipo,motivo,obs,req.user.id_usuario,req.user.nombre,key]);
        for(const l of body.lineas) {
            const p=products.get(Number(l.id_producto));
            let factor='1.000',unit=null,unitName='Unidad base';
            if(l.id_unidad) {
                const [u]=await S.query(c,'SELECT u.* FROM Unidades u JOIN Precios_productos pp ON pp.id_unidad=u.id_unidad WHERE pp.id_producto=? AND u.id_unidad=? LIMIT 1 FOR UPDATE',[p.id_producto,l.id_unidad]);
                if(!u) throw new Error('Presentación inválida.');factor=u.cantidad;unit=u.id_unidad;unitName=u.nombre;
            }
            const quantity=S.positive(l.cantidad).mul(factor);
            if(quantity.decimalPlaces()>3) throw new Error('La cantidad base no puede tener más de tres decimales.');
            const meta={tipo:'AJUSTE_'+body.tipo,id_ajuste:result.insertId,user:req.user,observacion:motivo+': '+obs,nombre_unidad:unitName,factor_unidad:factor};
            let parts;
            if(body.tipo==='ENTRADA') {
                let unitCost=p.costo_promedio;
                if(l.costo_base!=='' && l.costo_base!=null) unitCost=S.cost(S.positive(l.costo_base,'Costo por unidad base'));
                parts=await S.enter(c,p,quantity,unitCost,S.validDate(l.fecha),meta,1);
            } else parts=await S.leave(c,p,quantity,meta,l.id_lote||null);
            await adjustmentDetails(c,result.insertId,p,unit,factor,parts,unitName);
        }
        return result.insertId;
    });}catch(e){if(e.code==='ER_DUP_ENTRY'){const [r]=await q('SELECT id_ajuste FROM Ajustes_inventario WHERE token_operacion=?',[key]);if(r) id=r.id_ajuste;else throw e;}else throw e;}
    res.json({id});
}));
router.post('/inventario/ajustes/:id/revertir',isLoggedIn,admin,safe(async(req,res)=>{
    const obs=String(req.body.observacion||'').trim();
    if(!obs||obs.length>500) throw new Error('Indique el motivo de la reversión (hasta 500 caracteres).');
    const id=await S.transaction(async c=>{
        const [original]=await S.query(c,'SELECT * FROM Ajustes_inventario WHERE id_ajuste=? FOR UPDATE',[req.params.id]);
        if(!original||original.reversa_de) throw new Error('Solo se puede revertir un ajuste original.');
        const [done]=await S.query(c,'SELECT id_ajuste FROM Ajustes_inventario WHERE reversa_de=?',[original.id_ajuste]);
        if(done) return done.id_ajuste;
        const lines=await S.query(c,'SELECT d.*,f.fecha_vencimiento FROM Detalle_ajuste d JOIN Fechas_vencimiento f ON f.id_fechavencimiento=d.id_fechavencimiento WHERE id_ajuste=?',[original.id_ajuste]);
        const products=await S.lockProducts(c,lines.map(l=>l.id_producto));
        const tipo=original.tipo==='ENTRADA'?'SALIDA':'ENTRADA';
        const result=await S.query(c,`INSERT INTO Ajustes_inventario (tipo,motivo,observacion,fecha,id_usuario,usuario_nombre,reversa_de,token_operacion) VALUES(?,'Reversión',?,CONVERT_TZ(UTC_TIMESTAMP(6),'+00:00','-05:00'),?,?,?,?)`,[tipo,obs,req.user.id_usuario,req.user.nombre,original.id_ajuste,randomUUID()]);
        for(const l of lines) {
            const p=products.get(Number(l.id_producto)),meta={tipo:'REVERSO_'+tipo,id_ajuste:result.insertId,user:req.user,observacion:`Reversión del ajuste #${original.id_ajuste}: ${obs}`,nombre_unidad:l.nombre_unidad_historico,factor_unidad:l.factor_unidad};
            const parts=tipo==='ENTRADA'?await S.enter(c,p,l.cantidad_base,l.costo_unitario,l.fecha_vencimiento,meta,1,l.id_fechavencimiento):await S.leave(c,p,l.cantidad_base,meta,l.id_fechavencimiento);
            await adjustmentDetails(c,result.insertId,p,l.id_unidad,l.factor_unidad,parts,l.nombre_unidad_historico);
        }
        return result.insertId;
    });
    res.json({id});
}));
router.post('/inventario/:id/valoracion',isLoggedIn,admin,safe(async(req,res)=>{
    const value=S.cost(S.positive(req.body.costo,'Costo de apertura'));
    const obs=String(req.body.observacion||'').trim();
    if(!obs||obs.length>450) throw new Error('Indique el sustento del costo (hasta 450 caracteres).');
    await S.transaction(async c=>{
        const products=await S.lockProducts(c,[req.params.id]),p=products.get(Number(req.params.id));
        if(p.costo_promedio!=null) throw new Error('El producto ya tiene costo. No se permite sobrescribirlo.');
        const [lot]=await S.query(c,'SELECT id_fechavencimiento FROM Fechas_vencimiento WHERE id_producto=? ORDER BY id_fechavencimiento LIMIT 1',[p.id_producto]);
        if(!lot) throw new Error('El producto no tiene lotes. Registre una compra o entrada.');
        p.costo_promedio=value;p.costo_estimado=1;
        await S.movement(c,p,lot.id_fechavencimiento,0,value,1,{tipo:'VALORIZACION',user:req.user,observacion:obs});
        await S.updateState(c,p);
    });res.json({ok:true});
}));
module.exports=router;
