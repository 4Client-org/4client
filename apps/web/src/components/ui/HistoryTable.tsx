// Shared order-history table: Fecha/Hora | (Pedido) | Quién | Campo/Acción | Antes | Después
// Row coloring: red-ish for producto_eliminado, green-ish for producto_agregado, alternating otherwise.
// Extracted from DetallePedidoModal.tsx so the same table is used there and in ResumenTab.tsx.

import type { CSSProperties } from 'react';

const HIST_VAL_MAP: Record<string, string> = {
  cod: 'Cobro en casa', cash: 'Pagado en tienda', transfer: 'Transferencia', sin_asignar: 'Sin asignar',
  nuevo: 'Nuevo', preparando: 'Preparando', listo: 'Listo',
  camino: 'En camino', entregado: 'Entregado', cerrado: 'Cerrado',
  whatsapp: 'WhatsApp', call: 'Llamada',
};

function fmtHistVal(v: string | null | undefined): string {
  if (!v) return '';
  return HIST_VAL_MAP[v] ?? v;
}

// Every history entry the client made through the public form has this substring
// in its notes (see orders.ts and public.ts) - a reliable signal that actor_id
// records the staff member who SENT the link, not who made the actual change.
function isFromClient(h: any): boolean {
  return typeof h.notes === 'string' && h.notes.includes('formulario');
}

const th: CSSProperties = {
  textAlign: 'left', padding: '7px 10px', fontWeight: 800, color: 'var(--gt)',
  fontSize: 10, textTransform: 'uppercase', letterSpacing: '.4px',
  borderBottom: '2px solid var(--brd)', borderRight: '1px solid var(--brd)',
};
const thLast: CSSProperties = {
  textAlign: 'left', padding: '7px 10px', fontWeight: 800, color: 'var(--gt)',
  fontSize: 10, textTransform: 'uppercase', letterSpacing: '.4px',
  borderBottom: '2px solid var(--brd)',
};
const td: CSSProperties = {
  padding: '8px 10px', borderBottom: '1px solid var(--brd)', borderRight: '1px solid var(--brd)',
};

interface Props {
  history: any[];
  /** Show the "Pedido" column (order number + customer name). Use for cross-order history lists. */
  showOrder?: boolean;
}

export default function HistoryTable({ history, showOrder }: Props) {
  return (
    <div style={{ border: '1px solid var(--brd)', borderRadius: 'var(--rad)', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--bg)' }}>
            <th style={{ ...th, whiteSpace: 'nowrap' }}>Fecha / Hora</th>
            {showOrder && <th style={th}>Pedido</th>}
            <th style={th}>Quién</th>
            <th style={th}>Campo / Acción</th>
            <th style={th}>Antes</th>
            <th style={thLast}>Después</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h: any, i: number) => {
            const isRemove = h.action_type === 'producto_eliminado';
            const isAdd = h.action_type === 'producto_agregado';
            const isCobro = h.action_type === 'cobro';
            const rowBg = isRemove ? '#FEF2F2' : isAdd ? '#F0FDF4' : i % 2 === 0 ? 'var(--b)' : 'var(--bg)';
            return (
              <tr key={i} style={{ background: rowBg }}>
                <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--gt)' }}>
                  {new Date(h.created_at).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' })}
                </td>
                {showOrder && (
                  <td style={{ ...td, fontWeight: 700 }}>
                    #{h.order?.num ?? '?'}
                    <div style={{ fontSize: 11, color: 'var(--gt)', fontWeight: 400 }}>{h.order?.customer_name ?? ''}</div>
                  </td>
                )}
                <td style={{ ...td, fontWeight: 700, color: isFromClient(h) ? 'var(--r)' : 'var(--n)' }}>
                  {/* actor_id is really "whoever sent the client this form link" - it's
                      never the client themselves (clients have no User account), so
                      showing that staff member's name here as if THEY typed the
                      change reads as misleading. The notes already say "vía
                      formulario... enviado por X"; this just makes the primary
                      column say who actually made the change. */}
                  {isFromClient(h) ? 'Cliente' : (h.actor?.name ?? 'Sistema')}
                </td>
                <td style={{
                  ...td, fontWeight: 600,
                  color: isRemove ? '#DC2626' : isAdd ? 'var(--v)' : isCobro ? 'var(--v)' : 'var(--n)',
                }}>
                  {h.field ?? h.action_type}
                  {h.notes && !isCobro && <div style={{ fontWeight: 400, color: 'var(--gt)', fontSize: 11, marginTop: 2 }}>{h.notes}</div>}
                </td>
                <td style={{ ...td, color: '#DC2626' }}>
                  {fmtHistVal(h.value_before) || (isCobro ? h.notes : '') || '-'}
                </td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--brd)', color: 'var(--v)' }}>
                  {fmtHistVal(h.value_after) || '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
