# 4Client

Plataforma SaaS multi-tenant que convierte el WhatsApp Business de un negocio (fruvers, tiendas de frutas y verduras en Colombia) en un sistema de pedidos: los clientes escriben o llenan un formulario, el personal gestiona los pedidos en un tablero en tiempo real, cobra, cierra la caja y envía la factura por WhatsApp.

Primer cliente en producción: **Fruver San Gabriel** (Bogotá).

## Documentación

Todo el contexto del proyecto vive en **[`specs/`](specs/README.md)**: negocio, arquitectura, operación, decisiones, pendientes y hacia dónde va. Si eres una IA o una persona nueva, empieza por **[`AGENTS.md`](AGENTS.md)**.

| Quiero saber… | Voy a |
|---|---|
| Qué hace el producto y para quién | [`specs/01-funcional/vision-y-direccion.md`](specs/01-funcional/vision-y-direccion.md) |
| Cómo funciona una parte | [`specs/modulos/`](specs/modulos) |
| Cómo está construido | [`specs/02-tecnico/`](specs/02-tecnico) |
| Cómo se trabaja y se despliega | [`specs/04-operacion/flujo-de-trabajo.md`](specs/04-operacion/flujo-de-trabajo.md) |
| Cómo levantarlo en local | [`specs/04-operacion/desarrollo-local.md`](specs/04-operacion/desarrollo-local.md) |
| Qué está pendiente o dudoso | [`specs/03-plan/`](specs/03-plan) |
| Estado actual | [`specs/00-estado-actual.md`](specs/00-estado-actual.md) |

## Stack

Monorepo pnpm: `apps/api` (Fastify 5 + Prisma + PostgreSQL 16 + Socket.IO), `apps/web` (React 18 + Vite + PWA), `packages/shared` (tipos). WhatsApp Business Cloud API de Meta, Cloudflare R2 para archivos.

## Infraestructura

API y bases de datos en un VPS administrado con Coolify; web en Cloudflare Pages. Un push a `dev` despliega el entorno dev y un push a `main` despliega producción (solo con aprobación). Detalle en [`specs/04-operacion/entornos-y-despliegue.md`](specs/04-operacion/entornos-y-despliegue.md).

## Flujo de ramas

Solo existen `dev` y `main`. Cada trabajo va en una rama nueva desde `dev`, se integra a `dev` y la rama se borra. `main` es producción y no se toca sin aprobación. Pasos y comandos en [`specs/04-operacion/flujo-de-trabajo.md`](specs/04-operacion/flujo-de-trabajo.md).

## Material histórico

[`archivo/`](archivo/README.md) conserva la propuesta comercial, el manual de usuario y los planes originales. Están desactualizados y no son fuente de verdad.
