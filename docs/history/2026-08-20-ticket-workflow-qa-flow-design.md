# Diseño — Rediseño del flujo de `ticket-workflow`: QA manual, Orca y capturas hidratadas

> **Histórico**: este documento describe el diseño previo a la unificación en `claude-workbench` y no refleja el estado actual del repo. Se conserva por el razonamiento que registra, no como referencia vigente — ver `docs/superpowers/specs/2026-08-24-claude-workbench-design.md` para el diseño actual.

**Fecha:** 2026-08-20
**Estado:** aprobado
**Skill afectada:** `skills/ticket-workflow/`

## Problema

El flujo original (11 pasos) llevaba un ticket de link a PR, pero tenía cuatro
huecos que aparecieron al usarlo en el día a día sobre un proyecto real:

1. **No había verificación real antes del commit.** Se commiteaba código sin
   haberlo ejercitado en la app, y la validación manual quedaba para después
   del push — cuando ya era caro corregir.
2. **Las capturas eran arqueología.** El paso 6 pedía screenshots
   "antes/después", lo que obligaba a revertir el código para fotografiar el
   estado viejo. Trabajo puro sin valor: el revisor necesita ver que lo nuevo
   funciona, no un museo de lo que había.
3. **El estado del ticket quedaba desactualizado.** Nada movía el ticket a
   `In Progress` al arrancar ni a `In Review` al abrir la PR, así que el
   tablero no reflejaba en qué se estaba trabajando.
4. **Las ramas no eran visibles en Orca IDE.** Se creaban con `git checkout -b`
   en el checkout actual, así que el trabajo no aparecía como worktree propio
   en la UI de Orca — ni en front ni en back.

Además, el comentario del ticket era técnico y largo. Lo lee gente de negocio,
que no necesita el nombre del componente pero sí saber qué cambió para el
usuario.

## Decisiones

### 1. El QA manual es un paso propio y bloqueante, antes del commit

Se agrega el paso 7: levantar la app local, ejercitar los casos de prueba del
ticket en el navegador embebido de Orca, loguearse con el usuario o rol que el
ticket pida, y capturar una screenshot por caso. El commit **no** ocurre hasta
que el usuario da el OK sobre esos casos.

**Por qué el navegador de Orca y no `claude-in-chrome`:** el usuario ve la
sesión en vivo dentro de la misma app donde trabaja, y el navegador está
scopeado al worktree — no hay ambigüedad sobre qué rama se está probando.

**Por qué local y no stage:** stage tiene el código viejo. El QA tiene que
ejercitar el cambio que todavía no se commiteó.

### 2. Solo se captura el estado implementado

Se elimina toda instrucción de revertir código para fotografiar el estado
anterior. Una captura por caso de prueba, del resultado, con su título.

### 3. Las capturas van embebidas en el comentario, no adjuntas

Un adjunto de Linear es un link al pie del comentario; una imagen embebida se
renderiza inline. El flujo es `prepare_attachment_upload` → `PUT` a la URL
firmada → embeber el `assetUrl` como `![Caso N: ...](assetUrl)` en el cuerpo
del comentario.

### 4. El estado del ticket se mueve en dos puntos

`In Progress` al crear la rama, `In Review` al abrir la PR. El mismo cambio se
refleja en la tarjeta de Orca vía `worktree set --workspace-status`.

Linear no tiene campo de reviewer, así que el assignee del ticket **no** se
toca: el reviewer se asigna solo en la PR de GitHub. Cambiar el assignee
sacaría al autor de su propio ticket.

### 5. El reviewer se configura por repo, con default

El config del repo guarda un `default` y una lista de `options`, en handles de
GitHub. Si `askEveryTime` es `false` se usa el default sin preguntar; el usuario
puede pedir otro en el momento. Los handles concretos viven en el config del
repo de trabajo, no acá — `claude-brain` no guarda datos de ningún cliente.

### 6. Sincronizar con la rama base antes del commit, con merge

Antes de commitear: `git fetch origin` y, si la rama está atrasada respecto de
su base, `git merge origin/<base>` **dentro de la rama de trabajo**.

**Merge y no rebase:** la rama puede estar ya publicada, y rebasear historia
publicada obliga a force-push sobre una rama que otro puede haber leído.

**Conflictos:** se para y se avisa. Resolver conflictos en silencio es la forma
más rápida de perder trabajo ajeno.

### 7. La PR apunta a la rama de nacimiento, nunca a `main`

La base de la PR es la misma rama de la que se cortó la de trabajo (`dev`,
`stage`, o la que indicara el tag del ticket). `main` nunca es destino de una
PR de ticket.

### 8. El comentario del ticket se acota; la PR no

Comentario: 3 a 6 líneas, arranca por el impacto para el usuario y cierra con
una línea de dónde se tocó, sin pegar código. La descripción de la PR queda
técnica y detallada — solo la leen devs.

### 9. Las ramas se crean como worktrees de Orca

`orca-ide worktree create --repo id:<repoId> --base-branch <base>` en lugar de
`git checkout -b`, para que el trabajo sea visible en Orca IDE en los dos
repos. El `repoId` se guarda en el config del repo. Si Orca no está corriendo
o el repo no está registrado, se cae a `git checkout -b` y se avisa: la falta
de Orca no puede bloquear el trabajo.

## Estructura

`SKILL.md` mantiene los pasos ejecutables; el detalle operativo del QA baja a
`reference/qa-manual.md`. La alternativa de meter todo en `SKILL.md` lo llevaba
a ~460 líneas, que se cargan enteras cada vez que la skill aplica. Partir en
dos skills (`ticket-workflow` + `ticket-delivery`) se descartó: es un flujo
continuo y partirlo obliga a duplicar el config.

## Flujo resultante — 13 pasos

| # | Paso | Bloqueante |
|---|---|---|
| 0 | Detectar config del repo | — |
| 1 | Onboarding (solo primera vez) | pregunta |
| 2 | Leer el ticket | — |
| 3 | Analizar el workspace | confirma |
| 4 | Tipo de rama | pregunta |
| 5 | Crear rama/worktree + `In Progress` | — |
| 6 | Implementar | — |
| 7 | **QA manual en navegador** | **OK del usuario** |
| 8 | **Sync con la rama base** | para si hay conflictos |
| 9 | Commit | confirma |
| 10 | Push | confirma |
| 11 | Comentario con capturas embebidas | automático |
| 12 | PR + reviewer + `In Review` | confirma |

## Campos nuevos de config

`branchNameCI` (ya se usaba en el paso 4 pero faltaba en el schema), `orca`,
`reviewers`, `qa`. Las credenciales de los usuarios de prueba nunca van al
config: se usan los seeds del repo, y si no alcanzan se piden en el momento.

## Alcance

Se toca: `skills/ticket-workflow/SKILL.md`, sus tres archivos de `reference/`,
`playbooks/resolve-ticket.md` (espeja los pasos de la skill) y
`rules/git-conventions.md` (regla de base de PR y de sync previo al commit).
