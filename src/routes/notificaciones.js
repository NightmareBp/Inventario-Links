const express = require('express');
const router = express.Router();

const pool = require('../database');

const {
    isLoggedIn
} = require('../lib/auth');


/* =========================================================
   CONFIGURACIÓN
========================================================= */

const NOTIFICACIONES_POR_PAGINA = 12;


/* =========================================================
   UTILIDADES
========================================================= */

function prepararNotificacion(notificacion) {

    const existencias =
        notificacion.existencias === null
            ? null
            : Number(notificacion.existencias);


    return {

        ...notificacion,

        noLeida:
            Number(notificacion.estado) === 1,

        tipoBajoStock:
            existencias === 2,

        tipoAgotado:
            existencias === 3,

        tipoVencimiento:
            existencias === null &&
            Boolean(
                notificacion.fecha_vencimiento_mostrar
            ),

        tipoInformacion:
            existencias === null &&
            !notificacion.fecha_vencimiento_mostrar

    };

}


/* =========================================================
   LISTAR NOTIFICACIONES
========================================================= */

router.get(
    '/',
    isLoggedIn,
    async (req, res) => {

        try {

            const idUsuario =
                req.user.id_usuario;


            /*
             * Conservamos el comportamiento del
             * aplicativo de retirar notificaciones
             * antiguas después de 15 días.
             */
            await pool.query(`
                DELETE FROM Notificaciones

                WHERE
                    id_usuario = ?

                    AND
                    fecha_noti IS NOT NULL

                    AND
                    fecha_noti <
                    DATE_SUB(
                        CURDATE(),
                        INTERVAL 15 DAY
                    )
            `, [
                idUsuario
            ]);


            /* =============================================
               PAGINACIÓN
            ============================================= */

            let pagina =
                Number.parseInt(
                    req.query.page,
                    10
                ) || 1;


            pagina =
                Math.max(
                    pagina,
                    1
                );


            const totalResultado =
                await pool.query(`
                    SELECT
                        COUNT(*) AS total

                    FROM Notificaciones

                    WHERE
                        id_usuario = ?

                        AND
                        estado != 3
                `, [
                    idUsuario
                ]);


            const total =
                Number(
                    totalResultado[0].total
                ) || 0;


            const totalPaginas =
                Math.max(
                    1,
                    Math.ceil(
                        total /
                        NOTIFICACIONES_POR_PAGINA
                    )
                );


            if (
                pagina >
                totalPaginas
            ) {

                pagina =
                    totalPaginas;

            }


            const offset =
                (
                    pagina - 1
                ) *
                NOTIFICACIONES_POR_PAGINA;



            /* =============================================
               NOTIFICACIONES DE LA PÁGINA
            ============================================= */

            const resultado =
                await pool.query(`
                    SELECT
                        n.id_notificacion,
                        n.contenido,
                        n.estado,
                        n.id_producto,
                        n.id_fecha_vencimiento,
                        n.existencias,

                        p.nombre_producto
                            AS nombre,


                        CASE

                            WHEN
                                n.fecha_noti IS NULL

                            THEN
                                ''

                            ELSE
                                DATE_FORMAT(
                                    n.fecha_noti,
                                    '%d/%m/%Y'
                                )

                        END
                            AS fecha_noti_mostrar,


                        CASE

                            WHEN
                                n.fecha_vencimiento
                                IS NULL

                            THEN
                                ''

                            ELSE
                                DATE_FORMAT(
                                    n.fecha_vencimiento,
                                    '%d/%m/%Y'
                                )

                        END
                            AS fecha_vencimiento_mostrar


                    FROM Notificaciones n

                    LEFT JOIN Productos p
                        ON p.id_producto =
                           n.id_producto


                    WHERE
                        n.id_usuario = ?

                        AND
                        n.estado != 3


                    ORDER BY
                        n.fecha_noti DESC,
                        n.id_notificacion DESC


                    LIMIT ?
                    OFFSET ?
                `, [
                    idUsuario,
                    NOTIFICACIONES_POR_PAGINA,
                    offset
                ]);


            const notis =
                resultado.map(
                    prepararNotificacion
                );



            /* =============================================
               TOTAL DE NO LEÍDAS
            ============================================= */

            const noLeidasResultado =
                await pool.query(`
                    SELECT
                        COUNT(*) AS total

                    FROM Notificaciones

                    WHERE
                        id_usuario = ?

                        AND
                        estado = 1
                `, [
                    idUsuario
                ]);


            const noLeidas =
                Number(
                    noLeidasResultado[0].total
                ) || 0;



            /* =============================================
               BOTONES DE PAGINACIÓN
            ============================================= */

            const paginas = [];


            const inicioPaginas =
                Math.max(
                    1,
                    pagina - 2
                );


            const finPaginas =
                Math.min(
                    totalPaginas,
                    pagina + 2
                );


            for (
                let numero = inicioPaginas;
                numero <= finPaginas;
                numero++
            ) {

                paginas.push({

                    numero,

                    activa:
                        numero === pagina

                });

            }


            const desde =
                total === 0
                    ? 0
                    : offset + 1;


            const hasta =
                Math.min(
                    offset +
                    NOTIFICACIONES_POR_PAGINA,
                    total
                );


            return res.render(
                'notificaciones/notificaciones',
                {

                    notis,

                    noLeidas,

                    hayNoLeidas:
                        noLeidas > 0,

                    paginacion: {

                        pagina,

                        total,

                        totalPaginas,

                        desde,

                        hasta,

                        anterior:
                            pagina > 1
                                ? pagina - 1
                                : null,

                        siguiente:
                            pagina < totalPaginas
                                ? pagina + 1
                                : null,

                        tieneAnterior:
                            pagina > 1,

                        tieneSiguiente:
                            pagina <
                            totalPaginas,

                        paginas

                    }

                }
            );


        } catch (error) {

            console.error(
                'Error al obtener las notificaciones:',
                error
            );


            req.flash(
                'message',
                'No se pudieron cargar las notificaciones.'
            );


            return res.redirect(
                '/'
            );

        }

    }
);


/* =========================================================
   MARCAR UNA NOTIFICACIÓN COMO LEÍDA
========================================================= */

router.post(
    '/actualizar_estado_notificacion',
    isLoggedIn,
    async (req, res) => {

        try {

            const {
                idNotificacion
            } = req.body;


            if (
                !idNotificacion
            ) {

                return res
                    .status(400)
                    .json({
                        success:
                            false,

                        error:
                            'Notificación inválida.'
                    });

            }


            /*
             * Solo actualizamos si actualmente
             * está sin leer.
             *
             * Esto permite saber si realmente
             * debemos disminuir el contador.
             */
            const resultado =
                await pool.query(`
                    UPDATE Notificaciones

                    SET
                        estado = 2

                    WHERE
                        id_notificacion = ?

                        AND
                        id_usuario = ?

                        AND
                        estado = 1
                `, [
                    idNotificacion,
                    req.user.id_usuario
                ]);


            return res.json({

                success:
                    true,

                actualizada:
                    resultado.affectedRows > 0

            });


        } catch (error) {

            console.error(
                'Error actualizando notificación:',
                error
            );


            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        'No se pudo actualizar la notificación.'

                });

        }

    }
);


/* =========================================================
   MARCAR TODAS COMO LEÍDAS
========================================================= */

router.post(
    '/marcar-todas-leidas',
    isLoggedIn,
    async (req, res) => {

        try {

            await pool.query(`
                UPDATE Notificaciones

                SET
                    estado = 2

                WHERE
                    id_usuario = ?

                    AND
                    estado = 1
            `, [
                req.user.id_usuario
            ]);


            const pagina =
                Math.max(
                    Number.parseInt(
                        req.query.page,
                        10
                    ) || 1,
                    1
                );


            req.flash(
                'success',
                'Todas las notificaciones fueron marcadas como leídas.'
            );


            return res.redirect(
                `/notificaciones?page=${pagina}`
            );


        } catch (error) {

            console.error(
                'Error marcando notificaciones:',
                error
            );


            req.flash(
                'message',
                'No se pudieron actualizar las notificaciones.'
            );


            return res.redirect(
                '/notificaciones'
            );

        }

    }
);


/* =========================================================
   ELIMINAR NOTIFICACIÓN
   ELIMINACIÓN LÓGICA
========================================================= */

router.post(
    '/eliminar/:id',
    isLoggedIn,
    async (req, res) => {

        try {

            const {
                id
            } = req.params;


            await pool.query(`
                UPDATE Notificaciones

                SET
                    estado = 3

                WHERE
                    id_notificacion = ?

                    AND
                    id_usuario = ?
            `, [
                id,
                req.user.id_usuario
            ]);


            req.flash(
                'noti',
                'Notificación eliminada correctamente.'
            );


            return res.redirect(
                '/notificaciones'
            );


        } catch (error) {

            console.error(
                'Error eliminando notificación:',
                error
            );


            req.flash(
                'message',
                'No se pudo eliminar la notificación.'
            );


            return res.redirect(
                '/notificaciones'
            );

        }

    }
);


/* =========================================================
   COMPATIBILIDAD CON LA RUTA ANTIGUA

   Puedes quitarla más adelante.
========================================================= */

router.get(
    '/eliminarnoti/:id',
    isLoggedIn,
    async (req, res) => {

        try {

            await pool.query(`
                UPDATE Notificaciones

                SET
                    estado = 3

                WHERE
                    id_notificacion = ?

                    AND
                    id_usuario = ?
            `, [
                req.params.id,
                req.user.id_usuario
            ]);


            req.flash(
                'noti',
                'Notificación eliminada correctamente.'
            );


            return res.redirect(
                '/notificaciones'
            );


        } catch (error) {

            console.error(
                'Error eliminando notificación:',
                error
            );


            return res.redirect(
                '/notificaciones'
            );

        }

    }
);


/* =========================================================
   CONTADOR DE LA CAMPANA
========================================================= */

router.get(
    '/notificationCount',
    async (req, res) => {

        /*
         * Esta ruta puede ser consultada por
         * navegaciones.hbs antes de iniciar sesión.
         */
        if (
            !req.isAuthenticated() ||
            !req.user
        ) {

            return res.json({
                cuenta:
                    0
            });

        }


        try {

            const resultado =
                await pool.query(`
                    SELECT
                        COUNT(*) AS count

                    FROM Notificaciones

                    WHERE
                        estado = 1

                        AND
                        id_usuario = ?
                `, [
                    req.user.id_usuario
                ]);


            return res.json({

                cuenta:
                    Number(
                        resultado[0].count
                    ) || 0

            });


        } catch (error) {

            console.error(
                'Error obteniendo número de notificaciones:',
                error
            );


            return res
                .status(500)
                .json({
                    cuenta:
                        0
                });

        }

    }
);


module.exports = router;