# Best Practices: uso de Claude Code

## Skills personales vs skills de proyecto

Las skills de este repositorio (instaladas vía `install.sh` en
`~/.claude/skills/`) son personales — están disponibles en cualquier
proyecto. Si un proyecto necesita una skill específica de ese repo (que no
tiene sentido reutilizar en otro lado), va en `.claude/skills/` dentro de ese
mismo repo, no acá.

## `CLAUDE.md` de proyecto vs `CLAUDE.md` global

- El `CLAUDE.md` global (`~/.claude/CLAUDE.md`) es para preferencias que
  aplican a todo lo que hacés, independientemente del repo — como la
  referencia a este repositorio.
- El `CLAUDE.md` de cada proyecto es para convenciones específicas de ese
  repo (arquitectura, cómo correr tests, convenciones propias) — y siempre
  tiene prioridad sobre lo genérico.

## Confirmaciones explícitas para acciones irreversibles o visibles

Cualquier acción que sea difícil de revertir (push, force-push, borrar rama)
o visible para terceros (abrir PR, comentar un ticket, publicar algo) debe
confirmarse explícitamente en el turno actual — una aprobación de un paso
anterior no cubre el siguiente. Esto está encodeado como restricción dura en
`rules/git-conventions.md` y en la skill `ticket-workflow`, pero aplica como
principio general a cualquier otra skill nueva que se agregue acá.

## Preguntas de a una por vez

Cuando una skill o proceso necesita varias respuestas del usuario (como el
onboarding de `ticket-workflow`), preguntar de a una, no todas juntas en un
solo mensaje — reduce el error de que una respuesta quede mal interpretada
por estar mezclada con otras.

## Mantené este repositorio chico y curado

Es tentador volcar cualquier nota suelta como una "skill". Antes de agregar
contenido nuevo, preguntate: ¿esto es un patrón que se va a repetir en más de
un proyecto? Si la respuesta es no, probablemente no pertenece acá — pertenece
al `CLAUDE.md` del proyecto específico.
