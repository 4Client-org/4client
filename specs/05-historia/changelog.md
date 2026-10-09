---
estado: vigente
verificado: 2026-10-09 @ 066c45d
fuentes: [git log origin/main --first-parent --merges, cuerpos de commit]
---

# Changelog de producción

Un renglón por release a producción, es decir, cada merge de `dev` a `main` (`git log origin/main --first-parent --merges`), del más nuevo al más viejo. Solo cambios visibles para el usuario; el detalle técnico está en el commit (`git show <sha>`). Las decisiones de fondo están en [`decisiones.md`](decisiones.md) y la línea de tiempo en [`cronologia.md`](cronologia.md).

> **Las entradas anteriores al 2026-07-25 son pre-producción.** El cliente real (Fruver San Gabriel) entró en vivo el 2026-07-25 (José). Antes de esa fecha `main` se desplegaba, pero era el entorno de la primera instalación y de pruebas con el cliente; por eso esa parte está resumida por día y no por release. Hay una diferencia de un día con el primer merge a `main` posterior (2026-07-26) → PREG-116 en `cronologia.md`.

Nota de lectura: desde 2026-07-12 hubo merges encadenados `dev → test → main`; aquí cuenta el que llega a `main`. Los merges "Merge remote-tracking branch 'origin/dev'" no traen descripción; se resumen con los commits que incluyen.

## Producción (desde 2026-07-25)

### Octubre 2026

- **2026-10-09 `a072a25`** — Aviso en vivo al guardar un mensaje en Configuración > Mensajes. Mínimo de domicilio sube a $20.000. *(No incluye la política de privacidad en el dominio propio ni la limpieza de Vercel/Railway: están en `dev`.)*
- **2026-10-08 `fed1270`** — Corte de las 9 p. m. por el primer mensaje real del día (también para clientes antiguos).
- **2026-10-08 `2f98b3a`** — Los chats nuevos entre 9:00 p. m. y 11:59:59 p. m. pasan al día siguiente del tablero.
- **2026-10-06 `9efc3c8`** — El encabezado del chat es igual en la conversación y en el pedido.
- **2026-10-06 `ad347c7`** — Mensajes editables por organización; botón "Cuenta banco" (deshabilitado al cerrar caja); "Eliminar datos" solo para `dev`; chat y modales con tamaños unificados.
- **2026-10-05 `c87e363`** — Botón "Cuenta banco" en el chat y mensaje de domicilio (mínimo $10.000, costo $2.000).
- **2026-10-03 `2c04e31`** — Vulnerabilidades de auditoría y dependencias cerradas (fastify 5.12.5, overrides).

### Septiembre 2026

- **2026-09-28 `afad6a8`** — Hallazgos de auditoría de seguridad y cumplimiento: la lista de tickets deja de cargar todo el historial, el socket se corta al vencer la sesión, auditoría de logins, se registra la versión de la política aceptada.
- **2026-09-21 `5725bb8`** — Tablero reordenado, se quita la columna Entregado; la bienvenida ya no manda el link automáticamente.
- **2026-09-20 `bd6c1c7`** — Limpieza de documentos y configuración residuales de Railway.
- **2026-09-20 `97bfabb`** — Se restauran los candados de seguridad que dependían de Railway (ahora con `APP_ENVIRONMENT_NAME`).
- **2026-09-20 `1e3c863`, `07ac4d3`, `3bece02`** — El chat siempre abre al final; botón "ir al final" muestra el último mensaje completo; "cargar mensajes anteriores" disponible en todos los modales.
- **2026-09-20 `e86be9d`** — El chat muestra los mensajes recientes en tickets con historial largo; logs del webhook visibles; Tomar lista no espera de nuevo a Gemini caído.
- **2026-09-11 `b8d48c1`** — Reenviar un mensaje a otro chat ya no falla en silencio; el encargado deja de ver un buscador de reenvío inservible.
- **2026-09-09 `7faf707`** — Cierre de hallazgos de seguridad; Tomar lista deja de autoasignar el precio del catálogo.
- **2026-09-08 `f062ace`** — Ningún pedido queda con precio autoasignado del catálogo.
- **2026-09-04 `2f2b8a9`** — Corrige fotos y audios del chat que no se veían (CSP bloqueaba `blob:`).
- **2026-09-03 `c87bda1`** — **Ley 1581:** consentimiento de datos en cada pedido, aviso de privacidad una sola vez en la bienvenida, botón "Eliminar datos" (derecho de supresión), multimedia del chat solo en WhatsApp; correo de login único en la plataforma.
- **2026-09-03 `9b9d326`** — App usable en celular y tableta; mensaje de redirección para el número de WhatsApp retirado.
- **2026-09-02 `eda7360`, `543837d`, `dc11dda`** — Chat usable en celular, se quita un tope de ancho que rompía el PC; mensaje de redirección del número viejo. *(Merges a `dev`; llegan a `main` con `9b9d326`.)*
- **2026-09-01 `17a467e`** — Valor por concepto en los cobros de plataforma; editar y eliminar un cobro.
- **2026-09-01 `534aa94`** — Factura de plataforma con diseño profesional; pestaña de Facturación para el admin; nombre de producto editable en cualquier fila; Tomar lista resiste a Gemini congestionado.

### Agosto 2026

- **2026-08-31 `47da3b0`** — La facturación admite varios conceptos por cobro y solo pide el mes.
- **2026-08-31 `bc9494a`** — Centro de mando `dev` (crear organizaciones, acciones curadas), catálogo por WhatsApp, tabla de productos con edición en línea, precios por Excel.
- **2026-08-29 `2c4be6b`** — **Tomar lista:** armar el pedido con IA desde el chat (Gemini principal, Groq y OpenRouter de respaldo), con detección de duplicados.
- **2026-08-28 `5d2ae78`** — Bienvenida y aviso del link en un solo mensaje (3 mensajes en vez de 4).
- **2026-08-23 `1db397a`** — El informe muestra en rojo los pedidos cerrados sin cobro y por qué faltan del total.
- **2026-08-23 `2d6bf0f`** — Se puede corregir un pedido cerrado "sin cobro" por error; el CSV ya no lo oculta.
- **2026-08-23 `163992c`** — Token de WhatsApp cifrado en reposo; el informe no duplica el cobro en casa y muestra el método de pago por fila.
- **2026-08-02 `6b744fe`** — Numeración de pedidos que rellena huecos; un pospuesto se renumera al día siguiente; Chats WPP con búsqueda y reenvío de mensajes; 2FA por correo para `dev` (apagado por defecto); repetir mi último pedido; "ver conversación" desde el cierre de caja; orden de tickets por última actividad.
- **2026-08-01 `ae8e531`** — Se guarda el payload crudo del webhook de Meta (diagnóstico).

### Julio 2026 (desde la puesta en vivo)

- **2026-07-31 `770435e`** — Multimedia completa de WhatsApp (audio, video, documento, ubicación); aviso en pedidos de crédito; un pedido tardío del formulario ya no cae en un día cerrado.
- **2026-07-27 `5851a13`** — Separador de fecha estilo WhatsApp en el chat (la burbuja muestra solo la hora); cobro dividido por método y conciliación del domiciliario.
- **2026-07-26 `213845a`, `ad1e92f`** — Se pone `main` al día con `dev`: el aviso del método de pago también sale cuando el formulario se une a un pedido existente. Incluye el lote del 07-24/25: links sin PIN ni bloqueo por dispositivo (24 h), `observación` del pedido, pedidos cerrados editables solo por admin/dev, mejoras de crédito.

## Pre-producción (hasta 2026-07-24)

`main` recibía promociones frecuentes (`dev → test → main`); es historia de construcción, no de operación real. Resumen por día de los merges a `main`:

- **2026-07-23** (5 merges, `8ba3ae1`…`69953fb`) — Links del formulario y la factura con verificación de teléfono, bloqueo por intentos fallidos y revocación automática; seguimiento real de entregado/leído/fallido; backup diario; cobro en casa con campo de vuelto.
- **2026-07-22** (4 merges, `458447c`…`79a7196`) — Banner rojo "DEV" en desarrollo; logo y marca de agua del cliente; fecha del pedido en los mensajes al cliente; aviso de seguridad en el link.
- **2026-07-18 y 07-19** (11 merges) — Bloqueo de todos los links de golpe; pista de auditoría completa; ventana 4 a. m. a 8 p. m. del formulario (luego retirada); Usuarios y Domiciliarios unificados; botón de ver contraseña.
- **2026-07-14 y 07-16** (3 merges) — Links atados al dispositivo (retirado el 07-25), pedidos en camino y cerrados de solo lectura, seguimiento de cambios del cliente.
- **2026-07-11 a 07-13** (27 merges) — Auditoría técnica y de seguridad; sesión que no se perdía; un ticket por teléfono; numeración sin colisiones; validaciones en vivo del formulario; el formulario agrega a un pedido activo; cierre de caja sin duplicados.
- **2026-06-28 a 06-30** (11 merges) — Endurecimiento de seguridad, DevTools, rediseño de interfaz, burbujas de WhatsApp, formulario público del cliente con catálogo.
- **2026-06-27 `9e6a809`** — **v1.0.0**: backend, frontend, WhatsApp (Meta Cloud API) e infraestructura de despliegue.
- **2026-06-16 y 06-20** (PR #1 a #9) — Primeras migraciones de interfaz, plan de implementación, backend fase 1a y frontend fase 1B.

## Cómo mantener este archivo

- Una entrada nueva por cada merge a `main`, arriba, con fecha, sha del merge y 1 a 3 líneas de lo que el usuario nota.
- Si un release trae una migración, anotarlo (la prod no tiene rollback de migraciones; ver `04-operacion/entornos-y-despliegue.md`).
- Para generarlas: `git log origin/main --first-parent --merges --format="%ad %h %s" --date=short`.
