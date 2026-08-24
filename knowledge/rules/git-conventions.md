# Git Conventions

## Comportamiento esperado

- Toda rama de trabajo se crea a partir de la rama base configurada para ese
  repo (por defecto `dev`; ver el campo `baseBranch` de la capa `project` en
  [`core/config-schema.md`](../../core/config-schema.md)),
  actualizada desde el remoto antes de branchear.
- El nombre de rama sigue el patrón `{type}/{ticketId}-{descripción-corta-en-kebab-case}`,
  ej. `fix/EX-107-solucion-error-color-modal`. El `type` es siempre uno de los
  configurados para ese repo (`feature`, `fix`, `bug`, `hotfix`, `chore`,
  `refactor`, u otro que el repo defina).
- Cada rama tiene un propósito único y acotado — evitar ramas que acumulan
  varios tickets no relacionados.
- Antes de commitear en una rama de trabajo, verificar que esté al día con su
  rama base. Si no lo está, traer la base **con merge dentro de la rama de
  trabajo** (`git merge origin/<base>`), nunca con rebase — la rama puede estar
  ya publicada, y rebasear historia publicada obliga a force-push sobre algo
  que otro pudo haber leído.
- La PR de una rama de trabajo apunta **a la rama de la que nació** (`dev`,
  `stage`, o la que indicara el ticket). `main` no es destino de una PR de
  ticket.

## Prioridades

1. La convención de ramas propia del repo de trabajo (si existe, ej. en su
   `CONTRIBUTING.md`) gana sobre lo que sugiere esta rule.
2. Si no hay convención propia, se usa el patrón de arriba, configurado una
   sola vez por repo (ver `ticket-workflow`).

## Restricciones

- **Nunca** commitear directo contra la rama base (`dev`, `main`, u otra
  configurada) de ningún repo. Todo commit va contra una rama de trabajo.
- **Nunca** pushear sin confirmación explícita del usuario en el turno actual
  — una confirmación de un push anterior no cubre el siguiente.
- **Nunca** hacer force-push a una rama compartida, ni reescribir historia ya
  publicada, sin pedido explícito del usuario.
- **Nunca** borrar ramas remotas sin confirmación explícita.
- **Nunca** mergear una rama de trabajo dentro de `dev`/`stage` localmente para
  "sincronizar" — eso se integra por PR.
- **Nunca** dejar que `gh pr create` elija la base por defecto: pasar `--base`
  explícito con la rama de nacimiento, o la PR termina apuntando a `main`.

## Ejemplos

✅ Correcto:
```
git fetch origin
git checkout dev
git pull origin dev
git checkout -b fix/EX-107-solucion-error-color-modal
```

❌ Incorrecto: crear la rama desde el estado local de `dev` sin actualizarlo
primero (puede quedar desactualizada respecto al remoto).

❌ Incorrecto: `git push origin dev` directo, sin pasar por una PR — incluso
si el cambio es "chiquito".

✅ Correcto, antes de commitear en una rama que quedó atrasada:
```
git fetch origin
git merge origin/stage      # la base de la que nació la rama
```

❌ Incorrecto: `git rebase origin/stage` sobre una rama ya publicada, o
`git checkout stage && git merge fix/EX-107-...` para "sincronizar" al revés.
