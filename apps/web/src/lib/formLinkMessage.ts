// Shared by every "Enviar formulario" button (TicketModal, DetallePedidoModal,
// NuevoPedidoModal) so the safety notice always goes out with the link, worded
// and ordered the same way everywhere.
export function buildFormLinkMessage(url: string): string {
  return 'ESTE LINK ES SOLO PARA HACER TU PEDIDO Y HACER SEGUIMIENTO DE TUS PEDIDOS. '
    + 'NUNCA TE PEDIREMOS DINERO NI DATOS BANCARIOS NI INFORMACIÓN CONFIDENCIAL.'
    + '\n\nLink de formulario:\n' + url;
}
