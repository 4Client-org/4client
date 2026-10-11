---
estado: vigente
verificado: 2026-10-10 @ a7c7981
fuentes: [specs/00-horizonte.md, archivo/Requerimientos/Propuesta - 4Client - FruverSanGabriel.md, archivo/RoadMap/ROADMAP_PROYECTO_GENERAL.md, README.md, specs/00-estado-actual.md, specs/modulos/*.md]
---

# Visión y dirección

**En una frase:** 4Client convierte el WhatsApp de un negocio en un sistema de pedidos con orden, trazabilidad y control para el dueño, y con la menor fricción posible para el personal. Este archivo cubre, en orden: el problema (§1), a quién se vende y cómo se opera (§2), la solución (§3), el alcance (§4), el modelo comercial (§5), el estado (§6) y la dirección (§7).

Qué problema resuelve 4Client, para quién, qué cubre hoy y hacia dónde va. Los hechos comerciales vienen de documentos antiguos (`archivo/Requerimientos/Propuesta…`, `archivo/RoadMap/ROADMAP_PROYECTO_GENERAL.md`, `README.md`) que están en parte desactualizados: todo lo que se apoya solo en ellos lleva *(inferido)*. Lo técnico y el comportamiento actual viven en `modulos/*.md`.

## 1. El problema

La Propuesta (abril 2026) diagnosticó seis problemas en la operación del primer cliente, un fruver con buen volumen de pedidos por WhatsApp y domicilios propios *(inferido)*:

| # | Problema | Cómo lo ataca el sistema hoy | Módulo |
|---|---|---|---|
| 1 | **El orden de llegada se pierde.** WhatsApp reordena por último mensaje: el cliente de las 8:00 queda detrás del de las 9:00. | Tablero con una fila por cliente, ordenado por hora del primer mensaje del día (`first_message_today_at`). | INB, ORD |
| 2 | **El personal puede alterar o borrar conversaciones** sin que el dueño se entere. | El número de WhatsApp lo custodia el dueño; el personal usa el chat dentro de 4Client, donde no se borra nada. | INB, WPP |
| 3 | **Planilla de domicilios en papel**, alterable o perdible. | Pedido digital con domiciliario asignado, estado y método de pago. | ORD |
| 4 | **Sin trazabilidad** de cada domicilio. | Historial de pedido inmutable (solo-añadir) y observaciones con autor. | ORD |
| 5 | **Cobro riesgoso en la calle**; transferencias confirmadas informalmente. | Cobro con contraseña del usuario, pedido bloqueado tras cobrar, cierre de caja con totales por efectivo y transferencia. | CAJ |
| 6 | **Cero visibilidad para el dueño** fuera del local. | Informe del día en vivo para admin. | DSH |

La conclusión de la Propuesta, que sigue orientando el producto: el problema no es el esfuerzo del equipo sino la falta de un sistema que dé orden, trazabilidad y control *(inferido)*.

## 2. Cliente y modelo de operación

**Cliente objetivo:** fruvers (tiendas de frutas y verduras) con pedidos por WhatsApp y domicilios propios, en Colombia. Hoy hay uno solo: Fruver San Gabriel (Bogotá). Cada cliente es una *organización*; ve únicamente sus datos (principio 2 de `00-principios.md`).

**Cambio operativo que exige el sistema** *(inferido de la Propuesta; su cumplimiento real en el local no está verificado en el código)*:
- El **celular con el WhatsApp Business** queda bajo custodia exclusiva del propietario. El personal no lo usa para gestionar pedidos.
- El personal trabaja desde un **computador del local**, cada uno con su usuario y contraseña. El propietario monitorea desde donde esté.
- La Propuesta advierte que el éxito depende "50 % de la tecnología y 50 % del compromiso del equipo"; la capacitación va incluida en el onboarding *(inferido)*.

**Roles** (detalle y matriz en `actores-y-permisos.md`; cuentas en `modulos/ACC.md`):

| Rol | Papel en la operación |
|---|---|
| admin | El dueño: ve y controla todo, incluido el informe, el catálogo, los usuarios y los créditos. |
| encargado | Atiende el mostrador: pedidos, cobros, chat. No borra registros. No cierra la caja: solo el admin (y `dev`) puede; la API le responde 403 (decisión de José, 2026-10-10). |
| domiciliario | Repartidor con login; por ahora con los mismos permisos que el encargado (decisión de José, 2026-10-10). (El repartidor al que se *asigna* un pedido es un `Employee` sin login.) |
| dev | José, operador de la plataforma, entre organizaciones (`modulos/PLT.md`). |
| cliente final | Escribe por WhatsApp y arma su pedido en un formulario con link temporal, sin cuenta. |

## 3. Propuesta de valor

- **Orden de llegada visible** y un solo lugar para pedidos, chat y cobro, en tiempo real.
- **Trazabilidad que nadie puede borrar:** historial inmutable, cobros con contraseña y días de caja congelados.
- **El cliente arma su pedido solo** (formulario con consentimiento Ley 1581), o la IA ayuda a transcribir un chat dictado (Tomar lista). Los precios siempre los pone el personal.
- **Visibilidad para el dueño** sin estar en el local.
- **Hecho para fruvers**, a un precio que un negocio de ese tamaño paga, frente a CRM genéricos (la Propuesta compara con Kommo) *(inferido)*.

## 4. Alcance

### Dentro (hoy)

| Módulo | Qué hace en una línea |
|---|---|
| WPP (`modulos/WPP.md`) | Recibe los mensajes de Meta, crea el ticket por cliente, decide su día de negocio, manda la bienvenida y guarda las plantillas ("Formulario", "Cuenta banco"). |
| INB (`modulos/INB.md`) | Chats del lado del personal: leer, responder, multimedia, reenviar, links del formulario y tablero de tickets. |
| FRM (`modulos/FRM.md`) | Formulario público donde el cliente arma, edita o borra su pedido del día. |
| IA (`modulos/IA.md`) | "Tomar lista": extrae productos y cantidades de mensajes del chat como borrador en $0. |
| ORD (`modulos/ORD.md`) | Ciclo de vida del pedido: numeración, estados, papelera, historial y observaciones. |
| CAJ (`modulos/CAJ.md`) | Cobros (contado, cobro en casa, crédito, pago dividido) y cierre de caja que congela el día. |
| DSH (`modulos/DSH.md`) | Informe del día para el admin; desde ahí se cierra la caja. |
| FAC (`modulos/FAC.md`) | Recibo en PDF del pedido enviado al cliente con link de 24 h. |
| CAT (`modulos/CAT.md`) | Catálogo de productos y envío del catálogo por el chat. |
| ACC (`modulos/ACC.md`) | Organizaciones, usuarios, empleados, sesión y 2FA del operador. |
| PLT (`modulos/PLT.md`) | Consola del operador: altas de negocios, soporte y cobros de plataforma. |

### Fuera (explícito)

- **Tienda web pública** para que los clientes compren en línea. La Propuesta la deja para fases posteriores si el negocio la necesita. *(inferido)*
- **Pasarela de pagos en línea** (Wompi, Nequi, Daviplata, tarjetas): fuera de alcance hoy; José la contempla como rumbo si el negocio la pide (`00-horizonte.md`). *(inferido)*
- **Factura electrónica DIAN:** la factura de 4Client es un recibo; no reemplaza la factura electrónica (`modulos/FAC.md`).
- Quién recibe cada plata es siempre humano: el sistema registra el cobro, no lo ejecuta.

## 5. Modelo comercial

Según la Propuesta (abril 2026, v1.0) *(inferido; confirmar que sigue vigente con José)*:

| Concepto | Valor según la Propuesta |
|---|---|
| Setup e incorporación | $400.000 COP, una sola vez |
| Suscripción mensual (acceso + soporte) | $200.000 COP |
| Primer mes (setup + mes 1) | $600.000 COP |
| Desde el mes 2 | $200.000 COP al mes |
| Infraestructura (dominio, base de datos, hosting, API de WhatsApp) | $0 durante la fase actual, según la Propuesta |

El soporte incluye corrección de errores, actualizaciones de seguridad, atención de inconvenientes y asesoría de uso. Las **mejoras funcionales** nuevas se cotizan y la suscripción se ajusta. La plataforma registra lo que cobra a cada negocio (`PlatformCharge`, `modulos/PLT.md`); no es facturación electrónica. Detalle de montos y condiciones: la Propuesta es la fuente; esta spec no los replica más allá de la tabla.

## 6. Estado actual

La foto viva (commits, qué viaja a producción, trabajo en curso) está en `00-estado-actual.md`; aquí solo lo estable:

- En producción desde ~2026-07-25 con **un cliente real** (Fruver San Gabriel). Tablero, WhatsApp, formulario, cobro, cierre, informe, facturas, catálogo e IA están en uso.
- Hay un incidente de facturación de Meta (2026-10-07) que impide los mensajes salientes mientras los entrantes siguen llegando (`modulos/WPP.md`).
- Las decisiones de fondo y su porqué están en `05-historia/decisiones.md`; los pendientes, en `03-plan/`.

## 7. Dirección

Todo lo de esta sección es **propuesto, a confirmar con José**. El orden y los plazos están en `03-plan/roadmap.md`.

1. **Segundo cliente.** El sistema es multi-tenant desde el principio, pero quedan restos de un solo cliente en el código (cuenta bancaria en plantillas por defecto, logo y política fijos). Generalizarlos es el requisito previo; la lista está en `03-plan/problemas-conocidos.md`.
2. **Reglas de dinero pendientes** (`modulos/CAJ.md`, `03-plan/preguntas-abiertas.md`). El crédito pagado después del cierre queda fuera de los totales por ahora (D-19); se retoma si el cliente lo pide.
3. **Operación sólida:** probar la restauración de respaldos, ventana de reinicio del VPS, repositorio privado (`00-estado-actual.md`).
4. **Endurecer la plataforma, por pasos** *(José)*: inicio de sesión con nombre de usuario en vez de correo, 2FA también para administradores, y que el administrador de cada negocio pueda borrar los datos de un cliente final (hoy solo `dev`; D-10, D-17).
5. **Hardware y pagos** *(José; el rumbo completo está en `00-horizonte.md`)*: báscula digital conectada que llene el precio de la línea (sin cambiar que `price` es el total de la línea, D-02), impresora de etiquetas y, solo si el negocio lo pide, pasarela de pagos. Además, evaluar generar el PDF de la factura en el servidor (D-12).
6. **Ideas de fases del README** (*ideas, no compromisos*; vienen de un README antiguo, *inferido*):
   - Fase 2, escalabilidad multi-cliente: panel super-admin (en parte cubierto por PLT), onboarding automático de negocios, página pública de 4Client, cobro a clientes, dominio propio por cliente.
   - Fase 3, inteligencia de negocio: historial de clientes frecuentes, avisos de demora por WhatsApp, catálogo automático por WhatsApp.
7. La Propuesta dice que las fases siguientes se definen **en conjunto con el negocio** una vez la Fase 1 opere bien; ninguna idea de arriba se construye sin ese acuerdo y, si es grande, sin un `CH-nnnn` previo (principio 10).

## 8. Qué no cubre esta spec

- Reglas de cada módulo: ver `modulos/`.
- Flujo de un día completo: `ciclo-diario.md`; qué ve y puede hacer cada rol: `actores-y-permisos.md`; vocabulario: `glosario.md`.
- Arquitectura, despliegue y operación: `02-tecnico/` y `04-operacion/`.
- Preguntas abiertas para José: `03-plan/preguntas-abiertas.md`.
