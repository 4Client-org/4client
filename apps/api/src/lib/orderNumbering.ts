import { Prisma, type PrismaClient } from '@prisma/client';

// Finds the n-th smallest positive integer NOT in `used` (n=1 -> the smallest
// missing one, n=2 -> the next one after that, etc). Only n=1 is actually used in
// normal operation now that the advisory lock below serializes every creation for
// a given org+day - n>1 only ever gets exercised by the P2002 retry fallback,
// which needs a DIFFERENT candidate than the one that just collided.
function nthSmallestUnused(used: Set<number>, n: number): number {
  let candidate = 0;
  let found = 0;
  while (found < n) {
    candidate++;
    if (!used.has(candidate)) found++;
  }
  return candidate;
}

// Computes the smallest unused positive integer order number for org+fecha and
// creates the order via `createFn(tx, num)`, run inside a Postgres advisory lock
// scoped to that exact org+day.
//
// Gap-fills on purpose: a deferred order (cierre.ts, decision "mañana") keeps its
// ORIGINAL num when its fecha moves to the next day, so a day's number space can
// already have high numbers "occupied" (e.g. 13 and 24 carried in from
// yesterday) well before any of today's own orders exist. The previous MAX(num)+1
// approach treated every carried-in num as a permanent floor - once something
// landed on 24, every unused number below it (1-12, 14-23) sat wasted for that
// whole day. This instead always fills 1, 2, 3... skipping only numbers already
// taken that day (so with 13 and 24 already occupied: 1-12, then 14-23, then 25+).
//
// Safety (non-negotiable - a numbering bug must never cross-assign one
// customer's order number to another, or ever error out instead of just
// assigning a number): reading "what's the smallest unused number" and then
// inserting it are two separate steps, so without serialization two concurrent
// requests for the SAME org+day could both read the same gap and both try to
// insert the same candidate - a real, not theoretical, race under real staff/
// client-form concurrency, confirmed by a concurrent-creation test that hit
// exactly this and burned through every retry attempt. pg_advisory_xact_lock
// closes that: every call for a given org+day queues behind this lock (keyed by
// hashtextextended(orgId+fecha) - a wider bigint hash than hashtext, so two
// unrelated org+day pairs essentially never accidentally share a key and
// needlessly serialize each other), so the read-compute-insert below always runs
// as if it were the only one happening for that day. The lock is transaction-
// scoped (`_xact_`) - it releases itself automatically on commit OR rollback, no
// manual unlock needed, and can never be left held by a crashed/hung request.
// The DB's own @@unique([org_id, num, fecha]) constraint stays as a second,
// independent guarantee underneath the lock (belt AND suspenders) - the
// MAX_ATTEMPTS retry loop exists only to catch that constraint if it were ever
// hit anyway, not as the primary safety mechanism anymore.
export async function createOrderWithRetryNum<T>(
  prisma: PrismaClient,
  orgId: string,
  fecha: Date,
  createFn: (tx: Prisma.TransactionClient, num: string) => Promise<T>,
): Promise<T> {
  const MAX_ATTEMPTS = 5;
  const lockKey = `${orgId}:${fecha.toISOString().split('T')[0]}`;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
        const existing = await tx.order.findMany({ where: { org_id: orgId, fecha }, select: { num: true } });
        const used = new Set(existing.map(o => parseInt(o.num, 10)).filter(n => Number.isFinite(n) && n > 0));
        const candidate = nthSmallestUnused(used, attempt);
        const num = String(candidate).padStart(3, '0');
        return await createFn(tx, num);
      }, { timeout: 15_000 });
    } catch (error) {
      const isCollision = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!isCollision || attempt === MAX_ATTEMPTS) throw error;
    }
  }
  // Unreachable, but keeps TS happy about a guaranteed return/throw.
  throw new Error('No se pudo generar un número de pedido único');
}
