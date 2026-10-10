---
estado: vigente
verificado: 2026-10-10 @ 1edb809
fuentes: [apps/api/prisma/schema.prisma, apps/api/src/routes/inbox.ts, apps/api/src/routes/webhook.ts, apps/api/src/routes/public.ts, apps/api/src/routes/files.ts, apps/api/src/routes/dev.ts, apps/api/src/routes/auth.ts, apps/api/src/lib/audit.ts, apps/api/src/lib/formLink.ts, apps/api/src/server.ts, apps/api/src/services/ai/index.ts, apps/api/src/services/email.ts, apps/api/src/services/storage.ts, apps/web/public/legal/politica-privacidad.html]
---

# Tratamiento de datos personales (Ley 1581 de 2012)

> **Resumen.** Inventario de los datos personales que 4Client trata, dónde viven, quién los ve, cuánto duran y cómo se borran; el flujo para atender una solicitud de un titular; los terceros que reciben datos; las brechas entre lo que la política publicada promete y lo que el sistema hace; y el procedimiento ante una filtración. Hoy **no hay ninguna purga automática** y la supresión es parcial (§5).

Este documento es una **referencia operativa** de lo que el sistema hace con los datos personales. **No es asesoría jurídica**: si una decisión depende de cómo interpretar la ley (plazos de retención, validez del consentimiento, transferencia a proveedores en el exterior), la decide José con un abogado. Complementa `seguridad-y-privacidad.md` §11 (requisitos de la ley y supresión) y `integraciones.md` (qué sale a cada servicio); aquí se consolidan y no se repiten sus detalles técnicos. Nada de lo que sigue incluye datos reales ni secretos.

## 1. Roles en el tratamiento

| Parte | Rol | Quién es |
|---|---|---|
| Responsable del tratamiento | Decide sobre los datos de los clientes finales | El negocio (hoy Fruver San Gabriel). La política publicada lo nombra como responsable *(código: HTML de la política)* |
| Encargado del tratamiento | Opera la plataforma y custodia los datos por cuenta del negocio | 4Client, hoy operada solo por José (D-17) |
| Titulares | Dueños de los datos | Clientes finales (chat, formulario), y el personal (usuarios y empleados) |
| Subencargados | Terceros que reciben datos | Ver §4 |

La política publicada es **una sola para toda la plataforma** y contiene los datos de un único negocio (DT-002, D-18). Con un segundo cliente habrá que parametrizarla; hasta entonces este documento describe el único caso real.

## 2. Inventario de datos personales

Leyenda de visibilidad: **admin**, **encargado**, **domiciliario**, **dev** como en `01-funcional/actores-y-permisos.md`. El rol `dev` (José) lee la base de cualquier organización desde DevTools (PREG-085).

### 2.1 Clientes finales

| Dato | Dónde se guarda | Para qué | Quién lo ve | Retención hoy | Cómo se borra |
|---|---|---|---|---|---|
| Nombre de perfil de WhatsApp | `Ticket.customer_name` (lo escribe el webhook; el personal puede cambiarlo) | Identificar el chat | admin, encargado, domiciliario (desde el ticket), dev | Indefinida | `erase-data` lo reemplaza por "Cliente eliminado" |
| Teléfono (o identificador alterno) | `Ticket.phone`; `Order.customer_phone` si el cliente lo escribe en el formulario | Responder por WhatsApp, entregar, validar el acceso a la factura | Igual que arriba | Indefinida | `erase-data`: el del ticket se reemplaza por `eliminado-<aleatorio>`; el del pedido pasa a nulo |
| BSUID de WhatsApp | `Ticket.bsuid` | Identificar al cliente cuando llega sin teléfono | Solo la base (dev); no se muestra en la interfaz *(inferido)* | Indefinida | `erase-data` lo pone en nulo |
| Mensajes de texto (entrada y salida) | `TicketMessage.text` | Historial de la conversación, base de "Tomar lista" | Quien abre el ticket; la bandeja completa solo admin y dev (D-09) | Indefinida | `erase-data` borra las filas del ticket |
| Ubicación enviada | `TicketMessage.media_url` como enlace de Google Maps | Domicilio | Igual que los mensajes | Indefinida | Igual |
| Multimedia (foto, audio, video, documento) | **No se guarda.** Solo el id de Meta en `media_url`; los bytes los retiene Meta 30 días | Ver el archivo mientras Meta lo tenga | Quien abre el ticket | Meta: 30 días. Nosotros: el id, sin límite | `erase-data` borra el id con el mensaje (D-04) |
| Cuerpo crudo del webhook | `TicketMessage.raw_payload` (cada mensaje entrante) y `Ticket.raw_payload` (solo el primero) | Diagnóstico de mensajes sin remitente o mal formados | Solo dev, por la base | Indefinida | `erase-data` borra los mensajes y pone en nulo el del ticket |
| Nombre de contacto y dirección de entrega | `Order.client_contact_name`, `Order.address`, `Order.customer_name` (formulario o captura manual) | Entregar y facturar | admin, encargado, domiciliario (lectura), dev | Indefinida | `erase-data` los anonimiza (el pedido se conserva) |
| Contenido del pedido (productos, cantidades, precios) | `OrderItem`, `Order.notes` | Cobrar, facturar, cerrar caja | Igual que el pedido | Indefinida | **No se borra** (soporte de la venta). `Order.notes` queda tal cual (PREG-037) |
| Historial de cambios del pedido | `OrderHistory.value_before` / `value_after` | Trazabilidad; es inmutable (principio 4, D-03) | admin, dev | Para siempre | **No se puede borrar**: puede conservar nombres, teléfonos o direcciones anteriores (PREG-037) |
| Observaciones del personal | `OrderObservation.text` | Notas internas | admin, encargado, dev | Indefinida | No se borran; pueden mencionar al cliente en texto libre |
| Consentimiento | `Order.consent_confirmed_at` y `Order.privacy_policy_version` (cada envío del formulario); `Ticket.consent_given_at` y `Ticket.privacy_policy_version` (la primera vez); `Ticket.privacy_notice_sent_at` | Prueba del consentimiento y de qué versión del texto aceptó | dev, por la base | Indefinida | `erase-data` conserva `consent_given_at` a propósito como prueba |
| Facturas PDF (nombre, dirección, teléfono, productos) | Cloudflare R2 `invoices/<archivo>`; enlace en `InvoiceLink` con `phone_last4` | Entregar la factura al cliente por WhatsApp | Quien tenga el link (24 h, validado con los últimos 4 dígitos del teléfono); admin y dev desde el pedido | El PDF: sin límite (PREG-084). El link: 24 h | `erase-data` revoca los links y enmascara `phone_last4`; **el PDF no se borra** |
| Facturas PDF antiguas en el repositorio | `apps/api/uploads/` versionado en git (6 archivos) | Restos de pruebas | Quien acceda al repo | Indefinida | Pendiente (DT-033) |
| Enlace del formulario | `Ticket.form_link_*` | Dar acceso al formulario 24 h | Solo el cliente con el link; dev por la base | 24 h de validez; la fila queda | `erase-data` lo deja en blanco |

### 2.2 Personal del negocio

| Dato | Dónde | Para qué | Quién lo ve | Retención | Borrado |
|---|---|---|---|---|---|
| Nombre y correo de usuarios | `User.name`, `User.email` (y `username`, sin uso todavía) | Inicio de sesión, aviso de bloqueo, 2FA del dev | admin (los de su organización), dev | Mientras exista la cuenta; desactivar no borra y el correo queda ocupado (PREG-059) | No hay borrado desde la interfaz |
| Contraseña | `User` (hash) | Autenticación | Nadie (solo hash) | Mientras exista la cuenta | — |
| Sesiones | `RefreshToken` (hash SHA-256) | Mantener la sesión 7 días | Nadie | Los vencidos se borran en el siguiente login exitoso del usuario (`seguridad-y-privacidad.md` §1) | Idem |
| Código 2FA | `LoginVerificationCode` | Segundo factor del `dev` | Nadie | Sin purga automática (`seguridad-y-privacidad.md` §11) | — |
| Nombre y teléfono de empleados (domiciliarios) | `Employee.name`, `Employee.phone` | Asignar entregas | admin, encargado y domiciliario (lectura), dev | Un empleado desactivado queda en la base (PREG-061) | No hay borrado |
| Registro de auditoría | `AuditLog` (actor, acción, destino, `metadata`) | Trazabilidad de acciones sensibles | Solo dev, por la base | Indefinida | No se borra. No guarda IP. `metadata` de la edición de usuarios guarda el cuerpo recibido, que puede incluir el correo (PREG-060) |

### 2.3 Registros técnicos

| Dato | Dónde | Observación |
|---|---|---|
| Teléfono del cliente en logs | Log de la API (`warn`): descarte de mensajes con más de 10 min (PREG-032) y colisión concurrente de tickets | En todos los despliegues `NODE_ENV=production` fija el nivel en `warn`, así que el `info` "mensaje entrante ingresado", que también trae el teléfono, **no se emite**; si el nivel cambiara, sí saldría *(código)* |
| IP de quien llama | Fastify la usa para los límites de peticiones; los logs de petición son de nivel `info` (no se emiten en producción). No se guarda en la base | Los logs de contenedor viven en el VPS; su rotación no está documentada *(no especificado)* |
| Errores | Sentry, con `tracesSampleRate` 0,2 y sin filtro propio de datos | Qué campos de la petición incluye el SDK por defecto no está verificado (§4 y §6) |
| Copias de seguridad | Volcado diario de toda la base en un bucket de R2 aparte | Contiene todo lo anterior. La retención es una regla del panel de Cloudflare que no está en el repo (PREG-099, PREG-111) |

## 3. Retención: lo que hace el código hoy

- **Nada borra datos automáticamente**: ni mensajes, ni `raw_payload`, ni pedidos, ni `audit_logs`, ni PDF de facturas, ni códigos 2FA *(código; PREG-097)*. Las únicas caducidades son técnicas: links de 24 h (el registro permanece), multimedia de Meta a 30 días, sesiones de 7 días.
- La política dice que los datos se conservan "durante el tiempo que mantengas una relación comercial" y "el periodo estrictamente necesario para cumplir las normas colombianas", sin plazo concreto. **No hay un plazo definido que el sistema pueda aplicar** (PREG-097).
- Los pedidos y su historial se conservan como soporte de la venta; qué plazo contable/tributario aplica al negocio no está especificado.

## 4. Terceros que reciben datos personales

| Tercero | Qué datos recibe | Para qué | Qué dice la política publicada | Observación |
|---|---|---|---|---|
| **Meta (WhatsApp Cloud API)** | Todos los mensajes que el cliente envía y los que el negocio le responde, teléfono/BSUID, nombre de perfil, multimedia (30 días) | Es el canal de comunicación | Menciona "proveedores tecnológicos estrictamente necesarios para operar nuestro canal de WhatsApp" sin nombrarlos | Meta es además responsable de sus propios datos por las condiciones de WhatsApp; retiene la multimedia 30 días |
| **Gemini, Groq, OpenRouter** (IA de "Tomar lista") | El **texto literal** de los mensajes del cliente que el personal selecciona (1 a 50, solo entrantes y sin multimedia) y los nombres del catálogo. No se envía el teléfono ni el nombre *(código: `inbox.ts › parse-messages`)* | Convertir mensajes en un borrador de pedido | **No los menciona.** Dice que los datos solo los procesan "proveedores tecnológicos estrictamente necesarios" | Cadena de niveles gratuitos que pueden usar los datos para entrenar y procesan fuera de Colombia; el texto libre del cliente puede traer cualquier dato personal (PREG-051, D-11) |
| **Cloudflare** (Pages, R2, DNS) | Pages sirve la web (sin datos de clientes); R2 guarda las facturas PDF y los respaldos de la base; DNS resuelve los dominios | Alojamiento y archivos | No lo nombra | Es el destino de **todos** los datos de la base vía respaldo (PREG-099) |
| **Resend** | Correo del usuario que inicia sesión como `dev` (código 2FA) y del dueño de una cuenta bloqueada (aviso), con el nombre de la organización | Correo transaccional | No aplica a clientes finales | Solo datos del personal |
| **Sentry** | Excepciones no controladas de la API (traza, mensaje, contexto de la petición según el SDK) | Detectar fallos | No lo nombra | No hay `beforeSend` ni limpieza de datos; un mensaje de error podría incluir un fragmento de datos de un cliente. No verificado qué contexto envía el SDK por defecto |
| **Proveedor del VPS** (ver `04-operacion/entornos-y-despliegue.md`) | Aloja la base, los logs y los contenedores: tiene acceso físico a todo | Cómputo | No lo nombra | Los discos del servidor no tienen cifrado documentado *(no especificado)* |
| **GitHub** | El repositorio (código y 6 PDF de facturas antiguos, DT-033); Actions con el respaldo diario, que usa las credenciales de la base como secretos | Código y CI | No lo nombra | Repo pasando a privado (`00-estado-actual.md`) |

**Diferencias factuales con la política publicada** *(código: HTML de la política, versión de septiembre de 2026, `v1`)*:

1. Afirma que no se comparten datos "con terceros" y que solo los procesan proveedores "necesarios"; no nombra a ninguno, ni a los proveedores de IA ni su ubicación fuera de Colombia.
2. Lista como datos recogidos nombre, teléfono, dirección, historial de compras, facturas y texto de chats. No menciona los **cuerpos crudos** de los mensajes ni el **identificador de WhatsApp (BSUID)**.
3. Dice que el titular puede pedir eliminar su información "siempre y cuando no exista un proceso de facturación en curso o una obligación legal que lo impida"; el sistema conserva en la práctica pedidos anonimizados, historial, PDF y respaldos, sin que la política lo explique.
4. Los canales de contacto de la política son los del negocio; el sistema no tiene un canal propio de solicitudes (§5).
5. Declara cifrado; la base y los respaldos no tienen cifrado a nivel de aplicación (solo los tokens de Meta, D-15) *(inferido)*.

## 5. Derechos del titular y cómo atenderlos

### 5.1 Qué existe

| Derecho | Mecanismo en el sistema | Alcance real |
|---|---|---|
| Información (aviso) | Mensaje con el link a `/legal/politica-privacidad`, **una vez por ticket**, solo si hay `welcome_message` y no `wpp_redirect_message` (PREG-022) | No se envía a conversaciones sin bienvenida configurada |
| Autorización (consentimiento) | Casilla obligatoria en **cada** envío del formulario, con la versión de la política | Los pedidos creados a mano por el personal no registran consentimiento (PREG-022) |
| Acceso | **No hay función.** El negocio consulta el ticket y los pedidos en la interfaz; el dev puede leer la base | Se responde a mano (§5.2) |
| Actualización / rectificación | El personal edita nombre, contacto, dirección y teléfono del pedido; el admin renombra el ticket (el perfil de WhatsApp lo vuelve a pisar con el siguiente mensaje, PREG-021) | `order_history` conserva los valores anteriores |
| Supresión | `POST /inbox/:ticketId/erase-data`, botón "Eliminar datos", **solo `dev`** (D-17, D-18) | Anonimiza; ver abajo |
| Revocar la autorización | Igual que la supresión; no hay función separada | — |

**`erase-data`, resumen** *(código)*: en una transacción, anonimiza todos los pedidos del ticket (nombre, contacto, teléfono, dirección), borra los mensajes del chat, las revocaciones y la sesión del formulario, revoca los links de factura y enmascara `phone_last4`, y anonimiza el ticket (nombre, teléfono, BSUID, `raw_payload`, campos del link). Conserva `consent_given_at` y registra `ticket.erase_customer_data` en `audit_logs`. **No toca:** `order_history`, `OrderObservation`, `Order.notes`, los PDF de R2, los respaldos, lo que tenga Meta ni las copias de los proveedores de IA. Detalle en `seguridad-y-privacidad.md` §11 y `runbooks.md` §i.

### 5.2 Procedimiento para el operador

1. **Recibir y verificar.** La solicitud llega por los canales de la política (WhatsApp o correo del negocio). El negocio confirma que quien pide es el titular (p. ej. escribe desde el mismo número del ticket). No hay formulario ni registro de solicitudes en el sistema: anótala en el canal que use José *(el registro formal no está especificado)*.
2. **Clasificar:** consulta (acceso), corrección o supresión. Plazos legales de respuesta: confirmarlos con asesoría; el sistema no los vigila.
3. **Acceso:** el admin del negocio abre el ticket y sus pedidos y se los comunica al titular; para algo que solo está en la base (p. ej. `raw_payload`), lo consulta el dev y lo deja anotado en la auditoría de lectura (`dev.db_read`).
4. **Corrección:** el admin edita el pedido o el nombre del ticket. Advertir al titular que el historial inmutable guarda el valor previo.
5. **Supresión:** ejecutar el procedimiento de `runbooks.md` §i (botón "Eliminar datos", solo `dev`). Antes, comprobar que el ticket es de la organización del dev que ejecuta; si el titular es de **otra organización**, la ruta no lo encuentra (PREG-042).
6. **Después de borrar**, revisar a mano lo que la herramienta no cubre y decidir con José: observaciones y `Order.notes` que mencionen al cliente, PDF de facturas en R2 (borrado manual del objeto), y avisar que los respaldos conservan el dato hasta que venza su ciclo de vida.
7. **Responder al titular** qué se borró y qué se conserva y por qué (soporte de venta, obligación legal), sin prometer más de lo que el sistema hace.
8. **Verificar:** el ticket aparece como "Cliente eliminado", sin mensajes; existe `ticket.erase_customer_data` en `audit_logs`.

## 6. Medidas de seguridad relevantes

No se repiten aquí; están en `seguridad-y-privacidad.md`: sesión de 15 min con refresh rotativo (§1), aislamiento por `org_id` del JWT (404 y no 403), cifrado de los tokens de Meta por organización (§5), links públicos de 24 h con token opaco (§7), HMAC del webhook (§1.2 de `integraciones.md`), HTTPS obligatorio y límites de peticiones (§10, §12) y la auditoría de acciones sensibles (§9). Para datos personales, además:

- La multimedia del chat nunca se persiste (D-04).
- El `warn` con el teléfono es la excepción conocida en logs (PREG-032).
- Las cuentas admin entran sin segundo factor (D-10) y ven todos los datos del negocio.
- La base se expone por un proxy para el respaldo diario (riesgo aceptado, `seguridad-y-privacidad.md` §13).

## 7. Brechas conocidas

| # | Brecha entre lo que la política o la ley esperan y lo que hace el sistema | Referencia |
|---|---|---|
| G1 | Sin purga automática ni plazo de retención aplicable | PREG-097 |
| G2 | La supresión deja datos en `order_history`, observaciones, `Order.notes` y PDF de R2 | PREG-037 |
| G3 | La supresión solo alcanza tickets de la organización del dev que la ejecuta | PREG-042 |
| G4 | Texto de clientes sale a IA gratuita fuera de Colombia, sin mención en la política | PREG-051, D-11 |
| G5 | El aviso de privacidad depende de configuración y los pedidos manuales no registran consentimiento | PREG-022 |
| G6 | El dev lee datos de cualquier negocio sin tope; solo queda el rastro `dev.db_read` sin contenido | PREG-085 |
| G7 | Los PDF de factura no tienen retención y puede que el bucket sea de lectura pública | PREG-084, PREG-095 |
| G8 | Respaldos con todos los datos, sin plazo de retención conocido y en el mismo proveedor | PREG-099, PREG-111 |
| G9 | 6 PDF de facturas en el repositorio | DT-033 |
| G10 | Teléfono del cliente en un log `warn` | PREG-032 |
| G11 | Política única con datos de un solo negocio; no nombra a los encargados ni al BSUID ni al `raw_payload` | DT-002, D-18, §4 |
| G12 | Sin canal propio ni registro de solicitudes de titulares (acceso, rectificación) | Nueva: ver mensaje final |
| G13 | Sentry sin filtro de datos personales | Nueva: ver mensaje final |
| G14 | Nombres y correos de usuarios y empleados no se pueden borrar desde la interfaz | PREG-059, PREG-061 |
| G15 | La auditoría de edición de usuarios guarda el cuerpo recibido tal cual | PREG-060 |

## 8. Respuesta ante una filtración de datos

Una filtración es cualquier acceso, pérdida o exposición no autorizada: credencial de un admin comprometida, link de factura o formulario reenviado a quien no debe, respaldo o conexión a la base expuestos, repositorio con datos, error que revela datos de un cliente.

1. **Detectar y contener (primeras horas).** José lo confirma. Contener según el caso: revocar sesiones de la cuenta (reset de contraseña por un admin revoca los refresh tokens y desconecta sockets); "bloquear todos" los links del ticket; rotar secretos (`runbooks.md` §g: `JWT_SECRET`, credenciales de la base, claves de R2, token de Meta); si es el repo, volverlo privado y purgar el archivo.
2. **Alcance.** Revisar `audit_logs` (inicios de sesión exitosos y fallidos, `dev.db_read`, cambios de usuarios), los logs de la API en Coolify (solo `warn` y superior en producción), el panel de acceso de Cloudflare R2 y de GitHub. Lo que **no** está registrado: lecturas normales de tickets y pedidos, descargas de PDF, bloqueos de links (PREG-098); por eso el alcance suele quedar como "posible".
3. **Identificar titulares afectados** por organización y tipo de dato (§2) y si hay datos de salud, menores o financieros (el inventario actual no incluye datos sensibles).
4. **Notificar.** Al negocio responsable de inmediato, y con su asesoría decidir los avisos al titular y a la autoridad (Superintendencia de Industria y Comercio, registro de incidentes del RNBD). Los plazos y condiciones los fija la ley, no este documento: confirmar con abogado *(no especificado)*.
5. **Corregir y documentar.** Cerrar la causa, anotar el incidente en `05-historia/cronologia.md` y el cambio en `registro-de-cambios.md`, abrir PREG/BUG para lo que falló y revisar el riesgo en `03-plan/riesgos.md`.

## 9. Checklist: una función nueva que toca datos personales

- [ ] ¿Qué datos nuevos se guardan? Agrégalos al inventario (§2): tabla/columna, finalidad, quién los ve, retención y cómo se borran.
- [ ] ¿Se necesita de verdad cada dato (minimización)? Si se puede calcular, no se guarda.
- [ ] ¿La finalidad cabe en la política publicada? Si no, subir `PRIVACY_POLICY_VERSION` y actualizar el HTML en el mismo cambio, y pedir consentimiento de nuevo.
- [ ] ¿Sale algún dato a un tercero nuevo? Agregarlo a §4 y a `integraciones.md`, y decidir con José si la política debe nombrarlo (PREG-051 es el precedente).
- [ ] ¿`erase-data` lo cubre? Si crea filas ligadas al ticket, añadirlas a la transacción y a su test (`inbox.test.ts`).
- [ ] ¿Entra en `order_history` (inmutable)? Evitar guardar datos del cliente en `value_before`/`value_after` salvo necesidad.
- [ ] ¿Lo ve un rol que antes no lo veía? Revisar `actores-y-permisos.md` y filtrar por `org_id` del JWT (principio 2).
- [ ] ¿Aparece en logs, `audit_logs` o en el mensaje de un error (Sentry)? No debe incluir teléfono, nombre ni texto del cliente.
- [ ] ¿Cuánto dura y quién lo purga? Si no hay respuesta, dejar una PREG de retención; no es aceptable sumar datos sin plazo.
- [ ] ¿Entra en los respaldos? Todo lo de la base entra; considerarlo al pedir un borrado.
- [ ] Test contra Postgres real para permisos y borrado (principio 11) y asiento `R-nnnn` (principio 14).
- [ ] Si es un cambio de privacidad o de datos, es clase C: `specs/03-plan/cambios/CH-nnnn-*.md` antes del código.

## Pendientes

Las preguntas están en `03-plan/preguntas-abiertas.md`: PREG-097 (retención), PREG-037 y PREG-042 (supresión), PREG-051 (IA), PREG-022 (aviso y consentimiento), PREG-085 (lectura del dev), PREG-084, PREG-095, PREG-099 y PREG-111.
