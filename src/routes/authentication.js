const express = require('express');
const router = express.Router();
const passport = require('passport');
const { isLoggedIn } = require('../lib/auth');
const { isNotLoggedIn } = require('../lib/auth');
const { isLoggedInAdmin } = require('../lib/auth');
const helpers = require('../lib/helpers');
const pool = require('../database');

router.get('/signup', isNotLoggedIn, async (req, res) => {
    const usuarios = await pool.query('SELECT * FROM usuarios WHERE tipo = 1;');
    if (usuarios.length > 0) {
        return res.redirect("/");
    }
    res.render('auth/signup');
});

router.post('/signup', isNotLoggedIn, passport.authenticate('local.signup', {
    successRedirect: '/',
    failureRedirect: '/signup', // Corregir el nombre de la opción
    failureFlash: true
}));

router.get('/signin', isNotLoggedIn, async (req, res) => {
    const usuarios = await pool.query('SELECT * FROM usuarios WHERE tipo = 1;');
    res.render('auth/signin', { usuarios });
});

router.post('/signin', isNotLoggedIn, (req, res, next) => {
    passport.authenticate('local.signin', {
        successRedirect: '/',
        failureRedirect: '/signin',
        failureFlash: true
    })(req, res, next);
});

router.get('/asignarUsuario', isLoggedInAdmin, async (req, res) => {
    const userId = req.user.id_usuario;
    const usuarios = await pool.query('SELECT * from usuarios where id_usuario <> ? ORDER BY nombre ASC;', [userId]);
    res.render('auth/asignarUsuario', { usuarios });
});

router.get('/usuario/add', isLoggedInAdmin, (req, res) => {
    res.render('auth/addUsuario');
});

router.post('/usuario/add', isLoggedInAdmin, async (req, res) => {
    const { nombre, tipo, usuario, contra } = req.body;
    const newUser = {
        nombre: nombre,
        usuario: usuario,
        contra: contra,
        tipo: tipo,
    };

    const existingUserByName = await pool.query('SELECT * FROM usuarios WHERE nombre = ?', [nombre]);
    if (existingUserByName.length > 0) {
        req.flash('message', 'El nombre ya está asociado a una cuenta');
        return res.redirect('/usuario/add');
    }

    const existingUserByUsuario = await pool.query('SELECT * FROM usuarios WHERE usuario = ?', [usuario]); // Corregido aquí
    if (existingUserByUsuario.length > 0) {
        req.flash('message', 'El usuario ya está asociado a una cuenta.');
        return res.redirect('/usuario/add');
    }

    newUser.contra = await helpers.encryptPassword(newUser.contra);
    const result = await pool.query('INSERT INTO usuarios SET ?', [newUser]);
    newUser.id = result.insertId;
    req.flash('success', 'Usuario Añadido Correctamente');
    res.redirect('/asignarUsuario');
});

router.get('/eliminarusuario/:id', isLoggedInAdmin, async (req, res) => {
    const { id } = req.params;
    await pool.query('DELETE FROM Notificaciones WHERE id_usuario = ?', [id]);
    await pool.query('DELETE FROM usuarios WHERE id_usuario = ?', [id]);
    req.flash('noti', 'Usuario Eliminado Correctamente');
    res.redirect('/asignarUsuario');
});

router.get('/Perfil', isLoggedIn, (req, res) => {
    res.render('Perfil');
});

router.post('/Perfil', isLoggedInAdmin, async (req, res) => {
    const { contra } = req.body;
    const userId = req.user.id_usuario;
    try {
        const rows = await pool.query('SELECT * FROM usuarios WHERE id_usuario = ?', [userId]);
        if (rows.length > 0) {
            const user = rows[0];
            const validPassword = await helpers.matchPassword(contra, user.contra);
            if (validPassword) {
                return res.render('auth/editUsuario', { user: rows[0] });
            } else {
                req.flash('message', 'Contraseña Incorrecta');
                return res.redirect('/Perfil');
            }
        } else {
            req.flash('message', 'Hubo un problema');
            return res.redirect('/Perfil');
        }
    } catch (error) {
        console.error('Error al verificar el token de recuperación:', error);
        req.flash('message', 'Hubo un error al verificar la contraseña');
        return res.redirect('/Perfil');
    }
});

router.post('/editarPerfil', isLoggedInAdmin, async (req, res) => {
    const userId = req.user.id_usuario;
    const { nombre, tipo, usuario } = req.body;
    const nuevaFila = {
        nombre: nombre,
        usuario: usuario,
        tipo: tipo,
    }
    const existingUserByName = await pool.query('SELECT * FROM usuarios WHERE nombre = ? AND id_usuario <> ?', [nombre, userId]);
    if (existingUserByName.length > 0) {
        req.flash('message', 'El nombre ya está asociado a una cuenta');
        return res.redirect('/Perfil');
    }
    const existingUserByUsuario = await pool.query('SELECT * FROM usuarios WHERE usuario = ? AND id_usuario <> ?', [usuario, userId]); // Corregido aquí
    if (existingUserByUsuario.length > 0) {
        req.flash('message', 'El usuario ya está asociado a una cuenta.');
        return res.redirect('/Perfil');
    }
    await pool.query('UPDATE usuarios set ? where id_usuario = ?', [nuevaFila, userId]);
    req.flash('success', 'Información de perfil editada correctamente');
    res.redirect('/Perfil');
});

router.post('/PerfilContra', isLoggedInAdmin, async (req, res) => {
    const { contra, contranueva } = req.body;
    const userId = req.user.id_usuario;
    var contraencriptada = await helpers.encryptPassword(contranueva);
    const nuevaFila = {
        contra: contraencriptada,
    };
    try {
        const rows = await pool.query('SELECT * FROM usuarios WHERE id_usuario = ?', [userId]);
        if (rows.length > 0) {
            const user = rows[0];
            const validPassword = await helpers.matchPassword(contra, user.contra);
            if (validPassword) {
                await pool.query('UPDATE usuarios set ? where id_usuario = ?', [nuevaFila, userId]);
                req.flash('success', 'Contraseña Actualizada');
                return res.redirect('/Perfil');
            } else {
                req.flash('message', 'Contraseña Incorrecta');
                return res.redirect('/Perfil');
            }
        } else {
            req.flash('message', 'Hubo un problema');
            return res.redirect('/Perfil');
        }
    } catch (error) {
        console.error('Error al verificar el token de recuperación:', error);
        req.flash('message', 'Hubo un error al verificar la contraseña');
        return res.redirect('/Perfil');
    }
});

router.get('/logout', isLoggedIn, (req, res, next) => {
    req.logout(function (err) {
        if (err) { return next(err); }
    });
    res.redirect('/');
});

module.exports = router;