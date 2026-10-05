import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const source = '33333333-3333-4333-8333-333333333333';
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261001000000_reporting_foundation.sql', import.meta.url), 'utf8');
const auth = `create schema auth; create role authenticated; create role anon;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
grant usage on schema auth, public to authenticated, anon;
insert into auth.users values ('${alice}'), ('${bob}');`;
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(auth);
  await db.exec(schema);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261005160000_debt_category.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into public.income_sources(id,user_id,name,context) values ('${source}','${alice}','Clínica Real','Clínica 1');
insert into public.transactions(id,user_id,date,competence_date,kind,amount,context,category,description,source_id) values
(gen_random_uuid(),'${alice}','2026-10-05','2026-09-20','income',1000000,'Clínica 1','Honorarios','Trabajo septiembre','${source}'),
(gen_random_uuid(),'${alice}','2026-10-06','2026-10-06','expense',100000,'Personal','Alimentación','Mercado',null),
(gen_random_uuid(),'${bob}','2026-10-06','2026-10-06','expense',200000,'Personal','Compras','Gasto privado',null);
insert into public.transactions(id,user_id,date,kind,amount,context,category,description,flow_type) values
(gen_random_uuid(),'${alice}','2026-10-01','income',500000,'Personal','Otros','Inicio','opening_balance');`);
}, 20000);
afterAll(async () => { await db?.close(); });
async function asAlice() { await db.exec(`set role authenticated; select set_config('app.user_id','${alice}',false);`); }
describe('Base de reportes y seguridad de Supabase (Postgres local)', () => {
  it('permite reclasificar una deuda sin cambiar el dinero y mantiene válidas las categorías', async () => {
    await asAlice();
    const before = await db.query<{ total: string }>("select sum(amount)::text as total from public.transactions");
    await db.exec("update public.transactions set category='Deudas' where kind='expense' and description='Mercado'");
    const debt = await db.query<{ amount: string }>("select amount::text from public.transactions where category='Deudas'");
    expect(debt.rows).toEqual([{ amount: '100000' }]);
    const after = await db.query<{ total: string }>("select sum(amount)::text as total from public.transactions");
    expect(after.rows).toEqual(before.rows);
    await expect(db.exec("update public.transactions set category='Deudas' where kind='income'")).rejects.toThrow();
    await expect(db.exec("update public.transactions set category='Inventada' where kind='expense'")).rejects.toThrow();
    await db.exec("update public.transactions set category='Alimentación' where description='Mercado'");
  });

  it('separa fecha de pago de fecha de periodo y excluye saldo inicial de PyL', async () => {
    await asAlice();
    const cash = await db.query<{ received: string }>('select sum(received_cop)::text as received from public.cashflow_monthly');
    expect(cash.rows[0].received).toBe('1500000');
    const pnl = await db.query<{ month: string; amount: string }>("select month::text, amount_cop::text as amount from public.pnl_recorded_monthly where kind = 'income'");
    expect(pnl.rows).toEqual([{ month: '2026-09-01', amount: '1000000' }]);
  });
  it('las vistas no exponen datos de otra persona y exportan fuente/categoría', async () => {
    await asAlice();
    for (const view of ['movements_export', 'cashflow_monthly', 'pnl_recorded_monthly', 'spending_monthly']) {
      const result = await db.query<{ person_id: string }>(`select distinct person_id from public.${view}`);
      expect(result.rows.every(r => r.person_id === alice)).toBe(true);
    }
    const rows = await db.query<{ income_source: string }>("select income_source from public.movements_export where source_id is not null");
    expect(rows.rows[0].income_source).toBe('Clínica Real');
    const spending = await db.query<{ category: string; spent: string }>('select category, spent_cop::text as spent from public.spending_monthly');
    expect(spending.rows).toEqual([{ category: 'Alimentación', spent: '100000' }]);
  });
  it('rechaza movimientos asignados a otra persona y fuentes ajenas', async () => {
    await asAlice();
    await expect(db.query('insert into public.income_sources(user_id,name,context) values ($1,$2,$3)', [bob, 'Ajena', 'Personal'])).rejects.toThrow();
    await db.exec('reset role');
    await db.exec(`insert into public.income_sources(id,user_id,name,context) values ('44444444-4444-4444-8444-444444444444','${bob}','Privada','Clínica 1');`);
    await asAlice();
    await expect(db.query(`insert into public.transactions(id,user_id,date,kind,amount,context,category,description,source_id) values (gen_random_uuid(),$1,'2026-10-10','income',100,'Clínica 1','Honorarios','Prueba',$2)`, [alice, '44444444-4444-4444-8444-444444444444'])).rejects.toThrow();
  });
  it('impide cambiar de espacio una fuente usada y niega acceso anónimo', async () => {
    await asAlice();
    await expect(db.query('update public.income_sources set context = $1 where id = $2', ['Consultorio', source])).rejects.toThrow();
    await db.exec('reset role; set role anon');
    await expect(db.query('select * from public.movements_export')).rejects.toThrow();
    await db.exec('reset role');
  });
  it('migra registros anteriores sin perder monto, fecha, reserva o presupuesto, y se puede repetir', async () => {
    const old = new PGlite();
    try {
      await old.exec(auth);
      await old.exec(schema.split('-- Base de fuentes y reportes')[0]);
      await old.exec(`insert into public.transactions(id,user_id,date,kind,amount,context,category,description,reserved)
values (gen_random_uuid(),'${alice}','2026-09-01','income',900000,'Consultorio','Tratamiento','Anterior',300000);
insert into public.budgets values ('${alice}','2026-09',400000);`);
      await old.exec(migration);
      await old.exec(migration);
      const row = await old.query<{ amount: number; reserved: number; source_id: string; competence_date: string }>('select amount, reserved, source_id, competence_date::text from public.transactions');
      expect(row.rows[0].amount).toBe(900000);
      expect(row.rows[0].reserved).toBe(300000);
      expect(row.rows[0].competence_date).toBe('2026-09-01');
      expect(row.rows[0].source_id).toBeTruthy();
      expect((await old.query<{ count: number }>('select count(*)::int as count from public.income_sources')).rows[0].count).toBe(4);
      expect((await old.query<{ amount: number }>('select amount from public.budgets')).rows[0].amount).toBe(400000);
    } finally { await old.close(); }
  }, 20000);
});
it('aplica reglas del propietario, respeta correcciones y libera abonos sin otro ingreso', async()=>{
 await asAlice();
 await db.query("insert into public.classification_rules(user_id,person_tag,rule_key,name,keywords,context,category) values($1,'natalia','transport_v1','Transporte',array['didi'],'Personal','Transporte')",[alice]);
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 await db.query("insert into public.transactions(id,user_id,date,kind,amount,context,category,description) values($1,$2,'2000-01-01','expense',100,'Consultorio','Otros','Didi')",[id,alice]);
 expect((await db.query('select context,category,classification_rule_key from public.transactions where id=$1',[id])).rows[0]).toEqual({context:'Personal',category:'Transporte',classification_rule_key:'transport_v1'});
 await db.query("update public.transactions set category='Compras' where id=$1",[id]);
 expect((await db.query('select classification_rule_key from public.transactions where id=$1',[id])).rows[0]).toEqual({classification_rule_key:null});
 const abono='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 await db.query("insert into public.transactions(id,user_id,date,kind,amount,context,category,description,reserved,patient_advance) values($1,$2,'2000-01-01','income',1650000,'Consultorio','Tratamiento','Abono',1650000,true)",[abono,alice]);
 await db.exec(`select set_config('app.user_id','${bob}',false)`);
 await expect(db.query('select public.release_patient_advance($1)',[abono])).rejects.toThrow();
 expect((await db.query('select * from public.classification_rules')).rows).toHaveLength(0);
 await asAlice(); await db.query('select public.release_patient_advance($1)',[abono]);
 const released=(await db.query<{amount:string;reserve_release_date:string}>('select amount,reserve_release_date from public.transactions where id=$1',[abono])).rows[0];
 expect(Number(released.amount)).toBe(1650000);expect(released.reserve_release_date).toBeTruthy();
 expect((await db.query("select id from public.change_history where record_id=$1 and operation='UPDATE'",[abono])).rows).toHaveLength(1);
 await expect(db.query('select public.release_patient_advance($1)',[abono])).rejects.toThrow();
});
