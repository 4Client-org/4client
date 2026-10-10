---
estado: vigente
verificado: 2026-10-10 @ 1edb809
fuentes: [apps/api/src/services/whatsapp/meta-cloud.ts, apps/web/src/lib/formatPhone.ts, apps/web/src/lib/fileToBase64.ts, apps/web/src/components/ui/ChatImage.tsx, apps/web/src/components/ui/ChatAudio.tsx, apps/web/src/components/ui/ChatVideo.tsx, apps/web/src/components/ui/ChatDocument.tsx, apps/web/src/components/ui/ChatLocation.tsx, apps/api/src/routes/inbox.ts, apps/api/src/routes/tickets.ts, apps/api/src/lib/formLink.ts, apps/api/src/lib/linkSecurity.ts, apps/api/src/lib/media.ts, apps/api/src/lib/businessDate.ts, apps/api/prisma/migrations/20260802000000_ticket_last_activity/migration.sql, apps/web/src/components/inbox/InboxPanel.tsx, apps/web/src/components/modals/TicketModal.tsx, apps/web/src/components/modals/DetallePedidoModal.tsx, apps/web/src/components/modals/NuevoPedidoModal.tsx, apps/web/src/components/ui/ForwardMessageModal.tsx, apps/web/src/components/ui/DeliveryStatus.tsx, apps/web/src/hooks/useChatScroll.ts, apps/web/src/hooks/useSendChatMedia.ts, apps/web/src/hooks/useChatMediaBlob.ts, apps/web/src/pages/MainPage.tsx, apps/web/src/styles/global.css, apps/api/test/inbox.test.ts, apps/api/test/tickets.test.ts, apps/api/test/files.test.ts, apps/api/test/public.test.ts]
---

# INB — Chats (bandeja, mensajes, links de formulario)

> Deja al personal ver y contestar las conversaciones de WhatsApp (texto y multimedia), reenviar mensajes, enviar y bloquear el link del formulario, borrar los datos de un cliente (Ley 1581) y ver el tablero de tickets del día. Lo usan admin y dev (bandeja completa) y todos los roles (chat dentro del ticket).

## 1. Negocio

**Propósito.** Que el negocio atienda por WhatsApp sin salir de 4Client: leer, responder, mandar fotos/audio/video/PDF, reenviar y entregar al cliente el link del formulario. Este módulo es el lado **del personal** del chat; lo que entra desde Meta es `modulos/WPP.md`, el formulario del cliente es `modulos/FRM.md`, "Tomar lista" es `modulos/IA.md`.

**Alcance y límites.**
- *Incluye:* la bandeja "Chats WPP" y su búsqueda; leer el chat; responder, enviar multimedia y reenviar; ver multimedia; generar y bloquear links del formulario (lado del personal); borrar los datos de un cliente (`dev`); el tablero de tickets del día; renombrar ticket; el encabezado y las piezas de interfaz del chat.
- *No incluye:* recibir mensajes de Meta, crear el ticket, el día del chat y los mensajes automáticos (WPP); el formulario público y su validación del token (FRM); los pedidos y sus modales salvo la columna del chat (ORD); "Tomar lista" (IA); el cierre y el pase a mañana (CAJ); la factura (FAC).

**Dependencias.**
- *De qué depende:* WPP (tickets y mensajes entrantes, `first_message_today_at`, plantillas); Meta Cloud API (enviar, subir y descargar multimedia); ACC (sesión y roles); FRM y FAC (leen el token y la revocación que este módulo escribe); R2 solo en el límite del borrado (PREG-037).
- *Quién depende de él:* ORD y CAJ (abren el chat y el tablero de tickets); FRM y FAC (validez de los links); IA ("Tomar lista" parte del chat); DSH (bloquear todos vive en el informe).

**Permisos.** Filas "Ver tablero, tickets, pedidos, historial de chat", "Responder en el chat, enviar multimedia, reenviar", "Generar / revocar el link de formulario", "Chats WPP (bandeja completa y búsqueda)", "Bloquear todos los links", "Renombrar ticket / cambiar su teléfono" y "Borrar datos de un cliente" de `01-funcional/actores-y-permisos.md`. Lo que esa tabla no dice:
- **Interfaz ≠ API.** El encargado y el domiciliario no ven la pestaña "Chats WPP" (la API les responde 403 en `GET /inbox`), pero sí abren el chat desde el ticket y pueden responder, enviar multimedia, reenviar, mandar el formulario y bloquear el link (RN-INB-10, RN-INB-18, RN-INB-19). El botón "Bloquear Link" de un solo ticket está abierto a todos los roles; "bloquear todos" es solo admin y vive en el informe (`apps/web/src/components/dashboard/ResumenTab.tsx`).
- "Chats WPP" solo admin/dev fue **decisión explícita**: commit `6e18c76` (2026-08-02) lo abrió al encargado y `dbc9633` (mismo día) lo revirtió "a propósito", porque el encargado ya tiene el tablero. *(inferido, commits)*
- Renombrar y cambiar teléfono: la API es solo admin/dev; el botón del lápiz está **apagado** con la bandera `RENAME_TICKET_UI_ENABLED = false` en `InboxPanel.tsx` (commit `bf4c4a9`: "nadie lo ha pedido aún").

**Estados del mensaje saliente.** No hay máquina de estados guardada; se deduce de tres campos del `TicketMessage` saliente.

| Lo que ve el personal | Condición |
|---|---|
| Un check gris ("Enviado") | ni `delivered` ni `read_by_client` ni `failed_reason` |
| Doble check gris ("Entregado") | `delivered` |
| Doble check azul ("Leído") | `read_by_client` |
| Aviso rojo ("No se pudo entregar: …") | `failed_reason` con texto (gana sobre todo lo demás) |

`wpp_status` solo lo devuelve el `POST` de envío: `sending` (hay credenciales; el envío a Meta sigue en segundo plano) o `no_credentials` (solo guardado). Los cambios posteriores llegan por Meta (`modulos/WPP.md`).

**Reglas.**

*Bandeja y búsqueda*

- **RN-INB-01 — Bandeja de admin.** CUANDO admin/dev abre "Chats WPP", el sistema DEBE devolver los **500** tickets de su organización con `last_activity_at` más reciente (orden descendente), cada uno con su último mensaje y sus pedidos que no están en papelera, sin duplicar teléfono. No hay paginación: `page` se acepta y se ignora. Encargado y domiciliario: 403. *(plataforma, código)*
- **RN-INB-02 — "Última actividad" la mantiene la base.** Siempre `Ticket.last_activity_at` sube con **cada** `TicketMessage` insertado (entrante o saliente) por un trigger de Postgres (`trg_bump_ticket_last_activity`, usa `created_at`, nunca retrocede), no por código de aplicación. Responder a un chat viejo lo sube al tope; **no** toca `last_message_at` (ese campo, solo de mensajes entrantes, ya no ordena nada visible). *Por qué:* había 14+ lugares que insertan mensajes y uno olvidado desordenaba la bandeja. *(plataforma, código; el porqué, inferido de la migración)*
- **RN-INB-03 — Destinos de reenvío para cualquier rol.** `GET /inbox/forward-targets` devuelve solo `id`, `customer_name` y `phone` de los 500 tickets más recientes por actividad (sin duplicar teléfono), a cualquier usuario autenticado. *Por qué:* el encargado veía el buscador de reenviar con la lista vacía (commit `0e78f23`). *(plataforma, código)*
- **RN-INB-04 — Búsqueda en todo el historial.** CUANDO admin/dev busca, el sistema DEBE devolver hasta **50** tickets cuyo nombre, teléfono o algún mensaje coincidan, sin tildes ni mayúsculas (`immutable_unaccent(lower(...)) LIKE`), con el mensaje que coincidió como fragmento. El filtro por `fecha` acota el mensaje que coincide (por `sent_at`) al día de Bogotá completo (05:00 UTC a 05:00 UTC del día siguiente); sin texto, solo salen los tickets con algún mensaje ese día, pero con texto un ticket cuyo nombre o teléfono coincide sale aunque no tenga mensajes ese día (sin fragmento). Sin texto ni fecha: lista vacía. `q` ≤ 200 caracteres; fecha con formato `AAAA-MM-DD`, si no 400 `VALIDATION_ERROR`. La interfaz solo busca con ≥ 2 caracteres o con fecha. *(plataforma, código)*

*Mensajes y no leídos*

- **RN-INB-05 — Últimos 500 mensajes.** CUANDO se abre un chat, el sistema DEBE devolver los **500** mensajes más recientes en orden cronológico (se piden 501 para saber si hay más: `hasMoreMessages`). El orden es por `created_at` e `id`, nunca por `sent_at`. Cualquier rol de la organización puede leerlo; otra organización: 404. *Por qué:* con `asc` + `take 500` un chat largo dejaba de mostrar lo nuevo (commit `a5d1be3`). *(plataforma, código; el porqué, inferido)*
- **RN-INB-06 — Pedidos del chat acotados al día.** CUANDO se pide `?fecha=`, los pedidos adjuntos DEBEN ser solo los de esa fecha (sin papelera); sin `fecha`, todos. *Por qué:* un ticket es uno por teléfono para siempre. *(plataforma, código)*
- **RN-INB-07 — Cargar anteriores.** `GET /inbox/:ticketId/messages/older?cursor=<id de mensaje>` devuelve la página siguiente hacia atrás (500 + `hasMoreMessages`) con paginación por cursor; `cursor` debe ser UUID (si no, 400). *(plataforma, código)*
- **RN-INB-08 — Abrir un chat NO borra los no leídos.** Nunca abrir o leer un chat cambia `unread_count`; el punto de "sin leer" significa "falta contestar". *(plataforma, código)*
- **RN-INB-09 — Cuándo se ponen en 0.** CUANDO el personal envía una respuesta de texto, una foto/audio/video/documento, o recibe un reenvío como **destino**, el sistema DEBE poner `unread_count = 0` del chat (si era > 0) y emitir `ticket:unread`. Lo suma el webhook (`modulos/WPP.md`); la decisión `atendido` del cierre lo pone en 0 (`modulos/CAJ.md`, RN-CAJ-18). Mandar el formulario o "Cuenta banco" cuenta también, porque la interfaz los envía como respuestas de texto. *(plataforma, código)*

*Responder, multimedia y reenvío*

- **RN-INB-10 — Responder: primero guardar, luego Meta.** CUANDO el personal responde (1–4096 caracteres), el sistema DEBE crear el `TicketMessage` saliente, emitir `ticket:message`, resetear no leídos (RN-INB-09) y responder `201` **antes** de hablar con Meta; el envío corre en segundo plano. Con éxito guarda `wpp_message_id` (así los estados `delivered`/`read` del webhook encuentran el mensaje) y emite `ticket:message-status`; con error guarda `failed_reason` (máx. 255 caracteres) y emite lo mismo. Sin credenciales de Meta: se guarda igual, `wpp_status = no_credentials` y no hay envío. La API no revisa la ventana de 24 h: si Meta rechaza, aparece como `failed_reason`. *(plataforma, código)*
- **RN-INB-11 — Multimedia: tipos y tamaños.** CUANDO se envía un archivo (base64 en JSON), el sistema DEBE aceptar solo: imagen `jpeg/png/webp` ≤ **5 MB**; audio `ogg/mpeg/mp4/amr` ≤ **16 MB** (sin pie de foto); video `mp4/3gpp` ≤ **16 MB**; documento `application/pdf` ≤ **100 MB** (con `filename` obligatorio, ≤ 200 caracteres). Pie de foto ≤ 1000 caracteres. Se rechaza con 400 `VALIDATION_ERROR` lo vacío, lo grande y lo que no coincide. *(plataforma, código)*
- **RN-INB-12 — Se verifican los bytes reales.** Siempre el tipo declarado se compara con la firma de los primeros bytes del archivo (`detectImageMime` / `detectMediaMime`); una etiqueta falsa se rechaza antes de subir nada. *(plataforma, código)*
- **RN-INB-13 — Subir a Meta antes de crear el mensaje.** CUANDO se envía multimedia, el sistema DEBE subir primero el archivo a Meta y guardar **el `media_id` de Meta** en `media_url`; solo entonces crea el mensaje y envía en segundo plano. Sin credenciales: 422 `NO_WPP_CREDENTIALS` (no se crea mensaje); fallo de la subida: 502 `WPP_UPLOAD_FAILED`. Nunca se guarda el archivo en disco, R2 ni base. *(plataforma, código; principio 6)*
- **RN-INB-14 — Límites de frecuencia.** Reenviar: **20** por minuto. Enviar foto/audio/video/documento: **60** por minuto cada ruta. Responder y el resto de rutas del módulo no tienen límite propio (aplica el global de 300 por minuto del servidor). *(plataforma, código)*
- **RN-INB-15 — Reenviar.** CUANDO el personal reenvía un mensaje a 1–20 chats (UUID; si no, 400), el sistema DEBE: quitar el chat de origen de los destinos (si no queda ninguno, 400 "Elige un chat distinto al actual"); ignorar los destinos de otra organización o inexistentes y listarlos en `failed` de la respuesta; descargar el archivo de Meta **una sola vez** y volver a subirlo por destino; crear en cada destino una fila saliente nueva (que reutiliza el mismo `media_id` para **verlo**) y resetear sus no leídos. Texto y ubicación se reenvían sin subir archivo. Responde `201` con `{ forwarded, failed }`. *(plataforma, código)*
- **RN-INB-16 — Reenvío imposible = fila fallida.** CUANDO no se puede ni intentar el envío (organización sin credenciales, ubicación ilegible, o archivo ya retirado por Meta), el sistema DEBE crear igual la fila en el destino y marcarla de inmediato con `failed_reason`, para que no quede como un envío pendiente eterno. Ver PREG-038. *(plataforma, código)*
- **RN-INB-17 — Ver multimedia.** `GET /inbox/media/:token` (cualquier rol) acepta solo un `media_id` numérico de 5 a 40 dígitos (si no, 400), exige que ese `media_id` pertenezca a un mensaje **de la organización de quien pide** (si no, 404) y le pide los bytes a Meta **en vivo** cada vez. Meta guarda el archivo **30 días**: pasado eso, 404 `MEDIA_EXPIRED`. Se revalida la firma de los bytes en cada vista; envía `nosniff` y `Cache-Control: private, max-age=86400`. La interfaz lo pide con el token de sesión y lo muestra como `blob` (`useChatMediaBlob`, `ChatImage`). *(plataforma, código)*

*Link del formulario (lado del personal)*

- **RN-INB-18 — Generar un link.** CUANDO el personal pulsa "Formulario", `GET /inbox/:ticketId/form-link` DEBE crear un token de **20 bytes aleatorios en hex (40 caracteres)**, **sobrescribirlo** en el ticket (lo que mata todo link anterior, porque la búsqueda por el valor viejo ya no encuentra nada), guardar quién lo envió y la hora de emisión, poner `form_link_opened_at = null` y `link_failed_attempts = 0`, y borrar la fila de revocación del ticket. Devuelve la URL con el primer `FRONTEND_URL`. El webhook **no** genera links (RN-WPP-15). La interfaz manda después **tres mensajes de texto** por `/reply`: advertencia, link y seguimiento. *(plataforma, código)*
- **RN-INB-19 — Bloquear un link.** CUANDO el personal pulsa "Bloquear Link", `POST /inbox/:ticketId/form-link/revoke` (motivo opcional ≤ 255) DEBE crear o actualizar la revocación del ticket y además **revocar todas las facturas** (`InvoiceLink`) del ticket que no lo estén. Un link generado después vuelve a funcionar (RN-INB-18 borra la revocación). *(plataforma, código)*
- **RN-INB-20 — Bloquear todos (solo admin/dev).** `POST /inbox/form-links/block-all` DEBE poner `Organization.form_links_blocked_at = ahora`; mata todo link emitido **antes** de ese instante (también facturas) y no afecta los emitidos después. No es un apagado permanente. *(plataforma, código)*
- **RN-INB-21 — Escalera de bloqueo por intentos: hoy inerte.** `lib/linkSecurity.ts` define 10 intentos fallidos (bloquea los links del ticket), 30 acumulados (bloquea el chat 24 h) y `registerFailedLinkAttempt`, pero **nada llama a `registerFailedLinkAttempt`** desde que se quitó la verificación de los últimos 4 dígitos del teléfono (commit `089ddc3`), así que los contadores nunca suben y `link_failed_total` y `link_blocked_until` nunca se escriben. Siguen leyéndose en `public.ts › loadTicketByFormToken` y `files.ts` (ramas que hoy no se alcanzan). `device_token` es obligatorio en las rutas públicas pero ya no se compara con nada (`FormLinkSession` solo se borra en `erase-data`). El comentario de `linkSecurity.ts` dice que `GET /form-link` llama a `clearSoftLinkBlock`; el código reinicia `link_failed_attempts` directamente (`generateFormLinkUrl`). `clearSoftLinkBlock` sí se llama, pero solo desde `files.ts › POST /invoice`. Ver PREG-035 y DT-012. *(plataforma, código)*

*Borrado de datos (Ley 1581)*

- **RN-INB-22 — Borrar los datos de un cliente.** CUANDO `dev` ejecuta `POST /inbox/:ticketId/erase-data`, el sistema DEBE, en una transacción: **anonimizar** todos los pedidos del ticket (cualquier estado: nombre "Cliente eliminado", contacto y teléfono nulos, dirección "[eliminado a solicitud del cliente]"; número, productos y precios quedan); **borrar** todos los mensajes del chat, la revocación y las sesiones de formulario; **revocar** las facturas y poner su `phone_last4` en `****`; y **anonimizar el ticket** (nombre, teléfono `eliminado-<16 hex>`, `bsuid`, `raw_payload`, token y contadores en cero/nulo), sin borrarlo ni tocar `consent_given_at`. Deja `audit_logs` con `ticket.erase_customer_data` y el conteo. Admin y encargado: 403. **Límites documentados:** no toca `order_history` (inmutable, principio 4), las observaciones, las notas del pedido ni los PDF de factura en R2. Ver PREG-037. *(plataforma, código; límites del comentario de la ruta)*

*Tablero de tickets*

- **RN-INB-23 — Lista del día.** `GET /tickets?fecha=` (cualquier rol; sin `fecha` usa `new Date()` del servidor, un instante y no un día, así que en la práctica la interfaz siempre manda la fecha) DEBE devolver los tickets de la organización cuya `fecha` sea ese día **o** cuyo `deferred_to` sea ese día **o** que tengan un pedido de ese día; con los últimos 50 mensajes (cronológicos) y los pedidos de ese día que no están en papelera ni eliminados por el cliente. *Por qué del `OR`:* la fecha del pedido es la verdad aunque `deferred_to` nunca se haya escrito. *(plataforma, código; el porqué, comentario)*
- **RN-INB-24 — Orden del tablero.** Siempre se ordena por `first_message_today_at` ascendente con los **nulos primero** (los que están hoy solo por un pedido o un pospuesto, sin mensaje nuevo, van antes que las llegadas de hoy), y se deja un ticket por teléfono. *Por qué:* "el primero en llegar sigue primero" todo el día, aunque escriba otra vez. *(plataforma, código)*
- **RN-INB-25 — Crear ticket a mano (sin uso).** `POST /tickets` (cualquier rol, `phone` ≥ 7 caracteres) hace `upsert` por `(org, phone)`: si **no existía** crea con la fecha del **día de negocio** (corte 21:00 Bogotá: de 21:00 a 23:59 cuenta para mañana); si **ya existía** lo pasa a **hoy real** de Bogotá (sin corte), quita `deferred_to`, pone `first_message_today_at = ahora` y pone el nombre dado o el teléfono. **La interfaz no lo llama.** Ver PREG-036. *(plataforma, código)*
- **RN-INB-26 — Renombrar / cambiar teléfono.** CUANDO admin/dev edita (`PATCH /tickets/:id`, nombre 1–200, teléfono 7–150, al menos uno), el sistema DEBE: responder 409 `PHONE_TAKEN` si otro ticket de la organización ya usa ese teléfono (no hay fusión), también si la carrera la pierde contra el índice único; quitar `no_wpp_number`; y, en la misma transacción, copiar el nombre a los pedidos del ticket cuyo nombre sea distinto y el teléfono **solo** a los pedidos cuyo `customer_phone` sea aún el teléfono viejo, dejando historial "Actualizado desde el chat (Chats WPP)". Emite `order:updated` por cada pedido. *(plataforma, código)*

*Interfaz del chat*

- **RN-INB-27 — Encabezado unificado.** `TicketModal`, `DetallePedidoModal` y `NuevoPedidoModal` DEBEN mostrar el chat en una columna de **660 px** con la misma fila de botones en este orden: Cuenta banco, Formulario, Bloquear Link, Eliminar datos (solo `dev`), Catálogo, Tomar lista (admin, encargado, dev). En celular la fila se vuelve un menú hamburguesa. Cuenta banco, Formulario, Bloquear Link y Catálogo se deshabilitan si el día es anterior o la caja está cerrada (`isPastDay`), solo en la interfaz: la API no lo exige. Commits `1dce1d6` y `39d96a3` (2026-10-06). *(plataforma, código)*
- **RN-INB-28 — Desplazamiento.** `useChatScroll` carga los anteriores al pedirlo sin saltar de posición, solo sigue al final si el usuario ya estaba abajo, y cuenta "N mensajes nuevos" si hay mensajes nuevos mientras lee arriba. Lo comparten los cuatro chats. *(plataforma, código)*
- **RN-INB-29 — Cómo se muestra un teléfono.** Siempre la web muestra el teléfono con `lib/formatPhone.ts › formatPhoneDisplay`: si son 12 dígitos que empiezan por 57 quita el 57 (el personal no marca el indicativo); cualquier otra forma se deja igual; un BSUID (`CC.` + alfanuméricos) o un relleno `no-<hex>` nunca son números reales y se muestran como "Sin teléfono" (`looksFake`). Lo usan el tablero, la bandeja, los modales, el reenvío, el cierre y el PDF de la factura. El almacenamiento no cambia (`Ticket.phone` guarda el valor tal cual llegó). *(plataforma, código)*
- **RN-INB-30 — Fotos desde el navegador.** `lib/fileToBase64.ts` fija el tope de la foto de chat en 5 MiB y los tipos `image/jpeg`, `image/png` e `image/webp` (iguales a los de `inbox.ts`, RN-INB-11; es una de las constantes duplicadas de DT-016) y entrega el archivo como base64 sin el prefijo `data:`, que es lo que espera la API. *(plataforma, código)*
- **RN-INB-31 — Cómo se ve cada tipo de mensaje.** La imagen, el audio y el video se piden con el token de sesión a `GET /inbox/media/:token` al montarse y se muestran desde un enlace local temporal; la imagen se amplía dentro de la aplicación al tocarla. El documento solo se pide al hacer clic y se abre en una pestaña nueva (se libera a los 60 s). La ubicación es un enlace directo a Google Maps ("Ver ubicación"). Si la carga falla, el texto es "No se pudo cargar la imagen/audio/video" o "No se pudo abrir el documento". Las marcas de entrega (`DeliveryStatus`): una marca "Enviado"; doble gris "Entregado"; doble azul "Leído"; icono rojo con el motivo si `failed_reason`. *(plataforma, código)*

**Criterios de aceptación.**

1. *Dado* un encargado y una organización con chats, *cuando* pide la lista de destinos de reenvío, *entonces* recibe solo los chats de su organización con id, nombre y teléfono; al pedir `GET /inbox` recibe 403. (RN-INB-01, 03; `inbox.test.ts › "an encargado (not just admin) gets the real chat list, unlike GET /inbox which is admin-only"` y `› "never returns another organization's chats"`)
2. *Dado* un chat con mensajes sin contestar, *cuando* el personal lo abre varias veces, *entonces* `unread_count` no cambia; solo baja a 0 al responder. (RN-INB-08, 09; `inbox.test.ts › "the \"sin leer\" dot survives opening the chat any number of times - it only clears once staff actually replies"`)
3. *Dado* un ticket de una fecha con varios pedidos, *cuando* se abre el chat con `?fecha=`, *entonces* se adjuntan solo los pedidos de esa fecha. (RN-INB-06; `inbox.test.ts › "GET /:ticketId/messages?fecha=X only returns that day's order, not every order this ticket ever had"`)
4. *Dado* una organización con credenciales, *cuando* el personal responde por texto, *entonces* recibe 201 de inmediato y el mensaje queda con el id de Meta; si Meta rechaza el envío, el mensaje queda con `failed_reason`. (RN-INB-10; `inbox.test.ts › "POST /:ticketId/reply stores the real Meta message id - …"` y `› "POST /:ticketId/reply records failed_reason when Meta rejects the send …"`)
5. *Dado* una imagen cuyo contenido real no coincide con su tipo declarado, *cuando* se envía, *entonces* se rechaza con 400 antes de subir nada a Meta. (RN-INB-12; `inbox.test.ts › "POST /:ticketId/send-image rejects a file whose real bytes don't match the declared mime_type - never trusts the label alone"`)
6. *Dado* un `media_id` que pertenece a otra organización, *cuando* se pide `GET /inbox/media/:token`, *entonces* responde 404. (RN-INB-17; `inbox.test.ts › "GET /media/:token refuses a real media_id that belongs to a DIFFERENT org, …"`)
7. *Dado* un mensaje, *cuando* se intenta reenviar solo a su propio chat, *entonces* se rechaza con 400 y nada se envía. (RN-INB-15; `inbox.test.ts › "rejects forwarding a message to its own chat, even if it's the only target"`)
8. *Dado* un link de formulario ya enviado, *cuando* el personal genera uno nuevo, *entonces* el anterior deja de funcionar. (RN-INB-18; `public.test.ts › "sending a fresh form-link automatically supersedes (kills) every earlier still-unexpired link for the same ticket, …"`)
9. *Dado* un link vigente, *cuando* el personal pulsa "Bloquear Link", *entonces* el token se rechaza en todas las rutas públicas y se revocan las facturas del ticket. (RN-INB-19; `public.test.ts › "after revoking, the previously-issued token is rejected on every public endpoint (fails closed)"` y `files.test.ts › ""Bloquear link" on a ticket also kills any factura already sent to that same conversation"`)
10. *Dado* un ticket con pedidos y chat, *cuando* un admin pide borrar los datos recibe 403; *cuando* lo hace `dev`, *entonces* los pedidos quedan anonimizados sin borrarse, el chat se borra y el ticket se anonimiza. (RN-INB-22; `inbox.test.ts › "rejects an admin (no dev) with 403 - …"` y `› "anonimiza TODOS los pedidos del ticket (sea cual sea su estado) sin borrar ninguno, …"`)

**Textos que ve el cliente final.** Lo que escribe el personal tal cual; el formulario (advertencia, link, seguimiento) y la cuenta bancaria salen de las plantillas editables de la organización (`Organization.message_templates`). El link pasa a ser inválido para el cliente según RN-INB-18 a 20 (mensaje genérico "Link inválido o expirado").

## 2. Técnico

**Mapa de código.**

| Parte | Dónde |
|---|---|
| API bandeja | `apps/api/src/routes/inbox.ts › GET /`, `› GET /forward-targets`, `› GET /search` |
| API chat | `inbox.ts › GET /:ticketId/messages`, `› GET /:ticketId/messages/older`, `› POST /:ticketId/reply` |
| API multimedia | `inbox.ts › POST /:ticketId/send-image`, `› send-audio`, `› send-video`, `› send-document`, `› trackOutboundMediaSend`, `› markForwardFailed`, `› GET /media/:token`; `apps/api/src/lib/media.ts` |
| API reenvío | `inbox.ts › POST /messages/:messageId/forward` |
| API link | `inbox.ts › GET /:ticketId/form-link`, `› POST /:ticketId/form-link/revoke`, `› POST /form-links/block-all`; `apps/api/src/lib/formLink.ts › generateFormLinkUrl`; `apps/api/src/lib/linkSecurity.ts` |
| API borrado | `inbox.ts › POST /:ticketId/erase-data` |
| API tickets | `apps/api/src/routes/tickets.ts › GET /`, `› POST /`, `› PATCH /:id` |
| Web | `apps/web/src/components/inbox/InboxPanel.tsx`; `components/modals/TicketModal.tsx`; `ui/ForwardMessageModal.tsx`; `ui/ChatImage.tsx`, `ChatAudio.tsx`, `ChatVideo.tsx`, `ChatDocument.tsx`, `ChatLocation.tsx`; `ui/DeliveryStatus.tsx`; `hooks/useChatScroll.ts`, `useSendChatMedia.ts`, `useChatMediaBlob.ts`; `styles/global.css › .tk-modal-chat` |
| Datos | `Ticket`, `TicketMessage`, `RevokedFormToken`, `FormLinkSession`, `InvoiceLink`, `Order`, `OrderHistory`, `AuditLog`; trigger `trg_bump_ticket_last_activity` |

**Regla → dónde se hace cumplir → test.** Rutas abreviadas al archivo; el mapa de arriba tiene la completa. Los títulos largos se cortan con "…".

| Regla | Se hace cumplir en | Test |
|---|---|---|
| RN-INB-01 | `inbox.ts › GET /` | `inbox.test.ts › "an encargado (not just admin) gets the real chat list, unlike GET /inbox which is admin-only"` |
| RN-INB-02 | migración `20260802000000_ticket_last_activity` | *(sin test)* |
| RN-INB-03 | `inbox.ts › GET /forward-targets` | `apps/api/test/inbox.test.ts › "an encargado (not just admin) gets the real chat list, unlike GET /inbox which is admin-only"`; `› "never returns another organization's chats"` |
| RN-INB-04 | `inbox.ts › GET /search` | *(sin test)* |
| RN-INB-05 | `inbox.ts › GET /:ticketId/messages` | *(sin test del tope de 500)* |
| RN-INB-06 | `inbox.ts › GET /:ticketId/messages` | `inbox.test.ts › "GET /:ticketId/messages?fecha=X only returns that day's order, not every order this ticket ever had"` |
| RN-INB-07 | `inbox.ts › GET /:ticketId/messages/older` | *(sin test)* |
| RN-INB-08 | `inbox.ts › GET /:ticketId/messages` | `inbox.test.ts › "the "sin leer" dot survives opening the chat any number of times - it only clears once staff actually replies"` |
| RN-INB-09 | `inbox.ts › POST /:ticketId/reply`, `› send-*`, `› forward` | el de RN-INB-08 (solo respuesta de texto; multimedia y reenvío, *sin test*) |
| RN-INB-10 | `inbox.ts › POST /:ticketId/reply` | `inbox.test.ts › "POST /:ticketId/reply stores the real Meta message id - …"`; `› "POST /:ticketId/reply broadcasts ticket:message-status on a SUCCESSFUL send too, …"`; `› "POST /:ticketId/reply records failed_reason when Meta rejects the send (e.g. no active 24h session …"` |
| RN-INB-11 | `inbox.ts › send-image/audio/video/document` | `inbox.test.ts › "POST /:ticketId/send-document rejects a missing filename"` (tamaños y tipos, *sin test*) |
| RN-INB-12 | `lib/media.ts › detectImageMime`, `› detectMediaMime` | `inbox.test.ts › "POST /:ticketId/send-image rejects a file whose real bytes don't match the declared mime_type - never trusts the label alone"` |
| RN-INB-13 | `inbox.ts › send-*` | `inbox.test.ts › "POST /:ticketId/send-image uploads to Meta FIRST (media_url is Meta's own media_id, …"`; `› "POST /:ticketId/send-audio stores and sends a voice note - …"`; `› "POST /:ticketId/send-document stores the filename (in media_caption, …"` (422 y 502, *sin test*) |
| RN-INB-14 | `inbox.ts` (`config.rateLimit`) | *(sin test)* |
| RN-INB-15 | `inbox.ts › POST /messages/:messageId/forward` | `inbox.test.ts › "POST /messages/:messageId/forward sends a text message to another chat and tracks delivery normally"`; `› "rejects forwarding a message to its own chat, even if it's the only target"`; `› "reports a target ticket from another org as failed/missing, …"` |
| RN-INB-16 | `inbox.ts › markForwardFailed` | `inbox.test.ts › "marks a forwarded PHOTO failed_reason immediately when the original has expired on Meta (>30 days) - …"`; `› "marks a forward failed_reason immediately when the organization has no WhatsApp credentials configured"` |
| RN-INB-17 | `inbox.ts › GET /media/:token` | `inbox.test.ts › "GET /media/:token rejects a malformed id and a well-formed (numeric) but never-issued one"`; `› "GET /media/:token refuses a real media_id that belongs to a DIFFERENT org, …"`; `› "GET /media/:token never serves bytes Meta returns that don't actually match a real image signature, …"`; `› "GET /media/:token returns a clear MEDIA_EXPIRED 404 when Meta no longer has the file …"` |
| RN-INB-18 | `lib/formLink.ts › generateFormLinkUrl` | `apps/api/test/public.test.ts › "GET /inbox/:ticketId/form-link embeds who sent it and is a short opaque token, not a long JWT"`; `› "generating a fresh form-link clears the earlier revocation, so the new link works"`; `› "sending a fresh form-link automatically supersedes (kills) every earlier still-unexpired link for the same ticket, …"` |
| RN-INB-19 | `inbox.ts › POST /:ticketId/form-link/revoke` | `public.test.ts › "after revoking, the previously-issued token is rejected on every public endpoint (fails closed)"`; `apps/api/test/files.test.ts › ""Bloquear link" on a ticket also kills any factura already sent to that same conversation"` |
| RN-INB-20 | `inbox.ts › POST /form-links/block-all` | `public.test.ts › "blocks every outstanding link across every ticket in the org at once, and a link issued afterward still works"`; `files.test.ts › "the org-wide "Bloquear todos los links" also kills every outstanding factura, …"` |
| RN-INB-21 | `lib/linkSecurity.ts`; `public.ts › loadTicketByFormToken` | *(sin test; código muerto)* |
| RN-INB-22 | `inbox.ts › POST /:ticketId/erase-data` | `inbox.test.ts › "rejects an admin (no dev) with 403 - …"`; `› "rejects a non-dev (encargado) with 403"`; `› "404s for a ticket that does not exist or belongs to another org"`; `› "anonimiza TODOS los pedidos del ticket (sea cual sea su estado) sin borrar ninguno, …"` |
| RN-INB-23 | `tickets.ts › GET /` | *(sin test del OR ni de los 50 mensajes)* |
| RN-INB-24 | `tickets.ts › GET /` | `apps/api/test/tickets.test.ts › "a returning customer (old created_at, fresh first_message_today_at) sorts by when they FIRST wrote TODAY, not by when their ticket was first created"`; `› "a ticket that already wrote earlier today stays ahead of a newer arrival, even after writing AGAIN later"` (nulos primero, *sin test*) |
| RN-INB-25 | `tickets.ts › POST /`; `lib/businessDate.ts › businessDateForInstant` | *(sin test)* |
| RN-INB-26 | `tickets.ts › PATCH /:id` | *(sin test)* |
| RN-INB-27 | `TicketModal.tsx`, `DetallePedidoModal.tsx`, `NuevoPedidoModal.tsx`; `global.css › .tk-modal-chat` | *(sin test)* |
| RN-INB-28 | `hooks/useChatScroll.ts` | *(sin test)* |
| RN-INB-29 | `apps/web/src/lib/formatPhone.ts › formatPhoneDisplay`, `› looksFake` | *(sin test)* |
| RN-INB-30 | `apps/web/src/lib/fileToBase64.ts` | *(sin test)* |
| RN-INB-31 | `ui/ChatImage.tsx`, `ChatAudio.tsx`, `ChatVideo.tsx`, `ChatDocument.tsx`, `ChatLocation.tsx`, `DeliveryStatus.tsx` | *(sin test)* |

**Datos y eventos socket** (sala `org:<orgId>`):

| Evento | Quién lo emite | Qué hace la web |
|---|---|---|
| `ticket:message` `{ ticketId, message }` | respuesta, multimedia, reenvío (por destino); webhook | `InboxPanel` y `MainPage` refrescan bandeja y chat abierto |
| `ticket:message-status` `{ ticketId, messageId, delivered, read_by_client, failed_reason }` | cierre del envío en segundo plano; webhook | refresca el chat abierto |
| `ticket:unread` `{ ticketId, count }` | respuesta, multimedia, reenvío; webhook | `MainPage` refresca tablero, bandeja e informe |
| `order:updated` `{ id }` | `PATCH /tickets/:id` | refresca pedidos |

Respaldo: la bandeja y el chat abierto se refrescan solos cada 60 s por si falla el socket. Todo se invalida con claves de React Query (`inbox`, `inbox-convo`, `inbox-search`, `inbox-forward-targets`, `tickets`).

**Transacciones y concurrencia.**
- Responder y multimedia **no** usan transacción: crear el mensaje, resetear no leídos y el envío a Meta son pasos separados; el estado final del envío lo escribe un `.then/.catch` suelto (si el servidor se reinicia en medio, la fila queda sin `wpp_message_id` ni `failed_reason`).
- `erase-data` y `PATCH /tickets/:id` sí van en una transacción. `PATCH` hace además una comprobación previa de colisión y traduce el error `P2002` del índice único a 409 `PHONE_TAKEN`.
- Reenviar procesa los destinos **en serie** con una sola descarga del original.

**Códigos de error propios.**

| Código | HTTP | Cuándo |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Cuerpo, query o archivo inválido (también "Elige un chat distinto al actual") |
| `NOT_FOUND` | 404 | Chat, mensaje o ticket inexistente o de otra organización; `media_id` ajeno o sin credenciales de la organización |
| `NO_WPP_CREDENTIALS` | 422 | Enviar multimedia sin credenciales de Meta |
| `WPP_UPLOAD_FAILED` | 502 | Meta rechazó la subida |
| `MEDIA_EXPIRED` | 404 | Meta ya no tiene el archivo (30 días) |
| `PHONE_TAKEN` | 409 | `PATCH /tickets/:id` con un teléfono de otro ticket |

**Si tocas X, revisa Y.**
- **`generateFormLinkUrl`** lo usa solo `GET /form-link` (el webhook ya no genera links, RN-WPP-15); cambiar los campos que reinicia rompe el "reemplaza el anterior" de `public.ts › loadTicketByFormToken` (`modulos/FRM.md`).
- **Tipos y tamaños de multimedia:** están en `inbox.ts` (constantes `MAX_*_BYTES` y `z.enum`), en `lib/media.ts` y duplicados en `useSendChatMedia.ts › MEDIA_KINDS`.
- **El reenvío** reutiliza `media_url`: si alguna vez se guarda multimedia propia, `GET /media/:token` y el reenvío deben cambiar juntos.
- **El gate de la bandeja** está en `inbox.ts › GET /`, en `MainPage.tsx` (`enabled: isAdmin`) y en `actores-y-permisos.md`.
- **Texto de los tres mensajes del formulario y de "Cuenta banco":** viven en `Organization.message_templates`, no aquí.
- **Una ruta nueva que inserte `TicketMessage`** no necesita tocar `last_activity_at` (lo hace el trigger).
- **Mover pedidos entre tickets** no existe: por eso `PATCH /tickets/:id` rechaza la fusión.

## 3. Pendientes

IDs globales; resumen en `03-plan/preguntas-abiertas.md` y `03-plan/problemas-conocidos.md`.

- **PREG-035 — Escalera de bloqueo inerte.** `registerFailedLinkAttempt` nunca se llama y `device_token` no se compara con nada (ver RN-INB-21); los comentarios de `linkSecurity.ts` y `formLink.ts` (sesión de dispositivo, `clearSoftLinkBlock`) describen un comportamiento que ya no existe. ¿Se elimina el código y las columnas, o se restablece la protección con otro mecanismo (por ejemplo límite de aperturas por link)?
- **PREG-036 — `POST /tickets` sin uso.** Ninguna pantalla lo llama y no tiene test. Además mezcla dos días distintos (día de negocio al crear, hoy real al reabrir). ¿Se borra o se conserva para alguna integración?
- **PREG-037 — Borrado de datos incompleto.** `erase-data` deja datos personales en `order_history` (valores de campos nombre, teléfono y dirección editados), en `OrderObservation`, en `Order.notes` y en los PDF de factura de R2 (solo revoca el link). El comentario de la ruta lo documenta como límite aceptado. ¿Se acepta ante la Ley 1581 o se relaja la inmutabilidad / se borran los PDF para este caso?
- **PREG-038 — Reenvío con archivo vencido crea fila fallida.** El destino recibe una fila con `failed_reason` ("ya no está disponible"), `forwarded` la cuenta como reenviada y `failed` solo lista destinos inexistentes. ¿Debe el contador o la respuesta distinguir los envíos que nunca salieron, o abortar todo si el original ya venció?
- **PREG-039 — Bandeja limitada a 500 sin paginación.** Un negocio con más de 500 chats activos no ve los más viejos en la lista (sí los encuentra la búsqueda, que devuelve máx. 50). `page` es un parámetro aceptado e ignorado. ¿Es suficiente?
- **PREG-040 — Encargado sin bandeja pero con todo el chat.** Por decisión (`dbc9633`) el encargado no ve "Chats WPP", pero desde el ticket puede leer los últimos 500 mensajes de cualquier chat de la organización, responder, reenviar a cualquiera (`forward-targets`) y bloquear links. ¿Es el alcance buscado? Lo mismo para el domiciliario.
- **PREG-041 — No leídos se borran antes de saber si Meta aceptó.** Responder (y enviar multimedia o recibir un reenvío) pone `unread_count = 0` aunque el envío falle después con `failed_reason` (por ejemplo, fuera de la ventana de 24 h). El chat queda "atendido" sin que el cliente haya recibido nada. ¿Se mantiene?
- **PREG-030 — Los días anteriores solo se bloquean en la interfaz.** Los botones Formulario/Cuenta banco se deshabilitan en días pasados o con caja cerrada (`isPastDay`), pero la API genera links y envía mensajes siempre. ¿Debe la API aplicar la misma regla?
- **DT-012 — Código muerto de seguridad de links.** `registerFailedLinkAttempt`, `MAX_ATTEMPTS_HARD`, `TICKET_BLOCK_HOURS`, columnas `link_failed_total` / `link_blocked_until`, modelo `FormLinkSession` y los parámetros `device_token` de las rutas públicas (ver PREG-035).
- **DT-013 — Rama muerta en la web.** `InboxPanel.tsx` y `useSendChatMedia.ts` comprueban `wpp_status === 'failed'` y `wpp_error`; la API solo devuelve `sending` o `no_credentials`, así que ese aviso nunca sale. Un fallo se ve solo por `ticket:message-status`.
- **DT-014 — Quitar duplicados por teléfono es redundante.** `GET /inbox`, `/forward-targets` y `GET /tickets` filtran teléfonos repetidos, pero `Ticket` es único por `(org_id, phone)` (principio 8).
- **DT-015 — Faltan tests.** Sin test: lista de 500, búsqueda, tope y cursor de mensajes, tamaños y tipos de multimedia, 422/502, límites de frecuencia, reenvío de archivos, `GET /tickets` (OR de fechas, 50 mensajes, nulos primero), `POST /tickets`, `PATCH /tickets/:id` (propagación a pedidos, `PHONE_TAKEN`), `GET /form-link` desde la interfaz del personal (solo se prueba vía formulario), y rastro de privacidad de `erase-data` más allá del caso base.
- **DT-016 — Constantes de multimedia duplicadas** entre `inbox.ts`, `lib/media.ts` y `useSendChatMedia.ts`.

Decisiones relacionadas: principios 4, 6 y 8 de `00-principios.md`. Decisión candidata a registrar: "Chats WPP solo admin/dev" (commits `6e18c76` y `dbc9633`, 2026-08-02).
