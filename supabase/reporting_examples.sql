-- Ejecutar después de schema.sql o de la migración reporting_foundation.
-- Estas consultas se pueden exportar a CSV desde los resultados del SQL Editor.
-- El SQL Editor usa privilegios de administración y puede ver todas las personas.
-- En la app las vistas respetan la cuenta autenticada y sus políticas RLS.

-- Tabla plana completa, con persona, fuente, categoría y ambas fechas.
select * from public.movements_export
order by person_id, payment_date, transaction_id;

-- En qué gastó cada persona, separado entre Personal y Consultorio.
select person_id, month, context, category, spent_cop
from public.spending_monthly
order by person_id, month desc, context, spent_cop desc;

-- Entradas/salidas de efectivo, incluyendo saldos iniciales y financiación.
select person_id, month,
  sum(received_cop) as received_cop,
  sum(paid_cop) as paid_cop,
  sum(net_cashflow_cop) as net_cashflow_cop
from public.cashflow_monthly
group by person_id, month
order by person_id, month;

-- Base de resultado del consultorio por periodo (operaciones ya registradas).
-- No es PyL contable completo: faltan obligaciones sin cobrar/pagar, depreciación,
-- inventario, impuestos y ajustes. Las fechas históricas se deben revisar.
select person_id, month,
  sum(case when kind = 'income' then amount_cop else 0 end) as income_cop,
  sum(case when kind = 'expense' then amount_cop else 0 end) as expenses_cop,
  sum(recorded_result_cop) as recorded_result_cop
from public.pnl_recorded_monthly
where context = 'Consultorio'
group by person_id, month
order by person_id, month;
