// "Día de negocio" para un chat (Ticket.fecha) en hora de Bogotá (UTC-5, sin DST).
// Pedido explícito: un chat que escribe de 9:00 p.m. en adelante (hasta las
// 11:59:59 p.m.) se cuenta para el día SIGUIENTE, no para hoy - así no queda
// enterrado en el tablero/informe de un día que para fines prácticos ya cerró,
// y el encargado lo ve mañana en vez de tener que acordarse de revisar ayer.
// A la medianoche en punto el calendario ya cambió solo, así que no hace falta
// tratar ese caso aparte.
//
// Esto es SOLO para el chat (Ticket.fecha) - el día de cierre de caja/pedidos
// (cierre.ts, public.ts, Order.fecha) es un concepto de negocio aparte y no se
// toca acá.
export const NIGHT_CUTOFF_HOUR = 21; // 9:00 p.m.

// Devuelve la fecha (solo día, sin hora) que le corresponde a un instante dado,
// aplicando el corte de las 9 p.m. Mismo formato que el resto del código usa
// para Ticket.fecha: un Date construido desde un string "YYYY-MM-DD".
export function businessDateForInstant(instant: Date): Date {
  const localMs = instant.getTime() - 5 * 60 * 60 * 1000;
  const local = new Date(localMs);
  const hour = local.getUTCHours(); // local ya está corrido a Bogotá, por eso UTC getters
  const dateStr = local.toISOString().split('T')[0];
  const businessDate = new Date(dateStr);
  if (hour >= NIGHT_CUTOFF_HOUR) {
    businessDate.setUTCDate(businessDate.getUTCDate() + 1);
  }
  return businessDate;
}
