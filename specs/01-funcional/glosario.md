---
estado: vigente
verificado: 2026-10-10 @ 1edb809
fuentes: [apps/api/prisma/schema.prisma, apps/web/src/lib/format.ts, packages/shared/src/types, specs/modulos/*.md]
---

# Glosario: término de negocio ↔ código

Vocabulario congelado: todas las specs usan estos términos con este sentido. Si falta uno, se agrega aquí **antes** de usarlo. Un término aparece **una sola vez**; si dos nombres designan lo mismo, se explica en la misma fila. La tercera columna dice dónde vive en el código (no copia campos: ver `apps/api/prisma/schema.prisma`).

## 1. Negocio y personas

| Término (negocio) | Qué es | En el código |
|---|---|---|
| **Fruver** | Tienda de frutas y verduras. Es el tipo de cliente de la plataforma. | — |
| **Organización / negocio** | Un cliente de 4Client (un fruver). Cada uno ve solo sus datos (principio 2). | `Organization`, `org_id` |
| **Admin** | Dueño del negocio. Ve y controla todo lo suyo. | `role = 'admin'` |
| **Encargado** | Quien atiende el mostrador y maneja pedidos y cobros. | `role = 'encargado'` |
| **Domiciliario (usuario)** | Repartidor con login: solo lectura y chat. | `role = 'domiciliario'` |
| **Domiciliario (empleado)** | Repartidor **sin** login al que se asigna un pedido. Es un registro aparte del usuario. | `Employee` |
| **Dev** | El operador de la plataforma (José). Pasa todos los permisos y actúa entre organizaciones. | `role = 'dev'` |
| **Cliente final** | La persona que escribe por WhatsApp y hace el pedido. No tiene cuenta. | — (es el `Ticket`) |
| **Meta** | Empresa dueña de WhatsApp; entrega los mensajes entrantes al webhook y recibe los salientes. | `webhook.ts` |
| **Webhook** | Entrada por la que Meta avisa de un mensaje o de su estado; se autentica con firma HMAC. | `routes/webhook.ts` |

## 2. Chats y WhatsApp

| Término (negocio) | Qué es | En el código |
|---|---|---|
| **Ticket / chat** | Conversación con un cliente final. **Uno por teléfono, para siempre.** | `Ticket` |
| **BSUID** | Identificador que Meta envía cuando el cliente usa nombre de usuario de WhatsApp y no hay teléfono. | `Ticket.bsuid` |
| **Ticket manual** | Ticket creado por el personal en vez de por un mensaje entrante. | `POST /tickets` |
| **Chats WPP** | Bandeja con todos los chats de la organización y su búsqueda (solo admin y dev). | `InboxPanel`, `GET /inbox` |
| **Sin leer** | Mensajes entrantes que el personal aún no atendió; se limpian al responder o al marcar atendido. | `Ticket.unread_count` |
| **Última actividad** | Instante del último mensaje, entrante o saliente, que ordena la bandeja. | `Ticket.last_activity_at` |
| **Día de negocio (ticket)** | Día al que pertenece un chat. Si su primer mensaje del día llega entre 21:00 y 23:59 (Bogotá), cuenta para mañana. No es la fecha del pedido. | `Ticket.fecha`, `businessDate.ts` |
| **Día calendario real** | Día de Bogotá desde las 00:00, sin corte. Decide cuál es el "primer mensaje del día" (bienvenida) y la fecha de los pedidos. | `lib/businessDate.ts` |
| **Mensaje de bienvenida** | Respuesta automática al primer mensaje del día real, con el aviso de privacidad pegado la primera vez. Nunca lleva el link del formulario. | `Organization.welcome_message`, `webhook.ts` |
| **Mensaje de redirección** | Si la organización lo configura, se envía **solo** ese texto en lugar de la bienvenida (número retirado). | `Organization.wpp_redirect_message` |
| **Plantillas de mensajes** | Textos editables por organización para los botones del chat y la bienvenida. | `Organization.message_templates` |
| **Cuenta banco** | Botón del chat que envía los datos bancarios del negocio. | plantilla `bank_account` |
| **Ventana de 24 h** | Regla de Meta: fuera de 24 h desde el último mensaje del cliente, los mensajes del negocio pueden fallar. | — |
| **Reenviar** | Copiar un mensaje del chat a otros chats (1 a 20). | `POST /inbox/messages/:id/forward` |
| **Multimedia del chat** | Imagen, audio, video, documento o ubicación de un mensaje; nunca se guarda, solo su id de Meta (30 días). | `media_url`, `MEDIA_EXPIRED` |
| **Aviso de privacidad / consentimiento** | Aviso en el chat (una vez por ticket) y casilla en el formulario (cada pedido), Ley 1581 de 2012. | `privacy_notice_sent_at`, `consent_*` |
| **Tomar lista** | Elegir mensajes del chat y dejar que la IA extraiga productos y cantidades como **borrador** de ítems. Los precios quedan en 0 y no se guarda nada. | `inbox.ts › parse-messages` |
| **Proveedor de IA** | Servicio externo que hace la extracción de "Tomar lista" (Gemini principal; Groq y OpenRouter de respaldo). | `services/ai/*` |

## 3. Pedido y tablero

| Término (negocio) | Qué es | En el código |
|---|---|---|
| **Pedido** | Una orden de compra, con sus ítems. | `Order`, `OrderItem` |
| **Ítem** | Una línea del pedido: producto, cantidad en texto libre y **precio = total de la línea** (no precio unitario). | `OrderItem` (`price`, `quantity_label`) |
| **Número de pedido** | Número de tres dígitos del día (`001`…): el menor libre, contando los de papelera. | `lib/orderNumbering.ts` |
| **Fecha del pedido** | Día de negocio del pedido y de su cierre; usa el día calendario real, sin corte de 21:00. | `Order.fecha` |
| **Nuevo / Preparando / Listo / En camino / Cerrado** | Estados del pedido en el tablero. `entregado` es heredado y ya no se puede asignar. | `status` |
| **Papelera** | Pedido descartado por el personal, con motivo; se puede restaurar. | `status = 'papelera'` |
| **Eliminado por el cliente** | El cliente borró su pedido desde el formulario; el estado no cambia, queda marcado. | `client_deleted` |
| **Canal** | Origen de un pedido: `whatsapp` o `call` (por llamada; hoy sin pantalla que lo cree). | `Order.channel` |
| **Pedido bloqueado** | Pedido que ya no se edita (cobrado o cerrado sin cobro). `locked` es el candado; solo admin/dev editan un pedido bloqueado. | `Order.locked` |
| **Pendiente de confirmar** | Dirección provisional de un pedido sin dirección real; impide cobrar. | `address` |
| **Observación** | Nota del personal sobre un pedido; solo su autor la edita; se puede agregar aun con el día cerrado. | `OrderObservation` |
| **Historial** | Registro inmutable de cambios de un pedido (principio 4). | `OrderHistory` |
| **Zona roja** | Franja urgente del tablero: un ticket con pedido abierto entra de inmediato; uno sin pedido, a los 20 minutos de su creación. | `Swimlane.tsx` |
| **Fantasma** | Rastro atenuado de un pedido pospuesto en el día del que salió. | `isGhost` en `Swimlane.tsx`, marcador `pasado_manana:` |
| **isPastDay** | Condición de la interfaz: el pedido o chat es de un día anterior o su caja ya cerró; deshabilita Formulario, Cuenta banco y similares. | `TicketModal`, `DetallePedidoModal` |

## 4. Formulario del cliente

| Término (negocio) | Qué es | En el código |
|---|---|---|
| **Formulario / link de formulario** | Página pública donde el cliente arma su pedido; solo se accede con un enlace temporal (40 hexadecimales, 24 h) que sirve únicamente para su ticket. | `/form?t=…`, `Ticket.form_link_token`, `public.ts` |
| **Bloquear link / bloquear todos** | Invalidar el link de un cliente / todos los links de la organización (formulario y facturas). No es el bloqueo de cuenta. | `RevokedFormToken`, `Organization.form_links_blocked_at` |
| **Pedido del formulario** | Pedido creado por el cliente desde el link; solo estos puede editar o borrar el cliente. | `source = 'form'` |
| **Editable** | Pedido del formulario en estado nuevo, preparando o listo y sin bloquear: el cliente aún puede cambiarlo. | `editable` en `form-info` |
| **Marcado por el cliente (campana)** | Rastro permanente de que el cliente agregó o cambió algo; se ve como una campana roja en el pedido. | `added_by_client`, `client_modified` |
| **Repetir último pedido** | Botón del formulario que carga los productos de un pedido anterior (sin precios). | `GET /public/last-order` |
| **Pregunta de pago** | Mensaje automático "¿Efectivo o transferencia?" cuando el pedido del formulario no trae método. | `public.ts` |

## 5. Cobro y cierre de caja

| Término (negocio) | Qué es | En el código |
|---|---|---|
| **Cobro** | Cerrar un pedido registrando el pago, con la contraseña del usuario. Lo bloquea. | `POST /orders/:id/cobro` |
| **Pagado en tienda** | Método de pago `cash` (efectivo en el local). El historial lo escribe "Efectivo". | `payment_method = 'cash'` |
| **Cobro en casa** | Pago contra entrega: `cod`, con elección **completo** o **necesita vuelta**. | `cod`, `cod_choice` |
| **Transferencia** | Pago por transferencia bancaria. | `transfer` |
| **Crédito** | Se cierra ahora y se paga después; se liquida con "marcar crédito pagado". | `credito`, `credito-pagado` |
| **Pago dividido** | Un cobro repartido entre efectivo y transferencia, que suma exacto el total. | `split_cash`, `split_transfer` |
| **Sin asignar** | Método de pago aún no elegido; un pedido así no se puede cobrar. | `payment_method = 'sin_asignar'` |
| **Vuelta / vuelto** | Cambio que se devuelve al cliente. | `change_amount` |
| **Cierre de caja** | Cierre del día: calcula totales, obliga a decidir cada pedido pendiente y congela el día. | `cierre.ts`, `DailyClose` |
| **Día cerrado / caja cerrada** | Día congelado después del cierre. | `DailyClose`, `caja_cerrada` |
| **Foto del cierre** | Registro guardado del día cerrado (totales y decisiones); es lo único que guarda totales (principio 3). | `DailyClose` |
| **Pasar a mañana / pospuesto** | Decisión de cierre: el pedido pendiente se renumera en el día siguiente y muestra "Pospuesto" con su número viejo. | decisión `manana`, marcador `pasado_manana:` en `notes`, `Ticket.deferred_to` |
| **Cerrar sin cobro / cerrado sin cobro** | Decisión de cierre y su resultado: el pedido queda cerrado y bloqueado sin pago registrado. | decisión `forzar_cierre`; `locked`, `paid = false`, no crédito |
| **Marcar como atendido** | Decisión de cierre sobre un chat sin pedido: pone sus mensajes no leídos en 0. | decisión `atendido` |
| **Cobro retroactivo** | Corregir un pedido cerrado "sin cobro" por error, marcándolo pagado después. | `cobro-retroactivo` |
| **Reabrir cierre** | Borrar la foto del cierre de una fecha para descongelar el día; solo `dev`, deja snapshot en auditoría. | `POST /dev/actions/reopen-cierre` |
| **Bolsa** | Cada uno de los dos totales del cierre y del informe: efectivo y transferencia. | `totalEfectivo`, `totalTransferencia` |

## 6. Informe, catálogo y factura

| Término (negocio) | Qué es | En el código |
|---|---|---|
| **Informe del día** | Reporte del administrador: totales, chats, papelera, créditos, cambios. | `dashboard.ts` |
| **Recaudado** | Suma de los pedidos de la fecha pagados y cerrados, repartida en las dos bolsas. | `recaudado` en `dashboard.ts` |
| **Cerrados/Cobrados** | Contador del informe: pedidos en estado cerrado (incluye los cerrados sin cobro y los crédito). | `entregados` en `dashboard.ts` |
| **Catálogo** | Lista de productos del negocio con precio de referencia; también la imagen o texto que se envía al cliente por el chat. | `Product`, `catalogImage.ts` |
| **Precio de referencia** | Precio del catálogo: solo informativo, nunca llena el precio de una línea. | `Product.price_per_unit` |
| **Existencia (Stock) / agotado** | Interruptor de un producto: hay o no hay. Agotado no lo desactiva: el catálogo muestra "NO HAY". | `Product.in_stock` |
| **Consultar** | Texto del catálogo para un producto sin precio. | `catalogImage.ts` |
| **Factura** | PDF **del pedido** que se envía al cliente por WhatsApp con un link de 24 h. No es la factura de plataforma ni una factura electrónica DIAN. | `files.ts`, `InvoiceLink` |
| **Link de factura** | Enlace de 24 h al PDF de un pedido: vivo, revocado o vencido. | `InvoiceLink` |
| **R2** | Almacenamiento de archivos de Cloudflare donde van los PDF (facturas y cobros de plataforma) y los respaldos. | `services/storage.ts` |

## 7. Plataforma, acceso y operación

| Término (negocio) | Qué es | En el código |
|---|---|---|
| **Cobro de plataforma** | Lo que 4Client le cobra a una organización (suscripción, onboarding, otro). Comprobante interno numerado `4C-nnnnnn`; no es factura electrónica DIAN. | `PlatformCharge` |
| **Concepto (de cobro de plataforma)** | `suscripcion`, `onboarding` u `otro`. | `PlatformCharge.types` |
| **Aviso del día 1** | Franja que recuerda a admin y dev pagar la suscripción el primer día de cada mes. | `MainPage.tsx` |
| **DevTools** | Consola del rol `dev`: visor de base, organizaciones, WhatsApp, cobros, sistema y enlaces. | `DevSection` |
| **Ticket de prueba** | Ticket creado desde DevTools con mensajes entrantes ficticios, sin enviar nada por WhatsApp. | `create-test-ticket` |
| **Seed** | Siembra de una organización, un admin y un dev fijos; única forma de crear un usuario `dev`; prohibida en producción. | `POST /dev/seed`, `seed.ts` |
| **Auditoría** | Registro de acciones sensibles de la plataforma (no de pedidos, que usan el historial). | `AuditLog` |
| **PWA** | La web instalable que se actualiza sola al detectar una versión nueva. | `UpdateBanner.tsx` |
| **Bloqueo de cuenta** | Tras 5, 10 y 15 intentos fallidos de contraseña la cuenta se bloquea 5 min, 15 min y 1 h. | `locked_until` |
| **2FA** | Código de 6 dígitos por correo; solo se pide al rol `dev` cuando `REQUIRE_2FA` está activo. | `LoginVerificationCode` |
| **Interfaz ≠ API** | Fórmula de las specs para "lo que la pantalla permite difiere de lo que la API acepta"; siempre se anota. | — |

Nota de etiquetas: el historial del pedido escribe "Efectivo" para `cash`, mientras la interfaz dice "Pagado en tienda".
