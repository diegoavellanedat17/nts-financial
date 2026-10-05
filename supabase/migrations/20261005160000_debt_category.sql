begin;
-- Locate the original unnamed category constraint without changing other checks.
do $$
declare category_check record;
begin
  for category_check in
    select conname from pg_constraint
    where conrelid = 'public.transactions'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%category%'
  loop
    execute format('alter table public.transactions drop constraint %I', category_check.conname);
  end loop;
end $$;
alter table public.transactions add constraint transactions_category_check check (
  (kind = 'income' and category in ('Consulta', 'Tratamiento', 'Honorarios', 'Otros')) or
  (kind = 'expense' and category in ('Alimentación', 'Transporte', 'Hogar', 'Compras', 'Bienestar', 'Arriendo consultorio', 'Materiales', 'Laboratorio', 'Servicios', 'Otros', 'Deudas'))
);
commit;
