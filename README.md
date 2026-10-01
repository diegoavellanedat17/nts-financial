# Natalia · Finanzas con calma

Primera versión de una app de finanzas personales y del consultorio. React + TypeScript + Vite, con Supabase Auth/Postgres y despliegue en Vercel. Monedas: COP y USD.

## Usar en local

Requiere Node.js 22.12 o superior de la rama 22 (`.nvmrc`).

```sh
npm install
npm run dev
```

Abre la dirección que imprime Vite (normalmente http://localhost:5173).

Si tu equipo todavía tiene Node 18, puedes ejecutar los comandos sin cambiar la instalación global:

```sh
npx -y -p node@22 -c 'npm install'
npx -y -p node@22 -c 'npm run dev'
```

Sin variables de Supabase, entra en modo demo con datos de ejemplo claramente identificados. Guarda los cambios en este navegador; no sincroniza entre dispositivos. «Empezar desde cero» borra solo los registros locales. Los datos de ejemplo nunca se suben automáticamente a Supabase.

## La pantalla diaria

Una sola pantalla con el disponible actual, dos botones grandes y los últimos movimientos.

- **Recibí dinero:** monto y fuente de ingreso (puedes poner los nombres reales de las clínicas y agregar fuentes desde Opciones). Registra cada pago cuando se reciba, aunque llegue en fechas distintas. No se presupone un salario mensual ni una fecha fija de pago.
- **Pagué algo:** monto y Personal o Consultorio. La categoría es opcional y ayuda a entender en qué se gasta. No obliga a escribir una nota o una fecha. La fecha inicial es hoy y la descripción se completa automáticamente.
- **Consultorio:** compara sus cobros y pagos de este mes e indica cuánto falta para cubrir sus gastos con lo recibido.
- **Últimos movimientos:** toca uno para corregirlo o eliminarlo; «Ver anteriores» muestra el resto.

La nota, una fecha pasada y el dinero apartado para tratamientos quedan dentro de «Agregar nota o cambiar fecha». Las reservas de la versión anterior se conservan y siguen contando en el saldo. El menú Opciones contiene fuentes de ingreso, ayuda, descarga CSV, reinicio de demo y cierre de sesión. «¿En qué se fue el dinero?» abre un desglose del mes por categoría y espacio.

## Cómo se calcula

Disponible = lo recibido hasta hoy − lo pagado hasta hoy − reservas pendientes. El saldo acumula movimientos de meses anteriores: cambiar de mes no reinicia el dinero. Los movimientos de fecha futura ya existentes se conservan, pero no cuentan en el disponible hasta esa fecha. El formulario registra dinero efectivamente recibido o pagado, con fecha de hoy o pasada.

El consultorio compara únicamente sus movimientos del mes actual. La diferencia indica lo que falta cubrir; no registra automáticamente aportes personales ni afirma que ya se hayan realizado.

El saldo inicial es cero. Registra lo que ya tienes como un ingreso y selecciona **Saldo inicial** en el tipo de movimiento. Así cuenta en caja pero se excluye del resultado operativo. Las reservas se compensan por espacio de trabajo, no por paciente ni tratamiento individual. No hay conciliación bancaria, impuestos, cobros pendientes ni conexión con Dentalink. Usa notas generales sin datos clínicos de pacientes.

La migración de almacenamiento y el esquema de Supabase conservan los movimientos y reservas anteriores. En datos anteriores, la fecha del periodo se inicia con la de pago y el tipo se inicia como `operating`: revisa saldos iniciales y periodos históricos antes de sacar reportes. Los presupuestos existentes se conservan aunque ya no aparecen en la interfaz.

## Conectar Supabase

1. Crea un proyecto Supabase.
2. Para un proyecto nuevo, ejecuta `supabase/schema.sql` una sola vez en el SQL Editor. Si ya ejecutaste la versión anterior, aplica solamente `supabase/migrations/20261001000000_reporting_foundation.sql`. Crea las tablas y políticas RLS por usuario; la llave pública no permite leer registros de otros usuarios.
3. En Authentication → Users, crea las cuentas `natalia-access@nts-financial.example.com` con clave `1357955` y `diego-access@nts-financial.example.com` con clave `123456`, ambas con correo confirmado. La pantalla solo solicita la clave; `signInWithPassword` valida el acceso contra Supabase. No hay registro público ni envío de correos.
4. En Authentication → URL Configuration, configura Site URL y Redirect URLs con `http://localhost:5173` y después con el dominio de Vercel. Estos dominios quedan preparados para futuros flujos de recuperación de cuenta.
5. Copia `.env.example` a `.env.local` y completa `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` con la URL del proyecto y su llave pública/publishable. Nunca uses una llave secreta o service_role.
6. Reinicia `npm run dev`. Aparecerá el acceso por correo y el espacio empezará vacío.

Las tablas y el inicio de sesión requieren esta configuración externa; no se crean automáticamente. Antes de usar datos reales, confirma en Supabase que las políticas estén activas y prueba con dos usuarios que no puedan ver los registros del otro. No hay caché local de datos de cuentas; si falla la lectura o escritura, la app muestra un error y no sustituye registros con la demo.

## Base para PyL, cashflow y exportación

Se conserva una fila por movimiento en `transactions`, con `user_id` de la cuenta propietaria. Por ahora **cada persona tiene su propia cuenta**; no existe administración compartida de otras personas desde el navegador. El ID de persona en el CSV corresponde al UID de Supabase Auth, no a un paciente.

| Dato | Para qué sirve |
| --- | --- |
| `date` | Día del cobro o pago; es la fecha del flujo de caja. |
| `competence_date` | Fecha a la que corresponde el trabajo/gasto; permite agrupar el resultado por periodo. Si no se indica, toma la fecha de pago. |
| `kind`, `amount` | Ingreso o gasto, con monto positivo entero en COP. |
| `flow_type` | Operación normal, saldo inicial, financiación o transferencia; solo `operating` entra en la base de resultado. |
| `context` | Personal, Consultorio o espacio de trabajo. No mezclar gasto personal con costo del consultorio. |
| `source_id` | Fuente de ingreso con ID estable; cambiar su nombre no rompe los movimientos anteriores. |
| `category` | Clasificación del ingreso/gasto; los que no se clasifiquen quedan en Otros. |
| `reserved`, `from_reserve` | Dinero separado de tratamientos; apartarlo no es por sí solo un gasto ni una ganancia. |

La tabla `income_sources` guarda nombre y espacio por usuario. Las fuentes usadas no se eliminan; puedes renombrarlas. El espacio de una fuente existente permanece fijo para no alterar los reportes históricos. Un FK compuesto impide asociar una fuente de otra cuenta o de otro espacio.

Las vistas de Supabase están listas para consumir o exportar:

- `movements_export`: tabla plana con persona, fuente, categoría, dos fechas, moneda, monto y flujo con signo.
- `cashflow_monthly`: recibido, pagado y flujo neto por persona, mes de pago, espacio y tipo de flujo.
- `spending_monthly`: gasto operativo por persona, mes de pago, espacio y categoría.
- `pnl_recorded_monthly`: ingresos/gastos operativos registrados, agrupados por periodo, espacio y categoría.

Las vistas usan `security_invoker` para aplicar las políticas RLS de la cuenta que consulta. Requiere Postgres 15 o superior. [Documentación de vistas de Supabase](https://supabase.com/docs/guides/database/views).

**CSV desde la app:** Opciones → Descargar movimientos. Con Supabase configurado, vuelve a consultar todos los registros y fuentes de la cuenta, paginando en bloques de 500; no exporta solo los últimos visibles. Incluye IDs, fechas de pago/periodo, fuente, categoría, tipo de flujo y monto con signo. Formato UTF-8 con BOM, separador `;`, encabezados y protección de texto contra fórmulas de hojas de cálculo. Los números negativos se conservan como números.

**CSV desde Supabase:** ejecuta las consultas de `supabase/reporting_examples.sql` en SQL Editor y exporta sus resultados. La primera consulta produce una tabla plana completa; las siguientes comparan gastos, flujo y resultado por persona. El SQL Editor usa acceso administrativo y puede ver todas las personas; la app consulta solo la cuenta autenticada. Los UID se pueden identificar en Authentication → Users. También puedes exportar `transactions` desde el proyecto, pero la vista añade el nombre de la fuente.

**Qué falta para un PyL completo:** esta base solo representa operaciones cobradas/pagadas que se registraron. En una siguiente etapa, añadir documentos de ingresos/gastos devengados (facturas u obligaciones) y pagos parciales enlazados, con identificación estable de la operación. El PyL deberá leer la obligación una vez; cashflow deberá leer cada pago. Después se pueden añadir cuentas, transferencias enlazadas, inventario, depreciación, principal/intereses de préstamos y ajustes según la necesidad del consultorio. Las fechas distintas permiten empezar a ordenar los datos, pero aún no resuelven cuentas por cobrar/pagar ni producen utilidad contable definitiva.

## Vercel

1. Sube el proyecto al repositorio y en Vercel importa `diegoavellanedat17/nts-financial`.
2. Usa el preset Vite, Node 22, build `npm run build`, salida `dist` (incluido en `vercel.json`).
3. Añade las dos variables `VITE_SUPABASE_*` al entorno correspondiente antes del build.
4. Despliega y añade el dominio resultante a las URLs de Supabase Auth.
5. Si cambias las variables, vuelve a desplegar: Vite las incorpora al compilar.

Sin variables de entorno, el despliegue será una demo local en el navegador de cada visitante.

## Verificar

```sh
npm run test
npm run build
# Con npm run dev ejecutándose en otra terminal:
npm exec playwright install chromium
npm run test:browser
```

Los tests de Postgres local (PGlite) ejecutan esquema y migración, validan el aislamiento de dos usuarios también en las vistas, las fuentes ajenas, la separación de fechas, la exclusión de saldo inicial de PyL y la conservación de datos históricos. Los tests de finanzas cubren el cálculo de reservas entre meses/espacios, el pago sin doble descuento, exceso de reserva, validación y exportación CSV. La prueba de navegador cubre el registro rápido sin detalles obligatorios, pagos en distintas fechas, saldo entre meses, gastos del consultorio, reservas, edición/eliminación, persistencia local, fuentes con nombre, categorías, fechas de periodo, CSV y pantallas de 320/375 px. Guarda capturas en `artifacts/` (ignorado por Git). No se han ejecutado pruebas contra una cuenta Supabase real sin credenciales de proyecto.

Referencias de configuración: [Vite](https://vite.dev/guide/), [Vite en Vercel](https://vercel.com/docs/frameworks/frontend/vite), [seguridad por usuario en Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security) y [acceso con contraseña](https://supabase.com/docs/reference/javascript/auth-signinwithpassword).

## Despliegue conectado a Git

El workflow `.github/workflows/ci.yml` comprueba tests de finanzas/Postgres, compilación y flujos de navegador en cada push y PR a `main`. El despliegue se realiza con la integración Git de Vercel: importa este repositorio y configura `main` como rama de producción. Los pushes siguientes publicarán una nueva versión. La configuración de Vite impide que Vercel publique sin las dos variables públicas de Supabase: la nube debe guardar datos en Supabase, mientras el modo demo sigue disponible en desarrollo local.

Para crear **una base de datos nueva** con las migraciones versionadas:

```sh
npx supabase@2.119.0 login
npx supabase@2.119.0 link --project-ref TU_PROJECT_REF
npx supabase@2.119.0 db push --dry-run
npx supabase@2.119.0 db push
```

Esto requiere acceso a la cuenta y contraseña de la base cuando la CLI la solicite. Las migraciones incluyen el esquema inicial y la base de reportes. Usa `schema.sql` o las migraciones de CLI, no ambos contra la misma base nueva. Si el proyecto ya tiene tablas creadas manualmente, revisa su esquema y alinea el historial de migraciones antes de hacer `db push`.

Configura en Vercel `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` para Production y los entornos de Preview que vayas a usar. En Supabase Auth configura el dominio definitivo como Site URL y Redirect URL, y crea la cuenta de Natalia compartida según el paso 3 de Conectar Supabase. El acceso con clave es obligatorio cuando Supabase está conectado. Los registros de demo del navegador no se transfieren automáticamente a producción.

Después de publicar, prueba un ingreso y un gasto de prueba con la cuenta invitada, recarga y confirma desde otro dispositivo que persisten. La conexión Git publica el frontend; los cambios futuros de base de datos se aplican con migraciones antes de publicar un frontend que los necesite.

## Despliegue actual

App: https://nts-financial.vercel.app

Supabase: proyecto `taprvieqmbnbqlatcwdu` (`nts-financial`), organización independiente Natalia Finanzas, región us-east-1. Las seis migraciones están aplicadas, con personas, trazabilidad, notas libres y secuencia de eventos. Las variables públicas están configuradas en Vercel para Production y Preview. El registro público está deshabilitado y las cuentas se habilitan administrativamente. Las claves administrativas de Supabase nunca se guardan en Git. Las claves de acceso de esta versión están incluidas en el cliente según lo solicitado.

Vercel está conectado a `diegoavellanedat17/nts-financial`. Cada push a `main` publica automáticamente la app en https://nts-financial.vercel.app; guardar cambios locales solo actualiza el servidor local. CI de GitHub comprueba cada push por separado. Las migraciones de Supabase se aplican con `supabase db push` y no forman parte del despliegue del frontend.

## Acceso rápido

Las claves fijas de esta versión son `1357955` para Natalia y `123456` para Diego. Cada una inicia su propia cuenta de Supabase y consulta sus movimientos y notas. Supabase conserva y renueva la sesión en el navegador hasta cerrar sesión o borrar sus datos. La demo local también recuerda el acceso.

Estas claves están incluidas en el código del cliente por decisión de esta versión; quien conozca una clave puede entrar a esa cuenta. Las políticas RLS siguen exigiendo una sesión válida de Supabase. Los registros de otras cuentas, si existen, no se trasladan ni eliminan.

## Rutina y trazabilidad

- Separa Personal y Consultorio en cada movimiento, aunque compartan una cuenta bancaria. Procura mantener también el dinero en cuentas separadas.
- Registra cada abono cuando llegue; no cuentes como dinero disponible el valor total de un tratamiento si todavía no lo han pagado. Aparta lo necesario para materiales y laboratorio.
- Usa conceptos consistentes: arriendo, laboratorio, materiales, mercado, transporte. En detalles puedes identificar el tercero, medio de pago y referencia del caso en Dentalink/recibo.
- Si el pago corresponde a un trabajo anterior, indica su fecha de periodo. Cuando se deja vacía se asume la fecha del pago; los análisis deben tener en cuenta esa suposición.
- Una vez por semana revisa recibos/extractos y corrige conceptos incompletos. Una vez al mes revisa ingresos/costos del consultorio antes de decidir cuánto dinero retirar para uso personal. Un retiro entre tus espacios se clasifica como transferencia, no como otro ingreso ganado.

`transactions.person_tag` distingue `natalia` y `diego` en la misma tabla. La persona activa se obtiene de la cuenta autenticada; las lecturas y escrituras filtran por cuenta y tag. Las políticas RLS separan las cuentas y la sesión identifica la cuenta que realizó cada cambio.

`change_history` conserva creaciones, correcciones y eliminaciones de movimientos y fuentes con las versiones antes/después y fecha del evento. Solo los triggers escriben en el historial; las cuentas de la app pueden consultarlo pero no modificarlo. El historial empieza al aplicar `20261001010000_people_and_traceability.sql`. Los registros anteriores se guardan como `SNAPSHOT`: no se reconstruyen correcciones anteriores que nunca fueron registradas. `created_at` conserva su fecha y `updated_at` registra cambios posteriores.

`supabase/reporting_examples.sql` incluye consultas por persona/espacio, fuente, fechas, conceptos incompletos e historial. Cuando se solicite un análisis, se puede consultar Supabase para el periodo indicado; no hay un proceso del asistente monitoreando la base en segundo plano. El usuario debe aportar datos reales completos para obtener conclusiones útiles.

Los reportes actuales cubren movimientos registrados. Todavía no hay agenda de cobros, facturas pendientes, saldos de tarjetas ni cuentas conciliadas. Un movimiento con medio tarjeta crédito describe la compra registrada, pero no reconstruye la deuda de la tarjeta ni un flujo bancario conciliado. La liquidación de esa misma compra no se debe registrar como un segundo gasto operativo.

La primera etapa es registrar movimientos reales durante 10 días, sin exigir todos los campos opcionales. Al terminar se revisan fuentes, conceptos, espacios, fechas y registros incompletos para decidir la siguiente mejora a partir de datos. No hay un análisis programado: se inicia cuando el usuario lo solicita.

## Notas libres

La sección «Notas, tal como pasó» guarda texto crudo (incluidos saltos de línea), persona y fechas en `notes`. Se puede corregir y eliminar; los cambios quedan en `change_history`. Las notas no crean movimientos ni cambian saldos. Para analizarlas se leen junto con los movimientos del mismo periodo y persona, sin contar dos veces montos mencionados en el texto. La demo las conserva en su propio almacenamiento del navegador. La migración `20261001020000_raw_notes.sql` agrega la tabla y sus políticas.

## Dos accesos y análisis de notas

Natalia entra con `1357955` y Diego con `123456`. Cada clave inicia una cuenta distinta de Supabase; la app obtiene la persona de la sesión y filtra movimientos, fuentes y notas por cuenta y tag. Cada navegador conserva el perfil con el que entró. Salir cierra solo la sesión de ese navegador. El contenido de cada persona se conserva separado por RLS en la misma tabla.

Las notas pueden explicar montos, origen, destino/cuenta, fechas y dudas con texto libre. Primero se analiza lo escrito. En una etapa posterior, las reglas acordadas podrán convertir patrones repetidos en registros estructurados: la nota original se conserva, cada resultado debe referenciarla y se debe impedir registrar dos veces la misma extracción. Esa conversión todavía no se ejecuta automáticamente y no modifica saldos en esta versión.

Las cuentas de Natalia y Diego ya están creadas en el proyecto publicado.

## Vista personal y monedas

Diego usa una vista de Entrada, Salida y Notas, con fuentes personales y sin secciones del consultorio. Natalia mantiene la vista del consultorio. Las fuentes históricas se conservan en Supabase; la vista personal ofrece solo las de contexto Personal.

Cada movimiento y nota tiene moneda COP o USD. El selector del saldo muestra una moneda a la vez; los gastos y reservas se calculan por esa moneda. USD admite hasta dos decimales y COP conserva montos enteros. Los registros previos se etiquetan COP. No hay conversión automática ni saldo combinado: una tasa de cambio requerirá una operación explícita en otra etapa.

El CSV exporta moneda y monto nativo. `movements_export` usa `amount_native`, `cashflow_native` y `reserved_native`; las vistas `person_cashflow_monthly` y `person_pnl_recorded_monthly` agrupan también por moneda. Las vistas legadas con columnas terminadas en `_cop` solo muestran COP. Las consultas de ejemplo respetan esta separación.
