# Personal Finance

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

Supabase: proyecto `taprvieqmbnbqlatcwdu` (`nts-financial`), organización independiente Natalia Finanzas, región us-east-1. Las nueve migraciones están aplicadas, con personas, trazabilidad, notas históricas, secuencia de eventos, comprobantes Gmail y TRM oficiales. Las variables públicas están configuradas en Vercel para Production y Preview. El registro público está deshabilitado y las cuentas se habilitan administrativamente. Las claves administrativas de Supabase nunca se guardan en Git. Las claves de acceso de esta versión están incluidas en el cliente según lo solicitado.

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

## Notas históricas

La tabla `notes` conserva las notas capturadas en la etapa anterior, con persona, fechas e historial. La sección separada se retiró de la pantalla: los conceptos nuevos se escriben en Entrada/Salida y quedan en `transactions.description`. Para análisis se pueden consultar notas históricas junto con los movimientos, evitando contar dos veces montos mencionados en el texto.

## Dos accesos y análisis de notas

Natalia entra con `1357955` y Diego con `123456`. Cada clave inicia una cuenta distinta de Supabase; la app obtiene la persona de la sesión y filtra movimientos, fuentes y notas por cuenta y tag. Cada navegador conserva el perfil con el que entró. Salir cierra solo la sesión de ese navegador. El contenido de cada persona se conserva separado por RLS en la misma tabla.

Las notas pueden explicar montos, origen, destino/cuenta, fechas y dudas con texto libre. Primero se analiza lo escrito. En una etapa posterior, las reglas acordadas podrán convertir patrones repetidos en registros estructurados: la nota original se conserva, cada resultado debe referenciarla y se debe impedir registrar dos veces la misma extracción. Esa conversión todavía no se ejecuta automáticamente y no modifica saldos en esta versión.

Las cuentas de Natalia y Diego ya están creadas en el proyecto publicado.

## Vista personal y monedas

Diego usa una vista de Entrada y Salida, con fuentes personales y sin secciones del consultorio. Natalia mantiene la vista del consultorio. Las fuentes históricas se conservan en Supabase; la vista personal ofrece solo las de contexto Personal.

Cada movimiento y nota tiene moneda COP o USD. El selector del saldo muestra una moneda a la vez; los gastos y reservas se calculan por esa moneda. USD admite hasta dos decimales y COP conserva montos enteros. Los registros previos se etiquetan COP. Total en COP permite valorar ambas monedas con la TRM vigente, conservando los montos nativos.

El CSV exporta moneda y monto nativo. `movements_export` usa `amount_native`, `cashflow_native` y `reserved_native`; las vistas `person_cashflow_monthly` y `person_pnl_recorded_monthly` agrupan también por moneda. Las vistas legadas con columnas terminadas en `_cop` solo muestran COP. Las consultas de ejemplo respetan esta separación.

## Registro unificado

El concepto se escribe directamente en Entrada/Salida y se guarda en `transactions.description`, con hasta 4000 caracteres y saltos de línea. La sección independiente de notas se retiró de la pantalla; las notas previas y su historial siguen en Supabase para consultar en análisis. Los totales muestran ingresos del mes en verde y gastos del mes en rojo por moneda. Lista/Tabla permite consultar fecha, concepto, tipo, moneda y monto; la tabla contiene todos los movimientos de la cuenta y permite corregirlos desde el concepto.


## Importación de Gmail para Diego

El botón **Revisar Gmail** abre la autorización de Google y busca avisos del día elegido en horario de Colombia. Los montos ambiguos y las monedas no explícitas requieren revisión. Cada aviso permite corregir tipo, monto, COP/USD, fecha, concepto, categoría y fuente; guardar exige una confirmación por movimiento. Los correos de facturas, rechazos o pagos pendientes nunca se registran solos. No interpreta adjuntos ni reemplaza un extracto bancario. La búsqueda inicial cubre frases frecuentes de avisos de compras/pagos/transferencias y algunos bancos colombianos; se ajustará con ejemplos reales. Hay un límite visible de 500 correos por consulta.

Google concede lectura con `gmail.readonly` mediante Google Identity Services, modelo de token en navegador. El token existe solo en memoria durante la sesión: no se guarda en Supabase, localStorage, Git ni Vercel. Al vencer o recargar hay que volver a conectar; no existe sincronización automática. El botón Desconectar revoca el permiso. La conexión Gmail de Codex es independiente de esta conexión de la app.

Para habilitarlo:

1. Crear un proyecto propio en [Google Cloud](https://console.cloud.google.com/projectcreate) y habilitar [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
2. En [Google Auth Platform](https://console.cloud.google.com/auth/overview), completar Branding y elegir audiencia External, estado Testing. Agregar el correo personal de Diego como usuario de prueba y el permiso `https://www.googleapis.com/auth/gmail.readonly` en Data Access.
3. Crear un cliente OAuth tipo **Web application** en Clients. Añadir estos **Authorized JavaScript origins**: `https://nts-financial.vercel.app` y `http://localhost:5173`. No requiere redirect URI ni secreto de cliente para este flujo con popup. Las URLs de preview necesitan su propio origen autorizado.
4. Configurar `VITE_GOOGLE_GMAIL_CLIENT_ID` (ID público que termina en `.apps.googleusercontent.com`) y `VITE_GOOGLE_GMAIL_ACCOUNT` (cuenta personal esperada) en `.env.local` y Vercel. Reiniciar local o desplegar de nuevo para incorporar cambios. Nunca usar una contraseña de Gmail ni copiar un client secret al frontend.
5. Entrar como Diego, pulsar Revisar Gmail, escoger la cuenta configurada y autorizar lectura. La cuenta se comprueba antes de buscar correos. En modo Testing puede requerirse volver a autorizar; la distribución pública con este permiso restringido puede requerir verificación de Google.

La migración `20261001050000_gmail_import.sql` crea `gmail_imports` y la función `import_gmail_movement`. La función permite importar únicamente al usuario de acceso de Diego, valida su fuente y escribe movimiento + comprobante en una sola transacción. La clave única `(user_id, account_email, message_id)` evita duplicados incluso con dos dispositivos o al repetir después de un fallo de red. El comprobante permanece si se borra el movimiento: conserva cuenta, ID del correo, remitente, asunto, fecha de recepción, fragmento original (hasta 6000 caracteres), versión del parser y relación al movimiento. Las correcciones del movimiento siguen en `change_history`; los comprobantes son solo de lectura para el cliente. No se almacena el buzón completo ni los adjuntos.

Un movimiento registrado manualmente con igual fecha, moneda, monto y tipo muestra una advertencia; confirmar otro correo que representa la misma operación sigue requiriendo criterio del usuario. Para transferencias propias usa el formulario entre cuentas: registra ambos lados y la comisión en una operación atómica. Un aviso de Gmail que corresponda a una transferencia propia debe revisarse y registrarse desde ese formulario, sin importarlo además como ingreso o gasto.

Referencias: [modelo de token](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [configuración del ID](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid), [filtros y fechas de Gmail](https://developers.google.com/workspace/gmail/api/guides/filtering).


## Total en COP a la TRM del día

Diego abre por defecto **Total en COP**: disponible, ingresos y gastos del mes se valoran en pesos usando la TRM vigente del día en Colombia. Natalia conserva COP por defecto y también puede seleccionar Total en COP. Los botones COP/USD muestran cada moneda por separado. Todos los movimientos y el CSV conservan la moneda/monto original; esta vista es una valoración actual estimada, no una conversión bancaria ni un P&L histórico a tasas de cada transacción. La misma TRM actual se aplica a los USD de todo el historial registrado y del mes visible. Las reservas se calculan por moneda antes de convertir para evitar que un gasto COP consuma una reserva USD.

`GET /api/trm` obtiene la tasa de [datos.gov.co / Superfinanciera](https://www.datos.gov.co/Econom-a-y-Finanzas/Tasa-de-Cambio-Representativa-del-Mercado-TRM/32sa-8pi3). Busca la vigencia que incluye hoy, no el último registro publicado: la tasa de mañana puede estar disponible antes. Persiste fecha de valoración, COP por USD, vigencia, fuente y fecha de consulta en `exchange_rates`, mediante la migración `20261001060000_exchange_rates.sql`. La primera consulta guarda la tasa; consultas posteriores leen la misma tasa guardada para mantener trazabilidad y evitar llamadas repetidas a la fuente. No crea ni cambia movimientos financieros. La tabla es de lectura para el navegador y de escritura solo para el servidor.

La función requiere `SUPABASE_SERVICE_ROLE_KEY` como variable **solo de servidor** en Vercel (Production/Preview) y `.env.local`. Nunca usar prefijo `VITE_` ni exponer esta clave en el cliente. Vite sirve la misma función en local. La función usa hora de Colombia, valida la vigencia de la respuesta y no retorna totales parciales: si falta TRM y hay USD, Total en COP muestra un guion con Reintentar TRM; las vistas nativas siguen disponibles. La pantalla revisa el cambio de día para dejar de usar la tasa anterior. No usa una tasa inventada ni una tasa vencida como reemplazo.


El nombre visible de la aplicación es **Personal Finance**, incluyendo el título del navegador y el nombre sugerido en iPhone. Diego y Natalia siguen siendo los perfiles separados; el nombre activo aparece debajo de la marca.


## Cuentas y transferencias

Mis cuentas crea cuentas COP o USD por perfil. Los movimientos anteriores quedan sin asignar: al corregirlos se puede seleccionar la cuenta de la misma moneda. Los saldos por cuenta suman los movimientos asignados hasta hoy, no representan un extracto conciliado. Un saldo inicial registra únicamente dinero anterior que no esté ya incluido en movimientos registrados. No se inventan saldos ni se reclasifica el historial automáticamente.

La migración `20261001070000_accounts_and_chat.sql` agrega `accounts`, `transfers`, enlaces a los movimientos y sus versiones en `change_history`. Las claves foráneas exigen misma persona, dueño y moneda; RLS impide acceder a otra persona. `create_transfer` escribe salida, entrada y comisión en una transacción. El monto enviado incluye la comisión: principal = enviado − comisión; principal y recepción son transferencias, comisión es gasto operativo en Servicios y `transfer_role=fee`. En una misma moneda recibido = enviado − comisión. En monedas distintas se conserva lo recibido realmente: tipo efectivo = recibido / principal, sin sustituirlo por TRM. No se infieren comisiones por diferencias cambiarias.

Las piernas no admiten edición o eliminación independiente. Para corregir se anula toda la transferencia con `cancel_transfer` y se crea otra; el historial conserva la operación anterior. El CSV y `movements_export` incluyen cuenta, transferencia y rol. Los ingresos/gastos visibles excluyen transferencias y saldos iniciales; el disponible incluye sus efectos nativos. Las cuentas pueden quedar negativas si faltan movimientos asignados; no hay bloqueo bancario por saldo.

## Asistente por persona

El globo abre un chat responsive. `POST /api/chat` valida el JWT con Supabase y obtiene persona del correo de la sesión; ignora cualquier persona indicada por el cliente. Lee con ese JWT y RLS, calcula agregados completos por moneda, mes de pago, categoría, espacio y fuente; incluye saldos de cuentas, comisiones y hasta 200 movimientos recientes, con cobertura explícita. Incluye TRM únicamente si ya hay una tasa válida del día guardada. No lee el buzón ni proveedores en vivo, no ejecuta pagos ni modifica movimientos.

Configurar `OPENAI_API_KEY` **solo en servidor** en `.env.local` y en Vercel → Settings → Environment Variables → Production/Preview. Obtenerla en https://platform.openai.com/api-keys con una cuenta API con saldo. No compartirla en chat ni usar prefijo VITE_. `OPENAI_MODEL` es opcional (por defecto `gpt-5-mini`). Reiniciar local o redesplegar después de agregar variables. Sin clave, el globo indica que falta activación; no inventa respuestas.

La integración usa [Responses API](https://developers.openai.com/api/docs/guides/text), `store:false` y un historial acotado por perfil. Esto desactiva el almacenamiento de Responses, no equivale a retención cero del proveedor. Los registros del perfil se envían a OpenAI para responder la consulta. Supabase conserva pregunta, respuesta, modelo, fecha y el snapshot enviado en `finance_chat`; el perfil puede consultar su propio historial. Los snapshots son del contexto utilizado, no una copia del buzón. Los conceptos se tratan como datos no confiables, sin ejecutar instrucciones contenidas en ellos. Hay un límite básico de cinco consultas guardadas por minuto por usuario; no es una cuota de facturación ni un límite estricto concurrente. Los detalles anteriores a los 200 últimos requieren una consulta más específica en una siguiente iteración; los agregados sí cubren todos los registros.


## Fijar saldo de hoy

En Mis cuentas → Fijar saldo de hoy se indica el saldo bancario actual (COP entero, USD hasta dos decimales, admite cero). `set_account_balance` calcula la diferencia contra todos los movimientos ya asignados a esa cuenta hasta hoy en Colombia y guarda esa diferencia como `opening_balance`, sin afectar ingresos/gastos ni PyL. Solo los movimientos nuevos posteriores deben registrarse después. Asigna los movimientos antiguos conocidos antes de fijarlo; los movimientos sin cuenta no se asignan automáticamente.

La migración `20261001080000_account_balance.sql` conserva saldo declarado, saldo previo, diferencia, fecha y persona en `account_balance_checks`, más sus eventos en `change_history`. Reintentar la misma solicitud no duplica el ajuste. Una corrección se hace fijando nuevamente el saldo, conservando el ajuste anterior. El ajuste no puede editarse o borrarse independientemente. Los movimientos futuros no se incluyen al fijar el saldo; registrar o cambiar movimientos pasados después del ajuste cambia el saldo calculado y puede requerir una nueva comprobación.


## Tarjetas y escenarios de cuotas

Tarjetas de crédito guarda nombre, COP/USD, deuda declarada y fecha del saldo, cuota del próximo pago, cupo, día de corte/pago, tasa mensual opcional y notas. Se actualiza manualmente desde el extracto; no modifica movimientos ni efectivo y no sincroniza con el banco. El cupo es crédito disponible, no dinero propio. La cuota es la del próximo pago declarado, no una obligación mensual permanente reconstruida automáticamente. No se capturan número de tarjeta ni CVV.

¿Y si compro a cuotas? guarda escenarios en `credit_scenarios`. El simulador reparte capital en partes iguales y aplica una tasa mensual fija sobre el saldo de capital pendiente; muestra capital por cuota, primera cuota e intereses totales estimados, sin seguros, comisiones ni reglas de facturación del banco. Una tasa desconocida (`null`) no equivale a 0: muestra solo capital y no inventa intereses. No se asume que todas las compras a una cuota sean sin interés. El cálculo orienta escenarios y no replica necesariamente la liquidación de la tarjeta. Referencia de condiciones: [Bancolombia](https://www.bancolombia.com/educacion-financiera/finanzas-personales/como-saber-interes-tarjetas-de-credito).

Los escenarios no incrementan la deuda ni registran un gasto. Si se realiza una compra, su registro real y posterior pago deben revisarse para no contabilizar dos veces el gasto; esta versión solo agrega contexto crediticio. El asistente recibe tarjetas y escenarios de su perfil con resultados calculados, fecha y supuestos; mantiene la deuda separada de efectivo y compras futuras. Su activación sigue requiriendo OPENAI_API_KEY en el servidor.

`20261001090000_credit_context.sql` agrega tablas por persona, claves foráneas de propietario/persona/moneda, RLS y cambios en `change_history`. `20261001100000_balance_assignment.sql` permite seleccionar movimientos sin cuenta al fijar un saldo; la selección se asocia antes de calcular el ajuste, en la misma transacción, y queda en `linked_transaction_ids`. Se requiere revisar cuáles pertenecen a esa cuenta y cuáles a otras. No se asignan movimientos automáticamente por compartir moneda.

La fecha predeterminada de movimientos, saldos y Gmail usa el día de Colombia, igual que TRM y las funciones de Supabase; no adelanta el día cuando en UTC ya es mañana.

### Reglas y abonos de Natalia

Didi, parqueadero y parqueo → Personal/Transporte; Gladys → Personal/Hogar; ventilador → Personal/Compras. Las reglas se guardan por propietario en `classification_rules`. Se aplican a gastos operativos con categoría Otros; una categoría manual tiene prioridad. Se conserva el concepto original y la regla aplicada, con historial en Supabase. Diego no comparte estas reglas.

Un ingreso de Consultorio puede marcarse como abono de tratamiento pendiente: queda recibido en su cuenta y apartado completo del disponible. «Tratamiento entregado · liberar» registra la fecha de entrega sin crear otro ingreso. Un gasto genérico de laboratorio no consume estos abonos automáticamente. La referencia del caso permite relacionar abonos y costos; aún no se calcula utilidad por tratamiento. El CSV y `movements_export` incluyen regla, indicador de abono y fecha de liberación. Las vistas PyL existentes requieren adaptar el reconocimiento de estos abonos antes de usarlas como estado de resultados.

Las fuentes clínicas de Natalia son Déntica (Clínica 1), Sedato (Clínica 2) y Aleja (Clínica 3). Los nombres se guardan en `income_sources`, conservando los IDs de fuentes existentes y las referencias de ingresos anteriores.
