import { useEffect, useState, type FormEvent } from 'react';
import { budgetNoteId, budgetProgress, decodePlan, encodePlan, personalBudgetCategories, suggestedPlan, type CategoryPlan } from '../lib/categoryBudgets';
import { supabase } from './supabase';
import { money, today, type Transaction } from './finance';
import { monthLabel } from './MonthFilter';
import { MoneyInput } from './MoneyInput';

function budgetMoney(value: number, currency: 'COP') {
  return Number.isInteger(value) ? money(value,currency) : `$${new Intl.NumberFormat('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value)} COP`;
}

export function CategoryBudgets({ userId, personTag, month, items }: { userId?: string; personTag: string; month: string; items: Transaction[] }) {
  const [plan,setPlan]=useState<CategoryPlan|null>(null),[draft,setDraft]=useState<CategoryPlan|null>(null);
  const [revision,setRevision]=useState<string|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[loadError,setLoadError]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[attempt,setAttempt]=useState(0);
  const localKey=`${personTag}-category-budget-v1-${month}`;
  useEffect(()=>{let active=true;setReady(false);setLoadError('');
    void(async()=>{try{
      if(userId&&supabase){
        const id=await budgetNoteId(userId,month);
        const {data,error}=await supabase.from('notes').select('body,updated_at').eq('id',id).eq('user_id',userId).eq('person_tag',personTag).maybeSingle();
        if(error)throw error;
        const saved=data?decodePlan(data.body,month):null;
        if(active){setPlan(saved);setRevision(data?.updated_at||null);}
      }else{
        const body=localStorage.getItem(localKey);if(active)setPlan(body?decodePlan(body,month):null);
      }
    }catch{if(active)setLoadError('No pudimos cargar tu presupuesto. Intenta de nuevo.');}finally{if(active)setReady(true);}})();
    return()=>{active=false;};
  },[userId,personTag,month,localKey,attempt]);
  async function save(e:FormEvent){e.preventDefault();if(!draft)return;setBusy(true);setError('');setNotice('');
    try{
      const body=encodePlan(draft);
      if(userId&&supabase){
        const id=await budgetNoteId(userId,month);
        const query=revision
          ?supabase.from('notes').update({body}).eq('id',id).eq('user_id',userId).eq('updated_at',revision)
          :supabase.from('notes').insert({id,user_id:userId,person_tag:personTag,currency:'COP',body});
        const {data,error}=await query.select('updated_at').maybeSingle();
        if(error||!data)throw Error('No se guardó. Puede haber un cambio en otro dispositivo. Recarga el presupuesto y vuelve a intentarlo.');
        setRevision(data.updated_at);
      }else localStorage.setItem(localKey,body);
      setPlan(draft);setDraft(null);setNotice('Presupuesto guardado.');
    }catch(e){setError(e instanceof Error?e.message:'No se guardó el presupuesto.');}finally{setBusy(false);}
  }
  const progress=plan?budgetProgress(items,plan,today()):[];
  const spent=Math.round(progress.reduce((s,r)=>s+r.spent,0)*100)/100,limit=progress.reduce((s,r)=>s+r.limit,0);
  const usd=items.some(t=>t.date.startsWith(month)&&t.date<=today()&&t.context==='Personal'&&t.kind==='expense'&&(t.flow_type||'operating')==='operating'&&t.currency==='USD');
  return <section className="category-budgets" aria-label="Presupuesto personal por categoría">
    <div className="budget-heading"><div><h2>Mi presupuesto</h2><p>{monthLabel(month)} · Personal · COP</p></div>{ready&&!loadError&&plan&&!draft&&<button className="show-more" onClick={()=>{setDraft(structuredClone(plan));setError('');setNotice('');}}>Editar presupuesto</button>}</div>
    {!ready?<p role="status">Cargando presupuesto…</p>:loadError?<p role="alert">{loadError} <button onClick={()=>setAttempt(x=>x+1)}>Reintentar presupuesto</button></p>:<>
      {!plan&&!draft&&<><p>Este mes todavía no tiene topes. Puedes empezar con una sugerencia y cambiarla.</p><button className="secondary" onClick={()=>setDraft(suggestedPlan(personTag,month))}>Crear presupuesto</button></>}
      {draft?<form onSubmit={save} className="budget-form"><p>Define cuánto quieres gastar como máximo. <strong>$0 significa no gastar en esa categoría.</strong></p><fieldset disabled={busy}>
        <div className="budget-inputs">{personalBudgetCategories.map(category=><label key={category}>{category}<MoneyInput aria-label={`Tope de ${category}`} currency="COP" value={String(draft.limits[category])} onValueChange={value=>setDraft({...draft,limits:{...draft.limits,[category]:value===''?0:Number(value)}})} /></label>)}</div>
        <label>Qué incluye Hogar<textarea aria-label="Detalle del presupuesto de Hogar" rows={2} maxLength={400} value={draft.homeDetails} onChange={e=>setDraft({...draft,homeDetails:e.target.value})}/></label>
        <p className="budget-draft-total">Total del mes: <strong>{budgetMoney(Object.values(draft.limits).reduce((s,v)=>s+v,0),'COP')}</strong></p>
        <p className="budget-hint">La sugerencia busca reducir el gasto, pero revísala con el dinero que esperas recibir y lo que necesitas ahorrar. La nevera y los sofás solo están incluidos en noviembre de 2026.</p>
        <div className="budget-actions"><button className="primary" type="submit">{busy?'Guardando…':'Guardar presupuesto'}</button><button className="secondary" type="button" onClick={()=>{setDraft(null);setError('');}}>Cancelar</button></div>
      </fieldset>{error&&<p className="error" role="alert">{error} <button type="button" onClick={()=>{setDraft(null);setError('');setAttempt(x=>x+1);}}>Recargar presupuesto</button></p>}</form>:plan&&<>
        <div className="budget-total"><span>Gastado <strong>{budgetMoney(spent,'COP')}</strong></span><span>Tope del mes <strong>{budgetMoney(limit,'COP')}</strong></span></div>
        <p className={spent>limit?'budget-over':'budget-hint'}>{spent>limit?`Te pasaste ${budgetMoney(spent-limit,'COP')} del total.`:`Quedan ${budgetMoney(limit-spent,'COP')} dentro del presupuesto.`}</p>
        <p className="budget-hint">Las barras se llenan con los gastos registrados. Amarillo: llegaste al 80%. Rojo: superaste el tope.</p>
        {plan.homeDetails&&<p className="budget-home"><strong>Hogar:</strong> {plan.homeDetails}</p>}
        <div className="budget-categories">{progress.map(r=><article className={`budget-category budget-${r.state}`} key={r.category}><div className="budget-category-title"><h3>{r.category}</h3><span>{r.state==='over'?'Te pasaste':r.limit===0?'Sin gasto previsto':r.spent===r.limit?'Tope alcanzado':r.state==='near'?'Cerca del tope':'Dentro del tope'}</span></div>
          <div className="budget-track" role="progressbar" aria-label={`Presupuesto de ${r.category}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(r.percent,100))} aria-valuetext={`${budgetMoney(r.spent,'COP')} gastados de ${budgetMoney(r.limit,'COP')}; ${r.remaining<0?'exceso':'restante'} ${budgetMoney(Math.abs(r.remaining),'COP')}`}><span style={{width:`${Math.min(r.percent,100)}%`}}/></div>
          <p className="budget-values"><strong>{budgetMoney(r.spent,'COP')}</strong><span>de {budgetMoney(r.limit,'COP')}</span></p><small>{r.remaining<0?`Te pasaste ${budgetMoney(-r.remaining,'COP')}`:`Quedan ${budgetMoney(r.remaining,'COP')}`}</small>
        </article>)}</div>
        <p className="budget-hint">Fijar un tope no registra una compra ni cambia el saldo. Los gastos del consultorio van aparte.{usd?' Tienes gastos en USD este mes; estas barras solo incluyen COP.':''}</p>
      </>}
      {notice&&<p role="status" className="budget-saved">{notice}</p>}
    </>}
  </section>;
}
