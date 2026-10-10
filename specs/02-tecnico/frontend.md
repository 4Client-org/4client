---
estado: vigente
verificado: 2026-10-09 @ 5d8e69d
fuentes: [apps/web/src/App.tsx, apps/web/src/main.tsx, apps/web/src/pages, apps/web/src/components, apps/web/src/hooks, apps/web/src/lib, apps/web/src/store/auth.ts, apps/web/vite.config.ts, apps/web/public, packages/shared]
---

# Mapa del frontend

Dónde vive cada cosa en `apps/web` (React + Vite + TypeScript + Zustand + React Query). Complementa `arquitectura.md` §7 y §8, que explican el **comportamiento** (sesión, refresh, socket, PWA, cabeceras, claves de React Query); aquí está el **mapa**. Para qué hace cada pantalla para el negocio, ver `modulos/`.

## 1. Pantallas (`src/pages`)

| Archivo | Ruta | Quién | Notas |
|---|---|---|---|
| `LoginPage.tsx` | cualquier ruta sin sesión | personal | Incluye el paso del código 2FA (solo rol `dev`). |
| `MainPage.tsx` | cualquier ruta con sesión | personal | Pestañas por rol, selector de fecha, sala de sockets, cabecera con el logo fijo (DT-002). |
| `ClientFormPage.tsx` | `/form?t=<token>` | cliente final | Sin sesión; guarda un borrador en `localStorage` y un identificador de dispositivo por link. |
| `FacturaPage.tsx` | `/factura` | cliente final | Descarga de factura por link de 24 h; sin sesión. |

No hay librería de rutas: `App.tsx` lee `window.location.pathname` una sola vez (`arquitectura.md` §8). La política de privacidad **no** es una pantalla de la app: es HTML estático (`public/legal/politica-privacidad.html`, ruta `/legal/…`).

## 2. Componentes (`src/components`)

| Carpeta | Contiene | Módulo |
|---|---|---|
| `orders/` | `Swimlane` (tablero por ticket, con filas plegables guardadas en `localStorage`), `ProductSearch` (buscador de productos de un pedido), `CodPaymentField` (campos de cobro en casa) | ORD, CAJ |
| `modals/` | `TicketModal` (chat + pedidos de un cliente), `NuevoPedidoModal`, `DetallePedidoModal` (editar, cobrar, papelera, factura PDF), `CierreCajaModal` (decisiones del cierre con borrador en `localStorage`) | ORD, CAJ, FAC |
| `inbox/` | `InboxPanel`: pestaña "Chats WPP" (bandeja, búsqueda, conversación) | INB |
| `chat/` | Catálogo por WhatsApp (`EnviarCatalogoMenu`) y "Tomar lista" (`TomarListaActionBar`, `TomarListaResultModal`) | CAT, IA |
| `dashboard/` | `ResumenTab`: Informe del día y pestaña Crédito | DSH |
| `config/` | `ConfigTab` y sus secciones: Productos, Usuarios, Domiciliarios (`EmployeesSection`), Mensajes, Facturación (`BillingSection`); y la consola `Dev*` (organizaciones, base, enlaces, WhatsApp, sistema, cobros) con `OrgSelector` | ACC, CAT, WPP, PLT |
| `ui/` | Piezas sin lógica de negocio: burbujas de multimedia (`ChatImage/Audio/Video/Document/Location`), `ConfirmModal`, `DatePickerES`, `DeliveryStatus`, `ForwardMessageModal`, `HistoryTable`, `PasswordInput`, `Toast`, `UpdateBanner` | varios |

Convención: todo modal que deba esperar antes de una recarga automática debe usar la clase `moverlay` (ver `UpdateBanner` en `arquitectura.md` §7).

## 3. Hooks (`src/hooks`) y estado

| Hook | Para qué |
|---|---|
| `useOrders` | Lista, creación, edición, movimiento y cobro de pedidos (mutaciones que invalidan `orders` y `tickets`) |
| `useDashboard`, `useCierre` | Informe del día; estado de día cerrado (`useDiaCerrado`) |
| `useProducts`, `useEmployees`, `useMessageTemplates` | Catálogos de la organización |
| `useTomarLista` | Llamada a "Tomar lista" y forma de sus ítems |
| `useSendChatMedia`, `useChatMediaBlob` | Envío de multimedia por el chat; descarga con autenticación de un archivo de Meta |
| `useChatScroll` | Comportamiento de desplazamiento del chat (anclaje al final, carga de mensajes antiguos) |
| `useIdleLogout` | Cierre de sesión tras 60 min sin interacción |

**Estado global:** un solo store de Zustand, `store/auth.ts` (`user` en `sessionStorage`, `accessToken` solo en memoria). Todo lo demás es estado local de componente o caché de React Query (defaults `retry: 1`, `staleTime: 30_000` en `main.tsx`). Claves y eventos que las invalidan: `arquitectura.md` §8.

## 4. Utilidades (`src/lib`)

| Archivo | Función |
|---|---|
| `api.ts`, `apiBase.ts`, `socket.ts` | Cliente HTTP con refresh, elección de la URL de la API y conexión Socket.IO (ver §6) |
| `format.ts`, `formatPhone.ts`, `normalize.ts` | Formato de pesos (`fmtCOP`), fechas de Bogotá (`todayStr`), etiquetas de estado y pago; teléfonos (oculta BSUID y marcadores `no-…`); normalización de texto para búsquedas |
| `tomarLista.ts` | Convierte lo que devuelve la IA en líneas del borrador de un pedido |
| `catalogImage.ts` | Dibuja la imagen del catálogo en un `<canvas>` (sin fotos por producto) |
| `productExcel.ts`, `csv.ts` | Excel de precios (solo el precio es editable al re-subir) y CSV del cierre (neutraliza comillas e inyección de fórmulas) |
| `platformChargePdf.ts` | PDF del cobro de plataforma (carta, jsPDF) |
| `categoryOrder.ts` | Orden de categorías; **copia** de la de la API (DT-028) |
| `fileToBase64.ts` | Archivo a base64 y topes de imagen del chat |

Los tipos de eventos de Socket.IO vienen del paquete `packages/shared` (`@4client/shared`), usado por API y web.

## 5. Archivos estáticos (`public/`)

`_headers` (cabeceras y CSP de Cloudflare), íconos de la PWA, `legal/politica-privacidad.html`, y el logo y marca de agua del primer cliente (`fruver-san-gabriel.*`, DT-002), más `logo.png` y `storeWallpaper.jpg`.

## 6. Cómo elige la web la URL de la API

Orden de decisión en `lib/apiBase.ts › resolveApiBase` *(código)*:

1. `VITE_API_URL`, si se fijó **al construir** (Vite la incrusta). En Cloudflare Pages debe quedar sin definir; en CI el build la fija con la variable de repositorio `VITE_API_URL` o, si falta, la API de producción (`ci.yml`).
2. `localhost` o `127.0.0.1` → `http://localhost:3000`.
3. Host `dev.*.pages.dev` → API de dev.
4. Cualquier otro host → API de producción.

`isDevEnvironment` aplica la misma regla de hosts para mostrar la franja roja "DEV". Consecuencia: una vista previa de Pages de otra rama habla con la API de **producción** (PREG-105).

## 7. PWA y service worker

Configurado en `vite.config.ts › VitePWA` *(código)*:

- `registerType: 'prompt'`: un deploy nuevo no recarga pestañas abiertas (por qué: `arquitectura.md` §7).
- Manifiesto: nombre "4Client - Gestión Operativa", `display: standalone`, íconos de 192 y 512 px.
- **Exclusión `/legal`:** `workbox.navigateFallbackDenylist: [/^\/legal\//]`. Sin ella, el service worker respondería con la app (`index.html`) a quien ya la usó en ese navegador, y la política de privacidad no se vería. Si agregas otra página estática bajo `public/`, agrégala a esa lista.
- Actualización: `UpdateBanner` revisa versión cada 30 min y al volver a la pestaña.

## 8. Cómo agregar una pantalla o una llamada

- **Llamada a la API:** `api.get/post/patch/delete` de `lib/api.ts` (ya trae token, refresh y errores con `code`; ver `codigos-de-error.md`). Para datos que se repiten, un hook con React Query y su clave documentada en `arquitectura.md` §8.
- **Evento de tiempo real nuevo:** declararlo en `packages/shared`, emitirlo en la API (`api-y-eventos.md`) y escucharlo en `MainPage` invalidando la clave que corresponda.
- **Texto de interfaz:** en español (principio 12).
- La web **no tiene tests** (`calidad-y-pruebas.md`); se verifica con `tsc --noEmit` y `vite build`.
