---
estado: vigente
verificado: 2026-10-09 @ 5d8e69d
fuentes: [apps/api/src/seed-chats.ts, apps/api/src/seed-wpp.ts, apps/api/src/update-org-wpp.ts, apps/api/src/reencrypt-wpp-tokens.ts, apps/web/src/lib/apiBase.ts, apps/web/src/components/ui/UpdateBanner.tsx, apps/api/src/routes/dev.ts, apps/api/src/routes/billing.ts, apps/api/src/lib/audit.ts, apps/api/src/lib/messageTemplates.ts, apps/api/src/lib/formLink.ts, apps/api/prisma/schema.prisma, apps/web/src/components/config/DevSection.tsx, apps/web/src/components/config/DevOrgsPanel.tsx, apps/web/src/components/config/DevDbPanel.tsx, apps/web/src/components/config/DevWppPanel.tsx, apps/web/src/components/config/DevBillingPanel.tsx, apps/web/src/components/config/DevSistemaPanel.tsx, apps/web/src/components/config/DevLinksPanel.tsx, apps/web/src/components/config/OrgSelector.tsx, apps/web/src/components/config/BillingSection.tsx, apps/web/src/lib/platformChargePdf.ts, apps/web/src/pages/MainPage.tsx, apps/web/src/components/inbox/InboxPanel.tsx, apps/api/test/dev-centro-mando.test.ts, apps/api/test/billing.test.ts, apps/api/test/config.test.ts]
---

# PLT — Plataforma (operador dev)

> La consola del operador de 4Client (rol `dev`, hoy José): ver datos de cualquier negocio, dar de alta negocios nuevos, hacer favores de soporte sin escribir SQL y registrar lo que 4Client le cobra a cada negocio. Más la vista de solo lectura con la que el administrador de un negocio ve sus propios cobros.

## 1. Negocio

**Propósito.** Operar la plataforma multi-negocio sin entrar a la base de datos a mano. Antes se hacían "favores" con SQL (reabrir un cierre, sembrar un chat de prueba, dar de alta un cliente); este módulo los convirtió en acciones concretas y limitadas, y deja rastro de las que importan en `audit_logs`. No hay SQL libre a propósito: no se puede limitar a un solo negocio de forma segura cuando varios comparten las tablas *(código, comentario de `DevDbPanel.tsx`)*. Los cobros de plataforma son el registro interno de lo que 4Client factura a cada negocio (suscripción, puesta en marcha).

**Permisos.** Filas "DevTools: BD, organizaciones, cobros de plataforma, acciones", "Borrar datos de un cliente" y "Ver sus cobros de plataforma (solo lectura)" de `01-funcional/actores-y-permisos.md`.
- Todo `/dev/*` exige `requireRole('dev')` (hook del plugin completo). Admin, encargado y domiciliario reciben 403.
- `GET /billing/charges` exige `admin` o `dev` y devuelve **solo** los cobros de la organización de la sesión.
- Donde la interfaz difiere de la API: la pestaña "Facturación" (admin) solo existe para admin; el dev, aunque la API se lo permite, ve esos cobros desde el panel "Facturación" de DevTools para cualquier negocio. El panel "WhatsApp" de DevTools usa `/config/*` (módulo WPP), que la API abre también a admin; solo la interfaz lo restringe al dev.
- El rol `dev` **solo se crea con el seed** (RN-PLT-05): `POST /users` solo acepta `admin`, `encargado` y `domiciliario`.

**Reglas.**

*Visor de base de datos*

- **RN-PLT-01 — Solo tablas permitidas.** CUANDO el dev pide `GET /dev/db`, el sistema DEBE aceptar solo estas 10 tablas: `users`, `organizations`, `products`, `employees`, `orders`, `tickets`, `ticket_messages`, `order_history`, `daily_closes`, `audit_logs`; otra tabla responde 400. Por defecto `users`; el límite por página es 20 y nunca pasa de 200; el `offset` mínimo es 0. Sin `orgId` consulta el negocio del propio dev; con `orgId` (UUID, si no 400 `VALIDATION_ERROR`) consulta cualquier negocio. *(plataforma, código)*
- **RN-PLT-02 — Columnas sensibles ocultas.** Siempre el visor omite: de `users`, `password_hash`; de `organizations`, el token y el secreto de la app de Meta (`wpp_meta_token`, `wpp_meta_app_secret`); de `tickets`, el payload crudo de WhatsApp y el token del link de formulario. `ticket_messages` se lista con columnas elegidas. La interfaz además enmascara con puntos las columnas `password_hash`, `token_hash`, `wpp_meta_token` y `wpp_meta_app_secret` si llegaran. Las demás tablas (pedidos, productos, empleados, historial, cierres, auditoría) se muestran completas, con los datos personales del cliente que contengan. *Por qué:* un hallazgo de auditoría de seguridad encontró que el visor devolvía los tokens y el payload crudo *(inferido de comentarios)*. *(plataforma, código)*
- **RN-PLT-03 — Toda lectura queda auditada.** CUANDO el dev consulta una tabla, el sistema DEBE registrar `dev.db_read` en `audit_logs` de la organización **consultada**, con tabla, límite y offset. No bloquea ni limita nada. *(plataforma, código)*

*Alta de negocios y siembra*

- **RN-PLT-04 — Alta de un negocio.** CUANDO el dev crea una organización, el sistema DEBE crear en una sola transacción la organización (plan `starter`, proveedor `meta_api`, activa) y su primer usuario `admin`, y responder 201 con la contraseña **una sola vez** (el hash no se vuelve a exponer; la interfaz avisa que no se muestra otra vez). Reglas: nombre 2–200; slug opcional (minúsculas, números y guiones, 2–50) o derivado del nombre (cualquier carácter fuera de a-z y 0-9, tildes incluidas, se vuelve guion: «Frutería» da `fruter-a`); si el slug ya existe se le agrega `-` y 4 hexadecimales; el correo del admin se guarda en minúsculas y debe ser único en **toda la plataforma** (409 `DUPLICATE_EMAIL`); la contraseña sigue la política de contraseñas (`passwordSchema`, la interfaz dice mínimo 12 con mayúscula, minúscula y número). Cualquier otro fallo es 500 `SERVER_ERROR`. Queda `dev.org_created` en la auditoría. La contraseña la escribe el dev (no se genera). *(plataforma, código)*
- **RN-PLT-05 — Seed.** CUANDO se llama `POST /dev/seed`, el sistema DEBE: responder 403 `FORBIDDEN` si `APP_ENVIRONMENT_NAME` es `production`; responder 500 `MISSING_SEED_CREDENTIALS` si no están configuradas `SEED_ADMIN_PASS` y `SEED_DEV_PASS` (no hay valor por defecto); si pasa, hacer upsert de una organización fija, un admin y un dev, **reseteando** la contraseña y reactivando ambos si ya existían. Deja un `warn` en el log (`dev.seed_run`) y **no** escribe en `audit_logs`. Es la única forma de crear un usuario `dev`. La interfaz de DevTools no tiene botón de seed (se quitó en el commit b66ba91). *Por qué:* que un ambiente real mal configurado no quede con cuentas de superusuario de contraseña conocida. *(plataforma, código)*
- **RN-PLT-06 — Estado del sistema.** `GET /dev/env-status` devuelve solo booleanos (sin valores) de las variables de Meta, R2 y Sentry, más `NODE_ENV` y `PORT`. `GET /dev/health` cuenta organizaciones y usuarios y devuelve latencia de la base, versión de Node y uptime. `GET /dev/storage-test` sube de verdad un archivo de prueba `_healthcheck/<ms>.txt` a R2 y devuelve el error real (nombre y mensaje) si falla; sin R2 informa "usando almacenamiento local". Ninguno audita. El archivo de prueba queda en el bucket. *(plataforma, código)*

*Acciones curadas*

- **RN-PLT-07 — Reabrir cierre.** CUANDO el dev reabre un cierre, el sistema DEBE borrar el `DailyClose` de esa fecha (404 `NOT_FOUND` si no existe) y guardar a continuación el snapshot completo en `audit_logs` como `dev.cierre_reopened` (primero borra y luego audita, y `audit()` es de mejor esfuerzo: si falla, el snapshot se pierde). No ofrece "cerrar": cerrar de verdad recalcula totales y eso lo hace el cierre normal. Qué queda sin deshacer, ver CAJ (RN-CAJ-24, PREG-005); no se repite aquí. *(plataforma, código)*
- **RN-PLT-08 — Ticket de prueba.** CUANDO el dev crea un ticket de prueba (organización existente, si no 404; teléfono de 5 a 150 caracteres; fecha `AAAA-MM-DD`; de 1 a 20 mensajes de hasta 2000 caracteres), el sistema DEBE crear el ticket y sus mensajes **entrantes** con marcas de tiempo escalonadas de un minuto, `unread_count` = número de mensajes, sin enviar nada por WhatsApp. Si ya existe un ticket con ese teléfono en la organización, 409 `CONFLICT`. Audita `dev.test_ticket_created`. El dev debe poner un teléfono ficticio (ver los datos de ejemplo `+57 300 000 0000`); la API no lo impide. *(plataforma, código)*

*Cobros de plataforma*

- **RN-PLT-09 — Qué es un cobro y su número.** Un `PlatformCharge` es un **comprobante interno de cobro**, no una factura electrónica DIAN (esa exige numeración autorizada aparte). Su `number` es un consecutivo **global** (secuencia de Postgres, sin reinicio por negocio) y es el que imprime el PDF como `4C-` más 6 dígitos con ceros (`4C-000042`). Nace `pendiente`. *(plataforma, código)*
- **RN-PLT-10 — Conceptos, mes y valores.** Un cobro lleva uno o más conceptos de `suscripcion`, `onboarding`, `otro`, un mes `AAAA-MM` y **exactamente un valor positivo por concepto elegido** (ni más ni menos claves que conceptos, si no 400 `VALIDATION_ERROR`). El total se calcula siempre en el servidor como suma de los valores; el cuerpo no trae total. Notas hasta 1000 caracteres. No hay fecha de vencimiento: solo el mes. Los valores comerciales concretos (cuánto cuesta cada concepto) no están en el código; salen de la Propuesta, ver `archivo/Requerimientos/` en la raíz del repositorio. *(plataforma, código; los valores, José)*
- **RN-PLT-11 — Creación en dos pasos.** CUANDO el dev crea un cobro, la interfaz DEBE (1) `POST /dev/charges`, que crea la fila (así existe su `number` real, 404 si el negocio no existe) y (2) armar el PDF en el navegador con ese número y subirlo con `POST /dev/charges/:id/pdf` (cuerpo de hasta 6 000 000 bytes, base64). El PDF es carta con logo comprimido, "Comprobante de cobro", número, fecha de generación, negocio, tabla de conceptos, notas y total. La clave en R2 es `platform-charges/<slug>-<número>.pdf`; si el cobro se edita, el PDF se regenera y **se sobrescribe** en la misma clave. *(plataforma, código)*
- **RN-PLT-12 — La subida del PDF no puede perder el cobro.** Si R2 no está configurado o la subida falla, el endpoint responde 200 con `report_url` en `null` y el cobro sigue existiendo; solo se queda sin PDF. *(plataforma, código; ver PREG-086)*
- **RN-PLT-13 — Estado y pago.** CUANDO el dev cambia el estado de un cobro (`pendiente` o `pagado`), el sistema DEBE poner `paid_at` = ahora si es `pagado` y `null` si es `pendiente`. La interfaz solo ofrece "Marcar pagado"; volver a `pendiente` solo existe por la API. *(plataforma, código)*
- **RN-PLT-14 — Editar y borrar.** Editar (`PUT`) cambia conceptos, mes, valores y notas, recalcula el total, y no cambia negocio, número ni estado (se puede editar un cobro ya pagado). Borrar (`DELETE`) elimina la fila definitivamente tras guardar en `audit_logs` un snapshot (conceptos, mes, total, desglose, notas, estado) como `dev.charge_deleted`; el PDF en R2 **no** se borra. Ambos devuelven 404 si el cobro no existe. Cada creación, edición y cambio de estado audita (`dev.charge_created`, `dev.charge_updated`, `dev.charge_status_changed`). La subida del PDF no audita. *(plataforma, código)*
- **RN-PLT-15 — Lo que ve el administrador.** `GET /billing/charges` devuelve los cobros de la organización de la sesión, ordenados por mes descendente y luego por creación descendente. No hay paso de "publicar": el cobro ya nace con su `org_id`. La pestaña "Facturación" lista número, mes, total, estado, desglose por concepto, notas y el enlace al PDF si existe. *(plataforma, código)*
- **RN-PLT-16 — Franja de recordatorio.** CUANDO el dev abre el panel "Facturación", el sistema DEBE mostrar una franja por organización **activa** con los días desde el último pago de **suscripción** (el `paid_at` más reciente entre sus cobros pagados que incluyen `suscripcion`) o, si nunca pagó, desde la creación de la organización: hasta 25 días "al día"; de 26 a 30 "por vencer"; más de 30 "vencida". Solo se calcula al abrir la pestaña; no hay aviso por correo ni push. *(plataforma, código)*
- **RN-PLT-17 — Aviso del día 1.** CUANDO el día del mes (hora local del navegador, `todayStr()`) termina en `-01` y el usuario es admin o dev, la barra roja de `MainPage` DEBE decir "Hoy es día 1 - recuerda pagar la suscripción de 4Client para que el sistema no se deshabilite". No consulta si ya se pagó (PREG-078). *(plataforma, código)*

*Auditoría*

- **RN-PLT-18 — `audit()` es de mejor esfuerzo.** Siempre `lib/audit.ts › audit` traga sus errores (los deja en la consola) para que registrar nunca rompa la acción registrada. Consecuencia: un hueco en el historial es posible sin que la acción falle. *(plataforma, código)*
- **RN-PLT-19 — Acciones que hoy se registran.** `auth.login_success`, `auth.login_failed`, `config.message_templates_update`, `config.wpp_update`, `ticket.erase_customer_data`, `user.create`, `user.update`, `user.reset_password`, y las `dev.*` de este módulo: `dev.db_read`, `dev.org_created`, `dev.cierre_reopened`, `dev.test_ticket_created`, `dev.charge_created`, `dev.charge_updated`, `dev.charge_deleted`, `dev.charge_status_changed`. El campo `action` admite hasta 50 caracteres. Quedan **sin** registro: seed, `env-status`, `health`, `storage-test`, lista de organizaciones, subida del PDF de un cobro. *(plataforma, código)*
- **RN-PLT-20 — Scripts de línea de comandos (no son rutas).** En `apps/api/src/`, además de `seed.ts` (`pnpm db:seed`, ver `/dev/seed`), hay cuatro scripts que se corren a mano con `dotenv`: `seed-chats.ts` (borra los tickets del día fijo `2026-06-27` de la organización `fruver-san-gabriel` y crea cuatro chats de ejemplo con teléfonos ficticios; exige que el seed ya exista); `seed-wpp.ts` (pone en la **primera** organización que encuentre el `phone_id`, el token y el secreto de Meta tomados de las variables `META_*`, cifrados con `encryptSecret`, y un número de WhatsApp fijo); `update-org-wpp.ts` (pone `phone_id` y token de `fruver-san-gabriel`; el token sale de `META_TOKEN` y el `phone_id` está escrito en el código); y `reencrypt-wpp-tokens.ts` (migración única idempotente: re-cifra a `enc:v2:` el token y el secreto de las organizaciones que aún estén en texto plano o `enc:v1:`; exige `WPP_TOKEN_ENC_KEY`; ver RN-WPP-30). Ninguno audita ni pasa por la API. Los de siembra no deben correrse contra producción. *(plataforma, código)*
- **RN-PLT-21 — Qué API usa la web y la marca DEV.** La web elige la dirección de la API al ejecutarse, no al compilar (`lib/apiBase.ts › resolveApiBase`): `VITE_API_URL` si está definida; `http://localhost:3000` en `localhost`/`127.0.0.1`; la API de desarrollo (`dev-api.4client.shop`) si el host empieza por `dev.` y termina en `.pages.dev`; en cualquier otro caso (dominio real, o cualquier otra vista previa de Cloudflare Pages) la de producción (`api.4client.shop`). `isDevEnvironment()` usa la misma señal (localhost o la vista previa `dev.`) para mostrar una etiqueta roja "DEV" en el login y en el encabezado de `MainPage`, de modo que el personal distinga la copia de pruebas de la real. *Por qué:* evitar una variable por entorno en Cloudflare *(inferido del comentario)*. *(plataforma, código)*
- **RN-PLT-22 — Actualización de la web (PWA).** CUANDO el navegador detecta una versión nueva (búsqueda cada 30 min y cada vez que la pestaña vuelve a verse), `UpdateBanner` DEBE recargar la aplicación: de inmediato en el formulario del cliente (guarda el avance en `localStorage`); en la app del personal, solo cuando no haya ninguna ventana modal abierta (comprueba cada 3 s la clase `moverlay`), y mientras tanto muestra "Hay una nueva versión - se actualizará sola en cuanto cierres esta ventana". En `/factura` no hay actualización automática. Detalle del registro del service worker en `02-tecnico/arquitectura.md` §7. *(plataforma, código)*

**Textos que ve el cliente final.** Ninguno. El administrador de un negocio solo ve la pestaña "Facturación" (RN-PLT-15) y la barra del día 1 (RN-PLT-17); las credenciales del primer admin se las entrega el dev fuera del sistema.

## 2. Técnico

**Mapa de código.**

| Parte | Dónde |
|---|---|
| API (dev) | `apps/api/src/routes/dev.ts › queryTable`, `› GET /db`, `› POST /seed`, `› GET /env-status`, `› GET /storage-test`, `› GET /health`, `› GET/POST /organizations`, `› POST /actions/reopen-cierre`, `› POST /actions/create-test-ticket`, `› /charges` (GET, POST, `POST /:id/pdf`, PUT, DELETE, PATCH) |
| API (admin) | `apps/api/src/routes/billing.ts › GET /charges` |
| Auditoría | `apps/api/src/lib/audit.ts › audit` |
| Web | `components/config/DevSection.tsx` (pestañas, selector de negocio), `DevOrgsPanel.tsx`, `DevDbPanel.tsx` (visor y `ActionsSection`), `DevWppPanel.tsx` (llama a `/config`), `DevBillingPanel.tsx` (`ReminderStrip`), `DevSistemaPanel.tsx`, `DevLinksPanel.tsx`, `OrgSelector.tsx`, `BillingSection.tsx` |
| PDF | `apps/web/src/lib/platformChargePdf.ts › buildPlatformChargePdf`, `› pdfToBase64` |
| Aviso día 1 | `apps/web/src/pages/MainPage.tsx` (barra bajo el encabezado) |
| Datos | `PlatformCharge` (`number` autoincrement único, `types[]`, `amount`, `amounts` JSON, `status`, `paid_at`, `report_url`), `AuditLog`, `Organization`, `User` |

**Regla → dónde se hace cumplir → test.**

| Regla | Se hace cumplir en | Test |
|---|---|---|
| RN-PLT-01 | `dev.ts › GET /db` | `dev-centro-mando.test.ts › "permite al dev consultar una organización distinta a la propia"`; `› "400 con un orgId con formato inválido"` (tabla no permitida, tope 200: *sin test*) |
| RN-PLT-02 | `dev.ts › queryTable`; `DevDbPanel.tsx › SECRET_COLS` | *(sin test)* |
| RN-PLT-03 | `dev.ts › GET /db` | *(sin test)* |
| RN-PLT-04 | `dev.ts › POST /organizations` | `dev-centro-mando.test.ts › "crea una organización nueva + su admin, y ese admin puede iniciar sesión"`; `› "genera un slug único si el nombre ya existe"`; `› "rechaza una contraseña que no cumple la política"`; `› "rechaza un rol no-dev (admin)"` (`DUPLICATE_EMAIL`: *sin test*) |
| RN-PLT-05 | `dev.ts › POST /seed` | *(sin test)* |
| RN-PLT-06 | `dev.ts › GET /env-status`, `› GET /storage-test`, `› GET /health` | *(sin test)* |
| RN-PLT-07 | `dev.ts › POST /actions/reopen-cierre` | `dev-centro-mando.test.ts › "borra el DailyClose de esa fecha (reabre) y deja el snapshot en audit_logs"`; `› "404 si no hay cierre para esa fecha"` |
| RN-PLT-08 | `dev.ts › POST /actions/create-test-ticket` | `dev-centro-mando.test.ts › "crea un ticket + sus mensajes entrantes"`; `› "409 si ya existe un ticket con ese teléfono en la organización"` |
| RN-PLT-09/10 | `dev.ts › createChargeSchema`, `› POST /charges`; `schema.prisma › PlatformCharge` | `dev-centro-mando.test.ts › "crea un cobro con varios conceptos a la vez y lo marca pagado"`; `› "rechaza un cobro sin ningún concepto seleccionado"`; `› "rechaza un cobro donde amounts no coincide exactamente con los conceptos elegidos"`; `› "asigna números consecutivos crecientes entre cobros"` |
| RN-PLT-11/12 | `dev.ts › POST /charges/:id/pdf`; `DevBillingPanel.tsx › create`; `platformChargePdf.ts` | `dev-centro-mando.test.ts › "POST /charges/:id/pdf adjunta el PDF a un cobro ya creado"` (sin R2 deja `report_url` nulo); `› "POST /charges/:id/pdf da 404 con un cobro inexistente"`; el PDF y los textos: *sin test* |
| RN-PLT-13 | `dev.ts › PATCH /charges/:id` | `dev-centro-mando.test.ts › "crea un cobro con varios conceptos a la vez y lo marca pagado"`; `› "404 al marcar pagado un cobro inexistente"` (volver a `pendiente`: *sin test*) |
| RN-PLT-14 | `dev.ts › PUT /charges/:id`, `› DELETE /charges/:id` | `dev-centro-mando.test.ts › "PUT /charges/:id edita conceptos/mes/valores/notas sin cambiar el number"`; `› "PUT /charges/:id rechaza amounts que no coincide con types, 404 con inexistente, y 403 para no-dev"`; `› "DELETE /charges/:id borra el cobro, 404 con inexistente, 403 para no-dev"` |
| RN-PLT-15 | `billing.ts › GET /charges`; `BillingSection.tsx` | `billing.test.ts › "el admin ve sus propias facturas, más reciente primero por mes, y nunca las de otra organización"`; `› "el rol dev también puede ver la vista de su propia organización"`; `› "rechaza un rol que no sea admin/dev (encargado)"` |
| RN-PLT-16 | `DevBillingPanel.tsx › ReminderStrip` | *(sin test)* |
| RN-PLT-17 | `MainPage.tsx` | *(sin test)* |
| RN-PLT-18/19 | `lib/audit.ts › audit`; llamadas en `dev.ts`, `users.ts`, `config.ts`, `inbox.ts`, `auth.ts` | `dev-centro-mando.test.ts › "borra el DailyClose de esa fecha (reabre) y deja el snapshot en audit_logs"` (solo ese caso) |
| RN-PLT-20 | `apps/api/src/seed-chats.ts`, `seed-wpp.ts`, `update-org-wpp.ts`, `reencrypt-wpp-tokens.ts` | *(sin test)* |
| RN-PLT-21 | `apps/web/src/lib/apiBase.ts › resolveApiBase`, `› isDevEnvironment`; `LoginPage.tsx`, `MainPage.tsx` | *(sin test)* |
| RN-PLT-22 | `apps/web/src/components/ui/UpdateBanner.tsx`; montaje en `App.tsx` | *(sin test)* |
| Permiso dev-only | hook `requireRole('dev')` de `dev.ts` | los `"rechaza un rol no-dev"` de cada grupo en `dev-centro-mando.test.ts` |

`config.test.ts` solo cubre aquí la unicidad de `wpp_meta_phone_id` entre negocios (`PATCH /config/wpp`), que pertenece a WPP.

**Datos y eventos socket.** No emite eventos socket. Escribe `AuditLog`, `PlatformCharge`, `Organization`+`User` (alta), `Ticket`+`TicketMessage` (prueba) y borra `DailyClose` (reabrir). R2: prefijos `platform-charges/` y `_healthcheck/`.

**Transacciones y concurrencia.** El alta de negocio es transaccional (organización + admin), pero la comprobación de correo y de slug va antes: dos altas simultáneas con el mismo correo podrían caer en el 500 genérico. Borrar un cobro y su auditoría no son atómicos (se borra primero, `audit` es de mejor esfuerzo y no relanza: si falla, el snapshot se pierde). La numeración de cobros usa una secuencia de Postgres: no se reutilizan números aunque se borre un cobro, y se pueden saltar. El PUT/PATCH que no encuentra la fila se traduce a 404 por un `catch`.

**Códigos de error propios.**

| Código | HTTP | Cuándo |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Cuerpo, `orgId`, mes o valores por concepto inválidos |
| `NOT_FOUND` | 404 | Negocio, cobro o cierre inexistente |
| `DUPLICATE_EMAIL` | 409 | Correo del admin ya registrado en la plataforma |
| `CONFLICT` | 409 | Ticket de prueba con teléfono ya existente |
| `FORBIDDEN` | 403 | Seed en producción |
| `MISSING_SEED_CREDENTIALS` | 500 | Seed sin `SEED_ADMIN_PASS` / `SEED_DEV_PASS` |
| `SERVER_ERROR` | 500 | Falla al crear la organización |

**Si tocas X, revisa Y.**
- **Una tabla o columna nueva con datos sensibles:** `ALLOWED_TABLES` y `queryTable` en `dev.ts` (qué se lista) y `SECRET_COLS` en `DevDbPanel.tsx` (qué se enmascara). La lista de tablas se repite en `DB_TABLES` del panel.
- **El formato del número de cobro `4C-` + 6 dígitos** está duplicado en `platformChargePdf.ts › invoiceNumber`, `DevBillingPanel.tsx` y `BillingSection.tsx`.
- **Los tres conceptos de cobro** (`suscripcion`, `onboarding`, `otro`) están en `dev.ts` (dos esquemas), en `DevBillingPanel.tsx`, `BillingSection.tsx` y `platformChargePdf.ts`.
- **Los umbrales de la franja de recordatorio** (25 y 30 días) son constantes del componente, no de la API.
- **Una acción nueva de auditoría:** el `action` cabe en 50 caracteres y se lista en RN-PLT-19.
- **Cambiar el prefijo `platform-charges/`** deja huérfanos los PDF ya subidos (la URL se guarda completa en `report_url`).
- **`DevLinksPanel.tsx`** lleva direcciones de servicios fijas (Coolify con IP, GitHub, Sentry, Meta, Cloudflare, Prisma Studio local); revisarlas si cambia la infraestructura.

## 3. Pendientes

IDs globales; resumen en `03-plan/preguntas-abiertas.md` y `03-plan/problemas-conocidos.md`.

- **PREG-085 — Lectura de datos personales entre negocios sin tope ni motivo.** El dev lee tickets, mensajes y pedidos de cualquier negocio sin pedir motivo ni limitar; solo queda `dev.db_read`, que no incluye el contenido leído. Los datos de `orders` y `ticket_messages` incluyen nombre, teléfono, dirección y texto de chats. ¿Es suficiente ese rastro (Ley 1581), o se enmascaran datos personales por defecto?
- **PREG-086 — El PDF de un cobro puede quedar vacío sin aviso.** `POST /charges/:id/pdf` responde 200 aunque la subida falle y, además, **sobrescribe `report_url` con `null`**: un cobro que ya tenía PDF lo pierde de la vista si R2 falla al regenerarlo al editar. Tampoco valida que el archivo sea un PDF (a diferencia de FAC) ni audita. En la interfaz, si el segundo paso falla después del primero, el cobro queda creado sin PDF y el mensaje de error no lo dice. ¿Debe fallar con error y conservar la URL anterior?
- **PREG-078 — La barra del día 1 no sabe si ya se pagó.** Sale a todo admin/dev el día 1 de cada mes, haya pagado o no, con la hora del navegador. Y "para que el sistema no se deshabilite" no se corresponde con ningún corte automático: el login sí rechaza organizaciones con `active = false` (`auth.ts`), pero nada en `dev.ts` ni en DevTools la desactiva (se haría a mano en la base) y la franja "vencida" solo informa. ¿Debe consultar los cobros? ¿Existe o se piensa un corte por impago?
- **PREG-087 — Cobros pagados editables y borrables.** El dev puede editar los valores o borrar un cobro ya `pagado`; solo queda un snapshot si se borra (editar guarda los valores nuevos, no los anteriores). ¿Debe bloquearse un cobro pagado?
- **PREG-088 — "Marcar pagado" sin vuelta atrás en la interfaz,** aunque la API permite volver a `pendiente`. Y la franja "al día" mira `paid_at` de cualquier cobro que incluya suscripción, sin comparar el mes cubierto (`period`). ¿Debe mirar el mes?
- **PREG-089 — Contraseña inicial visible y elegida por el dev.** El primer admin recibe la contraseña que escribió el dev, que viaja en la respuesta y se muestra en pantalla; no se fuerza cambio en el primer ingreso. ¿Se genera aleatoria o se obliga a cambiarla?
- **PREG-090 — Reapertura y seed no auditados.** El seed (que resetea contraseñas del admin y del dev del negocio fijo) solo deja un `warn`. Ver también PREG-005 sobre lo que reabrir no deshace.
- **PREG-014 — Pedidos con `channel = 'call'` sin interfaz.** La API acepta `channel: 'call'` (pedido sin chat) y la pantalla del pedido sabe mostrarlo como "Llamada", pero ninguna pantalla lo crea (la interfaz no envía `channel`). ¿Es un canal por terminar o se puede quitar?
- **PREG-091 — Renombrar ticket oculto por una constante.** `RENAME_TICKET_UI_ENABLED = false` en `InboxPanel.tsx` esconde la edición de nombre y teléfono del chat, aunque la API la permite al admin (fila "Renombrar ticket" de la matriz). ¿Se reactiva o se retira?
- **DT-001 y DT-002 — Monoinquilino fijado en el código** (todo negocio nuevo lo hereda; principio 2 de `00-principios.md`). Las plantillas por defecto son DT-001 (ver WPP); el resto es DT-002:
  - Las **plantillas de mensajes por defecto** (`lib/messageTemplates.ts › DEFAULT_MESSAGE_TEMPLATES`) traen datos de un cliente concreto: el nombre de su razón social, una cuenta bancaria y el monto mínimo y costo del domicilio. Un negocio nuevo que no edite sus plantillas enviaría esos datos a sus clientes. Es el caso más grave: puede mandar la cuenta de otro negocio.
  - La **política de privacidad** es una sola URL fija (`/legal/politica-privacidad`, versión `v1`) y un texto que nombra a un solo negocio (ver FRM).
  - El **logo del encabezado** de `MainPage` es siempre la imagen del cliente actual (y la marca de agua de fondo en `global.css`), sea cual sea la organización (ver `02-tecnico/arquitectura.md`).
  - El **seed** y los scripts `seed-chats.ts` y `update-org-wpp.ts` apuntan a un `slug` fijo de ese cliente; el seed crea usuarios con correos fijos de ese dominio.
  - El panel de WhatsApp muestra un ejemplo de bienvenida con el nombre de ese cliente.
- **DT-037 — Faltan tests:** el seed, las columnas ocultas del visor, la auditoría `dev.db_read`, `DUPLICATE_EMAIL`, la franja de recordatorio y el aviso del día 1, el PDF de plataforma, y que `audit()` no relance.
- **DT-038 — Total del cobro sumado en cuatro sitios** (`dev.ts` crear y editar, `platformChargePdf.ts`, vista previa de `DevBillingPanel.tsx`). Hoy coinciden.
- **DT-039 — PDF huérfanos en R2:** borrar un cobro no borra su PDF; `storage-test` deja archivos `_healthcheck/` sin limpieza.

Decisiones relacionadas: principio 2 de `00-principios.md` (multi-tenant estricto; `dev` es la excepción por diseño), CAJ (reabrir el cierre), FAC (mismo patrón de PDF en R2), WPP (configuración de WhatsApp), ACC (usuarios y roles).
