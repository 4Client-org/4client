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
  return '*Este link es solo para tu pedido. Nunca te pediremos dinero ni datos bancarios.*'
    + '\n*Válido por 24 horas.*'
    + '\nCuenta de ahorros Bancolombia: 27900010068, a nombre de Fruver San Gabriel SAS.';
}

// Sent as a THIRD message, right after the link itself (see callers). Mirrors
// apps/api/src/lib/formLink.ts's buildFormLinkFollowUpMessage - keep both in sync.
export function buildFormLinkFollowUpMessage(): string {
  return 'Diligencia por favor el pedido por medio del link. Recuerda que el monto mínimo para el domicilio es de $30.000. Cualquier duda con gusto.';
}
