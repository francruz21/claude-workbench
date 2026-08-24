# Playbook: Resolver un bug

Versión narrativa de la skill [`bug-fix`](../../skills/bug-fix/SKILL.md).

## Proceso

1. **Recolectar contexto del reporte**: qué se esperaba, qué pasó, pasos para
   reproducir, entorno. Si falta algo esencial, preguntarlo antes de
   investigar a ciegas.
2. **Reproducir de forma determinística.** Sin reproducción confiable, no hay
   forma de verificar después que el fix funcionó.
3. **Aislar el caso mínimo** que sigue mostrando el problema.
4. **Investigar la causa raíz** con [`superpowers:systematic-debugging`] si
   está disponible en la sesión — no conformarse con el primer punto donde el
   síntoma es visible.
5. **Escribir un test que falle** por la causa identificada.
6. **Aplicar el fix mínimo** que resuelve la causa.
7. **Verificar** que el test nuevo pasa y que no se rompió nada más.
8. **Commitear** explicando la causa, no solo el síntoma corregido.
9. Si el bug vino de un ticket, usar
   [`ticket-workflow`](../../skills/ticket-workflow/SKILL.md) para el resto del
   ciclo (push, comentario, PR).

## Señal de alarma

Si en el paso 4 la "causa raíz" identificada es simplemente "el valor era
`null`/`undefined`" sin explicar **por qué** llegó a serlo, todavía no se
llegó a la causa real — seguir investigando un nivel más abajo.
