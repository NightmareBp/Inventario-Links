const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const fs = require('fs');
const pool = require('../database');
const { isLoggedIn } = require('../lib/auth');

router.get('/', async (req, res) => {
    try {
        const { q, q1 } = req.query;
        const queryParams = [];
        let query = 'SELECT * FROM Ventas WHERE fecha_venta BETWEEN ? AND ? ORDER BY fecha_venta DESC';
        let montototall = null;
        if (q && q1) {
            queryParams.push(q, q1);
            montototal = await pool.query('SELECT SUM(monto_total) AS total_ventas FROM Ventas WHERE fecha_venta BETWEEN ? AND ?;', [q, q1]);
            if (montototal[0].total_ventas !== null) {
                montototall = montototal[0].total_ventas.toFixed(2);
            } else {
                montototall = '';
            }
        } else {
            // Si no se proporcionan ambas fechas, muestra todas las compras
            query = 'SELECT * FROM Ventas ORDER BY fecha_venta DESC';
        }

        const ventas = await pool.query(query, queryParams);

        // Formatear las fechas y montos antes de renderizar la vista
        ventas.forEach((element) => {
            const fechaVenta = new Date(element.fecha_venta);
            element.fecha_venta = fechaVenta.toLocaleDateString('es-ES', {
                weekday: 'long',
                year: 'numeric',
                month: 'numeric',
                day: 'numeric'
            });
            element.monto_total = parseFloat(element.monto_total).toFixed(2);
        });

        res.render('ventas/listV', { ventas, q, q1, montototall });
    } catch (error) {
        console.error('Error al obtener las compras:', error);
        res.status(500).send('Error interno del servidor');
    }
});

router.get('/add', isLoggedIn, async (req, res) => {
    try {
        // Consulta para obtener todos los productos
        const productos = await pool.query(`SELECT p.*, IFNULL(inventario_total, 0) AS inventario_total
        FROM Productos p
        LEFT JOIN (
            SELECT id_producto, SUM(inventario) AS inventario_total
            FROM Fechas_vencimiento
            GROUP BY id_producto
        ) fv ON p.id_producto = fv.id_producto
        WHERE IFNULL(inventario_total, 0) <> 0
        ORDER BY p.nombre_producto ASC;`);

        // Renderizar la vista de agregar compra, pasando los productos y precios de compra
        res.render('ventas/addVenta', { productos });
    } catch (error) {
        console.error('Error al obtener los productos y precios de compra:', error);
        res.status(500).send('Error interno del servidor');
    }
});

router.get('/productos/:idProducto/preciosVenta', isLoggedIn, async (req, res) => {
    try {
        const { idProducto } = req.params;

        // Consulta para obtener los precios de compra del producto seleccionado con los nombres de las unidades
        const preciosVenta = await pool.query(`
            SELECT pp.*, u.nombre AS nombre_unidad 
            FROM Precios_productos pp 
            INNER JOIN Unidades u ON pp.id_unidad = u.id_unidad 
            WHERE pp.id_producto = ? AND pp.precio_venta != 0`, [idProducto]);

        res.json(preciosVenta); // Devolver los precios de compra como respuesta en formato JSON
    } catch (error) {
        console.error('Error al obtener los precios de compra del producto:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

router.post('/add', isLoggedIn, async (req, res) => {
    try {
        const productos = Array.isArray(req.body.producto) ? req.body.producto : [req.body.producto];
        const preciosventa = Array.isArray(req.body.precioventa) ? req.body.precioventa : [req.body.precioventa];
        const cantidades = Array.isArray(req.body.cantidad) ? req.body.cantidad : [req.body.cantidad];
        console.log(productos, cantidades, preciosventa);
        for (let i = 0; i < cantidades.length; i++) {
            const producto = productos[i];
            const precioventa = preciosventa[i];
            for (let j = i + 1; j < cantidades.length; j++) {
                if (producto === productos[j] && precioventa === preciosventa[j]) {
                    req.flash('message', 'Existen Entradas Duplicadas');
                    return res.redirect('/ventas/add');
                }
            }
        }
        for (let i = 0; i < cantidades.length; i++) {
            const cantidad = parseFloat(cantidades[i]); // Convertir el valor de cantidad a decimal
            if (isNaN(cantidad) || cantidad <= 0) { // Verificar si el valor no es un número o es menor o igual a cero
                req.flash('message', 'Por favor, ingrese cantidades válidas como números decimales.');
                return res.redirect('/ventas/add');
            }
        }
        for (let i = 0; i < cantidades.length; i++) {
            const producto = productos[i];
            const datosproducto = await pool.query(`SELECT p.*, IFNULL(inventario_total, 0) AS inventario_total
                                            FROM Productos p
                                            LEFT JOIN (
                                            SELECT id_producto, SUM(inventario) AS inventario_total
                                            FROM Fechas_vencimiento
                                            GROUP BY id_producto
                                            ) fv ON p.id_producto = fv.id_producto where p.id_producto = ?`, [producto]);
            const inventariototal = datosproducto[0].inventario_total;
            const datosprecio = await pool.query(`SELECT pp.*, u.cantidad AS cantidad_referencial 
            FROM Precios_productos pp 
            INNER JOIN Unidades u ON pp.id_unidad = u.id_unidad 
            WHERE pp.id_precio = ?`, [preciosventa[i]]);
            const cantidadref = datosprecio[0].cantidad_referencial;
            const cantidad = cantidades[i];
            let inventarioadescontar = parseFloat(cantidad) * parseFloat(cantidadref);
            for (let j = i + 1; j < cantidades.length; j++) {
                if (producto === productos[j]) {
                    const datosprecion = await pool.query(`SELECT pp.*, u.cantidad AS cantidad_referencial 
                                                          FROM Precios_productos pp 
                                                          INNER JOIN Unidades u ON pp.id_unidad = u.id_unidad 
                                                          WHERE pp.id_precio = ?`, [preciosventa[j]]);
                    const cantidadrefn = datosprecion[0].cantidad_referencial;
                    const cantidadn = cantidades[j];
                    inventarioadescontar = inventarioadescontar + (parseFloat(cantidadn) * parseFloat(cantidadrefn))
                }
            }
            const verificardisponibilidad = parseFloat(inventariototal) - inventarioadescontar;
            if (verificardisponibilidad < 0) {
                req.flash('message', 'No Hay Disponibilidad de Algún Producto Seleccionado');
                return res.redirect('/ventas/add');
            }
        }
        let montototal = 0;
        for (let i = 0; i < cantidades.length; i++) {
            const cantidad = cantidades[i];
            const datosprecioventa = await pool.query('SELECT * FROM Precios_productos WHERE id_precio = ?', [preciosventa[i]]);
            const preciocompra = datosprecioventa[0].precio_venta;
            montototal += parseFloat(cantidad) * parseFloat(preciocompra);
        }
        const fechaActual = new Date();
        const result = await pool.query('INSERT INTO Ventas SET ?', {
            fecha_venta: fechaActual,
            monto_total: montototal,
        });
        const ventaid = result.insertId;
        for (let i = 0; i < cantidades.length; i++) {
            const datosprecioventa = await pool.query('SELECT * FROM Precios_productos WHERE id_precio = ?', [preciosventa[i]]);
            const cantidad = cantidades[i];
            const precioventa = datosprecioventa[0].precio_venta;
            const precioparcial = parseFloat(precioventa) * parseFloat(cantidad);
            const idunidad = datosprecioventa[0].id_unidad;
            const nuevodetalle = {
                id_producto: productos[i],
                cantidad_producto: cantidad,
                precio_parcial: precioparcial,
                id_venta: ventaid,
                id_unidad: idunidad,
            };
            await pool.query('INSERT INTO Detalle_venta SET ?', nuevodetalle);

            const datosunidad = await pool.query('SELECT * FROM Unidades WHERE id_unidad = ?', [idunidad]);
            const candidadreferencia = datosunidad[0].cantidad;
            let inventarionuevo = parseFloat(candidadreferencia) * parseFloat(cantidad);
            const datosinvetarioproducto = await pool.query('SELECT * FROM Fechas_vencimiento WHERE id_producto = ? ORDER by fecha_vencimiento ASC', [productos[i]])
            for (let i = 0; i < datosinvetarioproducto.length; i++) {
                const inventarioproducto = datosinvetarioproducto[i].inventario;
                const nuevoinventario = parseFloat(inventarioproducto) - parseFloat(inventarionuevo);
                if (nuevoinventario > 0) {
                    const nuevolink = {
                        inventario: nuevoinventario,
                    };
                    await pool.query('UPDATE Fechas_vencimiento SET ? WHERE id_fechavencimiento = ?', [nuevolink, datosinvetarioproducto[i].id_fechavencimiento]);
                    break;
                } else {
                    inventarionuevo = parseFloat(inventarionuevo) - parseFloat(inventarioproducto);
                    await pool.query('DELETE FROM Notificaciones WHERE id_fecha_vencimiento = ?', [datosinvetarioproducto[i].id_fechavencimiento]);
                    await pool.query('DELETE FROM Fechas_vencimiento WHERE id_fechavencimiento = ?', [datosinvetarioproducto[i].id_fechavencimiento]);
                }
            }
            const inventarios = await pool.query('SELECT * FROM Fechas_vencimiento WHERE id_producto = ?', [productos[i]]);
            let inventariototalp = 0;
            for (let i = 0; i < inventarios.length; i++) {
                inventariototalp = inventariototalp + inventarios[i].inventario;
            }
            const datoproductocantidadlimite = await pool.query('SELECT * FROM Productos WHERE id_producto = ?', [productos[i]]);
            const productocantidadlimite = datoproductocantidadlimite[0].cantidad_limite;
            let nuevoestadoproducto = 1;
            if (inventariototalp <= productocantidadlimite) {
                nuevoestadoproducto = 2;
            }
            if (inventariototalp === 0) {
                nuevoestadoproducto = 3;
            }
            await pool.query('Update Productos set estado_producto = ? WHERE id_producto = ?', [nuevoestadoproducto, productos[i]]);
        }

        req.flash('success', 'Venta Registrada Correctamente');
        res.redirect('/ventas');
    } catch (error) {
        console.error('Error al procesar el formulario:', error);
        req.flash('message', 'Error interno del servidor.');
        res.redirect('/ventas/add');
    }
});

// Código del servidor para generar el PDF de la cotización

router.post('/cotizacion', async (req, res) => {
    try {
        // Extraer los datos de la solicitud
        const productosIds = Array.isArray(req.body.productos) ? req.body.productos : [req.body.productos];
        const preciosIds = Array.isArray(req.body.precios) ? req.body.precios : [req.body.precios];
        const cantidades = Array.isArray(req.body.cantidades) ? req.body.cantidades : [req.body.cantidades];

        // Validar entradas duplicadas
        for (let i = 0; i < cantidades.length; i++) {
            const producto = productosIds[i];
            const precioventa = preciosIds[i];
            for (let j = i + 1; j < cantidades.length; j++) {
                if (producto === productosIds[j] && precioventa === preciosIds[j]) {
                    res.status(400).json({ error: 'Existen entradas duplicadas en los datos enviados.' });
                    return;
                }
            }
        }

        // Validar datos numéricos correctos
        for (let i = 0; i < cantidades.length; i++) {
            const cantidad = parseFloat(cantidades[i]);
            if (isNaN(cantidad) || cantidad <= 0) {
                res.status(400).json({ error: 'Por favor, ingrese cantidades válidas como números decimales.' });
                return;
            }
        }

        // Obtener la información de los productos y precios desde la base de datos
        let productosInfo = [];
        for (let i = 0; i < productosIds.length; i++) {
            const productoId = productosIds[i];
            const precioId = preciosIds[i];
            const rows = await pool.query('SELECT p.nombre_producto, u.nombre, pp.precio_venta FROM Productos p INNER JOIN Precios_productos pp ON p.id_producto = pp.id_producto INNER JOIN Unidades u ON pp.id_unidad = u.id_unidad WHERE p.id_producto = ? AND pp.id_precio = ?', [productoId, precioId]);
            if (rows.length > 0) {
                productosInfo.push(rows[0]);
            } else {
                res.status(400).json({ error: `No se encontró información para el producto con ID ${productoId}. y ${precioId}` });
                return;
            }
        }

        // Crear un nuevo documento PDF
        const doc = new PDFDocument();
        const filename = 'cotizacion.pdf';
        const filePath = `./${filename}`; // Ruta del archivo PDF
        doc.pipe(fs.createWriteStream(filePath)); // Guardar el PDF en el sistema de archivos

        // Agregar título, nombre de la bodega y fecha actual
        const fechaActual = new Date().toLocaleDateString('es-ES');
        doc.fontSize(12).text(fechaActual, { align: 'right' });
        doc.fontSize(30).text('Bodega Link\'S', { align: 'center' });
        doc.fontSize(16).text('Cotización', { align: 'center' });
        doc.moveDown();

        // Dibujar la tabla manualmente
        const startX = -10;
        let startY = doc.y + 30;
        const columnWidths = [200, 100, 100, 100, 100]; // Anchos de las columnas
        const rowHeight = 20;

        // Encabezados de la tabla
        doc.font('Helvetica-Bold').fontSize(11);
        doc.text('Producto', startX, startY, { width: columnWidths[0], align: 'center' });
        doc.text('Unidad', startX + columnWidths[0], startY, { width: columnWidths[1], align: 'center' });
        doc.text('Precio por Unidad', startX + columnWidths[0] + columnWidths[1], startY, { width: columnWidths[2], align: 'center' });
        doc.text('Cantidad P/U', startX + columnWidths[0] + columnWidths[1] + columnWidths[2], startY, { width: columnWidths[3], align: 'center' });
        doc.text('Precio Parcial', startX + columnWidths[0] + columnWidths[1] + columnWidths[2] + columnWidths[3], startY, { width: columnWidths[4], align: 'center' });

        // Contenido de la tabla
        doc.font('Helvetica').fontSize(10);
        let total = 0;
        for (let i = 0; i < productosInfo.length; i++) {
            const productoInfo = productosInfo[i];
            startY += rowHeight;
            doc.text(productoInfo.nombre_producto, startX, startY, { width: columnWidths[0], align: 'center' });
            doc.text(productoInfo.nombre, startX + columnWidths[0], startY, { width: columnWidths[1], align: 'center' });
            doc.text(productoInfo.precio_venta.toFixed(2), startX + columnWidths[0] + columnWidths[1], startY, { width: columnWidths[2], align: 'center' });
            doc.text(cantidades[i], startX + columnWidths[0] + columnWidths[1] + columnWidths[2], startY, { width: columnWidths[3], align: 'center' });
            const precioParcial = parseFloat(productoInfo.precio_venta) * parseFloat(cantidades[i]);
            doc.text(precioParcial.toFixed(2), startX + columnWidths[0] + columnWidths[1] + columnWidths[2] + columnWidths[3], startY, { width: columnWidths[4], align: 'center' });
            total += precioParcial;
        }

        // Total
        startY += rowHeight;
        doc.text('Total:', startX + columnWidths[0] + columnWidths[1] + columnWidths[2], startY, { width: columnWidths[3], align: 'right' });
        doc.text(total.toFixed(2), startX + columnWidths[0] + columnWidths[1] + columnWidths[2] + columnWidths[3], startY, { width: columnWidths[4], align: 'center' });

        // Finalizar el documento PDF
        doc.end();

        // Enviar la respuesta con el archivo PDF adjunto
        res.download(filePath, filename);
    } catch (error) {
        console.error('Error al procesar la cotización:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

router.get('/detalle/:id', isLoggedIn, async (req, res) => {
    const { id } = req.params;
    const detalles = await pool.query(`SELECT Detalle_venta.*, Productos.nombre_producto, Unidades.nombre, Unidades.cantidad FROM Detalle_venta 
                                       INNER JOIN Productos ON Detalle_venta.id_producto = Productos.id_producto 
                                       INNER JOIN Unidades ON Detalle_venta.id_unidad = Unidades.id_unidad 
                                       WHERE Detalle_venta.id_venta = ?`, [id]);
    const compras = await pool.query('SELECT * FROM Ventas WHERE id_venta = ?', [id]);
    var fechaBaseDatos = new Date();
    const opcionesFormato = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    compras.forEach((element) => {
        fechaBaseDatos = element.fecha_venta
        element.fecha_venta = fechaBaseDatos.toLocaleDateString('es-ES', opcionesFormato);
        element.monto_total = parseFloat(element.monto_total).toFixed(2);
    })
    detalles.forEach((element) => {
        element.precio_parcial = parseFloat(element.precio_parcial).toFixed(2);
    })
    res.render('ventas/VerDetalleVenta', { detalles, compra: compras[0] });
});

module.exports = router;