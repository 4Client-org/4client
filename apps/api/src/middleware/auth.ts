import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthPayload, UserRole } from '@4client/shared';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthPayload;
    user: AuthPayload;
  }
}

// Sesión única (decisión de José 2026-10-10): solo administrador y dev. El encargado
// y el domiciliario pueden tener varias sesiones abiertas a la vez.
export function hasSingleSession(role: string): boolean {
  return role === 'admin' || role === 'dev';
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
    req.user = req.user as AuthPayload;
    // Form-link tokens (routes/public.ts) are signed with the same JWT_SECRET but carry
    // a different payload shape ({ type: 'form_link', ticketId, orgId, ... }, no userId/role).
    // Without this check, a client's form link could be replayed as a Bearer token against
    // any staff route that only requires `authenticate` (no role check) - e.g. GET /orders -
    // and, since it still has an `orgId` field, would pass org-scoping and leak every order.
    if (!req.user.userId || !req.user.role) {
      return reply.status(401).send({ error: 'No autorizado', code: 'UNAUTHORIZED' });
    }
    // Corte inmediato: el access token (15 min) es stateless, así que se contrasta
    // con la fila del usuario en cada petición (select mínimo por clave primaria).
    // Usuario inexistente, desactivado, de otra org o con rol distinto al del token
    // -> 401. En el caso del rol, el cliente web reintenta con /auth/refresh, que
    // emite un token nuevo con el rol vigente (o falla si la cuenta está desactivada).
    const current = await req.server.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { active: true, role: true, org_id: true, session_id: true },
    });
    if (!current || !current.active || current.role !== req.user.role || current.org_id !== req.user.orgId) {
      return reply.status(401).send({ error: 'No autorizado', code: 'UNAUTHORIZED' });
    }
    // Sesión única de admin y dev: si ya hay una sesión vigente registrada, el token
    // debe ser de ella. Un token sin `sid` (anterior a esta regla) sigue valiendo solo
    // mientras la cuenta no haya iniciado sesión de nuevo (session_id nulo).
    if (hasSingleSession(current.role) && current.session_id && req.user.sid !== current.session_id) {
      return reply.status(401).send({ error: 'Tu sesión se cerró porque se inició en otro dispositivo', code: 'SESSION_REPLACED' });
    }
  } catch {
    reply.status(401).send({ error: 'No autorizado', code: 'UNAUTHORIZED' });
  }
}

export function requireRole(...roles: UserRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const role = req.user.role as UserRole;
    // dev is a super-role that passes all role checks
    if (role === 'dev' || roles.includes(role)) return;
    // Por ahora el domiciliario puede lo mismo que el encargado (decisión de José
    // 2026-10-10, PREG-012). Lo que es solo de admin sigue cerrado.
    if (role === 'domiciliario' && roles.includes('encargado')) return;
    return reply.status(403).send({ error: 'Acceso denegado', code: 'FORBIDDEN' });
  };
}
