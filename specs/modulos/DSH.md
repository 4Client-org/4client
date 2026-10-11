---
estado: vigente
verificado: 2026-10-10 @ 15f5766
fuentes: [apps/api/src/routes/dashboard.ts, apps/api/src/lib/cierreTotals.ts, apps/api/test/cierre-totales.test.ts, apps/web/src/lib/format.ts, apps/web/src/components/dashboard/ResumenTab.tsx, apps/web/src/hooks/useDashboard.ts, apps/web/src/pages/MainPage.tsx, apps/web/src/lib/csv.ts, apps/api/test/dashboard.test.ts]
---

# DSH — Informe del día

> El tablero del administrador para un día: cuántos pedidos y chats hubo, cuánta plata entró en efectivo y transferencia, qué se fue a la papelera, qué créditos están por cobrar y qué cambió. Se calcula en vivo; desde aquí también se cierra la caja y se bloquean todos los links del formulario.

## 1. Negocio

**Propósito.** Que el dueño vea de un vistazo cómo va el día (o cómo fue uno pasado) y si la plata cuadra. Es una vista de **lectura calculada al momento** sobre los pedidos y chats de la fecha elegida; no guarda nada.

**Alcance y límites.**
- *Incluye:* conteos de pedidos y chats del día, recaudado por bolsa, lista de cerrados sin cobro, pestañas Pedidos, Papelera, Crédito y Cambios, vista de día cerrado, y los botones del encabezado (cerrar caja, CSV, bloquear links) como puntos de entrada.
- *No incluye:* la lógica del cierre, la foto `DailyClose` y la regla de bolsas (**CAJ**); la lógica de bloquear links (**FRM**, **INB**); crear o editar pedidos (**ORD**); la suscripción de la plataforma (**PLT**; aquí solo el aviso del día 1).

**Dependencias.**
- *De qué depende:* **ORD** (pedidos, historial, restaurar), **CAJ** (función de bolsas `lib/cierreTotals.ts`, `DailyClose`, modal de cierre), **INB** (tickets y su resolución por fecha; bloqueo masivo de links), **ACC** (rol admin); Socket.IO para refrescar.
- *Quién depende de él:* nadie a nivel de datos (no escribe nada); el administrador lo usa como vista de control y punto de partida del cierre.

**Permisos.** Fila "Informe del día" de `01-funcional/actores-y-permisos.md`: admin y dev. `GET /dashboard` es `requireRole('admin')` (dev pasa); encargado y domiciliario reciben 403 `FORBIDDEN`. La interfaz coincide: la pestaña solo existe para admin/dev (`MainPage.tsx`: `isAdmin`) y la consulta no se dispara para otros roles (`useDashboard(fecha, enabled)`). Las acciones del encabezado heredan sus propios permisos: cerrar caja (solo admin/dev también en la API, `CAJ` RN-CAJ-31) y bloquear todos los links (solo admin/dev, `FRM`).

**Qué contiene.** Encabezado (selector de fecha, "Cerrar caja" o "Caja ya cerrada" + "Descargar CSV", "Bloquear todos los links"), tarjetas de **Chats de WhatsApp**, tarjetas de **Pedidos** y **Recaudado**, y cuatro pestañas: Pedidos, Papelera, Crédito y Cambios.

**Reglas.**

*Qué pedidos cuentan*

- **RN-DSH-01 — Pedidos del día.** Siempre el informe de una fecha usa los pedidos de la organización con esa `fecha`, excluyendo los de papelera y los eliminados por el cliente (`client_deleted`): para el informe "se hace de cuenta que no existen", aunque sigan visibles en el tablero. Un pedido pasado a mañana en el cierre ya no está en la fecha de origen, así que el informe de ese día no lo cuenta (ver PREG-003). *(plataforma, código)*
- **RN-DSH-02 — Conteos de pedidos.** `total` = pedidos de RN-DSH-01. `entregados` = los que están en `cerrado`; la interfaz lo llama **"Cerrados/Cobrados"** (nombre heredado de la API: cuenta cerrados, estén pagados o no, crédito sin pagar y cerrados sin cobro incluidos). `pendientes` = todos los demás estados (nuevo, preparando, listo, camino y el heredado `entregado`). Siempre `total = entregados + pendientes`. *(plataforma, código)*
- **RN-DSH-03 — `domActivos` se calcula pero no se muestra.** La API devuelve `domActivos` (pedidos en preparando, listo o camino con domiciliario asignado); ninguna pantalla lo usa. *(plataforma, código)*

*Chats*

- **RN-DSH-04 — Qué chats entran.** Un chat (ticket) cuenta si su `fecha` es la consultada, o fue pasado a ella (`deferred_to`), o tiene algún pedido con esa `fecha`. Es la misma resolución que usa el tablero de tickets (`GET /tickets`), para que ambos coincidan; además se deduplica por teléfono. *(plataforma, código)*
- **RN-DSH-05 — Clasificación de chats.** Para cada chat se miran solo sus pedidos de esa fecha, sin papelera ni eliminados por el cliente: **sin pedido** = ninguno; **completos** = tiene alguno y todos están pagados **o** cerrados; **activos** = alguno ni pagado ni cerrado. Los tres suman el total. Por la regla "pagado **o** cerrado", un chat cuyo único pedido es un crédito cerrado sin pagar, o un pedido cerrado sin cobro, cuenta como "completo" (PREG-075). Los pedidos de otros días del mismo chat no cuentan (un ticket es uno por teléfono para siempre). *(plataforma, código)*

*Dinero*

- **RN-DSH-06 — Recaudado.** Siempre `recaudado` suma solo pedidos de la fecha **pagados y cerrados** con la misma regla de bolsas que el cierre: pago dividido a cada bolsa; si no, `cash` y `cod` a efectivo, `transfer` a transferencia; cualquier otro método no entra en ninguna. Total = efectivo + transferencia. La regla es **la misma función** que usan el cierre real y su vista previa (`lib/cierreTotals.ts › calcularBolsas`, documentada en `CAJ` RN-CAJ-19 y RN-CAJ-30): sobre los mismos pedidos, el informe, el modal de cierre y la foto `DailyClose` dan los mismos números (un pedido de $50.000 pagado $30.000 en efectivo + $20.000 por transferencia suma $30.000 y $20.000). **Un crédito pagado después no suma en ningún total ni en ninguna fecha: es el comportamiento previsto por ahora (D-19, decisión de José 2026-10-09)**; queda registrado solo en la pestaña Crédito (RN-DSH-11). Sigue abierto únicamente el caso de `sin_asignar` y valores heredados (PREG-001). *(plataforma, código; D-19, José)*
- **RN-DSH-07 — Cerrados sin cobro, en rojo.** CUANDO hay pedidos `cerrado` + bloqueados + sin pagar y con método distinto de crédito, el informe DEBE listarlos bajo la bolsa que les corresponde por método (`cash`/`cod` en efectivo, `transfer` en transferencia) con cliente ("Sin nombre" si no hay) y total, y un texto "cerrado(s) sin cobro - no incluido arriba". *Por qué:* un desajuste real reportado entre lo que decía el informe y lo cobrado a mano (commit b7d3e5b, 2026-08-23). Un crédito sin pagar no aparece: es normal. Un cerrado sin cobro con método `sin_asignar` no sale en ninguna lista (PREG-001). *(plataforma, código; inferido por el commit)*
- **RN-DSH-08 — El informe sigue el estado actual, no la foto del cierre.** Siempre los números salen de los pedidos en vivo, incluso en un día ya cerrado; la fila `DailyClose` solo se lee para saber si el día está cerrado, quién lo cerró y las decisiones del CSV. Si después del cierre cambia algo (cobro retroactivo, crédito saldado, restaurar), el informe cambia y la foto no (PREG-004). *(plataforma, código)*

*Pestañas*

- **RN-DSH-09 — Pedidos.** La pestaña lista los pedidos de RN-DSH-01 ordenados por estado (nuevo, preparando, listo, camino, entregado, cerrado) y agrupados por cliente: clave `ticket_id` (o, sin ticket, el nombre), con total por grupo, desplegables y los cambios de cada pedido. El contador de la pestaña es el número de pedidos, no de grupos. *(plataforma, código)* *(sin test)*
- **RN-DSH-10 — Papelera.** La pestaña lista los pedidos de la fecha en `papelera` **y** los eliminados por el cliente, cada uno con su aviso ("Enviado a papelera por <nombre>: <motivo>" o "Eliminado por el cliente") y el botón **Restaurar** (`PATCH /orders/:id/restore`, que refresca pedidos e informe). No suma a ningún total. *(plataforma, código)* *(sin test)*
- **RN-DSH-11 — Crédito: todas las fechas.** Siempre la pestaña Crédito trae **todos** los pedidos con método `credito` de la organización, de cualquier fecha (más recientes primero), porque un crédito sigue pendiente semanas después. Es el único lugar donde queda registrado un crédito saldado (D-19). Cada tarjeta dice "Crédito creado el <dd/mm/aaaa>" (la `fecha` del pedido, mostrada como día de negocio sin correrla por zona horaria) y, si ya se pagó, ", pagado el <dd/mm/aaaa>" (`credit_paid_at`, RN-CAJ-32; "pagado (fecha no registrada)" si no hay dato). Antes la fecha salía con la zona de Bogotá y mostraba el día anterior. La web los divide en **No pagados** (el contador de la pestaña) y **Pagados**, y filtra con un buscador por nombre, dirección, domiciliario, artículo, número, fecha (en ISO, `dd/mm/aaaa`, `dd-mm-aaaa` o texto) o monto. No depende del selector de fecha. *(plataforma, código)* *(sin test)*
- **RN-DSH-12 — Cambios, máximo 300.** La pestaña muestra el historial (`order_history`) de los pedidos de la fecha, más recientes primero, con un tope de **300** entradas; el contador de la pestaña es esa cantidad, no el total real. Con más de 300 cambios en un día los más viejos desaparecen del informe (siguen en cada pedido). El filtro es por la `fecha` del pedido, sin excluir papelera: el historial de pedidos en papelera también entra. *(plataforma, código)* *(sin test)*

*Día cerrado y acciones del encabezado*

- **RN-DSH-13 — Vista de día cerrado.** CUANDO el día de la fecha consultada tiene `DailyClose`, el encabezado DEBE mostrar "Caja ya cerrada" (deshabilitado, con "Cerrada por <nombre>") y "Descargar CSV", que reconstruye el reporte con los pedidos del informe y las decisiones guardadas; así el CSV se puede bajar cuando se quiera (commit bb5a630, 2026-07-18). El CSV omite los pasados a mañana (PREG-003). *(plataforma, código)* *(sin test)*
- **RN-DSH-14 — Cerrar caja solo hoy.** El botón "Cerrar caja" está habilitado solo si la fecha elegida es hoy en Bogotá; en otra fecha sale deshabilitado ("Solo se puede cerrar la caja del día actual"). Abre el modal de cierre, que solo se monta para admin/dev y pinta la vista previa del servidor (`GET /cierre/preview`); las reglas del cierre son de `CAJ` (RN-CAJ-30, 27). *(plataforma, código)*
- **RN-DSH-15 — Bloquear todos los links.** CUANDO el admin pulsa "Bloquear todos los links" y confirma, la web DEBE llamar a `POST /inbox/form-links/block-all` (revoca todos los links de formulario emitidos hasta ese instante, sin importar la fecha del informe ni la hora; uno emitido después funciona). La regla es de `FRM`; aquí está el botón y su confirmación. El botón está siempre habilitado, aunque el día esté cerrado. *(plataforma, código)* *(sin test)*
- **RN-DSH-16 — Aviso del día 1.** CUANDO es el día 1 del mes en Bogotá y el usuario es admin o dev, la web DEBE mostrar en toda pantalla de la sesión (no solo en el informe) una franja roja: "Hoy es día 1 - recuerda pagar la suscripción de 4Client para que el sistema no se deshabilite". No consulta cobros de plataforma: sale aunque ya se haya pagado, y no se puede descartar. *(plataforma, código)* *(sin test)*
- **RN-DSH-17 — Actualización.** El informe se vuelve a pedir cada 30 s y además cada vez que llegan eventos `order:created`, `order:updated`, `order:moved`, `order:paid`, `ticket:message` o de no leídos (solo la fecha visible), y `cierre:done` (todas las fechas). Un evento perdido se corrige en menos de 30 s. *(plataforma, código)* *(sin test)*

**Criterios de aceptación.** Archivo de tests: `apps/api/test/dashboard.test.ts`.

1. *Solo admin.* Dado un encargado o un domiciliario, cuando pide `GET /dashboard`, entonces 403 `FORBIDDEN`; un admin recibe el informe. Permisos. (sin test; DT-030)
2. *Qué pedidos cuentan.* Dados un pedido en papelera y otro eliminado por el cliente en la fecha, cuando se pide el informe, entonces no suman a `total` y aparecen en la pestaña Papelera. RN-DSH-01, 10. (sin test; DT-030)
3. *Chats del día.* Dado un chat con pedidos de varios días, cuando se pide el informe de un día, entonces su clasificación (completo/activo/sin pedido) mira solo los pedidos de esa fecha. RN-DSH-04, 05. `"\"chats completados\"/\"con pedido activo\" only count orders from the day being viewed, not the ticket's entire history (a ticket is now one row per phone forever)"`
4. *Recaudado.* Dados un pedido pagado en efectivo y otro cerrado sin cobro, cuando se pide el informe, entonces solo el pagado suma en efectivo; un pago dividido suma cada parte a su bolsa, igual que el cierre. RN-DSH-06. `"a genuinely PAID cash order never shows up in sinCobroEfectivo, even though it is also cerrado+locked"`; `apps/api/test/cierre-totales.test.ts › "pago dividido $30.000 efectivo + $20.000 transferencia: vista previa, DailyClose e informe dicen lo mismo"`; `› "día mixto: mismos números que la regla anterior del servidor, y el crédito sin pagar y el eliminado por el cliente no suman"`
5. *Cerrado sin cobro en rojo.* Dado un pedido de cobro en casa cerrado sin cobro, cuando se pide el informe, entonces aparece en `sinCobroEfectivo` y no en el recaudado; uno por transferencia aparece en `sinCobroTransferencia`. RN-DSH-07. `"a cod order closed via \"cerrar sin cobro\" (locked+cerrado+unpaid) shows up in sinCobroEfectivo, not in efectivo"`; `"a transfer order closed via \"cerrar sin cobro\" shows up in sinCobroTransferencia, not sinCobroEfectivo"`
6. *Crédito sin pagar no es alarma.* Dado un crédito cerrado sin pagar, cuando se pide el informe, entonces no sale en ninguna lista `sinCobro`. RN-DSH-07. `"an unpaid crédito order never shows up in either sinCobro list - that is normal/expected, not a mistake to flag"`
7. *Pedido abierto.* Dado un pedido aún abierto, entonces nunca sale en `sinCobro`. RN-DSH-07. `"an order still open (not locked/cerrado) never shows up in sinCobro lists - only a genuinely closed-without-payment order should"`
8. *Crédito saldado (D-19).* Dado un crédito marcado pagado después del cierre, cuando se pide el informe del día del pedido, entonces aparece en la pestaña Crédito como pagado con su `fecha` y su `credit_paid_at`, pero no suma en efectivo ni transferencia. RN-DSH-06, 11. `cierre-totales.test.ts › "crédito: guarda cuándo se pagó (credit_paid_at) sin tocar paid_at, se puede pagar con el día cerrado y no suma en ningún total (D-19)"` (crédito de otro día, *sin test*)
9. *Día cerrado sigue en vivo.* Dado un día con `DailyClose`, cuando después se hace un cobro retroactivo, entonces el informe refleja el cambio y la foto del cierre no. RN-DSH-08. (sin test; PREG-004)
10. *Tope de cambios.* Dado un día con más de 300 entradas de historial, cuando se pide el informe, entonces la pestaña Cambios trae solo las 300 más recientes. RN-DSH-12. (sin test)

**Textos que ve el cliente final.** Ninguno. El informe es solo para el personal.

## 2. Técnico

**Mapa de código.**

| Parte | Dónde |
|---|---|
| API | `apps/api/src/routes/dashboard.ts › GET /` (una sola consulta paralela de pedidos, papelera, crédito, historial, tickets y cierre); totales con `apps/api/src/lib/cierreTotals.ts › calcularBolsas` |
| Web | `apps/web/src/components/dashboard/ResumenTab.tsx › ResumenTab`, `› renderSinCobro`, `› filteredCreditoOrders`; `apps/web/src/lib/format.ts › fmtBusinessDate`; `apps/web/src/hooks/useDashboard.ts › useDashboard`; `apps/web/src/pages/MainPage.tsx` (pestaña `resumen`, eventos de socket, franja del día 1) |
| CSV | `apps/web/src/lib/csv.ts › downloadCierreCSV` |
| Datos | `Order` (incluye `credit_paid_at`), `OrderItem`, `OrderHistory`, `Ticket`, `DailyClose`; el cálculo no escribe nada |

**Regla → se hace cumplir en → test.**

| Regla | Se hace cumplir en | Test |
|---|---|---|
| RN-DSH-01, 02, 03 | `dashboard.ts › GET /` (bloque "Order stats") | *(sin test)* |
| RN-DSH-04, 05 | `dashboard.ts › GET /` (consulta de tickets y "Chat stats") | `apps/api/test/dashboard.test.ts › "\"chats completados\"/\"con pedido activo\" only count orders from the day being viewed, not the ticket's entire history (a ticket is now one row per phone forever)"` (chats pasados a mañana y `sinPedido`, *sin test*) |
| RN-DSH-06 | `dashboard.ts › GET /` → `cierreTotals.ts › calcularBolsas` | `dashboard.test.ts › "a genuinely PAID cash order never shows up in sinCobroEfectivo, even though it is also cerrado+locked"`; `cierre-totales.test.ts › "pago dividido $30.000 efectivo + $20.000 transferencia: vista previa, DailyClose e informe dicen lo mismo"`; `› "día mixto: mismos números que la regla anterior del servidor, y el crédito sin pagar y el eliminado por el cliente no suman"` |
| RN-DSH-07 | `dashboard.ts › sinCobro`; `ResumenTab.tsx › renderSinCobro` | `dashboard.test.ts › "a cod order closed via \"cerrar sin cobro\" (locked+cerrado+unpaid) shows up in sinCobroEfectivo, not in efectivo"`; `› "a transfer order closed via \"cerrar sin cobro\" shows up in sinCobroTransferencia, not sinCobroEfectivo"`; `› "an unpaid crédito order never shows up in either sinCobro list - that is normal/expected, not a mistake to flag"`; `› "an order still open (not locked/cerrado) never shows up in sinCobro lists - only a genuinely closed-without-payment order should"` |
| RN-DSH-08 | `dashboard.ts › GET /` (`dailyClose` solo en `cierre`) | *(sin test)* |
| RN-DSH-09, 10 | `ResumenTab.tsx › orderGroups`, pestaña `papelera`; `dashboard.ts › papeleraOrders` | *(sin test)* |
| RN-DSH-11 | `dashboard.ts › creditoOrders`; `ResumenTab.tsx › filteredCreditoOrders` y tarjeta de crédito | `cierre-totales.test.ts › "crédito: guarda cuándo se pagó (credit_paid_at) sin tocar paid_at, se puede pagar con el día cerrado y no suma en ningún total (D-19)"` (solo los datos; la pestaña, el buscador y "todas las fechas", *sin test*) |
| RN-DSH-12 | `dashboard.ts › history` (`take: 300`) | *(sin test)* |
| RN-DSH-13, 14 | `ResumenTab.tsx › ResumenTab` (encabezado) | *(sin test)* |
| RN-DSH-15 | `ResumenTab.tsx › blockAllLinksMut`; `apps/api/src/routes/inbox.ts › POST /form-links/block-all` | *(sin test)* |
| RN-DSH-16 | `MainPage.tsx` (`todayStr().endsWith('-01')`) | *(sin test)* |
| RN-DSH-17 | `useDashboard.ts` (`refetchInterval: 30000`); `MainPage.tsx` (manejadores de socket) | *(sin test)* |

**Datos y eventos socket.** No emite eventos. Escucha los de RN-DSH-17. El parámetro `fecha` llega como texto `AAAA-MM-DD` y se convierte con `new Date(fecha)`; sin parámetro usa la fecha-hora actual del servidor (la web siempre lo envía, PREG-076).

**Transacciones y concurrencia.** Las seis consultas corren en paralelo pero **sin transacción**: un cobro que entre en medio puede dar una lectura ligeramente incoherente (por ejemplo un pedido pagado en la lista pero no en los totales) hasta el siguiente refresco.

**Códigos de error propios.** Ninguno: `FORBIDDEN` (403) por rol; una `fecha` inválida produce un error del servidor (PREG-076).

**Si tocas X, revisa Y.**
- **La regla de bolsas** vive solo en `lib/cierreTotals.ts` (ver `CAJ`); no la copies aquí ni en la web. `sinCobro` sigue con su propio filtro en `dashboard.ts`.
- **La resolución de chats por fecha** debe seguir igual a `tickets.ts › GET /` o las cifras del informe y del tablero se separan.
- **El nombre `entregados`** está en la API y en `MainPage`/`ResumenTab`; la etiqueta visible es "Cerrados/Cobrados". El estado heredado `entregado` ya no se asigna.
- **Un método de pago nuevo** hay que añadirlo a las bolsas y a `sinCobro` (filtro propio) o queda fuera del informe.
- **Los eventos de socket** que cambien pedidos o tickets deben invalidar `['dashboard', fecha]` en `MainPage.tsx`.
- **`creditoOrders`** crece sin límite con el tiempo (no hay tope ni filtro por antigüedad).

## 3. Pendientes

IDs globales; resumen en `03-plan/preguntas-abiertas.md` y `03-plan/problemas-conocidos.md`. Relacionados de `CAJ`: PREG-001 (pagos fuera de bolsas), PREG-003 (CSV sin pasados a mañana), PREG-004 (día cerrado cambia). PREG-008 (¿encargado cierra?) y DT-004 (regla triplicada) quedaron resueltas el 2026-10-10 (RN-CAJ-31, `lib/cierreTotals.ts`).

- **PREG-074 — "Cerrados/Cobrados" cuenta pedidos que no se cobraron.** `entregados` es `status = cerrado`: incluye crédito sin pagar y cerrado sin cobro. ¿Se separan "cobrados" de "cerrados"?
- **PREG-075 — "Chats con pedidos completados" incluye cerrados sin pagar.** La regla es `paid || cerrado`; un crédito pendiente o un cerrado sin cobro cuentan como completos aunque no haya entrado la plata. ¿Es la intención o debe exigir pago (salvo crédito)?
- **PREG-001 — Cerrado sin cobro con método `sin_asignar`.** No cae en `sinCobroEfectivo` ni en `sinCobroTransferencia`: desaparece del informe (no suma ni se lista). Mismo hueco que PREG-001, del lado de la lista.
- **PREG-076 — `fecha` inválida o ausente.** Un texto no fecha llega a la base y da error del servidor (no 400); sin `fecha`, el servidor usa su hora actual en UTC, que entre las 19:00 y las 23:59 de Bogotá es "mañana". La web siempre envía la fecha, así que no se manifiesta hoy. *(inferido)*
- **PREG-077 — El tope de 300 cambios no avisa.** El contador "Cambios (N)" muestra como máximo 300 y no indica que se recortó. ¿Se avisa o se pagina?
- **PREG-078 — Aviso del día 1 no sabe si ya se pagó.** Sale a todos los admin/dev toda la jornada, sin poder cerrarlo. ¿Debe leer los cobros de plataforma (`PlatformCharge`) y esconderse al pagar?
- **PREG-079 — Pestaña Crédito sin tope.** Trae todos los créditos de la historia en cada refresco de 30 s, pagados incluidos. ¿Se limita por antigüedad o se pagina?
- **DT-030 — Faltan tests** (los totales por bolsa y el pago dividido ya tienen test desde 2026-10-10, `cierre-totales.test.ts`) de conteos de pedidos, chats sin pedido y pasados a mañana, papelera/eliminados por el cliente, crédito de todas las fechas, tope de 300 cambios, 403 por rol y día cerrado. Los 5 tests de `dashboard.test.ts` cubren solo los chats del día y las listas "sin cobro". Viola el principio 11.
- **DT-031 — `domActivos` es código muerto** (se calcula y se envía, nadie lo muestra).
- **DT-032 — Respuesta sin tipo y con exceso de datos:** la API devuelve los pedidos completos con ítems (y `(o as any)` para `split_cash`); la web usa `any` para todo el informe.
