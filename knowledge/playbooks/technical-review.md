# Playbook: Hacer una revisión técnica

Distinto de [`code-review`](../../skills/code-review/SKILL.md) — este playbook
es para revisar un **diseño o una arquitectura** antes (o en lugar) de
revisar código ya escrito: un ADR, un RFC, o una propuesta de enfoque.

## Cuándo aplica

- Alguien propuso un ADR/RFC y pide feedback antes de implementar.
- Se necesita evaluar si un enfoque técnico es sólido antes de invertir tiempo
  en construirlo.

## Proceso

1. **Entender el problema que se busca resolver**, no solo la solución
   propuesta — un diseño puede ser técnicamente elegante y resolver el
   problema equivocado.
2. **Evaluar alternativas consideradas.** Si el documento no menciona
   alternativas, preguntarlas — un solo enfoque sin comparación es una señal
   de alarma, no necesariamente un error.
3. **Buscar los puntos de falla**: ¿qué pasa bajo carga, con datos
   inesperados, con fallos parciales de red/servicios externos?
4. **Evaluar reversibilidad**: si el enfoque resulta equivocado después de
   implementado, ¿qué tan caro es volver atrás?
5. **Dar feedback estructurado**: qué está bien fundamentado, qué necesita
   más justificación, y qué es bloqueante antes de avanzar a implementación.

## Errores comunes

- Revisar solo la solución propuesta sin cuestionar si resuelve el problema
  real.
- Aceptar un diseño sin alternativas consideradas, cuando el problema
  claramente admite más de un enfoque razonable.
- Dar feedback solo sobre detalles menores, sin señalar riesgos estructurales
  si los hay.
