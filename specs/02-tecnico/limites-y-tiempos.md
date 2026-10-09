---
estado: vigente
verificado: 2026-10-09 @ 2cbd083
fuentes: [apps/api/src/server.ts, apps/api/src/routes/*.ts, apps/api/src/lib/businessDate.ts, apps/api/src/services/ai/*]
---

# Límites, tiempos y umbrales

Tabla de consulta rápida para responder "¿cuánto dura / cuántos permite…?". Cada valor se verificó en su módulo; **el detalle y el porqué están en el módulo indicado** (este archivo no los repite). Si cambias un valor en el código, cambia también esta tabla y el módulo.

## Tiempos de vida

| Qué | Valor | Módulo |
|---|---|---|
| Token de acceso (JWT) | 15 min | ACC |
| Refresh token | 7 días, rota en cada uso | ACC |
| Cierre de sesión por inactividad (web) | 1 hora | ACC |
| Link de formulario | 24 h planas desde que se generó | FRM, INB |
| Link de factura | 24 h | FAC |
| Código 2FA (solo rol dev) | 5 min; 5 intentos; reenvío cada 30 s; máx. 5 códigos por 15 min | ACC |
| Multimedia en WhatsApp | Meta la retiene 30 días (4Client no la guarda) | INB, WPP |
| Mensaje entrante "viejo" | Se descarta si llega con más de 10 min de retraso | WPP |
| Pausa de un proveedor de IA caído | 90 s (en memoria) | IA |
| Caché de modelos de IA | 1 hora | IA |

## Horarios de negocio

| Qué | Valor | Módulo |
|---|---|---|
| Zona horaria de negocio | Bogotá, UTC-5, sin horario de verano | todos |
| Corte del día de un chat | 21:00 (solo el primer mensaje real del día) | WPP |
| Respaldo diario de la base | 03:00 Bogotá (08:00 UTC) | `04-operacion/` |
| Zona roja de un ticket sin pedido | 20 min desde su creación | ORD |
| Aviso de suscripción | El día 1 de cada mes | PLT, DSH |

## Tope de cantidades

| Qué | Valor | Módulo |
|---|---|---|
| Pedidos por formulario | 3 por ticket y por fecha (429 `FORM_LIMIT_REACHED`) | FRM |
| Mensajes automáticos de confirmación | 30 por ticket en 24 h | FRM |
| Ítems por envío del formulario | 1 a 100 | FRM |
| Precio máximo de un ítem | 9.999.999 | ORD |
| Bandeja de chats | 500 tickets, sin paginar | INB |
| Mensajes por página de chat | 500 (más antiguos con cursor) | INB |
| Reenvío de mensajes | 1 a 20 destinos | INB |
| Texto de una respuesta | hasta 4096 caracteres | INB |
| Tomar lista | 1 a 50 mensajes; hasta 200 ítems devueltos | IA |
| Precios por lote (Excel) | 1 a 500 filas | CAT |
| Historial del informe | 300 cambios | DSH |

## Frecuencia (rate limits)

| Qué | Valor | Módulo |
|---|---|---|
| Global por usuario (o IP si no hay sesión) | 300 por minuto | `api-y-eventos.md` |
| Login | 10 por minuto | ACC |
| Verificación 2FA y refresh | 20 por minuto | ACC |
| Envío del formulario y borrado por el cliente | 15 por minuto por IP | FRM |
| Webhook de Meta | 2000 por minuto | WPP |
| Tomar lista | 15 por minuto | IA |
| Envío de multimedia | 60 por minuto | INB |
| Reenvío | 20 por minuto | INB |
| Subida de factura | 20 por minuto | FAC |

## Bloqueo de cuentas

| Fallos de contraseña | Bloqueo |
|---|---|
| 5 | 5 min |
| 10 | 15 min |
| 15 | 1 hora |

## Archivos

| Qué | Límite | Módulo |
|---|---|---|
| Imagen enviada por chat | JPEG, PNG o WebP, hasta 5 MB | INB |
| Audio / video | hasta 16 MB | INB |
| Documento PDF | hasta 100 MB | INB |
| Factura PDF | debe empezar con `%PDF`; límite de tamaño en `modulos/FAC.md` | FAC |

## Umbrales de coincidencia (IA)

| Qué | Valor | Módulo |
|---|---|---|
| Similitud mínima para asociar a un producto | 0,72, con margen de 0,08 sobre el segundo | IA |
| Texto máximo que se intenta asociar | 200 caracteres | IA |
