import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Prisma, type PrismaClient } from '@prisma/client';
import { MetaCloudProvider } from '../services/whatsapp/meta-cloud.js';
import { sanitizeForWhatsApp } from '../lib/sanitize.js';
import { sortByCategoryOrder } from '../lib/categoryOrder.js';
import { MAX_ATTEMPTS_SOFT } from '../lib/linkSecurity.js';
import { clientChangedFlags } from '../lib/clientChangedFlags.js';

// Max orders a single form link (ticket) may generate - a link can stay valid up to
// 24h, so this caps spam from a leaked/shared link.
const MAX_FORM_ORDERS_PER_TICKET = 3;

// Wording for the client-facing WhatsApp confirmation messages - matches the buttons
// shown on the form itself (ClientFormPage.tsx), not the staff-side PAYMENT_LABELS
// used in orders.ts (which says "Efectivo" instead of "En tienda" for `cash`).
const PAYMENT_LABEL_CLIENT: Record<string, string> = { transfer: 'Transferencia', cash: 'En tienda', cod: 'Cobro en casa' };

// The full date always goes in these WhatsApp confirmations - a staff member
// resending/checking an order days later (or a client re-reading an old chat) has
// no other way to tell WHICH day's pedido a message is actually about otherwise.
// Pinned to noon UTC before formatting (matches DetallePedidoModal.tsx's
// formatFechaLong) - `fecha` is a DATE-only column serialized as midnight UTC for
// that calendar day, and converting that through a Bogota (UTC-5) offset directly
// would read it as 7pm the PREVIOUS day.
function formatFechaLong(fecha: Date): string {
  const ymd = fecha.toISOString().split('T')[0];
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Bogota',
  });
}

// Computes the next sequential order number for org+fecha and creates the order,
// retrying on a unique-constraint collision (@@unique([org_id, num, fecha])).
//
// Uses MAX(num)+1, not COUNT(*)+1 - a deferred order (cierre.ts, decision "manana")
// keeps its ORIGINAL num when its fecha moves to the next day, so COUNT(*)+1 can guess
// a num that's already occupied by one of those, and since count doesn't change
// between retries with no concurrent insert, every retry recomputed the exact same
// doomed num and collided identically until attempts ran out (see orders.ts, same fix).
async function createOrderWithRetryNum<T>(
  prisma: PrismaClient,
  orgId: string,
  fecha: Date,
  createFn: (num: string) => Promise<T>,
): Promise<T> {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const existing = await prisma.order.findMany({ where: { org_id: orgId, fecha }, select: { num: true } });
    const maxNum = existing.reduce((max, o) => Math.max(max, parseInt(o.num, 10) || 0), 0);
    const num = String(maxNum + attempt).padStart(3, '0');
    try {
      return await createFn(num);
    } catch (error) {
      const isCollision = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!isCollision || attempt === MAX_ATTEMPTS) throw error;
    }
  }
  // Unreachable, but keeps TS happy about a guaranteed return/throw.
  throw new Error('No se pudo generar un número de pedido único');
}

export default async function publicRoutes(fastify: FastifyInstance) {
  // Allow any origin - these endpoints are genuinely public (client-facing form)
  fastify.addHook('onRequest', async (_req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
  });
  fastify.options('*', async (_req, reply) => reply.status(204).send());

  // Checked BEFORE token verification (no DB work needed) and given its own
  // clear message+code, unlike the generic "link inválido" used for revoked/
  // expired/device-mismatch - this isn't a security-sensitive reason to
  // hide, and a legitimate customer deserves to know why instead of thinking their
  // link is broken.
  // Every other invalid-link reason (revoked/org-blocked/never-opened-in-
  // time/unknown token) stays behind the same generic message on purpose - doesn't
  // help an attacker learn which one it was. Wrong phone digits get their own message
  // instead: that's the one case where the visitor might genuinely be the right
  // customer who just mistyped, and a useless "link inválido" only pushes them to
  // give up and ask staff to resend instead of just retrying the 4 digits.
  function sendInvalidToken(err: unknown, reply: FastifyReply) {
    // 'ticket blocked'/'link attempts exceeded' below are dead in practice now
    // (nothing calls registerFailedLinkAttempt anymore since the phone-digits check
    // that used to trigger it is gone - see loadTicketByFormToken) but harmless to
    // leave: if this ever gets re-enabled, the messaging is already here.
    if (err instanceof Error && err.message === 'ticket blocked') {
      return reply.status(403).send({
        error: 'Demasiados intentos incorrectos. Este chat quedó bloqueado temporalmente por seguridad. Intenta de nuevo en 24 horas o contáctanos directamente.',
        code: 'TICKET_BLOCKED',
      });
    }
    if (err instanceof Error && err.message === 'link attempts exceeded') {
      return reply.status(403).send({
        error: 'Demasiados intentos incorrectos con este link. Pide que te reenvíen uno nuevo.',
        code: 'LINK_ATTEMPTS_EXCEEDED',
      });
    }
    return reply.status(401).send({ error: 'Link inválido o expirado', code: 'INVALID_TOKEN' });
  }

  // Four ways a form_link_token can still be dead even though it's a real string
  // someone is presenting: (1) it just doesn't match any ticket - either bogus, or
  // (the common case) a superseded token: generateFormLinkUrl (formLink.ts)
  // OVERWRITES ticket.form_link_token every time a fresh link is issued, so an
  // older link's token simply stops matching anything, no separate comparison
  // needed; (2) explicitly revoked via POST /inbox/:ticketId/form-link/revoke;
  // (3) org-wide blocked - admin hit "Bloquear todos los links" (POST /inbox/
  // form-links/block-all), which stamps Organization.form_links_blocked_at after
  // this token was issued; (4) more than 24h since issuance, regardless of
  // whether it was ever opened. All fail the same generic way on every public
  // endpoint below - never reveals which of them it was.
  // Flat 24h - simpler than the previous two-tier scheme (4h unopened / 24h once
  // opened), which reportedly read as "the link doesn't open" to a customer who
  // didn't see the WhatsApp notification right away and came back to find it
  // already dead. Absolute cap, not renewed by opening it - used to be the JWT's
  // own `exp` claim (enforced automatically by jwt.verify before any of this
  // ran); now enforced here since there's no token payload carrying its own
  // expiry anymore.
  const FORM_LINK_ABSOLUTE_TTL_SECONDS = 24 * 60 * 60;

  // The link itself (an unguessable random token, DB-backed, time-limited,
  // revocable) is the entire security boundary now - see git history for the
  // phone_last4 digit-entry step this replaced, dropped because customers kept
  // getting confused by it. GET /link-status calls this same function - a dead
  // link answers "is this link alive" identically whether or not the visitor has
  // gotten as far as form-info/products/submit.
  async function loadTicketByFormToken(token: string) {
    const ticket = await fastify.prisma.ticket.findUnique({
      where: { form_link_token: token },
      include: {
        org: true,
        revoked_form_token: { select: { id: true } },
      },
    });
    if (!ticket) throw new Error('invalid token');
    if (ticket.revoked_form_token) throw new Error('revoked');
    // Checked before anything token-specific below - a chat that hit
    // MAX_ATTEMPTS_HARD wrong guesses is locked out entirely for TICKET_BLOCK_HOURS,
    // even against a link issued after the block started.
    if (ticket.link_blocked_until && ticket.link_blocked_until > new Date()) throw new Error('ticket blocked');
    // Ticket-wide, not specific to this token - a wrong guess against the
    // INVOICE link for this same ticket counts here too (files.ts), so hitting
    // MAX_ATTEMPTS_SOFT kills the form link even if every failed guess actually
    // happened on the factura. Staff sending ANY fresh link (form or factura)
    // resets this counter (linkSecurity.ts's clearSoftLinkBlock).
    if (ticket.link_failed_attempts >= MAX_ATTEMPTS_SOFT) throw new Error('link attempts exceeded');
    if (
      ticket.org.form_links_blocked_at
      && ticket.form_token_min_iat
      && ticket.org.form_links_blocked_at > ticket.form_token_min_iat
    ) {
      throw new Error('org blocked');
    }
    if (ticket.form_token_min_iat) {
      const ageSeconds = (Date.now() - ticket.form_token_min_iat.getTime()) / 1000;
      if (ageSeconds > FORM_LINK_ABSOLUTE_TTL_SECONDS) throw new Error('expired');
    }
    return ticket;
  }

  // Orders a client may see/act on via the form are scoped to TODAY (Colombia local) -
  // matches the link's own <=24h lifetime, and "editable" mirrors what staff can still
  // change too: once an order is 'camino' or 'cerrado', only staff can touch it from
  // here on, the client's copy becomes view-only.
  const EDITABLE_STATUSES = ['nuevo', 'preparando', 'listo'] as const;

  // Attribute an action taken via the client's form link to whichever staff
  // member actually sent that specific link (form_link_sent_by, stamped when it
  // was generated - see inbox.ts's /form-link route), so history/registered_by
  // shows a real name instead of an arbitrary admin. Falls back to the first
  // active admin/encargado for links issued before this existed, or sent
  // automatically (webhook.ts's auto-send has no actor). Shared by /submit and
  // the order-delete route below - both need a real User row for OrderHistory's
  // required actor_id, since the client itself has no User account.
  async function resolveActorUser(ticket: { org_id: string; form_link_sent_by: string | null }) {
    let actorUser = ticket.form_link_sent_by
      ? await fastify.prisma.user.findFirst({ where: { id: ticket.form_link_sent_by, org_id: ticket.org_id } })
      : null;
    if (!actorUser) {
      actorUser = await fastify.prisma.user.findFirst({
        where: { org_id: ticket.org_id, active: true, role: { in: ['admin', 'encargado'] } },
        orderBy: { created_at: 'asc' },
      });
    }
    return actorUser;
  }

  // GET /api/v1/public/link-status?t=TOKEN - checked BEFORE the client ever sees the
  // catalog, so a dead link (blocked/expired/revoked) shows the same "Link inválido"
  // screen immediately instead of the form flashing content it's about to yank away.
  fastify.get('/link-status', async (req, reply) => {
    const q = z.object({ t: z.string().min(1) }).safeParse(req.query);
    if (!q.success) return reply.status(400).send({ error: 'Token requerido', code: 'VALIDATION_ERROR' });
    try {
      await loadTicketByFormToken(q.data.t);
      return reply.send({ data: { valid: true } });
    } catch (err) {
      // sendInvalidToken - not a bare generic catch - so a ticket-wide block or an
      // exhausted link shows ITS OWN message here too, same as files.ts's factura
      // /status already does. Was swallowing those into "Link inválido o expirado"
      // before, so a client who hit the lockout only ever saw the specific reason
      // on the factura side, never on the form link.
      return sendInvalidToken(err, reply);
    }
  });

  // GET /api/v1/public/form-info?t=TOKEN&device_token=X - verifica token y devuelve
  // info del cliente + sus pedidos activos de hoy
  fastify.get('/form-info', async (req, reply) => {
    const q = z.object({ t: z.string().min(1), device_token: z.string().min(1) }).safeParse(req.query);
    if (!q.success) return reply.status(400).send({ error: 'Token requerido', code: 'VALIDATION_ERROR' });
    try {
      const ticket = await loadTicketByFormToken(q.data.t);

      // First successful open of THIS link - stamped for display purposes only now
      // (loadTicketByFormToken's expiry check is a flat 24h from issuance regardless
      // of whether/when it was ever opened).
      if (!ticket.form_link_opened_at) {
        await fastify.prisma.ticket.update({ where: { id: ticket.id }, data: { form_link_opened_at: new Date() } });
      }

      // Colombia UTC-5 local date - same "today" the client's own submissions land on.
      const todayLocal = new Date(new Date(Date.now() - 5 * 3600000).toISOString().split('T')[0]);

      // Only orders still in play today - cerrado (and papelera) are excluded outright,
      // not just marked non-editable. An order deferred INTO today (e.g. left open
      // overnight) still shows here if it's genuinely still active; once it's closed,
      // whether that happened today or it arrived already closed from a prior day,
      // there's nothing left for the client to see or do with it.
      const todaysOrders = await fastify.prisma.order.findMany({
        where: { ticket_id: ticket.id, org_id: ticket.org_id, fecha: todayLocal, status: { notIn: ['cerrado', 'papelera'] } },
        select: {
          id: true, num: true, address: true, payment_method: true, status: true, source: true, created_at: true,
          items: { select: { id: true, product_name: true, quantity_label: true, price: true }, orderBy: { sort_order: 'asc' } },
        },
        orderBy: { created_at: 'desc' },
        take: 20,
      });

      return reply.send({
        data: {
          clientName: ticket.customer_name ?? '',
          orgName: ticket.org.name,
          orgId: ticket.org_id,
          orders: todaysOrders.map(o => ({
            id: o.id,
            num: o.num,
            address: o.address === 'Pendiente de confirmar' ? '' : o.address,
            paymentMethod: o.payment_method === 'sin_asignar' ? '' : o.payment_method,
            status: o.status,
            // A pedido an encargado typed up manually is view-only from here, always -
            // see the same source !== 'form' check in /submit's merge path. Prices in
            // it may well be hand-set on purpose; a client edit merging their own item
            // list on top would clobber that.
            editable: o.source === 'form' && (EDITABLE_STATUSES as readonly string[]).includes(o.status),
            items: o.items.map(i => ({ id: i.id, product_name: i.product_name, quantity_label: i.quantity_label ?? '', price: Number(i.price) })),
            createdAt: o.created_at,
          })),
        },
      });
    } catch (err) {
      return sendInvalidToken(err, reply);
    }
  });

  // GET /api/v1/public/products?t=TOKEN&device_token=X - catálogo público (sin precios)
  fastify.get('/products', async (req, reply) => {
    const q = z.object({ t: z.string().min(1), device_token: z.string().min(1) }).safeParse(req.query);
    if (!q.success) return reply.status(400).send({ error: 'Token requerido', code: 'VALIDATION_ERROR' });
    try {
      const ticket = await loadTicketByFormToken(q.data.t);
      const products = await fastify.prisma.product.findMany({
        where: { org_id: ticket.org_id, active: true },
        select: { id: true, name: true, category: true, unit_type: true, sort_order: true },
        orderBy: [{ category: 'asc' }, { sort_order: 'asc' }, { name: 'asc' }],
      });
      return reply.send({ data: sortByCategoryOrder(products) });
    } catch (err) {
      return sendInvalidToken(err, reply);
    }
  });

  // POST /api/v1/public/submit - cliente envía su pedido → crea Order directamente
  // Rate limited per FORM LINK (token), not per IP - a per-IP key means every phone
  // behind the same shared connection (mobile carrier CGNAT, mall/office wifi) draws
  // from the same bucket, so unrelated customers' submissions - or even one person
  // testing a couple of different chats' links back to back - can exhaust it for
  // everyone sharing that IP, with no way to tell it apart from real abuse. Keying by
  // token instead means only repeated hits on *that specific* link count against it.
  // `hook: 'preHandler'` runs after body parsing so the token is actually readable
  // here (the default 'onRequest' hook fires before that). MAX_FORM_ORDERS_PER_TICKET
  // below is the real anti-abuse guard (caps actual orders created per link); this is
  // just a backstop against a script hammering one specific link's submit endpoint.
  fastify.post('/submit', {
    config: {
      rateLimit: {
        max: 15,
        timeWindow: '1 minute',
        hook: 'preHandler',
        keyGenerator: (req) => (req.body as { token?: string } | undefined)?.token || req.ip,
      },
    },
  }, async (req, reply) => {
    const body = z.object({
      token: z.string().min(1),
      device_token: z.string().min(1),
      // Required - a pedido without a delivery address can't actually be dispatched,
      // and staff kept having to chase clients down for it after the fact.
      address: z.string().trim().min(1, 'La dirección es obligatoria').max(500),
      payment_method: z.enum(['cash', 'transfer', 'cod']).optional(),
      // Set when the client chose "add to my active order" instead of a new one.
      // Re-validated below (not trusted blindly) - if it's gone stale (e.g. staff
      // closed it while the client was filling the form) this just falls through to
      // creating a new order instead of blocking the submission.
      merge_order_id: z.string().uuid().optional(),
      items: z.array(z.object({
        product_name:   z.string().min(1).max(200),
        quantity_label: z.string().max(100),
        // Client typed this in themselves rather than picking it from the catalog -
        // always flagged added_by_client below so staff notices it needs a price/
        // review, same red flag as any other client edit.
        is_manual: z.boolean().optional(),
      })).min(1).max(100),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    let ticket: Awaited<ReturnType<typeof loadTicketByFormToken>>;
    try {
      ticket = await loadTicketByFormToken(body.data.token);
    } catch (err) {
      return sendInvalidToken(err, reply);
    }

    const actorUser = await resolveActorUser(ticket);
    if (!actorUser) return reply.status(500).send({ error: 'Organización sin usuarios activos', code: 'NO_USER' });

    // Fetch product prices from catalog - needed either way (new order or merge)
    const productNames = body.data.items.map(i => i.product_name);
    const catalogProducts = await fastify.prisma.product.findMany({
      where: { org_id: ticket.org_id, name: { in: productNames }, active: true },
      select: { name: true, price_per_unit: true },
    });
    const priceMap = new Map(catalogProducts.map(p => [p.name, Number(p.price_per_unit ?? 0)]));
    const newItemsData = body.data.items.map(item => ({
      product_name: item.product_name,
      quantity_label: item.quantity_label,
      price: priceMap.get(item.product_name) ?? 0,
      added_by_client: item.is_manual === true,
    }));

    // ── Merge path: replace this order's items with the client's current full list
    // instead of just appending - the form now shows everything already on the order
    // (not a blank slate), so "submit" means "this is the whole order now", items the
    // client removed included. Only orders still in an editable status (nuevo/
    // preparando/listo) qualify; once 'camino' or 'cerrado' only staff can touch it.
    if (body.data.merge_order_id) {
      // Looked up WITHOUT the status/locked filter first, on purpose - the client had
      // the order open (and its full item list loaded into the form) as of form-info,
      // but staff can move it to 'camino' or close it out any time before submit
      // actually lands. The old behavior silently fell through to "create a new
      // order" here, which - since the form now carries the target's ENTIRE existing
      // item list, not just newly-typed ones - duplicated the whole pedido as a
      // brand-new one instead of just failing loudly. Now it never falls through:
      // not-found is a real 404, and no-longer-editable is a real 409 explaining why.
      const target = await fastify.prisma.order.findFirst({
        where: { id: body.data.merge_order_id, ticket_id: ticket.id, org_id: ticket.org_id },
        include: { items: true },
      });

      if (!target) {
        return reply.status(404).send({ error: 'Pedido no encontrado', code: 'NOT_FOUND' });
      }

      // A pedido an encargado typed up manually (source !== 'form') is view-only
      // for the client - always, regardless of status. Staff builds those with
      // their own judgment (prices, substitutions, whatever the customer asked for
      // over a call) and a client edit merging their own item list on top would
      // clobber that. Only a pedido the client themselves created via this same
      // form can be edited back through it.
      if (target.source !== 'form') {
        return reply.status(409).send({
          error: `Tu pedido #${target.num} fue creado por el negocio y no se puede modificar desde aquí. Si necesitas hacer un cambio, contáctanos directamente.`,
          code: 'ORDER_NOT_EDITABLE',
        });
      }

      const isEditable = (EDITABLE_STATUSES as readonly string[]).includes(target.status) && !target.locked;
      if (!isEditable) {
        const STATUS_LABEL_ES: Record<string, string> = { camino: 'en camino', entregado: 'entregado', cerrado: 'cerrado', papelera: 'cancelado' };
        return reply.status(409).send({
          error: `Tu pedido #${target.num} ya está ${STATUS_LABEL_ES[target.status] ?? target.status} y no se puede modificar. Si necesitas hacer un cambio, contáctanos directamente.`,
          code: 'ORDER_NOT_EDITABLE',
        });
      }

      {
        const priorByName = new Map(target.items.map(i => [i.product_name, i]));
        const submittedNames = new Set(body.data.items.map(i => i.product_name));
        const mergedItemsData = body.data.items.map((item, idx) => {
          const prior = priorByName.get(item.product_name);
          const changed = !prior || prior.quantity_label !== item.quantity_label;
          return {
            product_name: item.product_name,
            quantity_label: item.quantity_label,
            // An item already on the order ALWAYS keeps its existing price, no
            // matter what - staff often hand-prices an item because the catalog's
            // price_per_unit is wrong, missing, or just doesn't apply to this
            // specific pedido, and re-deriving it from the catalog on every resubmit
            // (even one triggered by an unrelated one-letter address edit) silently
            // threw that away. The catalog price only ever applies to a genuinely
            // NEW line the client is adding right now (`prior` undefined) - it can
            // never overwrite a price that already existed on the order.
            price: prior ? Number(prior.price) : (priceMap.get(item.product_name) ?? 0),
            sort_order: idx,
            // Sticky once true - an item the client already touched before stays
            // flagged even if this particular submission left it untouched.
            added_by_client: changed || (prior?.added_by_client ?? false),
          };
        });
        const anyItemChange = mergedItemsData.length !== target.items.length
          || mergedItemsData.some(it => { const prior = priorByName.get(it.product_name); return !prior || prior.quantity_label !== it.quantity_label; })
          || target.items.some(i => !submittedNames.has(i.product_name));
        const addressChanged = body.data.address !== target.address;
        const paymentChanged = !!body.data.payment_method && body.data.payment_method !== target.payment_method;

        // Nothing actually changed (client opened the form and resubmitted as-is) -
        // no-op rather than spamming a "tu pedido fue actualizado" WhatsApp message
        // and flipping the staff-facing bell for a non-change.
        if (!anyItemChange && !addressChanged && !paymentChanged) {
          return reply.status(200).send({ data: { ok: true, orderId: target.id, num: target.num, merged: true, unchanged: true } });
        }

        const updated = await fastify.prisma.order.update({
          where: { id: target.id },
          data: {
            ...(addressChanged ? { address: body.data.address } : {}),
            ...(paymentChanged ? { payment_method: body.data.payment_method } : {}),
            client_modified: true,
            items: { deleteMany: {}, create: mergedItemsData },
          },
          include: {
            items: { orderBy: { sort_order: 'asc' } },
            employee: { select: { id: true, name: true } },
            registeredBy: { select: { id: true, name: true } },
            paidBy: { select: { id: true, name: true } },
          },
        });

        // Item-level diff, same shape/labels as staff edits (orders.ts) - a client
        // merge used to write one generic "Pedido actualizado" note with no detail,
        // so which product/price/quantity actually changed was invisible in the
        // Historial. `notes` still says it came from the client via the form, so
        // it stays distinguishable from a staff-made edit.
        const histNotes = `Vía formulario del cliente (enviado por ${actorUser.name})`;
        const historyEntries: any[] = [];
        for (const ri of target.items.filter(i => !submittedNames.has(i.product_name))) {
          historyEntries.push({
            org_id: ticket.org_id, order_id: target.id, actor_id: actorUser.id,
            action_type: 'producto_eliminado', field: 'Producto eliminado',
            value_before: `${ri.quantity_label ? ri.quantity_label + ' ' : ''}${ri.product_name} - $${Number(ri.price).toLocaleString('es-CO')}`,
            value_after: 'Eliminado',
            notes: histNotes,
          });
        }
        for (const item of mergedItemsData) {
          const prior = priorByName.get(item.product_name);
          if (!prior) {
            historyEntries.push({
              org_id: ticket.org_id, order_id: target.id, actor_id: actorUser.id,
              action_type: 'producto_agregado', field: 'Producto agregado',
              value_before: '',
              value_after: `${item.quantity_label ? item.quantity_label + ' ' : ''}${item.product_name} - $${item.price}`,
              notes: histNotes,
            });
          } else {
            const qtyChanged = (prior.quantity_label ?? '') !== (item.quantity_label ?? '');
            const priceChanged = Number(prior.price) !== Number(item.price);
            if (qtyChanged || priceChanged) {
              historyEntries.push({
                org_id: ticket.org_id, order_id: target.id, actor_id: actorUser.id,
                action_type: 'producto_modificado', field: 'Producto modificado',
                value_before: `${prior.quantity_label ? prior.quantity_label + ' ' : ''}${prior.product_name} - $${Number(prior.price).toLocaleString('es-CO')}`,
                value_after: `${item.quantity_label ? item.quantity_label + ' ' : ''}${item.product_name} - $${Number(item.price).toLocaleString('es-CO')}`,
                notes: histNotes,
              });
            }
          }
        }
        if (addressChanged) {
          historyEntries.push({
            org_id: ticket.org_id, order_id: target.id, actor_id: actorUser.id,
            action_type: 'edit', field: 'Dirección',
            value_before: target.address, value_after: body.data.address,
            notes: histNotes,
          });
        }
        if (paymentChanged) {
          historyEntries.push({
            org_id: ticket.org_id, order_id: target.id, actor_id: actorUser.id,
            action_type: 'edit', field: 'Método de pago',
            value_before: PAYMENT_LABEL_CLIENT[target.payment_method] ?? target.payment_method,
            value_after: PAYMENT_LABEL_CLIENT[body.data.payment_method!] ?? body.data.payment_method,
            notes: histNotes,
          });
        }
        await fastify.prisma.orderHistory.createMany({ data: historyEntries });

        const lines = updated.items.map(i => `• ${sanitizeForWhatsApp(i.product_name)}: ${sanitizeForWhatsApp(i.quantity_label ?? '')}`);
        const updatedPaymentLabel = updated.payment_method && updated.payment_method !== 'sin_asignar'
          ? (PAYMENT_LABEL_CLIENT[updated.payment_method] ?? updated.payment_method)
          : 'Sin especificar';
        const msgText = `*Tu pedido #${updated.num} fue actualizado*\n${lines.join('\n')}\n\n_Fecha: ${formatFechaLong(updated.fecha)}_\n_Dirección: ${sanitizeForWhatsApp(updated.address)}_\n_Método de pago: ${updatedPaymentLabel}_\n\n_El encargado revisará los cambios._`;

        const message = await fastify.prisma.ticketMessage.create({
          data: { ticket_id: ticket.id, direction: 'out', text: msgText, sent_at: new Date(), sent_by: actorUser.id },
        });
        await fastify.prisma.ticket.update({ where: { id: ticket.id }, data: { last_message_at: new Date() } });

        const provider = MetaCloudProvider.fromOrg(ticket.org);
        let wppMessageId: string | null = null;
        let failedReason: string | null = null;
        if (provider) {
          try {
            // Saved onto the message below - webhook.ts's ingestStatus matches every
            // later delivered/read/failed status update by this id. Without it, this
            // confirmation's check mark stays stuck on "sent" forever, never a real
            // failure either (see inbox.ts's /reply for the same fix, same reasoning).
            const sent = await provider.sendText(ticket.phone, msgText);
            wppMessageId = sent.messageId;
          } catch (err: any) {
            failedReason = String(err?.message ?? 'Error desconocido Meta API').slice(0, 255);
            fastify.log.error({ err, ticketId: ticket.id }, 'WPP: error enviando confirmación de items agregados');
          }
        } else {
          fastify.log.warn({ ticketId: ticket.id }, 'WPP: org sin credenciales Meta, confirmación solo guardada en BD');
        }
        if (wppMessageId || failedReason) {
          await fastify.prisma.ticketMessage.update({
            where: { id: message.id },
            data: { wpp_message_id: wppMessageId, failed_reason: failedReason },
          });
        }

        // Same as staff editing the order (orders.ts's PATCH /:id) - the client just
        // changed something real about this order via the form, so any factura
        // already sent for it is now a stale snapshot.
        await fastify.prisma.invoiceLink.updateMany({
          where: { order_id: updated.id, org_id: ticket.org_id, revoked_at: null },
          data: { revoked_at: new Date() },
        });

        const updatedWithFlags = { ...updated, ...(await clientChangedFlags(fastify.prisma, updated.id)) };
        fastify.io.to(`org:${ticket.org_id}`).emit('order:updated', updatedWithFlags as any);
        fastify.io.to(`org:${ticket.org_id}`).emit('ticket:message', {
          ticketId: ticket.id,
          message: {
            id: message.id, ticket_id: ticket.id, direction: 'out' as const, text: message.text,
            media_url: null, media_type: null, media_caption: null,
            sent_by: actorUser.id, sent_by_name: actorUser.name, wpp_message_id: wppMessageId,
            sent_at: message.sent_at.toISOString(), delivered: false, read_by_client: false, failed_reason: failedReason,
          },
        });

        return reply.status(200).send({ data: { ok: true, orderId: updated.id, num: updated.num, merged: true } });
      }
    }

    // ── New order path ──
    // Colombia UTC-5 local date for fecha
    const todayLocal = new Date(new Date(Date.now() - 5 * 3600000).toISOString().split('T')[0]);

    // Cap NEW orders generated per form link, PER DAY - the token stays valid for 7
    // days with no revocation, so without this a single leaked/shared link could
    // spam-create orders. Scoped to `fecha`, not the ticket's whole lifetime: a
    // ticket is one row per phone forever now (not per day, see schema.prisma), so a
    // lifetime cap meant any regular customer would eventually place their 4th-ever
    // form order and be permanently locked out of the link, forever, with no way to
    // recover short of staff editing the DB. Doesn't apply to the merge path above
    // since that never creates a new order.
    const existingFormOrdersToday = await fastify.prisma.order.count({
      where: { ticket_id: ticket.id, source: 'form', fecha: todayLocal },
    });
    if (existingFormOrdersToday >= MAX_FORM_ORDERS_PER_TICKET) {
      return reply.status(429).send({ error: 'Límite de pedidos alcanzado para este link por hoy. Contáctanos directamente si necesitas hacer otro.', code: 'FORM_LIMIT_REACHED' });
    }

    const orderItems = newItemsData.map((item, idx) => ({ ...item, sort_order: idx }));

    const order = await createOrderWithRetryNum(fastify.prisma, ticket.org_id, todayLocal, (num) =>
      fastify.prisma.order.create({
        data: {
          org_id: ticket.org_id,
          ticket_id: ticket.id,
          num,
          customer_name: ticket.customer_name ?? '',
          // Snapshot at creation time, never touched afterward - see
          // schema.prisma's own comment on client_contact_name. Matches
          // orders.ts's own staff-side order creation.
          client_contact_name: ticket.customer_name ?? '',
          customer_phone: ticket.phone,
          address: body.data.address,
          channel: 'whatsapp',
          payment_method: body.data.payment_method ?? 'sin_asignar',
          status: 'nuevo',
          source: 'form',
          registered_by: actorUser.id,
          fecha: todayLocal,
          items: { create: orderItems },
        },
        include: {
          items: { orderBy: { sort_order: 'asc' } },
          employee: { select: { id: true, name: true } },
          registeredBy: { select: { id: true, name: true } },
          paidBy: { select: { id: true, name: true } },
        },
      }),
    );
    const num = order.num;

    // Mensaje en el chat del ticket
    const lines = body.data.items.map(i => `• ${sanitizeForWhatsApp(i.product_name)}: ${sanitizeForWhatsApp(i.quantity_label)}`);
    const paymentLabel = body.data.payment_method
      ? (PAYMENT_LABEL_CLIENT[body.data.payment_method] ?? body.data.payment_method)
      : 'Sin especificar';
    const msgText = `*Pedido #${num} recibido desde el formulario*\n${lines.join('\n')}\n\n_Fecha: ${formatFechaLong(todayLocal)}_\n_Dirección: ${sanitizeForWhatsApp(body.data.address)}_\n_Método de pago: ${paymentLabel}_\n\n_El encargado revisará y confirmará el pedido._`;

    const message = await fastify.prisma.ticketMessage.create({
      data: {
        ticket_id: ticket.id,
        direction: 'out',
        text: msgText,
        sent_at: new Date(),
        sent_by: actorUser.id,
      },
    });

    await fastify.prisma.ticket.update({
      where: { id: ticket.id },
      data: { last_message_at: new Date() },
    });

    // Actually deliver the confirmation to the client's WhatsApp - previously this only
    // wrote the message to the DB and broadcast it to staff views, so staff saw a
    // "recibido" message in the chat but the client's phone never got anything.
    const provider = MetaCloudProvider.fromOrg(ticket.org);
    let wppMessageId: string | null = null;
    let failedReason: string | null = null;
    if (provider) {
      try {
        // Saved onto the message below - see the merge path's identical fix above
        // (same file) for why this id has to be captured, not just discarded.
        const sent = await provider.sendText(ticket.phone, msgText);
        wppMessageId = sent.messageId;
      } catch (err: any) {
        failedReason = String(err?.message ?? 'Error desconocido Meta API').slice(0, 255);
        fastify.log.error({ err, ticketId: ticket.id }, 'WPP: error enviando confirmación de pedido desde formulario');
      }
    } else {
      fastify.log.warn({ ticketId: ticket.id }, 'WPP: org sin credenciales Meta, confirmación de formulario solo guardada en BD');
    }
    if (wppMessageId || failedReason) {
      await fastify.prisma.ticketMessage.update({
        where: { id: message.id },
        data: { wpp_message_id: wppMessageId, failed_reason: failedReason },
      });
    }

    // Historial del pedido - una entrada 'create' del pedido, más un
    // producto_agregado por cada ítem inicial (mismo formato que un edit posterior),
    // para que se vea qué productos/precios trajo desde el inicio, no solo en ediciones.
    await fastify.prisma.orderHistory.create({
      data: {
        org_id: ticket.org_id,
        order_id: order.id,
        actor_id: actorUser.id,
        action_type: 'create',
        notes: `Pedido creado desde formulario (enviado por ${actorUser.name})`,
      },
    });
    if (order.items.length > 0) {
      await fastify.prisma.orderHistory.createMany({
        data: order.items.map((i) => ({
          org_id: ticket.org_id, order_id: order.id, actor_id: actorUser.id,
          action_type: 'producto_agregado', field: 'Producto agregado',
          value_before: '',
          value_after: `${i.quantity_label ? i.quantity_label + ' ' : ''}${i.product_name} - $${Number(i.price).toLocaleString('es-CO')}`,
          notes: `Agregado al crear el pedido desde formulario (enviado por ${actorUser.name})`,
        })),
      });
    }

    // Socket events
    fastify.io.to(`org:${ticket.org_id}`).emit('order:created', order as any);
    fastify.io.to(`org:${ticket.org_id}`).emit('ticket:message', {
      ticketId: ticket.id,
      message: {
        id: message.id,
        ticket_id: ticket.id,
        direction: 'out' as const,
        text: message.text,
        media_url: null, media_type: null, media_caption: null,
        sent_by: actorUser.id, sent_by_name: actorUser.name, wpp_message_id: wppMessageId,
        sent_at: message.sent_at.toISOString(),
        delivered: false, read_by_client: false, failed_reason: failedReason,
      },
    });

    // Nudges the client for a payment method right away when they submitted the
    // form without picking one - a "Sin especificar" sitting in the confirmation
    // above is easy to skim past; a direct question isn't. Sent as its own
    // message, same "receipt first, question second" ordering as everywhere else
    // in this file that sends more than one message per action.
    if (!body.data.payment_method) {
      const promptText = '¿Efectivo o transferencia?';
      const promptMessage = await fastify.prisma.ticketMessage.create({
        data: { ticket_id: ticket.id, direction: 'out', text: promptText, sent_at: new Date(), sent_by: actorUser.id },
      });
      let promptWppMessageId: string | null = null;
      let promptFailedReason: string | null = null;
      if (provider) {
        try {
          const sent = await provider.sendText(ticket.phone, promptText);
          promptWppMessageId = sent.messageId;
        } catch (err: any) {
          promptFailedReason = String(err?.message ?? 'Error desconocido Meta API').slice(0, 255);
          fastify.log.error({ err, ticketId: ticket.id }, 'WPP: error enviando pregunta de método de pago');
        }
      }
      if (promptWppMessageId || promptFailedReason) {
        await fastify.prisma.ticketMessage.update({
          where: { id: promptMessage.id },
          data: { wpp_message_id: promptWppMessageId, failed_reason: promptFailedReason },
        });
      }
      fastify.io.to(`org:${ticket.org_id}`).emit('ticket:message', {
        ticketId: ticket.id,
        message: {
          id: promptMessage.id, ticket_id: ticket.id, direction: 'out' as const, text: promptText,
          media_url: null, media_type: null, media_caption: null,
          sent_by: actorUser.id, sent_by_name: actorUser.name, wpp_message_id: promptWppMessageId,
          sent_at: promptMessage.sent_at.toISOString(), delivered: false, read_by_client: false, failed_reason: promptFailedReason,
        },
      });
    }

    return reply.status(201).send({ data: { ok: true, orderId: order.id, num: order.num } });
  });

  // POST /api/v1/public/order/:orderId/delete - client cancels their OWN order
  // entirely (not an edit) via the form link. Same eligibility gate as everything
  // else the client can touch here (source==='form', still nuevo/preparando/listo,
  // not locked) - can't cancel an order staff typed up manually, or one already
  // past the point of no return. Soft-deletes via the same 'papelera' status
  // staff's own trash already uses (not a hard DELETE) - keeps the order/history
  // for the audit trail. form-info's own `notIn: ['cerrado','papelera']` filter
  // means the client's NEXT visit to this same link sees no active order for
  // today and lands straight back in the fresh catalog form, same as a brand new
  // customer - no special-casing needed there.
  fastify.post('/order/:orderId/delete', {
    config: {
      rateLimit: {
        max: 15,
        timeWindow: '1 minute',
        hook: 'preHandler',
        keyGenerator: (req) => (req.body as { token?: string } | undefined)?.token || req.ip,
      },
    },
  }, async (req, reply) => {
    const { orderId } = req.params as { orderId: string };
    const body = z.object({ token: z.string().min(1), device_token: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Datos inválidos', code: 'VALIDATION_ERROR' });

    let ticket: Awaited<ReturnType<typeof loadTicketByFormToken>>;
    try {
      ticket = await loadTicketByFormToken(body.data.token);
    } catch (err) {
      return sendInvalidToken(err, reply);
    }

    const order = await fastify.prisma.order.findFirst({
      where: { id: orderId, ticket_id: ticket.id, org_id: ticket.org_id },
    });
    if (!order) return reply.status(404).send({ error: 'Pedido no encontrado', code: 'NOT_FOUND' });

    const isEditable = order.source === 'form' && (EDITABLE_STATUSES as readonly string[]).includes(order.status) && !order.locked;
    if (!isEditable) {
      return reply.status(400).send({
        error: 'Este pedido ya no se puede eliminar - contáctanos directamente si necesitas cambiar algo.',
        code: 'NOT_EDITABLE',
      });
    }

    const actorUser = await resolveActorUser(ticket);
    if (!actorUser) return reply.status(500).send({ error: 'Organización sin usuarios activos', code: 'NO_USER' });

    // A marker appended to `notes` (never overwritten), same convention cierre.ts
    // already uses for its own 'pasado_manana:DATE' deferral markers - lets staff
    // (admin AND encargado, `notes` is always selected regardless of role, unlike
    // the audit `history` array which encargado no longer sees at all) tell a
    // client-initiated delete apart from a staff one at a glance, without a schema
    // change. The Papelera list/detail view checks for this to show a warning
    // badge + a "Restaurar" action.
    const deletedMarker = `client_deleted:${Date.now()}`;
    const newNotes = order.notes ? `${order.notes}\n${deletedMarker}` : deletedMarker;

    await fastify.prisma.$transaction([
      fastify.prisma.order.update({ where: { id: order.id }, data: { status: 'papelera', client_modified: true, notes: newNotes } }),
      fastify.prisma.orderHistory.create({
        data: {
          org_id: ticket.org_id, order_id: order.id, actor_id: actorUser.id,
          action_type: 'papelera', field: 'Estado',
          value_before: order.status,
          value_after: 'Eliminado por el cliente',
          notes: 'Vía formulario del cliente',
        },
      }),
    ]);

    // Same event the board/staff swimlane already listens for on any status move
    // (orders.ts's PATCH /:id/status) - the card disappears from the active
    // columns into papelera live, no different from a staff-initiated delete.
    fastify.io.to(`org:${ticket.org_id}`).emit('order:moved', { orderId: order.id, newStatus: 'papelera' });

    return reply.send({ data: { ok: true } });
  });

  // Legacy: GET /api/v1/public/org/:slug - kept for backward compat
  fastify.get('/org/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const org = await fastify.prisma.organization.findFirst({
      where: { slug, active: true },
      select: { id: true, name: true, slug: true },
    });
    if (!org) return reply.status(404).send({ error: 'Organización no encontrada', code: 'NOT_FOUND' });
    return reply.send({ data: org });
  });
}
