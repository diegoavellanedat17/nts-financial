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
 create table public.transactions(user_id uuid,person_tag text,kind text,category text,currency text,amount numeric,flow_type text,context text,date date,balance_check_id uuid,transfer_id uuid,transfer_role text,reserved numeric not null default 0,reserve_release_date date);
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
 await db.exec(readFileSync(new URL('../supabase/migrations/20261012020000_general_office_advances.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261012030000_general_personal_expenses.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261013010000_general_plans_health.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261017010000_general_python.sql',import.meta.url),'utf8'));
 await db.exec(`insert into public.transactions(user_id,person_tag,kind,category,currency,amount,flow_type,context,date,reserved,reserve_release_date) values
 ('${natalia}','natalia','income','Tratamiento','COP',100,'operating','Consultorio',(now() at time zone 'America/Bogota')::date,100,null),
 ('${natalia}','natalia','income','Tratamiento','COP',200,'operating','Consultorio',(now() at time zone 'America/Bogota')::date,200,(now() at time zone 'America/Bogota')::date),
 ('${natalia}','natalia','expense','Laboratorio','COP',40,'operating','Consultorio',(now() at time zone 'America/Bogota')::date,0,null);`);
},20000);
afterAll(async()=>{await db?.close();});
describe('General: totales compartidos y abonos apartados',()=>{
 it('ambos ven los mismos agregados, mantienen privado el detalle y incluyen ingresos del consultorio y excluyen sus gastos, transferencias, conciliaciones y fechas futuras',async()=>{
  let previous:unknown;
  for(const owner of [diego,natalia]){
   await db.exec(`set role authenticated;select set_config('app.user_id','${owner}',false)`);
   const result=await db.query(`select * from public.general_summary(to_char(now() at time zone 'America/Bogota','YYYY-MM'))`);
   expect(result.rows).toHaveLength(5);
   expect(result.rows.every(r=>Object.keys(r as object).sort().join(',')==='amount,category,currency,kind,pending_amount,person_tag')).toBe(true);
   expect(result.rows.map(r=>(r as {amount:string}).amount)).toEqual(['100','5','2','1299','300']);
   const officeIncome=result.rows.find(r=>(r as {category:string;kind:string}).category==='Consultorio'&&(r as {kind:string}).kind==='income');
   expect(result.rows.some(r=>(r as {category:string;kind:string}).category==='Consultorio'&&(r as {kind:string}).kind==='expense')).toBe(false);
   expect(officeIncome).toMatchObject({amount:'1299',pending_amount:'100'});
   expect(result.rows.filter(r=>(r as {pending_amount:string}).pending_amount!=='0')).toHaveLength(1);
   if(previous)expect(result.rows).toEqual(previous);previous=result.rows;
   const direct=await db.query<{user_id:string}>('select user_id from public.transactions');
   expect(direct.rows.every(r=>r.user_id===owner)).toBe(true);
  }
 });
 it('conserva Planes, Salud y Python como categorías generales distintas sin mover el dinero',async()=>{
  await db.exec('reset role');
  await db.exec(`insert into public.transactions(user_id,person_tag,kind,category,currency,amount,flow_type,context,date) values
   ('${diego}','diego','expense','Planes','COP',50,'operating','Personal',(now() at time zone 'America/Bogota')::date),
   ('${natalia}','natalia','expense','Salud','COP',80,'operating','Personal',(now() at time zone 'America/Bogota')::date),
   ('${diego}','diego','expense','Python','COP',65,'operating','Personal',(now() at time zone 'America/Bogota')::date);`);
  await db.exec(`set role authenticated;select set_config('app.user_id','${diego}',false)`);
  const result=await db.query<{category:string;amount:string}>(`select category,amount::text from public.general_summary(to_char(now() at time zone 'America/Bogota','YYYY-MM')) where category in ('Planes','Salud','Python') order by category`);
  expect(result.rows).toEqual([{category:'Planes',amount:'50'},{category:'Python',amount:'65'},{category:'Salud',amount:'80'}]);
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
