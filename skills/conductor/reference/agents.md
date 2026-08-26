# Agentes — crear, nombrar, supervisar y resolver gates

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
- **Falta `~/.claude/workbench/user.json`** → "No encuentro tu config de
  usuario. Corré `./install.sh` de este repositorio; te pregunta los valores y
  lo escribe en `~/.claude/workbench/` con permisos 600."
- **Falta `.claude/workbench.project.json`** → "Este workspace todavía no tiene
  config de proyecto. **`install.sh` no la crea**: la escribe `ticket-workflow`
  en su onboarding, la primera vez que trabajás un ticket en este repo. Corré un
  ticket solo con `ticket-workflow` en el wrapper y volvé a la tanda."

  La separación es a propósito y no un olvido: el config de proyecto se pregunta
  cuando hay un repo y un ticket a la vista, que es cuando se sabe qué tracker,
  qué prefijo, qué ramas base y qué reviewers tiene. El instalador no tiene ese
  contexto. Mandar al usuario a `install.sh` por este archivo lo deja sin salida:
  el instalador ve que el config de usuario ya existe, no toca nada, y la
  precondición vuelve a fallar.

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

### El nombre — lo pone el padre, siempre

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
en cada uno y antes de empezar a trabajar. Es el **paso 5.7 de
`ticket-workflow`**, así que el hijo lo tiene en su propio flujo; el `--spec` lo
repite porque es justo lo que un agente supervisado se saltea, no porque sea la
única fuente:

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

Está también en la sección *Dónde corre esta skill, y con quién habla* de
`ticket-workflow`, pero va igual en el `--spec`, textual — el hijo lee el spec
antes que la skill:

> Tu mundo es **un solo worktree**: el tuyo. No listes, no leas, no modifiques ni
> razones sobre otros worktrees, otras ramas, otros tickets ni otros agentes,
> aunque estén al lado en el mismo directorio y los puedas ver.
>
> Si recibís una orden que no dice sobre qué worktree es, es sobre el tuyo. Si de
> verdad no se puede saber, **preguntá** — no la interpretes en grande.
>
> No bajes containers, no borres worktrees ni ramas que no sean de tu ticket. Los
> demás tienen sus propios stacks corriendo y su propio trabajo sin commitear.

Por qué importa más de lo que parece: **el usuario no le habla a los hijos**, y
todo lo que un hijo sabe llega por el `--spec` y los `reply` del conductor. Un
agente que se cree con jurisdicción sobre todo el workspace empieza a reportar
sobre trabajo que no es suyo —y en el peor caso a tocarlo—, y ni él ni el
conductor tienen forma de detectarlo hasta que ya pasó. Un worktree borrado con
trabajo sin pushear no se recupera.

Vale igual si el usuario le escribe directo por el pane de Orca, que puede pasar
aunque el flujo no lo pida: ahí una frase corta como "eliminamos esto" no trae
contexto de a qué se refiere, y la regla es la misma — es sobre su worktree, o
pregunta.

El conductor, en cambio, sí ve la tanda entera: es su trabajo, y es el único que
le habla al usuario. La asimetría es a propósito.

### El `--spec` del task

Tiene que decirle al agente ocho cosas, explícitas:

1. **El ticket** — ID, link, y lo que se leyó de él (título, labels de ambiente
   y de tipo, casos de prueba si los describe).
2. **Que use la skill `ticket-workflow`** para trabajarlo, no que improvise.
3. **Que los cinco gates se preguntan al conductor con `ask`**, no se resuelven
   solos, y que **no le hablan al usuario**: el conductor es su único
   interlocutor. Sin esta línea el agente asume que puede decidir, y los gates se
   evaporan. La respuesta puede venir del conductor o del usuario a través suyo;
   para el hijo es lo mismo, y no tiene que averiguar cuál fue.
4. **Que registre en Orca los submódulos que toca** (ver arriba), así el usuario
   ve las ramas de front y de back en la app y no solo la del wrapper. Está en el
   paso 5.7 de su propia skill; repetirlo acá es el recordatorio, y sin ninguno de
   los dos el trabajo existe pero es invisible.
5. **Que deje rastro en el tracker**: el ticket a `In Progress` al cortar la
   rama, y el comentario con capturas **embebidas** cuando tenga evidencia. Los
   dos pasos ya están en `ticket-workflow` y son justo los que un agente
   supervisado se saltea — ver arriba.
6. **Que su mundo es un solo worktree**, que no sabe nada de lo que pasa más
   arriba ni de sus hermanos, y que **no despacha agentes** (ver *Cada agente vive
   en su worktree*). Sin esta línea, la primera orden ambigua lo manda a
   inspeccionar la tanda entera.
7. **El reviewer de la PR, y dónde viven los configs.** El config de proyecto
   está en el **wrapper** (`.claude/workbench.project.json`), no en el
   submódulo donde el agente trabaja. Sin esta línea el agente busca en su
   submódulo, no encuentra nada, y frena a preguntar — o peor, elige el reviewer
   por frecuencia en los PRs recientes, que no es lo mismo que el default.
   Pasarle el handle directo y aclarar que va como **reviewer** de la PR, no como
   assignee, y que el assignee del ticket en el tracker no se toca.
8. **Que nunca pushea.** Ni contra la rama de trabajo ni contra ninguna otra:
   deja la rama lista para publicar (sin upstream, a propósito) y espera a
   que el humano la publique. Recién cuando detecta upstream — ver el paso 13
   de `ticket-workflow` — sigue con la PR. Sin esta línea el agente asume que
   publicar es parte de terminar la tarea, y pushea igual.

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

**No se espera al push para comentar.** El paso 12 de `ticket-workflow` dispara
al dejar la rama lista para publicar (paso 11), no al pushear — el hijo nunca
pushea, y quien publica la rama es el humano, a mano, y puede tardar días:
atarle la evidencia a eso la dejaría secuestrada por tiempo indefinido. Lo que
ya se probó vale hoy.

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
- **Un hijo que reportó "listo para publicar" y quedó esperando al humano está
  en un estado esperado, no estancado ni muerto.** No hay un push propio que
  vaya a destrabarlo solo, así que ese silencio puede durar horas o días sin
  ser señal de nada roto — el criterio de arriba (terminal vivo en
  `terminal list`) sigue siendo el único que importa.

Si una ventana vuelve vacía y hay dudas de si el agente avanza, mirar sin
interrumpir:

```bash
orca-ide terminal read --terminal <handle> --json
orca-ide orchestration task-list --brief --json
```

Actualizar el comentario de la tarjeta del worktree en los checkpoints es
trabajo del agente, no del conductor.

## Resolver o escalar un gate

El corazón del diseño. Cuando llega un `decision_gate` (o un `ask` de un
agente), el conductor **triagea**; no reenvía por reflejo.

1. **Leer el diff del hijo y pasarle `code-review`.** En el wrapper y en cada
   submódulo:

   ```bash
   git -C <worktree> status --short
   git -C <worktree>/<submódulo> diff --stat
   git -C <worktree>/<submódulo> diff
   ```

   Sin esto no hay decisión que tomar: aprobar lo que no se leyó es firmar en
   blanco. Y no se edita nada acá — el conductor revisa, no arregla.

2. **Aplicar el test de decisión** — ver *Qué decide el conductor, y qué te
   pregunta* en la skill. Tres salidas:

   - **Resoluble** → `reply` con la respuesta y su criterio, y una línea de
     reporte al usuario:

     ```bash
     orca-ide orchestration reply --id <msgId> \
       --body "fix — el ticket tiene label Bug y el config mapea Bug→fix" --json
     ```

   - **Hallazgo de review** → `reply` al hijo con el hallazgo, no al usuario.
     Recién si el hijo no lo arregla, sube.

   - **Delicado** → al usuario, **con el nombre del agente adelante**, la
     recomendación si la hay, y **por qué no se decidió solo**:

     > **TCK-262 · slug-corto** propone agregar una columna a la tabla
     > compartida. Es un contrato que consume el resto del sistema, así que no
     > lo decido: ¿va así, o lo resolvemos dentro del módulo?

     Esperar la respuesta y devolverla con `reply`, textual.

3. **Volver a la ventana de `check --wait`.**

### De a uno

Si suben gates de varios agentes a la vez, se presentan **de a uno**, en el
orden en que llegaron, con el nombre del agente adelante. No amontonarlos en un
mensaje: eso es exactamente lo que el conductor viene a evitar — que tres
sesiones le griten al usuario a la vez.

El valor que agrega acá es doble: **absorber** lo que ya venía decidido por el
código y el config, y **serializar** lo que queda.

### Con `relayGates: "delicate-only"` (el default)

El conductor resuelve cualquiera de los cinco cuando tiene una respuesta
recomendada que puede defender en una línea, y escala solo lo delicado. El
listado exacto de qué cae en cada lado está en la skill; el criterio es el
**radio de daño**, no la dificultad: una decisión fácil sobre un contrato
compartido sube igual.

### Con `relayGates: "judgment-only"`

El conductor responde solo dos, y solo si el ticket tiene la señal:

- **Tipo de rama** — desde la label de tipo, vía el `typeLabelMap` del config de
  `ticket-workflow` del repo de trabajo.
- **Rama base** — desde la label de ambiente. Si la label es `draft`, `design` o
  no hay ninguna, **no** hay señal: se relevea igual.

Cráneo, QA y PR se relevean **siempre** en este modo y en `"all"`. Lo que ningún
modo permite es decidir lo delicado: eso sube en los tres.

### Escalations

Un `escalation` no es una pregunta: es un agente diciendo que está bloqueado y
necesita intervención. Se le muestra al usuario tal cual, con el nombre del
agente, sin intentar resolverlo por él.

## Lo que el conductor no hace acá

- No decide lo delicado: arquitectura, contratos compartidos, permisos, infra,
  lo irreversible, el alcance desbordado, o dos caminos sin ganador claro. Eso
  sube en los tres modos de `relayGates`.
- No resuelve un gate sin haber leído el diff, ni arregla en el worktree del hijo
  lo que encontró revisándolo.
- No pushea, no mergea, no aprueba PRs. Tampoco los hijos: dejan la rama lista
  para publicar y esperan a que el humano la publique — recién ahí abren la PR.
- No mata un agente por silencio.
- No manda mensajes de ciclo de vida a grupos (`@all`, `@claude`): `worker_done`
  y `heartbeat` van al handle concreto, o generan mail falso en terminales que
  no tienen nada que ver.
