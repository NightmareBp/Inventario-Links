-- Solo lectura. Ejecutar luego de migrar y después de las pruebas de uso.
-- Las primeras dos consultas deben devolver cero filas.
SELECT p.id_producto,p.nombre_producto,COALESCE(f.stock,0) stock,
       COALESCE(m.saldo_calculado,0) saldo_movimientos
FROM Productos p
LEFT JOIN (SELECT id_producto,SUM(inventario) stock FROM Fechas_vencimiento GROUP BY id_producto) f ON f.id_producto=p.id_producto
LEFT JOIN (SELECT id_producto,SUM(entrada-salida) saldo_calculado FROM Movimientos_inventario GROUP BY id_producto) m ON m.id_producto=p.id_producto
WHERE COALESCE(f.stock,0)<>COALESCE(m.saldo_calculado,0);
SELECT f.id_fechavencimiento,f.id_producto,f.inventario,COALESCE(m.cantidad,0) saldo_movimientos
FROM Fechas_vencimiento f
LEFT JOIN (SELECT id_fechavencimiento,SUM(entrada-salida) cantidad FROM Movimientos_inventario GROUP BY id_fechavencimiento) m ON m.id_fechavencimiento=f.id_fechavencimiento
WHERE COALESCE(f.inventario,0)<>COALESCE(m.cantidad,0);
SELECT version,fecha FROM Migraciones_inventario;
SELECT p.id_producto,p.nombre_producto,SUM(f.inventario) stock
FROM Productos p JOIN Fechas_vencimiento f ON f.id_producto=p.id_producto
WHERE p.costo_promedio IS NULL GROUP BY p.id_producto,p.nombre_producto HAVING SUM(f.inventario)>0;
