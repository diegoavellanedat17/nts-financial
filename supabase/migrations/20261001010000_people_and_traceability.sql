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
