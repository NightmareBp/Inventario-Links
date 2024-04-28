const mysql = require('mysql');
const { promisify } = require('util');
const { database } = require('./keys');

const pool = mysql.createPool(database);

pool.getConnection((err, connection) => {
    if (err) {
        if (err.code === 'PROTOCOL_CONNECTION_LOST') {
            console.error('La conexión a la base de datos se cerró');
        }
        if (err.code === 'ER_CON_COUNT_ERROR') {
            console.error('La base de datos tiene demasiadas conexiones');
        }
        if (err.code === 'ECONNREFUSED') {
            console.error('Conexión a la base de datos rechazada');
        }
    }
    if (connection) {
        connection.release(); // Liberar la conexión una vez que se haya utilizado
        console.log('Base de datos conectada');
    }
    return;
});

// Promisify the pool.query method to use async/await
pool.query = promisify(pool.query);

module.exports = pool;