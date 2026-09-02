import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Check, X, FileText } from 'lucide-react';
import { api } from '../../lib/api';
import { toast } from '../ui/Toast';
import { buildPlatformChargePdf, pdfToBase64 } from '../../lib/platformChargePdf';
import type { DevOrg } from './OrgSelector';

type ChargeType = 'suscripcion' | 'onboarding' | 'otro';

interface Charge {
  id: string;
  number: number;
  org_id: string;
  org: { name: string; slug: string };
  types: ChargeType[];
  period: string;
  amount: string;
  status: 'pendiente' | 'pagado';
  paid_at: string | null;
  notes: string | null;
  report_url: string | null;
}

const TYPE_LABEL: Record<ChargeType, string> = { suscripcion: 'Suscripción', onboarding: 'Onboarding', otro: 'Otro' };
const TYPE_OPTIONS: ChargeType[] = ['suscripcion', 'onboarding', 'otro'];
const CYCLE_DAYS = 30;

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Panel de recordatorio - una franja por organización activa, "al día"/"por
// vencer"/"vencida" según hace cuánto se pagó su última suscripción (o desde
// que se creó la organización si nunca ha pagado una). Se consulta al abrir
// la pestaña (v1) - no es una notificación activa (correo/push), eso sería
// infraestructura nueva que no hace falta todavía para "no acordarme de todos".
function ReminderStrip({ orgs, charges }: { orgs: DevOrg[]; charges: Charge[] }) {
  const rows = orgs.filter(o => o.active).map(org => {
    const paidSubs = charges
      .filter(c => c.org_id === org.id && c.types.includes('suscripcion') && c.status === 'pagado' && c.paid_at)
      .sort((a, b) => new Date(b.paid_at!).getTime() - new Date(a.paid_at!).getTime());
    const referenceDate = paidSubs[0]?.paid_at ?? org.created_at;
    const days = daysSince(referenceDate);
    const state = days <= 25 ? 'al día' : days <= CYCLE_DAYS ? 'por vencer' : 'vencida';
    const color = state === 'al día' ? 'var(--v)' : state === 'por vencer' ? '#D97706' : 'var(--r)';
    const bg = state === 'al día' ? 'var(--vc)' : state === 'por vencer' ? '#FEF3C7' : 'var(--rc)';
    return { org, days, state, color, bg };
  });

  if (rows.length === 0) return null;

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
      {rows.map(r => (
        <div key={r.org.id} style={{ background: r.bg, border: `1.5px solid ${r.color}`, borderRadius: 'var(--rad)', padding: '8px 12px', fontSize: 12 }}>
          <div style={{ fontWeight: 700, color: r.color }}>{r.org.name}</div>
          <div style={{ color: r.color }}>{r.state} - hace {r.days} día{r.days === 1 ? '' : 's'} de su último pago</div>
        </div>
      ))}
    </div>
  );
}

export default function DevBillingPanel({ org }: { org: DevOrg | null }) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'' | 'pendiente' | 'pagado'>('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<{ types: ChargeType[]; period: string; amount: string; notes: string }>({
    types: ['suscripcion'], period: currentMonth(), amount: '', notes: '',
  });

  const { data: orgs = [] } = useQuery({
    queryKey: ['dev-organizations'],
    queryFn: () => api.get<{ data: DevOrg[] }>('/dev/organizations').then(r => r.data),
  });

  // Todos los cobros, sin filtrar - alimenta el panel de recordatorio (necesita
  // ver TODAS las organizaciones a la vez, no solo la elegida en el selector).
  const { data: allCharges = [] } = useQuery({
    queryKey: ['dev-charges-all'],
    queryFn: () => api.get<{ data: Charge[] }>('/dev/charges').then(r => r.data),
  });

  const { data: charges = [], isLoading } = useQuery({
    queryKey: ['dev-charges', org?.id, statusFilter],
    queryFn: () => api.get<{ data: Charge[] }>(`/dev/charges?${new URLSearchParams({
      ...(org ? { orgId: org.id } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
    })}`).then(r => r.data),
    enabled: !!org,
  });

  function toggleType(t: ChargeType) {
    setForm(f => ({ ...f, types: f.types.includes(t) ? f.types.filter(x => x !== t) : [...f.types, t] }));
  }

  const create = useMutation({
    // Dos pasos: primero se crea el cobro (así existe su `number` real,
    // autoincrement en la BD) y RECIÉN con ese número se arma el PDF - antes
    // se armaba el PDF primero y se mandaba junto con la creación en una sola
    // llamada, pero eso no permitía imprimir un consecutivo de verdad (el
    // número aún no existía en ese momento).
    mutationFn: async () => {
      if (!org) throw new Error('Elige una organización primero');
      if (form.types.length === 0) throw new Error('Elige al menos un concepto');
      const amount = parseFloat(form.amount);
      const created = await api.post<{ data: Charge }>('/dev/charges', {
        orgId: org.id, types: form.types, period: form.period,
        amount, notes: form.notes || undefined,
      });
      const doc = await buildPlatformChargePdf({
        number: created.data.number, orgName: org.name, types: form.types, period: form.period, amount, notes: form.notes || null,
      });
      await api.post(`/dev/charges/${created.data.id}/pdf`, { pdf_base64: pdfToBase64(doc) });
      return created.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dev-charges'] });
      qc.invalidateQueries({ queryKey: ['dev-charges-all'] });
      setShowForm(false);
      setForm({ types: ['suscripcion'], period: currentMonth(), amount: '', notes: '' });
      toast('Cobro registrado');
    },
    onError: (e: any) => toast(e.message, true),
  });

  const markPaid = useMutation({
    mutationFn: (id: string) => api.patch(`/dev/charges/${id}`, { status: 'pagado' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dev-charges'] });
      qc.invalidateQueries({ queryKey: ['dev-charges-all'] });
      toast('Marcado como pagado');
    },
    onError: (e: any) => toast(e.message, true),
  });

  return (
    <div>
      <ReminderStrip orgs={orgs} charges={allCharges} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <select className="fi" style={{ width: 'auto', padding: '7px 12px', fontSize: 13 }}
          value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendientes</option>
          <option value="pagado">Pagados</option>
        </select>
        <button className="bnew" onClick={() => setShowForm(true)} disabled={showForm || !org}>
          <Plus size={14} /> Nuevo cobro
        </button>
      </div>

      {showForm && org && (
        <div style={{ background: 'var(--vc)', border: '2px solid var(--v)', borderRadius: 'var(--rad)', padding: 18, marginBottom: 18 }}>
          <div style={{ fontWeight: 800, marginBottom: 14, color: 'var(--vd)' }}>Nuevo cobro para {org.name}</div>
          <div style={{ marginBottom: 14 }}>
            <label className="fl">Conceptos (elige uno o varios) *</label>
            <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
              {TYPE_OPTIONS.map(t => (
                <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.types.includes(t)} onChange={() => toggleType(t)} />
                  {TYPE_LABEL[t]}
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label className="fl">Mes del cobro *</label>
              <input className="fi" type="month" value={form.period} onChange={e => setForm(f => ({ ...f, period: e.target.value }))} />
            </div>
            <div>
              <label className="fl">Valor *</label>
              <input className="fi" type="number" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="150000" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="fl">Notas</label>
              <input className="fi" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opcional" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 9 }}>
            <button className="bpri" style={{ flex: 0, padding: '10px 22px', margin: 0 }}
              onClick={() => create.mutate()} disabled={create.isPending || !form.amount || !form.period || form.types.length === 0}>
              <Check size={14} /> {create.isPending ? 'Generando...' : 'Crear y generar PDF'}
            </button>
            <button className="bsec" style={{ flex: 0, padding: '10px 18px' }} onClick={() => setShowForm(false)}>
              <X size={14} /> Cancelar
            </button>
          </div>
        </div>
      )}

      {!org ? (
        <div style={{ color: 'var(--gt)', padding: 16, fontSize: 13 }}>Elige una organización arriba para ver sus cobros.</div>
      ) : isLoading ? (
        <div style={{ color: 'var(--gt)', padding: 16 }}>Cargando...</div>
      ) : charges.length === 0 ? (
        <div style={{ color: 'var(--gt)', padding: 16, fontSize: 13 }}>Sin cobros registrados para esta organización.</div>
      ) : (
        <div style={{ border: '1.5px solid var(--brd)', borderRadius: 'var(--rad)', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 100px 110px 90px 60px', padding: '8px 14px', gap: 10, background: 'var(--gm)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--gt)' }}>
            <span>No.</span><span>Conceptos</span><span>Mes</span><span>Valor</span><span>Estado</span><span />
          </div>
          {charges.map(c => (
            <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 100px 110px 90px 60px', alignItems: 'center', padding: '10px 14px', gap: 10, borderTop: '1px solid var(--brd)' }}>
              <span style={{ fontSize: 12, color: 'var(--gt)', fontFamily: 'monospace' }}>4C-{String(c.number).padStart(6, '0')}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{c.types.map(t => TYPE_LABEL[t] ?? t).join(' + ')}</span>
              <span style={{ fontSize: 12, color: 'var(--gt)' }}>{c.period}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--vd)' }}>${Number(c.amount).toLocaleString('es-CO')}</span>
              <span>
                {c.status === 'pagado' ? (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'var(--vc)', color: 'var(--v)' }}>Pagado</span>
                ) : (
                  <button className="dc-btn" title="Marcar pagado" onClick={() => markPaid.mutate(c.id)} disabled={markPaid.isPending}>
                    <Check size={12} />
                  </button>
                )}
              </span>
              <span>
                {c.report_url && (
                  <a href={c.report_url} target="_blank" rel="noreferrer noopener" className="dc-btn" title="Ver PDF" style={{ display: 'inline-flex' }}>
                    <FileText size={12} />
                  </a>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
