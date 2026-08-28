const express = require('express');
const router = express.Router();

const pool = require('../database');

const {
    isLoggedInAdmin
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


function fechaActualPeru() {

    const partes =
        new Intl.DateTimeFormat(
            'en-US',
            {
                timeZone: 'America/Lima',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }
        ).formatToParts(new Date());


    const valores = {};

    partes.forEach(parte => {
        valores[parte.type] = parte.value;
    });


    return (
        `${valores.year}-` +
        `${valores.month}-` +
        `${valores.day}`
    );
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
   ACTUALIZAR ESTADO DE PRODUCTO
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


    if (resultado.length === 0) {
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


    /*
     * Eliminar notificaciones que
     * dejaron de ser válidas.
     */
    if (estado === 1) {

        await consultar(
            connection,
            `
                DELETE FROM Notificaciones
                WHERE
                    id_producto = ?
                    AND existencias IN (2, 3)
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
                    AND existencias = 3
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
                    AND existencias = 2
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
    isLoggedInAdmin,
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
                        fecha_compra >=
                            CONCAT(?, ' 00:00:00')

                        AND

                        fecha_compra <
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


            const compras =
                await pool.query(
                    `
                        SELECT
                            c.*,

                            DATE_FORMAT(
                                c.fecha_compra,
                                '%d/%m/%Y'
                            ) AS fecha_mostrar,

                            DATE_FORMAT(
                                c.fecha_compra,
                                '%H:%i:%s'
                            ) AS hora_mostrar

                        FROM Compras c

                        ${where}

                        ORDER BY
                            c.fecha_compra ${ordenSQL},
                            c.id_compra ${ordenSQL}
                    `,
                    params
                );


            compras.forEach(
                compra => {

                    compra.monto_total =
                        Number(
                            compra.monto_total
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
                                ) AS total_compras

                            FROM Compras

                            ${where}
                        `,
                        params
                    );


                montototall =
                    Number(
                        total[0].total_compras
                    ).toFixed(2);

            }


            return res.render(
                'compras/listC',
                {
                    compras,
                    q,
                    q1,
                    orden,
                    montototall
                }
            );


        } catch (error) {

            console.error(
                'Error al obtener compras:',
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
    isLoggedInAdmin,
    async (req, res) => {

        return res.render(
            'compras/addCompra'
        );

    }
);


/* =========================================================
   AUTOCOMPLETADO
========================================================= */

router.get(
    '/productos/buscar',
    isLoggedInAdmin,
    async (req, res) => {

        try {

            const termino =
                String(
                    req.query.q || ''
                ).trim();


            /*
             * No buscamos hasta que el usuario
             * escriba al menos dos caracteres.
             */
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


                            AND EXISTS (

                                SELECT 1

                                FROM Precios_productos pc

                                WHERE
                                    pc.id_producto =
                                        p.id_producto

                                    AND
                                    pc.precio_compra > 0
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
                        'Error al buscar productos'
                });

        }

    }
);


/* =========================================================
   PRECIOS DE COMPRA
========================================================= */

router.get(
    '/productos/:idProducto/preciosCompra',
    isLoggedInAdmin,
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
                            pp.precio_compra,

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
                            pp.precio_compra > 0

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
    isLoggedInAdmin,
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
                            pp.precio_compra,

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
                    producto.precio_compra
                ) <= 0
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            'Este producto no tiene precio de compra'
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
   REGISTRAR COMPRA
========================================================= */

router.post(
    '/add',
    isLoggedInAdmin,
    async (req, res) => {

        let connection = null;


        try {

            const productos =
                normalizarArray(
                    req.body.producto
                );


            const precios =
                normalizarArray(
                    req.body.preciocompra
                );


            const cantidades =
                normalizarArray(
                    req.body.cantidad
                );


            const fechas =
                normalizarArray(
                    req.body.fecha_vencimiento
                );


            if (
                productos.length === 0
            ) {

                req.flash(
                    'message',
                    'Debe agregar al menos un producto.'
                );


                return res.redirect(
                    '/compras/add'
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
                    'Los datos de la compra están incompletos.'
                );


                return res.redirect(
                    '/compras/add'
                );

            }


            const hoy =
                fechaActualPeru();


            /*
             * Validaciones básicas.
             */
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
                        '/compras/add'
                    );

                }


                const fecha =
                    fechas[i] || null;


                if (fecha) {

                    if (
                        !/^\d{4}-\d{2}-\d{2}$/
                            .test(fecha)
                    ) {

                        req.flash(
                            'message',
                            'Existe una fecha de vencimiento inválida.'
                        );


                        return res.redirect(
                            '/compras/add'
                        );

                    }


                    if (fecha < hoy) {

                        req.flash(
                            'message',
                            'La fecha de vencimiento no puede ser anterior a hoy.'
                        );


                        return res.redirect(
                            '/compras/add'
                        );

                    }

                }


                /*
                 * Debido a la PK actual de Detalle_compra,
                 * no puede repetirse el mismo
                 * producto + unidad dentro de una compra.
                 */
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
                            '/compras/add'
                        );

                    }

                }

            }


            /*
             * Validar precios directamente
             * contra la BD.
             */
            const lineas = [];

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
                                pp.precio_compra,

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
                                pp.precio_compra > 0

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
                        '/compras/add'
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
                        datos.precio_compra
                    );


                const subtotal =
                    precio *
                    cantidad;


                montoTotal +=
                    subtotal;


                lineas.push({

                    idProducto:
                        Number(
                            productos[i]
                        ),

                    idUnidad:
                        Number(
                            datos.id_unidad
                        ),

                    cantidad,

                    precio,

                    subtotal,

                    cantidadReferencial:
                        Number(
                            datos.cantidad_referencial
                        ),

                    fechaVencimiento:
                        fechas[i] || null

                });

            }


            /* =========================================
               TRANSACCIÓN
            ========================================= */

            connection =
                await obtenerConexion();


            await iniciarTransaccion(
                connection
            );


            const resultadoCompra =
                await consultar(
                    connection,
                    `
                        INSERT INTO Compras
                        (
                            fecha_compra,
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


            const idCompra =
                resultadoCompra.insertId;


            for (
                const linea
                of lineas
            ) {

                await consultar(
                    connection,
                    `
                        INSERT INTO Detalle_compra
                        (
                            id_producto,
                            id_unidad,
                            id_compra,
                            cantidad_producto,
                            precio_parcial
                        )

                        VALUES (?, ?, ?, ?, ?)
                    `,
                    [
                        linea.idProducto,
                        linea.idUnidad,
                        idCompra,
                        linea.cantidad,
                        linea.subtotal
                    ]
                );


                const cantidadInventario =
                    linea.cantidad *
                    linea.cantidadReferencial;


                /*
                 * <=> es igualdad segura con NULL.
                 */
                const lote =
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
                                fecha_vencimiento <=> ?

                            LIMIT 1

                            FOR UPDATE
                        `,
                        [
                            linea.idProducto,
                            linea.fechaVencimiento
                        ]
                    );


                if (lote.length > 0) {

                    await consultar(
                        connection,
                        `
                            UPDATE Fechas_vencimiento

                            SET
                                inventario =
                                    inventario + ?

                            WHERE
                                id_fechavencimiento = ?
                        `,
                        [
                            cantidadInventario,

                            lote[0]
                                .id_fechavencimiento
                        ]
                    );

                } else {

                    await consultar(
                        connection,
                        `
                            INSERT INTO Fechas_vencimiento
                            (
                                fecha_vencimiento,
                                inventario,
                                id_producto
                            )

                            VALUES (?, ?, ?)
                        `,
                        [
                            linea.fechaVencimiento,
                            cantidadInventario,
                            linea.idProducto
                        ]
                    );

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
                'Compra registrada correctamente.'
            );


            return res.redirect(
                '/compras'
            );


        } catch (error) {

            if (connection) {

                await cancelarTransaccion(
                    connection
                );

            }


            console.error(
                'Error registrando compra:',
                error
            );


            req.flash(
                'message',
                'No se pudo registrar la compra.'
            );


            return res.redirect(
                '/compras/add'
            );


        } finally {

            if (connection) {

                connection.release();

            }

        }

    }
);


/* =========================================================
   DETALLE
========================================================= */

router.get(
    '/detalle/:id',
    isLoggedInAdmin,
    async (req, res) => {

        try {

            const {
                id
            } = req.params;


            const compras =
                await pool.query(
                    `
                        SELECT
                            c.*,

                            DATE_FORMAT(
                                c.fecha_compra,
                                '%d/%m/%Y'
                            ) AS fecha_mostrar,

                            DATE_FORMAT(
                                c.fecha_compra,
                                '%H:%i:%s'
                            ) AS hora_mostrar

                        FROM Compras c

                        WHERE
                            c.id_compra = ?

                        LIMIT 1
                    `,
                    [id]
                );


            if (
                compras.length === 0
            ) {

                req.flash(
                    'message',
                    'La compra no existe.'
                );


                return res.redirect(
                    '/compras'
                );

            }


            const detalles =
                await pool.query(
                    `
                        SELECT
                            dc.*,

                            p.nombre_producto,

                            u.nombre
                                AS nombre_unidad,

                            u.cantidad
                                AS cantidad_unidad

                        FROM Detalle_compra dc

                        INNER JOIN Productos p
                            ON p.id_producto =
                               dc.id_producto

                        INNER JOIN Unidades u
                            ON u.id_unidad =
                               dc.id_unidad

                        WHERE
                            dc.id_compra = ?

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


            const compra =
                compras[0];


            compra.monto_total =
                Number(
                    compra.monto_total
                ).toFixed(2);


            return res.render(
                'compras/VerDetalleCompra',
                {
                    compra,
                    detalles
                }
            );


        } catch (error) {

            console.error(
                'Error viendo compra:',
                error
            );


            req.flash(
                'message',
                'No se pudo cargar la compra.'
            );


            return res.redirect(
                '/compras'
            );

        }

    }
);


module.exports = router;