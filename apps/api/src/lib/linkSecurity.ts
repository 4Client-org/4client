import type { PrismaClient } from '@prisma/client';

// Wrong-PIN abuse ladder, shared by public.ts (form links) and files.ts (invoice
// links) - a single chat's failed guesses count together no matter which kind of
// link they came through, so alternating between the form link and a factura link
// can't be used to dodge the ticket-wide block below.
export const MAX_ATTEMPTS_PER_LINK = 10;
export const MAX_ATTEMPTS_PER_TICKET = 30;
export const TICKET_BLOCK_HOURS = 24;

// Call on every wrong phone_last4 guess for a ticket. Bumps the ticket-wide
// cumulative counter and, once it crosses MAX_ATTEMPTS_PER_TICKET, blocks every
// link belonging to this ticket (form + all invoices) for TICKET_BLOCK_HOURS -
// self-expiring, no staff action needed. Mirrors the org-wide "bloquear todos los
// links" kill switch, just scoped to one chat and on a timer instead of manual.
export async function registerFailedLinkAttempt(prisma: PrismaClient, ticketId: string): Promise<void> {
  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: { link_failed_total: { increment: 1 } },
    select: { link_failed_total: true },
  });
  if (updated.link_failed_total >= MAX_ATTEMPTS_PER_TICKET) {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { link_failed_total: 0, link_blocked_until: new Date(Date.now() + TICKET_BLOCK_HOURS * 3600000) },
    });
  }
}
