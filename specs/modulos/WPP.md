---
estado: vigente
verificado: 2026-10-10 @ 1edb809
fuentes: [apps/api/src/lib/crypto.ts, apps/api/src/lib/sanitize.ts, apps/api/src/services/whatsapp/meta-cloud.ts, apps/api/src/routes/webhook.ts, apps/api/src/lib/businessDate.ts, apps/api/src/lib/messageTemplates.ts, apps/api/src/lib/formLink.ts, apps/api/src/routes/config.ts, apps/api/src/routes/tickets.ts, apps/api/src/routes/inbox.ts, apps/api/src/routes/public.ts, apps/api/src/routes/cierre.ts, apps/api/src/server.ts, apps/api/prisma/schema.prisma, apps/web/src/components/config/MessagesSection.tsx, apps/web/src/components/config/DevWppPanel.tsx, apps/web/src/hooks/useMessageTemplates.ts, apps/web/src/components/modals/TicketModal.tsx, apps/web/src/components/modals/DetallePedidoModal.tsx, apps/web/src/components/modals/NuevoPedidoModal.tsx, apps/api/test/webhook.test.ts, apps/api/test/businessDate.test.ts, apps/api/test/messageTemplates.test.ts, apps/api/test/config.test.ts]
---

# WPP — WhatsApp entrante y mensajes automáticos

> Recibe lo que Meta entrega al webhook, lo convierte en mensajes del chat (un ticket por cliente final, para siempre), decide a qué día del tablero pertenece el chat, manda la bienvenida automática con el aviso de privacidad, y guarda los textos por organización que el personal envía con los botones "Formulario" y "Cuenta banco".

## 1. Negocio

**Propósito.** Que todo lo que el cliente final escribe por WhatsApp aparezca en el tablero sin que nadie haga nada: en el ticket correcto, en el día correcto, sin duplicados y aunque Meta repita la entrega. El primer contacto del día recibe un saludo del negocio, y la primera vez en la vida del ticket, el aviso de privacidad (Ley 1581). El link del formulario ya **no** sale solo: lo dispara el personal con un botón, junto con textos que cada negocio edita.

**Alcance y límites.**
- *Incluye:* el webhook de Meta (firma, enrutamiento a la organización, deduplicación, tipos de mensaje, recibos), la creación y actualización del ticket por mensaje entrante, el día del chat (corte de las 21:00), la respuesta automática (bienvenida, redirección, aviso de privacidad), las plantillas por organización, los botones "Formulario" y "Cuenta banco", y el cifrado del token de Meta.
- *No incluye:* la bandeja, el envío de respuestas del personal y el visor de multimedia (INB); el formulario público y su link (FRM); el pedido y su fecha (ORD); el pase a mañana en el cierre (CAJ); la clasificación con IA de los mensajes (IA); el alta del número de Meta por organización desde DevTools (PLT).

**Dependencias.**
- *De qué depende:* Meta Cloud API (entrada por webhook y envío de respuestas automáticas); `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` y `WPP_TOKEN_ENC_KEY`; ACC (`authenticate`, rol admin/dev para configurar); `lib/formLink.ts` (aviso de privacidad, FRM/INB).
- *Quién depende de él:* INB (los tickets y mensajes que crea), ORD (`first_message_today_at` ordena el tablero y `fecha` ubica el chat), CAJ (`deferred_to`), FRM (link que envía el botón), IA (lee los mensajes guardados).

**Permisos.** Filas "Configuración de WhatsApp y mensaje de bienvenida", "Editar plantillas de mensajes", "Leer … plantillas de mensajes" y "Responder en el chat" de `01-funcional/actores-y-permisos.md`. Lo que esa tabla no dice:
- El webhook no tiene usuario: lo autentica la firma HMAC de Meta (actor **Meta**).
- Los botones "Formulario" y "Cuenta banco" los usa cualquier rol, también el domiciliario, porque la API de respuesta (`/inbox/:id/reply`) solo exige sesión (ver INB).
- `wpp_redirect_message` se puede cambiar por API (`PATCH /config/wpp`, admin/dev) pero ninguna pantalla lo muestra ni lo edita (PREG-023).

**Reglas.**

*Entrada y enrutamiento*

- **RN-WPP-01 — Firma de Meta.** CUANDO llega un `POST /api/v1/webhook`, el sistema DEBE verificar `X-Hub-Signature-256` (HMAC-SHA256 del cuerpo **crudo**, comparación de tiempo constante) con el secreto **global** `META_APP_SECRET`. Sin firma: 403 `MISSING_SIGNATURE`; firma inválida: 403 `INVALID_SIGNATURE`. Con `APP_ENVIRONMENT_NAME=production` la API no arranca sin `META_APP_SECRET` ni `META_WEBHOOK_VERIFY_TOKEN`; fuera de producción, sin secreto, acepta todo con un aviso. El handshake `GET` devuelve `hub.challenge` solo si el token está configurado y coincide; si no, 403. Detalle y PREG-033 en `02-tecnico/integraciones.md` §1.2. *(plataforma, código)*
- **RN-WPP-02 — 200 inmediato.** Siempre el webhook responde `{ ok: true }` **antes** de procesar; un error posterior no hace reintentar a Meta. Solo procesa `object = whatsapp_business_account` y cambios con `field = messages`. Cada mensaje del lote se procesa sin esperar al anterior (en paralelo). *Por qué:* Meta reintenta si la respuesta tarda. *(plataforma, código)*
- **RN-WPP-03 — A qué negocio va.** Siempre el mensaje se asigna a la organización **activa** cuyo `wpp_meta_phone_id` es el `metadata.phone_number_id` del evento (columna única). Sin coincidencia, se descarta con un `warn` en el log. *(plataforma, código)*
- **RN-WPP-04 — Mensajes tardíos.** CUANDO el `timestamp` del mensaje tiene más de **10 minutos** respecto al reloj del servidor, el sistema DEBE descartarlo; solo queda un `warn` en el log (con el remitente y el id). Ver PREG-032. *(plataforma, código)*
- **RN-WPP-05 — Sin duplicados.** Nunca se guarda dos veces el mismo `wpp_message_id` (único global). La actualización del ticket y la inserción del mensaje van en **una transacción**: si una entrega repetida pierde la carrera (P2002 sobre `wpp_message_id`), se revierte también el `+1` de no leídos. Si el P2002 es del ticket (dos mensajes distintos de un número nuevo llegando a la vez), se busca el ticket ganador y se inserta el mensaje ahí, en vez de perderlo. *(plataforma, código)*

*Ticket y día del chat*

- **RN-WPP-06 — Un ticket por cliente, para siempre.** Siempre se busca el ticket de la organización por `phone = identificador`, `bsuid = identificador` o `bsuid = pista`. El identificador es `from` (teléfono) o, si falta, `from_user_id` (BSUID). La pista BSUID solo se toma cuando el **mismo** contacto trae `wa_id` y `user_id` juntos; se guarda en el ticket solo si no tenía uno, y nunca se borra. *Por qué:* evitar que la misma persona quede partida en dos chats (pasó en producción). Principio 8. *(plataforma, código)*
- **RN-WPP-07 — Sin remitente.** CUANDO un mensaje no trae ni teléfono ni BSUID, el sistema DEBE crear un ticket con teléfono de relleno `no-<16 hexadecimales aleatorios>` y `no_wpp_number = true` (la interfaz lo avisa), y no intentar ningún envío automático. Cada mensaje así crea un ticket nuevo (PREG-020). *(plataforma, código)*
- **RN-WPP-08 — Qué toca cada mensaje entrante.** CUANDO entra un mensaje a un ticket existente, el sistema DEBE sumar 1 a `unread_count`, poner `last_message_at`, borrar `deferred_to`, rodar `fecha` (RN-WPP-10) y **reemplazar `customer_name`** por el nombre de perfil de WhatsApp (o por el identificador si no hay perfil) (PREG-021). Un ticket nuevo nace con no leídos en 1. *(plataforma, código)*
- **RN-WPP-09 — Primer mensaje del día (día real).** Siempre "primer mensaje del día" se decide contra el **día calendario real de Bogotá** (desde las 00:00, UTC−5), sin corte de las 21:00, con un reclamo atómico: solo gana el mensaje que logra cambiar `first_message_today_at` desde vacío o desde un día anterior. Como mucho uno por ticket y día, aunque lleguen en paralelo. Ese campo también ordena el tablero (ver ORD). *(plataforma, código)*
- **RN-WPP-10 — Fecha del ticket con corte de las 21:00.** CUANDO el mensaje es el primero del día real (o crea el ticket), `Ticket.fecha` DEBE ser el **día de negocio**: si llega entre las 21:00:00 y las 23:59:59 (Bogotá), cuenta para mañana (`businessDateForInstant`, `NIGHT_CUTOFF_HOUR = 21`). CUANDO no es el primero del día real, `fecha` DEBE ser el día real, sea la hora que sea. Vale igual para un ticket nuevo que para uno de hace meses. *Por qué:* un chat que arranca de noche no debe quedar enterrado en el tablero de un día que ya terminó (José, commits b8f83a5, 55de2fc, aec85c4). Ver PREG-025, p7, p8, p9. *(plataforma, código)*
- **RN-WPP-11 — El corte es solo del chat.** Nunca el corte de las 21:00 cambia `Order.fecha` ni el día de cierre: un pedido creado de noche desde el formulario queda con la fecha real de hoy (FRM, ORD, CAJ). Principio 5. *(plataforma, código)*

*Mensajes automáticos*

- **RN-WPP-12 — Cuándo hay respuesta automática.** CUANDO el mensaje es el primero del día real, el ticket tiene remitente, la organización tiene credenciales de Meta y tiene `wpp_redirect_message` o `welcome_message`, el sistema DEBE enviar la respuesta automática después de responder a Meta y sin bloquear el resto. Los mensajes automáticos quedan sin autor (`sent_by` nulo: "Sistema"). Sin credenciales no se envía ni se registra nada. *(plataforma, código; textos: cliente)*
- **RN-WPP-13 — Redirección.** CUANDO la organización tiene `wpp_redirect_message`, el sistema DEBE enviar **solo** ese texto (aunque haya bienvenida), sin aviso de privacidad ni link. *Por qué:* pensado para un número retirado que ya nadie atiende (commit 7de543c). *(cliente, código)*
- **RN-WPP-14 — Bienvenida y aviso de privacidad.** CUANDO se envía la bienvenida y el ticket nunca recibió el aviso (`privacy_notice_sent_at` vacío), el sistema DEBE agregar el aviso al final del mismo mensaje (dos saltos de línea). El aviso se envía **una vez por ticket, para siempre**, y se marca **solo si Meta aceptó** el envío; si falla, se reintenta en el próximo primer mensaje del día. La bienvenida sí se repite cada día real. El aviso depende de que exista `welcome_message` (PREG-022). *(plataforma, código)*
- **RN-WPP-15 — El link del formulario nunca sale solo.** Nunca el webhook genera ni envía el link del formulario; solo el botón "Formulario" (RN-WPP-26). *Por qué:* pedido explícito (commit 035968d). *(plataforma, código)*
- **RN-WPP-16 — Envío automático fallido.** CUANDO Meta rechaza la bienvenida o la redirección, el sistema DEBE guardar el mensaje saliente con `failed_reason` (recortado a 255 caracteres; la X roja del chat) y emitirlo al chat. *Por qué:* que el personal lo vea, no solo un log. Ver PREG-024. *(plataforma, código)*
- **RN-WPP-17 — Falla de facturación de Meta.** CUANDO la cuenta de Meta tiene un problema de pago ("Business eligibility payment issue", incidente del 2026-10-07), los mensajes **entrantes siguen llegando** normalmente y **todos los salientes** (automáticos y del personal) quedan con `failed_reason`. No hay alerta. Ver `02-tecnico/integraciones.md` §1.4. *(plataforma, José; registro de fallos: código)*

*Tipos de mensaje y recibos*

- **RN-WPP-18 — Cómo se guarda cada tipo.** Siempre así *(plataforma, código)*:

| Tipo de Meta | Texto guardado | `media_url` / `media_type` |
|---|---|---|
| `text` | El cuerpo, hasta 4096 caracteres. Sin cuerpo: se descarta sin rastro | — |
| `image`, `sticker` | Caption (hasta 4096) o nada | Media id de Meta / `image` (el sticker se muestra como foto) |
| `audio`, `video`, `document` | Caption (4096) o, si no hay, nombre del archivo (500) | Media id de Meta / su tipo |
| `location` | `Ubicación: <nombre> - <dirección>` o `Ubicación compartida` | Enlace de Google Maps / `location` |
| `reaction` con emoji | `Reaccionó <emoji> a: "<primeros 100 caracteres del original>"`, o sin cita si el original no es de esta organización | — |
| `interactive` con título de botón o lista | `Seleccionó: <título>` | — |
| Cualquier otro (o reacción sin emoji, o interactivo sin título) | `[Tipo de mensaje no soportado: <tipo>]` | — |

  Un tipo soportado al que le falta su campo (p. ej. `image` sin id) termina descartado sin rastro (PREG-031).
- **RN-WPP-19 — Multimedia: solo el id.** Nunca se descarga ni se guarda la multimedia del chat al recibirla; se guarda el media id de Meta y se resuelve al verla (INB). Principio 6. *(plataforma, código)*
- **RN-WPP-20 — La reacción no cruza negocios.** Siempre el mensaje citado en una reacción se busca **dentro de la organización** dueña del número, aunque `wpp_message_id` sea global. *(plataforma, código)*
- **RN-WPP-21 — Recibos que no retroceden.** CUANDO llega un estado de un mensaje saliente, `delivered` y `read` DEBEN quedar en verdadero (y `read` implica `delivered`), `failed` DEBE guardar el título o mensaje del primer error (255 caracteres) sin tocar los otros dos, y `sent` solo no cambia nada. Nunca vuelven a falso. Un estado de un mensaje que no está en la base se ignora. *(plataforma, código)*
- **RN-WPP-22 — Payload crudo.** Siempre el cuerpo completo del webhook se guarda en `raw_payload` de cada mensaje entrante, y en el del ticket solo cuando ese mensaje lo crea. En el log solo va la lista de campos del evento. *Por qué:* Meta no guarda historial de entregas. *(plataforma, código)*

*Plantillas de mensajes y botones*

- **RN-WPP-23 — Tres plantillas por organización.** Siempre existen `form_warning`, `form_followup` y `bank_account`. Cada una es lo guardado en `Organization.message_templates` si existe y no está en blanco; si no, el texto por defecto del código. Cambiar un default no migra nada (DT-001). *(cliente, código)*
- **RN-WPP-24 — Editar plantillas.** CUANDO un admin o dev guarda una plantilla, el sistema DEBE cambiar solo las claves enviadas (las demás se conservan), borrar la clave si llega `null` (vuelve al default), rechazar con 400 `VALIDATION_ERROR` un texto vacío tras `trim` o de más de **1000** caracteres, registrar en auditoría solo los nombres de las claves y emitir `message-templates:changed` a la organización. Cualquier rol las lee; encargado y domiciliario no editan (403 `FORBIDDEN`). La interfaz guarda un campo a la vez y no tiene botón para volver al default (se quitó en el commit 52aed92). *(plataforma, código)*
- **RN-WPP-25 — Bienvenida editable.** CUANDO un admin o dev guarda la bienvenida (`PATCH /config/wpp`), el sistema DEBE aceptar hasta **1000** caracteres; la interfaz manda `null` si queda vacía ("Vacío = desactivado"). La misma ruta cambia `wpp_meta_phone_id`, el token (se guarda cifrado por organización) y `wpp_redirect_message`; un `wpp_meta_phone_id` ya usado por otra organización da 409 `PHONE_ID_ALREADY_IN_USE`. Auditoría con solo los nombres de campos. *(cliente, código)*
- **RN-WPP-26 — Botón "Formulario".** CUANDO el personal lo toca, la interfaz DEBE pedir un link nuevo (`GET /inbox/:id/form-link`, ver FRM) y, si lo obtiene, enviar tres respuestas en orden: `form_warning`, el link y `form_followup`, esperando cada respuesta HTTP antes de la siguiente. Si el link falla: "No se pudo generar el link" y no se envía nada. Ver PREG-029. *(plataforma, código)*
- **RN-WPP-27 — Botón "Cuenta banco".** CUANDO el personal lo toca, la interfaz DEBE enviar `bank_account` como respuesta del chat. *(plataforma, código)*
- **RN-WPP-28 — Cuándo se desactivan.** Siempre "Formulario" y "Cuenta banco" están desactivados si el día es anterior a hoy o su caja ya cerró (`isPastDay`), o si las plantillas aún no cargaron. En `TicketModal` el día es `Ticket.fecha`; en `DetallePedidoModal`, `Order.fecha`; en `NuevoPedidoModal`, la fecha del modal. En los dos primeros también mientras se está enviando. Es solo de interfaz: la API de respuesta no lo exige (PREG-030). *(plataforma, código)*
- **RN-WPP-29 — Caché de plantillas.** Siempre la interfaz guarda las plantillas en caché **5 minutos** y la invalida al recibir `message-templates:changed`, para que un cambio hecho en otra pestaña o dispositivo se use de inmediato (commit 4a060c2). *(plataforma, código)*
- **RN-WPP-30 — Credenciales de Meta cifradas por negocio.** CUANDO se guarda el token de acceso (`PATCH /config/wpp`), el sistema DEBE cifrarlo con AES-256-GCM y una clave derivada por organización (HMAC-SHA256 de `WPP_TOKEN_ENC_KEY` con el `org_id`); queda con prefijo `enc:v2:`. Se lee con `decryptSecret`, que entiende también `enc:v1:` (clave maestra directa, formato anterior) y texto plano (de antes de que existiera la clave). Sin `WPP_TOKEN_ENC_KEY` el cifrado no hace nada y guarda texto plano (un aviso en consola una sola vez, salvo en test); el servidor se niega a arrancar sin esa clave cuando `APP_ENVIRONMENT_NAME=production` (`config.ts`). Si el descifrado falla (clave cambiada, dato dañado) devuelve `null`: `MetaCloudProvider.fromOrg` devuelve `null` y no se envía nada. El token nunca sale en las respuestas ni en el visor de PLT. *(plataforma, código)*
- **RN-WPP-31 — Texto del cliente sanitizado antes de ir a WhatsApp.** Siempre `lib/sanitize.ts › sanitizeForWhatsApp` quita los caracteres de control, escapa `*`, `_`, `~` y `` ` ``, elimina también los saltos de línea (son caracteres de control; no los convierte en espacio), recorta espacios y corta a 200 caracteres Unicode (por puntos de código, para no partir un emoji). No restringe el alfabeto (los nombres del catálogo llevan `/` y paréntesis). Hoy lo usan solo los dos mensajes que arma `public.ts` con texto del cliente (confirmación y actualización de pedido del formulario, ver RN-FRM-22), para el nombre y la cantidad de cada producto. *Por qué:* que el cliente no inyecte formato ni líneas en un mensaje con negritas fijas *(inferido del comentario)*. *(plataforma, código)*

**Criterios de aceptación.**

1. *Dado* un token de verificación configurado, *cuando* Meta hace `GET` con el token correcto, *entonces* recibe 200 con el `hub.challenge`; con un token distinto recibe 403. (RN-WPP-01; `webhook.test.ts › "GET verify handshake with correct hub.verify_token -> 200 returns the challenge string"` y `› "GET verify handshake with wrong token -> 403"`)
2. *Dado* un `POST` al webhook con una firma `X-Hub-Signature-256` que no coincide con el cuerpo, *cuando* llega, *entonces* responde 403 `INVALID_SIGNATURE` y no se guarda nada. (RN-WPP-01; *sin test*)
3. *Dado* un teléfono sin ticket y una organización con bienvenida y credenciales, *cuando* escribe su primer mensaje, *entonces* se crea un ticket con 1 no leído y recibe un solo mensaje: bienvenida con el aviso de privacidad al final, sin link de formulario. (RN-WPP-12, 14, 15; `webhook.test.ts › "first message of the day sends ONLY welcome+notice combined into one message - the form link is never auto-sent anymore, only via the manual \"Enviar formulario\" button"`)
4. *Dado* un ticket que ya recibió el aviso, *cuando* escribe otro día, *entonces* recibe la bienvenida sin repetir el aviso. (RN-WPP-14; `webhook.test.ts › "a SECOND message from the same ticket (even on a later day, isFirstMessageToday again) does NOT repeat the privacy notice …"`)
5. *Dado* una organización con `wpp_redirect_message`, *cuando* un cliente escribe por primera vez en el día, *entonces* recibe solo ese texto, aunque haya bienvenida. (RN-WPP-13; `webhook.test.ts › "org.wpp_redirect_message set -> sends ONLY that text, never the welcome/link/follow-up flow, even when welcome_message is also set"`)
6. *Dado* un cliente nuevo, *cuando* su primer mensaje llega a las 21:00:00 de Bogotá, *entonces* `Ticket.fecha` es el día siguiente; a las 20:59:59 es el mismo día. (RN-WPP-10; `webhook.test.ts › "20:59:59 cae en el mismo día; 21:00:00 y 23:59:59 caen en el día siguiente"`)
7. *Dado* un ticket que ya escribió a las 10 a.m., *cuando* escribe de nuevo a las 10 p.m., *entonces* su `fecha` no se corre a mañana. (RN-WPP-10; `webhook.test.ts › "un ticket que ya existe hoy (escribió a las 10 a.m.) y recibe un mensaje a las 10 p.m. NO se corre a mañana - solo un ticket NUEVO se corre"`)
8. *Dado* un mensaje sin teléfono ni BSUID, *cuando* llega, *entonces* se crea un ticket con teléfono de relleno y `no_wpp_number = true`, y no se intenta ningún envío automático. (RN-WPP-07; `webhook.test.ts › "a message with an empty sender phone (msg.from = \"\") gets a unique placeholder phone, is flagged no_wpp_number, and never attempts the welcome/link auto-send"`)
9. *Dado* un mensaje saliente ya leído, *cuando* llega un estado `delivered` tardío, *entonces* `read` y `delivered` siguen en verdadero. (RN-WPP-21; `webhook.test.ts › "delivered then read updates the matching message, never regresses, and read implies delivered even if the delivered event never arrived"`)
10. *Dado* un encargado, *cuando* intenta guardar una plantilla de mensajes, *entonces* recibe 403 `FORBIDDEN`; un admin que guarda una de más de 1000 caracteres recibe 400 `VALIDATION_ERROR`. (RN-WPP-24; `messageTemplates.test.ts › "el encargado no puede editar"` y `› "rechaza un texto vacío o demasiado largo"`)

**Textos que ve el cliente final.**
- **Bienvenida:** el texto del negocio, una vez por día real. La primera vez en la vida del ticket, seguido del aviso de privacidad en cursiva con el enlace a la política en el dominio de 4Client (`lib/formLink.ts › buildPrivacyNoticeMessage`).
- **Redirección:** solo el texto configurado, una vez por día real.
- **Botón "Formulario":** aviso (por defecto dice que el link es solo para pedir y que nunca se piden datos bancarios), el link, y un seguimiento (por defecto con mínimo y costo de domicilio).
- **Botón "Cuenta banco":** los datos bancarios del negocio.
- Los textos por defecto de las tres plantillas contienen hoy datos de un negocio concreto (DT-001); no se copian aquí.

## 2. Técnico

**Mapa de código.**

| Parte | Dónde |
|---|---|
| Webhook | `apps/api/src/routes/webhook.ts › webhookRoutes` (`GET /`, `POST /`, parser `application/json` con cuerpo crudo solo en este plugin), `› verifyHmac`, `› ingestMessage`, `› ingestImageMessage`, `› ingestBinaryMediaMessage`, `› ingestLocationMessage`, `› ingestStatus` |
| Día del chat | `apps/api/src/lib/businessDate.ts › businessDateForInstant`, `› NIGHT_CUTOFF_HOUR`; también lo usa `apps/api/src/routes/tickets.ts › POST /` (ticket manual) |
| Aviso de privacidad | `apps/api/src/lib/formLink.ts › buildPrivacyNoticeMessage` |
| Plantillas | `apps/api/src/lib/messageTemplates.ts › DEFAULT_MESSAGE_TEMPLATES`, `› messageTemplatesPatchSchema`, `› resolveMessageTemplates` |
| Configuración | `apps/api/src/routes/config.ts › GET /message-templates`, `› PUT /message-templates`, `› GET /org`, `› PATCH /wpp` |
| Web configuración | `apps/web/src/components/config/MessagesSection.tsx › MessagesSection` (Configuración > Mensajes: bienvenida y las tres plantillas); `apps/web/src/components/config/DevWppPanel.tsx › DevWppPanel` (DevTools: número, token y bienvenida; no toca la redirección) |
| Web botones | `apps/web/src/hooks/useMessageTemplates.ts › useMessageTemplates`; `TicketModal.tsx › sendFormLink`, `› sendBankAccount`; `DetallePedidoModal.tsx › sendFormLink`, `› sendBankAccount`; `NuevoPedidoModal.tsx` (manejadores en línea) |
| Datos | `Organization` (`wpp_meta_phone_id`, `wpp_meta_token`, `welcome_message`, `wpp_redirect_message`, `message_templates`, `active`), `Ticket` (`phone`, `bsuid`, `fecha`, `deferred_to`, `first_message_today_at`, `last_message_at`, `unread_count`, `customer_name`, `no_wpp_number`, `privacy_notice_sent_at`, `raw_payload`), `TicketMessage` (`wpp_message_id`, `media_url`, `media_type`, `delivered`, `read_by_client`, `failed_reason`, `raw_payload`), `AuditLog` |

**Regla → se hace cumplir en → test.** Rutas abreviadas al nombre de archivo.

| Regla | Se hace cumplir en | Test |
|---|---|---|
| RN-WPP-01 | `webhook.ts › verifyHmac`, `› webhookRoutes` | `apps/api/test/webhook.test.ts › "GET verify handshake with correct hub.verify_token -> 200 returns the challenge string"`; `› "GET verify handshake with wrong token -> 403"` (la firma HMAC, *sin test*) |
| RN-WPP-02 | `webhook.ts › POST /` | *(sin test)* |
| RN-WPP-03 | `webhook.ts › ingestMessage` | *(sin test)* |
| RN-WPP-04 | `webhook.ts › POST /` | *(sin test; los tests congelan `Date.now` para no caer en este descarte)* |
| RN-WPP-05 | `webhook.ts › ingestMessage` (transacción y `catch` de P2002) | *(sin test)* |
| RN-WPP-06 | `webhook.ts › ingestMessage`, `› POST /` (`bsuidHint`) | `webhook.test.ts › "a message with no `from`/`wa_id` at all, only from_user_id/user_id (WhatsApp username/BSUID), is NOT flagged no_wpp_number …"` (la búsqueda por pista, *sin test*) |
| RN-WPP-07 | `webhook.ts › POST /` (`noWppNumber`) | `webhook.test.ts › "a message with an empty sender phone (msg.from = "") gets a unique placeholder phone, is flagged no_wpp_number, and never attempts the welcome/link auto-send"` |
| RN-WPP-08 | `webhook.ts › ingestMessage` | *(sin test)* |
| RN-WPP-09 | `webhook.ts › ingestMessage` (`updateMany` sobre `first_message_today_at`) | `webhook.test.ts › "a SECOND message from the same ticket (even on a later day, isFirstMessageToday again) does NOT repeat the privacy notice …"` (la carrera, *sin test*) |
| RN-WPP-10 | `businessDate.ts › businessDateForInstant`; `webhook.ts › ingestMessage` | `apps/api/test/businessDate.test.ts › "a las 9 p.m. en punto y después, cae en el día siguiente"`; `webhook.test.ts › "20:59:59 cae en el mismo día; 21:00:00 y 23:59:59 caen en el día siguiente"`; `› "un ticket que ya existe hoy (escribió a las 10 a.m.) y recibe un mensaje a las 10 p.m. NO se corre a mañana - solo un ticket NUEVO se corre"`; `› "un ticket viejo cuyo primer mensaje de hoy llega a las 9 p.m. sí se corre al día siguiente"` |
| RN-WPP-11 | `public.ts › POST /submit` (día real); `businessDate.ts` (comentario) | *(sin test)* |
| RN-WPP-12 | `webhook.ts › ingestMessage` (condición y `sendAndRecord`) | `webhook.test.ts › "first message of the day sends ONLY welcome+notice combined into one message - the form link is never auto-sent anymore, only via the manual "Enviar formulario" button"` |
| RN-WPP-13 | `webhook.ts › ingestMessage` | `webhook.test.ts › "org.wpp_redirect_message set -> sends ONLY that text, never the welcome/link/follow-up flow, even when welcome_message is also set"` |
| RN-WPP-14 | `webhook.ts › ingestMessage` (`needsPrivacyNotice`) | `webhook.test.ts › "first message of the day sends ONLY welcome+notice …"`; `› "a SECOND message from the same ticket … does NOT repeat the privacy notice …"` (el reintento tras fallo, *sin test*) |
| RN-WPP-15 | `webhook.ts › ingestMessage` | `webhook.test.ts › "first message of the day sends ONLY welcome+notice …"` (verifica `form_token_min_iat` nulo) |
| RN-WPP-16 | `webhook.ts › ingestMessage` (`recordFailed`) | *(sin test)* |
| RN-WPP-17 | `webhook.ts › ingestMessage` (`recordFailed`); `inbox.ts › POST /:ticketId/reply` | *(sin test)* |
| RN-WPP-18 | `webhook.ts › POST /` y funciones `ingest*` | `webhook.test.ts › "an inbound image message stores Meta's own media_id directly as media_url …"`; `› "an inbound voice note (audio/ogg) stores Meta's own media_id directly as media_url …"`; `› "an inbound location never touches Meta's media API at all …"` (reacción, interactivo, no soportado, *sin test*) |
| RN-WPP-19 | `webhook.ts › ingestImageMessage`, `› ingestBinaryMediaMessage` | los mismos tests de imagen y audio |
| RN-WPP-20 | `webhook.ts › POST /` (rama `reaction`) | *(sin test)* |
| RN-WPP-21 | `webhook.ts › ingestStatus` | `webhook.test.ts › "delivered then read updates the matching message, never regresses, and read implies delivered even if the delivered event never arrived"`; `› "a failed status records the reason without touching delivered/read_by_client"`; `› "a status for a wpp_message_id we never stored is silently ignored, not an error"` |
| RN-WPP-22 | `webhook.ts › ingestMessage`, `› POST /` (log) | `webhook.test.ts › "every inbound message persists the ENTIRE webhook POST body verbatim in raw_payload - on the message always, and on the ticket only at creation time"` |
| RN-WPP-23 | `messageTemplates.ts › resolveMessageTemplates` | `apps/api/test/messageTemplates.test.ts › "sin nada guardado devuelve los defaults"`; `› "una clave guardada reemplaza solo esa; un valor vacío cae al default"` |
| RN-WPP-24 | `config.ts › PUT /message-templates`, `› GET /message-templates` | `messageTemplates.test.ts › "GET devuelve los textos efectivos, y el encargado también puede leerlos"`; `› "el encargado no puede editar"`; `› "el admin edita su texto y el cambio se ve en GET"`; `› "null restaura el texto por defecto de esa clave"`; `› "rechaza un texto vacío o demasiado largo"` (auditoría y socket, *sin test*) |
| RN-WPP-25 | `config.ts › PATCH /wpp`; web `MessagesSection.tsx`, `DevWppPanel.tsx` | `apps/api/test/config.test.ts › "lets an org claim a wpp_meta_phone_id nobody else has"`; `› "rejects a second org claiming the SAME wpp_meta_phone_id with 409 PHONE_ID_ALREADY_IN_USE, not a raw 500"` |
| RN-WPP-26, 27, 28 | web `TicketModal.tsx`, `DetallePedidoModal.tsx`, `NuevoPedidoModal.tsx` | *(sin test: no hay tests de interfaz)* |
| RN-WPP-29 | web `useMessageTemplates.ts`; `config.ts › PUT /message-templates` | *(sin test)* |
| RN-WPP-30 | `lib/crypto.ts › encryptSecret`, `› decryptSecret`; `config.ts › PATCH /wpp`; `config.ts` (arranque); `services/whatsapp/meta-cloud.ts › MetaCloudProvider.fromOrg`; migración de formato: `apps/api/src/reencrypt-wpp-tokens.ts` (ver RN-PLT-20) | *(sin test)* |
| RN-WPP-31 | `lib/sanitize.ts › sanitizeForWhatsApp`; `public.ts › POST /submit` | *(sin test)* |

**Datos y eventos socket.** Todos a la sala `org:<id>`: `ticket:message` (cada entrante y cada automático, también los fallidos), `ticket:unread` (`{ ticketId, count }`), `ticket:message-status` (recibos, con los valores leídos de la base, no los parciales del evento) y `message-templates:changed` (sin datos). `PATCH /config/wpp` no emite nada.

**Transacciones y concurrencia.**
- Por mensaje: búsqueda de organización, chequeo de duplicado y búsqueda del ticket **fuera** de la transacción; dentro van crear o actualizar el ticket (con el reclamo atómico de RN-WPP-09) y crear el mensaje.
- La recuperación de P2002 del ticket inserta el mensaje y suma no leídos fuera de transacción, y **no** rueda `fecha`, `deferred_to`, `customer_name` ni `first_message_today_at`, ni dispara bienvenida. Busca al ganador por teléfono o BSUID igual al identificador, sin la pista BSUID.
- La respuesta automática corre en una función asíncrona suelta: si el proceso se reinicia entre el 200 y el envío, no se envía y no queda rastro.
- Límite de uso del webhook: **2000** peticiones por minuto por IP (todas las organizaciones comparten las IP de Meta).

**Códigos de error propios.**

| Código | HTTP | Cuándo |
|---|---|---|
| `MISSING_SIGNATURE` | 403 | Webhook sin `X-Hub-Signature-256` (con secreto configurado) |
| `INVALID_SIGNATURE` | 403 | Firma HMAC que no coincide |
| *(sin código)* | 403 | Handshake `GET` con token incorrecto o sin token configurado (`{ error: 'Token inválido' }`) |
| `VALIDATION_ERROR` | 400 | Plantilla vacía o de más de 1000 caracteres; `PATCH /config/wpp` inválido (incluye `details`) |
| `PHONE_ID_ALREADY_IN_USE` | 409 | `wpp_meta_phone_id` de otra organización |
| `FORBIDDEN` | 403 | Encargado o domiciliario editando plantillas o configuración de WhatsApp |

**Si tocas X, revisa Y.**
- **El cálculo del día real** (`localDateStr`, `dayStartUtc`) está escrito en línea en `webhook.ts`, distinto de `businessDate.ts`; `tickets.ts › POST /` repite la misma lógica (día de negocio solo al crear). Cambiar el corte en uno sin el otro hace que el chat manual y el de WhatsApp caigan en días distintos.
- **`first_message_today_at`** lo escriben el webhook y `tickets.ts › POST /` (ticket manual, que lo pone en "ahora"): si el personal crea o reabre un ticket a mano, el primer mensaje del cliente ese día ya no cuenta como primero (sin bienvenida, sin corte). Lo lee `tickets.ts › GET /` para ordenar.
- **`deferred_to`** lo pone `cierre.ts` (pasar a mañana) y lo borra cada mensaje entrante (PREG-028) y `public.ts › POST /submit`.
- **`customer_name`** lo cambia el personal (`tickets.ts`, admin) y lo pisa cada mensaje entrante (PREG-021).
- **Las claves de plantilla** están en `messageTemplates.ts`, en el tipo `MessageTemplates` de `useMessageTemplates.ts` y en `FIELDS` de `MessagesSection.tsx`; agregar una exige tocar los tres.
- **Los textos por defecto** están fijados por `messageTemplates.test.ts › "el mínimo de domicilio y el costo quedan en el texto por defecto"`.
- **Un tipo de mensaje nuevo de Meta** se agrega antes del filtro `SUPPORTED_TYPES`, o termina como "[Tipo de mensaje no soportado]".
- **`welcome_message` vacío desactiva también el aviso de privacidad** (RN-WPP-14); cualquier cambio en la bienvenida afecta el cumplimiento de la Ley 1581.

## 3. Pendientes

IDs globales; resumen en `03-plan/preguntas-abiertas.md` y `03-plan/problemas-conocidos.md`. Ya registrados en otro archivo: **PREG-032** (descarte de mensajes con más de 10 min, solo en el log y con el remitente) y **PREG-033** (HMAC con secreto global), en `02-tecnico/integraciones.md`.

- **PREG-020 — Mensajes sin remitente: un ticket por mensaje.** Cada mensaje sin teléfono ni BSUID genera un teléfono de relleno aleatorio, así que tres mensajes de la misma persona dejan tres tickets "sin número". ¿Se agrupan de alguna forma o es aceptable por lo raro del caso?
- **PREG-021 — El nombre de WhatsApp pisa el del personal.** Cada mensaje entrante reemplaza `customer_name` por el nombre de perfil (o por el teléfono/BSUID si no viene perfil); un ticket renombrado por el admin pierde el nombre con el siguiente mensaje. Con BSUID el nombre de perfil suele ser decorativo y `username` no se usa. ¿Se conserva el nombre puesto a mano?
- **PREG-022 — Casos en que el aviso de privacidad nunca sale.** Depende de `welcome_message`: si el negocio no tiene bienvenida, nunca se envía; tampoco por el camino de redirección, en tickets sin número ni en organizaciones sin credenciales. La pantalla dice "Vacío = desactivado" sin advertir esto. ¿Debe el aviso enviarse por separado aunque no haya bienvenida? (Principio 6.)
- **PREG-023 — Redirección sin pantalla.** `wpp_redirect_message` solo se cambia por API o base. `GET /config/org` lo devuelve, pero ni Configuración > Mensajes ni DevTools lo muestran, así que un admin no puede saber que está activo (y desactiva la bienvenida). ¿Se agrega a DevTools?
- **PREG-024 — Fallos automáticos en serie.** Durante una falla de Meta (p. ej. la de facturación del 2026-10-07) cada primer mensaje del día de cada cliente deja una bienvenida con X roja, y el aviso de privacidad se reintenta cada día hasta que un envío funcione. No hay alerta al negocio ni a dev. ¿Se agrega una alerta, o se deja de registrar el automático fallido?
- **PREG-025 — Chat de noche y pedido del formulario en días distintos.** Un cliente que escribe por primera vez a las 21:30 queda con `Ticket.fecha` = mañana; si arma el pedido por el formulario esa misma noche, `Order.fecha` = hoy (si la caja no cerró). El chat aparece en el tablero de mañana por su fecha y también en el de hoy porque tiene un pedido ese día. ¿Es el comportamiento esperado? (Revisar con FRM, ORD, DSH.)
- **PREG-026 — El segundo mensaje de la noche devuelve el chat a hoy.** Si el primer mensaje del día llega a las 21:10 (fecha = mañana) y el cliente escribe otra vez a las 21:20, ese segundo mensaje pone la fecha en el día real (hoy): el chat salta de vuelta. El commit 55de2fc dice que un chat ya abierto "se queda en el día en que ya estaba", pero el código usa el día real, no la fecha actual del ticket. Ningún test cubre este caso. ¿Cuál es la intención?
- **PREG-027 — Dos bienvenidas para el mismo día de negocio.** El primer mensaje del día se decide por día real y la fecha por día de negocio: un cliente que escribe a las 21:30 y otra vez a las 00:10 recibe dos bienvenidas en menos de 3 horas, ambas para el mismo día del tablero. ¿Debe el "primer mensaje del día" usar también el corte?
- **PREG-028 — Un mensaje después del cierre saca el chat de mañana.** El cierre pasa un chat a mañana con `deferred_to` sin cambiar `fecha`. Si ese cliente, que ya había escrito hoy, vuelve a escribir antes de las 24:00, el mensaje borra `deferred_to` y deja `fecha` = hoy (un día ya cerrado): el chat desaparece del tablero de mañana. Si su primer mensaje del día fue después de las 21:00, sí queda en mañana. ¿Debe un mensaje respetar el día cerrado? (Revisar con CAJ, RN-CAJ-18.)
- **PREG-029 — "Formulario enviado" sin saber si salió.** `POST /inbox/:id/reply` responde 201 antes de hablar con Meta, así que la interfaz muestra "Formulario enviado" aunque Meta rechace los tres mensajes (solo aparecen las X rojas), y el orden de llegada al cliente lo decide el despacho a Meta, no la espera del navegador *(inferido)*. ¿Se acepta?
- **PREG-030 — Desactivación solo en la interfaz.** "Formulario" y "Cuenta banco" se desactivan en días pasados o con la caja cerrada, pero la API de respuesta acepta enviar cualquier texto en cualquier día. ¿Debe la API impedirlo, o es solo una ayuda visual?
- **PREG-031 — Otros descartes silenciosos.** Un `text` sin cuerpo, o un tipo soportado sin su campo (`image` sin id, `location` sin datos), se descarta sin log ni mensaje. Quitar una reacción (emoji vacío) aparece como "[Tipo de mensaje no soportado: reaction]". ¿Se registran o se ignoran a propósito?
- **DT-001 — Plantillas por defecto con datos de un cliente.** `DEFAULT_MESSAGE_TEMPLATES` contiene datos privados de un negocio concreto (nombre, cuenta bancaria, mínimo y costo de domicilio), y un test los fija. Una organización nueva que no edite sus mensajes enviaría la cuenta bancaria de otro negocio al tocar "Cuenta banco". Rompe el principio 2. Los tests del webhook también usan nombres y valores con forma de datos reales. Defaults genéricos (o vacíos con botón desactivado) y tests con datos ficticios.
- **DT-010 — Faltan tests de reglas de tenant y entrada.** Sin test: enrutamiento por `phone_number_id` y organización inactiva, reacción limitada a la organización, firma HMAC del `POST`, deduplicación y las dos recuperaciones de P2002, descarte de 10 min, sobrescritura de `customer_name`, `deferred_to` borrado, envío automático fallido, auditoría y evento socket de plantillas. El principio 11 exige test para reglas de tenant.
- **DT-011 — Comentarios desactualizados.** `webhook.ts` todavía describe "tres mensajes" (bienvenida, link, seguimiento) y un envío de link automático que ya no existe; `server.ts` dice que el límite del webhook es 300/min y es 2000.

Decisiones relacionadas: principios 5 (dos conceptos de día), 6 (Ley 1581) y 8 (un ticket por teléfono) de `00-principios.md`.
