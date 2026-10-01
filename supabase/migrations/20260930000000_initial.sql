-- Esquema inicial para un proyecto nuevo.
begin;
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


commit;
