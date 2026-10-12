import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
const diego='00000000-0000-0000-0000-000000000001',natalia='00000000-0000-0000-0000-000000000002',outsider='00000000-0000-0000-0000-000000000003';
let db:PGlite;
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role authenticated;create role anon;create schema auth;
 create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.user_id',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,anon;
 insert into auth.users values('${diego}','diego-access@nts-financial.example.com'),('${natalia}','natalia-access@nts-financial.example.com'),('${outsider}','outsider@example.com');
 create table public.transactions(user_id uuid,person_tag text,kind text,category text,currency text,amount numeric,flow_type text,context text,date date,balance_check_id uuid,transfer_id uuid,transfer_role text);
 alter table public.transactions enable row level security;
 grant select on public.transactions to authenticated;
 create policy own_rows on public.transactions for select to authenticated using(user_id=auth.uid());
 insert into public.transactions(user_id,person_tag,kind,category,currency,amount,flow_type,context,date) values
 ('${diego}','diego','expense','Alimentación','COP',100,'operating','Personal',(now() at time zone 'America/Bogota')::date),
 ('${natalia}','natalia','expense','Compras','USD',2,'operating','Personal',(now() at time zone 'America/Bogota')::date),
 ('${natalia}','natalia','income','Honorarios','COP',300,'operating','Clínica 1',(now() at time zone 'America/Bogota')::date),
 ('${natalia}','natalia','income','Tratamiento','COP',999,'operating','Consultorio',(now() at time zone 'America/Bogota')::date),
 ('${diego}','diego','income','Otros','COP',999,'opening_balance','Personal',(now() at time zone 'America/Bogota')::date),
 ('${diego}','diego','income','Otros','COP',999,'transfer','Personal',(now() at time zone 'America/Bogota')::date),
 ('${diego}','diego','expense','Servicios','COP',999,'operating','Personal',(now() at time zone 'America/Bogota')::date+1),
 ('${outsider}','diego','expense','Otros','COP',999,'operating','Personal',(now() at time zone 'America/Bogota')::date);
 insert into public.transactions(user_id,person_tag,kind,category,currency,amount,flow_type,context,date,transfer_id,transfer_role) values('${diego}','diego','expense','Servicios','COP',5,'operating','Personal',(now() at time zone 'America/Bogota')::date,'${diego}','fee');`);
 await db.exec(readFileSync(new URL('../supabase/migrations/20261012010000_general_summary.sql',import.meta.url),'utf8'));
},20000);
afterAll(async()=>{await db?.close();});
describe('General: solo totales personales compartidos',()=>{
 it('ambos ven los mismos agregados, mantienen privado el detalle y excluyen consultorio, transferencias, conciliaciones y fechas futuras',async()=>{
  let previous:unknown;
  for(const owner of [diego,natalia]){
   await db.exec(`set role authenticated;select set_config('app.user_id','${owner}',false)`);
   const result=await db.query(`select * from public.general_summary(to_char(now() at time zone 'America/Bogota','YYYY-MM'))`);
   expect(result.rows).toHaveLength(4);
   expect(result.rows.every(r=>Object.keys(r as object).sort().join(',')==='amount,category,currency,kind,person_tag')).toBe(true);
   expect(result.rows.map(r=>(r as {amount:string}).amount)).toEqual(['100','5','2','300']);
   if(previous)expect(result.rows).toEqual(previous);previous=result.rows;
   const direct=await db.query<{user_id:string}>('select user_id from public.transactions');
   expect(direct.rows.every(r=>r.user_id===owner)).toBe(true);
  }
 });
 it('rechaza otras personas, usuarios sin sesión, meses inválidos y acceso anónimo',async()=>{
  await db.exec(`set role authenticated;select set_config('app.user_id','${outsider}',false)`);
  await expect(db.query("select * from public.general_summary('2026-10')")).rejects.toThrow();
  await db.exec(`select set_config('app.user_id','',false)`);
  await expect(db.query("select * from public.general_summary('2026-10')")).rejects.toThrow();
  await db.exec(`select set_config('app.user_id','${diego}',false)`);
  await expect(db.query("select * from public.general_summary('2026-13')")).rejects.toThrow();
  await db.exec('set role anon');
  await expect(db.query("select * from public.general_summary('2026-10')")).rejects.toThrow();
 });
});
