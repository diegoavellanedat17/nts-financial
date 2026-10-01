import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const diego='11111111-1111-4111-8111-111111111111';
const natalia='22222222-2222-4222-8222-222222222222';
it('importa atómicamente solo para Diego, conserva el origen y evita duplicados incluso al borrar el movimiento',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create schema auth;create role authenticated;create role anon;
  create table auth.users(id uuid primary key,email text);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.user_id',true),'')::uuid$$;
  grant usage on schema auth,public to authenticated,anon;
  insert into auth.users values ('${diego}','diego-access@nts-financial.example.com'),('${natalia}','natalia-access@nts-financial.example.com');`);
  await db.exec(readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
  await db.exec(`set role authenticated;select set_config('app.user_id','${diego}',false);`);
  const source=(await db.query<{id:string}>(`insert into public.income_sources(user_id,person_tag,name,context) values ($1,'diego','Salario','Personal') returning id`,[diego])).rows[0].id;
  const email={account:'Test@Example.com',messageId:'a123',receivedAt:'2026-10-01T15:00:00Z',sender:'Banco',subject:'Pago recibido',excerpt:'Recibiste USD 150.25'};
  const movement={date:'2026-10-01',kind:'income',amount:150.25,currency:'USD',category:'Otros',description:'Pago del trabajo',source_id:source};
  const call=(e= email,m=movement)=>db.query<{result:{duplicate:boolean;transaction?:{id:string;person_tag:string;currency:string;amount:number}}}>('select public.import_gmail_movement($1::jsonb,$2::jsonb) as result',[JSON.stringify(e),JSON.stringify(m)]);
  await expect(call({...email,messageId:'invalid'},{...movement,amount:150.251})).rejects.toThrow();
  expect((await db.query(`select * from public.gmail_imports where message_id='invalid'`)).rows).toHaveLength(0);
  const first=(await call()).rows[0].result;
  expect(first).toMatchObject({duplicate:false,transaction:{person_tag:'diego',currency:'USD',amount:150.25}});
  expect((await call()).rows[0].result).toEqual({duplicate:true});
  expect((await db.query('select * from public.transactions')).rows).toHaveLength(1);
  const receipt=(await db.query<{account_email:string,excerpt:string,transaction_id:string}>('select * from public.gmail_imports')).rows[0];
  expect(receipt.account_email).toBe('test@example.com');expect(receipt.excerpt).toBe(email.excerpt);expect(receipt.transaction_id).toBe(first.transaction!.id);
  await expect(db.query('delete from public.gmail_imports')).rejects.toThrow();
  expect((await db.query(`select * from public.change_history where table_name='transactions'`)).rows).toHaveLength(1);
  await db.query('delete from public.transactions where id=$1',[first.transaction!.id]);
  expect((await call()).rows[0].result).toEqual({duplicate:true});
  expect((await db.query('select * from public.transactions')).rows).toHaveLength(0);
  await db.exec(`select set_config('app.user_id','${natalia}',false);`);
  expect((await db.query('select * from public.gmail_imports')).rows).toHaveLength(0);
  await expect(call({...email,messageId:'other'})).rejects.toThrow('Solo Diego');
  await db.exec(`set role anon;`);
  await expect(call()).rejects.toThrow();
 }finally{await db.close();}
},20000);
