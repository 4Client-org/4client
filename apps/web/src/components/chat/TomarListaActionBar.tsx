import { ListChecks, X } from 'lucide-react';

interface Props {
  count: number;
  pending: boolean;
  onCancel: () => void;
  onClearSelection: () => void;
  onProcess: () => void;
}

// Replaces the normal reply bar while "Tomar lista" mode is active (see
// TicketModal/NuevoPedidoModal/DetallePedidoModal) - staff is selecting
// messages, not typing a reply, so the two controls never need to coexist.
export function TomarListaActionBar({ count, pending, onCancel, onClearSelection, onProcess }: Props) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
      borderTop: '1px solid rgba(0,0,0,.1)', background: '#EEF2FF', flexShrink: 0,
    }}>
      <ListChecks size={15} color="var(--v)" />
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--n)', flex: 1 }}>
        {count} seleccionado{count === 1 ? '' : 's'}
      </span>
      {count > 0 && (
        // Clears the selection WITHOUT leaving Tomar lista mode - "me
        // equivoqué, no necesito todas" shouldn't force re-clicking the header
        // button to start over (that's what Cancelar, to the right, is for).
        <button
          onClick={onClearSelection}
          disabled={pending}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v)', fontSize: 12, fontWeight: 600, padding: '4px 8px', textDecoration: 'underline' }}
        >
          Deseleccionar todo
        </button>
      )}
      <button
        onClick={onCancel}
        disabled={pending}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gt)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, padding: '4px 8px' }}
      >
        <X size={13} /> Cancelar
      </button>
      <button
        onClick={onProcess}
        disabled={count === 0 || pending}
        style={{
          background: 'var(--v)', color: '#fff', border: 'none', borderRadius: 8,
          padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700,
          opacity: count === 0 || pending ? 0.6 : 1,
        }}
      >
        {pending ? 'Procesando...' : 'Procesar con IA'}
      </button>
    </div>
  );
}
