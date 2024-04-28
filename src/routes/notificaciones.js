const express = require('express');
const router = express.Router();
const pool = require('../database');
const { isLoggedIn } = require('../lib/auth');

router.get('/', isLoggedIn, async (req, res) => {
    usuario = req.user;
    const notis = await pool.query('SELECT * FROM Notificaciones WHERE id_usuario = ? AND estado != 3 ORDER BY fecha_noti DESC, id_notificacion DESC', [usuario.id_usuario]);
    var fechaBaseDatos;
    const opcionesFormato = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const opcionesFormato1 = { year: 'numeric', month: 'numeric', day: 'numeric' };
    notis.forEach(async (element) => {
        if (element.fecha_vencimiento !== null) {
            fechaBaseDatos = new Date(element.fecha_vencimiento);
            element.fecha_vencimiento = fechaBaseDatos.toLocaleDateString('es-ES', opcionesFormato);
        }
        if (element.fecha_noti !== null) {
            fechaBaseDatos = new Date(element.fecha_noti);
            element.fecha_noti = fechaBaseDatos.toLocaleDateString('es-ES', opcionesFormato1);
        }
        const datosproducto = await pool.query('Select * from Productos where id_producto = ?', [element.id_producto]);
        element.nombre = datosproducto[0].nombre_producto;
    });
    res.render('notificaciones/notificaciones', { notis });
});

router.post('/actualizar_estado_notificacion', isLoggedIn, async (req, res) => {
    const idNotificacion = req.body.idNotificacion;

    // Realiza la actualización del estado de la notificación en la base de datos
    await pool.query('UPDATE Notificaciones SET estado = 2 WHERE id_notificacion = ?', [idNotificacion]);

    res.status(200).send('Estado de la notificación actualizado correctamente.');
});

router.get('/eliminarnoti/:id', isLoggedIn, async (req, res) => {
    const { id } = req.params;
    await pool.query('UPDATE Notificaciones SET estado = 3 WHERE Notificaciones.id_notificacion = ?', [id]);
    req.flash('noti', 'Notificación Eliminada Correctamente');
    res.redirect('/notificaciones');
});

router.get('/notificationCount', async (req, res) => {
    usuario = req.user;
    try {
        const count = await pool.query('SELECT COUNT(*) AS count FROM Notificaciones WHERE estado = 1 and id_usuario = ?', [usuario.id_usuario]);
        const cuenta = count[0].count;
        const fechaHace15Dias = new Date();
        fechaHace15Dias.setDate(fechaHace15Dias.getDate() - 15);

        // Eliminar las notificaciones con fecha_noti hace 15 días o más
        await pool.query('DELETE FROM Notificaciones WHERE fecha_noti <= ?', [fechaHace15Dias]);
        res.json({ cuenta });
    } catch (error) {
        console.error('Error al obtener el número de notificaciones:', error);
        res.status(500).json({ error: 'Error al obtener el número de notificaciones' });
    }
});

module.exports = router;