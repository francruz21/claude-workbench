---
name: bug-fix
description: Use cuando el usuario reporta un bug con causa no evidente (algo se rompió, un comportamiento no coincide con lo esperado, un error intermitente) y hace falta investigar antes de tocar código. NO usar para errores triviales de una línea (typo, import faltante) donde la causa ya es obvia por el mensaje de error.
---

# Bug Fix

## Propósito

Resolver bugs atacando la causa raíz, con un fix mínimo y verificado, en vez
de parchar el síntoma.

## Requiere

Esta skill no depende de ninguna capability ni campo de las tres capas de
`core/config-schema.md`: trabaja sobre el código y los tests del repo, no
sobre integraciones externas. Si una variante futura necesitara alguna, ver
`core/resolve.md` para el hueco.

## Cuándo usarla

- Un test falla y no es obvio por qué.
- Un usuario reporta "esto no funciona como esperaba" sin stack trace claro.
- Un bug es intermitente o depende de estado/timing.
- El mensaje de error apunta a un síntoma, pero la causa está en otra capa.

## Cuándo NO usarla

- El error ya dice exactamente qué falta (`Cannot find module 'x'`, typo en
  un nombre de variable) — arreglalo directo, no hace falta este proceso.
- Es un cambio de comportamiento pedido explícitamente (eso es una feature,
  no un bug) — ver [`feature-development`](../feature-development/SKILL.md).
- El "bug" es en realidad un ticket sin analizar todavía — primero analizalo
  con [`ticket-workflow`](../ticket-workflow/SKILL.md) si viene de un tracker.

## Pasos detallados

1. **Reproducir primero.** Si no podés reproducir el bug de forma
   determinística (o entender exactamente bajo qué condiciones ocurre), no
   avances a proponer un fix — seguí investigando.
2. **Aislar.** Reducí el caso a la mínima expresión que sigue mostrando el bug
   (menos código, menos dependencias, menos pasos).
3. **Encontrar la causa raíz**, no el punto donde se manifiesta el síntoma.
   Preguntate: "¿por qué pasó esto?" al menos una vez más de lo que parece
   necesario.
4. **Escribir un test que falle** por la causa raíz, antes de tocar el
   código de producción (ver [`superpowers:test-driven-development`] si está
   disponible en la sesión).
5. **Aplicar el fix mínimo** que resuelve la causa, sin aprovechar para
   refactorizar código no relacionado.
6. **Verificar** que el test nuevo pasa y que el resto de la suite sigue
   pasando.
7. **Documentar el commit** explicando la causa raíz, no solo el síntoma
   (ver [`rules/commit-conventions.md`](../../knowledge/rules/commit-conventions.md)).

## Checklist

- [ ] El bug se reprodujo de forma determinística antes de proponer un fix.
- [ ] Se identificó la causa raíz, no solo dónde se manifiesta.
- [ ] Existe un test de regresión que falla sin el fix y pasa con él.
- [ ] El fix no incluye cambios no relacionados (refactors, estilo, etc.).
- [ ] El mensaje de commit explica la causa, no solo "arregla bug X".

## Ejemplos

**Síntoma reportado:** "El formulario de checkout a veces envía el carrito vacío."

**Investigación:** se reproduce solo cuando el usuario navega rápido entre
pasos — el estado del carrito se lee de un context que todavía no terminó de
hidratarse desde localStorage.

**Causa raíz:** condición de carrera entre la hidratación async del carrito y
el submit del formulario, no el formulario en sí.

**Fix mínimo:** deshabilitar el submit hasta que el carrito termine de
hidratar, en vez de agregar un `setTimeout` como parche (que hubiera sido
tratar el síntoma).

## Errores comunes

- Parchar el síntoma (ej. agregar un `null`-check) sin entender por qué el
  valor era `null` para empezar.
- Declarar el bug "resuelto" sin haber podido reproducirlo antes.
- Aprovechar el fix para refactorizar código cercano no relacionado con el bug.
- No agregar test de regresión — el mismo bug reaparece meses después.

## Buenas prácticas

- Si la causa raíz revela un patrón riesgoso repetido en otros lugares del
  código, mencionalo — pero como hallazgo aparte, no como parte del mismo fix.
- Si el bug vino de un ticket, cerrá el loop con
  [`ticket-workflow`](../ticket-workflow/SKILL.md) para el commit/push/comentario.
