---
estado: vigente
verificado: 2026-10-09 @ 5d8e69d
fuentes: [AGENTS.md, specs/README.md, apps/api/src/server.ts, packages/shared/src/types, apps/api/src/config.ts]
---

# Checklist: qué archivos de `specs/` tocar según lo que cambies

Úsala **antes de dar por terminado** un cambio (regla 6 y 7 de `AGENTS.md`). Para cualquier cambio, siempre: asiento en `05-historia/registro-de-cambios.md`, campo `verificado:` de cada archivo tocado, y `00-estado-actual.md` si cambia lo que hay en dev/prod.

Antes de empezar: ¿es clase C (feature, esquema, API, dinero, privacidad)? Entonces primero `03-plan/cambios/CH-nnnn-*.md` aprobado (plantilla `cambio.md`). ¿Cierra el camino a algo de `00-horizonte.md`? Pregunta a José.

## Por tipo de cambio

| Añado o cambio… | Spec a tocar (además de lo común) |
|---|---|
| **Endpoint HTTP** | `02-tecnico/api-y-eventos.md` (fila en la tabla del módulo: rol, propósito); `modulos/<MOD>.md` (mapa de código, regla `RN-` si hay comportamiento, test); `01-funcional/actores-y-permisos.md` si cambia quién puede; `02-tecnico/limites-y-tiempos.md` si lleva rate limit propio (y la tabla "Rate limits" de `api-y-eventos.md`); el mapa de `AGENTS.md` si el archivo de rutas es nuevo |
| **Tabla o columna (Prisma)** | Migración **aditiva** en `apps/api/prisma/migrations/` (principio 1); `02-tecnico/datos-y-migraciones.md` (mapa del modelo, §10 historia de migraciones y su conteo, §8 si deja algo sin uso); `modulos/<MOD>.md`; `01-funcional/glosario.md` si hay término nuevo; toda tabla con datos de negocio lleva `org_id` (principio 2) |
| **Evento Socket.IO** | `packages/shared/src/types/socket.types.ts`; `02-tecnico/api-y-eventos.md` §2 (quién emite, quién escucha); `modulos/<MOD>.md` |
| **Permiso / rol** | `01-funcional/actores-y-permisos.md`; `02-tecnico/seguridad-y-privacidad.md` §3; `api-y-eventos.md` (columna rol); el módulo; un test de permisos (principio 11) |
| **Variable de entorno** | `apps/api/src/config.ts`; `02-tecnico/arquitectura.md` (tabla de variables) y `04-operacion/entornos-y-despliegue.md` (lista de nombres, qué cambia por entorno); `runbooks.md` si hay que rotarla. **Solo el nombre, nunca el valor** |
| **Plantilla de mensaje o texto automático** | `apps/api/src/lib/messageTemplates.ts`; `modulos/WPP.md` (o `INB.md` si es del chat); `01-funcional/ciclo-diario.md` si cambia lo que ve el cliente; ojo con `DT-001` (los defaults no pueden llevar datos de un negocio) |
| **Método de pago / estado de pedido** | `modulos/CAJ.md` y `ORD.md`; `packages/shared/src/types/order.types.ts`; totales del cierre y del informe (`CAJ` RN de cálculo, `DSH.md`); glosario; el formulario del cliente (`FRM.md`) si lo puede elegir. |
| **Integración externa nueva** | `02-tecnico/integraciones.md`; variables (fila arriba); `seguridad-y-privacidad.md` (qué dato sale); `00-horizonte.md` si es parte de lo planeado |
| **Dinero / totales / privacidad** | Principios 3, 6, 11; `decisiones.md` si cambia una decisión (`D-nn`); `CH-nnnn` aprobado antes |
| **Límite o tiempo (horas, cuántos)** | `02-tecnico/limites-y-tiempos.md` con el número exacto verificado |
| **Pantalla / componente web** | `modulos/<MOD>.md` (mapa de código) y, si cambia lo que ve el usuario, `01-funcional/ciclo-diario.md` |
| **Infra, deploy, CI** | `04-operacion/entornos-y-despliegue.md`, `runbooks.md` si hay procedimiento nuevo, `flujo-de-trabajo.md` si cambia el proceso |
| **Un módulo nuevo** | Copia `_plantillas/modulo.md` a `modulos/<COD>.md`; añádelo a la tabla de módulos de `specs/README.md`, al mapa código → módulo de `AGENTS.md` y a `01-funcional/actores-y-permisos.md` |
| **Un PREG / BUG / DT / D nuevo** | Su archivo en `03-plan/` o `05-historia/decisiones.md`; puntero de una línea en la sección 3 del módulo; `03-plan/mapa-de-ids.md` si el ID era provisional |
| **Un término de negocio nuevo** | `01-funcional/glosario.md` |
| **Algo que ya está en `00-horizonte.md` o `03-plan/roadmap.md`** | Actualiza el horizonte/roadmap: no deben describir como futuro lo que ya es presente |

## Al final, siempre

1. Corrige **todo** archivo que haya quedado falso (`grep -rn` del término viejo en `specs/` y `AGENTS.md`).
2. Cierra o actualiza el `CH-nnnn`, `BUG-nnn`, `PREG-nnn` involucrado.
3. Asiento `R-nnnn` en la misma rama (ver reglas en `05-historia/registro-de-cambios.md`).
4. Revisa que los enlaces relativos de lo que tocaste funcionen y que ningún archivo pase de 400 líneas.
