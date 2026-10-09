---
estado: vigente
verificado: 2026-10-09 @ 2cbd083
fuentes: [apps/api/src/middleware/auth.ts, apps/api/src/routes/*.ts, apps/web/src/pages/MainPage.tsx, apps/web/src/components/config/ConfigTab.tsx]
---

# Actores y permisos

## Actores

| Actor | Quién es | Cómo entra |
|---|---|---|
| **admin** | Dueño del negocio | Login (email + contraseña) |
| **encargado** | Atiende el mostrador, maneja pedidos y cierre | Login |
| **domiciliario** | Repartidor con acceso de solo lectura y chat | Login |
| **dev** | Operador de la plataforma | Login (con 2FA por correo si `REQUIRE_2FA`) |
| **cliente final** | Compra por WhatsApp y arma su pedido en el formulario | Link temporal (sin cuenta) |
| **Meta** | Envía los mensajes entrantes al webhook | Firma HMAC |

## Regla de herencia

`dev` **pasa todas las verificaciones de rol** (`requireRole`). Por eso, donde esta tabla dice "admin", también aplica a `dev`. Un admin nunca ve ni edita cuentas `dev` (la API responde 404 como si no existieran). `authenticate` rechaza cualquier token sin `userId` y `role`, para que un token de link de formulario no sirva como sesión de personal.

## Matriz rol × capacidad (lo que la API permite)

| Capacidad | admin | encargado | domiciliario | dev |
|---|:-:|:-:|:-:|:-:|
| Ver tablero, tickets, pedidos, historial de chat | ✅ | ✅ | ✅ | ✅ |
| Responder en el chat, enviar multimedia, reenviar mensajes | ✅ | ✅ | ✅ | ✅ |
| Generar / revocar el link de formulario de un ticket | ✅ | ✅ | ✅ | ✅ |
| Subir factura (PDF) y enviarla | ✅ | ✅ | ✅ | ✅ |
| Leer productos, empleados, plantillas de mensajes | ✅ | ✅ | ✅ | ✅ |
| Crear/editar pedidos, mover estado, papelera, restaurar | ✅ | ✅ | ❌ | ✅ |
| Cobrar un pedido (pide contraseña del usuario) | ✅ | ✅ | ❌ | ✅ |
| Observaciones en pedidos | ✅ | ✅ | ❌ | ✅ |
| Tomar lista (IA) | ✅ | ✅ | ❌ | ✅ |
| Cierre de caja | ✅ | ✅ | ❌ | ✅ |
| Editar un pedido ya bloqueado (cerrado) | ✅ | ❌ | ❌ | ✅ |
| Marcar crédito pagado, cobro retroactivo | ✅ | ❌ | ❌ | ✅ |
| Chats WPP (bandeja completa y búsqueda) | ✅ | ❌ | ❌ | ✅ |
| Informe del día | ✅ | ❌ | ❌ | ✅ |
| Bloquear todos los links de la organización | ✅ | ❌ | ❌ | ✅ |
| Renombrar ticket / cambiar su teléfono | ✅ | ❌ | ❌ | ✅ |
| Productos y catálogo (crear, editar, precios, Excel) | ✅ | ❌ | ❌ | ✅ |
| Empleados (domiciliarios sin login) | ✅ | ❌ | ❌ | ✅ |
| Usuarios (crear, editar, resetear contraseña) | ✅ | ❌ | ❌ | ✅ |
| Configuración de WhatsApp y mensaje de bienvenida | ✅ | ❌ | ❌ | ✅ |
| Editar plantillas de mensajes | ✅ | ❌ | ❌ | ✅ |
| Ver sus cobros de plataforma (solo lectura) | ✅ | ❌ | ❌ | — (ve todos en DevTools) |
| Borrar datos de un cliente (Ley 1581) | ❌ | ❌ | ❌ | ✅ |
| DevTools: BD, organizaciones, cobros de plataforma, acciones | ❌ | ❌ | ❌ | ✅ |

## Lo que cada rol ve en la interfaz

- **Todos:** pestaña "Tickets & Pedidos".
- **admin / dev:** además "Chats WPP", "Informe del día" y "Configuración".
- **Configuración:** Productos, Usuarios (incluye Domiciliarios), Mensajes, Facturación (solo admin) y DevTools (solo dev).
- Hay una divergencia conocida: al domiciliario se le muestran botones (Guardar, Mover) que la API rechaza con 403. Ver `03-plan/problemas-conocidos.md`.

## Cliente final

Sin cuenta. Entra con un link de formulario de 40 hexadecimales, válido 24 horas desde que se generó, que solo sirve para su propio ticket. Detalle en `modulos/FRM.md`.
