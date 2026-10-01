import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { supabase } from './supabase';
import type { Currency } from './finance';
import { readNotes, type RawNote } from './data';
export function Notes({ userId, personTag }: { userId?: string; personTag: string }) {
 const STORAGE = `${personTag}-notes-v1`;
 const [notes,setNotes]=useState<RawNote[]>([]);
 const [currency,setCurrency]=useState<Currency>('COP');
 const [body,setBody]=useState('');
 const [editing,setEditing]=useState<string|null>(null);
 const [deleting,setDeleting]=useState<string|null>(null);
 const [ready,setReady]=useState(false);
 const [failed,setFailed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [reload,setReload]=useState(0);
 const [showAll,setShowAll]=useState(false);
 const textarea=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{
  let active=true;
  async function load(){
   setReady(false);setFailed(false);setError('');
   try{
    const rows=userId?await readNotes(userId, personTag):JSON.parse(localStorage.getItem(STORAGE)||'[]');
    if(!Array.isArray(rows)||rows.some(n=>typeof n.body!=='string'||!n.id||!n.created_at)) throw new Error('Notas inválidas');
    if(active)setNotes(rows);
   }catch{if(active){setFailed(true);setError('No pudimos cargar tus notas. Inténtalo otra vez.');}}
   finally{if(active)setReady(true);}
  }
  void load();return()=>{active=false;};
 },[userId,personTag,reload]);
 function persist(rows:RawNote[]){
  if(!userId)localStorage.setItem(STORAGE,JSON.stringify(rows));
  setNotes(rows);
 }
 async function save(e:FormEvent){
  e.preventDefault();setError('');setMessage('');
  if(!body.trim()){setError('Escribe algo antes de guardar.');return;}
  setBusy(true);
  const previous=notes.find(n=>n.id===editing);
  const note:RawNote={id:editing||crypto.randomUUID(),body,person_tag:personTag,currency,created_at:previous?.created_at||new Date().toISOString(),updated_at:new Date().toISOString()};
  try{
   if(userId&&supabase){
    const result=editing
     ?await supabase.from('notes').update({body,currency}).eq('id',editing).eq('user_id',userId).eq('person_tag',personTag).select().single()
     :await supabase.from('notes').insert({id:note.id,user_id:userId,person_tag:personTag,body,currency}).select().single();
    if(result.error)throw result.error;
    Object.assign(note,result.data);
   }
   persist([note,...notes.filter(n=>n.id!==note.id)].sort((a,b)=>b.created_at.localeCompare(a.created_at)));
   setBody('');setEditing(null);setMessage('Nota guardada.');
  }catch{setError('No se guardó la nota. Tu texto sigue aquí para volver a intentarlo.');}
  finally{setBusy(false);}
 }
 async function remove(id:string){
  setBusy(true);setError('');setMessage('');
  try{
   if(userId&&supabase){const {data,error}=await supabase.from('notes').delete().eq('id',id).eq('user_id',userId).eq('person_tag',personTag).select('id');if(error||!data?.length)throw error||new Error('Nota no encontrada');}
   persist(notes.filter(n=>n.id!==id));setDeleting(null);
   if(editing===id){setEditing(null);setBody('');}
   setMessage('Nota eliminada.');
  }catch{setError('No pudimos eliminar la nota. Inténtalo otra vez.');}
  finally{setBusy(false);}
 }
 return <section className="notes-section" aria-labelledby="notes-title">
  <h2 id="notes-title">Notas, tal como pasó</h2>
  <p className="notes-hint">Escribe el concepto o lo que quieras recordar. Después lo analizamos.</p>
  <form onSubmit={save}><label className="notes-label">Moneda de la nota<select aria-label="Moneda de la nota" value={currency} onChange={e=>setCurrency(e.target.value as Currency)} disabled={!ready||failed||busy}><option>COP</option><option>USD</option></select></label><label className="notes-label" htmlFor="raw-note">{editing?'Corregir nota':'Tu nota'}</label><textarea ref={textarea} id="raw-note" name="raw_note" value={body} onChange={e=>setBody(e.target.value)} maxLength={4000} rows={3} placeholder={personTag === 'diego' ? 'Ej. Entraron $800.000 a Bancolombia por un trabajo. Pagué $50.000 de mercado…' : 'Ej. Entraron $800.000 a Bancolombia por pago de la clínica. Parte es para laboratorio…'} disabled={!ready||failed||busy}/><div className="notes-actions"><button className="primary" disabled={!ready||failed||busy||!body.trim()}>{busy?'Guardando…':editing?'Guardar cambios':'Guardar nota'}</button>{editing&&<button className="secondary" type="button" disabled={busy} onClick={()=>{setEditing(null);setBody('');setError('');}}>Cancelar</button>}</div></form>
  <p className="notes-hint">Las notas no cambian tu saldo. Para registrar dinero usa {personTag === 'diego' ? '«Entrada» o «Salida»' : '«Recibí dinero» o «Pagué algo»'}.</p>
  {error&&<p className="error" role="alert">{error}{failed&&<button onClick={()=>setReload(r=>r+1)}>Reintentar</button>}</p>}
  {message&&<p className="notes-status" role="status">{message}</p>}
  {!ready?<p className="empty-note">Cargando notas…</p>:!failed&&(notes.length?<ul className="notes-list">{(showAll?notes:notes.slice(0,3)).map(n=><li key={n.id}><div className="note-heading"><time dateTime={n.created_at}>{new Intl.DateTimeFormat('es-CO',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(n.created_at))}</time><span className="note-currency">{n.currency || 'COP'}</span><div><button className="icon-button" aria-label="Corregir nota" disabled={busy} onClick={()=>{setEditing(n.id);setBody(n.body);setCurrency(n.currency || 'COP');setMessage('');setDeleting(null);textarea.current?.focus();}}><Pencil size={16}/></button><button className="icon-button" aria-label="Eliminar nota" disabled={busy} onClick={()=>setDeleting(n.id)}><Trash2 size={16}/></button></div></div><p className="note-body">{n.body}</p>{deleting===n.id&&<div className="note-confirm"><p>¿Eliminar esta nota?{userId&&' Su historial seguirá guardado.'}</p><button className="danger" disabled={busy} onClick={()=>remove(n.id)}>Confirmar eliminación</button><button className="secondary" disabled={busy} onClick={()=>setDeleting(null)}>Cancelar</button></div>}</li>)}</ul>:<p className="empty-note">Aquí quedarán tus ideas y recordatorios.</p>)}
  {!failed&&notes.length>3&&<button className="show-more" onClick={()=>setShowAll(!showAll)}>{showAll?'Ver menos notas':'Ver todas las notas'}</button>}
 </section>;
}
