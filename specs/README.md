# specs/ — contexto completo de 4Client

Aquí vive todo lo que una persona o una IA necesita para entender 4Client sin leer el código primero: qué es el negocio, cómo está construido, cómo se opera, qué se decidió y hacia dónde va. Sigue el método **Spec Driven Development**: lo grande se especifica y se aprueba antes de programarse, y las specs se mantienen al día con cada cambio.

> Empieza por `../AGENTS.md`. Este índice es el mapa.

## Orden de lectura (según el contexto disponible)

| Nivel | Qué leer | Cuándo |
|---|---|---|
| **T0** (siempre, ~350 líneas) | `../AGENTS.md`, `00-estado-actual.md`, `00-principios.md` | Antes de cualquier tarea |
| **T1** | `modulos/<MOD>.md` del área (mapa en `AGENTS.md`) + los pendientes de ese módulo en `03-plan/` | Tareas sobre una parte del sistema |
| **T2** | `01-funcional/glosario.md`, `actores-y-permisos.md`; `02-tecnico/*` según la tarea; `04-operacion/*` | Datos, API, seguridad, infraestructura, deploy |
| **T3** | `05-historia/decisiones.md` | Antes de revertir o cambiar un comportamiento existente |

## Estructura

| Carpeta | Contenido |
|---|---|
| `00-*.md` | Estado actual (foto viva) y principios no negociables |
| `01-funcional/` | **Qué y por qué.** Visión, actores y permisos, glosario, ciclo del día |
| `02-tecnico/` | **Cómo está construido.** Arquitectura, datos, API y eventos, integraciones, seguridad y privacidad, calidad |
| `modulos/` | Un archivo por módulo, con tres secciones: 1 Negocio · 2 Técnico · 3 Pendientes |
| `03-plan/` | **Hacia dónde.** Roadmap, problemas conocidos, preguntas abiertas y cambios (`CH-nnnn`) |
| `04-operacion/` | Flujo de trabajo (ramas y deploys), entornos, desarrollo local, runbooks |
| `05-historia/` | Cronología, decisiones y changelog |
| `_plantillas/` | Plantillas y guía de escritura de specs |

## Módulos

| Código | Módulo | Archivo |
|---|---|---|
| ACC | Cuentas, roles y acceso | `modulos/ACC.md` |
| WPP | WhatsApp entrante y mensajes automáticos | `modulos/WPP.md` |
| INB | Chats (bandeja, mensajes, links) | `modulos/INB.md` |
| IA | Tomar lista | `modulos/IA.md` |
| FRM | Formulario público del cliente | `modulos/FRM.md` |
| ORD | Pedidos | `modulos/ORD.md` |
| CAJ | Cobros y cierre de caja | `modulos/CAJ.md` |
| DSH | Informe del día | `modulos/DSH.md` |
| CAT | Catálogo de productos | `modulos/CAT.md` |
| FAC | Facturas al cliente | `modulos/FAC.md` |
| PLT | Plataforma (operador dev) | `modulos/PLT.md` |

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

1. Cada archivo lleva `verificado: fecha @ sha`. Para saber si puede estar desactualizado: `git log <sha>..HEAD -- <fuentes>`; si hay commits, revisar.
2. Un cambio de comportamiento actualiza la spec del módulo **en el mismo commit**.
3. Lo que parece mal se registra como `PREG`, no se "arregla" en la spec. Solo José lo convierte en `BUG`.
4. Cambios clase C: spec, plan y tareas aprobados antes del código (`03-plan/cambios/`).
5. Máximo 400 líneas por archivo. Guía completa: `_plantillas/guia-de-escritura.md`.
6. Nunca secretos ni datos reales de clientes finales.
