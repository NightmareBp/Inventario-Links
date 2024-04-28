const { format } = require('timeago.js');
const pool = require('../database');
const helpers = {};

helpers.timeago = (timestamp) => {
    return format(timestamp);
};

helpers.ifvalue = function (conditional, options) {
    if (options.hash.value === conditional) {
        return options.fn(this);
    } else {
        return options.inverse(this);
    }
}

helpers.dividePrecioUnitario = function (precio_parcial, cantidad_insumo) {
    var precioUnitario = parseFloat(precio_parcial) / parseFloat(cantidad_insumo);
    return precioUnitario.toFixed(2);
};

module.exports = helpers;