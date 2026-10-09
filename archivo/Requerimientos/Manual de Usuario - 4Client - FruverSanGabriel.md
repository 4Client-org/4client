| Manual de Usuario \- Sistema 4Client |
| :---: |

| Preparado por: | Jose Alvarez Marin - 4Client |
| :---- | :---- |
| **Para:** | Fruver San Gabriel |
| **Versión:** | 1.0 |

# Índice

1. Introducción
2. Roles y accesos
3. El tablero principal (Kanban)
4. Chats de WhatsApp
5. Crear un pedido manualmente
6. El formulario del cliente (el "link")
7. Detalle de un pedido
8. Cierre de caja
9. Informe del día
10. Configuración (solo administrador)
11. Tabla de permisos por rol
12. Preguntas frecuentes e importantes

---

# 1. Introducción

4Client es el sistema con el que se gestionan todos los pedidos del negocio: los que llegan por WhatsApp, los que se toman por teléfono o en persona, y los que el propio cliente arma desde un link de formulario que se le envía.

Todo el negocio funciona alrededor de tres ideas simples:

- **Un tablero** que muestra en qué va cada pedido del día (nuevo, preparando, listo, en camino, entregado).
- **Un chat de WhatsApp integrado**, donde se ve y se responde a cada cliente sin salir del sistema.
- **Un cierre de caja diario**, que congela el día, cuadra el dinero recibido y no deja pedidos sueltos sin resolver.

Este manual explica cada parte, en el orden en que normalmente se usan durante el día.

---

# 2. Roles y accesos

Cada persona que usa el sistema entra con su propio usuario y contraseña. El sistema reconoce tres roles:

| Rol | Para quién es |
| :---- | :---- |
| **Administrador** | El dueño del negocio. Ve y controla todo: pedidos, chats, cierre de caja, informe del día, configuración, usuarios. |
| **Encargado** | La persona que atiende el mostrador o coordina el día a día. Puede crear y gestionar pedidos, mover el tablero, cerrar caja. No entra a Configuración ni ve el Informe del día. |
| **Domiciliario** | El repartidor. Puede ver el tablero de pedidos, abrir chats y pedidos para consultar la información, responder mensajes y enviar/bloquear el link de formulario de un cliente puntual. **No puede** mover pedidos de estado, cobrar, crear pedidos nuevos, ni cerrar caja — esas acciones están reservadas a Administrador y Encargado. |

La sesión se cierra sola después de un tiempo sin actividad, por seguridad. Cada usuario solo ve la información de su propio negocio (nunca la de otro negocio que también use 4Client).

**Nota:** hoy la pantalla no oculta los botones de mover pedido/cobrar para el domiciliario — si los presiona, el sistema simplemente rechaza la acción con un mensaje de "acceso denegado", en vez de no mostrárselos. No es un error de datos ni un riesgo de seguridad (el rechazo pasa igual), pero puede resultar confuso para esa persona. Se puede ajustar más adelante si se quiere que directamente no vea esos botones.

---

# 3. El tablero principal (Kanban)

Es la pantalla principal. Muestra los pedidos del día seleccionado organizados en columnas por estado:

**Nuevo → Preparando → Listo → En camino → Entregado**

- Cada tarjeta es un pedido: muestra número, cliente, y un contador de minutos desde que se creó. Si un pedido lleva más de 20 minutos sin moverse, se marca en rojo para llamar la atención.
- Los pedidos se mueven de columna arrastrándolos, o abriendo el pedido y usando los botones de "Mover pedido".
- Arriba hay un selector de fecha: por defecto muestra **hoy**, pero se puede navegar a días anteriores para consultar el historial. Los días ya cerrados se ven en modo solo lectura (más adelante se explica el cierre de caja).
- Los chats de WhatsApp asociados a pedidos del día también aparecen en el tablero, agrupados junto a su pedido.
- Arriba también hay un buscador para filtrar pedidos o chats por nombre.

**Importante:** un chat abierto en un día muestra únicamente los pedidos de **ese** día. Si un cliente escribió ayer y también hoy, el pedido de ayer no se mezcla con el de hoy — cada día ve lo suyo.

---

# 4. Chats de WhatsApp

## 4.1 Bandeja de entrada

Solo el administrador tiene acceso a la pestaña "Chats WhatsApp", que lista todas las conversaciones activas, ordenadas por el mensaje más reciente. Desde ahí se puede leer el historial completo y responder directamente, sin usar el celular.

## 4.2 Mensaje de bienvenida automático

Si el negocio tiene configurado un mensaje de bienvenida, se envía automáticamente **la primera vez que un cliente escribe en el día**. Si ese mismo cliente vuelve a escribir más tarde el mismo día, no se le repite. Al día siguiente, si vuelve a escribir, sí se le envía de nuevo (es "una vez por cliente, por día", no "una vez por cliente para siempre").

## 4.3 La ventana de 24 horas de WhatsApp (muy importante)

WhatsApp tiene una regla que **no depende de 4Client, es de WhatsApp mismo**: el negocio solo puede responder libremente a un cliente durante **24 horas después de su último mensaje**. Pasado ese tiempo sin que el cliente vuelva a escribir, un mensaje normal de texto ya no se entrega.

En la práctica:

- Mientras el cliente esté "dentro de la ventana" (te escribió en las últimas 24h), se le puede responder cuanto se quiera, sin costo.
- Si pasan más de 24 horas sin que el cliente escriba, y el negocio le escribe primero, ese mensaje puede no llegar.
- En cuanto el cliente vuelve a escribir (aunque hayan pasado semanas), se abre una ventana nueva y todo vuelve a funcionar normal.

Si un mensaje no se pudo entregar por esta razón, el sistema avisa con un mensaje en pantalla ("falló el envío a WhatsApp"). Si eso pasa, lo más seguro es esperar a que el cliente escriba de nuevo, o contactarlo por otro medio.

---

# 5. Crear un pedido manualmente

Cuando un pedido no llega por el link del formulario (por ejemplo, alguien llama por teléfono o pide en el mostrador), se crea manualmente:

1. Se abre el chat del cliente (o se crea uno nuevo) y se elige "Crear pedido".
2. Se completa nombre del cliente, teléfono, método de pago y domiciliario (todo esto se puede dejar en blanco y completar después).
3. **La dirección ya no es obligatoria para crear el pedido** — solo se pide en el momento de cerrarlo (cobrarlo). Esto permite registrar el pedido rápido y completar los datos con calma después. Mientras no se complete, en el pedido aparece "Pendiente de confirmar" como recordatorio de que falta ese dato.
4. Se agregan los productos: buscándolos en el catálogo, o usando el campo de **"producto manual"** al final de la lista si el producto todavía no está cargado en el catálogo (se escribe nombre, cantidad y precio a mano). Esto funciona sin importar en qué estado esté el pedido.
5. Métodos de pago disponibles: **Transferencia**, **Pagado en tienda** (efectivo) y **Cobro en casa** (el domiciliario cobra al entregar).

---

# 6. El formulario del cliente (el "link")

Esta es una de las funciones más importantes del sistema: en vez de tomar el pedido a mano, se le puede enviar al cliente un link para que arme su propio pedido desde el celular.

## 6.1 Cómo se envía

Desde cualquier chat (en el tablero, en el detalle de un pedido, o en la bandeja de WhatsApp), hay un botón **"Formulario"**. Al presionarlo, el sistema genera un link único para ese cliente y se lo envía por WhatsApp automáticamente.

## 6.2 Qué puede hacer el cliente con el link

- Ver los productos disponibles (el mismo catálogo que usa el negocio — un cambio hecho desde Configuración se refleja en el formulario del cliente en los siguientes segundos).
- Armar su pedido: agregar cantidad de cada producto.
- Si ya tiene un pedido abierto ese día, puede **editarlo**: agregar productos, quitar productos, cambiar cantidades, cambiar dirección o método de pago — todo desde el mismo link, sin tener que escribir por chat.
- Ver (sin poder editar) los pedidos que ya están en camino o entregados.

## 6.3 Reglas de edición según el estado del pedido

El cliente solo puede editar su pedido mientras esté en estado **Nuevo, Preparando o Listo**. En cuanto el negocio lo pasa a **En camino** o **Entregado**, el cliente ya no puede tocarlo desde el link — si intenta enviar un cambio en ese momento, el sistema le explica claramente que el pedido ya salió y que debe contactar directamente al negocio.

## 6.4 Un link, un dispositivo

El link queda "amarrado" al primer celular/navegador donde se abre. Si alguien más intenta abrir el mismo link desde otro dispositivo, no funciona (por seguridad, para que no cualquiera que reenvíe el link pueda tocar el pedido de otra persona).

## 6.5 Límite de pedidos nuevos por día

Cada link permite crear como máximo **3 pedidos nuevos por día**. Esto es para evitar que un link filtrado o reenviado sea usado para generar pedidos falsos en cadena. El límite se reinicia automáticamente cada día — no es un límite de por vida del cliente.

## 6.6 Cuándo deja de funcionar el link

Un link deja de funcionar en cualquiera de estos casos:

- **Automáticamente a las 8:00 p.m. hora Colombia, todos los días.** Después de esa hora nadie puede crear ni editar pedidos por el formulario — si un cliente escribe después de esa hora, debe ser atendido directamente por un trabajador vía chat. A la mañana siguiente el horario se reinicia solo (no hace falta hacer nada).
- **A la medianoche** (fin del día), como fecha de vencimiento normal del link.
- Si se le envía al cliente un **link nuevo**: automáticamente el anterior queda inválido, sin necesidad de bloquearlo a mano. Esto sirve, por ejemplo, si el cliente perdió el link o hubo algún problema — con solo mandarle uno nuevo, el viejo ya no sirve.
- Si un trabajador lo **bloquea manualmente** (botón "Bloquear link" en el chat de ese cliente).
- Si el administrador usa el botón de **"Bloquear todos los links"** (ver siguiente punto).

## 6.7 Bloquear todos los links de una vez (botón de emergencia)

En "Informe del día", junto al botón de Cerrar caja, el administrador tiene el botón **"Bloquear todos los links"**. Sirve para cuando el negocio cierra más temprano de lo normal un día puntual: con un solo click, **todos** los links activos de **todos** los clientes quedan bloqueados al instante, sin tener que ir chat por chat. Un link que se envíe después de bloquear todo vuelve a funcionar con normalidad — no es un apagado permanente, solo mata lo que estaba activo en ese momento.

## 6.8 Actualización en vivo

Mientras el cliente tiene el formulario abierto, el sistema revisa cada pocos segundos si algo cambió (por ejemplo, si el pedido pasó a "en camino"). Si el pedido deja de ser editable mientras el cliente lo tiene abierto, se le avisa ahí mismo, sin que tenga que intentar enviar el cambio para enterarse.

---

# 7. Detalle de un pedido

Al abrir cualquier pedido se ve:

- Información general: cliente, teléfono, dirección, hora, estado, canal (WhatsApp o llamada).
- **Campana roja**: aparece junto al número del pedido cuando el cliente hizo un cambio desde el formulario que todavía nadie revisó. Se apaga automáticamente en cuanto un trabajador guarda el pedido (es la forma de confirmar "ya lo vi").
- **Texto en rojo con la etiqueta "· cliente"**: marca qué productos fueron agregados o modificados por el cliente mismo (no por un trabajador), para diferenciarlos de un vistazo.
- Botones para mover el pedido entre estados.
- **Guardar**: aplica los cambios y cierra el detalle.
- **Copiar**, **PDF** y **Enviar factura**: generan o envían la factura del pedido. La factura de un pedido de un día anterior sale con la fecha real de ese pedido, no con la fecha de hoy. El link de la factura que se envía por WhatsApp deja de abrir después de **24 horas** — si el cliente lo necesita después de ese tiempo, basta con volver a presionar "Enviar factura" para generarle un link nuevo y fresco (esto funciona siempre, sin límite de veces ni de días).
- **Papelera**: cancela el pedido (solo administrador/encargado).
- Chat del cliente embebido a la izquierda, para responder sin salir del pedido — con los mismos botones de Formulario/Bloquear link, que se deshabilitan automáticamente si el pedido es de un día anterior o si la caja de ese día ya se cerró.

---

# 8. Cierre de caja

El cierre de caja es el corte del día: cuadra el dinero recibido, obliga a resolver todos los pedidos pendientes, y congela el día para que nada se pueda alterar después.

## 8.1 Solo se puede cerrar el día de hoy

No se puede cerrar caja de un día pasado ni de un día futuro — únicamente del día actual, mientras está en curso. Esto evita, por ejemplo, que un pedido pendiente que se pase a "mañana" termine cayendo en un día que ya pasó.

## 8.2 Qué se ve al cerrar

- Resumen de ventas del día: total en efectivo, total en transferencias, y total general.
- Pedidos ya completados (pagados/entregados).
- **Pedidos pendientes** (sin cobrar y sin cerrar): para cada uno hay que elegir una de dos acciones:
  - **Pasar a mañana**: el pedido sigue abierto, se traslada al día siguiente tal cual estaba.
  - **Cerrar sin cobro**: el pedido queda cerrado y marcado como no gestionado (sin registrar ningún pago, porque no se cobró).
  - Hay un botón de atajo, **"Pasar todo a mañana"**, que aplica esa decisión a todos los pedidos pendientes de una sola vez, para cuando se quiere dejar todo abierto para el día siguiente sin ir uno por uno.
- **Chats pendientes sin pedido asociado** (el cliente escribió pero no llegó a armar un pedido, o quedó con mensajes sin leer): piden su propia decisión, distinta a la de los pedidos:
  - **Pasar a mañana**: el chat se traslada al día siguiente.
  - **Marcar como atendido**: se da por resuelto tal cual quedó hoy.

No se puede cerrar la caja mientras quede algún pedido o chat pendiente sin su decisión correspondiente.

## 8.3 Después de cerrado

Una vez confirmado el cierre, queda disponible el botón para **descargar el CSV** (una tabla con el detalle completo de ese día: cada pedido, cliente, productos, total, y qué se decidió con los pendientes). Este CSV se puede volver a descargar **en cualquier momento después**, no solo justo cuando se cierra — sirve para llevar el registro en Excel o entregárselo a quien lleve la contabilidad.

## 8.4 Qué significa "el día está cerrado"

Una vez cerrado, todos los pedidos de ese día quedan congelados: no se pueden editar, no se pueden mover de estado, y no se pueden crear pedidos nuevos con esa fecha. El día queda como una fotografía fija de lo que pasó, para que el historial nunca se pueda alterar después del hecho.

---

# 9. Informe del día

Pestaña exclusiva del administrador. Muestra, para la fecha seleccionada:

- Totales de pedidos (total, entregados, pendientes, domiciliarios activos).
- Totales de chats (total, sin pedido, activos, completados).
- Recaudo del día (efectivo, transferencia, total).
- Tres pestañas: **Activos** (lista de pedidos del día), **Papelera** (pedidos cancelados ese día) y **Cambios** (historial completo de todo lo que se modificó en el día: quién, qué y cuándo).
- El botón de Cerrar caja y, junto a él, Bloquear todos los links.

---

# 10. Configuración (solo administrador)

- **Productos**: catálogo de productos que usan tanto los trabajadores (al crear/editar pedidos) como los clientes (en el formulario). Es la misma lista en los dos lados — un cambio acá se refleja de inmediato para los trabajadores que tengan el sistema abierto, y en los siguientes segundos para un cliente que en ese momento tenga el formulario abierto en el celular.
- **Domiciliarios**: alta y edición de los repartidores del negocio.
- **Usuarios**: creación de cuentas para encargados y otros administradores, con su rol correspondiente.

---

# 11. Tabla de permisos por rol

| Acción | Administrador | Encargado | Domiciliario |
| :---- | :---: | :---: | :---: |
| Ver tablero de pedidos (cualquier día) | Sí | Sí | Sí |
| Ver el detalle y el chat de un pedido | Sí | Sí | Sí |
| Responder en el chat de un cliente | Sí | Sí | Sí |
| Enviar / bloquear el link de un cliente puntual | Sí | Sí | Sí |
| Crear pedidos nuevos | Sí | Sí | No |
| Editar pedidos (guardar cambios) | Sí | Sí | No |
| Mover pedidos de estado | Sí | Sí | No |
| Cobrar (cerrar un pedido individual) | Sí | Sí | No |
| Cerrar caja del día | Sí | Sí | No |
| Bloquear TODOS los links de una vez | Sí | No | No |
| Ver Chats WhatsApp (bandeja completa) | Sí | No | No |
| Ver Informe del día | Sí | No | No |
| Configuración (productos, usuarios, domiciliarios) | Sí | No | No |

---

# 12. Preguntas frecuentes e importantes

**¿Por qué un mensaje que le mandé a un cliente no le llegó?**
Casi siempre es la ventana de 24 horas de WhatsApp (ver sección 4.3): si el cliente no ha escrito en más de 24 horas, un mensaje normal puede no entregarse. Esperá a que el cliente escriba de nuevo, o contactalo por otra vía.

**Un cliente dice que el link no le funciona a las 9 de la noche.**
Es esperado — los links se desactivan solos todos los días a las 8:00 p.m. En ese caso hay que tomarle el pedido manualmente por chat.

**Le mandé un link nuevo a un cliente, ¿tengo que bloquear el viejo a mano?**
No. Mandar un link nuevo invalida automáticamente el anterior.

**Cerré caja por error, ¿se puede deshacer?**
No, el cierre es definitivo — por diseño, para que el historial no se pueda alterar después. Hay que tener la certeza antes de confirmar.

**¿Por qué la dirección ya no es obligatoria al crear un pedido?**
Para poder registrar el pedido rápido apenas llega, sin frenar por un dato que se puede completar después. Sí es obligatoria en el momento de cerrar/cobrar el pedido.

**¿El cliente puede eliminar un pedido completo desde el link?**
No. Puede editar los productos de un pedido en estado Nuevo/Preparando/Listo, pero no puede eliminarlo por completo ni tocarlo una vez que salió (En camino) o fue entregado.

**Un cliente dice que el link de la factura ya no abre.**
Es normal si pasaron más de 24 horas desde que se envió — ese link vence solo, por seguridad (para que una factura vieja filtrada no quede accesible para siempre). Solución: volver a presionar "Enviar factura" en el pedido, que genera y manda un link nuevo al instante.

---

*Fin del manual. Ante cualquier duda de uso que no esté cubierta acá, contactar a 4Client.*
