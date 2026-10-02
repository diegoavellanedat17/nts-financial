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

-- COP y USD
begin;
-- Los registros históricos fueron capturados en COP.
alter table public.transactions add column currency text not null default 'COP' check(currency in ('COP','USD'));
alter table public.notes add column currency text not null default 'COP' check(currency in ('COP','USD'));
-- Recrear vistas permite cambiar bigint a numeric sin redondear centavos.
drop view public.movements_export,public.cashflow_monthly,public.pnl_recorded_monthly,public.spending_monthly,public.person_cashflow_monthly,public.person_pnl_recorded_monthly;
alter table public.transactions alter column amount type numeric using amount::numeric;
alter table public.transactions alter column reserved type numeric using reserved::numeric;
alter table public.transactions drop constraint transactions_amount_check;
alter table public.transactions add constraint transactions_amount_check check(amount between 0.01 and 999999999);
alter table public.transactions add constraint transactions_currency_precision_check check (
 (currency='COP' and amount=trunc(amount) and reserved=trunc(reserved)) or
 (currency='USD' and amount*100=trunc(amount*100) and reserved*100=trunc(reserved*100))
);
create index transactions_person_currency_date_idx on public.transactions(user_id,person_tag,currency,date);
create view public.movements_export with (security_invoker=true) as
 select t.id as transaction_id,t.user_id as person_id,t.date as payment_date,t.competence_date,t.kind,t.flow_type,t.context,t.source_id,
 case when t.kind='income' then coalesce(s.name,t.context) end as income_source,t.category,t.description,t.currency,
 t.amount as amount_native,case when t.kind='income' then t.amount else -t.amount end as cashflow_native,t.reserved as reserved_native,
 t.from_reserve,t.created_at,t.person_tag,t.counterparty,t.reference,t.payment_method,t.updated_at
 from public.transactions t left join public.income_sources s on s.id=t.source_id and s.user_id=t.user_id;
-- Vistas legadas: exclusivamente COP. Nunca agregan USD a pesos.
create view public.cashflow_monthly with (security_invoker=true) as
 select user_id as person_id,date_trunc('month',date)::date as month,context,flow_type,
 sum(case when kind='income' then amount else 0 end) as received_cop,sum(case when kind='expense' then amount else 0 end) as paid_cop,
 sum(case when kind='income' then amount else -amount end) as net_cashflow_cop
 from public.transactions where currency='COP' group by user_id,date_trunc('month',date)::date,context,flow_type;
create view public.pnl_recorded_monthly with (security_invoker=true) as
 select user_id as person_id,date_trunc('month',competence_date)::date as month,context,kind,category,
 sum(amount) as amount_cop,sum(case when kind='income' then amount else -amount end) as recorded_result_cop
 from public.transactions where currency='COP' and flow_type='operating' group by user_id,date_trunc('month',competence_date)::date,context,kind,category;
create view public.spending_monthly with (security_invoker=true) as
 select user_id as person_id,date_trunc('month',date)::date as month,context,category,sum(amount) as spent_cop
 from public.transactions where currency='COP' and kind='expense' and flow_type='operating' group by user_id,date_trunc('month',date)::date,context,category;
create view public.person_cashflow_monthly with (security_invoker=true) as
 select user_id,person_tag,currency,date_trunc('month',date)::date as month,context,flow_type,
 sum(case when kind='income' then amount else 0 end) as received_amount,sum(case when kind='expense' then amount else 0 end) as paid_amount,
 sum(case when kind='income' then amount else -amount end) as net_cashflow_amount
 from public.transactions group by user_id,person_tag,currency,date_trunc('month',date)::date,context,flow_type;
create view public.person_pnl_recorded_monthly with (security_invoker=true) as
 select user_id,person_tag,currency,date_trunc('month',competence_date)::date as month,context,category,
 sum(case when kind='income' then amount else 0 end) as income_amount,sum(case when kind='expense' then amount else 0 end) as expense_amount,
 sum(case when kind='income' then amount else -amount end) as result_amount
 from public.transactions where flow_type='operating' group by user_id,person_tag,currency,date_trunc('month',competence_date)::date,context,category;
revoke all on public.movements_export,public.cashflow_monthly,public.pnl_recorded_monthly,public.spending_monthly,public.person_cashflow_monthly,public.person_pnl_recorded_monthly from anon;
grant select on public.movements_export,public.cashflow_monthly,public.pnl_recorded_monthly,public.spending_monthly,public.person_cashflow_monthly,public.person_pnl_recorded_monthly to authenticated;
commit;

-- Conceptos libres dentro de cada movimiento
begin;
alter table public.transactions drop constraint transactions_description_check;
alter table public.transactions add constraint transactions_description_check check(char_length(trim(description)) between 1 and 4000);
commit;

begin;
-- Import receipts stay after a movement is deleted, so the same email is never silently reimported.
create table public.gmail_imports (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 person_tag text not null default 'diego' check (person_tag = 'diego'),
 account_email text not null check (char_length(account_email) between 3 and 254),
 message_id text not null check (message_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
 transaction_id uuid not null,
 received_at timestamptz not null,
 sender text not null check (char_length(sender) <= 500),
 subject text not null check (char_length(subject) <= 500),
 excerpt text not null check (char_length(excerpt) <= 6000),
 parser_version text not null default 'rules-v1',
 created_at timestamptz not null default now(),
 unique(user_id,account_email,message_id)
);
alter table public.gmail_imports enable row level security;
create policy "Read own Gmail receipts" on public.gmail_imports for select to authenticated
 using ((select auth.uid()) = user_id);
revoke all on public.gmail_imports from anon,authenticated;
grant select on public.gmail_imports to authenticated;
create index gmail_imports_transaction_idx on public.gmail_imports(user_id,transaction_id);

-- The transaction and import receipt commit together, including concurrent clicks on two devices.
create function public.import_gmail_movement(p_email jsonb,p_movement jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 owner_id uuid := auth.uid();
 new_id uuid := gen_random_uuid();
 receipt_id uuid;
 result jsonb;
 account text := lower(p_email->>'account');
begin
 if owner_id is null or not exists (select 1 from auth.users where id=owner_id and email='diego-access@nts-financial.example.com') then
   raise exception 'Solo Diego puede importar movimientos de Gmail.' using errcode='42501';
 end if;
 if account is null or account !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Correo inválido.'; end if;
 if p_movement->>'kind' not in ('income','expense') or p_movement->>'kind' is null
   or p_movement->>'currency' not in ('COP','USD') or p_movement->>'currency' is null
   or coalesce(p_movement->>'flow_type','operating') not in ('operating','transfer') then raise exception 'Movimiento inválido.'; end if;
 if (p_movement->>'date')::date > (now() at time zone 'America/Bogota')::date then raise exception 'La fecha no puede estar en el futuro.'; end if;
 if p_movement->>'kind' = 'income' and not exists (
   select 1 from public.income_sources where id=(p_movement->>'source_id')::uuid and user_id=owner_id and person_tag='diego' and context='Personal'
 ) then raise exception 'Selecciona una fuente de ingreso propia.'; end if;
 insert into public.gmail_imports(user_id,account_email,message_id,transaction_id,received_at,sender,subject,excerpt)
 values(owner_id,account,p_email->>'messageId',new_id,(p_email->>'receivedAt')::timestamptz,p_email->>'sender',p_email->>'subject',p_email->>'excerpt')
 on conflict (user_id,account_email,message_id) do nothing returning id into receipt_id;
 if receipt_id is null then
   return jsonb_build_object('duplicate',true);
 end if;
 insert into public.transactions(id,user_id,person_tag,date,competence_date,kind,amount,currency,context,category,description,source_id,flow_type,reference)
 values(new_id,owner_id,'diego',(p_movement->>'date')::date,(p_movement->>'date')::date,p_movement->>'kind',
   (p_movement->>'amount')::numeric,p_movement->>'currency','Personal',p_movement->>'category',p_movement->>'description',
   case when p_movement->>'kind'='income' then (p_movement->>'source_id')::uuid else null end,
   coalesce(p_movement->>'flow_type','operating'),'gmail:' || (p_email->>'messageId')) returning to_jsonb(transactions.*) into result;
 return jsonb_build_object('duplicate',false,'transaction',result);
end;
$$;
revoke all on function public.import_gmail_movement(jsonb,jsonb) from public,anon;
grant execute on function public.import_gmail_movement(jsonb,jsonb) to authenticated;
commit;

begin;
-- Public official rates, written only by the server. Financial records retain native currencies.
create table public.exchange_rates (
 date date primary key,
 cop_per_usd numeric not null check (cop_per_usd > 0 and cop_per_usd < 100000),
 valid_from date not null,
 valid_to date not null,
 source text not null check (source = 'https://www.datos.gov.co/resource/32sa-8pi3.json'),
 fetched_at timestamptz not null,
 check (valid_from <= date and valid_to >= date)
);
alter table public.exchange_rates enable row level security;
create policy "Read official rates" on public.exchange_rates for select to authenticated,anon using (true);
revoke all on public.exchange_rates from anon,authenticated;
grant select on public.exchange_rates to anon,authenticated;
commit;

begin;
create table public.accounts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 person_tag text not null check (person_tag in ('diego','natalia')),
 name text not null check(char_length(trim(name)) between 1 and 80), currency text not null check(currency in ('COP','USD')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,user_id,person_tag,currency), unique(user_id,person_tag,name,currency)
);
alter table public.accounts enable row level security;
create policy "Own accounts" on public.accounts for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
grant select,insert,update,delete on public.accounts to authenticated;
revoke all on public.accounts from anon;
alter table public.transactions add column account_id uuid;
alter table public.transactions add constraint transactions_account_owner foreign key(account_id,user_id,person_tag,currency) references public.accounts(id,user_id,person_tag,currency);
create table public.transfers (
 id uuid primary key, user_id uuid not null references auth.users(id), person_tag text not null,
 from_account_id uuid not null, to_account_id uuid not null, from_currency text not null, to_currency text not null,
 sent_amount numeric not null check(sent_amount>0 and sent_amount<=999999999), received_amount numeric not null check(received_amount>0 and received_amount<=999999999),
 fee_amount numeric not null default 0 check(fee_amount>=0 and fee_amount<sent_amount), date date not null,
 description text not null check(char_length(trim(description)) between 1 and 4000), created_at timestamptz not null default now(),
 check(from_account_id<>to_account_id), unique(id,user_id,person_tag),
 foreign key(from_account_id,user_id,person_tag,from_currency) references public.accounts(id,user_id,person_tag,currency),
 foreign key(to_account_id,user_id,person_tag,to_currency) references public.accounts(id,user_id,person_tag,currency),
 check(from_currency<>to_currency or received_amount=sent_amount-fee_amount)
);
alter table public.transfers enable row level security;
create policy "Own transfers" on public.transfers for select to authenticated using(auth.uid()=user_id);
grant select on public.transfers to authenticated;
revoke all on public.transfers from anon;
alter table public.transactions add column transfer_id uuid;
alter table public.transactions add column transfer_role text check(transfer_role in ('sent','received','fee'));
alter table public.transactions add constraint transfer_link foreign key(transfer_id,user_id,person_tag) references public.transfers(id,user_id,person_tag) on delete cascade;
alter table public.transactions add constraint transfer_role_link check((transfer_id is null)=(transfer_role is null));
alter table public.transactions add constraint transfer_leg_unique unique(transfer_id,transfer_role);
-- Linked movements are managed atomically by the transfer functions.
create policy "No direct transfer insert" on public.transactions as restrictive for insert to authenticated with check(transfer_id is null);
create policy "No direct transfer update" on public.transactions as restrictive for update to authenticated using(transfer_id is null) with check(transfer_id is null);
create policy "No direct transfer delete" on public.transactions as restrictive for delete to authenticated using(transfer_id is null);
alter table public.change_history drop constraint change_history_table_name_check;
alter table public.change_history add constraint change_history_table_name_check check(table_name in ('transactions','income_sources','notes','accounts','transfers'));
create trigger accounts_updated before update on public.accounts for each row execute function public.preserve_change_timestamps();
create trigger accounts_history after insert or update or delete on public.accounts for each row execute function public.record_financial_change();
create trigger transfers_history after insert or update or delete on public.transfers for each row execute function public.record_financial_change();
create function public.create_transfer(p_id uuid,p_from uuid,p_to uuid,p_sent numeric,p_received numeric,p_fee numeric,p_date date,p_description text)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.accounts; b public.accounts;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into strict a from public.accounts where id=p_from and user_id=auth.uid();
 select * into strict b from public.accounts where id=p_to and user_id=auth.uid() and person_tag=a.person_tag;
 if p_date>(now() at time zone 'America/Bogota')::date then raise exception 'Future transfer'; end if;
 if p_sent<>round(p_sent,case when a.currency='COP' then 0 else 2 end) or p_received<>round(p_received,case when b.currency='COP' then 0 else 2 end) or p_fee<>round(p_fee,case when a.currency='COP' then 0 else 2 end) then raise exception 'Invalid precision'; end if;
 insert into public.transfers values(p_id,auth.uid(),a.person_tag,a.id,b.id,a.currency,b.currency,p_sent,p_received,p_fee,p_date,p_description,now());
 insert into public.transactions(id,user_id,person_tag,date,competence_date,kind,amount,currency,context,category,description,reserved,from_reserve,flow_type,account_id,transfer_id,transfer_role)
 values(gen_random_uuid(),auth.uid(),a.person_tag,p_date,p_date,'expense',p_sent-p_fee,a.currency,'Personal','Otros',p_description,0,false,'transfer',a.id,p_id,'sent'),
 (gen_random_uuid(),auth.uid(),a.person_tag,p_date,p_date,'income',p_received,b.currency,'Personal','Otros',p_description,0,false,'transfer',b.id,p_id,'received');
 if p_fee>0 then
 insert into public.transactions(id,user_id,person_tag,date,competence_date,kind,amount,currency,context,category,description,reserved,from_reserve,flow_type,account_id,transfer_id,transfer_role)
 values(gen_random_uuid(),auth.uid(),a.person_tag,p_date,p_date,'expense',p_fee,a.currency,'Personal','Servicios','Comisión: '||left(p_description,3990),0,false,'operating',a.id,p_id,'fee');
 end if;
 return p_id;
end; $$;
create function public.cancel_transfer(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 delete from public.transfers where id=p_id and user_id=auth.uid();
 if not found then raise exception 'Transfer not found'; end if;
end; $$;
revoke all on function public.create_transfer(uuid,uuid,uuid,numeric,numeric,numeric,date,text),public.cancel_transfer(uuid) from public,anon;
grant execute on function public.create_transfer(uuid,uuid,uuid,numeric,numeric,numeric,date,text),public.cancel_transfer(uuid) to authenticated;
create table public.finance_chat (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), person_tag text not null,
 question text not null check(char_length(question) between 1 and 2000), answer text not null,
 model text not null, snapshot jsonb not null, created_at timestamptz not null default now()
);
alter table public.finance_chat enable row level security;
create policy "Own chat read" on public.finance_chat for select to authenticated using(auth.uid()=user_id);
create policy "Own chat insert" on public.finance_chat for insert to authenticated with check(auth.uid()=user_id);
grant select,insert on public.finance_chat to authenticated;
revoke all on public.finance_chat from anon;
create index finance_chat_owner_date on public.finance_chat(user_id,created_at desc);
create or replace view public.movements_export with (security_invoker=true) as
 select t.id as transaction_id,t.user_id as person_id,t.date as payment_date,t.competence_date,t.kind,t.flow_type,t.context,t.source_id,
 case when t.kind='income' and t.flow_type<>'transfer' then coalesce(s.name,t.context) end as income_source,t.category,t.description,t.currency,
 t.amount as amount_native,case when t.kind='income' then t.amount else -t.amount end as cashflow_native,t.reserved as reserved_native,
 t.from_reserve,t.created_at,t.person_tag,t.counterparty,t.reference,t.payment_method,t.updated_at,t.account_id,a.name as account_name,t.transfer_id,t.transfer_role
 from public.transactions t left join public.income_sources s on s.id=t.source_id and s.user_id=t.user_id
 left join public.accounts a on a.id=t.account_id and a.user_id=t.user_id;
commit;

begin;
create table public.account_balance_checks (
 id uuid primary key, user_id uuid not null references auth.users(id), person_tag text not null,
 account_id uuid not null, currency text not null, balance numeric not null check(balance between 0 and 999999999),
 previous_balance numeric not null, adjustment numeric not null, date date not null,
 created_at timestamptz not null default now(), unique(id,user_id,person_tag),
 foreign key(account_id,user_id,person_tag,currency) references public.accounts(id,user_id,person_tag,currency),
 check(balance=previous_balance+adjustment)
);
alter table public.account_balance_checks enable row level security;
create policy "Own balance checks" on public.account_balance_checks for select to authenticated using(auth.uid()=user_id);
grant select on public.account_balance_checks to authenticated;
revoke all on public.account_balance_checks from anon;
alter table public.transactions add column balance_check_id uuid;
alter table public.transactions add constraint transactions_balance_check_owner foreign key(balance_check_id,user_id,person_tag) references public.account_balance_checks(id,user_id,person_tag);
create policy "No direct balance check insert" on public.transactions as restrictive for insert to authenticated with check(balance_check_id is null);
create policy "No direct balance check update" on public.transactions as restrictive for update to authenticated using(balance_check_id is null) with check(balance_check_id is null);
create policy "No direct balance check delete" on public.transactions as restrictive for delete to authenticated using(balance_check_id is null);
alter table public.change_history drop constraint change_history_table_name_check;
alter table public.change_history add constraint change_history_table_name_check check(table_name in ('transactions','income_sources','notes','accounts','transfers','account_balance_checks'));
create trigger balance_checks_history after insert on public.account_balance_checks for each row execute function public.record_financial_change();
create function public.set_account_balance(p_id uuid,p_account uuid,p_balance numeric) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.accounts; existing public.account_balance_checks; previous numeric; delta numeric; day date := (now() at time zone 'America/Bogota')::date;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into strict a from public.accounts where id=p_account and user_id=auth.uid() for update;
 select * into existing from public.account_balance_checks where id=p_id;
 if found then
  if existing.user_id<>auth.uid() or existing.account_id<>p_account or existing.balance<>p_balance then raise exception 'Invalid retry'; end if;
  return existing.id;
 end if;
 if p_balance is null or p_balance<0 or p_balance>999999999 or p_balance<>round(p_balance,case when a.currency='COP' then 0 else 2 end) then raise exception 'Invalid balance'; end if;
 select coalesce(sum(case when kind='income' then amount else -amount end),0) into previous from public.transactions where account_id=a.id and user_id=auth.uid() and date<=day;
 delta := p_balance-previous;
 if abs(delta)>999999999 then raise exception 'Adjustment too large'; end if;
 insert into public.account_balance_checks(id,user_id,person_tag,account_id,currency,balance,previous_balance,adjustment,date)
 values(p_id,auth.uid(),a.person_tag,a.id,a.currency,p_balance,previous,delta,day);
 if delta<>0 then
 insert into public.transactions(id,user_id,person_tag,date,competence_date,kind,amount,currency,context,category,description,reserved,from_reserve,flow_type,account_id,balance_check_id)
 values(gen_random_uuid(),auth.uid(),a.person_tag,day,day,case when delta>0 then 'income' else 'expense' end,abs(delta),a.currency,'Personal','Otros','Ajuste de saldo: '||a.name,0,false,'opening_balance',a.id,p_id);
 end if;
 return p_id;
end; $$;
revoke all on function public.set_account_balance(uuid,uuid,numeric) from public,anon;
grant execute on function public.set_account_balance(uuid,uuid,numeric) to authenticated;
create or replace view public.movements_export with (security_invoker=true) as
 select t.id as transaction_id,t.user_id as person_id,t.date as payment_date,t.competence_date,t.kind,t.flow_type,t.context,t.source_id,
 case when t.kind='income' and t.flow_type<>'transfer' then coalesce(s.name,t.context) end as income_source,t.category,t.description,t.currency,
 t.amount as amount_native,case when t.kind='income' then t.amount else -t.amount end as cashflow_native,t.reserved as reserved_native,
 t.from_reserve,t.created_at,t.person_tag,t.counterparty,t.reference,t.payment_method,t.updated_at,t.account_id,a.name as account_name,t.transfer_id,t.transfer_role,t.balance_check_id
 from public.transactions t left join public.income_sources s on s.id=t.source_id and s.user_id=t.user_id
 left join public.accounts a on a.id=t.account_id and a.user_id=t.user_id;
commit;
begin;
create table public.credit_cards (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),person_tag text not null check(person_tag in ('diego','natalia')),
 name text not null check(char_length(trim(name)) between 1 and 80),currency text not null check(currency in ('COP','USD')),
 debt numeric not null check(debt between 0 and 999999999),credit_limit numeric check(credit_limit between 0 and 999999999),monthly_payment numeric check(monthly_payment between 0 and 999999999),
 monthly_rate numeric check(monthly_rate between 0 and 20),closing_day integer check(closing_day between 1 and 31),payment_day integer check(payment_day between 1 and 31),
 balance_date date not null,notes text not null default '' check(char_length(notes)<=4000),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(id,user_id,person_tag,currency),unique(user_id,person_tag,name,currency),
 check(debt=round(debt,case when currency='COP' then 0 else 2 end) and (credit_limit is null or credit_limit=round(credit_limit,case when currency='COP' then 0 else 2 end)) and (monthly_payment is null or monthly_payment=round(monthly_payment,case when currency='COP' then 0 else 2 end)))
);
create table public.credit_scenarios (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),person_tag text not null,
 card_id uuid not null,currency text not null,description text not null check(char_length(trim(description)) between 1 and 1000),
 amount numeric not null check(amount>0 and amount<=999999999),installments integer not null check(installments between 1 and 120),monthly_rate numeric check(monthly_rate between 0 and 20),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(card_id,user_id,person_tag,currency) references public.credit_cards(id,user_id,person_tag,currency),
 check(amount=round(amount,case when currency='COP' then 0 else 2 end))
);
alter table public.credit_cards enable row level security;
alter table public.credit_scenarios enable row level security;
create policy "Own credit cards" on public.credit_cards for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy "Own credit scenarios" on public.credit_scenarios for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
grant select,insert,update,delete on public.credit_cards,public.credit_scenarios to authenticated;
revoke all on public.credit_cards,public.credit_scenarios from anon;
alter table public.change_history drop constraint change_history_table_name_check;
alter table public.change_history add constraint change_history_table_name_check check(table_name in ('transactions','income_sources','notes','accounts','transfers','account_balance_checks','credit_cards','credit_scenarios'));
create trigger credit_cards_updated before update on public.credit_cards for each row execute function public.preserve_change_timestamps();
create trigger credit_cards_history after insert or update or delete on public.credit_cards for each row execute function public.record_financial_change();
create trigger credit_scenarios_updated before update on public.credit_scenarios for each row execute function public.preserve_change_timestamps();
create trigger credit_scenarios_history after insert or update or delete on public.credit_scenarios for each row execute function public.record_financial_change();
create index credit_cards_person_idx on public.credit_cards(user_id,person_tag);
create index credit_scenarios_person_idx on public.credit_scenarios(user_id,person_tag);
commit;

begin;
alter table public.account_balance_checks add column linked_transaction_ids uuid[] not null default '{}';
drop function public.set_account_balance(uuid,uuid,numeric);
create function public.set_account_balance(p_id uuid,p_account uuid,p_balance numeric,p_transaction_ids uuid[] default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.accounts; existing public.account_balance_checks; previous numeric; delta numeric; linked_count integer; day date := (now() at time zone 'America/Bogota')::date;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into strict a from public.accounts where id=p_account and user_id=auth.uid() for update;
 select * into existing from public.account_balance_checks where id=p_id;
 if found then
  if existing.user_id<>auth.uid() or existing.account_id<>p_account or existing.balance<>p_balance or existing.linked_transaction_ids<>coalesce(p_transaction_ids,'{}') then raise exception 'Invalid retry'; end if;
  return existing.id;
 end if;
 if p_balance is null or p_balance<0 or p_balance>999999999 or p_balance<>round(p_balance,case when a.currency='COP' then 0 else 2 end) then raise exception 'Invalid balance'; end if;
 update public.transactions set account_id=a.id where id=any(coalesce(p_transaction_ids,'{}')) and user_id=auth.uid() and person_tag=a.person_tag and currency=a.currency and account_id is null and transfer_id is null and balance_check_id is null and date<=day;
 get diagnostics linked_count=row_count;
 if linked_count<>coalesce(array_length(p_transaction_ids,1),0) then raise exception 'Select only unassigned movements from this person, currency and date'; end if;
 select coalesce(sum(case when kind='income' then amount else -amount end),0) into previous from public.transactions where account_id=a.id and user_id=auth.uid() and date<=day;
 delta := p_balance-previous;
 if abs(delta)>999999999 then raise exception 'Adjustment too large'; end if;
 insert into public.account_balance_checks(id,user_id,person_tag,account_id,currency,balance,previous_balance,adjustment,date,linked_transaction_ids)
 values(p_id,auth.uid(),a.person_tag,a.id,a.currency,p_balance,previous,delta,day,coalesce(p_transaction_ids,'{}'));
 if delta<>0 then
 insert into public.transactions(id,user_id,person_tag,date,competence_date,kind,amount,currency,context,category,description,reserved,from_reserve,flow_type,account_id,balance_check_id)
 values(gen_random_uuid(),auth.uid(),a.person_tag,day,day,case when delta>0 then 'income' else 'expense' end,abs(delta),a.currency,'Personal','Otros','Ajuste de saldo: '||a.name,0,false,'opening_balance',a.id,p_id);
 end if;
 return p_id;
end; $$;
revoke all on function public.set_account_balance(uuid,uuid,numeric,uuid[]) from public,anon;
grant execute on function public.set_account_balance(uuid,uuid,numeric,uuid[]) to authenticated;
commit;
begin;
create table public.classification_rules (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),person_tag text not null,
 rule_key text not null,name text not null,keywords text[] not null check(cardinality(keywords) between 1 and 20 and array_to_string(keywords,',') ~ '^[a-z0-9]+(,[a-z0-9]+)*$'),
 context text not null check(context in ('Personal','Consultorio','Clínica 1','Clínica 2')),category text not null,priority integer not null default 100,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(rule_key,user_id,person_tag)
);
alter table public.classification_rules enable row level security;
create policy "Own classification rules" on public.classification_rules for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
grant select,insert,update on public.classification_rules to authenticated;
revoke all on public.classification_rules from anon;
alter table public.change_history drop constraint change_history_table_name_check;
alter table public.change_history add constraint change_history_table_name_check check(table_name in ('transactions','income_sources','notes','accounts','transfers','account_balance_checks','credit_cards','credit_scenarios','classification_rules'));
create trigger classification_rules_updated before update on public.classification_rules for each row execute function public.preserve_change_timestamps();
create trigger classification_rules_history after insert or update or delete on public.classification_rules for each row execute function public.record_financial_change();
alter table public.transactions add column classification_rule_key text;
alter table public.transactions add column patient_advance boolean not null default false;
alter table public.transactions add column reserve_release_date date;
alter table public.transactions add constraint classification_rule_owner foreign key(classification_rule_key,user_id,person_tag) references public.classification_rules(rule_key,user_id,person_tag);
alter table public.transactions add constraint advance_income_only check(not patient_advance or (kind='income' and context='Consultorio' and flow_type='operating' and reserved=amount));
alter table public.transactions add constraint release_reserved_income_only check(reserve_release_date is null or (kind='income' and reserved>0 and reserve_release_date>=date));
create function public.classify_movement() returns trigger language plpgsql security invoker set search_path='' as $$
declare r public.classification_rules;
begin
 if new.kind<>'expense' or new.flow_type<>'operating' or new.transfer_id is not null or new.balance_check_id is not null then return new; end if;
 if tg_op='UPDATE' and old.classification_rule_key is not null then
  if new.context<>old.context or new.category<>old.category then new.classification_rule_key:=null; return new; end if;
  if new.description<>old.description then new.category:='Otros';new.classification_rule_key:=null; end if;
 end if;
 if new.category<>'Otros' then return new; end if;
 select * into r from public.classification_rules where user_id=new.user_id and person_tag=new.person_tag
 and keywords && regexp_split_to_array(translate(lower(new.description),'áéíóúüñ','aeiouun'),'[^a-z0-9]+') order by priority,rule_key limit 1;
 if found then new.context:=r.context;new.category:=r.category;new.classification_rule_key:=r.rule_key;new.from_reserve:=case when r.context='Personal' then false else new.from_reserve end;end if;
 return new;
end; $$;
create trigger a_classify_movement before insert or update on public.transactions for each row execute function public.classify_movement();
create function public.release_patient_advance(p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 update public.transactions set reserve_release_date=(now() at time zone 'America/Bogota')::date where id=p_id and user_id=auth.uid() and patient_advance and reserve_release_date is null and date<=(now() at time zone 'America/Bogota')::date;
 if not found then raise exception 'Pending advance not found'; end if;
end; $$;
revoke all on function public.release_patient_advance(uuid) from public,anon;
grant execute on function public.release_patient_advance(uuid) to authenticated;
create or replace view public.movements_export with (security_invoker=true) as
 select t.id as transaction_id,t.user_id as person_id,t.date as payment_date,t.competence_date,t.kind,t.flow_type,t.context,t.source_id,
 case when t.kind='income' and t.flow_type<>'transfer' then coalesce(s.name,t.context) end as income_source,t.category,t.description,t.currency,
 t.amount as amount_native,case when t.kind='income' then t.amount else -t.amount end as cashflow_native,t.reserved as reserved_native,
 t.from_reserve,t.created_at,t.person_tag,t.counterparty,t.reference,t.payment_method,t.updated_at,t.account_id,a.name as account_name,t.transfer_id,t.transfer_role,t.balance_check_id,t.classification_rule_key,t.patient_advance,t.reserve_release_date
 from public.transactions t left join public.income_sources s on s.id=t.source_id and s.user_id=t.user_id
 left join public.accounts a on a.id=t.account_id and a.user_id=t.user_id;
commit;
