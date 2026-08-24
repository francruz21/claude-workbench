# Limpieza — cerrar al publicar y anunciar

Detalle operativo de la fase 6. El principio que ordena todo este archivo: **el
riesgo no es simétrico.** Un worktree de más no cuesta nada; un worktree borrado
de menos cuesta el trabajo que tenía adentro.

## Detectar

Por cada PR del ticket, según el registro de la sesión:

```bash
gh pr view <n> --repo "$SLUG" --json state,mergedAt,reviewDecision
```

Un ticket está listo para limpiar cuando **todos** sus PRs están publicados y su
mensaje de anuncio ya salió. **No se espera el merge.**

El review puede tardar horas o días, y mientras tanto se sigue trabajando: un
worktree vivo por cada ticket en revisión bloquea el ambiente local — puertos
tomados, containers arriba, stacks que se pisan. Como la rama ya está en el
remoto, el trabajo no vive en el worktree: está publicado. El worktree pasa a ser
descartable.

Eso corre el peso a las verificaciones de abajo. Con el gate de merge las tres
eran cinturón y tirantes; sin él, **`git log @{u}..HEAD` vacío es la condición
que sostiene todo**: es lo único que garantiza que no queda un commit local sin
subir. Si esa falla y se borra igual, se pierde trabajo de verdad.

`reviewDecision` se **reporta pero no es condición**: el disparador es el
anuncio, no el approve.

Un PR `CLOSED` sin `mergedAt` **no** habilita la limpieza: el trabajo se
descartó, y puede que el usuario quiera recuperar algo de esa rama.

## Verificaciones antes de borrar

Las tres, y **todas** tienen que pasar:

```bash
git -C <worktreePath> status --porcelain                  # vacío
git -C <worktreePath> log @{u}..HEAD --oneline            # vacío: nada sin pushear
BRANCH=$(git -C <worktreePath> branch --show-current)
git -C <worktreePath> stash list | grep -F "$BRANCH"      # vacío
```

**El `grep` del stash no es un detalle.** Los stashes son **globales del repo**,
no del worktree: `git stash list` en un worktree muestra también los stashes
creados en `main`, en `dev` o en cualquier otro worktree del mismo repo.
Verificado en un worktree real, donde `stash list` devolvió
`On main: ...` y `WIP on dev: ...` — ninguno de los dos de ese ticket. Sin
filtrar por la rama del worktree, el chequeo da falso positivo y ese worktree no
se puede borrar nunca.

Y **lo mismo en cada submódulo que el ticket tocó** — el wrapper puede estar
limpio con un submódulo sucio adentro, que es el caso más probable de todos
porque el trabajo real pasa en los submódulos:

```bash
git -C <worktreePath> submodule foreach --quiet \
  'echo "== $name"; git status --porcelain; \
   git log @{u}..HEAD --oneline 2>/dev/null; \
   git stash list | grep -F "$(git branch --show-current)"'
```

Casos borde:

- **`@{u}` falla con "no upstream configured"** → la rama nunca se pusheó. Eso
  es **trabajo sin publicar**, no un error del chequeo: no borrar.
- **La rama remota se borró después del merge** (squash + delete branch) →
  `@{u}` también falla. Distinguirlo del caso anterior mirando si el PR está
  mergeado: si lo está y el remoto ya no tiene la rama, no hay nada sin
  publicar.
- **Submódulo en detached HEAD** → tratarlo como sucio y no borrar; que el
  usuario decida. `branch --show-current` devuelve vacío ahí, así que el filtro
  del stash no aplica y hay que mirarlo a mano.
- **El wrapper con el puntero del submódulo movido** (` M repo-front` en el
  `status --porcelain` del wrapper) cuenta como sucio: es un cambio real sin
  commitear, aunque el submódulo por dentro esté limpio.

Si alguna verificación no pasa: **no borrar**, y decir exactamente qué quedó y
dónde, con la ruta.

## Borrar

Mostrar qué se va a borrar, con el nombre del agente, y esperar OK:

> **TCK-262 · slug-corto** está publicado y anunciado (PR #25 y #61). El
> worktree está limpio, sin cambios sin commitear ni commits sin pushear, en el
> wrapper y en los dos submódulos. Voy a bajar el container, liberar los puertos,
> cerrar el agente y borrar `~/orca/workspaces/<proyecto>/tck-262-.../`.
> ¿Confirmás?

Con OK:

```bash
orca-ide worktree rm --worktree id:<worktreeId> --force --json
```

Y sacar el ticket del registro de la sesión.

Sin OK, o si el usuario no contesta: **no tocar nada.** El silencio no es un sí.

## Lo que no se hace

- **No borrar automáticamente**, ni aunque las tres verificaciones pasen.
- **No mergear ni aprobar** para llegar al estado de limpiable. El conductor
  detecta que el PR se publicó y se anunció; no provoca ninguno de los dos.
- **No borrar la rama remota.** Eso lo maneja GitHub según la config del repo, o
  el usuario.
- **No borrar un worktree cuyo agente todavía está trabajando**, aunque el PR ya
  se haya anunciado: primero se confirma que el agente terminó
  (`worker_done` recibido, o su terminal ya no aparece en `terminal list`).

## Volver a trabajar el ticket

Cerrar al anunciar significa que el review llega cuando el worktree ya no está.
Eso es esperado, no un problema: la rama vive en el remoto, así que se recrea.

```bash
orca-ide worktree create --repo id:<wrapperRepoId> --name <slug> \
  --base-branch <rama-de-trabajo-publicada> --agent claude --json
```

La rama de trabajo ya existe en el remoto, así que se usa como base y no hay que
cortar nada nuevo. Los cambios del review se commitean y pushean sobre ella, y la
PR abierta los recoge sola.

Si el ticket vuelve a la cola, **el anuncio no se repite**: la label de
`notifiedLabel` sigue puesta y es lo que evita anunciar dos veces el mismo
ticket.

## Efecto colateral conocido

Al borrar el worktree, el registro del submódulo en Orca queda huérfano: no hay
`orca repo remove` para limpiarlo. Se acumula un registro por submódulo por
ticket cerrado. No rompe nada — el `repo add` de la fase 5 es idempotente y
vuelve a apuntar bien la próxima vez — pero la lista de repos de Orca crece y hay
que saber por qué.
