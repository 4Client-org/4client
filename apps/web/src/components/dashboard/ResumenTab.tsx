import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package, PackageCheck, Clock, Banknote, ArrowLeftRight, Wallet,
  FileText, Trash2, History, ChevronDown, ChevronRight, Lock, Download, Ban,
  MessageSquare, MessageCircleWarning, MessageCircleCheck, MessageCircleDashed,
  AlertTriangle,
} from 'lucide-react';
import { STATUS_LABEL, fmtCOP, PAYMENT_LABEL, todayStr } from '../../lib/format';
import { normalizeSearch } from '../../lib/normalize';
import { downloadCierreCSV } from '../../lib/csv';
import { formatPhoneDisplay } from '../../lib/formatPhone';
import { api } from '../../lib/api';
import { toast } from '../ui/Toast';
import { ConfirmModal } from '../ui/ConfirmModal';
import HistoryTable from '../ui/HistoryTable';
import DatePickerES from '../ui/DatePickerES';

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  nuevo: { bg: '#F8FAFC', fg: '#94A3B8' },
  preparando: { bg: '#FFFBEB', fg: '#D97706' },
  listo: { bg: '#EFF6FF', fg: '#2563EB' },
  camino: { bg: '#F5F3FF', fg: '#7C3AED' },
  entregado: { bg: '#E8F5EE', fg: '#1A7A4A' },
  cerrado: { bg: '#E8F5EE', fg: '#0F4F30' },
  papelera: { bg: '#FDEDEC', fg: '#C0392B' },
};

// Pedidos cerrados vía "Cerrar sin cobro" (cierre.ts, decisión forzar_cierre) -
// cuentan como cerrados pero deliberadamente NO entran a "Recaudado efectivo"/
// "Recaudado transferencia" de arriba, porque nunca se confirmó que el dinero
// entró. Antes esto era invisible - el total salía más bajo de lo real sin
// ninguna pista de por qué (caso real reportado). Mismo bloque reutilizado
// para efectivo y transferencia, solo cambia qué lista le llega.
function renderSinCobro(items?: { id: string; customer_name: string; total: number }[]) {
  if (!items || items.length === 0) return null;
  const total = items.reduce((s, i) => s + i.total, 0);
  return (
    <div style={{ borderTop: '1px dashed #FCA5A5', paddingTop: 8, fontSize: 12, color: '#B91C1C' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, marginBottom: 4 }}>
        <AlertTriangle size={13} />
        {fmtCOP(total)} cerrado{items.length > 1 ? 's' : ''} sin cobro ({items.length} pedido{items.length > 1 ? 's' : ''}) - no incluido arriba
      </div>
      <div style={{ display: 'grid', gap: 2 }}>
        {items.map(i => (
          <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{i.customer_name}</span>
            <span style={{ fontWeight: 700 }}>{fmtCOP(i.total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface Props {
  fecha: string;
  setFecha: (d: string) => void;
  dashboard: any;
  papeleraOrders: any[];
  creditoOrders: any[];
  history: any[];
  orders: any[];
  onCierreCaja: () => void;
  onOpenOrder: (orderId: string) => void;
}

export default function ResumenTab({ fecha, setFecha, dashboard, papeleraOrders, creditoOrders, history, onCierreCaja, onOpenOrder }: Props) {
  const qc = useQueryClient();
  const [resumenTab, setResumenTab] = useState<'activos' | 'papelera' | 'credito' | 'cambios'>('activos');
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showBlockAllConfirm, setShowBlockAllConfirm] = useState(false);
  // Not scoped to `fecha` like the rest of this page - crédito orders can be from
  // any day (see dashboard.ts's own creditoOrders query), so this searches by
  // name, address, date, monto, artículos - whatever matches, across the whole
  // list at once. Also split Pagados/No pagados below (dashboard.ts now sends
  // both, not just unpaid ones).
  const [creditoSearch, setCreditoSearch] = useState('');
  const [creditoSubTab, setCreditoSubTab] = useState<'no_pagados' | 'pagados'>('no_pagados');
  const creditoNoPagados = useMemo(() => creditoOrders.filter((o: any) => !o.paid), [creditoOrders]);
  const creditoPagados = useMemo(() => creditoOrders.filter((o: any) => o.paid), [creditoOrders]);
  const filteredCreditoOrders = useMemo(() => {
    const list = creditoSubTab === 'pagados' ? creditoPagados : creditoNoPagados;
    const q = normalizeSearch(creditoSearch);
    if (!q) return list;
    return list.filter((o: any) => {
      // Several date formats checked, not just ISO - a search box is where people
      // type "25/07", "25-07-2026", or "25 jul" just as often as "2026-07-25", and
      // only matching the raw ISO string silently failed every one of those.
      let fechaMatch = false;
      if (o.fecha) {
        const d = new Date(o.fecha);
        const iso = d.toISOString().split('T')[0]; // 2026-07-25
        const [y, m, day] = iso.split('-');
        const ddmmyyyy = `${day}/${m}/${y}`;
        const ddmmyyyyDash = `${day}-${m}-${y}`;
        const localized = normalizeSearch(d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' }));
        fechaMatch = iso.includes(creditoSearch) || ddmmyyyy.includes(creditoSearch) || ddmmyyyyDash.includes(creditoSearch) || localized.includes(q);
      }
      const total = o.items?.reduce((s: number, i: any) => s + Number(i.price), 0) ?? 0;
      const itemsText = (o.items ?? []).map((i: any) => `${i.quantity_label ?? ''} ${i.product_name ?? ''}`).join(' ');
      return normalizeSearch(o.client_contact_name ?? o.customer_name ?? '').includes(q)
        || normalizeSearch(o.address ?? '').includes(q)
        || normalizeSearch(o.employee?.name ?? '').includes(q)
        || normalizeSearch(itemsText).includes(q)
        || (o.num ?? '').includes(creditoSearch)
        || fechaMatch
        || String(total).includes(creditoSearch);
    });
  }, [creditoNoPagados, creditoPagados, creditoSubTab, creditoSearch]);

  const restoreMut = useMutation({
    mutationFn: (orderId: string) => api.patch(`/orders/${orderId}/restore`, {}),
    // The socket 'order:updated' MainPage listens for already refreshes the board
    // and this tab's own ['dashboard', fecha] query - but NOT the detail modal's
    // ['order', orderId] cache, since that listener only runs while the modal is
    // actually mounted. Restoring from here (modal closed) left that cache stale
    // for up to staleTime (30s, main.tsx's QueryClient default) - reopening the
    // SAME order from the board within that window kept showing "¿restaurar?"
    // even though it had already been restored. Explicit invalidation here closes
    // that gap regardless of whether anything was listening at the time.
    onSuccess: (_data, orderId) => {
      toast('Pedido restaurado');
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: any) => toast(e.message ?? 'No se pudo restaurar el pedido', true),
  });

  // Emergency kill switch - e.g. the store closes early one day and every form link
  // sent out today needs to die right now, not just the one someone remembers to
  // individually revoke. A fresh link sent afterward works normally again.
  const blockAllLinksMut = useMutation({
    mutationFn: () => api.post('/inbox/form-links/block-all', {}),
    onSuccess: () => toast('Todos los links de formulario activos fueron bloqueados'),
    onError: (e: any) => toast(e.message ?? 'No se pudo bloquear los links', true),
  });

  function toggleOrder(id: string) {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  // Build per-order history map from the global history list
  const histByOrder = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const h of (history ?? [])) {
      const orderId = h.order_id ?? h.orderId;
      if (!orderId) continue;
      if (!map[orderId]) map[orderId] = [];
      map[orderId].push(h);
    }
    return map;
  }, [history]);

  const STATUS_SORT: Record<string, number> = {
    nuevo: 0, preparando: 1, listo: 2, camino: 3, entregado: 4, cerrado: 5,
  };

  const filteredOrders: any[] = useMemo(
    () => [...(dashboard?.orders ?? [])].sort((a, b) =>
      (STATUS_SORT[a.status] ?? 99) - (STATUS_SORT[b.status] ?? 99)
    ),
    [dashboard?.orders]
  );

  // Group orders by ticket_id (same chat) or customer_name fallback
  const orderGroups = useMemo(() => {
    const groups: { key: string; label: string; orders: any[] }[] = [];
    const seen = new Map<string, any[]>();
    for (const o of filteredOrders) {
      const key = o.ticket_id ?? `name:${o.customer_name}`;
      if (!seen.has(key)) { seen.set(key, []); }
      seen.get(key)!.push(o);
    }
    for (const [key, orders] of seen.entries()) {
      // client_contact_name (the WhatsApp contact's name, snapshotted once at
      // creation, never editable afterward) over customer_name (staff can
      // freely retype it per-order) - Informe del día must show the real
      // contact, not whatever a specific order's name field was last edited to.
      const label = orders[0].client_contact_name ?? orders[0].customer_name;
      groups.push({ key, label, orders });
    }
    return groups;
  }, [filteredOrders]);

  return (
    <>
      <div className="khead">
        <div>
          <div className="ktit">Informe del día</div>
          <div className="kmeta">Tiempo real - actualización automática</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <DatePickerES value={fecha} onChange={setFecha} />
          {dashboard?.cierre?.cerrado ? (
            <>
              <button disabled title={dashboard.cierre.closedByName ? `Cerrada por ${dashboard.cierre.closedByName}` : ''}
                style={{ background: 'var(--bg)', color: 'var(--gt)', border: '1px solid var(--brd)', padding: '11px 16px', borderRadius: 'var(--rad)', fontSize: 14, fontWeight: 700, cursor: 'not-allowed', display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
                <Lock size={15} /> Caja ya cerrada
              </button>
              {/* Re-downloadable any time after the close, not just in the one live
                  session that ran it - decisions come from the persisted DailyClose
                  row (GET /dashboard), same report either way. */}
              <button
                onClick={() => downloadCierreCSV(fecha, dashboard.orders ?? [], dashboard.cierre.decisions ?? {})}
                style={{ background: 'var(--vd)', color: '#fff', border: 'none', padding: '11px 16px', borderRadius: 'var(--rad)', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
                <Download size={15} /> Descargar CSV
              </button>
            </>
          ) : fecha !== todayStr() ? (
            // Cierre only ever applies to the live, current day (see cierre.ts's
            // NOT_TODAY check) - a past day with pending orders is done, not
            // reconcilable anymore, and a future day has nothing to close yet.
            <button disabled title="Solo se puede cerrar la caja del día actual"
              style={{ background: 'var(--bg)', color: 'var(--gt)', border: '1px solid var(--brd)', padding: '11px 16px', borderRadius: 'var(--rad)', fontSize: 14, fontWeight: 700, cursor: 'not-allowed', display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
              <Lock size={15} /> Cerrar caja
            </button>
          ) : (
            <button onClick={onCierreCaja}
              style={{ background: 'var(--vd)', color: '#fff', border: 'none', padding: '11px 16px', borderRadius: 'var(--rad)', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
              <Lock size={15} /> Cerrar caja
            </button>
          )}
          <button
            onClick={() => setShowBlockAllConfirm(true)}
            disabled={blockAllLinksMut.isPending}
            title="Bloquea todos los links de formulario activos ahora mismo, sin importar la hora"
            style={{ background: 'var(--rc)', color: 'var(--r)', border: '1px solid var(--r)', padding: '11px 16px', borderRadius: 'var(--rad)', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
            <Ban size={15} /> Bloquear todos los links
          </button>
        </div>
      </div>

      {showBlockAllConfirm && (
        <ConfirmModal
          message="Vas a bloquear TODOS los links de formulario activos ahora mismo, para todos los chats. Ningún cliente podrá crear ni editar pedidos por el link hasta que le envíes uno nuevo. ¿Deseas continuar?"
          confirmLabel="Bloquear todos"
          danger
          onConfirm={() => { blockAllLinksMut.mutate(); setShowBlockAllConfirm(false); }}
          onCancel={() => setShowBlockAllConfirm(false)}
        />
      )}

      {dashboard && (
        <>
          <div className="arow">
            {/* Chat stats */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
                Chats de WhatsApp
              </div>
              <div className="agrid4">
                <div className="acard">
                  <div className="ai"><MessageSquare size={26} color="var(--gt)" strokeWidth={1.5} /></div>
                  <div className="av">{dashboard.chats?.total ?? 0}</div>
                  <div className="al2">Chats totales</div>
                </div>
                {/* Was missing - "activos" + "completos" alone never added up to
                    "total" for a chat that's written in but never placed a pedido,
                    which read as the total being wrong instead of a category
                    missing. Backend already computed sinPedido (dashboard.ts), this
                    tile was the only thing not surfacing it. */}
                <div className="acard">
                  <div className="ai"><MessageCircleDashed size={26} color="var(--gt)" strokeWidth={1.5} /></div>
                  <div className="av">{dashboard.chats?.sinPedido ?? 0}</div>
                  <div className="al2">Chat sin pedido</div>
                </div>
                <div className="acard r">
                  <div className="ai"><MessageCircleWarning size={26} color="var(--r)" strokeWidth={1.5} /></div>
                  <div className="av">{dashboard.chats?.activos ?? 0}</div>
                  <div className="al2">Chat con pedido activo</div>
                </div>
                <div className="acard v">
                  <div className="ai"><MessageCircleCheck size={26} color="var(--v)" strokeWidth={1.5} /></div>
                  <div className="av">{dashboard.chats?.completos ?? 0}</div>
                  <div className="al2">Chat con pedidos completados</div>
                </div>
              </div>
            </div>

            {/* Order stats */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
                Pedidos
              </div>
              <div className="agrid">
                <div className="acard">
                  <div className="ai"><Package size={26} color="var(--gt)" strokeWidth={1.5} /></div>
                  <div className="av">{dashboard.totales?.total ?? 0}</div>
                  <div className="al2">Pedidos totales</div>
                </div>
                <div className="acard r">
                  <div className="ai"><Clock size={26} color="var(--r)" strokeWidth={1.5} /></div>
                  <div className="av">{dashboard.totales?.pendientes ?? 0}</div>
                  <div className="al2">Pendientes</div>
                </div>
                <div className="acard v">
                  <div className="ai"><PackageCheck size={26} color="var(--v)" strokeWidth={1.5} /></div>
                  <div className="av">{dashboard.totales?.entregados ?? 0}</div>
                  <div className="al2">Cerrados/Cobrados</div>
                </div>
              </div>
            </div>
          </div>

          <div className="drow">
            <div className="dcard2 v" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div className="dico v"><Banknote size={22} color="var(--v)" strokeWidth={1.5} /></div>
                <div><div className="dlbl">Recaudado efectivo</div><div className="dval">{fmtCOP(dashboard.recaudado?.efectivo ?? 0)}</div></div>
              </div>
              {renderSinCobro(dashboard.recaudado?.sinCobroEfectivo)}
            </div>
            <div className="dcard2 az" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div className="dico az"><ArrowLeftRight size={22} color="var(--az)" strokeWidth={1.5} /></div>
                <div><div className="dlbl">Recaudado transferencia</div><div className="dval">{fmtCOP(dashboard.recaudado?.transferencia ?? 0)}</div></div>
              </div>
              {renderSinCobro(dashboard.recaudado?.sinCobroTransferencia)}
            </div>
            <div className="dcard2 tot">
              <div className="dico n"><Wallet size={22} color="var(--n)" strokeWidth={1.5} /></div>
              <div><div className="dlbl">Total recaudado</div><div className="dval">{fmtCOP(dashboard.recaudado?.total ?? 0)}</div></div>
            </div>
          </div>

        </>
      )}

      <div className="atabs">
        <button className={`atab${resumenTab === 'activos' ? ' on' : ''}`} onClick={() => setResumenTab('activos')}>
          <FileText size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 5 }} />
          Pedidos ({dashboard?.orders?.length ?? 0})
        </button>
        <button className={`atab${resumenTab === 'papelera' ? ' on' : ''}`} onClick={() => setResumenTab('papelera')}>
          <Trash2 size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 5 }} />
          Papelera ({papeleraOrders.length})
        </button>
        <button className={`atab${resumenTab === 'credito' ? ' on' : ''}`} onClick={() => setResumenTab('credito')}>
          <Wallet size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 5 }} />
          Crédito ({creditoNoPagados.length})
        </button>
        <button className={`atab${resumenTab === 'cambios' ? ' on' : ''}`} onClick={() => setResumenTab('cambios')}>
          <History size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 5 }} />
          Cambios ({history.length})
        </button>
      </div>

      {resumenTab === 'activos' && (
        <div className="htab">
          <div className="hth">
            <span>{filteredOrders.length} pedido{filteredOrders.length !== 1 ? 's' : ''} · {orderGroups.length} cliente{orderGroups.length !== 1 ? 's' : ''}</span>
          </div>
          {filteredOrders.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--gt)', fontSize: 14 }}>
              Sin pedidos en este estado
            </div>
          )}
          {orderGroups.map(({ key, label, orders: groupOrders }) => {
            const isGroupCollapsed = collapsedGroups.has(key);
            const groupTotal = groupOrders.reduce((s: number, o: any) =>
              s + (o.items?.reduce((ss: number, i: any) => ss + Number(i.price), 0) ?? 0), 0);

            return (
              <div key={key} style={{ borderBottom: '2px solid var(--brd)' }}>
                {/* Group header - always shown */}
                <div
                  onClick={() => toggleGroup(key)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 18px', background: 'var(--vc)', cursor: 'pointer',
                    borderBottom: isGroupCollapsed ? 'none' : '1px solid var(--brd)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {isGroupCollapsed ? <ChevronRight size={15} color="var(--v)" /> : <ChevronDown size={15} color="var(--v)" />}
                    <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--vd)' }}>{label}</span>
                    <span style={{ fontSize: 12, background: 'var(--vm)', color: 'var(--vd)', padding: '2px 8px', borderRadius: 20, fontWeight: 700 }}>
                      {groupOrders.length} {groupOrders.length === 1 ? 'pedido' : 'pedidos'}
                    </span>
                  </div>
                  <span style={{ fontWeight: 800, color: 'var(--v)', fontSize: 14 }}>{fmtCOP(groupTotal)}</span>
                </div>

                {/* Orders within group */}
                {!isGroupCollapsed && groupOrders.map((o: any) => {
                  const total = o.items?.reduce((s: number, i: any) => s + Number(i.price), 0) ?? 0;
                  const orderHist = histByOrder[o.id] ?? [];
                  const isExp = expandedOrders.has(o.id);
                  const col = STATUS_COLORS[o.status] ?? { bg: 'var(--bg)', fg: 'var(--gt)' };

                  return (
                    <div key={o.id} style={{ borderBottom: '1px solid var(--brd)' }}>
                      <div
                        className="hrow hrow-exp"
                        onClick={() => toggleOrder(o.id)}
                        style={{
                          gridTemplateColumns: '50px 1fr auto auto auto 28px',
                          paddingLeft: 32,
                        }}
                      >
                        <div className="hnum">#{o.num}</div>
                        <div>
                          <div className="hdir">{o.address}</div>
                        </div>
                        <div>
                          <span className="ebadge" style={{ background: col.bg, color: col.fg }}>
                            {STATUS_LABEL[o.status] ?? o.status}
                          </span>
                        </div>
                        {/* Método de pago visible sin tener que expandir cada pedido -
                            antes solo aparecía adentro del detalle (isExp), y sumar
                            efectivo/transferencia a mano exigía abrir uno por uno. */}
                        <div style={{ fontSize: 12, color: 'var(--gt)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {PAYMENT_LABEL[o.payment_method] ?? o.payment_method ?? '-'}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {orderHist.length > 0 && (
                            <span className="chg-cnt">{orderHist.length} cambio{orderHist.length !== 1 ? 's' : ''}</span>
                          )}
                          <span style={{ fontWeight: 800, color: 'var(--v)', fontSize: 14 }}>{fmtCOP(total)}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', color: 'var(--gt)' }}>
                          {isExp ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </div>
                      </div>

                      {isExp && (
                        <div className="ord-hist-sub" style={{ paddingLeft: 32 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px 12px', fontSize: 13, marginBottom: orderHist.length > 0 ? 10 : 0 }}>
                            <div><span style={{ color: 'var(--gt)' }}>Teléfono: </span>{o.customer_phone ? formatPhoneDisplay(o.customer_phone) : '-'}</div>
                            <div><span style={{ color: 'var(--gt)' }}>Pago: </span>{PAYMENT_LABEL[o.payment_method] ?? o.payment_method ?? '-'}</div>
                            <div><span style={{ color: 'var(--gt)' }}>Dom: </span>{o.employee?.name ?? 'Sin asignar'}</div>
                          </div>
                          {o.items && o.items.length > 0 && (
                            <div style={{ fontSize: 13, marginBottom: orderHist.length > 0 ? 10 : 0 }}>
                              <strong>Productos: </strong>
                              {o.items.map((i: any) => `${i.quantity_label ? i.quantity_label + ' ' : ''}${i.product_name}`).join(' · ')}
                            </div>
                          )}
                          {orderHist.length > 0 && (
                            <>
                              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>
                                Historial de cambios
                              </div>
                              <HistoryTable history={orderHist} />
                            </>
                          )}
                          {orderHist.length === 0 && (
                            <div style={{ fontSize: 13, color: 'var(--gt)' }}>Sin cambios registrados</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {resumenTab === 'papelera' && (
        <div style={{ padding: '4px 0' }}>
          {papeleraOrders.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gt)', fontSize: 14 }}>
              No hay pedidos en papelera hoy
            </div>
          )}
          {papeleraOrders.map((o: any) => {
            const total = o.items?.reduce((s: number, i: any) => s + Number(i.price), 0) ?? 0;
            const clientDeleted = !!o.client_deleted;
            const staffPapelera = o.status === 'papelera';
            return (
              <div key={o.id} className="papcard" onClick={() => onOpenOrder(o.id)}
                title="Ver detalle - quién lo envió a la papelera y cuándo"
                style={{ cursor: 'pointer', ...((clientDeleted || staffPapelera) ? { border: '1.5px solid var(--r)' } : {}) }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 800 }}>#{o.num} - {o.client_contact_name ?? o.customer_name}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--r)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Trash2 size={11} /> {new Date(o.updated_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' })}
                  </span>
                </div>
                {clientDeleted && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'var(--rc)', color: 'var(--r)', borderRadius: 8, padding: '5px 9px', marginBottom: 6, fontSize: 12, fontWeight: 800 }}>
                    <span>⚠ Eliminado por el cliente</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); restoreMut.mutate(o.id); }}
                      disabled={restoreMut.isPending}
                      style={{ background: 'var(--v)', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 9px', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                      Restaurar
                    </button>
                  </div>
                )}
                {staffPapelera && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'var(--rc)', color: 'var(--r)', borderRadius: 8, padding: '5px 9px', marginBottom: 6, fontSize: 12, fontWeight: 800 }}>
                    <span>⚠ Enviado a papelera por {o.papeleraBy?.name ?? 'alguien'}{o.papelera_reason ? `: ${o.papelera_reason}` : ''}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); restoreMut.mutate(o.id); }}
                      disabled={restoreMut.isPending}
                      style={{ background: 'var(--v)', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 9px', fontSize: 11, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>
                      Restaurar
                    </button>
                  </div>
                )}
                <div style={{ fontSize: 13, color: 'var(--gt)', marginBottom: 3 }}>{o.address}</div>
                <div style={{ fontSize: 13, color: 'var(--gt)' }}>
                  {o.items?.map((i: any) => `${i.quantity_label ? i.quantity_label + ' ' : ''}${i.product_name}`).join(' · ')}
                </div>
                <div style={{ fontSize: 13, marginTop: 4, fontWeight: 700 }}>
                  {fmtCOP(total)} · {PAYMENT_LABEL[o.payment_method] ?? o.payment_method}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {resumenTab === 'credito' && (
        <div style={{ padding: '4px 0' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button className={`atab${creditoSubTab === 'no_pagados' ? ' on' : ''}`} onClick={() => setCreditoSubTab('no_pagados')}>
              No pagados ({creditoNoPagados.length})
            </button>
            <button className={`atab${creditoSubTab === 'pagados' ? ' on' : ''}`} onClick={() => setCreditoSubTab('pagados')}>
              Pagados ({creditoPagados.length})
            </button>
          </div>
          <div className="sbx" style={{ margin: '0 0 12px', maxWidth: 320 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--gt)' }}>
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input type="text" placeholder="Buscar por nombre, dirección, domiciliario, fecha, monto o artículo..."
              value={creditoSearch} onChange={(e) => setCreditoSearch(e.target.value)} />
          </div>
          {(creditoSubTab === 'pagados' ? creditoPagados : creditoNoPagados).length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gt)', fontSize: 14 }}>
              {creditoSubTab === 'pagados' ? 'No hay créditos pagados' : 'No hay pedidos a crédito pendientes de pago'}
            </div>
          )}
          {(creditoSubTab === 'pagados' ? creditoPagados : creditoNoPagados).length > 0 && filteredCreditoOrders.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gt)', fontSize: 14 }}>
              Sin resultados para "{creditoSearch}"
            </div>
          )}
          {filteredCreditoOrders.map((o: any) => {
            const total = o.items?.reduce((s: number, i: any) => s + Number(i.price), 0) ?? 0;
            return (
              <div key={o.id} className="papcard" onClick={() => onOpenOrder(o.id)}
                title="Ver pedido - marcar el crédito como pagado se hace ahí"
                style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  {/* client_contact_name (the WhatsApp contact's name, snapshotted
                      at creation, never editable afterward) - not o.customer_name,
                      which staff can freely retype per-order and which a crédito
                      debt record must never silently drift away from. */}
                  <span style={{ fontSize: 14, fontWeight: 800 }}>#{o.num} - {o.client_contact_name ?? o.customer_name}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gt)' }}>
                    {o.fecha ? new Date(o.fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'America/Bogota' }) : ''}
                  </span>
                </div>
                {o.client_contact_name && o.customer_name && o.client_contact_name !== o.customer_name && (
                  <div style={{ fontSize: 11, color: 'var(--gt)', marginBottom: 3, fontStyle: 'italic' }}>
                    Pedido a nombre de: {o.customer_name}
                  </div>
                )}
                <div style={{ fontSize: 13, color: 'var(--gt)', marginBottom: 3 }}>{o.address}</div>
                {o.employee?.name && (
                  <div style={{ fontSize: 13, color: 'var(--gt)', marginBottom: 3 }}>Domiciliario: {o.employee.name}</div>
                )}
                <div style={{ fontSize: 13, color: 'var(--gt)' }}>
                  {o.items?.map((i: any) => `${i.quantity_label ? i.quantity_label + ' ' : ''}${i.product_name}`).join(' · ')}
                </div>
                <div style={{ fontSize: 13, marginTop: 4, fontWeight: 700, color: o.paid ? 'var(--v)' : '#DC2626' }}>
                  {fmtCOP(total)} · {o.paid ? 'Pagado' : 'Pendiente de pago'}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {resumenTab === 'cambios' && (
        <div style={{ padding: '4px 0' }}>
          {history.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gt)', fontSize: 14 }}>
              No hay cambios registrados
            </div>
          ) : (
            <HistoryTable history={history} showOrder />
          )}
        </div>
      )}
    </>
  );
}
