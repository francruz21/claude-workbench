# Diseño — `claude-conductor`: supervisor de agentes por ticket

> **Histórico**: este documento describe el diseño previo a la unificación en `claude-workbench` y no refleja el estado actual del repo. Se conserva por el razonamiento que registra, no como referencia vigente — ver `docs/superpowers/specs/2026-08-24-claude-workbench-design.md` para el diseño actual.

**Fecha:** 2026-08-20
**Estado:** aprobado, sin implementar
**Depende de:** `ticket-workflow` (de `claude-brain`), Orca IDE con orquestación habilitada

## Problema

Trabajar varios tickets a la vez hoy significa abrir una sesión de Claude por
ticket a mano, acordarse de en qué worktree está cada una, y al final juntar los
PRs y anunciarlos en Discord copiando y pegando. Tres costos concretos:

1. **No hay nadie mirando el conjunto.** Cada sesión sabe de su ticket y nada
   más. Si dos tickets tocan el mismo archivo, se descubre en el merge.
2. **El anuncio en Discord es trabajo manual repetido** — buscar los PRs
   verdes, agrupar por ambiente, escribir qué hace cada uno, mencionar a quien
   revisa.
3. **La limpieza no se hace.** Los worktrees de tickets ya mergeados quedan
   acumulándose porque nadie se acuerda de borrarlos.

## Qué es

Una skill de supervisión — el **conductor** — que corre en la sesión donde el
usuario pega los links de ticket. Por cada ticket crea un worktree de Orca con
su propio agente Claude, le pasa el ticket, y supervisa: relevea los gates al
usuario, junta los PRs cuando están verdes, arma y postea el mensaje de
Discord, y al final limpia.

El conductor **no hace el trabajo del ticket**. Eso lo hace cada agente hijo
corriendo `ticket-workflow`, que ya existe y ya tiene su flujo de 15 pasos.

## Decisiones

### 1. Un agente por ticket, worktree a nivel wrapper

En un workspace con submódulos, el worktree se crea una vez en el wrapper y
trae front y back adentro. Un solo agente se ocupa de los dos repos.

**Por qué no uno por repo:** comparten el mismo stack local (un solo
`docker-compose.local.yml`, un solo puerto 4321). Dos agentes levantando la
misma app se pisan.

### 2. Los cinco gates de `ticket-workflow` se relevean al usuario, no se responden

`ticket-workflow` tiene cinco puntos donde decide el usuario: tipo de rama, el
cráneo, el QA manual, commit/push y la PR. El conductor los **transporta**: el
agente manda `ask`, el conductor se lo muestra al usuario, el usuario contesta,
el conductor responde con `reply`.

**Por qué:** automatizar las respuestas vacía los gates, que son la razón por la
que el flujo del ticket es confiable. El conductor no agrega autonomía, agrega
paralelismo y orden.

**El costo, dicho de frente:** tres tickets en paralelo son ~15 gates. El valor
que agrega el conductor ahí es **serializarlos** — que lleguen de a uno, con el
nombre del ticket adelante, en vez de tres sesiones gritando a la vez.

`relayGates: "all"` es el default. `"judgment-only"` responde los dos
derivables del ticket (tipo de rama y rama base, que salen de los labels) y
eleva solo cráneo, QA y PR. Es una concesión a la practicidad, no el default.

### 3. El conductor no pushea, no mergea, no aprueba

Restricciones duras, no sugerencias:

- No `git push`, no `git merge`, no `gh pr merge`, no `gh pr review --approve`.
- No responde gates en nombre del usuario (salvo el modo `judgment-only`
  explícito).
- No postea en Discord sin mostrar el mensaje antes.
- No borra un worktree sin confirmación.

Los hijos sí pushean, con la confirmación del usuario que ya pide
`ticket-workflow`. El conductor observa y coordina.

### 4. Los nombres de los agentes

Orca direcciona agentes por *handle* de terminal, que es un identificador
opaco. Para que el usuario y el conductor puedan hablar de ellos, cada agente
recibe un nombre legible al crearse: el ID del ticket más un slug corto, por
ejemplo `TCK-262 · slug-corto`.

Ese nombre es el `--display-name` del worktree. El conductor mantiene un
registro en memoria de la sesión: `ticket → {name, worktreeId, handle, taskId,
dispatchId}`. El handle puede cambiar si el pane se reinicia; el nombre y el
worktreeId no.

### 5. El mensaje de Discord: agrupado por ambiente, una línea por PR

Un mensaje por ambiente destino — nunca un encabezado que diga "PR a DEV" con
PRs que van a stage adentro. Dentro de cada mensaje, agrupado por ticket, una
línea por PR:

```
@<mención> — PRs a DEV 🟢

**TCK-262** `fix/TCK-262-titulo-largo-del-ticket-…`
[API #25](url) `stage→dev` — rechaza el login en un hub que el usuario no tiene asignado
[FRONT #61](url) `stage→dev` — valida el hub del portal también para los admins

**TCK-257** `fix/TCK-257-titulo-del-segundo-ticket`
[FRONT #62](url) `stage→dev` — oculta labels y certificación de estudiante/graduado en hubs sin formaciones

Los 3 verdes en Tests & Coverage 👌
```

- La flecha dice **origen → destino**, no solo el destino: es la información que
  el revisor necesita para saber qué está aprobando.
- La descripción de cada línea sale del comentario que el agente ya dejó en el
  ticket. No se redacta dos veces.
- El tag del repo (`API`/`FRONT`) viene de la config, nunca se infiere del
  título del PR.

### 6. Solo los PRs del autor configurado

Se anuncian únicamente los PRs cuyo `author.login` coincide con el configurado.
El conductor no anuncia trabajo de otra gente.

### 7. Ningún nombre de persona en el repo

El repo es público. El login de GitHub del usuario, la mención de Discord y el
ID del canal viven en **`~/.claude/conductor.config.json`, fuera del repo**. Lo
único que se commitea es `conductor.config.example.json` con placeholders.
`install.sh` pregunta los valores la primera vez y escribe el archivo en el
home.

**Por qué fuera del repo y no adentro con `.gitignore`:** un `.gitignore` es una
sola línea de distancia de un `git add -f` o de un clone que la pierde. Un
archivo que nunca estuvo en el árbol del repo no se puede commitear por error.
El `.gitignore` igual lista `conductor.config.json` como segunda barrera, para
el caso de que alguien copie el archivo adentro.

### 8. Discord por el navegador embebido de Orca

Elección explícita del usuario por sobre el MCP de Discord.

**El riesgo, documentado:** Discord web es una SPA y la mención exige elegir de
un autocompletado. Si el popup no aparece, el mensaje sale con `@Nombre` como
texto plano y **no notifica a nadie**. El flujo verifica que la mención quedó
resuelta antes de enviar; si no puede verificarlo, para y avisa. Nunca manda un
ping falso.

Alternativa disponible si el navegador resulta insostenible: el MCP de Discord
(`mcp__discord__discord_send`), que necesita `DISCORD_TOKEN` exportado.

### 9. La limpieza pide confirmación

Al detectar que todos los PRs de un ticket están aprobados y mergeados, el
conductor verifica que el worktree no tenga cambios sin commitear ni commits sin
pushear, muestra qué va a borrar, y espera OK.

**Por qué no automático:** un worktree borrado se lleva puesto cualquier trabajo
local. El riesgo no es simétrico — un worktree de más no cuesta nada, un
worktree borrado de menos cuesta el trabajo.

## Las 7 fases

| Fase | Qué hace | Gate |
|---|---|---|
| 0 | Precondiciones: Orca corriendo, orquestación habilitada, `ticket-workflow` instalada, config presente | — |
| 1 | Parsea los links/IDs pegados y confirma la lista | confirma |
| 2 | Onboarding, solo la primera vez | pregunta |
| 3 | Un worktree + agente por ticket, con nombre, y dispatch del task | — |
| 4 | Supervisión: ventanas rodantes de `check --wait`, relevo de gates | relevo |
| 5 | Junta PRs verdes, agrupa por ambiente, muestra el mensaje, postea | confirma |
| 6 | Detecta merged, verifica limpio, confirma, borra | confirma |

## Lo que se reutiliza

- **Orquestación de Orca**: `task-create`, `dispatch --inject`, `check --wait
  --types worker_done,escalation,decision_gate`, `ask`, `reply`. No se
  reimplementa mensajería entre agentes.
- **El filtro de PRs verdes de `<skill de anuncios del proyecto>`**, ya verificado contra
  datos reales: exige que el workflow del gate haya corrido *y* que todos sus
  checks estén `COMPLETED` + `SUCCESS`, y descarta drafts. Se le suma
  `--author`.
- **El dedupe por label** (`<label-de-ya-anunciado>`, configurable), que hace
  la operación idempotente aunque el conductor corra dos veces.
- **`ticket-workflow`** entero para el trabajo del ticket.

## Fuera de alcance

- Que el conductor decida el orden de los tickets por dependencias entre ellos.
  Si dos tickets tocan lo mismo, lo dice; no lo resuelve.
- Anunciar PRs de otros autores.
- Mergear, aprobar o pushear cualquier cosa.
- Trackers sin MCP conectado: el conductor los detecta y pide el contenido
  pegado, igual que `ticket-workflow`.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| La mención de Discord sale como texto plano y no notifica | Verificar que la mención quedó resuelta antes de enviar; si no, parar |
| Un agente se cuelga y el conductor lo da por muerto | Un timeout de `check --wait` es un checkpoint, no una falla. Nunca matar un agente por silencio |
| Dos agentes levantan el mismo stack local y se pisan | Un agente por ticket, y el QA de un ticket a la vez |
| Nada de esto está probado de punta a punta | La implementación arranca con **un solo ticket** antes de habilitar paralelismo |
