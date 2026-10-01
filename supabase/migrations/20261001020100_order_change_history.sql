begin;
-- Las fechas pueden coincidir: la secuencia identifica el orden de eventos nuevos.
alter table public.change_history add column event_sequence bigint generated always as identity;
create unique index change_history_sequence_idx on public.change_history(event_sequence);
commit;
