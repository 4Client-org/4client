---
estado: vigente
actualizado: 2026-10-10
verificado: 2026-10-10 @ 1edb809
fuentes: [git log, estado de Coolify y Cloudflare Pages]
---

# Estado actual

Foto viva del proyecto. **Se actualiza al final de cada sesión de trabajo** (regla 6 de `AGENTS.md`). Si algo aquí contradice el código, gana el código: corrige este archivo.

## Producción y dev

| | Rama | Commit | Notas |
|---|---|---|---|
| **Producción** (`api.4client.shop`, `4client.shop`) | `main` | `a072a25` | Un cliente real: Fruver San Gabriel (en vivo desde 2026-07-25). Sin la política de privacidad en el dominio propio ni la limpieza de Vercel/Railway. |
| **Dev** (`dev-api.4client.shop`, `dev.4client.pages.dev`) | `dev` | `1edb809` | Incluye todo lo de producción más lo listado abajo. Fuente de Coolify de dev = GitHub App `4client-deploy-org`. |

Lo que `dev` tiene y `main` no, y viajará en el próximo release:
- Política de privacidad servida desde la web de 4Client (`apps/web/public/legal/`), con el aviso de privacidad y el formulario apuntando a la nueva URL.
- Eliminación de `vercel.json`, `nixpacks.toml` y menciones a Railway/Vercel.
- Toda la documentación SDD (`specs/`, `AGENTS.md`, `archivo/`), incluidos el horizonte (`00-horizonte.md`), el registro de cambios, los documentos técnicos de frontend y códigos de error, las guías de alta de negocio y diagnóstico de incidentes, y las decisiones D-17 a D-19 (borrado de datos solo `dev`, política de privacidad en el dominio propio, créditos pagados fuera de los totales).
- Ningún cambio de código de la API o la web respecto a producción, salvo la política de privacidad y la limpieza de Vercel/Railway: lo demás es solo documentación.

## En curso

- **Adopción de Spec Driven Development** (esta carpeta): escrita y **verificada contra el código** (11 módulos, documentos técnicos, operación e historia) y probada con un agente que solo leyó `AGENTS.md` y `specs/` (15/15 respuestas correctas, 3/3 "no especificado" en lo que no está documentado). Solo en `dev`. **Falta:** que José responda las preguntas de `03-plan/preguntas-abiertas.md` (139; 12 prioritarias, 31 ya respondidas; varias ya respondidas) y confirme la columna "por qué" de `05-historia/decisiones.md`.
- **Pulido profesional de las specs** (R-0015): cada módulo con alcance, dependencias y criterios de aceptación; siete documentos nuevos (modelo de datos, amenazas, datos personales, riesgos, observabilidad y continuidad, pantallas por rol, escenarios de punta a punta). Nuevas PREG-130 a PREG-136 y DT-043 a DT-048.
- **Pasar el repositorio a privado** (organización `4Client-org`): planeado para la noche del 2026-10-09. Orden: cambiar la fuente de `4client-api-prod` a la GitHub App → confirmar acceso de Cloudflare Pages → hacer el repo privado → verificar deploy de dev → redesplegar prod en un momento tranquilo. Reversa: volver a hacerlo público. El repo `fruver-san-gabriel-web` (política antigua + landing) se queda público.

- **Ramas:** solo existen `dev` y `main`, en local y en GitHub (limpieza del 2026-10-10, R-0016).

## Próximas prioridades (propuestas, a confirmar con José)

1. Responder las preguntas abiertas prioritarias de `03-plan/preguntas-abiertas.md`. Los créditos pagados **no** se acomodan en los totales por ahora (D-19, decisión de José 2026-10-09: el cliente no lo ha pedido).
2. Promover a `BUG` lo que José confirme que está mal.
3. Quitar del código lo específico del primer cliente (cuenta bancaria en plantillas por defecto, logo y política fijos) antes de un segundo cliente.
4. Reiniciar el VPS para aplicar actualizaciones de kernel pendientes, en ventana con caja cerrada y respaldo fresco.
5. Regenerar el manual de usuario desde `01-funcional` (el actual está desactualizado).

## Problemas abiertos principales

Ver `03-plan/problemas-conocidos.md` y `03-plan/preguntas-abiertas.md`.

## Cómo está organizado el contexto

`AGENTS.md` (reglas) → `00-horizonte.md` (rumbo) → este archivo → `00-principios.md` → módulo según el mapa de `AGENTS.md`. Índice completo en `specs/README.md`.
