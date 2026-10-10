---
estado: vigente
verificado: 2026-10-10 @ 1edb809
fuentes: [package.json, apps/api/package.json, apps/web/package.json, apps/api/.env.example, .env.example, apps/api/vitest.config.ts, apps/api/test/globalSetup.ts, apps/api/src/config.ts, apps/api/src/seed.ts, apps/api/src/seed-chats.ts, apps/api/src/seed-wpp.ts, apps/api/prisma/migrations/20260802050000_chat_search_trgm/migration.sql, apps/web/vite.config.ts, apps/web/src/lib/apiBase.ts, .github/workflows/ci.yml]
---

# Desarrollo local

> **Resumen.** Para trabajar en local hacen falta Node 20, pnpm 10 y un Postgres 16 con dos bases (`fourclient` para la API y `fourclient_test` para Vitest). Los pasos: instalar, crear `apps/api/.env` y `.env.test`, levantar Postgres con la receta de §4, migrar, y correr `pnpm dev:api` / `pnpm dev:web`. La sección 8 lista las trampas más frecuentes.

Cómo levantar 4Client en una máquina de desarrollo y correr los tests. Para el flujo de ramas y verificación antes de integrar, ver [`flujo-de-trabajo.md`](flujo-de-trabajo.md).

## 1. Requisitos

| Herramienta | Versión | Por qué esa | Fuente |
|---|---|---|---|
| Node.js | 20 | Es la del `Dockerfile` (`node:20-slim`) y la de la CI | (código) |
| pnpm | 10 | `corepack prepare pnpm@10` en el Dockerfile; `pnpm/action-setup` v10 en CI | (código) |
| PostgreSQL | 16 | Es la de CI (`postgres:16`) y la que declara José para prod (PREG-092: el respaldo usa un cliente 18) | (código), (José) |

En la máquina de José los binarios del servidor ya están en `/usr/lib/postgresql/16/bin` (no hace falta instalar ni extraer nada) (José).

## 2. Instalar

```bash
pnpm install            # en la raíz: instala api, web y packages/shared
```

`package.json › pnpm.onlyBuiltDependencies` limita qué paquetes pueden correr scripts de instalación (Prisma, bcrypt, esbuild). Si pnpm avisa que un build fue ignorado, revisar esa lista antes de aprobarlo.

```bash
cd apps/api && npx prisma generate      # cliente Prisma (también lo hace el build)
```

## 3. Archivos de entorno

Nunca se commitean (`.gitignore` excluye `.env`, `.env.local`, `.env.test`). Solo los `.env.example` están en git.

| Archivo | Lo lee | Plantilla | Variables mínimas (nombres) |
|---|---|---|---|
| `apps/api/.env` | la API en local (`import 'dotenv/config'` con cwd `apps/api`) y los scripts de `apps/api/src/*.ts` | `apps/api/.env.example` | `DATABASE_URL` (a la base `fourclient`), `JWT_SECRET` (≥32), `NODE_ENV=development`, `FRONTEND_URL=http://localhost:5173` |
| `apps/api/.env.test` | Vitest (`vitest.config.ts` y `test/globalSetup.ts`) | no hay plantilla; crearlo a mano | `DATABASE_URL` (**debe contener `fourclient_test`**), `JWT_SECRET`, `NODE_ENV`, `PORT`, `FRONTEND_URL`, `META_WEBHOOK_VERIFY_TOKEN` |
| `apps/web/.env.local` | Vite | — | Opcional: `VITE_API_URL` solo si quieres apuntar la web local a otra API |

Opcionales en `apps/api/.env` según lo que pruebes: `META_*` y `WPP_TOKEN_ENC_KEY` (WhatsApp), `R2_*` (si no están, las facturas van a `apps/api/uploads/`, ignorado por git), `GEMINI_API_KEY`/`GROQ_API_KEY`/`OPENROUTER_API_KEY` (Tomar lista), `RESEND_API_KEY` + `REQUIRE_2FA` (2FA), `SEED_ADMIN_PASS`/`SEED_DEV_PASS` (seed). Lista completa: `apps/api/src/config.ts › envSchema`.

**Ojo con `apps/api/.env.example`:** trae `NODE_ENV="production"`. Copiado tal cual para local, la API se niega a arrancar (pide `APP_ENVIRONMENT_NAME`) y, si se la das, rechaza todo lo que no llegue por HTTPS. En local usa `NODE_ENV=development` y no definas `APP_ENVIRONMENT_NAME` (`config.ts`, `server.ts`, código). PREG-108.

El `.env.example` de la **raíz** es una plantilla vieja que la API no lee. PREG-109.

## 4. Postgres local (receta de José)

`/tmp` se borra periódicamente en la máquina de trabajo: cuando la base "desaparece", se repite la receta completa (José).

```bash
export PATH=/usr/lib/postgresql/16/bin:$PATH

# 1. Crear el clúster (una vez por cada vez que /tmp se borró)
initdb -D /tmp/pgdata_jose -U fourclient --auth=trust

# 2. Arrancar (socket en /tmp/pgsock_jose, TCP en localhost:5432)
pg_ctl -D /tmp/pgdata_jose -o "-k /tmp/pgsock_jose -p 5432" -l /tmp/pg_jose.log start

# 3. Contraseña y bases
psql -h /tmp/pgsock_jose -p 5432 -U fourclient -d postgres
```

```sql
ALTER USER fourclient PASSWORD '<contraseña de desarrollo>';  -- la de apps/api/.env.test; no se copia aquí
CREATE DATABASE fourclient;        -- la que usa la API en local
CREATE DATABASE fourclient_test;   -- la que usan los tests
```

- Con `--auth=trust` las conexiones locales no validan la contraseña, pero se define igual para que `DATABASE_URL` tenga la misma forma que en CI.
- Parar: `pg_ctl -D /tmp/pgdata_jose stop`. Ver el log: `/tmp/pg_jose.log`.
- Esquema de la base de desarrollo: `cd apps/api && npx prisma migrate deploy` (aplica las migraciones del repo, igual que prod). La de tests la migra Vitest sola.
- Requiere las extensiones `pg_trgm` y `unaccent` (contrib, vienen con Postgres): las crea la migración `20260802050000_chat_search_trgm`.

## 5. Correr la app

```bash
pnpm dev:api      # API en :3000 (tsx watch src/server.ts)
pnpm dev:web      # web en :5173
```

- En `localhost`, la web habla directo con `http://localhost:3000` (`apiBase.ts`), así que `FRONTEND_URL` de la API debe incluir `http://localhost:5173` para CORS y socket. El proxy `/api` de `vite.config.ts` queda como respaldo.
- `GET http://localhost:3000/health` → `{"status":"ok", ...}`.
- Sin `META_APP_SECRET` la API avisa en el log que el webhook acepta peticiones sin firma: es lo esperado fuera de prod.
- La web en local muestra el banner rojo "DEV" (`isDevEnvironment`).

## 6. Tests

```bash
cd apps/api
npx vitest run                         # toda la suite (Postgres real)
npx vitest run test/orders.test.ts     # un archivo
```

- `test/globalSetup.ts` carga `.env.test`, **se niega a correr** si `DATABASE_URL` no contiene `fourclient_test`, y aplica `prisma migrate deploy` a esa base antes de la suite (código).
- Los archivos corren en serie (`fileParallelism: false`) contra una sola base; cada test crea sus propios datos aleatorios (`vitest.config.ts`, código).
- Los servicios externos (Meta, IA, R2, Resend) se simulan; la base no (principio 11).
- La CI corre lo mismo con un Postgres 16 de servicio (`ci.yml`).

Verificación completa antes de integrar (tipos, tests, build): `flujo-de-trabajo.md` §3.

## 7. Datos de prueba

### Seed base

```bash
cd apps/api
SEED_ADMIN_PASS='<...>' SEED_DEV_PASS='<...>' pnpm db:seed     # tsx src/seed.ts
```

- Sin las dos variables el script termina con error: no hay contraseña por defecto (`seed.ts`, código). Deben cumplir la política de contraseñas (12+ caracteres, mayúscula, minúscula y dígito; comentario de `.env.example`).
- Crea (o deja intactos si ya existen) la organización `fruver-san-gabriel`, un usuario `admin`, un usuario `dev` y el catálogo de productos. Es idempotente: re-correrlo **no** cambia contraseñas de cuentas existentes.
- Los datos de la organización y los correos del seed son los del cliente real: es solo para tu base local. Nunca se corre contra prod (allí `POST /dev/seed` además responde 403).

### Otros scripts

| Script | Qué hace | Cuidado |
|---|---|---|
| `src/seed-chats.ts` | Crea chats de ejemplo | Usa una **fecha fija** (2026-06-27), contraria a la convención de abajo. PREG-110 |
| `src/seed-wpp.ts` | Copia `META_*` del `.env` a la primera organización (cifra con `WPP_TOKEN_ENC_KEY` si existe) | Teléfono de prueba fijo en el código |
| Acción dev "crear ticket de prueba" (`POST /api/v1/dev/actions/create-test-ticket`, panel Configuración › Dev › Base de datos) | Un ticket con mensajes entrantes falsos, sin enviar nada por WhatsApp | Ponerle la fecha de hoy |

### Convención: fecha real de hoy

Los datos de prueba que José va a mirar (pedidos, tickets) van con la **fecha real del día** en que se crean, no con una fecha futura inventada, para que no tenga que mover el selector de fecha (José; también en `AGENTS.md`). Recordar que el día de negocio es de Bogotá (UTC-5) y que un chat que arranca de 21:00 en adelante cuenta para el día siguiente (`lib/businessDate.ts`).

## 8. Trampas frecuentes

| Síntoma | Causa | Qué hacer |
|---|---|---|
| `prisma migrate dev` propone `DROP INDEX "tickets_phone_trgm_idx"` (y posiblemente los otros índices `*_trgm_idx`) | Esos índices GIN con `immutable_unaccent(...)` se crearon en SQL a mano en la migración `20260802050000_chat_search_trgm`; Prisma no los ve en `schema.prisma` y cree que sobran | **No aceptar.** Editar a mano el SQL generado y borrar esas líneas antes de aplicar. Sin ellos, la búsqueda de Chats WPP pasa a recorrer toda la tabla |
| La API o los tests no conectan a Postgres de un día para otro | `/tmp` se borró y con él el clúster | Repetir §4 completa |
| `Refusing to run "prisma migrate deploy": DATABASE_URL does not look like the test database` | `.env.test` falta o apunta a otra base | Crear o corregir `apps/api/.env.test` con una URL que contenga `fourclient_test`. El guardia existe para no tocar nunca la base de desarrollo |
| `❌ NODE_ENV=production pero APP_ENVIRONMENT_NAME no está seteada` | Copiaste `.env.example` tal cual | `NODE_ENV=development` en local |
| Respuestas `400 HTTPS_REQUIRED` en local | `NODE_ENV=production` | Igual que arriba |
| `JWT_SECRET` inválido al arrancar | El placeholder de `.env.example` es más corto que 32 a propósito | Generar uno: `openssl rand -hex 32` |
| La web local habla con producción | `VITE_API_URL` definido en `apps/web/.env.local` apuntando a prod | Borrarlo o apuntarlo a `http://localhost:3000` |
| Los datos de prueba no aparecen en el tablero | Fecha distinta de hoy, o chat creado después de las 21:00 (cuenta para mañana) | Ver §7 |
| Un cambio de esquema rompe prod durante el deploy | Migración no aditiva | Principio 1: columnas nuevas nullable o con default, nada de borrar o renombrar en el mismo release |

## 9. Preguntas abiertas

| ID | Pregunta |
|---|---|
| PREG-108 | `apps/api/.env.example` trae `NODE_ENV="production"`: ¿es intencional (plantilla para deploy) o se cambia a `development` para uso local? |
| PREG-109 | El `.env.example` de la raíz duplica variables con valores viejos y nada lo lee. ¿Se borra? |
| PREG-110 | `seed-chats.ts` usa la fecha fija 2026-06-27. ¿Se adapta a la fecha de hoy o se retira? |
