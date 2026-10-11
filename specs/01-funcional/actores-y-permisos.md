---
estado: vigente
verificado: 2026-10-10 @ 17dcc31
fuentes: [apps/api/src/middleware/auth.ts, apps/api/src/routes/*.ts, apps/web/src/pages/MainPage.tsx, apps/web/src/components/config/ConfigTab.tsx, specs/modulos/*.md]
---

# Actores y permisos

## Actores

| Actor | Quién es | Cómo entra | Módulo |
|---|---|---|---|
| **admin** | Dueño del negocio | Login (correo + contraseña) | ACC |
| **encargado** | Atiende el mostrador, maneja pedidos y cobros | Login | ACC |
| **domiciliario** | Repartidor con acceso de solo lectura y chat | Login | ACC |
| **dev** | Operador de la plataforma (hoy José) | Login, con 2FA por correo si `REQUIRE_2FA` (D-10) | ACC, PLT |
| **cliente final** | Compra por WhatsApp y arma su pedido en el formulario | Link temporal (sin cuenta) | FRM |
| **Meta** | Envía los mensajes entrantes al webhook | Firma HMAC (sin usuario) | WPP |

El repartidor al que se *asigna* un pedido es un `Employee` sin login: no es un actor del sistema (ver glosario).

## Reglas generales

- **Herencia de `dev`.** `dev` **pasa todas las verificaciones de rol** (`requireRole`). Donde la tabla dice "admin", también aplica a `dev`. Un admin nunca ve ni edita cuentas `dev` (la API responde 404 como si no existieran).
- **Solo sesiones de personal.** `authenticate` rechaza cualquier token sin `userId` y `role`, para que un token de link de formulario no sirva como sesión de personal.
- **Aislamiento por negocio.** Toda ruta filtra por el `org_id` del token (principio 2); la única excepción por diseño es `/dev/*`.
- **Día cerrado congela todo.** Con la caja de un día cerrada, ningún rol (tampoco admin ni dev) crea, edita, mueve, restaura, cobra ni cobra retroactivamente pedidos de ese día: 409 `DAY_CLOSED`. Solo siguen las observaciones y "marcar crédito pagado" (RN-CAJ-21). La matriz de abajo vale para un día abierto.
- **Gana la API.** La matriz es lo que la **API permite**. Cuando la interfaz muestra u oculta algo distinto, está anotado abajo y en el módulo dueño.

## Matriz rol × capacidad (lo que la API permite)

| Capacidad | admin | encargado | domiciliario | dev | Módulo |
|---|:-:|:-:|:-:|:-:|---|
| Ver tablero, tickets, pedidos, historial de chat | ✅ | ✅ | ✅ | ✅ | ORD, INB |
| Responder en el chat, enviar multimedia, reenviar mensajes | ✅ | ✅ | ✅ | ✅ | INB |
| Enviar formulario, "Cuenta banco" y catálogo por el chat | ✅ | ✅ | ✅ | ✅ | WPP, INB, CAT |
| Generar / revocar el link de formulario de un ticket | ✅ | ✅ | ✅ | ✅ | INB |
| Subir factura (PDF) y enviarla | ✅ | ✅ | ✅ | ✅ | FAC |
| Leer productos, empleados, plantillas de mensajes | ✅ | ✅ | ✅ | ✅ | CAT, ACC, WPP |
| Crear/editar pedidos, mover estado, papelera, restaurar | ✅ | ✅ | ❌ | ✅ | ORD |
| Cobrar un pedido (pide contraseña del usuario) | ✅ | ✅ | ❌ | ✅ | CAJ |
| Observaciones en pedidos | ✅ | ✅ | ❌ | ✅ | ORD |
| Tomar lista (IA) | ✅ | ✅ | ❌ | ✅ | IA |
| Cierre de caja | ✅ | ✅ | ❌ | ✅ | CAJ |
| Editar un pedido ya bloqueado (cerrado) | ✅ | ❌ | ❌ | ✅ | ORD, CAJ |
| Cambiar el método o el desglose de pago de un pedido ya cobrado (`403 PAYMENT_CHANGE_ADMIN_ONLY` al encargado) | ✅ | ❌ | ❌ | ✅ | CAJ (RN-CAJ-26) |
| Marcar crédito pagado, cobro retroactivo | ✅ | ❌ | ❌ | ✅ | CAJ |
| Chats WPP (bandeja completa y búsqueda) | ✅ | ❌ | ❌ | ✅ | INB (D-09) |
| Informe del día (incluye descargar CSV) | ✅ | ❌ | ❌ | ✅ | DSH |
| Bloquear todos los links de la organización | ✅ | ❌ | ❌ | ✅ | INB, DSH |
| Renombrar ticket / cambiar su teléfono | ✅ | ❌ | ❌ | ✅ | INB |
| Productos y catálogo (crear, editar, precios, Excel) | ✅ | ❌ | ❌ | ✅ | CAT |
| Empleados (domiciliarios sin login) | ✅ | ❌ | ❌ | ✅ | ACC |
| Usuarios (crear, editar, resetear contraseña) | ✅ | ❌ | ❌ | ✅ | ACC |
| Configuración de WhatsApp y mensaje de bienvenida | ✅ | ❌ | ❌ | ✅ | WPP |
| Editar plantillas de mensajes | ✅ | ❌ | ❌ | ✅ | WPP |
| Ver sus cobros de plataforma (solo lectura) | ✅ | ❌ | ❌ | — (ve todos en DevTools) | PLT |
| Borrar datos de un cliente (Ley 1581) | ❌ | ❌ | ❌ | ✅ | INB (D-17) |
| Reabrir un día cerrado | ❌ | ❌ | ❌ | ✅ | CAJ, PLT |
| DevTools: BD, organizaciones, cobros de plataforma, acciones | ❌ | ❌ | ❌ | ✅ | PLT |

## Lo que cada rol ve en la interfaz

- **Todos:** pestaña "Tickets & Pedidos".
- **admin / dev:** además "Chats WPP", "Informe del día" y "Configuración".
- **Configuración:** Productos, Usuarios (incluye Domiciliarios), Mensajes, Facturación (solo admin) y DevTools (solo dev).

**Donde la interfaz difiere de la API** (el módulo dueño tiene el detalle):

| Caso | Interfaz | API | Dónde |
|---|---|---|---|
| Domiciliario en pedidos | Ve botones (Guardar, Mover) | 403 | ORD, PREG-012 |
| Encargado y cierre de caja | No tiene el botón (vive en el Informe, que no ve) | Lo permite | CAJ, PREG-008 |
| Encargado/domiciliario y "Chats WPP" | No ven la pestaña; sí abren el chat desde el ticket | 403 en `GET /inbox` | INB |
| Renombrar ticket | Botón apagado (`RENAME_TICKET_UI_ENABLED`) | Admin/dev | INB, PREG-091 |
| Crear admin | El formulario solo ofrece encargado y domiciliario | Acepta `admin` | ACC |
| WhatsApp en DevTools | Solo dev | `/config/*` abierto a admin | PLT, WPP |
| Restaurar desde la pestaña Papelera del informe con el día cerrado | Muestra "Restaurar" | 409 `DAY_CLOSED` | DSH, CAJ (RN-CAJ-21) |

## Cliente final

Sin cuenta. Entra con un link de formulario de 40 hexadecimales, válido 24 horas desde que se generó, que solo sirve para su propio ticket; puede crear (máximo 3 por día), editar o borrar sus pedidos del formulario mientras estén abiertos y su día no tenga la caja cerrada (RN-CAJ-21). También abre, sin sesión, el link de factura de 24 h. Detalle en `modulos/FRM.md` y `modulos/FAC.md`.
