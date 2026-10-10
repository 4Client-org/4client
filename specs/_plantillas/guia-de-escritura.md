---
estado: vigente
verificado: 2026-10-10 @ 1edb809
---

# Guía de escritura de specs

Para quien escriba o actualice un archivo de `specs/` (persona o agente).

## Principio: solo lo que el código no dice

Una spec registra **intención, reglas, invariantes, flujos entre módulos, permisos, el porqué y las trampas**. No copia lo que ya está en el código:
- Nada de listas de campos de la base (eso es `apps/api/prisma/schema.prisma`).
- Nada de parámetros de cada endpoint (eso es el código de `apps/api/src/routes/`).
- Nada de resúmenes archivo por archivo.

Si una afirmación se puede leer en cinco segundos en el código, no va. Si requiere leer tres archivos para entenderla, o es una decisión, sí va.

## Estructura de un archivo

- **Resumen arriba:** un párrafo con `> **Resumen.** …` justo después del título: qué cubre, qué decide y qué es lo más importante.
- **Diagramas Mermaid** solo cuando aclaran lo que la prosa no: contexto y contenedores (`flowchart`), un flujo entre actores (`sequenceDiagram`), una máquina de estados real (`stateDiagram-v2`), un despliegue. Máximo uno o dos por archivo; no decorativos.
- **Tablas** para listas de hechos comparables (límites, endpoints, variables, runbooks); prosa para el porqué.
- **Pendientes al final:** solo el ID y una línea; el texto completo vive en `03-plan/`.
- **Frontmatter:** `estado`, `verificado: AAAA-MM-DD @ sha` y `fuentes`.

## Reglas de estilo

- **Idioma:** español. Identificadores de código, rutas y nombres de campo tal cual, entre acentos graves (`payment_method`). Términos de negocio según `01-funcional/glosario.md`; si falta uno, no lo inventes: repórtalo.
- **Referencias al código:** `ruta › símbolo` (por ejemplo `apps/api/src/routes/cierre.ts › POST /`). **Nunca números de línea** (cambian).
- **Tests:** cita `archivo › "título del test"` real. Si una regla no tiene test, escribe *(sin test)*.
- **Reglas de negocio:** ID `RN-<MOD>-nn`, numeradas desde 01 dentro del módulo. Una regla = una afirmación verificable. Eventos: "CUANDO …, el sistema DEBE …". Invariantes: "Siempre …" / "Nunca …".
- **Valores con número** (24 h, 3 pedidos, 10 min, 21:00): escribe el número exacto y verifica que coincide con el código.
- **Fuente de cada regla** entre paréntesis: *(código)* si lo verificaste leyendo el código, *(José)* si lo dijo José, *(inferido)* si lo deduces de comentarios o commits. Y su alcance: *(plataforma)* si aplica a todos los negocios, *(cliente)* si es configuración de un negocio (por ejemplo el mínimo de domicilio).
- **Documenta el comportamiento actual verificado.** Si algo parece un error o contradice un comentario o la intención aparente, **no lo declares bug**: descríbelo como es y regístralo como `PREG` (pregunta para José). Solo es `BUG` si José lo confirmó.
- **Sin secretos ni datos reales:** nunca contraseñas, tokens, URLs de base con credenciales, ni teléfonos, nombres o cuentas bancarias reales. Ejemplos con datos ficticios (`+57 300 000 0000`).
- **Tamaño:** máximo 400 líneas por archivo. Usa tablas cuando sea posible.

## IDs

- `RN-<MOD>-nn` regla de negocio (por módulo). `BUG-nnn`, `DT-nnn` (deuda técnica), `PREG-nnn` globales y secuenciales. `CH-nnnn` cambio. `D-nn` decisión.
- Un ID nunca se reutiliza. Lo obsoleto se tacha (`~~RN-X-03~~ → ver RN-X-07`).
- Los pendientes nuevos que descubras en un módulo se anotan en su sección 3 con ID provisional (`PREG-<MOD>-p1`, `BUG-<MOD>-p1`, `DT-<MOD>-p1`); quien consolida asigna el ID global y deja la trazabilidad en `03-plan/mapa-de-ids.md`.

## Verificación

Antes de dar por terminado un archivo: cada regla, número y `ruta › símbolo` debe haberse comprobado leyendo el código. El campo `verificado:` lleva la fecha y el sha corto de `dev` contra el que se comprobó.

## Aclaraciones (aprendidas con el módulo piloto)

- **Fuente del porqué:** la regla puede ser *(código)* y su "por qué" *(inferido)* de un commit; si importa, escribe ambas etiquetas.
- **Evidencia solo en datos** (por ejemplo un valor raro visto en la base de dev): usa *(datos)*, no *(código)*.
- **Tabla regla → cumplimiento → test:** la primera vez escribe `ruta › símbolo` completo; en las celdas puedes abreviar al nombre del archivo si no es ambiguo. Con varios tests, cita los más representativos (no hace falta listar los cuatro).
- **Permisos:** si el módulo cubre varias filas de la matriz de permisos, enuméralas y anota aparte dónde la **interfaz difiere de la API**.
- **PREG vs DT:** `PREG` = comportamiento cuya intención solo José puede confirmar (incluye huecos de concurrencia). `DT` = deuda técnica objetiva: código duplicado, tests que faltan, código muerto.
- **Dueño de cada regla (para no duplicar):** el congelamiento del día cerrado (`findDayClose`) lo documenta **CAJ**; ORD y FRM lo mencionan y enlazan. El paso a "mañana" de un pedido del formulario lo documenta **FRM**. La numeración de pedidos la documenta **ORD**; el renumerado del cierre, **CAJ**.
- **Estado del archivo:** `borrador` hasta que un verificador independiente lo revise; entonces `vigente`. Aunque tenga PREG abiertos, un archivo verificado es `vigente`.
- **Pendientes:** el texto completo de cada PREG/BUG/DT vive en `03-plan/` (una sola vez). En el módulo, la sección 3 deja el ID y una línea. Durante la redacción, los IDs provisionales (`PREG-<MOD>-pN`) llevan su texto completo en el módulo; la consolidación lo mueve.
