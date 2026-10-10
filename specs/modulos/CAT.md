---
estado: vigente
verificado: 2026-10-10 @ 1edb809
fuentes: [apps/api/src/routes/products.ts, apps/api/src/lib/categoryOrder.ts, apps/api/src/routes/public.ts, apps/api/src/lib/matchProduct.ts, apps/web/src/components/config/ProductsSection.tsx, apps/web/src/lib/productExcel.ts, apps/web/src/lib/catalogImage.ts, apps/web/src/lib/categoryOrder.ts, apps/web/src/components/chat/EnviarCatalogoMenu.tsx, apps/web/src/hooks/useProducts.ts, apps/api/test/products-bulk-price.test.ts]
---

# CAT — Catálogo de productos

> La lista de productos del negocio (nombre, categoría, unidad, precio de referencia, si hay existencia): el administrador la mantiene en Configuración, el personal la usa para armar pedidos y para enviar el catálogo a un cliente por el chat.

## 1. Negocio

**Propósito.** Tener una sola lista de lo que se vende, con su precio de referencia y si hoy hay existencias, para (a) que el personal busque productos al armar un pedido, (b) que el cliente final los elija en el formulario y (c) mandarle por WhatsApp un catálogo con precios sin armarlo a mano. El precio del catálogo es solo una **referencia**: el precio real de cada línea de pedido lo escribe siempre el personal.

**Alcance y límites.**

| Dentro | Fuera |
|---|---|
| Lista de productos por negocio: nombre, categoría, unidad, precio de referencia, existencia, activo/desactivado. | Cualquier precio de línea de pedido: lo escribe siempre el personal (principio 3; ORD, CAJ). |
| Carga y descarga de precios por Excel. | Crear o editar productos por Excel (solo se actualizan precios de ids existentes). |
| Catálogo al cliente por el chat: una imagen por categoría o un producto por texto. | Fotos de productos, inventario con cantidades, precios por cliente o por volumen. |
| Lectura de productos activos para el formulario público. | Mostrar precio o existencia al cliente dentro del formulario (RN-CAT-15). |
| Aviso en vivo `product:changed`. | Historial de cambios de precio: no se guarda (PREG-068). |

**Dependencias.**

| Módulo | Relación |
|---|---|
| FRM | Lee `GET /public/products` (RN-CAT-15); los ítems del cliente nacen en $0. |
| ORD | Busca productos al armar un pedido a mano; no copia el precio (RN-CAT-08). |
| IA | `matchProduct.ts` resuelve nombres contra el catálogo; los precios quedan en 0. |
| INB / WPP | El envío del catálogo usa el chat (`send-image`, `reply`); respeta el día pasado o cerrado. |
| ACC | Define las pestañas de Configuración y el rol que escribe (RN-CAT-03). |

**Permisos.** Filas "Leer productos, empleados, plantillas de mensajes" (todos los roles) y "Productos y catálogo (crear, editar, precios, Excel)" (admin y dev) de `01-funcional/actores-y-permisos.md`. Lo que esa tabla no dice:
- Enviar el catálogo (imagen o un producto) lo puede cualquier rol con acceso al chat: usa `POST /inbox/:ticketId/send-image` y `/reply`, que solo piden sesión. El botón se deshabilita en días pasados.
- La **interfaz coincide con la API**: Configuración > Productos solo existe para admin/dev (ver `ACC` para las pestañas).

**Estados.** Un producto tiene dos interruptores independientes: `active` ("borrado suave": desaparece de todo) e `in_stock` ("hoy no hay": sigue en la lista pero se anuncia "NO HAY"). No hay máquina de estados más allá de eso.

**Reglas.**

*Lista y permisos*

- **RN-CAT-01 — Lectura para todos, solo activos.** `GET /products` responde a cualquier rol con sesión y devuelve únicamente productos `active` de la organización del token. *(plataforma, código)* *(sin test)*
- **RN-CAT-02 — Orden de categorías.** Siempre la lista sale con las categorías en este orden: Frutas, Verduras, Otros, y después cualquier otra categoría por orden alfabético; dentro de cada categoría, por `sort_order` y luego nombre. Los productos sin categoría quedan al inicio del grupo de "otras" (la API los ordena con categoría vacía) y la web los muestra como "Sin categoría". El orden está copiado en la API y en la web. *(plataforma, código)* *(sin test)*
- **RN-CAT-03 — Escribir es solo admin (dev pasa).** Crear, editar, borrar y cargar precios en lote responden 403 `FORBIDDEN` a encargado y domiciliario. *(plataforma, código)*
- **RN-CAT-04 — Borrado suave.** CUANDO se borra un producto, el sistema DEBE marcarlo `active = false` (no se elimina la fila); desaparece de la lista, del formulario del cliente y de la búsqueda de pedidos. Un id inexistente o de otra organización da 404 `NOT_FOUND`. La interfaz lo llama "Desactivar" y no ofrece reactivar (PREG-069). *(plataforma, código)* *(sin test)*
- **RN-CAT-05 — Existencia ≠ activo.** Siempre `in_stock` es independiente de `active`: un producto sin existencia sigue en la lista del personal y en el formulario del cliente. Solo cambia lo que el catálogo de WhatsApp anuncia (RN-CAT-13). Por defecto es `true`. *(plataforma, código)*
- **RN-CAT-06 — Interruptor de existencia inmediato.** CUANDO el administrador mueve el interruptor "Stock" de un producto existente, la web DEBE guardar de inmediato (`PATCH` con solo `in_stock`), sin pulsar "Guardar" ni cerrar la edición. En un producto nuevo el interruptor sí viaja con el formulario. *(plataforma, código)* *(sin test)*
- **RN-CAT-07 — Aviso en vivo.** CUANDO se crea, edita o borra un producto, el sistema DEBE emitir `product:changed` a toda la organización (`{ id }`); en la carga en lote emite un solo evento `{ bulk: true }`. Las sesiones abiertas invalidan su caché de productos (`useProducts`, vigencia normal 5 min). El formulario público del cliente no escucha: lo lee una vez al abrirse. *(plataforma, código)* *(sin test)*

*Precio y unidad*

- **RN-CAT-08 — Precio de referencia, nunca el de una línea.** Siempre `price_per_unit` es solo informativo: ninguna ruta de pedidos lo lee. Los ítems nacen en $0 tanto desde el formulario del cliente (`public.ts › POST /submit`, decisión explícita del negocio) como desde "Tomar lista" (`matchProduct.ts` solo resuelve nombres; commit d64551b, 2026-09-09) y el pedido manual (`ProductSearch.tsx` recibe el precio en su tipo pero no lo usa). Quien lo escribe es el personal, siempre. **Pero el cliente sí lo ve** si el personal le envía el catálogo (RN-CAT-13, RN-CAT-14), así que un precio desactualizado llega al cliente aunque no afecte ningún total. *(plataforma, código; José por el commit)* *(sin test)*
- **RN-CAT-09 — Precio vacío = no cambiar.** CUANDO el administrador guarda el formulario de un producto con el precio en blanco, la web DEBE omitir el campo: el precio guardado no cambia (nunca se borra ni se pone en 0 desde el formulario). Un `0` explícito sí es un precio válido (agotado). La interfaz solo acepta ≥ 0 (un valor negativo o no numérico se omite). *(plataforma, código)* *(sin test)*
- **RN-CAT-10 — Carga de precios en lote.** CUANDO llega `PATCH /products/bulk-price`, el sistema DEBE aceptar entre 1 y 500 filas `{ id (uuid), price_per_unit ≥ 0 }`, aplicarlas **todas en una sola transacción** (un fallo a medias no deja nada aplicado) y responder `{ updated, notFound }`. Una fila cuyo id no existe o es de otra organización no falla el lote: queda en `notFound`. Nunca crea productos ni toca otros campos. Más de 500 filas, cero filas o un precio negativo: 400 `VALIDATION_ERROR`. *(plataforma, código)*
- **RN-CAT-11 — Tipo de unidad informativo.** `unit_type` es texto libre (hasta 20 caracteres en la base). El formulario ofrece kg, unidad, libra, bulto, caja, canasta y manojo y por defecto `kg`. Solo se usa para mostrar: en el formulario del cliente bajo el nombre, en el catálogo (`$precio/unidad`) y en el Excel. No interviene en cantidades ni precios de pedidos. *(plataforma, código)*

*Excel*

- **RN-CAT-12 — Ida y vuelta del Excel solo para precios.** CUANDO el administrador descarga el Excel, la web DEBE generar `Catalogo_precios_<AAAA-MM-DD>.xlsx` con hoja "Precios" y columnas ID, Nombre, Categoría, Unidad (vacía = `kg`) y Precio, con los productos activos. CUANDO sube un Excel, solo se leen **ID y Precio** de la primera hoja; Nombre, Categoría y Unidad son de referencia y se ignoran. Se descarta (cuenta como "ignorada") cada fila con ID vacío o que no sea un uuid, ID repetido (vale la primera), Precio vacío, no numérico o negativo. Si no queda ninguna fila válida no se llama a la API; si hay ignoradas, se avisa cuántas. Un Precio `0` es válido. Otras filas del archivo (productos nuevos, ids ajenos) nunca crean nada; los ids ajenos terminan en `notFound` (el aviso final lo informa). *(plataforma, código)* *(sin test)*

*Catálogo por WhatsApp*

- **RN-CAT-13 — Imagen por categoría.** CUANDO el personal elige "Catálogo completo", la web DEBE dibujar y enviar **una imagen PNG por categoría** (en el orden de RN-CAT-02), una tras otra, con el nombre de la categoría como pie de foto; "Catálogo completo" no arma una sola imagen porque salía demasiado alta y la letra ilegible. También puede enviar una sola categoría. La imagen se dibuja en el navegador (no hay fotos de productos, decisión del usuario), mide 800 px de ancho, dos columnas, encabezado con el nombre del negocio y "Precios actualizados al <fecha de hoy del navegador>". Cada producto muestra `$precio/unidad` (unidad por defecto `kg`) o **"NO HAY"** en rojo si `in_stock` es falso, o **"Consultar"** si no tiene precio. Un precio `0` se muestra como `$0/kg`. Si el envío falla a mitad, las categorías ya enviadas no se retiran. *(plataforma, código)* *(sin test)*
- **RN-CAT-14 — Un solo producto, por texto.** CUANDO el personal elige "Un producto…", busca por nombre (sin tildes ni mayúsculas, máximo 8 resultados) y la web DEBE enviar un mensaje de texto `Nombre: $precio/unidad`, `Nombre: NO HAY` (sin existencia) o `Nombre: Consultar/unidad` (sin precio). Usa la lista que ya tiene cargada el navegador. *(plataforma, código)* *(sin test)*
- **RN-CAT-15 — El formulario del cliente no recibe precio ni existencia.** Siempre `GET /public/products` entrega solo id, nombre, categoría, unidad y orden de los productos activos. Un producto con `in_stock = false` sigue seleccionable por el cliente y su línea nace en $0 como todas (PREG-052). *(plataforma, código)* *(sin test)*

**Criterios de aceptación.**

| # | Escenario | Reglas | Test |
|---|---|---|---|
| 1 | Dado un administrador y un catálogo con ids propios y ajenos, cuando carga precios en lote, entonces se actualizan solo los ids propios en una transacción y los ajenos o inexistentes salen en `notFound`. | RN-CAT-10 | `products-bulk-price.test.ts › "updates price_per_unit for every id belonging to this org, ignores an id from another org and a nonexistent id, and reports both as notFound"` |
| 2 | Dado un encargado, cuando intenta cargar precios en lote, entonces recibe 403 y nada cambia. | RN-CAT-03 | `products-bulk-price.test.ts › "rejects a non-admin role (encargado)"` |
| 3 | Dado un lote con un precio negativo o sin filas, cuando se envía, entonces responde 400 `VALIDATION_ERROR` y no toca la base. | RN-CAT-10 | `products-bulk-price.test.ts › "rejects an update with a negative price (schema validation, never reaches the DB)"`; `› "rejects an empty updates array"` |
| 4 | Dado un producto desactivado, cuando cualquier rol pide la lista, entonces no aparece (ni en el formulario del cliente). | RN-CAT-01, 04, 15 | (sin test) |
| 5 | Dado un producto sin existencia (`in_stock = false`), cuando el personal envía el catálogo, entonces se anuncia "NO HAY", pero sigue en la lista y en el formulario. | RN-CAT-05, 13 | (sin test) |
| 6 | Dado un producto con precio de referencia, cuando el cliente arma su pedido por el formulario o el personal usa Tomar lista, entonces la línea nace en $0. | RN-CAT-08 | (sin test) |
| 7 | Dado el formulario de edición con el precio en blanco, cuando el administrador guarda, entonces el precio guardado no cambia. | RN-CAT-09 | (sin test) |
| 8 | Dado un Excel con filas sin id uuid, ids repetidos o precios vacíos o negativos, cuando se sube, entonces esas filas se ignoran, se avisa cuántas y no se crea ningún producto. | RN-CAT-12 | (sin test) |
| 9 | Dadas varias categorías, cuando se pide "Catálogo completo", entonces se envía una imagen por categoría en el orden Frutas, Verduras, Otros y luego alfabético. | RN-CAT-02, 13 | (sin test) |

**Textos que ve el cliente final.** La imagen del catálogo y el texto de un producto (RN-CAT-13, RN-CAT-14): nombre del negocio, categoría, productos, precio/unidad, "NO HAY" o "Consultar". El formulario muestra nombre, categoría y unidad. Nada más.

## 2. Técnico

**Mapa de código.**

| Parte | Dónde |
|---|---|
| API | `apps/api/src/routes/products.ts › GET /`, `› POST /`, `› PATCH /bulk-price`, `› PATCH /:id`, `› DELETE /:id`; `apps/api/src/lib/categoryOrder.ts › sortByCategoryOrder` |
| API cliente | `apps/api/src/routes/public.ts › GET /products` |
| Web admin | `apps/web/src/components/config/ProductsSection.tsx › ProductsSection`, `› StockToggle`, `› handleSubmit`, `› handleExcelUpload` |
| Excel | `apps/web/src/lib/productExcel.ts › downloadProductsExcel`, `› parseProductsExcelFile` |
| Catálogo | `apps/web/src/lib/catalogImage.ts › generateCatalogCanvas`, `› canvasToBase64Png`; `apps/web/src/components/chat/EnviarCatalogoMenu.tsx › EnviarCatalogoMenu` (montado en `TicketModal`, `NuevoPedidoModal`, `DetallePedidoModal`) |
| Orden / caché | `apps/web/src/lib/categoryOrder.ts › sortCategoryEntries`; `apps/web/src/hooks/useProducts.ts › useProducts` |
| Datos | `Product` (`active`, `in_stock`, `sort_order`, `price_per_unit` decimal(12,2), `unit_type`) |

**Regla → se hace cumplir en → test.**

| Regla | Se hace cumplir en | Test |
|---|---|---|
| RN-CAT-01, 02 | `products.ts › GET /`, `categoryOrder.ts` | *(sin test)* |
| RN-CAT-03 | `products.ts` (`requireRole('admin')`) | `apps/api/test/products-bulk-price.test.ts › "rejects a non-admin role (encargado)"` (solo la carga en lote) |
| RN-CAT-04 | `products.ts › DELETE /:id` | *(sin test)* |
| RN-CAT-05, 06 | `products.ts › productSchema`; `ProductsSection.tsx › toggleStock` | *(sin test)* |
| RN-CAT-07 | `products.ts` (`fastify.io.to(...).emit`); `useProducts.ts` | *(sin test)* |
| RN-CAT-08 | `public.ts › POST /submit`; `matchProduct.ts`; ninguna ruta de `orders.ts` lo lee | *(sin test)* |
| RN-CAT-09 | `ProductsSection.tsx › handleSubmit` | *(sin test)* |
| RN-CAT-10 | `products.ts › PATCH /bulk-price` | `products-bulk-price.test.ts › "updates price_per_unit for every id belonging to this org, ignores an id from another org and a nonexistent id, and reports both as notFound"`; `› "rejects an update with a negative price (schema validation, never reaches the DB)"`; `› "rejects an empty updates array"` (tope de 500 y atomicidad, *sin test*) |
| RN-CAT-11 | `products.ts › productSchema`; `ProductsSection.tsx` | *(sin test)* |
| RN-CAT-12 | `productExcel.ts` | *(sin test)* |
| RN-CAT-13, 14 | `catalogImage.ts`, `EnviarCatalogoMenu.tsx` | *(sin test)* |
| RN-CAT-15 | `public.ts › GET /products` | *(sin test)* |

**Datos y eventos socket.** Emite `product:changed`. Las altas y ediciones individuales no tienen tope de longitud salvo `name` (1–200).

**Transacciones y concurrencia.** Solo la carga en lote es transaccional (un `updateMany` por fila dentro de `$transaction`). Dos administradores editando el mismo producto: gana el último (sin versionado).

**Códigos de error propios.** Solo los genéricos: `VALIDATION_ERROR` (400), `NOT_FOUND` (404, en `PATCH /:id` y `DELETE /:id`), `FORBIDDEN` (403).

**Si tocas X, revisa Y.**
- **Orden de categorías:** `categoryOrder.ts` existe en API y en web (copias; `packages/shared` solo lleva tipos); `public.ts` también lo usa. Cambiar `['Frutas','Verduras','Otros']` exige tocar las dos.
- **Un campo nuevo del producto:** `productSchema` (API), `ProductForm` (`ProductsSection.tsx`), `CatalogProduct` (`catalogImage.ts`), el `select` de `public.ts › GET /products` y las columnas del Excel.
- **El Excel** lee columnas por nombre exacto (`ID`, `Precio`, con variantes `id`/`precio`/`PRECIO`): renombrar una en la exportación rompe la carga.
- **El tope de 500** vive en la API; la web no parte archivos grandes.
- **Cualquier ruta que lea `price_per_unit` para armar una línea** rompe el invariante RN-CAT-08 y la decisión del negocio (precio siempre manual).

## 3. Pendientes

IDs globales; resumen en `03-plan/preguntas-abiertas.md` y `03-plan/problemas-conocidos.md`.

- **PREG-068 — Un precio de referencia desactualizado llega al cliente.** El catálogo envía `price_per_unit` tal cual y dice "Precios actualizados al <hoy>" aunque nadie lo haya revisado hoy. ¿Debe la fecha mostrar la última edición real, o basta con la disciplina del personal?
- **PREG-069 — No hay forma de reactivar un producto desactivado** ni de verlo (la lista solo trae activos). Crear otro con el mismo nombre es posible (no hay unicidad por nombre). ¿Se necesita reactivar, o duplicar es lo esperado?
- **PREG-052 — `in_stock` no llega al formulario del cliente.** Un producto agotado sigue seleccionable por el cliente. ¿Debe marcarse "agotado" o esconderse en el formulario? Hoy el aviso de "NO HAY" solo llega por el catálogo de WhatsApp.
- **PREG-070 — Precio negativo por la API.** `POST` y `PATCH /products/:id` aceptan `price_per_unit` negativo (el lote y la interfaz no). Y `name` repetido no se valida.
- **PREG-071 — Carga de Excel con separadores colombianos.** El Precio se lee con `parseFloat`: `"12.500"` (texto con punto de miles) se interpreta como `12.5` y `"1,5"` como `1`; solo una celda numérica real es exacta. ¿Se acepta?
- **PREG-072 — Nombre del Excel con fecha en UTC.** `Catalogo_precios_<fecha>` usa `toISOString()`: entre las 19:00 y las 23:59 de Bogotá la fecha del nombre es la del día siguiente.
- **PREG-073 — Más de 500 productos.** La descarga incluye todos los activos, pero la carga rechaza (400) un archivo con más de 500 filas válidas sin avisar cómo partirlo. Hoy no es un problema de tamaño real; ¿se parte en la web?
- **DT-027 — Falta cobertura de tests** de lectura (`GET`, orden, solo activos), `POST`/`PATCH`/`DELETE`, aislamiento por organización en cada ruta, el tope de 500 y la atomicidad del lote, y el evento `product:changed`. Tampoco hay test de `productExcel.ts` ni de `catalogImage.ts`.
- **DT-028 — `categoryOrder.ts` duplicado** (API y web), más una tercera aplicación implícita en `ProductsSection.tsx` (`sortCategoryEntries`).
- **DT-029 — Tipo de unidad sin catálogo cerrado:** `unit_type` es texto libre en la API y la lista de 7 opciones vive solo en `ProductsSection.tsx`.

Decisiones relacionadas: la decisión de no autoasignar el precio de catálogo en pedidos (commit d64551b y comentario de `public.ts › POST /submit`); D-02 de `05-historia/decisiones.md` y principio 3 de `00-principios.md` (el precio de una línea es del pedido, no del catálogo). Relacionadas: FRM (formulario), ORD (pedido a mano), IA (Tomar lista), INB (envío por el chat), ACC (pestañas y roles).
