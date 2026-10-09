---
estado: vigente
verificado: 2026-10-09 @ 2cbd083
fuentes: [apps/api/src/routes/public.ts, apps/api/src/lib/formLink.ts, apps/api/src/lib/linkSecurity.ts, apps/api/src/lib/businessDate.ts, apps/web/src/pages/ClientFormPage.tsx, apps/web/public/legal/politica-privacidad.html, apps/api/test/public.test.ts]
---

# FRM — Formulario público del cliente

> Página pública (`/form?t=…`) donde el cliente final arma, edita o borra su pedido del día con un link temporal, sin cuenta. Crea y modifica pedidos con precios en $0 para que el encargado los revise. Lo usa el cliente final; el personal solo ve el resultado en el tablero.

## 1. Negocio

**Propósito.** Que el cliente entregue su pedido (productos, dirección, método de pago) sin que el encargado lo transcriba del chat. El formulario nunca fija precios y nunca toca pedidos que armó el personal: todo lo que el cliente agrega o cambia queda marcado para que el encargado lo vea y le ponga precio.

**Permisos.** Es la fila "Cliente final" de `01-funcional/actores-y-permisos.md`: sin cuenta, solo sirve para su propio ticket. Emitir, revocar y bloquear links es de **INB** (aquí solo se describe lo que el formulario comprueba). La acción del cliente se atribuye en el historial al empleado que mandó el link (RN-FRM-19).

**Estados / ciclo de vida.** El cliente solo puede editar o borrar un pedido con `source = 'form'`, estado `nuevo`/`preparando`/`listo` y sin bloquear. Un pedido `camino` se ve pero es de solo lectura; `cerrado` y `papelera` ni se listan.

**Reglas.**

*A. El link y sus endpoints*

- **RN-FRM-01 — Un link muerto responde siempre igual.** CUANDO el token no existe en ningún ticket (incluye los reemplazados por un link más nuevo), está revocado, la organización los bloqueó después de emitirlo o pasaron más de 24 h, el sistema DEBE responder 401 `INVALID_TOKEN` "Link inválido o expirado", sin decir cuál de las causas fue. Aplica a los cuatro GET y a los dos POST (en los POST, un cuerpo mal formado responde 400 `VALIDATION_ERROR` antes de mirar el link). *Por qué:* no darle pistas a quien adivina *(inferido)*. *(plataforma, código)*
- **RN-FRM-02 — Vida de 24 h planas.** El link vive 24 h exactas desde `form_token_min_iat` (su emisión), se abra o no; abrirlo no lo renueva. *Por qué:* el esquema anterior (4 h sin abrir / 24 h abierto) hacía que un cliente que no vio el aviso a tiempo creyera que "el link no abre" *(inferido, comentario del código)*. Un ticket sin `form_token_min_iat` nunca vence por edad. *(plataforma, código)*
- **RN-FRM-03 — Bloqueo por intentos fallidos (latente).** CUANDO `link_blocked_until` está en el futuro responde 403 `TICKET_BLOCKED`, y CUANDO `link_failed_attempts` ≥ 10 responde 403 `LINK_ATTEMPTS_EXCEEDED`. Hoy nada incrementa esos contadores (ver DT-012), así que solo se disparan con valores ya guardados. `clearSoftLinkBlock` y emitir un link nuevo ponen el contador suave en 0. *(plataforma, código)*
- **RN-FRM-04 — `link-status`.** `GET /link-status?t=` solo pide el token (no `device_token`) y responde `{ valid: true }` o el mismo error de RN-FRM-01/03. La página lo llama primero para no mostrar el catálogo de un link muerto. *(plataforma, código)*
- **RN-FRM-05 — `form-info`.** CUANDO el link está vivo, el sistema DEBE devolver nombre del cliente, nombre del negocio y hasta 20 pedidos **de hoy (Bogotá)**, ordenados del más nuevo al más viejo, excluyendo `cerrado`, `papelera` y `client_deleted`. Marca `form_link_opened_at` la primera vez (solo informativo). La dirección "Pendiente de confirmar" y el método `sin_asignar` salen como cadena vacía. `editable` es verdadero solo si `source === 'form'` y el estado es `nuevo`/`preparando`/`listo`. Un pedido del personal se ve pero nunca es editable, porque el cliente podría pisar precios puestos a mano. *(plataforma, código)*
- **RN-FRM-06 — Catálogo sin precios.** `GET /products` devuelve los productos activos de la organización con `id`, `name`, `category`, `unit_type` y `sort_order`; nunca precio. Ordenado con `sortByCategoryOrder`. No envía `in_stock`: un producto agotado se puede pedir igual (PREG-052). *(plataforma, código)*
- **RN-FRM-07 — Repetir mi último pedido.** `GET /last-order` devuelve `null` o los `product_name`/`quantity_label` del pedido más reciente por `created_at` que sea de un día anterior, o de hoy pero `cerrado`; excluye `papelera` y `client_deleted`. Cada ítem trae `available`, verdadero si ese nombre sigue en el catálogo activo; la página carga solo los disponibles. No copia precio, dirección ni método de pago (pueden estar vencidos). Un pedido de hoy aún abierto no cuenta: ese se edita, no se repite. *(plataforma, código)*

*B. Enviar el pedido (`POST /submit`)*

- **RN-FRM-08 — Validación del cuerpo.** `address` es obligatoria (recortada, 1–500); `payment_method` es opcional y solo `cash`, `transfer` o `cod` (nunca `credito`, ver CAJ); `items` tiene de 1 a 100 líneas, con `product_name` de 1–200 y `quantity_label` de hasta 100 caracteres. `device_token` es obligatorio en el cuerpo pero no se usa para decidir nada (PREG-035). Si falla: 400 `VALIDATION_ERROR`. *(plataforma, código)*
- **RN-FRM-09 — Límite de envíos por IP.** Máximo 15 envíos por minuto por IP (`req.ip`), también para el borrado. La clave es la IP y no el token porque el cliente controla el token y rotarlo evadía el límite. *Por qué:* hallazgo de auditoría de seguridad *(código, inferido)*. Reemplaza el límite global. *(plataforma, código)* *(sin test)*
- **RN-FRM-10 — Consentimiento en cada envío.** CUANDO `consent` no es exactamente `true`, el sistema DEBE responder 400 `CONSENT_REQUIRED`, aunque el ticket ya haya consentido antes. Cada envío (nuevo o edición) guarda en el pedido `consent_confirmed_at` y `privacy_policy_version = 'v1'`. `Ticket.consent_given_at` (con la versión) se escribe solo la primera vez y no vuelve a tocarse. *Por qué:* en la web no hay forma de probar quién está detrás de cada envío, así que cada pedido lleva su propia prueba (Ley 1581; principio 6) *(código, inferido)*. El chequeo ocurre después de validar el link y antes de crear nada. *(plataforma, código)*
- **RN-FRM-11 — Todo ítem nuevo entra en $0.** Siempre `price = 0` para una línea nueva, sin consultar `price_per_unit`: decisión explícita del negocio (el precio de catálogo es referencia, no el real del día). `is_manual: true` (producto escrito a mano, fuera del catálogo) marca la línea `added_by_client`. *(plataforma, código)*
- **RN-FRM-12 — Sin usuario activo no hay pedido.** CUANDO no se puede resolver un usuario para atribuir la acción, responde 500 `NO_USER` "Organización sin usuarios activos" (en `POST /submit`, ya después de validar el consentimiento, y también en el borrado). *(plataforma, código)* *(sin test)*

*C. Editar un pedido (con `merge_order_id`)*

- **RN-FRM-13 — Quién puede ser objetivo.** El pedido se busca por `id`, ticket y organización. Si no existe: 404 `NOT_FOUND`. Si `source !== 'form'`, si `client_deleted`, o si el estado no es editable o está bloqueado: 409 `ORDER_NOT_EDITABLE` con mensaje al cliente que nombra el número y el estado ("en camino", "cerrado", "cancelado"). Nunca cae a crear un pedido nuevo: hacerlo duplicaría todo el pedido, porque la página manda la lista completa. *(plataforma, código)*
- **RN-FRM-14 — La lista enviada reemplaza los ítems.** CUANDO se edita, la lista enviada ES el pedido: los ítems que el cliente quitó se borran. Un ítem que ya existía (mismo `product_name`) conserva su precio siempre; uno nuevo entra en $0. `added_by_client` queda en verdadero si el ítem es nuevo o cambió su `quantity_label`, y una vez en verdadero no se apaga. *(plataforma, código)*
- **RN-FRM-15 — Sin cambios, sin ruido.** CUANDO no cambió ningún ítem, ni la dirección, ni el método de pago, el sistema DEBE responder 200 con `unchanged: true` sin tocar `client_modified`, sin historial, sin WhatsApp y sin evento de socket. Un `payment_method` ausente en la edición no cuenta como cambio. *(plataforma, código)*
- **RN-FRM-16 — Efectos de una edición real.** CUANDO hay cambios, el sistema DEBE: marcar `client_modified = true` (permanente; guardar del personal no lo limpia), actualizar `consent_confirmed_at`/versión, escribir historial por ítem quitado/agregado/modificado y por dirección y método de pago, con la nota "Vía formulario del cliente (enviado por <quien>)", revocar las facturas (`InvoiceLink`) vigentes del pedido, mandar por WhatsApp "Tu pedido #N fue actualizado" y emitir `order:updated`. *(plataforma, código)*
- **RN-FRM-17 — Pregunta de pago.** CUANDO la edición no trae `payment_method` y el pedido sigue en `sin_asignar`, el sistema DEBE mandar además "¿Efectivo o transferencia?". No se repite si el pedido ya tenía método. *(plataforma, código)*

*D. Crear un pedido nuevo*

- **RN-FRM-18 — Pasa a mañana si hoy ya cerró.** CUANDO ya existe `DailyClose` para hoy (Bogotá), el pedido nuevo DEBE crearse con `fecha` de mañana y el ticket DEBE moverse con él (`fecha` = mañana, `deferred_to` = null). *Por qué:* un pedido en un día ya reconciliado quedaría sin que nadie lo decida; es lo mismo que hace el cierre con un pendiente. Dueño de la regla: FRM; el congelamiento del día cerrado es de **CAJ**. Solo aplica a pedidos nuevos: la edición de un pedido existente no consulta el cierre (queda cubierta porque el cierre bloquea o pasa a mañana todo pendiente). *(plataforma, código)*
- **RN-FRM-19 — Atribución.** `registered_by` y el actor del historial son el empleado que mandó el link (`form_link_sent_by`) o, si no hay, el primer admin/encargado activo más antiguo. En este segundo caso (envío automático del link, que hoy ya no existe: el link solo lo manda el personal (RN-WPP-15); el código y su test se conservan) el texto dice "el sistema (formulario enviado automáticamente)" y el mensaje de chat queda con `sent_by` null para no atribuir nada a una persona real. *(plataforma, código)*
- **RN-FRM-20 — Máximo 3 pedidos del formulario por ticket y día.** CUANDO el ticket ya tiene 3 pedidos `source = 'form'` con la misma `fecha`, el sistema DEBE responder 429 `FORM_LIMIT_REACHED`. El conteo y la creación van en una transacción con un lock asesor por ticket (`pg_advisory_xact_lock`, semilla 1), así que dos envíos simultáneos no pueden pasar el tope. Los pedidos de días anteriores no cuentan. No aplica a ediciones. *(plataforma, código)*
- **RN-FRM-21 — Forma del pedido nuevo.** Estado `nuevo`, `source = 'form'`, `channel = 'whatsapp'`, método `sin_asignar` si no se eligió, nombre y teléfono tomados del ticket (el cliente no los escribe), número por `createOrderWithRetryNum` (numeración: **ORD**). Historial: una fila `create` ("Pedido creado desde formulario") más un `producto_agregado` por ítem. Emite `order:created`. Responde 201. *(plataforma, código)*
- **RN-FRM-22 — Mensaje de confirmación.** El sistema DEBE guardar y enviar por WhatsApp "Pedido #N recibido desde el formulario" con productos, fecha larga, dirección y método ("En tienda", "Transferencia", "Cobro en casa" o "Sin especificar"). Los textos del cliente pasan por `sanitizeForWhatsApp`. Si no se eligió método, sigue "¿Efectivo o transferencia?". No toca `last_message_at`: no es un mensaje entrante y no debe reordenar el tablero. Si Meta falla, queda `failed_reason`; si la organización no tiene credenciales, solo se guarda. *(plataforma, código)*
- **RN-FRM-23 — Tope de mensajes automáticos.** Antes de enviar la confirmación el sistema cuenta los mensajes `out` del ticket de las últimas 24 h con `sent_by` null; con 30 o más no envía y guarda `failed_reason` "Límite diario de confirmaciones automáticas alcanzado". Como cuando un empleado mandó el link la confirmación lleva su `sent_by`, el tope solo puede dispararse en tickets con link automático (PREG-054). No limita la pregunta de pago. *(plataforma, código)* *(sin test)*

*E. Borrado por el cliente*

- **RN-FRM-24 — Borrar su pedido.** `POST /order/:orderId/delete` (cuerpo `token` + `device_token`) solo borra un pedido propio con `source = 'form'`, estado `nuevo`/`preparando`/`listo` y sin bloquear. 404 `NOT_FOUND` si no es de su ticket; 400 `ALREADY_DELETED` si ya estaba borrado; 400 `NOT_EDITABLE` en cualquier otro caso. *(plataforma, código)*
- **RN-FRM-25 — Qué hace el borrado.** Pone `client_deleted = true` y `client_modified = true` **sin cambiar el estado** (no es `papelera`: el pedido sigue en su columna, señalado en rojo), revoca las facturas vigentes y escribe historial `eliminado_cliente` ("Vía formulario del cliente"), todo en una transacción. Emite `order:updated`. El personal decide: **Restaurar** (limpia la marca) o dejarlo borrado. *(plataforma, código)*

**Textos que ve el cliente final.** Pantalla de consentimiento ("Antes de continuar") con casilla y enlace a la política; errores de link (RN-FRM-01/03); errores de edición con el número de pedido (RN-FRM-13); confirmaciones por WhatsApp (RN-FRM-16, 22); "¿Efectivo o transferencia?" (RN-FRM-17).

### Comportamiento de la página (`ClientFormPage`)

- **RN-FRM-26 — Consentimiento primero y en cada envío.** CUANDO el estado es catálogo y la casilla no está marcada, la página DEBE mostrar solo la pantalla "Antes de continuar" (casilla + enlace). Marcarla revela el formulario; tras cada envío exitoso se desmarca, así que volver a editar la pide otra vez. Al enviar también se revalida. *(plataforma, código)*
- **RN-FRM-27 — Enlace a la política.** La casilla enlaza a `/legal/politica-privacidad` (relativo, mismo dominio de la web), servida desde `apps/web/public/legal/politica-privacidad.html`. El aviso en el chat usa `lib/formLink.ts › buildPrivacyNoticeMessage`, con la URL armada desde el primer `FRONTEND_URL` + la misma ruta (sin `.html`, porque Cloudflare Pages redirige y sería un salto extra dentro de WhatsApp). El texto de la política nombra a un solo negocio; hay una única política y una única versión (`PRIVACY_POLICY_VERSION = 'v1'`, subida a mano al cambiar el texto) para todas las organizaciones (DT-002). *(plataforma, código)*
- **RN-FRM-28 — Unidades y cantidades.** Cada producto se agrega con cantidad y unidad (Kilo, Libra, Unidad, Paquete, Bulto, Bandeja, Canasta, "Pesos $"; Kilo por defecto) y se guarda como texto libre en `quantity_label`. El cliente puede añadir un producto que no está en el catálogo; viaja con `is_manual: true` (RN-FRM-11). *(plataforma, código)*
- **RN-FRM-29 — Se edita el primer pedido editable.** CUANDO el cliente entra, la página DEBE apuntar al primer pedido con `editable = true` de `form-info` y precargar sus ítems, dirección y método; si no hay ninguno, empieza un pedido nuevo. No hay menú para elegir. El método de pago viaja solo si el cliente lo eligió. *(plataforma, código)*
- **RN-FRM-30 — Borrador local de 24 h.** La página guarda en `localStorage`, por token (`4client_form_draft_<token>`), ítems, dirección, método y pedido objetivo en cada cambio, y lo descarta si tiene 24 h o más; se borra al enviar. Sin `localStorage` (modo privado) funciona sin persistencia. *(plataforma, código)* *(sin test)*
- **RN-FRM-31 — Sondeo cada 5 s.** Mientras el formulario está abierto, la página consulta `form-info` y `products` cada 5 s (no hay socket público). CUANDO el pedido en edición ya no existe o dejó de ser editable, DEBE mostrar una advertencia, sin tocar lo que el cliente está escribiendo; el 409 de RN-FRM-13 es la protección real al enviar. *(plataforma, código)* *(sin test)*
- **RN-FRM-32 — `device_token` aleatorio.** La página genera un UUID por link (`4client_device_<token>`) y lo manda siempre; el servidor lo exige en el cuerpo/consulta pero no lo guarda ni lo compara. Cualquier dispositivo con el link puede ver, enviar y borrar. *(plataforma, código)*
- **RN-FRM-33 — Estados en lenguaje del cliente.** Nuevo, Preparando, "Listo para entrega", "En camino" y `cerrado` como "Entregado". Como `form-info` no lista pedidos cerrados, "Entregado" en la práctica no se alcanza (DT-021). *(plataforma, código)*

## 2. Técnico

| Parte | Dónde |
|---|---|
| API | `apps/api/src/routes/public.ts › default (GET /link-status, /form-info, /products, /last-order; POST /submit, /order/:orderId/delete)` |
| Validación del link | `public.ts › loadTicketByFormToken`, `sendInvalidToken`, `resolveActorUser` |
| Tope de mensajes | `public.ts › automatedFormMsgAllowed` |
| Link, política, versión | `apps/api/src/lib/formLink.ts › generateFormLinkUrl, buildPrivacyNoticeMessage, PRIVACY_POLICY_VERSION` |
| Contadores de intentos | `apps/api/src/lib/linkSecurity.ts` |
| Flags para el tablero | `apps/api/src/lib/clientChangedFlags.ts` |
| Web | `apps/web/src/pages/ClientFormPage.tsx › ClientFormPage` |
| Política | `apps/web/public/legal/politica-privacidad.html` |
| Datos | `Ticket` (`form_link_token`, `form_token_min_iat`, `form_link_sent_by`, `consent_given_at`), `RevokedFormToken`, `Organization.form_links_blocked_at`, `Order`, `OrderItem`, `OrderHistory`, `TicketMessage`, `InvoiceLink`, `DailyClose` |

**Regla → dónde se hace cumplir → test.** Archivo de tests: `apps/api/test/public.test.ts`.

| Regla | Se hace cumplir en | Test |
|---|---|---|
| RN-FRM-01 | `loadTicketByFormToken`, `sendInvalidToken` | `"after revoking, the previously-issued token is rejected on every public endpoint (fails closed)"`; `"sending a fresh form-link automatically supersedes (kills) every earlier still-unexpired link for the same ticket, no manual \"Bloquear link\" needed"`; `"blocks every outstanding link across every ticket in the org at once, and a link issued afterward still works"` |
| RN-FRM-02 | `FORM_LINK_ABSOLUTE_TTL_SECONDS` | `"a link survives past 4 hours whether or not it was ever opened - flat 24h cap either way"`; `"a link dies past the flat 24h cap, whether or not it was ever opened"` |
| RN-FRM-03 | `loadTicketByFormToken` | *(sin test)* |
| RN-FRM-04 | `GET /link-status` | `"GET /link-status answers \"is this link alive\" with no phone_last4 at all - a revoked link is caught here before the visitor ever sees the digit-entry screen"` |
| RN-FRM-05 | `GET /form-info` | `"GET /form-info now lists that order, editable (status nuevo), with its item"`; `"GET /form-info marks a pedido an encargado typed up manually as not editable, even while it's in an editable status - the client can only view it"`; `"GET /form-info no longer lists the closed order at all - nothing left for the client to see or do with it"`; `"GET /form-info still lists a \"camino\" order, read-only"` |
| RN-FRM-06 | `GET /products` | *(sin test)* |
| RN-FRM-07 | `GET /last-order` | `"returns a genuinely PAST order (fecha before today)"`; `"returns TODAY's own order when it is already cerrado - counts as \"the previous order\""`; `"does NOT return today's order while it is still active (nuevo/preparando/listo/camino) - form-info owns that one, not \"repetir\""`; `"returns null when the ticket has no past orders at all"` (el flag `available: false` no tiene test) |
| RN-FRM-08 | `POST /submit › body` | `"POST /submit without an address is rejected - address is required, payment method is not"`; `"a client picking \"Cobro en casa\" on the public form never decides completo/vuelta themselves - the order lands with it unset, and staff can set it afterward from the app"` |
| RN-FRM-09 | `rateLimit` de la ruta | *(sin test)* |
| RN-FRM-10 | `POST /submit › CONSENT_REQUIRED` | `"POST /submit rejects with CONSENT_REQUIRED when consent is not sent as true - even on a ticket that already consented before"`; `"POST /submit with consent:true stamps Order.consent_confirmed_at on THAT order, and Ticket.consent_given_at only the first time (historical marker, doesn't skip the requirement later)"`; `"a merge (editing an existing order via the form) also requires consent:true and stamps consent_confirmed_at on that same order"` |
| RN-FRM-11 | `newItemsData` | `"POST /submit with no merge_order_id creates a new order (address required, payment optional), items not flagged as client-added"`; `"a manually-typed product (not picked from the catalog) is flagged added_by_client on the very first submission - the one exception to the rule above"` |
| RN-FRM-12 | `resolveActorUser` + 500 | *(sin test)* |
| RN-FRM-13 | `POST /submit › merge path` | `"POST /submit with a merge_order_id whose order became \"camino\" (out for delivery) while the client was editing is rejected with 409 - NOT silently duplicated as a new order"`; `"a pedido an encargado typed up manually (source !== \"form\") can never be merged into via the client form, even while it's otherwise in an editable status"`; `"POST /submit with a merge_order_id that is no longer open (closed in the meantime) is rejected with 409, not silently duplicated"`; `"rejects resubmitting (merge_order_id) into a client_deleted order even though its status is still editable - 409 ORDER_NOT_EDITABLE"` (el 404 no tiene test) |
| RN-FRM-14 | `mergedItemsData` | `"POST /submit with merge_order_id replaces the order's items with the full submitted list (not append-only), flags only the new/changed line, and sets client_modified"`; `"a client resubmit NEVER overwrites an existing item's price with the catalog price, even when the catalog has one - a brand-new line starts at $0 either way"` |
| RN-FRM-15 | rama `unchanged` | `"resubmitting the exact same items/address/payment is a no-op - does not touch client_modified or items"` |
| RN-FRM-16 | rama de edición | `"staff saving the order does NOT clear client_modified - it stays permanently, same as the per-item added_by_client flag"` (historial, facturas y mensaje de actualización: *sin test*) |
| RN-FRM-17 | pregunta de pago en la edición | *(sin test)* (la del pedido nuevo sí: ver RN-FRM-22) |
| RN-FRM-18 | `alreadyClosed` | `"POST /submit rolls the new order forward to TOMORROW if today already has a DailyClose - never lands on an already-closed day"` |
| RN-FRM-19 | `resolveActorUser` | `"an order created through a real /form-link token is attributed to (registered_by) the staff member who sent it, and the history note names them"`; `"an order created through an AUTO-sent link (no staff member clicked \"enviar formulario\") never attributes the confirmation message to a real staff account"` |
| RN-FRM-20 | `createOrderWithRetryNum` + `FormOrderLimitReachedError` | `"the per-link new-order cap only counts TODAY's form orders - old-day orders never count against it, and a fresh day resets it"` (la concurrencia del lock: *sin test*) |
| RN-FRM-21 | `POST /submit › new order path` | `"POST /submit with no merge_order_id creates a new order (address required, payment optional), items not flagged as client-added"` |
| RN-FRM-22 | mensaje y envío | `"the \"pedido recibido\" confirmation sent to the client stores the real Meta message id, not the hardcoded null it used to send"` |
| RN-FRM-23 | `automatedFormMsgAllowed` | *(sin test)* |
| RN-FRM-24 | `POST /order/:orderId/delete` | `"rejects an order belonging to a different ticket than the one the token was issued for"`; `"rejects deleting the same order twice - 400 ALREADY_DELETED"`; `"rejects deleting an order that already moved past listo (e.g. camino) - 400 NOT_EDITABLE, order untouched"`; `"rejects deleting a pedido an encargado typed up manually (source !== \"form\"), even while still nuevo"` |
| RN-FRM-25 | transacción del borrado | `"marks client_deleted (status untouched, NOT papelera) on an editable order the client submitted, and it disappears from form-info afterward"` (facturas e historial: *sin test*) |
| RN-FRM-26 a 31, 33 | `ClientFormPage` | *(sin test; la web no tiene tests de esta página)* |
| RN-FRM-32 | `device_token` solo exigido por zod | `"the link is not locked to whichever device opened/submitted it first - any device presenting the same token can view AND submit"`; `"a different device_token than the one that created the order can still delete it - same token, no device lock"` |

**Datos y eventos socket.** Emite a `org:<orgId>`: `order:created` (pedido nuevo), `order:updated` (edición con cambios y borrado, con los flags de `clientChangedFlags`) y `ticket:message` (confirmación y pregunta de pago). No hay canal público: la página sondea.

**Transacciones y concurrencia.** Pedido nuevo: conteo del tope + creación dentro de `createOrderWithRetryNum` bajo lock asesor por ticket. La edición no usa transacción ni versión: dos ediciones simultáneas del mismo pedido gana la última (PREG-055). Borrado: transacción (facturas + pedido + historial). El mensaje de WhatsApp y su historial se escriben **después**; si el proceso cae entre medias, el pedido existe sin historial ni aviso.

**Códigos de error propios.** `INVALID_TOKEN` 401, `TICKET_BLOCKED` 403, `LINK_ATTEMPTS_EXCEEDED` 403, `VALIDATION_ERROR` 400, `CONSENT_REQUIRED` 400, `NOT_FOUND` 404, `ORDER_NOT_EDITABLE` 409, `FORM_LIMIT_REACHED` 429, `ALREADY_DELETED` 400, `NOT_EDITABLE` 400, `NO_USER` 500. El 429 del límite por IP lo emite el plugin de rate limit; la página lo distingue de `FORM_LIMIT_REACHED` por el código.

**Si tocas X, revisa Y.**
- Cambiar el texto de la política: sube `PRIVACY_POLICY_VERSION` en `formLink.ts`; `ClientFormPage` y el aviso del chat apuntan a la misma ruta.
- Cambiar `EDITABLE_STATUSES` o la regla de `editable`: hay que mantener iguales `form-info`, el merge, el borrado y el sondeo de la página.
- Cambiar el corte de día (`businessDate.ts`, cierre): la fecha del pedido del formulario es el día calendario de Bogotá sin corte de las 21:00.
- Emitir/revocar links (**INB**) cambia lo que RN-FRM-01 y 02 ven: `form_link_token` sobrescrito mata el link anterior sin comparación aparte.
- Facturas (`InvoiceLink`, **FAC**) y numeración (**ORD**) se tocan desde aquí.

## 3. Pendientes

IDs globales; resumen en `03-plan/preguntas-abiertas.md` y `03-plan/problemas-conocidos.md`.

- **PREG-052 — Producto agotado se puede pedir.** `/products` no envía `in_stock` y la página no lo distingue; el glosario define "Agotado" como "NO HAY" en el catálogo. ¿Debe el cliente ver o no poder pedir un agotado? Hoy se pide y el personal lo pasa a $0.
- **PREG-053 — CORS de las rutas públicas.** El servidor registra CORS global con lista de orígenes y `credentials: true` (`server.ts`), y además un hook de `public.ts` pone `Access-Control-Allow-Origin: *` y solo permite el encabezado `Content-Type`. El comentario dice "cualquier origen", pero un origen no listado ya falla en el plugin global antes de llegar al hook. ¿Cuál es la intención y qué cabecera gana para un origen permitido?
- **PREG-035 — `device_token` obligatorio pero sin uso.** Las rutas lo exigen (400 si falta) y la página lo envía, pero nada lo guarda ni compara (el comentario de la página dice que se registra "para trazabilidad"; el código no lo hace). ¿Se elimina el requisito o se registra?
- **PREG-025 — Pedido de la noche del corte 21:00.** `Ticket.fecha` pasa a mañana con el primer mensaje desde las 21:00 (`businessDate.ts`), pero el pedido nuevo del formulario toma la fecha calendario de Bogotá (hoy) y solo se mueve a mañana si ya hay `DailyClose`. Entre las 21:00 y la medianoche sin cierre, el pedido queda con fecha de hoy mientras el ticket puede estar en mañana. ¿Es lo esperado?
- **PREG-054 — Tope de 30 mensajes automáticos casi inerte.** Cuenta mensajes `out` con `sent_by` null en 24 h, pero cuando un empleado mandó el link, la confirmación lleva su `sent_by` y no cuenta; solo suma lo automático (bienvenida, confirmaciones de links automáticos). Un link filtrado de un ticket con link enviado por personal no queda limitado por este tope (sí por 3 pedidos/día y 15/min por IP; las ediciones no tienen tope propio).
- **DT-002 — Política única, un solo negocio.** Una URL fija, una versión `v1` y un texto que nombra a un solo negocio sirven a todas las organizaciones; el código ya anticipa pasar a política por `Organization` (parte del hardcoding de un solo cliente).
- **PREG-055 — Dos ediciones simultáneas.** La edición reemplaza los ítems sin transacción ni versión; dos pestañas (o dos dispositivos, que el diseño permite) pueden pisarse.
- **DT-012 — Bloqueo por intentos, código muerto.** Nada llama a `registerFailedLinkAttempt` (el paso de teléfono que lo disparaba se quitó); `TICKET_BLOCKED`/`LINK_ATTEMPTS_EXCEEDED` y los contadores solo se leen. Sin test.
- **DT-020 — Comentarios desactualizados en `public.ts`.** El de `/submit` dice que el límite es "por link (token)" (es por IP); los del tope de pedidos dicen que el token "queda válido 7 días" (son 24 h); el de `/order/:orderId/delete` dice que usa `papelera` (usa `client_deleted`); el de `/link-status` menciona un "paso de dígitos" que ya no existe (y los tests aún pasan `phone_last4`, que se ignora). También el cierre de `ClientFormPage` habla de "1 día" de borrador (son 24 h).
- **DT-021 — "Entregado" inalcanzable.** `form-info` excluye `cerrado`, así que la etiqueta `cerrado: 'Entregado'` de la página nunca se muestra; el sondeo dice "Este pedido ya no está disponible".
- **DT-022 — Sin tests** para: endpoint `/products`, límite de 15/min, 404 del merge, historial/facturas/WhatsApp de la edición, tope de 30, bloqueo por intentos y toda la página.
