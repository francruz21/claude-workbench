# Limpieza — detectar merged y borrar

Detalle operativo de la fase 6. El principio que ordena todo este archivo: **el
riesgo no es simétrico.** Un worktree de más no cuesta nada; un worktree borrado
de menos cuesta el trabajo que tenía adentro.

## Detectar

Por cada PR del ticket, según el registro de la sesión:

```bash
gh pr view <n> --repo "$SLUG" --json state,mergedAt,reviewDecision
```

Un ticket está listo para limpiar cuando **todos** sus PRs tienen
`state == "MERGED"`.

`reviewDecision == "APPROVED"` se **reporta pero no es condición**: un PR puede
mergearse por admin sin review formal, y lo que importa para poder borrar el
worktree es que el código ya está en la rama base. Si el usuario quiere que
además exija el approve, es una condición más en este mismo chequeo.

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

> **TCK-262 · slug-corto** está mergeado (PR #25 y #61). El worktree
> está limpio, sin cambios sin commitear ni commits sin pushear, en el wrapper y
> en los dos submódulos. Voy a cerrar el agente y borrar
> `~/orca/workspaces/<proyecto>/tck-262-.../`. ¿Confirmás?

Con OK:

```bash
orca-ide worktree rm --worktree id:<worktreeId> --force --json
```

Y sacar el ticket del registro de la sesión.

Sin OK, o si el usuario no contesta: **no tocar nada.** El silencio no es un sí.

## Lo que no se hace

- **No borrar automáticamente**, ni aunque las tres verificaciones pasen.
- **No mergear ni aprobar** para llegar al estado de "mergeado". El conductor
  detecta que pasó; no lo provoca.
- **No borrar la rama remota.** Eso lo maneja GitHub según la config del repo, o
  el usuario.
- **No borrar un worktree cuyo agente todavía está trabajando**, aunque los PRs
  estén mergeados: primero se confirma que el agente terminó
  (`worker_done` recibido, o su terminal ya no aparece en `terminal list`).
