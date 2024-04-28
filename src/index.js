const express = require('express');
const morgan = require('morgan');
const { engine } = require('express-handlebars');
const path = require('path');
const flash = require('connect-flash');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const { database } = require('./keys');
const passport = require('passport');
const bodyParser = require('body-parser');
const { PORT } = require('./config.js');
const helmet = require('helmet');

//Inicialización
const app = express();
require('./lib/passport');

//Configuración
/*app.set('port', process.env.PORT || 4000);*/
app.set('views', path.join(__dirname, 'views'));
app.engine('.hbs', engine({
    defaultLayout: 'main',
    layoutsDir: path.join(app.get('views'), 'layouts'),
    partialsDir: path.join(app.get('views'), 'partials'),
    extname: '.hbs',
    helpers: require('./lib/handlebars')
}));
app.set('view engine', '.hbs');

//Middlewares
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(session({
    secret: 'faztmysqlnodesession',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 3600000,
    },
    store: new MySQLStore(database)
}));
app.use(flash());
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(passport.initialize());
app.use(passport.session());
app.use(helmet());
app.use(helmet.contentSecurityPolicy({
    directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://cdn.jsdelivr.net', 'https://code.jquery.com'],
        // Agrega cualquier otro origen de scripts necesario
    },
}));
app.use(helmet.referrerPolicy());
app.use(helmet.frameguard());
app.use(helmet.hidePoweredBy());

//Variables globales
app.use((req, res, next) => {
    app.locals.success = req.flash('success',);
    app.locals.message = req.flash('message',);
    app.locals.noti = req.flash('noti',);
    app.locals.user = req.user;
    next();
});

//Rutas
app.use(require('./routes/index.js'));
app.use(require('./routes/authentication.js'));
app.use('/inventario', require('./routes/inventario.js'));
app.use('/notificaciones', require('./routes/notificaciones.js'));
app.use('/ventas', require('./routes/ventas.js'));
app.use('/compras', require('./routes/compras.js'));

//Archivos públicos
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT)
console.log('Servidor en el puerto', PORT);