begin;
-- Public official rates, written only by the server. Financial records retain native currencies.
create table public.exchange_rates (
 date date primary key,
 cop_per_usd numeric not null check (cop_per_usd > 0 and cop_per_usd < 100000),
 valid_from date not null,
 valid_to date not null,
 source text not null check (source = 'https://www.datos.gov.co/resource/32sa-8pi3.json'),
 fetched_at timestamptz not null,
 check (valid_from <= date and valid_to >= date)
);
alter table public.exchange_rates enable row level security;
create policy "Read official rates" on public.exchange_rates for select to authenticated,anon using (true);
revoke all on public.exchange_rates from anon,authenticated;
grant select on public.exchange_rates to anon,authenticated;
commit;
