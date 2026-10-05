begin;
alter table public.transactions drop constraint transactions_category_check;
alter table public.transactions add constraint transactions_category_check check (
  (kind = 'income' and category in ('Consulta', 'Tratamiento', 'Honorarios', 'Otros')) or
  (kind = 'expense' and category in ('Alimentación', 'Transporte', 'Hogar', 'Compras', 'Bienestar', 'Arriendo consultorio', 'Materiales', 'Laboratorio', 'Servicios', 'Otros', 'Deudas', 'Carro'))
);
commit;
