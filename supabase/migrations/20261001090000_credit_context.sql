begin;
create table public.credit_cards (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),person_tag text not null check(person_tag in ('diego','natalia')),
 name text not null check(char_length(trim(name)) between 1 and 80),currency text not null check(currency in ('COP','USD')),
 debt numeric not null check(debt between 0 and 999999999),credit_limit numeric check(credit_limit between 0 and 999999999),monthly_payment numeric check(monthly_payment between 0 and 999999999),
 monthly_rate numeric check(monthly_rate between 0 and 20),closing_day integer check(closing_day between 1 and 31),payment_day integer check(payment_day between 1 and 31),
 balance_date date not null,notes text not null default '' check(char_length(notes)<=4000),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(id,user_id,person_tag,currency),unique(user_id,person_tag,name,currency),
 check(debt=round(debt,case when currency='COP' then 0 else 2 end) and (credit_limit is null or credit_limit=round(credit_limit,case when currency='COP' then 0 else 2 end)) and (monthly_payment is null or monthly_payment=round(monthly_payment,case when currency='COP' then 0 else 2 end)))
);
create table public.credit_scenarios (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),person_tag text not null,
 card_id uuid not null,currency text not null,description text not null check(char_length(trim(description)) between 1 and 1000),
 amount numeric not null check(amount>0 and amount<=999999999),installments integer not null check(installments between 1 and 120),monthly_rate numeric check(monthly_rate between 0 and 20),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(card_id,user_id,person_tag,currency) references public.credit_cards(id,user_id,person_tag,currency),
 check(amount=round(amount,case when currency='COP' then 0 else 2 end))
);
alter table public.credit_cards enable row level security;
alter table public.credit_scenarios enable row level security;
create policy "Own credit cards" on public.credit_cards for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy "Own credit scenarios" on public.credit_scenarios for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
grant select,insert,update,delete on public.credit_cards,public.credit_scenarios to authenticated;
revoke all on public.credit_cards,public.credit_scenarios from anon;
alter table public.change_history drop constraint change_history_table_name_check;
alter table public.change_history add constraint change_history_table_name_check check(table_name in ('transactions','income_sources','notes','accounts','transfers','account_balance_checks','credit_cards','credit_scenarios'));
create trigger credit_cards_updated before update on public.credit_cards for each row execute function public.preserve_change_timestamps();
create trigger credit_cards_history after insert or update or delete on public.credit_cards for each row execute function public.record_financial_change();
create trigger credit_scenarios_updated before update on public.credit_scenarios for each row execute function public.preserve_change_timestamps();
create trigger credit_scenarios_history after insert or update or delete on public.credit_scenarios for each row execute function public.record_financial_change();
create index credit_cards_person_idx on public.credit_cards(user_id,person_tag);
create index credit_scenarios_person_idx on public.credit_scenarios(user_id,person_tag);
commit;
