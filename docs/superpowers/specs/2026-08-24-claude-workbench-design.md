# claude-workbench — diseño

**Fecha:** 2026-08-24
**Estado:** aprobado, pendiente de plan de implementación

## Objetivo

Unificar `claude-conductor` y `claude-brain` en un repo público que cualquiera
pueda clonar y usar sin heredar el stack ni los datos de quien lo escribió.

Tres requisitos que mandan sobre el resto:

1. **Nadie pierde funcionalidad.** Toda capacidad que hoy tiene cualquiera de
   los dos repos existe en el nuevo.
2. **Cero datos de personas o proyectos reales.** Todo valor concreto es un
   placeholder; lo real vive en config local, fuera del repo.
3. **El setup pregunta.** La primera vez configura; durante el flujo, ante un
   hueco, pregunta con opciones concretas en vez de asumir.

## Audiencia

Cualquiera que clone el repo. Es la decisión de la que se derivan casi todas
las demás: ninguna integración puede ser obligatoria, porque quien clona puede
no usar Orca, ni Discord, ni el mismo tracker.

## Decisiones tomadas

| Decisión | Elegido | Descartado y por qué |
|---|---|---|
| Nombre | `claude-workbench` | `claude-praxis` pide traducción; `claude-forge` está muy usado; `claude-maestro` sobrepondera la mitad de orquestación |
| Estructura | Núcleo compartido (`core/`) que las skills consumen | Skills autocontenidas replican el protocolo 5 veces; dos paquetes separados no unifican el setup |
| Capas de config | Tres, separadas | Dos capas mezclan lo detectado con lo declarado; un archivo único impide que el config del proyecto viaje con el proyecto |
| Falta una integración | Preguntar la primera vez, recordar la respuesta | El fallback automático elige sin contexto; el requisito duro le saca la skill entera a quien no tiene la integración |
| Historia del repo | Commit inicial limpio, sin importar | Importar exige otra pasada de reescritura y deja commits huérfanos servidos por SHA |

## Layout

```
claude-workbench/
├── install.sh                    único; reemplaza los dos actuales
├── core/
│   ├── capabilities.md           probes: cómo se detecta cada integración
│   ├── config-schema.md          las tres capas, campos y defaults
│   └── resolve.md                protocolo de preguntar-y-persistir
├── skills/
│   ├── conductor/
│   ├── ticket-workflow/
│   ├── bug-fix/
│   ├── code-review/
│   ├── feature-development/
│   └── TEMPLATE.md
├── knowledge/
│   ├── rules/
│   ├── playbooks/
│   ├── templates/
│   ├── checklists/
│   ├── examples/
│   └── architecture/
├── tools/
│   └── check-placeholders.sh
├── .github/workflows/placeholders.yml
└── docs/superpowers/specs/
```

`core/` no es código: son tres documentos que las skills citan. El protocolo
vive en un lugar y se referencia, en vez de repetirse en cinco skills que
pueden divergir.

`knowledge/` agrupa las seis carpetas de saber bajo un techo. Hoy compiten con
`skills/` en la raíz y hacen ilegible de qué se trata el repo al abrirlo.

## Configuración: tres capas

| Capa | Ruta | Contiene | Ciclo de vida |
|---|---|---|---|
| capabilities | `~/.claude/workbench/capabilities.json` | qué hay instalado, y qué se decidió ante lo que falta | re-detectable |
| user | `~/.claude/workbench/user.json`, `chmod 600` | handle, canal de anuncios, mención | se pregunta una vez |
| project | `<repo>/.claude/workbench.project.json` | tracker, ramas, reviewers, QA, repos del workspace | vive con el repo |

### capabilities: `detected` y `choices` separados

El archivo es re-detectable, y las decisiones del usuario viven en él. Si
re-detectar reescribiera todo, borraría las decisiones. Por eso va partido:
el probe sólo pisa `detected`; `choices` no se toca nunca.

```json
{
  "detected": { "orca": false, "gh": true, "tracker": "linear" },
  "choices":  { "worktrees": "git-worktree", "announce": "skip" }
}
```

Re-detectar Orca no vuelve a preguntar qué hacer sin Orca.

### user

Sólo lo que es de la persona y vale para cualquier proyecto: su handle del
remoto, la URL del canal de anuncios, y el nombre e id de la mención.

### project

Todo lo que es del proyecto. Absorbe el esquema que hoy tiene
`ticket-workflow` (tracker, prefijo, tipos de rama, idioma, rama base, labels
de ambiente, mapeo de tipos, convención de commits, patrón de rama, validador
de nombre de rama por CI, reviewers, QA) y recibe además cinco campos que hoy
están mal ubicados a nivel usuario.

### Recolocación de campos

Hoy `conductor.config.json` guarda a nivel usuario cosas que son del proyecto:
la lista de repos con sus tags, el id del repo wrapper en Orca, el workflow que
actúa de gate, la label de "ya anunciado", y la política de relay de gates.

Eso ata a un solo workspace: no se pueden conducir dos proyectos distintos sin
editar el config personal. Los cinco bajan a `project`, en el config del repo
wrapper. A nivel `user` quedan sólo el handle y el bloque de anuncios.

Es un cambio de forma respecto del config actual, y la migración lo absorbe.

### Migración

El instalador detecta un `~/.claude/conductor.config.json` existente y ofrece
importarlo, **mostrando el reparto por capa antes de escribir nada**. No se
pierde ningún valor ya configurado.

## Protocolo de resolución (`core/resolve.md`)

Se dispara ante tres clases de hueco:

1. **Falta una capability** — la integración no está instalada.
2. **Falta un valor de config** — el campo está vacío o ausente.
3. **La situación es ambigua** — dos caminos válidos, un check en rojo.

La forma es siempre la misma: **enumerar opciones concretas con su
consecuencia**. Nunca preguntar abierto cuando las opciones son enumerables.
"¿Qué hago?" es una mala pregunta; una lista numerada donde cada entrada dice
qué implica es una buena.

### Qué persiste y qué no

| Tipo | Ejemplo | Persiste |
|---|---|---|
| Preferencia permanente | "sin la integración de worktrees, usar el fallback de git" | sí, a `choices` |
| Hecho del proyecto | "la rama base de tal ambiente es tal" | sí, a `project` |
| Decisión de una vez | "esta PR va con otro reviewer" | **no** |

Sin la tercera fila el config se llena de respuestas de un solo uso, y meses
después aplica en silencio una decisión que se tomó para un caso puntual. Es el
modo más probable de que el sistema envejezca mal.

### Declaración de requisitos

Cada skill declara en una sección `## Requiere` las capabilities y los campos
que usa, con su capa. Tiene tres consumidores:

- el **instalador**, para preguntar de entrada lo que va a hacer falta;
- la **skill**, para chequear antes de empezar en vez de morir a la mitad;
- el **checker**, para validar que ninguna skill lea un campo que el schema no
  declara.

### Escape

Cualquier decisión guardada se puede desanclar con `askEveryTime`. Una
preferencia que no se puede cambiar deja de ser una preferencia.

## Primer run

Cinco pasos, cada uno reversible:

1. Detecta capabilities y muestra qué encontró.
2. Ofrece importar el config anterior, mostrando el reparto por capa.
3. Pregunta sólo los campos `user` que el probe no puede deducir.
4. Linkea las skills. **Si un symlink apunta a uno de los dos repos
   anteriores, ofrece repuntarlo** en vez de saltearlo en silencio — el
   instalador actual lo saltea, con lo cual se seguirían corriendo las skills
   viejas sin aviso.
5. Imprime el bloque de `CLAUDE.md` con las rutas de `knowledge/`.

El config `project` no se toca en el install: lo crea la skill la primera vez
que se trabaja en ese repo, que es cuando hay contexto para preguntarlo.

## Preservación de funcionalidad

| De | Qué | A |
|---|---|---|
| conductor | skill `conductor` y sus tres referencias | `skills/conductor/` |
| conductor | config de ejemplo | absorbido en `core/config-schema.md` |
| brain | cuatro skills y el `TEMPLATE.md` | `skills/` |
| brain | rules, playbooks, templates, checklists, examples, architecture | `knowledge/` |
| ambos | symlink de skills a `~/.claude/skills/` | `install.sh` unificado |
| brain | bloque de `CLAUDE.md` | `install.sh`, con rutas actualizadas |
| ambos | specs de diseño | `docs/superpowers/specs/`, saneados |

Nada se descarta. Los dos `config-schema.md` se fusionan en `core/` — es la
única fusión de contenido real; el resto es mudanza más saneamiento.

## Prevención de filtraciones

Dos chequeos independientes en `tools/check-placeholders.sh`, porque cada uno
agarra lo que el otro no puede.

### Data-driven

Compara los archivos commiteados contra los valores reales de las tres capas de
config. Agarra cualquier valor sin tener que nombrarlo en el repo, que es la
trampa del grep con nombres hardcodeados: ese chequeo *contiene* la filtración
que busca evitar.

**Si no encuentra valores contra los que comparar, falla.** Un chequeo que pasa
cuando no pudo correr es peor que no tenerlo: da la confianza sin el trabajo.
Cero valores cargados es un error, con el motivo impreso.

### Por forma

Patrones sensibles independientemente del valor: mails, identificadores de 15 a
22 dígitos, URLs de webhook, prefijos de token conocidos, headers de clave
privada, rutas absolutas de home, ids de ticket con prefijo real.

Con allowlist para las excepciones legítimas: dominios de ejemplo reservados
y `localhost`. Sin excepción para ninguna cuenta real, ni siquiera la del
dueño del repo en un link autorreferencial: todo lo relacionado a identidad
se configura localmente, fuera del repo.

### Cableado

En dos lugares, porque el hook se saltea con `--no-verify`:

- **pre-commit**, instalado por `install.sh` de forma opt-in, sobre el
  contenido *staged* y no el working tree;
- **CI**, en push y en pull request.

### Saneamiento del contenido migrado

El material que viene de `claude-brain` contiene, en archivos y en metadata de
commits: un id de ticket real, el nombre en clave de un proyecto, un login, el
slug completo de una feature interna, y dos direcciones de mail reales. Todo
eso se reemplaza por placeholders durante la mudanza, y el commit inicial
limpio evita que quede en la historia.

Este documento no nombra ninguno de esos valores a propósito: va a vivir en el
repo público, y nombrarlos sería repetir el error que el saneamiento corrige.

## Testing

- `install.sh` con `shellcheck`, y un run contra un `HOME` temporal que
  verifique **idempotencia** — es su promesa declarada ("safe to re-run") y hoy
  no está probada.
- `check-placeholders.sh` con fixtures: un config falso más archivos con
  filtraciones conocidas. El caso que más importa es el assert de que **falla
  cuando la lista de valores viene vacía**.
- Un script que valide que todo campo mencionado por una skill exista en
  `core/config-schema.md`, para que las cinco no se desincronicen del schema.

## Fuera de alcance

- Soporte de trackers más allá del que ya está integrado. La capa de
  capabilities deja el lugar; sumar otro tracker es trabajo aparte.
- Publicar el repo como plugin instalable. Por ahora se clona y se corre
  `install.sh`.
- Migrar automáticamente el `CLAUDE.md` del usuario. Se imprime el bloque para
  que lo pegue, igual que hoy, para no pisar sus instrucciones globales.

## Riesgos

- **La recolocación de campos rompe el config actual.** Mitigado por la
  migración con reparto visible, pero quien tenga scripts propios leyendo
  `conductor.config.json` los tiene que ajustar.
- **El repuntado de symlinks toca `~/.claude/skills/`.** Es el directorio del
  que depende Claude Code para descubrir skills. El instalador muestra qué va a
  cambiar y pide confirmación antes de tocar cada uno.
- **Historia fresca pierde el registro de desarrollo** de los dos repos. Los
  specs de diseño se preservan como archivos, que es donde está el
  razonamiento, pero los commits no vuelven.
