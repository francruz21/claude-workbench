<!--
Instrucciones de uso: el "cómo" detallado de una feature ya aprobada (por
RFC/ADR o por acuerdo directo). Si la feature es simple y el enfoque es
obvio, puede que ni haga falta este documento — ver
skills/feature-development/SKILL.md.
-->

# Diseño técnico: {{nombre de la feature}}

**Ticket relacionado:** {{ID o link, si existe}}

## Objetivo

{{Qué se va a construir y qué problema resuelve, en términos concretos.}}

## Alcance

{{Qué queda explícitamente adentro y qué queda explícitamente afuera. Esto
evita scope creep durante la implementación.}}

## Diseño

{{El enfoque técnico: componentes involucrados, flujo de datos, cambios de
esquema/API si aplica. Suficiente detalle para que otra persona pueda
implementarlo sin tener que rediseñar sobre la marcha.}}

## Casos borde

{{Qué pasa con inputs inesperados, fallos parciales, condiciones de carrera,
concurrencia — lo que no es el camino feliz.}}

## Plan de testing

{{Qué se va a testear y a qué nivel (unitario, integración, e2e).}}

## Troceo de implementación

{{Los commits/PRs lógicos en los que se va a dividir el trabajo, en orden.}}
