# Schema de configuracion: tres capas

Este documento define, campo por campo, las tres capas de configuracion que
usan las skills de este repo. Las tres rutas exactas:

- `~/.claude/workbench/capabilities.json`
- `~/.claude/workbench/user.json` (`chmod 600`)
- `<repo-de-trabajo>/.claude/workbench.project.json`

**Nada de esto entra al repo.** Ninguno de estos tres archivos se commitea:
viven fuera del control de versiones, y los valores de ejemplo de este
documento son siempre placeholders. `tools/check-placeholders.sh` bloquea el
commit de un valor real de cualquiera de las tres capas.

Cada skill declara, en su seccion `## Requiere`, los campos de estas tablas
que necesita (ver `core/resolve.md`). `tools/check-schema-refs.sh` valida que
todo campo que una skill referencia exista en alguna de las tablas de abajo,
y que toda skill declare esa seccion.

## Capa `capabilities`

Ruta: `~/.claude/workbench/capabilities.json`.

El archivo se parte en dos objetos, `detected` y `choices`, y la particion no
es cosmetica: **el probe de capabilities solo pisa `detected`**. Cada vez que
se re-corre la deteccion (por ejemplo porque se instalo `gh`), el probe
reescribe `detected` entero y no toca `choices`. Si el archivo fuera plano, un
re-detect no tendria forma de distinguir "esto lo volvi a medir" de "esto lo
decidio una persona", y pisaria decisiones tomadas.

La linea que separa un campo de `detected` de uno de `choices` es mecanica y
no de gusto: **un probe responde por hechos del sistema — algo instalado o
no, algo presente o no — y una eleccion del usuario se pregunta, nunca se
detecta.** Mezclar las dos es exactamente lo que haria que re-detectar borre
una decision: si `worktrees` viviera en `detected`, la siguiente corrida del
probe podria pisar la respuesta que la persona ya dio.

### `detected` — solo hechos del sistema

| Campo | Tipo | Que hecho describe |
|---|---|---|
| `orca` | boolean | si el CLI `orca-ide` esta disponible en el PATH |
| `gh` | boolean | si el CLI `gh` esta disponible en el PATH |
| `python3` | boolean | si `python3` esta disponible en el PATH |

### `choices` — todo lo que es una decision, no un hecho

| Campo | Tipo | Elige entre |
|---|---|---|
| `tracker` | string \| null | el tracker de tickets a usar; `null` si no se elegio ninguno todavia |
| `worktrees` | string | `"orca"` \| `"git-worktree"` \| `"checkout"` |
| `announce` | string | `"canal"` \| `"skip"` |
| `askEveryTime` | string[] | claves de `choices` a re-preguntar siempre en vez de usar el valor guardado |

`tracker` va en `choices` y no en `detected` a proposito: aunque el probe
pueda ver que hay mas de un tracker instalado, cual usar sigue siendo una
eleccion de la persona, no algo que el sistema revele por si solo.

### Ejemplo completo

```json
{
  "detected": {
    "orca": false,
    "gh": true,
    "python3": true
  },
  "choices": {
    "tracker": "<nombre-del-tracker>",
    "worktrees": "git-worktree",
    "announce": "skip",
    "askEveryTime": []
  }
}
```

## Capa `user`

Ruta: `~/.claude/workbench/user.json`, con permisos `chmod 600` porque puede
contener un id de mencion.

Solo lo que pertenece a la persona y vale igual para cualquier proyecto en el
que trabaje:

| Campo | Tipo | Contenido |
|---|---|---|
| `author` | string | handle del remoto (ej. de GitHub) de la persona |
| `announce.channelUrl` | string | URL del canal donde se anuncian los avisos |
| `announce.mention.name` | string | nombre a mencionar en un anuncio |
| `announce.mention.id` | string (opcional) | id de la mencion, si el canal lo requiere |

### Ejemplo completo

```json
{
  "author": "<handle-del-remoto>",
  "announce": {
    "channelUrl": "<url-del-canal>",
    "mention": {
      "name": "<nombre-a-mencionar>",
      "id": "<id-opcional-de-la-mencion>"
    }
  }
}
```

## Capa `project`

Ruta: `<repo-de-trabajo>/.claude/workbench.project.json`. Vive con el repo:
cada workspace tiene el suyo, y viaja junto con el checkout.

Absorbe todo el esquema que hoy tiene `ticket-workflow`, mas cinco campos que
bajan desde la capa de usuario (ver la seccion siguiente).

| Campo | Tipo | Contenido |
|---|---|---|
| `trackerPrefix` | string | prefijo de los ids de ticket de este proyecto |
| `tracker` | string | tracker usado por este proyecto |
| `branchTypes` | string[] | tipos de rama admitidos (ej. feature, fix) |
| `descriptionLanguage` | string | idioma de las descripciones de PR/commit |
| `baseBranch` | string | rama base por defecto |
| `baseBranchFromTicketLabel` | object | mapeo de label de ticket a rama base |
| `environmentLabelGroup` | string | nombre del grupo de labels de ambiente |
| `environmentLabels` | string[] | labels de ambiente admitidas |
| `typeLabelMap` | object | mapeo de tipo de rama a label |
| `commitConvention` | string | convencion de mensajes de commit |
| `branchPattern` | string | patron de nombre de rama |
| `branchNameCI` | boolean | si CI valida el nombre de rama contra `branchPattern` |
| `orca.repoId` | string | id del repo en Orca |
| `orca.useWorktrees` | boolean | si este proyecto usa worktrees de Orca |
| `orca.worktreeLevel` | string | nivel de anidamiento de los worktrees |
| `reviewers` | string[] | reviewers por defecto de este proyecto |
| `qa` | object | configuracion de QA del proyecto |
| `repos` | array de `{slug, tag}` | repos del workspace que este proyecto conduce |
| `orca.wrapperRepoId` | string | id en Orca del repo wrapper que agrupa `repos` |
| `gateWorkflow` | string | workflow de CI que actua de gate antes de anunciar |
| `notifiedLabel` | string | label que marca un ticket como ya anunciado |
| `relayGates` | `"all"` \| `"judgment-only"` | que gates viajan hasta el usuario. `"all"` releva los cinco y es el default. `"judgment-only"` deja que el conductor responda los dos derivables de labels (tipo de rama y rama base) y releva craneo, QA y PR siempre; es una concesion para tandas grandes, no el default |

### Por que esos cinco campos bajaron de `user` a `project`

`repos`, `orca.wrapperRepoId`, `gateWorkflow`, `notifiedLabel` y `relayGates`
vivian antes a nivel usuario. A ese nivel atan a la persona a un solo
workspace: si se quieren conducir dos proyectos distintos, hay que editar el
config personal cada vez que se cambia de uno a otro. Bajarlos a `project`
significa que cada repo lleva su propia respuesta, y trabajar en dos a la vez
no exige tocar nada compartido.

### Ejemplo completo

```json
{
  "trackerPrefix": "<PREFIJO>",
  "tracker": "<nombre-del-tracker>",
  "branchTypes": ["feature", "fix"],
  "descriptionLanguage": "es",
  "baseBranch": "<rama-base>",
  "baseBranchFromTicketLabel": { "<label-de-ambiente>": "<rama-base>" },
  "environmentLabelGroup": "<nombre-del-grupo>",
  "environmentLabels": ["<label-1>", "<label-2>"],
  "typeLabelMap": { "feature": "<label-de-tipo>" },
  "commitConvention": "conventional-commits",
  "branchPattern": "<tipo>/<id-de-ticket>-<slug>",
  "branchNameCI": true,
  "orca": {
    "repoId": "<id-de-repo-en-orca>",
    "useWorktrees": true,
    "worktreeLevel": "<nivel>",
    "wrapperRepoId": "<id-del-repo-wrapper>"
  },
  "reviewers": ["<handle-reviewer>"],
  "qa": { "<clave-de-qa>": "<valor-de-qa>" },
  "repos": [{ "slug": "<slug-de-repo>", "tag": "<tag-de-repo>" }],
  "gateWorkflow": "<nombre-del-workflow>",
  "notifiedLabel": "<label-de-ya-anunciado>",
  "relayGates": "all"
}
```
