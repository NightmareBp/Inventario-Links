const express = require('express');
const router = express.Router();
const pool = require('../database');
const { isLoggedInAdmin } = require('../lib/auth');

router.get('/', isLoggedInAdmin, async (req, res) => {
    const compras = await pool.query('SELECT * FROM Compras ORDER BY fecha_compra DESC');
    var fechaBaseDatos = new Date();
    const opcionesFormato = { weekday: 'long', year: 'numeric', month: 'numeric', day: 'numeric' };
    compras.forEach((element) => {
        fechaBaseDatos = element.fecha_compra
        element.fecha_compra = fechaBaseDatos.toLocaleDateString('es-ES', opcionesFormato);
        element.monto_total = parseFloat(element.monto_total).toFixed(2);
    })
    res.render('compras/listC', { compras });
});

router.get('/add', isLoggedInAdmin, async (req, res) => {
    try {
        // Consulta para obtener todos los productos
        const productos = await pool.query('SELECT * FROM Productos ORDER BY nombre_producto ASC');

        // Renderizar la vista de agregar compra, pasando los productos y precios de compra
        res.render('compras/addCompra', { productos });
    } catch (error) {
        console.error('Error al obtener los productos y precios de compra:', error);
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
        const fecha = req.body.fechacompra;
        const productos = Array.isArray(req.body.producto) ? req.body.producto : [req.body.producto];
        const precioscompra = Array.isArray(req.body.preciocompra) ? req.body.preciocompra : [req.body.preciocompra];
        const cantidades = Array.isArray(req.body.cantidad) ? req.body.cantidad : [req.body.cantidad];
        let fechasvencimiento = [];
        if (Array.isArray(req.body.fecha)) {
            fechasvencimiento = req.body.fecha.map(fecha => fecha.trim() || null);
        } else {
            fechasvencimiento = [req.body.fecha.trim() || null];
        }

        for (let i = 0; i < cantidades.length; i++) {
            const producto = productos[i];
            const preciocompra = precioscompra[i];
            for (let j = i + 1; j < cantidades.length; j++) {
                if (producto === productos[j] && preciocompra === precioscompra[j]) {
                    req.flash('message', 'Existen Entradas Duplicadas');
                    return res.redirect('/compras/add');
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
        let montototal = 0;
        for (let i = 0; i < cantidades.length; i++) {
            const cantidad = cantidades[i];
            const datospreciocompra = await pool.query('SELECT * FROM Precios_productos WHERE id_precio = ?', [precioscompra[i]]);
            const preciocompra = datospreciocompra[0].precio_compra;
            montototal += parseFloat(cantidad) * parseFloat(preciocompra);
        }

        const result = await pool.query('INSERT INTO Compras SET ?', {
            fecha_compra: fecha,
            monto_total: montototal,
        });

        const compraid = result.insertId;
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
            const candidadreferencia = datosunidad[0].cantidad;
            const inventarionuevo = parseFloat(candidadreferencia) * parseFloat(cantidad);
            const fechavencimiento = fechasvencimiento[i];
            let fechaexistente;
            if (fechavencimiento === null) {
                fechaexistente = await pool.query('SELECT * FROM Fechas_vencimiento WHERE fecha_vencimiento IS NULL AND id_producto = ?', [productos[i]]);
            } else {
                fechaexistente = await pool.query('SELECT * FROM Fechas_vencimiento WHERE fecha_vencimiento = ? and id_producto = ?', [fechavencimiento, productos[i]]);
            }
            if (fechaexistente.length > 0) {
                const idfecha = fechaexistente[0].id_fechavencimiento;
                const inventarioviejo = fechaexistente[0].inventario;
                const inventariofinal = parseFloat(inventarionuevo) + parseFloat(inventarioviejo);
                const nuevolink = {
                    inventario: inventariofinal,
                };
                await pool.query('UPDATE Fechas_vencimiento SET ? WHERE id_fechavencimiento = ?', [nuevolink, idfecha]);
            } else {
                const nuevafecha = {
                    fecha_vencimiento: fechavencimiento,
                    inventario: inventarionuevo,
                    id_producto: productos[i],
                };
                await pool.query('INSERT INTO Fechas_vencimiento SET ?', nuevafecha);
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

        req.flash('success', 'Compra Registrada Correctamente');
        res.redirect('/compras');
    } catch (error) {
        console.error('Error al procesar el formulario:', error);
        req.flash('message', 'Error interno del servidor.');
        res.redirect('/compras/add');
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