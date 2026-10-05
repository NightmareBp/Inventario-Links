'use strict';
window.G={
 esc:v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
 money:v=>v==null?'Pendiente':new Intl.NumberFormat('es-PE',{style:'currency',currency:'PEN'}).format(Number(v)),
 num:v=>new Intl.NumberFormat('es-PE',{maximumFractionDigits:3}).format(Number(v||0)),
 async api(url,body){const r=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});let data;try{data=await r.json();}catch(_){throw new Error('La sesión puede haber vencido. Recargue la página.');}if(!r.ok)throw new Error(data.error||'No se pudo completar la operación.');return data;},
 error:e=>{const box=document.getElementById('gestionError');if(box){box.textContent=e.message;box.hidden=false;}else alert(e.message);},
 clear:()=>{const b=document.getElementById('gestionError');if(b)b.hidden=true;}
};
