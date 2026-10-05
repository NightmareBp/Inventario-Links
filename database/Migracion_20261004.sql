-- MIGRACIÓN 20261004_control_v1. MySQL 8.0.46.
-- Ejecutar con la aplicación DETENIDA y respaldo verificado. No usar mysql --force.
-- Reejecutable: DDL condicional, apertura transaccional y marca de versión.
-- MySQL confirma DDL implícitamente; la restauración del respaldo es la reversión completa.
SET NAMES utf8mb4;
DELIMITER $$
DROP PROCEDURE IF EXISTS inventario_preflight$$
CREATE PROCEDURE inventario_preflight()
BEGIN
 IF DATABASE() IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Seleccione la base de datos'; END IF;
 IF EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' AND ENGINE <> 'InnoDB') THEN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Hay tablas que no son InnoDB'; END IF;
 IF EXISTS (SELECT 1 FROM Fechas_vencimiento WHERE inventario < 0) THEN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Hay stock negativo: revisar antes de migrar'; END IF;
 IF EXISTS (SELECT 1 FROM Unidades WHERE cantidad <= 0) THEN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Hay equivalencias de unidad no positivas'; END IF;
END$$
CALL inventario_preflight()$$
DROP PROCEDURE inventario_preflight$$
DROP PROCEDURE IF EXISTS inventario_columna$$
CREATE PROCEDURE inventario_columna(IN tabla VARCHAR(64), IN columna VARCHAR(64), IN definicion TEXT)
BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=tabla AND COLUMN_NAME=columna) THEN
 SET @ddl=CONCAT('ALTER TABLE `',tabla,'` ADD COLUMN `',columna,'` ',definicion);
 PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
 END IF;
END$$
DROP PROCEDURE IF EXISTS inventario_indice$$
CREATE PROCEDURE inventario_indice(IN tabla VARCHAR(64), IN nombre VARCHAR(64), IN definicion TEXT)
BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=tabla AND INDEX_NAME=nombre) THEN
 SET @ddl=CONCAT('ALTER TABLE `',tabla,'` ADD ',definicion);
 PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
 END IF;
END$$
DROP PROCEDURE IF EXISTS inventario_fk$$
CREATE PROCEDURE inventario_fk(IN tabla VARCHAR(64), IN nombre VARCHAR(64), IN definicion TEXT)
BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=tabla AND CONSTRAINT_NAME=nombre) THEN
 SET @ddl=CONCAT('ALTER TABLE `',tabla,'` ADD CONSTRAINT `',nombre,'` ',definicion);
 PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
 END IF;
END$$
DELIMITER ;
CREATE TABLE IF NOT EXISTS Clientes (
 id_cliente INT AUTO_INCREMENT PRIMARY KEY,
 nombre VARCHAR(150) NOT NULL, tipo_documento VARCHAR(10) NULL, documento VARCHAR(25) NULL,
 telefono VARCHAR(30) NULL, direccion VARCHAR(250) NULL, correo VARCHAR(150) NULL,
 contacto VARCHAR(150) NULL, activo TINYINT NOT NULL DEFAULT 1,
 UNIQUE KEY uq_cliente_documento (tipo_documento, documento), KEY ix_cliente_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS Proveedores (
 id_proveedor INT AUTO_INCREMENT PRIMARY KEY,
 nombre VARCHAR(150) NOT NULL, tipo_documento VARCHAR(10) NULL, documento VARCHAR(25) NULL,
 telefono VARCHAR(30) NULL, direccion VARCHAR(250) NULL, correo VARCHAR(150) NULL,
 contacto VARCHAR(150) NULL, activo TINYINT NOT NULL DEFAULT 1,
 UNIQUE KEY uq_proveedor_documento (tipo_documento, documento), KEY ix_proveedor_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS Ajustes_inventario (
 id_ajuste INT AUTO_INCREMENT PRIMARY KEY,
 tipo ENUM('ENTRADA','SALIDA') NOT NULL, motivo VARCHAR(100) NOT NULL,
 observacion VARCHAR(500) NOT NULL, fecha DATETIME(6) NOT NULL,
 id_usuario INT NOT NULL, usuario_nombre VARCHAR(70) NOT NULL,
 reversa_de INT NULL, token_operacion VARCHAR(64) NOT NULL,
 UNIQUE KEY uq_ajuste_token (token_operacion), UNIQUE KEY uq_ajuste_reversa (reversa_de),
 FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario),
 FOREIGN KEY (reversa_de) REFERENCES Ajustes_inventario(id_ajuste), KEY ix_ajuste_fecha (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS Detalle_ajuste (
 id_detalle INT AUTO_INCREMENT PRIMARY KEY, id_ajuste INT NOT NULL,
 id_producto INT NOT NULL, id_unidad INT NULL, id_fechavencimiento INT NOT NULL,
 cantidad DECIMAL(14,3) NOT NULL, factor_unidad DECIMAL(10,3) NOT NULL,
 cantidad_base DECIMAL(14,3) NOT NULL, costo_unitario DECIMAL(18,6) NULL,
 nombre_unidad_historico VARCHAR(70) NULL,
 FOREIGN KEY (id_ajuste) REFERENCES Ajustes_inventario(id_ajuste),
 FOREIGN KEY (id_producto) REFERENCES Productos(id_producto),
 FOREIGN KEY (id_unidad) REFERENCES Unidades(id_unidad),
 FOREIGN KEY (id_fechavencimiento) REFERENCES Fechas_vencimiento(id_fechavencimiento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS Movimientos_inventario (
 id_movimiento BIGINT AUTO_INCREMENT PRIMARY KEY, fecha DATETIME(6) NOT NULL,
 tipo VARCHAR(30) NOT NULL, id_producto INT NOT NULL, id_fechavencimiento INT NOT NULL,
 id_compra INT NULL, id_venta INT NULL, id_ajuste INT NULL,
 id_usuario INT NULL, usuario_nombre VARCHAR(70) NULL,
 entrada DECIMAL(14,3) NOT NULL DEFAULT 0, salida DECIMAL(14,3) NOT NULL DEFAULT 0,
 saldo DECIMAL(14,3) NOT NULL, costo_unitario DECIMAL(18,6) NULL,
 costo_estimado TINYINT NOT NULL DEFAULT 1, observacion VARCHAR(500) NULL,
 nombre_unidad VARCHAR(70) NULL, factor_unidad DECIMAL(10,3) NULL, cantidad_presentacion DECIMAL(18,6) NULL,
 FOREIGN KEY (id_producto) REFERENCES Productos(id_producto),
 FOREIGN KEY (id_fechavencimiento) REFERENCES Fechas_vencimiento(id_fechavencimiento),
 FOREIGN KEY (id_compra) REFERENCES Compras(id_compra),
 FOREIGN KEY (id_venta) REFERENCES Ventas(id_venta),
 FOREIGN KEY (id_ajuste) REFERENCES Ajustes_inventario(id_ajuste),
 FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario),
 KEY ix_mov_producto_fecha (id_producto,fecha,id_movimiento), KEY ix_mov_fecha (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS Migraciones_inventario (
 version VARCHAR(80) PRIMARY KEY, fecha DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CALL inventario_columna('Productos','costo_promedio','DECIMAL(18,6) NULL');
CALL inventario_columna('Productos','costo_estimado','TINYINT NOT NULL DEFAULT 1');
CALL inventario_columna('usuarios','activo','TINYINT NOT NULL DEFAULT 1');
CALL inventario_columna('Compras','id_proveedor','INT NULL');
CALL inventario_columna('Compras','id_usuario','INT NULL');
CALL inventario_columna('Compras','usuario_nombre','VARCHAR(70) NULL');
CALL inventario_columna('Compras','contacto_nombre','VARCHAR(150) NULL');
CALL inventario_columna('Compras','contacto_documento','VARCHAR(25) NULL');
CALL inventario_columna('Compras','token_operacion','VARCHAR(64) NULL');
CALL inventario_columna('Ventas','id_cliente','INT NULL');
CALL inventario_columna('Ventas','id_usuario','INT NULL');
CALL inventario_columna('Ventas','usuario_nombre','VARCHAR(70) NULL');
CALL inventario_columna('Ventas','contacto_nombre','VARCHAR(150) NULL');
CALL inventario_columna('Ventas','contacto_documento','VARCHAR(25) NULL');
CALL inventario_columna('Ventas','token_operacion','VARCHAR(64) NULL');
CALL inventario_columna('Detalle_compra','factor_unidad','DECIMAL(10,3) NULL');
CALL inventario_columna('Detalle_compra','nombre_unidad_historico','VARCHAR(70) NULL');
CALL inventario_columna('Detalle_compra','nombre_producto_historico','VARCHAR(40) NULL');
CALL inventario_columna('Detalle_compra','fecha_vencimiento','DATE NULL');
CALL inventario_columna('Detalle_venta','factor_unidad','DECIMAL(10,3) NULL');
CALL inventario_columna('Detalle_venta','nombre_unidad_historico','VARCHAR(70) NULL');
CALL inventario_columna('Detalle_venta','nombre_producto_historico','VARCHAR(40) NULL');
CALL inventario_columna('Detalle_venta','costo_unitario_base','DECIMAL(18,6) NULL');
CALL inventario_columna('Detalle_venta','costo_estimado','TINYINT NOT NULL DEFAULT 1');
-- Un identificador por línea permite recibir el mismo producto en distintos vencimientos.
CALL inventario_indice('Detalle_compra','ix_dc_producto','INDEX ix_dc_producto (id_producto)');
DELIMITER $$
DROP PROCEDURE IF EXISTS inventario_detalle$$
CREATE PROCEDURE inventario_detalle()
BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Detalle_compra' AND COLUMN_NAME='id_detalle') THEN
 ALTER TABLE Detalle_compra DROP PRIMARY KEY, ADD COLUMN id_detalle INT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST;
 END IF;
END$$
CALL inventario_detalle()$$
DROP PROCEDURE inventario_detalle$$
DELIMITER ;
ALTER TABLE Compras MODIFY fecha_compra DATETIME NOT NULL;
ALTER TABLE Ventas MODIFY fecha_venta DATETIME NOT NULL;
CALL inventario_fk('Compras','fk_compras_id_proveedor','FOREIGN KEY (id_proveedor) REFERENCES Proveedores(id_proveedor)');
CALL inventario_fk('Ventas','fk_ventas_id_cliente','FOREIGN KEY (id_cliente) REFERENCES Clientes(id_cliente)');
CALL inventario_fk('Compras','fk_compras_id_usuario','FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)');
CALL inventario_fk('Ventas','fk_ventas_id_usuario','FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)');
CALL inventario_indice('Compras','uq_token','UNIQUE INDEX uq_token (token_operacion)');
CALL inventario_indice('Compras','ix_fecha','INDEX ix_fecha (fecha_compra)');
CALL inventario_indice('Ventas','uq_token','UNIQUE INDEX uq_token (token_operacion)');
CALL inventario_indice('Ventas','ix_fecha','INDEX ix_fecha (fecha_venta)');
DROP PROCEDURE inventario_columna;
DROP PROCEDURE inventario_indice;
DROP PROCEDURE inventario_fk;
DELIMITER $$
DROP PROCEDURE IF EXISTS inventario_apertura$$
CREATE PROCEDURE inventario_apertura()
BEGIN
 DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
 START TRANSACTION;
 IF NOT EXISTS (SELECT 1 FROM Migraciones_inventario WHERE version='20261004_control_v1') THEN
 -- Costo de apertura SOLO si todas las presentaciones con precio positivo coinciden
 -- al convertir a unidad base (6 decimales). Lo ambiguo permanece NULL para revisión.
 UPDATE Productos p LEFT JOIN (
   SELECT pp.id_producto,
     IF(MIN(ROUND(pp.precio_compra/u.cantidad,6))=MAX(ROUND(pp.precio_compra/u.cantidad,6)),
        MIN(ROUND(pp.precio_compra/u.cantidad,6)),NULL) costo
   FROM Precios_productos pp JOIN Unidades u ON u.id_unidad=pp.id_unidad
   WHERE pp.precio_compra>0 AND u.cantidad>0 GROUP BY pp.id_producto
 ) c ON c.id_producto=p.id_producto
 SET p.costo_promedio=c.costo, p.costo_estimado=1;
 SET @apertura=CONVERT_TZ(UTC_TIMESTAMP(6),'+00:00','-05:00');
 INSERT INTO Movimientos_inventario
 (fecha,tipo,id_producto,id_fechavencimiento,entrada,salida,saldo,costo_unitario,costo_estimado,observacion)
 SELECT @apertura,'APERTURA',f.id_producto,f.id_fechavencimiento,COALESCE(f.inventario,0),0,
   SUM(COALESCE(f.inventario,0)) OVER (PARTITION BY f.id_producto ORDER BY f.id_fechavencimiento),
   p.costo_promedio,1,'Saldo al migrar. Historial anterior no reconstruible; costo de apertura estimado.'
 FROM Fechas_vencimiento f JOIN Productos p ON p.id_producto=f.id_producto
 ORDER BY f.id_producto,f.id_fechavencimiento;
 INSERT INTO Migraciones_inventario VALUES ('20261004_control_v1',@apertura);
 END IF;
 COMMIT;
END$$
CALL inventario_apertura()$$
DROP PROCEDURE inventario_apertura$$
DELIMITER ;
SELECT version,fecha FROM Migraciones_inventario;
SELECT id_producto,nombre_producto FROM Productos WHERE costo_promedio IS NULL;
