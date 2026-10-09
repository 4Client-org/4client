---
estado: vigente | borrador | desactualizado
verificado: AAAA-MM-DD @ <sha corto>
fuentes: [rutas de código y tests en las que se basa]
---

# <CÓDIGO> — <Nombre del módulo>

> Una frase: qué hace este módulo y para quién.

## 1. Negocio

**Propósito.** …

**Permisos.** Fila de este módulo en `01-funcional/actores-y-permisos.md` (qué rol puede qué).

**Estados / ciclo de vida.** (Diagrama Mermaid solo si hay una máquina de estados real.)

**Reglas.** Una por entrada, con ID `RN-<MOD>-nn`. Eventos: "CUANDO …, el sistema DEBE …". Invariantes: "Siempre …" / "Nunca …". Cada valor se marca *(plataforma)* o *(cliente)*, y su fuente *(código)*, *(José)* o *(inferido)*.

- **RN-<MOD>-01 — título.** Regla. *(plataforma, código)*

**Textos que ve el cliente final.** Qué mensajes automáticos o pantallas recibe (sin copiar datos privados).

## 2. Técnico

**Mapa de código.** `ruta › símbolo` (nunca número de línea).

| Parte | Dónde |
|---|---|
| API | `apps/api/src/routes/… › handler` |
| Web | `apps/web/src/… › componente` |
| Datos | modelos Prisma tocados |

**Regla → dónde se hace cumplir → test.**

| Regla | Se hace cumplir en | Test |
|---|---|---|
| RN-<MOD>-01 | `ruta › símbolo` | `apps/api/test/x.test.ts › "nombre"` o *(sin test)* |

**Datos y eventos socket** que toca. **Transacciones y concurrencia** (locks, guardas atómicas). **Códigos de error** propios.

**Si tocas X, revisa Y.** Lista corta de dependencias ocultas.

## 3. Pendientes

Enlaces a `BUG-nnn`, `DT-nnn`, `PREG-nnn` (en `03-plan/`), cambios `CH-nnnn` y decisiones `D-nn` relacionados.
