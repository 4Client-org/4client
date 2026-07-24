import { CheckCircle } from 'lucide-react';
import { fmtCOP } from '../../lib/format';

interface Props {
  total: number;
  choice: 'completo' | 'vuelta' | null;
  onChoiceChange: (choice: 'completo' | 'vuelta') => void;
  cash: string;
  onCashChange: (value: string) => void;
  disabled?: boolean;
}

// Shown wherever payment_method === 'cod' is selected (NuevoPedidoModal,
// DetallePedidoModal) - staff must actively pick "Completo" or "Necesita vuelta",
// neither is a default. Picking "vuelta" reveals the cash-amount input; "completo"
// hides it entirely (the client pays exactly the total, nothing to type). The
// backend enforces the exact same rule (>0, >= total) before a cod order can be
// cerrado - see orders.ts's validateCodAmount - this is just the same check shown
// live instead of only failing after a round trip.
export default function CodPaymentField({ total, choice, onChoiceChange, cash, onCashChange, disabled }: Props) {
  const cashNum = parseFloat(cash) || 0;
  const change = cashNum - total;
  const cashValid = cashNum > 0 && cashNum >= total;

  return (
    <div className="fg2">
      <label className="fl2">¿Cómo paga el cliente? <span style={{ color: 'var(--r)', fontWeight: 800 }}>*</span></label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={disabled}
          onClick={() => onChoiceChange('completo')}
          className={choice === 'completo' ? 'bpri' : 'bsec'}
          style={{ flex: 1, padding: '8px 0', fontSize: 13 }}>
          Completo
        </button>
        <button type="button" disabled={disabled}
          onClick={() => onChoiceChange('vuelta')}
          className={choice === 'vuelta' ? 'bpri' : 'bsec'}
          style={{ flex: 1, padding: '8px 0', fontSize: 13 }}>
          Necesita vuelta
        </button>
      </div>
      {choice === 'vuelta' && (
        <>
          <input className="fi2 no-spin" type="number" disabled={disabled}
            placeholder={`Mínimo: $${total.toLocaleString('es-CO')}`}
            value={cash} onChange={(e) => onCashChange(e.target.value)}
            style={{ marginTop: 8, borderColor: cash && !cashValid ? 'var(--r)' : undefined }} />
          {cash && (
            <div style={{
              fontSize: 13, marginTop: 6, fontWeight: 700,
              color: cashValid ? 'var(--v)' : 'var(--r)',
              background: cashValid ? 'var(--vc)' : 'var(--rc)',
              borderRadius: 8, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {cashValid ? <CheckCircle size={13} /> : null}
              {cashValid ? `Vuelta: ${fmtCOP(change)}` : cashNum <= 0 ? 'Ingresa el monto' : `Falta ${fmtCOP(total - cashNum)} para cubrir el total`}
            </div>
          )}
        </>
      )}
    </div>
  );
}
