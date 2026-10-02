begin;
alter table public.transfers add column source_balance_before numeric;
alter table public.transfers add column source_balance_after numeric;
alter table public.transfers add column benchmark_rate numeric check(benchmark_rate>0);
alter table public.transfers add column benchmark_date date;
alter table public.transfers add constraint transfer_balance_snapshot check((source_balance_before is null and source_balance_after is null) or (source_balance_before is not null and source_balance_after is not null and source_balance_after>=0 and source_balance_before-source_balance_after=sent_amount));
alter table public.transfers add constraint transfer_benchmark_pair check((benchmark_rate is null)=(benchmark_date is null));
alter table public.transfers add column effective_cop_per_usd numeric generated always as (case when from_currency='USD' and to_currency='COP' then received_amount/(sent_amount-fee_amount) when from_currency='COP' and to_currency='USD' then (sent_amount-fee_amount)/received_amount end) stored;
alter table public.transfers add column fx_difference_cop numeric generated always as (case when from_currency='USD' and to_currency='COP' then round((sent_amount-fee_amount)*benchmark_rate-received_amount,0) when from_currency='COP' and to_currency='USD' then round((sent_amount-fee_amount)-received_amount*benchmark_rate,0) end) stored;
create or replace function public.create_transfer(p_id uuid,p_from uuid,p_to uuid,p_sent numeric,p_received numeric,p_fee numeric,p_date date,p_description text)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.accounts; b public.accounts;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 perform id from public.accounts where id in (p_from,p_to) and user_id=auth.uid() order by id for update;
 select * into strict a from public.accounts where id=p_from and user_id=auth.uid();
 select * into strict b from public.accounts where id=p_to and user_id=auth.uid() and person_tag=a.person_tag;
 if p_date>(now() at time zone 'America/Bogota')::date then raise exception 'Future transfer'; end if;
 if p_sent<>round(p_sent,case when a.currency='COP' then 0 else 2 end) or p_received<>round(p_received,case when b.currency='COP' then 0 else 2 end) or p_fee<>round(p_fee,case when a.currency='COP' then 0 else 2 end) then raise exception 'Invalid precision'; end if;
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
create function public.create_transfer_from_balance(p_id uuid,p_from uuid,p_to uuid,p_received numeric,p_remaining numeric,p_expected_balance numeric,p_date date,p_description text,p_fee numeric default 0)
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
 if p_remaining is null or p_expected_balance is null or p_remaining<0 or p_remaining<>round(p_remaining,case when a.currency='COP' then 0 else 2 end) then raise exception 'Invalid remaining balance';end if;
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
