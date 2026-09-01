import { useState } from 'react';
import { Database, MessageSquare, Settings, ExternalLink, Building2, Receipt } from 'lucide-react';
import DevDbPanel from './DevDbPanel';
import DevWppPanel from './DevWppPanel';
import DevSistemaPanel from './DevSistemaPanel';
import DevLinksPanel from './DevLinksPanel';
import DevOrgsPanel from './DevOrgsPanel';
import DevBillingPanel from './DevBillingPanel';
import { OrgSelector, type DevOrg } from './OrgSelector';

// ─── DevTools sub-panels ──────────────────────────────────────────────────────

type DevTab = 'organizaciones' | 'bd' | 'wpp' | 'sistema' | 'links' | 'facturacion';

const DEV_TABS: { key: DevTab; label: string; icon: React.ReactNode }[] = [
  { key: 'organizaciones', label: 'Organizaciones', icon: <Building2 size={13} /> },
  { key: 'bd',      label: 'Base de datos', icon: <Database size={13} /> },
  { key: 'wpp',     label: 'WhatsApp',      icon: <MessageSquare size={13} /> },
  { key: 'facturacion', label: 'Facturación', icon: <Receipt size={13} /> },
  { key: 'sistema', label: 'Sistema',        icon: <Settings size={13} /> },
  { key: 'links',   label: 'Links',          icon: <ExternalLink size={13} /> },
];

export default function DevSection() {
  const [tab, setTab] = useState<DevTab>('bd');
  const [org, setOrg] = useState<DevOrg | null>(null);

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {DEV_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: `1.5px solid ${tab === t.key ? 'var(--v)' : 'var(--brd)'}`,
              background: tab === t.key ? 'var(--vc)' : 'var(--b)',
              color: tab === t.key ? 'var(--vd)' : 'var(--gt)',
              transition: 'all .12s',
            }}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* El selector de organización objetivo aplica a Base de datos y
          Facturación (ambas ahora operan sobre CUALQUIER organización, no solo
          la propia sesión del dev) - Organizaciones/WhatsApp/Sistema/Links no
          lo necesitan (la primera lista TODAS, las demás siguen atadas a la
          propia sesión, sin cambios). */}
      {(tab === 'bd' || tab === 'facturacion') && (
        <OrgSelector value={org} onChange={setOrg} />
      )}

      {tab === 'organizaciones' && <DevOrgsPanel />}
      {tab === 'bd'      && <DevDbPanel org={org} />}
      {tab === 'wpp'     && <DevWppPanel />}
      {tab === 'facturacion' && <DevBillingPanel org={org} />}
      {tab === 'sistema' && <DevSistemaPanel />}
      {tab === 'links'   && <DevLinksPanel />}
    </div>
  );
}
