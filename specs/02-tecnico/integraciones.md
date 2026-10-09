---
estado: vigente
verificado: 2026-10-09 @ 2cbd083
fuentes: [apps/api/src/services/whatsapp/meta-cloud.ts, apps/api/src/routes/webhook.ts, apps/api/src/routes/inbox.ts, apps/api/src/lib/media.ts, apps/api/src/lib/crypto.ts, apps/api/src/services/ai/index.ts, apps/api/src/services/ai/gemini.ts, apps/api/src/services/ai/groq.ts, apps/api/src/services/ai/openrouter.ts, apps/api/src/services/ai/cerebras.ts, apps/api/src/services/ai/modelDiscovery.ts, apps/api/src/services/ai/openaiCompatible.ts, apps/api/src/services/ai/types.ts, apps/api/src/lib/matchProduct.ts, apps/api/src/services/storage.ts, apps/api/src/routes/files.ts, apps/api/src/routes/dev.ts, apps/api/src/services/email.ts, apps/api/src/routes/auth.ts, apps/api/src/server.ts, apps/api/src/config.ts, .github/workflows/backup-prod-db.yml, apps/api/test/ai-providers.test.ts, apps/api/test/inbox.test.ts, apps/api/test/webhook.test.ts]
---

# Integraciones externas

Qué servicios de terceros usa la API, qué se les manda, qué se guarda de vuelta y cómo falla cada uno. Las variables de entorno se nombran, nunca se dan sus valores.

**Entorno actual:** API en un VPS con Coolify (proxy Traefik), web en Cloudflare Pages, archivos en Cloudflare R2, código y CI en GitHub. Railway y Vercel ya no existen; los comentarios del código que todavía los nombran están desactualizados y no describen el entorno *(código, commit 30c5271)*.

| Servicio | Para qué | Variables | Si falta la configuración |
|---|---|---|---|
| Meta WhatsApp Cloud API | Recibir y enviar mensajes del chat | `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `WPP_TOKEN_ENC_KEY`; credenciales por organización en la base | En `APP_ENVIRONMENT_NAME=production` la API **no arranca** sin las tres; en otros entornos solo avisa |
| Gemini / Groq / OpenRouter | "Tomar lista" (IA) | `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` (`CEREBRAS_API_KEY` existe pero no se usa) | El proveedor sin clave se salta; sin ninguna, "Tomar lista" responde 502 |
| Cloudflare R2 | PDF de facturas y de cobros de plataforma | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` | Facturas caen a disco local (`apps/api/uploads/`); cobros quedan sin PDF |
| Resend | Correo de códigos 2FA y avisos de bloqueo | `RESEND_API_KEY` | `sendEmail` lanza error (ver §4) |
| Sentry | Errores de la API | `SENTRY_DSN` | Sin reporte, solo logs |

---

## 1. Meta WhatsApp Cloud API

### 1.1 Cliente de salida (`services/whatsapp/meta-cloud.ts › MetaCloudProvider`)

- **Versión de Graph fija:** `https://graph.facebook.com/v22.0` (`META_API_BASE`). Cambiarla es un cambio de código, no de configuración *(código)*.
- **Métodos:** `sendText`, `sendImage`, `sendAudio` (sin caption: WhatsApp no lo admite), `sendVideo`, `sendDocument` (con `filename` para que el cliente vea un nombre legible), `sendLocation` (sin subida previa), `uploadMedia` (sube los bytes a Meta y devuelve un media id), `getMediaUrl` + `downloadMedia` (ver multimedia entrante) y `markAsRead`. `markAsRead` **no tiene ningún llamador** hoy (código muerto) *(código)*.
- **Errores:** todo método de envío lanza `Error("Meta API <método> failed (<status>): <json de Meta>")` si la respuesta no es 2xx. Quien llama guarda ese texto, recortado a 255 caracteres, en `TicketMessage.failed_reason` (la X roja del chat) *(código)*.
- **Destinatario BSUID:** si el identificador del ticket tiene forma `CC.<alfanumérico>` (regex `^[A-Za-z]{2}\.[A-Za-z0-9]+$`, `toOrRecipient`), el cuerpo usa la clave `recipient`; si no, `to`. Es el único lugar del sistema donde importa si el ticket se identifica por teléfono o por BSUID *(código)*.
- **Credenciales por organización:** `MetaCloudProvider.fromOrg(org)` exige `wpp_meta_phone_id` y `wpp_meta_token`; el token se descifra con `lib/crypto.ts › decryptSecret` usando el `org.id` (clave derivada por organización, ver `seguridad-y-privacidad.md` §5). Si falta alguno o el descifrado falla, devuelve `null` y el llamador trata a la organización como "sin credenciales de WhatsApp" *(código)*.
- Las variables globales `META_PHONE_NUMBER_ID` y `META_ACCESS_TOKEN` solo las usa el script `src/seed-wpp.ts`; la API en ejecución nunca envía con credenciales globales *(código)*.

### 1.2 Webhook de entrada (`routes/webhook.ts`)

- **Firma HMAC:** `POST /api/v1/webhook` verifica `X-Hub-Signature-256` con HMAC-SHA256 del cuerpo crudo y comparación de tiempo constante (`verifyHmac`). El secreto es el **global** `META_APP_SECRET`; la columna por organización `Organization.wpp_meta_app_secret` existe (y el script de recifrado la procesa) pero **no se lee para verificar** *(código)*. Consecuencia: todas las organizaciones deben estar bajo la misma App de Meta. Ver PREG-GEN-p2.
- Sin `META_APP_SECRET` fuera de producción, el webhook acepta cualquier POST sin firma (solo un warning al arrancar) *(código)*.
- **Handshake GET:** responde el `hub.challenge` solo si `META_WEBHOOK_VERIFY_TOKEN` está configurado y coincide *(código; test `webhook.test.ts › "GET verify handshake with correct hub.verify_token -> 200 returns the challenge string"`)*.
- **Respuesta inmediata:** responde 200 **antes** de procesar (Meta reintenta si la respuesta tarda o falla). Todo lo demás corre después, sin que Meta se entere de errores *(código)*.
- **Enrutamiento a la organización:** por `metadata.phone_number_id` contra `Organization.wpp_meta_phone_id` (único en la base; solo organizaciones activas). Sin coincidencia, el mensaje se descarta con un warning *(código)*.
- **Ventana de reproducción de 10 min:** un mensaje cuyo `timestamp` tiene más de 10 minutos se **descarta** (solo queda un `warn` en el log, que incluye el remitente). Esto protege contra repeticiones, pero también descarta los reintentos legítimos de Meta después de una caída de la API de más de 10 minutos *(código)*. Ver PREG-GEN-p1.
- **Deduplicación:** por `TicketMessage.wpp_message_id` (único) dentro de una transacción con la actualización del ticket *(código)*.
- **Payload crudo:** el cuerpo completo del webhook se guarda en `raw_payload` de cada mensaje entrante y del ticket al crearse (contiene teléfono, nombre y texto). En el log solo queda la lista de campos del evento *(código; test `webhook.test.ts › "every inbound message persists the ENTIRE webhook POST body verbatim in raw_payload - on the message always, and on the ticket only at creation …"`)*.
- **Recibos de estado** (`statuses`): `ingestStatus` busca por `wpp_message_id` en toda la base (sin filtrar por organización, el id es único), nunca hace retroceder `delivered`/`read_by_client`, y con `failed` guarda `errors[0].title` (o `message`) en `failed_reason` *(código)*.
- Textos y captions entrantes se recortan a 4096 caracteres *(código)*.

### 1.3 Qué se guarda y qué no (Ley 1581, ver `seguridad-y-privacidad.md` §11)

| Dato | ¿Se guarda? | Dónde / cuánto |
|---|---|---|
| Texto de mensajes (entrada y salida) | Sí | `TicketMessage.text`, sin borrado automático |
| Payload crudo del webhook | Sí | `raw_payload` (mensaje y ticket) |
| Foto, audio, video, documento o sticker del chat | **Nunca** (ni en R2, ni en disco, ni en la base) | Solo el **media id de Meta** en `TicketMessage.media_url` |
| Ubicación | Sí, como enlace de Google Maps | `media_url` |
| Bytes de multimedia que envía el personal | No | Se suben a Meta (`uploadMedia`) y se guarda el media id |

- Para **ver** un archivo, `inbox.ts › GET /media/:token` valida el id (`lib/media.ts › isValidMetaMediaId`: 5 a 40 dígitos), comprueba que pertenece a un mensaje de la organización del usuario, pide a Meta una URL de corta duración (`getMediaUrl`), descarga los bytes (`downloadMedia`), revalida la firma real del archivo en **cada** vista y lo sirve con `Cache-Control: private, max-age=86400` *(código)*.
- **Meta retiene la multimedia 30 días.** Pasado ese plazo, la vista responde 404 `MEDIA_EXPIRED` y un reenvío queda con `failed_reason` inmediato. Es una pérdida aceptada a propósito: no hay copia propia *(código + decisión en `lib/media.ts`; tests `inbox.test.ts › "GET /media/:token returns a clear MEDIA_EXPIRED 404 when Meta no longer has the file …"` y `› "marks a forwarded PHOTO failed_reason immediately when the original has expired on Meta (>30 days) …"`)*.
- **Lista de hosts permitidos para descargar** (defensa SSRF, `ALLOWED_MEDIA_HOSTS`): `fbcdn.net`, `fbsbx.com`, `facebook.com`, `whatsapp.net` y sus subdominios. Cualquier otro host en la URL que devuelva Meta lanza error antes de hacer la petición *(código, sin test propio)*.

### 1.4 Modos de falla conocidos

| Falla | Síntoma en el sistema | Qué hace el código |
|---|---|---|
| Ventana de 24 h vencida (el cliente no escribe hace más de 24 h) | El envío del personal o la confirmación del formulario sale con X roja | Guarda `failed_reason`; el mensaje queda en la base. **No hay soporte de plantillas de Meta**, así que no hay forma de reabrir la conversación desde el sistema *(código)*. Ver PREG-GEN-p7 |
| Problema de facturación/elegibilidad de la cuenta de Meta ("Business eligibility payment issue", observado en octubre de 2026) | **Todos** los mensajes salientes fallan con `failed_reason`, mientras los **entrantes siguen llegando** con normalidad | Nada especial: el chat sigue recibiendo y cada envío queda marcado como fallido. No hay alerta; se detecta mirando las X rojas *(inferido de la historia del proyecto; el comportamiento de registro es código)* |
| Número sin teléfono ni BSUID (`msg.from` vacío) | Ticket con teléfono de relleno y `no_wpp_number=true` | No se intenta la bienvenida *(código; test `webhook.test.ts › "a message with an empty sender phone (msg.from = \"\") gets a unique placeholder phone …"`)* |
| Organización sin credenciales | Mensajes guardados, nada enviado | Las rutas guardan el mensaje con `failed_reason` o solo en base, según el caso *(código)* |
| Multimedia vencida (más de 30 días) | 404 `MEDIA_EXPIRED` | Ver §1.3 |
| Caída de la API más de 10 min | Mensajes que Meta reintente tarde se pierden | Ver §1.2 y PREG-GEN-p1 |

---

## 2. IA de "Tomar lista" (`services/ai/`)

**Flujo:** `inbox.ts › POST /:ticketId/parse-messages` junta los mensajes de texto del cliente seleccionados (solo entrantes y sin multimedia; de 1 a 50 ids), manda el texto más la lista de nombres del catálogo activo a `services/ai/index.ts › extractOrderItems`, cruza cada producto devuelto con el catálogo (`lib/matchProduct.ts`) y devuelve un borrador. **No escribe en la base** y **el precio siempre es 0** *(código; test `inbox-parse-messages.test.ts › "happy path: matched item is resolved to the catalog NAME but never priced from it …"`)*.

**Qué sale del sistema:** el texto literal de los mensajes del cliente y los nombres del catálogo van a proveedores externos de nivel gratuito. Ver PREG-GEN-p4.

### 2.1 Cadena de proveedores

| Orden | Proveedor | Descubrimiento de modelos | Preferidos (en orden) | Máx. candidatos | Timeout por intento | Modo JSON |
|---|---|---|---|---|---|---|
| 1 | Gemini | `GET /v1beta/models`, solo los que soportan `generateContent`, excluye familias no textuales (`SKIP_PATTERN`) | `models/gemini-3.6-flash` | 1 | 12 s | `responseMimeType: application/json`, `thinkingBudget: 1`, `temperature: 0` |
| 2 | Groq | `GET /openai/v1/models`, `active` y texto→texto; excluye `guard`, `whisper`, `compound`, `safeguard`, `qwen3.6`, `allam` | `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`, `openai/gpt-oss-120b` | 3 | 20 s | `response_format: json_object` |
| 3 | OpenRouter | `GET /api/v1/models`, solo ids `:free` con precio 0 en prompt y completion; excluye `safety`, `guard`, `code`, `note-preview` | `inclusionai/ling-3.0-flash-fin:free` | 4 | 20 s | Ninguno (algunos modelos gratis rechazan `response_format`) |
| — | Cerebras | — | — | — | — | **Deshabilitado**: comentado en `PROVIDERS` (402 en todos los modelos de la cuenta) |

*(código: `gemini.ts`, `groq.ts`, `openrouter.ts`, `cerebras.ts`, `index.ts › PROVIDERS`)*

- Un proveedor sin clave se salta en silencio. Si ninguno tiene clave: error "Ningún proveedor de IA está configurado"; si todos fallan: "Todos los proveedores de IA fallaron". La ruta traduce ambos a **502 `AI_EXTRACTION_FAILED`** *(código; tests `ai-providers.test.ts › "no provider configured -> throws immediately without calling fetch"` e `inbox-parse-messages.test.ts › "all configured providers failing -> 502 AI_EXTRACTION_FAILED"`)*.
- **Descubrimiento en vivo** (`modelDiscovery.ts › discoverCandidateModels`): la lista de modelos se pide al proveedor y se guarda **en memoria 1 h** (`TTL_MS`); la petición de la lista tiene timeout de 10 s. Los preferidos que el proveedor todavía lista van primero, luego el resto, hasta `maxCandidates` (4 si no se indica). Una lista vacía en caché cuenta como vencida *(código)*.
- **Expulsión de un modelo de la caché** (`dropFromCache`) solo por error **permanente**: HTTP 400 o 404 (`isPermanentModelError`). Un 5xx o un timeout no lo expulsa: el mismo modelo se reintenta en la siguiente petición *(código; test `ai-providers.test.ts › "a TRANSIENT failure (503) on Gemini falls through to Groq for this request but does NOT blacklist the model FOREVER …"`)*.
- **Enfriamiento por proveedor** (`index.ts › COOLDOWN_MS`): **90 s en memoria**. Se activa cuando el error final del proveedor "parece caída": status ≥ 500 **o sin status HTTP** (`looksLikeProviderDown`). Durante el enfriamiento ese proveedor se salta; un éxito lo borra *(código; test `ai-providers.test.ts › "a NON-transient failure (400, e.g. malformed JSON) does NOT trigger the cooldown …"`)*. Ojo: un JSON imposible de parsear o que no pasa el esquema zod no trae status, así que **también** activa el enfriamiento, aunque el comentario del código diga que los fallos de contenido no deberían. Ver PREG-GEN-p3.
- La caché de modelos y el enfriamiento viven en memoria del proceso: se pierden en cada despliegue y no se comparten entre contenedores *(código)*.
- **Peor caso de latencia** de una petición: hasta 8 llamadas de generación (1 + 3 + 4) más hasta 3 listas de modelos, cada una con su timeout, lo que supera de lejos lo que espera el navegador o el proxy. Los timeouts por intento existen para acotar ese caso, no para eliminarlo *(inferido de los números del código)*.
- **Límite de uso:** 15 peticiones/min (por usuario autenticado, clave global de `server.ts`) en esta ruta *(código)*.

### 2.2 Prompt, respuesta y validación (`services/ai/types.ts`)

- Un único prompt de sistema en español para todos los proveedores (`buildExtractionPrompt`): pide `{"items":[{"product_name","quantity_label"}]}` con el nombre y la cantidad **tal como los escribió el cliente**; el catálogo va como pista, no como restricción *(código)*.
- `stripJsonFence` quita un bloque ```` ```json ```` alrededor de la respuesta (los modelos gratuitos lo agregan a menudo) *(código; test `ai-providers.test.ts › "a provider wrapping its JSON in a markdown code fence still parses …"`)*.
- **Esquema zod** (`extractedItemsSchema`): máximo **200 ítems**; `product_name` de 1 a 200 caracteres; `quantity_label` hasta 100 (opcional, por defecto vacío). Una respuesta que no pasa el esquema cuenta como fallo del candidato *(código; test `ai-providers.test.ts › "a provider returning JSON that fails the schema is treated as a failure, not a crash"`)*.
- La ruta descarta los ítems con `product_name` en blanco y deduplica dentro de la misma extracción (sin distinguir mayúsculas ni tildes), conservando la primera cantidad *(código; test `inbox-parse-messages.test.ts › "dedupes duplicate mentions of the same product WITHIN one extraction …"`)*.

### 2.3 Cruce con el catálogo (`lib/matchProduct.ts › matchProductName`)

1. Entrada de más de **200 caracteres** → sin coincidencia de una vez (protege el costo de Levenshtein).
2. **Normalización** solo para este cruce: `normalizeSearch` (NFD, sin tildes, minúsculas, `trim`) y singularización ingenua por palabra (quita `es` si la palabra tiene más de 4 letras, si no `s` si tiene más de 3).
3. **Igualdad exacta** normalizada → coincide.
4. **Contención** (el texto contiene el nombre del catálogo o al revés) → coincide **solo si exactamente un** producto califica; con dos o más, pasa al paso 5.
5. **Similitud** `1 − Levenshtein / longitud mayor`: coincide si la mejor es **≥ 0,72** (`FUZZY_THRESHOLD`) **y** supera a la segunda por **≥ 0,08** (`FUZZY_MARGIN`).
6. Si no, devuelve el texto de la IA tal cual con `ai_unmatched: true` para que el personal lo revise.

Cuando coincide, el borrador usa el **nombre del catálogo**, nunca su precio *(código; tests en `matchProduct.test.ts`, p. ej. `› "ambiguous substring match (two catalog products both contain the term) -> unmatched"` y `› "two close fuzzy candidates within the margin -> unmatched, no coin-flip"`)*. Los umbrales son una primera heurística declarada en el propio archivo, pendiente de ajustar con datos reales *(código)*.

---

## 3. Cloudflare R2 (`services/storage.ts`)

- Cliente S3 con `region: auto` y endpoint `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`. Las sumas de verificación flexibles del SDK van en `WHEN_REQUIRED` porque R2 no las soporta *(código)*.
- **Bucket:** `R2_BUCKET_NAME`, o `4client-files` si no está definido. `storage.isConfigured()` exige `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY` *(código)*.

| Prefijo | Quién escribe | Quién lee | Sin R2 configurado |
|---|---|---|---|
| `invoices/<filename>` | `files.ts › POST /invoice` (solo PDF con firma `%PDF`, máx. 20 MB) | `files.ts › GET /:filename`, siempre pasando por el control de link (24 h, revocación) | Disco local `apps/api/uploads/`, dentro del contenedor |
| `platform-charges/<slug>-<number>.pdf` | `dev.ts › POST /charges/:id/pdf` (sobrescribe la misma clave al regenerar) | El admin, por la URL guardada en `PlatformCharge.report_url` | El cobro queda sin PDF (`report_url = null`), nunca falla el cobro |
| `_healthcheck/<timestamp>.txt` | `dev.ts › GET /storage-test` | Nadie | — (no se borra; cada prueba deja un archivo) |

- `storage.upload` devuelve `R2_PUBLIC_URL/<clave>` (o la URL del endpoint si no hay URL pública). Las facturas **ignoran** esa URL y entregan un link a la web (`/factura?f=…`); los cobros de plataforma **sí** la guardan como `report_url` *(código)*. Si la URL pública da acceso de lectura al bucket entero, los PDF de `invoices/` también serían descargables directo, sin pasar por el vencimiento de 24 h ni la revocación (el nombre lleva 160 bits aleatorios). Ver PREG-GEN-p5.
- La caída a disco local se pierde en cada redespliegue si el contenedor no tiene un volumen persistente *(inferido: el Dockerfile no declara volumen)*.
- El **borrado de datos** de un cliente no borra sus PDF de R2; solo revoca los links (ver `seguridad-y-privacidad.md` §11) *(código)*.
- **Bucket de respaldos separado:** el respaldo diario de la base (`.github/workflows/backup-prod-db.yml`) sube a otro bucket de R2, con otras credenciales (`BACKUP_R2_*`), bajo `db-backups/`. La retención es una regla de ciclo de vida del bucket configurada en el panel de Cloudflare, no en el repo. Detalle en `calidad-y-pruebas.md` §6 *(código)*.

---

## 4. Resend (`services/email.ts`)

- Llamada HTTP directa a `https://api.resend.com/emails`, sin SDK. Remitente fijo `4Client <no-reply@4client.shop>`: el dominio del sistema, verificado en Resend con SPF/DKIM, no el del negocio *(código)*.
- **Usos (los dos en `routes/auth.ts`):**
  - **Código 2FA** de 6 dígitos para el rol `dev` cuando `REQUIRE_2FA` está activo. Si el envío falla, el login responde **500 `EMAIL_SEND_FAILED`**: con Resend caído el dev no puede entrar *(código)*.
  - **Aviso de bloqueo** al dueño de la cuenta cada vez que se aplica un bloqueo por intentos fallidos. Se envía sin esperar (fire-and-forget); un fallo solo deja un warning *(código; test `auth.test.ts › "locks the account after 5 wrong passwords, notifies the owner by email …"`)*.
- El nombre de la organización se escapa como HTML antes de insertarlo en el correo de bloqueo (`escapeHtml`) *(código)*.
- Sin `RESEND_API_KEY`, `sendEmail` lanza error. En los tests el módulo se reemplaza con `vi.mock` *(código)*.

---

## 5. Sentry (`server.ts`)

- Se inicializa solo si existe `SENTRY_DSN`, con `tracesSampleRate: 0.2` y `environment = NODE_ENV` *(código)*.
- El manejador global de errores (`setErrorHandler`) captura toda excepción que llega a Fastify. En producción, las respuestas 5xx ocultan el mensaje real ("Error interno del servidor") *(código)*.
- Solo la API reporta a Sentry; la web no tiene SDK (DevTools solo muestra si `SENTRY_DSN` está configurado) *(código)*.
- `NODE_ENV` vale `production` en todos los despliegues (dev incluido, ver `config.ts`), así que Sentry no distingue dev de producción. Ver PREG-GEN-p6.

---

## Si tocas X, revisa Y

- **Versión de Graph** (`META_API_BASE`): la URL de `GET /media/:token` se arma con la misma constante; revisa los formatos de payload del webhook (`MetaWebhookPayload`).
- **Lista de hosts de multimedia:** si Meta cambia de CDN, las vistas de multimedia fallan con 404 genérico (el error queda solo en el log).
- **Orden o proveedores de IA:** se cambia solo el arreglo `PROVIDERS`; los tests de `ai-providers.test.ts` asumen el orden Gemini → Groq → OpenRouter.
- **Umbrales de cruce** (`FUZZY_THRESHOLD`, `FUZZY_MARGIN`): `matchProduct.test.ts` fija casos límite.
- **Prefijos de R2:** las facturas viejas se buscan por `invoices/<filename>`; cambiar el prefijo rompe todos los links vigentes.
- **Poner la API detrás del proxy de Cloudflare:** `trustProxy` confía solo en el salto 0 (Traefik); con Cloudflare delante, `req.ip` sería la IP del borde de Cloudflare y los límites por IP se compartirían entre clientes (habría que usar `CF-Connecting-IP`) *(inferido)*.

## Pendientes

IDs provisionales; quien consolide les asigna número global en `03-plan/preguntas-abiertas.md`.

- **PREG-GEN-p1** — El webhook descarta todo mensaje con más de 10 min de antigüedad. Después de una caída de la API de más de 10 min, los reintentos de Meta se pierden sin dejar rastro en la base (y el `warn` que sí queda incluye el teléfono, contra el criterio de "sin datos personales en logs"). ¿Es aceptable o se guarda el mensaje marcado como tardío?
- **PREG-GEN-p2** — La verificación HMAC usa solo el `META_APP_SECRET` global; `Organization.wpp_meta_app_secret` no se usa. ¿Todas las organizaciones van a compartir siempre la misma App de Meta, o la columna debe empezar a usarse?
- **PREG-GEN-p3** — El enfriamiento de 90 s también se activa con errores sin status HTTP (JSON roto, esquema zod), no solo con caídas del proveedor, al contrario de lo que dice el comentario de `index.ts`. ¿Es intencional?
- **PREG-GEN-p4** — "Tomar lista" envía texto literal de clientes a proveedores de IA de nivel gratuito (que pueden usar los datos para entrenar y procesan fuera de Colombia). La política de privacidad publicada no menciona a estos encargados. ¿Se aceptó este tratamiento bajo la Ley 1581?
- **PREG-GEN-p5** — ¿El bucket de R2 (o `R2_PUBLIC_URL`) permite lectura pública? Si sí, `invoices/` es descargable sin el control de 24 h ni la revocación, y el borrado de datos no lo cubre.
- **PREG-GEN-p6** — Sentry usa `environment = NODE_ENV`, que es `production` en todos los despliegues. ¿Se debe usar `APP_ENVIRONMENT_NAME`?
- **PREG-GEN-p7** — No hay soporte de plantillas de Meta: fuera de la ventana de 24 h el negocio no puede escribirle al cliente desde el sistema. ¿Es una limitación aceptada o un pendiente?
