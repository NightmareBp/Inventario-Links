const express = require('express');
const router = express.Router();
const pool = require('../database');
const { isLoggedInAdmin } = require('../lib/auth');
const { isLoggedIn } = require('../lib/auth');
const multer = require('multer');
const fs = require('fs');
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'src/public/uploads/') // Aquí indicas la carpeta donde se guardarán las imágenes
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname)
    }
});
const upload = multer({ storage: storage });

async function verificarFechas() {
    try {
        const fechas = await pool.query('SELECT * FROM Fechas_vencimiento WHERE fecha_vencimiento IS NOT NULL;');
        const fechaActual = new Date();
        fechas.forEach(async (fecha) => {
            const diffTiempo = fecha.fecha_vencimiento.getTime() - fechaActual.getTime();
            const diffDias = Math.ceil(diffTiempo / (1000 * 3600 * 24));
            const datosProducto = await pool.query('SELECT * FROM Productos WHERE id_producto = ?;', [fecha.id_producto]);
            if (diffDias <= datosProducto[0].fecha_notificacion) {
                const mensaje = `El producto ${datosProducto[0].nombre_producto} está por vencerse en ${diffDias} días.`;
                const usuarios = await pool.query('SELECT * FROM usuarios');
                for (let i = 0; i < usuarios.length; i++) {
                    const nuevanoti = {
                        contenido: mensaje,
                        estado: 1,
                        id_usuario: usuarios[i].id_usuario,
                        id_producto: fecha.id_producto,
                        id_fecha_vencimiento: fecha.id_fechavencimiento,
                        fecha_vencimiento: fecha.fecha_vencimiento,
                        fecha_noti: fechaActual,
                        existencias: null,
                    };
                    const existeNotificacion = await pool.query('SELECT * FROM Notificaciones WHERE fecha_vencimiento = ? AND id_usuario = ? AND id_producto = ?', [fecha.fecha_vencimiento, usuarios[i].id_usuario, fecha.id_producto]);
                    if (existeNotificacion.length === 0) {
                        await pool.query('INSERT INTO Notificaciones SET ?', nuevanoti);
                        console.log(`Notificación generada para ${datosProducto[0].nombre_producto}: ${mensaje}`);
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error al verificar fechas de vencimiento:', error);
    }
}

async function verificarExistencias() {
    try {
        const productos = await pool.query('SELECT * FROM Productos');
        const fechaActual = new Date();
        productos.forEach(async (producto) => {
            const estadoproducto = producto.estado_producto;
            if (estadoproducto === 1) {
            } else if (estadoproducto === 2) {
                const mensaje = `El producto ${producto.nombre_producto} cuenta con bajas existencias`;
                const usuarios = await pool.query('SELECT * FROM usuarios');
                for (let i = 0; i < usuarios.length; i++) {
                    const nuevanoti = {
                        contenido: mensaje,
                        estado: 1,
                        id_usuario: usuarios[i].id_usuario,
                        id_producto: producto.id_producto,
                        id_fecha_vencimiento: null,
                        fecha_vencimiento: null,
                        fecha_noti: fechaActual,
                        existencias: 2,
                    };
                    const existeNotificacion = await pool.query('SELECT * FROM Notificaciones WHERE existencias = 2 AND id_usuario = ? AND id_producto = ?', [usuarios[i].id_usuario, producto.id_producto]);
                    if (existeNotificacion.length === 0) {
                        await pool.query('INSERT INTO Notificaciones SET ?', nuevanoti);
                        console.log(`Notificación generada para ${producto.nombre_producto}: ${mensaje}`);
                    }
                }
            } else if (estadoproducto === 3) {
                const mensaje = `El producto ${producto.nombre_producto} se ha agotado`;
                const usuarios = await pool.query('SELECT * FROM usuarios');
                for (let i = 0; i < usuarios.length; i++) {
                    const nuevanoti = {
                        contenido: mensaje,
                        estado: 1,
                        id_usuario: usuarios[i].id_usuario,
                        id_producto: producto.id_producto,
                        id_fecha_vencimiento: null,
                        fecha_vencimiento: null,
                        fecha_noti: fechaActual,
                        existencias: 3,
                    };
                    const existeNotificacion = await pool.query('SELECT * FROM Notificaciones WHERE existencias = 3 AND id_usuario = ? AND id_producto = ?', [usuarios[i].id_usuario, producto.id_producto]);
                    if (existeNotificacion.length === 0) {
                        await pool.query('INSERT INTO Notificaciones SET ?', nuevanoti);
                        console.log(`Notificación generada para ${producto.nombre_producto}: ${mensaje}`);
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error al verificar fechas de vencimiento:', error);
    }
}

router.get('/', isLoggedIn, async (req, res) => {
    verificarFechas();
    verificarExistencias();
    try {
        let query = 'SELECT p.*, pp.precio_compra, pp.precio_venta, pp.id_unidad, u.nombre AS nombre_unidad FROM Productos p LEFT JOIN Precios_productos pp ON p.id_producto = pp.id_producto LEFT JOIN Unidades u ON pp.id_unidad = u.id_unidad';

        const { q } = req.query;
        const queryParams = [];

        if (q) {
            query += ' WHERE nombre_producto LIKE ?';
            queryParams.push(`%${q}%`);
        }
        query += ' ORDER BY nombre_producto ASC';
        const productos = await pool.query(query, queryParams);
        // Obtener inventario total y fechas de vencimiento por producto
        const inventarios = await pool.query('SELECT id_producto, SUM(inventario) AS inventario_total FROM Fechas_vencimiento GROUP BY id_producto');
        const fechasVencimiento = await pool.query('SELECT id_producto, fecha_vencimiento, inventario FROM Fechas_vencimiento ORDER BY fecha_vencimiento ASC;');

        // Convertir resultados a objeto para facilitar el acceso
        const inventarioTotalPorProducto = inventarios.reduce((acc, { id_producto, inventario_total }) => {
            acc[id_producto] = inventario_total;
            return acc;
        }, {});

        const fechasVencimientoPorProducto = fechasVencimiento.reduce((acc, { id_producto, fecha_vencimiento, inventario }) => {
            if (!acc[id_producto]) {
                acc[id_producto] = [];
            }
            if (fecha_vencimiento !== null) {
                acc[id_producto].push({
                    fecha_vencimiento: new Date(fecha_vencimiento).toLocaleDateString('es-ES', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                    }),
                    inventario
                });
            }
            return acc;
        }, {});

        // Agrupar los precios y el inventario por producto
        const productosConPrecios = productos.reduce((acc, producto) => {
            const idProducto = producto.id_producto;
            if (!acc[idProducto]) {
                acc[idProducto] = { ...producto, preciosventa: [], precioscompra: [], inventarioTotal: 0, fechasVencimiento: [] };
            }
            if (producto.precio_venta && producto.id_unidad) {
                acc[idProducto].preciosventa.push({ precio_venta: producto.precio_venta, unidad: producto.nombre_unidad });
            }
            if (producto.precio_compra && producto.id_unidad) {
                acc[idProducto].precioscompra.push({ precio_compra: producto.precio_compra, unidad: producto.nombre_unidad });
            }
            acc[idProducto].inventarioTotal = inventarioTotalPorProducto[idProducto] || 0;
            acc[idProducto].fechasVencimiento = fechasVencimientoPorProducto[idProducto] || [];
            return acc;
        }, {});

        res.render('productos/listA', {
            productos: Object.values(productosConPrecios).sort((a, b) => {
                // Comparar los nombres de los productos para ordenar alfabéticamente
                const nombreA = a.nombre_producto.toUpperCase();
                const nombreB = b.nombre_producto.toUpperCase();
                if (nombreA < nombreB) {
                    return -1;
                }
                if (nombreA > nombreB) {
                    return 1;
                }
                return 0; // Los nombres son iguales
            })
        });
    } catch (error) {
        console.error('Error al obtener los productos:', error);
        res.status(500).send('Error interno del servidor');
    }
});

router.get('/add', isLoggedInAdmin, async (req, res) => {
    const unidades = await pool.query('SELECT * FROM Unidades');
    res.render('productos/add', { unidades });
});

router.post('/add', isLoggedInAdmin, upload.single('imagen'), async (req, res) => {
    try {
        let { nombre, cantidadlimite, anos, meses, dias } = req.body;
        let productoExistente = await pool.query('SELECT * FROM Productos WHERE nombre_producto = ?', [nombre]);
        let preciosVenta = req.body.precioVenta.map(precio => parseFloat(precio.trim() || 0));
        let preciosCompra = req.body.precioCompra.map(precio => parseFloat(precio.trim() || 0));
        let unidades = req.body.unidad;
        let cantidadesinicial = req.body.cantidadinicial.map(cantidad => parseInt(cantidad.trim() || 0));
        let fechasvencimiento = req.body.fechavencimiento.map(fecha => fecha.trim() || null);
        anos = anos.trim() !== '' ? parseInt(anos) : 0;
        meses = meses.trim() !== '' ? parseInt(meses) : 0;
        dias = dias.trim() !== '' ? parseInt(dias) : 0;
        if (productoExistente.length > 0) {
            req.flash('message', 'Ya existe un producto con el mismo nombre.');
            return res.redirect('/inventario/add');
        }
        for (let i = 0; i < cantidadesinicial.length; i++) {
            const fechavencimiento = fechasvencimiento[i];
            for (let j = i + 1; j < cantidadesinicial.length; j++) {
                if (fechavencimiento === fechasvencimiento[j]) {
                    req.flash('message', 'Existen fechas de vencimiento duplicadas');
                    return res.redirect('/inventario/add');
                }
            }
        }
        for (let i = 0; i < cantidadesinicial.length; i++) {
            const cantidad = parseFloat(cantidadesinicial[i]); // Convertir el valor de cantidad a decimal
            if (isNaN(cantidad) || cantidad < 0) { // Verificar si el valor no es un número o es menor o igual a cero
                req.flash('message', 'Por favor, ingrese cantidades válidas como números decimales.');
                return res.redirect('/inventario/add');
            }
        }
        for (let i = 0; i < preciosCompra.length; i++) {
            const preciocompra = parseFloat(preciosCompra[i]); // Convertir el valor de cantidad a decimal
            if (isNaN(preciocompra) || preciocompra < 0) { // Verificar si el valor no es un número o es menor o igual a cero
                req.flash('message', 'Por favor, ingrese precios válidos como números decimales.');
                return res.redirect('/inventario/add');
            }
            const precioventa = parseFloat(preciosVenta[i]);
            if (isNaN(precioventa) || precioventa < 0) { // Verificar si el valor no es un número o es menor o igual a cero
                req.flash('message', 'Por favor, ingrese precios válidos como números decimales.');
                return res.redirect('/inventario/add');
            }
        }
        for (let i = 0; i < unidades.length; i++) {
            const unidad = unidades[i];
            for (let j = i + 1; j < unidades.length; j++) {
                if (unidad === unidades[j]) {
                    req.flash('message', 'Existen unidades duplicadas');
                    return res.redirect('/inventario/add');
                }
            }
        }
        const fechanoti = (anos || meses || dias) ? (365 * anos + 30 * meses + dias) : null; // Si no hay años, meses o días, fechanoti será null
        const inventarioTotal = calcularInventarioTotal(cantidadesinicial);
        const estado = calcularEstadoProducto(inventarioTotal, cantidadlimite);

        // Insertar el producto en la base de datos
        const result = await pool.query('INSERT INTO Productos SET ?', {
            nombre_producto: nombre,
            cantidad_limite: cantidadlimite,
            fecha_notificacion: fechanoti,
            estado_producto: estado
        });

        const productoid = result.insertId;

        for (let i = 0; i < unidades.length; i++) {
            const nuevoprecio = {
                precio_compra: preciosCompra[i],
                precio_venta: preciosVenta[i],
                id_producto: productoid,
                id_unidad: unidades[i],
            };
            await pool.query('INSERT INTO Precios_productos SET ?', nuevoprecio);
        }

        for (let i = 0; i < cantidadesinicial.length; i++) {
            const nuevafecha = {
                fecha_vencimiento: fechasvencimiento[i],
                inventario: cantidadesinicial[i],
                id_producto: productoid,
            };
            await pool.query('INSERT INTO Fechas_vencimiento SET ?', nuevafecha);
        }

        // Redirigir al usuario después de agregar el producto
        req.flash('success', 'Producto agregado correctamente');
        res.redirect('/inventario');
    } catch (error) {
        console.error('Error al agregar el producto:', error);
        req.flash('message', 'Error interno del servidor.');
        res.redirect('/inventario/add');
    }
});

function calcularInventarioTotal(cantidadesinicial) {
    let inventarioTotal = 0;
    for (let i = 0; i < cantidadesinicial.length; i++) {
        inventarioTotal = inventarioTotal + cantidadesinicial[i]
    }
    return inventarioTotal;
}

function calcularEstadoProducto(inventarioTotal, cantidadlimite) {
    let estado = 1;
    if (inventarioTotal === 0) {
        estado = 3;
    } else if (inventarioTotal <= cantidadlimite) {
        estado = 2;
    }
    return estado;
}

router.get('/edit/:id', isLoggedInAdmin, async (req, res) => {
    const { id } = req.params;
    const productos = await pool.query('SELECT * FROM Productos WHERE id_producto = ?', [id]);
    const precios = await pool.query('SELECT precios.*, Unidades.nombre AS nombre_unidad '
        + 'FROM Precios_productos AS precios '
        + 'JOIN Unidades ON precios.id_unidad = Unidades.id_unidad '
        + 'WHERE precios.id_producto = ?', [id]);
    const unidades = await pool.query('SELECT * FROM Unidades');
    let fechasvencimiento = await pool.query('SELECT * FROM Fechas_vencimiento WHERE id_producto = ?', [id]);

    // Formatear la fecha de vencimiento
    for (let i = 0; i < fechasvencimiento.length; i++) {
        let fechaVencimiento = new Date(fechasvencimiento[i].fecha_vencimiento);
        let fechaFormateada = fechaVencimiento.toLocaleDateString('es-ES', { year: 'numeric', month: '2-digit', day: '2-digit' });
        fechasvencimiento[i].fecha_vencimientoFormateada = fechaFormateada;
    }
    var fechaBaseDatos = new Date();
    fechasvencimiento.forEach((element) => {
        fechaBaseDatos = element.fecha_vencimiento;
        if (fechaBaseDatos) {
            element.fecha_vencimiento = fechaBaseDatos.toISOString().split('T')[0];
        } else {
            element.fecha_vencimiento = ''; // o cualquier otro valor predeterminado si es null
        }
    })
    // Calcular años, meses y días
    const cantidadDias = productos[0].fecha_notificacion;
    const anos = Math.floor(cantidadDias / 365);
    const meses = Math.floor((cantidadDias - 365 * anos) / 30);
    const dias = cantidadDias - 365 * anos - meses * 30;

    res.render('productos/edit', { producto: productos[0], precios, unidades, fechasvencimiento, anos, meses, dias });
});

router.post('/edit/:id', isLoggedInAdmin, upload.single('imagen'), async (req, res) => {
    try {
        const { id } = req.params;
        let { nombre, cantidadlimite, anos, meses, dias } = req.body;
        let productoExistente = await pool.query('SELECT * FROM Productos WHERE nombre_producto = ? AND id_producto <> ?', [nombre, id]);
        anos = anos ? anos : 0;
        meses = meses ? meses : 0;
        dias = dias ? dias : 0;
        if (productoExistente.length > 0) {
            req.flash('message', 'Ya existe un producto con el mismo nombre.');
            return res.redirect('/inventario/edit/' + id);
        }
        let fechanoti = parseInt(365 * anos) + parseInt(30 * meses) + parseInt(dias);
        if (fechanoti === 0) {
            fechanoti = null;
        }
        const nuevolink = {
            nombre_producto: nombre,
            cantidad_limite: cantidadlimite,
            fecha_notificacion: fechanoti,
        };
        await pool.query('UPDATE Productos SET ? WHERE id_producto = ?', [nuevolink, id]);
        const inventarios = await pool.query('SELECT * FROM Fechas_vencimiento WHERE id_producto = ?', [id]);
        let inventariototalp = 0;
        for (let i = 0; i < inventarios.length; i++) {
            inventariototalp = inventariototalp + inventarios[i].inventario;
        }
        const datoproductocantidadlimite = await pool.query('SELECT * FROM Productos WHERE id_producto = ?', [id]);
        const productocantidadlimite = datoproductocantidadlimite[0].cantidad_limite;
        let nuevoestadoproducto = 1;
        if (inventariototalp <= productocantidadlimite) {
            nuevoestadoproducto = 2;
        }
        if (inventariototalp === 0) {
            nuevoestadoproducto = 3;
        }
        await pool.query('Update Productos set estado_producto = ? WHERE id_producto = ?', [nuevoestadoproducto, id]);
        req.flash('success', 'Producto Editado Correctamente');
        res.redirect('/inventario');
    } catch (error) {
        const { id } = req.params;
        console.error('Error al editar el producto:', error);
        req.flash('message', 'Error interno del servidor.');
        res.redirect('/inventario/edit/' + id);
    }
});

router.post('/editarprecios/:id', isLoggedInAdmin, async (req, res) => {
    const { id } = req.params;
    const { unidad, precio_compra, precio_venta } = req.body;
    const precioCompraDecimal = precio_compra ? parseFloat(precio_compra) : 0;
    const precioVentaDecimal = precio_venta ? parseFloat(precio_venta) : 0;
    const resultado = await pool.query('SELECT * FROM Precios_productos WHERE id_precio = ?', [id]);
    if (isNaN(precioCompraDecimal) || precioCompraDecimal < 0 ||
        isNaN(precioVentaDecimal) || precioVentaDecimal < 0) {
        req.flash('message', 'Por favor, ingrese precios de compra y venta válidos como números decimales.');
        return res.redirect('/inventario/edit/' + resultado[0].id_producto);
    }
    let unidadexistente = await pool.query('SELECT * FROM Precios_productos WHERE id_producto = ? and id_unidad = ? AND id_precio <> ?', [resultado[0].id_producto, unidad, id]);
    if (unidadexistente.length > 0) {
        req.flash('message', 'Ya existe esta unidad registrada en el producto');
        return res.redirect('/inventario/edit/' + resultado[0].id_producto);
    }
    const nuevolink = {
        precio_compra: precioCompraDecimal,
        precio_venta: precioVentaDecimal,
        id_unidad: unidad
    };
    await pool.query('UPDATE Precios_productos SET ? WHERE id_precio = ?', [nuevolink, id]);
    req.flash('success', 'Precios Actualizados Correctamente');
    res.redirect('/inventario/edit/' + resultado[0].id_producto);
});

router.post('/editarinventarios/:id', isLoggedInAdmin, async (req, res) => {
    const { id } = req.params;
    const { inventario, fechavencimiento } = req.body;

    // Validar que el inventario sea un número decimal válido
    const inventarioDecimal = inventario ? parseFloat(inventario) : 0;
    const resultado = await pool.query('SELECT * FROM Fechas_vencimiento WHERE id_fechavencimiento = ?', [id]);
    if (isNaN(inventarioDecimal) || inventarioDecimal < 0) {
        req.flash('message', 'Por favor, ingrese un inventario válido como número decimal mayor o igual que cero.');
        return res.redirect('/inventario/edit/' + resultado[0].id_producto);
    }

    // Verificar si la fecha de vencimiento está vacía
    const fechaVencimiento = fechavencimiento ? fechavencimiento : null;

    let fechaexistente;
    if (fechaVencimiento !== null) {
        fechaexistente = await pool.query('SELECT * FROM Fechas_vencimiento WHERE id_producto = ? AND fecha_vencimiento = ? AND id_fechavencimiento <> ?', [resultado[0].id_producto, fechaVencimiento, id]);
    } else {
        fechaexistente = await pool.query('SELECT * FROM Fechas_vencimiento WHERE id_producto = ? AND fecha_vencimiento IS NULL AND id_fechavencimiento <> ?', [resultado[0].id_producto, id]);
    }

    if (fechaexistente.length > 0) {
        req.flash('message', 'Ya existe esta fecha de vencimiento registrada en el producto');
        return res.redirect('/inventario/edit/' + resultado[0].id_producto);
    }

    const nuevolink = {
        fecha_vencimiento: fechaVencimiento,
        inventario: inventarioDecimal,
    };

    await pool.query('UPDATE Fechas_vencimiento SET ? WHERE id_fechavencimiento = ?', [nuevolink, id]);

    const inventarios = await pool.query('SELECT * FROM Fechas_vencimiento WHERE id_producto = ?', [resultado[0].id_producto]);
    let inventariototalp = 0;
    for (let i = 0; i < inventarios.length; i++) {
        inventariototalp = inventariototalp + inventarios[i].inventario;
    }

    const datoproductocantidadlimite = await pool.query('SELECT * FROM Productos WHERE id_producto = ?', [resultado[0].id_producto]);
    const productocantidadlimite = datoproductocantidadlimite[0].cantidad_limite;
    let nuevoestadoproducto = 1;
    if (inventariototalp <= productocantidadlimite) {
        nuevoestadoproducto = 2;
    }
    if (inventariototalp === 0) {
        nuevoestadoproducto = 3;
    }

    await pool.query('Update Productos set estado_producto = ? WHERE id_producto = ?', [nuevoestadoproducto, resultado[0].id_producto]);

    req.flash('success', 'Inventario Actualizado Correctamente');
    res.redirect('/inventario/edit/' + resultado[0].id_producto);
});

router.get('/eliminarprecio/:id', isLoggedInAdmin, async (req, res) => {
    const { id } = req.params;
    const resultado = await pool.query('Select * from Precios_productos WHERE id_precio = ?', [id]);
    await pool.query('DELETE FROM Precios_productos WHERE id_precio = ?', [id]);
    req.flash('noti', 'Precio Eliminado Correctamente');
    res.redirect('/inventario/edit/' + resultado[0].id_producto);
});

router.get('/eliminarinventario/:id', isLoggedInAdmin, async (req, res) => {
    const { id } = req.params;
    const resultado = await pool.query('Select * from Fechas_vencimiento WHERE id_fechavencimiento = ?', [id]);
    await pool.query('DELETE FROM Notificaciones WHERE id_fecha_vencimiento = ?', [id]);
    await pool.query('DELETE FROM Fechas_vencimiento WHERE id_fechavencimiento = ?', [id]);
    const inventarios = await pool.query('SELECT * FROM Fechas_vencimiento WHERE id_producto = ?', [resultado[0].id_producto]);
    let inventariototalp = 0;
    for (let i = 0; i < inventarios.length; i++) {
        inventariototalp = inventariototalp + inventarios[i].inventario;
    }
    const datoproductocantidadlimite = await pool.query('SELECT * FROM Productos WHERE id_producto = ?', [resultado[0].id_producto]);
    const productocantidadlimite = datoproductocantidadlimite[0].cantidad_limite;
    let nuevoestadoproducto = 1;
    if (inventariototalp <= productocantidadlimite) {
        nuevoestadoproducto = 2;
    }
    if (inventariototalp === 0) {
        nuevoestadoproducto = 3;
    }
    await pool.query('Update Productos set estado_producto = ? WHERE id_producto = ?', [nuevoestadoproducto, resultado[0].id_producto]);
    req.flash('noti', 'Inventario Eliminado Correctamente');
    res.redirect('/inventario/edit/' + resultado[0].id_producto);
});

router.post('/anadirprecios/:id', isLoggedInAdmin, async (req, res) => {
    const { id } = req.params;
    const { unidad, precio_compra, precio_venta } = req.body;

    // Validar que los precios de compra y venta sean números decimales válidos
    const precioCompraDecimal = precio_compra ? parseFloat(precio_compra) : 0;
    const precioVentaDecimal = precio_venta ? parseFloat(precio_venta) : 0;

    if (isNaN(precioCompraDecimal) || isNaN(precioVentaDecimal) || precioCompraDecimal < 0 || precioVentaDecimal < 0) {
        req.flash('message', 'Por favor, ingrese precios de compra y venta válidos como números decimales mayores o iguales que cero.');
        return res.redirect('/inventario/edit/' + id);
    }

    let unidadexistente = await pool.query('SELECT * FROM Precios_productos WHERE id_producto = ? and id_unidad = ?', [id, unidad]);
    if (unidadexistente.length > 0) {
        req.flash('message', 'Ya existe esta unidad registrada en el producto');
        return res.redirect('/inventario/edit/' + id);
    }

    const nuevolink = {
        precio_compra: precioCompraDecimal,
        precio_venta: precioVentaDecimal,
        id_producto: id,
        id_unidad: unidad
    };

    await pool.query('INSERT INTO Precios_productos SET ?', nuevolink);
    req.flash('success', 'Precio Agregado Correctamente');
    res.redirect('/inventario/edit/' + id);
});

router.post('/anadirinventarios/:id', isLoggedInAdmin, async (req, res) => {
    const { id } = req.params;
    const { inventario, fechavencimiento } = req.body;

    // Validar que el inventario sea un número decimal válido
    const inventarioDecimal = parseFloat(inventario);

    if (isNaN(inventarioDecimal) || inventarioDecimal < 0) {
        req.flash('message', 'Por favor, ingrese un inventario válido como número decimal mayor o igual que cero.');
        return res.redirect('/inventario/edit/' + id);
    }

    const fechaVencimiento = fechavencimiento ? fechavencimiento : null;

    let fechaexistente;
    if (fechaVencimiento !== null) {
        fechaexistente = await pool.query('SELECT * FROM Fechas_vencimiento WHERE id_producto = ? AND fecha_vencimiento = ?', [id, fechaVencimiento]);
    } else {
        fechaexistente = await pool.query('SELECT * FROM Fechas_vencimiento WHERE id_producto = ? AND fecha_vencimiento IS NULL', [id]);
    }

    if (fechaexistente.length > 0) {
        req.flash('message', 'Ya existe esta fecha de vencimiento registrada en el producto');
        return res.redirect('/inventario/edit/' + id);
    }

    const nuevolink = {
        fecha_vencimiento: fechaVencimiento,
        inventario: inventarioDecimal,
        id_producto: id
    };

    await pool.query('INSERT INTO Fechas_vencimiento SET ?', nuevolink);

    const inventarios = await pool.query('SELECT * FROM Fechas_vencimiento WHERE id_producto = ?', [id]);
    let inventariototalp = 0;
    for (let i = 0; i < inventarios.length; i++) {
        inventariototalp = inventariototalp + inventarios[i].inventario;
    }

    const datoproductocantidadlimite = await pool.query('SELECT * FROM Productos WHERE id_producto = ?', [id]);
    const productocantidadlimite = datoproductocantidadlimite[0].cantidad_limite;
    let nuevoestadoproducto = 1;
    if (inventariototalp <= productocantidadlimite) {
        nuevoestadoproducto = 2;
    }
    if (inventariototalp === 0) {
        nuevoestadoproducto = 3;
    }

    await pool.query('Update Productos set estado_producto = ? WHERE id_producto = ?', [nuevoestadoproducto, id]);

    req.flash('success', 'Inventario Agregado Correctamente');
    res.redirect('/inventario/edit/' + id);
});

router.get('/unidades', isLoggedInAdmin, async (req, res) => {
    const unidades = await pool.query('SELECT * from Unidades');
    res.render('productos/unidades', { unidades });
});

router.post('/unidades', isLoggedInAdmin, async (req, res) => {
    const { nombre, cantidad } = req.body;
    const cantidadValida = /^(\d+(\.\d{1,3})?)?$/.test(cantidad);
    if (!cantidadValida) {
        req.flash('message', 'La cantidad debe ser un número decimal válido (hasta 3 decimales).');
        return res.redirect('/inventario/unidades');
    }

    const unidadExistente = await pool.query('SELECT * FROM Unidades WHERE nombre = ?', [nombre]);
    if (unidadExistente.length > 0) {
        req.flash('message', 'Ya existe una unidad con el mismo nombre.');
        return res.redirect('/inventario/unidades');
    }
    const nuevaFila = {
        nombre: nombre,
        cantidad: cantidad,
    };
    await pool.query('INSERT INTO Unidades SET ?', [nuevaFila]);
    req.flash('success', 'Unidad agregada correctamente');
    res.redirect('/inventario/unidades');
});

router.get('/unidades/edit/:id', isLoggedInAdmin, async (req, res) => {
    const { id } = req.params;
    const unidades = await pool.query('SELECT * FROM Unidades WHERE id_unidad = ?', [id]);
    res.render('productos/unidadesedit', { unidad: unidades[0] });
});

router.post('/unidades/edit/:id', isLoggedInAdmin, async (req, res) => {
    const { id } = req.params;
    const { nombre, cantidad } = req.body;

    // Verificar si la cantidad es un decimal válido
    const cantidadValida = /^(\d+(\.\d{1,3})?)?$/.test(cantidad);
    if (!cantidadValida) {
        req.flash('message', 'La cantidad debe ser un número decimal válido (hasta 3 decimales).');
        return res.redirect('/inventario/unidades/edit/' + id);
    }

    const unidadExistente = await pool.query('SELECT * FROM Unidades WHERE nombre = ? AND id_unidad <> ?', [nombre, id]);
    if (unidadExistente.length > 0) {
        req.flash('message', 'Ya existe una unidad con el mismo nombre.');
        return res.redirect('/inventario/unidades/edit/' + id);
    }
    const nuevaFila = {
        nombre: nombre,
        cantidad: cantidad,
    };
    await pool.query('UPDATE Unidades SET ? WHERE id_unidad = ?', [nuevaFila, id]);
    req.flash('success', 'Unidad de medida modificada correctamente');
    res.redirect('/inventario/unidades');
});

module.exports = router;