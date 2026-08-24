# ADR 003: Usar Conventional Commits como convención por defecto en este repositorio

**Fecha:** 2026-07-16
**Estado:** Aceptado

## Contexto

Este repositorio necesita una convención de mensajes de commit de referencia
para sugerir en repos nuevos que todavía no definieron la suya propia. Sin un
default razonable, la skill `ticket-workflow` tendría que preguntar siempre
desde cero, incluso cuando el usuario no tiene preferencia formada.

## Decisión

Usar [Conventional Commits](https://www.conventionalcommits.org/) como
convención sugerida por defecto, siempre preguntando explícitamente al
usuario la primera vez que se trabaja en un repo nuevo (no asumida en
silencio), y siempre cediendo ante cualquier convención propia que el repo
de trabajo ya tenga documentada.

## Alternativas consideradas

- **Formato libre sin estructura**: más simple, pero pierde la capacidad de
  generar changelogs automáticos o filtrar por tipo de cambio — se descartó
  por no aportar valor a cambio de la simplicidad.
- **Gitmoji**: agrega expresividad visual, pero no es un estándar tan
  extendido en los equipos con los que suele trabajarse — se descartó por
  preferir algo más reconocible para terceros que se sumen a un repo.

## Consecuencias

- Cualquier repo nuevo que no tenga convención propia arranca con
  Conventional Commits como sugerencia, no como imposición silenciosa.
- Si en el futuro se detecta que la mayoría de los repos de trabajo prefieren
  otra convención, este ADR debería revisarse y reemplazarse.
