// Editar un pedido ya cobrado (locked) con el día abierto (RN-CAJ-26 a RN-CAJ-28).
//
// El cobro (orders.ts › POST /:id/cobro) guarda cómo entró la plata en campos
// que ya existen y cuyo significado no cambia aquí:
//   - payment_method: método del pedido.
//   - amount_received / change_amount: monto recibido y vuelta (vuelta = recibido − total).
//   - split_cash / split_transfer: pago dividido; si los dos están puestos, el
//     cierre y el informe reparten por ellos (RN-CAJ-19), si no, por el método.
//   - cod_choice: "completo" o "vuelta" de un cobro en casa.
// Cuando el administrador cambia ítems (y con ello el total) o el método de un
// pedido ya cobrado, esta función decide si hace falta un desglose nuevo
// ({ cash, transfer }, la misma forma que `split` del cobro), lo valida contra el
// total nuevo y calcula los valores coherentes de esos campos. Es pura: no toca la
// base; orders.ts › PATCH /:id la llama y escribe el resultado.

export type PaymentBreakdown = { cash: number; transfer: number };

export type LockedPaymentState = {
  payment_method: string;
  amount_received: number | null;
  change_amount: number | null;
  cod_choice: string | null;
  split_cash: number | null;
  split_transfer: number | null;
};

export type PaymentFields = {
  amount_received: number;
  change_amount: number;
  split_cash: number | null;
  split_transfer: number | null;
  cod_choice: string | null;
};

export type SettleResult =
  | { ok: false; code: 'PAYMENT_BREAKDOWN_REQUIRED' | 'PAYMENT_BREAKDOWN_MISMATCH' | 'PAYMENT_METHOD_NOT_ALLOWED'; error: string }
  | { ok: true; data: PaymentFields | null };

// Métodos con los que un pedido ya cobrado puede quedar al corregirlo: los que
// reciben plata y caen en una bolsa (RN-CAJ-19). `credito` (se salda con
// "Marcar crédito pagado", D-19) y `sin_asignar` quedan fuera.
export const LOCKED_EDIT_METHODS = ['cash', 'transfer', 'cod'] as const;

const fmt = (n: number) => `$${n.toLocaleString('es-CO')}`;

function hasSplit(s: Pick<LockedPaymentState, 'split_cash' | 'split_transfer'>): boolean {
  return s.split_cash != null && s.split_transfer != null;
}

// Bolsa "natural" de cada método, la misma de RN-CAJ-19: cash y cod van a
// efectivo, transfer a transferencia; los demás no van a ninguna.
function naturalBucket(method: string): 'cash' | 'transfer' | null {
  if (method === 'cash' || method === 'cod') return 'cash';
  if (method === 'transfer') return 'transfer';
  return null;
}

export function settleLockedOrderEdit(input: {
  existing: LockedPaymentState;
  newMethod: string;
  oldTotal: number;
  newTotal: number;
  breakdown?: PaymentBreakdown;
}): SettleResult {
  const { existing, newMethod, oldTotal, newTotal, breakdown } = input;
  const methodChanged = newMethod !== existing.payment_method;
  const totalChanged = newTotal !== oldTotal;
  const existingSplit = hasSplit(existing);

  if (methodChanged) {
    if (existing.payment_method === 'credito' || !(LOCKED_EDIT_METHODS as readonly string[]).includes(newMethod)) {
      return {
        ok: false, code: 'PAYMENT_METHOD_NOT_ALLOWED',
        error: 'Un pedido ya cobrado solo puede quedar en efectivo (pagado en tienda), transferencia o cobro en casa; un crédito no se cambia de método (se salda con "Marcar crédito pagado")',
      };
    }
  }

  // Un crédito sin pago dividido no reparte plata en ninguna bolsa: no lleva
  // desglose (aceptarlo lo haría contar en los totales al saldarse, contra D-19).
  const creditoSinSplit = newMethod === 'credito' && !existingSplit;
  if (breakdown && creditoSinSplit) {
    return { ok: false, code: 'PAYMENT_METHOD_NOT_ALLOWED', error: 'Un pedido a crédito no lleva desglose de pago' };
  }

  if (!breakdown && (methodChanged || (totalChanged && !creditoSinSplit))) {
    return {
      ok: false, code: 'PAYMENT_BREAKDOWN_REQUIRED',
      error: methodChanged
        ? `Para cambiar el método de pago de un pedido ya cobrado indica cuánto fue en efectivo y cuánto en transferencia (total ${fmt(newTotal)})`
        : `El total del pedido ya cobrado cambió de ${fmt(oldTotal)} a ${fmt(newTotal)}: indica cuánto fue en efectivo y cuánto en transferencia`,
    };
  }

  if (breakdown) {
    const sum = breakdown.cash + breakdown.transfer;
    if (sum !== newTotal) {
      return {
        ok: false, code: 'PAYMENT_BREAKDOWN_MISMATCH',
        error: `Efectivo + transferencia debe sumar exactamente el total del pedido (${fmt(newTotal)}) - suman ${fmt(sum)}`,
      };
    }
    const natural = naturalBucket(newMethod);
    const isSplit = natural === null || (natural === 'cash' ? breakdown.transfer > 0 : breakdown.cash > 0);
    if (isSplit) {
      // Mismo criterio que el cobro dividido (RN-CAJ-06): sin vuelta.
      return {
        ok: true,
        data: {
          amount_received: newTotal, change_amount: 0,
          split_cash: breakdown.cash, split_transfer: breakdown.transfer,
          cod_choice: newMethod === 'cod' ? (methodChanged ? 'completo' : existing.cod_choice ?? 'completo') : null,
        },
      };
    }
    // Todo en la bolsa del método: no es pago dividido. Recibido = total nuevo y
    // vuelta 0, salvo un cobro en casa "con vuelta" cuyo monto entregado por el
    // cliente aún cubre el total nuevo: ese monto se conserva y la vuelta se
    // recalcula (RN-CAJ-05 sigue cumpliéndose: monto ≥ total).
    const prevAmount = existing.amount_received;
    const keepVuelta = !methodChanged && newMethod === 'cod' && existing.cod_choice === 'vuelta' && !existingSplit
      && prevAmount != null && prevAmount >= newTotal;
    const amount = keepVuelta ? prevAmount! : newTotal;
    return {
      ok: true,
      data: {
        amount_received: amount, change_amount: amount - newTotal,
        split_cash: null, split_transfer: null,
        cod_choice: newMethod !== 'cod' ? null
          : amount > newTotal ? 'vuelta'
          : methodChanged ? 'completo' : existing.cod_choice ?? 'completo',
      },
    };
  }

  if (totalChanged) {
    // Solo llega aquí un crédito sin pago dividido: el monto acordado sigue al total.
    return {
      ok: true,
      data: {
        amount_received: newTotal, change_amount: 0,
        split_cash: null, split_transfer: null, cod_choice: existing.cod_choice,
      },
    };
  }

  return { ok: true, data: null };
}

const METHOD_LABEL: Record<string, string> = {
  cod: 'Cobro en casa', cash: 'Efectivo', transfer: 'Transferencia', sin_asignar: 'Sin asignar', credito: 'Crédito',
};

/** Texto legible del cobro para el historial ("Efectivo - recibido $20.000, vuelta $0"). */
export function paymentSummary(
  method: string,
  p: { amount_received: number | null; change_amount: number | null; split_cash: number | null; split_transfer: number | null },
): string {
  if (p.split_cash != null && p.split_transfer != null) {
    return `${METHOD_LABEL[method] ?? method} - dividido: efectivo ${fmt(p.split_cash)}, transferencia ${fmt(p.split_transfer)}`;
  }
  return `${METHOD_LABEL[method] ?? method} - recibido ${fmt(p.amount_received ?? 0)}, vuelta ${fmt(p.change_amount ?? 0)}`;
}
