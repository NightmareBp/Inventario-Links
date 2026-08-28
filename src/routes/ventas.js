const express = require('express');
const router = express.Router();

const PDFDocument = require('pdfkit');

const pool = require('../database');

const {
    isLoggedIn
} = require('../lib/auth');


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


/* =========================================================
   TRANSACCIONES
========================================================= */

function obtenerConexion() {

    return new Promise(
        (resolve, reject) => {

            pool.getConnection(
                (error, connection) => {

                    if (error) {
                        return reject(error);
                    }

                    resolve(connection);
                }
            );

        }
    );
}


function consultar(
    connection,
    sql,
    params = []
) {

    if (!connection) {
        return pool.query(sql, params);
    }


    return new Promise(
        (resolve, reject) => {

            connection.query(
                sql,
                params,
                (error, resultado) => {

                    if (error) {
                        return reject(error);
                    }

                    resolve(resultado);
                }
            );

        }
    );
}


function iniciarTransaccion(connection) {

    return new Promise(
        (resolve, reject) => {

            connection.beginTransaction(
                error => {

                    if (error) {
                        return reject(error);
                    }

                    resolve();
                }
            );

        }
    );
}


function confirmarTransaccion(connection) {

    return new Promise(
        (resolve, reject) => {

            connection.commit(
                error => {

                    if (error) {
                        return reject(error);
                    }

                    resolve();
                }
            );

        }
    );
}


function cancelarTransaccion(connection) {

    return new Promise(
        resolve => {

            connection.rollback(
                () => resolve()
            );

        }
    );
}


/* =========================================================
   ESTADO PRODUCTO
========================================================= */

async function actualizarEstadoProducto(
    idProducto,
    connection = null
) {

    const resultado =
        await consultar(
            connection,
            `
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
            `,
            [idProducto]
        );


    if (
        resultado.length === 0
    ) {
        return;
    }


    const stock =
        Number(
            resultado[0].inventario_total
        ) || 0;


    const limite =
        Number(
            resultado[0].cantidad_limite
        ) || 0;


    let estado = 1;


    if (stock <= 0) {

        estado = 3;

    } else if (stock <= limite) {

        estado = 2;

    }


    await consultar(
        connection,
        `
            UPDATE Productos

            SET estado_producto = ?

            WHERE id_producto = ?
        `,
        [
            estado,
            idProducto
        ]
    );


    if (estado === 1) {

        await consultar(
            connection,
            `
                DELETE FROM Notificaciones

                WHERE
                    id_producto = ?

                    AND
                    existencias IN (2, 3)
            `,
            [idProducto]
        );

    } else if (estado === 2) {

        await consultar(
            connection,
            `
                DELETE FROM Notificaciones

                WHERE
                    id_producto = ?

                    AND
                    existencias = 3
            `,
            [idProducto]
        );

    } else {

        await consultar(
            connection,
            `
                DELETE FROM Notificaciones

                WHERE
                    id_producto = ?

                    AND
                    existencias = 2
            `,
            [idProducto]
        );

    }

}


/* =========================================================
   LISTADO
========================================================= */

router.get(
    '/',
    isLoggedIn,
    async (req, res) => {

        try {

            const {
                q,
                q1
            } = req.query;


            const orden =
                req.query.orden === 'asc'
                    ? 'asc'
                    : 'desc';


            const ordenSQL =
                orden === 'asc'
                    ? 'ASC'
                    : 'DESC';


            const params = [];

            let where = '';


            if (q && q1) {

                where = `
                    WHERE
                        fecha_venta >=
                            CONCAT(?, ' 00:00:00')

                        AND

                        fecha_venta <
                            DATE_ADD(
                                CONCAT(?, ' 00:00:00'),
                                INTERVAL 1 DAY
                            )
                `;


                params.push(
                    q,
                    q1
                );

            }


            const ventas =
                await pool.query(
                    `
                        SELECT
                            v.*,

                            DATE_FORMAT(
                                v.fecha_venta,
                                '%d/%m/%Y'
                            ) AS fecha_mostrar,

                            DATE_FORMAT(
                                v.fecha_venta,
                                '%H:%i:%s'
                            ) AS hora_mostrar

                        FROM Ventas v

                        ${where}

                        ORDER BY
                            v.fecha_venta ${ordenSQL},
                            v.id_venta ${ordenSQL}
                    `,
                    params
                );


            ventas.forEach(
                venta => {

                    venta.monto_total =
                        Number(
                            venta.monto_total
                        ).toFixed(2);

                }
            );


            let montototall = null;


            if (q && q1) {

                const total =
                    await pool.query(
                        `
                            SELECT
                                COALESCE(
                                    SUM(monto_total),
                                    0
                                ) AS total_ventas

                            FROM Ventas

                            ${where}
                        `,
                        params
                    );


                montototall =
                    Number(
                        total[0].total_ventas
                    ).toFixed(2);

            }


            return res.render(
                'ventas/listV',
                {
                    ventas,
                    q,
                    q1,
                    orden,
                    montototall
                }
            );


        } catch (error) {

            console.error(
                'Error obteniendo ventas:',
                error
            );


            return res
                .status(500)
                .send(
                    'Error interno del servidor'
                );

        }

    }
);


/* =========================================================
   FORMULARIO
========================================================= */

router.get(
    '/add',
    isLoggedIn,
    async (req, res) => {

        return res.render(
            'ventas/addVenta'
        );

    }
);


/* =========================================================
   AUTOCOMPLETADO
========================================================= */

router.get(
    '/productos/buscar',
    isLoggedIn,
    async (req, res) => {

        try {

            const termino =
                String(
                    req.query.q || ''
                ).trim();


            if (termino.length < 2) {

                return res.json([]);

            }


            const contiene =
                `%${termino}%`;


            const comienza =
                `${termino}%`;


            const productos =
                await pool.query(
                    `
                        SELECT
                            p.id_producto,
                            p.nombre_producto,

                            COALESCE(
                                fv.inventario_total,
                                0
                            ) AS inventario_total

                        FROM Productos p

                        LEFT JOIN (

                            SELECT
                                id_producto,
                                SUM(inventario)
                                    AS inventario_total

                            FROM Fechas_vencimiento

                            GROUP BY id_producto

                        ) fv
                            ON fv.id_producto =
                               p.id_producto


                        WHERE

                            (
                                p.nombre_producto
                                    LIKE ?

                                OR EXISTS (

                                    SELECT 1

                                    FROM Precios_productos pb

                                    WHERE
                                        pb.id_producto =
                                            p.id_producto

                                        AND
                                        pb.codigo_barras
                                            LIKE ?
                                )
                            )


                            AND

                            COALESCE(
                                fv.inventario_total,
                                0
                            ) > 0


                            AND EXISTS (

                                SELECT 1

                                FROM Precios_productos pv

                                WHERE
                                    pv.id_producto =
                                        p.id_producto

                                    AND
                                    pv.precio_venta > 0
                            )


                        ORDER BY

                            CASE
                                WHEN
                                    p.nombre_producto
                                        LIKE ?
                                THEN 0
                                ELSE 1
                            END,

                            p.nombre_producto ASC


                        LIMIT 10
                    `,
                    [
                        contiene,
                        contiene,
                        comienza
                    ]
                );


            return res.json(
                productos
            );


        } catch (error) {

            console.error(
                'Error buscando productos:',
                error
            );


            return res
                .status(500)
                .json({
                    error:
                        'Error buscando productos'
                });

        }

    }
);


/* =========================================================
   PRECIOS DE VENTA
========================================================= */

router.get(
    '/productos/:idProducto/preciosVenta',
    isLoggedIn,
    async (req, res) => {

        try {

            const {
                idProducto
            } = req.params;


            const precios =
                await pool.query(
                    `
                        SELECT
                            pp.id_precio,
                            pp.id_unidad,
                            pp.precio_venta,

                            u.nombre
                                AS nombre_unidad,

                            u.cantidad
                                AS cantidad_referencial

                        FROM Precios_productos pp

                        INNER JOIN Unidades u
                            ON u.id_unidad =
                               pp.id_unidad

                        WHERE
                            pp.id_producto = ?

                            AND
                            pp.precio_venta > 0

                        ORDER BY
                            u.nombre ASC
                    `,
                    [idProducto]
                );


            return res.json(
                precios
            );


        } catch (error) {

            console.error(
                'Error obteniendo precios:',
                error
            );


            return res
                .status(500)
                .json({
                    error:
                        'Error obteniendo precios'
                });

        }

    }
);


/* =========================================================
   CÓDIGO DE BARRAS
========================================================= */

router.get(
    '/productos/barcode/:barcode',
    isLoggedIn,
    async (req, res) => {

        try {

            const barcode =
                String(
                    req.params.barcode
                ).trim();


            const resultado =
                await pool.query(
                    `
                        SELECT
                            pp.id_precio,
                            pp.id_producto,
                            pp.id_unidad,
                            pp.precio_venta,

                            u.nombre
                                AS nombre_unidad,

                            u.cantidad
                                AS cantidad_referencial,

                            p.nombre_producto,

                            COALESCE(
                                fv.inventario_total,
                                0
                            ) AS inventario_total

                        FROM Precios_productos pp

                        INNER JOIN Productos p
                            ON p.id_producto =
                               pp.id_producto

                        INNER JOIN Unidades u
                            ON u.id_unidad =
                               pp.id_unidad

                        LEFT JOIN (

                            SELECT
                                id_producto,
                                SUM(inventario)
                                    AS inventario_total

                            FROM Fechas_vencimiento

                            GROUP BY id_producto

                        ) fv
                            ON fv.id_producto =
                               p.id_producto

                        WHERE
                            pp.codigo_barras = ?

                        LIMIT 1
                    `,
                    [barcode]
                );


            if (
                resultado.length === 0
            ) {

                return res
                    .status(404)
                    .json({
                        error:
                            'Código de barras no registrado'
                    });

            }


            const producto =
                resultado[0];


            if (
                Number(
                    producto.precio_venta
                ) <= 0
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            'Este producto no tiene precio de venta'
                    });

            }


            if (
                Number(
                    producto.inventario_total
                ) <= 0
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            'El producto está agotado'
                    });

            }


            return res.json(
                producto
            );


        } catch (error) {

            console.error(
                'Error leyendo código:',
                error
            );


            return res
                .status(500)
                .json({
                    error:
                        'Error interno del servidor'
                });

        }

    }
);


/* =========================================================
   REGISTRAR VENTA
========================================================= */

router.post(
    '/add',
    isLoggedIn,
    async (req, res) => {

        let connection = null;


        try {

            const productos =
                normalizarArray(
                    req.body.producto
                );


            const precios =
                normalizarArray(
                    req.body.precioventa
                );


            const cantidades =
                normalizarArray(
                    req.body.cantidad
                );


            if (
                productos.length === 0
            ) {

                req.flash(
                    'message',
                    'Debe agregar al menos un producto.'
                );


                return res.redirect(
                    '/ventas/add'
                );

            }


            if (
                productos.length !==
                    precios.length ||

                productos.length !==
                    cantidades.length
            ) {

                req.flash(
                    'message',
                    'Los datos de la venta están incompletos.'
                );


                return res.redirect(
                    '/ventas/add'
                );

            }


            for (
                let i = 0;
                i < productos.length;
                i++
            ) {

                const cantidad =
                    Number(
                        cantidades[i]
                    );


                if (
                    !Number.isInteger(cantidad) ||
                    cantidad <= 0
                ) {

                    req.flash(
                        'message',
                        'Las cantidades deben ser números enteros mayores que cero.'
                    );


                    return res.redirect(
                        '/ventas/add'
                    );

                }


                for (
                    let j = i + 1;
                    j < productos.length;
                    j++
                ) {

                    if (
                        String(productos[i]) ===
                            String(productos[j])

                        &&

                        String(precios[i]) ===
                            String(precios[j])
                    ) {

                        req.flash(
                            'message',
                            'El mismo producto y presentación está repetido. Ajuste la cantidad en una sola fila.'
                        );


                        return res.redirect(
                            '/ventas/add'
                        );

                    }

                }

            }


            /* =========================================
               PREPARAR LÍNEAS
            ========================================= */

            const lineas = [];

            const requeridoPorProducto =
                new Map();


            let montoTotal = 0;


            for (
                let i = 0;
                i < productos.length;
                i++
            ) {

                const resultadoPrecio =
                    await pool.query(
                        `
                            SELECT
                                pp.id_precio,
                                pp.id_producto,
                                pp.id_unidad,
                                pp.precio_venta,

                                u.cantidad
                                    AS cantidad_referencial

                            FROM Precios_productos pp

                            INNER JOIN Unidades u
                                ON u.id_unidad =
                                   pp.id_unidad

                            WHERE
                                pp.id_precio = ?

                                AND
                                pp.id_producto = ?

                                AND
                                pp.precio_venta > 0

                            LIMIT 1
                        `,
                        [
                            precios[i],
                            productos[i]
                        ]
                    );


                if (
                    resultadoPrecio.length === 0
                ) {

                    req.flash(
                        'message',
                        'Uno de los precios seleccionados ya no es válido.'
                    );


                    return res.redirect(
                        '/ventas/add'
                    );

                }


                const datos =
                    resultadoPrecio[0];


                const cantidad =
                    Number(
                        cantidades[i]
                    );


                const precio =
                    Number(
                        datos.precio_venta
                    );


                const factor =
                    Number(
                        datos.cantidad_referencial
                    );


                const unidadesInventario =
                    cantidad *
                    factor;


                const subtotal =
                    precio *
                    cantidad;


                montoTotal +=
                    subtotal;


                const idProducto =
                    Number(
                        productos[i]
                    );


                lineas.push({

                    idProducto,

                    idUnidad:
                        Number(
                            datos.id_unidad
                        ),

                    cantidad,

                    precio,

                    subtotal,

                    unidadesInventario

                });


                requeridoPorProducto.set(

                    idProducto,

                    (
                        requeridoPorProducto
                            .get(idProducto) || 0
                    ) +
                    unidadesInventario

                );

            }


            /* =========================================
               TRANSACCIÓN
            ========================================= */

            connection =
                await obtenerConexion();


            await iniciarTransaccion(
                connection
            );


            /*
             * Bloqueamos los lotes antes
             * de confirmar disponibilidad.
             */
            for (
                const [
                    idProducto,
                    requerido
                ]
                of requeridoPorProducto
            ) {

                const lotes =
                    await consultar(
                        connection,
                        `
                            SELECT
                                id_fechavencimiento,
                                inventario

                            FROM Fechas_vencimiento

                            WHERE
                                id_producto = ?

                                AND
                                inventario > 0

                            FOR UPDATE
                        `,
                        [idProducto]
                    );


                const disponible =
                    lotes.reduce(
                        (total, lote) =>
                            total +
                            Number(
                                lote.inventario
                            ),
                        0
                    );


                if (
                    disponible <
                    requerido
                ) {

                    throw new Error(
                        'STOCK_INSUFICIENTE'
                    );

                }

            }


            const resultadoVenta =
                await consultar(
                    connection,
                    `
                        INSERT INTO Ventas
                        (
                            fecha_venta,
                            monto_total
                        )

                        VALUES
                        (
                            CONVERT_TZ(
                                UTC_TIMESTAMP(),
                                '+00:00',
                                '-05:00'
                            ),
                            ?
                        )
                    `,
                    [montoTotal]
                );


            const idVenta =
                resultadoVenta.insertId;


            /* =========================================
               DETALLE + INVENTARIO
            ========================================= */

            for (
                const linea
                of lineas
            ) {

                await consultar(
                    connection,
                    `
                        INSERT INTO Detalle_venta
                        (
                            id_producto,
                            id_unidad,
                            id_venta,
                            cantidad_producto,
                            precio_parcial
                        )

                        VALUES (?, ?, ?, ?, ?)
                    `,
                    [
                        linea.idProducto,
                        linea.idUnidad,
                        idVenta,
                        linea.cantidad,
                        linea.subtotal
                    ]
                );


                let restante =
                    linea.unidadesInventario;


                /*
                 * FEFO:
                 * primero sale lo que vence primero.
                 * Sin fecha queda al final.
                 */
                const lotes =
                    await consultar(
                        connection,
                        `
                            SELECT
                                id_fechavencimiento,
                                inventario,
                                fecha_vencimiento

                            FROM Fechas_vencimiento

                            WHERE
                                id_producto = ?

                                AND
                                inventario > 0

                            ORDER BY

                                fecha_vencimiento
                                    IS NULL ASC,

                                fecha_vencimiento ASC,

                                id_fechavencimiento ASC

                            FOR UPDATE
                        `,
                        [linea.idProducto]
                    );


                for (
                    const lote
                    of lotes
                ) {

                    if (
                        restante <= 0
                    ) {
                        break;
                    }


                    const disponible =
                        Number(
                            lote.inventario
                        );


                    if (
                        disponible >
                        restante
                    ) {

                        await consultar(
                            connection,
                            `
                                UPDATE Fechas_vencimiento

                                SET
                                    inventario =
                                        inventario - ?

                                WHERE
                                    id_fechavencimiento = ?
                            `,
                            [
                                restante,

                                lote
                                    .id_fechavencimiento
                            ]
                        );


                        restante = 0;

                    } else {

                        restante -=
                            disponible;


                        await consultar(
                            connection,
                            `
                                DELETE FROM Notificaciones

                                WHERE
                                    id_fecha_vencimiento = ?
                            `,
                            [
                                lote
                                    .id_fechavencimiento
                            ]
                        );


                        await consultar(
                            connection,
                            `
                                DELETE FROM Fechas_vencimiento

                                WHERE
                                    id_fechavencimiento = ?
                            `,
                            [
                                lote
                                    .id_fechavencimiento
                            ]
                        );

                    }

                }

            }


            const productosActualizados =
                [
                    ...new Set(
                        lineas.map(
                            linea =>
                                linea.idProducto
                        )
                    )
                ];


            for (
                const idProducto
                of productosActualizados
            ) {

                await actualizarEstadoProducto(
                    idProducto,
                    connection
                );

            }


            await confirmarTransaccion(
                connection
            );


            req.flash(
                'success',
                'Venta registrada correctamente.'
            );


            return res.redirect(
                '/ventas'
            );


        } catch (error) {

            if (connection) {

                await cancelarTransaccion(
                    connection
                );

            }


            if (
                error.message ===
                'STOCK_INSUFICIENTE'
            ) {

                req.flash(
                    'message',
                    'No hay disponibilidad suficiente de uno de los productos.'
                );

            } else {

                console.error(
                    'Error registrando venta:',
                    error
                );


                req.flash(
                    'message',
                    'No se pudo registrar la venta.'
                );

            }


            return res.redirect(
                '/ventas/add'
            );


        } finally {

            if (connection) {

                connection.release();

            }

        }

    }
);


/* =========================================================
   COTIZACIÓN
========================================================= */

router.post(
    '/cotizacion',
    isLoggedIn,
    async (req, res) => {

        try {

            const productos =
                normalizarArray(
                    req.body.productos
                );


            const precios =
                normalizarArray(
                    req.body.precios
                );


            const cantidades =
                normalizarArray(
                    req.body.cantidades
                );


            if (
                productos.length === 0 ||

                productos.length !==
                    precios.length ||

                productos.length !==
                    cantidades.length
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            'Datos incompletos.'
                    });

            }


            const items = [];

            let total = 0;


            for (
                let i = 0;
                i < productos.length;
                i++
            ) {

                const cantidad =
                    Number(
                        cantidades[i]
                    );


                if (
                    !Number.isInteger(cantidad) ||
                    cantidad <= 0
                ) {

                    return res
                        .status(400)
                        .json({
                            error:
                                'Existe una cantidad inválida.'
                        });

                }


                const resultado =
                    await pool.query(
                        `
                            SELECT
                                p.nombre_producto,

                                u.nombre
                                    AS nombre_unidad,

                                pp.precio_venta

                            FROM Precios_productos pp

                            INNER JOIN Productos p
                                ON p.id_producto =
                                   pp.id_producto

                            INNER JOIN Unidades u
                                ON u.id_unidad =
                                   pp.id_unidad

                            WHERE
                                pp.id_precio = ?

                                AND
                                pp.id_producto = ?

                            LIMIT 1
                        `,
                        [
                            precios[i],
                            productos[i]
                        ]
                    );


                if (
                    resultado.length === 0
                ) {

                    return res
                        .status(400)
                        .json({
                            error:
                                'Uno de los productos ya no existe.'
                        });

                }


                const precio =
                    Number(
                        resultado[0]
                            .precio_venta
                    );


                const subtotal =
                    precio *
                    cantidad;


                total += subtotal;


                items.push({

                    nombre:
                        resultado[0]
                            .nombre_producto,

                    unidad:
                        resultado[0]
                            .nombre_unidad,

                    cantidad,

                    precio,

                    subtotal

                });

            }


            res.setHeader(
                'Content-Type',
                'application/pdf'
            );


            res.setHeader(
                'Content-Disposition',
                'inline; filename="cotizacion.pdf"'
            );


            const doc =
                new PDFDocument({
                    margin: 40
                });


            doc.pipe(res);


            const fecha =
                new Intl.DateTimeFormat(
                    'es-PE',
                    {
                        timeZone:
                            'America/Lima',

                        dateStyle:
                            'short',

                        timeStyle:
                            'medium'
                    }
                ).format(
                    new Date()
                );


            doc
                .fontSize(10)
                .text(
                    fecha,
                    {
                        align: 'right'
                    }
                );


            doc
                .fontSize(24)
                .text(
                    "Bodega Link'S",
                    {
                        align: 'center'
                    }
                );


            doc
                .fontSize(15)
                .text(
                    'Cotización',
                    {
                        align: 'center'
                    }
                );


            doc.moveDown();


            items.forEach(
                item => {

                    doc
                        .fontSize(11)
                        .text(
                            item.nombre
                        );


                    doc
                        .fontSize(10)
                        .text(
                            `${item.cantidad} × ${item.unidad} · ` +
                            `S/. ${item.precio.toFixed(2)} · ` +
                            `Subtotal S/. ${item.subtotal.toFixed(2)}`
                        );


                    doc.moveDown(
                        0.5
                    );

                }
            );


            doc.moveDown();


            doc
                .fontSize(15)
                .text(
                    `TOTAL: S/. ${total.toFixed(2)}`,
                    {
                        align: 'right'
                    }
                );


            doc.end();


        } catch (error) {

            console.error(
                'Error generando cotización:',
                error
            );


            if (!res.headersSent) {

                return res
                    .status(500)
                    .json({
                        error:
                            'No se pudo generar la cotización.'
                    });

            }

        }

    }
);


/* =========================================================
   DETALLE
========================================================= */

router.get(
    '/detalle/:id',
    isLoggedIn,
    async (req, res) => {

        try {

            const {
                id
            } = req.params;


            const ventas =
                await pool.query(
                    `
                        SELECT
                            v.*,

                            DATE_FORMAT(
                                v.fecha_venta,
                                '%d/%m/%Y'
                            ) AS fecha_mostrar,

                            DATE_FORMAT(
                                v.fecha_venta,
                                '%H:%i:%s'
                            ) AS hora_mostrar

                        FROM Ventas v

                        WHERE
                            v.id_venta = ?

                        LIMIT 1
                    `,
                    [id]
                );


            if (
                ventas.length === 0
            ) {

                req.flash(
                    'message',
                    'La venta no existe.'
                );


                return res.redirect(
                    '/ventas'
                );

            }


            const detalles =
                await pool.query(
                    `
                        SELECT
                            dv.*,

                            p.nombre_producto,

                            u.nombre
                                AS nombre_unidad,

                            u.cantidad
                                AS cantidad_unidad

                        FROM Detalle_venta dv

                        INNER JOIN Productos p
                            ON p.id_producto =
                               dv.id_producto

                        INNER JOIN Unidades u
                            ON u.id_unidad =
                               dv.id_unidad

                        WHERE
                            dv.id_venta = ?

                        ORDER BY
                            p.nombre_producto ASC
                    `,
                    [id]
                );


            detalles.forEach(
                detalle => {

                    detalle.precio_parcial =
                        Number(
                            detalle.precio_parcial
                        ).toFixed(2);


                    detalle.precio_unitario =
                        (
                            Number(
                                detalle.precio_parcial
                            ) /
                            Number(
                                detalle.cantidad_producto
                            )
                        ).toFixed(2);

                }
            );


            const venta =
                ventas[0];


            venta.monto_total =
                Number(
                    venta.monto_total
                ).toFixed(2);


            return res.render(
                'ventas/VerDetalleVenta',
                {
                    venta,
                    detalles
                }
            );


        } catch (error) {

            console.error(
                'Error viendo venta:',
                error
            );


            req.flash(
                'message',
                'No se pudo cargar la venta.'
            );


            return res.redirect(
                '/ventas'
            );

        }

    }
);


module.exports = router;