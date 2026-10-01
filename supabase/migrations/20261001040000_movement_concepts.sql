begin;
alter table public.transactions drop constraint transactions_description_check;
alter table public.transactions add constraint transactions_description_check check(char_length(trim(description)) between 1 and 4000);
commit;
