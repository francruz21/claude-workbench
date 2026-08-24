# Testing Conventions

## Comportamiento esperado

- Todo bugfix incluye un test de regresión que falla sin el fix y pasa con él
  (ver [`skills/bug-fix/SKILL.md`](../../skills/bug-fix/SKILL.md)).
- Toda feature nueva incluye tests para su comportamiento observable, no solo
  para el camino feliz — casos borde y de error también.
- Los tests se escriben para el comportamiento externo (qué hace el código),
  no para su implementación interna — evitar tests que se rompen con
  cualquier refactor que no cambia el comportamiento.

## Prioridades

1. El framework y las convenciones de testing ya establecidas en el repo de
   trabajo ganan siempre (no introducir un framework nuevo sin acuerdo
   explícito).
2. Si el repo no tiene tests todavía y hay que decidir un enfoque desde cero,
   priorizar tests de integración sobre unitarios cuando cubren más
   comportamiento real con menos mantenimiento.

## Restricciones

- No mockear una dependencia crítica (ej. la base de datos) en tests que
  deberían validar el comportamiento real de integración, salvo que el repo
  ya tenga esa convención establecida y documentada.
- No marcar una tarea como completa con tests fallando o saltados
  (`skip`/`todo`) — ver `superpowers:verification-before-completion`.
- No escribir tests que dependen de orden de ejecución o de estado global
  compartido entre tests, salvo que sea inevitable y esté documentado por qué.

## Ejemplos

✅ Test de regresión de un bug de condición de carrera: simula la secuencia
exacta que dispara el bug, no solo llama a la función en aislamiento.

❌ Test que verifica que una función interna privada fue llamada exactamente
una vez — acopla el test a la implementación, no al comportamiento.

## Buenas prácticas

- Si escribís el test antes del fix/feature (TDD), verificalo en rojo antes
  de pasar a verde — un test que nunca falló no prueba nada.
- Preferí nombres de test que describen el comportamiento esperado
  ("rechaza el submit si el carrito no terminó de hidratar") por sobre
  nombres genéricos ("test 1").
