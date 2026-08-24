# Rules

Las rules definen comportamiento esperado y restricciones que aplican de
forma transversal — no son un proceso paso a paso (eso son los
[playbooks](../playbooks/)), son las reglas de fondo que rigen cómo se hace
cualquier proceso.

## Índice

- [`git-conventions.md`](git-conventions.md) — ramas, remotos, qué nunca se toca directo.
- [`commit-conventions.md`](commit-conventions.md) — Conventional Commits y su relación con tickets.
- [`testing-conventions.md`](testing-conventions.md) — qué se testea y con qué prioridad.
- [`code-review-guidelines.md`](code-review-guidelines.md) — cómo se prioriza y comunica una revisión.

## Prioridades

Cuando una rule de acá choca con algo definido en el repo de trabajo (su
propio `CLAUDE.md`, su propio `CONTRIBUTING.md`, sus propias reglas), **gana
el repo de trabajo**. Estas rules son el comportamiento por defecto cuando el
repo de trabajo no dice nada distinto — no un reemplazo del criterio de cada
proyecto ni de su equipo.

Dentro de las rules de este repo, si dos parecen chocar entre sí, la más
específica al contexto actual gana (ej. una restricción explícita de
`git-conventions.md` sobre "nunca push a la rama base" gana sobre cualquier
sugerencia genérica de otra rule).

## Cómo se usan

No se "invocan" como una skill — son contexto que Claude debe tener presente
todo el tiempo que esté trabajando en un repo, una vez que este repositorio
está referenciado desde `~/.claude/CLAUDE.md` (ver [instalación](../../README.md#instalación)).
