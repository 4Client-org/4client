import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, ChevronRight, Unlock, MessageSquarePlus, Plus, X } from 'lucide-react';
import { api } from '../../lib/api';
import { toast } from '../ui/Toast';
import { ConfirmDialog } from './ConfirmDialog';
import type { DevOrg } from './OrgSelector';

const DB_TABLES = ['users', 'organizations', 'products', 'employees', 'orders', 'tickets', 'ticket_messages', 'order_history', 'daily_closes', 'audit_logs'];

// Acciones curadas (POST /dev/actions/*) - reemplazan los favores manuales de
// SQL (abrir/cerrar caja, crear tickets de prueba) por botones concretos.
// Deliberadamente NO hay una caja de SQL libre acá - decisión explícita: un
// SQL libre no se puede auto-limitar a una sola organización de forma segura
// una vez haya varios clientes reales compartiendo las mismas tablas.
function ActionsSection({ org }: { org: DevOrg | null }) {
  const qc = useQueryClient();
  const [confirmReopen, setConfirmReopen] = useState<string | null>(null);
  const [fecha, setFecha] = useState('');
  const [showTicketForm, setShowTicketForm] = useState(false);
  const [ticketForm, setTicketForm] = useState({ phone: '', customer_name: '', fecha: '', mensajes: [''] });

  const reopen = useMutation({
    mutationFn: (fecha: string) => api.post('/dev/actions/reopen-cierre', { orgId: org!.id, fecha }),
    onSuccess: () => { toast('Cierre reabierto'); setConfirmReopen(null); setFecha(''); qc.invalidateQueries({ queryKey: ['dev-db'] }); },
    onError: (e: any) => { toast(e.message, true); setConfirmReopen(null); },
  });

  const createTicket = useMutation({
    mutationFn: () => api.post('/dev/actions/create-test-ticket', {
      orgId: org!.id, phone: ticketForm.phone, customer_name: ticketForm.customer_name,
      fecha: ticketForm.fecha, mensajes: ticketForm.mensajes.filter(m => m.trim()),
    }),
    onSuccess: () => {
      toast('Ticket de prueba creado');
      setShowTicketForm(false);
      setTicketForm({ phone: '', customer_name: '', fecha: '', mensajes: [''] });
      qc.invalidateQueries({ queryKey: ['dev-db'] });
    },
    onError: (e: any) => toast(e.message, true),
  });

  return (
    <div style={{ background: 'var(--bg)', border: '1.5px solid var(--brd)', borderRadius: 'var(--rad)', padding: 16, marginBottom: 18 }}>
      {confirmReopen && (
        <ConfirmDialog
          message={`¿Reabrir el cierre del ${confirmReopen} para ${org?.name}? Se borra el registro de cierre de esa fecha - la app vuelve a considerar el día abierto. El registro completo queda guardado en audit_logs por si hace falta reconstruirlo.`}
          onConfirm={() => reopen.mutate(confirmReopen)}
          onCancel={() => setConfirmReopen(null)}
        />
      )}
      <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 12, color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Acciones</div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <Unlock size={14} color="var(--gt)" />
        <span style={{ fontSize: 13 }}>Reabrir cierre de una fecha:</span>
        <input className="fi" type="date" style={{ width: 'auto', padding: '6px 10px', fontSize: 13 }} value={fecha} onChange={e => setFecha(e.target.value)} />
        <button className="bsec" style={{ padding: '6px 14px', fontSize: 12 }} disabled={!fecha || !org || reopen.isPending}
          onClick={() => setConfirmReopen(fecha)}>
          Reabrir
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <MessageSquarePlus size={14} color="var(--gt)" style={{ marginTop: 6 }} />
        {!showTicketForm ? (
          <button className="bsec" style={{ padding: '6px 14px', fontSize: 12 }} disabled={!org} onClick={() => setShowTicketForm(true)}>
            Crear ticket de prueba
          </button>
        ) : (
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <input className="fi" style={{ padding: '6px 10px', fontSize: 12 }} placeholder="Teléfono (ej: 573001112233)"
                value={ticketForm.phone} onChange={e => setTicketForm(f => ({ ...f, phone: e.target.value }))} />
              <input className="fi" style={{ padding: '6px 10px', fontSize: 12 }} placeholder="Nombre del cliente"
                value={ticketForm.customer_name} onChange={e => setTicketForm(f => ({ ...f, customer_name: e.target.value }))} />
              <input className="fi" type="date" style={{ padding: '6px 10px', fontSize: 12 }}
                value={ticketForm.fecha} onChange={e => setTicketForm(f => ({ ...f, fecha: e.target.value }))} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--gt)', marginBottom: 4 }}>Mensajes de prueba (entrantes):</div>
            {ticketForm.mensajes.map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input className="fi" style={{ padding: '6px 10px', fontSize: 12, flex: 1 }} placeholder={`Mensaje ${i + 1}`}
                  value={m} onChange={e => setTicketForm(f => ({ ...f, mensajes: f.mensajes.map((x, j) => j === i ? e.target.value : x) }))} />
                {ticketForm.mensajes.length > 1 && (
                  <button className="dc-btn" onClick={() => setTicketForm(f => ({ ...f, mensajes: f.mensajes.filter((_, j) => j !== i) }))}><X size={12} /></button>
                )}
              </div>
            ))}
            <button className="dc-btn" title="Agregar mensaje" style={{ marginBottom: 10 }}
              onClick={() => setTicketForm(f => ({ ...f, mensajes: [...f.mensajes, ''] }))}>
              <Plus size={12} />
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="bpri" style={{ flex: 0, padding: '7px 16px', margin: 0, fontSize: 12 }}
                disabled={!ticketForm.phone || !ticketForm.customer_name || !ticketForm.fecha || createTicket.isPending}
                onClick={() => createTicket.mutate()}>
                {createTicket.isPending ? 'Creando...' : 'Crear'}
              </button>
              <button className="bsec" style={{ flex: 0, padding: '7px 14px', fontSize: 12 }} onClick={() => setShowTicketForm(false)}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DevDbPanel({ org }: { org: DevOrg | null }) {
  const [table, setTable] = useState('users');
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const limit = 20;

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['dev-db', table, offset, org?.id],
    queryFn: () => api.get<{ data: any[]; total: number }>(`/dev/db?table=${table}&limit=${limit}&offset=${offset}${org ? `&orgId=${org.id}` : ''}`).then(r => r),
    staleTime: 0,
    enabled: !!org,
  });

  const allRows: any[] = (data as any)?.data ?? [];
  const rows = search
    ? allRows.filter(row => Object.values(row).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))
    : allRows;
  const total: number = (data as any)?.total ?? 0;
  const cols = allRows.length > 0 ? Object.keys(allRows[0]) : [];
  const SECRET_COLS = new Set(['password_hash', 'token_hash', 'wpp_meta_token', 'wpp_meta_app_secret']);

  function fmtVal(col: string, val: any): string {
    if (val === null || val === undefined) return '-';
    if (SECRET_COLS.has(col)) return '••••••••';
    if (typeof val === 'boolean') return val ? 'Sí' : 'No';
    const s = String(val);
    return s.length > 60 ? s.slice(0, 57) + '...' : s;
  }

  return (
    <div>
      <ActionsSection org={org} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          className="fi"
          style={{ width: 'auto', padding: '7px 12px', fontSize: 13 }}
          value={table}
          onChange={e => { setTable(e.target.value); setOffset(0); setSearch(''); }}>
          {DB_TABLES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          className="fi"
          style={{ width: 180, padding: '7px 12px', fontSize: 13 }}
          placeholder="Filtrar filas..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button className="bsec" style={{ padding: '7px 14px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }} onClick={() => refetch()} disabled={!org}>
          <RotateCcw size={12} />{isFetching ? 'Cargando...' : 'Refrescar'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--gt)' }}>
          {search ? `${rows.length} de ${allRows.length} filas (${total} total)` : `${total} filas totales`}
        </span>
      </div>

      {!org ? (
        <div style={{ color: 'var(--gt)', padding: 16, fontSize: 13 }}>Elige una organización arriba.</div>
      ) : isLoading ? (
        <div style={{ color: 'var(--gt)', padding: 16 }}>Cargando...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: 'var(--gt)', padding: 16, fontSize: 13 }}>Sin datos en esta tabla.</div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--brd)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace' }}>
            <thead>
              <tr style={{ background: 'var(--gm)' }}>
                {cols.map(c => (
                  <th key={c} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: 'var(--gt)', borderBottom: '1px solid var(--brd)', whiteSpace: 'nowrap' }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--brd)', background: i % 2 === 0 ? 'var(--b)' : 'var(--bg)' }}>
                  {cols.map(c => {
                    const display = fmtVal(c, row[c]);
                    const isSecret = SECRET_COLS.has(c);
                    return (
                      <td
                        key={c}
                        title={isSecret ? '(oculto)' : String(row[c] ?? '')}
                        style={{ padding: '7px 12px', color: isSecret ? 'var(--gt)' : 'var(--n)', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <button className="bsec" style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
          disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
          <ChevronRight size={12} style={{ transform: 'rotate(180deg)' }} /> Anterior
        </button>
        <span style={{ fontSize: 12, color: 'var(--gt)' }}>
          {rows.length > 0 ? `${offset + 1}–${offset + rows.length} de ${total}` : '0 resultados'}
        </span>
        <button className="bsec" style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
          disabled={rows.length < limit} onClick={() => setOffset(offset + limit)}>
          Siguiente <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}
