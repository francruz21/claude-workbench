# Best Practices: AI Engineering

Guías de fondo para trabajar con Claude (u otros LLMs) como parte del
desarrollo de software — no un proceso paso a paso, sino criterio general.

## YAGNI, incluso (especialmente) con un asistente de IA

Un LLM puede generar abstracciones, configuraciones y manejo de errores
"por si acaso" con la misma facilidad que código mínimo necesario. Esa
facilidad es justamente el riesgo: es más fácil que nunca sobre-construir.
Pedile a Claude explícitamente que resuelva lo pedido, no lo que podría
llegar a hacer falta después.

## El código habla, los comentarios explican el porqué

Nombres de variables y funciones bien elegidos son mejor documentación que
un comentario que repite lo que el código ya dice. Reservá los comentarios
para lo que el código no puede expresar por sí solo: una restricción externa,
un workaround para un bug específico, una decisión no obvia.

## Verificar antes de afirmar

Un LLM puede sonar igual de seguro afirmando algo verificado que algo
alucinado. Antes de aceptar una afirmación de "esto ya funciona" o "el bug
está resuelto", pedí evidencia concreta: output de tests, logs, un
comportamiento observado — no solo la afirmación.

## Contexto explícito mejor que contexto asumido

Cuando el repo de trabajo tiene convenciones propias, decilas explícitamente
en el `CLAUDE.md` del proyecto en vez de esperar que se infieran del código
existente. Un LLM puede inferir patrones incorrectos de código legado que ya
no representa la convención actual.

## Diseñar para unidades pequeñas y bien delimitadas

Un LLM (como una persona) razona mejor sobre código que puede sostener
completo en su "cabeza" — archivos chicos, responsabilidades claras,
interfaces explícitas. Cuando un archivo o módulo crece demasiado, es señal
de que está haciendo más de una cosa, y también hace que trabajar con IA
sobre ese código sea menos confiable.

## Feedback como inversión, no como corrección puntual

Si corregís un enfoque de Claude una vez, vale la pena preguntarte si esa
corrección debería quedar registrada (en el `CLAUDE.md` del proyecto, en una
rule de este repositorio) para no tener que repetirla cada vez.
