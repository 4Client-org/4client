import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Building2 } from 'lucide-react';
import { api } from '../../lib/api';

export interface DevOrg {
  id: string;
  name: string;
  slug: string;
  plan: string;
  active: boolean;
  created_at: string;
  _count: { users: number };
}

interface Props {
  value: DevOrg | null;
  onChange: (org: DevOrg) => void;
}

// Selector de "organización objetivo" para DevTools - todo bajo /dev/* está
// gateado a role==='dev' (el operador de la plataforma, no un tenant), así
// que cada panel (BD, acciones, facturación) opera sobre la organización
// elegida acá en vez de asumir siempre la propia sesión del dev. Mismo patrón
// de dropdown propio (portal + position:fixed) que CategoryPicker
// (config/ProductsSection.tsx) y EnviarCatalogoMenu.tsx - reutilizado a
// propósito, no reinventado.
export function OrgSelector({ value, onChange }: Props) {
  const { data: orgs = [] } = useQuery({
    queryKey: ['dev-organizations'],
    queryFn: () => api.get<{ data: DevOrg[] }>('/dev/organizations').then(r => r.data),
    staleTime: 30_000,
  });

  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Por defecto, la primera organización que llegue (normalmente la propia
  // del dev, más reciente o única al principio) - una vez el dev elige una,
  // esto ya no vuelve a pisar su elección.
  useEffect(() => {
    if (!value && orgs.length > 0) onChange(orgs[0]);
  }, [orgs, value, onChange]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setCoords({ top: r.bottom + 4, left: r.left });
    };
    reposition();
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onScrollOrResize() { reposition(); }
    document.addEventListener('mousedown', onClickOutside);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gt)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 5 }}>
        Organización objetivo
      </div>
      <button ref={btnRef} type="button" onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', minWidth: 260,
          border: '1.5px solid var(--v)', borderRadius: 'var(--rad)', background: 'var(--vc)',
          color: 'var(--vd)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
        }}>
        <Building2 size={14} />
        <span style={{ flex: 1, textAlign: 'left' }}>{value ? value.name : 'Cargando...'}</span>
        <ChevronDown size={13} />
      </button>
      {open && coords && createPortal(
        <div ref={menuRef} style={{
          position: 'fixed', top: coords.top, left: coords.left, zIndex: 1000, minWidth: 260,
          background: 'var(--b)', border: '1px solid var(--brd)', borderRadius: 'var(--rad)',
          boxShadow: 'var(--shf)', padding: 6, maxHeight: 320, overflowY: 'auto',
        }}>
          {orgs.map(org => (
            <button key={org.id} type="button"
              onClick={() => { onChange(org); setOpen(false); }}
              onMouseDown={e => e.preventDefault()}
              style={{
                display: 'block', width: '100%', textAlign: 'left', border: 'none', borderRadius: 6,
                padding: '8px 10px', fontSize: 13, cursor: 'pointer', color: 'var(--n)',
                background: value?.id === org.id ? 'var(--vc)' : 'none',
              }}>
              <div style={{ fontWeight: 700 }}>{org.name}{!org.active && ' (inactiva)'}</div>
              <div style={{ fontSize: 11, color: 'var(--gt)' }}>{org.slug} · {org._count.users} usuario{org._count.users === 1 ? '' : 's'}</div>
            </button>
          ))}
          {orgs.length === 0 && <div style={{ fontSize: 12, color: 'var(--gt)', padding: '6px 8px' }}>Sin organizaciones</div>}
        </div>,
        document.body
      )}
    </div>
  );
}
