const PORT = process.env.PORT || 4000
const DB_HOST_PORT = process.env.DB_HOST_PORT || `https://mikeila-157aedd37fe9.herokuapp.com`;
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || 'BaseDatos45';
const DB_NAME = process.env.DB_NAME || 'bodega';
const DB_PORT = process.env.DB_PORT || 3306;

module.exports = {
    PORT: PORT,
    DB_HOST: DB_HOST,
    DB_USER: DB_USER,
    DB_PASSWORD: DB_PASSWORD,
    DB_NAME: DB_NAME,
    DB_PORT: DB_PORT,
    DB_HOST_PORT: DB_HOST_PORT
};