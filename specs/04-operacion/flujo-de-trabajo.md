---
estado: vigente
verificado: 2026-10-09 @ 2cbd083
fuentes: [.github/workflows/ci.yml, start.sh, Dockerfile]
---

# Flujo de trabajo (git, deploys, verificación)

Aplica a cualquier persona o agente que modifique el repo. Solo existen dos ramas permanentes: **`dev`** (integración y entorno dev) y **`main`** (producción).

## 1. Una rama por trabajo

```bash
git checkout dev && git pull --ff-only origin dev
git checkout -b feature/<slug>        # o fix/<slug>, chore/<slug>, docs/<slug>
```

Una rama = un tema. Nunca se trabaja directo sobre `dev` ni sobre `main`.

## 2. Commits

- Español, formato `tipo: descripción` (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`). Cuerpo opcional con el porqué.
- Termina con la línea de atribución que indique la sesión de trabajo (el entorno la provee).
- Nunca se commitean secretos, `.env`, ni archivos de `apps/api/uploads/`.

## 3. Verificar antes de integrar

Desde la raíz del repo:

```bash
cd apps/api && npx tsc --noEmit          # tipos API
cd ../web   && npx tsc --noEmit          # tipos web
cd ../api   && npx vitest run            # tests (necesita Postgres local, ver desarrollo-local.md)
cd ../web   && npx vite build            # build web
```

Si tocaste el esquema de Prisma: migración nueva, **aditiva** (columna nullable o con default; nada de borrar o renombrar en el mismo release). Ver principio 1.

## 4. Integrar a `dev`

```bash
git checkout dev && git merge --no-ff <rama> -m "Merge <rama> into dev"
git push origin dev
git branch -d <rama>                      # borrar la rama local
git push origin --delete <rama>           # borrar la rama en GitHub (si llegó a subirse)
```

El push a `dev` dispara dos despliegues automáticos:
- **API dev** (Coolify, ~9–11 min): contenedor nuevo, health check, y recién ahí se retira el viejo.
- **Web dev** (Cloudflare Pages).

Verificar: `curl -s https://dev-api.4client.shop/health` responde `{"status":"ok"}` y `docker ps` en el VPS muestra la imagen con el sha nuevo (`<uuid-app>:<sha completo>`). Si el build falla (por ejemplo un corte de red al descargar paquetes) el contenedor anterior sigue sirviendo: reintentar el deploy desde Coolify.

## 5. Pasar a producción (`main`)

**Solo con OK explícito de José, cada vez.**

```bash
git checkout main && git pull --ff-only origin main
git merge --no-ff dev -m "Merge dev into main: <resumen>"
git push origin main
```

Dispara el deploy de la API prod (Coolify) y de la web prod (Cloudflare Pages). La API ejecuta `prisma migrate deploy` al arrancar. Verificar: contenedor nuevo con el sha, 0 reinicios, `GET https://api.4client.shop/health` ok, `https://4client.shop/` responde 200, y cero errores nivel 50/60 en los logs de los primeros minutos.

Preferir ventanas tranquilas (después del cierre de caja). Una documentación pura (`specs/`, `*.md`) puede viajar a `main` junto con el siguiente release real, no sola.

## 6. Si un deploy falla

| Síntoma | Qué hacer |
|---|---|
| `ECONNRESET` o error de red en `pnpm install` / descarga de Prisma | Reintentar el deploy en Coolify; el contenedor viejo sigue vivo |
| El deploy automático no se dispara | Revisar el webhook de GitHub (Recent Deliveries) y que el puerto 8000 del VPS responda a GitHub; ver `runbooks.md` |
| Contenedor nuevo reinicia en bucle | Mirar logs; la versión anterior sigue sirviendo hasta que el health check del nuevo pase |

## 7. Al terminar la sesión

1. Actualizar la spec del módulo tocado (y su campo `verificado`).
2. Si el trabajo era un cambio clase C, actualizar su `CH-nnnn` (estado, sha).
3. Actualizar `specs/00-estado-actual.md` (qué hay en prod, qué en dev, qué sigue).
4. Anotar sospechas nuevas como `PREG` en `03-plan/preguntas-abiertas.md`.

## 8. Clases de cambio

| Clase | Qué es | Qué exige |
|---|---|---|
| **A** | Trivial: texto, estilo, refactor sin cambio de comportamiento, dependencias | Nada de specs |
| **B** | Fix o cambio acotado a un módulo, sin esquema ni API nueva | Actualizar la spec del módulo en el mismo commit |
| **C** | Feature, esquema, API, dinero o privacidad | `CH-nnnn` aprobado por José **antes** de programar |
