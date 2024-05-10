CREATE TABLE Productos (
    id_producto INTEGER AUTO_INCREMENT,
    nombre_producto VARCHAR(40) NOT NULL,
    cantidad_limite INTEGER NULL,
    fecha_notificacion INTEGER NULL,
    estado_producto INTEGER NOT NULL,
    PRIMARY KEY (id_producto)
);
CREATE TABLE Unidades (
    id_unidad INTEGER AUTO_INCREMENT,
    nombre VARCHAR(70) NOT NULL,
    cantidad DECIMAL(10, 3) NOT NULL,
    PRIMARY KEY (id_unidad)
);
CREATE TABLE Precios_productos (
    id_precio INTEGER AUTO_INCREMENT,
    precio_compra DECIMAL(10, 3) NULL,
    precio_venta DECIMAL(10, 3) NULL,
    id_producto INTEGER NOT NULL,
    id_unidad INTEGER NOT NULL,
    PRIMARY KEY (id_precio),
    FOREIGN KEY (id_producto) REFERENCES Productos (id_producto),
    FOREIGN KEY (id_unidad) REFERENCES Unidades (id_unidad)
);
CREATE TABLE Fechas_vencimiento (
    id_fechavencimiento INTEGER AUTO_INCREMENT,
    fecha_vencimiento DATE NULL,
    inventario DECIMAL(10, 3) NULL,
    id_producto INTEGER NOT NULL,
    PRIMARY KEY (id_fechavencimiento),
    FOREIGN KEY (id_producto) REFERENCES Productos (id_producto)
);
CREATE TABLE usuarios (
    id_usuario INTEGER AUTO_INCREMENT,
    nombre VARCHAR(70) NOT NULL,
    usuario VARCHAR(40) NOT NULL,
    contra TEXT NOT NULL,
    tipo INTEGER NOT NULL,
    PRIMARY KEY (id_usuario)
);
CREATE TABLE Compras (
    id_compra INTEGER AUTO_INCREMENT,
    fecha_compra DATE NOT NULL,
    monto_total DECIMAL(10, 3) NOT NULL,
    PRIMARY KEY (id_compra)
);
CREATE TABLE Detalle_compra (
    id_producto INTEGER NOT NULL,
    cantidad_producto INTEGER NOT NULL,
    precio_parcial DECIMAL(10, 3) NOT NULL,
    id_compra INTEGER NOT NULL,
    id_unidad INTEGER NOT NULL,
    PRIMARY KEY (id_producto, id_compra),
    FOREIGN KEY (id_producto) REFERENCES Productos (id_producto),
    FOREIGN KEY (id_compra) REFERENCES Compras (id_compra),
    FOREIGN KEY (id_unidad) REFERENCES Unidades (id_unidad)
);
CREATE TABLE Ventas (
    id_venta INTEGER AUTO_INCREMENT,
    fecha_venta DATE NOT NULL,
    monto_total DECIMAL(10, 3) NOT NULL,
    PRIMARY KEY (id_venta)
);
CREATE TABLE Detalle_venta (
    id_producto INTEGER NOT NULL,
    cantidad_producto INTEGER NOT NULL,
    precio_parcial DECIMAL(10, 3) NOT NULL,
    id_venta INTEGER NOT NULL,
    id_unidad INTEGER NOT NULL,
    PRIMARY KEY (id_producto, id_venta),
    FOREIGN KEY (id_producto) REFERENCES Productos (id_producto),
    FOREIGN KEY (id_venta) REFERENCES Ventas (id_venta),
    FOREIGN KEY (id_unidad) REFERENCES Unidades (id_unidad)
);
CREATE TABLE Notificaciones (
    id_notificacion INTEGER AUTO_INCREMENT,
    contenido TEXT NOT NULL,
    estado INTEGER NOT NULL,
    id_usuario INTEGER NOT NULL,
    id_producto INTEGER NULL,
    id_fecha_vencimiento INTEGER NULL,
    fecha_vencimiento DATE NULL,
    fecha_noti DATE NULL,
    existencias INTEGER NULL,
    PRIMARY KEY (id_notificacion),
    FOREIGN KEY (id_usuario) REFERENCES usuarios (id_usuario),
    FOREIGN KEY (id_producto) REFERENCES Productos (id_producto),
    FOREIGN KEY (id_fecha_vencimiento) REFERENCES Fechas_vencimiento (id_fechavencimiento)
);