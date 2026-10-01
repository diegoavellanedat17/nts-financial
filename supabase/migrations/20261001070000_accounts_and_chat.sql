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
