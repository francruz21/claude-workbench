# Playbook: Agregar una feature nueva

Versión narrativa de la skill [`feature-development`](../../skills/feature-development/SKILL.md).

## Proceso

1. **Confirmar el alcance exacto** con el usuario — qué queda adentro, qué
   queda explícitamente afuera. No asumir alcance implícito.
2. **Decidir si hace falta diseño previo.** Si el cambio toca varios sistemas,
   tiene más de un enfoque razonable, o es difícil de revertir, escribir un
   [ADR](../templates/adr.md) o [RFC](../templates/rfc.md) antes de codear.
   Si es acotado y el enfoque es obvio, saltar directo a implementar.
3. **Trocear el trabajo en commits lógicos**, cada uno en estado funcional.
4. **Escribir tests** para el comportamiento nuevo, incluyendo casos borde.
5. **Revisar contra la definition of done** (ver checklist de
   [`feature-development`](../../skills/feature-development/SKILL.md#checklist-definition-of-done)).
6. **Cerrar el loop**: si viene de un ticket, usar
   [`ticket-workflow`](../../skills/ticket-workflow/SKILL.md); si no, abrir la PR
   directamente con el playbook [`create-pr`](create-pr.md).

## Señal de alarma

Si durante la implementación aparecen dos o tres decisiones de diseño no
anticipadas, es señal de que el paso 2 se resolvió mal — parar y volver a
confirmar el enfoque con el usuario en vez de seguir decidiendo solo.
