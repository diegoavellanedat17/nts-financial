-- Después de las tres migraciones. SQL Editor tiene acceso administrativo.
-- La API respeta RLS por cuenta; person_tag clasifica personas, no autentica personas.
select * from public.movements_export
order by person_tag,payment_date,transaction_id;

-- En qué se gasta cada persona, sin mezclar Personal con Consultorio.
select person_tag,date_trunc('month',date)::date as month,context,category,sum(amount) as spent_cop
from public.transactions where kind='expense' and flow_type='operating'
group by person_tag,date_trunc('month',date)::date,context,category
order by person_tag,month desc,context,spent_cop desc;

select * from public.person_cashflow_monthly
order by person_tag,month desc,context,flow_type;

-- Resultado de movimientos registrados; faltan cobros/pagos pendientes y ajustes contables.
select person_tag,month,sum(income_cop) as income_cop,sum(expense_cop) as expense_cop,sum(recorded_result_cop) as result_cop
from public.person_pnl_recorded_monthly where context='Consultorio'
group by person_tag,month order by person_tag,month desc;

-- Dinámica de pagos: fuente, fechas de cobro y tiempo entre trabajo y pago.
-- competence_date se asume igual al pago cuando no se especificó; cero no prueba pago inmediato.
select person_tag,income_source,payment_date,competence_date,
 payment_date-competence_date as recorded_days_to_payment,amount_cop,reference
from public.movements_export where kind='income' and flow_type='operating'
order by person_tag,income_source,payment_date;

-- Revisión semanal: completar conceptos y clasificar gastos.
select id,person_tag,date,context,amount,description
from public.transactions where category='Otros' and flow_type='operating'
order by date desc;

-- Creaciones, correcciones y eliminaciones; las filas eliminadas siguen aquí.
select recorded_at,person_tag,table_name,record_id,operation,actor_user_id,before_data,after_data
from public.change_history order by recorded_at desc,event_sequence desc;

-- Notas crudas para analizar sin transformarlas en movimientos ni sumarlas como pagos.
select id,user_id,person_tag,body,created_at,updated_at
from public.notes order by person_tag,created_at,id;
