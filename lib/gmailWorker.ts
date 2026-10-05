import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { automaticCandidate, automaticMovement, isBankSender } from './gmailAutomatic.ts';
import { gmailGet, googleTokens, openToken, sealToken, verifyPersonalGmail } from './gmailServer.ts';
import type { GmailMessage } from './gmailParsing.ts';

type Connection = { user_id:string;account_id:string;token_ciphertext:string;enabled_since:string;last_success_at:string|null;scan_start:string|null;scan_end:string|null;page_token:string|null };
export async function runGmailWorker(db:SupabaseClient, userId:string) {
  const lease=randomUUID();
  const {data:claimed,error:claimError}=await db.rpc('claim_gmail_sync',{p_user:userId,p_lease:lease});
  if(claimError)throw claimError;
  const connection=claimed?.[0] as Connection|undefined;
  if(!connection)return {skipped:true,imported:0,reviews:0};
  const started=Date.now(), runId=randomUUID();
  let imported=0,reviews=0, complete=false;
  const save=async(values:Record<string,unknown>)=>{
    const {data,error}=await db.from('gmail_connections').update(values).eq('user_id',userId).eq('lease_id',lease).eq('status','active').select('user_id').maybeSingle();
    if(error||!data)throw Error('connection_changed');
  };
  try {
    const {error:runError}=await db.from('gmail_sync_runs').insert({id:runId,user_id:userId});if(runError)throw runError;
    const tokens=await googleTokens({grant_type:'refresh_token',refresh_token:openToken(connection.token_ciphertext,userId)});
    await verifyPersonalGmail(tokens.access_token);
    if(tokens.refresh_token)await save({token_ciphertext:sealToken(tokens.refresh_token,userId)});
    const end=connection.scan_end || new Date(started).toISOString();
    const start=connection.scan_start || new Date(Math.max(Date.parse(connection.enabled_since),Date.parse(connection.last_success_at || connection.enabled_since)-3*86400000)).toISOString();
    let pageToken=connection.page_token || '';
    await save({scan_start:start,scan_end:end});
    for(let pageNumber=0;pageNumber<3 && Date.now()-started<85000;pageNumber++) {
      const q=`after:${Math.floor(Date.parse(start)/1000)-1} before:${Math.ceil(Date.parse(end)/1000)} from:notificacionesbancolombia.com -in:spam -in:trash {"Compraste" "Pagaste" "transferiste" "Recibiste" "retiro" "consignación"}`;
      const params=new URLSearchParams({q,maxResults:'50'});if(pageToken)params.set('pageToken',pageToken);
      const page=await gmailGet<{messages?:{id:string}[];nextPageToken?:string}>(tokens.access_token,`messages?${params}`);
      let pageFinished=true;
      for(const {id} of page.messages || []) {
        if(Date.now()-started>85000){pageFinished=false;break;}
        const message=await gmailGet<GmailMessage>(tokens.access_token,`messages/${encodeURIComponent(id)}?format=full`);
        const received=Number(message.internalDate);
        if(received<Date.parse(start)||received>=Date.parse(end))continue;
        const candidate=automaticCandidate(message);
        if(!isBankSender(candidate.sender))continue;
        const movement=automaticMovement(message,connection.account_id);
        const {data:outcome,error}=await db.rpc('import_automatic_gmail',{p_user:userId,p_lease:lease,p_candidate:candidate,p_movement:movement});
        if(error)throw error;
        if(outcome==='imported')imported++;if(outcome==='review')reviews++;
      }
      if(!pageFinished)break;
      pageToken=page.nextPageToken || '';
      await save({page_token:pageToken || null});
      if(!pageToken){complete=true;break;}
    }
    await save({lease_id:null,lease_until:null,last_error:null,last_imported:imported,last_reviews:reviews,updated_at:new Date().toISOString(),...(complete?{last_success_at:end,scan_start:null,scan_end:null,page_token:null}:{})});
    const {error:finishError}=await db.from('gmail_sync_runs').update({finished_at:new Date().toISOString(),status:complete?'success':'partial',imported,reviews}).eq('id',runId);if(finishError)throw finishError;
    return {imported,reviews,complete};
  } catch(e) {
    const reason=e instanceof Error && e.message==='reauthorize'?'reauthorize':'sync_error';
    await db.from('gmail_connections').update({lease_id:null,lease_until:null,last_error:reason,...(reason==='reauthorize'?{status:'reauthorize'}:{})}).eq('user_id',userId).eq('lease_id',lease);
    await db.from('gmail_sync_runs').update({finished_at:new Date().toISOString(),status:'error',error_code:reason,imported,reviews}).eq('id',runId);
    throw Error(reason);
  }
}
