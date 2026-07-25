// Shared by every "Enviar formulario" button (TicketModal, DetallePedidoModal,
// NuevoPedidoModal) so the safety notice always goes out worded and ordered the
// same way everywhere. Mirrors apps/api/src/lib/formLink.ts's
// buildFormLinkWarningMessage exactly - keep both in sync if this ever changes,
// they intentionally duplicate each other since one runs server-side (auto-send
// after welcome) and one client-side (staff click).
//
// Sent as its OWN message, separate from the link itself (callers send the URL as
// a second, independent message right after this one) - combining them into one
// long message made it long enough to risk mangling in transit, and meant the
// client couldn't forward/copy just the link without dragging this notice along.
export function buildFormLinkWarningMessage(): string {
  return '*ESTE LINK ES SOLO PARA HACER TU PEDIDO Y HACER SEGUIMIENTO DE TUS PEDIDOS. '
    + 'NUNCA TE PEDIREMOS DINERO NI DATOS BANCARIOS NI INFORMACIÓN CONFIDENCIAL.*'
    + '\n\n*Este link estará activo por 4 horas. Si lo abres dentro de ese tiempo, '
    + 'quedará activo por 24 horas. Si no lo abres en las primeras 4 horas, quedará '
    + 'inactivo y deberás pedir uno nuevo.*'
    + '\n\nCuenta de ahorros Bancolombia: 27900010068, a nombre de Fruver San Gabriel SAS.';
}
