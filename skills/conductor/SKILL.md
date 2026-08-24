---
name: conductor
description: Use cuando el usuario pega uno o varios links o IDs de ticket y espera que Claude los trabaje en paralelo supervisando agentes, en vez de trabajarlos él mismo en esta sesión. Crea un worktree con su propio agente por ticket, relevea al usuario los gates de ticket-workflow, anuncia en Discord cada ticket en cuanto sus PRs pasan el gate, y cierra el worktree de cada ticket en cuanto su PR quedó publicada y anunciada, sin esperar el merge. NO usar para un solo ticket que el usuario quiere trabajar acá mismo (usar ticket-workflow directo), ni para anunciar PRs que no pasaron por este flujo.
---

# Conductor

## Propósito

Supervisar varios tickets a la vez sin perder los controles que hacen confiable
el trabajo de cada uno. Por cada ticket, un worktree con su propio agente que lo
trabaja con `ticket-workflow`; el conductor coordina, transporta las decisiones
al usuario, anuncia los PRs cuando están verdes, y cierra cada worktree en
cuanto su ticket quedó anunciado.

El conductor **no hace el trabajo del ticket** y **no agrega autonomía**. Lo que
agrega es paralelismo y orden.

## Requiere

**Capabilities**
- `capabilities.gh` — para leer el estado de las PRs.
- `capabilities.orca` — opcional. Sin ella, ver `core/resolve.md`: se
  pregunta una vez y se recuerda la respuesta en `choices.worktrees`.

**Config**
- `user.author` — sólo se anuncian las PRs de este handle.
- `user.announce.channelUrl` — dónde anunciar.
- `project.repos` — los repos del workspace, con su tag.
- `project.gateWorkflow` — el workflow que actúa de gate.
- `project.notifiedLabel` — la label que marca lo ya anunciado.
- `project.relayGates` — política de relay.
- `project.orca.wrapperRepoId` — el repo wrapper en Orca.

Ante un campo ausente o una capability que falta, seguir `core/resolve.md`.
No completar en silencio.

## Lo que el conductor no hace

No son limitaciones pendientes: son restricciones de diseño. Si algo de esto
parece necesario, la respuesta es preguntarle al usuario, no hacerlo.

- **No pushea, no mergea, no aprueba PRs.** Nada de `git push`, `git merge`,
  `gh pr merge`, `gh pr review --approve`. Los hijos pushean, con la
  confirmación que ya pide `ticket-workflow`.
- **No responde gates en nombre del usuario.** Los cinco gates se relevean. Con
  `relayGates: "judgment-only"` responde los dos derivables de los labels, y eso
  es una concesión configurada, no el default.
- **No anuncia un ticket a medias.** Si el back está verde y el front todavía
  corre, espera. Media notificación manda al revisor a un PR que depende de otro
  que no puede mirar.
- **No anuncia PRs ajenos, ni de otro ticket que el pedido.** Solo los del autor
  del config y de los tickets que el usuario nombró. "Verde y propio" habilita a
  anunciar un PR; no es una razón para hacerlo.
- **No elige el alcance de un anuncio.** Un pedido elástico ("mis PRs", "los
  últimos") es una pregunta sin hacer, no una licencia para incluir todo lo que
  matchee.
- **No borra un worktree sin confirmación**, ni con cambios sin commitear o
  commits sin pushear.
- **No mata un agente porque todavía no contestó.** Una tarea de código tarda
  entre 15 y 60 minutos; el silencio no es una falla.

## Cuándo usarla

- El usuario pega **varios** links o IDs de ticket de una.
- Pega uno y dice explícitamente que lo trabaje en un worktree aparte, o que lo
  supervise.
- Pide anunciar en Discord los PRs de tickets que se trabajaron con este flujo.
- Pide limpiar los worktrees de tickets ya anunciados.

## Cuándo NO usarla

- **Un solo ticket que el usuario quiere trabajar en esta sesión** → usar
  `ticket-workflow` directo. Levantar un agente aparte para eso solo agrega
  intermediarios entre el usuario y su propio trabajo.
- Anunciar PRs que no salieron de este flujo — no hay comentario de ticket del
  que sacar la descripción de cada línea.
- El usuario pide "leeme estos tickets" sin más → leerlos y parar.

## Pasos detallados

### 0. Precondiciones

Las cuatro, antes de crear nada: Orca corriendo, orquestación habilitada,
`ticket-workflow` instalada, config presente. Si una falla, parar y decir cuál —
ver [`reference/agents.md`](reference/agents.md#precondiciones) para los
comandos y los mensajes exactos.

Sin orquestación no hay fallback. Sin `ticket-workflow` no se improvisa el flujo
del ticket.

### 1. Detección — confirma

Parsear lo que pegó el usuario:

- `linear.app/<org>/issue/<ID>/<slug>` → `<ID>`
- `<algo>.atlassian.net/browse/<ID>` → `<ID>`
- Un ID pelado (`TCK-262`) si el prefijo coincide con el del repo de trabajo.

Leer cada ticket por el MCP del tracker. Si no hay MCP para ese tracker, pedir
el contenido pegado; no usar WebFetch como sustituto.

**Confirmar la lista antes de crear nada:**

> Detecté TCK-262 y TCK-257. Voy a crear dos worktrees con un agente cada uno.
> ¿Confirmás?

Si dos tickets tocan lo mismo, **decirlo** — el conductor no resuelve
dependencias entre tickets, pero avisa antes de arrancar los dos en paralelo.

### 2. Onboarding

Solo si falta la config local: mandar a correr `./install.sh`,
que pregunta los valores. Ver [`core/config-schema.md`](../../core/config-schema.md).

Nunca pedir estos datos y guardarlos a mano en el repo: el repo es público.

### 3. Crear los agentes

Uno por ticket, con nombre legible (`TCK-262 · slug-corto`), worktree a
nivel del wrapper, `--agent claude`, y el task despachado con `--inject`. Ver
[`reference/agents.md`](reference/agents.md#crear-y-nombrar-un-agente).

Registrar `ticket → {name, worktreeId, handle, taskId, dispatchId}`. El nombre
es cómo el usuario y el conductor hablan de ese agente.

El `--spec` tiene que pedirle al agente que **registre en Orca los submódulos que
toca** (`repo add` + `worktree set --display-name "<TICKET> · front|back"`). Orca
no los descubre solo: sin eso, la app muestra solo la rama del wrapper y las de
front y back quedan invisibles. Ver
[`reference/agents.md`](reference/agents.md#hacer-visibles-en-orca-las-ramas-de-los-submódulos).

Al crear cada uno, decir qué se creó y con qué nombre.

### 4. Supervisión — relevo

Ventanas rodantes de `check --wait --types worker_done,escalation,decision_gate`
con `--timeout-ms 900000`. Ver
[`reference/agents.md`](reference/agents.md#supervisar-sin-matar-agentes).

Cuando llega un gate, presentarlo **con el nombre del agente adelante**, esperar
la respuesta del usuario, y devolvérsela con `reply`. **De a uno**, en el orden
en que llegaron — ver
[`reference/agents.md`](reference/agents.md#relevar-un-gate).

Un timeout es un checkpoint, no una falla.

### 5. PRs y Discord — cola por ticket, automático

**Es una cola, no una tanda.** La unidad es el ticket: en cuanto **todos** los PRs
de un ticket pasan el gate, sale su mensaje — solo, sin esperar a que otros
tickets estén listos. Un ticket con front y back manda los dos PRs juntos; uno de
una sola rama manda uno.

**El conductor queda a la escucha.** Cuando un PR se publica, hay que seguir el
gate hasta que resuelva y disparar el anuncio ahí, sin que el usuario lo pida. Un
ticket que se pone verde y nadie anuncia es un PR esperando a que alguien se
acuerde.

El envío es **automático**: no se le muestra el mensaje al usuario ni se espera
OK. Lo que lo hace seguro es que el alcance dejó de ser una decisión — el mensaje
cubre ese ticket y nada más. Lo obligatorio antes de enviar: que la mención
resuelva, que estén los PRs que corresponden, y que ninguno tenga ya la label.
Después del envío exitoso, la label. Ver
[`reference/discord.md`](reference/discord.md).

Si el front está verde y el back todavía corre, **no se manda nada**: se espera
al ticket completo.

Verificar que la mención quedó resuelta antes de enviar. Si no se puede, parar y
preguntar: un ping falso es peor que no mandar nada.

### 6. Limpieza — confirma

Detectar los tickets ya publicados y anunciados —**no** se espera el merge, porque
un worktree vivo por cada ticket en revisión bloquea el ambiente local—, correr
las tres verificaciones (en el wrapper y en cada submódulo), mostrar qué se va a
borrar con el nombre del agente, esperar OK, bajar el container, liberar los
puertos y borrar. Ver [`reference/cleanup.md`](reference/cleanup.md).

Si algo no está limpio, no borrar y decir qué quedó y dónde.

## Checklist

- [ ] Se verificaron las cuatro precondiciones antes de crear nada.
- [ ] Se confirmó la lista de tickets detectados antes de crear worktrees.
- [ ] Si dos tickets se pisan, se avisó antes de arrancarlos en paralelo.
- [ ] Cada agente se creó con nombre legible y quedó en el registro — con `worktree set --display-name` después del `create`, que no acepta ese flag.
- [ ] El `--spec` le dijo a cada agente que su mundo es un solo worktree y que no toque ni razone sobre los demás.
- [ ] El `--spec` del task le dijo al agente que use `ticket-workflow`, que pregunte los gates con `ask`, que registre en Orca los submódulos que toca, y que deje rastro en el tracker.
- [ ] Cada ticket de la tanda quedó en `In Progress` al cortarse su rama, no en `Todo` con una rama viva.
- [ ] Cada agente dejó su comentario en el ticket con las capturas **embebidas**, sin esperar el push.
- [ ] Las ramas de front y de back se ven en `orca-ide worktree list`, no solo la del wrapper.
- [ ] Los gates se presentaron de a uno, con el nombre del agente adelante, y se respondieron con `reply` solo con la respuesta del usuario.
- [ ] Ningún agente se cerró ni reinició por no haber contestado todavía.
- [ ] Cada mensaje de Discord cubrió **un** ticket con todas sus ramas, y salió en cuanto ese ticket estuvo verde.
- [ ] Ningún ticket se anunció con una de sus ramas en rojo o todavía corriendo.
- [ ] Se buscó en el canal si esos PRs ya estaban anunciados, además de mirar la label.
- [ ] Cada línea del mensaje lleva ambiente **y** stack juntos (`DEV BACK`, `STAGE FRONT`), con el tag sacado del config.
- [ ] La descripción de cada línea salió del comentario del ticket, no del título del PR.
- [ ] El anuncio salió solo, sin pedirle OK al usuario, y con el alcance acotado a ese ticket.
- [ ] Se verificó que la mención quedó resuelta antes de enviar.
- [ ] La label de anunciado se puso **después** del envío exitoso.
- [ ] Antes de borrar, las tres verificaciones pasaron en el wrapper y en cada submódulo.
- [ ] Nada se pusheó, mergeó ni aprobó desde el conductor.

## Errores comunes

- **Matar un agente por silencio** — un timeout de `check --wait` es un
  checkpoint. Las tareas de código tardan 15-60 minutos.
- **Responder un gate en nombre del usuario "para no interrumpirlo"** — es
  exactamente lo que vacía el flujo del ticket. El conductor serializa las
  preguntas, no las contesta.
- **Amontonar los gates de varios agentes en un mensaje** — de a uno, con el
  nombre adelante.
- **Postear con la mención sin resolver** — sale `@Nombre` como texto plano, no
  notifica a nadie, y el equipo cree que fue avisado.
- **Leer "mis PRs" o "los últimos que tenga" como una lista de tickets** — es
  elástico a propósito. Ahí se pregunta, no se elige. Anunciar un ticket de más
  arrastra a un revisor a trabajo que nadie le pidió mirar, y el ping no se
  deshace borrando el mensaje.
- **Confiar solo en la label para no duplicar** — un anuncio escrito a mano por el
  usuario no dejó label, y el filtro lo lee como "nunca se anunció".
- **Anunciar un PR sin CI corrida** — pasa si falta el guarda `length > 0`:
  "todos los checks en verde" sobre una lista vacía es verdadero.
- **Inferir el tag `FRONT`/`BACK` del título del PR** en vez de leerlo de
  `config.repos[].tag`.
- **Una línea que no dice ambiente y stack** — `#191 dev→dev` obliga al revisor a
  abrir el PR para saber si le toca. Va `DEV BACK #191`.
- **Esperar a juntar varios tickets antes de anunciar** — es una cola: cada ticket
  sale cuando está listo. Acumular retrasa al primero por culpa del último.
- **Anunciar el front de un ticket cuyo back todavía corre** — el ticket se
  anuncia entero o no se anuncia.
- **Poner la label de anunciado antes de que el envío salga bien** — una falla de
  Discord deja ese PR marcado y nunca se anuncia.
- **Borrar un worktree con el puntero de un submódulo movido** — el wrapper con
  ` M submodulo` está sucio, aunque el submódulo por dentro esté limpio.
- **Leer `git stash list` sin filtrar por la rama del worktree** — los stashes
  son globales del repo, así que aparecen los de `main`, `dev` y otros
  worktrees, y el chequeo nunca deja borrar nada.
- **Correr `orca` pelado en vez de `orca-ide`** en Linux fuera de una terminal de
  Orca — `orca` es el lector de pantalla de GNOME.
- **Mandar mensajes a dos handles del mismo agente** cuando uno quedó
  `terminal_handle_stale` — duplica mail de ciclo de vida.
- **Dejar el worktree con el nombre del `--name`** — `create` no acepta
  `--display-name`, así que la tarjeta queda con el slug crudo y el usuario no
  puede referirse a los agentes por nombre. Va un `worktree set` después.
- **No acotarle el mundo al agente** — el usuario le habla directo por el pane de
  Orca, y una frase como "eliminamos esto" sin contexto puede hacer que razone
  sobre el worktree de otro. Los hermanos están al lado y los puede ver.
- **Crear un worktree por submódulo** en vez de uno a nivel wrapper — dos
  agentes levantando el mismo stack local se pisan. (Registrar el submódulo como
  repo para que se vea en Orca es otra cosa: no crea un checkout nuevo.)
- **Dar el trabajo por visible porque existe en disco** — si el submódulo no se
  registró, el usuario ve la tarjeta del wrapper y nada de front ni de back, y no
  tiene forma de saber que hay commits ahí.
- **Dejar el ticket en `Todo` con la rama ya cortada** — el board deja de decir
  qué está agarrado, y otra persona puede empezar lo mismo en paralelo.
- **Reportarle al conductor y creer que eso reemplaza al ticket** — el conductor
  no es el board del equipo. Lo que no está en el tracker no existe para quien no
  está en esta sesión.
- **Adjuntar las capturas en vez de embeberlas** — un adjunto queda como link al
  pie y nadie lo abre.
- **Esperar el push para comentar la evidencia** — en este flujo el push lo corre
  el usuario a mano y puede tardar días; la evidencia va cuando existe.

## Buenas prácticas

- Decir qué agente se creó y con qué nombre, en el momento. El usuario tiene que
  poder referirse a ellos.
- Cuando un agente termina, resumir en una línea qué hizo, antes de pasar al
  siguiente.
- Si la tanda es chica, `relayGates: "all"`. `"judgment-only"` es para cuando
  hay muchos tickets y las preguntas derivables se vuelven ruido.
- Al cerrar la tanda, dejar una tabla de qué quedó: ticket, PRs, estado del
  anuncio, y si el worktree sigue vivo o se borró.
