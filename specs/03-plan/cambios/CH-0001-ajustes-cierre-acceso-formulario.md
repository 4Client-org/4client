---
id: CH-0001
estado: hecho @a7c7981
clase: C
modulos: [CAJ, ORD, DSH, ACC, FRM, WPP, CAT]
aprobado_por: José (2026-10-10, en conversación: "implementa todo" tras responder las preguntas prioritarias)
---

# CH-0001 — Ajustes de cierre de caja, acceso y formulario

## Spec (qué y por qué)

José respondió las preguntas prioritarias de `preguntas-abiertas.md` el 2026-10-10 y pidió implementar lo decidido. Se agrupa en un solo cambio por ser una misma tanda aprobada, escrita después de la aprobación verbal y antes de llevarse a producción.

**Comportamiento nuevo**
- Cierre de caja congela todo: con `DailyClose` no se crea, edita, mueve, restaura, elimina, cobra ni cobra retroactivamente; solo observaciones y pagar créditos (roadmap 25, 26).
- Cierre, vista previa e informe usan una sola función de totales; el pago dividido se guarda y se muestra tal cual (roadmap 27).
- Un pedido cobrado con el día abierto se edita; cambiar el método de pago es solo del administrador y exige el desglose por método (roadmap 34).
- La API no cobra pedidos en papelera ni eliminados por el cliente (roadmap 39).
- Solo el administrador cierra la caja (roadmap 37). El domiciliario tiene los permisos del encargado (roadmap 38).
- Desactivar a un usuario o cambiarle el rol corta su acceso al instante (roadmap 29). `REQUIRE_2FA` se lee bien (roadmap 35).
- Crédito con fecha de creación y de pago (roadmap 26).
- Formulario: sin `device_token`, fecha del pedido = día en que se emitió el link, "NO HAY" en agotados, política v2 con párrafo de IA (roadmap 28, 36, 40, 30).

**Reglas afectadas**
- `~ RN-CAJ-09, 10, 11, 19, 20, 21` (crédito con fecha, retroactivo bloqueado con día cerrado, edición de cobrado, una sola regla de bolsas, congelado total).
- `+ RN-CAJ-26 a RN-CAJ-32` (corrección del pago, no cobrar eliminados, vista previa, solo admin, crédito con fechas).
- `~`/`+` en ACC (corte inmediato), FRM (fecha del link, `NO HAY`, sin `device_token`), actores-y-permisos (cierre solo admin, domiciliario = encargado).

**Fuera de alcance:** selector de organización para `dev` (31), plazo de retención (32), borrado más completo (33), bucket privado (41).

**Horizonte.** No cierra el camino a la báscula ni a pagos: el total de pedido sigue sin guardarse (suma de líneas) y el desglose de pago es un dato del cobro, no un total. Ayuda al segundo cliente al centralizar permisos y totales.

## Plan (cómo)

Cuatro ramas de trabajo integradas en `feature/ajustes-jose-2026-10-10`. Una migración aditiva: `orders.credit_paid_at` (nullable) con relleno desde el historial; el contenedor viejo la ignora. `FormLinkSession` queda sin uso y se elimina en un release posterior.

**Riesgos y reversa.** Reversa: revertir el merge a `dev`/`main`; la columna nueva puede quedarse sin efecto. El riesgo mayor es `authenticate` (una lectura por petición) y las nuevas reglas de cobro: se probaron con 321 tests contra Postgres real y se prueban de nuevo en `dev` antes de producción.

**Specs a actualizar:** módulos CAJ, ORD, DSH, ACC, FRM, WPP, CAT, IA; `actores-y-permisos`, `api-y-eventos`, `codigos-de-error`, `modelo-de-datos`, `datos-y-migraciones`, `seguridad-y-privacidad`, `datos-personales`, `calidad-y-pruebas`; plan e historia.

## Tareas

- [x] Congelado del día y edición de cobrados (lib/dayClose.ts, lib/paymentEdit.ts).
- [x] Totales únicos, vista previa, solo admin, crédito con fechas.
- [x] Corte inmediato de acceso, `REQUIRE_2FA`, domiciliario = encargado.
- [x] Formulario: `device_token`, fecha del link, NO HAY, política v2.
- [ ] Probar en `dev` con datos de hoy.
- [ ] Llevar a producción con OK de José (con el repo privado).

## Verificación

321 pruebas de la API pasan (259 anteriores + 62 nuevas), `tsc` de API y web sin errores y `vite build` correcto. Pendiente: prueba manual en `dev`.
