import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Check, X, Copy } from 'lucide-react';
import { api } from '../../lib/api';
import { toast } from '../ui/Toast';
import type { DevOrg } from './OrgSelector';

interface CreatedCreds {
  organization: { id: string; name: string; slug: string };
  admin: { email: string; password: string };
}

// Alta de organizaciones (clientes nuevos) - solo rol dev. Crea la
// Organization + su primer usuario admin en un solo paso (backend:
// POST /dev/organizations) para no tener que tocar Railway/la BD a mano cada
// vez. El cliente entra con esas credenciales y configura su propio
// WhatsApp/productos con las pantallas que ya existen (DevWppPanel,
// ProductsSection) - esto no cambia nada de esas pantallas.
export default function DevOrgsPanel() {
  const qc = useQueryClient();
  const { data: orgs = [], isLoading } = useQuery({
    queryKey: ['dev-organizations'],
    queryFn: () => api.get<{ data: DevOrg[] }>('/dev/organizations').then(r => r.data),
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', admin_name: '', admin_email: '', admin_password: '' });
  const [created, setCreated] = useState<CreatedCreds | null>(null);

  const create = useMutation({
    mutationFn: () => api.post<{ data: CreatedCreds }>('/dev/organizations', form).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['dev-organizations'] });
      setCreated(data);
      setShowForm(false);
      setForm({ name: '', admin_name: '', admin_email: '', admin_password: '' });
    },
    onError: (e: any) => toast(e.message, true),
  });

  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => toast('Copiado'));
  }

  return (
    <div>
      {created && (
        <div style={{ background: 'var(--vc)', border: '2px solid var(--v)', borderRadius: 'var(--rad)', padding: 18, marginBottom: 18 }}>
          <div style={{ fontWeight: 800, color: 'var(--vd)', marginBottom: 8 }}>
            Organización creada - guarda estas credenciales, no se vuelven a mostrar
          </div>
          <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'monospace' }}>
            <div>Organización: <b>{created.organization.name}</b> ({created.organization.slug})</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Correo: <b>{created.admin.email}</b>
              <button className="dc-btn" title="Copiar correo" onClick={() => copy(created.admin.email)}><Copy size={11} /></button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Contraseña: <b>{created.admin.password}</b>
              <button className="dc-btn" title="Copiar contraseña" onClick={() => copy(created.admin.password)}><Copy size={11} /></button>
            </div>
          </div>
          <button className="bsec" style={{ marginTop: 12, padding: '6px 14px', fontSize: 12 }} onClick={() => setCreated(null)}>Entendido</button>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: 'var(--gt)' }}>{orgs.length} organizaciones</span>
        <button className="bnew" onClick={() => setShowForm(true)} disabled={showForm}>
          <Plus size={14} /> Nueva organización
        </button>
      </div>

      {showForm && (
        <div style={{ background: 'var(--vc)', border: '2px solid var(--v)', borderRadius: 'var(--rad)', padding: 18, marginBottom: 18 }}>
          <div style={{ fontWeight: 800, marginBottom: 14, color: 'var(--vd)' }}>Nueva organización</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label className="fl">Nombre del negocio *</label>
              <input className="fi" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ej: Fruver de Pepito" autoFocus />
            </div>
            <div>
              <label className="fl">Nombre del admin *</label>
              <input className="fi" value={form.admin_name} onChange={e => setForm(f => ({ ...f, admin_name: e.target.value }))}
                placeholder="Ej: Pepito Pérez" />
            </div>
            <div>
              <label className="fl">Correo del admin *</label>
              <input className="fi" type="email" value={form.admin_email} onChange={e => setForm(f => ({ ...f, admin_email: e.target.value }))}
                placeholder="admin@negocio.com" />
            </div>
            <div>
              <label className="fl">Contraseña (mín. 12, mayús+minús+número) *</label>
              <input className="fi" value={form.admin_password} onChange={e => setForm(f => ({ ...f, admin_password: e.target.value }))}
                placeholder="••••••••••••" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 9 }}>
            <button className="bpri" style={{ flex: 0, padding: '10px 22px', margin: 0 }}
              onClick={() => create.mutate()} disabled={create.isPending || !form.name.trim() || !form.admin_name.trim() || !form.admin_email.trim() || !form.admin_password}>
              <Check size={14} /> {create.isPending ? 'Creando...' : 'Crear organización'}
            </button>
            <button className="bsec" style={{ flex: 0, padding: '10px 18px' }} onClick={() => setShowForm(false)}>
              <X size={14} /> Cancelar
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div style={{ color: 'var(--gt)', padding: 16 }}>Cargando...</div>
      ) : (
        <div style={{ border: '1.5px solid var(--brd)', borderRadius: 'var(--rad)', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 90px 90px 140px', padding: '8px 14px', gap: 10, background: 'var(--gm)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--gt)' }}>
            <span>Nombre</span><span>Slug</span><span>Plan</span><span>Usuarios</span><span>Creada</span>
          </div>
          {orgs.map(org => (
            <div key={org.id} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 90px 90px 140px', alignItems: 'center', padding: '10px 14px', gap: 10, borderTop: '1px solid var(--brd)', opacity: org.active ? 1 : 0.55 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{org.name}{!org.active && ' (inactiva)'}</span>
              <span style={{ fontSize: 12, color: 'var(--gt)', fontFamily: 'monospace' }}>{org.slug}</span>
              <span style={{ fontSize: 12, color: 'var(--gt)' }}>{org.plan}</span>
              <span style={{ fontSize: 12, color: 'var(--gt)' }}>{org._count.users}</span>
              <span style={{ fontSize: 12, color: 'var(--gt)' }}>{new Date(org.created_at).toLocaleDateString('es-CO')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
