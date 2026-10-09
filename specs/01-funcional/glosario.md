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
| **Zona roja** | Franja urgente del tablero: ticket con pedido abierto, o sin pedido tras 20 minutos. | `Swimlane.tsx` |
| **Observación** | Nota del personal sobre un pedido; solo su autor la edita. | `OrderObservation` |
| **Historial** | Registro inmutable de cambios de un pedido. | `OrderHistory` |
| **Factura** | PDF del pedido que se envía al cliente por WhatsApp con un link de 24 h. | `files.ts`, `InvoiceLink` |
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

Nota de etiquetas: el historial del pedido escribe "Efectivo" para `cash`, mientras la interfaz dice "Pagado en tienda".
