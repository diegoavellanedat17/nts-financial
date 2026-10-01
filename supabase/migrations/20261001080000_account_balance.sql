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
