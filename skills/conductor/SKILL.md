---
name: conductor
description: Use cuando el usuario pega uno o más links o IDs de ticket, o dice "trabajá este ticket" — también si es uno solo. Es el único punto de entrada de un ticket: el conductor no lo trabaja, crea sin pedir OK un worktree con su propio agente hijo por ticket y lo pone a trabajarlo con ticket-workflow, le pone un nombre legible y lo reporta. Es también el único interlocutor del usuario: los hijos no le hablan nunca. Resuelve él los gates que tienen una respuesta recomendada — juzgando con la estructura y la arquitectura del código y pasando `code-review` al diff — y solo escala lo delicado. Lleva el registro de la tanda en disco, no en el contexto, así que al arrancar reconcilia lo que ya existe en vez de duplicar hijos. Anuncia en Discord cada ticket en cuanto sus PRs pasan el gate —el gate autoriza, el reloj no—, y cierra el worktree —automáticamente y sin pedir OK, con sus imágenes y volúmenes— en cuanto la PR quedó publicada y anunciada, sin esperar el merge. Después de cerrar un ticket se olvida de su hijo y arranca el próximo limpio. NO usar si esta sesión ya es un hijo despachado por un conductor, ni para anunciar PRs que no pasaron por este flujo.
---

# Conductor

## Propósito

Ser **el único punto de entrada de un ticket**, y supervisar los que estén
abiertos a la vez sin perder los controles que hacen confiable el trabajo de cada
uno. Por cada ticket, un worktree con su propio agente hijo que lo trabaja con
`ticket-workflow`; el conductor coordina, transporta las decisiones al usuario,
anuncia los PRs cuando están verdes, y cierra cada worktree en cuanto su ticket
quedó anunciado.

**Un ticket también es una tanda.** Que sea uno solo no habilita a trabajarlo
acá: entra por el mismo camino que diez, con su worktree y su hijo. La topología
no cambia con el volumen —el consumo sí, y por eso están la sexta precondición y
el torniquete de QA.

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

**Tools del workbench**
- `tools/conductor-ledger.sh` — el registro de la tanda, en disco. Es lo que
  permite cerrar un ticket y olvidar al hijo sin perder el rastro del anuncio.
- `tools/conductor-cleanup.sh` — la fase 6 en un comando.
- `tools/hooks/pretooluse-announce-gate.sh` — el hook que deniega el anuncio si
  el gate no se verificó en vivo. Va en `~/.claude/settings.json` como **dos
  entradas más** del array `PreToolUse`, sin reemplazar a las que ya estén:

  ```json
  { "matcher": "Bash",
    "hooks": [{ "type": "command", "timeout": 10,
                "if": "Bash(gh pr edit *)",
                "command": "<ruta-del-workbench>/tools/hooks/pretooluse-announce-gate.sh" }] },
  { "matcher": "Bash",
    "hooks": [{ "type": "command", "timeout": 10,
                "if": "Bash(orca-ide *)",
                "command": "<ruta-del-workbench>/tools/hooks/pretooluse-announce-gate.sh" }] }
  ```

  **El `if` no es decorativo.** Sin él el hook se spawnea en cada comando Bash
  de cada sesión de la máquina para no hacer nada; con él corre sólo en los dos
  comandos que puede denegar. Si algún día el anuncio sale por otra vía (un
  webhook con `curl`, por ejemplo), hay que agregarle su propia entrada — el
  hook no puede denegar lo que no se le pasa.

  Sin el hook el flujo funciona igual, pero el guarda vuelve a depender de que
  el modelo se acuerde — que es exactamente lo que ya falló.
- Los tres necesitan `jq`. Sin él, parar y decirlo: el registro a mano vuelve a
  meter la tanda en el contexto, que es el problema que estos scripts resuelven.

El conductor corre en el workspace del usuario, no en el workbench, así que la
ruta a los tools se resuelve **una vez por sesión** y se reusa:

```bash
WB="$(cd "$(readlink -f ~/.claude/skills/conductor)/../.." && pwd)"
```

Si eso no devuelve un directorio con `tools/` adentro, la skill no está instalada
por symlink: preguntar la ruta del workbench y recordarla, sin adivinarla.

**Skills**
- `ticket-workflow` — es la que trabaja cada ticket. Sin ella no se improvisa el
  flujo.
- `code-review` — la que el conductor le aplica al diff de cada hijo antes de
  resolver un gate por su cuenta. Sin leer el diff no hay decisión informada que
  tomar.

Ante un campo ausente o una capability que falta, seguir `core/resolve.md`.
No completar en silencio.

## Lo que el conductor no hace

No son limitaciones pendientes: son restricciones de diseño. Si algo de esto
parece necesario, la respuesta es preguntarle al usuario, no hacerlo.

- **No trabaja el ticket.** No implementa, no corre el QA, no toca los repos de
  trabajo. Lee el ticket para armar el `--spec` y ahí termina su relación con el
  contenido. Si se encontró editando código de un ticket, se equivocó de rol: eso
  es de un hijo, y el hijo hay que crearlo.
- **No lee el hilo de comentarios de ningún ticket.** Del tracker saca **una
  sola** consulta: título, descripción y labels, que es todo lo que el `--spec`
  necesita. Los comentarios son del hijo, que los lee en su paso 2 y devuelve lo
  que haga falta saber.

  No es una preferencia de estilo, es el ítem más grande que el conductor puede
  ahorrarse: un `list_comments` de un ticket con hilo largo entró **una vez** y
  costó **24.000 tokens** — más que todo lo demás de esa sesión junto. El
  conductor que lo leyó no ganó nada con eso: no implementa, no hace QA, y para
  decidir un gate lee el diff, no el hilo.

  Si para resolver un gate hace falta algo que está en un comentario, se le pide
  al hijo con `reply` y él contesta en tres líneas. Preguntarle al hijo cuesta un
  mensaje; leer el hilo cuesta el 12% de la ventana.
- **No pushea, no mergea, no aprueba PRs.** Nada de `git push`, `git merge`,
  `gh pr merge`, `gh pr review --approve`. Tampoco los hijos: dejan la rama
  lista para publicar (sin upstream, a propósito) y esperan a que el humano
  la publique. Recién con upstream ya creado el hijo abre la PR — ver los
  pasos 11 y 13 de `ticket-workflow`.
- **No decide lo delicado.** Resuelve los gates que tienen una respuesta
  recomendada y defendible; lo que toca arquitectura, contratos compartidos,
  permisos, infra, o lo irreversible, sube al usuario. Ver *Qué decide el
  conductor, y qué te pregunta*.
- **No resuelve un gate sin haber leído el diff.** Decidir "la recomendada" sin
  mirar lo que el hijo escribió es firmar en blanco, y el usuario queda sin
  nadie que haya revisado nada.
- **No esconde lo que decidió.** Cada gate que resolvió solo se reporta en una
  línea. Una decisión que el usuario no vio es una decisión que no puede
  corregir.
- **No arregla el código del hijo.** Lo que `code-review` encuentra vuelve al
  hijo con `reply`; el conductor no edita el worktree de nadie.
- **No anuncia un ticket a medias.** Si el back está verde y el front todavía
  corre, espera. Media notificación manda al revisor a un PR que depende de otro
  que no puede mirar.
- **No anuncia PRs ajenos, ni de otro ticket que el pedido.** Solo los del autor
  del config y de los tickets que el usuario nombró. "Verde y propio" habilita a
  anunciar un PR; no es una razón para hacerlo.
- **No elige el alcance de un anuncio.** Un pedido elástico ("mis PRs", "los
  últimos") es una pregunta sin hacer, no una licencia para incluir todo lo que
  matchee.
- **No crea tickets por cuenta propia.** Ni él ni los hijos: ni sub-issues, ni
  follow-ups, ni un ticket para el bug que apareció de paso. Si un hijo reporta
  trabajo fuera del alcance, eso **sube como reporte** y el usuario decide si se
  abre algo. Un ticket que nadie pidió entra en la planificación de alguien que
  no está en esta sesión.
  **El permiso lo da el usuario y el conductor solo lo transporta**: puede
  bajarle a un hijo la orden de crear un ticket, pero no puede originarla ni
  aprobar por su cuenta el pedido de un hijo. Este gate sube siempre, aunque
  `relayGates` sea `delicate-only`. Y si el hallazgo del hijo es grave —pérdida
  de datos, seguridad, algo roto en un ambiente publicado, o un bloqueante de su
  propio ticket— sube **en el momento**, no al cierre de la tanda. Ver *Cuándo sí
  se crea un ticket* en `ticket-workflow`.
- **No hace triage por iniciativa propia**: no reasigna, no cambia prioridad,
  estimación, labels, título ni descripción de ningún ticket. Editar un ticket
  necesita una orden del usuario, y esa orden se ejecuta sin repreguntar; no hay
  hallazgo que la reemplace. El conductor tampoco la origina para un hijo: si un
  hijo ve algo que "habría que corregir" en el tracker, eso **sube como reporte**.
  Esto no toca los dos pasos de estado que cada hijo hace sobre su propio ticket
  (`In Progress` al cortar la rama, `In Review` al abrir la PR): esos son el
  flujo y van solos.
- **No borra un worktree con cambios sin commitear o commits sin pushear**, ni
  con un `prune` global de Docker. Las tres verificaciones son la condición; la
  confirmación del usuario, no.
- **No mata un agente porque todavía no contestó.** Una tarea de código tarda
  entre 15 y 60 minutos; el silencio no es una falla.

## Cuándo usarla

- El usuario pega **un** link o ID de ticket, o varios. Uno alcanza: no hace
  falta que pida un worktree, ni que diga que lo supervises.
- Dice "trabajá este ticket", "manos a la obra con esto", o equivalente.
- Pide anunciar en Discord los PRs de tickets que se trabajaron con este flujo.
- Pide limpiar los worktrees de tickets ya anunciados.

## Cuándo NO usarla

- **Esta sesión ya es un hijo** despachado por un conductor: corre dentro del
  worktree de un ticket y su interlocutor es quien la despachó. Un hijo no crea
  nietos. Si le llega otro ticket, lo dice para arriba y no lo agarra.
- El usuario ya tiene una rama en curso y pide ayuda con el código, sin ticket
  nuevo de por medio → no hay nada que despachar.
- Anunciar PRs que no salieron de este flujo — no hay comentario de ticket del
  que sacar la descripción de cada línea.
- El usuario pide "leeme estos tickets" sin más → leerlos y parar.

## El usuario habla con el padre, y con nadie más

El usuario **nunca tiene que hablarle a un hijo**. No es una preferencia de
estilo: es lo que hace que la tanda se pueda seguir desde un solo lugar.

- **Todo lo que el usuario necesita ver, se lo reporta el conductor**: qué se
  creó, qué está haciendo cada hijo, qué gates se resolvieron y con qué criterio,
  qué subió a decisión, qué terminó y qué quedó.
- **Todo lo que un hijo necesita, se lo da el conductor**: el `--spec` al
  arrancar y los `reply` después. Un hijo bloqueado esperando algo que el
  conductor no le mandó es un error del conductor, no del hijo.
- **Un hijo que terminó y no se reportó es trabajo invisible.** El usuario no
  abre el pane de cada agente para enterarse.
- Si el usuario igual le escribe a un hijo por el pane de Orca, el aislamiento
  sigue valiendo: el hijo razona sobre su worktree y nada más. Pero el flujo no
  depende de que eso pase.

## El registro vive en disco, no en el contexto

El registro `ticket → {name, worktreeId, handle, taskId, dispatchId, qaTurn}` se
guarda con `tools/conductor-ledger.sh`, no en la memoria de la conversación.

**Por qué.** El contexto es append-only: no baja nunca. Ni cuando el hijo
termina, ni cuando el worktree se borra, ni cuando las imágenes se van. Borrar al
hijo libera disco y RAM y **cero tokens**. Así que un conductor que condujo tres
tickets arrastra los tres para siempre, y para el cuarto ya está diluido —
contestando a medias, salteándose pasos, y necesitando que el usuario le recuerde
su propio flujo. Medido en una tanda real: el conductor arrancó en **84.000
tokens** antes de hacer nada y terminó en **248.000**, sin haber tocado una línea
de código.

El registro en disco es lo que rompe eso. Lo que el conductor tiene que recordar
de un ticket cerrado son cuatro datos —qué ticket, qué PRs, cuándo se anunció,
cuándo se limpió— y eso son dos líneas en un archivo, no 30.000 tokens de
conversación.

```bash
$WB/tools/conductor-ledger.sh open TCK-1 --slug <slug> --name "TCK-1 · <titulo corto>"
$WB/tools/conductor-ledger.sh child TCK-1 --handle <handle> --worktree-id <id>
$WB/tools/conductor-ledger.sh pr-add TCK-1 --repo OWNER/REPO --number <n> --url <url>
$WB/tools/conductor-ledger.sh pr-gate TCK-1 --number <n> --gate GREEN
$WB/tools/conductor-ledger.sh brief          # el estado de la tanda, compacto
```

El registro **también es un guarda, no sólo un apunte**: `announced` se niega a
anotar el anuncio si los PRs del ticket no están todos en `GREEN`, y `labelled`
se niega si no hay anuncio registrado. Un reloj no puede saltear eso.

### Olvidar al hijo

Cuando un ticket quedó anunciado y limpiado, se cierra:

```bash
$WB/tools/conductor-ledger.sh close TCK-1
```

`close` colapsa la entrada a una línea y **borra del registro todo lo del hijo**
—`handle`, `taskId`, `dispatchId`, `worktreeId`, el turno de QA—, porque ya no
hay hijo a quien mandarle nada. Sobrevive lo que el conductor tiene que poder
decir dentro de un mes: el ticket, sus PRs, y las dos fechas.

Y entonces el conductor hace lo mismo con su propio contexto: **a partir de ahí
ese ticket es esas dos líneas y nada más.** No se vuelve a razonar sobre su diff,
su QA, sus gates, sus mensajes ni su worktree. Si el usuario pregunta por él, se
contesta con `brief` o con `get`, no de memoria.

### Rotar con hijos vivos

Cerrar un ticket casi nunca deja la tanda vacía: lo normal es cerrar uno y que
otro siga trabajando. **Y eso no impide rotar.** Un `/clear` con un hijo vivo no
lo pierde, porque conducir a un hijo no depende del contexto del padre:

| Lo que hace falta para conducirlo | Dónde vive | ¿Sobrevive al `/clear`? |
|---|---|---|
| `handle`, `worktreeId`, `taskId`, `dispatchId` | el registro, en disco | **sí** |
| toda la conversación con ese hijo | Orca: `orchestration check --terminal <h> --all` | **sí** |
| los gates pendientes | Orca: `orchestration gate-list` | **sí** |
| el estado de su task | Orca: `orchestration task-list` | **sí** |
| quién tiene el turno de QA | el registro, y `docker ps` | **sí** |
| el estado de sus PRs | GitHub: `gh pr checks` | **sí** |
| los monitores de gate | nada | **no** — y ya se re-arman por diseño |
| el criterio con el que el padre resolvió un gate | sólo el contexto | **no** — hay que anotarlo |

Las dos últimas filas son todo lo que hay que atender. Los monitores mueren
igual al cerrar la terminal, así que `/clear` no empeora nada: el bloque
*Re-sincronizar al volver* ya los re-arma. Y lo que este conductor decidió y no
escribió en ningún lado se anota antes de rotar, en una línea:

```bash
$WB/tools/conductor-ledger.sh note <TCK-N> --add "gate 2 resuelto: va sobre el hook que ya existe, no uno nuevo"
```

La nota está topeada a 200 caracteres y a las últimas 5 por ticket. **Es a
propósito:** un campo libre sin techo se convierte en un segundo contexto, que es
exactamente lo que el registro existe para evitar. Si el criterio no entra en una
línea, no es una nota — es una decisión que tenía que haber ido al hijo con
`reply`, y ahí es donde queda registrada.

Antes de rotar se verifica que el sucesor pueda retomar:

```bash
$WB/tools/conductor-ledger.sh handoff
```

Sale `0` con la receta exacta de retoma —los comandos, con los handles puestos—
o sale `1` diciendo qué ticket abierto no tiene `handle` o `worktreeId`
registrado. **Con exit 1 no se rota**: un hijo vivo cuyo handle sólo existe en
este contexto se queda sin conductor cuando el contexto se va.

### Cuándo decírselo al usuario

Con `handoff` en verde y algún ticket recién cerrado, se le ofrece — no se hace
solo, porque `/clear` es su sesión:

> **`<TCK-N>` cerrado** (anunciado y limpiado). Quedan `<n>` abiertos:
> `<tickets>`. Este contexto está en ~N tokens y `<TCK-N>` ya no aporta nada.
> Si querés, `/clear` y sigo: `handoff` da verde, así que retomo `<tickets>`
> desde el registro y Orca sin perder nada. Los monitores los re-armo yo.

Si el registro queda **sin ningún ticket abierto**, la tanda terminó y ahí la
rotación no es una opción sino la recomendación: no se agarra un ticket nuevo con
el contexto de la tanda anterior encima. Es el mismo principio que hace que cada
ticket vaya a su propio hijo en su propio worktree: **empezar limpio no es
prolijidad, es la condición para no delirar a mitad de camino.**

### Rehidratar una sesión nueva

Una sesión nueva de conductor no reconstruye nada leyendo git, labels y el
tracker. Arranca con:

```bash
$WB/tools/conductor-ledger.sh brief
```

Eso son ~10 líneas. La reconciliación contra Orca del paso 0.5 sigue corriendo
—el registro dice qué debería haber, Orca dice qué hay— pero ya no es una
investigación desde cero.

## Cada sesión es su propia tanda

El usuario abre terminales en paralelo, y **una sesión nueva no es este
conductor**. No hereda la tanda ni sabe qué gates ya se relevaron: el registro en
disco dice qué existe, no quién lo está conduciendo.

Reglas para una sesión que arranca al lado de otra:

- **Solo maneja los agentes que creó ella.** No relevea gates, no anuncia y no
  borra worktrees de agentes que no despachó ni adoptó. Dos padres relevando el
  mismo gate le hacen contestar dos veces al usuario; dos padres anunciando el
  mismo PR mandan dos pings que no se deshacen.
- **El contexto de una tanda con hijos vivos se pide, no se asume.** Si el
  usuario quiere que esta sesión se haga cargo de una tanda que arrancó en otra y
  todavía tiene hijos vivos, lo dice. Recién ahí se reconstruye el estado con
  `conductor-ledger.sh brief` y se contrasta **contra Orca y el tracker**
  (`worktree list`, el estado de las PRs, la label de anunciado), nunca de
  memoria ni adivinando qué hizo la otra sesión. El registro es compartido y está
  en disco, así que adoptar una tanda dejó de ser una investigación: es leer diez
  líneas y verificarlas. Si están todos muertos no hay a quién pisar, y aplica el
  bullet de abajo: se adopta sin preguntar.
- **Una sesión muerta no es una sesión hermana.** La regla de arriba existe para
  que dos conductores **vivos** no le contesten el mismo gate al mismo hijo ni
  manden dos anuncios. `connected` y `orphaned` alcanzan para distinguir los dos
  casos:

  - **Todos los hijos de esos tickets están muertos** → fue un crash: ninguna
    sesión viva puede estar conduciendo agentes muertos. **Se adopta y se sigue,
    sin preguntar.**
  - **Hay hijos vivos que esta sesión no creó** → ahí sí puede haber otra
    terminal conduciéndolos. **Se pregunta una sola vez** por toda la tanda, no
    ticket por ticket.
- **Que exista un worktree en Orca no significa que sea tuyo.** Es la señal de
  que hay trabajo vivo, y con eso alcanza para no pisarlo.
- **El torniquete es por sesión, así que el registro no alcanza.** Si otra
  sesión conduce sus propios hijos, su `qaTurn` no está en tu registro y su
  stack está arriba igual. Por eso, **antes de conceder un turno se mira la
  máquina, no sólo el registro**: `docker ps` ve los containers de cualquier
  hijo, sea de esta tanda o de otra. Un turno concedido contra un registro que
  no ve la mitad de la máquina es exactamente el problema que el torniquete
  viene a evitar.

## Qué decide el conductor, y qué te pregunta

El default es `relayGates: "delicate-only"`. El conductor **resuelve el gate
cuando hay una respuesta recomendada que puede defender en una línea**, y escala
solo lo delicado. No es autonomía: es sacar al usuario del camino de las
decisiones que ya venían tomadas por el código, el config o el ticket.

**Antes de resolver cualquier gate, el conductor lee el diff del hijo** — `git -C
<worktree> diff` y `diff --stat` en el wrapper y en cada submódulo — y le aplica
`code-review`. Leer el diff de un hijo no es trabajar el ticket: es revisarlo. Lo
que encuentre vuelve **al hijo** con `reply`, nunca se arregla desde acá.

### Lo resuelve el conductor

- **Tipo de rama y rama base** cuando salen de las labels y del config.
- **El cráneo** que sigue los patrones que ya están en el código, se queda en los
  archivos del alcance del ticket, no agrega dependencias y no cambia contratos.
- **El QA** con todos los casos del ticket ejercitados, con el rol que el ticket
  pedía, una captura por caso, y ninguno en rojo.
- **El commit** cuando el QA pasó y el mensaje sigue la convención.
- **La PR** cuando la rama ya tiene upstream (la publicó el humano), apunta a la
  rama de nacimiento, y el reviewer sale del config.

### Te pregunta

- **Arquitectura**: una dependencia nueva, un patrón que no existe en el código,
  algo que cambia de capa, o un cambio que sienta precedente para lo que venga.
- **Contratos compartidos**: endpoint, DTO, schema de DB, migración, evento, tipo
  público. Los consume gente que no está en esta tanda.
- **Permisos, auth, secretos, infra o deploy** — el radio de daño no termina en
  el worktree.
- **Algo irreversible o fuera del worktree**: una DB compartida, ramas remotas,
  ambientes publicados.
- **El alcance se desborda**: el fix pide cambiar comportamiento que el ticket no
  pidió, o tocar un repo que el ticket no nombra.
- **Un hijo pide crear un ticket.** Lo autoriza el usuario, no el conductor, sin
  importar cuán real sea el hallazgo.
- **Dos caminos viables sin ganador claro.** Una recomendación que no se puede
  defender en una línea no es una recomendación: es una preferencia, y esa la
  elige el usuario.
- **La evidencia contradice el plan**: un caso de QA en rojo, tests que ya
  estaban rotos, o el cambio empeora otra cosa.
- **`code-review` encontró algo real y el hijo no lo arregló** después del
  `reply` — ahí sube, con el hallazgo y la respuesta del hijo.
- **No hay señal para la rama base**: sin label de ambiente, o con `draft` /
  `design`.

Ante duda entre resolver y preguntar, **se pregunta**. El costo de preguntar es
un mensaje; el de decidir mal algo delicado es rehacer trabajo ajeno.

### Cómo se reporta cada caso

Lo que **resolvió**, en una línea, junto al resto del avance:

> **TCK-262 · slug-corto**: tipo de rama `fix` (label `Bug`) y cráneo aprobado —
> toca solo el componente del ticket, sigue el patrón de los hermanos, sin
> dependencias nuevas.

Lo que **sube**, de a uno, con el nombre del agente adelante, la recomendación
del conductor si la tiene, y **por qué no la tomó solo**:

> **TCK-257 · otro-slug** propone resolverlo agregando una columna a la tabla
> compartida. Es un contrato que consume el resto del sistema, así que no lo
> decido: ¿va así, o lo resolvemos dentro del módulo?

## El torniquete de QA

**Varios hijos en paralelo, un solo stack levantado.** El paralelismo que importa
es el del trabajo —leer, implementar, commitear, esperar el CI— y ese no consume
containers. Lo único que se serializa es el minuto en que un hijo necesita la app
corriendo.

Un hijo pide turno antes de levantar nada (paso 8 de `ticket-workflow`). El
conductor lo concede **de a uno**:

- **Torniquete libre en el registro y `docker ps` sin containers de ningún
  ticket** → se concede, y ese ticket queda en `qaTurn: "held"`.
- **Torniquete ocupado** → el pedido queda en `qaTurn: "queued"` y **su `ask` no
  se responde** hasta que se libera. Se conceden en el orden en que llegaron.
- **Ocupado por un stack que no está en tu registro** (el hijo de otra sesión) →
  el pedido queda en `queued` y se re-chequea `docker ps` en cada ventana de
  `check --wait`. Se reporta al usuario en una línea, porque esa espera no la
  destraba ningún hijo tuyo.
- **Llega "devuelvo el turno"** → vuelve a `null` y se concede el primero de la
  cola.

Se reporta en una línea, como cualquier otra decisión:

> **TCK-257 · otro-slug** espera turno de QA; lo tiene **TCK-262 · slug-corto**.

**Un hijo esperando turno no es un hijo colgado.** Es el motivo legítimo de
silencio más largo que hay en este flujo, y no habilita a cerrarlo ni a
reiniciarlo — vale la misma regla de siempre: solo está muerto si su terminal
desapareció de `terminal list`.

**Dos redes de seguridad, porque un turno huérfano cuelga la tanda entera:**

- Si quien tiene el turno desaparece de `orca-ide terminal list`, se libera.
- Si manda `worker_done` sin devolverlo, se libera.

En los dos casos hay que **verificar que sus containers bajaron** antes de
conceder el siguiente: un turno liberado sobre un stack que quedó arriba pone dos
stacks en la máquina, que es justo lo que el torniquete existe para evitar.

## Cuándo termina la tanda

**La tanda no termina cuando los hijos reportan `worker_done`.** Termina cuando
**cada** ticket está anunciado, su worktree limpiado, y su entrada cerrada en el
registro — o sea cuando `conductor-ledger.sh open-tickets` no devuelve nada.

Entre una cosa y la otra hay una espera que puede durar días y que **no depende
de ningún hijo**: la publicación de la rama, que la hace el humano a mano. Un
ticket en esa espera es trabajo abierto, no trabajo terminado, y tratarlo como
terminado es lo que hace que un PR verde se quede sin anunciar hasta que el
usuario venga a recordarlo.

### Re-sincronizar al volver

Los monitores viven mientras vive la sesión. Así que **al recibir cualquier
turno del usuario, antes de contestarle**, el conductor:

1. Lee `conductor-ledger.sh brief` para saber qué tickets tiene abiertos.
2. Re-consulta el estado de los PRs de esa lista y actualiza los gates con
   `pr-gate`.
3. Re-arma los monitores que falten.
4. Menciona lo que cambió mientras no estaba, si cambió algo.

El paso 1 no es de más: el registro es lo único que sobrevive a cerrar la
terminal. Si el conductor sale a re-consultar "los PRs que recuerda", ya perdió
los de antes del último silencio largo.

Sin esto, cerrar la terminal un viernes significa que el lunes nadie anuncia
nada — y el usuario se entera cuando pregunta, que es el síntoma que este bloque
existe para eliminar.

## Pasos detallados

### 0. Precondiciones

Las seis, antes de crear nada: Orca corriendo, orquestación habilitada,
`ticket-workflow` instalada, config de usuario y config de proyecto presentes, y
la máquina con margen de memoria y swap. Si una falla, parar y decir cuál —
ver [`reference/agents.md`](reference/agents.md#precondiciones) para los
comandos y los mensajes exactos.

Sin orquestación no hay fallback. Sin `ticket-workflow` no se improvisa el flujo
del ticket.

### 0.5. Reconciliar lo que ya existe

**Corre siempre, antes de la detección**, cuente el usuario o no que hubo un
crash. Cuatro pasos:

0. Leer el registro: `$WB/tools/conductor-ledger.sh brief`. Dice qué **debería**
   haber, en diez líneas y sin investigar nada. Los pasos que siguen dicen qué
   hay.
1. Listar los worktrees y quedarse con los que tienen `linkedLinearIssue`, o
   `displayName` que matchee `<trackerPrefix>-<n> · `.
2. Cruzarlos con `terminal list` por `worktreeId` para saber cuáles tienen un
   hijo vivo.
3. **Reportar lo encontrado antes de tocar nada**, incluido lo que el registro
   decía y no aparece (y al revés).

Después, por cada ticket: hijo muerto → revivir un agente **en ese worktree**;
sin worktree → el flujo normal del paso 3. Ver
[`reference/agents.md`](reference/agents.md#reconciliar-una-tanda-que-sobrevivió-a-la-sesión).

**Un hijo vivo no se reattachea sin preguntar.** Si esta sesión recién arrancó,
todo hijo vivo que 0.5 encuentre es, por construcción, uno que no creó — y puede
haber otra terminal conduciéndolo ahora mismo. Ahí vale la regla de *Cada sesión
es su propia tanda*: se pregunta **una sola vez** por toda la tanda antes de
hacerse cargo. Reattachear en silencio pone dos conductores sobre el mismo hijo,
y eso son dos respuestas al mismo gate y dos anuncios que no se deshacen.

Los hijos **muertos** no tienen ese problema: nadie puede estar conduciendo en
vivo a un agente muerto. Ahí se reconcilia y se sigue, sin preguntar.

**Que un ticket ya tenga worktree no habilita a trabajarlo acá.** Encontrar
trabajo a medias no convierte al conductor en el hijo.

### 1. Detección — automático si el usuario los nombró

Parsear lo que pegó el usuario — **uno o varios, el camino es el mismo**:

- `linear.app/<org>/issue/<ID>/<slug>` → `<ID>`
- `<algo>.atlassian.net/browse/<ID>` → `<ID>`
- Un ID pelado (`TCK-262`) si el prefijo coincide con el del repo de trabajo.

Leer cada ticket por el MCP del tracker. Si no hay MCP para ese tracker, pedir
el contenido pegado; no usar WebFetch como sustituto.

**Si el usuario nombró los tickets, no se pregunta: se crean y se reporta.**
Pegar un link o un ID y mandarlo al conductor ya es la decisión — volver a
pedir un OK es un turno perdido que no protege nada, porque el alcance no lo
eligió el conductor. Se dice qué se creó, no se pide permiso para crearlo:

> Detecté TCK-262 y TCK-257. Creé dos worktrees con un agente cada uno:
> **TCK-262 · slug-corto** y **TCK-257 · otro-slug**. Ya están trabajando.

**Se confirma antes de crear sólo cuando el alcance lo puso el conductor y no
el usuario**, que es el único caso donde hay algo que confirmar:

- El pedido es elástico (`"mis tickets"`, `"los últimos"`, `"lo que quedó
  abierto"`) → ahí el conductor elegiría por él. Se pregunta cuáles, siempre.
- Un ID pelado cuyo prefijo **no** coincide con el del repo de trabajo, o un
  link que no se pudo leer por MCP → se confirma a qué ticket se refiere.
- **Dos tickets que tocan lo mismo** → se avisa y se espera, antes de
  arrancarlos en paralelo. El conductor no resuelve dependencias entre
  tickets, pero no los larga a pisarse en silencio.

Fuera de esos tres casos, crear y reportar. El resto de los controles no se
mueve: los cinco gates se relevean igual, y la limpieza del paso 6 sigue
exigiendo sus tres verificaciones antes de borrar nada.

### 2. Onboarding

Solo si falta la config local: mandar a correr `./install.sh`,
que pregunta los valores. Ver [`core/config-schema.md`](../../core/config-schema.md).

Nunca pedir estos datos y guardarlos a mano en el repo: el repo es público.

### 3. Crear los agentes

Uno por ticket, con nombre legible (`TCK-262 · slug-corto`), worktree a
nivel del wrapper, `--agent claude`, y el task despachado con `--inject`. Ver
[`reference/agents.md`](reference/agents.md#crear-y-nombrar-un-agente).

**Esto no se pregunta.** Ni "¿creo el worktree?", ni "¿lo despacho?", ni "¿lo
trabajo acá o levanto un agente?". Crear el hijo con su worktree **es** el
trabajo del conductor: preguntarlo es preguntar si va a hacer lo que se le
pidió. Se crea y se reporta.

**El nombre lo pone el padre, siempre**, y sale del ticket (`<ID> · slug-corto`).
Un hijo sin nombre legible deja al usuario sin forma de referirse a él: la
tarjeta muestra el slug crudo y los gates llegan de un agente anónimo. El
`--display-name` va en un segundo comando, porque `create` no lo acepta.

Registrar el ticket **en disco, en el momento de crearlo** — no al final, no
"cuando haga falta": un hijo despachado que no está en el registro es un hijo que
se pierde si la terminal se cierra.

```bash
$WB/tools/conductor-ledger.sh open <TCK-N> --slug <slug> --name "<TCK-N> · <slug-corto>"
$WB/tools/conductor-ledger.sh child <TCK-N> --handle <handle> --worktree-id <id> \
    --task-id <taskId> --dispatch-id <dispatchId>
```

El nombre es cómo el usuario y el conductor hablan de ese agente. El `qaTurn`
arranca vacío y es el torniquete del stack — ver *El torniquete de QA*; se anota
con `set <TCK-N> child.qaTurn <valor>`.

El `--spec` tiene que pedirle al agente que **registre en Orca los submódulos que
toca** (`repo add` + `worktree set --display-name "<TICKET> · front|back"`). Orca
no los descubre solo: sin eso, la app muestra solo la rama del wrapper y las de
front y back quedan invisibles. Ver
[`reference/agents.md`](reference/agents.md#hacer-visibles-en-orca-las-ramas-de-los-submódulos).

Al crear cada uno, decir qué se creó y con qué nombre.

### 4. Supervisión — resolver o escalar

Ventanas rodantes de `check --wait --types worker_done,escalation,decision_gate`
con `--timeout-ms 900000`. Ver
[`reference/agents.md`](reference/agents.md#supervisar-sin-matar-agentes).

Cuando llega un gate: leer el diff del hijo, pasarle `code-review`, y aplicar el
test de *Qué decide el conductor, y qué te pregunta*.

- **Resoluble** → responder con `reply` y reportarlo en una línea.
- **Delicado** → subirlo al usuario, esperar, y devolver su respuesta con
  `reply`. **De a uno**, en el orden en que llegaron.
- **Hallazgo de review** → vuelve al hijo con `reply`, no al usuario.

Ver [`reference/agents.md`](reference/agents.md#resolver-o-escalar-un-gate).

Una `escalation` no es un gate: es un hijo bloqueado. Se muestra tal cual.

Un timeout es un checkpoint, no una falla.

### 5. PRs y Discord — cola por ticket, automático

**Es una cola, no una tanda.** La unidad es el ticket: en cuanto **todos** los PRs
de un ticket pasan el gate, sale su mensaje — solo, sin esperar a que otros
tickets estén listos. Un ticket con front y back manda los dos PRs juntos; uno de
una sola rama manda uno.

**El conductor vigila con un mecanismo, no con una promesa.** Apenas se registra
un PR, arma un monitor persistente sobre su gate. Cuando emite `GREEN` y todos
los PRs de ese ticket están verdes, **el anuncio sale ahí**, sin que el usuario
lo pida. Cuando emite `RED`, la falla vuelve al hijo. Ver
[`reference/agents.md`](reference/agents.md#vigilar-el-gate-de-un-pr).

Tres reglas del gate que **no** viven sólo en los reference: si se pierden, se
anuncia un PR que no pasó los tests.

- **`GREEN` es el único disparador.** No un `worker_done`, no "la PR está
  abierta", no que el usuario lo recuerde.
- **`SINCHECKS` y `PENDING` no son verde.** Un PR sin checks terminados no es un
  PR verde. Se reporta y se espera.
- **Una hora pedida por el usuario agenda el anuncio; no autoriza saltear el
  gate.** "Anuncialo a las 9" significa *no antes de las 9*, no *a las 9 pase lo
  que pase*. Si a esa hora el gate no está en `GREEN`, no sale nada: se avisa que
  llegó la hora con el gate en `<estado>` y se manda en cuanto pase a verde.

  Esto pasó: el anuncio salió a la hora pedida con el gate de tests en `pending`,
  y quedó verde 29 minutos después. La hora ganó porque era la instrucción más
  reciente y el guarda estaba en un archivo que no se había leído. Por eso está
  acá y por eso `conductor-ledger.sh announced` se niega a registrar un anuncio
  sin todos los PRs en `GREEN`.

Y **la label va después del envío verificado**, no después del `Enter`. Mandar el
mensaje y etiquetar en el mismo paso deja el PR marcado como anunciado cuando el
mensaje no llegó — el ticket queda invisible para la próxima pasada y nadie lo
anuncia nunca.

### El anuncio pasa por un hook, no por la memoria

Estas reglas ya estaban escritas y se violaron igual, porque una regla en prosa
se diluye a los 300 turnos y una instrucción del usuario más reciente le gana.
Así que además están implementadas en
[`tools/hooks/pretooluse-announce-gate.sh`](../../tools/hooks/pretooluse-announce-gate.sh),
un hook de `PreToolUse` que **deniega** el envío y la label si el gate no se
verificó en vivo. El orden es este, y no hay otro:

```bash
# 1. Verificar el gate EN VIVO contra GitHub. Sin esto el envio esta denegado.
$WB/tools/conductor-ledger.sh announce-arm <TCK-N> --gate-workflow "<gateWorkflow>"

# 2. Mandar el mensaje al canal. Habilitado por 10 minutos, no más.

# 3. Verificar que el mensaje esta en el canal, y recien ahi:
$WB/tools/conductor-ledger.sh announced <TCK-N> --message-url <url>

# 4. La label. El hook la deniega si el paso 3 no se hizo.
gh pr edit <n> --repo OWNER/REPO --add-label <notifiedLabel>
$WB/tools/conductor-ledger.sh labelled <TCK-N>
```

`announce-arm` corre `gh pr checks` sobre cada PR registrado, con el guarda de
`length == 0` puesto —un PR sin checks es `SINCHECKS`, no verde—, actualiza los
gates y sólo con **todos** en `GREEN` habilita el envío. Si devuelve `PENDING` o
`SINCHECKS`, eso es la respuesta: se le dice al usuario el estado y se espera.

El arm es **de un ticket y por 10 minutos**, y `announced` lo consume. No se
puede armar una vez y anunciar la tanda entera, ni dejar la puerta abierta.

**Si el hook deniega algo, no se busca la vuelta.** El motivo que devuelve dice
qué falta; se hace eso. Reescribir el comando para esquivar el match es
falsificar el gate, y el gate existe porque ya se anunció un PR con los tests
sin terminar.

Un ticket que se pone verde y nadie anuncia es un PR esperando a que alguien se
acuerde — y acordarse no es un mecanismo.

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

### 6. Limpieza — automática, y en un comando

Detectar los tickets ya publicados y anunciados —**no** se espera el merge, porque
un worktree vivo por cada ticket en revisión bloquea el ambiente local— y correr:

```bash
$WB/tools/conductor-cleanup.sh --slug <slug-del-worktree> --ticket <TCK-N>
```

El script hace las tres verificaciones en el wrapper **y en cada submódulo**,
revisa los containers que hayan quedado, y con todo en verde borra el worktree,
las imágenes que ese ticket construyó y los volúmenes de su stack. Devuelve una
línea y un exit code: `0` limpiado, `1` no se tocó nada y dice qué quedó y dónde,
`2` error de uso. Con `--dry-run` verifica sin borrar.

**Por qué en un script y no a mano.** Hecha a mano esta fase son ~30 turnos de
Bash *en el contexto del padre*: verificar, mirar containers, medir, borrar,
reportar. El padre paga en contexto el orden que hace, y esa es exactamente la
plata que la fase 6 viene a ahorrar. Acá entra un slug y sale una línea.

Las reglas no cambiaron y están en [`reference/cleanup.md`](reference/cleanup.md):
las tres verificaciones son condición obligatoria, el filtro va anclado al slug
del ticket, y **nunca** hay un `prune` global. Si algo no está limpio, no se borra
nada.

Después de limpiar, cerrar el ticket en el registro y olvidar al hijo:

```bash
$WB/tools/conductor-ledger.sh cleaned <TCK-N> --images <n> --volumes <n>
$WB/tools/conductor-ledger.sh close <TCK-N>
```

Ver *Olvidar al hijo*. Un ticket limpiado que sigue vivo en el contexto del
conductor es la mitad del trabajo hecha.

## Checklist

- [ ] Se verificaron las seis precondiciones antes de crear nada, incluida la memoria disponible y el swap.
- [ ] Se reconcilió contra Orca antes de crear nada, y se reportó lo encontrado.
- [ ] Ningún ticket con worktree vivo recibió un segundo agente.
- [ ] Ningún ticket con worktree existente se trabajó en la sesión del conductor.
- [ ] Los hijos revividos recibieron el spec de retoma, no el inicial.
- [ ] Los containers de tickets sin hijo vivo se bajaron, y el torniquete quedó libre.
- [ ] Cada ticket se despachó a un hijo con su worktree — ninguno se trabajó en la sesión del conductor, ni siquiera el único de la tanda.
- [ ] No se preguntó si había que crear el worktree ni el hijo: se creó y se reportó.
- [ ] Los tickets que el usuario nombró se crearon sin pedir OK, y se reportó qué se creó.
- [ ] Se confirmó antes de crear sólo si el alcance era elástico, el ticket era ambiguo, o dos tickets se pisaban.
- [ ] Si dos tickets se pisan, se avisó antes de arrancarlos en paralelo.
- [ ] Cada agente se creó con nombre legible y quedó en el registro — con `worktree set --display-name` después del `create`, que no acepta ese flag.
- [ ] El `--spec` le dijo a cada agente que su mundo es un solo worktree y que no toque ni razone sobre los demás.
- [ ] El `--spec` del task le dijo al agente que use `ticket-workflow`, que pregunte los gates con `ask`, que registre en Orca los submódulos que toca, y que deje rastro en el tracker.
- [ ] Cada ticket de la tanda quedó en `In Progress` al cortarse su rama, no en `Todo` con una rama viva.
- [ ] Cada agente dejó su comentario en el ticket con las capturas **embebidas**, sin esperar el push, y escrito en lenguaje de negocio.
- [ ] No se creó ningún ticket sin orden del usuario: lo que apareció fuera del alcance subió como reporte, y lo grave subió en el momento en vez de esperar al cierre.
- [ ] No se editó ningún ticket sin orden del usuario; lo que había que corregir en el tracker subió como reporte.
- [ ] Las ramas de front y de back se ven en `orca-ide worktree list`, no solo la del wrapper.
- [ ] Ningún gate se resolvió sin haber leído el diff del hijo y pasarle `code-review`.
- [ ] Cada gate que el conductor resolvió solo se reportó en una línea, con el criterio.
- [ ] Lo delicado (arquitectura, contratos compartidos, permisos, infra, irreversible, alcance desbordado, dos caminos sin ganador) subió al usuario.
- [ ] Los hallazgos de review volvieron al hijo con `reply`, y el conductor no editó el worktree de nadie.
- [ ] Los gates que subieron se presentaron de a uno, con el nombre del agente adelante y el motivo de no haberlo decidido, y se respondieron con `reply` solo con la respuesta del usuario.
- [ ] El usuario no tuvo que hablarle a ningún hijo para saber en qué estaba la tanda.
- [ ] Ningún agente se cerró ni reinició por no haber contestado todavía.
- [ ] Cada mensaje de Discord cubrió **un** ticket con todas sus ramas, y salió en cuanto ese ticket estuvo verde.
- [ ] Ningún ticket se anunció con una de sus ramas en rojo o todavía corriendo.
- [ ] Se buscó en el canal si esos PRs ya estaban anunciados, además de mirar la label.
- [ ] Cada línea del mensaje lleva ambiente **y** stack juntos (`DEV BACK`, `STAGE FRONT`), con el tag sacado del config.
- [ ] La descripción de cada línea salió del comentario del ticket, no del título del PR.
- [ ] El anuncio salió solo, sin pedirle OK al usuario, y con el alcance acotado a ese ticket.
- [ ] Se verificó que la mención quedó resuelta antes de enviar.
- [ ] La label de anunciado se puso **después** del envío exitoso, y el envío se verificó en el canal antes de etiquetar.
- [ ] Ninguna hora pedida por el usuario se tomó como autorización para anunciar con el gate sin terminar.
- [ ] El envío pasó por `announce-arm`, que verificó el gate en vivo contra GitHub, no por el `pr-gate` anotado.
- [ ] Ningún comando se reescribió para esquivar el hook: lo que denegó se resolvió haciendo lo que el motivo pedía.
- [ ] Cada PR registrado quedó con su monitor de gate armado.
- [ ] El anuncio salió disparado por el evento `GREEN`, no porque el usuario lo recordara.
- [ ] Ningún PR en `SINCHECKS` se tomó por verde.
- [ ] Cada `RED` volvió al hijo con la falla leída, no con un "está en rojo".
- [ ] Antes de borrar, las tres verificaciones pasaron en el wrapper y en cada submódulo.
- [ ] Nunca hubo dos stacks arriba a la vez: el turno de QA se concedió de a uno.
- [ ] Antes de conceder un turno liberado por red de seguridad, se verificó que los containers del anterior bajaron.
- [ ] El `--spec` le dijo a cada agente que no delega en ningún otro agente, ni siquiera para el QA.
- [ ] Nada se pusheó, mergeó ni aprobó desde el conductor.
- [ ] No se relevaron gates, ni se anunció, ni se borraron worktrees de agentes vivos que esta sesión no despachó ni adoptó.
- [ ] La tanda no se dio por cerrada con tickets publicados sin anunciar.
- [ ] Al volver de un silencio, se re-consultó el estado de los PRs antes de contestarle al usuario.
- [ ] Cada ticket anunciado se limpió solo, sin esperar un OK.
- [ ] La limpieza borró también las imágenes y los volúmenes del ticket, no solo el worktree.
- [ ] El filtro de imágenes se ancló al slug del ticket; no se corrió ningún `prune` global.
- [ ] Cada ticket quedó registrado en `conductor-ledger.sh` al despacharlo, no sólo en el contexto.
- [ ] El conductor no leyó el hilo de comentarios de ningún ticket: del tracker salió una sola consulta, para el `--spec`.
- [ ] Lo que hacía falta de un comentario se le pidió al hijo con `reply`, no se leyó del tracker.
- [ ] Cada ticket anunciado y limpiado se cerró con `close`, y el conductor dejó de razonar sobre ese hijo.
- [ ] La limpieza corrió por `conductor-cleanup.sh`, no a mano turno por turno.
- [ ] Con el registro sin tickets abiertos, se le dijo al usuario que la tanda cerró y que el próximo ticket arranca en sesión nueva.
- [ ] Antes de ofrecer una rotación se corrió `handoff`, y con exit 1 no se rotó.
- [ ] Ningún hijo vivo quedó con su `handle` sólo en el contexto: todos están en el registro.
- [ ] El criterio de los gates que el conductor resolvió y que no está en ningún `reply` quedó anotado con `note` antes de rotar.
- [ ] Al volver de un silencio, lo primero fue `brief` — no la memoria de qué PRs había.

## Errores comunes

- **Leer el hilo de comentarios de un ticket "para tener contexto"** — es el
  gasto más grande que un conductor puede hacer y no le sirve para nada: no
  implementa, no hace QA, y los gates los decide leyendo el diff. Un hilo largo
  costó 24.000 tokens en una sola llamada.
- **Seguir con la tanda anterior encima** — agarrar un ticket nuevo con el
  contexto de tres tickets cerrados adentro es exactamente lo que produce el
  conductor que contesta a medias y se saltea su propio flujo. El registro está
  en disco justamente para poder empezar limpio; hay que usarlo.
- **Confundir "borré el hijo" con "liberé contexto"** — borrar el worktree, las
  imágenes y los containers libera disco y RAM, y **cero tokens**. El contexto
  sólo baja con una sesión nueva.
- **No rotar "porque hay un hijo vivo"** — conducir a un hijo no depende del
  contexto del padre: los IDs están en el registro y la conversación entera, los
  gates y el estado de la task están en Orca. Lo que hay que hacer antes es
  correr `handoff` y anotar lo que no está escrito, no quedarse con la tanda
  entera encima por las dudas.
- **Rotar sin correr `handoff`** — el error simétrico. Un hijo vivo cuyo handle
  sólo existía en el contexto se queda sin conductor, y recuperarlo es cruzar
  `terminal list` con `worktree list` a mano.
- **Anunciar porque llegó la hora** — la hora agenda, el gate autoriza. Si a las
  9 el gate está en `pending`, a las 9 no sale nada.
- **Reescribir un comando para esquivar el hook del anuncio** — el hook no es un
  obstáculo que hay que rodear, es el guarda que reemplaza a la regla que ya se
  violó una vez. Si deniega, se hace lo que dice el motivo.
- **Etiquetar en el mismo paso que se manda el mensaje** — si el envío falló, el
  PR queda marcado como anunciado y nadie lo anuncia nunca. Primero se verifica
  en el canal.
- **Correr la fase 6 a mano** — son ~30 turnos de Bash en el contexto del padre
  para hacer algo que `conductor-cleanup.sh` devuelve en una línea. Limpiar al
  hijo no debería ensuciar al padre.
- **Crear un segundo worktree o un segundo agente para un ticket que ya tiene el
  suyo** — duplica agente, stack e imágenes sobre la máquina que acaba de
  colapsar. Es el resultado más caro de no reconciliar.
- **Trabajar el ticket en la sesión del conductor porque "el worktree ya está"**
  — el worktree existente es la razón para retomarlo ahí, no para traérselo.
- **Revivir un hijo con el spec original** — vuelve a empezar de cero y pisa los
  commits que ya tenía.
- **Reconciliar solo cuando el usuario menciona el crash** — es justo lo que no
  va a hacer: para él, el conductor debería haberse enterado solo.
- **Ponerse a trabajar el ticket en vez de despacharlo** — es el error más caro,
  porque no se nota: sale trabajo, pero sin worktree propio, sin tarjeta en Orca,
  sin gates relevados y pisando el checkout donde el usuario tiene lo suyo. Un
  ticket solo no es la excepción.
- **Preguntar si hay que crear el worktree o el hijo** — el usuario ya lo decidió
  cuando mandó el ticket al conductor. Ese turno no protege nada.
- **Dejar al hijo sin nombre** — los gates llegan de un agente que el usuario no
  puede nombrar, y no tiene forma de decir "el de TCK-262 que se pare".
- **Que un hijo despache nietos** — si a un hijo le llega otro ticket, lo reporta
  para arriba. Un worktree adentro de un worktree no lo pidió nadie.
- **Adoptar la tanda de otra sesión** — un worktree vivo en Orca no es prueba de
  que este conductor lo creó. Ver *Cada sesión es su propia tanda*.
- **Matar un agente por silencio** — un timeout de `check --wait` es un
  checkpoint. Las tareas de código tardan 15-60 minutos.
- **Aprobar un gate sin leer el diff** — "el hijo dice que el QA pasó" no es
  evidencia, es una cita. Si nadie miró el código, la revisión no existió y el
  usuario cree que sí.
- **Escalar todo igual "por prudencia"** — devuelve al usuario las cinco
  preguntas de cada hijo, que es justo el ruido que el conductor viene a
  absorber. Lo derivable se decide.
- **Decidir algo delicado porque "la recomendación era obvia"** — un contrato
  compartido, una migración o un permiso no se vuelven menos delicados por tener
  una respuesta clara. Lo que define el escalamiento es el radio de daño, no la
  dificultad.
- **Arreglar el hallazgo de review en el worktree del hijo** — lo deja con el
  árbol movido bajo los pies y sin saber por qué. Va con `reply`.
- **Que el usuario se entere de algo abriendo el pane de un hijo** — si tuvo que
  ir a buscarlo, el conductor no reportó.
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
- **Conceder un turno sin haber verificado que el stack anterior bajó** — deja
  dos stacks arriba y el torniquete deja de servir para lo único que existe.
- **Tratar como colgado a un hijo que espera turno** — es el conductor quien no
  le contestó todavía. Cerrarlo tira trabajo por un silencio que él mismo pidió.
- **Prometer que se queda a la escucha sin armar el monitor** — `check --wait`
  no oye al CI de GitHub. El PR se pone verde, nadie emite nada, y el usuario
  tiene que venir a avisar que hace días que está listo.
- **Dar la tanda por terminada con el `worker_done` del último hijo** — queda
  afuera justo el tramo que no depende de nadie del equipo: la publicación de la
  rama y el gate. Ahí es donde un ticket se pierde durante días.
- **Decidir el estado del gate por el exit code de `gh pr checks`** — sale 1 en
  rojo y 8 en pendiente, así que el rojo se pierde justo cuando importa.
- **Mandarle al hijo "el CI está en rojo"** sin el job ni el error — lo obliga a
  ir a buscar lo que el conductor ya tenía leído.
- **Borrar el worktree y dejar sus imágenes** — recupera el 5% de lo que ese
  ticket ocupa. Las imágenes son 5-6,5 GB por ticket y no las reclama nadie.
- **Limpiar con `docker image prune` o `system prune`** — alcanza tickets vivos
  y de otras sesiones. El filtro va anclado al slug.

## Buenas prácticas

- Decir qué agente se creó y con qué nombre, en el momento. El usuario tiene que
  poder referirse a ellos.
- Cuando un agente termina, resumir en una línea qué hizo, antes de pasar al
  siguiente.
- El default es `relayGates: "delicate-only"`: decidir lo recomendado, escalar
  lo delicado. `"judgment-only"` y `"all"` existen para quien quiera más control
  — `"all"` releva los cinco gates de cada hijo, y con dos o tres tickets en
  paralelo eso es mucho ruido.
- Al resolver un gate, decir el criterio en la misma línea ("sigue el patrón de
  los hermanos", "sin dependencias nuevas"). Es lo que le permite al usuario
  corregir el rumbo sin tener que revisar todo de nuevo.
- Al cerrar la tanda, dejar una tabla de qué quedó: ticket, PRs, estado del
  anuncio, y si el worktree sigue vivo o se borró.
