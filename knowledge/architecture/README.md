# Arquitectura de este repositorio

Este documento explica cómo está organizado este repositorio y cómo Claude
Code lo consume en la práctica. No es documentación de un sistema de
software — es la "arquitectura de conocimiento" del repo.

## Las cuatro capas

```
┌─────────────────────────────────────────────┐
│  skills/       → capacidades formales        │  Claude Code las autodescubre
│                  (SKILL.md + frontmatter)    │  o se invocan con /nombre
├─────────────────────────────────────────────┤
│  playbooks/    → procesos punta a punta      │  Se consultan cuando el proceso
│                  en prosa                    │  no tiene (o no necesita) skill
├─────────────────────────────────────────────┤
│  rules/        → comportamiento y            │  Contexto de fondo, siempre
│                  restricciones               │  presentes
├─────────────────────────────────────────────┤
│  templates/    → artefactos reutilizables    │  Se usan al crear PRs, ADRs,
│                  (PR, commit, ADR, RFC...)   │  bug reports, etc.
└─────────────────────────────────────────────┘
```

`examples/`, `checklists/` y `best-practices/` son transversales: no son una
capa nueva, sino apoyo para las cuatro de arriba (un ejemplo de un template
lleno, un checklist derivado de una rule, una guía de fondo que informa una
skill).

## Por qué Skills, y por qué no todo es una Skill

Una Skill formal tiene sentido cuando:
- Claude necesita **decidir cuándo aplicarla** (autodescubrimiento por
  `description`), no solo seguir un proceso que el usuario ya sabe que quiere.
- El proceso tiene pasos condicionales, estado propio (como el config por
  repo de `ticket-workflow`), o checklist verificable.

Un Playbook alcanza cuando el proceso es lineal, no tiene estado propio, y el
usuario ya sabe que lo quiere ejecutar (ej. "hacé una PR").

Una Rule no es un proceso — es una restricción o expectativa de comportamiento
que aplica transversalmente (ej. "nunca push directo a `dev`").

## Cómo Claude descubre este repo

1. **Skills**: `install.sh` symlinkea `skills/*` a `~/.claude/skills/`. Claude
   Code las lee ahí igual que cualquier skill personal, en cualquier proyecto.
2. **Rules / Playbooks / Templates**: no hay autodescubrimiento nativo para
   estas carpetas, así que `~/.claude/CLAUDE.md` (instrucciones globales del
   usuario) referencia explícitamente las rutas de este repo. Esto hace que
   Claude sepa que existen y las lea cuando son relevantes al pedido.
3. **Prioridad**: cuando el repo de trabajo (cliente) tiene su propio
   `CLAUDE.md` o sus propias rules/skills, esas **siempre ganan** sobre lo
   genérico de este repositorio. Este repo es la base por defecto, no un
   reemplazo del criterio de cada proyecto — ver [`rules/README.md`](../rules/README.md#prioridades).

## Por qué el config de `ticket-workflow` vive en cada repo de cliente y no acá

Este repositorio es agnóstico de proyecto: no sabe (ni debe saber) qué
convención de ramas usa el backend de tal cliente. Por eso el estado
específico de cada integración (prefijo de workspace, tipos de rama, idioma,
convención de commits) se guarda en la capa `project` de
`.claude/workbench.project.json` **dentro de cada repo de trabajo** (ver
`core/config-schema.md`), no acá. La skill en sí (el comportamiento, el
flujo, las preguntas) es lo único que vive acá.

## Evolución esperada

Con el tiempo, `skills/` va a crecer a decenas o cientos de carpetas. Para que
eso siga siendo manejable:
- Cada skill nueva sigue `skills/TEMPLATE.md` sin excepción.
- Si dos skills se solapan en propósito, se fusionan o se dejan claramente
  diferenciadas en su `description` (de la que depende el autodescubrimiento).
- Este archivo (`architecture/README.md`) se actualiza si cambia algo
  estructural — no si solo se agrega una skill más.
