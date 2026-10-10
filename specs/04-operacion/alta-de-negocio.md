---
estado: vigente
verificado: 2026-10-09 @ 5d8e69d
fuentes: [apps/api/src/routes/dev.ts, apps/api/src/routes/config.ts, apps/api/src/routes/users.ts, apps/api/src/lib/messageTemplates.ts, apps/api/src/routes/webhook.ts, apps/api/src/lib/formLink.ts, apps/web/src/components/config/DevOrgsPanel.tsx, apps/web/src/components/config/OrgSelector.tsx]
---

# Alta de un negocio nuevo (segunda organización)

Procedimiento para dar de alta un negocio en la plataforma con lo que **existe hoy**. El alta sin intervención de José es una meta del horizonte (`../00-horizonte.md`, etapa "Siguiente"); mientras tanto la hace el operador `dev`.

> **Antes de dar de alta un segundo negocio hay que limpiar lo específico del primero.** Con el código actual el negocio nuevo hereda datos de otro cliente (ver sección 1). No continúes sin confirmar con José cómo se resuelve.

## 1. Lo específico de un cliente que hoy contamina a otro

| Qué | Dónde está | Efecto en el negocio nuevo | ID |
|---|---|---|---|
| Plantillas por defecto con razón social, cuenta bancaria, mínimo y costo de domicilio del primer cliente | `apps/api/src/lib/messageTemplates.ts › DEFAULT_MESSAGE_TEMPLATES` (`form_warning`, `form_followup`, `bank_account`) | Si el admin no las edita, sus clientes reciben la cuenta de **otro** negocio | DT-001 |
| Política de privacidad fija (un solo negocio como responsable), logo y marca de agua del encabezado | `apps/web/public/legal/politica-privacidad.html`, `lib/formLink.ts › PRIVACY_POLICY_PATH`, `ClientFormPage.tsx` | El aviso y el formulario de todo negocio muestran la política del primero | DT-002 |
| Seed y scripts con el `slug` del primer cliente | `routes/dev.ts › POST /seed`, `apps/api/src/update-org-wpp.ts` | **No uses `/dev/seed` ni `update-org-wpp.ts` para el negocio nuevo.** (`/seed` además responde 403 en producción) | DT-002 |

Qué es seguro: todo lo demás se filtra por `org_id` (principio 2). Un dato de un negocio no aparece en otro; las diferencias de arriba son **texto fijo**, no fuga de pedidos.

## 2. Pasos

Requiere sesión con rol `dev` (con 2FA por correo si `REQUIRE_2FA` está activo en ese entorno). **Ensaya siempre primero en dev** (`https://dev-api.4client.shop`); en producción, con OK de José (`runbooks.md`, reglas generales).

1. **Crear la organización y su primer admin.** Configuración › DevTools › Organizaciones (`DevOrgsPanel`) › Nueva organización. Llama a `POST /api/v1/dev/organizations` con nombre, `slug` opcional (minúsculas, números y guiones; si choca se le añade un sufijo), nombre, correo y contraseña del admin. Crea en una transacción la organización (`plan = starter`, `wpp_provider = meta_api`, activa) y el admin. **La contraseña se muestra una sola vez**: entrégala por un canal seguro. El correo es único en **toda** la plataforma (409 `DUPLICATE_EMAIL`).
2. **WhatsApp.** El número del negocio debe estar en Meta (misma App de Meta que la plataforma: la firma del webhook es el `META_APP_SECRET` global, PREG-033). Obtén su *phone number id* y un token permanente (`runbooks.md` §f). **Hueco de interfaz:** el panel Configuración › DevTools › WhatsApp (`DevWppPanel`) y `PATCH /api/v1/config/wpp` actúan sobre la organización **de la sesión que los usa**, no sobre la elegida en `OrgSelector`; y el admin nuevo no ve la pestaña DevTools. Hoy la única vía es llamar `PATCH /api/v1/config/wpp` (`wpp_meta_phone_id`, `wpp_meta_token`, `wpp_phone`) con la sesión del admin nuevo (por ejemplo `curl` con su token). El token se guarda cifrado. 409 `PHONE_ID_ALREADY_IN_USE` = ese número ya es de otra organización. Esto es un candidato a mejora (panel de WhatsApp por organización objetivo): proponerlo a José como `CH`.
3. **Mensaje de bienvenida.** Sin `welcome_message` el sistema **no manda bienvenida ni aviso de privacidad** al cliente nuevo (`routes/webhook.ts`: solo se envía si hay `welcome_message` o `wpp_redirect_message`; el link del formulario nunca sale solo, lo manda el personal con el botón). Defínelo con el mismo `PATCH /config/wpp` (`welcome_message`, máx. 1000 caracteres). Cuando se envía, lleva pegado el aviso de privacidad (una vez por ticket).
4. **Textos de los botones del chat** (`form_warning`, `form_followup`, `bank_account`). Configuración › Mensajes, pestaña del admin (`PUT /config/message-templates`): **reescribe los tres antes del primer día** (sección 1, DT-001).
5. **Usuarios.** Configuración › Usuarios (`POST /users`, admin o dev): roles `admin`, `encargado`, `domiciliario`; correo único en la plataforma y `username` opcional también único. Los domiciliarios (`/employees`, solo admin) se gestionan en la misma pestaña.
6. **Catálogo.** Configuración › Productos: a mano o importando Excel (`apps/web/src/lib/productExcel.ts`; ver `../modulos/CAT.md`). Recordar que el precio de referencia es solo eso: el precio de cada línea es el total (principio 3).
7. **Prueba de punta a punta** con un número propio de José: mensaje al número del negocio → ticket en el tablero → bienvenida → el personal envía el link → formulario → pedido → respuesta desde el chat entregada (`diagnostico-de-incidentes.md` si algo falla).

## 3. Qué todavía no se puede hacer sin José o a mano

| Necesidad | Estado |
|---|---|
| Borrar los datos de un cliente final del negocio nuevo | Solo `dev` (D-17; `runbooks.md` §i). El horizonte prevé pasarlo a los admins |
| Cobro de la suscripción | Registro manual en el panel de facturación dev (`routes/billing.ts`); no hay cobro automático |
| Dominio propio, logo o política propios por negocio | No existe (DT-002) |
| Desactivar un negocio | Hay campo `active` (el webhook solo enruta organizaciones activas); no hay botón en la interfaz: preguntar a José |
| Login por nombre de usuario | Existe el campo `username` opcional; el login por usuario está en el horizonte |

## 4. Al terminar

Registra el alta como asiento en `../05-historia/registro-de-cambios.md` **solo si cambiaste el código o las specs** (un alta operativa en producción no es un cambio de repo; anótala en `../00-estado-actual.md` ("Un cliente real" pasa a dos)). Actualiza `../00-horizonte.md` y `../03-plan/roadmap.md` si con esto se cumple un ítem.
