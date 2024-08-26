const express = require('express');
const router = express.Router();
const pool = require('../database');
const { isLoggedInAdmin } = require('../lib/auth');

router.get('/', isLoggedInAdmin, async (req, res) => {
    try {
        const { q, q1 } = req.query;
        const queryParams = [];
        let query = 'SELECT * FROM Compras WHERE fecha_compra BETWEEN ? AND ? ORDER BY fecha_compra DESC, id_compra DESC';
        let montototall = null;
        if (q && q1) {
            queryParams.push(q, q1);
            montototal = await pool.query('SELECT SUM(monto_total) AS total_compras FROM Compras WHERE fecha_compra BETWEEN ? AND ?;', [q, q1]);
            if (montototal[0].total_compras !== null) {
                montototall = montototal[0].total_compras.toFixed(2);
            } else {
                montototall = '';
            }
        } else {
            // Si no se proporcionan ambas fechas, muestra todas las compras
            query = 'SELECT * FROM Compras ORDER BY fecha_compra DESC, id_compra DESC';
        }

        const compras = await pool.query(query, queryParams);

        // Formatear las fechas y montos antes de renderizar la vista
        compras.forEach((element) => {
            const fechaCompra = new Date(element.fecha_compra);
            element.fecha_compra = fechaCompra.toLocaleDateString('es-ES', {
                weekday: 'long',
                year: 'numeric',
                month: 'numeric',
                day: 'numeric'
            });
            element.monto_total = parseFloat(element.monto_total).toFixed(2);
        });

        res.render('compras/listC', { compras, q, q1, montototall });
    } catch (error) {
        console.error('Error al obtener las compras:', error);
        res.status(500).send('Error interno del servidor');
    }
});

router.get('/add', isLoggedInAdmin, async (req, res) => {
    try {
        // Consulta para obtener todos los productos y su inventario
        const productos = await pool.query(`SELECT p.*, IFNULL(inventario_total, 0) AS inventario_total
        FROM Productos p
        LEFT JOIN (
            SELECT id_producto, SUM(inventario) AS inventario_total
            FROM Fechas_vencimiento
            GROUP BY id_producto
        ) fv ON p.id_producto = fv.id_producto
        ORDER BY p.nombre_producto ASC;`);

        // Renderizar la vista de agregar compra, pasando los productos
        res.render('compras/addCompra', { productos });
    } catch (error) {
        console.error('Error al obtener los productos para la compra:', error);
        res.status(500).send('Error interno del servidor');
    }
});

router.get('/productos/:idProducto/preciosCompra', isLoggedInAdmin, async (req, res) => {
    try {
        const { idProducto } = req.params;

        // Consulta para obtener los precios de compra del producto seleccionado con los nombres de las unidades
        const preciosCompra = await pool.query(`
            SELECT pp.*, u.nombre AS nombre_unidad 
            FROM Precios_productos pp 
            INNER JOIN Unidades u ON pp.id_unidad = u.id_unidad 
            WHERE pp.id_producto = ? AND pp.precio_compra != 0`, [idProducto]);

        res.json(preciosCompra); // Devolver los precios de compra como respuesta en formato JSON
    } catch (error) {
        console.error('Error al obtener los precios de compra del producto:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

router.post('/add', isLoggedInAdmin, async (req, res) => {
    try {
        const productos = Array.isArray(req.body.producto) ? req.body.producto : [req.body.producto];
        const precioscompra = Array.isArray(req.body.preciocompra) ? req.body.preciocompra : [req.body.preciocompra];
        const cantidades = Array.isArray(req.body.cantidad) ? req.body.cantidad : [req.body.cantidad];
        const fechasVencimiento = Array.isArray(req.body.fecha_vencimiento) ? req.body.fecha_vencimiento : [req.body.fecha_vencimiento];

        console.log(productos, cantidades, precioscompra, fechasVencimiento);

        // Validar entradas duplicadas
        for (let i = 0; i < cantidades.length; i++) {
            const producto = productos[i];
            const preciocompra = precioscompra[i];
            for (let j = i + 1; j < cantidades.length; j++) {
                if (producto === productos[j] && preciocompra === precioscompra[j] && fechasVencimiento[i] === fechasVencimiento[j]) {
                    req.flash('message', 'Existen Entradas Duplicadas');
                    return res.redirect('/compras/add');
                }
            }
        }

        // Validar cantidades
        for (let i = 0; i < cantidades.length; i++) {
            const cantidad = parseFloat(cantidades[i]); // Convertir el valor de cantidad a decimal
            if (isNaN(cantidad) || cantidad <= 0) { // Verificar si el valor no es un número o es menor o igual a cero
                req.flash('message', 'Por favor, ingrese cantidades válidas como números decimales.');
                return res.redirect('/compras/add');
            }
        }

        // Validar que la fecha de vencimiento sea mayor a la fecha actual
        const fechaActual = new Date();
        for (let i = 0; i < fechasVencimiento.length; i++) {
            const fechaVenc = new Date(fechasVencimiento[i]);
            if (fechaVenc && fechaVenc < fechaActual) {
                req.flash('message', 'La fecha de vencimiento debe ser mayor a la fecha actual.');
                return res.redirect('/compras/add');
            }
        }

        // Calcular el monto total de la compra
        let montototal = 0;
        for (let i = 0; i < cantidades.length; i++) {
            const cantidad = cantidades[i];
            const datospreciocompra = await pool.query('SELECT * FROM Precios_productos WHERE id_precio = ?', [precioscompra[i]]);
            const preciocompra = datospreciocompra[0].precio_compra;
            montototal += parseFloat(cantidad) * parseFloat(preciocompra);
        }

        // Registrar la compra en la tabla de Compras
        const result = await pool.query('INSERT INTO Compras SET ?', {
            fecha_compra: fechaActual,
            monto_total: montototal,
        });
        const compraid = result.insertId;

        // Registrar el detalle de la compra y actualizar inventarios
        for (let i = 0; i < cantidades.length; i++) {
            const datospreciocompra = await pool.query('SELECT * FROM Precios_productos WHERE id_precio = ?', [precioscompra[i]]);
            const cantidad = cantidades[i];
            const preciocompra = datospreciocompra[0].precio_compra;
            const precioparcial = parseFloat(preciocompra) * parseFloat(cantidad);
            const idunidad = datospreciocompra[0].id_unidad;

            const nuevodetalle = {
                id_producto: productos[i],
                cantidad_producto: cantidad,
                precio_parcial: precioparcial,
                id_compra: compraid,
                id_unidad: idunidad,
            };
            await pool.query('INSERT INTO Detalle_compra SET ?', nuevodetalle);

            const datosunidad = await pool.query('SELECT * FROM Unidades WHERE id_unidad = ?', [idunidad]);
            const cantidadreferencia = datosunidad[0].cantidad;
            let inventarionuevo = parseFloat(cantidadreferencia) * parseFloat(cantidad);

            const fechaVencimiento = fechasVencimiento[i] || null;

            // Verificar si existe un inventario con la misma fecha de vencimiento (incluyendo null)
            const inventarioExistente = await pool.query('SELECT * FROM Fechas_vencimiento WHERE id_producto = ? AND (fecha_vencimiento = ? OR (fecha_vencimiento IS NULL AND ? IS NULL))', [productos[i], fechaVencimiento, fechaVencimiento]);

            if (inventarioExistente.length > 0) {
                // Si existe, sumar la cantidad al inventario existente
                const inventarioActual = inventarioExistente[0].inventario;
                const nuevoInventario = parseFloat(inventarioActual) + parseFloat(inventarionuevo);
                await pool.query('UPDATE Fechas_vencimiento SET inventario = ? WHERE id_fechavencimiento = ?', [nuevoInventario, inventarioExistente[0].id_fechavencimiento]);
            } else {
                // Si no existe, crear un nuevo registro en Fechas_vencimiento
                const nuevoInventario = {
                    inventario: inventarionuevo,
                    fecha_vencimiento: fechaVencimiento,
                    id_producto: productos[i],
                };
                await pool.query('INSERT INTO Fechas_vencimiento SET ?', nuevoInventario);
            }
        }

        req.flash('success', 'Compra Registrada Correctamente');
        res.redirect('/compras');
    } catch (error) {
        console.error('Error al procesar el formulario:', error);
        req.flash('message', 'Error interno del servidor.');
        res.redirect('/compras/add');
    }
});

router.get('/productos/barcode/:barcode', isLoggedInAdmin, async (req, res) => {
    try {
        const { barcode } = req.params;

        // Consulta para obtener el producto y su unidad por código de barras
        const producto = await pool.query(`
            SELECT pp.id_precio, pp.precio_venta, pp.precio_compra, u.nombre AS nombre_unidad, p.id_producto, p.nombre_producto, fv.inventario_total
            FROM Precios_productos pp
            INNER JOIN Unidades u ON pp.id_unidad = u.id_unidad
            INNER JOIN Productos p ON pp.id_producto = p.id_producto
            LEFT JOIN (
                SELECT id_producto, SUM(inventario) AS inventario_total
                FROM Fechas_vencimiento
                GROUP BY id_producto
            ) fv ON p.id_producto = fv.id_producto
            WHERE pp.codigo_barras = ? LIMIT 1`, [barcode]);

        if (producto.length === 0) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        // Verificar si el producto tiene un precio de compra registrado
        if (!producto[0].precio_compra) {
            return res.status(400).json({ error: 'El producto no tiene un precio de compra registrado' });
        }

        res.json(producto[0]); // Devolver el producto encontrado
    } catch (error) {
        console.error('Error al obtener el producto por código de barras:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

router.get('/detalle/:id', isLoggedInAdmin, async (req, res) => {
    const { id } = req.params;
    const detalles = await pool.query(`SELECT Detalle_compra.*, Productos.nombre_producto, Unidades.nombre, Unidades.cantidad FROM Detalle_compra 
                                       INNER JOIN Productos ON Detalle_compra.id_producto = Productos.id_producto 
                                       INNER JOIN Unidades ON Detalle_compra.id_unidad = Unidades.id_unidad 
                                       WHERE Detalle_compra.id_compra = ?`, [id]);
    const compras = await pool.query('SELECT * FROM Compras WHERE id_compra = ?', [id]);
    var fechaBaseDatos = new Date();
    const opcionesFormato = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    compras.forEach((element) => {
        fechaBaseDatos = element.fecha_compra
        element.fecha_compra = fechaBaseDatos.toLocaleDateString('es-ES', opcionesFormato);
        element.monto_total = parseFloat(element.monto_total).toFixed(2);
    })
    detalles.forEach((element) => {
        element.precio_parcial = parseFloat(element.precio_parcial).toFixed(2);
    })
    res.render('compras/VerDetalleCompra', { detalles, compra: compras[0] });
});

module.exports = router;