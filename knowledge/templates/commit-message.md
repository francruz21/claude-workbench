<!--
Instrucciones de uso: formato Conventional Commits. El tipo y el ámbito van
en minúscula. La descripción en modo imperativo ("agrega", no "agregado").
Ver rules/commit-conventions.md.
-->

{{tipo}}({{ámbito opcional}}): {{descripción corta en imperativo, menor a 72 caracteres}}

{{Cuerpo opcional: por qué se hizo el cambio, no qué archivos se tocaron.
Se puede omitir si la descripción corta ya es suficiente.}}

{{Footer opcional: referencia a ticket, ej. "Refs: EX-107", o breaking change,
ej. "BREAKING CHANGE: descripción del cambio incompatible".}}

<!--
Tipos válidos: feat, fix, docs, style, refactor, test, chore.
Ejemplo real:

fix(checkout): corrige condición de carrera en hidratación del carrito

El submit se ejecutaba antes de que el contexto del carrito terminara de
hidratar desde localStorage, enviando un carrito vacío en navegación rápida.

Refs: EX-203
-->
