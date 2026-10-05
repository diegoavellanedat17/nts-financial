import type { IncomingMessage, ServerResponse } from 'node:http';
import { send, serverDb, validCron } from '../../lib/gmailServer.ts';
import { runGmailWorker } from '../../lib/gmailWorker.ts';
export default async function handler(req:IncomingMessage,res:ServerResponse) {
  if(req.method!=='GET'){send(res,405,{error:'Método no permitido.'});return;}
  if(!validCron(req.headers.authorization)){send(res,401,{error:'No autorizado.'});return;}
  try {
    const db=serverDb();
    const {data:connections,error}=await db.from('gmail_connections').select('user_id').eq('status','active');
    if(error)throw error;
    const results=[];
    for(const c of connections || [])results.push(await runGmailWorker(db,c.user_id));
    await db.from('gmail_oauth_states').delete().lt('expires_at',new Date().toISOString());
    send(res,200,{ok:true,runs:results});
  } catch { send(res,503,{error:'La sincronización no se completó; se reintentará en la próxima ejecución.'}); }
}
