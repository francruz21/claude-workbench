#!/usr/bin/env bash
#
# Publica la rama de trabajo actual en `origin`, y nada mas que eso.
#
# Por que existe. En repos donde el harness bloquea todo `git push` (el guard
# del workspace es de todo el equipo y no se toca), este script es la unica
# puerta para que un agente publique la rama de su ticket. La puerta es
# angosta a proposito: no recibe refspec ni rama, empuja HEAD a una rama del
# mismo nombre y valida antes de empujar.
#
#   - La rama actual cumple `branchNameCI.pattern` del config de proyecto
#     (`<repo>/.claude/workbench.project.json`, o el del superproyecto cuando
#     el repo es un submodulo sin config propio). Sin patron, no publica.
#   - La rama no es una rama de ambiente: ni las de la lista fija, ni
#     `baseBranch`, ni ninguna de `baseBranchFromTicketLabel`.
#   - Sin force, nunca: si el remoto tiene commits que HEAD no contiene, para.
#   - Propiedad. Si la rama ya existe en el remoto, solo se empuja si la
#     publico este flujo en este clon (marca `branch.<rama>.workbenchPublished`)
#     o si la punta remota es un commit tuyo (mismo `user.email`). La rama de
#     un compañero que se llame igual no se toca.
#
# Uso: publish-branch.sh [-C <dir>] [--dry-run]
#   --dry-run  valida y dice que haria, sin empujar.
# Salida: 0 publicado (o validado en dry-run), 1 rechazado, 2 uso invalido.
set -uo pipefail

DIR="."
DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    -C) [ $# -ge 2 ] || { echo "publish-branch: -C necesita un directorio" >&2; exit 2; }
        DIR="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,/^set -uo/p' "$0" | sed 's/^# \{0,1\}//; /^set -uo/d'; exit 0 ;;
    *) echo "publish-branch: argumento no admitido: $1 (no recibe rama ni refspec: publica la rama actual)" >&2; exit 2 ;;
  esac
done

refuse() { printf 'publish-branch: NO publicado: %s\n' "$1" >&2; exit 1; }

command -v jq >/dev/null 2>&1 || refuse "falta jq para leer el config de proyecto"
G() { git -C "$DIR" "$@"; }

TOP="$(G rev-parse --show-toplevel 2>/dev/null)" || refuse "$DIR no es un repo git"
BRANCH="$(G symbolic-ref --quiet --short HEAD 2>/dev/null)" || refuse "HEAD esta desacoplado: no hay rama que publicar"
HEAD_SHA="$(G rev-parse HEAD)"

# Config: el del repo, o el del superproyecto si es un submodulo sin config.
CONFIG=""
for cand in "$TOP/.claude/workbench.project.json" \
            "$(G rev-parse --show-superproject-working-tree 2>/dev/null)/.claude/workbench.project.json"; do
  [ -f "$cand" ] && { CONFIG="$cand"; break; }
done
[ -n "$CONFIG" ] || refuse "no hay .claude/workbench.project.json en el repo ni en su superproyecto"

PATTERN="$(jq -r '.branchNameCI.pattern // empty' "$CONFIG")"
[ -n "$PATTERN" ] || refuse "el config ($CONFIG) no declara branchNameCI.pattern"

PROTECTED="dev stage staging master main design prod production release develop"
PROTECTED="$PROTECTED $(jq -r '[.baseBranch // empty] + [(.baseBranchFromTicketLabel // {})[]] | join(" ")' "$CONFIG")"
for p in $PROTECTED; do
  [ "$BRANCH" = "$p" ] && refuse "'$BRANCH' es una rama de ambiente"
done
case "$BRANCH" in release/*|hotfix-release/*) refuse "'$BRANCH' es una rama de release" ;; esac

printf '%s' "$BRANCH" | grep -qE -- "$PATTERN" \
  || refuse "'$BRANCH' no cumple el patron de rama del repo ($PATTERN)"

G remote get-url origin >/dev/null 2>&1 || refuse "el repo no tiene remoto 'origin'"

REMOTE_SHA="$(G ls-remote --heads origin "refs/heads/$BRANCH" 2>/dev/null | awk '{print $1}')"
MARK="$(G config --bool --get "branch.$BRANCH.workbenchPublished" 2>/dev/null || true)"

if [ -n "$REMOTE_SHA" ]; then
  if [ "$MARK" != true ]; then
    G cat-file -e "$REMOTE_SHA^{commit}" 2>/dev/null || G fetch -q origin "refs/heads/$BRANCH" 2>/dev/null || true
    TIP_EMAIL="$(G log -1 --format=%ae "$REMOTE_SHA" 2>/dev/null || true)"
    ME="$(G config user.email || true)"
    if [ -z "$TIP_EMAIL" ] || [ "$TIP_EMAIL" != "$ME" ]; then
      refuse "'$BRANCH' ya existe en origin y no la publico este flujo (punta de ${TIP_EMAIL:-desconocido}): no es tuya"
    fi
  fi
  if [ "$REMOTE_SHA" = "$HEAD_SHA" ]; then
    printf 'publish-branch: %s ya esta publicada en %s, nada que empujar\n' "$BRANCH" "$HEAD_SHA"
    exit 0
  fi
  G cat-file -e "$REMOTE_SHA^{commit}" 2>/dev/null || G fetch -q origin "refs/heads/$BRANCH" 2>/dev/null || true
  G merge-base --is-ancestor "$REMOTE_SHA" HEAD 2>/dev/null \
    || refuse "origin/$BRANCH tiene commits que HEAD no contiene: traelos con merge, sin force"
fi

if [ "$DRY" = 1 ]; then
  printf 'publish-branch: dry-run OK: empujaria %s -> origin/%s\n' "$HEAD_SHA" "$BRANCH"
  exit 0
fi

G push --set-upstream origin "HEAD:refs/heads/$BRANCH" || refuse "git push fallo (ver arriba)"
G config "branch.$BRANCH.workbenchPublished" true

# Se mide contra el remoto: `@{u}` puede mentir.
AFTER="$(G ls-remote --heads origin "refs/heads/$BRANCH" | awk '{print $1}')"
[ "$AFTER" = "$HEAD_SHA" ] || refuse "el push termino pero origin/$BRANCH apunta a ${AFTER:-nada}, no a $HEAD_SHA"
printf 'publish-branch: publicado %s -> origin/%s\n' "$HEAD_SHA" "$BRANCH"
