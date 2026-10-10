---
estado: vigente
verificado: 2026-10-10 @ 1edb809
fuentes: [specs/modulos/WPP.md, specs/modulos/INB.md, specs/modulos/FRM.md, specs/modulos/IA.md, specs/modulos/ORD.md, specs/modulos/CAJ.md, specs/modulos/DSH.md, specs/modulos/FAC.md, specs/modulos/ACC.md, specs/01-funcional/ciclo-diario.md, specs/01-funcional/pantallas-por-rol.md, apps/api/test/*.test.ts, apps/web/src/components/modals/*.tsx, apps/web/src/pages/*.tsx]
---

# Escenarios de aceptación de punta a punta

> **Resumen.** Veinticinco escenarios `ES-01` a `ES-25` en forma Dado / Cuando / Entonces que cruzan varios módulos y que una persona puede ejecutar en el entorno `dev` para aceptar el sistema: de la llegada de un cliente por WhatsApp al informe, pasando por formulario, Tomar lista, cobros, cierre de caja, factura, permisos y fallas de Meta. Cada uno indica los módulos y reglas (`RN-…`) que ejercita, el resultado observable exacto y el test automatizado real que cubre todo o parte (o *(sin test)*). Al final, una tabla de trazabilidad por módulo y la lista de escenarios sin test, que son los candidatos a nuevas pruebas. No define reglas: cada afirmación es la de su módulo dueño, y si alguna difiere gana el módulo.

## Cómo ejecutarlos

- **Entorno:** `dev` (`dev.4client.pages.dev`, `dev-api.4client.shop`), con datos de prueba y la **fecha real de hoy** (no una futura inventada). Teléfonos ficticios del estilo `+57 300 000 0001`.
- **Roles de prueba:** un admin, un encargado, un domiciliario y un `dev`; un segundo navegador para el "otro" usuario.
- **WhatsApp:** los escenarios que dependen de Meta (ES-01 a ES-04, ES-17, ES-24, ES-25) necesitan un número de prueba conectado a `dev`. El "ticket de prueba" de DevTools crea chats ficticios pero **no envía** nada por WhatsApp.
- **Hora:** los escenarios de 9:30 p. m. se ejecutan de verdad después de las 21:00 (Bogotá) o con el test automatizado, que congela la hora.
- **Montos de ejemplo:** pedido de $38.000 = $20.000 + $18.000 (el precio es el total de cada línea).

---

## A. Llegada del cliente y día de negocio

### ES-01 — Cliente nuevo a las 9:30 p. m.
- **Módulos / reglas:** WPP, INB · RN-WPP-06, 09, 10, 12, 14, 15; RN-INB-23, 24.
- **Dado** un teléfono sin ticket y un negocio con mensaje de bienvenida y credenciales de Meta, **cuando** escribe su primer mensaje a las 21:30 de Bogotá, **entonces** (1) se crea un ticket con 1 no leído; (2) su `Ticket.fecha` es **mañana**; (3) el cliente recibe **un solo** mensaje: la bienvenida con el aviso de privacidad al final (en cursiva, con el enlace a la política), **sin link de formulario**; (4) el ticket aparece en el tablero de mañana y no en el de hoy (mientras no tenga pedido de hoy); (5) a las 20:59:59 la fecha habría sido hoy.
- **Tests:** `webhook.test.ts › "un ticket NUEVO que arranca a las 10 p.m. sí se corre al día siguiente"`; `› "20:59:59 cae en el mismo día; 21:00:00 y 23:59:59 caen en el día siguiente"`; `› "first message of the day sends ONLY welcome+notice combined into one message - the form link is never auto-sent anymore, …"`. El tablero (punto 4): *(sin test)*.

### ES-02 — Cliente recurrente: primer mensaje del día después de las 21:00
- **Módulos / reglas:** WPP · RN-WPP-06, 09, 10, 14.
- **Dado** un ticket de hace semanas que ya recibió el aviso de privacidad, **cuando** escribe por primera vez en el día real a las 21:10, **entonces** el ticket es el mismo (nunca se crea otro), `fecha` pasa a mañana, recibe la bienvenida **sin repetir el aviso** y `first_message_today_at` queda en el día real de hoy.
- **Tests:** `webhook.test.ts › "un ticket viejo cuyo primer mensaje de hoy llega a las 9 p.m. sí se corre al día siguiente"`; `› "a SECOND message from the same ticket (even on a later day, isFirstMessageToday again) does NOT repeat the privacy notice …"`.

### ES-03 — Mensaje de noche de un chat que ya escribió hoy
- **Módulos / reglas:** WPP · RN-WPP-08, 09, 10.
- **Dado** un ticket que escribió a las 10:00 a. m., **cuando** escribe de nuevo a las 22:00, **entonces** suma 1 no leído, **no** recibe bienvenida (no es el primer mensaje del día) y su `fecha` **no** se corre a mañana: el corte de las 21:00 solo afecta al primer mensaje del día. Si además tenía un pedido de hoy, ese pedido conserva la fecha de hoy (el pedido nunca usa el corte, RN-WPP-11; ver PREG-025 y PREG-026).
- **Test:** `webhook.test.ts › "un ticket que ya existe hoy (escribió a las 10 a.m.) y recibe un mensaje a las 10 p.m. NO se corre a mañana - solo un ticket NUEVO se corre"`.

---

## B. Del chat al pedido

### ES-04 — Personal envía el formulario y el cliente pide con consentimiento
- **Módulos / reglas:** INB, WPP, FRM, ORD · RN-WPP-26; RN-INB-18; RN-FRM-01, 08, 10, 11, 19, 21, 22, 26, 28; RN-ORD-05.
- **Dado** un ticket de hoy, **cuando** el encargado toca "Formulario", **entonces** aparece el aviso "Formulario enviado" y el chat muestra tres mensajes salientes en orden: aviso previo, link `/form?t=<40 hexadecimales>` y seguimiento.
  **Cuando** el cliente abre el link, **entonces** ve primero "Antes de continuar" con la casilla de la política y, solo al marcarla, el formulario; agrega productos (cantidad y unidad), escribe la dirección, elige "Transferencia" y toca "Enviar pedido", **entonces** (1) ve "¡Pedido enviado!"; (2) en el tablero aparece un pedido `nuevo` con la etiqueta "Formulario", método Transferencia y **todas las líneas en $0** (aunque el catálogo tenga precio de referencia); (3) el cliente recibe por WhatsApp "Pedido #001 recibido desde el formulario" con sus productos; (4) el pedido queda a nombre (`registered_by`) del encargado que envió el link.
  **Cuando** el encargado abre el pedido y escribe los precios, **entonces** el total del pedido es la suma de los precios de las líneas y no hay ningún total guardado (principio 3).
- **Tests:** `public.test.ts › "POST /submit with no merge_order_id creates a new order (address required, payment optional), items not flagged as client-added"`; `› "POST /submit with consent:true stamps Order.consent_confirmed_at on THAT order, …"`; `› "an order created through a real /form-link token is attributed to (registered_by) the staff member who sent it, …"`; `› "the \"pedido recibido\" confirmation sent to the client stores the real Meta message id, …"`. Los tres mensajes del botón y la pantalla de consentimiento: *(sin test)*.

### ES-05 — El cliente edita su pedido por el formulario (fusión)
- **Módulos / reglas:** FRM, ORD, FAC · RN-FRM-13, 14, 15, 16, 29; RN-ORD-15.
- **Dado** el pedido de ES-04 en `nuevo` con dos líneas, la primera ya con precio, **cuando** el cliente vuelve a abrir el mismo link (aún vivo), acepta de nuevo la política, ve "Editando tu pedido #001", cambia la cantidad de la primera línea, quita la segunda y agrega una tercera, y envía, **entonces** (1) la lista enviada **reemplaza** a la anterior; (2) la línea que se conserva **mantiene su precio**; la nueva entra en $0; (3) las líneas nuevas o cambiadas quedan marcadas "del cliente"; (4) el pedido queda con la campana roja "el cliente lo tocó", que **no desaparece** cuando el personal guarda; (5) el historial dice "Vía formulario del cliente"; (6) las facturas enviadas de ese pedido quedan revocadas; (7) el cliente recibe "Tu pedido #001 fue actualizado". Si reenvía exactamente lo mismo, responde `unchanged` y no marca nada. Si entre tanto el personal lo pasó a "En camino", el envío da 409 y **no** se crea un duplicado.
- **Tests:** `public.test.ts › "POST /submit with merge_order_id replaces the order's items with the full submitted list (not append-only), …"`; `› "a client resubmit NEVER overwrites an existing item's price with the catalog price, …"`; `› "resubmitting the exact same items/address/payment is a no-op - …"`; `› "POST /submit with a merge_order_id whose order became \"camino\" … is rejected with 409 - NOT silently duplicated …"`; `› "staff saving the order does NOT clear client_modified - …"`. Revocar facturas al editar: `files.test.ts › "editing an order (PATCH /orders/:id) invalidates its own outstanding factura - …"`. La campana en pantalla: *(sin test)*.

### ES-06 — Un link nuevo mata al anterior y "Bloquear Link" mata al vigente
- **Módulos / reglas:** INB, FRM, FAC · RN-INB-18, 19; RN-FRM-01.
- **Dado** un cliente con el link A abierto, **cuando** el personal toca "Formulario" otra vez (link B), **entonces** A responde 401 "Link inválido o expirado" y B funciona. **Cuando** el personal toca "Bloquear Link" y confirma ("Link bloqueado - el cliente ya no puede usarlo"), **entonces** B responde lo mismo que A (el mensaje no dice cuál fue la causa) y las facturas de ese chat quedan revocadas. **Cuando** envía un link nuevo, **entonces** vuelve a funcionar.
- **Tests:** `public.test.ts › "sending a fresh form-link automatically supersedes (kills) every earlier still-unexpired link for the same ticket, …"`; `› "after revoking, the previously-issued token is rejected on every public endpoint (fails closed)"`; `› "generating a fresh form-link clears the earlier revocation, so the new link works"`; `files.test.ts › ""Bloquear link" on a ticket also kills any factura already sent to that same conversation"`.

### ES-07 — El link del formulario vence a las 24 horas
- **Módulos / reglas:** FRM · RN-FRM-01, 02.
- **Dado** un link emitido hace más de 24 h (se haya abierto o no), **cuando** el cliente lo abre o envía, **entonces** ve "Link inválido" con el mismo texto genérico que un link revocado (401 `INVALID_TOKEN`). Un link de 23 h sigue vivo aunque nunca se hubiera abierto: no hay regla de "4 horas sin abrir".
- **Tests:** `public.test.ts › "a link dies past the flat 24h cap, whether or not it was ever opened"`; `› "a link survives past 4 hours whether or not it was ever opened - flat 24h cap either way"`.

### ES-08 — "Bloquear todos los links" desde el Informe
- **Módulos / reglas:** DSH, INB, FRM, FAC · RN-DSH-15; RN-INB-20; RN-FRM-01; RN-FAC-10.
- **Dado** tres clientes con links y una factura enviada, **cuando** el admin pulsa "Bloquear todos los links" en el Informe y confirma, **entonces** los tres links y la factura responden como muertos; un link emitido **después** funciona (no es un apagado permanente). El encargado no tiene el botón y la API le responde 403.
- **Tests:** `public.test.ts › "blocks every outstanding link across every ticket in the org at once, and a link issued afterward still works"`; `› "requires admin - encargado forbidden, no auth rejected"`; `files.test.ts › "the org-wide "Bloquear todos los links" also kills every outstanding factura, and a fresh one issued afterward still works"`.

### ES-09 — Tomar lista: la IA propone, el personal decide
- **Módulos / reglas:** IA, INB, ORD · RN-IA-01, 02, 05, 06, 08, 11, 12, 13, 14; RN-ORD-05, 34.
- **Dado** un chat con tres mensajes de texto del cliente ("2 kg de tomate, cilantro…") y un catálogo con Tomate pero sin cilantro, **cuando** el encargado toca "Tomar lista", selecciona los mensajes y toca "Montar lista", **entonces** (1) no se guarda nada; (2) como hay un producto no identificado, aparece "Estos productos no pude identificarlos: cilantro. Recuerda revisar todo."; (3) al elegir "Crear nuevo pedido" y "Continuar" se abre "Nuevo pedido" **prellenado** con Tomate (nombre del catálogo) y cilantro (marcado para revisar), **ambos en $0**; (4) el encargado escribe los precios y crea el pedido. Si selecciona un mensaje saliente o con multimedia, la API responde 400 `INVALID_MESSAGES` y no llama a la IA. Un domiciliario no ve el botón y la API le da 403. En un día pasado o con caja cerrada el botón está deshabilitado.
- **Tests:** `inbox-parse-messages.test.ts › "happy path: matched item is resolved to the catalog NAME but never priced from it, unmatched item is flagged for review, never touches the DB"`; `› "role gate: admin and encargado allowed, domiciliario forbidden"`; `› "rejects if any selected message is media"`; `› "rejects if any selected message is outbound (staff reply)"`. Las ventanas y el prellenado: *(sin test)*.

---

## C. Cobro y crédito

### ES-10 — Cobro en efectivo o transferencia, con contraseña y una sola vez
- **Módulos / reglas:** CAJ, ORD · RN-CAJ-02, 03, 04, 07, 08.
- **Dado** un pedido de $38.000 completo (nombre, teléfono, dirección real, método Pagado en tienda, domiciliario y productos), **cuando** el encargado avanza la tarjeta a "Cerrado", **entonces** se abre "Confirmar pago" mostrando como receptor al propio usuario; con la contraseña errónea responde 403 `INVALID_PASSWORD` y el pedido no cambia; con la correcta queda `cerrado`, bloqueado y pagado, y el detalle muestra "Pedido cerrado y cobrado" con "Cerrado por" y la hora; un segundo cobro responde 409 `ORDER_LOCKED`. Si falta el domiciliario, el diálogo lista "Falta completar antes de cerrar: domiciliario" y el botón no se habilita. El mismo flujo vale para transferencia.
- **Tests:** `orders.test.ts › "POST /orders/:id/cobro with wrong password -> 403 INVALID_PASSWORD, order not marked paid"`; `› "POST /orders/:id/cobro with correct password -> 200, paid+locked; second cobro -> 409 ORDER_LOCKED"`; `› "POST /orders/:id/cobro rejects an amount_received below the total - …"`. La lista de faltantes en pantalla y el 400 `MISSING_FIELDS` de campos distintos del monto: *(sin test)*.

### ES-11 — Pago dividido entre efectivo y transferencia
- **Módulos / reglas:** CAJ · RN-CAJ-06, 19.
- **Dado** el pedido de $38.000, **cuando** en "Confirmar pago" se marca "¿Pago dividido…?" con $20.000 efectivo y $15.000 transferencia, **entonces** la pantalla dice "Deben sumar exactamente $38.000 - van $35.000" y el botón queda deshabilitado; con $18.000 de transferencia dice "Suman el total" y el cobro se acepta sin vuelta. En el cierre, $20.000 suman a la bolsa de efectivo y $18.000 a la de transferencia.
- **Tests:** `orders.test.ts › "accepts a split that sums exactly to the total - stores split_cash/split_transfer, no vuelto"`; `› "rejects a split that does not sum to the total"`; `› "rejects amount_received above the total when split is used (no vuelta allowed on a split)"`. El reparto en el cierre: *(sin test)*.

### ES-12 — Cobro en casa: completo y con vuelta
- **Módulos / reglas:** CAJ, ORD, FRM · RN-CAJ-04, 05; RN-ORD-14.
- **Dado** un pedido de $38.000 con método "Cobro en casa", **cuando** el cliente lo hizo por el formulario, **entonces** llega sin elegir completo ni vuelta (el cliente no lo decide) y no se puede cobrar: el diálogo exige "monto de pago en efectivo (completo o con vuelta)". **Cuando** el personal elige "Completo", el monto recibido queda igual al total y la vuelta en $0. **Cuando** elige "Necesita vuelta" con $50.000, la pantalla dice "Vuelta: $12.000" y, ya cobrado, el admin o encargado ve "Vuelto: $12.000" (el domiciliario no ve ese campo). Con un monto menor al total dice "Falta $… para cubrir el total"; "completo" distinto del total es rechazado.
- **Tests:** `orders.test.ts › "cobro-en-casa: POST /orders/:id/cobro is blocked until amount_received has been recorded, even with every other field filled"`; `› "cobro-en-casa: \"completo\" must equal the total exactly, not just be >= it"`; `› "cobro-en-casa: \"vuelta\" chosen with an amount that happens to equal the total still round-trips as \"vuelta\", …"`; `public.test.ts › "a client picking \"Cobro en casa\" on the public form never decides completo/vuelta themselves - …"`.

### ES-13 — Crédito: cerrado, saldado después y fuera de los totales (D-19)
- **Módulos / reglas:** CAJ, DSH · RN-CAJ-07, 09, 19; RN-DSH-06, 07, 11; D-19.
- **Dado** un pedido de $38.000 con método "Crédito", **cuando** el encargado lo cobra (con contraseña), **entonces** queda `cerrado` y bloqueado pero **no pagado**; el informe no lo marca en rojo como "cerrado sin cobro" y aparece en Crédito > No pagados. **Cuando** el encargado intenta marcarlo pagado, no ve el botón y la API responde 403. **Cuando** el admin pulsa "Marcar crédito pagado" y confirma, `paid` pasa a verdadero sin pedir contraseña y sin cambiar quién ni cuándo lo cerró; el pedido pasa a Crédito > Pagados. **En ningún momento** suma a "Recaudado efectivo", "Recaudado transferencia" ni al total del cierre (comportamiento intencional por ahora, decisión de José del 2026-10-09).
- **Tests:** `orders.test.ts › "POST /orders/:id/cobro on a crédito order closes it (cerrado+locked) through the SAME password+amount flow as everyone else, but leaves paid:false"`; `› "PATCH /orders/:id/credito-pagado does NOT overwrite paid_by/paid_at - …"`; `› "PATCH /orders/:id/credito-pagado rejects encargado - admin/dev only per business rule"`; `dashboard.test.ts › "an unpaid crédito order never shows up in either sinCobro list - …"`. Que el crédito saldado no entre en los totales y la pestaña Crédito: *(sin test; DT-003, DT-030)*.

---

## D. Cierre de caja

### ES-14 — Cierre con pedidos pospuestos que se renumeran
- **Módulos / reglas:** CAJ, ORD, DSH · RN-CAJ-12 a 20, 22; RN-ORD-31.
- **Dado** hoy los pedidos abiertos #013 y #024 y un chat sin pedido con mensajes sin leer, **cuando** el admin abre el Informe y pulsa "Cerrar caja", **entonces** el botón "Cerrar caja" del modal permanece deshabilitado hasta decidir cada pedido (Pasar a mañana o Cerrar sin cobro) y cada chat (Pasar a mañana o Marcar como atendido). Con #013 y #024 en "Pasar a mañana" y mañana vacío: (1) mañana los tiene como **#001 y #002**, en ese orden, con la etiqueta "Pospuesto" y su número viejo; (2) hoy quedan como fantasmas atenuados; (3) un pedido en "Cerrar sin cobro" queda `cerrado`, bloqueado y **sin pagar** (rojo en el Informe); (4) aparece "Caja cerrada correctamente. Ya no se puede modificar." con "Descargar CSV del cierre"; (5) otra sesión abierta se refresca sola. Si mañana ya tenía #001 a #003 (pedidos de la noche), los pospuestos siguen en #004 y #005. Cerrar una fecha que no es hoy da 400 `NOT_TODAY`; sin decisión, 400 `MISSING_DECISIONS`; cerrar otra vez, 409 `ALREADY_CLOSED`.
- **Tests:** `cierre.test.ts › "#13 and #24 both deferred the same cierre become #001 and #002 tomorrow, in that order - never keeping 13/24"`; `› "deferred orders continue AFTER whatever already exists on tomorrow (e.g. an overnight form order), not always starting at 1"`; `› "moving a pending order to \"manana\" moves its fecha to tomorrow and PRESERVES original notes with the pasado_manana marker appended (B3 fix)"`; `› "cierre without a decision for a pending order -> 400 MISSING_DECISIONS"`; `› "cierre on a date other than today -> 400 NOT_TODAY …"`; `› "closing an already-closed day again -> 409 ALREADY_CLOSED, …"`; `› "GET /cierre/status reflects whether the day has been closed, and \"forzar_cierre\" … closes the order WITHOUT marking it paid"`. Fantasma en pantalla, decisión `atendido`, totales y foto del cierre, evento en vivo: *(sin test)*.

### ES-15 — Después del cierre el día queda congelado y el formulario cae en mañana
- **Módulos / reglas:** CAJ, ORD, FRM · RN-CAJ-21, 25; RN-ORD-13, 29, 32; RN-FRM-18.
- **Dado** la caja de hoy cerrada (ES-14), **cuando** el admin intenta editar un pedido de hoy, **entonces** 409 `DAY_CLOSED` (el admin no lo evita); el tablero muestra "Día cerrado - vista de solo lectura" y ninguna tarjeta se mueve; el detalle dice "Este día ya fue cerrado - vista de solo lectura" y las observaciones siguen disponibles. **Cuando** un cliente con link vivo envía un pedido nuevo, **entonces** el pedido nace con la fecha de **mañana** y el ticket se mueve con él (aparece en el tablero de mañana, no en el de hoy).
- **Tests:** `orders.test.ts › "admin CANNOT edit a locked order once the whole day has been cerrado (caja cerrada) - DAY_CLOSED wins even for admin"`; `cierre.test.ts › "once a day is closed, EVERY order on it is frozen - even one that was never individually locked, purely because the day itself closed"`; `public.test.ts › "POST /submit rolls the new order forward to TOMORROW if today already has a DailyClose - never lands on an already-closed day"`; `orders.test.ts › "encargado (non-admin) CAN add an observation on a locked order -> 201, …"`. Los avisos de pantalla: *(sin test)*.

### ES-16 — Botones del chat deshabilitados con el día cerrado o pasado
- **Módulos / reglas:** WPP, INB, IA, CAT, ORD · RN-WPP-28; RN-INB-27; RN-ORD-33; RN-IA-14.
- **Dado** el ticket de un cliente en un día con la caja cerrada (o al mirar un día anterior), **cuando** cualquier rol abre el chat, **entonces** "Cuenta banco", "Formulario", "Bloquear Link", "Enviar catálogo" y "Tomar lista" aparecen deshabilitados, con el texto "…de un día anterior…". "Eliminar datos" (solo `dev`) sigue habilitado. La caja de respuesta sigue activa: es solo una ayuda visual y la API acepta enviar (PREG-030). Si alguien estaba seleccionando mensajes en Tomar lista cuando se cerró la caja, la interfaz sale del modo selección. Mientras las plantillas no han cargado, "Cuenta banco" y "Formulario" también están deshabilitados.
- **Test:** *(sin test; la web no tiene pruebas de estas ventanas)*.

---

## E. Factura y mensajes

### ES-17 — Factura enviada y revocada al editar el pedido
- **Módulos / reglas:** FAC, ORD · RN-FAC-03, 06, 09, 10, 12; RN-ORD-16.
- **Dado** un pedido en "Listo" con productos y chat, **cuando** el personal toca "Enviar factura", **entonces** el PDF se arma en el navegador, se sube y el cliente recibe por chat un texto con número, fecha, cliente, total y un link a `/factura?f=…`; al abrirlo, el navegador va al PDF. **Cuando** luego el personal edita y guarda el pedido, **entonces** el mismo link muestra "Link inválido" con "Este link de factura fue bloqueado. Pide que te reenvíen la factura." (410 `INVOICE_EXPIRED`); reenviar crea una factura nueva y la anterior del mismo pedido queda muerta, pero la de otro pedido del mismo cliente sigue viva. Con el pedido en "En camino", "Cerrado" o sin chat, "Enviar factura" no está disponible. Pasadas 24 h el link muere aunque se haya abierto a tiempo.
- **Tests:** `files.test.ts › "editing an order (PATCH /orders/:id) invalidates its own outstanding factura - …"`; `› "sending a fresh factura for the same ORDER auto-supersedes every earlier one for it, …"`; `› "resending a factura for one order does NOT touch a different order's still-accurate factura, …"`; `› "expires at 24h absolute, even if it was opened in time"`; `› "GET serves the PDF on the link alone - …"`. Las condiciones del botón: *(sin test)*.

### ES-18 — El admin edita una plantilla y otra sesión la usa de inmediato
- **Módulos / reglas:** WPP · RN-WPP-23, 24, 29.
- **Dado** un encargado con un ticket abierto (las plantillas ya en su caché de 5 minutos), **cuando** el admin cambia el texto de "Cuenta bancaria" en Configuración > Mensajes y guarda ("Guardar" solo se habilita con cambios y texto no vacío), **entonces** el encargado, **sin recargar**, toca "Cuenta banco" y el cliente recibe el texto **nuevo**. Un texto vacío o de más de 1000 caracteres es rechazado (400); el encargado no puede editar (403) pero sí leer; restaurar una clave vuelve al texto por defecto.
- **Tests:** `messageTemplates.test.ts › "el admin edita su texto y el cambio se ve en GET"`; `› "el encargado no puede editar"`; `› "null restaura el texto por defecto de esa clave"`; `› "rechaza un texto vacío o demasiado largo"`. El evento en vivo y la caché de la web: *(sin test)*.

---

## F. Acceso y permisos

### ES-19 — El admin no ve las cuentas `dev`
- **Módulos / reglas:** ACC · RN-ACC-04, 05.
- **Dado** una cuenta `dev` en la misma organización, **cuando** el admin abre Configuración > Usuarios, **entonces** esa cuenta no aparece; si intenta editarla por la API, 404 `NOT_FOUND` (como si no existiera). El formulario de crear usuario solo ofrece Encargado y Domiciliario.
- **Test:** *(sin test)*.

### ES-20 — Bloqueo de la cuenta por contraseñas erróneas
- **Módulos / reglas:** ACC · RN-ACC-11, 13.
- **Dado** una cuenta con 4 fallos, **cuando** falla un quinto intento y luego escribe la contraseña **correcta**, **entonces** la pantalla muestra siempre "Usuario o contraseña incorrectos" (no revela el bloqueo), la API responde 429 `ACCOUNT_LOCKED` también a la contraseña correcta, y el dueño recibe un correo. El bloqueo dura 5 minutos (10 fallos: 15 minutos; 15 o más: 1 hora) y un reseteo de contraseña del admin lo limpia. Un correo inexistente y una clave errónea dan el mismo 401.
- **Tests:** `auth.test.ts › "locks the account after 5 wrong passwords, notifies the owner by email, and rejects further attempts (even the RIGHT password) with 429 ACCOUNT_LOCKED"`; `› "rejects login with a nonexistent email using the SAME error code (timing-attack protection)"`. Los escalones de 15 minutos y 1 hora y el texto en pantalla: *(sin test)*.

### ES-21 — El encargado no ve "Chats WPP"
- **Módulos / reglas:** INB, ACC · RN-INB-01, 03; D-09.
- **Dado** un encargado con sesión, **cuando** mira el encabezado (y el menú hamburguesa en celular), **entonces** solo tiene "Tickets & Pedidos"; `GET /inbox` responde 403. Aun así, desde el ticket del tablero puede leer el chat, responder y reenviar un mensaje a cualquier chat de su organización (la lista de destinos sí le responde 200), y nunca ve chats de otra organización (PREG-040).
- **Tests:** `inbox.test.ts › "an encargado (not just admin) gets the real chat list, unlike GET /inbox which is admin-only"`; `› "never returns another organization's chats"`. La ausencia de la pestaña: *(sin test)*.

### ES-22 — El domiciliario es de solo lectura (con chat)
- **Módulos / reglas:** ACC, ORD, INB · RN-ORD-26, 32; RN-INB-27; PREG-012.
- **Dado** un domiciliario, **cuando** entra, **entonces** solo tiene "Tickets & Pedidos"; puede abrir el chat, responder y usar Cuenta banco, Formulario, Bloquear Link y catálogo, pero no ve "Tomar lista", "Papelera" ni el historial. Si intenta crear un pedido, la API responde 403 `FORBIDDEN`. Hoy la interfaz le **muestra** Guardar, Mover pedido, observaciones, flechas, arrastre y "Confirmar pago", y cada uno termina en 403 con un aviso de error (PREG-012).
- **Tests:** `orders.test.ts › "forbids creating an order as domiciliario -> 403"`; `inbox-parse-messages.test.ts › "role gate: admin and encargado allowed, domiciliario forbidden"`. Lo demás: *(sin test)*.

### ES-23 — `dev` borra los datos de un cliente (Ley 1581)
- **Módulos / reglas:** INB, ORD, FAC · RN-INB-22; D-17; principio 6.
- **Dado** un ticket con pedidos y chat, **cuando** un admin lo intenta, **entonces** no ve "Eliminar datos" y la API responde 403. **Cuando** un `dev` toca "Eliminar datos" y confirma, **entonces** aparece "Datos del cliente eliminados (N pedidos anonimizados)" y la ventana se cierra; los pedidos **no se borran** (número, productos y precios quedan) pero pasan a "Cliente eliminado", sin teléfono y con la dirección "[eliminado a solicitud del cliente]"; los mensajes del chat se borran; el ticket queda con teléfono `eliminado-<hex>`; los links de factura y de formulario mueren; queda una fila de auditoría. Quedan datos residuales en historial, observaciones y PDF (PREG-037).
- **Tests:** `inbox.test.ts › "rejects an admin (no dev) with 403 - solo el desarrollador puede eliminar datos"`; `› "rejects a non-dev (encargado) with 403"`; `› "anonimiza TODOS los pedidos del ticket (sea cual sea su estado) sin borrar ninguno, borra el chat, y anonimiza el ticket - …"`. El botón y el aviso: *(sin test)*.

---

## G. Multimedia y fallas de Meta

### ES-24 — Multimedia vencida (30 días)
- **Módulos / reglas:** WPP, INB · RN-WPP-19; RN-INB-16, 17, 31; D-04.
- **Dado** una imagen recibida hace más de 30 días (de la que solo se guardó el id de Meta), **cuando** el personal abre el chat, **entonces** la pantalla muestra "No se pudo cargar la imagen" (no distingue vencido de error de red) y la API de multimedia responde 404 `MEDIA_EXPIRED`. Si intenta reenviarla, el destino recibe una fila con `failed_reason` "ya no está disponible". Un `media_id` de otra organización da 404.
- **Tests:** `inbox.test.ts › "GET /media/:token returns a clear MEDIA_EXPIRED 404 when Meta no longer has the file …"`; `› "marks a forwarded PHOTO failed_reason immediately when the original has expired on Meta (>30 days) - …"`; `› "GET /media/:token refuses a real media_id that belongs to a DIFFERENT org, …"`. El texto en pantalla: *(sin test)*.

### ES-25 — Meta rechaza un mensaje saliente
- **Módulos / reglas:** INB, WPP · RN-INB-10; RN-WPP-16, 17, 21.
- **Dado** un chat fuera de la ventana de 24 h de Meta (o durante la falla de facturación de Meta), **cuando** el personal responde "Hola", **entonces** la API responde 201 de inmediato, el mensaje queda guardado con `failed_reason` y el chat muestra un círculo rojo con "No se pudo entregar: <motivo>" (la X roja); los no leídos ya se pusieron en 0 aunque no llegó (PREG-041). Con "Formulario", la interfaz dice "Formulario enviado" aunque Meta rechace los tres mensajes (PREG-029). Durante una falla de Meta las bienvenidas automáticas también quedan con X roja, sin alerta (PREG-024). Un recibo `read` tardío nunca retrocede un `delivered`.
- **Tests:** `inbox.test.ts › "POST /:ticketId/reply records failed_reason when Meta rejects the send (e.g. no active 24h session …"`; `webhook.test.ts › "a failed status records the reason without touching delivered/read_by_client"`; `› "delivered then read updates the matching message, never regresses, …"`. El envío automático fallido y el círculo rojo: *(sin test)*.

---

## Trazabilidad por módulo

| Módulo | Reglas ejercitadas | Escenarios |
|---|---|---|
| WPP | RN-WPP-06, 08 a 15 | ES-01, 02, 03 |
| WPP | RN-WPP-16, 17, 19, 21 | ES-24, 25 |
| WPP | RN-WPP-23, 24, 26 a 29 | ES-04, 16, 18 |
| INB | RN-INB-01, 03 | ES-21 |
| INB | RN-INB-10, 16, 17, 31 | ES-24, 25 |
| INB | RN-INB-18, 19, 20 | ES-04, 06, 08 |
| INB | RN-INB-22 | ES-23 |
| INB | RN-INB-23, 24, 27 | ES-01, 16, 22 |
| FRM | RN-FRM-01, 02 | ES-06, 07, 08 |
| FRM | RN-FRM-08 a 11, 19 a 22, 26 a 29 | ES-04 |
| FRM | RN-FRM-13 a 16, 29 | ES-05 |
| FRM | RN-FRM-18 | ES-15 |
| IA | RN-IA-01, 02, 05, 06, 08, 11 a 14 | ES-09 |
| ORD | RN-ORD-05, 34 | ES-04, 09 |
| ORD | RN-ORD-13, 29, 32, 33 | ES-15, 16, 22 |
| ORD | RN-ORD-14 | ES-12 |
| ORD | RN-ORD-15, 16 | ES-05, 17 |
| ORD | RN-ORD-26, 31 | ES-14, 22 |
| CAJ | RN-CAJ-02 a 04, 07, 08 | ES-10 |
| CAJ | RN-CAJ-05 | ES-12 |
| CAJ | RN-CAJ-06 | ES-11 |
| CAJ | RN-CAJ-09, 19 | ES-11, 13 |
| CAJ | RN-CAJ-12 a 18, 20, 22 | ES-14 |
| CAJ | RN-CAJ-21, 25 | ES-15 |
| DSH | RN-DSH-06, 07, 11 | ES-13 |
| DSH | RN-DSH-15 | ES-08 |
| FAC | RN-FAC-03, 06, 09, 10, 12 | ES-17 |
| ACC | RN-ACC-04, 05 | ES-19 |
| ACC | RN-ACC-11, 13 | ES-20 |
| CAT | RN-CAT-13 | ES-16 (solo deshabilitado) |

**Reglas sin escenario de punta a punta** (candidatas a escenarios futuros): WPP-01 a 05, 07, 18, 20, 22, 25, 30, 31 (plumbing del webhook y configuración de WhatsApp); INB-02, 04 a 09, 11 a 15, 21, 25, 26, 28 a 30 (búsqueda, paginación, límites y reenvío de archivos); FRM-03 a 07, 12, 17, 23 a 25, 30 a 33 (borrado por el cliente, repetir último pedido, sondeo, borrador local); ORD-01 a 04, 06 a 12, 17 a 25, 27, 28, 30, 35 a 38 (numeración, papelera, observaciones, zona roja); CAJ-01, 10, 11, 23, 24 (cobro retroactivo, CSV, reabrir día); DSH-01 a 05, 08 a 10, 12 a 14, 16, 17; FAC-01, 02, 04, 05, 07, 08, 11, 13 a 15; ACC-01 a 03, 06 a 10, 12, 14 a 26; CAT-01 a 12, 14, 15; PLT completo; IA-03, 04, 07, 09 a 10, 15 a 20.

## Escenarios sin test automatizado

| Escenario | Estado de la cobertura | Qué falta (candidato a nueva prueba) |
|---|---|---|
| ES-16 | Sin test | Prueba de interfaz: botones deshabilitados con `isPastDay` y con plantillas sin cargar (DT-008 ya anota la ausencia de pruebas de los modales) |
| ES-19 | Sin test | Listar y editar una cuenta `dev` como admin: ausente en la lista y 404 |
| ES-22 | Parcial | Domiciliario recibe 403 en guardar, mover, observar y cobrar (PREG-012 hoy lo describe sin prueba) |
| ES-13 | Parcial | Crédito saldado fuera de los totales del cierre y presente en la pestaña Crédito (DT-003, DT-030) |
| ES-14 | Parcial | Fantasma en `GET /orders`, decisión `atendido`, totales y foto del cierre, evento `cierre:done` |
| ES-11 | Parcial | Reparto de las dos partes del pago dividido en las bolsas del cierre |
| ES-10 | Parcial | 400 `MISSING_FIELDS` por cada campo faltante |
| ES-18 | Parcial | Evento `message-templates:changed` y refresco de la caché de la web |
| ES-20 | Parcial | Escalones de bloqueo de 15 minutos y 1 hora |
| ES-21 | Parcial | Solo la API; falta la pestaña oculta (prueba de interfaz) |
| ES-01 a 03 | Parcial | El tablero de mañana (`GET /tickets?fecha=` con `Ticket.fecha` de mañana) |
| ES-04, 09 | Parcial | Los tres mensajes del botón "Formulario" y las ventanas de Tomar lista; solo se prueba la API |
| ES-24, 25 | Parcial | El texto en pantalla ante multimedia vencida y el envío automático fallido |

Los demás escenarios (ES-05 a 08, 12, 15, 17, 23) tienen al menos un test de API que cubre su resultado principal; lo que ninguno cubre es la pantalla, porque la web no tiene pruebas de componentes.

## Pendientes

Citados arriba, con su texto en `03-plan/`: PREG-012, PREG-024, PREG-025, PREG-026, PREG-029, PREG-030, PREG-037, PREG-040, PREG-041, DT-003, DT-008, DT-030.
