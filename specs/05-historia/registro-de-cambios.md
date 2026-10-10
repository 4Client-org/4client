---
estado: vigente
actualizado: 2026-10-09
verificado: 2026-10-10 @ 1edb809
fuentes: [git log, specs/]
---

# Registro de cambios

**Bitácora de trabajo, un asiento por cambio.** Responde "qué se cambió, por qué, qué specs se tocaron y dónde quedó". Es distinto de:
- `changelog.md`: una línea por **release a producción**, pensada para humanos.
- `decisiones.md`: decisiones de fondo que no se deben deshacer a la ligera.
- `git log`: el detalle técnico completo.

## Regla (obligatoria; fuente única de detalle: este bloque; resumen en `AGENTS.md` regla 6 y `00-principios.md` 13–14)

1. **Quién y cuándo.** Quien hace el cambio (persona o agente) escribe el asiento **en la misma rama del cambio, antes de integrarla a `dev`**, y viaja en el mismo merge. Un cambio sin asiento está incompleto. Se escribe al **principio de la lista** (el más reciente primero).
2. **Qué cambios llevan asiento:** todo lo que se integra a `dev`, sea código, esquema, infraestructura, **solo documentación**, o un archivo movido o borrado. Incluye cambios clase A (en "Specs tocadas": "ninguna (clase A)"). Un cambio que no toca ninguna spec **sigue necesitando asiento**; lo que no necesita es corregir specs.
3. **Excepción (para no caer en regresión infinita):** completar los campos **Commit** y **Prod** de asientos ya existentes, la línea de `changelog.md` y `00-estado-actual.md` tras un release son anotaciones de contabilidad y **no generan asiento propio**.
4. **Campo Commit.** Al escribir el asiento no se conoce el sha del merge: se deja `(al integrar)`. La siguiente rama que toque este archivo reemplaza ese texto por el sha del merge a `dev` (`git log --merges --oneline -- <ruta>`).
5. **Campo Prod.** Queda `pendiente` hasta que el cambio viaja a `main` (con OK de José). Tras el release, una rama `docs/` desde `dev` pone el sha del merge a `main` en cada asiento incluido, agrega la línea en `changelog.md` y actualiza `00-estado-actual.md` (regla 3 de arriba: sin asiento propio).
6. **Los asientos no se editan** salvo lo permitido en 3–5 y para añadir un puntero "revertido por R-nnnn".

Cada asiento tiene:

| Campo | Contenido |
|---|---|
| **ID** | `R-nnnn` secuencial, nunca se reutiliza |
| **Fecha / rama** | Fecha (Bogotá) y nombre de la rama (`feature/…`) |
| **Qué cambió** | 1–4 líneas, en términos de comportamiento, no de archivos |
| **Por qué** | La razón o petición (de quién), no solo "mejora" |
| **Specs tocadas** | Archivos de `specs/` actualizados por este cambio, o "ninguna (clase A)" |
| **Obsoleto** | Lo que dejó de ser verdad y se corrigió (por ejemplo, un stack o regla anterior); "nada" si no aplica |
| **Commit** | `(al integrar)` y luego el sha del merge a `dev` (regla 4) |
| **Prod** | `pendiente` y luego el sha de `main` cuando viaje (regla 5) |

### Cuando algo queda obsoleto

Si un cambio vuelve falsa una parte de las specs (otro lenguaje, otra regla, otra infraestructura), **se corrigen en ese mismo cambio todos los archivos afectados**: nunca se deja documentación que describa lo anterior. El asiento lista cada archivo corregido en "Specs tocadas" y qué decía antes en "Obsoleto". Para ver el estado anterior de cualquier archivo basta `git log -p -- <ruta>`.

### Si un cambio es una reversa

Es un cambio como cualquier otro: **asiento nuevo** que cita el original (`revierte R-nnnn`) y añade al original el puntero "revertido por R-mmmm". Además, las specs que el original había corregido se **vuelven a corregir** para describir el comportamiento restaurado (regla de no dejar specs viejas), y si el original ya estaba en producción, la reversa viaja a `main` como cualquier release (`flujo-de-trabajo.md` §5; rollback urgente de infraestructura: `runbooks.md` §c, y el asiento se escribe después).

---

## Asientos (más reciente primero)

### R-0017 — Flujo: se prueba solo en dev (D-20)
- **Fecha / rama:** 2026-10-10, `docs/flujo-sin-previews`
- **Qué cambió:** nueva decisión D-20 (José solo prueba en `dev`, no en vistas previas de rama); PREG-131 queda respondida; `flujo-de-trabajo.md` lo dice en el paso 1.
- **Por qué:** respuesta de José a PREG-131.
- **Specs tocadas:** `05-historia/decisiones.md`, `03-plan/preguntas-abiertas.md`, `04-operacion/flujo-de-trabajo.md`.
- **Obsoleto:** nada.
- **Commit:** (al integrar) · **Prod:** pendiente

### R-0016 — Lista de pendientes de privacidad y seguridad, y limpieza de ramas
- **Fecha / rama:** 2026-10-10, `docs/lista-pendientes`
- **Qué cambió:** el roadmap suma los ítems 22 a 24 (solicitudes de titulares, cifrado frente a la política, bloqueo de cuenta por terceros). Se borraron las 36 ramas remotas ya integradas en `dev`; quedan solo `dev` y `main`, local y en GitHub.
- **Por qué:** pedido de José (2026-10-10): dejar esos temas en la lista de pendientes y que solo existan las dos ramas permanentes.
- **Specs tocadas:** `03-plan/roadmap.md`, `00-estado-actual.md`.
- **Obsoleto:** nada.
- **Commit:** `31da636` · **Prod:** pendiente

### R-0015 — Pulido profesional de las specs y siete documentos nuevos
- **Fecha / rama:** 2026-10-10, `docs/specs-profesional`
- **Qué cambió:** los 11 módulos ganan alcance, dependencias y criterios de aceptación; glosario reescrito; resúmenes y diagramas en los documentos técnicos, de plan, operación e historia. Nuevos: `02-tecnico/modelo-de-datos.md`, `modelo-de-amenazas.md`, `datos-personales.md`, `03-plan/riesgos.md` (RK-01..RK-24), `04-operacion/observabilidad-y-continuidad.md`, `01-funcional/pantallas-por-rol.md`, `escenarios-extremo-a-extremo.md`. Registradas PREG-130..136 y DT-043..048.
- **Por qué:** José pidió revisar las specs a fondo, que estén completas, profesionales y con los documentos que falten.
- **Specs tocadas:** todas las de `specs/` (revisión), `AGENTS.md` (mapa), `specs/README.md`, `00-estado-actual.md`, `seguridad-y-privacidad.md`, `arquitectura.md`.
- **Obsoleto:** conteo de preguntas abiertas (129 → 136); "sin test" de RN-INB-01 si el verificador lo corrigió.
- **Commit:** `06bd284` · **Prod:** pendiente

### R-0014 — Horizonte, registro de cambios y revisión de completitud de las specs
- **Fecha / rama:** 2026-10-09, `docs/horizonte-y-registro`
- **Qué cambió:** se crearon `00-horizonte.md` (rumbo del producto: báscula conectada, pagos, siguiente etapa), este registro de cambios, `02-tecnico/frontend.md`, `codigos-de-error.md`, `04-operacion/alta-de-negocio.md`, `diagnostico-de-incidentes.md` y `_plantillas/checklist.md`; se agregaron las reglas "las specs nunca quedan viejas" y "todo cambio deja asiento"; se sumaron 14 reglas de cobertura en ACC, CAJ, INB, ORD, PLT y WPP (cifrado, sanitizado, scripts, PWA, hooks); se respondió D-17; se asignaron PREG-123 a PREG-129 y DT-041 y DT-042.
- **Por qué:** José pidió que cualquier agente lea siempre el horizonte, que quede trazabilidad de todo cambio, que nunca haya documentación vieja y que las specs queden completas.
- **Specs tocadas:** `00-horizonte.md`, `00-principios.md` (principios 13 y 14), `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `specs/README.md`, `00-estado-actual.md`, `01-funcional/vision-y-direccion.md`, `02-tecnico/*` (4 archivos), `03-plan/*`, `04-operacion/*`, `05-historia/decisiones.md`, `modulos/{ACC,CAJ,INB,ORD,PLT,WPP}.md`, `_plantillas/checklist.md`.
- **Obsoleto:** las prioridades del roadmap sobre créditos pagados (ya cerradas por D-19) y la ubicación de varias ideas (login por usuario y 2FA de admins pasaron a "Siguiente").
- **Commit:** `1edb809` · **Prod:** pendiente

### R-0013 — Respuestas de José: price, Coolify/Cloudflare, 2FA solo dev, PDF en navegador
- **Fecha / rama:** 2026-10-09, `docs/porques-jose` · **Commit:** `5d8e69d` · **Prod:** pendiente
- **Qué cambió:** el "por qué" de D-02, D-06, D-10 y D-12 pasó de pregunta a decisión respondida; se añadieron al roadmap el login por nombre de usuario, el 2FA de administradores y evaluar el PDF en servidor.
- **Por qué:** respuesta directa de José a las preguntas PREG-118 a PREG-121.
- **Specs tocadas:** `05-historia/decisiones.md`, `03-plan/preguntas-abiertas.md`, `03-plan/roadmap.md`.
- **Obsoleto:** nada.

### R-0012 — Créditos pagados no se acomodan en los totales (D-19)
- **Fecha / rama:** 2026-10-09, `docs/credito-decision` · **Commit:** `939287e` · **Prod:** pendiente
- **Qué cambió:** se registró la decisión de que un crédito pagado después no se cuenta en ningún total del cierre ni del informe; queda solo en el módulo de Crédito. No hay cambio de código.
- **Por qué:** el cliente no ha pedido gestionarlo; decisión de José "por ahora".
- **Specs tocadas:** `05-historia/decisiones.md` (D-19), `03-plan/preguntas-abiertas.md`, `03-plan/roadmap.md`, `00-estado-actual.md`, `modulos/CAJ.md`.
- **Obsoleto:** la prioridad "resolver créditos pagados" del roadmap y del estado actual.

### R-0011 — Adopción de Spec Driven Development
- **Fecha / rama:** 2026-10-09, `docs/specs-sdd` · **Commit:** `77af0cd` · **Prod:** pendiente
- **Qué cambió:** nació `specs/` (11 módulos, documentos técnicos, operación, historia, plan), `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`; `Requerimientos/` y `RoadMap/` pasaron a `archivo/`; el `README.md` se reescribió.
- **Por qué:** que cualquier agente o modelo nuevo tenga el contexto completo del proyecto leyendo solo `specs/`.
- **Specs tocadas:** todas (creación).
- **Obsoleto:** `README.md` (Railway/Vercel, rama `test`, referencia de API falsa), manual de usuario y planes originales (marcados históricos).

### R-0010 — Quitar Vercel y Railway del repo
- **Fecha / rama:** 2026-10-09, `chore/quitar-vercel-railway` · **Commit:** `2cbd083` · **Prod:** pendiente
- **Qué cambió:** se borraron `vercel.json` y `nixpacks.toml`; se actualizaron README, comentarios del código y el panel de links de DevTools. Sin cambio de comportamiento.
- **Por qué:** esa infraestructura ya no se usa (solo Coolify, GitHub y Cloudflare).
- **Specs tocadas:** ninguna (antes de existir `specs/`).
- **Obsoleto:** menciones a Railway/Vercel en README y comentarios.

### R-0009 — Política de privacidad en el dominio de 4Client
- **Fecha / rama:** 2026-10-09, `feature/legal-en-dominio` · **Commit:** `bb6e1e8` · **Prod:** pendiente
- **Qué cambió:** la política (Ley 1581) se sirve desde `/legal/politica-privacidad` de la propia web; el aviso de privacidad del chat y el formulario apuntan ahí; el service worker no la intercepta. Contenido y versión (`v1`) sin cambios.
- **Por qué:** no depender de otro repo público (GitHub Pages) y poder pasar el repo principal a privado.
- **Specs tocadas:** ninguna (antes de existir `specs/`; documentado después en `modulos/FRM.md` y `WPP.md`).
- **Obsoleto:** la URL anterior de la política (queda viva en su repo antiguo).

### R-0008 — Aviso en vivo al guardar plantillas de mensajes
- **Fecha / rama:** 2026-10-09 · **Commit:** `4a060c2` · **Prod:** `a072a25`
- **Qué cambió:** al guardar un texto en Configuración > Mensajes, el servidor avisa por socket (`message-templates:changed`) y todas las sesiones lo recargan al instante (antes tardaban hasta 5 minutos).
- **Por qué:** el mínimo de domicilio se actualizó a $20.000 y otras sesiones seguían mandando el texto viejo.

### R-0007 — El corte de las 9 p.m. va por primer mensaje real del día
- **Fecha / rama:** 2026-10-08 · **Commits:** `b8f83a5`, `55de2fc`, `aec85c4` · **Prod:** `fed1270`
- **Qué cambió:** un chat cuyo primer mensaje real del día llega entre las 21:00 y las 23:59 (Bogotá) cuenta para el día siguiente en el tablero. Segundo intento: solo para chats nuevos; tercero (vigente): por primer mensaje del día, sea el ticket nuevo o viejo.
- **Por qué:** que un chat nocturno no quede enterrado en un día ya cerrado.
- **Specs:** documentado después en `modulos/WPP.md` (RN-WPP-10) y `00-principios.md` (principio 5).

### R-0006 — Chat y pedido con el mismo encabezado, tamaños y botones
- **Fecha / rama:** 2026-10-06 · **Commits:** `ffc3d47`, `956dc93`, `90f38f2`, `39d96a3` · **Prod:** `9efc3c8`
- **Qué cambió:** el chat de conversación, el del pedido y el del nuevo pedido tienen el mismo ancho (660 px), el mismo orden de botones en una sola fila y los mismos tamaños de texto (títulos 16 px, campos 13 px).
- **Por qué:** pedido de José: que los modales se vean iguales salgan de donde salgan.

### R-0005 — Mensajes editables por organización y botón "Cuenta banco"
- **Fecha / rama:** 2026-10-05 y 2026-10-06 · **Commits:** `3432aec`, `024365b`, `bb8e23d`, `52aed92` · **Prod:** `c87e363`, `ad347c7`
- **Qué cambió:** botón "Cuenta banco" en el chat; los textos del formulario, el seguimiento y la cuenta bancaria se editan por organización en Configuración > Mensajes (admin y dev); cada campo guarda solo lo que se editó; se quitó "Restaurar texto original"; el mínimo y costo del domicilio quedaron en el texto por defecto.
- **Por qué:** que el administrador cambie esos mensajes sin depender de José.

### R-0004 — "Eliminar datos" solo para dev
- **Fecha / rama:** 2026-10-06 · **Commit:** `1dce1d6` · **Prod:** `ad347c7`
- **Qué cambió:** el borrado de datos de un cliente final (Ley 1581) lo hace solo el rol `dev`, en la interfaz y en la API (antes también el admin).
- **Por qué:** acción irreversible; hoy José opera la plataforma y se abrirá al admin cuando haya más clientes (D-17).

### R-0003 — Seguridad y dependencias
- **Fecha / rama:** 2026-10-03 · **Commit:** `f89ec15` · **Prod:** `2c04e31`
- **Qué cambió:** se cerraron vulnerabilidades de auditoría y de dependencias (Fastify 5.12.5, overrides de paquetes), sin cambio de funcionalidad.

### R-0002 — Endurecimiento del VPS (fuera del repo)
- **Fecha:** 2026-10-03 y 2026-10-09 · **Prod:** (infraestructura)
- **Qué cambió:** SSH solo con llave; puerto del dashboard de Traefik bloqueado desde fuera con una regla persistente; el 2026-10-09 se corrigió esa regla porque también bloqueaba el puerto de Coolify y los despliegues automáticos desde GitHub dejaron de llegar.
- **Specs:** `04-operacion/entornos-y-despliegue.md`, `runbooks.md`.

### R-0001 — Migración a Coolify y GitHub App
- **Fecha:** 2026-09-20 (dev y prod en Coolify) y 2026-10-09 (GitHub App `4client-deploy-org` para dev)
- **Qué cambió:** API y bases en un VPS con Coolify; web en Cloudflare Pages; dev ya clona con una GitHub App, prod pasa esta noche.
- **Por qué:** precio y control (D-06).
