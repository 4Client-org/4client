import { useState } from 'react';

export interface EligibleOrder { id: string; num: string; status: string; }

interface Props {
  unmatchedNames: string[];
  eligibleOrders: EligibleOrder[];
  onConfirm: (target: 'new' | { orderId: string }) => void;
  onCancel: () => void;
}

// Shown after "Tomar lista" extraction whenever there's something to decide:
// unmatched items to warn about, and/or (only from TicketModal, which has no
// order-item UI of its own) an existing eligible order to offer merging into.
// If neither applies, callers skip this entirely and just toast the plain
// success message - see TicketModal/NuevoPedidoModal/DetallePedidoModal.
export function TomarListaResultModal({ unmatchedNames, eligibleOrders, onConfirm, onCancel }: Props) {
  const [target, setTarget] = useState<'new' | string>('new');

  return (
    <div className="moverlay on" style={{ zIndex: 900 }} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="mwin" style={{ maxWidth: 420 }}>
        <div className="mbody" style={{ padding: '24px 24px 20px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--n)', marginBottom: 10 }}>
            Lista montada exitosamente
          </div>
          {unmatchedNames.length > 0 && (
            <div style={{ fontSize: 13, color: '#B91C1C', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '10px 12px', marginBottom: 16, lineHeight: 1.5 }}>
              Estos productos no pude identificarlos: <strong>{unmatchedNames.join(', ')}</strong>. Recuerda revisar todo.
            </div>
          )}
          {eligibleOrders.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gt)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.3px' }}>
                ¿Dónde montamos estos productos?
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                <input type="radio" name="tomar-lista-target" checked={target === 'new'} onChange={() => setTarget('new')} />
                Crear nuevo pedido
              </label>
              {eligibleOrders.map(o => (
                <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  <input type="radio" name="tomar-lista-target" checked={target === o.id} onChange={() => setTarget(o.id)} />
                  Pedido #{o.num} ({o.status})
                </label>
              ))}
            </div>
          )}
          <div className="mactions" style={{ justifyContent: 'center' }}>
            <button className="bsec" onClick={onCancel}>Cancelar</button>
            <button className="bpri" onClick={() => onConfirm(target === 'new' ? 'new' : { orderId: target })}>Continuar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
