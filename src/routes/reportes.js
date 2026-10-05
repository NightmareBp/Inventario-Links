'use strict';
const router=require('express').Router();
const {isLoggedInAdmin}=require('../lib/auth');
const {query,D,today}=require('../lib/stock');
const {period,safe}=require('../lib/gestion');
const q=(sql,params=[])=>query(null,sql,params);
router.use(isLoggedInAdmin);
router.get('/',(req,res)=>res.render('gestion/reportes'));
function whereDates(field,dates){const clauses=[],params=[];if(dates.desde){clauses.push(`${field}>=?`);params.push(dates.desde);}if(dates.hasta){clauses.push(`${field}<DATE_ADD(?,INTERVAL 1 DAY)`);params.push(dates.hasta);}return {where:clauses.length?'WHERE '+clauses.join(' AND '):'',params};}
async function inventory() {
    return q(`SELECT p.id_producto,p.nombre_producto,p.cantidad_limite,p.costo_promedio,p.costo_estimado,
      COALESCE(f.stock,0) stock,COALESCE(f.vencido,0) vencido,
      CASE WHEN p.costo_promedio IS NULL THEN NULL ELSE COALESCE(f.stock,0)*p.costo_promedio END valor
      FROM Productos p LEFT JOIN (SELECT id_producto,SUM(inventario) stock,
        SUM(CASE WHEN fecha_vencimiento < ? THEN inventario ELSE 0 END) vencido
        FROM Fechas_vencimiento GROUP BY id_producto) f ON f.id_producto=p.id_producto
      ORDER BY valor DESC,p.nombre_producto`,[today()]);
}
router.get('/datos',safe(async(req,res)=>{
    const dates=period(req.query),v=whereDates('v.fecha_venta',dates),c=whereDates('c.fecha_compra',dates),a=whereDates('fecha',dates);
    const [sales,purchases,daily,ranking,clients,providers,adjustments,profit,capital,expiry]=await Promise.all([
      q(`SELECT COUNT(*) operaciones,COALESCE(SUM(v.monto_total),0) total,COALESCE(AVG(v.monto_total),0) ticket FROM Ventas v ${v.where}`,v.params),
      q(`SELECT COUNT(*) operaciones,COALESCE(SUM(c.monto_total),0) total FROM Compras c ${c.where}`,c.params),
      q(`SELECT DATE_FORMAT(v.fecha_venta,'%Y-%m-%d') fecha,SUM(v.monto_total) total FROM Ventas v ${v.where} GROUP BY DATE_FORMAT(v.fecha_venta,'%Y-%m-%d') ORDER BY fecha`,v.params),
      q(`SELECT p.id_producto,p.nombre_producto,SUM(d.precio_parcial) importe,SUM(d.cantidad_producto*COALESCE(d.factor_unidad,u.cantidad)) cantidad_base,
         SUM(d.factor_unidad IS NULL) lineas_anteriores FROM Detalle_venta d JOIN Ventas v ON v.id_venta=d.id_venta
         JOIN Productos p ON p.id_producto=d.id_producto JOIN Unidades u ON u.id_unidad=d.id_unidad ${v.where}
         GROUP BY p.id_producto,p.nombre_producto ORDER BY importe DESC`,v.params),
      q(`SELECT v.id_cliente,COALESCE(cl.nombre,'Sin cliente') nombre,SUM(v.monto_total) total,COUNT(*) operaciones FROM Ventas v LEFT JOIN Clientes cl ON cl.id_cliente=v.id_cliente ${v.where} GROUP BY v.id_cliente,cl.nombre ORDER BY total DESC LIMIT 10`,v.params),
      q(`SELECT c.id_proveedor,COALESCE(pr.nombre,'Sin proveedor') nombre,SUM(c.monto_total) total,COUNT(*) operaciones FROM Compras c LEFT JOIN Proveedores pr ON pr.id_proveedor=c.id_proveedor ${c.where} GROUP BY c.id_proveedor,pr.nombre ORDER BY total DESC LIMIT 10`,c.params),
      q(`SELECT tipo,motivo,COUNT(*) operaciones FROM Ajustes_inventario ${a.where} GROUP BY tipo,motivo ORDER BY operaciones DESC`,a.params),
      q(`SELECT COUNT(*) lineas,COALESCE(SUM(d.costo_unitario_base IS NULL),0) sin_costo,
       COALESCE(SUM(d.costo_unitario_base IS NOT NULL AND d.costo_estimado=1),0) estimadas,
       COALESCE(SUM(CASE WHEN d.costo_unitario_base IS NOT NULL THEN d.precio_parcial-d.cantidad_producto*d.factor_unidad*d.costo_unitario_base ELSE 0 END),0) margen
       FROM Detalle_venta d JOIN Ventas v ON v.id_venta=d.id_venta ${v.where}`,v.params),
      inventory(),
      q(`SELECT p.id_producto,p.nombre_producto,f.inventario,DATE_FORMAT(f.fecha_vencimiento,'%d/%m/%Y') fecha,
       f.fecha_vencimiento < ? vencido FROM Fechas_vencimiento f JOIN Productos p ON p.id_producto=f.id_producto
       WHERE f.inventario>0 AND f.fecha_vencimiento<=DATE_ADD(?,INTERVAL 30 DAY) ORDER BY f.fecha_vencimiento,p.nombre_producto`,[today(),today()])
    ]);
    const known=capital.reduce((s,r)=>s.plus(r.valor||0),D(0));
    const missing=capital.filter(r=>Number(r.stock)>0&&r.costo_promedio==null).length;
    const [opening]=await q("SELECT DATE_FORMAT(fecha,'%d/%m/%Y %H:%i:%s') fecha FROM Migraciones_inventario WHERE version='20261004_control_v1'");
    res.json({...dates,sales:sales[0],purchases:purchases[0],daily,ranking,clients,providers,adjustments,profit:profit[0],capital,expiry,
      valor_conocido:known.toFixed(3),sin_costo:missing,apertura:opening&&opening.fecha});
}));
router.get('/inventario.csv',safe(async(req,res)=>{
    const rows=await inventory();
    const cell=value=>'"'+String(value==null?'':value).replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
    const data=[['Producto','Stock unidad base','Costo por unidad base','Valor inventario','Estado costo','Stock vencido'],
      ...rows.map(r=>[r.nombre_producto,r.stock,r.costo_promedio,r.valor,r.costo_promedio==null?'Pendiente':r.costo_estimado?'Estimado':'Registrado',r.vencido])];
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="inventario_valorizado.csv"');
    res.send('\uFEFF'+data.map(row=>row.map(cell).join(';')).join('\r\n'));
}));
module.exports=router;
