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
