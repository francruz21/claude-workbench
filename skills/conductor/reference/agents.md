# Agentes — crear, nombrar, supervisar y relevar gates

Detalle operativo de las fases 0, 3 y 4. Todo el mecanismo multi-agente es
orquestación de Orca; el conductor no reimplementa mensajería.

## Resolver el CLI de Orca

Elegir el ejecutable **una vez** y reusarlo:

1. Si existe `ORCA_CLI_COMMAND`, usar su valor.
2. Si la sesión expone `ORCA_DEV_REPO_ROOT`, usar `orca-dev`.
3. En Linux, fuera de una terminal de Orca, usar **`orca-ide`**.
4. Dentro de una terminal de Orca, usar `orca`.

**Nunca `orca` pelado en Linux fuera de una terminal de Orca:** ahí resuelve al
lector de pantalla de GNOME y arranca a hablar en la máquina del usuario.

En los ejemplos de abajo se usa `orca-ide`; sustituir por el que corresponda.

## Precondiciones

Verificar las cinco **antes** de crear nada. Si una falla, parar y decir cuál:

```bash
orca-ide status --json                            # app.running == true, runtime.state == "ready"
orca-ide orchestration task-list --json           # si falla: orquestación no habilitada
ls ~/.claude/skills/ticket-workflow/SKILL.md      # dependencia de este repositorio
test -f ~/.claude/workbench/user.json             # config de usuario
test -f .claude/workbench.project.json            # config de proyecto (wrapper)
```

Mensajes exactos cuando fallan:

- **Orca no corre** → "Orca no está corriendo. Levantalo con `orca-ide open` y volvé a intentar."
- **Orquestación deshabilitada** → "La orquestación de Orca no está habilitada. Activala en Settings > Experimental y volvé a intentar." **No hay fallback**: sin orquestación no hay agentes que se hablen.
- **Falta `ticket-workflow`** → "No encuentro la skill `ticket-workflow` en `~/.claude/skills/`. Es la que hace el trabajo de cada ticket; corré `./install.sh` de este repositorio primero." No improvisar el flujo del ticket.
- **Falta el config** → correr `./install.sh`.

## Crear y nombrar un agente

Uno por ticket. En un workspace con submódulos, el worktree se crea **una sola
vez a nivel del wrapper** y trae los submódulos adentro — no uno por submódulo.

```bash
orca-ide worktree create \
  --repo id:<wrapperRepoId> \
  --name <ticket-slug> \
  --base-branch <rama-base> \
  --linear-issue <TICKET-ID> \
  --agent claude --json
# leer worktree id y el handle de la respuesta:
#   result.agentTerminalHandle (o result.startupTerminal.handle en runtimes viejos)

# El nombre legible va DESPUES, en un segundo comando: `create` NO tiene
# --display-name. Sin este paso la tarjeta muestra el slug crudo.
orca-ide worktree set --worktree "id:<worktreeId>" \
  --display-name "<TICKET-ID> · <slug-corto>" --json

orca-ide terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json
orca-ide orchestration task-create --spec "<spec del ticket>" --json
orca-ide orchestration dispatch --task <taskId> --to <handle> --inject --json
```

### El nombre

`<TICKET-ID> · <slug-corto>`, por ejemplo `TCK-262 · slug-corto`. Es el
`displayName` del worktree y es **cómo el usuario y el conductor hablan de ese
agente**. Sin nombre, la única dirección es el handle, que es opaco y además
puede cambiar.

**`worktree create` no acepta `--display-name`.** Lo que se le pasa en `--name`
termina siendo el nombre visible, o sea el slug del directorio: `tck-262-titulo-largo-del-ticket-tal-como-viene-del-tracker`.
El nombre legible se pone con `worktree set --display-name` inmediatamente
después de crear. Es un paso separado y **es fácil de olvidar**: si el usuario ve
slugs crudos en las tarjetas, es esto lo que falta.

Vale igual para los submódulos que el agente registra: `repo add` los nombra con
el nombre del repo (`repo-front`), y el `· front` / `· back` lo pone un
`worktree set` posterior.

El conductor mantiene un registro de la sesión:

```
ticket → { name, worktreeId, handle, taskId, dispatchId }
```

`name` y `worktreeId` son estables. `handle` es routing y puede cambiar si el
pane se reinicia.

### Agent-first, no dos pasos

`--agent claude` en el `create`. **Nunca** `worktree create` pelado y después
`terminal create --command claude` para el mismo worker: sin tabs por defecto
configurados, eso deja un shell huérfano al lado del agente.

### Handle stale

Si un comando devuelve `terminal_handle_stale`, re-resolver:

```bash
orca-ide terminal list --worktree id:<worktreeId> --json
```

y seguir **solo con el reemplazo**. Nunca mandar el mismo mensaje a los dos
handles: duplica mail de ciclo de vida y ensucia el estado.

### Hacer visibles en Orca las ramas de los submódulos

**Orca no descubre los submódulos de un worktree.** La tarjeta del worktree
muestra la rama del **wrapper** y nada más: las ramas de front y de back quedan
invisibles en la app, aunque en disco existan y tengan commits.

No es un problema de timing ni de cañería de git — verificado: el `gitdir` de un
submódulo clonado después es idéntico al de uno que Orca sí muestra. La diferencia
es el registro. Los submódulos que se ven están **registrados como repos** en
Orca, con su propio `repoId` y su `displayName`.

Tampoco hay comando de adopción: `worktree show --worktree path:<submódulo>`
devuelve `selector_not_found`, y `worktree set` exige un selector que ya exista.

Así que **el agente hijo registra sus propios submódulos**, apenas cortó la rama
en cada uno y antes de empezar a trabajar:

```bash
orca-ide repo add --path "<worktree>/repo-front" --json
orca-ide worktree set --worktree "path:<worktree>/repo-front" \
  --display-name "<TICKET-ID> · front" --json
```

Reglas:

- **Uno por submódulo que efectivamente tocás**, con `· front` y `· back` en el
  nombre. `back` es la palabra del equipo para la API.
- **Un submódulo sin rama propia no se registra.** Si quedó en detached sobre el
  pin del wrapper, su tarjeta no dice nada útil y solo agrega ruido.
- Verificá que quedó: `orca-ide worktree list --json` tiene que mostrar una
  entrada por cada uno, con su rama.

Por qué le toca al hijo y no al conductor: el hijo es el que sabe qué submódulos
terminó tocando. El conductor, cuando crea el worktree, todavía no lo sabe — y en
ese momento los directorios de submódulo pueden estar incluso vacíos.

### Aprovisionar el worktree antes de despachar

Un worktree recién creado por Orca **no arranca solo**. Lo que hay que dejarle
puesto, y que si falta el agente descubre a los golpes:

| Falta | Síntoma |
|---|---|
| Submódulos sin inicializar | directorios vacíos; `git submodule update --init <los que necesita>` |
| `.env` del wrapper y de cada submódulo | el compose no levanta |
| `.env.repo-api` | el compose lo pide en `env_file` y **falla antes de arrancar** |
| Puertos sin desplazar | choca con los stacks que ya corren |
| `repo-api/jwt/*.key` | gitignoreadas; la API muere con `JwtStrategy requires a secret or key` |

Y dos cosas que el agente va a tener que resolver igual, así que conviene
avisarle en el `--spec` en vez de que las descubra:

- **La DB nace sin usuarios.** El compose fuerza `NODE_ENV=development` y ese
  camino siembra solo hubs y planes. El reseed completo se fuerza con un overlay
  de compose, que **vive en el scratchpad, nunca en el repo**.
- **`migrate.mjs` no se bootstrapea en una DB virgen**: falta el esquema donde
  drizzle lleva su registro y el contenedor entra en crash-loop. Se crea a mano
  una vez.

El script de puertos del wrapper tiene dos trampas propias: hace `cat >` sobre el
`.env` (pisa lo que ya estaba) y usa `sed -i ''`, forma BSD que **falla en
Linux** justo en el paso que reescribe `VITE_API_BASE_URL` del front. Hay que
re-pegar lo pisado y parchear esa variable a mano.

### Cada agente vive en su worktree y no sabe de los demás

Los worktrees de una tanda son hermanos en el mismo directorio, y cualquier
agente puede listarlos, leerlos y razonar sobre ellos. Nada se lo impide, así que
**hay que decírselo**, o ante la primera orden ambigua sale a inspeccionar el
workspace entero y opina sobre trabajo que no es suyo.

Va en el `--spec`, textual:

> Tu mundo es **un solo worktree**: el tuyo. No listes, no leas, no modifiques ni
> razones sobre otros worktrees, otras ramas, otros tickets ni otros agentes,
> aunque estén al lado en el mismo directorio y los puedas ver.
>
> Si recibís una orden que no dice sobre qué worktree es, es sobre el tuyo. Si de
> verdad no se puede saber, **preguntá** — no la interpretes en grande.
>
> No bajes containers, no borres worktrees ni ramas que no sean de tu ticket. Los
> demás tienen sus propios stacks corriendo y su propio trabajo sin commitear.

Por qué importa más de lo que parece: el usuario le habla a los agentes
**directo, por el pane de Orca**, no solo a través del conductor. Ahí una frase
corta como "eliminamos esto" no trae contexto de a qué se refiere, y un agente
que se cree con jurisdicción sobre todo el workspace puede razonar sobre —o peor,
tocar— el worktree de otro. Un worktree borrado con trabajo sin pushear no se
recupera.

El conductor, en cambio, sí ve la tanda entera: es su trabajo. La asimetría es a
propósito.

### El `--spec` del task

Tiene que decirle al agente cuatro cosas, explícitas:

1. **El ticket** — ID, link, y lo que se leyó de él (título, labels de ambiente
   y de tipo, casos de prueba si los describe).
2. **Que use la skill `ticket-workflow`** para trabajarlo, no que improvise.
3. **Que los cinco gates se preguntan al conductor con `ask`**, no se resuelven
   solos. Sin esta línea el agente asume que puede decidir, y los gates se
   evaporan.
4. **Que registre en Orca los submódulos que toca** (ver arriba), así el usuario
   ve las ramas de front y de back en la app y no solo la del wrapper. Sin esta
   línea el trabajo existe pero es invisible.
5. **Que deje rastro en el tracker**: el ticket a `In Progress` al cortar la
   rama, y el comentario con capturas **embebidas** cuando tenga evidencia. Los
   dos pasos ya están en `ticket-workflow` y son justo los que un agente
   supervisado se saltea — ver arriba.
6. **Que su mundo es un solo worktree** (ver *Cada agente vive en su worktree*).
   Sin esta línea, la primera orden ambigua lo manda a inspeccionar la tanda
   entera.
7. **El reviewer de la PR, y dónde viven los configs.** El config de proyecto
   está en el **wrapper** (`.claude/workbench.project.json`), no en el
   submódulo donde el agente trabaja. Sin esta línea el agente busca en su
   submódulo, no encuentra nada, y frena a preguntar — o peor, elige el reviewer
   por frecuencia en los PRs recientes, que no es lo mismo que el default.
   Pasarle el handle directo y aclarar que va como **reviewer** de la PR, no como
   assignee, y que el assignee del ticket en el tracker no se toca.

## El rastro en el tracker

`ticket-workflow` ya pide las dos cosas, pero un agente que le habla a un
conductor las trata como opcionales, porque siente que reportarle a él ya es
reportar. No lo es: el conductor no es el board del equipo.

**Al cortar la rama, el ticket va a `In Progress`.** Sin confirmación, es parte
de agarrar el trabajo:

```bash
# en Linear: save_issue con state "In Progress"
orca-ide worktree set --worktree active --workspace-status in-progress --json
```

Un ticket en `Todo` con una rama viva es una invitación a que otra persona lo
empiece en paralelo.

**Cuando hay evidencia, va un comentario con las capturas embebidas.**
Embebidas, no adjuntas: un adjunto queda como link al pie y nadie lo abre; una
imagen embebida se ve inline. Tres a seis líneas de prosa —lo lee gente de
negocio y gente técnica— más una imagen por caso de prueba.

En Linear la subida es de tres pasos y la URL firmada dura ~60 segundos, así que
va **de una imagen a la vez**: `prepare_attachment_upload` → `PUT` del archivo →
`create_attachment_from_upload`, y después se embebe con sintaxis de imagen de
markdown en el cuerpo del comentario.

**No se espera al push para comentar.** El paso 12 de `ticket-workflow` dice
"inmediatamente después de un push confirmado", y en este flujo el push lo corre
el usuario a mano: atarle la evidencia a eso la deja secuestrada por tiempo
indefinido. Lo que ya se probó vale hoy.

Y si el conductor ya dejó un comentario en el ticket (por ejemplo, una pregunta
de negocio), el del agente es **otro** comentario, el de la evidencia técnica.
No se contradicen ni se repiten: son dos temas.

## Supervisar sin matar agentes

```bash
orca-ide orchestration check --wait \
  --types worker_done,escalation,decision_gate \
  --timeout-ms 900000 --json
```

Ventanas rodantes de 15 minutos. Reglas:

- **Un timeout o `{count:0}` es un checkpoint, no una falla.** Las tareas de
  código tardan entre 15 y 60 minutos.
- **Nunca** cerrar, matar ni reiniciar un agente porque todavía no mandó nada.
  Heartbeat y actividad visible significan **vivo**, no listo.
- Si hay N agentes que pueden terminar juntos, loopear N veces: `check --wait`
  devuelve **un** mensaje por vez.
- Un agente se considera muerto solo si su terminal desapareció de
  `orca-ide terminal list --json`, o si el usuario lo pide.

Si una ventana vuelve vacía y hay dudas de si el agente avanza, mirar sin
interrumpir:

```bash
orca-ide terminal read --terminal <handle> --json
orca-ide orchestration task-list --brief --json
```

Actualizar el comentario de la tarjeta del worktree en los checkpoints es
trabajo del agente, no del conductor.

## Relevar un gate

El corazón del diseño. Cuando llega un `decision_gate` (o un `ask` de un
agente):

1. **Mostrarlo con el nombre del agente adelante**, y la pregunta textual:

   > **TCK-262 · slug-corto** pregunta: ¿tipo de rama? Propone `fix`
   > porque el ticket tiene label `Bug`.

2. **Esperar la respuesta del usuario.** No responder por él.

3. Devolvérsela al agente:

   ```bash
   orca-ide orchestration reply --id <msgId> --body "<respuesta del usuario>" --json
   ```

4. Volver a la ventana de `check --wait`.

### De a uno

Si llegan gates de varios agentes a la vez, se presentan **de a uno**, en el
orden en que llegaron, con el nombre del agente adelante. No amontonarlos en un
mensaje: eso es exactamente lo que el conductor viene a evitar — que tres
sesiones le griten al usuario a la vez.

El valor que agrega el conductor acá no es decidir, es **serializar**.

### Con `relayGates: "judgment-only"`

El conductor responde solo dos, y solo si el ticket tiene la señal:

- **Tipo de rama** — desde la label de tipo, vía el `typeLabelMap` del config de
  `ticket-workflow` del repo de trabajo.
- **Rama base** — desde la label de ambiente. Si la label es `draft`, `design` o
  no hay ninguna, **no** hay señal: se relevea igual.

Cráneo, QA y PR se relevean **siempre**, en los dos modos. No existe un modo que
los responda por el usuario.

### Escalations

Un `escalation` no es una pregunta: es un agente diciendo que está bloqueado y
necesita intervención. Se le muestra al usuario tal cual, con el nombre del
agente, sin intentar resolverlo por él.

## Lo que el conductor no hace acá

- No responde un gate en nombre del usuario (salvo los dos derivables en modo
  `judgment-only`).
- No pushea, no mergea, no aprueba PRs. Los hijos pushean, con la confirmación
  que ya pide `ticket-workflow`.
- No mata un agente por silencio.
- No manda mensajes de ciclo de vida a grupos (`@all`, `@claude`): `worker_done`
  y `heartbeat` van al handle concreto, o generan mail falso en terminales que
  no tienen nada que ver.
