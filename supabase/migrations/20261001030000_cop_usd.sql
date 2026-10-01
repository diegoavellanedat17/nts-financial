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
