# AGENTS.md — 4Client

SaaS multi-tenant para gestionar pedidos por WhatsApp de fruvers (tiendas de frutas y verduras, Colombia). Primer cliente en producción: Fruver San Gabriel. Monorepo pnpm: `apps/api` (Fastify + Prisma + Postgres 16), `apps/web` (React + Vite), `packages/shared` (tipos).

**Todo el contexto del proyecto está en `specs/`. Lee antes de tocar código.**

## Reglas obligatorias

1. **`main` = producción con un cliente real.** Nunca hagas merge ni push a `main` sin OK explícito de José, cada vez. El deploy de `main` ejecuta migraciones al arrancar (`start.sh`): toda migración debe ser aditiva.
2. **Una rama por trabajo, desde `dev`** (`feature/`, `fix/`, `chore/`, `docs/`). Se integra a `dev` con merge y **se borra la rama** en local y en GitHub. Solo existen `dev` y `main`. Detalle y comandos: `specs/04-operacion/flujo-de-trabajo.md`.
3. **Verifica antes de integrar:** `tsc --noEmit` en api y web, `vitest run` en api (Postgres local), `vite build` en web.
4. **Las specs describen el comportamiento actual verificado; las dudas de intención están como PREG.** Si el código difiere de la spec y no hay un BUG registrado, **para**: anótalo como PREG en `specs/03-plan/preguntas-abiertas.md` y pregunta a José; no "arregles" lo que podría ser intencional. Si la spec no dice algo, dilo: no lo inventes.
5. **Cambios clase C** (feature, esquema, API, dinero, privacidad): escribe `specs/03-plan/cambios/CH-nnnn-*.md` y espera aprobación **antes** del código.
6. **Definición de terminado** (todo en la misma rama, antes de integrar a `dev`): spec del módulo actualizada y su `verificado`; BUG cerrado con sha; sospechas nuevas como PREG; **asiento nuevo `R-nnnn` en `specs/05-historia/registro-de-cambios.md`** (también si el cambio es solo de docs, clase A o una reversa; el campo "Prod" se completa cuando viaje a `main`); `specs/00-estado-actual.md` actualizado. Qué archivos tocar según el cambio: `specs/_plantillas/checklist.md`.
7. **Las specs nunca quedan viejas.** Si tu cambio vuelve falsa cualquier parte de las specs (lenguaje, regla, infraestructura, permisos…), corrígela **en el mismo cambio**, en todos los archivos afectados, y anota en el asiento cuáles y qué decían. Si no toca ninguna spec, igual hay asiento ("ninguna (clase A)").
8. **Lee siempre el horizonte** (`specs/00-horizonte.md`): hacia dónde va el producto (báscula conectada, pagos, segundo cliente). Antes de implementar, comprueba que no le cierras el camino; si choca, pregunta a José. Si tu cambio cumple o desvía algo del horizonte, actualízalo.
9. **Nunca** escribas en el repo secretos, tokens, URLs de base con credenciales ni datos reales de clientes finales.
10. Si tu memoria o contexto previo contradice `specs/`, **gana `specs/`**; reporta la contradicción.
11. Commits en español (`tipo: descripción`); documentación e interfaz en español; identificadores de código en inglés.

## Orden de lectura (según presupuesto de contexto)

- **Siempre:** este archivo, `specs/00-horizonte.md`, `specs/00-estado-actual.md`, `specs/00-principios.md` (Claude los carga solo vía `CLAUDE.md`; con otra herramienta, léelos tú).
- **Según la tarea:** `specs/modulos/<MOD>.md` del área (mapa abajo), y `specs/01-funcional/glosario.md` si dudas de un término.
- **Tareas operativas:** alta de un negocio nuevo → `specs/04-operacion/alta-de-negocio.md`; algo falla → `specs/04-operacion/diagnostico-de-incidentes.md` y `runbooks.md`; desplegar → `flujo-de-trabajo.md`; qué specs tocar → `specs/_plantillas/checklist.md`.
- **Transversal:** esquema o datos → `specs/02-tecnico/datos-y-migraciones.md` (diagrama y diccionario: `modelo-de-datos.md`); endpoint o evento → `specs/02-tecnico/api-y-eventos.md`; seguridad o privacidad → `specs/02-tecnico/seguridad-y-privacidad.md` (amenazas: `modelo-de-amenazas.md`; datos personales y derechos del titular: `datos-personales.md`; riesgos: `specs/03-plan/riesgos.md`); infraestructura, deploy o backups (monitoreo, RPO/RTO: `specs/04-operacion/observabilidad-y-continuidad.md`) → `specs/04-operacion/entornos-y-despliegue.md` y `runbooks.md`; cuánto dura / cuántos permite algo → `specs/02-tecnico/limites-y-tiempos.md`; código de error → `specs/02-tecnico/codigos-de-error.md`; la web (componentes, hooks, PWA) → `specs/02-tecnico/frontend.md`; alta de un negocio nuevo o un incidente → `specs/04-operacion/alta-de-negocio.md`, `diagnostico-de-incidentes.md`; qué specs tocar al agregar algo → `specs/_plantillas/checklist.md`.
- **Antes de revertir un comportamiento:** `specs/05-historia/decisiones.md`.
- Índice completo: `specs/README.md`.

## Por pregunta de negocio

| Pregunta | Dónde |
|---|---|
| ¿Cuánto dura / cuántos permite…? | `specs/02-tecnico/limites-y-tiempos.md` |
| ¿Quién puede hacer qué? | `specs/01-funcional/actores-y-permisos.md` |
| ¿Qué significa este término? | `specs/01-funcional/glosario.md` |
| ¿Cómo es un día de punta a punta? | `specs/01-funcional/ciclo-diario.md` |
| ¿Qué está pendiente o dudoso? | `specs/03-plan/preguntas-abiertas.md`, `problemas-conocidos.md` |
| ¿Por qué se hizo así? | `specs/05-historia/decisiones.md` |
| ¿Hacia dónde va el producto? | `specs/00-horizonte.md` |
| ¿Qué se cambió y cuándo? | `specs/05-historia/registro-de-cambios.md` |

## Mapa código → módulo

| Si tocas… | Lee |
|---|---|
| `routes/users.ts`, `employees.ts`, `auth.ts`, `middleware/auth.ts`, `plugins/socket.ts` | `modulos/ACC.md` |
| `routes/webhook.ts`, `lib/businessDate.ts`, `lib/messageTemplates.ts`, `routes/config.ts` | `modulos/WPP.md` |
| `routes/inbox.ts`, `routes/tickets.ts`, `lib/formLink.ts`, `lib/linkSecurity.ts`, `InboxPanel`, `TicketModal` | `modulos/INB.md` |
| `services/ai/*`, `lib/matchProduct.ts` | `modulos/IA.md` |
| `routes/public.ts`, `pages/ClientFormPage.tsx` | `modulos/FRM.md` |
| `routes/orders.ts` (excepto cobro), `lib/orderNumbering.ts`, `Swimlane`, `DetallePedidoModal`, `NuevoPedidoModal` | `modulos/ORD.md` |
| cobro, crédito, `routes/cierre.ts`, `CierreCajaModal` | `modulos/CAJ.md` |
| `routes/dashboard.ts`, `ResumenTab` | `modulos/DSH.md` |
| `routes/products.ts`, `ProductsSection`, `catalogImage`, `productExcel` | `modulos/CAT.md` |
| `routes/files.ts`, PDF en `DetallePedidoModal`, `FacturaPage` | `modulos/FAC.md` |
| `routes/dev.ts`, `routes/billing.ts`, `lib/audit.ts`, `DevSection` | `modulos/PLT.md` |

## Comandos

```bash
pnpm install
pnpm dev:api                     # API en :3000 (tsx watch)
pnpm dev:web                     # web en :5173
cd apps/api && npx vitest run    # tests (Postgres local: specs/04-operacion/desarrollo-local.md)
```

Datos de prueba que José va a mirar: ponlos con la **fecha real de hoy**, no una fecha futura inventada (así no tiene que cambiar el selector de fecha).
