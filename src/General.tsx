import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { money, today, type Currency } from './finance';
import { useTrm } from './useTrm';
type Total = { person_tag: string; kind: string; category: string; currency: Currency; amount: number };
export function General({ userId }: { userId?: string }) {
 const [month,setMonth]=useState(()=>today().slice(0,7)),[view,setView]=useState<Currency|'total'>('total');
 const [rows,setRows]=useState<Total[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const trm=useTrm(view==='total');
 useEffect(()=>{let active=true;setLoading(true);setError('');setRows([]);
  if(!supabase||!userId){setLoading(false);setError('General está disponible al iniciar sesión.');return;}
  void (async()=>{try{const {data,error}=await supabase!.rpc('general_summary',{p_month:month});if(!active)return;if(error)setError('No pudimos cargar General.');else setRows((data||[]).map((r:Total)=>({...r,amount:Number(r.amount)})));}catch{if(active)setError('No pudimos cargar General.');}finally{if(active)setLoading(false);}})();
  return()=>{active=false;};
 },[month,userId,attempt]);
 const currency=view==='USD'?'USD':'COP';
 const needsRate=view==='total'&&rows.some(r=>r.currency==='USD');
 const ready=!loading&&!error&&(!needsRate||!!trm.rate);
 const selected=rows.filter(r=>view==='total'||r.currency===view).map(r=>({...r,amount:r.amount*(view==='total'&&r.currency==='USD'?(trm.rate?.cop_per_usd||0):1)}));
 const income=selected.filter(r=>r.kind==='income').reduce((n,r)=>n+r.amount,0),expense=selected.filter(r=>r.kind==='expense').reduce((n,r)=>n+r.amount,0);
 const people=['diego','natalia'].map((tag,i)=>({name:tag==='diego'?'Diego':'Natalia',color:i===0?'#176b58':'#d18a45',amount:selected.filter(r=>r.person_tag===tag&&r.kind==='expense').reduce((n,r)=>n+r.amount,0)}));
 const categories=Object.entries(selected.filter(r=>r.kind==='expense').reduce<Record<string,number>>((a,r)=>{a[r.category]=(a[r.category]||0)+r.amount;return a;},{})).sort((a,b)=>b[1]-a[1]);
 const share=expense?people[0].amount/expense*100:0;
 return <section className="general-summary" aria-label="Resumen general de Diego y Natalia">
  <div className="general-heading"><h2>Diego y Natalia</h2><label><span className="sr-only">Mes de General</span><input type="month" value={month} max={today().slice(0,7)} onChange={e=>{if(e.target.value)setMonth(e.target.value);}} /></label></div>
  <div className="currency-switch" role="group" aria-label="Moneda de General">{(['total','COP','USD'] as const).map(c=><button key={c} aria-pressed={view===c} onClick={()=>setView(c)}>{c==='total'?'Total en COP':c}</button>)}</div>
  <p className="empty-note">Solo lo personal · Incluye pagos de clínicas, excluye el consultorio.</p>
  {loading?<p role="status">Cargando…</p>:error?<p role="alert">{error}{userId&&<button className="show-more" onClick={()=>setAttempt(n=>n+1)}>Reintentar</button>}</p>:!ready?<p role="status">{trm.error||'Cargando TRM…'}{trm.error&&<button className="show-more" onClick={trm.retry}>Reintentar TRM</button>}</p>:<>
   <div className="movement-totals"><div><span>Ingresos de ambos</span><strong className="income-total">{money(income,currency)}</strong></div><div><span>Gastos de ambos</span><strong className="expense-total">{money(expense,currency)}</strong></div></div>
   <section className="spending-summary"><h3>Gastos de ambos</h3>{expense>0?<>
    <div className="category-donut" role="img" aria-label={people.map(p=>`Gastos ${p.name}: ${money(p.amount,currency)}, ${(p.amount/expense*100).toFixed(1)}%`).join('; ')} style={{background:`conic-gradient(${people[0].color} 0% ${share}%, ${people[1].color} ${share}% 100%)`}}><div><span>Gastos personales</span><strong>{money(expense,currency)}</strong></div></div>
    <ul className="general-legend">{people.map(p=><li key={p.name}><span><i style={{background:p.color}}/>Gastos {p.name}</span><strong>{money(p.amount,currency)}<small>{Math.round(p.amount/expense*100)}%</small></strong></li>)}</ul>
   </>:<p className="empty-note">No hay gastos registrados en este mes.</p>}</section>
   {categories.length>0&&<section className="spending-summary"><h3>¿En qué se va?</h3><ul className="general-categories">{categories.map(([category,amount])=><li key={category}><div><span>{category}</span><strong>{money(amount,currency)}</strong></div><div className="general-bar"><span style={{width:`${amount/expense*100}%`}}/></div></li>)}</ul></section>}
   {needsRate&&trm.rate&&<p className="empty-note">USD convertido con la TRM de hoy: {money(trm.rate.cop_per_usd,'COP')} por dólar.</p>}
  </>}
 </section>;
}
