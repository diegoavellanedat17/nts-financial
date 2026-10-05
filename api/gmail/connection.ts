import type { IncomingMessage, ServerResponse } from 'node:http';
import { googleConfig, hash, openToken, ownerForRequest, randomToken, sealToken, send } from '../../lib/gmailServer.ts';
import { gmailReadScope, personalGmail } from '../../lib/gmailAutomatic.ts';
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const { db, user } = await ownerForRequest(req);
    const { data: connection, error } = await db.from('gmail_connections').select('status,last_success_at,last_run_at,last_error,last_imported,last_reviews,token_ciphertext').eq('user_id',user.id).maybeSingle();
    if (error) throw error;
    if (req.method === 'GET') {
      let configured = true; try { googleConfig(); sealToken('check',user.id); if (!process.env.CRON_SECRET) configured=false; } catch { configured=false; }
      const { count, error: countError } = await db.from('gmail_sync_reviews').select('id', { count:'exact', head:true }).eq('user_id',user.id).eq('status','pending');
      if (countError) throw countError;
      const { token_ciphertext: _, ...safe } = connection || {};
      send(res,200,{ configured, connected:!!connection, ...safe, pending:count || 0 }); return;
    }
    if (req.method === 'DELETE') {
      // Stop scheduled access first, even if Google's revocation service is temporarily unavailable.
      const { error: deleteError } = await db.from('gmail_connections').delete().eq('user_id',user.id);
      if (deleteError) throw deleteError;
      const { error: stateError } = await db.from('gmail_oauth_states').delete().eq('user_id',user.id);
      if (stateError) throw stateError;
      if (connection?.token_ciphertext) {
        try { await fetch('https://oauth2.googleapis.com/revoke', { method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:openToken(connection.token_ciphertext,user.id)}),signal:AbortSignal.timeout(10000) }); } catch { /* Connection is already removed. */ }
      }
      send(res,200,{disconnected:true}); return;
    }
    if (req.method !== 'POST') { send(res,405,{error:'Método no permitido.'}); return; }
    const config = googleConfig();
    if (!process.env.CRON_SECRET) throw Error('google_configuration');
    const { data: accounts, error: accountError } = await db.from('accounts').select('id').eq('user_id',user.id).eq('person_tag','diego').eq('currency','COP').ilike('name','Bancolombia');
    if (accountError || accounts?.length !== 1) { send(res,400,{error:'Necesitas una cuenta Bancolombia en COP en Mis cuentas.'}); return; }
    const state=randomToken(), browser=randomToken(), verifier=randomToken();
    await db.from('gmail_oauth_states').delete().eq('user_id',user.id);
    const { error: stateError } = await db.from('gmail_oauth_states').insert({ state_hash:hash(state),user_id:user.id,account_id:accounts[0].id,browser_hash:hash(browser),verifier_ciphertext:sealToken(verifier,user.id),expires_at:new Date(Date.now()+10*60000).toISOString() });
    if (stateError) throw stateError;
    const params=new URLSearchParams({client_id:config.clientId,redirect_uri:config.redirectUri,response_type:'code',scope:gmailReadScope,access_type:'offline',prompt:'consent select_account',login_hint:personalGmail,state,code_challenge:Buffer.from(hash(verifier),'hex').toString('base64url'),code_challenge_method:'S256'});
    res.setHeader('Set-Cookie',`gmail_oauth=${browser}; HttpOnly; Secure; SameSite=Lax; Path=/api/gmail; Max-Age=600`);
    send(res,200,{url:`https://accounts.google.com/o/oauth2/v2/auth?${params}`});
  } catch (e) {
    const code=e instanceof Error ? e.message : '';
    send(res,code==='unauthorized'?401:code==='forbidden'?403:503,{error:code==='google_configuration'||code==='encryption_configuration'?'Falta configurar Google para activar la sincronización.':'No pudimos conectar Gmail. Intenta de nuevo.'});
  }
}
