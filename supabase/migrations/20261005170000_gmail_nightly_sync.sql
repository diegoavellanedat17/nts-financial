begin;
create table public.gmail_connections (
 user_id uuid primary key references auth.users(id) on delete cascade,
 account_email text not null check(account_email='diego.avellaneda1733@gmail.com'),
 account_id uuid not null references public.accounts(id),
 token_ciphertext text not null,
 status text not null default 'active' check(status in ('active','reauthorize','paused')),
 enabled_since timestamptz not null default now(),
 last_success_at timestamptz,
 last_run_at timestamptz,
 last_error text,
 last_imported integer not null default 0,
 last_reviews integer not null default 0,
 scan_start timestamptz, scan_end timestamptz, page_token text,
 lease_id uuid, lease_until timestamptz,
 updated_at timestamptz not null default now()
);
create table public.gmail_oauth_states (
 state_hash text primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 account_id uuid not null references public.accounts(id),
 browser_hash text not null,
 verifier_ciphertext text not null,
 expires_at timestamptz not null
);
create table public.gmail_sync_runs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 started_at timestamptz not null default now(), finished_at timestamptz,
 status text not null default 'running' check(status in ('running','success','partial','error')),
 imported integer not null default 0, reviews integer not null default 0,
 error_code text
);
create table public.gmail_sync_reviews (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 account_email text not null,
 message_id text not null,
 candidate jsonb not null,
 reason text not null,
 status text not null default 'pending' check(status in ('pending','ignored','imported')),
 created_at timestamptz not null default now(),
 unique(user_id,account_email,message_id)
);
alter table public.gmail_connections enable row level security;
alter table public.gmail_oauth_states enable row level security;
alter table public.gmail_sync_runs enable row level security;
alter table public.gmail_sync_reviews enable row level security;
revoke all on public.gmail_connections,public.gmail_oauth_states,public.gmail_sync_runs,public.gmail_sync_reviews from anon,authenticated;
grant all on public.gmail_connections,public.gmail_oauth_states,public.gmail_sync_runs,public.gmail_sync_reviews to service_role;
grant select on public.gmail_sync_runs,public.gmail_sync_reviews to authenticated;
grant update(status) on public.gmail_sync_reviews to authenticated;
create policy "Own sync runs" on public.gmail_sync_runs for select to authenticated using(auth.uid()=user_id);
create policy "Own sync reviews" on public.gmail_sync_reviews for select to authenticated using(auth.uid()=user_id);
create policy "Dismiss own sync reviews" on public.gmail_sync_reviews for update to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id and status in ('pending','ignored'));
create index gmail_reviews_pending on public.gmail_sync_reviews(user_id,created_at desc) where status='pending';

create function public.claim_gmail_sync(p_user uuid,p_lease uuid) returns setof public.gmail_connections
language sql security definer set search_path='' as $$
 update public.gmail_connections set lease_id=p_lease,lease_until=now()+interval '5 minutes',last_run_at=now()
 where user_id=p_user and status='active' and (lease_until is null or lease_until<now()) returning *;
$$;
revoke all on function public.claim_gmail_sync(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_gmail_sync(uuid,uuid) to service_role;

create function public.import_automatic_gmail(p_user uuid,p_lease uuid,p_candidate jsonb,p_movement jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare connection public.gmail_connections; new_id uuid:=gen_random_uuid(); receipt uuid; message text:=p_candidate->>'messageId';
begin
 select * into connection from public.gmail_connections where user_id=p_user for update;
 if not found or connection.status<>'active' or connection.lease_id is distinct from p_lease or connection.lease_until<now() then raise exception 'Synchronization lease expired'; end if;
 if not exists(select 1 from auth.users where id=p_user and email='diego-access@nts-financial.example.com')
 or not exists(select 1 from public.accounts where id=connection.account_id and user_id=p_user and person_tag='diego' and currency='COP' and lower(name)='bancolombia') then raise exception 'Invalid owner or account'; end if;
 if p_candidate->>'account' is distinct from connection.account_email or message is null or message !~ '^[a-zA-Z0-9_-]{1,100}$' then raise exception 'Invalid receipt'; end if;
 if exists(select 1 from public.gmail_imports where user_id=p_user and account_email=connection.account_email and message_id=message)
 or exists(select 1 from public.gmail_sync_reviews where user_id=p_user and account_email=connection.account_email and message_id=message) then return 'duplicate'; end if;
 if p_movement is null or exists(select 1 from public.transactions where user_id=p_user and date=(p_movement->>'date')::date and kind=p_movement->>'kind' and amount=(p_movement->>'amount')::numeric and currency=p_movement->>'currency' and (account_id=connection.account_id or account_id is null) and flow_type='operating') then
  insert into public.gmail_sync_reviews(user_id,account_email,message_id,candidate,reason) values(p_user,connection.account_email,message,p_candidate,case when p_movement is null then 'Confirma este aviso antes de guardarlo.' else 'Podría estar registrado; revisa antes de guardar.' end);
  return 'review';
 end if;
 if p_movement->>'kind' is distinct from 'expense' or p_movement->>'currency' is distinct from 'COP' or p_movement->>'flow_type' is distinct from 'operating' or p_movement->>'account_id' is distinct from connection.account_id::text or (p_movement->>'date')::date>(now() at time zone 'America/Bogota')::date then raise exception 'Invalid automatic movement'; end if;
 insert into public.gmail_imports(user_id,account_email,message_id,transaction_id,received_at,sender,subject,excerpt,parser_version)
 values(p_user,connection.account_email,message,new_id,(p_candidate->>'receivedAt')::timestamptz,p_candidate->>'sender',p_candidate->>'subject',p_candidate->>'excerpt','bancolombia-debit-v1') on conflict(user_id,account_email,message_id) do nothing returning id into receipt;
 if receipt is null then return 'duplicate';end if;
 insert into public.transactions(id,user_id,person_tag,date,competence_date,kind,amount,currency,context,category,description,reserved,from_reserve,flow_type,reference,account_id,payment_method,counterparty)
 values(new_id,p_user,'diego',(p_movement->>'date')::date,(p_movement->>'date')::date,'expense',(p_movement->>'amount')::numeric,'COP','Personal',p_movement->>'category',p_movement->>'description',0,false,'operating','gmail:'||message,connection.account_id,'debit_card',p_movement->>'counterparty');
 return 'imported';
end;
$$;
revoke all on function public.import_automatic_gmail(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.import_automatic_gmail(uuid,uuid,jsonb,jsonb) to service_role;

create function public.resolve_gmail_sync_review() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.gmail_sync_reviews set status='imported' where user_id=new.user_id and account_email=new.account_email and message_id=new.message_id;
 return new;
end; $$;
create trigger gmail_review_imported after insert on public.gmail_imports for each row execute function public.resolve_gmail_sync_review();
commit;
