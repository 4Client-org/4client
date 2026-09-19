import type { PrismaClient, Prisma } from '@prisma/client';

// Best-effort - a logging failure must never block the actual action it's recording.
export async function audit(
  prisma: PrismaClient,
  params: { orgId: string; actorId: string; action: string; targetId?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        org_id: params.orgId,
        actor_id: params.actorId,
        action: params.action,
        target_id: params.targetId,
        metadata: params.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    // Security-audit finding (deep-profile): sigue siendo best-effort a
    // propósito (un fallo acá nunca debe romper la acción real que registra),
    // pero antes no dejaba ningún rastro de que un hueco en el historial de
    // auditoría ocurrió. Un solo log, sin relanzar.
    console.error('[audit] no se pudo registrar la entrada de auditoría', { action: params.action, orgId: params.orgId, err });
  }
}
