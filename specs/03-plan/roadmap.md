---
estado: vigente
verificado: 2026-10-09 @ 2cbd083
fuentes: [specs/00-estado-actual.md, specs/modulos/*.md, specs/04-operacion/runbooks.md, specs/01-funcional/vision-y-direccion.md]
---

# Roadmap

> **Todo propuesto, a confirmar con José.** Es una ordenación sugerida a partir de `00-estado-actual.md` y de los pendientes que se ven en los módulos; no hay compromisos de fecha. Los textos completos de cada pregunta, bug o deuda viven en `preguntas-abiertas.md` y `problemas-conocidos.md`, y los cambios grandes necesitan su `CH-nnnn` antes de programar (principio 10).

## Ahora

Lo que protege el dinero del cliente actual o la producción.

| # | Item | Por qué | Módulo / área |
|---|---|---|---|
| 1 | Decidir la regla de **créditos pagados** en cierre e informe. | Hoy un crédito saldado después no suma en ningún total: el dinero entra y ninguna cifra lo refleja. Requiere respuesta de José y un `CH` (toca dinero). | CAJ, DSH |
| 2 | Responder `preguntas-abiertas.md` y promover a bug lo que José confirme. | Desbloquea los cambios de comportamiento; mientras tanto las specs solo describen lo actual. | todos |
| 3 | **Probar la restauración de respaldos** con el simulacro de los pasos 1 a 5 del runbook. | El procedimiento está escrito pero marcado como no probado; un respaldo que nunca se restauró no es una garantía. | `04-operacion/runbooks.md` |
| 4 | Terminar el paso del repositorio a **privado** y el redeploy de prod. | Ya planeado; deja prod sobre la GitHub App y alineada con `dev`. | `04-operacion/entornos-y-despliegue.md` |
| 5 | Resolver con Meta el **problema de facturación** de la cuenta de WhatsApp. | Mientras dure, ningún mensaje saliente (bienvenida, respuestas, formulario) llega al cliente final. | WPP, INB |
| 6 | Revisión independiente de cada módulo (pasar `borrador` a `vigente`) y prueba de arranque en frío de las specs. | Es el cierre de la adopción de SDD. | `specs/` |

## Siguiente

Preparar el sistema para un segundo cliente y endurecer la operación.

| # | Item | Por qué | Módulo / área |
|---|---|---|---|
| 7 | **Limpieza de lo específico del primer cliente:** cuenta bancaria en las plantillas por defecto, logo y política de privacidad fijos. | Principio 2: nada de un cliente va fijo en el código. Es requisito antes de dar de alta a otro negocio (ver `problemas-conocidos.md`). | WPP, FAC, FRM, PLT |
| 8 | Probar el **alta de un negocio de punta a punta** con una organización de prueba. | Verifica de verdad el aislamiento por `org_id` y el flujo de PLT antes del cliente real. | PLT, ACC |
| 9 | **Ventana de reinicio del VPS** para aplicar el kernel pendiente. | Con caja cerrada, fuera de horario de pedidos y con respaldo fresco (runbook). | `04-operacion/runbooks.md` |
| 10 | **Regenerar el manual de usuario** desde `01-funcional`. | El manual actual está desactualizado; las specs ya son la fuente. | `archivo/Requerimientos/` |
| 11 | Alinear **interfaz y API** donde difieren (botones que la API rechaza, cierre de caja del encargado). | Reduce confusión del personal; cada caso necesita decisión de José. | ORD, CAJ, INB |
| 12 | Script de **detección de deriva** (drift) entre specs y código. | Las specs citan `ruta › símbolo` y tests por título; un script puede avisar cuando ya no existen. | `specs/`, `.github/` |

## Después

Mejoras de proceso e ideas de producto, sin fecha.

| # | Item | Por qué | Módulo / área |
|---|---|---|---|
| 13 | **Revisiones de specs en CI** (frontmatter, enlaces, `verificado` al día, ausencia de secretos). | Evita que la documentación se pudra sin que nadie lo note. | CI |
| 14 | Escribir **ADRs / decisiones `D-nn`** de ahora en adelante para cada cambio de principio o de arquitectura. | Registrar el porqué mientras está fresco (`05-historia/decisiones.md`). | proceso |
| 15 | Tests o decisión sobre código latente (escalera de bloqueo por intentos de link, `domActivos`, `POST /tickets` sin uso). | Deuda objetiva: código que existe y no se ejecuta o no se muestra. | INB, FRM, DSH |
| 16 | Ideas de fases del README (panel de super-admin ampliado, onboarding automático, cobro a clientes, dominio propio por cliente). | *Ideas, no compromisos* (*inferido*): se definen con cada negocio cuando la fase actual opere bien. | PLT, ACC |
| 17 | Ideas de inteligencia de negocio: clientes frecuentes, avisos de demora por WhatsApp, catálogo automático. | Igual: *ideas, no compromisos* (*inferido*); toda feature grande necesita su `CH`. | INB, CAT |
| 18 | Tienda web pública y pasarela de pagos en línea. | Explícitamente fuera de alcance hoy (`vision-y-direccion.md`); solo si el negocio lo pide. | fuera de alcance |

## Cómo usar este archivo

- Cada vez que José confirme, cambie o descarte un item, actualizar este archivo y `00-estado-actual.md` en el mismo commit.
- Un item que se empiece a ejecutar y sea clase C obtiene su `03-plan/cambios/CH-nnnn-*.md`; aquí queda solo la referencia.
- Esta lista no sustituye las prioridades de `00-estado-actual.md`: si difieren, manda ese archivo hasta que José decida.
