# Commit Conventions

## Comportamiento esperado

Por defecto, en ausencia de una convención propia del repo, se usa
[Conventional Commits](https://www.conventionalcommits.org/):

```
<tipo>[ámbito opcional]: <descripción>

[cuerpo opcional]

[footer opcional, ej. referencia a ticket]
```

Tipos más usados: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.

Cuando el commit resuelve un ticket, referenciarlo en el mensaje o en el
footer, ej.: `fix: soluciona error de color en modal (EX-107)`.

## Prioridades

1. Si el repo de trabajo ya define su propia convención (Conventional
   Commits, Jira Smart Commits, formato libre documentado en su
   `CONTRIBUTING.md`), esa gana siempre.
2. Si es la primera vez que se trabaja en ese repo y no hay convención
   documentada, **preguntar explícitamente al usuario** qué convención
   quiere usar (no asumir Conventional Commits en silencio) — ver
   [`skills/ticket-workflow/SKILL.md`](../../skills/ticket-workflow/SKILL.md#1-onboarding-solo-la-primera-vez-por-repo).
   Guardar la respuesta en el config del repo para no volver a preguntar.

## Restricciones

- El mensaje de commit se propone y se muestra al usuario **antes** de
  ejecutar `git commit` — nunca se commitea en silencio.
- El mensaje debe explicar la causa/motivo del cambio, no solo repetir el
  nombre del archivo tocado.
- No mezclar en un mismo commit cambios de propósitos distintos (ej. un fix y
  un refactor no relacionado).

## Ejemplos

✅ `fix: corrige condición de carrera en hidratación del carrito (EX-203)`

✅ `feat: agrega exportación de pedidos a CSV`

❌ `update stuff` — no dice qué ni por qué.

❌ `fix: arregla bug y aprovecho para reordenar imports` — dos propósitos en
un commit.
