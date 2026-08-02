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

// Shared with cierre.ts's own defer-renumbering (same org+day numbering space,
// must serialize against each other too - a client's late-night form order
// rolling forward onto "tomorrow" at the exact moment staff runs cierre and
// defers pending orders onto that same "tomorrow" is a real race, not a
// theoretical one).
export function dayLockKey(orgId: string, fecha: Date): string {
  return `${orgId}:${fecha.toISOString().split('T')[0]}`;
}

// Transaction-scoped advisory lock (releases itself on commit/rollback, no
// manual unlock) - see createOrderWithRetryNum's own comment for the full
// reasoning. hashtextextended (bigint) rather than hashtext (int4) - wider hash,
// less chance of two unrelated org+day pairs colliding onto the same lock key.
export async function acquireDayLock(tx: Prisma.TransactionClient, orgId: string, fecha: Date): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dayLockKey(orgId, fecha)}, 0))`;
}

// Computes the smallest unused positive integer order number for org+fecha and
// creates the order via `createFn(tx, num)`, run inside a Postgres advisory lock
// scoped to that exact org+day.
//
// Fills gaps rather than just MAX(num)+1 - in normal operation this now behaves
// identically to MAX+1 (nothing leaves gaps anymore: a deferred order gets
// RENUMBERED into the next day's own consecutive sequence at cierre time - see
// cierre.ts's own comment - instead of dragging its old, possibly much higher,
// num along with it like it used to). Smallest-unused is kept anyway as the
// general-purpose rule rather than reverting to plain MAX+1, since it's exactly
// as cheap and correct either way when there's no gap, but also does the right
// thing without any special-casing in the rare case a gap DOES appear for some
// other reason (e.g. an order moved to papelera and its num never got reused).
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
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await acquireDayLock(tx, orgId, fecha);
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
