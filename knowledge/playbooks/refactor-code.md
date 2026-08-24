# Playbook: Refactorizar código

Mejorar la estructura interna del código sin cambiar su comportamiento
observable. A diferencia de una feature, acá el "definition of done" es que
nada externo cambió — solo la calidad interna.

## Cuándo aplica

- Un archivo/módulo creció demasiado y mezcla responsabilidades.
- Hay duplicación real (no solo similitud superficial) que complica mantener
  el código.
- Un cambio de feature requiere primero reordenar código existente para
  poder implementarse con claridad ("preparatory refactoring").

## Cuándo NO aplica

- Se quiere cambiar comportamiento al mismo tiempo — separar en dos pasos:
  primero refactor (sin cambiar comportamiento), después la feature/fix.
- El código "no gusta" pero no hay un problema concreto que el refactor
  resuelva — evitar refactors especulativos sin motivo (YAGNI también aplica
  acá).

## Proceso

1. **Verificar que hay cobertura de tests** sobre el comportamiento actual
   antes de tocar nada. Si no la hay, escribirla primero — es la red de
   seguridad que permite refactorizar con confianza.
2. **Confirmar el alcance** con el usuario: qué se va a reestructurar y por
   qué, explícitamente separado de cualquier cambio de comportamiento.
3. **Refactorizar en pasos pequeños**, corriendo los tests después de cada
   paso — no acumular cambios grandes sin verificar en el medio.
4. **Verificar que el comportamiento externo es idéntico** al final (mismos
   tests, mismo resultado).
5. **Commitear el refactor separado** de cualquier otro cambio — nunca
   mezclado con una feature o fix en el mismo commit/PR.

## Errores comunes

- Refactorizar y agregar una feature en el mismo cambio — hace la revisión y
  el rollback mucho más difíciles.
- Refactorizar sin red de tests, "a ojo" — el comportamiento puede cambiar sin
  que nadie lo note hasta producción.
- Sobre-abstraer "por si en el futuro hace falta" — ver
  [`best-practices/ai-engineering.md`](../best-practices/ai-engineering.md).
