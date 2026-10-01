# Natalia · Finanzas con calma

Primera versión de una app de finanzas personales y del consultorio. React + TypeScript + Vite, con Supabase Auth/Postgres y despliegue en Vercel. Moneda: COP.

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
3. En Authentication → Users, crea la cuenta de Natalia (y de cada persona que deba tener su propio espacio) con correo, contraseña y correo confirmado. No hay registro público. La app usa `signInWithPassword`; no requiere un proveedor SMTP para entrar.
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

Configura en Vercel `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` para Production y los entornos de Preview que vayas a usar. En Supabase Auth configura el dominio definitivo como Site URL y Redirect URL, y crea la cuenta de Natalia con correo confirmado y contraseña. El acceso con correo y contraseña es obligatorio cuando Supabase está conectado. Los registros de demo del navegador no se transfieren automáticamente a producción.

Después de publicar, prueba un ingreso y un gasto de prueba con la cuenta invitada, recarga y confirma desde otro dispositivo que persisten. La conexión Git publica el frontend; los cambios futuros de base de datos se aplican con migraciones antes de publicar un frontend que los necesite.

## Despliegue actual

App: https://nts-financial.vercel.app

Supabase: proyecto `taprvieqmbnbqlatcwdu` (`nts-financial`), organización independiente Natalia Finanzas, región us-east-1. Ambas migraciones están aplicadas. Las variables públicas están configuradas en Vercel para Production y Preview. El registro público está deshabilitado y las cuentas se habilitan administrativamente. Las contraseñas y claves privadas nunca se guardan en Git.

La primera publicación se hizo por CLI. Para activar los siguientes despliegues por push, conecta GitHub en https://vercel.com/account/settings/authentication y después ejecuta `vercel git connect https://github.com/diegoavellanedat17/nts-financial --scope diego-personal --yes`. CI de GitHub ya comprueba cada push.
