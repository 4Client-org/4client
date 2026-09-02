import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Check, X, FileText, Pencil, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { toast } from '../ui/Toast';
import { buildPlatformChargePdf, pdfToBase64 } from '../../lib/platformChargePdf';
import { ConfirmDialog } from './ConfirmDialog';
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
  // Valor de cada concepto por separado - null en cobros creados antes de
  // este campo (siguen mostrando solo el total, sin desglose por línea).
  amounts: Partial<Record<ChargeType, number>> | null;
  status: 'pendiente' | 'pagado';
  paid_at: string | null;
  notes: string | null;
  report_url: string | null;
}

type FormState = { types: ChargeType[]; period: string; amounts: Partial<Record<ChargeType, string>>; notes: string };

const TYPE_LABEL: Record<ChargeType, string> = { suscripcion: 'Suscripción', onboarding: 'Onboarding', otro: 'Otro' };
const TYPE_OPTIONS: ChargeType[] = ['suscripcion', 'onboarding', 'otro'];
const CYCLE_DAYS = 30;

function emptyForm(): FormState {
  return { types: ['suscripcion'], period: currentMonth(), amounts: {}, notes: '' };
}

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
  // Cuando no es null, el formulario está editando ESTE cobro en vez de
  // crear uno nuevo (necesitamos el objeto completo, no solo el id, para
  // poder regenerar el PDF con su mismo `number` real al guardar).
  const [editingCharge, setEditingCharge] = useState<Charge | null>(null);
  const [deletingCharge, setDeletingCharge] = useState<Charge | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

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

  function openCreateForm() {
    setEditingCharge(null);
    setForm(emptyForm());
    setShowForm(true);
  }

  function openEditForm(c: Charge) {
    const amounts: Partial<Record<ChargeType, string>> = {};
    for (const t of c.types) amounts[t] = String(c.amounts?.[t] ?? c.amount);
    setEditingCharge(c);
    setForm({ types: [...c.types], period: c.period, amounts, notes: c.notes ?? '' });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingCharge(null);
  }

  function toggleType(t: ChargeType) {
    setForm(f => {
      const selected = f.types.includes(t);
      const { [t]: _drop, ...restAmounts } = f.amounts;
      return {
        ...f,
        types: selected ? f.types.filter(x => x !== t) : [...f.types, t],
        // Al destildar un concepto se le borra el valor que tenía cargado -
        // si lo vuelve a marcar, empieza en blanco en vez de arrastrar un
        // valor viejo que ya no corresponde.
        amounts: selected ? restAmounts : f.amounts,
      };
    });
  }

  function setTypeAmount(t: ChargeType, value: string) {
    setForm(f => ({ ...f, amounts: { ...f.amounts, [t]: value } }));
  }

  // Suma en vivo de lo que lleva escrito - solo para mostrarle el total antes
  // de guardar (el backend vuelve a sumar por su cuenta, esto es solo para
  // que el usuario vea que cuadra).
  const totalPreview = form.types.reduce((s, t) => s + (parseFloat(form.amounts[t] ?? '') || 0), 0);
  const allAmountsValid = form.types.length > 0 && form.types.every(t => {
    const v = parseFloat(form.amounts[t] ?? '');
    return Number.isFinite(v) && v > 0;
  });

  function buildAmountsPayload(): Record<string, number> {
    const amounts: Record<string, number> = {};
    for (const t of form.types) amounts[t] = parseFloat(form.amounts[t]!);
    return amounts;
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
      if (!allAmountsValid) throw new Error('Pon un valor mayor a cero para cada concepto elegido');
      const amounts = buildAmountsPayload();
      const created = await api.post<{ data: Charge }>('/dev/charges', {
        orgId: org.id, types: form.types, period: form.period,
        amounts, notes: form.notes || undefined,
      });
      const doc = await buildPlatformChargePdf({
        number: created.data.number, orgName: org.name, types: form.types, period: form.period, amounts, notes: form.notes || null,
      });
      await api.post(`/dev/charges/${created.data.id}/pdf`, { pdf_base64: pdfToBase64(doc) });
      return created.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dev-charges'] });
      qc.invalidateQueries({ queryKey: ['dev-charges-all'] });
      closeForm();
      toast('Cobro registrado');
    },
    onError: (e: any) => toast(e.message, true),
  });

  const update = useMutation({
    // Mismo criterio de 2 pasos que crear, pero reutilizando el `number` que
    // el cobro ya tenía (no cambia al editar) - el PDF se sube a la misma key
    // en R2, así que se sobreescribe solo, sin dejar un PDF viejo huérfano.
    mutationFn: async () => {
      if (!org || !editingCharge) throw new Error('Nada que editar');
      if (form.types.length === 0) throw new Error('Elige al menos un concepto');
      if (!allAmountsValid) throw new Error('Pon un valor mayor a cero para cada concepto elegido');
      const amounts = buildAmountsPayload();
      const updated = await api.put<{ data: Charge }>(`/dev/charges/${editingCharge.id}`, {
        types: form.types, period: form.period, amounts, notes: form.notes || undefined,
      });
      const doc = await buildPlatformChargePdf({
        number: editingCharge.number, orgName: org.name, types: form.types, period: form.period, amounts, notes: form.notes || null,
      });
      await api.post(`/dev/charges/${editingCharge.id}/pdf`, { pdf_base64: pdfToBase64(doc) });
      return updated.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dev-charges'] });
      qc.invalidateQueries({ queryKey: ['dev-charges-all'] });
      closeForm();
      toast('Cobro actualizado');
    },
    onError: (e: any) => toast(e.message, true),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/dev/charges/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dev-charges'] });
      qc.invalidateQueries({ queryKey: ['dev-charges-all'] });
      setDeletingCharge(null);
      toast('Cobro eliminado');
    },
    onError: (e: any) => { toast(e.message, true); setDeletingCharge(null); },
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

  const saving = create.isPending || update.isPending;

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
        <button className="bnew" onClick={openCreateForm} disabled={showForm || !org}>
          <Plus size={14} /> Nuevo cobro
        </button>
      </div>

      {showForm && org && (
        <div style={{ background: 'var(--vc)', border: '2px solid var(--v)', borderRadius: 'var(--rad)', padding: 18, marginBottom: 18 }}>
          <div style={{ fontWeight: 800, marginBottom: 14, color: 'var(--vd)' }}>
            {editingCharge ? `Editar cobro 4C-${String(editingCharge.number).padStart(6, '0')}` : `Nuevo cobro para ${org.name}`}
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className="fl">Conceptos y su valor (elige uno o varios) *</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
              {TYPE_OPTIONS.map(t => (
                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', width: 130, flexShrink: 0 }}>
                    <input type="checkbox" checked={form.types.includes(t)} onChange={() => toggleType(t)} />
                    {TYPE_LABEL[t]}
                  </label>
                  {form.types.includes(t) && (
                    <input className="fi" type="number" min="0" style={{ maxWidth: 160 }}
                      value={form.amounts[t] ?? ''} onChange={e => setTypeAmount(t, e.target.value)} placeholder="Valor" />
                  )}
                </div>
              ))}
            </div>
            {form.types.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: 'var(--vd)' }}>
                Total: ${totalPreview.toLocaleString('es-CO')}
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label className="fl">Mes del cobro *</label>
              <input className="fi" type="month" value={form.period} onChange={e => setForm(f => ({ ...f, period: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="fl">Notas</label>
              <input className="fi" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opcional" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 9 }}>
            <button className="bpri" style={{ flex: 0, padding: '10px 22px', margin: 0 }}
              onClick={() => (editingCharge ? update.mutate() : create.mutate())}
              disabled={saving || !form.period || !allAmountsValid}>
              <Check size={14} /> {saving ? 'Guardando...' : editingCharge ? 'Guardar cambios' : 'Crear y generar PDF'}
            </button>
            <button className="bsec" style={{ flex: 0, padding: '10px 18px' }} onClick={closeForm}>
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
          {charges.map((c, i) => (
            <div key={c.id} style={{ padding: '12px 14px', borderTop: i === 0 ? 'none' : '1px solid var(--brd)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--gt)', fontFamily: 'monospace' }}>4C-{String(c.number).padStart(6, '0')}</span>
                  <span style={{ fontSize: 12, color: 'var(--gt)' }}>{c.period}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--vd)' }}>${Number(c.amount).toLocaleString('es-CO')}</span>
                  {c.status === 'pagado' ? (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'var(--vc)', color: 'var(--v)' }}>Pagado</span>
                  ) : (
                    <button className="dc-btn" title="Marcar pagado" onClick={() => markPaid.mutate(c.id)} disabled={markPaid.isPending}>
                      <Check size={12} />
                    </button>
                  )}
                  {c.report_url && (
                    <a href={c.report_url} target="_blank" rel="noreferrer noopener" className="dc-btn" title="Ver PDF" style={{ display: 'inline-flex' }}>
                      <FileText size={12} />
                    </a>
                  )}
                  <button className="dc-btn" title="Editar" onClick={() => openEditForm(c)}>
                    <Pencil size={12} />
                  </button>
                  <button className="dc-btn" title="Eliminar" onClick={() => setDeletingCharge(c)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {/* Desglose: un renglón por concepto con su propio valor - cobros
                  viejos sin `amounts` (creados antes de este campo) solo
                  muestran el total de arriba, sin desglose por línea. */}
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {c.types.map(t => (
                  <div key={t} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                    <span style={{ color: 'var(--n)' }}>{TYPE_LABEL[t] ?? t}</span>
                    <span style={{ color: 'var(--gt)' }}>
                      {c.amounts?.[t] != null ? `$${Number(c.amounts[t]).toLocaleString('es-CO')}` : '—'}
                    </span>
                  </div>
                ))}
              </div>
              {c.notes && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--gt)', fontStyle: 'italic' }}>{c.notes}</div>}
            </div>
          ))}
        </div>
      )}

      {deletingCharge && (
        <ConfirmDialog
          message={`¿Eliminar el cobro 4C-${String(deletingCharge.number).padStart(6, '0')} (${deletingCharge.types.map(t => TYPE_LABEL[t] ?? t).join(' + ')}, ${deletingCharge.period})? Esta acción no se puede deshacer.`}
          onConfirm={() => remove.mutate(deletingCharge.id)}
          onCancel={() => setDeletingCharge(null)}
        />
      )}
    </div>
  );
}
