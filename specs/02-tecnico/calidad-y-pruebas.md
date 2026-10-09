---
estado: vigente
verificado: 2026-10-09 @ 2cbd083
fuentes: [apps/api/vitest.config.ts, apps/api/test/globalSetup.ts, apps/api/test/helpers.ts, apps/api/test/*.test.ts, apps/api/package.json, apps/web/package.json, .github/workflows/ci.yml, .github/workflows/backup-prod-db.yml, apps/api/src/server.ts, apps/api/prisma/schema.prisma, apps/api/prisma/migrations, Dockerfile, start.sh]
---

# Calidad y pruebas

Cómo se prueba el sistema, qué cubre y qué no la suite, qué corre en CI, cómo se respalda la base y qué requisitos no funcionales se observan en el código. Principio 11: toda regla de dinero, permisos o tenant necesita un test contra **Postgres real**; los servicios externos se simulan.

## 1. Estrategia

- **Una sola suite: la de la API** (`apps/api/test`, Vitest). La web **no tiene** suite de pruebas (no tiene script `test` ni archivos `*.test.*`); se verifica con `tsc --noEmit` y `vite build` *(código)*.
- **Real:** PostgreSQL (una base dedicada a tests, con todas las migraciones aplicadas), Prisma, el registro de plugins de Fastify y las rutas. Las peticiones usan `fastify.inject()`, sin red *(código)*.
- **Simulado:**
  - **Meta, proveedores de IA:** se reemplaza `global.fetch`, con `vi.spyOn(global, 'fetch')` (IA, Tomar lista) o asignándolo a mano y restaurándolo después (`webhook`, `inbox`, `public`).
  - **Correo:** `vi.mock('../src/services/email.js')` en `auth.test.ts` y `auth-2fa.test.ts`.
  - **Reloj:** `vi.spyOn(Date, 'now')` para el corte de las 21:00 (`webhook.test.ts`) y `vi.useFakeTimers` + `vi.setSystemTime` para el enfriamiento de 90 s de la IA (`ai-providers.test.ts`).
  - **Sockets:** `vi.spyOn(app.io, 'to')` para comprobar los eventos emitidos (`inbox.test.ts`).
- **Datos de prueba:** cada test crea su organización y sus usuarios con sufijos aleatorios (`helpers.ts › createTestOrg`, `createTestUser`, bcrypt costo 12), así que no hace falta limpiar la base entre corridas *(código)*.
- R2 no se configura en los tests: las facturas caen a la carpeta local `uploads/` *(inferido de `files.ts` + ausencia de variables `R2_*` en CI)*.

## 2. Configuración de Vitest

| Pieza | Comportamiento |
|---|---|
| `vitest.config.ts` | Carga `apps/api/.env.test` y pasa sus valores a los workers con `NODE_ENV=test`; `fileParallelism: false` (archivos en serie, para no agotar el pool ni pelear locks en la base compartida); `testTimeout` 15 s, `hookTimeout` 20 s |
| `test/globalSetup.ts` | Recarga `.env.test` con `override: true` y **se niega a correr** si `DATABASE_URL` no contiene `fourclient_test` (protege la base de dev). Luego ejecuta `pnpm exec prisma migrate deploy` contra esa base |
| `.env.test` | **No está en git** (`.gitignore`). Si existe, sus valores le ganan a las variables del shell en `globalSetup` *(código)* |

**`helpers.ts › buildTestServer` frente a `server.ts`** (lo que los tests **no** ejercitan) *(código)*:

| Aspecto | `server.ts` (real) | `buildTestServer` |
|---|---|---|
| Rutas | Todas, más `/health` y `/api/v1/wpp/status` | Sin `users`, `employees`, `/health` ni `/wpp/status` |
| `@fastify/helmet`, hook HTTPS, cabecera HSTS, Sentry | Sí | No |
| `trustProxy` | Solo el salto 0 | No configurado |
| Límite global | 300/min, clave = `userId` verificado o IP | 100/min por IP; cada `inject` recibe una **IP aleatoria** si el test no fija una |
| CORS | Métodos y `allowedHeaders` explícitos (incluye `X-Requested-With`) | Solo origen y credenciales |
| Logger | `warn` en producción | Apagado |
| Errores 5xx | Mensaje oculto solo en producción | Siempre oculto |

Consecuencia: los límites por usuario, la cabecera HSTS, el rechazo por HTTP, `trustProxy`, las cabeceras de helmet y la verificación HMAC del webhook (los tests corren sin `META_APP_SECRET`) **no tienen test**.

## 3. Archivos de test

Conteo de bloques `it(` por archivo, hecho sobre el código: **20 archivos, 259 tests**.

| Archivo | Tests | Qué cubre |
|---|---|---|
| `ai-providers.test.ts` | 12 | Cadena Gemini → Groq → OpenRouter, Cerebras fuera de la cadena, descubrimiento de modelos, caída al siguiente candidato y proveedor, enfriamiento de 90 s solo ante 5xx y no ante 400, esquema zod, bloque de código markdown |
| `auth-2fa.test.ts` | 5 | 2FA solo para el rol `dev` con `REQUIRE_2FA` activo; código correcto o incorrecto; el código se consume |
| `auth.test.ts` | 11 | Login, error idéntico para un email inexistente, refresh con rotación, reutilización que revoca la familia, CSRF de `/refresh`, `/me`, bloqueo tras 5 fallos con correo al dueño, organización inactiva |
| `billing.test.ts` | 3 | `GET /billing/charges`: solo la propia organización, orden, roles |
| `businessDate.test.ts` | 5 | Corte de las 21:00 Bogotá (`businessDateForInstant`), cambios de mes y de año |
| `cierre.test.ts` | 16 | Solo se cierra hoy, decisiones obligatorias, `manana` (renumeración y marcador), `forzar_cierre`, doble cierre, día congelado, cobro retroactivo |
| `config.test.ts` | 2 | `PATCH /config/wpp`: unicidad de `wpp_meta_phone_id` (409) |
| `dashboard.test.ts` | 6 | Conteos del informe por día; listas "sin cobro" en efectivo y transferencia |
| `dev-centro-mando.test.ts` | 26 | DevTools: crear y listar organizaciones, reabrir cierre, ticket de prueba, cobros de plataforma (CRUD, PDF, consecutivo), `/dev/db` con `orgId`, rechazo de roles no-dev |
| `files.test.ts` | 12 | Facturas: subida, link de 24 h, reemplazo por pedido, edición que invalida, bloqueo por ticket y por organización, otra organización |
| `inbox-parse-messages.test.ts` | 7 | Tomar lista: precio siempre 0, sin coincidencia marcada, deduplicación, solo mensajes de texto entrantes del ticket, 502, roles |
| `inbox.test.ts` | 25 | Mensajes por día, marca de no leído, destinos de reenvío, `failed_reason` de Meta, envío de imagen, audio y documento con validación de firma, `GET /media` (otra organización, firma falsa, vencido), reenvío, supresión de datos (Ley 1581) |
| `matchProduct.test.ts` | 7 | Coincidencia exacta, plural, contención única o ambigua, similitud con umbral y margen |
| `messageTemplates.test.ts` | 8 | Plantillas por defecto o guardadas; lectura y edición por rol; validación |
| `orderNumbering.test.ts` | 5 | Llenado de huecos en la numeración del día; creación concurrente sin duplicados |
| `orders.test.ts` | 37 | Crear y editar pedidos, aislamiento por organización, historial, cobro (contraseña, bloqueo, dividido, crédito, $0), pedido bloqueado y día cerrado, observaciones, cobro en casa |
| `products-bulk-price.test.ts` | 4 | `PATCH /products/bulk-price`: otra organización, precio negativo, rol, lista vacía |
| `public.test.ts` | 48 | Formulario: enviar y fusionar, estados editables, link de 24 h, revocación, reemplazo, "bloquear todos", tope diario, atribución, día cerrado, borrado por el cliente, consentimiento, último pedido |
| `tickets.test.ts` | 2 | Orden de `GET /tickets` por primer mensaje del día |
| `webhook.test.ts` | 18 | Handshake, recibos de estado, bienvenida y aviso una vez por ticket, redirección, sin teléfono, BSUID, `raw_payload`, multimedia y ubicación sin descarga, corte de las 21:00 |

## 4. Huecos de cobertura

| Sin test | Detalle |
|---|---|
| `routes/users.ts` (completo) | Crear, editar, desactivar, resetear contraseña, ocultar cuentas `dev`, revocar sesiones al desactivar. Ni siquiera se registra en `buildTestServer` |
| `routes/employees.ts` (completo) | Tampoco se registra |
| `routes/tickets.ts › POST /` y `› PATCH /:id` | Solo hay tests del `GET` |
| `GET /api/v1/wpp/status`, `/health` | Viven en `server.ts`, fuera del servidor de test |
| `POST /auth/logout` | — |
| Productos: crear, editar, borrar | Solo `bulk-price` (y un `GET` dentro de DevTools) |
| `inbox.ts`: `GET /search`, `GET /:ticketId/messages/older`, `send-video` | — |
| `dev.ts`: `/seed`, `/env-status`, `/storage-test`, `/health`; `GET /config/org` | — |
| Transversal | HMAC del webhook, `lib/crypto.ts` (cifrado y formatos), `plugins/socket.ts` (autenticación, salas, desconexión), `lib/sanitize.ts`, límites por ruta y por usuario, cabeceras HTTP |
| Web | Toda la aplicación React (sin suite) |

## 5. CI (`.github/workflows/ci.yml`)

Se dispara con push y pull request hacia `main` y `dev` (las ramas `docs/`, `feature/` y demás no lo disparan por sí solas). Node 20 y pnpm 10 *(código)*.

| Job | Depende de | Pasos |
|---|---|---|
| `typecheck` | — | `pnpm install --frozen-lockfile`, `prisma generate` (con una URL ficticia), `tsc --noEmit` de API y web, `pnpm audit --prod` (falla con cualquier vulnerabilidad en dependencias de producción) |
| `test` | `typecheck` | Servicio `postgres:16` con la base `fourclient_test`; `prisma migrate deploy`; `pnpm --filter api test` con solo `DATABASE_URL` y `JWT_SECRET` en el entorno |
| `build` | `typecheck`, `test` | `prisma generate`, build de la API (`tsc`) y de la web (`VITE_API_URL` desde la variable del repositorio o un valor por defecto) |

- CI no tiene `.env.test`, así que `META_WEBHOOK_VERIFY_TOKEN` no está definido en el job de test. Sin embargo, `webhook.test.ts › "GET verify handshake with correct hub.verify_token -> 200 returns the challenge string"` espera un token fijo que solo existe en el `.env.test` local *(código)*. Ver PREG-100.
- El despliegue no lo hace este workflow: Coolify y Cloudflare Pages construyen por su cuenta al recibir el push (ver `04-operacion/flujo-de-trabajo.md`).

## 6. Respaldo de la base (`.github/workflows/backup-prod-db.yml`)

| Aspecto | Valor |
|---|---|
| Frecuencia | Diaria a las **08:00 UTC** (03:00 en Bogotá), más ejecución manual (`workflow_dispatch`) |
| Cliente | `postgresql-client-18` desde el repositorio oficial de PGDG, invocado por ruta versionada (`/usr/lib/postgresql/18/bin/pg_dump`) porque el `pg_dump` del PATH seguía siendo el 16 del runner |
| Formato | `--format=custom` (comprimido, restaurable tabla por tabla con `pg_restore`) |
| Origen | Secreto `PROD_DATABASE_BACKUP_URL` (conexión a Postgres de producción desde internet, ver `seguridad-y-privacidad.md` §13) |
| Destino | Bucket R2 **separado** del de facturas, con credenciales propias (`BACKUP_R2_*`), clave `db-backups/backup-<AAAAMMDD-HHMMSS>.dump`, subido con `aws s3 cp` |
| Retención | Regla de ciclo de vida del bucket en el panel de Cloudflare (a propósito fuera del script, para que un error en el script no pueda borrar todos los respaldos). El plazo **no está en el repo** |

*(código)*

- **RPO aproximado de 24 h:** lo que entre después del último respaldo se pierde si se pierde la base *(inferido)*.
- No hay prueba de restauración automatizada ni un RTO documentado en el repo *(código)*.
- Los PDF de facturas en R2 y los archivos locales `uploads/` no tienen respaldo propio *(código)*.
- El comentario del workflow dice que el respaldo es independiente "del VPS/Cloudflare", pero el destino es R2, que es de Cloudflare. Ver PREG-099.
- Que el cliente sea la versión 18 sugiere que producción corre Postgres 18, mientras CI y la documentación del repo usan 16. Ver PREG-092.

## 7. Requisitos no funcionales observados

**Disponibilidad** *(inferido salvo lo marcado)*:
- Una sola instancia de la API en un VPS con Coolify, sin alta disponibilidad. El despliegue arranca un contenedor nuevo, espera su health check y luego retira el viejo (`04-operacion/flujo-de-trabajo.md`); `start.sh` corre `prisma migrate deploy` antes de levantar el servidor *(código)*.
- Mucho estado vive en memoria del proceso: contadores de límites (almacén por defecto de `@fastify/rate-limit`), salas de Socket.io (sin adaptador compartido), caché de modelos y enfriamientos de la IA. Correr más de una réplica rompería los eventos en vivo y multiplicaría los límites *(código)*.
- El webhook responde 200 antes de procesar y descarta mensajes de más de 10 min, así que una caída larga pierde mensajes entrantes (`integraciones.md` §1.2, PREG-032).
- El contenedor corre con el usuario `node` (sin root) *(código, `Dockerfile`)*.

**Límites de uso:** tabla completa en `seguridad-y-privacidad.md` §12 (global de 300/min por usuario o IP).

**Rendimiento — índices relevantes** *(código: `schema.prisma` y migraciones)*:

| Índice | Sirve a |
|---|---|
| `tickets (org_id, fecha)`, `(org_id, deferred_to)`, `(org_id, last_message_at)` | Tablero del día, pospuestos, bandeja ordenada |
| `ticket_messages (ticket_id, sent_at)` | Historial del chat y paginación |
| `orders (org_id, fecha)`, `(org_id, status)`, `(ticket_id)`; único `(org_id, num, fecha)` | Tablero, cierre, numeración sin duplicados |
| GIN trigram sobre `immutable_unaccent(lower(text))` de `ticket_messages`, `customer_name` y `phone` de `tickets` (migración `20260802050000_chat_search_trgm`) | Búsqueda de Chats WPP sin tildes |
| `order_history (org_id, created_at)`, `audit_logs (org_id, created_at)` | Informe y visor de DevTools |
| Disparador `trg_bump_ticket_last_activity` (AFTER INSERT en `ticket_messages`) | Mantiene `tickets.last_activity_at` sin escrituras desde la aplicación |

- `GET /inbox/media/:token` busca por `ticket_messages.media_url`, que **no tiene índice**: hace un recorrido secuencial que crecerá con el historial *(inferido de `schema.prisma`)*.
- Los timeouts por intento de la IA (12 s y 20 s) acotan, pero no evitan, peticiones largas de "Tomar lista" (`integraciones.md` §2.1).

**Zona horaria:** todas las fechas de negocio se calculan con un desfase fijo de UTC−5 (Bogotá, sin horario de verano) por aritmética en el código, sin depender de la zona del servidor. Hay dos conceptos de día (principio 5). El respaldo se programa en UTC *(código)*.

**Observabilidad:** logs en nivel `warn` en producción, sin cuerpos de webhook (solo los nombres de campos); errores a Sentry si hay DSN (`integraciones.md` §5) *(código)*.

## 8. Cómo correr las pruebas localmente

Requisitos: Postgres local con una base cuyo nombre contenga `fourclient_test` (ver `04-operacion/desarrollo-local.md`), y un `apps/api/.env.test` (no versionado) con al menos `DATABASE_URL` apuntando a esa base, `JWT_SECRET` de 32 caracteres o más, `NODE_ENV=test`, `FRONTEND_URL` y `META_WEBHOOK_VERIFY_TOKEN` igual al valor de prueba que usa `webhook.test.ts`. Valores siempre ficticios.

```bash
pnpm install                                   # una vez, desde la raíz
cd apps/api
pnpm exec vitest run                           # suite completa (igual a `pnpm test`); aplica migraciones solo
pnpm exec vitest run test/public.test.ts       # un archivo
pnpm exec vitest run -t "detects refresh-token reuse"   # tests cuyo título contiene el texto
cd ../.. && pnpm --filter api test             # desde la raíz, como en CI
```

Antes de integrar, el resto de la verificación (tipos y builds) está en `04-operacion/flujo-de-trabajo.md` §3.

## Pendientes

- **PREG-099** — El comentario del workflow de respaldo promete independencia de Cloudflare, pero el destino es R2. ¿Se acepta, o hace falta una segunda copia fuera de Cloudflare? ¿Cuál es el plazo de la regla de ciclo de vida?
- **PREG-092** — ¿Qué versión de Postgres corre en producción? El cliente de respaldo es la 18, mientras CI, `AGENTS.md` y la memoria del proyecto dicen 16.
- **PREG-100** — El job de test de CI no define `META_WEBHOOK_VERIFY_TOKEN`, pero el test del handshake lo necesita. ¿CI está pasando hoy? (No se pudo comprobar desde esta sesión.)
