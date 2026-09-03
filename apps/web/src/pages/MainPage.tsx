import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ClipboardList, BarChart2, MessageSquare, Settings, AlertTriangle, Menu,
} from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { useOrders } from '../hooks/useOrders';
import { useDashboard } from '../hooks/useDashboard';
import { useDiaCerrado } from '../hooks/useCierre';
import { api } from '../lib/api';
import { todayStr } from '../lib/format';
import { getSocket, disconnectSocket } from '../lib/socket';
import { isDevEnvironment } from '../lib/apiBase';
import { useIdleLogout } from '../hooks/useIdleLogout';
import { useQueryClient } from '@tanstack/react-query';
import Swimlane from '../components/orders/Swimlane';
import NuevoPedidoModal from '../components/modals/NuevoPedidoModal';
import TicketModal from '../components/modals/TicketModal';
import CierreCajaModal from '../components/modals/CierreCajaModal';
import DetallePedidoModal from '../components/modals/DetallePedidoModal';
import InboxPanel from '../components/inbox/InboxPanel';
import ResumenTab from '../components/dashboard/ResumenTab';
import ConfigTab from '../components/config/ConfigTab';
import Toast from '../components/ui/Toast';
import DatePickerES from '../components/ui/DatePickerES';
import type { TomarListaItem } from '../hooks/useTomarLista';

interface Ticket {
  id: string; phone: string; customer_name: string;
  unread_count: number; last_message_at: string;
  messages: { text: string; direction: string; created_at?: string }[];
  orders: { id: string; num: string; status: string; paid: boolean }[];
}

export default function MainPage() {
  useIdleLogout();
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAdmin = user?.role === 'admin' || user?.role === 'dev';
  const canManage = user?.role === 'admin' || user?.role === 'encargado' || user?.role === 'dev';
  const qc = useQueryClient();

  const [fecha, setFecha] = useState(todayStr());
  const [tab, setTab] = useState<'swimlane' | 'inbox' | 'resumen' | 'config'>('swimlane');
  const [search, setSearch] = useState('');
  const [showCierre, setShowCierre] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [openOrderPrefillItems, setOpenOrderPrefillItems] = useState<TomarListaItem[] | undefined>(undefined);
  const [fromTicket, setFromTicket] = useState<{ ticketId: string; nombre: string; phone: string; messages: any[]; prefillItems?: TomarListaItem[] } | null>(null);

  // Menú hamburguesa del header en celular - reemplaza la fila horizontal de
  // pestañas (que ahí no cabe ni en modo solo-ícono) por una lista vertical,
  // armada del mismo `tabItems` de abajo (ver su comentario - misma fuente,
  // mismo filtro por rol).
  const [navOpen, setNavOpen] = useState(false);
  const navMenuRef = useRef<HTMLDivElement>(null);
  const navBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!navOpen) return;
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (navMenuRef.current?.contains(target) || navBtnRef.current?.contains(target)) return;
      setNavOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [navOpen]);

  const { data: orders = [], isLoading: loadingOrders } = useOrders(fecha);
  const { data: dashboard } = useDashboard(fecha, isAdmin);
  const { data: cierreStatus } = useDiaCerrado(fecha);
  const diaCerrado = cierreStatus?.cerrado ?? false;

  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets', fecha],
    queryFn: () => api.get<{ data: any[] }>(`/tickets?fecha=${fecha}`).then((r) => r.data),
  });

  // Same queryKey InboxPanel uses for its ticket list - sharing the cache means the
  // floating badge always reflects real per-ticket unread_count (server only resets it
  // to 0 once staff actually sends a reply, not just from opening the conversation),
  // and stays live since both onTicketMessage/onTicketUnread below already invalidate it.
  const { data: inboxTickets = [] } = useQuery({
    queryKey: ['inbox'],
    queryFn: () => api.get<{ data: any[] }>('/inbox').then((r) => r.data),
    // isAdmin only - Chats WPP was briefly opened to encargado too, reverted by
    // explicit decision (backend inbox.ts's GET / matches, requireRole('admin')).
    enabled: isAdmin,
  });
  const unreadWpp = inboxTickets.reduce((s: number, t: any) => s + (t.unread_count || 0), 0);

  useEffect(() => {
    if (!accessToken) return;
    const socket = getSocket(accessToken);
    const joinRooms = () => {
      socket.emit('join:org', user?.orgId ?? '');
      socket.emit('join:date', fecha);
    };
    joinRooms();
    // socket.io reconnects the transport on its own after a network blip, a backgrounded
    // phone tab waking up, or a server redeploy - but it does NOT re-run app-level room
    // joins on its own. Without this, the socket comes back "connected" yet silently stops
    // receiving org/date-scoped events (ticket:message included) until something else
    // (e.g. an accessToken change) happens to re-run this whole effect - which is exactly
    // the "messages don't arrive until I refresh" symptom.
    socket.on('connect', joinRooms);

    // Informe del día (dashboard) has its own totals/status counts computed
    // server-side - it must be invalidated on every event that can change them,
    // same as orders/tickets, or it silently drifts out of sync with the board.
    socket.on('order:created', () => {
      qc.invalidateQueries({ queryKey: ['orders', fecha] });
      qc.invalidateQueries({ queryKey: ['tickets', fecha] }); // re-link order to ticket row
      qc.invalidateQueries({ queryKey: ['dashboard', fecha] });
    });
    socket.on('order:updated', () => {
      qc.invalidateQueries({ queryKey: ['orders', fecha] });
      qc.invalidateQueries({ queryKey: ['tickets', fecha] });
      qc.invalidateQueries({ queryKey: ['dashboard', fecha] });
    });
    socket.on('order:moved', () => {
      qc.invalidateQueries({ queryKey: ['orders', fecha] });
      qc.invalidateQueries({ queryKey: ['dashboard', fecha] });
    });
    socket.on('order:paid', () => {
      qc.invalidateQueries({ queryKey: ['orders', fecha] });
      qc.invalidateQueries({ queryKey: ['dashboard', fecha] });
    });
    const onTicketMessage = (data: { ticketId: string; message?: { direction?: string } }) => {
      qc.invalidateQueries({ queryKey: ['tickets', fecha] });
      qc.invalidateQueries({ queryKey: ['inbox'] });
      qc.invalidateQueries({ queryKey: ['dashboard', fecha] });
      if (data?.ticketId) {
        qc.invalidateQueries({ queryKey: ['inbox-convo', data.ticketId] });
        qc.invalidateQueries({ queryKey: ['ticket', data.ticketId] });
      }
    };
    const onTicketUnread = () => {
      qc.invalidateQueries({ queryKey: ['tickets', fecha] });
      qc.invalidateQueries({ queryKey: ['inbox'] });
      qc.invalidateQueries({ queryKey: ['dashboard', fecha] });
    };
    // Cierre touches whichever orders/tickets it closes/defers, which can span the
    // fecha being closed AND wherever deferred orders land (tomorrow) - not just
    // whatever date this browser happens to be looking at right now, so this
    // invalidates every cached date instead of only `fecha`.
    const onCierreDone = () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['cierre-status'] });
    };

    socket.on('ticket:message', onTicketMessage);
    socket.on('ticket:unread', onTicketUnread);
    socket.on('cierre:done', onCierreDone);

    return () => {
      socket.off('connect', joinRooms);
      socket.off('order:created');
      socket.off('order:updated');
      socket.off('order:moved');
      socket.off('order:paid');
      socket.off('ticket:message', onTicketMessage);
      socket.off('ticket:unread', onTicketUnread);
      socket.off('cierre:done', onCierreDone);
    };
  }, [accessToken, fecha]);

  async function handleLogout() {
    await api.post('/auth/logout', {}).catch(() => {});
    disconnectSocket();
    clearAuth();
  }

  // Always opens a blank NuevoPedidoModal - staff clicking "crear pedido" on the
  // platform means "start a new one," full stop, even if the ticket already has
  // an active order. (The dedup-reopen-existing behavior stays, deliberately,
  // on the CLIENT's own form-link side - ClientFormPage's resolveTarget - since
  // that's a different actor with a different risk: a client resubmitting the
  // same link shouldn't accidentally create a duplicate. Staff explicitly
  // choosing to create another one is a distinct, intentional action.)
  function handleCreateFromTicket(ticket: Ticket, prefillItems?: TomarListaItem[]) {
    setFromTicket({
      ticketId: ticket.id,
      nombre: ticket.customer_name,
      phone: ticket.phone,
      messages: ticket.messages ?? [],
      prefillItems,
    });
  }

  // "Tomar lista" from TicketModal, merging into an existing order (see
  // TicketModal's own onOpenOrder call) - stored separately from openOrderId
  // itself so a normal "abrir pedido" click elsewhere never carries stale items.
  function handleOpenOrderWithPrefill(orderId: string, prefillItems?: TomarListaItem[]) {
    setOpenOrderId(orderId);
    setOpenOrderPrefillItems(prefillItems);
  }

  const totalPedidos = orders.length;
  const pendientes = orders.filter((o: any) => !['cerrado', 'papelera'].includes(o.status)).length;
  const papeleraOrders: any[] = dashboard?.papeleraOrders ?? [];
  const history: any[] = dashboard?.history ?? [];

  // Única fuente de verdad de qué pestañas existen y quién las ve - tanto la
  // fila horizontal (desktop/tablet) como el menú hamburguesa de celular (ver
  // más abajo y .nav-hamburger/.nav-menu en global.css) se arman a partir de
  // ESTE mismo arreglo ya filtrado por rol. Un encargado/domiciliario nunca
  // llega a ver Chats WPP/Informe/Configuración en NINGUNA de las 2
  // presentaciones porque ninguna las arma por su cuenta - ambas simplemente
  // recorren esta lista.
  const tabItems: { key: typeof tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: 'swimlane', label: 'Tickets & Pedidos', icon: <ClipboardList size={15} /> },
    ...(isAdmin ? [{ key: 'inbox' as const, label: 'Chats WPP', icon: <MessageSquare size={15} />, badge: unreadWpp }] : []),
    ...(isAdmin ? [{ key: 'resumen' as const, label: 'Informe del día', icon: <BarChart2 size={15} /> }] : []),
    ...(isAdmin ? [{ key: 'config' as const, label: 'Configuración', icon: <Settings size={15} /> }] : []),
  ];

  return (
    <div className="al">
      <header className="ah">
        <div className="ht">
          <div className="hleft">
            <div className="hlogo">
              <img src="/fruver-san-gabriel.jpeg" alt="Fruver San Gabriel" style={{ height: 34, objectFit: 'contain' }} />
            </div>
            {isDevEnvironment() && (
              // Tamaño/padding se achican en celular vía .dev-badge en global.css -
              // el color/fondo se queda inline porque no cambia con el viewport.
              <div className="dev-badge" style={{
                background: '#DC2626', color: '#fff', fontWeight: 900, fontSize: 15,
                padding: '4px 40px', minWidth: 140, borderRadius: 8, letterSpacing: '2px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                DEV
              </div>
            )}
            {/* En celular esto se reemplaza por el botón hamburguesa + menú de
                abajo (mismo tabItems) - ver .tabs/.nav-hamburger en global.css. */}
            <div className="tabs">
              {tabItems.map(t => (
                <button key={t.key} className={`tab${tab === t.key ? ' on' : ''}`} onClick={() => setTab(t.key)} title={t.label}>
                  {t.icon} <span className="tab-label">{t.label}</span>
                  {!!t.badge && (
                    <span style={{
                      position: 'absolute', top: 7, right: 6,
                      minWidth: 16, height: 16, background: '#DC2626', borderRadius: 10,
                      color: '#fff', fontSize: 9, fontWeight: 800,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
                    }}>
                      {t.badge > 99 ? '99+' : t.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <button ref={navBtnRef} className="nav-hamburger" onClick={() => setNavOpen(o => !o)} title="Menú">
              <Menu size={19} />
              {unreadWpp > 0 && <span className="nav-hamburger-dot" />}
            </button>
            {navOpen && (
              <div ref={navMenuRef} className="nav-menu">
                {tabItems.map(t => (
                  <button key={t.key} className={`nav-menu-item${tab === t.key ? ' on' : ''}`}
                    onClick={() => { setTab(t.key); setNavOpen(false); }}>
                    {t.icon} {t.label}
                    {!!t.badge && <span className="nav-menu-badge">{t.badge > 99 ? '99+' : t.badge}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="hright">
            <div className="huser">
              <div className={`uav${canManage ? ' adm' : ''}`}>{user?.name?.[0]?.toUpperCase() ?? 'U'}</div>
              <div>
                <div className="un">{user?.name}</div>
                <div className="ur2">
                  {user?.role === 'dev' ? 'Dev' : isAdmin ? 'Administrador' : canManage ? 'Encargado' : 'Domiciliario'}
                </div>
              </div>
            </div>
            <button className="bout" onClick={handleLogout}>Salir</button>
          </div>
        </div>
      </header>

      {isAdmin && todayStr().endsWith('-01') && (
        <div style={{
          background: '#FEE2E2', borderBottom: '2px solid #F87171', color: '#991B1B',
          padding: '8px 16px', fontSize: 13, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, textAlign: 'center',
        }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          Hoy es día 1 - recuerda pagar la suscripción de 4Client para que el sistema no se deshabilite.
        </div>
      )}

      <div className={`ac${tab === 'inbox' ? ' inbox-mode' : ' wm'}`}>
        {tab === 'swimlane' && (
          <>
            <div className="khead" style={{ paddingTop: 'var(--ac-pad)' }}>
              <div>
                <div className="ktit">Tickets & Pedidos de despacho</div>
                <div className="kmeta">
                  {loadingOrders ? 'Cargando...' : `${totalPedidos} pedidos · ${pendientes} pendientes`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <DatePickerES value={fecha} onChange={setFecha} />
                <div className="sbx" style={{ minWidth: 160 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--gt)' }}>
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <input type="text" placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </div>
            </div>

            <Swimlane
              fecha={fecha}
              tickets={tickets}
              orders={orders}
              search={search}
              diaCerrado={diaCerrado}
              onOpenTicket={(id) => setTicketId(id)}
              onCreateFromTicket={handleCreateFromTicket}
            />
          </>
        )}

        {tab === 'inbox' && isAdmin && (
          <>
            <div className="khead" style={{ marginBottom: 0, flexShrink: 0, paddingTop: 'var(--ac-pad)' }}>
              <div>
                <div className="ktit">Chats WhatsApp</div>
                <div className="kmeta">Bandeja de entrada - todas las conversaciones</div>
              </div>
            </div>
            <InboxPanel />
          </>
        )}

        {tab === 'resumen' && isAdmin && (
          <div style={{ paddingTop: 'var(--ac-pad)' }}>
            <ResumenTab
              fecha={fecha}
              setFecha={setFecha}
              dashboard={dashboard}
              papeleraOrders={papeleraOrders}
              creditoOrders={dashboard?.creditoOrders ?? []}
              history={history}
              orders={orders}
              onCierreCaja={() => setShowCierre(true)}
              onOpenOrder={(orderId) => setOpenOrderId(orderId)}
            />
          </div>
        )}

        {tab === 'config' && isAdmin && <div style={{ paddingTop: 'var(--ac-pad)' }}><ConfigTab /></div>}
      </div>

      {fromTicket && (
        <NuevoPedidoModal
          fecha={fecha}
          ticketId={fromTicket.ticketId}
          preNombre={fromTicket.nombre}
          prePhone={fromTicket.phone}
          messages={fromTicket.messages}
          prefillItems={fromTicket.prefillItems}
          onClose={() => setFromTicket(null)}
        />
      )}
      {ticketId && (
        <TicketModal
          ticketId={ticketId}
          fecha={fecha}
          onClose={() => setTicketId(null)}
          onCreateFromTicket={handleCreateFromTicket}
          onOpenOrder={(orderId, prefillItems) => { setTicketId(null); handleOpenOrderWithPrefill(orderId, prefillItems); }}
        />
      )}
      {openOrderId && (
        <DetallePedidoModal
          orderId={openOrderId}
          prefillItems={openOrderPrefillItems}
          onClose={() => { setOpenOrderId(null); setOpenOrderPrefillItems(undefined); }}
        />
      )}
      {showCierre && (
        <CierreCajaModal fecha={fecha} orders={orders} tickets={tickets} onClose={() => setShowCierre(false)} />
      )}
      <Toast />
    </div>
  );
}
