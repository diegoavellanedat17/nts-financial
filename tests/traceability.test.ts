import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const user='11111111-1111-4111-8111-111111111111';
it('conserva versiones al corregir/eliminar, separa tags y protege el historial', async () => {
 const db=new PGlite();
 try {
  await db.exec(`create schema auth; create role authenticated; create role anon; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.user_id',true),'')::uuid $$;
  grant usage on schema auth,public to authenticated,anon;
  insert into auth.users values ('${user}'),('22222222-2222-4222-8222-222222222222');`);
  await db.exec(readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
  await db.exec(`set role authenticated; select set_config('app.user_id','${user}',false);`);
  const source=await db.query<{id:string}>(`insert into public.income_sources(user_id,person_tag,name,context) values ($1,'natalia','Salario','Personal') returning id`,[user]);
  await db.query(`insert into public.income_sources(user_id,person_tag,name,context) values ($1,'diego','Salario','Personal')`,[user]);
  await expect(db.query(`insert into public.transactions(id,user_id,person_tag,date,kind,amount,context,category,description,source_id) values (gen_random_uuid(),$1,'diego','2026-10-01','income',100,'Personal','Otros','Ajena',$2)`,[user,source.rows[0].id])).rejects.toThrow();
  const row=await db.query<{id:string,created_at:Date}>(`insert into public.transactions(id,user_id,date,kind,amount,context,category,description) values (gen_random_uuid(),$1,'2026-10-01','expense',100,'Personal','Otros','Prueba') returning id,created_at`,[user]);
  const id=row.rows[0].id;
  await db.query(`update public.transactions set amount=200,created_at='2000-01-01' where id=$1`,[id]);
  await db.query(`update public.transactions set amount=200 where id=$1`,[id]);
  const same=await db.query<{created_at:Date}>(`select created_at from public.transactions where id=$1`,[id]);expect(same.rows[0].created_at).toEqual(row.rows[0].created_at);
  await db.query(`delete from public.transactions where id=$1`,[id]);
  const history=await db.query<{operation:string,before_data:{amount:number}|null,after_data:{amount:number}|null,actor_user_id:string}>(`select * from public.change_history where record_id=$1 order by event_sequence`,[id]);
  expect(history.rows.map(x=>x.operation)).toEqual(['INSERT','UPDATE','DELETE']);
  expect(history.rows[1].before_data?.amount).toBe(100);expect(history.rows[1].after_data?.amount).toBe(200);expect(history.rows[2].before_data?.amount).toBe(200);
  expect(history.rows.every(x=>x.actor_user_id===user)).toBe(true);
  await expect(db.query('delete from public.change_history')).rejects.toThrow();
  await expect(db.query(`insert into public.change_history(table_name,record_id,user_id,person_tag,operation) values ('transactions',gen_random_uuid(),$1,'natalia','DELETE')`,[user])).rejects.toThrow();
  await db.exec(`select set_config('app.user_id','22222222-2222-4222-8222-222222222222',false);`);
  expect((await db.query('select * from public.change_history')).rows).toHaveLength(0);
  await db.exec(`select set_config('app.user_id','${user}',false);`);
  const text='  Laboratorio pagado por mí\nClínica pendiente  ';
  const note=await db.query<{id:string,body:string}>(`insert into public.notes(user_id,person_tag,body) values ($1,'natalia',$2) returning id,body`,[user,text]);
  expect(note.rows[0].body).toBe(text);
  await expect(db.query(`insert into public.notes(user_id,body) values ($1,$2)`,[user,' \n\t '])).rejects.toThrow();
  await db.exec(`select set_config('app.user_id','22222222-2222-4222-8222-222222222222',false);`);
  expect((await db.query('select * from public.notes')).rows).toHaveLength(0);
  expect((await db.query(`update public.notes set body='Ajena' returning id`)).rows).toHaveLength(0);
  await db.exec(`select set_config('app.user_id','${user}',false);`);
  await db.query(`update public.notes set body=$1 where id=$2`,['Corregida',note.rows[0].id]);
  await db.query('delete from public.notes where id=$1',[note.rows[0].id]);
  const noteHistory=await db.query<{operation:string,before_data:{body:string}|null}>(`select operation,before_data from public.change_history where record_id=$1 order by event_sequence`,[note.rows[0].id]);
  expect(noteHistory.rows.map(x=>x.operation)).toEqual(['INSERT','UPDATE','DELETE']);
  expect(noteHistory.rows[1].before_data?.body).toBe(text);
  expect(noteHistory.rows[2].before_data?.body).toBe('Corregida');

 } finally {await db.close();}
},20000);
