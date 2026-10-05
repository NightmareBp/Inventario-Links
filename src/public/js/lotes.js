'use strict';
(()=>{
    const root=document.getElementById('lotsPage'),form=document.getElementById('lotDateForm');
    const editor=document.getElementById('lotEditor'),success=document.getElementById('lotsSuccess');
    let rows=[],selected=null,busy=false;
    async function load(){
        const data=await G.api(`/inventario/lotes/${root.dataset.product}/datos`);rows=data.rows;
        document.getElementById('lotsRows').innerHTML=rows.map(r=>`<tr><td>#${r.id}</td><td>${G.num(r.inventario)}</td><td>${G.esc(r.fecha||'Sin fecha')}</td><td><button type="button" class="btn btn-sm btn-outline-primary" data-edit-lot="${r.id}">Corregir fecha</button></td></tr>`).join('')||'<tr><td colspan="4">Sin lotes registrados.</td></tr>';
        document.getElementById('lotHistory').innerHTML=data.history.map(r=>`<tr><td>${G.esc(r.fecha)}<br>Lote #${r.lote}</td><td>${G.esc(r.usuario_nombre)}</td><td>${G.esc(r.observacion)}</td></tr>`).join('')||'<tr><td colspan="3">Sin correcciones registradas.</td></tr>';
    }
    document.getElementById('lotsRows').addEventListener('click',e=>{
        const button=e.target.closest('[data-edit-lot]');if(!button||busy)return;
        selected=rows.find(r=>String(r.id)===button.dataset.editLot);if(!selected)return;
        G.clear();success.hidden=true;form.reset();form.elements.fecha.value=selected.fecha||'';
        document.getElementById('lotEditorTitle').textContent=`Corregir vencimiento · lote #${selected.id} · actual: ${selected.fecha||'Sin fecha'}`;
        editor.hidden=false;editor.scrollIntoView({behavior:'smooth',block:'center'});form.elements.fecha.focus();
    });
    document.getElementById('cancelLotEdit').onclick=()=>{if(!busy){editor.hidden=true;selected=null;}};
    form.onsubmit=async e=>{
        e.preventDefault();if(!selected||busy)return;G.clear();success.hidden=true;
        busy=true;const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
        try{
            await G.api(`/inventario/lotes/${root.dataset.product}/vencimiento`,{id_lote:selected.id,fecha:form.elements.fecha.value,fecha_anterior:selected.fecha||'',motivo:form.elements.motivo.value});
            editor.hidden=true;selected=null;success.textContent='Fecha corregida. Las cantidades se conservan y la corrección quedó registrada en el kardex.';success.hidden=false;
            await load();
        }catch(error){G.error(error);}finally{busy=false;buttons.forEach(b=>b.disabled=false);}
    };
    load().catch(G.error);
})();
