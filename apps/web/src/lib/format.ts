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

// Time-only label for a chat bubble ("03:13 p. m.") - the date itself is shown
// once per day via the divider below (formatChatDateDivider), same split WhatsApp
// itself uses, instead of repeating the date on every single bubble.
export function formatChatTimestamp(raw: string | Date): string {
  const d = typeof raw === 'string' ? new Date(raw) : raw;
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
}

// The centered "Hoy" / "Ayer" / "27 de julio" pill WhatsApp shows between two
// messages that fall on different Colombia calendar days - callers insert one
// of these whenever consecutive messages' colombiaDateStr() differ (see
// InboxPanel/TicketModal/NuevoPedidoModal/DetallePedidoModal's chat render
// loops). Always compared against "now" at render time, not create() will
// re-run per render, so a page left open across midnight ages "Hoy" into the
// actual date on its own next render.
export function formatChatDateDivider(raw: string | Date): string {
  const dayStr = colombiaDateStr(raw);
  if (dayStr === colombiaDateStr()) return 'Hoy';
  const yesterday = new Date(Date.now() - 24 * 3600000);
  if (dayStr === colombiaDateStr(yesterday)) return 'Ayer';
  const d = typeof raw === 'string' ? new Date(raw) : raw;
  const sameYear = colombiaDateStr().slice(0, 4) === dayStr.slice(0, 4);
  return d.toLocaleDateString('es-CO', {
    day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'America/Bogota',
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
