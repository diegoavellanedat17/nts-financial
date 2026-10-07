import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const natalia='11111111-1111-4111-8111-111111111111',diego='22222222-2222-4222-8222-222222222222',movement='33333333-3333-4333-8333-333333333333';
it('guarda respuestas y versiones solo para Natalia sin tocar el movimiento',async()=>{
 const db=new PGlite();try{
 await db.exec(`create schema auth;create role authenticated;create role anon;create role service_role bypassrls;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.user_id',true),'')::uuid$$;grant usage on schema auth,public to authenticated,anon;insert into auth.users values('${natalia}','natalia-access@nts-financial.example.com'),('${diego}','diego-access@nts-financial.example.com');`);
 await db.exec(readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261007120000_office_questions.sql',import.meta.url),'utf8'));
 await db.exec(`insert into public.transactions(id,user_id,person_tag,date,kind,amount,currency,context,category,description,reserved,from_reserve) values('${movement}','${natalia}','natalia','2026-10-06','income',1511547,'COP','Consultorio','Tratamiento','Cobro mixto',1511547,false);set role authenticated;select set_config('app.user_id','${natalia}',false);`);
 const snapshot=JSON.stringify({question:'¿Cuánto está terminado?',amount:1511547,currency:'COP',date:'2026-10-06'});
 const insert=(owner=natalia,answer={amount:500000})=>db.query("insert into public.office_answers(user_id,question_key,kind,transaction_id,snapshot,answer) values($1,$2,'delivered_amount',$3,$4,$5)",[owner,`delivered_amount:${movement}`,movement,snapshot,JSON.stringify(answer)]);
 await expect(insert(natalia,{amount:2000000})).rejects.toThrow();await insert();
 const ledger=await db.query<{amount:string;reserved:string}>('select amount::text,reserved::text from public.transactions');expect(ledger.rows).toEqual([{amount:'1511547',reserved:'1511547'}]);
 await db.exec("update public.office_answers set answer='{"+'"amount":600000'+"}'");expect((await db.query('select * from public.office_answer_history')).rows).toHaveLength(2);
 await db.exec(`select set_config('app.user_id','${diego}',false);`);expect((await db.query('select * from public.office_answers')).rows).toHaveLength(0);expect((await db.query('select * from public.office_answer_history')).rows).toHaveLength(0);await expect(insert(diego)).rejects.toThrow();
 await db.exec(`select set_config('app.user_id','${natalia}',false);delete from public.transactions where id='${movement}';`);expect((await db.query('select * from public.office_answers')).rows).toHaveLength(1);
 await db.exec('set role anon');await expect(db.query('select * from public.office_answers')).rejects.toThrow();
 }finally{await db.close();}
},20000);
