const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const pool = require('../database');
const helpers = require('../lib/helpers');

passport.use('local.signin', new LocalStrategy({
    usernameField: 'usuario',
    passwordField: 'contra',
    passReqToCallback: true
}, async (req, usuario, contra, done) => {
    const rows = await pool.query('SELECT * FROM usuarios WHERE usuario = ?', [usuario]);
    if (rows.length > 0) {
        const user = rows[0];
        const validPassword = await helpers.matchPassword(contra, user.contra);
        if (validPassword) {
            user.id = user.id_usuario;
            done(null, user, req, req.flash('success', 'Bienvenido ' + user.usuario));
        } else {
            done(null, false, req.flash('message', 'Contraseña Incorrecta'));
        }
    } else {
        return done(null, false, req.flash('message', 'El usuario no existe'));
    }
}))

passport.use('local.signup', new LocalStrategy({
    usernameField: 'usuario',
    passwordField: 'contra',
    passReqToCallback: true
}, async (req, usuario, contra, done) => {
    const { nombre, tipo } = req.body;
    const newUser = {
        nombre: nombre,
        usuario: usuario,
        contra: contra,
        tipo: tipo,
    };

    const existingUserByName = await pool.query('SELECT * FROM usuarios WHERE nombre = ?', [nombre]);
    if (existingUserByName.length > 0) {
        return done(null, false, req.flash('message', 'El nombre ya está asociado a una cuenta'));
    }

    const existingUserByUsuario = await pool.query('SELECT * FROM usuarios WHERE usuario = ?', [usuario]); // Corregido aquí
    if (existingUserByUsuario.length > 0) {
        return done(null, false, req.flash('message', 'El usuario ya está asociado a una cuenta.'));
    }

    newUser.contra = await helpers.encryptPassword(newUser.contra);
    const result = await pool.query('INSERT INTO usuarios SET ?', [newUser]);
    newUser.id = result.insertId;
    return done(null, newUser);
}));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const rows = await pool.query('SELECT * FROM usuarios WHERE id_usuario = ?', [id]);
        if (rows.length > 0) {
            done(null, rows[0]);
        } else {
            done(new Error('Usuario no encontrado'));
        }
    } catch (err) {
        done(err);
    }
});