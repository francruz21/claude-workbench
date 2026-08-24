---
name: feature-development
description: Use cuando el usuario pide agregar una funcionalidad nueva (no un fix ni un refactor) — desde un requerimiento de negocio hasta una PR lista para revisar. Cubre cuándo hace falta un diseño previo (ADR/RFC) versus implementar directo. NO usar para bugs (ver bug-fix) ni para cambios que no agregan comportamiento nuevo (ver refactor, playbook refactor-code).
---

# Feature Development

## Propósito

Llevar una funcionalidad nueva desde el requerimiento hasta una PR lista,
decidiendo con criterio cuándo el diseño necesita documentarse antes de
escribir código y cuándo no.

## Requiere

Esta skill no depende directamente de ninguna capability ni campo propio de
`core/config-schema.md`. Cuando el trabajo viene de un ticket y cierra el loop
con [`ticket-workflow`](../ticket-workflow/SKILL.md), son los requisitos de esa
skill los que aplican — ver su propia sección `## Requiere`. Ante cualquier
hueco, seguir `core/resolve.md`.

## Cuándo usarla

- "Agregá la posibilidad de que el usuario pueda X."
- Un ticket de tipo feature/story, ya analizado (ver
  [`ticket-workflow`](../ticket-workflow/SKILL.md) si viene de un tracker).
- Cualquier pedido que agrega comportamiento nuevo observable por el usuario final.

## Cuándo NO usarla

- El pedido es corregir algo que no funciona como se espera — usá
  [`bug-fix`](../bug-fix/SKILL.md).
- El pedido es mejorar código existente sin cambiar comportamiento externo —
  usá el playbook [`refactor-code`](../../knowledge/playbooks/refactor-code.md).
- La feature es tan grande que en realidad son varias features independientes
  — primero descomponer con el usuario (ver `superpowers:brainstorming`) antes
  de aplicar esta skill a cada una por separado.

## Pasos detallados

1. **Decidir si hace falta diseño previo.** Señales de que sí: el cambio toca
   múltiples sistemas, hay más de un enfoque razonable con trade-offs reales,
   o el impacto es difícil de revertir. En esos casos, escribir un
   [ADR](../../knowledge/templates/adr.md) o [RFC](../../knowledge/templates/rfc.md) antes de
   codear. Si el cambio es acotado y el enfoque es obvio, saltar directo a
   implementar.
2. **Confirmar el alcance** con el usuario antes de empezar — qué queda
   adentro y qué queda explícitamente afuera (YAGNI: no agregar nada que no
   se pidió).
3. **Trocear en commits lógicos**, cada uno en un estado funcional (no dejar
   commits intermedios que rompen el build).
4. **Escribir tests** para el comportamiento nuevo antes o junto con la
   implementación (ver `superpowers:test-driven-development` si está disponible).
5. **Verificar la "definition of done"**: el checklist de abajo, no solo "compila".
6. **Cerrar el loop**: si viene de un ticket, usar
   [`ticket-workflow`](../ticket-workflow/SKILL.md) para commit/push/comentario/PR.

## Checklist (definition of done)

- [ ] El alcance se confirmó con el usuario antes de implementar (nada de más, nada de menos).
- [ ] Si el cambio era lo bastante grande/ambiguo, existe un ADR/RFC previo.
- [ ] Hay tests para el comportamiento nuevo, no solo para el camino feliz.
- [ ] Los commits son lógicos y cada uno deja el repo en estado funcional.
- [ ] No se coló ningún cambio no relacionado (refactors oportunistas, estilo).
- [ ] La PR describe qué se agregó y por qué (ver [`templates/pull-request.md`](../../knowledge/templates/pull-request.md)).

## Ejemplos

**Pedido:** "Agregá exportar el listado de pedidos a CSV."

**Análisis:** cambio acotado, un solo enfoque razonable (generar CSV en el
backend, endpoint de descarga) → no hace falta ADR, se implementa directo.

**Troceo de commits:**
1. `feat: agrega generación de CSV para listado de pedidos`
2. `feat: expone endpoint de descarga de CSV`
3. `test: cubre casos borde de exportación (listado vacío, caracteres especiales)`

## Errores comunes

- Empezar a codear antes de confirmar el alcance, y descubrir a mitad de
  camino que el usuario esperaba algo distinto.
- Escribir un RFC extenso para un cambio trivial (sobre-proceso) o, al revés,
  saltarse el diseño en un cambio con trade-offs reales no obvios.
- Un solo commit gigante en vez de una secuencia lógica revisable.
- Agregar configurabilidad o abstracciones para casos hipotéticos no pedidos.

## Buenas prácticas

- Si durante la implementación aparece una decisión de diseño no anticipada,
  volver a confirmar con el usuario en vez de decidir unilateralmente y seguir.
- Preferir tres líneas repetidas a una abstracción prematura — ver
  [`best-practices/ai-engineering.md`](../../knowledge/best-practices/ai-engineering.md).
