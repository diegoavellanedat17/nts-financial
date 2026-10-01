-- Ejecutar una vez desde el SQL Editor del proyecto Supabase.
create table public.transactions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('income', 'expense')),
  amount bigint not null check (amount between 1 and 999999999),
  context text not null check (context in ('Personal', 'Consultorio', 'Clínica 1', 'Clínica 2')),
  category text not null,
  description text not null check (char_length(trim(description)) between 1 and 120),
  reserved bigint not null default 0 check (reserved >= 0 and reserved <= amount),
  from_reserve boolean not null default false,
  created_at timestamptz not null default now(),
  check ((kind = 'income' and not from_reserve) or (kind = 'expense' and reserved = 0)),
  check (context <> 'Personal' or (reserved = 0 and not from_reserve)),
  check ((kind = 'income' and category in ('Consulta', 'Tratamiento', 'Honorarios', 'Otros')) or
    (kind = 'expense' and category in ('Alimentación', 'Transporte', 'Hogar', 'Compras', 'Bienestar', 'Arriendo consultorio', 'Materiales', 'Laboratorio', 'Servicios', 'Otros')))
);
create index transactions_user_date_idx on public.transactions(user_id, date desc);
create table public.budgets (
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount bigint not null check (amount between 1 and 999999999),
  primary key (user_id, month)
);
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
create policy "Own transactions only" on public.transactions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own budgets only" on public.budgets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.transactions, public.budgets from anon;
grant select, insert, update, delete on public.transactions, public.budgets to authenticated;

-- Base de fuentes y reportes (incluida para instalaciones nuevas).
-- Migración aditiva para la versión anterior. Ejecutar en el SQL Editor.
-- Postgres 15+ para vistas security_invoker.
begin;
create table if not exists public.income_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  context text not null check (context in ('Personal', 'Consultorio', 'Clínica 1', 'Clínica 2')),
  created_at timestamptz not null default now(),
  unique (user_id, name),
  unique (id, user_id, context)
);
alter table public.income_sources enable row level security;
drop policy if exists "Own sources only" on public.income_sources;
create policy "Own sources only" on public.income_sources for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.income_sources from anon;
grant select, insert, update on public.income_sources to authenticated;

alter table public.transactions add column if not exists source_id uuid;
alter table public.transactions add column if not exists competence_date date;
alter table public.transactions add column if not exists flow_type text not null default 'operating';
update public.transactions set competence_date = date where competence_date is null;
alter table public.transactions alter column competence_date set not null;
create or replace function public.fill_competence_date() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.competence_date is null then new.competence_date := new.date; end if;
  return new;
end;
$$;
drop trigger if exists transactions_competence_default on public.transactions;
create trigger transactions_competence_default before insert or update on public.transactions
for each row execute function public.fill_competence_date();
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_flow_type_check' and conrelid = 'public.transactions'::regclass) then
    alter table public.transactions add constraint transactions_flow_type_check check (flow_type in ('operating', 'opening_balance', 'financing', 'transfer'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_source_owner_fkey' and conrelid = 'public.transactions'::regclass) then
    alter table public.transactions add constraint transactions_source_owner_fkey foreign key (source_id, user_id, context) references public.income_sources(id, user_id, context);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_income_source_check' and conrelid = 'public.transactions'::regclass) then
    alter table public.transactions add constraint transactions_income_source_check check (kind = 'income' or source_id is null);
  end if;
end $$;
-- Los datos existentes conservan su origen y la fecha original como periodo.
insert into public.income_sources(user_id, name, context)
select distinct t.user_id, case when c.context = 'Personal' then 'Otro ingreso' else c.context end, c.context
from public.transactions t cross join (values ('Personal'), ('Consultorio'), ('Clínica 1'), ('Clínica 2')) c(context)
on conflict (user_id, name) do nothing;
update public.transactions t set source_id = s.id
from public.income_sources s
where t.kind = 'income' and t.source_id is null and t.user_id = s.user_id and t.context = s.context
  and s.name = case when t.context = 'Personal' then 'Otro ingreso' else t.context end;
create index if not exists transactions_user_competence_idx on public.transactions(user_id, competence_date);
create index if not exists transactions_source_idx on public.transactions(source_id);

-- Una fila por movimiento, para exportar desde SQL Editor o por la API.
create or replace view public.movements_export with (security_invoker = true) as
select t.id as transaction_id, t.user_id as person_id, t.date as payment_date,
  t.competence_date, t.kind, t.flow_type, t.context, t.source_id,
  case when t.kind = 'income' then coalesce(s.name, t.context) end as income_source,
  t.category, t.description, 'COP'::text as currency, t.amount as amount_cop,
  case when t.kind = 'income' then t.amount else -t.amount end as cashflow_cop,
  t.reserved as reserved_cop, t.from_reserve, t.created_at
from public.transactions t
left join public.income_sources s on s.id = t.source_id and s.user_id = t.user_id;

-- Flujo de caja: fecha efectiva del movimiento, todos los tipos de flujo.
create or replace view public.cashflow_monthly with (security_invoker = true) as
select user_id as person_id, date_trunc('month', date)::date as month,
  context, flow_type,
  sum(case when kind = 'income' then amount else 0 end) as received_cop,
  sum(case when kind = 'expense' then amount else 0 end) as paid_cop,
  sum(case when kind = 'income' then amount else -amount end) as net_cashflow_cop
from public.transactions
group by user_id, date_trunc('month', date)::date, context, flow_type;

-- Base para PyL de operaciones REGISTRADAS: no incluye facturas aún sin cobrar/pagar.
-- Separar Personal de Consultorio al analizar; no sumar gasto personal como costo clínico.
create or replace view public.pnl_recorded_monthly with (security_invoker = true) as
select user_id as person_id, date_trunc('month', competence_date)::date as month,
  context, kind, category,
  sum(amount) as amount_cop,
  sum(case when kind = 'income' then amount else -amount end) as recorded_result_cop
from public.transactions
where flow_type = 'operating'
group by user_id, date_trunc('month', competence_date)::date, context, kind, category;

create or replace view public.spending_monthly with (security_invoker = true) as
select user_id as person_id, date_trunc('month', date)::date as month,
  context, category, sum(amount) as spent_cop
from public.transactions
where kind = 'expense' and flow_type = 'operating'
group by user_id, date_trunc('month', date)::date, context, category;
revoke all on public.movements_export, public.cashflow_monthly, public.pnl_recorded_monthly, public.spending_monthly from anon;
grant select on public.movements_export, public.cashflow_monthly, public.pnl_recorded_monthly, public.spending_monthly to authenticated;
commit;

-- Personas y trazabilidad
begin;
alter table public.transactions add column person_tag text not null default 'natalia' check (person_tag ~ '^[a-z][a-z0-9_]{0,39}$');
alter table public.transactions add column counterparty text not null default '' check (char_length(counterparty) <= 120);
alter table public.transactions add column reference text not null default '' check (char_length(reference) <= 120);
alter table public.transactions add column payment_method text not null default 'unspecified' check (payment_method in ('unspecified','cash','bank_transfer','debit_card','credit_card','other'));
alter table public.transactions add column updated_at timestamptz not null default now();
alter table public.income_sources add column person_tag text not null default 'natalia' check (person_tag ~ '^[a-z][a-z0-9_]{0,39}$');
alter table public.income_sources add column updated_at timestamptz not null default now();
alter table public.income_sources drop constraint income_sources_user_id_name_key;
alter table public.income_sources add constraint income_sources_person_name_key unique(user_id,person_tag,name);
alter table public.income_sources add constraint income_sources_person_owner_key unique(id,user_id,context,person_tag);
alter table public.transactions drop constraint transactions_source_owner_fkey;
alter table public.transactions add constraint transactions_source_owner_fkey foreign key(source_id,user_id,context,person_tag) references public.income_sources(id,user_id,context,person_tag);
create index transactions_person_date_idx on public.transactions(user_id,person_tag,date desc);
create index income_sources_person_idx on public.income_sources(user_id,person_tag);

-- Historial independiente: una eliminación no borra sus versiones anteriores.
create table public.change_history (
 id uuid primary key default gen_random_uuid(),
 table_name text not null check (table_name in ('transactions','income_sources')),
 record_id uuid not null,
 user_id uuid not null,
 person_tag text not null,
 operation text not null check (operation in ('SNAPSHOT','INSERT','UPDATE','DELETE')),
 before_data jsonb,
 after_data jsonb,
 actor_user_id uuid,
 recorded_at timestamptz not null default now()
);
alter table public.change_history enable row level security;
create policy "Read own history" on public.change_history for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.change_history from anon, authenticated;
grant select on public.change_history to authenticated;
create index change_history_record_idx on public.change_history(user_id,record_id,recorded_at);

create function public.preserve_change_timestamps() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
 new.created_at := old.created_at;
 if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then new.updated_at := now();
 else new.updated_at := old.updated_at; end if;
 return new;
end;
$$;
create function public.record_financial_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare previous jsonb; current_row jsonb; owner_row jsonb;
begin
 if tg_op <> 'INSERT' then previous := to_jsonb(old); end if;
 if tg_op <> 'DELETE' then current_row := to_jsonb(new); end if;
 if tg_op = 'UPDATE' and previous = current_row then return new; end if;
 owner_row := coalesce(current_row, previous);
 insert into public.change_history(table_name,record_id,user_id,person_tag,operation,before_data,after_data,actor_user_id)
 values(tg_table_name,(owner_row->>'id')::uuid,(owner_row->>'user_id')::uuid,owner_row->>'person_tag',tg_op,previous,current_row,auth.uid());
 if tg_op = 'DELETE' then return old; end if;
 return new;
end;
$$;
revoke all on function public.record_financial_change() from public, anon, authenticated;
create trigger transactions_updated_at before update on public.transactions for each row execute function public.preserve_change_timestamps();
create trigger sources_updated_at before update on public.income_sources for each row execute function public.preserve_change_timestamps();
create trigger transactions_history after insert or update or delete on public.transactions for each row execute function public.record_financial_change();
create trigger sources_history after insert or update or delete on public.income_sources for each row execute function public.record_financial_change();
-- No se inventa el historial previo: se conserva el estado observado al instalar la migración.
insert into public.change_history(table_name,record_id,user_id,person_tag,operation,after_data)
 select 'transactions',id,user_id,person_tag,'SNAPSHOT',to_jsonb(t) from public.transactions t;
insert into public.change_history(table_name,record_id,user_id,person_tag,operation,after_data)
 select 'income_sources',id,user_id,person_tag,'SNAPSHOT',to_jsonb(s) from public.income_sources s;

-- Vista ampliada para analizar y exportar una fila por movimiento.
create or replace view public.movements_export with (security_invoker = true) as
select t.id as transaction_id,t.user_id as person_id,t.date as payment_date,t.competence_date,t.kind,t.flow_type,t.context,t.source_id,
 case when t.kind='income' then coalesce(s.name,t.context) end as income_source,
 t.category,t.description,'COP'::text as currency,t.amount as amount_cop,
 case when t.kind='income' then t.amount else -t.amount end as cashflow_cop,
 t.reserved as reserved_cop,t.from_reserve,t.created_at,t.person_tag,t.counterparty,t.reference,t.payment_method,t.updated_at
from public.transactions t left join public.income_sources s on s.id=t.source_id and s.user_id=t.user_id;
create view public.person_cashflow_monthly with (security_invoker = true) as
 select user_id,person_tag,date_trunc('month',date)::date as month,context,flow_type,
 sum(case when kind='income' then amount else 0 end) as received_cop,
 sum(case when kind='expense' then amount else 0 end) as paid_cop,
 sum(case when kind='income' then amount else -amount end) as net_cashflow_cop
 from public.transactions group by user_id,person_tag,date_trunc('month',date)::date,context,flow_type;
create view public.person_pnl_recorded_monthly with (security_invoker = true) as
 select user_id,person_tag,date_trunc('month',competence_date)::date as month,context,category,
 sum(case when kind='income' then amount else 0 end) as income_cop,
 sum(case when kind='expense' then amount else 0 end) as expense_cop,
 sum(case when kind='income' then amount else -amount end) as recorded_result_cop
 from public.transactions where flow_type='operating' group by user_id,person_tag,date_trunc('month',competence_date)::date,context,category;
revoke all on public.person_cashflow_monthly,public.person_pnl_recorded_monthly from anon;
grant select on public.person_cashflow_monthly,public.person_pnl_recorded_monthly to authenticated;
commit;

-- Notas libres
begin;
create table public.notes (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 person_tag text not null default 'natalia' check (person_tag ~ '^[a-z][a-z0-9_]{0,39}$'),
 body text not null check (char_length(trim(body)) between 1 and 4000 and body ~ '[^[:space:]]'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.notes enable row level security;
create policy "Own notes only" on public.notes for all to authenticated
 using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
revoke all on public.notes from anon;
grant select,insert,update,delete on public.notes to authenticated;
create index notes_person_date_idx on public.notes(user_id,person_tag,created_at desc,id);
alter table public.change_history drop constraint change_history_table_name_check;
alter table public.change_history add constraint change_history_table_name_check check (table_name in ('transactions','income_sources','notes'));
create trigger notes_updated_at before update on public.notes for each row execute function public.preserve_change_timestamps();
create trigger notes_history after insert or update or delete on public.notes for each row execute function public.record_financial_change();
commit;

-- Orden de eventos del historial
begin;
-- Las fechas pueden coincidir: la secuencia identifica el orden de eventos nuevos.
alter table public.change_history add column event_sequence bigint generated always as identity;
create unique index change_history_sequence_idx on public.change_history(event_sequence);
commit;
