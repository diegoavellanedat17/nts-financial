begin;
-- Import receipts stay after a movement is deleted, so the same email is never silently reimported.
create table public.gmail_imports (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 person_tag text not null default 'diego' check (person_tag = 'diego'),
 account_email text not null check (char_length(account_email) between 3 and 254),
 message_id text not null check (message_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
 transaction_id uuid not null,
 received_at timestamptz not null,
 sender text not null check (char_length(sender) <= 500),
 subject text not null check (char_length(subject) <= 500),
 excerpt text not null check (char_length(excerpt) <= 6000),
 parser_version text not null default 'rules-v1',
 created_at timestamptz not null default now(),
 unique(user_id,account_email,message_id)
);
alter table public.gmail_imports enable row level security;
create policy "Read own Gmail receipts" on public.gmail_imports for select to authenticated
 using ((select auth.uid()) = user_id);
revoke all on public.gmail_imports from anon,authenticated;
grant select on public.gmail_imports to authenticated;
create index gmail_imports_transaction_idx on public.gmail_imports(user_id,transaction_id);

-- The transaction and import receipt commit together, including concurrent clicks on two devices.
create function public.import_gmail_movement(p_email jsonb,p_movement jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 owner_id uuid := auth.uid();
 new_id uuid := gen_random_uuid();
 receipt_id uuid;
 result jsonb;
 account text := lower(p_email->>'account');
begin
 if owner_id is null or not exists (select 1 from auth.users where id=owner_id and email='diego-access@nts-financial.example.com') then
   raise exception 'Solo Diego puede importar movimientos de Gmail.' using errcode='42501';
 end if;
 if account is null or account !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Correo inválido.'; end if;
 if p_movement->>'kind' not in ('income','expense') or p_movement->>'kind' is null
   or p_movement->>'currency' not in ('COP','USD') or p_movement->>'currency' is null
   or coalesce(p_movement->>'flow_type','operating') not in ('operating','transfer') then raise exception 'Movimiento inválido.'; end if;
 if (p_movement->>'date')::date > (now() at time zone 'America/Bogota')::date then raise exception 'La fecha no puede estar en el futuro.'; end if;
 if p_movement->>'kind' = 'income' and not exists (
   select 1 from public.income_sources where id=(p_movement->>'source_id')::uuid and user_id=owner_id and person_tag='diego' and context='Personal'
 ) then raise exception 'Selecciona una fuente de ingreso propia.'; end if;
 insert into public.gmail_imports(user_id,account_email,message_id,transaction_id,received_at,sender,subject,excerpt)
 values(owner_id,account,p_email->>'messageId',new_id,(p_email->>'receivedAt')::timestamptz,p_email->>'sender',p_email->>'subject',p_email->>'excerpt')
 on conflict (user_id,account_email,message_id) do nothing returning id into receipt_id;
 if receipt_id is null then
   return jsonb_build_object('duplicate',true);
 end if;
 insert into public.transactions(id,user_id,person_tag,date,competence_date,kind,amount,currency,context,category,description,source_id,flow_type,reference)
 values(new_id,owner_id,'diego',(p_movement->>'date')::date,(p_movement->>'date')::date,p_movement->>'kind',
   (p_movement->>'amount')::numeric,p_movement->>'currency','Personal',p_movement->>'category',p_movement->>'description',
   case when p_movement->>'kind'='income' then (p_movement->>'source_id')::uuid else null end,
   coalesce(p_movement->>'flow_type','operating'),'gmail:' || (p_email->>'messageId')) returning to_jsonb(transactions.*) into result;
 return jsonb_build_object('duplicate',false,'transaction',result);
end;
$$;
revoke all on function public.import_gmail_movement(jsonb,jsonb) from public,anon;
grant execute on function public.import_gmail_movement(jsonb,jsonb) to authenticated;
commit;
