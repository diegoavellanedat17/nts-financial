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
  (kind = 'expense' and category in ('Alimentación', 'Transporte', 'Hogar', 'Compras', 'Bienestar', 'Arriendo consultorio', 'Materiales', 'Laboratorio', 'Servicios', 'Otros', 'Deudas', 'Carro', 'Regalos', 'Oficina', 'Planes', 'Salud', 'Python', 'Mercado', 'Tarjeta de crédito'))
);


create or replace function public.general_summary(p_month text)
returns table(person_tag text,kind text,category text,currency text,amount numeric,pending_amount numeric)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from auth.users u where u.id=auth.uid() and u.email in ('diego-access@nts-financial.example.com','natalia-access@nts-financial.example.com')) then
  raise exception 'Acceso no permitido.' using errcode='42501';
 end if;
 if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Mes inválido.'; end if;
 return query select t.person_tag,t.kind,
  case when t.context='Consultorio' then 'Consultorio' when t.kind='income' then 'Ingresos' when t.category in ('Alimentación','Transporte','Hogar','Compras','Bienestar','Servicios','Deudas','Carro','Regalos','Oficina','Planes','Salud','Python','Mercado','Tarjeta de crédito') then t.category else 'Otros' end,
  t.currency,sum(t.amount),sum(case when t.person_tag='natalia' and t.kind='income' and t.reserved>0 and (t.reserve_release_date is null or t.reserve_release_date>(now() at time zone 'America/Bogota')::date) then t.reserved else 0 end)
 from public.transactions t join auth.users u on u.id=t.user_id
 where ((u.email='diego-access@nts-financial.example.com' and t.person_tag='diego') or (u.email='natalia-access@nts-financial.example.com' and t.person_tag='natalia'))
  and t.flow_type='operating' and t.balance_check_id is null and (t.transfer_id is null or t.transfer_role='fee')
  and (t.context='Personal' or (t.kind='income' and t.context in ('Consultorio','Clínica 1','Clínica 2','Clínica 3')))
  and t.date>= (p_month||'-01')::date and t.date< ((p_month||'-01')::date+interval '1 month')
  and t.date<=(now() at time zone 'America/Bogota')::date
 group by 1,2,3,4 order by 1,2,3,4;
end; $$;
revoke all on function public.general_summary(text) from public,anon;
grant execute on function public.general_summary(text) to authenticated;
commit;

notify pgrst, 'reload schema';
