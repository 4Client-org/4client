# Problemas conocidos

> **Resumen.** Lista de lo que está mal de forma objetiva o puede estarlo: ningún `BUG` confirmado, 42 deudas técnicas (`DT`), y 17 divergencias entre interfaz y API que esperan decisión de José. Cada fila lleva módulo e impacto. Las dudas de intención están en `preguntas-abiertas.md`; la correspondencia con IDs provisionales, en `mapa-de-ids.md`.

## Cómo priorizar

| Impacto | Criterio | Qué hacer |
|---|---|---|
| **Alto** | Dinero sin test, permisos o tenant sin test, datos de un cliente en otro, datos personales en el repo | Primero. Antes de un segundo cliente o de tocar ese módulo |
| **Medio** | Cifras distintas según la pantalla, tests que faltan en un módulo no financiero, comentarios que prometen una defensa que no existe | Al tocar el módulo, en la misma rama |
| **Bajo** | Código muerto, duplicados, comentarios viejos | Oportunista; nunca solo por limpiar si arriesga producción |

Una DT con impacto Alto se resuelve con un test o un cambio clase C (principio 10 y 11). Una divergencia interfaz/API no se "arregla" sin que José diga cuál capa tiene razón (regla 4 de `AGENTS.md`).

### Los Altos de un vistazo

| ID | Resumen | Módulo |
|---|---|---|
| DT-001, DT-002 | Datos del primer cliente fijos en el código (rompen el principio 2) | WPP, PLT, FRM |
| DT-003, DT-030 | Totales del cierre y del informe sin test | CAJ, DSH |
| DT-010 | Reglas de tenant del webhook sin test | WPP |
| DT-023 | Usuarios y empleados (permisos y tenant) sin test | ACC |
| DT-033 | PDF de facturas versionados en git que podrían traer datos personales | FAC |

## Bugs confirmados

Ninguno todavía. José no ha confirmado ningún defecto: lo que parece mal está registrado como `PREG` (ver `preguntas-abiertas.md`). Un `BUG-nnn` nace cuando José responde que un comportamiento es incorrecto.

## Deuda técnica

| ID | Qué | Módulo | Impacto |
|---|---|---|---|
| DT-001 | Plantillas de mensajes por defecto con datos de un cliente (razón social, cuenta bancaria, mínimo y costo de domicilio) que cualquier negocio nuevo hereda; un test los fija. | WPP, PLT | Alto: un negocio nuevo enviaría la cuenta bancaria de otro; rompe el principio 2. |
| DT-002 | Otro monoinquilino fijo en el código: política de privacidad (URL y texto de un solo negocio), logo y marca de agua del encabezado, seed y scripts con el `slug` de un cliente, ejemplo de bienvenida. | PLT, FRM, GEN | Alto: marca y datos de un cliente en todo negocio nuevo. |
| DT-003 | Faltan tests de totales del cierre por bolsa, de `DailyClose` y del cobro en día cerrado. | CAJ | Alto: dinero sin red de seguridad (principio 11). |
| DT-004 | Regla de totales triplicada (servidor del cierre, informe y modal); ya divergió. | CAJ, DSH | Medio: cifras distintas según la pantalla. |
| DT-005 | `caja_cerrada` se escribe y nadie lo lee. | CAJ, GEN | Bajo: columna sin uso. |
| DT-006 | `DailyClose.decisions` guarda el objeto recibido sin filtrar; cierres viejos con `dejar_activo`/`cancelar` salen 'Sin decidir' en el CSV. | CAJ | Bajo. |
| DT-007 | `quantity_value` y `quantity_unit` sin uso (la cantidad real es `quantity_label`). | ORD | Bajo: campos muertos. |
| DT-008 | Faltan pruebas de papelera, restaurar, observaciones, revocación de facturas al editar y tablero/modales. | ORD | Medio. |
| DT-009 | Comentario desactualizado en `orderNumbering.test.ts` (el pospuesto ya se renumera). | ORD | Bajo. |
| DT-010 | Faltan tests de reglas de tenant y entrada del webhook (enrutamiento, HMAC, deduplicación, descarte 10 min, plantillas). | WPP | Alto: reglas de tenant sin test (principio 11). |
| DT-011 | Comentarios desactualizados en `webhook.ts` y `server.ts` (límite 300/min, es 2000). | WPP | Bajo. |
| DT-012 | Código muerto de seguridad de links: `registerFailedLinkAttempt`, `MAX_ATTEMPTS_HARD`, `TICKET_BLOCK_HOURS`, columnas `link_failed_total`/`link_blocked_until`, `FormLinkSession`, `device_token` (decisión en PREG-035). | INB, FRM, FAC, GEN | Medio: comentarios que prometen una defensa inexistente. |
| DT-013 | Rama muerta en la web: `wpp_status === 'failed'` y `wpp_error` nunca llegan. | INB | Bajo. |
| DT-014 | Quitar duplicados por teléfono es redundante (`Ticket` es único por `(org_id, phone)`). | INB | Bajo. |
| DT-015 | Faltan tests de bandeja, mensajes, multimedia, límites, reenvío, `GET/POST/PATCH /tickets` y `erase-data`. | INB | Medio. |
| DT-016 | Constantes de multimedia duplicadas entre `inbox.ts`, `lib/media.ts` y `useSendChatMedia.ts`. | INB | Bajo. |
| DT-017 | `.env.example` desactualizado sobre Groq/OpenRouter y cita un informe de costos inexistente. | IA | Bajo. |
| DT-018 | Huecos de tests (fusión web, modales, límite de 50 ids, ticket de otra organización, enfriamiento sin status). | IA | Medio. |
| DT-019 | Restos de proveedores desactivados (`openaiCompatible.ts`, `cerebras.ts`, comentario de `types.ts`). | IA | Bajo. |
| DT-020 | Comentarios desactualizados en `public.ts` y `ClientFormPage` (límite por IP, 24 h, `client_deleted`, paso de dígitos). | FRM | Bajo. |
| DT-021 | Etiqueta 'Entregado' inalcanzable: `form-info` excluye `cerrado`. | FRM | Bajo. |
| DT-022 | Sin tests de `/products`, límite 15/min, merge 404, edición, tope de 30, bloqueo y página. | FRM | Medio. |
| DT-023 | `users.ts` y `employees.ts` sin tests (permisos por rol, aislamiento por organización). | ACC | Alto: permisos y tenant sin test (principio 11). |
| DT-024 | Validación de contraseña duplicada y distinta (6 caracteres en `UsersSection.tsx`, 12 con mayúscula, minúscula y número en `password.ts`). | ACC | Medio: la interfaz acepta lo que la API rechaza. |
| DT-025 | Sin tests de bloqueos de 15 min y 1 h, cuenta inactiva, sockets y cierre por inactividad. | ACC | Medio. |
| DT-026 | Carrera en alta de usuario: puede devolver 500 en vez de 409. | ACC | Bajo. |
| DT-027 | Falta cobertura de tests del catálogo, aislamiento por organización, lote, Excel e imagen. | CAT | Medio. |
| DT-028 | `categoryOrder.ts` duplicado (API y web) más una tercera copia en `ProductsSection.tsx`. | CAT, GEN | Bajo. |
| DT-029 | `unit_type` es texto libre en la API y la lista de 7 opciones vive solo en la web. | CAT | Bajo. |
| DT-030 | Faltan tests del informe (conteos, bolsas, chats, crédito, 403, día cerrado); viola el principio 11. | DSH | Alto: cifras de dinero sin test. |
| DT-031 | `domActivos` es código muerto. | DSH | Bajo. |
| DT-032 | Respuesta del informe sin tipo y con exceso de datos (pedidos completos, `any`). | DSH | Bajo. |
| DT-033 | 6 PDF de facturas versionados en git bajo `apps/api/uploads/` que podrían traer datos de clientes. | FAC | Alto: posibles datos personales en el repositorio. |
| DT-034 | Comentarios desactualizados en `files.ts` (regla de 4 h, `phone_last4`). | FAC | Bajo. |
| DT-035 | Faltan tests de firma `%PDF`, tamaños, 502, revocaciones y `buildPDFDoc`. | FAC | Medio. |
| DT-036 | Total de la factura recalculado en tres sitios. | FAC | Bajo. |
| DT-037 | Faltan tests del seed, visor, auditoría `dev.db_read`, recordatorio, PDF de plataforma y `audit()`. | PLT | Medio. |
| DT-038 | Total del cobro sumado en cuatro sitios. | PLT | Bajo. |
| DT-039 | PDF huérfanos en R2: borrar un cobro no borra su PDF y `storage-test` deja archivos. | PLT, FAC | Bajo. |
| DT-040 | Comentarios del schema sobre ventanas de link (10 min / 4 h) y `phone_last4` contradicen el vencimiento fijo de 24 h. | GEN | Bajo. |

Total: 40 elementos de deuda técnica en esta tabla (más DT-041 y DT-042 al final). `DT-001` y `DT-002` son las excepciones al principio 2 (multi-tenant estricto) que ya cita `00-principios.md`.

## Divergencias interfaz vs API

Casos donde la interfaz y la API no aplican la misma regla. Hasta que José decida cuál es la correcta, el comportamiento documentado es el de cada capa.

| ID | La interfaz | La API | Módulo | Impacto |
|---|---|---|---|---|
| PREG-008 | Solo muestra 'Cerrar caja' en Informe del día (el encargado no lo ve) | El encargado puede cerrar caja | CAJ | Medio: el encargado puede cerrar caja por API aunque no vea el botón |
| PREG-012 | Muestra Guardar, Mover, observaciones, flechas y arrastre al domiciliario | Responde 403 a todos esos | ORD | Medio: botones que fallan con 403 al domiciliario |
| PREG-010 | Impide cobrar pedidos en papelera o eliminados por el cliente | Los cobra | CAJ | Medio: cobro de un pedido que la pantalla no deja cobrar |
| PREG-002 | La vista previa del cierre suma distinto (pago dividido, eliminados, créditos) | El cierre real aplica otra regla | CAJ | Alto: la vista previa del cierre puede no coincidir con el cierre real (dinero) |
| PREG-030 | Desactiva Formulario/Cuenta banco en días pasados o con caja cerrada | Genera links y envía siempre | WPP, INB | Bajo |
| PREG-080 | Impide facturar pedidos cerrados, en papelera, sin ítems o cobrados | `POST /invoice` los acepta | FAC | Medio: facturas de pedidos que la pantalla no permite |
| PREG-049 | Deja pulsar 'Tomar lista' en pedidos de solo lectura | Sin regla propia; no aparece 'Guardar' | IA | Bajo |
| PREG-047 | 'Tomar lista' activo desde el cierre de caja, sin manejadores | Extrae y el resultado se pierde | IA | Bajo: resultado perdido |
| PREG-062 | Muestra desactivar en la fila propia | Responde 400 `SELF_DEACTIVATE` | ACC | Bajo |
| PREG-063 | Muestra y guarda el nombre de usuario | No sirve para iniciar sesión | ACC | Medio: el usuario cree que puede entrar con nombre de usuario |
| PREG-088 | 'Marcar pagado' no tiene vuelta atrás | Permite volver a `pendiente` | PLT | Bajo |
| PREG-091 | Oculta renombrar ticket (`RENAME_TICKET_UI_ENABLED = false`) | El admin puede renombrar | PLT, INB | Bajo |
| PREG-014 | Ninguna pantalla crea pedidos `channel = 'call'` | Acepta el canal | ORD, PLT | Bajo |
| PREG-023 | Ninguna pantalla muestra `wpp_redirect_message` | Lo devuelve y lo aplica | WPP | Medio: mensaje configurable que ningún admin puede ver |
| PREG-052 | El formulario no distingue productos agotados | `in_stock` existe pero `/products` no lo envía | FRM, CAT | Medio: el cliente puede pedir un producto agotado |
| DT-024 | Acepta contraseñas de 6 caracteres | Exige 12 con mayúscula, minúscula y número | ACC | Medio |
| DT-013 | Muestra un aviso si `wpp_status === 'failed'` | Nunca devuelve ese valor | INB | Bajo |

## Nuevas (revisión de completitud, 2026-10-09)

| ID | Qué | Impacto | Módulo |
|---|---|---|---|
| DT-041 | `update-org-wpp.ts` y `seed-chats.ts` traen el `slug`, un `phone_id` de Meta y la fecha `2026-06-27` escritos en el código, y nada impide correrlos contra producción | Parte de DT-002 (monoinquilino fijado) | PLT |
| DT-042 | Los métodos de pago están repetidos en el tipo compartido, la lista de `public.ts`, los esquemas de `orders.ts` y varios modales; agregar uno obliga a tocar todos | Riesgo de olvidar un sitio | CAJ, ORD, FRM |
| DT-043 | `Dockerfile` sin `HEALTHCHECK` y sin manejadores `unhandledRejection`/`uncaughtException`; Sentry no ve los rechazos de los `.catch` del webhook | Medio, observabilidad | PLT |
| DT-044 | Backup R2 en la misma cuenta de Cloudflare que web, DNS y archivos; el workflow no verifica el objeto subido ni avisa si falla | Alto si se suspende la cuenta | PLT |
| DT-045 | Sin inventario ni copia fuera de Coolify de secretos y variables por app | Medio, recuperación | PLT |
| DT-046 | `downloadMedia` valida el host solo en la URL inicial; `fetch` sigue redirecciones sin revalidar | Bajo, por verificar | INB |
| DT-047 | `AuditLog` sin regla de inmutabilidad y `LoginVerificationCode` nunca se purga; `wpp_meta_app_secret` sin cifrar (columna sin uso) | Bajo | PLT, ACC |
| DT-048 | Clave de Gemini viaja en la URL; Actions fijadas por tag y sin Dependabot; `apps/api/uploads/` fuera de `.gitignore` (ver DT-033) | Bajo | PLT |
