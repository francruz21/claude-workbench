#!/usr/bin/env bash
#
# Fase 6 del conductor en un comando: las tres verificaciones, y con las tres en
# verde borrar el worktree, las imagenes y los volumenes del ticket.
#
# Por que existe: hecha a mano, esta fase son ~30 turnos de Bash en el contexto
# del padre -- verificar el wrapper, verificar cada submodulo, mirar containers,
# medir tamanos, borrar, reportar. El padre paga en contexto el orden que hace.
# Aca entra un slug y sale una linea.
#
# La regla de reference/cleanup.md se mantiene entera: las tres verificaciones
# son condicion obligatoria, el filtro va anclado al slug, y nunca hay un prune
# global. Si algo no esta limpio no se borra nada y se dice que quedo y donde.
#
# Salida: una linea en stdout. Exit 0 limpiado, 1 no se toco nada (algo sucio),
# 2 error de uso o de entorno.
set -euo pipefail

SLUG=""
WORKTREE_PATH=""
WORKTREE_ID=""
TICKET=""
DRY_RUN=0

die() { printf 'conductor-cleanup: %s\n' "$1" >&2; exit "${2:-2}"; }

usage() {
  cat <<'USAGE'
uso: conductor-cleanup.sh --slug <slug-del-worktree> [opciones]

  --slug S           el slug del worktree; ancla TODO el filtrado (obligatorio)
  --path P           ruta del worktree (si no, se resuelve por orca-ide)
  --worktree-id ID   id de Orca para el borrado (si no, se resuelve por slug)
  --ticket T         id del ticket, solo para el reporte
  --dry-run          verifica y dice que borraria, sin borrar nada

Exit: 0 limpiado -- 1 nada se toco, algo estaba sucio -- 2 uso o entorno.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --slug)        SLUG="$2"; shift 2 ;;
    --path)        WORKTREE_PATH="$2"; shift 2 ;;
    --worktree-id) WORKTREE_ID="$2"; shift 2 ;;
    --ticket)      TICKET="$2"; shift 2 ;;
    --dry-run)     DRY_RUN=1; shift ;;
    -h|--help)     usage; exit 0 ;;
    *)             die "opcion desconocida: $1" ;;
  esac
done

# --- Guarda del slug -------------------------------------------------------
# El slug entra en tres "grep -F" que alimentan tres "docker ... rm". Un slug
# vacio hace que grep matchee todas las lineas, y eso borra las imagenes y los
# volumenes de la maquina entera -- incluidos los de los tickets vivos. Por eso
# el slug se valida antes que nada y con criterio estrecho: no vacio, sin
# espacios, y lo bastante largo para no ser un prefijo generico.
[ -n "$SLUG" ] || { usage >&2; die 'falta --slug'; }
case "$SLUG" in
  *[[:space:]]*) die "el slug no puede tener espacios: '$SLUG'" ;;
esac
[ "${#SLUG}" -ge 6 ] ||
  die "el slug '$SLUG' es demasiado corto (minimo 6): un filtro corto alcanza tickets que no son de este"

[ -n "$TICKET" ] || TICKET="$SLUG"

have() { command -v "$1" >/dev/null 2>&1; }
have git || die 'falta git'

# --- Resolver el worktree --------------------------------------------------
if [ -z "$WORKTREE_PATH" ]; then
  have orca-ide || die 'sin --path hace falta orca-ide para resolver el worktree'
  have jq || die 'falta jq para leer la salida de orca-ide'
  WT_JSON="$(orca-ide worktree list --json 2>/dev/null || true)"
  [ -n "$WT_JSON" ] || die 'orca-ide worktree list no devolvio nada'
  WORKTREE_PATH="$(printf '%s' "$WT_JSON" | jq -r --arg s "$SLUG" '
    [.. | objects | select(has("path")) | select(.path | tostring | contains($s))][0].path // empty' 2>/dev/null || true)"
  [ -n "$WORKTREE_PATH" ] || die "no encontre ningun worktree cuyo path contenga '$SLUG'" 1
  if [ -z "$WORKTREE_ID" ]; then
    WORKTREE_ID="$(printf '%s' "$WT_JSON" | jq -r --arg s "$SLUG" '
      [.. | objects | select(has("path")) | select(.path | tostring | contains($s))][0].id // empty' 2>/dev/null || true)"
  fi
fi

[ -d "$WORKTREE_PATH" ] || die "el worktree no existe en disco: $WORKTREE_PATH" 1

# --- Las tres verificaciones ------------------------------------------------
# Se acumulan hallazgos en vez de cortar en el primero: el reporte tiene que
# decir todo lo que quedo sucio de una vez, no obligar a correr esto tres veces.
DIRTY=""
note_dirty() { DIRTY="${DIRTY}  - $1"$'\n'; }

check_repo() {
  local dir="$1" label="$2" branch st ahead stash
  st="$(git -C "$dir" status --porcelain 2>/dev/null || printf 'ERROR')"
  if [ "$st" = ERROR ]; then
    note_dirty "$label: no se pudo leer el estado de git ($dir)"
    return
  fi
  [ -z "$st" ] || note_dirty "$label: cambios sin commitear en $dir"

  branch="$(git -C "$dir" branch --show-current 2>/dev/null || true)"
  if [ -z "$branch" ]; then
    # detached HEAD: cleanup.md lo trata como sucio, y ademas el filtro del
    # stash no se puede armar sin nombre de rama.
    note_dirty "$label: detached HEAD en $dir -- que lo mire el usuario"
    return
  fi

  # Sin upstream, "@{u}..HEAD" falla. Eso es lo esperado hasta que el humano
  # publica la rama, y sigue siendo trabajo sin publicar: no se borra.
  if ! git -C "$dir" rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    note_dirty "$label: la rama $branch no tiene upstream -- todavia sin publicar, en $dir"
  else
    ahead="$(git -C "$dir" log '@{u}..HEAD' --oneline 2>/dev/null || printf 'ERROR')"
    if [ "$ahead" = ERROR ]; then
      note_dirty "$label: no se pudo comparar contra el upstream en $dir"
    elif [ -n "$ahead" ]; then
      note_dirty "$label: commits sin pushear en $branch ($dir)"
    fi
  fi

  # Los stashes son globales del repo, no del worktree: sin filtrar por la rama
  # el chequeo da falso positivo y este worktree no se puede borrar nunca.
  stash="$(git -C "$dir" stash list 2>/dev/null | grep -F "$branch" || true)"
  [ -z "$stash" ] || note_dirty "$label: hay stash de la rama $branch ($dir)"
}

check_repo "$WORKTREE_PATH" "wrapper"

# Cada submodulo que el ticket toco. El wrapper puede estar limpio con un
# submodulo sucio adentro, que es el caso mas probable: el trabajo real pasa
# en los submodulos.
if [ -f "$WORKTREE_PATH/.gitmodules" ]; then
  while IFS= read -r sub; do
    [ -n "$sub" ] || continue
    check_repo "$WORKTREE_PATH/$sub" "submodulo $sub"
    # shellcheck disable=SC2016  # $sm_path lo expande git, no el shell
  done < <(git -C "$WORKTREE_PATH" submodule --quiet foreach 'printf "%s\n" "$sm_path"' 2>/dev/null || true)
fi

# --- Containers del ticket, aunque esten parados ---------------------------
# "docker image rm" y "docker volume rm" fallan mientras un container -- aunque
# este parado -- referencie esa imagen o ese volumen.
CONTAINERS=""
if have docker; then
  CONTAINERS="$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep -F "$SLUG" || true)"
  [ -z "$CONTAINERS" ] || note_dirty "quedan containers del ticket: $(printf '%s' "$CONTAINERS" | tr '\n' ' ')"
fi

if [ -n "$DIRTY" ]; then
  printf '%s · %s NO se limpio. Quedo:\n%s' "$TICKET" "$SLUG" "$DIRTY"
  exit 1
fi

# --- Lo que se va a borrar --------------------------------------------------
IMAGES=""; VOLUMES=""
if have docker; then
  IMAGES="$(docker image ls --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -F "$SLUG" || true)"
  VOLUMES="$(docker volume ls --format '{{.Name}}' 2>/dev/null | grep -F "$SLUG" || true)"
fi
n_img=0; n_vol=0
[ -z "$IMAGES" ]  || n_img="$(printf '%s\n' "$IMAGES"  | grep -c . || true)"
[ -z "$VOLUMES" ] || n_vol="$(printf '%s\n' "$VOLUMES" | grep -c . || true)"

if [ "$DRY_RUN" -eq 1 ]; then
  printf '%s · %s limpiable: worktree %s, %s imagenes, %s volumenes. (dry-run, no se borro nada)\n' \
    "$TICKET" "$SLUG" "$WORKTREE_PATH" "$n_img" "$n_vol"
  exit 0
fi

# --- Borrar ----------------------------------------------------------------
FAILED=""
if [ -n "$WORKTREE_ID" ] && have orca-ide; then
  if ! orca-ide worktree rm --worktree "id:$WORKTREE_ID" --force --json >/dev/null 2>&1; then
    FAILED="${FAILED}worktree "
  fi
else
  # Sin id de Orca se cae a git. "worktree remove" tiene que correr desde otro
  # worktree del mismo repo, no desde el que se borra: el primero que lista
  # "worktree list --porcelain" es el principal.
  MAIN_WT="$(git -C "$WORKTREE_PATH" worktree list --porcelain 2>/dev/null |
             awk '/^worktree /{print $2; exit}')"
  if [ -n "$MAIN_WT" ] && [ "$MAIN_WT" != "$WORKTREE_PATH" ]; then
    if ! git -C "$MAIN_WT" worktree remove --force "$WORKTREE_PATH" >/dev/null 2>&1; then
      FAILED="${FAILED}worktree "
    fi
  else
    FAILED="${FAILED}worktree(sin-id-de-orca-y-sin-worktree-principal) "
  fi
fi

if [ -n "$IMAGES" ]; then
  printf '%s\n' "$IMAGES" | xargs -r docker image rm >/dev/null 2>&1 || FAILED="${FAILED}imagenes "
fi
if [ -n "$VOLUMES" ]; then
  printf '%s\n' "$VOLUMES" | xargs -r docker volume rm >/dev/null 2>&1 || FAILED="${FAILED}volumenes "
fi

if [ -n "$FAILED" ]; then
  printf '%s · %s limpiado a medias. Fallo borrar: %s\n' "$TICKET" "$SLUG" "$FAILED"
  exit 1
fi

printf '%s · %s limpiado: worktree, %s imagenes y %s volumenes.\n' "$TICKET" "$SLUG" "$n_img" "$n_vol"
