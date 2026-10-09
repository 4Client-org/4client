---
estado: vigente
verificado: 2026-10-09 @ 2cbd083
fuentes: [start.sh, apps/api/prisma/schema.prisma, apps/api/src/lib/businessDate.ts, apps/api/src/config.ts]
---

# Principios no negociables

Reglas que no se rompen sin una decisión explícita de José, registrada en `05-historia/decisiones.md`. Cada una explica su porqué.

1. **Producción es intocable.** `main` despliega a producción y `start.sh` corre `prisma migrate deploy` en cada arranque. Nada llega a `main` sin OK explícito de José, y toda migración debe ser aditiva y compatible con el código anterior (el contenedor viejo sigue vivo durante el deploy). *Por qué:* hay un cliente real trabajando con el sistema todos los días.
2. **Multi-tenant estricto.** Toda consulta y toda escritura se filtra por `org_id` tomado del JWT, nunca del cuerpo de la petición. Nada específico de un cliente va fijo en el código (hoy hay excepciones, ver `03-plan/problemas-conocidos.md`: DT-001, DT-002).
3. **No existe un total de pedido guardado.** El total de un pedido es siempre la suma de `OrderItem.price`, y `price` es el **total de la línea** (no el precio unitario). Solo `DailyClose` guarda una foto de totales. *Por qué:* un total guardado se desincroniza al editar.
4. **El historial de pedidos es inmutable.** `order_history` es solo-añadir, forzado por reglas de PostgreSQL (`DO INSTEAD NOTHING`). Un UPDATE o DELETE sobre esa tabla no falla: se ignora en silencio. Un pedido con historial no se puede borrar de la base.
5. **Las fechas de negocio son de Bogotá (UTC-5, sin horario de verano).** Hay **dos conceptos de día distintos** y no se mezclan: `Ticket.fecha` (con corte a las 21:00 para el primer mensaje del día, `lib/businessDate.ts`) y `Order.fecha` / día de cierre (sin corte).
6. **Ley 1581 (datos personales).** El cliente consiente en cada pedido (con versión de la política), el aviso de privacidad va una sola vez por ticket, la multimedia del chat **nunca se guarda** (solo el id de Meta, 30 días), y el borrado de datos de un cliente lo ejecuta solo el rol `dev`.
7. **Cerrar la caja congela el día.** Después del cierre no se crean, editan, mueven ni cobran pedidos de ese día (solo se pueden agregar observaciones). Ver `modulos/CAJ.md` para las excepciones conocidas.
8. **Un ticket por teléfono, para siempre.** Único por `(org_id, phone)` y `(org_id, bsuid)`. Un cliente que vuelve semanas después continúa el mismo ticket.
9. **Cero secretos en el repo,** aunque sea privado. Solo se documentan nombres de variables de entorno. Los datos de clientes finales en ejemplos son siempre ficticios.
10. **Spec antes que código en cambios grandes** (clase C: feature, esquema, API, dinero o privacidad). Se escribe y aprueba `03-plan/cambios/CH-nnnn-*.md` antes de programar. Los hotfix urgentes escriben el CH después.
11. **Toda regla de dinero, permisos o tenant tiene un test contra Postgres real** (`apps/api/test`). Los servicios externos se simulan; la base no.
12. **Idioma:** documentación, interfaz y commits en español; identificadores de código en inglés. Los términos de negocio en español (`cierre`, `pospuesto`, `encargado`) se mapean a su identificador en `01-funcional/glosario.md`.

Cambiar uno de estos principios exige registrar la decisión (`D-nn`) y actualizar este archivo en el mismo commit.
