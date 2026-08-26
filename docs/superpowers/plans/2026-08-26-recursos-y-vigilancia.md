# Recursos y vigilancia — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que varios agentes hijos trabajen en paralelo sin colapsar la máquina, y que el conductor no pierda de vista un ticket ni duplique trabajo después de un crash.

**Architecture:** Nueve cambios de texto sobre siete archivos de skills. Ninguno agrega código: lo que cambia son las reglas que siguen el conductor y sus hijos. Tres piezas son mecanismos reales (el torniquete de QA concedido por el conductor, los `Monitor` sobre `gh pr checks`, y la reconciliación contra `orca-ide worktree list`); el resto son reglas y guardas. El orden importa en un solo punto: el schema declara `qa.stopCommand` antes de que ninguna skill lo referencie, porque el hook de pre-commit lo valida.

**Tech Stack:** Markdown; `bash`, `jq`, `gh`, `docker`, `orca-ide`; validadores del propio repo en `tools/`.

**Spec:** `docs/superpowers/specs/2026-08-26-recursos-y-vigilancia-design.md`

## Global Constraints

Valen para **todas** las tareas. No se repiten en cada una.

- **Este repo es público.** Ningún valor real de config, ningún nombre de proyecto, ningún handle, ninguna URL de canal. Todo ejemplo es placeholder. `tools/check-placeholders.sh` lo bloquea.
- **Todo campo de config que una skill referencie tiene que existir en `core/config-schema.md`.** `tools/check-schema-refs.sh` lo valida.
- **Toda skill cita el protocolo de `core/resolve.md`.** `tools/check-core-refs.sh` lo valida.
- **El español del repo es rioplatense, sin voseo forzado en las reglas** — el estilo existente manda. No traducir términos ya asentados: gate, worktree, stack, handle, spec.
- **Ningún cambio agrega autonomía al conductor sobre lo delicado.** Arquitectura, contratos compartidos, permisos, infra e irreversible siguen subiendo al usuario en los tres modos de `relayGates`.
- **El conductor no pushea, no mergea y no aprueba PRs.** Los hijos tampoco.

### El ciclo de test de este repo

No hay `pytest`. El equivalente son dos cosas, y las dos corren en cada tarea:

```bash
# 1. Los tres validadores + la suite del repo
./tools/check-placeholders.sh && ./tools/check-schema-refs.sh && ./tools/check-core-refs.sh
for t in tools/tests/test-*.sh; do bash "$t" || echo "FALLÓ: $t"; done
```

```bash
# 2. Aserciones grep — el test real de una skill en prosa
# Cada tarea trae las suyas. Se corren ANTES de editar (tienen que fallar)
# y DESPUÉS (tienen que pasar).
```

**Por qué las aserciones `grep` son el test que importa.** El riesgo de este repo no es que un archivo no compile: es que `SKILL.md` diga una cosa y su `reference/` diga la contraria, y que el agente que lea primero el archivo viejo haga lo viejo. Cada tarea que **cambia** una regla existente tiene que verificar que la regla vieja **desapareció**, no solo que la nueva está. Una tarea que agrega texto sin borrar el que contradice no está terminada.

---

## Estructura de archivos

| Archivo | Responsabilidad después de este plan |
|---|---|
| `core/config-schema.md` | Declara `qa.startCommand`, `qa.stopCommand`, `qa.url` |
| `skills/ticket-workflow/SKILL.md` | Regla de no delegar; paso 8 con turno |
| `skills/ticket-workflow/reference/qa-manual.md` | Ciclo de vida del stack: 8.0 pedir turno, 8.7 bajar y devolver |
| `skills/conductor/SKILL.md` | Torniquete, vigilancia, fin de la tanda, reconciliación, limpieza |
| `skills/conductor/reference/agents.md` | Precondición de recursos, punto 9 del `--spec`, reattach/revivir |
| `skills/conductor/reference/discord.md` | El anuncio dispara desde el evento `GREEN` |
| `skills/conductor/reference/cleanup.md` | Limpieza automática; borra worktree, imágenes y volúmenes |

Cada tarea toca los archivos de **una** pieza del spec y termina con `SKILL.md` y su `reference/` diciendo lo mismo.

---

### Task 1: `qa.stopCommand` en el schema

Va primera porque `check-schema-refs.sh` corre en el pre-commit: si la Task 2 referencia `qa.stopCommand` antes de que el schema lo declare, el commit se rechaza.

**Files:**
- Modify: `core/config-schema.md` — la fila `qa` de la tabla de la capa `project`, y el ejemplo completo

**Interfaces:**
- Produces: los tres nombres `qa.startCommand`, `qa.stopCommand`, `qa.url`, que consumen las Tasks 2 y 9

- [ ] **Step 1: Escribir la aserción que tiene que fallar**

```bash
grep -q 'qa.stopCommand' core/config-schema.md && echo PASA || echo FALLA
```

- [ ] **Step 2: Correrla y confirmar que falla**

Esperado: `FALLA` — el campo todavía no existe.

- [ ] **Step 3: Reemplazar la fila `qa` de la tabla de la capa `project`**

Buscar la fila actual:

```markdown
| `qa` | object | configuracion de QA del proyecto |
```

y reemplazarla por:

```markdown
| `qa.startCommand` | string | comando que levanta la app local para el QA del paso 8 |
| `qa.stopCommand` | string | comando que la baja y libera los puertos, al cerrarse el paso 8 |
| `qa.url` | string | URL donde responde la app una vez levantada |
```

- [ ] **Step 4: Actualizar el ejemplo completo de la capa `project`**

Buscar:

```json
  "qa": { "<clave-de-qa>": "<valor-de-qa>" },
```

y reemplazar por:

```json
  "qa": {
    "startCommand": "<comando-que-levanta-la-app>",
    "stopCommand": "<comando-que-la-baja>",
    "url": "<url-local-de-la-app>"
  },
```

- [ ] **Step 5: Agregar la nota de por qué `stopCommand` es obligatorio**

Inmediatamente después de la tabla de la capa `project`, antes de la sección *Por que esos cinco campos bajaron*:

```markdown
### `qa.stopCommand` no es opcional

Sin él no hay forma de bajar el stack al cerrar el paso 8, y el stack de cada
ticket queda arriba tanto como su worktree — que puede ser días. Un proyecto que
no lo declara deja el paso 8 sin cierre: ahí se pregunta, siguiendo
`core/resolve.md`, y no se inventa un `down` a partir del `startCommand`.
```

- [ ] **Step 6: Correr el ciclo de test completo**

```bash
grep -q 'qa.stopCommand' core/config-schema.md && echo PASA || echo FALLA
./tools/check-placeholders.sh && ./tools/check-schema-refs.sh && ./tools/check-core-refs.sh
```

Esperado: `PASA`, y los tres validadores en OK.

- [ ] **Step 7: Commit**

```bash
git add core/config-schema.md
git commit -m "feat(config): qa.stopCommand, sin el cual el stack no se puede bajar"
```

---

### Task 2: El stack nace y muere dentro del paso 8

**Files:**
- Modify: `skills/ticket-workflow/reference/qa-manual.md` — nueva sección 0 antes de *1. Levantar la app local*, y nueva sección final
- Modify: `skills/ticket-workflow/SKILL.md` — el paso 8 y la checklist

**Interfaces:**
- Consumes: `qa.stopCommand` (Task 1)
- Produces: el mensaje `pido turno de QA` y el aviso de devolución, que consume el torniquete de la Task 4

- [ ] **Step 1: Escribir las aserciones que tienen que fallar**

```bash
grep -q 'pido turno de QA' skills/ticket-workflow/reference/qa-manual.md && echo A_PASA || echo A_FALLA
grep -q 'qa.stopCommand' skills/ticket-workflow/reference/qa-manual.md && echo B_PASA || echo B_FALLA
```

- [ ] **Step 2: Correrlas y confirmar que fallan**

Esperado: `A_FALLA` y `B_FALLA`.

- [ ] **Step 3: Insertar la sección 0, justo antes de `## 1. Levantar la app local`**

```markdown
## 0. Pedir turno antes de levantar nada

**Un solo stack arriba en toda la máquina.** Levantar el tuyo sin pedir turno es
lo que la vuelve inusable: cada stack son cinco containers y otro árbol
bind-montado, y no tenés forma de ver cuántos hermanos ya están corriendo el
suyo.

Con conductor —el caso normal— se pide con `ask` y se espera:

> pido turno de QA

**Quedarte bloqueado ahí es lo esperado, no es que algo se colgó.** El conductor
concede de a uno; si otro ticket está probando, tu turno llega cuando termine.
No levantes "mientras tanto" y no lo preguntes de nuevo.

Sin conductor (la skill corriendo directo con el usuario) no hay a quién
pedirle, así que se mide antes de levantar:

```bash
free -m | awk '/^Mem:/ {print "disponible:", $7, "MB"}'
swapon --show --noheadings --raw --bytes | awk '{u+=$4; t+=$3} END {if (t>0) printf "swap en uso: %.0f%%\n", 100*u/t}'
```

Si hay menos de 4 GB disponibles o el swap pasa del 50%, **decírselo al usuario
y no levantar**: la máquina ya está paginando y el stack la termina de tumbar.
```

- [ ] **Step 4: Insertar la sección de cierre, después de `## 6. Presentar y esperar el OK`**

```markdown
## 7. Bajar el stack y devolver el turno

**Cuándo:** con el gate 3 ya resuelto, no cuando se sacaron las capturas. Que la
app quede corriendo mientras el humano hace su QA manual es el propósito del
paso 8, así que bajarla antes le saca justo lo que vino a buscar.

```bash
<qa.stopCommand del config>
docker ps --format '{{.Names}}' | grep -F "<slug-del-worktree>" || echo "stack abajo"
```

Verificar que bajó: un `stopCommand` que falla en silencio deja los cinco
containers arriba y el turno devuelto, que es el peor de los dos mundos —el
siguiente hijo levanta el suyo creyendo que está solo.

Después, avisar que se devuelve el turno:

> QA cerrado, devuelvo el turno.

**Si el gate 3 vuelve pidiendo cambios de código** —no "probá también este otro
caso"—, se baja el stack y se devuelve el turno **ahí mismo**, antes de ponerse
a corregir. Retenerlo mientras se re-implementa deja el torniquete cerrado media
hora sin que nadie esté probando nada. Cuando haya algo nuevo que probar, se
pide de nuevo desde la sección 0.
```

- [ ] **Step 5: Actualizar el paso 8 en `SKILL.md`**

En la descripción del paso 8, agregar como primera y última frase del paso:

```markdown
El paso 8 **empieza pidiendo turno** y **termina bajando el stack**: un solo
stack arriba en toda la máquina. Ver
[`reference/qa-manual.md`](reference/qa-manual.md).
```

- [ ] **Step 6: Agregar los dos ítems a la checklist de `SKILL.md`**

```markdown
- [ ] Se pidió turno de QA antes de levantar el stack, y se esperó a que lo concedieran.
- [ ] El stack se bajó y el turno se devolvió al resolverse el gate 3, verificando que los containers efectivamente bajaron.
```

- [ ] **Step 7: Agregar el error común a `SKILL.md`**

```markdown
- **Dejar el stack arriba después del QA** — son cinco containers y un árbol
  bind-montado que quedan tomados tanto como el worktree, o sea días. No se nota
  en el ticket propio; se nota cuando el tercer hermano no puede levantar el suyo.
```

- [ ] **Step 8: Correr el ciclo de test completo**

```bash
grep -q 'pido turno de QA' skills/ticket-workflow/reference/qa-manual.md && echo A_PASA || echo A_FALLA
grep -q 'qa.stopCommand' skills/ticket-workflow/reference/qa-manual.md && echo B_PASA || echo B_FALLA
grep -c 'devuelv' skills/ticket-workflow/reference/qa-manual.md
./tools/check-placeholders.sh && ./tools/check-schema-refs.sh && ./tools/check-core-refs.sh
```

Esperado: `A_PASA`, `B_PASA`, el contador en 2 o más, validadores en OK.

- [ ] **Step 9: Commit**

```bash
git add skills/ticket-workflow/
git commit -m "feat(ticket-workflow): el stack nace y muere dentro del paso 8"
```

---

### Task 3: La prohibición de delegar

Es la tarea que ataca el "ahí es donde revienta todo": un hijo que lanza otro agente para el QA duplica contexto y puede duplicar el stack.

**Files:**
- Modify: `skills/ticket-workflow/SKILL.md` — el bullet *Un hijo no crea nietos* (línea ~41), la checklist y los errores comunes

**Interfaces:**
- Produces: el texto que la Task 4 copia como punto 9 del `--spec`

- [ ] **Step 1: Escribir las aserciones**

```bash
# la vieja tiene que desaparecer tal cual está
grep -q 'Un hijo no crea nietos.\*\* Si te llega otro ticket' skills/ticket-workflow/SKILL.md && echo VIEJA_PRESENTE || echo VIEJA_AUSENTE
grep -q 'No delegás en otro agente' skills/ticket-workflow/SKILL.md && echo NUEVA_PRESENTE || echo NUEVA_AUSENTE
```

- [ ] **Step 2: Correrlas y confirmar el estado inicial**

Esperado: `VIEJA_PRESENTE` y `NUEVA_AUSENTE`.

- [ ] **Step 3: Reemplazar el bullet completo**

Buscar el bullet actual, que dice:

```markdown
- **Un hijo no crea nietos.** Si te llega otro ticket, lo reportás para arriba y
  no lo agarrás. Despachar agentes es del conductor.
```

y reemplazarlo por:

```markdown
- **No delegás en otro agente.** Ni despachando por Orca, ni lanzando subagentes
  dentro de tu propia sesión — ni para el QA, ni para explorar código, ni para
  revisar tu diff. Todo lo de este ticket lo hacés vos, acá. Si una skill global
  te sugiere paralelizar con subagentes, en este flujo no aplica: cada agente
  extra levanta su propio contexto y puede levantar su propio stack, y esta
  máquina tiene otros worktrees corriendo que vos no ves.

  Y si te llega **otro ticket**, lo reportás para arriba y no lo agarrás:
  despachar es del conductor.
```

**Por qué el reemplazo y no un bullet nuevo al lado:** la regla vieja está
escrita contra *otro ticket* y contra *despachar por Orca*. Un agente que lee
"no crea nietos" y quiere paralelizar su QA concluye, con razón, que eso no es
un nieto. Dejar las dos redacciones convivir le da la salida.

- [ ] **Step 4: Agregar el ítem a la checklist**

```markdown
- [ ] No se lanzó ningún subagente: el QA, la exploración y la revisión del diff los hizo esta misma sesión.
```

- [ ] **Step 5: Agregar el error común**

```markdown
- **Lanzar un subagente para el QA** — parece gratis porque no crea worktree,
  pero suma otro contexto y puede levantar un segundo stack sobre la misma
  máquina. Es el modo más caro de reventar el ambiente, y el más fácil de
  justificar: "solo para esta parte".
```

- [ ] **Step 6: Correr el ciclo de test completo**

```bash
grep -q 'Un hijo no crea nietos.\*\* Si te llega otro ticket' skills/ticket-workflow/SKILL.md && echo VIEJA_PRESENTE || echo VIEJA_AUSENTE
grep -q 'No delegás en otro agente' skills/ticket-workflow/SKILL.md && echo NUEVA_PRESENTE || echo NUEVA_AUSENTE
./tools/check-placeholders.sh && ./tools/check-schema-refs.sh && ./tools/check-core-refs.sh
```

Esperado: `VIEJA_AUSENTE`, `NUEVA_PRESENTE`, validadores en OK.

- [ ] **Step 7: Commit**

```bash
git add skills/ticket-workflow/SKILL.md
git commit -m "fix(ticket-workflow): la prohibición de delegar cubre los subagentes, no solo los nietos"
```

---

### Task 4: El torniquete de QA

**Files:**
- Modify: `skills/conductor/SKILL.md` — el registro de la sesión, una sección nueva, la checklist y los errores comunes
- Modify: `skills/conductor/reference/agents.md` — el registro, el punto 9 del `--spec`, y la sección de supervisión

**Interfaces:**
- Consumes: los mensajes `pido turno de QA` y `devuelvo el turno` (Task 2); el texto de no delegar (Task 3)
- Produces: el campo `qaTurn` del registro, que consumen las Tasks 8 y 9

- [ ] **Step 1: Escribir las aserciones**

```bash
grep -q 'qaTurn' skills/conductor/SKILL.md && echo A_PASA || echo A_FALLA
grep -q 'qaTurn' skills/conductor/reference/agents.md && echo B_PASA || echo B_FALLA
grep -q 'ocho cosas' skills/conductor/reference/agents.md && echo SPEC_VIEJO || echo SPEC_NUEVO
```

- [ ] **Step 2: Correrlas**

Esperado: `A_FALLA`, `B_FALLA`, `SPEC_VIEJO`.

- [ ] **Step 3: Extender el registro en `agents.md`**

Buscar:

```
ticket → { name, worktreeId, handle, taskId, dispatchId }
```

y reemplazar por:

```
ticket → { name, worktreeId, handle, taskId, dispatchId, qaTurn }
```

Y agregar, debajo del párrafo que explica que `handle` es routing:

```markdown
`qaTurn` es `"held"`, `"queued"` o `null`, y **solo uno puede estar en `"held"`
en toda la tanda**. Es el torniquete del stack: ver *El torniquete de QA* en la
skill.
```

- [ ] **Step 4: Insertar la sección del torniquete en `SKILL.md`**

Después de la sección *Qué decide el conductor, y qué te pregunta*, antes de *Pasos detallados*:

```markdown
## El torniquete de QA

**Varios hijos en paralelo, un solo stack levantado.** El paralelismo que importa
es el del trabajo —leer, implementar, commitear, esperar el CI— y ese no consume
containers. Lo único que se serializa es el minuto en que un hijo necesita la app
corriendo.

Un hijo pide turno antes de levantar nada (paso 8 de `ticket-workflow`). El
conductor lo concede **de a uno**:

- **Torniquete libre** → se concede, y ese ticket queda en `qaTurn: "held"`.
- **Torniquete ocupado** → el pedido queda en `qaTurn: "queued"` y **su `ask` no
  se responde** hasta que se libera. Se conceden en el orden en que llegaron.
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
```

- [ ] **Step 5: Agregar el punto 9 al `--spec` en `agents.md`**

Cambiar el encabezado:

```markdown
Tiene que decirle al agente ocho cosas, explícitas:
```

por:

```markdown
Tiene que decirle al agente nueve cosas, explícitas:
```

y agregar al final de la lista:

```markdown
9. **Que no delega en ningún otro agente.** Ni despachando por Orca, ni lanzando
   subagentes dentro de su propia sesión — ni para el QA, ni para explorar
   código, ni para revisar su diff. Va textual, porque el hijo hereda las skills
   globales del usuario y algunas lo empujan justo para el otro lado:

   > No delegás en otro agente. Todo lo de este ticket lo hacés vos, en esta
   > sesión. Si una skill global te sugiere paralelizar con subagentes, en este
   > flujo no aplica: cada agente extra levanta su propio contexto y puede
   > levantar su propio stack, y esta máquina tiene otros worktrees corriendo
   > que vos no ves.

   La última frase carga el peso: el hijo tiene prohibido mirar a sus hermanos,
   así que **no tiene forma de saber que la máquina está cargada**. Si no se le
   dice, el cálculo que hace siempre es "estoy solo, puedo paralelizar".
```

- [ ] **Step 6: Agregar la nota a la sección de supervisión de `agents.md`**

Al final de *Supervisar sin matar agentes*, después del bullet del hijo que espera al humano:

```markdown
- **Un hijo esperando turno de QA tampoco está estancado.** Es el conductor el
  que todavía no le contestó, así que su silencio es literalmente lo que el
  torniquete pidió que hiciera.
```

- [ ] **Step 7: Agregar los ítems a la checklist de `SKILL.md`**

```markdown
- [ ] Nunca hubo dos stacks arriba a la vez: el turno de QA se concedió de a uno.
- [ ] Antes de conceder un turno liberado por red de seguridad, se verificó que los containers del anterior bajaron.
- [ ] El `--spec` le dijo a cada agente que no delega en ningún otro agente, ni siquiera para el QA.
```

- [ ] **Step 8: Agregar los errores comunes a `SKILL.md`**

```markdown
- **Conceder un turno sin haber verificado que el stack anterior bajó** — deja
  dos stacks arriba y el torniquete deja de servir para lo único que existe.
- **Tratar como colgado a un hijo que espera turno** — es el conductor quien no
  le contestó todavía. Cerrarlo tira trabajo por un silencio que él mismo pidió.
```

- [ ] **Step 9: Correr el ciclo de test completo**

```bash
grep -q 'qaTurn' skills/conductor/SKILL.md && echo A_PASA || echo A_FALLA
grep -q 'qaTurn' skills/conductor/reference/agents.md && echo B_PASA || echo B_FALLA
grep -q 'nueve cosas' skills/conductor/reference/agents.md && echo SPEC_NUEVO || echo SPEC_VIEJO
./tools/check-placeholders.sh && ./tools/check-schema-refs.sh && ./tools/check-core-refs.sh
```

Esperado: `A_PASA`, `B_PASA`, `SPEC_NUEVO`, validadores en OK.

- [ ] **Step 10: Commit**

```bash
git add skills/conductor/
git commit -m "feat(conductor): torniquete de QA — varios hijos, un solo stack arriba"
```

---

### Task 5: La sexta precondición — recursos

**Files:**
- Modify: `skills/conductor/reference/agents.md` — la sección *Precondiciones*
- Modify: `skills/conductor/SKILL.md` — el paso 0 y la checklist

**Interfaces:**
- Produces: nada que otras tareas consuman; es una guarda de entrada

- [ ] **Step 1: Escribir las aserciones**

```bash
grep -q 'Verificar las cinco' skills/conductor/reference/agents.md && echo CINCO || echo NO_CINCO
grep -q 'Las cinco, antes de crear nada' skills/conductor/SKILL.md && echo CINCO_SKILL || echo NO_CINCO_SKILL
```

- [ ] **Step 2: Correrlas**

Esperado: `CINCO` y `CINCO_SKILL` — hay que cambiar las dos.

- [ ] **Step 3: Cambiar el encabezado y el bloque de comandos en `agents.md`**

Reemplazar:

```markdown
Verificar las cinco **antes** de crear nada. Si una falla, parar y decir cuál:
```

por:

```markdown
Verificar las seis **antes** de crear nada. Si una falla, parar y decir cuál:
```

y agregar al final del bloque de comandos existente:

```bash
free -m                    # memoria disponible
swapon --show              # swap en uso
docker ps -q | wc -l       # containers vivos
```

- [ ] **Step 4: Agregar el mensaje de falla en `agents.md`**

Al final de la lista de mensajes exactos:

```markdown
- **La máquina no da** → "Hay <N> MB disponibles y el swap está al <P>%, con
  <C> containers arriba. Con eso, crear la tanda la tumba. Bajá lo que no estés
  usando y volvemos." Los umbrales: **menos de 4 GB disponibles, o swap por
  encima del 50%**.

  Es la única precondición que mide el estado de la máquina y no la
  configuración, así que es la única que puede pasar hoy y fallar en una hora.
  Se verifica al crear la tanda, no una vez por sesión.
```

- [ ] **Step 5: Agregar la nota sobre el criterio**

Debajo del mensaje anterior:

```markdown
Los umbrales son heurísticos y están elegidos para fallar del lado seguro:
negarse a arrancar de más cuesta un mensaje, y arrancar de más cuesta la sesión
entera del usuario, con el trabajo sin commitear que haya en cada worktree vivo.
```

- [ ] **Step 6: Actualizar el paso 0 de `SKILL.md`**

Reemplazar:

```markdown
Las cinco, antes de crear nada: Orca corriendo, orquestación habilitada,
```

por:

```markdown
Las seis, antes de crear nada: Orca corriendo, orquestación habilitada,
```

y agregar al final de esa enumeración, después de `config de proyecto presentes`:

```markdown
, y **la máquina con margen** (memoria disponible y swap).
```

- [ ] **Step 7: Actualizar la checklist de `SKILL.md`**

Reemplazar:

```markdown
- [ ] Se verificaron las cinco precondiciones antes de crear nada.
```

por:

```markdown
- [ ] Se verificaron las seis precondiciones antes de crear nada, incluida la memoria disponible y el swap.
```

- [ ] **Step 8: Correr el ciclo de test completo**

```bash
grep -c 'las seis' skills/conductor/reference/agents.md skills/conductor/SKILL.md
grep -q 'Verificar las cinco' skills/conductor/reference/agents.md && echo VIEJA_PRESENTE || echo VIEJA_AUSENTE
grep -q 'seis precondiciones' skills/conductor/SKILL.md && echo CHECK_OK || echo CHECK_FALTA
./tools/check-placeholders.sh && ./tools/check-schema-refs.sh && ./tools/check-core-refs.sh
```

Esperado: `VIEJA_AUSENTE`, `CHECK_OK`, validadores en OK.

- [ ] **Step 9: Commit**

```bash
git add skills/conductor/
git commit -m "feat(conductor): sexta precondición — no crear la tanda sobre una máquina que ya pagina"
```

---

### Task 6: La vigilancia del PR y el CI en rojo

Es la tarea que arregla el "dejó de escuchar". Hoy la skill promete escuchar y no tiene con qué.

**Files:**
- Modify: `skills/conductor/SKILL.md` — el paso 5 (línea ~322, *El conductor queda a la escucha*)
- Modify: `skills/conductor/reference/discord.md` — el disparador del anuncio
- Modify: `skills/conductor/reference/agents.md` — sección nueva con el monitor y el manejo del rojo

**Interfaces:**
- Produces: los cuatro estados `GREEN`, `RED`, `SINCHECKS`, `ERROR`, que consumen las Tasks 7 y 9

- [ ] **Step 1: Escribir las aserciones**

```bash
grep -q 'SINCHECKS' skills/conductor/reference/agents.md && echo A_PASA || echo A_FALLA
grep -q 'queda a la escucha' skills/conductor/SKILL.md && echo PROMESA_VIEJA || echo PROMESA_REEMPLAZADA
```

- [ ] **Step 2: Correrlas**

Esperado: `A_FALLA` y `PROMESA_VIEJA`.

- [ ] **Step 3: Agregar la sección del monitor a `agents.md`**

Al final del archivo:

````markdown
## Vigilar el gate de un PR

`check --wait` oye **solo** mensajes de los hijos por Orca. El CI de GitHub no
manda ninguno, y el push del humano tampoco. Por eso "quedar a la escucha" sin
un mecanismo propio termina en un PR verde que nadie anuncia.

Apenas se registra un PR, se arma **un monitor persistente por PR**, que emite
una línea por transición y sigue vivo mientras el conductor hace otra cosa:

```bash
prev=""
while true; do
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

Tres detalles de los que depende que funcione, y que se equivocan solos:

- **El estado sale del JSON, nunca del exit code.** `gh pr checks` sale con 1
  cuando algún check falla y con 8 cuando hay pendientes. Un `|| echo ERROR`
  colapsa el rojo y el pendiente en "error de consulta", y el monitor se queda
  mudo ante la falla que viene a detectar.
- **`length == 0` se evalúa antes que todo.** Sobre una lista vacía `all(...)`
  devuelve verdadero, así que un PR **sin checks corridos** se reportaría verde
  y se anunciaría solo. Es el error que esta skill ya tiene documentado ("falta
  el guarda `length > 0`").
- **El verde se decide por descarte.** Preguntar "¿son todos `pass`?" deja fuera
  a `skipping`, y un PR con los checks salteados se quedaría en `PENDING` para
  siempre: como `PENDING` no emite, nadie se entera. La pregunta correcta es
  "¿queda alguno sin terminar?". `cancel` cuenta como rojo: un check cancelado
  no probó nada.

### Qué se hace con cada estado

| Estado | Acción |
|---|---|
| `GREEN` | Dispara el anuncio de ese ticket, si todos sus PRs están verdes |
| `RED` | Se lee la falla y vuelve **al hijo** con `reply` |
| `SINCHECKS` | No es verde. Se reporta al usuario y se espera |
| `ERROR` | Se reporta y el monitor sigue; si se repite, sube al usuario |

**`RED` — la falla vuelve al hijo, no al usuario:**

```bash
gh run view --repo "$SLUG" --log-failed | tail -60
orca-ide orchestration reply --id <msgId> \
  --body "El CI falló en <job>: <error>. Corregí y avisá cuando esté." --json
```

Mandarle "está en rojo" a secas lo obliga a salir a averiguar lo que el conductor
ya tiene delante. Es el mismo camino que los hallazgos de `code-review`: **lo del
hijo lo arregla el hijo**, y el conductor no edita worktrees ajenos. Si hace falta
volver a probar, el hijo pide turno de QA otra vez.

**`ERROR` no puede matar la vigilancia.** Sin red, sin sesión de `gh` o con el PR
borrado, el monitor reporta y sigue. Un monitor que se muere en silencio es
indistinguible de uno que no tiene nada que decir — que es exactamente el modo de
falla que todo esto viene a corregir.
````

- [ ] **Step 4: Reemplazar la promesa vacía en el paso 5 de `SKILL.md`**

Buscar el párrafo que empieza:

```markdown
**El conductor queda a la escucha.** Cuando un PR se publica, hay que seguir el
```

y reemplazar el párrafo completo por:

```markdown
**El conductor vigila con un mecanismo, no con una promesa.** Apenas se registra
un PR, arma un monitor persistente sobre su gate. Cuando emite `GREEN` y todos
los PRs de ese ticket están verdes, **el anuncio sale ahí**, sin que el usuario
lo pida. Cuando emite `RED`, la falla vuelve al hijo. Ver
[`reference/agents.md`](reference/agents.md#vigilar-el-gate-de-un-pr).

Un ticket que se pone verde y nadie anuncia es un PR esperando a que alguien se
acuerde — y acordarse no es un mecanismo.
```

- [ ] **Step 5: Actualizar el disparador en `discord.md`**

En la sección que describe cuándo sale el mensaje, agregar al principio:

```markdown
**El disparador es el evento `GREEN` del monitor del PR**, no una revisión
manual ni un pedido del usuario. Ver
[`agents.md`](agents.md#vigilar-el-gate-de-un-pr). Cuando el último PR de un
ticket pasa a `GREEN`, sale el mensaje de ese ticket.

`SINCHECKS` **no habilita a anunciar**: un PR sin checks corridos no es un PR
verde.
```

- [ ] **Step 6: Agregar los ítems a la checklist de `SKILL.md`**

```markdown
- [ ] Cada PR registrado quedó con su monitor de gate armado.
- [ ] El anuncio salió disparado por el evento `GREEN`, no porque el usuario lo recordara.
- [ ] Ningún PR en `SINCHECKS` se tomó por verde.
- [ ] Cada `RED` volvió al hijo con la falla leída, no con un "está en rojo".
```

- [ ] **Step 7: Agregar los errores comunes a `SKILL.md`**

```markdown
- **Prometer que se queda a la escucha sin armar el monitor** — `check --wait`
  no oye al CI de GitHub. El PR se pone verde, nadie emite nada, y el usuario
  tiene que venir a avisar que hace días que está listo.
- **Decidir el estado del gate por el exit code de `gh pr checks`** — sale 1 en
  rojo y 8 en pendiente, así que el rojo se pierde justo cuando importa.
- **Mandarle al hijo "el CI está en rojo"** sin el job ni el error — lo obliga a
  ir a buscar lo que el conductor ya tenía leído.
```

- [ ] **Step 8: Correr el ciclo de test completo**

```bash
grep -q 'SINCHECKS' skills/conductor/reference/agents.md && echo A_PASA || echo A_FALLA
grep -q 'SINCHECKS' skills/conductor/reference/discord.md && echo B_PASA || echo B_FALLA
grep -q 'vigila con un mecanismo' skills/conductor/SKILL.md && echo C_PASA || echo C_FALLA
./tools/check-placeholders.sh && ./tools/check-schema-refs.sh && ./tools/check-core-refs.sh
```

Esperado: `A_PASA`, `B_PASA`, `C_PASA`, validadores en OK.

- [ ] **Step 9: Verificar el jq contra los siete casos**

```bash
j='if length == 0 then "SINCHECKS" elif any(.[].bucket; . == "fail" or . == "cancel") then "RED" elif any(.[].bucket; . == "pending") then "PENDING" else "GREEN" end'
for c in '[]' '[{"bucket":"pass"}]' '[{"bucket":"pass"},{"bucket":"fail"}]' \
         '[{"bucket":"pass"},{"bucket":"pending"}]' '[{"bucket":"skipping"}]' \
         '[{"bucket":"pass"},{"bucket":"skipping"}]' '[{"bucket":"cancel"}]'; do
  printf '%-44s -> %s\n' "$c" "$(echo "$c" | jq -r "$j")"
done
```

Esperado, en orden: `SINCHECKS`, `GREEN`, `RED`, `PENDING`, `GREEN`, `GREEN`, `RED`.

- [ ] **Step 10: Commit**

```bash
git add skills/conductor/
git commit -m "feat(conductor): vigilar el gate del PR con un monitor, y devolverle el rojo al hijo"
```

---

### Task 7: Cuándo termina la tanda, y la re-sincronización

**Files:**
- Modify: `skills/conductor/SKILL.md` — sección nueva, checklist y errores comunes

**Interfaces:**
- Consumes: los monitores de la Task 6

- [ ] **Step 1: Escribir la aserción**

```bash
grep -q 'La tanda no termina' skills/conductor/SKILL.md && echo PASA || echo FALLA
```

- [ ] **Step 2: Correrla**

Esperado: `FALLA`.

- [ ] **Step 3: Insertar la sección, después de *El torniquete de QA***

```markdown
## Cuándo termina la tanda

**La tanda no termina cuando los hijos reportan `worker_done`.** Termina cuando
**cada** ticket está anunciado y su worktree limpiado.

Entre una cosa y la otra hay una espera que puede durar días y que **no depende
de ningún hijo**: la publicación de la rama, que la hace el humano a mano. Un
ticket en esa espera es trabajo abierto, no trabajo terminado, y tratarlo como
terminado es lo que hace que un PR verde se quede sin anunciar hasta que el
usuario venga a recordarlo.

### Re-sincronizar al volver

Los monitores viven mientras vive la sesión. Así que **al recibir cualquier
turno del usuario, antes de contestarle**, el conductor:

1. Re-consulta el estado de los PRs de su registro.
2. Re-arma los monitores que falten.
3. Menciona lo que cambió mientras no estaba, si cambió algo.

Sin esto, cerrar la terminal un viernes significa que el lunes nadie anuncia
nada — y el usuario se entera cuando pregunta, que es el síntoma que este bloque
existe para eliminar.
```

- [ ] **Step 4: Agregar los ítems a la checklist**

```markdown
- [ ] La tanda no se dio por cerrada con tickets publicados sin anunciar.
- [ ] Al volver de un silencio, se re-consultó el estado de los PRs antes de contestarle al usuario.
```

- [ ] **Step 5: Agregar el error común**

```markdown
- **Dar la tanda por terminada con el `worker_done` del último hijo** — queda
  afuera justo el tramo que no depende de nadie del equipo: la publicación de la
  rama y el gate. Ahí es donde un ticket se pierde durante días.
```

- [ ] **Step 6: Correr el ciclo de test completo**

```bash
grep -q 'La tanda no termina' skills/conductor/SKILL.md && echo PASA || echo FALLA
grep -q 'Re-sincronizar al volver' skills/conductor/SKILL.md && echo RESYNC_OK || echo RESYNC_FALTA
./tools/check-placeholders.sh && ./tools/check-schema-refs.sh && ./tools/check-core-refs.sh
```

Esperado: `PASA`, `RESYNC_OK`, validadores en OK.

- [ ] **Step 7: Commit**

```bash
git add skills/conductor/SKILL.md
git commit -m "feat(conductor): la tanda termina al anunciar y limpiar, no al worker_done"
```

---

### Task 8: Reconciliar al arrancar (paso 0.5)

La tarea que arregla los tres síntomas del crash: no se entera, lo trabaja él, o duplica el hijo.

**Files:**
- Modify: `skills/conductor/SKILL.md` — paso 0.5 nuevo, la sección *Cada sesión es su propia tanda*, checklist y errores comunes
- Modify: `skills/conductor/reference/agents.md` — sección nueva de reattach/revivir y el spec de retoma

**Interfaces:**
- Consumes: `qaTurn` (Task 4)
- Produces: la tabla de tres salidas que la Task 9 asume al detectar tickets limpiables

- [ ] **Step 1: Escribir las aserciones**

```bash
grep -q 'linkedLinearIssue' skills/conductor/reference/agents.md && echo A_PASA || echo A_FALLA
grep -q 'Reconciliar' skills/conductor/SKILL.md && echo B_PASA || echo B_FALLA
```

- [ ] **Step 2: Correrlas**

Esperado: `A_FALLA` y `B_FALLA`.

- [ ] **Step 3: Agregar la sección de reconciliación a `agents.md`**

Al final del archivo:

````markdown
## Reconciliar una tanda que sobrevivió a la sesión

Si la máquina colapsa o Orca se cierra por error, el registro del conductor
—que vive en su memoria— desaparece. El trabajo no: los worktrees siguen en
disco, con sus ramas y sus commits.

**El registro ya está persistido, y es para esto que la skill exige el nombre
legible al crear:**

```bash
orca-ide worktree list --json   # displayName, linkedLinearIssue, branch, path, linkedPR
orca-ide terminal list --json   # worktreeId, handle, connected, orphaned, lastOutputAt
```

Un worktree con `linkedLinearIssue: "<TICKET-ID>"` y
`displayName: "<TICKET-ID> · <slug-corto>"` **es** la entrada del registro. Lo
que falta lo tienen las fuentes que la skill ya consulta: los PRs salen de
`linkedPR` y de `gh pr list --head <branch>`, y si un ticket ya se anunció lo
dice su `notifiedLabel`.

**El `worktreeId` y el `displayName` sobreviven; el `handle` no** — es routing y
cambia si el pane se reinicia. Después de un crash el handle viejo no sirve y
hay que re-resolverlo por `worktreeId` con `terminal list`. Esa es la razón
concreta por la que el nombre se exige: es la única dirección que aguanta.

### Antes de crear un worktree o un agente, buscar el ticket

Tres salidas, y **ninguna es "crear de nuevo"**:

| Estado | Qué se hace |
|---|---|
| Worktree existe, hijo **vivo** (`connected: true`, `orphaned: false`) | **Reattach.** Re-resolver el handle por `worktreeId` y seguir con `reply`. No se crea nada. |
| Worktree existe, hijo **muerto** (`orphaned: true` o sin terminal) | **Revivir un agente en ese worktree** con `terminal create`. Nunca `worktree create`. |
| No hay worktree para ese ticket | Recién ahí, el flujo normal de *Crear y nombrar un agente*. |

Y la que más cuesta: **que un ticket ya tenga worktree no habilita a trabajarlo
en la sesión del conductor.** Encontrar trabajo a medias no lo convierte en el
hijo; sigue siendo el error más caro de esta skill, y el crash es justo cuando
más tienta cometerlo.

### El spec de retoma no es el spec inicial

Un hijo revivido con el spec original vuelve a empezar de cero y pisa lo que ya
estaba hecho. El de retoma abre pidiéndole que mire dónde quedó:

> Estás retomando un ticket que ya venías trabajando; la sesión anterior se
> cortó. **Antes de tocar nada**, mirá dónde quedaste: tu rama, tus commits sin
> pushear, si ya hay PR abierto, y qué dice el último comentario del ticket.
> Reportá en qué estado está y seguí desde ahí. No rehagas lo que ya está hecho.

Todo lo demás del spec original vale igual, los nueve puntos incluidos.

### Lo que el crash dejó tomado

Un colapso no baja nada limpiamente:

- **Containers arriba de tickets sin hijo vivo** → bajarlos. Es memoria tomada
  por un stack sin dueño, y es parte de por qué la máquina sigue pesada después
  de reabrir.
- **El torniquete queda libre** (`qaTurn: null` en todos). Si el que lo tenía
  murió, nadie lo tiene — y si no se reinicia, el primer hijo que pida turno
  espera para siempre.
````

- [ ] **Step 4: Insertar el paso 0.5 en `SKILL.md`**

Entre *0. Precondiciones* y *1. Detección*:

```markdown
### 0.5. Reconciliar lo que ya existe

**Corre siempre, antes de la detección**, cuente el usuario o no que hubo un
crash. Tres pasos:

1. Listar los worktrees y quedarse con los que tienen `linkedLinearIssue`, o
   `displayName` que matchee `<trackerPrefix>-<n> · `.
2. Cruzarlos con `terminal list` por `worktreeId` para saber cuáles tienen un
   hijo vivo.
3. **Reportar lo encontrado antes de tocar nada.**

Después, por cada ticket: hijo vivo → reattach; hijo muerto → revivir un agente
**en ese worktree**; sin worktree → el flujo normal del paso 3. Ver
[`reference/agents.md`](reference/agents.md#reconciliar-una-tanda-que-sobrevivió-a-la-sesión).

**Que un ticket ya tenga worktree no habilita a trabajarlo acá.** Encontrar
trabajo a medias no convierte al conductor en el hijo.
```

- [ ] **Step 5: Ajustar *Cada sesión es su propia tanda* en `SKILL.md`**

Después del bullet *El contexto se pide, no se asume*, agregar:

```markdown
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
```

- [ ] **Step 6: Agregar los ítems a la checklist de `SKILL.md`**

```markdown
- [ ] Se reconcilió contra Orca antes de crear nada, y se reportó lo encontrado.
- [ ] Ningún ticket con worktree vivo recibió un segundo agente.
- [ ] Ningún ticket con worktree existente se trabajó en la sesión del conductor.
- [ ] Los hijos revividos recibieron el spec de retoma, no el inicial.
- [ ] Los containers de tickets sin hijo vivo se bajaron, y el torniquete quedó libre.
```

- [ ] **Step 7: Agregar los errores comunes a `SKILL.md`**

```markdown
- **Crear un segundo worktree o un segundo agente para un ticket que ya tiene el
  suyo** — duplica agente, stack e imágenes sobre la máquina que acaba de
  colapsar. Es el resultado más caro de no reconciliar.
- **Trabajar el ticket en la sesión del conductor porque "el worktree ya está"**
  — el worktree existente es la razón para retomarlo ahí, no para traérselo.
- **Revivir un hijo con el spec original** — vuelve a empezar de cero y pisa los
  commits que ya tenía.
- **Reconciliar solo cuando el usuario menciona el crash** — es justo lo que no
  va a hacer: para él, el conductor debería haberse enterado solo.
```

- [ ] **Step 8: Correr el ciclo de test completo**

```bash
grep -q 'linkedLinearIssue' skills/conductor/reference/agents.md && echo A_PASA || echo A_FALLA
grep -q 'Reconciliar lo que ya existe' skills/conductor/SKILL.md && echo B_PASA || echo B_FALLA
grep -q 'spec de retoma' skills/conductor/reference/agents.md && echo C_PASA || echo C_FALLA
grep -q 'Una sesión muerta no es una sesión hermana' skills/conductor/SKILL.md && echo D_PASA || echo D_FALLA
./tools/check-placeholders.sh && ./tools/check-schema-refs.sh && ./tools/check-core-refs.sh
```

Esperado: los cuatro en `PASA`, validadores en OK.

- [ ] **Step 9: Verificar que los comandos de reconciliación devuelven lo que el plan asume**

```bash
orca-ide worktree list --json | jq -r '.result.worktrees[] | [.displayName, .linkedLinearIssue, .branch] | @tsv'
orca-ide terminal list --json | jq -r '.result.terminals[] | [.worktreeId, .connected, .orphaned] | @tsv'
```

Esperado: la primera muestra `displayName` con el formato `<ID> · <slug>` y un `linkedLinearIssue` no nulo en los worktrees de ticket; la segunda muestra `connected` y `orphaned` por terminal. Si algún campo no aparece, **parar y reportarlo**: el diseño depende de ellos.

- [ ] **Step 10: Commit**

```bash
git add skills/conductor/
git commit -m "feat(conductor): reconciliar al arrancar en vez de duplicar hijos"
```

---

### Task 9: La limpieza es automática y completa

**Files:**
- Modify: `skills/conductor/reference/cleanup.md` — la sección *Borrar* (líneas ~85-105) y *Lo que no se hace* (línea ~107)
- Modify: `skills/conductor/SKILL.md` — el paso 6 (línea ~340), *Lo que el conductor no hace* (línea ~92), checklist y errores comunes

**Interfaces:**
- Consumes: el estado `GREEN` (Task 6), el registro con `qaTurn` (Task 4)

- [ ] **Step 1: Escribir las aserciones**

```bash
grep -q 'No borrar automáticamente' skills/conductor/reference/cleanup.md && echo VIEJA_CLEANUP || echo LIMPIA_CLEANUP
grep -q 'No borra un worktree sin confirmación' skills/conductor/SKILL.md && echo VIEJA_SKILL || echo LIMPIA_SKILL
grep -q 'Limpieza — confirma' skills/conductor/SKILL.md && echo VIEJO_TITULO || echo TITULO_NUEVO
grep -q 'docker image rm\|docker volume rm' skills/conductor/reference/cleanup.md && echo IMG_PASA || echo IMG_FALLA
```

- [ ] **Step 2: Correrlas**

Esperado: `VIEJA_CLEANUP`, `VIEJA_SKILL`, `VIEJO_TITULO`, `IMG_FALLA`.

- [ ] **Step 3: Reemplazar la sección *Borrar* de `cleanup.md`**

Reemplazar desde `## Borrar` hasta antes de `## Lo que no se hace` por:

````markdown
## Borrar — automático

**Las tres verificaciones siguen siendo condición obligatoria.** Lo que se
elimina es el turno de espera, no el control: el OK del usuario nunca fue lo que
hacía segura la limpieza. Lo que la hace segura es que el trabajo ya está en el
remoto, y eso lo prueban las tres verificaciones, no una confirmación.

Con las tres en verde, se borra y se reporta. Y se borra **todo lo del ticket**,
no solo el worktree:

```bash
# 1. El worktree
orca-ide worktree rm --worktree id:<worktreeId> --force --json

# 2. Las imágenes que ese ticket construyó — el grueso de lo que se recupera
docker image ls --format '{{.Repository}}:{{.Tag}}' \
  | grep -F "<slug-del-worktree>" \
  | xargs -r docker image rm

# 3. Los volúmenes de su stack, que `compose down` no toca sin -v
docker volume ls --format '{{.Name}}' \
  | grep -F "<slug-del-worktree>" \
  | xargs -r docker volume rm
```

Y sacar el ticket del registro de la sesión.

**Por qué las imágenes y no solo el worktree.** El worktree son unos cientos de
MB de código; el par de imágenes que ese mismo ticket construyó pesa entre 5 y
6,5 GB. Una limpieza que borra el worktree y deja las imágenes recupera el 5% y
deja el 95% acumulándose ticket a ticket.

**El filtro se ancla al slug del worktree, que es único por ticket. Nunca un
`prune` global:** eso alcanzaría imágenes de tickets vivos y de otras sesiones,
que es exactamente lo que la skill prohíbe cuando dice que no se toca lo que no
es de uno. Solo sobreviven las imágenes de los tickets que se están trabajando.

Se reporta después, en una línea:

> **TCK-262 · slug-corto** limpiado: worktree, 2 imágenes (6,1 GB) y 1 volumen.
````

- [ ] **Step 4: Corregir *Lo que no se hace* en `cleanup.md`**

Reemplazar el bullet:

```markdown
- **No borrar automáticamente**, ni aunque las tres verificaciones pasen.
```

por:

```markdown
- **No borrar con alguna verificación en rojo**, ni aunque el ticket esté
  anunciado. Ahí se reporta qué quedó y dónde, con la ruta, y no se borra nada.
- **No borrar con un `prune` global.** El filtro va anclado al slug del ticket.
```

- [ ] **Step 5: Actualizar el paso 6 de `SKILL.md`**

Reemplazar el título y el cuerpo:

```markdown
### 6. Limpieza — confirma
```

por:

```markdown
### 6. Limpieza — automática
```

y reemplazar:

```markdown
las tres verificaciones (en el wrapper y en cada submódulo), mostrar qué se va a
borrar con el nombre del agente, esperar OK, bajar el container, liberar los
puertos y borrar.
```

por:

```markdown
las tres verificaciones (en el wrapper y en cada submódulo), y con las tres en
verde borrar el worktree, las imágenes que ese ticket construyó y los volúmenes
de su stack — y reportarlo.
```

- [ ] **Step 6: Corregir *Lo que el conductor no hace* en `SKILL.md`**

Reemplazar:

```markdown
- **No borra un worktree sin confirmación**, ni con cambios sin commitear o
  commits sin pushear.
```

por:

```markdown
- **No borra un worktree con cambios sin commitear o commits sin pushear**, ni
  con un `prune` global de Docker. Las tres verificaciones son la condición; la
  confirmación del usuario, no.
```

- [ ] **Step 6b: Corregir la contradicción del paso 1 de `SKILL.md`**

En la sección *1. Detección*, hay una frase que dice lo contrario de esta tarea.
Buscar:

```markdown
Fuera de esos tres casos, crear y reportar. El resto de los controles no se
mueve: los cinco gates se relevean igual, y la limpieza del paso 6 sigue
pidiendo OK — ahí sí se borra trabajo.
```

y reemplazar por:

```markdown
Fuera de esos tres casos, crear y reportar. El resto de los controles no se
mueve: los cinco gates se relevean igual, y la limpieza del paso 6 sigue
exigiendo sus tres verificaciones antes de borrar nada.
```

**Es la razón por la que esta tarea tiene aserciones `grep`.** Una regla que se
cambia en `cleanup.md` y en el paso 6 puede quedar viva en un tercer lugar que
nadie estaba mirando, y un agente que lee primero la frase vieja se queda
esperando un OK que ya nadie le va a pedir.

- [ ] **Step 7: Agregar los ítems a la checklist de `SKILL.md`**

```markdown
- [ ] Cada ticket anunciado se limpió solo, sin esperar un OK.
- [ ] La limpieza borró también las imágenes y los volúmenes del ticket, no solo el worktree.
- [ ] El filtro de imágenes se ancló al slug del ticket; no se corrió ningún `prune` global.
```

Y reemplazar el ítem existente:

```markdown
- [ ] No se relevaron gates, ni se anunció, ni se borraron worktrees de agentes que esta sesión no despachó.
```

por:

```markdown
- [ ] No se relevaron gates, ni se anunció, ni se borraron worktrees de agentes vivos que esta sesión no despachó ni adoptó.
```

- [ ] **Step 8: Agregar los errores comunes a `SKILL.md`**

```markdown
- **Borrar el worktree y dejar sus imágenes** — recupera el 5% de lo que ese
  ticket ocupa. Las imágenes son 5-6,5 GB por ticket y no las reclama nadie.
- **Limpiar con `docker image prune` o `system prune`** — alcanza tickets vivos
  y de otras sesiones. El filtro va anclado al slug.
```

- [ ] **Step 9: Correr el ciclo de test completo**

```bash
grep -q 'No borrar automáticamente' skills/conductor/reference/cleanup.md && echo VIEJA_CLEANUP || echo LIMPIA_CLEANUP
grep -q 'No borra un worktree sin confirmación' skills/conductor/SKILL.md && echo VIEJA_SKILL || echo LIMPIA_SKILL
grep -q 'Limpieza — automática' skills/conductor/SKILL.md && echo TITULO_NUEVO || echo VIEJO_TITULO
grep -q 'docker image rm' skills/conductor/reference/cleanup.md && echo IMG_PASA || echo IMG_FALLA
grep -rn 'esperar OK' skills/conductor/reference/cleanup.md || echo "sin OK residual"
./tools/check-placeholders.sh && ./tools/check-schema-refs.sh && ./tools/check-core-refs.sh
```

Esperado: `LIMPIA_CLEANUP`, `LIMPIA_SKILL`, `TITULO_NUEVO`, `IMG_PASA`, `sin OK residual`, validadores en OK.

- [ ] **Step 10: Verificación cruzada final de todo el plan**

```bash
# Ninguna skill puede contradecir a otra sobre estos cuatro puntos
echo "== confirmación para borrar (no debe quedar ninguna) =="
# El patrón es ancho a propósito: la misma regla estaba escrita de tres
# formas distintas en tres archivos, y un filtro angosto deja viva la tercera.
grep -rn 'esperar OK\|esperaba OK\|¿Confirmás?\|sin confirmación\|pidiendo OK\|Con OK:\|Sin OK' \
  skills/conductor/SKILL.md skills/conductor/reference/cleanup.md || echo "OK: ninguna"
echo "== 'cinco precondiciones' residual =="
grep -rn 'cinco precondiciones\|Verificar las cinco\|Las cinco, antes' skills/conductor/ || echo "OK: ninguna"
echo "== 'nietos' residual =="
grep -rn 'no crea nietos' skills/ || echo "OK: ninguna"
echo "== 'ocho cosas' residual =="
grep -rn 'ocho cosas' skills/conductor/ || echo "OK: ninguna"
echo "== suite del repo =="
for t in tools/tests/test-*.sh; do bash "$t" >/dev/null 2>&1 || echo "FALLÓ: $t"; done; echo "suite terminada"
```

Esperado: los cuatro `OK: ninguna` y la suite sin fallas.

- [ ] **Step 11: Commit**

```bash
git add skills/conductor/
git commit -m "feat(conductor): la limpieza es automática y borra las imágenes del ticket"
```

---

## Cobertura del spec

| Sección del spec | Task |
|---|---|
| 1. El stack nace y muere dentro del paso 8 | 2 |
| 2. El torniquete | 4 |
| 3. La prohibición de delegar | 3 (skill del hijo) y 4 (punto 9 del `--spec`) |
| 4. Sexta precondición: recursos | 5 |
| 5. `qa.stopCommand` | 1 |
| 6. La vigilancia del PR | 6 |
| 7. CI en rojo → vuelve al hijo | 6 |
| 8. Cuándo termina la tanda | 7 |
| 9. La limpieza es automática y completa | 9 |
| 10. Recuperación después de un crash | 8 |

## Lo que este plan no hace

- **No toca la VM de Docker Desktop ni `permit-pdp`.** Son 12,2 GB y ~80% de un
  core por ticket, y son configuración de la máquina y del stack de trabajo, no
  de este repo. Están registrados en el spec para que la próxima medición no los
  redescubra.
- **No limpia los ~68 GB ya acumulados** de tickets cerrados antes de que esto
  existiera. La Task 9 evita que se sigan acumulando; lo viejo no lo reclama
  ninguna skill.
- **No hace sobrevivir los monitores a la muerte de la sesión.** La
  re-sincronización de la Task 7 los recupera cuando el usuario vuelve a
  escribir, pero entre el cierre y ese mensaje no hay nadie mirando. Un conductor
  que sobreviva a la sesión exige cron y estado en disco: rediseño mayor, fuera
  de alcance.
