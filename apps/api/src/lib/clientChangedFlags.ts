import type { PrismaClient } from '@prisma/client';

// Client-changed indicator for address/payment_method - available to EVERY role
// that can open an order (unlike the full order_history array, which stays
// admin/dev only), so encargado still sees "cambió el cliente" right on the
// field without getting access to the broader audit trail (every price/status
// change and who made it). Derived from each field's own most recent history
// entry rather than a stored column - address/payment_method don't carry a
// per-field flag the way order items do via added_by_client. Shared by
// orders.ts (staff edits) and public.ts (client form merges), since both are
// places an order gets returned/emitted after possibly changing one of these.
export async function clientChangedFlags(prisma: PrismaClient, orderId: string) {
  const [addr, pay] = await Promise.all([
    prisma.orderHistory.findFirst({
      where: { order_id: orderId, field: 'Dirección' },
      orderBy: { created_at: 'desc' },
      select: { notes: true },
    }),
    prisma.orderHistory.findFirst({
      where: { order_id: orderId, field: 'Método de pago' },
      orderBy: { created_at: 'desc' },
      select: { notes: true },
    }),
  ]);
  return {
    address_changed_by_client: !!addr?.notes?.includes('formulario'),
    payment_changed_by_client: !!pay?.notes?.includes('formulario'),
  };
}
