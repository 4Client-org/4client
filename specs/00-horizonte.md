---
estado: vigente
actualizado: 2026-10-10
verificado: 2026-10-10 @ 1edb809
fuentes: [conversación con José 2026-10-09, archivo/RoadMap/PLAN_IMPLEMENTACION_ORIGINAL.md, 01-funcional/vision-y-direccion.md]
---

# Horizonte: hacia dónde va 4Client

**Léelo siempre, antes de proponer o implementar algo.** Sirve para no perder el rumbo: cada cambio pequeño debe acercar el producto a esto, o por lo menos no cerrarle el camino. Lo que está aquí son **intenciones y supuestos de José, no compromisos ni fechas**; el detalle de lo que ya existe está en `01-funcional/vision-y-direccion.md` y lo próximo concreto en `03-plan/roadmap.md`.

## La idea de fondo

4Client convierte el WhatsApp de un negocio en un sistema de pedidos completo y confiable, con la **menor fricción posible para el personal**: que el trabajador **no tenga que digitar** lo que el sistema puede saber solo, que nada se pierda y que el dueño vea todo. El producto se vende como plataforma para varios negocios (multi-tenant), empezando por un fruver.

Dos ideas guían las decisiones:
- **Simplicidad primero, endurecimiento gradual.** Mientras haya un solo cliente (el primero necesita entender y adaptarse al sistema), se mantiene la plataforma segura pero lo más sencilla posible; las capas extra se agregan por pasos *(José)*.
- **José es hoy el único desarrollador y operador.** Cosas sensibles (por ejemplo borrar datos de un cliente final) pasan por él; se abrirán a los administradores de cada negocio cuando haya más clientes *(José, D-17)*.

## Etapas supuestas (en orden aproximado, sin fechas)

### Etapa actual — Un cliente en producción, plataforma estable
Fruver San Gabriel usa el sistema todos los días: WhatsApp → ticket → formulario o "Tomar lista" → pedido → cobro → cierre de caja → informe → factura. Foco: estabilidad, corregir lo que el cliente reporte, y documentación al día (`specs/`).

### Siguiente — Endurecer y preparar al segundo cliente *(supuesto)*
- Quitar lo específico del primer cliente del código (cuenta bancaria en plantillas por defecto, logo y política de privacidad fijos).
- Inicio de sesión con **nombre de usuario** en vez de correo (hoy el campo existe pero no sirve para entrar, `modulos/ACC.md`), y **2FA también para administradores** (hoy solo el rol `dev`, D-10) *(José)*.
- Que el **administrador de cada negocio** pueda borrar los datos de un cliente final (hoy solo `dev`, D-17) *(José)*.
- Alta de un negocio nuevo sin intervención manual de José (onboarding).

### Hardware: la báscula conectada *(José; también en el plan original)*
Hoy el trabajador **escribe a mano** el precio de cada línea. La visión es que una **báscula digital conectada al computador** entregue el peso, y la plataforma calcule el precio de la línea (peso × precio del producto) y lo llene sola, sin digitar nada.
- Idea técnica del plan original: leer la báscula desde el navegador con la **Web Serial API** (Chrome/Edge), sin cambios en backend ni en la base. El esquema ya trae los campos preparados (`quantity_value`, `quantity_unit`, `price_per_unit`), hoy sin uso.
- Cuidado: hoy `price_per_unit` es **solo referencia** y `price` es el **total de la línea** (principio 3). La báscula debe **llenar ese total de línea**, no cambiar esa regla.
- También en el plan original: **impresora de etiquetas térmicas** (sticker con número de pedido, cliente, dirección y total para pegar en la bolsa) mediante un agente local en el computador del negocio.

### Pagos *(José)*
**Pasarela de pagos** integrada a la plataforma (hoy el pago se registra a mano al cobrar). Hoy está fuera de alcance; solo si el negocio lo pide.

### Más adelante — Plataforma de varios negocios *(ideas, tomadas del README y del plan originales; sin compromiso)*
- Panel de operador (super-admin) más completo, dominio propio por cliente, cobro automático de la suscripción.
- Tienda web pública para los clientes finales.
- Inteligencia de negocio: clientes frecuentes, avisos de demora por WhatsApp, catálogo automático.
- Generar el **PDF de la factura en el servidor** en vez del navegador, si conviene por consumo y eficiencia *(José, D-12)*.

## Lo que el rumbo no puede romper

Cualquier etapa debe respetar `00-principios.md`. Los que más a menudo chocan con las ideas de arriba: el total del pedido no se guarda (báscula, pagos), el historial es inmutable (pagos), todo se filtra por `org_id` (segundo cliente, panel de operador) y nada específico de un cliente va fijo en el código (segundo cliente).

## Cómo usar este archivo

- **Antes de implementar:** pregúntate si lo que vas a hacer cierra el camino a algo de aquí (por ejemplo, un total de pedido guardado haría difícil la báscula). Si hay choque, consúltalo con José.
- **Después de un cambio relevante:** si algo de aquí ya se hizo o cambió de rumbo, **actualiza este archivo** y deja constancia en `05-historia/registro-de-cambios.md`. Este archivo nunca debe describir un futuro que ya es presente ni uno que se descartó.
- Los ítems concretos y priorizados viven en `03-plan/roadmap.md`; aquí solo está la dirección.
