'use strict';
const {validDate,today} = require('./stock');
function period(q, defaults=true) {
    const now=today();
    let desde=q.desde||q.q||'',hasta=q.hasta||q.q1||'';
    if(q.periodo==='mes_anterior') {
        const d=new Date(now+'T12:00:00Z');d.setUTCDate(0);
        hasta=d.toISOString().slice(0,10);desde=hasta.slice(0,7)+'-01';
    } else if(q.periodo==='mes' || (defaults && !desde && !hasta)) {desde=now.slice(0,7)+'-01';hasta=now;}
    validDate(desde);validDate(hasta);
    if(desde && hasta && desde>hasta) throw new Error('La fecha inicial no puede ser posterior a la final.');
    return {desde,hasta};
}
const safe = handler => async(req,res,next) => {try {await handler(req,res,next);}catch(e){console.error(e);res.status(e.status||400).json({error:e.code?'No se pudo completar la operación. Revise los datos.':e.message});}};
module.exports={period,safe};
