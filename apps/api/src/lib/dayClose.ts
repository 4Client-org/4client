import type { PrismaClient } from '@prisma/client';

// Congelamiento del día (RN-CAJ-21). Un día con fila DailyClose es una foto ya
// cerrada: cierre.ts obligó a decidir cada pedido abierto, así que nada de ese
// día cambia después - ni crear, editar (admin incluido), mover de estado,
// restaurar, eliminar (papelera o el propio cliente), cobrar ni cobrar
// retroactivo. Lo que congela es la fila DailyClose, no el campo caja_cerrada.
//
// Excepciones que NO pasan por aquí, a propósito: agregar/editar/borrar
// observaciones (orders.ts › rutas /:id/observations) y marcar un crédito como
// pagado (orders.ts › PATCH /:id/credito-pagado, que no suma en ningún total,
// D-19). El pase a mañana del formulario del cliente (public.ts › POST /submit)
// usa findDayClose para mover el pedido nuevo al día siguiente en vez de
// rechazarlo.
//
// Toda ruta nueva que modifique pedidos debe llamar a dayClosedError (o a
// findDayClose si necesita otra reacción), o el día deja de estar congelado.

export const DAY_CLOSED_CODE = 'DAY_CLOSED' as const;

const DEFAULT_MESSAGE = 'Ese día ya fue cerrado - el pedido quedó congelado';

export async function findDayClose(prisma: PrismaClient, orgId: string, fecha: Date) {
  return prisma.dailyClose.findUnique({ where: { org_id_fecha: { org_id: orgId, fecha } } });
}

/**
 * Devuelve el cuerpo de la respuesta 409 si la fecha ya tiene cierre de caja,
 * o null si el día sigue abierto. Uso: `const closed = await dayClosedError(...);
 * if (closed) return reply.status(409).send(closed);`
 */
export async function dayClosedError(
  prisma: PrismaClient,
  orgId: string,
  fecha: Date,
  message: string = DEFAULT_MESSAGE,
): Promise<{ error: string; code: typeof DAY_CLOSED_CODE } | null> {
  const close = await findDayClose(prisma, orgId, fecha);
  return close ? { error: message, code: DAY_CLOSED_CODE } : null;
}
