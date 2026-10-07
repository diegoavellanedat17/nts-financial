import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { officeQuestions, validateOfficeAnswer, type OfficeAnswer, type OfficeQuestion } from '../lib/officeQuestions';
import { money, today, type Transaction } from './finance';
import { MoneyInput } from './MoneyInput';
import { supabase } from './supabase';
const storage='natalia-office-answers-v1';
export default function OfficeQuestions({rows,userId,fallback}: {rows:Transaction[];userId?:string;fallback?:ReactNode}) {
 const [answers,setAnswers]=useState<OfficeAnswer[]>([]),[ready,setReady]=useState(false),[dismissed,setDismissed]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  let active=true;
  async function load(){
   try{
    let saved:OfficeAnswer[]=[];
    if(userId&&supabase){
     for(let offset=0;;offset+=500){const {data,error}=await supabase.from('office_answers').select('question_key,kind,answer').eq('user_id',userId).eq('person_tag','natalia').order('id').range(offset,offset+499);if(error)throw error;saved.push(...data as OfficeAnswer[]);if(data.length<500)break;}
    }else saved=JSON.parse(localStorage.getItem(storage)||'[]');
    if(active){setAnswers(saved);setReady(true);}
   }catch{if(active)setError('No pudimos cargar las respuestas. Recarga para intentarlo de nuevo.');}
  }
  void load();return()=>{active=false;};
 },[userId]);
 const questions=ready?officeQuestions(rows,answers,today()):[];
 async function save(q:OfficeQuestion,answer:Record<string,unknown>){
  const invalid=validateOfficeAnswer(q,answer);if(invalid)throw Error(invalid);
  const record={question_key:q.key,kind:q.kind,answer};
  if(userId&&supabase){const {error}=await supabase.from('office_answers').upsert({...record,user_id:userId,person_tag:'natalia',transaction_id:q.transactionId,snapshot:q.snapshot},{onConflict:'user_id,question_key'});if(error)throw Error('No se guardó la respuesta. Intenta de nuevo.');}
  else localStorage.setItem(storage,JSON.stringify([...answers,record]));
  setAnswers(previous=>[...previous.filter(a=>a.question_key!==q.key),record]);
 }
 if(error)return <p className="error" role="alert">{error}</p>;
 if(!ready||dismissed)return null;
 if(!questions.length)return <>{fallback}</>;
 return <section className="pending-review office-questions" aria-label="Preguntas del consultorio"><div><span>Para entender tu consultorio · {questions.length} por responder</span><button className="show-more" aria-label="Responder después sobre el consultorio" onClick={()=>setDismissed(true)}>Después</button></div><OfficeQuestionForm key={questions[0].key} question={questions[0]} onSave={answer=>save(questions[0],answer)} /></section>;
}
function OfficeQuestionForm({question:q,onSave}:{question:OfficeQuestion;onSave:(answer:Record<string,unknown>)=>Promise<void>}) {
 const [amount,setAmount]=useState(''),[notes,setNotes]=useState(''),[period,setPeriod]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(e:FormEvent){e.preventDefault();setError('');const answer=q.kind==='delivered_amount'?{amount:amount===''?null:Number(amount)}:q.kind==='pending_work'?{notes:notes.trim()}:{period,notes:notes.trim()};const invalid=validateOfficeAnswer(q,answer);if(invalid){setError(invalid);return;}setBusy(true);try{await onSave(answer);}catch(e){setError(e instanceof Error?e.message:'No se guardó la respuesta.');}finally{setBusy(false);}}
 return <form onSubmit={submit}><p>{q.question}</p>{q.amount!==undefined&&<strong>{money(q.amount,q.currency)} · {String(q.snapshot.date).split('-').reverse().join('/')}</strong>}<fieldset disabled={busy}>
 {q.kind==='delivered_amount'?<label>Monto ya terminado<MoneyInput aria-label="Monto de tratamientos terminados" currency={q.currency} value={amount} onValueChange={setAmount} min="0" max={q.amount} step={q.currency==='COP'?1:0.01} placeholder="0" /></label>:<>
 {q.kind==='auxiliary_period'&&<label>Periodo del pago<select aria-label="Periodo del pago a la auxiliar" required value={period} onChange={e=>setPeriod(e.target.value)}><option value="">Selecciona</option><option value="day">Un día</option><option value="week">Una semana</option><option value="month">Un mes</option><option value="other">Otro periodo</option></select></label>}
 <label>{q.kind==='pending_work'?'Cuéntanos lo pendiente':'Detalle (opcional)'}<textarea aria-label={q.kind==='pending_work'?'Tratamientos y pagos pendientes':'Detalle del periodo'} required={q.kind==='pending_work'||period==='other'} maxLength={4000} rows={2} value={notes} onChange={e=>setNotes(e.target.value)} placeholder={q.kind==='pending_work'?'Ej. Falta entregar dos casos. El laboratorio cobra por varios; aún no sé cuánto.':'Ej. Los turnos del 1 al 5 de octubre'} /></label>
 </>}
 </fieldset>{error&&<p className="error" role="alert">{error}</p>}<small>No cambia el saldo ni el dinero apartado.</small><button className="primary" aria-label="Guardar respuesta del consultorio" disabled={busy}>{busy?'Guardando…':'Guardar respuesta'}</button></form>;
}
