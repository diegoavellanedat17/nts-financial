import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { it,expect } from 'vitest';
const diego='11111111-1111-4111-8111-111111111111',natalia='22222222-2222-4222-8222-222222222222';
it('guarda Mercado y Tarjeta de crédito, conserva categorías y RLS, y las distingue en General',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create schema auth;create role authenticated;create role anon;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.user_id',true),'')::uuid$$;grant usage on schema auth,public to authenticated,anon;insert into auth.users values('${diego}','diego-access@nts-financial.example.com'),('${natalia}','natalia-access@nts-financial.example.com');`);
  await db.exec(readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
  // Run against a pre-change constraint/function too, to verify the real upgrade path.
  await db.exec(readFileSync(new URL('../supabase/migrations/20261017000000_python_category.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20261017010000_general_python.sql',import.meta.url),'utf8'));
  await db.exec(`insert into public.transactions(id,user_id,person_tag,date,kind,amount,currency,context,category,description) values(gen_random_uuid(),'${diego}','diego',(now() at time zone 'America/Bogota')::date,'expense',100,'COP','Personal','Hogar','Antes de migración');`);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261104000000_grocery_credit_categories.sql',import.meta.url),'utf8'));
  expect((await db.query('select id from public.transactions')).rows).toHaveLength(1);
  for(const [user,tag,category,amount] of [[diego,'diego','Mercado',200],[natalia,'natalia','Tarjeta de crédito',300]] as const){
   await db.exec(`set role authenticated;select set_config('app.user_id','${user}',false);`);
   await db.query("insert into public.transactions(id,user_id,person_tag,date,kind,amount,currency,context,category,description) values(gen_random_uuid(),$1,$2,(now() at time zone 'America/Bogota')::date,'expense',$4,'COP','Personal',$3,'Compra o pago')",[user,tag,category,amount]);
  }
  expect((await db.query('select category from public.transactions')).rows).toEqual([{category:'Tarjeta de crédito'}]);
  await expect(db.query("update public.transactions set category='No existe' where user_id=$1",[natalia])).rejects.toThrow();
  await expect(db.query("update public.transactions set amount=-1 where user_id=$1",[natalia])).rejects.toThrow();
  const summary=await db.query<{category:string;amount:string}>("select category,amount::text from public.general_summary(to_char(now() at time zone 'America/Bogota','YYYY-MM')) order by category");
  expect(summary.rows).toEqual([{category:'Hogar',amount:'100'},{category:'Mercado',amount:'200'},{category:'Tarjeta de crédito',amount:'300'}]);
 }finally{await db.close();}
},20000);
