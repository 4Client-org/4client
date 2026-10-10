---
estado: vigente
verificado: 2026-10-10 @ 1edb809
fuentes: [apps/api/src/server.ts, apps/api/src/middleware/auth.ts, apps/api/src/routes/auth.ts, apps/api/src/routes/orders.ts, apps/api/src/routes/cierre.ts, apps/api/src/routes/public.ts, apps/api/src/routes/files.ts, apps/api/src/routes/inbox.ts, apps/api/src/routes/webhook.ts, apps/api/src/routes/users.ts, apps/api/src/routes/tickets.ts, apps/api/src/routes/config.ts, apps/api/src/routes/dev.ts, apps/web/src/lib/api.ts]
---

# Catálogo de códigos de error

> **Resumen.** Contrato de errores de la API: `code` estable en `SCREAMING_SNAKE`, mensaje en español que puede cambiar. Organizado por módulo (§1 genéricos, §2 cuentas, §3 pedidos y caja, §4 formulario y facturas, §5 chats e IA). Para diagnosticar un código visto en producción, ver también `04-operacion/diagnostico-de-incidentes.md`.

Toda respuesta de error de la API tiene la forma `{ error: '<mensaje en español>', code: 'SCREAMING_SNAKE' }` (convención en `arquitectura.md` §9). La web lanza un `Error` con `code` y `data` (`apps/web/src/lib/api.ts`). Esta tabla lista los `code` que el código emite hoy; si agregas uno, agrégalo aquí. Los mensajes exactos viven en el código y pueden cambiar; el `code` es el contrato.

## 1. Genéricos (varias rutas)

| `code` | HTTP | Cuándo | Dónde |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 (401 en un caso) | Falla `safeParse` de zod o una regla de entrada simple (imagen vacía, tipo no soportado, observación vacía, "elige un chat distinto", pedido que no es a crédito, monto recibido menor al total). Algunos traen `details` con el árbol de zod. El único 401 es `/auth/refresh` sin cookie ("Token requerido") | casi todas las rutas |
| `NOT_FOUND` | 404 | Recurso inexistente **o de otra organización** (se busca filtrando por `org_id`; nunca 403) | casi todas las rutas |
| `UNAUTHORIZED` | 401 | `authenticate`: sin token, token inválido o sin `userId`/`role` | `middleware/auth.ts` |
| `FORBIDDEN` | 403 | `requireRole` con rol insuficiente; `POST /dev/seed` en producción | `middleware/auth.ts`, `dev.ts` |
| `HTTPS_REQUIRED` | 400 | `NODE_ENV=production` y la petición no llegó por HTTPS (excepto `/health`) | `server.ts` |
| `SERVER_ERROR` | 500 | Error no controlado sin `code` propio (en producción con mensaje "Error interno del servidor" si el status es 500 o más); también "No se pudo crear la organización" en `POST /dev/organizations` | `server.ts`, `dev.ts` |
| `CONFLICT` | 409 | `POST /dev/actions/create-test-ticket`: ya existe ese teléfono en la organización | `dev.ts` |

Errores que llegan **sin `code` de 4Client**: los lanza Fastify o un plugin y el manejador global (`server.ts › setErrorHandler`) conserva su `statusCode` y usa `error.code ?? 'SERVER_ERROR'`. Ejemplos: `FST_ERR_CTP_EMPTY_JSON_BODY` (400, cuerpo JSON vacío con `Content-Type: application/json`) y el 429 del limitador de frecuencia: `@fastify/rate-limit` usa su respuesta por defecto (un `Error` con `statusCode` 429 y sin `code`), así que sale con `code: 'SERVER_ERROR'` y el mensaje "Rate limit exceeded, retry in …" *(código)*. Los topes están en `limites-y-tiempos.md`.

Respuestas de error **sin `code`** (solo `error`), hoy: `webhook.ts` handshake con token inválido (403), `files.ts` (validación de la subida, archivo mayor de 20 MB, "no es un PDF válido", archivo no encontrado) e `inbox.ts` con identificador inválido de media (400). El cliente no puede distinguirlas por `code`.

## 2. Sesión y cuentas (ACC)

| `code` | HTTP | Cuándo |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | Email o contraseña incorrectos; el mismo error si el email no existe |
| `ACCOUNT_LOCKED` | 429 | Cuenta bloqueada por intentos fallidos (5 min, 15 min, 1 h; mensaje sin conteo) |
| `USER_INACTIVE` | 401 | Usuario o su organización inactivos (login y refresh) |
| `CODES_RATE_LIMITED` | 429 | 2FA: demasiados códigos pedidos en la ventana de 15 min |
| `EMAIL_SEND_FAILED` | 500 | 2FA: el correo con el código no se pudo enviar |
| `CODE_EXPIRED` | 401 | 2FA: no hay código vigente (venció o ya se usó) |
| `CODE_LOCKED` | 401 | 2FA: se agotaron los intentos del código |
| `INVALID_CODE` | 401 | 2FA: código incorrecto |
| `INVALID_REFRESH_TOKEN` | 401 | Cookie `rf` ausente, desconocida o vencida |
| `TOKEN_REUSE_DETECTED` | 401 | Refresh token ya rotado: se revoca toda la familia |
| `CSRF_CHECK_FAILED` | 403 | `/auth/refresh` sin la cabecera `X-Requested-With` |
| `DUPLICATE_EMAIL` | 409 | Email ya registrado en la plataforma (global, no por organización) |
| `DUPLICATE_USERNAME` | 409 | Nombre de usuario ya en uso |
| `SELF_DEACTIVATE` | 400 | Un usuario intenta desactivarse a sí mismo |
| `PHONE_ID_ALREADY_IN_USE` | 409 | `PATCH /config/wpp`: ese `wpp_meta_phone_id` ya es de otra organización |
| `MISSING_SEED_CREDENTIALS` | 500 | `POST /dev/seed` sin `SEED_ADMIN_PASS`/`SEED_DEV_PASS` |

## 3. Pedidos, cobros y cierre (ORD, CAJ)

| `code` | HTTP | Cuándo |
|---|---|---|
| `ORDER_LOCKED` | 409 | Pedido bloqueado (cobrado/cerrado): solo admin edita; también al cambiar estado de uno bloqueado |
| `DAY_CLOSED` | 409 | Crear o editar en un día con caja cerrada |
| `REASON_REQUIRED` | 400 | Enviar a papelera sin motivo |
| `NOT_DELETED` | 400 | Restaurar un pedido que no está en papelera ni eliminado |
| `NOT_AUTHOR` | 403 | Editar o borrar una observación ajena |
| `INVALID_PASSWORD` | 403 | Cobro con contraseña de usuario incorrecta |
| `MISSING_FIELDS` | 400 | Cobrar un pedido al que le faltan datos (el mensaje los lista) |
| `NOT_TODAY` | 400 | Cierre de caja de un día que no es hoy |
| `ALREADY_CLOSED` | 409 | La caja de ese día ya está cerrada |
| `MISSING_DECISIONS` | 400 | Hay pedidos pendientes sin decisión en el cierre (el cuerpo trae la lista) |

## 4. Formulario público y facturas (FRM, FAC)

| `code` | HTTP | Cuándo |
|---|---|---|
| `INVALID_TOKEN` | 401 | Link de formulario inválido o vencido (24 h) |
| `TICKET_BLOCKED` | 403 | Chat con links bloqueados por intentos. **Inactivo en la práctica** (ver DT-012) |
| `LINK_ATTEMPTS_EXCEEDED` | 403 | Igual: la escalera de intentos no se dispara hoy (DT-012). También existe en `files.ts` |
| `CONSENT_REQUIRED` | 400 | Envío sin aceptar la política de privacidad |
| `FORM_LIMIT_REACHED` | 429 | Tope de 3 pedidos por ticket y fecha |
| `ORDER_NOT_EDITABLE` | 409 | El cliente intenta editar un pedido creado por el negocio |
| `NOT_EDITABLE` | 400 | El cliente intenta borrar un pedido que ya no se puede eliminar |
| `ALREADY_DELETED` | 400 | El pedido ya fue eliminado por el cliente |
| `NO_USER` | 500 | La organización no tiene usuarios activos a quienes atribuir la acción |
| `STORAGE_UPLOAD_FAILED` | 502 | Fallo al subir la factura a R2 (revisar R2 en DevTools) |
| `STORAGE_WRITE_FAILED` | 502 | Fallo al guardar la factura en disco local |
| `INVOICE_EXPIRED` | 410 | Link de factura bloqueado/revocado o pasadas 24 h |

## 5. Chats, WhatsApp e IA (INB, WPP, IA)

| `code` | HTTP | Cuándo |
|---|---|---|
| `NO_WPP_CREDENTIALS` | 422 | La organización no tiene credenciales de WhatsApp (envío de multimedia) |
| `WPP_UPLOAD_FAILED` | 502 | Meta rechazó la subida de imagen, audio, video o documento |
| `MEDIA_EXPIRED` | 404 | Meta ya no tiene el archivo (retiene 30 días) |
| `PHONE_TAKEN` | 409 | Cambiar el teléfono de un ticket a uno que ya tiene otro chat |
| `INVALID_MESSAGES` | 400 | "Tomar lista" con mensajes inexistentes, no entrantes de texto o sin texto |
| `AI_EXTRACTION_FAILED` | 502 | Ningún proveedor de IA pudo procesar el texto |
| `MISSING_SIGNATURE` | 403 | Webhook sin cabecera de firma |
| `INVALID_SIGNATURE` | 403 | Webhook con firma HMAC incorrecta |

## Notas

- Un mismo `code` puede salir con textos distintos (`VALIDATION_ERROR`, `NOT_FOUND`); la web no debe depender del mensaje.
- La web trata distinto un 401: con token dispara refresh; sin token (login fallido) no (`arquitectura.md` §8).
- Excepciones al formato: `/health` y el webhook responden `{ status, timestamp }` y `{ ok: true }` en éxito.
