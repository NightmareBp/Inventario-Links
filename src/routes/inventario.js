const express = require('express');
const router = express.Router();

const pool = require('../database');

const {
    isLoggedIn,
    isLoggedInAdmin
} = require('../lib/auth');

const multer = require('multer');


/* =========================================================
   CONFIGURACIÓN DE ARCHIVOS
========================================================= */

const storage = multer.diskStorage({

    destination: function (req, file, cb) {

        cb(
            null,
            'src/public/uploads/'
        );

    },

    filename: function (req, file, cb) {

        cb(
            null,
            file.originalname
        );

    }

});


const upload = multer({
    storage
});


/* =========================================================
   UTILIDADES
========================================================= */

function normalizarArray(valor) {

    if (Array.isArray(valor)) {
        return valor;
    }

    if (
        valor === undefined ||
        valor === null
    ) {
        return [];
    }

    return [valor];

}


function calcularEstadoProducto(
    inventarioTotal,
    cantidadLimite
) {

    const inventario =
        Number(inventarioTotal) || 0;


    const limite =
        Number(cantidadLimite) || 0;


    if (inventario <= 0) {

        return 3;

    }


    if (inventario <= limite) {

        return 2;

    }


    return 1;

}


async function actualizarEstadoProducto(
    idProducto
) {

    const resultado =
        await pool.query(`
            SELECT
                p.id_producto,
                p.cantidad_limite,

                COALESCE(
                    SUM(fv.inventario),
                    0
                ) AS inventario_total

            FROM Productos p

            LEFT JOIN Fechas_vencimiento fv
                ON fv.id_producto =
                   p.id_producto

            WHERE
                p.id_producto = ?

            GROUP BY
                p.id_producto,
                p.cantidad_limite
        `, [
            idProducto
        ]);


    if (
        resultado.length === 0
    ) {

        return;

    }


    const estado =
        calcularEstadoProducto(
            resultado[0].inventario_total,
            resultado[0].cantidad_limite
        );


    await pool.query(`
        UPDATE Productos

        SET
            estado_producto = ?

        WHERE
            id_producto = ?
    `, [
        estado,
        idProducto
    ]);


    /*
     * Si el producto cambia de estado,
     * eliminamos notificaciones de existencias
     * que ya dejaron de tener sentido.
     */

    if (estado === 1) {

        await pool.query(`
            DELETE FROM Notificaciones

            WHERE
                id_producto = ?

                AND
                existencias IN (2, 3)
        `, [
            idProducto
        ]);

    }

    else if (estado === 2) {

        await pool.query(`
            DELETE FROM Notificaciones

            WHERE
                id_producto = ?

                AND
                existencias = 3
        `, [
            idProducto
        ]);

    }

    else {

        await pool.query(`
            DELETE FROM Notificaciones

            WHERE
                id_producto = ?

                AND
                existencias = 2
        `, [
            idProducto
        ]);

    }

}


/* =========================================================
   NOTIFICACIONES
========================================================= */

/*
 * Evitamos volver a recorrer todos los productos
 * cada vez que el buscador AJAX consulta el inventario.
 */

let ultimaVerificacionNotificaciones = 0;


const INTERVALO_VERIFICACION =
    5 * 60 * 1000;



async function verificarFechas() {

    try {

        const fechas =
            await pool.query(`
                SELECT
                    fv.id_fechavencimiento,
                    fv.id_producto,
                    fv.fecha_vencimiento,

                    p.nombre_producto,
                    p.fecha_notificacion

                FROM Fechas_vencimiento fv

                INNER JOIN Productos p
                    ON p.id_producto =
                       fv.id_producto

                WHERE
                    fv.fecha_vencimiento
                        IS NOT NULL

                    AND

                    p.fecha_notificacion
                        IS NOT NULL
            `);


        if (
            fechas.length === 0
        ) {

            return;

        }


        const usuarios =
            await pool.query(`
                SELECT
                    id_usuario

                FROM usuarios
            `);


        const fechaActual =
            new Date();


        for (
            const fecha
            of fechas
        ) {

            const fechaVencimiento =
                new Date(
                    fecha.fecha_vencimiento
                );


            const diffTiempo =
                fechaVencimiento.getTime() -
                fechaActual.getTime();


            const diffDias =
                Math.ceil(
                    diffTiempo /
                    (
                        1000 *
                        60 *
                        60 *
                        24
                    )
                );


            if (
                diffDias >
                Number(
                    fecha.fecha_notificacion
                )
            ) {

                continue;

            }


            let mensaje;


            if (diffDias < 0) {

                mensaje =
                    `El producto ${fecha.nombre_producto} tiene un lote vencido.`;

            }

            else if (diffDias === 0) {

                mensaje =
                    `El producto ${fecha.nombre_producto} vence hoy.`;

            }

            else {

                mensaje =
                    `El producto ${fecha.nombre_producto} está por vencerse en ${diffDias} días.`;

            }


            for (
                const usuario
                of usuarios
            ) {

                const existente =
                    await pool.query(`
                        SELECT
                            id_notificacion

                        FROM Notificaciones

                        WHERE
                            id_fecha_vencimiento = ?

                            AND
                            id_usuario = ?

                        LIMIT 1
                    `, [
                        fecha.id_fechavencimiento,
                        usuario.id_usuario
                    ]);


                if (
                    existente.length > 0
                ) {

                    continue;

                }


                await pool.query(
                    `
                        INSERT INTO Notificaciones
                        SET ?
                    `,
                    {
                        contenido:
                            mensaje,

                        estado:
                            1,

                        id_usuario:
                            usuario.id_usuario,

                        id_producto:
                            fecha.id_producto,

                        id_fecha_vencimiento:
                            fecha.id_fechavencimiento,

                        fecha_vencimiento:
                            fecha.fecha_vencimiento,

                        fecha_noti:
                            fechaActual,

                        existencias:
                            null
                    }
                );

            }

        }


    } catch (error) {

        console.error(
            'Error al verificar fechas de vencimiento:',
            error
        );

    }

}



async function verificarExistencias() {

    try {

        const productos =
            await pool.query(`
                SELECT
                    id_producto,
                    nombre_producto,
                    estado_producto

                FROM Productos

                WHERE
                    estado_producto
                    IN (2, 3)
            `);


        if (
            productos.length === 0
        ) {

            return;

        }


        const usuarios =
            await pool.query(`
                SELECT
                    id_usuario

                FROM usuarios
            `);


        const fechaActual =
            new Date();


        for (
            const producto
            of productos
        ) {

            const tipoExistencia =
                producto.estado_producto;


            const mensaje =
                tipoExistencia === 2

                    ? `El producto ${producto.nombre_producto} cuenta con bajas existencias`

                    : `El producto ${producto.nombre_producto} se ha agotado`;


            for (
                const usuario
                of usuarios
            ) {

                const existente =
                    await pool.query(`
                        SELECT
                            id_notificacion

                        FROM Notificaciones

                        WHERE
                            existencias = ?

                            AND
                            id_usuario = ?

                            AND
                            id_producto = ?

                        LIMIT 1
                    `, [
                        tipoExistencia,
                        usuario.id_usuario,
                        producto.id_producto
                    ]);


                if (
                    existente.length > 0
                ) {

                    continue;

                }


                await pool.query(
                    `
                        INSERT INTO Notificaciones
                        SET ?
                    `,
                    {
                        contenido:
                            mensaje,

                        estado:
                            1,

                        id_usuario:
                            usuario.id_usuario,

                        id_producto:
                            producto.id_producto,

                        id_fecha_vencimiento:
                            null,

                        fecha_vencimiento:
                            null,

                        fecha_noti:
                            fechaActual,

                        existencias:
                            tipoExistencia
                    }
                );

            }

        }


    } catch (error) {

        console.error(
            'Error al verificar existencias:',
            error
        );

    }

}



function ejecutarVerificacionesSiCorresponde() {

    const ahora =
        Date.now();


    if (
        ahora -
        ultimaVerificacionNotificaciones
        <
        INTERVALO_VERIFICACION
    ) {

        return;

    }


    ultimaVerificacionNotificaciones =
        ahora;


    Promise
        .all([
            verificarFechas(),
            verificarExistencias()
        ])
        .catch(
            error => {

                console.error(
                    'Error ejecutando verificaciones:',
                    error
                );

            }
        );

}



/* =========================================================
   OBTENER INVENTARIO PAGINADO
========================================================= */

/*
 * IMPORTANTE:
 *
 * La paginación se realiza primero sobre PRODUCTOS.
 *
 * No hacemos LIMIT directamente sobre:
 *
 * Productos JOIN Precios_productos
 *
 * porque un mismo producto puede tener varias unidades
 * y ocuparía varias posiciones de la página.
 */

async function obtenerInventarioPaginado({

    termino = '',
    pagina = 1,
    limite = 20,
    esAdmin = false

}) {

    const q =
        String(
            termino || ''
        ).trim();


    const page =
        Math.max(
            1,
            Number.parseInt(
                pagina,
                10
            ) || 1
        );


    const pageSize =
        Math.min(
            50,
            Math.max(
                10,
                Number.parseInt(
                    limite,
                    10
                ) || 20
            )
        );


    const whereParams = [];

    let where = '';


    /*
     * Permitimos buscar tanto por nombre
     * como por código de barras.
     */

    if (q) {

        const contiene =
            `%${q}%`;


        where = `
            WHERE
                p.nombre_producto LIKE ?

                OR

                EXISTS (

                    SELECT 1

                    FROM Precios_productos pb

                    WHERE
                        pb.id_producto =
                            p.id_producto

                        AND
                        pb.codigo_barras
                            LIKE ?
                )
        `;


        whereParams.push(
            contiene,
            contiene
        );

    }


    /* =====================================================
       TOTAL DE PRODUCTOS
    ====================================================== */

    const totalResultado =
        await pool.query(
            `
                SELECT
                    COUNT(*) AS total

                FROM Productos p

                ${where}
            `,
            whereParams
        );


    const total =
        Number(
            totalResultado[0].total
        ) || 0;


    const totalPaginas =
        Math.max(
            1,
            Math.ceil(
                total /
                pageSize
            )
        );


    const paginaActual =
        Math.min(
            page,
            totalPaginas
        );


    const offset =
        (
            paginaActual -
            1
        ) *
        pageSize;



    /* =====================================================
       ORDEN
    ====================================================== */

    const orderParams = [];

    let orderBy =
        `
            ORDER BY
                p.nombre_producto ASC
        `;


    /*
     * Si se escanea un código exacto,
     * ese producto aparece primero.
     */

    if (q) {

        orderBy = `
            ORDER BY

                CASE

                    WHEN EXISTS (

                        SELECT 1

                        FROM Precios_productos pe

                        WHERE
                            pe.id_producto =
                                p.id_producto

                            AND
                            pe.codigo_barras = ?

                    )
                    THEN 0


                    WHEN
                        p.nombre_producto LIKE ?

                    THEN 1


                    ELSE 2

                END,

                p.nombre_producto ASC
        `;


        orderParams.push(
            q,
            `${q}%`
        );

    }



    /* =====================================================
       OBTENER IDS DE LOS PRODUCTOS DE ESTA PÁGINA
    ====================================================== */

    const idsResultado =
        await pool.query(
            `
                SELECT
                    p.id_producto

                FROM Productos p

                ${where}

                ${orderBy}

                LIMIT ?
                OFFSET ?
            `,
            [
                ...whereParams,
                ...orderParams,
                pageSize,
                offset
            ]
        );


    const ids =
        idsResultado.map(
            fila =>
                Number(
                    fila.id_producto
                )
        );


    if (
        ids.length === 0
    ) {

        return {

            productos: [],

            paginacion: {

                pagina:
                    paginaActual,

                limite:
                    pageSize,

                total,

                totalPaginas,

                desde:
                    0,

                hasta:
                    0,

                tieneAnterior:
                    paginaActual > 1,

                tieneSiguiente:
                    paginaActual <
                    totalPaginas

            }

        };

    }



    /* =====================================================
       DATOS PRINCIPALES
    ====================================================== */

    const productosBase =
        await pool.query(`
            SELECT
                p.id_producto,
                p.nombre_producto,
                p.cantidad_limite,
                p.fecha_notificacion,
                p.estado_producto,

                COALESCE(
                    inv.inventario_total,
                    0
                ) AS inventarioTotal


            FROM Productos p


            LEFT JOIN (

                SELECT
                    id_producto,

                    SUM(inventario)
                        AS inventario_total

                FROM Fechas_vencimiento

                GROUP BY
                    id_producto

            ) inv

                ON inv.id_producto =
                   p.id_producto


            WHERE
                p.id_producto IN (?)
        `, [
            ids
        ]);



    /* =====================================================
       PRECIOS
    ====================================================== */

    /*
     * Para usuarios normales ni siquiera enviamos
     * precio_compra al navegador.
     */

    let precios;


    if (esAdmin) {

        precios =
            await pool.query(`
                SELECT
                    pp.id_precio,
                    pp.id_producto,
                    pp.precio_compra,
                    pp.precio_venta,
                    pp.codigo_barras,

                    u.nombre
                        AS unidad

                FROM Precios_productos pp

                INNER JOIN Unidades u
                    ON u.id_unidad =
                       pp.id_unidad

                WHERE
                    pp.id_producto
                    IN (?)

                ORDER BY
                    u.nombre ASC
            `, [
                ids
            ]);

    }

    else {

        precios =
            await pool.query(`
                SELECT
                    pp.id_precio,
                    pp.id_producto,
                    pp.precio_venta,
                    pp.codigo_barras,

                    u.nombre
                        AS unidad

                FROM Precios_productos pp

                INNER JOIN Unidades u
                    ON u.id_unidad =
                       pp.id_unidad

                WHERE
                    pp.id_producto
                    IN (?)

                ORDER BY
                    u.nombre ASC
            `, [
                ids
            ]);

    }



    /* =====================================================
       LOTES
    ====================================================== */

    const lotes =
        await pool.query(`
            SELECT
                id_producto,
                inventario,

                CASE

                    WHEN
                        fecha_vencimiento
                        IS NULL

                    THEN
                        NULL


                    ELSE
                        DATE_FORMAT(
                            fecha_vencimiento,
                            '%d/%m/%Y'
                        )

                END
                    AS fecha_vencimiento

            FROM Fechas_vencimiento

            WHERE
                id_producto
                IN (?)

            ORDER BY

                fecha_vencimiento
                    IS NULL ASC,

                fecha_vencimiento ASC
        `, [
            ids
        ]);



    /* =====================================================
       AGRUPAR PRODUCTOS
    ====================================================== */

    const mapaProductos =
        new Map();


    for (
        const producto
        of productosBase
    ) {

        mapaProductos.set(

            Number(
                producto.id_producto
            ),

            {

                ...producto,

                inventarioTotal:
                    Number(
                        producto.inventarioTotal
                    ) || 0,

                preciosventa: [],

                precioscompra: [],

                fechasVencimiento: []

            }

        );

    }



    /* =====================================================
       AGRUPAR PRECIOS
    ====================================================== */

    for (
        const precio
        of precios
    ) {

        const producto =
            mapaProductos.get(
                Number(
                    precio.id_producto
                )
            );


        if (!producto) {

            continue;

        }


        if (
            precio.precio_venta !== null &&
            Number(
                precio.precio_venta
            ) > 0
        ) {

            producto
                .preciosventa
                .push({

                    id_precio:
                        precio.id_precio,

                    precio_venta:
                        Number(
                            precio.precio_venta
                        ),

                    unidad:
                        precio.unidad,

                    codigo_barras:
                        precio.codigo_barras ||
                        null

                });

        }


        if (
            esAdmin &&
            precio.precio_compra !== null &&
            Number(
                precio.precio_compra
            ) > 0
        ) {

            producto
                .precioscompra
                .push({

                    id_precio:
                        precio.id_precio,

                    precio_compra:
                        Number(
                            precio.precio_compra
                        ),

                    unidad:
                        precio.unidad,

                    codigo_barras:
                        precio.codigo_barras ||
                        null

                });

        }

    }



    /* =====================================================
       AGRUPAR LOTES
    ====================================================== */

    for (
        const lote
        of lotes
    ) {

        const producto =
            mapaProductos.get(
                Number(
                    lote.id_producto
                )
            );


        if (!producto) {

            continue;

        }


        producto
            .fechasVencimiento
            .push({

                inventario:
                    Number(
                        lote.inventario
                    ) || 0,

                fecha_vencimiento:
                    lote.fecha_vencimiento ||
                    'Sin fecha de vencimiento'

            });

    }



    /*
     * Respetamos el orden obtenido
     * por la primera consulta.
     */

    const productos =
        ids
            .map(
                id =>
                    mapaProductos.get(id)
            )
            .filter(Boolean);



    return {

        productos,

        paginacion: {

            pagina:
                paginaActual,

            limite:
                pageSize,

            total,

            totalPaginas,

            desde:
                total === 0
                    ? 0
                    : offset + 1,

            hasta:
                Math.min(
                    offset +
                    pageSize,
                    total
                ),

            tieneAnterior:
                paginaActual > 1,

            tieneSiguiente:
                paginaActual <
                totalPaginas

        }

    };

}



/* =========================================================
   INVENTARIO PRINCIPAL
========================================================= */

router.get(
    '/',
    isLoggedIn,
    async (req, res) => {

        /*
         * Las notificaciones se verifican
         * como máximo una vez cada 5 minutos.
         */

        ejecutarVerificacionesSiCorresponde();


        return res.render(
            'productos/listA'
        );

    }
);



/* =========================================================
   API DE INVENTARIO
   BÚSQUEDA + PAGINACIÓN
========================================================= */

router.get(
    '/datos',
    isLoggedIn,
    async (req, res) => {

        try {

            const resultado =
                await obtenerInventarioPaginado({

                    termino:
                        req.query.q,

                    pagina:
                        req.query.page,

                    limite:
                        20,

                    esAdmin:
                        Number(
                            req.user.tipo
                        ) === 1

                });


            return res.json({

                ...resultado,

                esAdmin:
                    Number(
                        req.user.tipo
                    ) === 1

            });


        } catch (error) {

            console.error(
                'Error obteniendo inventario:',
                error
            );


            return res
                .status(500)
                .json({

                    error:
                        'No se pudo cargar el inventario.'

                });

        }

    }
);



/* =========================================================
   AGREGAR PRODUCTO
========================================================= */

router.get(
    '/add',
    isLoggedInAdmin,
    async (req, res) => {

        try {

            const unidades =
                await pool.query(`
                    SELECT *
                    FROM Unidades
                    ORDER BY nombre ASC
                `);


            return res.render(
                'productos/add',
                {
                    unidades
                }
            );


        } catch (error) {

            console.error(
                'Error cargando formulario de producto:',
                error
            );


            req.flash(
                'message',
                'No se pudo cargar el formulario.'
            );


            return res.redirect(
                '/inventario'
            );

        }

    }
);



router.post(
    '/add',
    isLoggedInAdmin,
    upload.single('imagen'),
    async (req, res) => {

        try {

            let {
                nombre,
                cantidadlimite,
                anos,
                meses,
                dias
            } = req.body;


            nombre =
                String(
                    nombre || ''
                ).trim();


            if (!nombre) {

                req.flash(
                    'message',
                    'Ingrese el nombre del producto.'
                );


                return res.redirect(
                    '/inventario/add'
                );

            }



            const productoExistente =
                await pool.query(`
                    SELECT
                        id_producto

                    FROM Productos

                    WHERE
                        nombre_producto = ?

                    LIMIT 1
                `, [
                    nombre
                ]);


            if (
                productoExistente.length > 0
            ) {

                req.flash(
                    'message',
                    'Ya existe un producto con el mismo nombre.'
                );


                return res.redirect(
                    '/inventario/add'
                );

            }



            const preciosVenta =
                normalizarArray(
                    req.body.precioVenta
                ).map(
                    valor =>
                        Number(
                            valor || 0
                        )
                );


            const preciosCompra =
                normalizarArray(
                    req.body.precioCompra
                ).map(
                    valor =>
                        Number(
                            valor || 0
                        )
                );


            const unidades =
                normalizarArray(
                    req.body.unidad
                );


            const codigosBarras =
                normalizarArray(
                    req.body.codigo_barras
                ).map(
                    valor => {

                        const codigo =
                            String(
                                valor || ''
                            ).trim();


                        return codigo || null;

                    }
                );


            const cantidadesIniciales =
                normalizarArray(
                    req.body.cantidadinicial
                ).map(
                    valor =>
                        Number(
                            valor || 0
                        )
                );


            const fechasVencimiento =
                normalizarArray(
                    req.body.fechavencimiento
                ).map(
                    valor => {

                        const fecha =
                            String(
                                valor || ''
                            ).trim();


                        return fecha || null;

                    }
                );



            if (
                unidades.length === 0 ||

                preciosVenta.length !==
                    unidades.length ||

                preciosCompra.length !==
                    unidades.length
            ) {

                req.flash(
                    'message',
                    'Los precios y unidades están incompletos.'
                );


                return res.redirect(
                    '/inventario/add'
                );

            }



            for (
                const precio
                of preciosCompra
            ) {

                if (
                    !Number.isFinite(precio) ||
                    precio < 0
                ) {

                    req.flash(
                        'message',
                        'Ingrese precios de compra válidos.'
                    );


                    return res.redirect(
                        '/inventario/add'
                    );

                }

            }



            for (
                const precio
                of preciosVenta
            ) {

                if (
                    !Number.isFinite(precio) ||
                    precio < 0
                ) {

                    req.flash(
                        'message',
                        'Ingrese precios de venta válidos.'
                    );


                    return res.redirect(
                        '/inventario/add'
                    );

                }

            }



            for (
                const cantidad
                of cantidadesIniciales
            ) {

                if (
                    !Number.isFinite(cantidad) ||
                    cantidad < 0
                ) {

                    req.flash(
                        'message',
                        'Ingrese cantidades iniciales válidas.'
                    );


                    return res.redirect(
                        '/inventario/add'
                    );

                }

            }



            const unidadesUnicas =
                new Set(
                    unidades.map(
                        String
                    )
                );


            if (
                unidadesUnicas.size !==
                unidades.length
            ) {

                req.flash(
                    'message',
                    'Existen unidades duplicadas.'
                );


                return res.redirect(
                    '/inventario/add'
                );

            }



            const fechasNoNulas =
                fechasVencimiento
                    .filter(Boolean);


            if (
                new Set(
                    fechasNoNulas
                ).size
                !==
                fechasNoNulas.length
            ) {

                req.flash(
                    'message',
                    'Existen fechas de vencimiento duplicadas.'
                );


                return res.redirect(
                    '/inventario/add'
                );

            }



            for (
                const codigo
                of codigosBarras
            ) {

                if (!codigo) {

                    continue;

                }


                const codigoExistente =
                    await pool.query(`
                        SELECT
                            id_precio

                        FROM Precios_productos

                        WHERE
                            codigo_barras = ?

                        LIMIT 1
                    `, [
                        codigo
                    ]);


                if (
                    codigoExistente.length > 0
                ) {

                    req.flash(
                        'message',
                        `El código de barras ${codigo} ya está registrado.`
                    );


                    return res.redirect(
                        '/inventario/add'
                    );

                }

            }



            anos =
                Number.parseInt(
                    anos,
                    10
                ) || 0;


            meses =
                Number.parseInt(
                    meses,
                    10
                ) || 0;


            dias =
                Number.parseInt(
                    dias,
                    10
                ) || 0;



            const fechaNotificacion =
                anos ||
                meses ||
                dias

                    ?
                    (
                        365 * anos
                    ) +
                    (
                        30 * meses
                    ) +
                    dias

                    :
                    null;



            const inventarioTotal =
                cantidadesIniciales
                    .reduce(
                        (
                            total,
                            cantidad
                        ) =>
                            total +
                            cantidad,
                        0
                    );


            const cantidadLimite =
                Number(
                    cantidadlimite
                ) || 0;


            const estado =
                calcularEstadoProducto(
                    inventarioTotal,
                    cantidadLimite
                );



            const resultadoProducto =
                await pool.query(
                    `
                        INSERT INTO Productos
                        SET ?
                    `,
                    {
                        nombre_producto:
                            nombre,

                        cantidad_limite:
                            cantidadLimite,

                        fecha_notificacion:
                            fechaNotificacion,

                        estado_producto:
                            estado
                    }
                );


            const idProducto =
                resultadoProducto.insertId;



            /* =================================================
               PRECIOS
            ================================================= */

            for (
                let i = 0;
                i < unidades.length;
                i++
            ) {

                await pool.query(
                    `
                        INSERT INTO Precios_productos
                        SET ?
                    `,
                    {
                        precio_compra:
                            preciosCompra[i],

                        precio_venta:
                            preciosVenta[i],

                        id_producto:
                            idProducto,

                        id_unidad:
                            unidades[i],

                        codigo_barras:
                            codigosBarras[i] ||
                            null
                    }
                );

            }



            /* =================================================
               INVENTARIO INICIAL
            ================================================= */

            for (
                let i = 0;
                i < cantidadesIniciales.length;
                i++
            ) {

                await pool.query(
                    `
                        INSERT INTO Fechas_vencimiento
                        SET ?
                    `,
                    {
                        fecha_vencimiento:
                            fechasVencimiento[i] ||
                            null,

                        inventario:
                            cantidadesIniciales[i],

                        id_producto:
                            idProducto
                    }
                );

            }



            req.flash(
                'success',
                'Producto agregado correctamente.'
            );


            return res.redirect(
                '/inventario'
            );


        } catch (error) {

            console.error(
                'Error al agregar producto:',
                error
            );


            req.flash(
                'message',
                'Error interno del servidor.'
            );


            return res.redirect(
                '/inventario/add'
            );

        }

    }
);



/* =========================================================
   EDITAR PRODUCTO
========================================================= */

router.get(
    '/edit/:id',
    isLoggedInAdmin,
    async (req, res) => {

        try {

            const {
                id
            } = req.params;



            const productos =
                await pool.query(`
                    SELECT *
                    FROM Productos

                    WHERE
                        id_producto = ?

                    LIMIT 1
                `, [
                    id
                ]);


            if (
                productos.length === 0
            ) {

                req.flash(
                    'message',
                    'El producto no existe.'
                );


                return res.redirect(
                    '/inventario'
                );

            }



            const precios =
                await pool.query(`
                    SELECT
                        pp.*,

                        u.nombre
                            AS nombre_unidad

                    FROM Precios_productos pp

                    INNER JOIN Unidades u
                        ON u.id_unidad =
                           pp.id_unidad

                    WHERE
                        pp.id_producto = ?

                    ORDER BY
                        u.nombre ASC
                `, [
                    id
                ]);



            const unidades =
                await pool.query(`
                    SELECT *
                    FROM Unidades

                    ORDER BY
                        nombre ASC
                `);



            const fechasVencimiento =
                await pool.query(`
                    SELECT
                        fv.*,


                        CASE

                            WHEN
                                fv.fecha_vencimiento
                                IS NULL

                            THEN
                                ''

                            ELSE
                                DATE_FORMAT(
                                    fv.fecha_vencimiento,
                                    '%Y-%m-%d'
                                )

                        END
                            AS fecha_vencimiento,


                        CASE

                            WHEN
                                fv.fecha_vencimiento
                                IS NULL

                            THEN
                                'Sin fecha de vencimiento'

                            ELSE
                                DATE_FORMAT(
                                    fv.fecha_vencimiento,
                                    '%d/%m/%Y'
                                )

                        END
                            AS fecha_vencimientoFormateada


                    FROM Fechas_vencimiento fv

                    WHERE
                        fv.id_producto = ?

                    ORDER BY

                        fv.fecha_vencimiento
                            IS NULL ASC,

                        fv.fecha_vencimiento ASC
                `, [
                    id
                ]);



            const cantidadDias =
                Number(
                    productos[0]
                        .fecha_notificacion
                ) || 0;


            const anos =
                Math.floor(
                    cantidadDias /
                    365
                );


            const meses =
                Math.floor(
                    (
                        cantidadDias -
                        (
                            365 *
                            anos
                        )
                    ) /
                    30
                );


            const dias =
                cantidadDias -
                (
                    365 *
                    anos
                ) -
                (
                    30 *
                    meses
                );



            return res.render(
                'productos/edit',
                {
                    producto:
                        productos[0],

                    precios,

                    unidades,

                    fechasvencimiento:
                        fechasVencimiento,

                    anos,

                    meses,

                    dias
                }
            );


        } catch (error) {

            console.error(
                'Error cargando producto:',
                error
            );


            req.flash(
                'message',
                'No se pudo cargar el producto.'
            );


            return res.redirect(
                '/inventario'
            );

        }

    }
);



router.post(
    '/edit/:id',
    isLoggedInAdmin,
    upload.single('imagen'),
    async (req, res) => {

        try {

            const {
                id
            } = req.params;


            let {
                nombre,
                cantidadlimite,
                anos,
                meses,
                dias
            } = req.body;


            nombre =
                String(
                    nombre || ''
                ).trim();



            const productoExistente =
                await pool.query(`
                    SELECT
                        id_producto

                    FROM Productos

                    WHERE
                        nombre_producto = ?

                        AND
                        id_producto <> ?

                    LIMIT 1
                `, [
                    nombre,
                    id
                ]);


            if (
                productoExistente.length > 0
            ) {

                req.flash(
                    'message',
                    'Ya existe un producto con el mismo nombre.'
                );


                return res.redirect(
                    `/inventario/edit/${id}`
                );

            }



            anos =
                Number.parseInt(
                    anos,
                    10
                ) || 0;


            meses =
                Number.parseInt(
                    meses,
                    10
                ) || 0;


            dias =
                Number.parseInt(
                    dias,
                    10
                ) || 0;



            const fechaNotificacionCalculada =
                (
                    365 *
                    anos
                ) +
                (
                    30 *
                    meses
                ) +
                dias;


            const fechaNotificacion =
                fechaNotificacionCalculada === 0

                    ?
                    null

                    :
                    fechaNotificacionCalculada;



            await pool.query(
                `
                    UPDATE Productos

                    SET ?

                    WHERE
                        id_producto = ?
                `,
                [
                    {
                        nombre_producto:
                            nombre,

                        cantidad_limite:
                            Number(
                                cantidadlimite
                            ) || 0,

                        fecha_notificacion:
                            fechaNotificacion
                    },

                    id
                ]
            );



            await actualizarEstadoProducto(
                id
            );



            req.flash(
                'success',
                'Producto editado correctamente.'
            );


            return res.redirect(
                '/inventario'
            );


        } catch (error) {

            console.error(
                'Error al editar producto:',
                error
            );


            req.flash(
                'message',
                'Error interno del servidor.'
            );


            return res.redirect(
                `/inventario/edit/${req.params.id}`
            );

        }

    }
);



/* =========================================================
   EDITAR PRECIO
========================================================= */

router.post(
    '/editarprecios/:id',
    isLoggedInAdmin,
    async (req, res) => {

        try {

            const {
                id
            } = req.params;



            const resultado =
                await pool.query(`
                    SELECT *
                    FROM Precios_productos

                    WHERE
                        id_precio = ?

                    LIMIT 1
                `, [
                    id
                ]);


            if (
                resultado.length === 0
            ) {

                req.flash(
                    'message',
                    'El precio no existe.'
                );


                return res.redirect(
                    '/inventario'
                );

            }



            const {
                unidad,
                precio_compra,
                precio_venta,
                codigo_barras
            } = req.body;



            const precioCompra =
                Number(
                    precio_compra || 0
                );


            const precioVenta =
                Number(
                    precio_venta || 0
                );


            const codigo =
                String(
                    codigo_barras || ''
                ).trim() || null;



            if (
                !Number.isFinite(
                    precioCompra
                ) ||

                precioCompra < 0 ||

                !Number.isFinite(
                    precioVenta
                ) ||

                precioVenta < 0
            ) {

                req.flash(
                    'message',
                    'Ingrese precios válidos.'
                );


                return res.redirect(
                    `/inventario/edit/${resultado[0].id_producto}`
                );

            }



            if (codigo) {

                const duplicado =
                    await pool.query(`
                        SELECT
                            id_precio

                        FROM Precios_productos

                        WHERE
                            codigo_barras = ?

                            AND
                            id_precio <> ?

                        LIMIT 1
                    `, [
                        codigo,
                        id
                    ]);


                if (
                    duplicado.length > 0
                ) {

                    req.flash(
                        'message',
                        `El código de barras ${codigo} ya está registrado.`
                    );


                    return res.redirect(
                        `/inventario/edit/${resultado[0].id_producto}`
                    );

                }

            }



            const unidadExistente =
                await pool.query(`
                    SELECT
                        id_precio

                    FROM Precios_productos

                    WHERE
                        id_producto = ?

                        AND
                        id_unidad = ?

                        AND
                        id_precio <> ?

                    LIMIT 1
                `, [
                    resultado[0].id_producto,
                    unidad,
                    id
                ]);


            if (
                unidadExistente.length > 0
            ) {

                req.flash(
                    'message',
                    'Ya existe esta unidad registrada en el producto.'
                );


                return res.redirect(
                    `/inventario/edit/${resultado[0].id_producto}`
                );

            }



            await pool.query(
                `
                    UPDATE Precios_productos

                    SET ?

                    WHERE
                        id_precio = ?
                `,
                [
                    {
                        precio_compra:
                            precioCompra,

                        precio_venta:
                            precioVenta,

                        id_unidad:
                            unidad,

                        codigo_barras:
                            codigo
                    },

                    id
                ]
            );



            req.flash(
                'success',
                'Precios actualizados correctamente.'
            );


            return res.redirect(
                `/inventario/edit/${resultado[0].id_producto}`
            );


        } catch (error) {

            console.error(
                'Error editando precios:',
                error
            );


            req.flash(
                'message',
                'No se pudieron actualizar los precios.'
            );


            return res.redirect(
                '/inventario'
            );

        }

    }
);



/* =========================================================
   AÑADIR PRECIO
========================================================= */

router.post(
    '/anadirprecios/:id',
    isLoggedInAdmin,
    async (req, res) => {

        try {

            const {
                id
            } = req.params;


            const {
                unidad,
                precio_compra,
                precio_venta,
                codigo_barras
            } = req.body;


            const precioCompra =
                Number(
                    precio_compra || 0
                );


            const precioVenta =
                Number(
                    precio_venta || 0
                );


            const codigo =
                String(
                    codigo_barras || ''
                ).trim() || null;



            if (
                !Number.isFinite(
                    precioCompra
                ) ||

                precioCompra < 0 ||

                !Number.isFinite(
                    precioVenta
                ) ||

                precioVenta < 0
            ) {

                req.flash(
                    'message',
                    'Ingrese precios válidos.'
                );


                return res.redirect(
                    `/inventario/edit/${id}`
                );

            }



            const unidadExistente =
                await pool.query(`
                    SELECT
                        id_precio

                    FROM Precios_productos

                    WHERE
                        id_producto = ?

                        AND
                        id_unidad = ?

                    LIMIT 1
                `, [
                    id,
                    unidad
                ]);


            if (
                unidadExistente.length > 0
            ) {

                req.flash(
                    'message',
                    'Ya existe esta unidad registrada en el producto.'
                );


                return res.redirect(
                    `/inventario/edit/${id}`
                );

            }



            if (codigo) {

                const codigoExistente =
                    await pool.query(`
                        SELECT
                            id_precio

                        FROM Precios_productos

                        WHERE
                            codigo_barras = ?

                        LIMIT 1
                    `, [
                        codigo
                    ]);


                if (
                    codigoExistente.length > 0
                ) {

                    req.flash(
                        'message',
                        `El código de barras ${codigo} ya está registrado.`
                    );


                    return res.redirect(
                        `/inventario/edit/${id}`
                    );

                }

            }



            await pool.query(
                `
                    INSERT INTO Precios_productos
                    SET ?
                `,
                {
                    precio_compra:
                        precioCompra,

                    precio_venta:
                        precioVenta,

                    id_producto:
                        id,

                    id_unidad:
                        unidad,

                    codigo_barras:
                        codigo
                }
            );



            req.flash(
                'success',
                'Precio agregado correctamente.'
            );


            return res.redirect(
                `/inventario/edit/${id}`
            );


        } catch (error) {

            console.error(
                'Error agregando precio:',
                error
            );


            req.flash(
                'message',
                'No se pudo agregar el precio.'
            );


            return res.redirect(
                `/inventario/edit/${req.params.id}`
            );

        }

    }
);



/* =========================================================
   ELIMINAR PRECIO
========================================================= */

router.get(
    '/eliminarprecio/:id',
    isLoggedInAdmin,
    async (req, res) => {

        try {

            const {
                id
            } = req.params;



            const resultado =
                await pool.query(`
                    SELECT
                        id_producto

                    FROM Precios_productos

                    WHERE
                        id_precio = ?

                    LIMIT 1
                `, [
                    id
                ]);


            if (
                resultado.length === 0
            ) {

                req.flash(
                    'message',
                    'El precio no existe.'
                );


                return res.redirect(
                    '/inventario'
                );

            }



            await pool.query(`
                DELETE FROM Precios_productos

                WHERE
                    id_precio = ?
            `, [
                id
            ]);



            req.flash(
                'noti',
                'Precio eliminado correctamente.'
            );


            return res.redirect(
                `/inventario/edit/${resultado[0].id_producto}`
            );


        } catch (error) {

            console.error(
                'Error eliminando precio:',
                error
            );


            req.flash(
                'message',
                'No se pudo eliminar el precio.'
            );


            return res.redirect(
                '/inventario'
            );

        }

    }
);



/* =========================================================
   EDITAR INVENTARIO
========================================================= */

router.post(
    '/editarinventarios/:id',
    isLoggedInAdmin,
    async (req, res) => {

        try {

            const {
                id
            } = req.params;



            const resultado =
                await pool.query(`
                    SELECT *
                    FROM Fechas_vencimiento

                    WHERE
                        id_fechavencimiento = ?

                    LIMIT 1
                `, [
                    id
                ]);


            if (
                resultado.length === 0
            ) {

                req.flash(
                    'message',
                    'El registro de inventario no existe.'
                );


                return res.redirect(
                    '/inventario'
                );

            }



            const inventario =
                Number(
                    req.body.inventario || 0
                );


            const fechaVencimiento =
                String(
                    req.body.fechavencimiento || ''
                ).trim() || null;



            if (
                !Number.isFinite(
                    inventario
                ) ||

                inventario < 0
            ) {

                req.flash(
                    'message',
                    'Ingrese un inventario válido mayor o igual que cero.'
                );


                return res.redirect(
                    `/inventario/edit/${resultado[0].id_producto}`
                );

            }



            let fechaExistente;


            if (fechaVencimiento) {

                fechaExistente =
                    await pool.query(`
                        SELECT
                            id_fechavencimiento

                        FROM Fechas_vencimiento

                        WHERE
                            id_producto = ?

                            AND
                            fecha_vencimiento = ?

                            AND
                            id_fechavencimiento <> ?

                        LIMIT 1
                    `, [
                        resultado[0].id_producto,
                        fechaVencimiento,
                        id
                    ]);

            }

            else {

                fechaExistente =
                    await pool.query(`
                        SELECT
                            id_fechavencimiento

                        FROM Fechas_vencimiento

                        WHERE
                            id_producto = ?

                            AND
                            fecha_vencimiento
                                IS NULL

                            AND
                            id_fechavencimiento <> ?

                        LIMIT 1
                    `, [
                        resultado[0].id_producto,
                        id
                    ]);

            }



            if (
                fechaExistente.length > 0
            ) {

                req.flash(
                    'message',
                    'Ya existe esta fecha de vencimiento en el producto.'
                );


                return res.redirect(
                    `/inventario/edit/${resultado[0].id_producto}`
                );

            }



            await pool.query(
                `
                    UPDATE Fechas_vencimiento

                    SET ?

                    WHERE
                        id_fechavencimiento = ?
                `,
                [
                    {
                        fecha_vencimiento:
                            fechaVencimiento,

                        inventario
                    },

                    id
                ]
            );



            await actualizarEstadoProducto(
                resultado[0].id_producto
            );



            req.flash(
                'success',
                'Inventario actualizado correctamente.'
            );


            return res.redirect(
                `/inventario/edit/${resultado[0].id_producto}`
            );


        } catch (error) {

            console.error(
                'Error editando inventario:',
                error
            );


            req.flash(
                'message',
                'No se pudo actualizar el inventario.'
            );


            return res.redirect(
                '/inventario'
            );

        }

    }
);



/* =========================================================
   AÑADIR INVENTARIO
========================================================= */

router.post(
    '/anadirinventarios/:id',
    isLoggedInAdmin,
    async (req, res) => {

        try {

            const {
                id
            } = req.params;


            const inventario =
                Number(
                    req.body.inventario || 0
                );


            const fechaVencimiento =
                String(
                    req.body.fechavencimiento || ''
                ).trim() || null;



            if (
                !Number.isFinite(
                    inventario
                ) ||

                inventario < 0
            ) {

                req.flash(
                    'message',
                    'Ingrese un inventario válido mayor o igual que cero.'
                );


                return res.redirect(
                    `/inventario/edit/${id}`
                );

            }



            let fechaExistente;


            if (fechaVencimiento) {

                fechaExistente =
                    await pool.query(`
                        SELECT
                            id_fechavencimiento

                        FROM Fechas_vencimiento

                        WHERE
                            id_producto = ?

                            AND
                            fecha_vencimiento = ?

                        LIMIT 1
                    `, [
                        id,
                        fechaVencimiento
                    ]);

            }

            else {

                fechaExistente =
                    await pool.query(`
                        SELECT
                            id_fechavencimiento

                        FROM Fechas_vencimiento

                        WHERE
                            id_producto = ?

                            AND
                            fecha_vencimiento
                                IS NULL

                        LIMIT 1
                    `, [
                        id
                    ]);

            }



            if (
                fechaExistente.length > 0
            ) {

                req.flash(
                    'message',
                    'Ya existe esta fecha de vencimiento en el producto.'
                );


                return res.redirect(
                    `/inventario/edit/${id}`
                );

            }



            await pool.query(
                `
                    INSERT INTO Fechas_vencimiento
                    SET ?
                `,
                {
                    fecha_vencimiento:
                        fechaVencimiento,

                    inventario,

                    id_producto:
                        id
                }
            );



            await actualizarEstadoProducto(
                id
            );



            req.flash(
                'success',
                'Inventario agregado correctamente.'
            );


            return res.redirect(
                `/inventario/edit/${id}`
            );


        } catch (error) {

            console.error(
                'Error agregando inventario:',
                error
            );


            req.flash(
                'message',
                'No se pudo agregar el inventario.'
            );


            return res.redirect(
                `/inventario/edit/${req.params.id}`
            );

        }

    }
);



/* =========================================================
   ELIMINAR INVENTARIO
========================================================= */

router.get(
    '/eliminarinventario/:id',
    isLoggedInAdmin,
    async (req, res) => {

        try {

            const {
                id
            } = req.params;



            const resultado =
                await pool.query(`
                    SELECT
                        id_producto

                    FROM Fechas_vencimiento

                    WHERE
                        id_fechavencimiento = ?

                    LIMIT 1
                `, [
                    id
                ]);


            if (
                resultado.length === 0
            ) {

                req.flash(
                    'message',
                    'El registro de inventario no existe.'
                );


                return res.redirect(
                    '/inventario'
                );

            }



            const idProducto =
                resultado[0].id_producto;



            await pool.query(`
                DELETE FROM Notificaciones

                WHERE
                    id_fecha_vencimiento = ?
            `, [
                id
            ]);



            await pool.query(`
                DELETE FROM Fechas_vencimiento

                WHERE
                    id_fechavencimiento = ?
            `, [
                id
            ]);



            await actualizarEstadoProducto(
                idProducto
            );



            req.flash(
                'noti',
                'Inventario eliminado correctamente.'
            );


            return res.redirect(
                `/inventario/edit/${idProducto}`
            );


        } catch (error) {

            console.error(
                'Error eliminando inventario:',
                error
            );


            req.flash(
                'message',
                'No se pudo eliminar el inventario.'
            );


            return res.redirect(
                '/inventario'
            );

        }

    }
);



/* =========================================================
   UNIDADES
========================================================= */

router.get(
    '/unidades',
    isLoggedInAdmin,
    async (req, res) => {

        try {

            const unidades =
                await pool.query(`
                    SELECT *
                    FROM Unidades

                    ORDER BY
                        nombre ASC
                `);


            return res.render(
                'productos/unidades',
                {
                    unidades
                }
            );


        } catch (error) {

            console.error(
                'Error cargando unidades:',
                error
            );


            req.flash(
                'message',
                'No se pudieron cargar las unidades.'
            );


            return res.redirect(
                '/inventario'
            );

        }

    }
);



router.post(
    '/unidades',
    isLoggedInAdmin,
    async (req, res) => {

        try {

            const nombre =
                String(
                    req.body.nombre || ''
                ).trim();


            const cantidadTexto =
                String(
                    req.body.cantidad || ''
                ).trim();


            const cantidadValida =
                /^\d+(\.\d{1,3})?$/
                    .test(
                        cantidadTexto
                    );


            if (
                !cantidadValida
            ) {

                req.flash(
                    'message',
                    'La cantidad debe ser un número válido con hasta 3 decimales.'
                );


                return res.redirect(
                    '/inventario/unidades'
                );

            }



            const unidadExistente =
                await pool.query(`
                    SELECT
                        id_unidad

                    FROM Unidades

                    WHERE
                        nombre = ?

                    LIMIT 1
                `, [
                    nombre
                ]);


            if (
                unidadExistente.length > 0
            ) {

                req.flash(
                    'message',
                    'Ya existe una unidad con el mismo nombre.'
                );


                return res.redirect(
                    '/inventario/unidades'
                );

            }



            await pool.query(
                `
                    INSERT INTO Unidades
                    SET ?
                `,
                {
                    nombre,

                    cantidad:
                        Number(
                            cantidadTexto
                        )
                }
            );



            req.flash(
                'success',
                'Unidad agregada correctamente.'
            );


            return res.redirect(
                '/inventario/unidades'
            );


        } catch (error) {

            console.error(
                'Error agregando unidad:',
                error
            );


            req.flash(
                'message',
                'No se pudo agregar la unidad.'
            );


            return res.redirect(
                '/inventario/unidades'
            );

        }

    }
);



router.get(
    '/unidades/edit/:id',
    isLoggedInAdmin,
    async (req, res) => {

        try {

            const unidades =
                await pool.query(`
                    SELECT *
                    FROM Unidades

                    WHERE
                        id_unidad = ?

                    LIMIT 1
                `, [
                    req.params.id
                ]);


            if (
                unidades.length === 0
            ) {

                req.flash(
                    'message',
                    'La unidad no existe.'
                );


                return res.redirect(
                    '/inventario/unidades'
                );

            }



            return res.render(
                'productos/unidadesedit',
                {
                    unidad:
                        unidades[0]
                }
            );


        } catch (error) {

            console.error(
                'Error cargando unidad:',
                error
            );


            req.flash(
                'message',
                'No se pudo cargar la unidad.'
            );


            return res.redirect(
                '/inventario/unidades'
            );

        }

    }
);



router.post(
    '/unidades/edit/:id',
    isLoggedInAdmin,
    async (req, res) => {

        try {

            const {
                id
            } = req.params;


            const nombre =
                String(
                    req.body.nombre || ''
                ).trim();


            const cantidadTexto =
                String(
                    req.body.cantidad || ''
                ).trim();


            const cantidadValida =
                /^\d+(\.\d{1,3})?$/
                    .test(
                        cantidadTexto
                    );


            if (
                !cantidadValida
            ) {

                req.flash(
                    'message',
                    'La cantidad debe ser un número válido con hasta 3 decimales.'
                );


                return res.redirect(
                    `/inventario/unidades/edit/${id}`
                );

            }



            const unidadExistente =
                await pool.query(`
                    SELECT
                        id_unidad

                    FROM Unidades

                    WHERE
                        nombre = ?

                        AND
                        id_unidad <> ?

                    LIMIT 1
                `, [
                    nombre,
                    id
                ]);


            if (
                unidadExistente.length > 0
            ) {

                req.flash(
                    'message',
                    'Ya existe una unidad con el mismo nombre.'
                );


                return res.redirect(
                    `/inventario/unidades/edit/${id}`
                );

            }



            await pool.query(
                `
                    UPDATE Unidades

                    SET ?

                    WHERE
                        id_unidad = ?
                `,
                [
                    {
                        nombre,

                        cantidad:
                            Number(
                                cantidadTexto
                            )
                    },

                    id
                ]
            );



            req.flash(
                'success',
                'Unidad modificada correctamente.'
            );


            return res.redirect(
                '/inventario/unidades'
            );


        } catch (error) {

            console.error(
                'Error editando unidad:',
                error
            );


            req.flash(
                'message',
                'No se pudo modificar la unidad.'
            );


            return res.redirect(
                '/inventario/unidades'
            );

        }

    }
);



module.exports = router;