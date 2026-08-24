# Playbooks

Los playbooks documentan procesos punta a punta en prosa. Se apoyan en
[rules](../rules/) y [templates](../templates/), y a veces en una
[skill](../../skills/) formal cuando el proceso tiene lógica condicional o
estado propio — en ese caso, el playbook referencia a la skill en vez de
duplicar su contenido.

## Índice

- [`resolve-ticket.md`](resolve-ticket.md) — de un link de ticket a trabajo publicado y comentado.
- [`fix-bug.md`](fix-bug.md) — de un reporte de bug a un fix verificado.
- [`add-feature.md`](add-feature.md) — de un requerimiento a una PR lista.
- [`refactor-code.md`](refactor-code.md) — mejorar código sin cambiar comportamiento externo.
- [`create-pr.md`](create-pr.md) — armar y abrir una Pull Request.
- [`technical-review.md`](technical-review.md) — revisar un diseño o una arquitectura antes de implementar.
- [`investigate-problem.md`](investigate-problem.md) — investigar un problema sin causa clara todavía.

## Cuándo usar un playbook en vez de una skill

Un playbook alcanza cuando el proceso es lineal, no tiene estado propio entre
ejecuciones, y el usuario ya sabe que lo quiere ejecutar. Si el proceso
necesita decidir por sí mismo cuándo aplicarse, o mantener estado (como la
convención de ramas por repo), es una [skill](../../skills/), no un playbook —
ver [`architecture/README.md`](../architecture/README.md#por-qué-skills-y-por-qué-no-todo-es-una-skill).
