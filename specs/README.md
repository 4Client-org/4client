---
estado: vigente
verificado: 2026-10-10 @ 1edb809
fuentes: [estructura de specs/, AGENTS.md]
---

# specs/ — contexto completo de 4Client

Aquí vive todo lo que una persona o una IA necesita para entender 4Client sin leer el código primero: qué es el negocio, cómo está construido, cómo se opera, qué se decidió y hacia dónde va. Sigue el método **Spec Driven Development**: lo grande se especifica y se aprueba antes de programarse, y las specs se mantienen al día con cada cambio.

> Empieza por `../AGENTS.md`. Este índice es el mapa.

## Orden de lectura (según el contexto disponible)

| Nivel | Qué leer | Cuándo |
|---|---|---|
| **T0** (siempre) | `../AGENTS.md`, `00-horizonte.md`, `00-estado-actual.md`, `00-principios.md` | Antes de cualquier tarea |
| **T1** | `modulos/<MOD>.md` del área (mapa en `AGENTS.md`) + los pendientes de ese módulo en `03-plan/` | Tareas sobre una parte del sistema |
| **T2** | `01-funcional/glosario.md`, `actores-y-permisos.md`; `02-tecnico/*` según la tarea; `04-operacion/*` | Datos, API, seguridad, infraestructura, deploy |
| **T3** | `05-historia/decisiones.md` | Antes de revertir o cambiar un comportamiento existente |

## Estructura

| Carpeta | Contenido |
|---|---|
| `00-*.md` | Horizonte (hacia dónde va), estado actual (foto viva) y principios no negociables |
| `01-funcional/` | **Qué y por qué.** Visión, actores y permisos, glosario, ciclo del día |
| `02-tecnico/` | **Cómo está construido.** Arquitectura, datos, API y eventos, integraciones, seguridad y privacidad, calidad |
| `modulos/` | Un archivo por módulo, con tres secciones: 1 Negocio · 2 Técnico · 3 Pendientes |
| `03-plan/` | **Hacia dónde.** Roadmap, problemas conocidos, preguntas abiertas y cambios (`CH-nnnn`) |
| `04-operacion/` | Flujo de trabajo (ramas y deploys), entornos y despliegue, desarrollo local, runbooks, **diagnóstico de incidentes** y **alta de un negocio nuevo** |
| `05-historia/` | Cronología, decisiones, changelog por release y **registro de cambios** (un asiento por cambio) |
| `_plantillas/` | Plantillas (`modulo.md`, `cambio.md`), guía de escritura y **`checklist.md`** (qué specs tocar según el tipo de cambio) |

## Archivos (índice completo)

| Carpeta | Archivos |
|---|---|
| raíz | `00-horizonte.md`, `00-estado-actual.md`, `00-principios.md` |
| `01-funcional/` | `vision-y-direccion.md`, `actores-y-permisos.md`, `glosario.md`, `ciclo-diario.md`, `pantallas-por-rol.md`, `escenarios-extremo-a-extremo.md` |
| `02-tecnico/` | `arquitectura.md`, `datos-y-migraciones.md`, `api-y-eventos.md`, `integraciones.md`, `seguridad-y-privacidad.md`, `limites-y-tiempos.md`, `calidad-y-pruebas.md`, `frontend.md`, `codigos-de-error.md`, `modelo-de-datos.md` (ERD), `modelo-de-amenazas.md`, `datos-personales.md` |
| `03-plan/` | `roadmap.md`, `problemas-conocidos.md` (BUG/DT), `riesgos.md` (RK), `preguntas-abiertas.md` (PREG), `mapa-de-ids.md`, `cambios/README.md` (+ un `CH-nnnn-*.md` por cambio clase C) |
| `04-operacion/` | `flujo-de-trabajo.md`, `entornos-y-despliegue.md`, `desarrollo-local.md`, `runbooks.md`, `diagnostico-de-incidentes.md`, `alta-de-negocio.md`, `observabilidad-y-continuidad.md` |
| `05-historia/` | `registro-de-cambios.md`, `changelog.md`, `decisiones.md`, `cronologia.md` |
| `_plantillas/` | `modulo.md`, `cambio.md`, `guia-de-escritura.md`, `checklist.md` |

## Módulos

Cada módulo trae: propósito, **alcance y límites**, **dependencias**, permisos, reglas `RN-<MOD>-nn`, **criterios de aceptación** (escenarios Dado/Cuando/Entonces con su test), mapa de código y pendientes.

| Código | Módulo | Qué cubre | Archivo |
|---|---|---|---|
| ACC | Cuentas, roles y acceso | Organizaciones, usuarios, empleados, sesión, 2FA del operador | `modulos/ACC.md` |
| WPP | WhatsApp entrante y mensajes automáticos | Webhook de Meta, ticket y día de negocio, bienvenida, plantillas | `modulos/WPP.md` |
| INB | Chats (bandeja, mensajes, links) | Chat del personal, multimedia, reenvío, links del formulario, borrado de datos | `modulos/INB.md` |
| IA | Tomar lista | Extracción de productos desde el chat como borrador en $0 | `modulos/IA.md` |
| FRM | Formulario público del cliente | El cliente arma, edita o borra su pedido | `modulos/FRM.md` |
| ORD | Pedidos | Numeración, estados, tablero, papelera, historial, observaciones | `modulos/ORD.md` |
| CAJ | Cobros y cierre de caja | Métodos de pago, crédito, cierre y congelamiento del día | `modulos/CAJ.md` |
| DSH | Informe del día | Totales, chats, créditos y cambios del admin | `modulos/DSH.md` |
| CAT | Catálogo de productos | Lista, precios de referencia, Excel, envío del catálogo | `modulos/CAT.md` |
| FAC | Facturas al cliente | Recibo PDF, link de 24 h y su revocación | `modulos/FAC.md` |
| PLT | Plataforma (operador dev) | DevTools, altas de negocios, cobros de plataforma, auditoría | `modulos/PLT.md` |

## Si buscas…

| Pregunta | Dónde |
|---|---|
| ¿Qué significa este término? | `01-funcional/glosario.md` |
| ¿Quién puede hacer qué? | `01-funcional/actores-y-permisos.md` |
| ¿Cómo es un día de punta a punta? | `01-funcional/ciclo-diario.md` |
| ¿Hacia dónde va el producto? | `00-horizonte.md`, `01-funcional/vision-y-direccion.md`, `03-plan/roadmap.md` |
| ¿Qué está pendiente o dudoso? | `03-plan/preguntas-abiertas.md`, `03-plan/problemas-conocidos.md` |
| ¿Por qué se hizo así? | `05-historia/decisiones.md` |
| ¿Qué se cambió y cuándo? | `05-historia/registro-de-cambios.md`, `changelog.md` |
| ¿Cómo desplego, doy de alta o diagnostico? | `04-operacion/` |

El material histórico anterior a las specs (propuesta comercial, roadmap original) vive en `../archivo/`; las specs mandan sobre él.

## Identificadores

| ID | Significado |
|---|---|
| `RN-<MOD>-nn` | Regla de negocio de un módulo |
| `BUG-nnn` | Defecto **confirmado por José** |
| `PREG-nnn` | Pregunta: algo que parece raro y solo José puede decir si es intencional |
| `DT-nnn` | Deuda técnica objetiva (código duplicado o muerto, tests que faltan) |
| `CH-nnnn` | Cambio (feature o fix grande) con su spec, plan y tareas |
| `D-nn` | Decisión registrada |

Los IDs no se reutilizan; lo obsoleto se tacha con un puntero a su reemplazo. Las referencias al código usan `ruta › símbolo`, sin números de línea.

## Reglas de mantenimiento

0. **Todo cambio que llega a `dev` deja un asiento** en `05-historia/registro-de-cambios.md` (misma rama, antes de integrar; reglas en ese archivo) y **corrige en el mismo cambio** cualquier spec que deje de ser verdad: nunca documentación vieja. Qué archivos tocar según el cambio: `_plantillas/checklist.md`.
1. Cada archivo lleva `verificado: fecha @ sha`. Para saber si puede estar desactualizado: `git log <sha>..HEAD -- <fuentes>`; si hay commits, revisar.
2. Un cambio de comportamiento actualiza la spec del módulo **en el mismo commit**.
3. Lo que parece mal se registra como `PREG`, no se "arregla" en la spec. Solo José lo convierte en `BUG`.
4. Cambios clase C: spec, plan y tareas aprobados antes del código (`03-plan/cambios/`).
5. Máximo 400 líneas por archivo. Guía completa: `_plantillas/guia-de-escritura.md`.
6. Nunca secretos ni datos reales de clientes finales.
