begin;
-- Only audited balance checks and transfer legs may carry bank COP cents.
alter table public.transactions drop constraint transactions_currency_precision_check;
alter table public.transactions add constraint transactions_currency_precision_check check (
 (currency='COP' and amount=trunc(amount) and reserved=trunc(reserved)) or
 (currency='COP' and (balance_check_id is not null or transfer_id is not null) and amount=round(amount,2) and reserved=0) or
 (currency='USD' and amount=round(amount,2) and reserved=round(reserved,2))
);
create or replace function public.set_account_balance(p_id uuid,p_account uuid,p_balance numeric,p_transaction_ids uuid[] default '{}') returns uuid
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
 if p_balance is null or p_balance<0 or p_balance>999999999 or p_balance<>round(p_balance,2) then raise exception 'Invalid balance'; end if;
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
 values(gen_random_uuid(),auth.uid(),a.person_tag,day,day,case when delta>0 then 'income' else 'expense' end,abs(delta),a.currency,'Personal','Otros','Otros · Conciliación: '||a.name,0,false,'opening_balance',a.id,p_id);
 end if;
 return p_id;
end; $$;

create or replace function public.create_transfer(p_id uuid,p_from uuid,p_to uuid,p_sent numeric,p_received numeric,p_fee numeric,p_date date,p_description text)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.accounts; b public.accounts;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 perform id from public.accounts where id in (p_from,p_to) and user_id=auth.uid() order by id for update;
 select * into strict a from public.accounts where id=p_from and user_id=auth.uid();
 select * into strict b from public.accounts where id=p_to and user_id=auth.uid() and person_tag=a.person_tag;
 if p_date>(now() at time zone 'America/Bogota')::date then raise exception 'Future transfer'; end if;
 if p_sent<>round(p_sent,2) or p_received<>round(p_received,2) or p_fee<>round(p_fee,2) then raise exception 'Invalid precision'; end if;
 insert into public.transfers(id,user_id,person_tag,from_account_id,to_account_id,from_currency,to_currency,sent_amount,received_amount,fee_amount,date,description,created_at) values(p_id,auth.uid(),a.person_tag,a.id,b.id,a.currency,b.currency,p_sent,p_received,p_fee,p_date,p_description,now());
 insert into public.transactions(id,user_id,person_tag,date,competence_date,kind,amount,currency,context,category,description,reserved,from_reserve,flow_type,account_id,transfer_id,transfer_role)
 values(gen_random_uuid(),auth.uid(),a.person_tag,p_date,p_date,'expense',p_sent-p_fee,a.currency,'Personal','Otros',p_description,0,false,'transfer',a.id,p_id,'sent'),
 (gen_random_uuid(),auth.uid(),a.person_tag,p_date,p_date,'income',p_received,b.currency,'Personal','Otros',p_description,0,false,'transfer',b.id,p_id,'received');
 if p_fee>0 then
 insert into public.transactions(id,user_id,person_tag,date,competence_date,kind,amount,currency,context,category,description,reserved,from_reserve,flow_type,account_id,transfer_id,transfer_role)
 values(gen_random_uuid(),auth.uid(),a.person_tag,p_date,p_date,'expense',p_fee,a.currency,'Personal','Servicios','Comisión: '||left(p_description,3990),0,false,'operating',a.id,p_id,'fee');
 end if;
 return p_id;
end; $$;
create or replace function public.create_transfer_from_balance(p_id uuid,p_from uuid,p_to uuid,p_received numeric,p_remaining numeric,p_expected_balance numeric,p_date date,p_description text,p_fee numeric default 0)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.accounts;b public.accounts;current_balance numeric;debit numeric;rate numeric;existing public.transfers;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 if p_date<>(now() at time zone 'America/Bogota')::date then raise exception 'Balance transfer requires today';end if;
 perform id from public.accounts where id in (p_from,p_to) and user_id=auth.uid() order by id for update;
 select * into strict a from public.accounts where id=p_from and user_id=auth.uid();
 select * into strict b from public.accounts where id=p_to and user_id=auth.uid() and person_tag=a.person_tag;
 select * into existing from public.transfers where id=p_id and user_id=auth.uid();
 if found then
  if existing.from_account_id=p_from and existing.to_account_id=p_to and existing.received_amount=p_received and existing.source_balance_after=p_remaining and existing.source_balance_before=p_expected_balance and existing.fee_amount=p_fee and existing.date=p_date and existing.description=p_description then return p_id;end if;
  raise exception 'Transfer request already used';
 end if;
 if p_remaining is null or p_expected_balance is null or p_remaining<0 or p_remaining<>round(p_remaining,2) then raise exception 'Invalid remaining balance';end if;
 select coalesce(sum(case when kind='income' then amount else -amount end),0) into current_balance from public.transactions where account_id=a.id and user_id=auth.uid() and date<=p_date;
 if current_balance<>p_expected_balance then raise exception 'Source balance changed; reload accounts';end if;
 debit:=current_balance-p_remaining;
 perform public.create_transfer(p_id,p_from,p_to,debit,p_received,p_fee,p_date,p_description);
 select cop_per_usd into rate from public.exchange_rates where date=p_date and valid_from<=p_date and valid_to>=p_date;
 update public.transfers set source_balance_before=current_balance,source_balance_after=p_remaining,
 benchmark_rate=case when a.currency<>b.currency then rate end,benchmark_date=case when a.currency<>b.currency and rate is not null then p_date end where id=p_id and user_id=auth.uid();
 return p_id;
end; $$;
revoke all on function public.create_transfer_from_balance(uuid,uuid,uuid,numeric,numeric,numeric,date,text,numeric) from public,anon;
grant execute on function public.create_transfer_from_balance(uuid,uuid,uuid,numeric,numeric,numeric,date,text,numeric) to authenticated;

commit;
