---
estado: vigente
verificado: 2026-10-10 @ 1edb809
---

# Preguntas abiertas

> **Resumen.** 129 preguntas (`PREG`) sobre comportamientos cuya intención solo José puede confirmar: 6 ya respondidas, 15 de impacto alto, el resto medio o bajo. El comportamiento actual de cada una está documentado tal cual en su módulo; aquí solo se recoge la decisión pendiente. Los números son globales; la correspondencia con los IDs provisionales está en `mapa-de-ids.md`.

## Cómo priorizar

| Impacto | Qué significa | Cuándo responderla |
|---|---|---|
| **Alto** | Dinero que no cuadra, seguridad, datos personales (Ley 1581) o algo que ve el cliente | Primero; son las de la tabla "Prioritarias" (más PREG-002, PREG-042 y PREG-097, que siguen en su sección) |
| **Medio** | Inconsistencia visible para el personal, regla de negocio dudosa, operación o configuración sin dueño claro | Cuando se vaya a tocar ese módulo, o antes del segundo cliente |
| **Bajo** | Cosmético, caso raro o mejora menor | Sin urgencia; en lote |
| **Respondida** | Ya hay decisión `D-nn` | Nada que hacer; queda como historia |

El impacto es una **propuesta** de quien redactó (`inferido`): José puede reclasificar al responder. Sugerencia de orden de trabajo: dinero (PREG-001, 002, 004, 009, 011) → seguridad (064, 065, 035) → Ley 1581 (022, 037, 042, 051, 085, 097) → lo que ve el cliente (081) → resto por módulo.

## Cómo responder

José responde en el chat, por ID. Cuando una pregunta se responde:

- Si el comportamiento es **incorrecto**, pasa a `BUG-nnn` (confirmado) y se planea su arreglo como cambio `CH-nnnn`.
- Si es **intencional**, se registra una decisión `D-nn` en `05-historia/decisiones.md` y se actualiza la regla en el módulo.
- Si quiere **cambiarlo** sin considerarlo un error, se abre un cambio `CH-nnnn` (clase C: spec, plan y tareas antes del código).

Las deudas técnicas objetivas (`DT-nnn`) no necesitan respuesta: están en `problemas-conocidos.md`.

## Prioritarias

Las de mayor impacto (dinero, seguridad, pérdida de datos, lo que ve el cliente).

| ID | Pregunta | Por qué importa |
|---|---|---|
| PREG-001 | **Parcialmente respondida (D-19):** el crédito pagado queda fuera de los totales a propósito, por ahora. **Sigue abierto:** un pedido `sin_asignar` cerrado sin cobro y los métodos heredados fuera de los cinco (por ejemplo `efectivo` en datos viejos) tampoco caen en ninguna bolsa. ¿Qué pasa con esos? | Dinero: pagos que no caen en ninguna bolsa hacen que el cierre y el informe no cuadren con lo cobrado. |
| PREG-004 | Restaurar, marcar crédito pagado y cobro retroactivo no miran el día cerrado (la foto `DailyClose` queda vieja), y restaurar deja pedidos abiertos que ya no se pueden cobrar ni mover; cambiar estado desde papelera no limpia sus campos. ¿Se recalcula la foto y se bloquea la restauración? | Dinero: un día cerrado puede cambiar después y la foto del cierre queda desactualizada. |
| PREG-009 | Los totales y la comprobación 'ya cerrado' ocurren fuera de la transacción: un cobro concurrente queda fuera de la foto y dos cierres simultáneos se pisan. ¿Vale la pena cerrar esa ventana? | Dinero: un cobro concurrente puede quedar fuera de la foto del cierre o dos cierres pisarse. |
| PREG-011 | El admin puede editar ítems o método de un pedido ya cobrado sin revalidar monto, vuelta ni pago dividido, y los totales pueden dejar de sumar. ¿Se revalida o se restringe? | Dinero: editar un pedido ya cobrado rompe la suma de los totales. |
| PREG-064 | `REQUIRE_2FA=false` (texto) activa el 2FA por `z.coerce.boolean()`. ¿Se corrige el parseo o se documenta que debe quedar vacía? | Seguridad: `REQUIRE_2FA=false` enciende el 2FA y puede bloquear el login real. |
| PREG-065 | Desactivar o bajar de rol a un usuario no invalida su access token hasta 15 min. ¿Se acepta o `authenticate` consulta `active`/`role`? | Seguridad: un usuario desactivado o degradado conserva acceso hasta 15 min. |
| PREG-035 | La seguridad de links por intentos fallidos y por `device_token`/`FormLinkSession` es código inerte que los comentarios describen como activo. ¿Se elimina todo o se restablece una protección (p. ej. límite de aperturas por link)? | Seguridad: la defensa de links por intentos no existe aunque el código y los comentarios la describen. |
| PREG-037 | 'Borrar datos del cliente' deja datos personales en `order_history`, observaciones, `Order.notes` y los PDF de factura en R2. ¿Se acepta ante la Ley 1581 o se borran/redactan? | Pérdida de datos y Ley 1581: 'Borrar datos del cliente' deja datos personales y PDF. |
| PREG-051 | 'Tomar lista' manda texto literal de clientes a proveedores de IA gratuitos fuera de Colombia que la política de privacidad no menciona. ¿Se aceptó este tratamiento bajo la Ley 1581? | Ley 1581: texto de clientes sale a proveedores de IA gratuitos no mencionados en la política. |
| PREG-022 | El aviso de privacidad (Ley 1581) solo sale si hay `welcome_message` y no hay redirección, y los pedidos a mano no registran consentimiento. ¿Debe enviarse aparte y basta para la ley? | Ley 1581 y cliente: el aviso de privacidad puede no salir nunca. |
| PREG-085 | El dev lee datos personales de cualquier negocio sin motivo ni tope y solo queda `dev.db_read` sin el contenido. ¿Basta ese rastro (Ley 1581) o se enmascaran por defecto? | Seguridad: el dev lee datos personales de cualquier negocio sin motivo ni tope. |
| PREG-081 | Si la subida a R2 falla, el pedido queda sin factura válida y la nueva apunta a un archivo inexistente. ¿Se reordena (subir primero) o se acepta? | Visible al cliente: si R2 falla, el pedido queda sin factura válida y el link da 404. |

## CAJ — Cobros y cierre de caja

| ID | Pregunta | Módulo(s) | Impacto | Detalle |
|---|---|---|---|---|
| PREG-001 | **Parcialmente respondida (D-19):** el crédito pagado queda fuera de los totales a propósito, por ahora. **Sigue abierto:** `sin_asignar` cerrado sin cobro y métodos heredados fuera de los cinco no caen en ninguna bolsa. ¿Qué pasa con esos? | CAJ, DSH | Alto | `modulos/CAJ.md` (§ 3 Pendientes); `modulos/DSH.md` (§ 3 Pendientes) |
| PREG-002 | La vista previa del modal de cierre suma distinto que el servidor (ignora el pago dividido, incluye eliminados por el cliente, rotula créditos como 'Completado'). ¿Debe usar exactamente la regla del servidor? | CAJ | Alto | `modulos/CAJ.md` (§ 3 Pendientes) |
| PREG-003 | El CSV descargado desde 'Informe del día' después de cerrar no trae los pedidos pasados a mañana; solo el descargado antes de confirmar. ¿Es aceptable? | CAJ | Medio | `modulos/CAJ.md` (§ 3 Pendientes) |
| PREG-004 | Restaurar, marcar crédito pagado y cobro retroactivo no miran el día cerrado (la foto `DailyClose` queda vieja), y restaurar deja pedidos abiertos que ya no se pueden cobrar ni mover; cambiar estado desde papelera no limpia sus campos. ¿Se recalcula la foto y se bloquea la restauración? | CAJ, ORD | Alto | `modulos/CAJ.md` (§ 3 Pendientes); `modulos/ORD.md` (§ 3 Pendientes) |
| PREG-005 | Reabrir un cierre solo borra `DailyClose`: no deshace `caja_cerrada`, bloqueos ni pasados a mañana, y un día pasado reabierto no se puede volver a cerrar (`NOT_TODAY`). ¿Es el uso esperado, se limpia al reabrir o se elimina la columna? | CAJ, PLT, GEN | Medio | `02-tecnico/datos-y-migraciones.md` (Preguntas/Pendientes); `04-operacion/runbooks.md` (Preguntas/Pendientes); `modulos/CAJ.md` (§ 3 Pendientes) |
| PREG-006 | **Respondida (D-19):** por ahora un crédito pagado no cuenta en ningún día. Se retoma si el cliente pide gestionarlos en el cierre. | CAJ | Respondida | `modulos/CAJ.md` (§ 3 Pendientes) |
| PREG-007 | Se puede marcar pagado un crédito que aún no está cerrado; el cierre ya no lo ve como pendiente ni lo suma. ¿Se exige que el pedido esté cerrado? | CAJ | Medio | `modulos/CAJ.md` (§ 3 Pendientes) |
| PREG-008 | La API y la matriz de permisos dejan cerrar caja al encargado, pero la interfaz solo muestra el botón en 'Informe del día', que el encargado no ve. ¿Cuál es la intención? | CAJ, ACC | Medio | `modulos/CAJ.md` (§ 3 Pendientes) |
| PREG-009 | Los totales y la comprobación 'ya cerrado' ocurren fuera de la transacción: un cobro concurrente queda fuera de la foto y dos cierres simultáneos se pisan. ¿Vale la pena cerrar esa ventana? | CAJ | Alto | `modulos/CAJ.md` (§ 3 Pendientes) |
| PREG-010 | La API cobra pedidos en papelera o eliminados por el cliente (solo la interfaz lo impide) y quedan fuera de los totales. ¿Debe rechazarlo la API? | CAJ | Medio | `modulos/CAJ.md` (§ 3 Pendientes) |
| PREG-011 | El admin puede editar ítems o método de un pedido ya cobrado sin revalidar monto, vuelta ni pago dividido, y los totales pueden dejar de sumar. ¿Se revalida o se restringe? | CAJ, ORD | Alto | `modulos/CAJ.md` (§ 3 Pendientes) |

## ORD — Pedidos

| ID | Pregunta | Módulo(s) | Impacto | Detalle |
|---|---|---|---|---|
| PREG-012 | El domiciliario ve botones (Guardar, Mover, observaciones, flechas, arrastre) que la API rechaza con 403. ¿Se ocultan para ese rol? | ORD, ACC | Medio | `modulos/ORD.md` (§ 3 Pendientes) |
| PREG-013 | Los ítems se identifican por `product_name`: líneas con igual nombre se confunden en el historial y renombrar se registra como eliminar + agregar. ¿Es intencional? | ORD | Bajo | `modulos/ORD.md` (§ 3 Pendientes) |
| PREG-014 | Ninguna pantalla crea pedidos `channel = 'call'` (sin ticket), aunque la API y el detalle los soportan. ¿Se mantiene el canal o es código heredado? | ORD, PLT | Bajo | `modulos/ORD.md` (§ 3 Pendientes); `modulos/PLT.md` (§ 3 Pendientes) |
| PREG-015 | `GET/POST /orders` sin `fecha` usan el día UTC (entre 19:00 y 23:59 Bogotá ya es 'mañana') y una `fecha` inválida llega a la base. ¿Se alinea con Bogotá y se valida? | ORD, GEN | Medio | `02-tecnico/arquitectura.md` (Preguntas/Pendientes); `modulos/ORD.md` (§ 3 Pendientes) |
| PREG-016 | La zona roja de un ticket sin pedido cuenta los 20 min desde la creación del ticket (siempre vencida para un cliente recurrente). ¿Debe contar desde el primer mensaje de hoy? | ORD | Medio | `modulos/ORD.md` (§ 3 Pendientes) |
| PREG-017 | Dos ediciones o cambios de estado simultáneos del mismo pedido pueden dejar un historial que describe un 'antes' falso. ¿Se acepta o se agrega guarda de versión? | ORD | Medio | `modulos/ORD.md` (§ 3 Pendientes) |
| PREG-018 | El marcador `pasado_manana:` vive en `notes`, que el personal edita; un texto igual a mano crearía un pedido fantasma. ¿Se protege o se guarda en su propio campo? | ORD, CAJ | Medio | `modulos/ORD.md` (§ 3 Pendientes) |
| PREG-019 | `order:updated` de cambio de estado y restaurar omite las banderas 'cambió el cliente' y podría borrar la etiqueta en el navegador. ¿Deben incluirlas? | ORD | Bajo | `modulos/ORD.md` (§ 3 Pendientes) |

## WPP — WhatsApp entrante y mensajes automáticos

| ID | Pregunta | Módulo(s) | Impacto | Detalle |
|---|---|---|---|---|
| PREG-020 | Cada mensaje sin remitente genera un ticket 'sin número' distinto. ¿Se agrupan o se acepta por lo raro del caso? | WPP | Bajo | `modulos/WPP.md` (§ 3 Pendientes) |
| PREG-021 | El nombre de perfil de WhatsApp pisa el nombre que el admin puso a mano en el siguiente mensaje. ¿Se conserva el nombre editado? | WPP, INB | Bajo | `modulos/WPP.md` (§ 3 Pendientes) |
| PREG-022 | El aviso de privacidad (Ley 1581) solo sale si hay `welcome_message` y no hay redirección, y los pedidos a mano no registran consentimiento. ¿Debe enviarse aparte y basta para la ley? | WPP, GEN | Alto | `02-tecnico/seguridad-y-privacidad.md` (Preguntas/Pendientes); `modulos/WPP.md` (§ 3 Pendientes) |
| PREG-023 | `wpp_redirect_message` solo se cambia por API o base; ninguna pantalla lo muestra aunque desactiva la bienvenida. ¿Se agrega a Configuración/DevTools? | WPP, OPS | Medio | `04-operacion/runbooks.md` (Preguntas/Pendientes); `modulos/WPP.md` (§ 3 Pendientes) |
| PREG-024 | En una falla de Meta cada primer mensaje deja una bienvenida con X roja y el aviso de privacidad se reintenta a diario, sin alertar a nadie. ¿Se agrega alerta o se deja de registrar el fallo automático? | WPP | Medio | `modulos/WPP.md` (§ 3 Pendientes) |
| PREG-025 | Entre las 21:00 y la medianoche, el chat queda en el tablero de mañana pero el pedido del formulario se crea con la fecha de hoy. ¿Es lo esperado? | WPP, FRM, ORD, DSH | Medio | `modulos/FRM.md` (§ 3 Pendientes); `modulos/WPP.md` (§ 3 Pendientes) |
| PREG-026 | El segundo mensaje de la noche devuelve el chat al día real (hoy), contra lo que dice el commit 55de2fc. ¿Cuál es la intención? | WPP | Medio | `modulos/WPP.md` (§ 3 Pendientes) |
| PREG-027 | Un cliente que escribe a las 21:30 y a las 00:10 recibe dos bienvenidas para el mismo día de negocio. ¿Debe el 'primer mensaje del día' usar también el corte? | WPP | Medio | `modulos/WPP.md` (§ 3 Pendientes) |
| PREG-028 | Un mensaje después del cierre borra `deferred_to` y saca el chat del tablero de mañana. ¿Debe respetar el día cerrado? | WPP, CAJ | Medio | `modulos/WPP.md` (§ 3 Pendientes) |
| PREG-029 | 'Formulario enviado' se muestra aunque Meta rechace los mensajes (la API responde 201 antes de enviar). ¿Se acepta? | WPP, INB | Medio | `modulos/WPP.md` (§ 3 Pendientes) |
| PREG-030 | Los botones Formulario/Cuenta banco se desactivan en días pasados o con caja cerrada solo en la interfaz; la API envía siempre. ¿Debe la API aplicar la regla? | WPP, INB | Medio | `modulos/INB.md` (§ 3 Pendientes); `modulos/WPP.md` (§ 3 Pendientes) |
| PREG-031 | Mensajes `text` sin cuerpo o tipos sin su campo se descartan sin log, y quitar una reacción aparece como 'tipo no soportado'. ¿Se registran o se ignoran a propósito? | WPP | Bajo | `modulos/WPP.md` (§ 3 Pendientes) |
| PREG-032 | El webhook descarta mensajes de más de 10 min (reintentos de Meta tras una caída) sin rastro en la base y con el teléfono en el log. ¿Es aceptable o se guardan marcados como tardíos? | WPP, GEN | Medio | `02-tecnico/integraciones.md` (Preguntas/Pendientes) |
| PREG-033 | La firma HMAC usa solo el `META_APP_SECRET` global; `Organization.wpp_meta_app_secret` no se usa. ¿Todas las organizaciones compartirán siempre la misma App de Meta? | WPP, GEN | Medio | `02-tecnico/integraciones.md` (Preguntas/Pendientes) |
| PREG-034 | Sin plantillas de Meta, fuera de la ventana de 24 h el negocio no puede escribirle al cliente desde el sistema. ¿Limitación aceptada o pendiente? | WPP, INB, GEN | Medio | `02-tecnico/integraciones.md` (Preguntas/Pendientes) |

## INB — Chats

| ID | Pregunta | Módulo(s) | Impacto | Detalle |
|---|---|---|---|---|
| PREG-035 | La seguridad de links por intentos fallidos y por `device_token`/`FormLinkSession` es código inerte que los comentarios describen como activo. ¿Se elimina todo o se restablece una protección (p. ej. límite de aperturas por link)? | INB, FRM, FAC, GEN | Alto | `02-tecnico/datos-y-migraciones.md` (Preguntas/Pendientes); `02-tecnico/seguridad-y-privacidad.md` (Preguntas/Pendientes); `modulos/FAC.md` (§ 3 Pendientes); `modulos/FRM.md` (§ 3 Pendientes); `modulos/INB.md` (§ 3 Pendientes) |
| PREG-036 | `POST /tickets` no lo usa ninguna pantalla ni tiene test, y mezcla dos días distintos. ¿Se borra o se conserva para alguna integración? | INB | Bajo | `modulos/INB.md` (§ 3 Pendientes) |
| PREG-037 | 'Borrar datos del cliente' deja datos personales en `order_history`, observaciones, `Order.notes` y los PDF de factura en R2. ¿Se acepta ante la Ley 1581 o se borran/redactan? | INB, FAC, GEN | Alto | `02-tecnico/seguridad-y-privacidad.md` (Preguntas/Pendientes); `modulos/FAC.md` (§ 3 Pendientes); `modulos/INB.md` (§ 3 Pendientes) |
| PREG-038 | Reenviar con el archivo vencido crea una fila fallida que `forwarded` cuenta como reenviada. ¿Debe distinguirse o abortar todo? | INB | Bajo | `modulos/INB.md` (§ 3 Pendientes) |
| PREG-039 | La bandeja muestra máximo 500 chats sin paginación (`page` se ignora). ¿Es suficiente? | INB | Bajo | `modulos/INB.md` (§ 3 Pendientes) |
| PREG-040 | El encargado (y el domiciliario) no ven la bandeja pero desde un ticket pueden leer 500 mensajes, responder, reenviar y bloquear links. ¿Es el alcance buscado? | INB, ACC | Medio | `modulos/INB.md` (§ 3 Pendientes) |
| PREG-041 | Responder pone `unread_count = 0` aunque el envío falle después con `failed_reason`; el chat queda 'atendido' sin que el cliente reciba nada. ¿Se mantiene? | INB | Medio | `modulos/INB.md` (§ 3 Pendientes) |
| PREG-042 | `erase-data` filtra por la organización del dev, no por la del ticket. ¿Cómo se atiende una solicitud de supresión de un cliente de otra organización? | INB, PLT, GEN | Alto | `02-tecnico/seguridad-y-privacidad.md` (Preguntas/Pendientes) |

## IA — Tomar lista

| ID | Pregunta | Módulo(s) | Impacto | Detalle |
|---|---|---|---|---|
| PREG-043 | El cruce de productos es una 'primera heurística' sin calibrar (plural ingenuo, contención que une 'uvas' con 'Uchuva' sin marca de revisión). ¿Se calibra con datos reales? | IA | Bajo | `modulos/IA.md` (§ 3 Pendientes) |
| PREG-044 | Enfriamiento y lista de modelos viven en memoria y un 429 por cupo no enfría. ¿Es aceptable con más de un contenedor? | IA | Medio | `modulos/IA.md` (§ 3 Pendientes) |
| PREG-045 | La suma de timeouts puede llegar a ~182 s sin tope total y el cliente web no tiene timeout. ¿Se pone un presupuesto total? | IA | Medio | `modulos/IA.md` (§ 3 Pendientes) |
| PREG-046 | Nada verifica que la IA devolvió todos los productos ('de 20 solo procesó 7') y la interfaz dice 'Lista montada exitosamente'. ¿Se advierte o basta 'Recuerda revisar todo'? | IA | Medio | `modulos/IA.md` (§ 3 Pendientes) |
| PREG-047 | Desde el cierre de caja 'Tomar lista' sigue activo pero sus manejadores no están conectados y los ítems se pierden. ¿Se oculta el botón o se conecta? | IA, CAJ | Medio | `modulos/IA.md` (§ 3 Pendientes) |
| PREG-048 | No hay medición de uso/costo ni tope por organización de la IA. ¿Hace falta antes de crecer a más negocios? | IA | Medio | `modulos/IA.md` (§ 3 Pendientes) |
| PREG-049 | 'Tomar lista' se puede usar en pedidos de solo lectura (papelera, eliminado por el cliente, bloqueado) sin que aparezca 'Guardar'. ¿Se desactiva el botón? | IA, ORD | Bajo | `modulos/IA.md` (§ 3 Pendientes) |
| PREG-050 | El enfriamiento de 90 s también se activa con errores sin status HTTP (JSON roto, esquema), contra el comentario del código. ¿Es intencional? | IA, GEN | Bajo | `02-tecnico/integraciones.md` (Preguntas/Pendientes) |
| PREG-051 | 'Tomar lista' manda texto literal de clientes a proveedores de IA gratuitos fuera de Colombia que la política de privacidad no menciona. ¿Se aceptó este tratamiento bajo la Ley 1581? | IA, GEN | Alto | `02-tecnico/integraciones.md` (Preguntas/Pendientes) |

## FRM — Formulario público

| ID | Pregunta | Módulo(s) | Impacto | Detalle |
|---|---|---|---|---|
| PREG-052 | El producto agotado (`in_stock = false`) se puede pedir en el formulario del cliente; el aviso 'NO HAY' solo llega por el catálogo de WhatsApp. ¿Debe esconderse o marcarse? | FRM, CAT | Medio | `modulos/CAT.md` (§ 3 Pendientes); `modulos/FRM.md` (§ 3 Pendientes) |
| PREG-053 | Las rutas públicas ponen CORS `*` pero el plugin global ya rechaza orígenes no listados. ¿Cuál es la intención y qué cabecera gana? | FRM | Bajo | `modulos/FRM.md` (§ 3 Pendientes) |
| PREG-054 | El tope de 30 mensajes automáticos por 24 h casi no limita (los enviados por personal no cuentan). ¿Se ajusta o se acepta con los otros límites? | FRM | Medio | `modulos/FRM.md` (§ 3 Pendientes) |
| PREG-055 | La edición del formulario reemplaza los ítems sin transacción ni versión; dos pestañas pueden pisarse. ¿Se acepta? | FRM | Bajo | `modulos/FRM.md` (§ 3 Pendientes) |

## ACC — Cuentas, roles y acceso

| ID | Pregunta | Módulo(s) | Impacto | Detalle |
|---|---|---|---|---|
| PREG-056 | El login no aplica la política de contraseña (por diseño) y el usuario no puede cambiar la suya. ¿Se quiere cambio propio o expiración de las viejas? | ACC | Medio | `modulos/ACC.md` (§ 3 Pendientes) |
| PREG-057 | Las cuentas `dev` solo se crean con `POST /dev/seed` (deshabilitado en producción). ¿Cómo se crea o recupera una cuenta dev en producción? | ACC, PLT | Medio | `modulos/ACC.md` (§ 3 Pendientes) |
| PREG-058 | Un admin puede cambiarse el rol o dejar la organización sin admin activo. ¿Se impide? | ACC | Medio | `modulos/ACC.md` (§ 3 Pendientes) |
| PREG-059 | El email de un usuario desactivado queda ocupado y no se puede reutilizar. ¿Es lo deseado? | ACC | Bajo | `modulos/ACC.md` (§ 3 Pendientes) |
| PREG-060 | Cambiar el email de un usuario no revoca sus sesiones y la auditoría guarda el cuerpo recibido tal cual. ¿Se corrige? | ACC | Medio | `modulos/ACC.md` (§ 3 Pendientes) |
| PREG-061 | Los empleados desactivados no se pueden reactivar ni ver. ¿Se necesita reactivar? | ACC | Bajo | `modulos/ACC.md` (§ 3 Pendientes) |
| PREG-062 | El botón de desactivar aparece en la fila propia aunque la API responde 400. ¿Se oculta? | ACC | Bajo | `modulos/ACC.md` (§ 3 Pendientes) |
| PREG-063 | **Parcialmente respondida (D-10, `roadmap.md` #19):** José planea el inicio de sesión con nombre de usuario más adelante, por pasos. **Sigue abierto:** mientras tanto, ¿se oculta el campo, que se muestra y guarda pero no sirve para entrar? | ACC | Medio | `modulos/ACC.md` (§ 3 Pendientes) |
| PREG-064 | `REQUIRE_2FA=false` (texto) activa el 2FA por `z.coerce.boolean()`. ¿Se corrige el parseo o se documenta que debe quedar vacía? | ACC, GEN, OPS | Alto | `02-tecnico/arquitectura.md` (Preguntas/Pendientes); `02-tecnico/seguridad-y-privacidad.md` (Preguntas/Pendientes) |
| PREG-065 | Desactivar o bajar de rol a un usuario no invalida su access token hasta 15 min. ¿Se acepta o `authenticate` consulta `active`/`role`? | ACC, GEN | Alto | `02-tecnico/seguridad-y-privacidad.md` (Preguntas/Pendientes) |
| PREG-066 | `/login/verify-code` no respeta `locked_until`. ¿Debe cortar también durante el bloqueo? | ACC, GEN | Medio | `02-tecnico/seguridad-y-privacidad.md` (Preguntas/Pendientes) |
| PREG-067 | `POST /tickets` (cualquier rol) sobrescribe `customer_name` de un ticket existente, esquivando el `PATCH` solo de admin. ¿Es intencional? | ACC, INB, GEN | Medio | `02-tecnico/seguridad-y-privacidad.md` (Preguntas/Pendientes) |

## CAT — Catálogo

| ID | Pregunta | Módulo(s) | Impacto | Detalle |
|---|---|---|---|---|
| PREG-068 | El catálogo dice 'Precios actualizados al <hoy>' aunque nadie los haya revisado hoy. ¿La fecha debe ser la última edición real? | CAT | Bajo | `modulos/CAT.md` (§ 3 Pendientes) |
| PREG-069 | No hay forma de reactivar ni ver un producto desactivado, y se pueden crear duplicados por nombre. ¿Se necesita reactivar? | CAT | Bajo | `modulos/CAT.md` (§ 3 Pendientes) |
| PREG-070 | La API acepta precio negativo y nombres repetidos (el lote y la interfaz no). ¿Debe validar? | CAT | Medio | `modulos/CAT.md` (§ 3 Pendientes) |
| PREG-071 | La carga de Excel lee '12.500' como 12,5 y '1,5' como 1 (separadores colombianos). ¿Se acepta? | CAT | Medio | `modulos/CAT.md` (§ 3 Pendientes) |
| PREG-072 | El nombre del Excel usa la fecha UTC (entre 19:00 y 23:59 Bogotá sale el día siguiente). ¿Se corrige? | CAT | Bajo | `modulos/CAT.md` (§ 3 Pendientes) |
| PREG-073 | La carga rechaza más de 500 filas sin explicar cómo partir el archivo. ¿Se parte en la web? | CAT | Bajo | `modulos/CAT.md` (§ 3 Pendientes) |

## DSH — Informe del día

| ID | Pregunta | Módulo(s) | Impacto | Detalle |
|---|---|---|---|---|
| PREG-074 | 'Cerrados/Cobrados' cuenta pedidos cerrados sin cobrar (crédito sin pagar, cerrado sin cobro). ¿Se separan 'cobrados' de 'cerrados'? | DSH | Medio | `modulos/DSH.md` (§ 3 Pendientes) |
| PREG-075 | 'Chats con pedidos completados' incluye créditos pendientes y cerrados sin cobro. ¿Es la intención? | DSH | Medio | `modulos/DSH.md` (§ 3 Pendientes) |
| PREG-076 | El informe con `fecha` inválida da error de servidor y sin `fecha` usa el día UTC. ¿Se valida y se alinea con Bogotá? | DSH | Medio | `modulos/DSH.md` (§ 3 Pendientes) |
| PREG-077 | El contador 'Cambios (N)' se corta en 300 sin avisar. ¿Se avisa o se pagina? | DSH | Bajo | `modulos/DSH.md` (§ 3 Pendientes) |
| PREG-078 | El aviso/barra del día 1 sale a todo admin/dev haya pagado o no y no corresponde a ningún corte automático por impago. ¿Debe leer los cobros de plataforma y existe o se planea un corte? | DSH, PLT | Medio | `modulos/DSH.md` (§ 3 Pendientes); `modulos/PLT.md` (§ 3 Pendientes) |
| PREG-079 | La pestaña Crédito trae todos los créditos de la historia cada 30 s. ¿Se limita o se pagina? | DSH | Bajo | `modulos/DSH.md` (§ 3 Pendientes) |

## FAC — Facturas

| ID | Pregunta | Módulo(s) | Impacto | Detalle |
|---|---|---|---|---|
| PREG-080 | `POST /invoice` acepta pedidos cerrados, en papelera, sin ítems o cobrados; solo la interfaz lo impide. ¿Debe la API repetir las condiciones? | FAC, ORD | Medio | `modulos/FAC.md` (§ 3 Pendientes) |
| PREG-081 | Si la subida a R2 falla, el pedido queda sin factura válida y la nueva apunta a un archivo inexistente. ¿Se reordena (subir primero) o se acepta? | FAC | Alto | `modulos/FAC.md` (§ 3 Pendientes) |
| PREG-082 | Una factura enviada sigue abriéndose hasta 24 h aunque el pedido se cobre o vaya a papelera. ¿Debe revocar también el cobro, la papelera o el cierre? | FAC, CAJ | Medio | `modulos/FAC.md` (§ 3 Pendientes) |
| PREG-083 | La factura se arma con la pantalla sin guardar, así que puede enviarse un PDF con datos no guardados. ¿Se exige guardar antes de enviar? | FAC | Medio | `modulos/FAC.md` (§ 3 Pendientes) |
| PREG-084 | Cada reenvío crea otro PDF permanente y nada borra los vencidos. ¿Hace falta política de retención? | FAC | Medio | `modulos/FAC.md` (§ 3 Pendientes) |

## PLT — Plataforma

| ID | Pregunta | Módulo(s) | Impacto | Detalle |
|---|---|---|---|---|
| PREG-085 | El dev lee datos personales de cualquier negocio sin motivo ni tope y solo queda `dev.db_read` sin el contenido. ¿Basta ese rastro (Ley 1581) o se enmascaran por defecto? | PLT | Alto | `modulos/PLT.md` (§ 3 Pendientes) |
| PREG-086 | El PDF de un cobro puede quedar vacío sin aviso y `report_url` se sobrescribe con `null` si R2 falla. ¿Debe fallar y conservar la URL anterior? | PLT | Medio | `modulos/PLT.md` (§ 3 Pendientes) |
| PREG-087 | El dev puede editar o borrar un cobro ya pagado. ¿Debe bloquearse? | PLT | Medio | `modulos/PLT.md` (§ 3 Pendientes) |
| PREG-088 | 'Marcar pagado' no se puede deshacer en la interfaz y 'al día' no compara el mes cubierto. ¿Debe mirar el mes? | PLT | Bajo | `modulos/PLT.md` (§ 3 Pendientes) |
| PREG-089 | El primer admin recibe la contraseña que escribió el dev, visible en pantalla y sin cambio forzado. ¿Se genera aleatoria o se obliga a cambiarla? | PLT, ACC | Medio | `modulos/PLT.md` (§ 3 Pendientes) |
| PREG-090 | Reabrir cierres y el seed (que resetea contraseñas del negocio fijo) no se auditan, solo un `warn`. ¿Se auditan? | PLT, CAJ | Medio | `modulos/PLT.md` (§ 3 Pendientes) |
| PREG-091 | `RENAME_TICKET_UI_ENABLED = false` esconde renombrar el chat aunque la API lo permite al admin. ¿Se reactiva o se retira? | PLT, INB | Bajo | `modulos/PLT.md` (§ 3 Pendientes) |

## GEN — Transversales (técnico)

| ID | Pregunta | Módulo(s) | Impacto | Detalle |
|---|---|---|---|---|
| PREG-092 | ¿Qué versión de PostgreSQL corre en producción? El README dice 15, local y CI usan 16 y el respaldo instala el cliente 18. | GEN, OPS | Medio | `02-tecnico/arquitectura.md` (Preguntas/Pendientes); `02-tecnico/calidad-y-pruebas.md` (Preguntas/Pendientes) |
| PREG-093 | La sala `join:date` no la usa ningún emisor. ¿Se elimina o se planea usar? | GEN | Bajo | `02-tecnico/api-y-eventos.md` (Preguntas/Pendientes) |
| PREG-094 | `order:updated` desde `tickets.ts › PATCH /:id` manda solo `{ id }` con `as any`. ¿Se ajusta el tipo o el emisor? | GEN | Bajo | `02-tecnico/api-y-eventos.md` (Preguntas/Pendientes) |
| PREG-095 | ¿El bucket de R2 permite lectura pública? Si sí, `invoices/` se descarga sin el control de 24 h ni la revocación. | GEN, FAC | Medio | `02-tecnico/integraciones.md` (Preguntas/Pendientes) |
| PREG-096 | Sentry usa `NODE_ENV` (`production` en todos los despliegues). ¿Debe usar `APP_ENVIRONMENT_NAME`? | GEN, OPS | Bajo | `02-tecnico/integraciones.md` (Preguntas/Pendientes) |
| PREG-097 | No hay purga automática de datos personales (mensajes, `raw_payload`, pedidos, `audit_logs`). ¿Cuál es el plazo de retención según la política? | GEN | Alto | `02-tecnico/seguridad-y-privacidad.md` (Preguntas/Pendientes) |
| PREG-098 | La auditoría no registra bloqueos de links, catálogo y precios, empleados ni `/dev/seed`. ¿Hace falta? | GEN | Medio | `02-tecnico/seguridad-y-privacidad.md` (Preguntas/Pendientes) |
| PREG-099 | El respaldo promete independencia de Cloudflare pero el destino es R2. ¿Se acepta o hace falta una segunda copia? ¿Cuál es el plazo del ciclo de vida? | GEN, OPS | Medio | `02-tecnico/calidad-y-pruebas.md` (Preguntas/Pendientes) |
| PREG-100 | El job de test de CI no define `META_WEBHOOK_VERIFY_TOKEN` que el test del handshake necesita. ¿CI está pasando hoy? | GEN, OPS | Medio | `02-tecnico/calidad-y-pruebas.md` (Preguntas/Pendientes) |

## OPS — Operación

| ID | Pregunta | Módulo(s) | Impacto | Detalle |
|---|---|---|---|---|
| PREG-101 | ¿El health check de Coolify usa `GET /health`, que no toca la base? | OPS | Medio | `04-operacion/entornos-y-despliegue.md` (Preguntas/Pendientes) |
| PREG-102 | ¿En qué entorno está `REQUIRE_2FA=true`? El commit habla de prod y `LoginPage.tsx` dice 'dev-only'. | OPS, ACC | Medio | `04-operacion/entornos-y-despliegue.md` (Preguntas/Pendientes) |
| PREG-103 | ¿Qué variables opcionales (Meta, R2, IA, Resend, Sentry) tiene cada app y dev y prod usan buckets de archivos distintos? | OPS | Medio | `04-operacion/entornos-y-despliegue.md` (Preguntas/Pendientes) |
| PREG-104 | Con la GitHub App como fuente, ¿el auto-deploy de dev llega por el webhook manual o por la App? ¿Se elimina el webhook manual de prod? | OPS | Medio | `04-operacion/entornos-y-despliegue.md` (Preguntas/Pendientes) |
| PREG-105 | ¿Cloudflare Pages construye vistas previas de ramas distintas de `dev` que hablarían con la API de prod? | OPS | Bajo | `04-operacion/entornos-y-despliegue.md` (Preguntas/Pendientes) |
| PREG-106 | ¿Alcanza el cupo de minutos de Actions del plan con el repo privado? | OPS | Bajo | `04-operacion/entornos-y-despliegue.md` (Preguntas/Pendientes) |
| PREG-107 | El `README.md` lista `JWT_REFRESH_SECRET` (inexistente) y recomienda `VITE_API_URL` en Pages (contradice `apiBase.ts`). ¿Se corrige? | OPS | Bajo | `04-operacion/entornos-y-despliegue.md` (Preguntas/Pendientes) |
| PREG-108 | `apps/api/.env.example` trae `NODE_ENV="production"`. ¿Es intencional o se cambia a `development`? | OPS | Bajo | `04-operacion/desarrollo-local.md` (Preguntas/Pendientes) |
| PREG-109 | El `.env.example` de la raíz duplica variables viejas y nada lo lee. ¿Se borra? | OPS | Bajo | `04-operacion/desarrollo-local.md` (Preguntas/Pendientes) |
| PREG-110 | `seed-chats.ts` usa la fecha fija 2026-06-27. ¿Se adapta a hoy o se retira? | OPS | Bajo | `04-operacion/desarrollo-local.md` (Preguntas/Pendientes) |
| PREG-111 | El procedimiento de restauración nunca se probó. ¿Se agenda un simulacro y cuántos días retiene el ciclo de vida del bucket de respaldos? | OPS | Medio | `04-operacion/runbooks.md` (Preguntas/Pendientes) |
| PREG-112 | José dijo que rotar `JWT_SECRET` desloguea a todos; el código sugiere que no. ¿Cuál es el comportamiento deseado? | OPS | Medio | `04-operacion/runbooks.md` (Preguntas/Pendientes) |
| PREG-113 | No hay script para rotar `WPP_TOKEN_ENC_KEY`. ¿Se crea o basta el procedimiento manual? | OPS | Bajo | `04-operacion/runbooks.md` (Preguntas/Pendientes) |

## HIS — Historia y decisiones

| ID | Pregunta | Módulo(s) | Impacto | Detalle |
|---|---|---|---|---|
| PREG-114 | ¿Qué día exacto se movió la base y el backend de producción de Railway al VPS con Coolify? | HIS | Bajo | `05-historia/cronologia.md` (Preguntas/Pendientes) |
| PREG-115 | ¿Cuándo y cómo se resolvió el incidente de Meta del 2026-10-07 y cuántos mensajes se perdieron? | HIS | Bajo | `05-historia/cronologia.md` (Preguntas/Pendientes) |
| PREG-116 | ¿Es correcto que la puesta en vivo fue el 2026-07-25 (el primer merge posterior a `main` es del 07-26)? | HIS | Bajo | `05-historia/cronologia.md` (Preguntas/Pendientes) |
| PREG-117 | No hay commits en mayo. ¿Hubo trabajo previo (otro repo, mockup) que deba mencionarse? | HIS | Bajo | `05-historia/cronologia.md` (Preguntas/Pendientes) |
| PREG-118 | **Respondida (D-02):** cada línea guarda el total de ese producto y el total del pedido es la suma de las líneas. | HIS | Respondida | `05-historia/decisiones.md` (Preguntas/Pendientes) |
| PREG-119 | **Respondida (D-06):** precio y control; Cloudflare le parece más robusto y profesional que Vercel. | HIS | Respondida | `05-historia/decisiones.md` (Preguntas/Pendientes) |
| PREG-120 | **Respondida (D-10):** simplicidad para el primer cliente; el 2FA de admins y el login por nombre de usuario vienen después. | HIS | Respondida | `05-historia/decisiones.md` (Preguntas/Pendientes) |
| PREG-121 | **Respondida (D-12):** fue la solución de momento; podría pasar al servidor más adelante. | HIS | Respondida | `05-historia/decisiones.md` (Preguntas/Pendientes) |
| PREG-122 | **Respondida (D-17):** hoy José opera la plataforma; se abrirá al administrador de cada negocio cuando haya más clientes. | HIS | Respondida | `05-historia/decisiones.md` (Preguntas/Pendientes) |

## Nuevas (revisión de completitud, 2026-10-09)

| ID | Pregunta | Módulo(s) | Impacto | Dónde está el detalle |
|---|---|---|---|---|
| PREG-123 | Un aviso (toast) nuevo no cancela el temporizador del anterior: si llegan dos seguidos, el segundo puede desaparecer antes de 2,8 s. ¿Se corrige? | ACC | Bajo | `modulos/ACC.md` (RN-ACC-26) |
| PREG-124 | La lista de empleados se guarda en caché 5 min (el resto de la web, 30 s): un domiciliario recién creado o desactivado tarda en verse en otra pestaña abierta. ¿Es aceptable? | ACC, ORD | Bajo | `modulos/ACC.md` (RN-ACC-25) |
| PREG-125 | `reencrypt-wpp-tokens.ts` omite en silencio una organización cuya clave no puede descifrar, y `seed-wpp.ts` escribe sobre la primera organización que encuentra. ¿Se protegen estos scripts? | PLT, WPP | Medio | `modulos/PLT.md` (RN-PLT-20) |
| PREG-126 | Sin `WPP_TOKEN_ENC_KEY` fuera de producción los tokens se guardan en texto plano (solo un aviso en consola). ¿Staging también lo asume? | WPP | Medio | `modulos/WPP.md` (RN-WPP-30) |
| PREG-127 | `DevWppPanel` y `PATCH /config/wpp` actúan solo sobre la organización de la sesión: no hay pantalla para configurar WhatsApp de otro negocio. ¿Cómo se hará al dar de alta el segundo cliente? | PLT, WPP | Medio | `04-operacion/alta-de-negocio.md` |
| PREG-128 | No hay forma en la interfaz de desactivar una organización (el login ya rechaza `active = false`). ¿Hace falta? | PLT, ACC | Medio | `04-operacion/alta-de-negocio.md` |
| PREG-129 | Un hotfix urgente no se puede aislar: `main` recibe todo lo que hay en `dev`. ¿Se acepta, o se define un flujo de hotfix? | flujo | Medio | `04-operacion/flujo-de-trabajo.md` |
| PREG-130 | Socket.IO usa salas en memoria sin adaptador: con más de una réplica de la API los eventos en tiempo real no llegarían a todos. ¿Se escala a más de una réplica alguna vez? | PLT, ACC | Bajo | `02-tecnico/arquitectura.md` |
| PREG-131 | Una vista previa de Cloudflare Pages con otro host que `dev.*.pages.dev` llamaría a la API de producción. ¿Se restringe? | PLT | Medio | `02-tecnico/modelo-de-amenazas.md` |
| PREG-132 | `PATCH /config/wpp` no emite evento de socket: otros usuarios conectados no ven el cambio hasta recargar. ¿Es intencional? | WPP | Bajo | `modulos/WPP.md` |
| PREG-133 | El bloqueo de cuenta (5/15/60 min) permite que alguien anónimo que conozca el correo de un admin lo bloquee hasta 1 h. ¿Se acepta? | ACC | Medio | `02-tecnico/modelo-de-amenazas.md` |
| PREG-134 | No hay canal ni registro de solicitudes de titulares (acceso, rectificación) ni procedimiento de notificación de brechas a la SIC. ¿Quién y cómo? | PLT | Alto | `02-tecnico/datos-personales.md` |
| PREG-135 | La política publicada dice datos "protegidos con cifrado"; en el código solo se cifran los tokens de Meta. ¿Se ajusta el texto o se cifra más? | PLT | Alto | `02-tecnico/datos-personales.md` |
| PREG-136 | Sentry se inicializa sin filtro de datos personales (`beforeSend`) y recibe también los 4xx de validación. ¿Se filtra? | PLT | Medio | `04-operacion/observabilidad-y-continuidad.md` |

Total: 136 preguntas (las respondidas por José están marcadas "Respondida").
