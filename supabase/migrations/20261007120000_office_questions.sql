begin;
create table public.office_answers (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 person_tag text not null default 'natalia' check(person_tag='natalia'),
 question_key text not null check(char_length(question_key) between 1 and 4000),
 kind text not null check(kind in ('delivered_amount','pending_work','auxiliary_period')),
 transaction_id uuid, -- Keep the answer and its snapshot if a movement is later deleted.
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 answer jsonb not null check(jsonb_typeof(answer)='object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,question_key)
);
create table public.office_answer_history (
 id uuid primary key default gen_random_uuid(),user_id uuid not null,answer_id uuid not null,
 operation text not null,before_data jsonb,after_data jsonb,recorded_at timestamptz not null default now()
);
alter table public.office_answers enable row level security;
alter table public.office_answer_history enable row level security;
revoke all on public.office_answers,public.office_answer_history from anon,authenticated;
grant select,insert,update on public.office_answers to authenticated;
grant select on public.office_answer_history to authenticated;
grant all on public.office_answers,public.office_answer_history to service_role;
create policy "Own office answers" on public.office_answers for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy "Own office answer history" on public.office_answer_history for select to authenticated using(auth.uid()=user_id);
create function public.validate_office_answer() returns trigger language plpgsql security definer set search_path='' as $$
declare t public.transactions;
begin
 if not exists(select 1 from auth.users where id=new.user_id and email='natalia-access@nts-financial.example.com') then raise exception 'Only Natalia can answer office questions';end if;
 if tg_op='UPDATE' then
  if new.user_id<>old.user_id or new.question_key<>old.question_key or new.kind<>old.kind or new.snapshot<>old.snapshot then raise exception 'Question identity cannot change';end if;
  new.created_at:=old.created_at;new.updated_at:=now();
 end if;
 if new.kind in ('delivered_amount','auxiliary_period') then
  select * into t from public.transactions where id=new.transaction_id and user_id=new.user_id and person_tag='natalia' and context='Consultorio' and flow_type='operating';
  if not found or new.question_key<>new.kind||':'||t.id::text then raise exception 'Invalid question movement';end if;
  if new.kind='delivered_amount' then
   if t.kind<>'income' or jsonb_typeof(new.answer->'amount') is distinct from 'number' then raise exception 'Invalid delivered amount';end if;
   if (new.answer->>'amount')::numeric<0 or (new.answer->>'amount')::numeric>t.amount or (new.answer->>'amount')::numeric<>round((new.answer->>'amount')::numeric,case when t.currency='COP' then 0 else 2 end) then raise exception 'Invalid delivered amount';end if;
  else
   if t.kind<>'expense' or coalesce(new.answer->>'period','') not in ('day','week','month','other') or jsonb_typeof(new.answer->'notes') is distinct from 'string' or char_length(new.answer->>'notes')>4000 or (new.answer->>'period'='other' and char_length(trim(new.answer->>'notes'))=0) then raise exception 'Invalid period';end if;
  end if;
 else
  if jsonb_typeof(new.answer->'notes') is distinct from 'string' or char_length(trim(new.answer->>'notes'))=0 or char_length(new.answer->>'notes')>4000 or jsonb_typeof(new.snapshot->'transaction_ids') is distinct from 'array' then raise exception 'Describe pending work';end if;
  if jsonb_array_length(new.snapshot->'transaction_ids')=0 or exists(select 1 from jsonb_array_elements_text(new.snapshot->'transaction_ids') as x(id) where not exists(select 1 from public.transactions where id=x.id::uuid and user_id=new.user_id and person_tag='natalia' and context='Consultorio' and kind='income')) then raise exception 'Invalid pending work context';end if;
 end if;
 return new;
end; $$;
create trigger office_answer_validate before insert or update on public.office_answers for each row execute function public.validate_office_answer();
create function public.audit_office_answer() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.office_answer_history(user_id,answer_id,operation,before_data,after_data) values(new.user_id,new.id,tg_op,case when tg_op='UPDATE' then to_jsonb(old) end,to_jsonb(new));
 return new;
end; $$;
create trigger office_answer_audit after insert or update on public.office_answers for each row execute function public.audit_office_answer();
revoke all on function public.validate_office_answer(),public.audit_office_answer() from public,anon,authenticated;
commit;
