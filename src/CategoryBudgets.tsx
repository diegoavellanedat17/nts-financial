import { useEffect, useState, type FormEvent } from 'react';
import { budgetNoteId, budgetProgress, fixedHomePayments, decodePlan, encodePlan, personalBudgetCategories, suggestedPlan, type CategoryPlan } from '../lib/categoryBudgets';
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
  const [showEmpty,setShowEmpty]=useState(false);
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
  async function save(e:FormEvent){e.preventDefault();if(!draft)return;if((draft.homePayments||[]).reduce((s,p)=>s+p.amount,0)>draft.limits.Hogar){setError('El tope de Hogar debe cubrir sus pagos fijos. Ajusta el total o los pagos.');return;}setBusy(true);setError('');setNotice('');
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
  function editPlan(source: CategoryPlan) {
    setDraft({...structuredClone(source),homePayments:source.homePayments??fixedHomePayments(personTag,month)});
    setError('');setNotice('');
  }
  const payments=(draft||plan)?.homePayments??fixedHomePayments(personTag,month);
  const fixedTotal=payments.reduce((s,p)=>s+p.amount,0);
  const progress=plan?budgetProgress(items,plan,today()):[];
  const spent=Math.round(progress.reduce((s,r)=>s+r.spent,0)*100)/100,limit=progress.reduce((s,r)=>s+r.limit,0);
  const usd=items.some(t=>t.date.startsWith(month)&&t.date<=today()&&t.context==='Personal'&&t.kind==='expense'&&(t.flow_type||'operating')==='operating'&&t.currency==='USD');
  return <section className="category-budgets" aria-label="Presupuesto personal por categoría">
    <div className="budget-heading"><div><h2>Mi presupuesto</h2><p>{monthLabel(month)} · Personal · COP</p></div>{ready&&!loadError&&plan&&!draft&&<button className="show-more" onClick={()=>{editPlan(plan);}}>Editar presupuesto</button>}</div>
    {!ready?<p role="status">Cargando presupuesto…</p>:loadError?<p role="alert">{loadError} <button onClick={()=>setAttempt(x=>x+1)}>Reintentar presupuesto</button></p>:<>
      {!plan&&!draft&&<><p>Este mes todavía no tiene topes. Puedes empezar con una sugerencia y cambiarla.</p><button className="secondary" onClick={()=>editPlan(suggestedPlan(personTag,month))}>Crear presupuesto</button></>}
      {payments.length>0&&!draft&&<section className="budget-fixed" aria-label="Pagos fijos del mes"><div className="budget-section-heading"><h3>Hogar · pagos fijos</h3><span>Pagos de casa · {monthLabel(month)}</span></div><div className="budget-fixed-grid">{payments.map(p=><div className="budget-fixed-item" key={p.name}><span>{p.name}</span><strong>{budgetMoney(p.amount,'COP')}</strong></div>)}</div>{plan&&plan.limits.Hogar>fixedTotal&&<p className="budget-hint">Otros gastos de Hogar: {budgetMoney(plan.limits.Hogar-fixedTotal,'COP')}</p>}<p className="budget-hint">{plan?'Estos pagos forman parte del tope de Hogar.':'Al crear el presupuesto, estos pagos ya vienen incluidos en Hogar.'} Presupuestarlos no significa que ya estén pagados.</p>{plan&&fixedTotal>plan.limits.Hogar&&<p className="budget-over">El tope de Hogar no alcanza para estos pagos. Revísalo en Editar presupuesto.</p>}</section>}
      {draft?<form onSubmit={save} className="budget-form"><p>Define cuánto quieres gastar como máximo. <strong>$0 significa no gastar en esa categoría.</strong></p><fieldset disabled={busy}>
        {payments.length>0&&<section className="budget-fixed"><h3>Hogar · pagos fijos</h3><p className="budget-hint">Ya están incluidos en Hogar. Si cambias un pago, ajustamos ese tope por la misma diferencia.</p><div className="budget-inputs">{payments.map((p,index)=><label key={p.name}>{p.name}<MoneyInput aria-label={`Pago fijo de ${p.name}`} currency="COP" value={String(p.amount)} onValueChange={value=>{const amount=Number(value||0);setDraft({...draft,homePayments:payments.map((row,i)=>i===index?{...row,amount}:row),homeDetails:payments.map((row,i)=>`${row.name} ${budgetMoney(i===index?amount:row.amount,'COP')}`).join(' + ')+(draft.limits.Hogar>fixedTotal?` + otros gastos de Hogar ${budgetMoney(draft.limits.Hogar-fixedTotal,'COP')}`:''),limits:{...draft.limits,Hogar:Math.max(0,draft.limits.Hogar+amount-p.amount)}});}} /></label>)}</div></section>}
        <h3>Topes por categoría</h3><p className="budget-hint">Hogar incluye los pagos de arriba. Los demás valores son editables.</p>
        <div className="budget-inputs">{personalBudgetCategories.map(category=><label key={category}>{category}<MoneyInput aria-label={`Tope de ${category}`} currency="COP" value={String(draft.limits[category])} onValueChange={value=>setDraft({...draft,limits:{...draft.limits,[category]:value===''?0:Number(value)}})} /></label>)}</div>
        <label>Qué incluye Hogar<textarea aria-label="Detalle del presupuesto de Hogar" rows={2} maxLength={400} value={draft.homeDetails} onChange={e=>setDraft({...draft,homeDetails:e.target.value})}/></label>
        <p className="budget-draft-total">Total del mes: <strong>{budgetMoney(Object.values(draft.limits).reduce((s,v)=>s+v,0),'COP')}</strong></p>
        <p className="budget-hint">La sugerencia busca reducir el gasto, pero revísala con el dinero que esperas recibir y lo que necesitas ahorrar. La nevera y los sofás solo están incluidos en noviembre de 2026.</p>
        <div className="budget-actions"><button className="primary" type="submit">{busy?'Guardando…':'Guardar presupuesto'}</button><button className="secondary" type="button" onClick={()=>{setDraft(null);setError('');}}>Cancelar</button></div>
      </fieldset>{error&&<p className="error" role="alert">{error} <button type="button" onClick={()=>{setDraft(null);setError('');setAttempt(x=>x+1);}}>Recargar presupuesto</button></p>}</form>:plan&&<>
        <div className="budget-total"><span>Gastado <strong>{budgetMoney(spent,'COP')}</strong></span><span>Tope del mes <strong>{budgetMoney(limit,'COP')}</strong></span></div>
        <p className={spent>limit?'budget-over':'budget-hint'}>{spent>limit?`Te pasaste ${budgetMoney(spent-limit,'COP')} del total.`:`Quedan ${budgetMoney(limit-spent,'COP')} dentro del presupuesto.`}</p>
        <p className="budget-hint">Las barras se llenan con los gastos registrados. Amarillo: llegaste al 80%. Rojo: superaste el tope.</p>
        {plan.homeDetails&&<details className="budget-detail"><summary>Ver notas de Hogar</summary><p className="budget-home">{plan.homeDetails}</p></details>}
        <div className="budget-categories">{progress.filter(r=>showEmpty||r.limit>0||r.spent>0).map(r=><article className={`budget-category budget-${r.state}`} key={r.category}><div className="budget-category-title"><h3>{r.category}</h3><span>{r.state==='over'?'Te pasaste':r.limit===0?'Sin gasto previsto':r.spent===r.limit?'Tope alcanzado':r.state==='near'?'Cerca del tope':'Dentro del tope'}</span></div>
          <div className="budget-track" role="progressbar" aria-label={`Presupuesto de ${r.category}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(r.percent,100))} aria-valuetext={`${budgetMoney(r.spent,'COP')} gastados de ${budgetMoney(r.limit,'COP')}; ${r.remaining<0?'exceso':'restante'} ${budgetMoney(Math.abs(r.remaining),'COP')}`}><span style={{width:`${Math.min(r.percent,100)}%`}}/></div>
          <p className="budget-values"><strong>{budgetMoney(r.spent,'COP')}</strong><span>de {budgetMoney(r.limit,'COP')}</span></p><small>{r.remaining<0?`Te pasaste ${budgetMoney(-r.remaining,'COP')}`:`Quedan ${budgetMoney(r.remaining,'COP')}`}</small>
        </article>)}</div>
        {progress.some(r=>r.limit===0&&r.spent===0)&&<button className="show-more budget-empty-toggle" aria-expanded={showEmpty} onClick={()=>setShowEmpty(!showEmpty)}>{showEmpty?'Ocultar categorías sin presupuesto':`Ver categorías sin presupuesto (${progress.filter(r=>r.limit===0&&r.spent===0).length})`}</button>}
        <p className="budget-hint">Fijar un tope no registra una compra ni cambia el saldo. Los gastos del consultorio van aparte.{usd?' Tienes gastos en USD este mes; estas barras solo incluyen COP.':''}</p>
      </>}
      {notice&&<p role="status" className="budget-saved">{notice}</p>}
    </>}
  </section>;
}
