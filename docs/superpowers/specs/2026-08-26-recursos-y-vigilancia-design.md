# Recursos y vigilancia — diseño

**Fecha:** 2026-08-26
**Estado:** aprobado, pendiente de plan de implementación
**Toca:** `conductor`, `ticket-workflow`, `core/config-schema.md`

## Problema

Dos hijos trabajando en paralelo dejan la máquina inutilizable, y el conductor
deja de anunciar sin avisar que dejó de hacerlo. Son dos fallas distintas con
una causa común: **el flujo no tiene noción de que los recursos de la máquina y
la atención del conductor son finitos.**

### Medición

Tomada el 2026-08-26 sobre la máquina donde ocurre el problema (29 GB de RAM,
12 cores, swap de 8 GB), con dos tickets en curso:

| Consumidor | RAM | Nota |
|---|---|---|
| VM de Docker Desktop (`qemu` + `virtiofsd`) | 12,2 GB | El mayor de todos. `virtiofsd` (5,3 GB) comparte archivos con la VM y crece con cada árbol bind-montado |
| Procesos `claude` (8+) | 3,0 GB | ~350-470 MB por agente |
| `orca-ide` (Electron) | 2,6 GB | |
| `npm` / servidores de desarrollo | 2,0 GB | |
| Los 10 containers medidos por `docker stats` | 2,6 GB | |

Estado resultante: 15 GB usados y **5,3 GB de 8 en swap**. La máquina pagina, y
ahí es donde muere.

Dos hallazgos que la medición desmiente y que cambian el diseño:

1. **Los containers no son el problema de memoria; la VM que los hospeda sí.**
   Cada worktree nuevo bind-montea otro árbol completo —`node_modules`
   incluido— y `virtiofsd` lo cachea. El costo marginal de un ticket más no
   está en los 5 containers que suma, sino en el mount que agrega.
2. **`<servicio-de-permisos>` consume ~80% de un core en idle, y hay uno por ticket.** Dos
   tickets son ~1,6 cores de 12 gastados en nada.

### Las cinco causas en el repo

1. **No hay tope de paralelismo.** `conductor` afirma explícitamente que "la
   topología no cambia con el volumen". Es cierto para la topología y falso
   para el consumo.
2. **El stack vive tanto como el worktree.** `reference/qa-manual.md` levanta la
   app en el paso 8 y termina en "esperar OK": no existe teardown. Y el worktree
   solo se borra después de que el PR se publique y se anuncie, lo que puede
   tardar días.
3. **La prohibición de crear agentes está mal apuntada.** "Un hijo no crea
   nietos" está escrita contra *otro ticket* y contra *despachar por Orca*. No
   cubre lanzar subagentes dentro de la propia sesión, que es lo que hace un
   agente cuando decide paralelizar su QA — y el hijo hereda skills globales
   (`superpowers:dispatching-parallel-agents`,
   `superpowers:subagent-driven-development`) que lo empujan exactamente ahí.
4. **El conductor escucha el canal equivocado.** El paso 5 dice que "queda a la
   escucha" pero la única herramienta que tiene es `check --wait`, que oye
   mensajes de los hijos por Orca. Ni el CI de GitHub ni el push manual del
   humano generan uno. Por eso se queda sordo justo cuando importa.
5. **La tanda no tiene final definido.** El conductor trata el `worker_done` del
   último hijo como el cierre. Pero después de eso queda una espera —la
   publicación de la rama, que hace el humano— que puede durar días y de la que
   nadie se hace cargo.

### El espacio en disco: lo que el worktree deja atrás

Medición del mismo día, en la misma máquina:

| | |
|---|---|
| Imágenes de tickets vivas | **26 imágenes, 64,0 GB** |
| Tickets distintos que las dejaron | 14 |
| Antigüedad de la más vieja | 4 semanas, de un ticket mergeado hace rato |
| Build cache de Docker | 66,2 GB |
| Volúmenes huérfanos | 16 de 17 |

Cada ticket construye su par privado de imágenes —`api` de 3,7 a 5,1 GB y
`front` de 1,42 GB, o sea **5 a 6,5 GB por ticket**— y **nadie las borra nunca**.

Esto reordena la prioridad de la limpieza: borrar el worktree recupera unos
cientos de MB de código fuente, mientras las imágenes que ese mismo ticket dejó
atrás pesan veinte veces más. Una limpieza que borra el worktree y deja las
imágenes no es una limpieza; es lo que produjo los 64 GB.

## El objetivo, en una línea

**Varios hijos trabajando en paralelo, un solo stack levantado.** El paralelismo
que importa es el del trabajo —leer, implementar, commitear, esperar el CI—, y
eso no consume containers. Lo único que se serializa es el minuto en que un hijo
necesita la app corriendo.

| | Hoy | Con este diseño |
|---|---|---|
| 4 hijos implementando | 4 stacks, ~5,4 GB y 4 árboles en `virtiofsd` | 4 procesos, ~1,6 GB, **cero containers** |
| Cuando toca QA | los 4 pueden coincidir | 1 stack, ~1,4 GB |
| Imágenes que dejan | 4 × ~6 GB, para siempre | 0 al cerrar el ticket |

Un hijo sin stack cuesta ~400 MB. El techo deja de estar en cuántos tickets se
trabajan a la vez y pasa a estar en cuántos quieren probar al mismo tiempo, que
es una cola de segundos, no de horas.

## Decisiones tomadas

| Decisión | Elegido | Descartado y por qué |
|---|---|---|
| Aislamiento entre hijos | Total: cada uno con su stack | Compartir postgres/redis/pdp expone a que una migración destructiva de un ticket rompa el QA de otro |
| Vida del stack | Efímero: arriba solo para el QA | Mantenerlo arriba toda la vida del worktree es el costo que se paga hoy por días |
| Tope de QA simultáneos | Torniquete en 1, fijo | `maxConcurrentStacks` configurable es una perilla que nadie va a mover y una rama más para mantener |
| Mecanismo del torniquete | Un gate más, concedido por el conductor | Lockfile compartido rompe el aislamiento del hijo y un lock huérfano cuelga la tanda; medir la máquina cada uno deja que dos midan "hay lugar" en el mismo segundo |
| Borrado del worktree | Al anunciar, sin rastro | Antes no se puede: hasta que los PRs no están verdes puede haber que retocar la rama |
| Confirmación para borrar | Ninguna: automático si las tres verificaciones pasan | Pedir OK convierte la limpieza en algo que depende de que el usuario esté mirando, y es lo que produjo los 64 GB acumulados |
| Alcance del borrado | Worktree **y** las imágenes y volúmenes del ticket | Borrar solo el worktree recupera el 5% de lo que ese ticket ocupa |
| Vigilancia del PR | `Monitor` persistente sobre `gh pr checks` | "Queda a la escucha" sin herramienta es la falla que se está corrigiendo |
| Estado tras un crash | Reconstruido de Orca, `gh` y la label del tracker | Un archivo de estado propio agrega un dato que puede quedar viejo y mentir, justo en el momento en que todo lo demás ya falló |
| Adopción de una tanda ajena | Automática si sus hijos están muertos | Preguntar siempre repite el síntoma (nadie retoma); adoptar siempre puede pisar a una sesión hermana viva |
| CI en rojo | Vuelve al hijo con `reply` | Que lo arregle el conductor viola la regla de no editar worktrees ajenos; que lo vea el usuario es el trabajo manual que el conductor viene a absorber |

## Diseño

### 1. El stack nace y muere dentro del paso 8

En `skills/ticket-workflow/reference/qa-manual.md`, el paso 8 gana dos extremos.

**8.0 — Pedir turno.** Antes de levantar nada, el hijo pide turno con `ask`:
*"pido turno de QA"*. Queda bloqueado hasta que se lo conceden.

Si la skill corre **sin conductor** (modo que la propia skill admite), no hay a
quién pedirle: mide `free -m` y el swap en uso, y si no hay margen se lo dice al
usuario en vez de levantar igual.

**8.7 — Bajar y devolver el turno.** Con el gate 3 ya resuelto, corre
`qa.stopCommand`, verifica que los containers bajaron, y avisa al conductor que
devuelve el turno.

Dos precisiones que no son negociables:

- **El turno se devuelve cuando el gate 3 se resuelve, no cuando se sacan las
  capturas.** La app tiene que seguir arriba mientras el humano mira: que quede
  corriendo para su QA manual es el propósito declarado del paso 8, no un
  descuido.
- **Si el gate vuelve pidiendo cambios de código** (no "probá otro caso"), el
  hijo baja el stack y devuelve el turno ahí mismo. Retenerlo mientras
  re-implementa deja el torniquete cerrado media hora sin que nadie esté
  probando nada.

### 2. El torniquete

En `skills/conductor/`. El registro de sesión suma un campo:

```
ticket → { name, worktreeId, handle, taskId, dispatchId, qaTurn }
```

con `qaTurn` en `"held" | "queued" | null`.

- **Un solo `held` en toda la tanda.** Quien pide con el torniquete ocupado
  entra en cola FIFO y su `ask` **no se responde** hasta que se libera.
- **Un hijo esperando turno no es un hijo colgado.** Refuerza la regla que ya
  existe de no matar agentes por silencio, y agrega un motivo legítimo más para
  ese silencio.
- Se reporta en una línea: *"TCK-257 espera turno de QA; lo tiene TCK-262."*
- **Red de seguridad:** si quien tiene el turno desaparece de `terminal list`, o
  manda `worker_done` sin devolverlo, el conductor lo libera solo. Un turno
  huérfano cuelga la tanda entera.

### 3. La prohibición de delegar

Reemplaza el bullet "Un hijo no crea nietos" en `ticket-workflow`, y se agrega
como noveno punto del `--spec` en `skills/conductor/reference/agents.md`:

> **No delegás en otro agente.** Ni despachando por Orca, ni lanzando
> subagentes dentro de tu propia sesión — ni para el QA, ni para explorar
> código, ni para revisar tu diff. Todo lo de este ticket lo hacés vos, acá. Si
> una skill global te sugiere paralelizar con subagentes, en este flujo no
> aplica: cada agente extra levanta su propio contexto y puede levantar su
> propio stack, y esta máquina tiene otros worktrees corriendo que vos no ves.

La última cláusula carga el peso. El hijo tiene prohibido mirar a sus hermanos,
así que **no tiene forma de saber que la máquina está cargada**: si no se le
dice, el cálculo que hace siempre es "estoy solo, puedo paralelizar".

### 4. Sexta precondición: recursos

A las cinco actuales de `reference/agents.md` (Orca corriendo, orquestación
habilitada, `ticket-workflow` instalada, config de usuario, config de proyecto)
se suma medir antes de crear nada:

```bash
free -m                    # memoria disponible
swapon --show              # swap en uso
docker ps -q | wc -l       # containers vivos
```

Se reporta siempre. Se **para** si hay menos de 4 GB disponibles o el swap
supera el 50%, diciendo qué lo está consumiendo, en vez de crear dos hijos sobre
una máquina que ya está paginando.

Los umbrales son heurísticos, calibrados sobre la máquina medida arriba. Están
elegidos para fallar del lado seguro: negarse a arrancar de más cuesta un
mensaje, y arrancar de más cuesta la sesión entera.

### 5. `qa.stopCommand`

En `core/config-schema.md`. Hermano del `qa.startCommand` que las skills ya
usan; sin él no hay teardown posible y todo lo anterior es decorativo. De paso
quedan documentadas las tres claves de `qa` —`startCommand`, `stopCommand`,
`url`— que hoy figuran como un objeto genérico.

### 6. La vigilancia del PR

Apenas se registra un PR, el conductor arma **un `Monitor` persistente por PR**
que emite una línea por transición y sigue vivo mientras él hace otra cosa:

```bash
prev=""
while true; do
  # el estado se decide sobre el JSON, no sobre el exit code
  out=$(gh pr checks "$N" --repo "$SLUG" --json name,bucket 2>/dev/null)
  if [ -z "$out" ]; then
    cur=ERROR
  else
    cur=$(jq -r 'if length == 0 then "SINCHECKS"
                 elif any(.[].bucket; . == "fail" or . == "cancel") then "RED"
                 elif any(.[].bucket; . == "pending") then "PENDING"
                 else "GREEN" end' <<<"$out")
  fi
  [ "$cur" != "$prev" ] && [ "$cur" != "PENDING" ] && echo "$TICKET PR#$N $cur"
  prev=$cur; sleep 60
done
```

Tres detalles de los que depende que esto funcione, y que se equivocan solos:

- **El estado sale del JSON, nunca del exit code.** `gh pr checks` sale con 1
  cuando algún check falla y con 8 cuando hay pendientes. Un
  `|| echo ERROR` colapsa el rojo y el pendiente en "error de consulta", y el
  monitor se queda mudo exactamente ante la falla que viene a detectar.
- **`length == 0` se evalúa antes que todo lo demás.** Sobre una lista vacía,
  `all(...)` devuelve verdadero: un PR **sin checks corridos** se reportaría
  como `GREEN` y se anunciaría solo. Es el mismo error que la skill ya tiene
  documentado en *Errores comunes* ("falta el guarda `length > 0`"), y
  `SINCHECKS` no habilita a anunciar: se reporta y se espera.
- **El verde se decide por descarte, no por lista blanca.** Preguntar "¿son
  todos `pass`?" deja fuera a `skipping`, y un PR cuyos checks se saltean se
  quedaría en `PENDING` para siempre: como `PENDING` no emite, nadie se entera y
  nadie anuncia — el mismo modo de falla, en chico. La pregunta correcta es
  "¿queda alguno sin terminar?"; si no queda ninguno y ninguno falló, es verde.
  `cancel` cuenta como rojo: un check cancelado no probó nada.

El filtro cubre **rojo, verde, sin-checks y error de consulta**, no solo el
camino feliz. Un monitor que solo grepea el verde se queda callado cuando el CI
explota, y el silencio se lee igual que "todavía corriendo" — que es exactamente
el modo de falla que se está corrigiendo.

### 7. CI en rojo → vuelve al hijo

Cuando el monitor emite `RED`:

1. El conductor lee la falla con `gh run view --log-failed`. Mandarle al hijo
   "está en rojo" a secas lo obliga a salir a averiguar lo que el conductor ya
   tiene delante.
2. Se la manda **al hijo con `reply`**, con el job y el error. Es el mismo
   camino que ya usan los hallazgos de `code-review`: lo del hijo lo arregla el
   hijo, el conductor no edita worktrees ajenos.
3. El hijo corrige, y si hace falta pide turno de QA otra vez — el torniquete ya
   cubre ese caso.
4. El humano publica, el monitor emite `GREEN`, y **el anuncio sale solo**.

Los otros dos estados no se anuncian y no van al hijo:

- **`SINCHECKS`** — el PR no tiene checks corridos. No es verde: se le reporta
  al usuario y se espera. Puede ser que el workflow todavía no arrancó, o que
  `gateWorkflow` no aplica a ese repo, y esa diferencia la sabe él.
- **`ERROR`** — la consulta falló (sin red, sin sesión de `gh`, PR borrado). Se
  reporta y el monitor sigue: un error transitorio no puede matar la vigilancia.
  Si se repite, sube al usuario, porque un monitor que falla en silencio es
  indistinguible de uno que no tiene nada que decir.

Esto es lo que hace coherente la regla de no borrar el worktree antes de que los
PRs estén verdes: el worktree es lo que el hijo necesita para arreglar el CI. Y
el costo de tenerlo esperando bajó de un stack de 5 containers a ~400 MB de
proceso, que es justo lo que compra la decisión del stack efímero.

### 8. Cuándo termina la tanda

En `skills/conductor/SKILL.md`:

> La tanda **no termina** cuando los hijos reportan `worker_done`. Termina
> cuando **cada** ticket está anunciado y su worktree limpiado. Entre medio hay
> una espera que puede durar días y que no depende de ningún hijo: la
> publicación de la rama, que hace el humano a mano. Un ticket en esa espera es
> trabajo abierto, no trabajo terminado.

Y una regla de re-sincronización, porque los `Monitor` mueren con la sesión:
**al recibir cualquier turno del usuario, antes de responderle, el conductor
re-consulta el estado de los PRs de su registro y re-arma los monitores
perdidos.** Sin esto, cerrar la terminal un viernes significa que el lunes nadie
anuncia nada.

### 9. La limpieza es automática y completa

Reemplaza la regla actual de `reference/cleanup.md`, que dice textual *"No
borrar automáticamente, ni aunque las tres verificaciones pasen"*.

**Lo que cambia es la confirmación, no las verificaciones.** El OK del usuario
nunca fue lo que hacía segura la limpieza: lo que la hace segura es que el
trabajo ya está en el remoto. Las tres verificaciones —árbol limpio, `@{u}..HEAD`
vacío, sin stashes de esa rama— siguen siendo condición obligatoria, en el
wrapper y en **cada** submódulo. Si alguna falla, no se borra nada y se reporta
qué quedó y dónde, exactamente como hoy.

Lo que se elimina es el turno de espera. Un ticket anunciado, con los PRs verdes
y las tres verificaciones en orden, se limpia solo. Pedir OK ahí no protege
nada: el trabajo está publicado y la rama vive en GitHub. Y sí tiene un costo
medible — es lo que dejó 64 GB de imágenes de 14 tickets, algunas de hace un
mes, esperando una confirmación que nunca llegó porque nadie estaba mirando.

**Y borra todo lo del ticket, no solo el worktree:**

1. El worktree (`orca-ide worktree rm --worktree id:<id> --force`).
2. **Las imágenes que ese ticket construyó** — el par `<slug>-api` y
   `<slug>-front`. Son 5 a 6,5 GB por ticket y son el grueso de lo que se
   recupera.
3. **Los volúmenes de su stack**, que `docker compose down` no toca sin `-v`:
   ahí vive la base de datos del ticket.

El filtro de imágenes y volúmenes se ancla al **slug del worktree**, que es
único por ticket. Nunca un `prune` global: eso alcanzaría imágenes de tickets
vivos y de otras sesiones, que es justo lo que la skill ya prohíbe cuando dice
que un agente no toca lo que no es suyo.

**Lo que sigue sin ser automático**, y sin cambios: no se borra con
verificaciones en rojo, no se borra un PR `CLOSED` sin `mergedAt` —el trabajo se
descartó y puede que el usuario quiera rescatar algo—, y no se borra la rama
remota.

### 10. Recuperación después de un crash

Si la máquina colapsa o Orca se cierra por error, hoy el conductor no se entera
de nada. Y cuando se le vuelve a mandar el trabajo hace una de tres cosas, todas
malas: no lo detecta, lo trabaja él mismo, o **levanta un segundo hijo para un
worktree que ya tiene uno**, duplicando agente, stack e imágenes.

**Causa raíz: el registro `ticket → {name, worktreeId, handle...}` vive solo en
la memoria del conductor** y muere con la sesión.

#### El registro ya está persistido, y nadie lo leía

No hace falta un archivo de estado. Orca guarda la identidad que la skill ya
obliga a escribir — es exactamente para esto que se exige el nombre legible:

```bash
orca-ide worktree list --json   # displayName, linkedLinearIssue, branch, path, linkedPR
orca-ide terminal list --json   # worktreeId, handle, connected, orphaned, lastOutputAt
```

Un worktree con `linkedLinearIssue: "TCK-262"` y
`displayName: "TCK-262 · slug-corto"` **es** la entrada del registro. Lo que
falta lo tienen las otras fuentes que la skill ya consulta: los PRs salen de
`gh pr list --head <branch>` y de `linkedPR`, y si un ticket ya se anunció lo
dice `notifiedLabel`. El estado completo es reconstruible sin memoria y sin
archivo — que es, textualmente, lo que la skill ya manda hacer en *Cada sesión
es su propia tanda*: *"se reconstruye el estado leyendo Orca y el tracker, nunca
de memoria"*. La regla estaba escrita; estaba apagada.

#### Paso 0.5 — Reconciliar antes de crear nada

Corre **siempre** al arrancar, antes de la detección de tickets:

1. Listar worktrees y quedarse con los que tienen `linkedLinearIssue`, o
   `displayName` que matchee `<trackerPrefix>-<n> · `.
2. Cruzar con `terminal list` por `worktreeId`. Un hijo está **vivo** si tiene
   terminal con `connected: true` y `orphaned: false`.
3. Reportar lo encontrado **antes de tocar nada**.

#### La regla que ataca los tres síntomas

**Antes de crear un worktree o un agente, se busca el ticket en la lista.** Tres
salidas, y ninguna es "crear de nuevo":

| Estado | Qué se hace |
|---|---|
| Worktree existe, hijo **vivo** | **Reattach.** Re-resolver el handle por `worktreeId` y mandarle `reply`. No se crea nada. |
| Worktree existe, hijo **muerto** (`orphaned: true` o sin terminal) | **Revivir un agente en ese worktree** con `terminal create`. Nunca `worktree create`. |
| No hay worktree | Recién ahí, el flujo normal del paso 3. |

Y la que falta, que es la que más cuesta: **que un ticket ya tenga worktree no
habilita a trabajarlo en la sesión del conductor.** Encontrar trabajo a medias
no convierte al conductor en el hijo; sigue siendo el error más caro de la
skill, y el crash es justo cuando más tienta cometerlo.

El `worktreeId` y el `displayName` son estables; **el handle no** —la skill ya
lo advierte, es routing y cambia si el pane se reinicia—, así que después de un
crash el handle viejo no sirve y hay que re-resolverlo por `worktreeId`. Esa es
la razón concreta por la que el nombre se exige al crear: es la única dirección
que sobrevive.

#### El spec de retoma no es el spec inicial

Un hijo revivido que recibe el spec original vuelve a empezar de cero y pisa lo
que ya estaba hecho. El de retoma le dice, antes que nada, que **mire dónde
quedó**: su rama, sus commits, si ya hay PR, y qué dice el comentario del ticket.
Recién con eso sigue. Todo lo demás del spec original vale igual.

#### Reconciliar lo que el crash dejó tomado

Un colapso no baja nada limpiamente. En el mismo paso 0.5:

- **Containers arriba de tickets sin hijo vivo** → se bajan. Es memoria que
  quedó tomada por un stack que ya no tiene dueño, y es parte de por qué la
  máquina sigue pesada después de reabrir.
- **El torniquete queda libre.** Si el que lo tenía murió, nadie lo tiene: se
  reinicia en `null`, o el primer hijo que pida turno espera para siempre.

#### Cuándo adopta sin preguntar, y cuándo pregunta

La regla de *Cada sesión es su propia tanda* existe para que dos conductores
vivos no le contesten el mismo gate al mismo hijo ni manden dos anuncios. Sigue
en pie; lo que se agrega es distinguir la sesión hermana viva de la muerta, y
`connected`/`orphaned` alcanzan:

- **Todos los hijos del ticket muertos** → es un crash, no una sesión hermana:
  ninguna sesión viva puede estar conduciendo agentes muertos. **Adopta y sigue,
  sin preguntar**, que es lo que se le está pidiendo.
- **Encuentra hijos vivos que no creó** → ahí sí hay ambigüedad real: puede
  haber otra terminal conduciéndolos. **Pregunta una sola vez** por toda la
  tanda, no ticket por ticket.

## Límite conocido

Si la sesión se cierra, los monitores mueren. La regla de re-sincronización los
recupera en cuanto el usuario vuelve a escribir, pero **entre el cierre y ese
mensaje no hay nadie mirando**. Un conductor que sobreviva a la sesión exige un
cron real y un estado en disco: es un rediseño mayor, explícitamente fuera de
alcance acá.

## Fuera del alcance de las skills

Más de la mitad del consumo medido no lo puede tocar ninguna skill, y se
registra acá para que la próxima medición no lo redescubra:

- **La VM de Docker Desktop reserva 12,2 GB y no los devuelve.** Reducir su
  límite es configuración de la máquina.
- **`<servicio-de-permisos>` quema ~80% de un core en idle**, duplicado por ticket. Es una
  característica del stack de trabajo, no de este repo.

## Archivos

| Archivo | Cambio |
|---|---|
| `skills/ticket-workflow/reference/qa-manual.md` | Pasos 8.0 y 8.7 |
| `skills/ticket-workflow/SKILL.md` | Prohibición de delegar; paso 8 con turno |
| `skills/conductor/SKILL.md` | Torniquete; fin de la tanda; re-sincronización; paso 0.5 de reconciliación |
| `skills/conductor/reference/agents.md` | Sexta precondición; punto 9 del `--spec`; reattach/revivir; spec de retoma |
| `skills/conductor/reference/discord.md` | Disparo del anuncio desde el evento `GREEN` |
| `skills/conductor/reference/cleanup.md` | Limpieza automática; borrado de imágenes y volúmenes |
| `core/config-schema.md` | `qa.stopCommand` y las tres claves de `qa` |

## Verificación

`tools/check-schema-refs.sh` y `tools/check-placeholders.sh`, que ya existen, y
que el hook de pre-commit corre. El primero valida que `qa.stopCommand` esté
declarado en el schema antes de que una skill lo referencie.
