---
name: code-review
description: Use cuando el usuario pide revisar un diff, un PR, o código recién escrito antes de mergear/entregar. Cubre tanto revisar código propio antes de subir un PR como dar una segunda opinión sobre código ajeno. NO usar como sustituto de tests automatizados — esta skill es para juicio humano/de diseño, no para verificar que el código corre.
---

# Code Review

## Propósito

Dar una revisión de código priorizada y accionable: encontrar lo que
realmente importa (correctness, seguridad, diseño) sin ahogarlo en
nitpicks de estilo.

## Requiere

Esta skill no depende de ninguna capability ni campo de las tres capas de
`core/config-schema.md`: revisa el diff que se le da, sin leer ni escribir
config propia. Si una variante futura necesitara alguna, ver
`core/resolve.md` para el hueco.

## Cuándo usarla

- Antes de abrir una PR ("revisá esto antes de subirlo").
- Al recibir un link de PR o un diff para dar feedback.
- Como segunda opinión sobre un enfoque ya implementado.

## Cuándo NO usarla

- Solo se necesita correr tests o el linter — eso es verificación automática,
  no revisión de código (ver [`superpowers:verification-before-completion`]).
- El pedido es "escribí este código" — eso es implementación, no revisión.
- El diff es trivial (typo, bump de versión, cambio de config) y no amerita
  más que un vistazo — no hace falta el proceso completo.

## Pasos detallados

1. **Entender el propósito del cambio** antes de leer línea por línea — ¿qué
   problema resuelve? Sin esto, cualquier opinión sobre el diseño es a ciegas.
2. **Priorizar en este orden:**
   1. Correctness — ¿hace lo que dice que hace, en todos los casos, no solo el feliz?
   2. Seguridad — inyección, validación de input, manejo de secretos, permisos.
   3. Diseño — ¿la solución es proporcional al problema? ¿hay abstracciones prematuras o faltantes?
   4. Mantenibilidad — nombres, claridad, tests.
   5. Estilo — solo si no lo cubre ya un linter/formatter automático.
3. **Verificar reproducibilidad de los tests** si el diff los incluye — no
   asumir que pasan por estar presentes.
4. **Clasificar cada hallazgo**: bloqueante (debe arreglarse antes de mergear)
   vs sugerencia (puede quedar para después o ignorarse).
5. **Dar el veredicto explícito**: aprobar, aprobar con comentarios menores, o
   pedir cambios — no dejarlo ambiguo.

## Checklist

- [ ] Se entendió el propósito del cambio antes de opinar sobre el diseño.
- [ ] Se revisó correctness antes que estilo.
- [ ] Se consideraron casos borde, no solo el camino feliz.
- [ ] Cada hallazgo está marcado como bloqueante o sugerencia.
- [ ] Hay un veredicto explícito al final (aprobar / cambios menores / cambios bloqueantes).

## Ejemplos

**Diff:** agrega un endpoint que recibe un `userId` por query param y devuelve
el perfil correspondiente.

**Revisión priorizada:**
- 🔴 Bloqueante (seguridad): el endpoint no verifica que el `userId` pedido
  coincida con el usuario autenticado — cualquiera puede leer el perfil de
  cualquier otro pasando el ID.
- 🟡 Sugerencia (diseño): el manejo de "usuario no encontrado" devuelve 500 en
  vez de 404.
- Sin comentarios de estilo — el linter del repo ya lo cubre.

**Veredicto:** cambios bloqueantes — no mergear hasta resolver el control de acceso.

## Errores comunes

- Enterrar el hallazgo de seguridad entre diez comentarios de estilo.
- Aprobar sin verificar si los tests incluidos realmente corren y fallan sin el fix.
- Dar feedback vago ("esto podría ser mejor") sin proponer algo concreto y accionable.
- No dar un veredicto claro, dejando al autor sin saber si puede mergear o no.

## Buenas prácticas

- Cuando el hallazgo es de seguridad o correctness, explicá el escenario de
  falla concreto (input, estado, secuencia), no solo "esto es inseguro".
- Reconocé lo que está bien hecho, no solo lo que falta — ayuda a calibrar
  qué patrones repetir.
- Usá [`checklists/code-review-checklist.md`](../../knowledge/checklists/code-review-checklist.md)
  como repaso final antes de cerrar la revisión.
