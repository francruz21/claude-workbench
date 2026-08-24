# Ejemplo de flujo completo — `ticket-workflow`

## Escenario

Workspace `~/proyectos/acme/` con dos repos git: `acme/frontend` y
`acme/backend`. Primera vez que se usa la skill en `frontend`. El usuario pega:

```
https://linear.app/acme/issue/EX-107/ERROR-FRONT-MODAL-COLOR
```

## Turno 1 — onboarding (primera vez en este repo)

> **Claude:** No encuentro `.claude/workbench.project.json` en este repo,
> así que antes de arrancar necesito configurar algunas cosas (solo se
> pregunta una vez).
>
> ¿Cuál es el prefijo de este workspace en el tracker? Por el link parece ser `EX`, ¿confirmás?

> **Usuario:** sí, EX

> **Claude:** ¿Qué tipos de rama usás en este repo? Te sugiero por defecto
> `feature, fix, bug, hotfix, chore, refactor` — ¿los dejamos así o ajustamos?

> **Usuario:** dejalos así

> **Claude:** ¿La descripción de la rama y de los commits va en español o en inglés?

> **Usuario:** español

> **Claude:** No encontré una convención de commits definida en este repo
> (ni `CONTRIBUTING.md` ni reglas propias). ¿Qué convención querés usar?

> **Usuario:** Conventional Commits

> **Claude:** ¿Desde qué rama remota partimos las ramas de trabajo, como default
> para cuando el ticket no traiga tag de ambiente? (sugerido: `dev`)

> **Usuario:** dev, sí

> **Claude:** Vi que el tracker tiene un grupo de labels `Ambiente` con `dev`,
> `stage`, `prod`, `draft` y `design`, y labels de tipo `Bug`, `Feature` e
> `Improvement`. Propongo: `dev`/`stage` mapean a esas ramas, `prod` a `main`,
> y `draft`/`design` significan "preguntar". `Bug` → `fix`, `Feature` → `feat`,
> `Improvement` lo pregunto cada vez. ¿Va así?

> **Usuario:** va

> **Claude:** Para poder probar los cambios en el navegador antes de commitear:
> vi en el `package.json` que la app se levanta con `pnpm dev` en
> `http://localhost:3000`. ¿Es así?

> **Usuario:** sí

> **Claude:** Última: ¿quiénes pueden ser reviewers de las PRs de este repo, y
> cuál es el default? Los colaboradores con permiso de push son `ana-dev`,
> `luis-dev` y `sofia-dev`.

> **Usuario:** default ana-dev, y los otros dos como alternativa

Claude guarda `.claude/workbench.project.json` con esos valores.

## Turno 2 — lectura del ticket y análisis del workspace

> **Claude:** Leí el ticket EX-107 vía Linear: "Error de color en modal —
> el modal de confirmación muestra el botón principal en gris en vez del
> color de marca."
>
> Labels: `stage` (grupo Ambiente) → la rama sale de `stage`, no del `dev` del
> config. `Bug` → propongo tipo `fix`. `Core` es de módulo, no decide nada.
>
> Por el contenido esto aplica solo a `frontend`, no hace falta tocar
> `backend`. ¿Confirmás?

> **Usuario:** sí, dale

## Turno 3 — tipo de rama (gate 1)

El label `Bug` mapea a `fix` en el `typeLabelMap`, así que la pregunta llega
armada — pero se pregunta igual.

> **Claude:** El ticket tiene label `Bug`, así que va como `fix`. ¿Confirmás?

> **Usuario:** sí

Si el ticket no hubiera tenido label de tipo, la pregunta habría sido abierta:
"¿Qué tipo de rama es este ticket: feat, fix, hotfix, chore, docs o refactor?".
Y si hubiera tenido `Improvement`, que es ambiguo: "El ticket es un
`Improvement`; por el cambio yo iría con `refactor`, pero puede ser `feat` o
`chore`. ¿Cuál preferís?".

## Turno 4 — rama y estado

Claude actualiza `stage` desde el remoto y crea el worktree en Orca:

```
orca-ide worktree create --repo id:<repoId> --name fix/EX-107-solucion-error-color-modal \
  --base-branch stage --json
orca-ide worktree set --worktree active --workspace-status in-progress --json
```

Y mueve el ticket EX-107 a `In Progress` en Linear, sin preguntar.

> **Claude:** Rama `fix/EX-107-solucion-error-color-modal` creada desde `stage`,
> visible en Orca. Ticket movido a In Progress. Voy a mirar el componente antes
> de tocar nada.

## Turno 5 — el cráneo (gate 2)

Claude lee el componente, reproduce el bug en local, y recién entonces habla.
Todavía no escribió una línea.

> **Claude:** Antes de tocar nada, cómo lo veo:
>
> **Qué pasa:** `ConfirmModal.tsx` renderiza el botón con la clase base de
> `Button` y no le pasa la variante `primary`, así que hereda el gris por
> defecto del componente en vez de `--color-primary`. No es un problema del
> token de color: el token está bien, no se está aplicando.
>
> **Dónde:** `src/components/ConfirmModal.tsx`, una línea. No hace falta tocar
> `Button` — si lo tocara, afectaría los otros 14 usos.
>
> **Cómo:** pasarle `variant="primary"` al botón de confirmación, que es lo que
> hacen los otros modales del proyecto.
>
> **Casos de prueba del QA:** (1) el modal muestra el botón en el color de
> marca, (2) el hover mantiene el color y no vuelve al gris.
>
> ¿Vamos así?

> **Usuario:** sí, dale

Recién ahora implementa: le pasa `variant="primary"` al botón. No saca ninguna
captura todavía — esas salen del QA, sobre el resultado terminado.

## Turno 6 — QA manual en el navegador (gate 3)

Claude levanta `pnpm dev` en background, espera que el puerto responda, y abre
el navegador embebido de Orca en `http://localhost:3000`. Se loguea con el
usuario de los seeds del repo, navega hasta la pantalla del modal, lo abre, y
captura. Después prueba el hover y captura de nuevo.

> **Claude:** QA en `http://localhost:3000`, logueado como `admin@acme.test`
> (seed del repo):
>
> - Caso 1 — el modal de confirmación muestra el botón principal en el color de
>   marca ✅ (`caso-1-modal-boton-color-marca.png`)
> - Caso 2 — el hover mantiene el color de marca, sin volver al gris ✅
>   (`caso-2-modal-boton-hover.png`)
>
> La consola no tiró errores. ¿Te sirve así o querés que pruebe algo más antes
> de commitear?

> **Usuario:** dale, está bien

## Turno 7 — sync con la base y commit (gate 4)

Con el OK dado, Claude revisa si la rama quedó atrasada:

```
git fetch origin
git log --oneline HEAD..origin/stage
```

Hay dos commits nuevos en `stage`, así que los trae con merge dentro de la rama
de trabajo (no rebase, no al revés) y verifica que no toquen el modal.

> **Claude:** `stage` tenía 2 commits nuevos, los mergeé dentro de la rama sin
> conflictos y no tocan el modal, así que el QA sigue válido.
>
> Propongo este commit:
> `fix: soluciona error de color en boton principal del modal (EX-107)`
> ¿Confirmás?

> **Usuario:** sí

## Turno 8 — push y comentario en el ticket (gate 4)

> **Claude:** ¿Publico la rama `fix/EX-107-solucion-error-color-modal` al remoto?

> **Usuario:** dale

Claude pushea con `git push -u origin fix/EX-107-solucion-error-color-modal`
(nunca contra `stage`) y, automáticamente, publica el comentario en EX-107. Sube
las dos capturas de una en una y embebe cada `assetUrl` inline:

> **Comentario publicado en EX-107 (Linear):**
>
> El botón principal del modal de confirmación ya se ve con el color de marca
> en vez del gris, tanto en su estado normal como en hover.
>
> Probado en local con los dos casos que se ven abajo. Se corrigió el override
> de estilos en `ConfirmModal.tsx`.
>
> Rama: `fix/EX-107-solucion-error-color-modal` (sale de `stage`).
>
> ![Caso 1: el modal muestra el botón en el color de marca](https://uploads.linear.app/.../caso-1.png)
>
> ![Caso 2: el hover mantiene el color de marca](https://uploads.linear.app/.../caso-2.png)

Seis líneas, arranca por el impacto para el usuario, una sola línea técnica, y
las capturas se ven inline en vez de quedar como adjuntos al pie.

## Turno 9 — PR y revisión (gate 5)

> **Claude:** ¿Abro la Pull Request de `fix/EX-107-solucion-error-color-modal`
> contra `stage`, con `ana-dev` como reviewer?

> **Usuario:** sí

Claude crea la PR con `--base stage` explícito (nunca `main`, aunque sea la
rama default del repo en GitHub) y `--reviewer ana-dev`, usando
`templates/pull-request.md` con la descripción técnica completa y las mismas
capturas del QA. Después:

```
orca-ide worktree set --worktree active --workspace-status in-review --json
```

y mueve EX-107 a `In Review` en Linear. El assignee del ticket sigue siendo
quien lo trabajó — el reviewer se asignó solo en la PR.

## Segunda vez (ticket EX-114, mismo repo)

El usuario pega el link de EX-114. Como el config ya existe, Claude **no**
repite el onboarding — pasa directo a leer el ticket (labels y casos de prueba),
analizar a qué repo(s) aplica, y preguntar el tipo de rama. Los cinco gates
siguen intactos: tipo de rama, cráneo, QA, commit/push y PR. Tener el config no
ahorra ninguno de esos: ahorra el onboarding.
