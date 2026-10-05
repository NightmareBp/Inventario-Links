'use strict';
document.addEventListener('DOMContentLoaded',()=>{
 const form=document.querySelector('form[data-contactos]');if(!form)return;
 const base=form.dataset.contactos,search=document.getElementById('contactSearch'),hidden=document.getElementById('contactId'),list=document.getElementById('contactSuggestions');
 const scanner=document.getElementById('barcodeInput'),status=document.getElementById('scannerStatus');
 const dialog=document.getElementById('contactDialog'),contactForm=document.getElementById('contactForm');
 let timer,version=0;
 function selected(c){hidden.value=c.id;search.value=c.nombre+(c.documento?' · '+c.documento:'');list.replaceChildren();}
 search.addEventListener('input',()=>{hidden.value='';clearTimeout(timer);const current=++version;list.replaceChildren();if(search.value.trim().length<2)return;
  timer=setTimeout(async()=>{try{const rows=await G.api('/'+base+'/buscar?q='+encodeURIComponent(search.value));if(current!==version)return;
   if(!rows.length){const msg=document.createElement('div');msg.className='p-2 text-muted';msg.textContent='Sin coincidencias. Puede agregarlo o continuar sin asociarlo.';list.append(msg);}
   rows.forEach(row=>{const button=document.createElement('button');button.type='button';button.className='list-group-item list-group-item-action';button.textContent=row.nombre+(row.documento?' · '+row.documento:'');button.onclick=()=>selected(row);list.append(button);});
  }catch(e){if(current===version){list.textContent=e.message;}}},200);
 });
 document.getElementById('clearContact').onclick=()=>{version++;clearTimeout(timer);search.value='';hidden.value='';list.replaceChildren();};
 document.getElementById('newContact').onclick=()=>{version++;clearTimeout(timer);list.replaceChildren();contactForm.reset();document.getElementById('contactError').hidden=true;document.getElementById('contactTitle').textContent=base==='clientes'?'Nuevo cliente':'Nuevo proveedor';dialog.showModal();};
 document.getElementById('closeContact').onclick=()=>dialog.close();
 contactForm.onsubmit=async event=>{event.preventDefault();const button=contactForm.querySelector('[type=submit]');button.disabled=true;try{const c=await G.api('/'+base,Object.fromEntries(new FormData(contactForm)));selected(c);dialog.close();}catch(e){const error=document.getElementById('contactError');error.textContent=e.message;error.hidden=false;}finally{button.disabled=false;}};
 function focusScanner(){if(!dialog.open&&!document.querySelector('.modal.show'))scanner.focus({preventScroll:true});}
 document.getElementById('activateScanner').onclick=focusScanner;
 form.addEventListener('change',event=>{if(event.target.matches('.precio-select') && event.target.value)focusScanner();});
 function scannerState(){status.replaceChildren();const label=document.createElement('span');label.textContent=document.activeElement===scanner?'Lector listo · Escanee un producto':'Edición manual · Puede activar el lector';status.append(label);}
 document.addEventListener('focusin',scannerState);scannerState();
 form.addEventListener('focusout',event=>{if(event.target.matches('.cantidad-input,.precio-select,input[type=date]'))setTimeout(()=>{const active=document.activeElement;if(active===document.body||active===event.target)focusScanner();},0);});
 form.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('.cantidad-input,.precio-select,input[type=date]')){event.preventDefault();focusScanner();}});
 // Lectores HID con sufijo Enter: reconocer ráfagas fuera del campo del lector.
 // No se procesa dentro de diálogos ni se captura escritura humana lenta.
 let sequence='',last=0,target=null,original='';
 document.addEventListener('keydown',event=>{
  if(event.target===scanner||dialog.open||document.querySelector('.modal.show')||event.ctrlKey||event.altKey||event.metaKey)return;
  const now=performance.now();
  if(event.key==='Enter'){
   if(sequence.length>=6 && now-last<80){event.preventDefault();event.stopImmediatePropagation();if(target&&'value' in target){target.value=original;target.dispatchEvent(new Event('input',{bubbles:true}));}document.dispatchEvent(new CustomEvent('inventario-scan',{detail:sequence}));}
   sequence='';return;
  }
  if(event.key.length!==1){sequence='';return;}
  if(now-last>45||event.target!==target){sequence='';target=event.target;original='value' in target?target.value:'';}
  sequence+=event.key;last=now;
 },true);
 const summary=document.querySelector('.transaction-summary');
 const count=document.createElement('small');count.className='text-muted';summary.append(count);
 const updateCount=()=>{count.textContent=form.querySelectorAll('.product-line').length+' líneas de productos';};
 new MutationObserver(updateCount).observe(document.getElementById('productosContainer'),{childList:true});updateCount();
 const reserve=()=>{form.style.paddingBottom=(summary.getBoundingClientRect().height+35)+'px';};
 new ResizeObserver(reserve).observe(summary);reserve();
 let submitting=false;
 form.addEventListener('submit',event=>{
  if(event.defaultPrevented)return;
  if(submitting){event.preventDefault();return;}
  if(search.value.trim()&&!hidden.value){event.preventDefault();alert('Seleccione una sugerencia, registre el contacto o use “Quitar” para continuar sin asociarlo.');return;}
  submitting=true;form.querySelectorAll('button[type=submit]').forEach(b=>b.disabled=true);
 });
});
