begin;
alter table public.transactions drop constraint transactions_context_check;
alter table public.transactions add constraint transactions_context_check check(context in ('Personal','Consultorio','Clínica 1','Clínica 2','Clínica 3'));
alter table public.income_sources drop constraint income_sources_context_check;
alter table public.income_sources add constraint income_sources_context_check check(context in ('Personal','Consultorio','Clínica 1','Clínica 2','Clínica 3'));
alter table public.classification_rules drop constraint classification_rules_context_check;
alter table public.classification_rules add constraint classification_rules_context_check check(context in ('Personal','Consultorio','Clínica 1','Clínica 2','Clínica 3'));
commit;
