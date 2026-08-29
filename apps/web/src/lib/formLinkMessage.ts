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
// Shortened by explicit request - ver el comentario en formLink.ts (versión
// servidor) para el porqué: se quitó el número de cuenta, que quedaba justo
// debajo de "nunca te pediremos datos bancarios" y leía contradictorio.
export function buildFormLinkWarningMessage(): string {
  return '*Este link es solo para hacer tu pedido. Nunca te pediremos dinero ni datos bancarios.*'
    + '\n_Válido por 24 horas._';
}

// Sent as a THIRD message, right after the link itself (see callers). Mirrors
// apps/api/src/lib/formLink.ts's buildFormLinkFollowUpMessage - keep both in sync.
export function buildFormLinkFollowUpMessage(): string {
  return 'Diligencia por favor el pedido por medio del link. Recuerda que el monto mínimo para el domicilio es de $30.000. Cualquier duda con gusto.';
}
