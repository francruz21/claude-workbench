# Playbook: Crear una Pull Request

## Cuándo aplica

Cuando el trabajo en una rama está listo, verificado, y se quiere abrir para
revisión. Si el trabajo vino de un ticket trabajado con
[`ticket-workflow`](../../skills/ticket-workflow/SKILL.md), esa skill ya ofrece
este paso al final — este playbook es para el resto de los casos (o como
referencia del proceso).

## Proceso

1. **Verificar que la rama está pusheada** y actualizada — nunca abrir una PR
   sobre commits que solo existen localmente.
2. **Revisar el diff completo contra la rama base**, no solo el último
   commit — asegurarse de que no se cuele nada no relacionado.
3. **Redactar la PR** con [`templates/pull-request.md`](../templates/pull-request.md):
   qué cambia, por qué, cómo probarlo, y cualquier riesgo conocido.
4. **Confirmar con el usuario antes de crearla** — abrir una PR es una acción
   visible para el equipo, nunca se hace sin confirmación explícita.
5. **Referenciar el ticket** correspondiente si existe (link o ID), para que
   quede trazabilidad entre el tracker y el código.
6. **Asignar reviewers** solo si el usuario lo pide explícitamente o el repo
   tiene una convención clara de a quién asignar (ej. CODEOWNERS).

## Errores comunes

- Abrir la PR con un título genérico ("cambios", "fix") en vez de describir
  el cambio real.
- Omitir cómo probar el cambio, dejando al reviewer sin forma fácil de
  verificarlo.
- Abrir la PR sin confirmación, asumiendo que "ya se sabía" que tocaba
  hacerlo — la creación de una PR es una acción visible para terceros y
  siempre requiere confirmación explícita en el momento.
