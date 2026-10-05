import type { IncomingMessage, ServerResponse } from 'node:http';
import { googleConfig, googleTokens, hash, openToken, sealToken, serverDb, verifyPersonalGmail } from '../../lib/gmailServer.ts';
import { diegoEmail, personalGmail } from '../../lib/gmailAutomatic.ts';
export default async function handler(req:IncomingMessage,res:ServerResponse) {
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  let result='error';
  try {
    if (req.method !== 'GET') throw Error('method');
    const config=googleConfig(), params=new URL(req.url || '',config.origin).searchParams;
    const state=params.get('state'), code=params.get('code');
    const browser=req.headers.cookie?.split(';').map(c=>c.trim()).find(c=>c.startsWith('gmail_oauth='))?.slice('gmail_oauth='.length);
    if (!state || !browser) throw Error('invalid_state');
    const db=serverDb();
    // Only the originating browser can consume this short-lived, single-use state.
    const {data:pending,error}=await db.from('gmail_oauth_states').delete().eq('state_hash',hash(state)).eq('browser_hash',hash(browser)).gt('expires_at',new Date().toISOString()).select().maybeSingle();
    if(error || !pending || !code || params.has('error')) throw Error('invalid_state');
    const {data:{user},error:userError}=await db.auth.admin.getUserById(pending.user_id);
    if(userError || user?.email!==diegoEmail)throw Error('invalid_owner');
    const tokens=await googleTokens({grant_type:'authorization_code',code,redirect_uri:config.redirectUri,code_verifier:openToken(pending.verifier_ciphertext,pending.user_id)});
    await verifyPersonalGmail(tokens.access_token);
    if(!tokens.refresh_token)throw Error('missing_refresh_token');
    const {data:old,error:oldError}=await db.from('gmail_connections').select('user_id').eq('user_id',pending.user_id).maybeSingle();
    if(oldError)throw oldError;
    const values={account_email:personalGmail,account_id:pending.account_id,token_ciphertext:sealToken(tokens.refresh_token,pending.user_id),status:'active',last_error:null,lease_id:null,lease_until:null,updated_at:new Date().toISOString()};
    const saved=old ? await db.from('gmail_connections').update(values).eq('user_id',pending.user_id) : await db.from('gmail_connections').insert({user_id:pending.user_id,...values});
    if(saved.error)throw saved.error;
    result='connected';
  } catch { /* Never put authorization codes, tokens or Google responses in the page or logs. */ }
  res.setHeader('Set-Cookie','gmail_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api/gmail; Max-Age=0');
  res.statusCode=303;res.setHeader('Location',`/?gmail_sync=${result}`);res.end();
}
