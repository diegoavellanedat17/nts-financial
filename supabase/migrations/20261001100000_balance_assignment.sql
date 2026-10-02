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
