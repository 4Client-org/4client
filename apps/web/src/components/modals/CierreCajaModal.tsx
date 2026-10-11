import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Banknote, ArrowLeftRight, AlertTriangle, CheckCircle, Download, MessageSquare, CircleSlash } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtCOP, STATUS_LABEL, PAYMENT_LABEL } from '../../lib/format';
import { formatPhoneDisplay } from '../../lib/formatPhone';
import { downloadCierreCSV } from '../../lib/csv';
import { toast } from '../ui/Toast';
import TicketModal from './TicketModal';

interface Props {
  fecha: string;
  tickets: any[];
  onClose: () => void;
}

type Decision = 'manana' | 'forzar_cierre';
type TicketDecision = 'manana' | 'atendido';

// Lo que devuelve GET /cierre/preview (cierre.ts): la MISMA regla de bolsas que usa
// POST /cierre para guardar DailyClose y GET /dashboard para el informe
// (apps/api/src/lib/cierreTotals.ts). Este modal ya no suma por su cuenta: antes
// ignoraba el pago dividido, contaba pedidos eliminados por el cliente y rotulaba
// créditos sin pagar como "Completado" (PREG-002, DT-004).
type ClaseCierre = 'cobrado' | 'credito_pendiente' | 'cerrado_sin_cobro' | 'pagado_sin_cerrar' | 'pendiente' | 'excluido';
interface PreviewOrder {
  id: string;
  num: string;
  ticket_id: string | null;
  customer_name: string;
  client_contact_name: string | null;
  customer_phone: string | null;
  address: string;
  status: string;
  payment_method: string;
  paid: boolean;
  items: { product_name: string; quantity_label: string | null; price: number }[];
  total: number;
  efectivo: number;
  transferencia: number;
  dividido: boolean;
  clase: ClaseCierre;
}
interface CierrePreview {
  fecha: string;
  cerrado: boolean;
  closedAt: string | null;
  totales: { efectivo: number; transferencia: number; total: number };
  orders: PreviewOrder[];
}

const NO_SUMA_LABEL: Partial<Record<ClaseCierre, string>> = {
  credito_pendiente: 'Crédito sin pagar',
  cerrado_sin_cobro: 'Cerrado sin cobro',
  pagado_sin_cerrar: 'Pagado sin cerrar',
};

// Cómo entró la plata de un pedido cobrado, con los mismos números que van a las bolsas.
function detallePago(o: PreviewOrder): string {
  const metodo = PAYMENT_LABEL[o.payment_method] ?? o.payment_method;
  if (o.dividido) return `Dividido: ${fmtCOP(o.efectivo)} efectivo + ${fmtCOP(o.transferencia)} transferencia`;
  if (o.efectivo > 0) return `${metodo} · ${fmtCOP(o.efectivo)} a efectivo`;
  if (o.transferencia > 0) return `${metodo} · ${fmtCOP(o.transferencia)} a transferencia`;
  if (o.total === 0) return metodo;
  return `${metodo} · no suma en efectivo ni transferencia`;
}

export default function CierreCajaModal({ fecha, tickets, onClose }: Props) {
  const qc = useQueryClient();
  // Once the close actually lands server-side, the only thing left to do is
  // download the CSV report of what was just closed - no more editing decisions,
  // no re-closing. Replaces the old behavior of instantly dismissing the modal,
  // which meant the CSV (only otherwise available mid-flow) was easy to miss.
  const [closedNow, setClosedNow] = useState(false);

  // Vista previa del servidor. Los "fantasmas" (pedidos ya pasados a mañana por un
  // cierre anterior, RN-CAJ-17) no vienen: la API filtra por la fecha real del
  // pedido. Tampoco vienen papelera ni eliminados por el cliente. MainPage la
  // invalida con los eventos de socket de pedidos; el intervalo es solo respaldo.
  const previewQ = useQuery({
    queryKey: ['cierre-preview', fecha],
    queryFn: () => api.get<{ data: CierrePreview }>(`/cierre/preview?fecha=${fecha}`).then((r) => r.data),
    refetchInterval: 15000,
  });
  const preview = previewQ.data;
  const previewReady = !!preview && !previewQ.isError;
  const previewOrders = preview?.orders ?? [];
  const totales = preview?.totales ?? { efectivo: 0, transferencia: 0, total: 0 };
  const cobrados = previewOrders.filter((o) => o.clase === 'cobrado');
  const noSuman = previewOrders.filter((o) => !!NO_SUMA_LABEL[o.clase]);
  // Exactamente los pendientes que POST /cierre exige decidir (misma regla, RN-CAJ-14).
  const pendingOrders = previewOrders.filter((o) => o.clase === 'pendiente');

  // A pending order tied to a chat drives its ticket's fate on its own - cierre.ts
  // already sets ticket.deferred_to when that order's decision is "manana" - so there's
  // no separate ticket-level decision to make for these; showing both was two decisions
  // for what's really one action. Group them: chat header, its pending order(s) indented
  // underneath with their normal per-order decision selects.
  const pendingOrdersWithTicket = pendingOrders.filter((o) => o.ticket_id);
  const pendingOrdersNoTicket = pendingOrders.filter((o) => !o.ticket_id);
  const groupedTicketIds = new Set(pendingOrdersWithTicket.map((o) => o.ticket_id as string));
  const ticketGroups = Array.from(groupedTicketIds).map((ticketId) => ({
    ticketId,
    ticketInfo: tickets.find((t: any) => t.id === ticketId),
    orders: pendingOrdersWithTicket.filter((o) => o.ticket_id === ticketId),
  }));

  // Chats that still need their OWN decision - nothing pending to hang it on (already
  // shown grouped above), just no order at all or unread messages to acknowledge.
  const ticketOnlyRows = tickets.filter((t: any) => {
    if (t.deferred_to) return false; // ya fue diferido antes, no mostrar de nuevo
    if (groupedTicketIds.has(t.id)) return false; // ya se muestra arriba con su pedido
    const hasNoOrders = !t.orders || t.orders.length === 0;
    const hasUnread = t.unread_count > 0;
    return hasNoOrders || hasUnread;
  });

  // Draft persistence - closing this modal (MainPage.tsx conditionally mounts
  // it, `{showCierre && <CierreCajaModal .../>}`) used to wipe every decision
  // already made the instant it unmounted, with no way back to them short of
  // redoing all of it. Scoped to this exact day (`fecha` alone, not per-user -
  // this is a per-browser draft, not a synced one) so a stray click elsewhere
  // or even a page reload doesn't lose progress - only actually submitting
  // (cierreMut's onSuccess below) clears it.
  const draftKey = `4client_cierre_draft_${fecha}`;
  function loadDraft(): { decisions?: Record<string, string>; ticketDecisions?: Record<string, string> } {
    try {
      const raw = localStorage.getItem(draftKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  // No defaults - user must explicitly choose for each pending order. The draft
  // pre-fills whatever was saved; only entries for orders/chats that are STILL
  // pending are ever sent (filtered below), so an id that stopped being pending
  // never carries an old answer into the cierre. (The pending list now arrives
  // async from GET /cierre/preview, so it can't be filtered at init anymore.)
  const [decisions, setDecisions] = useState<Record<string, Decision | ''>>(() => {
    const draft = loadDraft().decisions ?? {};
    return Object.fromEntries(Object.entries(draft).filter(([, v]) => v === 'manana' || v === 'forzar_cierre')) as Record<string, Decision>;
  });
  const [ticketDecisions, setTicketDecisions] = useState<Record<string, TicketDecision | ''>>(() => {
    const draft = loadDraft().ticketDecisions ?? {};
    return Object.fromEntries(Object.entries(draft).filter(([, v]) => v === 'manana' || v === 'atendido')) as Record<string, TicketDecision>;
  });
  // Chat opened on top to review before deciding (TicketModal, same overlay
  // class/z-index as this modal's own - painting later in the DOM is what
  // puts it visually on top, no z-index override needed). Closing it just
  // clears this and returns here, with every decision made so far untouched
  // (this whole modal never unmounts while it's open).
  const [viewTicketId, setViewTicketId] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ decisions, ticketDecisions }));
    } catch { /* localStorage unavailable - draft just won't persist, not fatal */ }
  }, [draftKey, decisions, ticketDecisions]);

  // Decisiones que de verdad viajan: solo de lo que sigue pendiente ahora mismo.
  const pendingIds = new Set(pendingOrders.map((o) => o.id));
  const ticketOnlyIds = new Set(ticketOnlyRows.map((t: any) => t.id));
  const decisionsToSend = Object.fromEntries(
    Object.entries(decisions).filter(([id, v]) => v && pendingIds.has(id)),
  ) as Record<string, string>;
  const ticketDecisionsToSend = Object.fromEntries(
    Object.entries(ticketDecisions).filter(([id, v]) => v && ticketOnlyIds.has(id)),
  ) as Record<string, string>;

  const allDecided =
    previewReady &&
    pendingOrders.every((o) => decisions[o.id]) &&
    ticketOnlyRows.every((t: any) => ticketDecisions[t.id]);

  const cierreMut = useMutation({
    mutationFn: () => api.post('/cierre', {
      fecha,
      decisions: decisionsToSend,
      ticket_decisions: ticketDecisionsToSend,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['cierre-status'] });
      qc.invalidateQueries({ queryKey: ['cierre-preview'] });
      try { localStorage.removeItem(draftKey); } catch { /* not fatal */ }
      toast('Caja cerrada correctamente');
      setClosedNow(true);
    },
    onError: (e: any) => {
      if (e.code === 'MISSING_DECISIONS' && Array.isArray(e.data?.pending) && e.data.pending.length > 0) {
        const nums = e.data.pending.map((p: any) => `#${p.num} (${p.customer_name})`).join(', ');
        toast(`Faltan decisiones: ${nums}`, true);
        qc.invalidateQueries({ queryKey: ['cierre-preview', fecha] });
        return;
      }
      if (e.code === 'ALREADY_CLOSED') {
        toast('Ya cerraste caja para este día', true);
        qc.invalidateQueries({ queryKey: ['dashboard'] });
        onClose();
        return;
      }
      toast(e.message ?? 'Error al cerrar caja', true);
    },
  });

  // Mismos pedidos que el informe del día (sin papelera ni eliminados por el
  // cliente), así el CSV del modal y el de "Informe del día" coinciden. Las
  // decisiones van completas (no solo las de pendientes): después de cerrar ya no
  // queda nada pendiente y el CSV igual debe decir "Cerrar sin cobro".
  function downloadCSV() {
    const allDecisions = Object.fromEntries(Object.entries(decisions).filter(([, v]) => v)) as Record<string, string>;
    downloadCierreCSV(fecha, previewOrders, allDecisions);
  }

  const pendingSinDecision = pendingOrders.filter((o) => !decisions[o.id]).length;

  if (closedNow) {
    return (
      <div className="moverlay on" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="cierre-win">
          <div className="mhead">
            <div>
              <div className="mtit" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <Lock size={18} color="var(--vd)" /> Cierre de caja
              </div>
              <div className="msub">{fecha}</div>
            </div>
            <button className="mclose" onClick={onClose}>×</button>
          </div>
          <div className="mbody">
            <div style={{ background: 'var(--vc)', borderRadius: 'var(--rad)', padding: '16px 18px', marginBottom: 16, fontSize: 14, fontWeight: 700, color: 'var(--vd)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle size={18} /> Caja cerrada correctamente. Ya no se puede modificar.
            </div>
            <div className="mactions">
              <button className="bsec" onClick={onClose}>Cerrar</button>
              <button className="bpri" onClick={downloadCSV}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Download size={14} /> Descargar CSV del cierre
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="moverlay on" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cierre-win">
        <div className="mhead">
          <div>
            <div className="mtit" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Lock size={18} color="var(--vd)" /> Cierre de caja
            </div>
            <div className="msub">{fecha}</div>
          </div>
          <button className="mclose" onClick={onClose}>×</button>
        </div>
        <div className="mbody">
          <div className="cierre-sect">
            <div className="cierre-stit">Resumen de ventas</div>
            <div className="cierre-row">
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Banknote size={15} color="var(--v)" /> Efectivo + Cobro en casa
              </span>
              <span style={{ fontWeight: 800 }}>{previewReady ? fmtCOP(totales.efectivo) : '…'}</span>
            </div>
            <div className="cierre-row">
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <ArrowLeftRight size={15} color="var(--az)" /> Transferencia
              </span>
              <span style={{ fontWeight: 800 }}>{previewReady ? fmtCOP(totales.transferencia) : '…'}</span>
            </div>
            <div className="cierre-total">
              <span>Total recaudado</span>
              <span>{previewReady ? fmtCOP(totales.total) : '…'}</span>
            </div>
            {previewQ.isError && (
              <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: 'var(--r)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <AlertTriangle size={13} /> No se pudo cargar el resumen del servidor.
                <button className="bsec" style={{ fontSize: 11, padding: '3px 9px' }} onClick={() => previewQ.refetch()}>Reintentar</button>
              </div>
            )}
          </div>

          {cobrados.length > 0 && (
            <div className="cierre-sect">
              <div className="cierre-stit" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle size={13} color="var(--v)" />
                Pedidos cobrados ({cobrados.length})
              </div>
              {cobrados.map((o) => (
                <div key={o.id} className="warn-ord" style={{ opacity: 0.75 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>#{o.num} - {o.customer_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--gt)' }}>
                      {fmtCOP(o.total)} · {detallePago(o)}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--v)', background: 'var(--vc)', padding: '4px 10px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <CheckCircle size={12} /> Cobrado
                  </span>
                </div>
              ))}
            </div>
          )}

          {noSuman.length > 0 && (
            <div className="cierre-sect">
              <div className="cierre-stit" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <CircleSlash size={13} color="var(--gt)" />
                Cerrados que no suman al total ({noSuman.length})
              </div>
              {noSuman.map((o) => (
                <div key={o.id} className="warn-ord" style={{ opacity: 0.75 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>#{o.num} - {o.customer_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--gt)' }}>
                      {fmtCOP(o.total)} · {PAYMENT_LABEL[o.payment_method] ?? o.payment_method}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--a)', background: 'var(--ac)', padding: '4px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                    {NO_SUMA_LABEL[o.clase] ?? o.clase}
                  </span>
                </div>
              ))}
            </div>
          )}

          {(ticketGroups.length > 0 || ticketOnlyRows.length > 0 || pendingOrdersNoTicket.length > 0) ? (
            <div className="cierre-sect">
              <div className="cierre-stit" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={13} color="var(--a)" />
                Pedidos y chats pendientes - decide qué hacer ({pendingOrders.length + ticketOnlyRows.length})
                <button
                  className="bsec"
                  style={{ marginLeft: 'auto', fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap' }}
                  onClick={() => {
                    const all: Record<string, Decision> = {};
                    for (const o of pendingOrders) all[o.id] = 'manana';
                    setDecisions(prev => ({ ...prev, ...all }));
                  }}
                >
                  Pasar todo a mañana
                </button>
              </div>
              {pendingSinDecision > 0 && (
                <div style={{ background: 'var(--ac)', border: '1px solid var(--a)', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 13, color: 'var(--a)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <AlertTriangle size={13} /> {pendingSinDecision} pedido{pendingSinDecision !== 1 ? 's' : ''} sin decisión
                </div>
              )}

              {/* Chat + su(s) pedido(s) pendiente(s) indentados debajo - una sola decisión
                  (la del pedido) mueve ambos, cierre.ts ya difiere el ticket junto con él. */}
              {ticketGroups.map(({ ticketId, ticketInfo, orders: tOrders }) => (
                <div key={ticketId} className="warn-ord" style={{ flexDirection: 'column', alignItems: 'stretch', borderLeft: '3px solid var(--az)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <MessageSquare size={13} color="var(--az)" />
                    <div
                      onClick={() => setViewTicketId(ticketId)}
                      title="Ver la conversación de este chat"
                      style={{ fontWeight: 700, fontSize: 13, cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>
                      {ticketInfo?.customer_name ?? tOrders[0].customer_name} - {formatPhoneDisplay(ticketInfo?.phone ?? tOrders[0].customer_phone ?? '')}
                    </div>
                    {ticketInfo?.unread_count > 0 && (
                      <span style={{ color: 'var(--az)', fontWeight: 700, fontSize: 12 }}>{ticketInfo.unread_count} sin leer</span>
                    )}
                  </div>
                  <div style={{ marginTop: 8, paddingLeft: 14, borderLeft: '2px solid var(--brd)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {tOrders.map((o) => {
                      const hasDecision = !!decisions[o.id];
                      return (
                        <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>#{o.num}</div>
                            <div style={{ fontSize: 12, color: 'var(--gt)' }}>
                              {STATUS_LABEL[o.status] ?? o.status} · {fmtCOP(o.total)}
                            </div>
                          </div>
                          <select
                            className="warn-sel"
                            value={decisions[o.id] ?? ''}
                            onChange={(e) => setDecisions({ ...decisions, [o.id]: e.target.value as Decision | '' })}
                            style={{ borderColor: hasDecision ? 'var(--v)' : 'var(--a)' }}
                          >
                            <option value="" disabled>- Elegir acción -</option>
                            <option value="manana">Pasar a mañana</option>
                            <option value="forzar_cierre">Cerrar sin cobro</option>
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Chats sin pedido pendiente que igual necesitan una decisión propia
                  (sin pedido, o con mensajes sin leer) */}
              {ticketOnlyRows.map((t: any) => {
                const hasDecision = !!ticketDecisions[t.id];
                const hasNoOrders = !t.orders || t.orders.length === 0;
                return (
                  <div key={t.id} className="warn-ord" style={{ borderLeft: hasDecision ? '3px solid var(--v)' : '3px solid var(--az)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        onClick={() => setViewTicketId(t.id)}
                        title="Ver la conversación de este chat"
                        style={{ fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3, width: 'fit-content' }}>
                        {t.customer_name} - {formatPhoneDisplay(t.phone)}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--gt)' }}>
                        {hasNoOrders ? 'Sin pedido' : 'Pedidos completados'}
                        {t.unread_count > 0 && <span style={{ marginLeft: 8, color: 'var(--az)', fontWeight: 700 }}>{t.unread_count} sin leer</span>}
                      </div>
                    </div>
                    <select
                      className="warn-sel"
                      value={ticketDecisions[t.id] ?? ''}
                      onChange={(e) => setTicketDecisions({ ...ticketDecisions, [t.id]: e.target.value as TicketDecision | '' })}
                      style={{ borderColor: hasDecision ? 'var(--v)' : 'var(--az)' }}
                    >
                      <option value="" disabled>- Elegir acción -</option>
                      <option value="manana">Pasar a mañana</option>
                      <option value="atendido">Marcar como atendido</option>
                    </select>
                  </div>
                );
              })}

              {/* Pedidos sin chat asociado (llamada/en persona) - no hay ticket bajo el cual agrupar */}
              {pendingOrdersNoTicket.map((o) => {
                const hasDecision = !!decisions[o.id];
                return (
                  <div key={o.id} className="warn-ord" style={{ borderLeft: hasDecision ? '3px solid var(--v)' : '3px solid var(--a)' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>#{o.num} - {o.customer_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--gt)' }}>
                        {STATUS_LABEL[o.status] ?? o.status} · {fmtCOP(o.total)}
                      </div>
                    </div>
                    <select
                      className="warn-sel"
                      value={decisions[o.id] ?? ''}
                      onChange={(e) => setDecisions({ ...decisions, [o.id]: e.target.value as Decision | '' })}
                      style={{ borderColor: hasDecision ? 'var(--v)' : 'var(--a)' }}
                    >
                      <option value="" disabled>- Elegir acción -</option>
                      <option value="manana">Pasar a mañana</option>
                      <option value="forzar_cierre">Cerrar sin cobro</option>
                    </select>
                  </div>
                );
              })}
            </div>
          ) : previewReady ? (
            <div style={{ background: 'var(--vc)', borderRadius: 'var(--rad)', padding: '12px 16px', marginBottom: 14, fontSize: 13, fontWeight: 700, color: 'var(--vd)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle size={15} /> Todos los pedidos y chats están resueltos.
            </div>
          ) : (
            <div style={{ padding: '12px 16px', marginBottom: 14, fontSize: 13, color: 'var(--gt)' }}>
              Cargando los pedidos del día…
            </div>
          )}

          {previewReady && !allDecided && (pendingOrders.length > 0 || ticketOnlyRows.length > 0) && (
            <div style={{ background: 'var(--ac)', border: '1px solid var(--a)', borderRadius: 'var(--rad)', padding: '10px 14px', marginBottom: 14, fontSize: 13, color: 'var(--a)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={14} /> Decide la acción de cada pedido y chat pendiente para poder cerrar o descargar el informe.
            </div>
          )}

          <div className="mactions">
            <button className="bsec" onClick={onClose}>Cancelar</button>
            <button className="bsec" onClick={downloadCSV} disabled={!allDecided}
              title={!allDecided ? 'Decide la acción de cada pedido pendiente primero' : ''}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: allDecided ? 1 : 0.5 }}>
              <Download size={14} /> CSV
            </button>
            <button className="bpri" onClick={() => cierreMut.mutate()} disabled={cierreMut.isPending || !allDecided}
              title={!allDecided ? 'Decide la acción de cada pedido pendiente primero' : ''}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
              {cierreMut.isPending ? 'Cerrando...' : <><Lock size={14} /> Cerrar caja</>}
            </button>
          </div>
        </div>
      </div>
    </div>
    {viewTicketId && (
      <TicketModal ticketId={viewTicketId} fecha={fecha} onClose={() => setViewTicketId(null)} />
    )}
    </>
  );
}
