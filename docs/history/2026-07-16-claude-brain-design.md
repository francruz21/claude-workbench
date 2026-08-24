# claude-brain — Diseño

> **Histórico**: este documento describe el diseño previo a la unificación en `claude-workbench` y no refleja el estado actual del repo. Se conserva por el razonamiento que registra, no como referencia vigente — ver `docs/superpowers/specs/2026-08-24-claude-workbench-design.md` para el diseño actual.

**Fecha:** 2026-07-16
**Autor:** <usuario> (con Claude Code)
**Estado:** Aprobado

## 1. Propósito

`claude-brain` es un repositorio personal, independiente de cualquier proyecto de
cliente, que centraliza todo el conocimiento reutilizable de su autor para trabajar
con Claude Code: Skills, Rules, Playbooks, Templates, Examples, Architecture Docs,
Checklists y Best Practices. La idea es que Claude pueda reutilizar este conocimiento
en cualquier repo de trabajo con solo tener acceso a este repositorio — es el
"segundo cerebro" de su autor para IA Engineering.

No contiene código de ningún cliente ni lógica de negocio de ningún proyecto.

## 2. Instalación / Descubrimiento

Claude Code descubre Skills personales automáticamente desde `~/.claude/skills/`.
`claude-brain/install.sh` crea un symlink por cada carpeta de `skills/` hacia
`~/.claude/skills/<nombre>`, de forma que estén disponibles en cualquier proyecto
sin copiar archivos.

Para Rules, Playbooks y Templates (que no son Skills formales y por ende Claude Code
no las autodescubre), `~/.claude/CLAUDE.md` (instrucciones globales de usuario) suma
una referencia explícita a las rutas de `claude-brain/rules/`, `claude-brain/playbooks/`
y `claude-brain/templates/`, para que Claude sepa que existen y las consulte cuando
sea relevante, en cualquier proyecto.

## 3. Estructura de carpetas

```
claude-brain/
├── README.md
├── install.sh
├── skills/
│   ├── TEMPLATE.md
│   ├── ticket-workflow/
│   │   ├── SKILL.md
│   │   └── reference/
│   │       ├── config-schema.md
│   │       └── examples.md
│   ├── bug-fix/SKILL.md
│   ├── code-review/SKILL.md
│   └── feature-development/SKILL.md
├── rules/
│   ├── README.md
│   ├── git-conventions.md
│   ├── commit-conventions.md
│   ├── testing-conventions.md
│   └── code-review-guidelines.md
├── playbooks/
│   ├── README.md
│   ├── resolve-ticket.md
│   ├── fix-bug.md
│   ├── add-feature.md
│   ├── refactor-code.md
│   ├── create-pr.md
│   ├── technical-review.md
│   └── investigate-problem.md
├── templates/
│   ├── README.md
│   ├── pull-request.md
│   ├── commit-message.md
│   ├── adr.md
│   ├── rfc.md
│   ├── bug-report.md
│   ├── technical-design.md
│   └── feature-proposal.md
├── examples/
│   ├── README.md
│   ├── adr-example.md
│   └── bug-report-example.md
├── architecture/
│   └── README.md
├── checklists/
│   ├── pr-checklist.md
│   ├── code-review-checklist.md
│   └── release-checklist.md
└── best-practices/
    ├── ai-engineering.md
    └── claude-code-usage.md
```

## 4. Formato de Skills

Cada Skill sigue el formato oficial de Claude Code: carpeta propia con `SKILL.md`,
frontmatter YAML (`name`, `description`), y estructura obligatoria de contenido:
propósito, cuándo usar, cuándo NO usar, pasos detallados, checklist, ejemplos,
errores comunes, buenas prácticas. `skills/TEMPLATE.md` documenta esta estructura
para cualquier skill futura.

## 5. Skill flagship: `ticket-workflow`

### 5.1 Config por repo de trabajo

Cada repo de trabajo (front, back, etc. — NUNCA `claude-brain`) tiene su propio
`.claude/ticket-workflow.config.json`, creado la primera vez que se usa la skill
en ese repo:

```json
{
  "workspacePrefix": "EX",
  "branchTypes": ["feature", "fix", "bug", "hotfix", "chore", "refactor"],
  "descriptionLanguage": "es",
  "baseBranch": "dev",
  "commitConvention": "conventional-commits",
  "branchPattern": "{type}/{ticketId}-{description}"
}
```

### 5.2 Flujo

1. **Detección de primera vez**: si no existe el config en el repo (ni en los repos
   hermanos del workspace), dispara el onboarding.
2. **Onboarding** (una vez por repo): pregunta prefijo del workspace, tipos de rama
   permitidos, idioma de descripción, convención de commits (si el repo no define
   ya una propia), rama base. Guarda todo en el config.
3. **Recepción del ticket**: link o ID. Si hay MCP conectado (Linear, Jira, etc.)
   lo lee directo; si no, pide que se pegue título/descripción manualmente.
4. **Análisis del workspace**: si el directorio contiene varios repos git (front/back),
   analiza el contenido del ticket para decidir en cuál(es) corresponde trabajar,
   y lo comunica antes de continuar.
5. **Tipo de rama**: siempre se pregunta para el ticket actual (no se infiere ni
   se cachea entre tickets).
6. **Rama**: actualiza `baseBranch` remoto y crea la rama desde ahí con el patrón
   configurado (ej. `fix/EX-107-solucion-error-color-modal`).
7. **Implementación**: se apoya en las skills/rules propias del repo de trabajo,
   que tienen prioridad sobre las reglas genéricas de `claude-brain`.
8. **Commit**: propone el mensaje según la convención configurada, pide confirmación
   explícita antes de commitear. Nunca commitea sin aprobación.
9. **Push**: pide confirmación explícita. Nunca pushea ni commitea directo a
   `baseBranch` (ni en front ni en back) — solo a la rama de trabajo.
10. **Comentario en el ticket**: automático tras el push, sin pedir confirmación
    adicional — resumen profesional y conciso de lo trabajado, vía el MCP
    correspondiente.
11. **PR**: pregunta si se desea abrir la Pull Request (usando `templates/pull-request.md`)
    contra `baseBranch`, antes de cerrar la tarea.
12. **Usos siguientes**: si el config ya existe, no se repite el onboarding —
    continúa directo, salvo el paso 5 (tipo de rama, siempre se pregunta) y
    cualquier decisión de negocio/funcionamiento que requiera juicio del usuario.

### 5.3 Restricciones duras

- Nunca commitear sin confirmación explícita del usuario.
- Nunca pushear sin confirmación explícita del usuario.
- Nunca commitear ni pushear directo a la rama base (`dev` u otra configurada),
  en ningún repo.
- El comentario en el ticket se publica automáticamente tras el push confirmado
  (no requiere una segunda confirmación).

## 6. Skills de referencia

`bug-fix`, `code-review`, `feature-development` — mismo formato que
`ticket-workflow`, sirven como ejemplo de calidad para futuras skills.

## 7. Rules

Cada rule define: comportamiento esperado, prioridades (la convención del repo de
cliente siempre gana sobre la regla genérica de `claude-brain`), restricciones
explícitas, y ejemplos de cumplimiento/incumplimiento.

## 8. Playbooks

Procesos punta a punta en prosa, pensados para ejecutarse aunque no exista una
skill formal para ese caso — capa de "checklist de proceso" por encima de las skills.

## 9. Templates

Reutilizables, con placeholders claros e instrucciones de uso al inicio de cada uno.

## 10. Fuera de alcance

- No se escriben "cientos" de skills ahora — la estructura queda lista para
  escalar, con 4 skills completas iniciales.
- No se integra código de ningún cliente.
- No se automatiza la creación de PRs fuera de la skill `ticket-workflow` /
  playbook `create-pr.md`.
