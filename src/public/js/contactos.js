'use strict';
(()=>{
 const page=document.getElementById('contactPage'),base=page.dataset.base,admin=page.dataset.admin==='true';
 const dialog=document.getElementById('contactDialog'),form=document.getElementById('contactForm'),filter=document.getElementById('filterContacts');
 let current=1,editing=null,rows=[],selected=null,historyPage=1,version=0;
 function open(row){editing=row;form.reset();document.getElementById('contactError').hidden=true;document.getElementById('activeLabel').hidden=!row;document.getElementById('contactTitle').textContent=row?'Editar registro':'Nuevo registro';if(row){for(const [key,val] of Object.entries(row)){const input=form.elements.namedItem(key);if(input){if(key==='activo')input.checked=!!val;else input.value=val||'';}}}dialog.showModal();}
 document.getElementById('createContact').onclick=()=>open(null);document.getElementById('closeContact').onclick=()=>dialog.close();
 async function load(){const request=++version;try{const d=await G.api(`/${base}/datos?q=${encodeURIComponent(filter.value)}&page=${current}`);if(request!==version)return;rows=d.rows;
 document.getElementById('contactsRows').innerHTML=rows.map((r,i)=>`<tr><td>${G.esc(r.nombre)}</td><td>${G.esc(r.tipo_documento||'')} ${G.esc(r.documento||'—')}</td><td>${G.esc(r.telefono||'—')}</td><td>${r.activo?'Activo':'Inactivo'}</td><td><button class="btn btn-sm btn-outline-primary" data-history="${i}">Historial</button> ${admin?`<button class="btn btn-sm btn-outline-secondary" data-edit="${i}">Editar / desactivar</button>`:''}</td></tr>`).join('');
 document.getElementById('contactPageInfo').textContent=`Página ${current} · ${d.total} registros`;document.getElementById('prevContacts').disabled=current<=1;document.getElementById('nextContacts').disabled=current*30>=d.total;
 }catch(e){G.error(e);}}
 let timer;filter.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{current=1;load();},200);};
 document.getElementById('prevContacts').onclick=()=>{current--;load();};document.getElementById('nextContacts').onclick=()=>{current++;load();};
 document.getElementById('contactsRows').onclick=e=>{const edit=e.target.closest('[data-edit]'),history=e.target.closest('[data-history]');if(edit)open(rows[edit.dataset.edit]);if(history){selected=rows[history.dataset.history];historyPage=1;document.getElementById('historyFilters').reset();loadHistory();}};
 form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;try{const body=Object.fromEntries(new FormData(form));body.activo=form.elements.activo.checked;await G.api(`/${base}${editing?'/'+editing.id+'/editar':''}`,body);dialog.close();await load();}catch(e){const el=document.getElementById('contactError');el.textContent=e.message;el.hidden=false;}finally{button.disabled=false;}};
 async function loadHistory(extra=''){try{const params=new URLSearchParams(new FormData(document.getElementById('historyFilters')));params.set('page',historyPage);if(extra)params.set('periodo',extra);const d=await G.api(`/${base}/${selected.id}/historial?${params}`);
 document.getElementById('historySection').hidden=false;document.getElementById('historyTitle').textContent='Historial: '+selected.nombre;
 const f=document.getElementById('historyFilters');f.elements.desde.value=d.desde;f.elements.hasta.value=d.hasta;
 document.getElementById('historyTotal').textContent=`${d.operaciones} operaciones · ${G.money(d.total)}`;
 document.getElementById('historyRows').innerHTML=d.rows.map(r=>`<tr><td><a href="${d.base}/detalle/${Number(r.id)}">#${Number(r.id)}</a></td><td>${G.esc(r.fecha)}</td><td>${G.money(r.monto_total)}</td><td>${G.esc(r.usuario_nombre||'No registrado')}</td></tr>`).join('');
 document.getElementById('historyPageInfo').textContent='Página '+historyPage;document.getElementById('prevHistory').disabled=historyPage<=1;document.getElementById('nextHistory').disabled=historyPage*50>=d.operaciones;
 }catch(e){G.error(e);}}
 document.getElementById('historyFilters').onsubmit=e=>{e.preventDefault();historyPage=1;loadHistory();};document.getElementById('lastMonth').onclick=()=>{historyPage=1;loadHistory('mes_anterior');};document.getElementById('prevHistory').onclick=()=>{historyPage--;loadHistory();};document.getElementById('nextHistory').onclick=()=>{historyPage++;loadHistory();};load();
})();
