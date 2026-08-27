---
name: ticket-workflow
description: Use cuando ya hay un ticket concreto que trabajar acá: leerlo, cortar la rama, implementar, probar en el navegador, commitear y dejar el trabajo listo para publicar. Es la skill del **hijo**: normalmente la invoca el agente que el conductor despachó en el worktree de ese ticket, y ahí el interlocutor de los cinco gates es quien lo despachó, no el usuario. Si el usuario pega un link o ID de ticket en una sesión que no es un hijo despachado, el punto de entrada es `conductor` — él crea el worktree y el hijo, y esta skill corre adentro. NO aplica para crear ramas sin relación a un ticket, ni para abrir la PR de un trabajo que no pasó por acá (ver playbook create-pr).
---

# Ticket Workflow

## Propósito

Llevar un ticket de un tracker (Linear, Jira, Trello, GitHub Issues, etc.) desde
que se recibe el link hasta que el trabajo está probado, commiteado y dejado
listo para publicar — y, una vez que el humano publica la rama, comentado en
el ticket y con su PR abierta y asignada a revisión — siguiendo siempre la
convención de ramas y commits específica del repo donde se trabaja, sin volver a
preguntar lo ya configurado, sin commitear nunca sin confirmación explícita, y
sin pushear nunca: publicar la rama es decisión del humano, no de quien trabaja
el ticket.

## Dónde corre esta skill, y con quién habla

Esta skill trabaja **un ticket, dentro de un worktree**. Casi siempre la corre un
agente hijo que despachó el conductor, y eso define tres cosas que no se deducen
del ticket:

- **Tu interlocutor es quien te despachó, y es el único.** Los cinco gates de
  abajo se le preguntan a él con `ask`. El conductor resuelve los que puede y
  sube al usuario los delicados; **cuál de los dos contestó no es asunto tuyo**,
  y no hay que averiguarlo. Lo que no se hace es resolverlos solo "porque el
  conductor está ocupado": un gate que nadie contestó no está contestado.
- **Al usuario no le hablás.** No escribas para él, no lo esperes, no le pidas
  nada: no está mirando tu pane. Todo lo que tenga que saber lo reporta el
  conductor, así que lo que tengas para decir va para arriba, en tus mensajes y
  en el comentario del ticket.
- **Tu mundo es un solo worktree: el tuyo.** No listes, no leas, no modifiques ni
  razones sobre otros worktrees, otras ramas, otros tickets ni otros agentes,
  aunque estén al lado en el mismo directorio y los puedas ver. No sabés qué pasa
  más arriba ni cuántos hermanos hay, y no te hace falta. Si te llega una orden
  que no dice sobre qué worktree es, es sobre el tuyo; si de verdad no se puede
  saber, **preguntá** — no la interpretes en grande. No bajes containers ni borres
  worktrees o ramas que no sean de tu ticket.
- **No delegás en otro agente.** Ni despachando por Orca, ni lanzando subagentes
  dentro de tu propia sesión — ni para el QA, ni para explorar código, ni para
  revisar tu diff. Todo lo de este ticket lo hacés vos, acá. Si una skill global
  te sugiere paralelizar con subagentes, en este flujo no aplica: cada agente
  extra levanta su propio contexto y puede levantar su propio stack, y esta
  máquina tiene otros worktrees corriendo que vos no ves.

  Y si te llega **otro ticket**, lo reportás para arriba y no lo agarrás:
  despachar es del conductor.

Si en cambio esta skill se invocó **sin** conductor (no hay orquestación, o el
usuario la pidió explícitamente para un ticket en este checkout), el interlocutor
es el usuario directo y todo lo demás del flujo no cambia.

## Las preguntas no se saltean nunca

Hay cinco puntos donde decide el usuario, no la skill:

| # | Gate | Paso |
|---|---|---|
| 1 | Tipo de rama | 4 |
| 2 | Cómo encarar la tarea (el cráneo) | 6 |
| 3 | OK del QA manual | 8 |
| 4 | Commit | 10 |
| 5 | Abrir la PR | 13 |

**Un label del ticket o un valor del config pre-llenan la propuesta; no
reemplazan la pregunta.** Que el ticket tenga label `Bug` no decide el tipo de
rama: propone `fix` y se confirma. Que el config tenga `baseBranch: "dev"` no
decide la rama base: es el fallback, y sin señal del ticket se pregunta.

Reglas de forma:

- **Una pregunta por vez.** Nunca amontonar las cinco en un mensaje para
  "avanzar más rápido".
- **La respuesta vale para el turno actual.** Un OK anterior no autoriza el
  paso siguiente.
- **El silencio no es un sí.** Si el usuario cambia de tema sin contestar, se
  vuelve a preguntar; no se asume.
- **Ante duda entre preguntar y asumir, se pregunta.** Preguntar de más cuesta
  un mensaje; asumir de más cuesta rehacer el trabajo.
- **Un hallazgo de review que vuelve por `reply` se arregla, no se discute.** El
  conductor le pasa `code-review` a tu diff antes de aprobar un gate; si te
  devuelve algo, es parte del mismo gate y todavía no está aprobado. Si no estás
  de acuerdo, contestá con el argumento — pero no sigas de largo.

## Lo que no se toca en el tracker

El ticket que te dieron se comenta y se mueve de estado. **Nada más**, y nada
fuera de él.

- **No se crean tickets.** Ni sub-issues, ni follow-ups, ni un ticket "para lo
  que quedó pendiente", ni uno para el bug que apareció de paso. Aunque el
  hallazgo sea real y valga la pena, **se pide permiso primero**: se reporta qué
  se encontró y se espera. Un ticket que nadie pidió aparece en el board del
  equipo, entra en la planificación de alguien, y el que lo creó no está para
  explicarlo.
- **No se reasigna, no se cambia prioridad, estimación ni labels.** Eso es
  triage, y el triage lo hace el equipo.
- **Los dos únicos cambios de estado son los del propio ticket**: a `In Progress`
  al cortar la rama, y a `In Review` al abrir la PR.
- **No se tocan otros tickets**, ni para comentar, ni para linkear, ni para
  cerrarlos por duplicado.

Si el trabajo desborda el alcance del ticket, eso es un gate: se reporta y se
pregunta — nunca se abre trabajo nuevo por cuenta propia.

## Requiere

**Capabilities**
- `capabilities.orca` — opcional. Sin ella, ver `core/resolve.md`: se cae a
  `git checkout -b` en el checkout actual y se avisa en una línea.
- `capabilities.gh` — para resolver los handles de reviewers desde
  `gh api repos/<owner>/<repo>/collaborators`.

**Config**
- `project.trackerPrefix` — prefijo del tracker de este repo.
- `project.tracker` — qué tracker usa este repo.
- `project.branchTypes` — tipos de rama válidos, para la pregunta del paso 4.
- `project.descriptionLanguage` — idioma de la descripción de rama y commits.
- `project.baseBranch` — rama base por defecto, solo como fallback.
- `project.baseBranchFromTicketLabel` — mapeo de label de ambiente a rama base.
- `project.environmentLabelGroup` — el grupo de labels que son de ambiente.
- `project.environmentLabels` — qué labels de ese grupo son admitidas como ambiente real (no todo hijo del grupo lo es, ver paso 2).
- `project.typeLabelMap` — mapeo de label de tipo a tipo de rama propuesto.
- `project.commitConvention` — convención de mensajes de commit.
- `project.branchPattern` — patrón de armado del nombre de rama.
- `project.branchNameCI` — si el repo valida el nombre de rama por CI.
- `project.orca.repoId` — repo en Orca donde crear el worktree.
- `project.orca.useWorktrees` — si la rama se crea como worktree de Orca.
- `project.orca.worktreeLevel` — a qué nivel se crea el worktree.
- `project.reviewers` — reviewers posibles de este repo, y el default.
- `project.qa` — cómo levantar la app local para el QA del paso 8, y cómo bajarla al cerrarlo.

Ante un campo ausente o una capability que falta, seguir `core/resolve.md`.
No completar en silencio: es la misma regla que ya aplica a los cinco gates
de este flujo.

## Cuándo usarla

- El usuario pega un link de un ticket (`https://linear.app/...`, `https://empresa.atlassian.net/browse/...`, etc.).
- El usuario pega solo un ID (`EX-107`) y por contexto de la conversación ya se sabe el tracker.
- El usuario dice "poné manos a la obra con este ticket" o equivalente.

## Cuándo NO usarla

- Crear una rama sin ticket asociado (rama exploratoria, spike, etc.) — hacelo directo, sin este flujo.
- El usuario ya tiene una rama creada y solo pide ayuda a implementar código — no hace falta re-disparar el onboarding ni la creación de rama.
- Se pide explícitamente "solo leeme el ticket, no hagas nada todavía" — leé el ticket y parate ahí; no sigas el flujo completo.
- Crear la PR de un trabajo que no pasó por esta skill (ej. un hotfix manual) — usá directamente el playbook [`create-pr`](../../knowledge/playbooks/create-pr.md).

## Pasos detallados

### 0. Detectar si es la primera vez en este repo

Antes de nada, revisar si existe la config de proyecto en el repo de trabajo
actual (ver [`core/config-schema.md`](../../core/config-schema.md) para el
formato exacto). Si el directorio actual contiene varios repos git
hijos (workspace con front/back), revisar en cada uno.

- **No existe en ninguno** → ir al paso 1 (onboarding).
- **Existe** → saltar directo al paso 2.

### 1. Onboarding (solo la primera vez, por repo)

Preguntar, en este orden, **una pregunta a la vez**:

1. Prefijo del workspace del tracker (ej. `EX` para `EX-107`). Si el ticket ya
   se pegó, se puede inferir del link/ID y solo confirmar.
2. Qué tipos de rama va a usar este repo (sugerir por defecto:
   `feature, fix, bug, hotfix, chore, refactor` y dejar que el usuario ajuste).
3. Idioma de la descripción de la rama y de los commits: español o inglés.
4. Convención de mensajes de commit — si el repo ya tiene una definida en su
   propio `CLAUDE.md`, `CONTRIBUTING.md` o `rules/`, usar esa y solo confirmarla;
   si no, preguntar explícitamente (no asumir Conventional Commits por defecto).
5. Rama base desde la que se crean las ramas de trabajo (default sugerido: `dev`).
   Este default es solo el *fallback* cuando el ticket no trae ninguna señal
   propia — ver paso 2 y paso 5 para el caso en que el ticket especifica su
   propia rama base vía tag/label.
6. **Cómo se leen las labels del tracker**: qué grupo agrupa los ambientes,
   qué label mapea a qué rama base (y cuáles no son ramas, tipo `draft` o
   `design`), y qué labels de tipo mapean a qué tipo de rama. Listar las
   labels reales del tracker y proponer el mapeo, no inventarlo.
7. **Cómo se levanta la app localmente** para el QA del paso 8 (ej. `pnpm dev`)
   y en qué URL queda (ej. `http://localhost:3000`). Si el repo ya lo documenta
   en su `README.md` o `package.json`, proponerlo y solo confirmar.
8. **Quiénes pueden ser reviewers de las PRs de este repo**, y cuál es el
   default. Los valores son handles de GitHub, no nombres — resolverlos con
   `gh api repos/<owner>/<repo>/collaborators` y confirmar el mapeo con el
   usuario si hay ambigüedad.

Guardar todo en `.claude/workbench.project.json` en la raíz del repo
correspondiente. **Nunca guardar credenciales en este archivo** — los usuarios
de prueba del paso 8 salen de los seeds del repo o se piden en el momento. No
commitear el config salvo que el usuario lo pida explícitamente (es preferencia
local, no necesariamente algo para compartir con el equipo).

### 2. Leer el ticket

- Si el link corresponde a un tracker con MCP conectado en la sesión (ej.
  Linear vía `mcp__claude_ai_Linear__get_issue`), leerlo directo: título,
  descripción, labels, proyecto/equipo.
- Si no hay MCP disponible para ese tracker (Jira, Trello sin integración,
  etc.), avisar explícitamente: "no tengo acceso a [tracker] en esta sesión,
  pegame el título y la descripción del ticket para seguir." No usar WebFetch
  como sustituto salvo pedido explícito del usuario — la mayoría de estos
  links no son públicos.
- **Leer las labels del ticket por grupo, no por parecido.** Los trackers
  agrupan labels bajo un padre, y el grupo es lo que les da significado:

  - **Label de ambiente** — la que pertenece al grupo configurado en
    `environmentLabelGroup` (ej. `Ambiente`, con hijos `dev`, `stage`, `prod`,
    `draft`, `design`). Determina desde qué rama se corta la de trabajo, en el
    paso 5. **No todos los hijos del grupo son ramas**: `draft` y `design`
    significan que el ticket todavía no tiene ambiente, o sea que **hay que
    preguntar**. El config lo declara en `environmentLabels`.
  - **Label de tipo** — `Bug`, `Feature`, `Improvement` u otras planas. Es la
    propuesta del tipo de rama del paso 4, según el `typeLabelMap` del config.
  - **El resto** (módulo, release, área de producto) no se usa para decidir
    rama ni tipo. No inventarles significado.

  Ambiente y tipo son señales distintas y no se mezclan: el ambiente es de
  dónde nace la rama, el tipo es la naturaleza del cambio.
- **Anotar los casos de prueba que el ticket describe o implica**, y con qué
  usuario o rol hay que ejercitarlos (ej. "como tutor externo, entrar al panel
  de cierre"). Esto es la entrada del paso 8; si el ticket no dice nada, el
  paso 8 los propone.

### 3. Analizar el workspace

- Si el directorio de trabajo es un único repo git → trabajar ahí directamente,
  sin preguntar.
- Si el directorio contiene múltiples repos git hijos (ej. `proyecto/frontend`,
  `proyecto/backend`) → leer el contenido del ticket y decidir a cuál(es)
  aplica el cambio (ej. "error de color en un modal" → solo frontend; "el
  endpoint devuelve 500" → solo backend; "agregar campo nuevo en el formulario
  y persistirlo" → ambos). Comunicar la decisión antes de crear ninguna rama:
  "Por el contenido del ticket, esto aplica a frontend. ¿Confirmás o también
  hace falta tocar backend?"

### 4. Preguntar el tipo de rama

**Siempre se pregunta**, incluso si ya existe el config y incluso si el label
lo deja obvio. Lo que cambia es qué tan armada llega la propuesta:

- **El ticket tiene label de tipo mapeada** en `typeLabelMap` (ej. `Bug` →
  `fix`, `Feature` → `feat`) → proponerlo y confirmar en una línea: "El ticket
  tiene label `Bug`, así que va como `fix`. ¿Confirmás?"
- **El ticket tiene label de tipo sin mapeo unívoco** (ej. `Improvement`, que
  puede ser `feat`, `chore` o `refactor` según el cambio) → proponer las
  opciones plausibles con una recomendación, y preguntar.
- **El ticket no tiene label de tipo** → preguntar abierto entre los
  `branchTypes` configurados: "¿Qué tipo de rama es este ticket: feat, fix,
  hotfix, chore, docs o refactor?"

Lo que **nunca** se hace es decidir el tipo en silencio: ni por el label, ni
por el contenido del ticket, ni por lo que se eligió en el ticket anterior.

**Caso especial — tickets de Linear en repos sin CI de nombre de rama:** el
nombre de la rama sale del campo `gitBranchName` que devuelve `get_issue`, y
ese nombre **no lleva prefijo de tipo** (ver paso 5). Preguntar el tipo ahí
sería preguntar algo que no se usa, así que en su lugar se confirma el nombre:
"Este repo usa el nombre canónico de Linear, así que la rama va a ser
`<usuario>/tck-138-...`, sin prefijo de tipo. ¿Confirmás?" El paso no se
omite — cambia de pregunta, y sigue esperando respuesta.

**Excepción a la excepción — el repo valida el nombre de rama por CI:** antes
de aplicar la excepción de arriba, revisar si el repo tiene un check de CI
tipo "Branch name convention" (o un `docs/branch-conventions.md`) que exija
un prefijo de tipo. Si existe, ese validador gana sobre el uso verbatim de
`gitBranchName`: se pregunta el tipo normalmente y se arma el nombre según
el patrón del paso 5. Un `gitBranchName` de Linear con prefijo de usuario
(ej. `<usuario>/tck-138-...`) casi nunca matchea un regex que empiece
con `(feat|fix|...)`, así que en repos con este check la excepción de Linear
no aplica. Guardar el hallazgo en `.claude/workbench.project.json` del
repo (campo `branchNameCI`) para no tener que redescubrirlo cada vez.

### 5. Crear la rama y marcar el ticket en progreso

1. Determinar la rama base para **este ticket específico** — nunca asumir
   directamente la `baseBranch` configurada sin revisar antes la señal del
   paso 2:
   - **El ticket tiene una label de ambiente que mapea a una rama** (ej.
     `stage`, `dev`, `prod`) → esa es la rama base, aunque sea distinta de la
     `baseBranch` default configurada en
     `.claude/workbench.project.json`. No pedir confirmación extra — la
     label ya es la señal explícita.
   - **El ticket no tiene label de ambiente, o la que tiene no es una rama**
     (`draft`, `design`, o cualquier hijo del grupo que no esté admitido en
     `environmentLabels`, o que estándolo no tenga rama mapeada en
     `baseBranchFromTicketLabel`) → **preguntar explícitamente antes de crear nada**:
     "El ticket no tiene ambiente definido. ¿Desde qué rama parto esta rama de
     trabajo: `dev`, `stage`, u otra?" No completar en silencio con la
     `baseBranch` default — la ausencia de señal no equivale a "usar el
     default", equivale a "hace falta preguntar". Un `draft` o un `design` es
     ausencia de señal, no una rama.
   - Aplica a cualquier tracker (Linear, Jira, etc.), no solo a Linear.

   **Anotar esta rama base**: es la misma contra la que se sincroniza en el
   paso 9 y la misma a la que apunta la PR del paso 13. `main` nunca es rama
   base de un ticket.

   **Si el patrón del CI admite un sufijo de ambiente** (ej. un regex que
   termina en `(-dev|-stage)?`), aplicarlo según la label del ticket: la label
   de ambiente define entonces dos cosas, de dónde nace la rama y cómo termina
   su nombre. Leer el `pattern` de `branchNameCI` para saber si aplica — no
   agregar un sufijo que el regex no contempla, ni omitirlo cuando la
   convención del repo lo espera.

2. Actualizar la rama base resultante desde el remoto: `git fetch origin &&
   git checkout <rama-base> && git pull origin <rama-base>`.

3. Determinar el nombre de la rama.

   **Tickets de Linear, repo SIN CI de nombre de rama:** usar **tal
   cual, sin modificar** el valor del campo `gitBranchName` que devuelve
   `get_issue` como nombre de la rama — no el patrón
   `{type}/{ticketId}-{descripción}` de abajo. Esto es lo que permite que
   Linear trackee automáticamente la rama (y luego el PR) contra el ticket
   en su propia UI; inventar un nombre propio rompe ese tracking aunque el
   ticket ID aparezca en el nombre. Ejemplo: si `get_issue` devuelve
   `"gitBranchName": "<usuario>/tck-138-<descripcion-de-la-rama>"`,
   la rama se llama exactamente eso, en ambos repos si el ticket toca
   varios.

   **Tickets de Linear, repo CON CI de nombre de rama** (ver excepción a la
   excepción del paso 4): usar el patrón `{type}/{TICKET-ID}-{slug}`, donde
   `{slug}` es la parte de `gitBranchName` posterior al ticket ID, sin el
   prefijo de usuario. Ejemplo: `gitBranchName` =
   `<usuario>/tck-138-<descripcion-de-la-rama>`
   con `type=feat` da `feat/TCK-138-<descripcion-de-la-rama>`.
   Si la PR ya se creó contra el nombre viejo y hay que renombrar la rama,
   **no usar el endpoint de rename de la API** (`POST
   .../branches/{branch}/rename`) — cierra automáticamente cualquier PR
   abierta porque borra el ref viejo (`head_ref_deleted`) en vez de
   actualizar su head.

   El reparto es el mismo que en el resto del flujo: lo local es de quien
   trabaja el ticket, lo que escribe en el remoto es del humano.

   1. Renombrar local con `git branch -m <nombre-nuevo>`. Preserva los cambios
      sin commitear y no toca el remoto.
   2. Reportar que la rama renombrada quedó lista para publicar, nombrándola, y
      armar el mismo watcher del paso 11 **apuntado al nombre nuevo** —
      "esperar" no es una acción acá tampoco. No se pushea la rama nueva ni se
      borra la vieja: las dos son escrituras al remoto.
   3. Cuando exista upstream para el nombre nuevo, abrir una PR nueva contra la
      rama renombrada — es el gate 5 otra vez, no un trámite.

   La rama vieja del remoto y la PR vieja las cierra el humano; la PR vieja
   queda como referencia histórica. Si no se borra la rama vieja, no se rompe
   nada: queda un ref huérfano sin PR asociada.

   **Cualquier otro tracker** (Jira, Trello, GitHub Issues sin este campo):
   usar el patrón `{type}/{ticketId}-{descripción-corta}`, en el idioma
   configurado y en `kebab-case`. Ejemplo, para
   `https://linear.app/example/issue/EX-107/ERROR-FRONT-MODAL-COLOR` con
   `type=fix` y `descriptionLanguage=es` (caso hipotético sin `gitBranchName`
   disponible):

   ```
   fix/EX-107-solucion-error-color-modal
   ```

   En inglés hubiera sido `fix/EX-107-fix-modal-color-error`.

4. **Crear la rama como worktree de Orca**, para que el trabajo sea visible en
   Orca IDE — **salvo que ya estés adentro de uno**:

   **Primero, mirar dónde estás.** Si un conductor te despachó, el worktree de
   este ticket **ya existe y es donde estás corriendo**: ahí no se crea nada, se
   cortan las ramas acá mismo y se sigue. Verificarlo con
   `orca-ide worktree show --worktree active --json` (o por el path del cwd
   contra `worktree list`) antes de crear.

   Esto **no se pregunta nunca**. Ni "¿creo el worktree?" ni "¿trabajo acá o en
   uno nuevo?": o ya estás en uno y se usa, o no hay ninguno y se crea. Es una
   verificación, no una decisión del usuario.

   ```
   orca-ide worktree create --repo id:<repoId> --name <nombre-rama> --base-branch <rama-base> --json
   ```

   El `repoId` sale de `orca.repoId` en el config, o de
   `orca-ide repo list --json` la primera vez (y se guarda). En Linux fuera de
   una terminal de Orca el ejecutable es **`orca-ide`**, nunca `orca` — ese
   resuelve al lector de pantalla de GNOME y arranca a hablar en la máquina del
   usuario. Ver [`reference/qa-manual.md`](reference/qa-manual.md#resolver-el-cli-de-orca).

   **Wrapper con submódulos** (`orca.worktreeLevel: "wrapper"`): el worktree se
   crea **una sola vez, a nivel del wrapper**, y trae todos los submódulos
   adentro — no uno por submódulo. Después se crea la rama de trabajo dentro de
   cada submódulo que el ticket toque, con el nombre que corresponda a ese
   submódulo. El nombre de la rama del wrapper y el de los submódulos **pueden
   ser distintos** para el mismo ticket: si el CI de nombre de rama vive en los
   submódulos y no en el wrapper, el wrapper puede usar el `gitBranchName` de
   Linear verbatim mientras los submódulos siguen el patrón del CI. No es un
   error, es lo correcto en ese layout.

   **Si Orca no está corriendo, el repo no está registrado, o el comando
   falla:** caer a `git checkout -b <nombre-rama>` en el checkout actual y
   avisarlo en una línea ("Orca no está disponible, creé la rama en el checkout
   actual"). La falta de Orca no bloquea el trabajo.

5. Marcar el trabajo como en progreso, en los dos lados:

   ```
   orca-ide worktree set --worktree active --workspace-status in-progress --json
   ```

   y en el tracker, mover el ticket a `In Progress` (en Linear,
   `save_issue` con `state: "In Progress"`). No pedir confirmación para esto:
   crear la rama ya es la señal de que el trabajo arrancó. Si el ticket ya
   estaba en `In Progress` o más adelante, no tocarlo.

6. Si la rama ya se había creado con el patrón genérico antes de notar que
   el ticket era de Linear, renombrarla en el momento con
   `git branch -m <nombre-nuevo>` (preserva cambios sin commitear) en vez de
   recrearla desde cero.

7. **Registrar en Orca los submódulos que tocás** — apenas cortaste la rama en
   cada uno y antes de empezar a trabajar. **Orca no los descubre solo:** la
   tarjeta del worktree muestra la rama del wrapper y nada más, así que las ramas
   de front y de back quedan invisibles en la app aunque en disco existan y
   tengan commits.

   ```
   orca-ide repo add --path "<worktree>/<submódulo>" --json
   orca-ide worktree set --worktree "path:<worktree>/<submódulo>" \
     --display-name "<TICKET-ID> · front" --json
   ```

   Reglas:

   - **Uno por submódulo que efectivamente tocás**, con `· front` y `· back` en
     el nombre (`back` es la palabra del equipo para la API). Un submódulo que
     quedó en detached sobre el pin del wrapper, sin rama propia, no se registra:
     su tarjeta no dice nada útil.
   - **Le toca al hijo, no al conductor.** El hijo es el único que sabe qué
     submódulos terminó tocando; cuando el conductor creó el worktree, esos
     directorios podían estar incluso vacíos.
   - Verificar que quedó: `orca-ide worktree list --json` tiene que mostrar una
     entrada por cada uno, con su rama.
   - No hay comando de adopción — `worktree show --worktree path:<submódulo>`
     devuelve `selector_not_found` y `worktree set` exige un selector que ya
     exista. Por eso va `repo add` primero.

### 6. Cráneo: cómo encarar la tarea — bloqueante

Antes de tocar una línea de código, entender el problema y presentar el plan.
Investigar primero: leer el código involucrado, reproducir el bug si es un bug,
y entender por qué pasa lo que pasa. Recién con eso, presentar:

1. **Qué está pasando** y por qué — la causa, no el síntoma.
2. **Dónde** — los archivos o módulos que hay que tocar.
3. **Cómo se va a resolver** — el enfoque concreto. Si hay más de una forma
   razonable, decir cuál se recomienda y por qué, no listar opciones para que
   el usuario elija a ciegas.
4. **Qué casos de prueba va a tener el QA** del paso 8, para que el usuario
   pueda corregirlos antes de que se implemente nada.

Y **esperar el OK del usuario.**

Este paso no es un resumen de cortesía: es donde se corrige un enfoque
equivocado antes de que cueste. Implementar sin haberlo presentado y aprobado
es un error del flujo, no un atajo.

**Si al implementar el enfoque aprobado resulta equivocado** (aparece una causa
distinta, el fix no alcanza, hay que tocar mucho más de lo previsto): parar,
decirlo, y volver a presentar el cráneo. No seguir adelante con un plan que ya
se sabe que no era.

**Lo único que se puede saltear sin OK** es un cambio de una línea cuya causa
ya está probada y a la vista (un typo, un import faltante que tira el error
exacto). Ante cualquier duda de si aplica, no aplica.

### 7. Implementar

Trabajar el ticket normalmente, priorizando cualquier skill o rule específica
del repo de trabajo por sobre las genéricas de este repositorio (ej. si el
repo tiene su propia convención de testing, esa gana).

Mantener actualizado el comentario de la tarjeta de Orca en los checkpoints
importantes, para que el usuario vea el progreso sin preguntar:

```
orca-ide worktree set --worktree active --comment "causa encontrada; implementando fix" --json
```

No capturar screenshots en este paso. Las capturas salen del QA del paso 8,
sobre el resultado terminado.

### 8. QA manual en el navegador — bloqueante

Antes de commitear, ejercitar el cambio en la app real y mostrarle al usuario
que funciona. El detalle operativo (comandos, login, capturas, qué hacer si
algo falla) está en [`reference/qa-manual.md`](reference/qa-manual.md).

El paso 8 **empieza pidiendo turno** y **termina bajando el stack**: un solo
stack arriba en toda la máquina.

En resumen:

1. **Pedir turno de QA y esperar a que lo concedan** (sin conductor: medir
   memoria disponible y swap antes de levantar nada).
2. Levantar la app local con el `qa.startCommand` del config, en background.
3. Abrir el navegador embebido de Orca en `qa.url` y esperar que cargue.
4. Loguearse con el usuario o rol que pida el ticket (paso 2). Los usuarios
   salen de los seeds/fixtures del repo; si no hay ninguno usable, **pararse y
   pedirlo** en vez de inventar credenciales o dar el QA por hecho.
5. Ejecutar cada caso de prueba anotado en el paso 2. Si el ticket no describe
   casos, proponer los que se deducen del cambio y pedir confirmación antes de
   ejecutarlos.
6. Capturar **una screenshot por caso**, del estado implementado, con un
   nombre que diga qué caso es. Nada de revertir código para fotografiar el
   estado anterior.
7. Presentarle al usuario la lista de casos con su resultado y las capturas, y
   **esperar su OK explícito**.
8. **Con el gate 3 resuelto, bajar el stack, verificar que los containers
   bajaron y devolver el turno.**

**Este paso es el punto de control del flujo.** Sin OK del usuario no se
commitea. Si un caso falla, volver al paso 7 y arreglarlo — no seguir con un
caso en rojo "para no perder el avance".

**Cuándo se puede saltear:** cambios sin superficie ejercitable en la app
(migraciones internas, refactors sin cambio de comportamiento, cambios de CI o
de documentación). En esos casos decirlo explícitamente y por qué, y correr en
su lugar los tests automatizados del repo. No usar esta excepción para
frontend.

### 9. Sincronizar con la rama base — antes del commit

Con el OK del QA dado, verificar que la rama de trabajo esté al día con su
rama base (la anotada en el paso 5) antes de commitear:

```
git fetch origin
git log --oneline HEAD..origin/<rama-base>
```

- **Sin commits nuevos** → seguir al paso 10.
- **Con commits nuevos** → traerlos con **merge dentro de la rama de trabajo**:

  ```
  git merge origin/<rama-base>
  ```

  Nunca rebase: la rama puede estar ya publicada, y rebasear historia
  publicada obliga a force-push sobre algo que otro pudo haber leído. Nunca al
  revés tampoco — jamás mergear la rama de trabajo dentro de la base.

- **Si el merge da conflictos** → **parar y avisar** cuáles son los archivos en
  conflicto. Resolverlos solo si el usuario lo pide y son inequívocos; si tocan
  lógica que no es del ticket, es él quien decide.
- **Si el merge trae cambios que afectan lo que se probó en el paso 8** (ej.
  toca los mismos archivos o la misma pantalla), avisarlo y re-correr los casos
  afectados antes de commitear, **pidiendo turno de QA de nuevo desde la
  sección 0 de [`reference/qa-manual.md`](reference/qa-manual.md) y bajando el
  stack al terminar**: el turno se devolvió al cerrarse el gate 3.

### 10. Commit — con confirmación

Proponer el mensaje de commit según la convención configurada (o la
descubierta en el repo) y mostrarlo al usuario antes de commitear. Ejemplo:

> Propongo este commit: `fix: soluciona error de color en modal (EX-107)`. ¿Confirmás?

Nunca ejecutar `git commit` sin una confirmación explícita en el turno actual,
y nunca antes del OK del QA del paso 8.

### 11. Rama lista para publicar — sin push

El commit del paso 10 ya está hecho. Esto **no es un paso de push**: publicar
la rama no es tarea de quien trabaja el ticket, es del humano. Nunca se
ejecuta `git push`, ni `git push -u`, ni ninguna variante, ni siquiera contra
la rama de trabajo — eso no cambió por sacar el push de acá, nunca fue
tarea de este flujo publicar nada al remoto.

La rama se deja **sin upstream, a propósito**: es justo lo que en Orca se ve
como *Publish Branch*. Reportarlo nombrando la rama de trabajo explícita y
esperar, sin insistir ni preguntar de nuevo si se publica:

> Listo para publicar: `fix/EX-107-solucion-error-color-modal`. El commit está
> hecho; la rama no tiene upstream todavía porque eso lo publica quien
> corresponda. En cuanto exista upstream, sigo con la PR.

**Y quedarse escuchando, que no es lo mismo que esperar.** "Esperar" no es una
acción: un agente que no tiene nada que hacer termina su turno y no vuelve solo.
Sin un watcher armado, la rama se publica y no pasa nada hasta que alguien
escribe — que es justo lo que este flujo viene a evitar. Antes de dar el paso
por terminado, dejar corriendo **en background**:

```bash
RAMA=$(git branch --show-current)
fallas=0
while true; do
  git ls-remote --exit-code --heads origin "$RAMA" >/dev/null 2>&1
  case $? in
    0) echo "rama publicada: $RAMA"; break ;;
    2) fallas=0 ;;                    # todavía no está: es el caso normal
    *) fallas=$((fallas + 1))
       if [ "$fallas" -ge 3 ]; then
         echo "ERROR: git ls-remote no responde ($fallas intentos)"; break
       fi ;;
  esac
  sleep 60
done
```

Termina solo cuando la rama aparece: no es un loop infinito, es una
notificación. `git ls-remote` pregunta por el remoto sin traerse objetos y sin
tocar nada local — no es un `fetch` ni un `push`.

**Los tres desenlaces son distintos y ninguno es el silencio.** `git ls-remote`
sale con **2** cuando la rama todavía no está —el caso normal, se sigue
esperando— y con **128** cuando el problema es el remoto: mal configurado, sin
red o con credenciales vencidas. Tragarse el 128 como si fuera un 2 deja al hijo
esperando para siempre una rama que nadie va a poder ver, y eso se lee igual que
"todavía no la publicaron". Tres fallas seguidas cortan y lo reportan hacia
arriba.

Cuando emite, seguir con el paso 13 **sin que nadie tenga que avisar**. Entre el
commit y la PR no hay ningún mensaje humano obligatorio, y ese es el punto.

**El watcher muere con la sesión.** Si la sesión se cerró y se reabrió, volver a
armarlo antes que nada — el paso 13 verifica el estado real de todas formas, así
que re-armarlo no puede duplicar ni adelantar nada.

### 12. Comentario en el ticket, con capturas embebidas — automático

**Cuándo: después del commit, sin esperar el push.** Las capturas ya existen —
se sacaron en el QA del paso 8, antes de commitear — y el comentario sale
inmediatamente después de dejar la rama lista para publicar (paso 11). No se pide
confirmación adicional: quedó autorizado al confirmar el commit del paso 10. Y no
se espera a que la rama esté publicada, porque eso lo controla el humano y puede
tardar horas o días.

**Formato del comentario — 3 a 6 líneas, mitad negocio.** Lo lee gente que no
toca el código y lo lee en el board, así que el registro es el de negocio y lo
técnico es la excepción:

- **Arranca por qué cambió para el usuario**, en lenguaje de negocio: qué se ve
  distinto, qué se puede hacer ahora que antes no, o qué dejó de fallar.
- **Una sola línea técnica**, al final, de dónde se tocó (archivo, servicio o
  módulo). Sin pegar código ni explicar la implementación.
- **En la parte de negocio no van** nombres de clases, funciones, archivos,
  tablas ni endpoints, ni jerga del oficio (*hook*, *middleware*, *override*,
  *race condition*, *refactor*, *deploy*), ni números de commit o de PR. Si un
  término técnico es imprescindible, se traduce a lo que el usuario ve.
- Nada de relatos del proceso ("primero investigué...") ni de listas de commits.

**La prueba de lectura:** si alguien que no programa no puede decir, leyendo el
comentario, qué cambió y qué mirar en las capturas, está mal escrito — por más
correcto que sea técnicamente.

**Las capturas van embebidas, no adjuntas.** Un adjunto queda como link al pie;
una imagen embebida se ve inline en el comentario. Una imagen por caso de
prueba, cada una con su título como texto alternativo, en el mismo orden en que
se ejecutaron. El procedimiento exacto de upload está en
[`reference/qa-manual.md`](reference/qa-manual.md#embeber-las-capturas-en-el-comentario);
el comentario terminado, en [`reference/examples.md`](reference/examples.md).

### 13. Pull Request — con confirmación

**Antes de preguntar nada, verificar que la rama ya tenga upstream** — o sea,
que el humano ya la publicó desde el paso 11:

```
git rev-parse --abbrev-ref --symbolic-full-name @{u}
```

- **Falla** (`fatal: no upstream configured` o similar) → todavía no se
  publicó. No es un error ni algo para resolver, y **no se resuelve esperando a
  que alguien avise**: lo que despierta es el watcher del paso 11. Si sigue
  armado, no hay nada que hacer; si la sesión se reabrió y se perdió, armarlo de
  nuevo ahora. No pushear para destrabarlo, y no volver a preguntar "¿publico?"
  — esa pregunta ya se contestó (o se dejó pendiente) en el paso 11.
- **Devuelve la rama remota** (ej. `origin/fix/EX-107-...`) → ya está
  publicada. Seguir con la pregunta de abrir la PR (gate 5), como siempre.

Con upstream confirmado, preguntar si se quiere abrir la PR. Si el usuario
confirma:

1. **Base = la rama de la que nació la rama de trabajo** (la anotada en el
   paso 5: `dev`, `stage`, o la que indicó el tag del ticket). **Nunca `main`**,
   ni siquiera si es la rama default del repo en GitHub — `gh pr create`
   toma la default cuando no se le pasa `--base`, así que pasarla siempre
   explícita.
2. Descripción según [`templates/pull-request.md`](../../knowledge/templates/pull-request.md)
   (o el template propio del repo si existe). **La PR sí va técnica y
   detallada** — el límite de 3-6 líneas es solo para el comentario del ticket.
   Incluir las mismas capturas del paso 8 en la sección "Capturas de pantalla".
3. **Asignar reviewer en GitHub**: usar `reviewers.default` del config
   (`--reviewer <handle>`). Si `reviewers.askEveryTime` es `true`, o si el
   usuario pide otro, preguntar entre los de `reviewers.options`. El reviewer
   se asigna **solo en la PR** — no tocar el assignee del ticket, que sigue
   siendo el autor.
4. Mover el estado a revisión en los dos lados:

   ```
   orca-ide worktree set --worktree active --workspace-status in-review --json
   ```

   y el ticket a `In Review` en el tracker.

Si el usuario no quiere abrir la PR, dejar la tarea cerrada en el paso 12 y no
mover el estado a `In Review`.

### 14. Segunda vez en adelante

Si el config ya existe para este repo, saltar directo del paso 2 al 4 (no se
repite el onboarding). Los únicos puntos que siempre requieren intervención del
usuario son los cinco gates: el tipo de rama (paso 4), **el OK del cráneo
(paso 6)**, **el OK del QA (paso 8)**, la confirmación de commit (paso 10) y la
confirmación de PR (paso 13). El paso 11 no es un gate: no hay push que
confirmar, la rama queda lista para publicar y se espera al humano. Que el
config exista ahorra el onboarding, no los gates.

## Checklist

- [ ] Se verificó si existe `.claude/workbench.project.json` antes de preguntar nada.
- [ ] El ticket se leyó por MCP o se pidió pegado manual — nunca se inventó contenido.
- [ ] Se anotaron los casos de prueba del ticket y con qué usuario/rol ejercitarlos.
- [ ] Se analizó si el workspace tiene un repo o varios, y se comunicó la decisión de en cuál(es) trabajar.
- [ ] Se leyeron las labels por grupo: la de ambiente (para la rama base) y la de tipo (para proponer el tipo de rama).
- [ ] Se preguntó el tipo de rama para este ticket específico — propuesto desde el label si había, pero preguntado igual.
- [ ] Si el ticket no tenía label de ambiente, o tenía `draft`/`design`, se preguntó de qué rama nace en vez de asumir el default.
- [ ] Si el patrón del CI admite sufijo de ambiente, el nombre de rama lo lleva según la label.
- [ ] Se presentó el cráneo (causa, archivos, enfoque, casos de prueba) y el usuario lo aprobó **antes** de escribir código.
- [ ] Se verificó si ya se estaba adentro de un worktree antes de crear uno, y no se preguntó por eso.
- [ ] La rama se creó desde la base actualizada del remoto, con el patrón configurado, y como worktree de Orca (o se avisó el fallback).
- [ ] Cada submódulo con rama propia quedó registrado en Orca (`repo add` + `worktree set --display-name "<TICKET> · front|back"`) y aparece en `worktree list`.
- [ ] El ticket se movió a `In Progress` y la tarjeta de Orca a `in-progress` al crear la rama.
- [ ] Con conductor: se pidió turno de QA antes de levantar el stack y se esperó a que lo concedieran. Sin conductor: se midió la memoria disponible y el swap antes de levantar.
- [ ] Se ejecutaron los casos de prueba en el navegador, con el usuario/rol que pedía el ticket, y se capturó una screenshot por caso del estado implementado.
- [ ] El usuario dio el OK explícito del QA antes de commitear.
- [ ] El stack se bajó al resolverse el gate 3, verificando que los containers efectivamente bajaron — y, si había conductor, se le devolvió el turno.
- [ ] Antes del commit se verificó que la rama estuviera al día con su base, y si no, se mergeó la base dentro de la rama de trabajo.
- [ ] El commit se propuso y se confirmó explícitamente antes de ejecutarse.
- [ ] No se ejecutó ningún `git push`: la rama quedó sin upstream a propósito y se reportó como lista para publicar, nombrándola explícitamente.
- [ ] El comentario del ticket se publicó tras el commit y sin esperar el push, en 3-6 líneas, con las capturas embebidas inline (no como adjuntos al pie).
- [ ] El comentario arranca en lenguaje de negocio, con una sola línea técnica y sin jerga ni identificadores de código en la parte de negocio.
- [ ] No se creó ningún ticket, sub-issue ni follow-up; lo que apareció fuera del alcance se reportó y se pidió permiso.
- [ ] Antes de abrir la PR se verificó que la rama ya tuviera upstream (`@{u}`); si no lo tenía, quedó (o se volvió a armar) el watcher del paso 11 en vez de esperar sin más, sin pushear ni volver a preguntar.
- [ ] La PR apunta a la rama de nacimiento y no a `main`, y quedó con reviewer asignado en GitHub.
- [ ] El ticket quedó en `In Review` y la tarjeta de Orca en `in-review`.
- [ ] Los cinco gates se le preguntaron a quien despachó el trabajo, y ninguno se resolvió solo.
- [ ] No se leyó, tocó ni se razonó sobre otro worktree, otra rama u otro ticket que el propio.
- [ ] No se lanzó ningún subagente: el QA, la exploración y la revisión del diff los hizo esta misma sesión.
- [ ] Al dejar la rama lista para publicar quedó un watcher armado, y la PR salió cuando la rama apareció en el remoto, sin que nadie avisara.

## Ejemplos

Ver [`reference/examples.md`](reference/examples.md) para un flujo completo de
punta a punta, incluyendo el onboarding de primera vez, el QA en el navegador y
el comentario final publicado en el ticket con las capturas embebidas.

## Errores comunes

- **Saltear una pregunta porque la respuesta "es obvia"** — el label, el
  config o el ticket anterior pre-llenan la propuesta; no reemplazan el gate.
  Los cinco gates se piden siempre.
- **Amontonar las preguntas en un mensaje** para avanzar más rápido — una por
  vez, y esperando respuesta.
- **Tomar el silencio como un sí** — si el usuario cambió de tema sin
  contestar, se vuelve a preguntar.
- **Empezar a implementar sin haber presentado el cráneo** — es el error más
  caro del flujo: un enfoque equivocado descubierto después de escribir el
  código cuesta rehacerlo.
- **Seguir con el cráneo aprobado cuando ya se sabe que era equivocado** — si
  aparece otra causa o el fix no alcanza, se para y se vuelve a presentar.
- **Decidir el tipo de rama por el contenido del ticket** en vez de por su
  label y la confirmación del usuario.
- **Tratar `draft` o `design` como rama base** — son labels del grupo de
  ambiente, pero significan que todavía no hay ambiente. Ausencia de señal es
  preguntar.
- **Darle significado de rama o de tipo a una label de módulo o de release** —
  solo el grupo de ambiente y las labels de tipo deciden algo.
- **Olvidar el sufijo de ambiente** cuando el regex del CI lo contempla, o
  agregarlo cuando no — leer el `pattern`, no improvisar.
- **Commitear sin el OK del QA** porque "el cambio es obvio" — el paso 8 es
  bloqueante. La única salida es la excepción explícita de cambios sin
  superficie ejercitable, dicha en voz alta y con los tests del repo corridos
  en su lugar.
- **Dar el QA por hecho cuando no hay usuario de prueba usable** — si no hay
  con qué loguearse, se para y se pide; no se reporta un caso como verde sin
  haberlo ejercitado.
- **Revertir el código para capturar el estado anterior** — no se hace. Solo se
  captura el resultado implementado.
- **Dejar el stack arriba después del QA** — son cinco containers y un árbol
  bind-montado que quedan tomados tanto como el worktree, o sea días. No se nota
  en el ticket propio; se nota cuando el tercer hermano no puede levantar el suyo.
- **Adjuntar las capturas en vez de embeberlas** — un adjunto queda como link
  al pie del comentario; el usuario pidió verlas inline. Embeber el `assetUrl`
  en el cuerpo.
- **Preparar todos los uploads de golpe y después hacer los PUT** — las URLs
  firmadas vencen en 60 segundos. Un archivo completo por vez.
- **Escribir el comentario del ticket como una PR** — 3 a 6 líneas, negocio
  primero, una sola línea técnica. El detalle va en la PR.
- **Rebasear la rama sobre la base en el paso 9** — si la rama ya está
  publicada, obliga a force-push. Merge de la base dentro de la rama, siempre.
- **Mergear la rama de trabajo dentro de `dev`/`stage` localmente** para
  "sincronizar" — eso se hace por PR, nunca a mano.
- **Resolver conflictos de merge en silencio** — se listan los archivos y
  decide el usuario, salvo que sean inequívocos y él haya pedido resolverlos.
- **Abrir la PR contra `main`** por dejar que `gh pr create` use la rama default
  del repo — pasar siempre `--base` con la rama de nacimiento.
- **Cambiar el assignee del ticket al reviewer** — el reviewer se asigna en la
  PR de GitHub; el ticket sigue asignado a quien lo trabajó.
- **Abrir un ticket para lo que apareció de paso** — el hallazgo puede ser
  válido y el ticket igual está de más: entró al board de alguien sin que nadie
  lo pidiera. Se reporta y se espera.
- **Escribir todo el comentario en registro técnico** — si la primera línea ya
  dice "se corrigió el override de estilos", quien reportó el bug no sabe si
  puede volver a probar. Arranca por lo que ve distinto el usuario; la línea
  técnica es una, y va al final.
- **No registrar los submódulos en Orca** — el trabajo existe en disco, con
  commits, y el usuario ve solo la tarjeta del wrapper: ni front ni back, y
  ninguna forma de enterarse de que hay algo ahí. Dar el trabajo por visible
  porque existe en disco es el error; la visibilidad es el `repo add`.
- **Crear un worktree estando adentro de uno** — si te despachó un conductor, el
  worktree del ticket es donde ya estás corriendo. Crear otro te deja el trabajo
  partido en dos checkouts y dos tarjetas para el mismo ticket.
- **Preguntar si hay que crear el worktree** — es una verificación (`worktree
  show --worktree active`), no un gate. Los gates son cinco y están en la tabla
  de arriba; ninguno es este.
- **Resolver un gate solo porque el conductor tarda** — el relevo es asincrónico
  a propósito. Un gate sin respuesta se espera, no se asume.
- **Salir a mirar los worktrees de al lado** ante una orden ambigua — los
  hermanos están en el mismo directorio y se pueden listar, pero una frase corta
  como "eliminamos esto" no trae contexto de a qué se refiere. Es sobre el tuyo,
  o se pregunta.
- **Lanzar un subagente para el QA** — parece gratis porque no crea worktree,
  pero suma otro contexto y puede levantar un segundo stack sobre la misma
  máquina. Es el modo más caro de reventar el ambiente, y el más fácil de
  justificar: "solo para esta parte".
- **Correr `orca` en vez de `orca-ide`** en Linux fuera de una terminal de Orca
  — `orca` es el lector de pantalla de GNOME y arranca a hablar en la máquina
  del usuario. Y si Orca no está disponible, no bloquear: caer a
  `git checkout -b`, avisarlo en una línea y seguir.
- **Preguntar el onboarding de nuevo** cuando el config ya existe — revisar
  siempre el archivo antes de preguntar cualquier cosa que ya podría estar
  configurada.
- **Commitear sin decirlo explícitamente en el turno** — una confirmación de
  una tarea anterior no cuenta para la tarea actual.
- **Pushear, en cualquier forma y contra cualquier rama** — no es que haga
  falta pedir confirmación antes de hacerlo: no es tarea de quien trabaja el
  ticket, nunca. Publicar la rama es del humano; y el riesgo de antes no
  desapareció, solo cambió de manos — si el humano publica asumiendo que la
  rama de trabajo ya "es" la base, sigue siendo pushear contra `dev` por
  error. Avisarlo si se detecta, pero no es algo que este flujo ejecute.
- **Inventar el prefijo del workspace** a partir del nombre de la empresa en
  vez del ID real del ticket (ej. asumir `EXAMPLE-107` cuando el ID real es
  `EX-107`).
- **No decidir qué repos tocar** cuando el workspace tiene varios, y crear
  ramas en todos "por las dudas" — analizar el ticket primero, y confirmar la
  decisión con el usuario en vez de branchear todo.
- **Inventar un nombre de rama para un ticket de Linear** en vez de usar el
  `gitBranchName` tal cual — aunque el nombre propio incluya el ID del
  ticket, rompe el auto-tracking de Linear entre la rama/PR y el issue. Pero
  ver la excepción a la excepción del paso 4: si el repo valida el nombre de
  rama por CI con un patrón de tipo obligatorio, ese check gana.
- **Asumir que `gitBranchName` de Linear siempre pasa el CI del repo** — su
  prefijo es el usuario (ej. `<usuario>/...`), no un tipo, y varios repos
  exigen `{type}/{TICKET-ID}-{slug}` vía un check de CI. Confirmar esto antes
  de crear la rama, no después de que falle el PR.
- **Renombrar una rama remota con PR abierta usando el endpoint de rename de
  GitHub** (`branches/{branch}/rename`) — borra el ref viejo y GitHub cierra
  la PR automáticamente (`head_ref_deleted`) en vez de re-apuntarla. Para
  corregir un nombre de rama con PR ya abierta: rename local, reportar como
  lista para publicar, y PR nueva cuando el humano publicó el nombre nuevo. El
  push de la rama renombrada y el borrado de la vieja **no** son de quien
  trabaja el ticket, igual que en el paso 11.
- **Pedir confirmación redundante para el comentario del ticket** — el punto de
  autorización es el commit del paso 10, no un paso aparte. Atarlo a que la
  rama ya esté publicada la dejaría secuestrada por tiempo indefinido: ese
  push, ahora del humano, puede tardar horas o días.
- **Asumir la `baseBranch` default cuando el ticket no tiene tag de
  ambiente** — la ausencia de señal significa preguntar, no completar en
  silencio con `dev` u otro default configurado.
- **Ignorar un tag de ambiente en el ticket y usar la `baseBranch` default
  igual** — el tag es una señal explícita por ticket y gana sobre el default
  del repo.
- **Reportar "listo para publicar" y no dejar nada escuchando** — "esperar" no
  es una acción: el turno termina y el hijo no vuelve solo. La rama se publica,
  no pasa nada, y alguien tiene que venir a avisar. Es el mismo agujero que
  tenía el conductor con el CI: una promesa sin mecanismo.

## Buenas prácticas

- El comentario del ticket tiene que servirle a alguien que no vio el trabajo
  y no lee código: qué cambió para el usuario, y en qué rama/PR está.
- Las capturas son la prueba de que el caso funciona, no decoración. Una por
  caso, con el título del caso, en el orden en que se ejecutaron.
- Mantener actualizado el comentario de la tarjeta de Orca en los checkpoints
  (repro, causa encontrada, fix, QA, publicado) — es lo que el usuario ve sin
  preguntar.
- Si el usuario corrige algo de la convención (ej. "en realidad los fix van
  con guion bajo, no guion medio"), actualizar el config inmediatamente, no
  solo para ese ticket.
- Si el repo de trabajo tiene su propio `CLAUDE.md` o `rules/` con convención
  de commits o de ramas, esa información gana sobre cualquier default sugerido
  acá — preguntar solo lo que realmente falta definir.
