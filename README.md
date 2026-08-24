# claude-workbench

Skills y base de conocimiento para [Claude Code](https://claude.com/claude-code):
un conjunto de skills reutilizables en cualquier proyecto, más el conocimiento
de fondo (reglas, playbooks, templates) que las sostiene. Se instala una vez
por máquina y queda disponible en cualquier repo en el que se trabaje después.

Este repo es público y no contiene datos de ningún proyecto ni persona real
— ver [Ningún dato real entra al repo](#ningún-dato-real-entra-al-repo).

## Qué trae

### Las cinco skills (`skills/`)

| Skill | Para qué |
|---|---|
| `ticket-workflow` | De un link o ID de ticket a una PR lista: onboarding por repo, lectura del ticket, rama, implementación, QA manual, commit/push, comentario y PR — con cinco gates que siempre pregunta. |
| `conductor` | Supervisa varios tickets en paralelo: un worktree y un agente por ticket, relevea los gates de `ticket-workflow` al usuario, anuncia los PRs verdes y limpia al mergear. |
| `bug-fix` | De un bug reportado a un fix verificado, con la causa investigada antes de tocar código. |
| `feature-development` | De un requerimiento a una PR, decidiendo cuándo hace falta un diseño previo (ADR/RFC) y cuándo no. |
| `code-review` | Cómo priorizar y comunicar una revisión de código. |

`install.sh` symlinkea cada carpeta de `skills/` en `~/.claude/skills/`, que es
donde Claude Code las autodescubre en cualquier proyecto. `skills/TEMPLATE.md`
documenta la estructura que sigue toda skill nueva.

### Las siete carpetas de `knowledge/`

No son skills — es contexto de fondo que Claude debe tener presente, no algo
que se invoque:

| Carpeta | Contenido |
|---|---|
| `rules/` | Comportamiento y restricciones transversales (convenciones de git, de commits, de testing, de revisión). |
| `playbooks/` | Procesos punta a punta en prosa, para cuando el proceso es lineal y no necesita una skill formal. |
| `templates/` | Artefactos reutilizables: PR, commit, ADR, RFC, bug report, propuesta técnica. |
| `checklists/` | Checklists derivados de las rules (PR, revisión de código, release). |
| `examples/` | Ejemplos completos y rellenos de los templates. |
| `architecture/` | Cómo está organizado este repo y por qué — la arquitectura de conocimiento en sí. |
| `best-practices/` | Guías de fondo, no paso a paso, sobre trabajar con Claude como parte del desarrollo. |

Ver [`knowledge/architecture/README.md`](knowledge/architecture/README.md)
para el mapa completo de cómo se relacionan estas capas entre sí y con
`skills/`.

### El core (`core/`)

Tres documentos que sostienen a las skills, no conocimiento de proyecto:

- [`core/config-schema.md`](core/config-schema.md) — el esquema de las tres
  capas de configuración (ver más abajo), campo por campo. Es la única
  autoridad sobre qué campo existe y en qué capa vive.
- [`core/resolve.md`](core/resolve.md) — el protocolo que sigue toda skill
  ante un hueco (falta una capability, falta un campo de config, o la
  situación es ambigua): parar y resolver con el usuario, nunca asumir.
- [`core/capabilities.md`](core/capabilities.md) — qué capability se detecta
  con qué probe, y por qué algunas cosas son un hecho del sistema y otras una
  elección de la persona.

`tools/check-schema-refs.sh` valida que todo campo que una skill declare en su
sección `## Requiere` exista en `core/config-schema.md`; `tools/check-core-refs.sh`
valida que toda skill cite el protocolo de resolución.

## Instalación

```bash
git clone https://github.com/OWNER/claude-workbench.git
cd claude-workbench
./install.sh
```

El instalador:

- symlinkea las cinco skills a `~/.claude/skills/`;
- detecta qué capabilities están disponibles (`gh`, `orca-ide`, `python3`) y
  guarda el resultado en `~/.claude/workbench/capabilities.json`;
- pregunta, interactivamente y de a una, la configuración de usuario y la
  guarda en `~/.claude/workbench/user.json` con permisos `600`;
- si existe un config de una instalación anterior de este repo, ofrece
  importarlo repartiendo cada campo en la capa que le corresponde;
- ofrece instalar el hook de pre-commit de este repo (opt-in, nunca pisa un
  hook propio).

Es seguro correrlo de nuevo: no repite preguntas ya respondidas ni pisa
decisiones tomadas. `./install.sh --help` lista los modos parciales
(`--skills-only`, `--detect-only`, `--print-claude-md`, `--hook-only`).

Para que Claude Code además consulte `knowledge/rules/`, `knowledge/playbooks/`
y `knowledge/templates/` en cualquier proyecto, `install.sh` imprime el bloque
a pegar en `~/.claude/CLAUDE.md` (no lo escribe solo, para no pisar
instrucciones globales ya existentes).

## Las tres capas de configuración

Ninguna vive dentro del repo — las tres están fuera del control de versiones,
siempre. `core/config-schema.md` es la autoridad sobre qué campo va en cuál;
esto es solo el mapa de rutas:

| Capa | Ruta | Qué guarda |
|---|---|---|
| `capabilities` | `~/.claude/workbench/capabilities.json` | Qué hay instalado (`detected`) y qué se eligió (`choices`) — por máquina. |
| `user` | `~/.claude/workbench/user.json` (`chmod 600`) | Lo que pertenece a la persona y vale igual en cualquier proyecto: handle, canal de anuncios, mención. |
| `project` | `<repo-de-trabajo>/.claude/workbench.project.json` | Lo que pertenece a cada repo de trabajo: prefijo de tracker, tipos de rama, reviewers, config de `conductor` para ese workspace, etc. |

## Ningún dato real entra al repo

Este repo se escribe y se edita sobre datos reales de proyectos y personas —
y ninguno de ellos debe llegar a un commit. La regla se sostiene con
`tools/check-placeholders.sh`, que corre en el hook de pre-commit (si se
instaló) y en CI, y hace dos chequeos independientes:

1. **Por forma**: patrones sensibles sin importar el valor — mails, tokens,
   claves privadas, rutas `/home/<usuario>/...`, ids largos, webhooks.
2. **Data-driven**: compara cada archivo contra los valores reales de la
   config local (`user.json` y `<repo-de-trabajo>/.claude/workbench.project.json`)
   sin nombrarlos nunca en el repo — los lee del disco en el momento de
   correr. `capabilities.json` queda afuera de esta comparación a propósito:
   solo contiene booleans y enums, y ninguno identifica a una persona o un
   proyecto, que es lo único que este chequeo cubre.

**No hay excepciones.** Ninguna cuenta de nadie puede aparecer en el repo
publicado — ni un handle personal, ni un handle de trabajo, ni un login de
GitHub, ni el nombre de una persona real, en ningún lugar, ni siquiera como
link autorreferencial al propio repo. Todo lo relacionado a identidad se
configura localmente, fuera del control de versiones.

```bash
./tools/check-placeholders.sh          # sobre todo lo trackeado
./tools/check-placeholders.sh --staged # sobre lo que se va a commitear
```

## Tests

```bash
for t in tools/tests/test-*.sh; do bash "$t"; done
./tools/check-schema-refs.sh
./tools/check-core-refs.sh
./tools/check-placeholders.sh
```

## Licencia

Apache 2.0 — ver [`LICENSE`](LICENSE).
