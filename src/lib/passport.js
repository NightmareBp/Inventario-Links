const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const pool = require('../database');
const helpers = require('../lib/helpers');

passport.use('local.signin', new LocalStrategy({
    usernameField: 'usuario',
    passwordField: 'contra'
}, async (usuario, contra, done) => {

    try {

        const rows = await pool.query(
            'SELECT * FROM usuarios WHERE usuario = ?',
            [usuario]
        );

        if (rows.length === 0) {
            return done(null, false, {
                message: 'El usuario no existe'
            });
        }

        const user = rows[0];

        const validPassword = await helpers.matchPassword(
            contra,
            user.contra
        );

        if (!validPassword) {
            return done(null, false, {
                message: 'Contraseña incorrecta'
            });
        }

        return done(null, user);

    } catch (error) {

        console.error('Error al iniciar sesión:', error);

        return done(error);
    }

}));

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
    done(null, user.id_usuario);
});

passport.deserializeUser(async (id, done) => {

    try {

        const rows = await pool.query(
            'SELECT * FROM usuarios WHERE id_usuario = ?',
            [id]
        );

        if (rows.length > 0) {
            return done(null, rows[0]);
        }

        return done(null, false);

    } catch (error) {
        return done(error);
    }

});