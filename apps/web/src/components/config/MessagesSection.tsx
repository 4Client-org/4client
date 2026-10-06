import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { toast } from '../ui/Toast';
import { useMessageTemplates, MessageTemplates } from '../../hooks/useMessageTemplates';

// Mensajes que el staff manda desde el chat. Admin y dev los editan para su
// propia org. El de bienvenida es el automático del primer mensaje del día;
// los otros tres salen con botones (Formulario, Cuenta banco).
type TemplateKey = keyof MessageTemplates;
type FieldKey = TemplateKey | 'welcome_message';

const FIELDS: { key: TemplateKey; label: string; hint: string }[] = [
  { key: 'form_warning', label: 'Aviso al enviar el formulario', hint: 'Primer mensaje al tocar "Formulario". Incluye los datos de la cuenta si quieres que vayan con el aviso.' },
  { key: 'form_followup', label: 'Seguimiento del formulario', hint: 'Tercer mensaje, justo después del link del formulario.' },
  { key: 'bank_account', label: 'Cuenta bancaria', hint: 'Lo que se manda al tocar "Cuenta banco" en el chat.' },
];

const btnStyle = { width: 'auto', padding: '9px 18px', marginTop: 0, fontSize: 14 };
const areaStyle = { width: '100%', padding: '9px 12px', border: '1px solid var(--brd)', borderRadius: 8, fontSize: 14, background: 'var(--bg)', color: 'var(--n)', minHeight: 90, resize: 'vertical' as const };

export default function MessagesSection() {
  const qc = useQueryClient();
  const { data: templates, isLoading } = useMessageTemplates();
  const { data: org } = useQuery({
    queryKey: ['config-org'],
    queryFn: () => api.get<{ data: any }>('/config/org').then(r => r.data),
  });

  // Borradores por campo. Solo los campos que el usuario tocó tienen entrada;
  // al guardar uno, se borra únicamente el suyo.
  const [drafts, setDrafts] = useState<Partial<Record<FieldKey, string>>>({});

  const savedValue = (key: FieldKey): string =>
    key === 'welcome_message' ? (org?.welcome_message ?? '') : (templates?.[key] ?? '');
  const currentValue = (key: FieldKey): string => drafts[key] ?? savedValue(key);
  const isDirty = (key: FieldKey): boolean => drafts[key] !== undefined && drafts[key] !== savedValue(key);

  function clearDraft(key: FieldKey) {
    setDrafts(d => { const n = { ...d }; delete n[key]; return n; });
  }

  // Cada guardado manda solo su campo; el servidor hace merge con lo demás.
  const saveTemplate = useMutation({
    mutationFn: (args: { key: TemplateKey; value: string | null }) =>
      api.put('/config/message-templates', { [args.key]: args.value }),
    onSuccess: (_res, args) => {
      clearDraft(args.key);
      toast('Mensaje guardado');
      qc.invalidateQueries({ queryKey: ['message-templates'] });
    },
    onError: (e: any) => toast(e.message ?? 'No se pudo guardar el mensaje', true),
  });

  const saveWelcome = useMutation({
    mutationFn: (text: string) => api.patch('/config/wpp', { welcome_message: text || null }),
    onSuccess: () => {
      clearDraft('welcome_message');
      toast('Mensaje de bienvenida guardado');
      qc.invalidateQueries({ queryKey: ['config-org'] });
    },
    onError: (e: any) => toast(e.message ?? 'No se pudo guardar la bienvenida', true),
  });

  if (isLoading) return <div style={{ color: 'var(--gt)' }}>Cargando...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 680 }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>Mensaje de bienvenida</div>
        <div style={{ fontSize: 12, color: 'var(--gt)', marginBottom: 8 }}>Se envía al primer mensaje del día de cada cliente. Vacío = desactivado.</div>
        <textarea style={areaStyle} value={currentValue('welcome_message')}
          onChange={e => setDrafts(d => ({ ...d, welcome_message: e.target.value }))} />
        <button className="bpri" style={{ ...btnStyle, marginTop: 8 }}
          disabled={!isDirty('welcome_message') || saveWelcome.isPending}
          onClick={() => saveWelcome.mutate(currentValue('welcome_message').trim())}>
          {saveWelcome.isPending ? 'Guardando...' : 'Guardar bienvenida'}
        </button>
      </div>

      {FIELDS.map(f => {
        const dirty = isDirty(f.key);
        const pending = saveTemplate.isPending && saveTemplate.variables?.key === f.key;
        return (
          <div key={f.key}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>{f.label}</div>
            <div style={{ fontSize: 12, color: 'var(--gt)', marginBottom: 8 }}>{f.hint}</div>
            <textarea style={areaStyle} value={currentValue(f.key)}
              onChange={e => setDrafts(d => ({ ...d, [f.key]: e.target.value }))} />
            <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center' }}>
              <button className="bpri" style={btnStyle}
                disabled={!dirty || pending || !currentValue(f.key).trim()}
                onClick={() => saveTemplate.mutate({ key: f.key, value: currentValue(f.key).trim() })}>
                {pending ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
