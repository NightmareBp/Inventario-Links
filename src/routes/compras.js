const express = require('express');
const router = express.Router();

const pool = require('../database');
const stock = require('../lib/stock');
const { randomUUID } = require('crypto');
const { period } = require('../lib/gestion');

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

router.get('/', isLoggedInAdmin, async (req,res) => {
    try {
        const fechas=period(req.query,false);
        const where=[],params=[];
        if(fechas.desde) {where.push('fecha_compra>=?');params.push(fechas.desde);}
        if(fechas.hasta) {where.push('fecha_compra<DATE_ADD(?,INTERVAL 1 DAY)');params.push(fechas.hasta);}
        if(req.query.usuario) {where.push('id_usuario=?');params.push(req.query.usuario);}
        const condicion=where.length?'WHERE '+where.join(' AND '):'';
        const orden=req.query.orden==='asc'?'asc':'desc';
        const registros=await pool.query(`SELECT *,DATE_FORMAT(fecha_compra,'%d/%m/%Y') fecha_mostrar,
          DATE_FORMAT(fecha_compra,'%H:%i:%s') hora_mostrar FROM Compras ${condicion} ORDER BY fecha_compra ${orden},id_compra ${orden}`,params);
        const total=registros.reduce((sum,row)=>sum.plus(row.monto_total),stock.D(0));
        registros.forEach(row=>row.monto_total=stock.D(row.monto_total).toFixed(2));
        const usuarios=await pool.query('SELECT id_usuario,nombre FROM usuarios ORDER BY nombre');
        usuarios.forEach(u=>u.selected=String(u.id_usuario)===String(req.query.usuario));
        return res.render('compras/listC',{compras:registros,q:fechas.desde,q1:fechas.hasta,orden,usuarios,montototall:total.toFixed(2)});
    } catch(e) {req.flash('message',e.code?'No se pudo cargar el listado.':e.message);return res.redirect('/');}
});


/* =========================================================
   FORMULARIO
========================================================= */

router.get(
    '/add',
    isLoggedInAdmin,
    async (req, res) => {

        return res.render(
            'compras/addCompra', { token_operacion: randomUUID() }
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

router.post('/add', isLoggedInAdmin, async (req,res) => {
    try {
        const id = await stock.register('compra', req.body, req.user);
        req.flash('success', 'Compra registrada correctamente.');
        return res.redirect('/compras/detalle/' + id);
    } catch(error) {
        console.error('Error registrando compra:',error);
        req.flash('message', error.code ? 'No se pudo guardar. Revise los datos e intente nuevamente.' : error.message);
        return res.redirect('/compras/add');
    }
});


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

                            COALESCE(dc.nombre_producto_historico,p.nombre_producto) AS nombre_producto,
 COALESCE(dc.nombre_unidad_historico,u.nombre) AS nombre_unidad,
 COALESCE(dc.factor_unidad,u.cantidad) AS cantidad_unidad

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