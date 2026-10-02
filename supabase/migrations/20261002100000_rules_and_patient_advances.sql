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
