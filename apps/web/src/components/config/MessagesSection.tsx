import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { toast } from '../ui/Toast';
import { useMessageTemplates, MessageTemplates } from '../../hooks/useMessageTemplates';

// Mensajes que el staff manda desde el chat. Admin y dev los editan para su
// propia org. El de bienvenida es el automático del primer mensaje del día;
// los otros tres salen con botones (Formulario, Cuenta banco).
const FIELDS: { key: keyof MessageTemplates; label: string; hint: string }[] = [
  { key: 'form_warning', label: 'Aviso al enviar el formulario', hint: 'Primer mensaje al tocar "Formulario". Incluye los datos de la cuenta si quieres que vayan con el aviso.' },
  { key: 'form_followup', label: 'Seguimiento del formulario', hint: 'Tercer mensaje, justo después del link del formulario.' },
  { key: 'bank_account', label: 'Cuenta bancaria', hint: 'Lo que se manda al tocar "Cuenta banco" en el chat.' },
];

const btnStyle = { width: 'auto', padding: '9px 18px', marginTop: 0, fontSize: 14 };
const secStyle = { padding: '9px 14px', fontSize: 13, background: 'none', border: '1px solid var(--brd)', borderRadius: 8, cursor: 'pointer', color: 'var(--gt)' };

const areaStyle = { width: '100%', padding: '9px 12px', border: '1px solid var(--brd)', borderRadius: 8, fontSize: 14, background: 'var(--bg)', color: 'var(--n)', minHeight: 90, resize: 'vertical' as const };

export default function MessagesSection() {
  const qc = useQueryClient();
  const { data: templates, isLoading } = useMessageTemplates();
  const { data: org } = useQuery({
    queryKey: ['config-org'],
    queryFn: () => api.get<{ data: any }>('/config/org').then(r => r.data),
  });
  const { data: defaults } = useQuery({
    queryKey: ['message-templates-defaults'],
    queryFn: () => api.get<{ data: { defaults: MessageTemplates } }>('/config/message-templates').then(r => r.data.defaults),
    staleTime: Infinity,
  });

  const [drafts, setDrafts] = useState<Partial<Record<keyof MessageTemplates | 'welcome_message', string>>>({});
  const value = (key: keyof MessageTemplates) => drafts[key] ?? templates?.[key] ?? '';
  const welcome = drafts.welcome_message ?? org?.welcome_message ?? '';

  const saveTemplates = useMutation({
    mutationFn: (data: Partial<Record<keyof MessageTemplates, string | null>>) => api.put('/config/message-templates', data),
    onSuccess: () => {
      toast('Mensajes guardados');
      qc.invalidateQueries({ queryKey: ['message-templates'] });
    },
    onError: (e: any) => toast(e.message ?? 'No se pudieron guardar los mensajes', true),
  });

  const saveWelcome = useMutation({
    mutationFn: (text: string) => api.patch('/config/wpp', { welcome_message: text || null }),
    onSuccess: () => {
      toast('Mensaje de bienvenida guardado');
      qc.invalidateQueries({ queryKey: ['config-org'] });
    },
    onError: (e: any) => toast(e.message ?? 'No se pudo guardar la bienvenida', true),
  });

  function restore(key: keyof MessageTemplates) {
    // null borra la clave guardada y el servidor vuelve al texto por defecto.
    saveTemplates.mutate({ [key]: null });
    setDrafts(d => { const n = { ...d }; delete n[key]; return n; });
  }

  if (isLoading) return <div style={{ color: 'var(--gt)' }}>Cargando...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 680 }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>Mensaje de bienvenida</div>
        <div style={{ fontSize: 12, color: 'var(--gt)', marginBottom: 8 }}>Se envía al primer mensaje del día de cada cliente. Vacío = desactivado.</div>
        <textarea style={areaStyle} value={welcome} onChange={e => setDrafts(d => ({ ...d, welcome_message: e.target.value }))} />
        <button className="bpri" style={{ ...btnStyle, marginTop: 8 }} disabled={saveWelcome.isPending}
          onClick={() => saveWelcome.mutate(welcome.trim())}>
          {saveWelcome.isPending ? 'Guardando...' : 'Guardar bienvenida'}
        </button>
      </div>

      {FIELDS.map(f => {
        const isDefault = templates?.[f.key] === defaults?.[f.key];
        return (
          <div key={f.key}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>{f.label}</div>
            <div style={{ fontSize: 12, color: 'var(--gt)', marginBottom: 8 }}>{f.hint}</div>
            <textarea style={areaStyle} value={value(f.key)} onChange={e => setDrafts(d => ({ ...d, [f.key]: e.target.value }))} />
            <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center' }}>
              <button className="bpri" style={btnStyle} disabled={saveTemplates.isPending || !value(f.key).trim()}
                onClick={() => saveTemplates.mutate({ [f.key]: value(f.key).trim() })}>
                {saveTemplates.isPending ? 'Guardando...' : 'Guardar'}
              </button>
              {!isDefault && defaults && (
                <button style={secStyle} disabled={saveTemplates.isPending} onClick={() => restore(f.key)}>
                  Restaurar texto original
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
