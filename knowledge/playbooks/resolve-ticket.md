# Playbook: Resolver un ticket (Linear / Jira / otro tracker)

Este playbook es la versión narrativa del proceso que implementa la skill
[`ticket-workflow`](../../skills/ticket-workflow/SKILL.md) — usalo como
referencia de alto nivel; para el detalle de cada paso (preguntas exactas,
formato de config, ejemplos) andá a la skill.

## Proceso

Hay **cinco gates** donde decide el usuario y no Claude: tipo de rama (4), el
cráneo (6), el QA (8), commit/push (10 y 11) y la PR (13). Un label del ticket o
un valor del config pre-llenan la propuesta; no reemplazan la pregunta.

1. **Recibir el ticket.** El usuario pega un link o ID. Si hay MCP conectado
   para ese tracker, leerlo directo; si no, pedir que se pegue el contenido.
   Leer las labels por grupo (ambiente y tipo) y anotar los casos de prueba
   que el ticket describe, con qué usuario o rol ejercitarlos.
2. **Verificar convención del repo.** ¿Ya existe configuración de ramas,
   commits, labels, reviewers y arranque local para este repo? Si no, es la
   primera vez — onboarding breve (una sola vez).
3. **Analizar impacto.** ¿El ticket toca uno o varios repos del workspace
   (front/back)? Decidirlo por el contenido del ticket y confirmarlo con el
   usuario antes de crear nada.
4. **Definir tipo de rama.** Se pregunta siempre. Si el ticket tiene label de
   tipo, se propone desde ahí y se confirma; si no, se pregunta abierto.
5. **Crear la rama** desde la base que indique la label de ambiente del ticket
   (y si no tiene, o tiene `draft`/`design`, **preguntar** de dónde nace), como
   worktree de Orca para que el trabajo se vea en la IDE. Respetar la
   convención de nombre del repo, sufijo de ambiente incluido. Mover el ticket
   a `In Progress`.
6. **Cranear cómo encarar la tarea.** Investigar, entender la causa, y
   presentar el plan: qué pasa, dónde, cómo se resuelve y qué casos de prueba
   va a tener el QA. **Esperar el OK antes de escribir código.** Si el enfoque
   resulta equivocado durante la implementación, parar y volver a presentarlo.
7. **Implementar** el cambio, apoyándose en las convenciones propias del repo.
8. **Probarlo en el navegador.** Levantar la app local, ejercitar los casos de
   prueba con el usuario o rol que pida el ticket, y capturar una screenshot
   por caso del estado implementado. **Esperar el OK del usuario.**
9. **Sincronizar con la base** antes de commitear: si la rama quedó atrasada,
   mergear la base dentro de la rama de trabajo (nunca rebase, nunca al revés).
   Conflictos → parar y avisar.
10. **Commitear** solo con confirmación explícita, con mensaje según la
    convención del repo.
11. **Pushear** solo con confirmación explícita, nunca contra la rama base.
12. **Comentar el ticket** automáticamente tras el push: 3 a 6 líneas, arrancando
    por el impacto para el usuario, con las capturas del QA embebidas inline.
13. **Ofrecer abrir la PR** contra la rama de la que nació la rama de trabajo
    (nunca `main`), con reviewer asignado en GitHub, y mover el ticket a
    `In Review`.

## Cuándo usar este playbook en vez de la skill directamente

En la práctica, casi siempre conviene invocar directamente la skill
`ticket-workflow` — el playbook es útil como resumen para explicarle el
proceso a otra persona (o a vos mismo) sin entrar al detalle técnico de la
skill.
