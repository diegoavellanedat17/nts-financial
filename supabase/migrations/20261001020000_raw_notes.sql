begin;
create table public.notes (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 person_tag text not null default 'natalia' check (person_tag ~ '^[a-z][a-z0-9_]{0,39}$'),
 body text not null check (char_length(trim(body)) between 1 and 4000 and body ~ '[^[:space:]]'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.notes enable row level security;
create policy "Own notes only" on public.notes for all to authenticated
 using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
revoke all on public.notes from anon;
grant select,insert,update,delete on public.notes to authenticated;
create index notes_person_date_idx on public.notes(user_id,person_tag,created_at desc,id);
alter table public.change_history drop constraint change_history_table_name_check;
alter table public.change_history add constraint change_history_table_name_check check (table_name in ('transactions','income_sources','notes'));
create trigger notes_updated_at before update on public.notes for each row execute function public.preserve_change_timestamps();
create trigger notes_history after insert or update or delete on public.notes for each row execute function public.record_financial_change();
commit;
