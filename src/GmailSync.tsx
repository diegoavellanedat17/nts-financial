import { useEffect, useState } from 'react';
import { supabase } from './supabase';
type Status={configured:boolean;connected:boolean;status?:string;last_success_at?:string;last_error?:string;last_imported?:number;pending:number};
export default function GmailSync({userId, compact=false}: {userId?:string;compact?:boolean}) {
 const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function call(method='GET') {
  const {data}=await supabase!.auth.getSession();
  const r=await fetch('/api/gmail/connection',{method,headers:{Authorization:`Bearer ${data.session?.access_token || ''}`}});
  const body=await r.json();if(!r.ok)throw Error(body.error || 'No pudimos consultar Gmail.');return body;
 }
 useEffect(()=>{if(!userId||!supabase)return;let alive=true;void call().then(s=>{if(alive)setStatus(s);}).catch(()=>{});return()=>{alive=false;};},[userId]);
 async function connect(){setBusy(true);setError('');try{const result=await call('POST');window.location.assign(result.url);}catch(e){setError(e instanceof Error?e.message:'No pudimos conectar.');setBusy(false);}}
 async function disconnect(){setBusy(true);setError('');try{await call('DELETE');setStatus(await call());}catch(e){setError(e instanceof Error?e.message:'No pudimos desconectar.');}finally{setBusy(false);}}
 if(!userId||!status)return null;
 if(compact)return status.connected?<p className="sync-status" role="status">{status.status==='reauthorize'?'Gmail necesita reconectarse':status.last_error?'La última revisión falló; se reintentará':status.last_success_at?`Gmail · Revisado ${new Intl.DateTimeFormat('es-CO',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'America/Bogota'}).format(new Date(status.last_success_at))} · ${status.last_imported || 0} nuevos`:'Gmail · Primera revisión esta noche'}{status.pending>0?` · ${status.pending} por revisar`:''}</p>:null;
 return <section className="gmail-sync"><strong>Revisión automática cada noche</strong><p>Compras de Bancolombia en tu Gmail personal. Los avisos dudosos quedan por revisar.</p>{status.connected&&status.status==='active'?<><p>Activada · alrededor de medianoche.</p><button className="show-more" disabled={busy} onClick={disconnect}>Desactivar revisión automática</button></>:<button className="secondary" disabled={busy||!status.configured} onClick={connect}>{busy?'Conectando…':status.status==='reauthorize'?'Reconectar Gmail':'Activar revisión automática'}</button>}{!status.configured&&<small>Falta terminar la configuración de Google.</small>}{new URLSearchParams(window.location.search).get('gmail_sync')==='error'&&<p className="error">No se completó la conexión. Intenta de nuevo con tu Gmail personal.</p>}{error&&<p className="error" role="alert">{error}</p>}</section>;
}
