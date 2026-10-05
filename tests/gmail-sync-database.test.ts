import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const diego='11111111-1111-4111-8111-111111111111',natalia='22222222-2222-4222-8222-222222222222',bank='33333333-3333-4333-8333-333333333333',lease='44444444-4444-4444-8444-444444444444';
it('importa con exclusión mutua, aislamiento y comprobante único; manda coincidencias a revisión',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create schema auth;create role authenticated;create role anon;create role service_role bypassrls;
  create table auth.users(id uuid primary key,email text);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.user_id',true),'')::uuid$$;
  grant usage on schema auth,public to authenticated,anon,service_role;
  insert into auth.users values('${diego}','diego-access@nts-financial.example.com'),('${natalia}','natalia-access@nts-financial.example.com');`);
  await db.exec(readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20261005170000_gmail_nightly_sync.sql',import.meta.url),'utf8'));
  await db.exec(`insert into public.accounts(id,user_id,person_tag,name,currency) values('${bank}','${diego}','diego','Bancolombia','COP');
  insert into public.gmail_connections(user_id,account_email,account_id,token_ciphertext) values('${diego}','diego.avellaneda1733@gmail.com','${bank}','encrypted');`);
  const claim=()=>db.query('select * from public.claim_gmail_sync($1,$2)',[diego,lease]);
  expect((await claim()).rows).toHaveLength(1);expect((await claim()).rows).toHaveLength(0);
  const c={messageId:'mail1',account:'diego.avellaneda1733@gmail.com',receivedAt:'2026-10-01T15:00:00Z',sender:'Banco',subject:'Aviso',excerpt:'Compraste COP 30000'};
  const m={date:'2026-10-01',kind:'expense',amount:30000,currency:'COP',category:'Otros',description:'OXXO',counterparty:'OXXO',flow_type:'operating',account_id:bank};
  const run=(candidate=c,movement:typeof m|null=m)=>db.query<{result:string}>('select public.import_automatic_gmail($1,$2,$3,$4) as result',[diego,lease,JSON.stringify(candidate),movement?JSON.stringify(movement):null]);
  expect((await run()).rows[0].result).toBe('imported');expect((await run()).rows[0].result).toBe('duplicate');
  const t=await db.query<{user_id:string;amount:string;account_id:string;reference:string}>('select user_id,amount::text,account_id,reference from public.transactions');
  expect(t.rows).toEqual([{user_id:diego,amount:'30000',account_id:bank,reference:'gmail:mail1'}]);
  expect((await run({...c,messageId:'mail2'})).rows[0].result).toBe('review');
  expect((await run({...c,messageId:'mail3'},null)).rows[0].result).toBe('review');
  expect((await db.query('select * from public.transactions')).rows).toHaveLength(1);
  // A manual import resolves its queued review without exposing tokens to either person.
  await db.exec(`insert into public.gmail_imports(user_id,account_email,message_id,transaction_id,received_at,sender,subject,excerpt) values('${diego}','diego.avellaneda1733@gmail.com','mail3',gen_random_uuid(),now(),'Banco','Aviso','Texto');`);
  expect((await db.query<{status:string}>("select status from public.gmail_sync_reviews where message_id='mail3'")).rows[0].status).toBe('imported');
  await db.exec(`set role authenticated; select set_config('app.user_id','${natalia}',false);`);
  expect((await db.query('select * from public.gmail_sync_reviews')).rows).toHaveLength(0);
  await expect(db.exec('select token_ciphertext from public.gmail_connections')).rejects.toThrow();await expect(claim()).rejects.toThrow();await expect(run()).rejects.toThrow();
  await db.exec(`select set_config('app.user_id','${diego}',false);`);
  await expect(db.exec("update public.gmail_sync_reviews set candidate='{}'")).rejects.toThrow();
  await db.exec("update public.gmail_sync_reviews set status='ignored' where message_id='mail2'");
  await db.exec(`reset role;update public.gmail_connections set status='paused' where user_id='${diego}';`);
  await expect(run({...c,messageId:'mail4'})).rejects.toThrow('lease expired');
 }finally{await db.close();}
},20000);
