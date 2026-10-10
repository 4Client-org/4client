// Regla de bolsas del día (RN-CAJ-19, RN-DSH-06) en UN solo lugar. La usan el
// cierre real (cierre.ts › POST /, que guarda la foto DailyClose), la vista previa
// del modal de cierre (cierre.ts › GET /preview) y el informe del día
// (dashboard.ts › GET /). Antes estaba copiada en esos tres sitios y la copia del
// modal (en la web) ya había divergido: ignoraba el pago dividido, contaba pedidos
// eliminados por el cliente y rotulaba créditos sin pagar como "Completado".
//
// Nada de esto escribe en la base ni guarda un total de pedido: el total de un
// pedido es siempre la suma de OrderItem.price (principio 3).

type Num = number | string | { toString(): string } | null | undefined;

export interface BolsaOrderInput {
  status: string;
  paid: boolean;
  client_deleted: boolean;
  payment_method: string;
  split_cash: Num;
  split_transfer: Num;
  items: { price: Num }[];
}

export interface Bolsas {
  efectivo: number;
  transferencia: number;
  total: number;
}

/** Total de un pedido = suma de los totales de línea (OrderItem.price). */
export function orderTotal(o: { items: { price: Num }[] }): number {
  return o.items.reduce((s, i) => s + Number(i.price ?? 0), 0);
}

/**
 * ¿Este pedido cuenta para la plata del día? Solo pagado Y cerrado, y que el
 * cliente no lo haya eliminado. El `status === 'cerrado'` explícito (además de
 * `paid`) impide que un total de dinero real incluya un pedido en otro estado.
 * La papelera nunca llega aquí: un pedido en papelera no está `cerrado`.
 */
export function cuentaEnBolsas(o: Pick<BolsaOrderInput, 'status' | 'paid' | 'client_deleted'>): boolean {
  return o.paid && o.status === 'cerrado' && !o.client_deleted;
}

/**
 * Cuánto aporta un pedido a cada bolsa. Si tiene pago dividido, cada parte va a
 * su bolsa; si no, `cash` y `cod` van a efectivo y `transfer` a transferencia;
 * cualquier otro método (`credito`, `sin_asignar`, valores heredados) no va a
 * ninguna (D-19, PREG-001). Un pedido que no cuenta (`cuentaEnBolsas`) aporta 0.
 */
export function bolsasDePedido(o: BolsaOrderInput): { efectivo: number; transferencia: number } {
  if (!cuentaEnBolsas(o)) return { efectivo: 0, transferencia: 0 };
  if (o.split_cash != null && o.split_transfer != null) {
    return { efectivo: Number(o.split_cash), transferencia: Number(o.split_transfer) };
  }
  const tot = orderTotal(o);
  if (o.payment_method === 'cash' || o.payment_method === 'cod') return { efectivo: tot, transferencia: 0 };
  if (o.payment_method === 'transfer') return { efectivo: 0, transferencia: tot };
  return { efectivo: 0, transferencia: 0 };
}

/** Totales del día: suma de `bolsasDePedido`; total = efectivo + transferencia. */
export function calcularBolsas(orders: BolsaOrderInput[]): Bolsas {
  let efectivo = 0;
  let transferencia = 0;
  for (const o of orders) {
    const b = bolsasDePedido(o);
    efectivo += b.efectivo;
    transferencia += b.transferencia;
  }
  return { efectivo, transferencia, total: efectivo + transferencia };
}

/**
 * Cómo se presenta cada pedido del día en la vista previa del cierre. Una sola
 * clasificación para que el modal no decida por su cuenta qué es "completado".
 * - `cobrado`: pagado y cerrado (suma según `bolsasDePedido`).
 * - `credito_pendiente`: cerrado a crédito y sin pagar (no suma; no es "Completado").
 * - `cerrado_sin_cobro`: cerrado sin pagar y no es crédito (no suma).
 * - `pagado_sin_cerrar`: pagado pero no cerrado (PREG-007: crédito marcado pagado
 *   antes de cobrarlo). `POST /cierre` no lo pide como pendiente (filtra
 *   `paid: false`) ni lo suma (no está cerrado); se muestra para que no desaparezca.
 * - `pendiente`: exige decisión en el cierre (misma regla que `POST /cierre`).
 * - `excluido`: papelera o eliminado por el cliente (no cuenta para nada).
 */
export type ClaseCierre = 'cobrado' | 'credito_pendiente' | 'cerrado_sin_cobro' | 'pagado_sin_cerrar' | 'pendiente' | 'excluido';

export function claseCierre(o: Pick<BolsaOrderInput, 'status' | 'paid' | 'client_deleted' | 'payment_method'>): ClaseCierre {
  if (o.client_deleted || o.status === 'papelera') return 'excluido';
  if (cuentaEnBolsas(o)) return 'cobrado';
  // Desde aquí, un pedido `cerrado` nunca está pagado (ese caso es `cobrado`).
  if (o.status === 'cerrado') return o.payment_method === 'credito' ? 'credito_pendiente' : 'cerrado_sin_cobro';
  if (o.paid) return 'pagado_sin_cerrar';
  return 'pendiente';
}

/** Filtro Prisma de los pendientes que `POST /cierre` exige decidir (RN-CAJ-14). */
export function pendientesWhere(orgId: string, fecha: Date) {
  return { org_id: orgId, fecha, paid: false, status: { notIn: ['cerrado', 'papelera'] }, client_deleted: false };
}
