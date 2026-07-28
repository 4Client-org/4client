export function fmtCOP(n: number): string {
  return '$' + n.toLocaleString('es-CO');
}

export function fmtDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Bogota' });
}

// Colombia's calendar date (UTC-5, no DST) for an instant - NOT the device's own local
// date. Using the device's local getters (new Date().getFullYear() etc.) only happens
// to be correct if the device's own timezone is set to Bogotá; on any other timezone
// (or just a misconfigured device) "today" could read as the wrong day, off by one
// around the boundary - which is exactly what shifts a Saturday into showing as Sunday.
export function colombiaDateStr(d: Date | string = new Date()): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const col = new Date(date.getTime() - 5 * 3600000);
  return `${col.getUTCFullYear()}-${String(col.getUTCMonth() + 1).padStart(2, '0')}-${String(col.getUTCDate()).padStart(2, '0')}`;
}

export function todayStr(): string {
  return colombiaDateStr();
}

// Shared by every chat message bubble (InboxPanel/TicketModal/NuevoPedidoModal/
// DetallePedidoModal) - previously each showed only the hour ("03:13 p. m."),
// with no way to tell WHICH DAY a message was from once a conversation ran
// long or a delayed webhook message landed late. Always includes the date,
// not just when it isn't today - the whole point is never having to guess.
export function formatChatTimestamp(raw: string | Date): string {
  const d = typeof raw === 'string' ? new Date(raw) : raw;
  return d.toLocaleString('es-CO', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
  });
}

export const STATUS_LABEL: Record<string, string> = {
  nuevo: 'Nuevo', preparando: 'Preparando', listo: 'Listo',
  camino: 'En camino', entregado: 'Entregado', cerrado: 'Cerrado',
};

export const STATUS_ORDER = ['nuevo', 'preparando', 'listo', 'camino', 'entregado', 'cerrado'];

// Must match the wording staff actually picks (DetallePedidoModal's <select>
// options) exactly - this same constant drives the factura PDF, the copied invoice
// text, the CSV export, and the informe/dashboard display, so a mismatched label
// here made the factura say "Efectivo" for an order the edit screen itself (and
// everywhere else) calls "Pagado en tienda".
export const PAYMENT_LABEL: Record<string, string> = {
  cod: 'Cobro en casa', cash: 'Pagado en tienda', transfer: 'Transferencia', sin_asignar: 'Sin asignar',
  credito: 'Crédito',
};
