import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { api } from '../../lib/api';

type ChargeType = 'suscripcion' | 'onboarding' | 'otro';

interface Charge {
  id: string;
  number: number;
  types: ChargeType[];
  period: string;
  amount: string;
  status: 'pendiente' | 'pagado';
  paid_at: string | null;
  notes: string | null;
  report_url: string | null;
}

const TYPE_LABEL: Record<ChargeType, string> = { suscripcion: 'Suscripción', onboarding: 'Onboarding', otro: 'Otro' };

// Registro de facturación de la PROPIA organización - solo lectura. Lo que
// aparece acá es exactamente lo que el operador (rol dev) generó para esta
// organización desde su Centro de mando (DevBillingPanel.tsx) - no hace
// falta ningún paso para "cargarlo" acá, la fila ya tiene el org_id correcto
// desde que se crea (ver routes/billing.ts). Más reciente primero (por mes,
// GET /billing/charges ya lo devuelve ordenado así).
export default function BillingSection() {
  const { data: charges = [], isLoading } = useQuery({
    queryKey: ['billing-charges'],
    queryFn: () => api.get<{ data: Charge[] }>('/billing/charges').then(r => r.data),
  });

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: 'var(--gt)' }}>{charges.length} factura{charges.length === 1 ? '' : 's'}</span>
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--gt)', padding: 16 }}>Cargando...</div>
      ) : charges.length === 0 ? (
        <div style={{ color: 'var(--gt)', fontSize: 14, padding: 16 }}>Todavía no hay facturas registradas.</div>
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
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, width: 'fit-content',
                background: c.status === 'pagado' ? 'var(--vc)' : 'var(--rc)',
                color: c.status === 'pagado' ? 'var(--v)' : 'var(--r)',
              }}>
                {c.status === 'pagado' ? 'Pagado' : 'Pendiente'}
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
