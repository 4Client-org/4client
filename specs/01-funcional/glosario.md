---
estado: vigente
verificado: 2026-10-09 @ 2cbd083
fuentes: [apps/api/prisma/schema.prisma, apps/web/src/lib/format.ts, packages/shared/src/types]
---

# Glosario: término de negocio ↔ código

Vocabulario congelado: todas las specs usan estos términos. Si falta uno, se agrega aquí antes de usarlo.

| Término (negocio) | Qué es | En el código |
|---|---|---|
| **Fruver** | Tienda de frutas y verduras. Es el tipo de cliente de la plataforma. | — |
| **Organización / negocio** | Un cliente de 4Client (un fruver). Cada uno ve solo sus datos. | `Organization`, `org_id` |
| **Encargado** | Quien atiende el mostrador y maneja pedidos y cierre. | `role = 'encargado'` |
| **Domiciliario (usuario)** | Repartidor con login: solo lectura y chat. | `role = 'domiciliario'` |
| **Domiciliario (empleado)** | Repartidor **sin** login al que se asigna un pedido. Es un registro aparte del usuario. | `Employee` |
| **Dev** | El operador de la plataforma (José). Pasa todos los permisos y actúa entre organizaciones. | `role = 'dev'` |
| **Cliente final** | La persona que escribe por WhatsApp y hace el pedido. | — (es el `Ticket`) |
| **Ticket / chat** | Conversación con un cliente final. **Uno por teléfono, para siempre.** | `Ticket` |
| **BSUID** | Identificador que Meta envía cuando el cliente usa nombre de usuario de WhatsApp y no hay teléfono. | `Ticket.bsuid` |
| **Pedido** | Una orden de compra, con sus ítems. | `Order`, `OrderItem` |
| **Ítem** | Una línea del pedido: producto, cantidad en texto libre y **precio = total de la línea**. | `OrderItem` (`price`, `quantity_label`) |
| **Nuevo / Preparando / Listo / En camino / Cerrado** | Estados del pedido en el tablero. `entregado` es heredado y ya no se puede asignar. | `status` |
| **Papelera** | Pedido descartado por el personal, con motivo; se puede restaurar. | `status = 'papelera'` |
| **Eliminado por el cliente** | El cliente borró su pedido desde el formulario; el estado no cambia, queda marcado. | `client_deleted` |
| **Formulario / link** | Página pública donde el cliente arma su pedido, accesible solo con un link temporal. | `/form?t=…`, `public.ts` |
| **Bloquear link / bloquear todos** | Invalidar el link de un cliente / todos los links de la organización. | `RevokedFormToken`, `Organization.form_links_blocked_at` |
| **Tomar lista** | Elegir mensajes del chat y dejar que la IA extraiga productos y cantidades para armar el pedido. Los precios quedan en 0. | `inbox.ts › parse-messages` |
| **Cobro** | Cerrar un pedido registrando el pago, con la contraseña del usuario. Lo bloquea. | `POST /orders/:id/cobro` |
| **Pagado en tienda** | Método de pago `cash` (efectivo en el local). | `payment_method = 'cash'` |
| **Cobro en casa** | Pago contra entrega: `cod`, con elección **completo** o **necesita vuelta**. | `cod`, `cod_choice` |
| **Transferencia** | Pago por transferencia bancaria. | `transfer` |
| **Crédito** | Se cierra ahora y se paga después; se liquida con "marcar crédito pagado". | `credito`, `credito-pagado` |
| **Pago dividido** | Un cobro repartido entre efectivo y transferencia, que suma exacto el total. | `split_cash`, `split_transfer` |
| **Vuelta / vuelto** | Cambio que se devuelve al cliente. | `change_amount` |
| **Cierre de caja** | Cierre del día: calcula totales, obliga a decidir cada pedido pendiente y congela el día. | `cierre.ts`, `DailyClose` |
| **Pasar a mañana / pospuesto** | Decisión de cierre: el pedido pendiente se renumera en el día siguiente y muestra "Pospuesto" con su número viejo. | decisión `manana`, marcador `pasado_manana:` en `notes`, `Ticket.deferred_to` |
| **Cerrar sin cobro** | Decisión de cierre: el pedido queda cerrado y bloqueado sin pago registrado. | decisión `forzar_cierre` |
| **Cobro retroactivo** | Corregir un pedido cerrado "sin cobro" por error, marcándolo pagado después. | `cobro-retroactivo` |
| **Día cerrado / caja cerrada** | Día congelado después del cierre. | `DailyClose`, `caja_cerrada` |
| **Informe del día** | Reporte del administrador: totales, chats, papelera, créditos, cambios. | `dashboard.ts` |
| **Zona roja** | Franja urgente del tablero: un ticket con pedido abierto entra de inmediato; uno sin pedido, a los 20 minutos de su creación. | `Swimlane.tsx` |
| **Observación** | Nota del personal sobre un pedido; solo su autor la edita. | `OrderObservation` |
| **Historial** | Registro inmutable de cambios de un pedido. | `OrderHistory` |
| **Factura** | PDF **del pedido** que se envía al cliente por WhatsApp con un link de 24 h. No es la factura de plataforma (cobro de 4Client al negocio) ni una factura electrónica DIAN. | `files.ts`, `InvoiceLink` |
| **Cuenta banco** | Botón del chat que envía los datos bancarios del negocio. | plantilla `bank_account` |
| **Plantillas de mensajes** | Textos editables por organización para los botones del chat. | `Organization.message_templates` |
| **Cobro de plataforma** | Lo que 4Client le cobra a una organización (suscripción, onboarding, otro). No es factura electrónica DIAN. | `PlatformCharge` |
| **Día de negocio (ticket)** | Día al que pertenece un chat. Si su primer mensaje del día llega entre 21:00 y 23:59 (Bogotá), cuenta para mañana. | `Ticket.fecha`, `businessDate.ts` |
| **Aviso de privacidad / consentimiento** | Aviso en el chat (una vez por ticket) y casilla en el formulario (cada pedido), Ley 1581 de 2012. | `privacy_notice_sent_at`, `consent_*` |
| **Ventana de 24 h** | Regla de Meta: fuera de 24 h desde el último mensaje del cliente, los mensajes del negocio pueden fallar. | — |
| **Agotado** | Producto sin existencias: línea en $0 en un pedido, o "NO HAY" en el catálogo. | `in_stock` |
| **Fantasma** | Rastro atenuado de un pedido pospuesto en el día del que salió. | `isGhost` en `Swimlane.tsx`, marcador `pasado_manana:` |
| **Sin asignar** | Método de pago aún no elegido; un pedido así no se puede cobrar. | `payment_method = 'sin_asignar'` |
| **Marcar como atendido** | Decisión de cierre sobre un chat sin pedido: pone sus mensajes no leídos en 0. | decisión `atendido` |
| **Bolsa** | Cada uno de los dos totales del cierre y del informe: efectivo y transferencia. | `totalEfectivo`, `totalTransferencia` |
| **Foto del cierre** | Registro guardado del día cerrado (totales y decisiones). | `DailyClose` |
| **Cerrado sin cobro** (estado) | Pedido cerrado y bloqueado sin pago registrado; resultado de la decisión "Cerrar sin cobro". | `locked`, `paid = false`, no crédito |

| **Link de formulario** | Enlace temporal (40 hexadecimales, 24 h) que permite a un cliente armar su pedido sin cuenta. | `Ticket.form_link_token` |
| **Pedido del formulario** | Pedido creado por el cliente desde el link; solo estos puede editar o borrar el cliente. | `source = 'form'` |
| **Editable** | Pedido del formulario en estado nuevo, preparando o listo y sin bloquear: el cliente aún puede cambiarlo. | `editable` en `form-info` |
| **Marcado por el cliente** | Rastro permanente de que el cliente agregó o cambió algo (campana roja en el pedido). | `added_by_client`, `client_modified` |
| **Repetir último pedido** | Botón del formulario que carga los productos de un pedido anterior (sin precios). | `GET /public/last-order` |
| **Pregunta de pago** | Mensaje automático "¿Efectivo o transferencia?" cuando el pedido del formulario no trae método. | `public.ts` |
| **Chats WPP** | Bandeja con todos los chats de la organización y su búsqueda (solo admin y dev). | `InboxPanel`, `GET /inbox` |
| **Sin leer** | Mensajes entrantes que el personal aún no atendió; se limpian al responder o al marcar atendido. | `Ticket.unread_count` |
| **Última actividad** | Instante del último mensaje, entrante o saliente, que ordena la bandeja. | `Ticket.last_activity_at` |
| **Reenviar** | Copiar un mensaje del chat a otros chats (1 a 20). | `POST /inbox/messages/:id/forward` |
| **Multimedia del chat** | Imagen, audio, video, documento o ubicación de un mensaje; nunca se guarda, solo su id de Meta (30 días). | `media_url`, `MEDIA_EXPIRED` |
| **Ticket manual** | Ticket creado por el personal en vez de por un mensaje entrante. | `POST /tickets` |
| **isPastDay** | Condición de la interfaz: el pedido o chat es de un día anterior o su caja ya cerró; deshabilita Formulario, Cuenta banco y similares. | `TicketModal`, `DetallePedidoModal` |
| **Cerrados/Cobrados** | Contador del informe: pedidos en estado cerrado (incluye los cerrados sin cobro y los crédito). | `entregados` en `dashboard.ts` |
| **Bloqueo de cuenta** | Tras 5, 10 y 15 intentos fallidos de contraseña la cuenta se bloquea 5 min, 15 min y 1 h. | `locked_until` |
| **2FA** | Código de 6 dígitos por correo; solo se pide al rol `dev` cuando `REQUIRE_2FA` está activo. | `LoginVerificationCode` |
| **Aviso del día 1** | Franja que recuerda a los admins pagar la suscripción el primer día de cada mes. | `MainPage.tsx` |
| **Existencia (Stock)** | Interruptor de un producto: hay o no hay; no lo desactiva. | `Product.in_stock` |
| **Consultar** | Texto del catálogo para un producto sin precio. | `catalogImage.ts` |
| **Canal** | Origen de un pedido: `whatsapp` o `call` (por llamada; hoy sin pantalla que lo cree). | `Order.channel` |
| **Pedido bloqueado** | Pedido que ya no se edita (cobrado o cerrado sin cobro); distinto de estado `cerrado` solo en que `locked` es el candado. | `Order.locked` |
| **Pendiente de confirmar** | Dirección provisional de un pedido sin dirección real; impide cobrar. | `address` |
| **Campana** | Icono rojo del pedido cuando el cliente lo tocó desde el formulario. | `client_modified` |
| **Link de factura** | Enlace de 24 h al PDF de un pedido: vivo, revocado o vencido. | `InvoiceLink` |
| **Concepto (de cobro de plataforma)** | `suscripcion`, `onboarding` u `otro`. | `PlatformCharge.types` |
| **Auditoría** | Registro de acciones sensibles de la plataforma (no de pedidos, que usan el historial). | `AuditLog` |
| **DevTools / ticket de prueba** | Consola del rol `dev`; un ticket de prueba se crea ahí sin enviar nada por WhatsApp. | `DevSection`, `create-test-ticket` |

Nota de etiquetas: el historial del pedido escribe "Efectivo" para `cash`, mientras la interfaz dice "Pagado en tienda".
