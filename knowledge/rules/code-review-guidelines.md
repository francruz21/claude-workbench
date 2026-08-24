# Code Review Guidelines

## Comportamiento esperado

Toda revisión de código (propia o ajena) prioriza en este orden:

1. Correctness — ¿hace lo que dice, en todos los casos relevantes?
2. Seguridad — inyección, validación de input, autorización, manejo de secretos.
3. Diseño — proporcionalidad de la solución al problema.
4. Mantenibilidad — claridad, nombres, cobertura de tests.
5. Estilo — solo lo que no cubra ya un linter/formatter automático.

Ver [`skills/code-review/SKILL.md`](../../skills/code-review/SKILL.md) para el
proceso paso a paso.

## Prioridades

1. Los lineamientos de estilo/arquitectura propios del repo de trabajo ganan
   sobre cualquier preferencia genérica.
2. Ante la duda entre "es correcto pero no me gusta cómo está escrito" y
   avanzar, priorizar no bloquear por preferencia personal no acordada con el
   equipo — separar bloqueante de sugerencia explícitamente.

## Restricciones

- Todo hallazgo de seguridad o correctness es bloqueante por defecto, salvo
  que el propio equipo decida asumir el riesgo explícitamente.
- No aprobar una PR sin haber revisado los tests incluidos (que existan y
  que efectivamente verifiquen el cambio).
- No dar una revisión sin veredicto final explícito (aprobar / cambios
  menores / cambios bloqueantes).

## Ejemplos

Ver los ejemplos en [`skills/code-review/SKILL.md`](../../skills/code-review/SKILL.md#ejemplos)
y el [`checklists/code-review-checklist.md`](../checklists/code-review-checklist.md).
