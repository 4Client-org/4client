// Shared by every "Enviar formulario" button (TicketModal, DetallePedidoModal,
// NuevoPedidoModal) so the safety notice always goes out with the link, worded
// and ordered the same way everywhere. Mirrors apps/api/src/lib/formLink.ts's
// buildFormLinkMessage exactly (same wording, same WhatsApp bold formatting) - keep
// both in sync if this ever changes, they intentionally duplicate each other since
// one runs server-side (auto-send after welcome) and one client-side (staff click).
export function buildFormLinkMessage(url: string): string {
  return '*ESTE LINK ES SOLO PARA HACER TU PEDIDO Y HACER SEGUIMIENTO DE TUS PEDIDOS. '
    + 'NUNCA TE PEDIREMOS DINERO NI DATOS BANCARIOS NI INFORMACIÓN CONFIDENCIAL.*'
    + '\n\n*Este link estará activo por 4 horas. Si lo abres dentro de ese tiempo, '
    + 'quedará activo por 24 horas. Si no lo abres en las primeras 4 horas, quedará '
    + 'inactivo y deberás pedir uno nuevo.*'
    + '\n\nCuenta de ahorros Bancolombia: 27900010068, a nombre de Fruver San Gabriel SAS.'
    + '\n\nLink de formulario:\n' + url;
}
