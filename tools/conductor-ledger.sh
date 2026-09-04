#!/usr/bin/env bash
#
# Registro en disco de una tanda del conductor.
#
# Por que existe: el registro "ticket -> {name, worktreeId, handle, taskId,
# dispatchId, qaTurn}" que la skill describe vivia en el contexto de la sesion.
# El contexto es append-only: no baja nunca, ni cuando el hijo se borra. Un
# conductor que condujo tres tickets arrastra los tres para siempre, y para el
# cuarto ya esta diluido.
#
# Con el registro en disco el conductor puede hacer lo contrario: cerrar un
# ticket, olvidar todo lo del hijo, y seguir con memoria de una linea por
# ticket cerrado. "close" es la operacion que hace ese olvido explicito.
#
# Salida: JSON en stdout para las lecturas de maquina, y "brief" en texto
# compacto para rehidratar una sesion nueva. Nada mas, para que leerlo cueste
# tokens de una linea y no de una investigacion.
set -euo pipefail

STATE_DIR="${WORKBENCH_STATE_DIR:-$HOME/.claude/workbench/state}"

die() { printf 'conductor-ledger: %s\n' "$1" >&2; exit "${2:-2}"; }

command -v jq >/dev/null 2>&1 || die 'falta jq, que es la dependencia de este script'

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# La clave del archivo sale de la ruta del workspace, saneada igual que las
# rutas de proyecto de Claude Code: "/" -> "-". Asi dos workspaces distintos
# nunca comparten registro, y la ruta es predecible sin tener que guardarla.
ledger_path() {
  local ws="$1" key
  key="$(printf '%s' "$ws" | sed 's#/#-#g')"
  printf '%s/conductor%s.json\n' "$STATE_DIR" "$key"
}

resolve_workspace() {
  if [ -n "${WORKBENCH_WORKSPACE:-}" ]; then printf '%s\n' "$WORKBENCH_WORKSPACE"; return; fi
  git rev-parse --show-toplevel 2>/dev/null ||
    die 'no se pudo resolver el workspace: corre esto dentro del wrapper, o pasa WORKBENCH_WORKSPACE'
}

# Toda escritura pasa por aca: lee, aplica el filtro jq, escribe a un temporal
# y renombra. El renombre es atomico en el mismo filesystem, asi que una
# corrida interrumpida no deja el registro a medias.
write_jq() {
  local file="$1"; shift
  local tmp; tmp="$(mktemp "${file}.XXXXXX")"
  if jq "$@" < "$file" > "$tmp"; then
    mv "$tmp" "$file"
  else
    rm -f "$tmp"
    die 'la escritura al registro fallo; el registro quedo como estaba' 1
  fi
}

ensure_ledger() {
  local ws file
  ws="$(resolve_workspace)"
  file="$(ledger_path "$ws")"
  if [ ! -f "$file" ]; then
    mkdir -p "$(dirname "$file")"
    jq -n --arg ws "$ws" --arg at "$(now)" \
      '{version: 1, workspace: $ws, createdAt: $at, tickets: {}}' > "$file"
  fi
  printf '%s\n' "$file"
}

need_ticket() {
  local file="$1" ticket="$2"
  jq -e --arg t "$ticket" '.tickets | has($t)' < "$file" >/dev/null 2>&1 ||
    die "el ticket $ticket no esta en el registro; abrilo primero con \"open\"" 1
}

usage() {
  cat <<'USAGE'
uso: conductor-ledger.sh <comando> [args]

  path                                   imprime la ruta del registro
  open <ticket> --slug S [--name N]      registra un ticket nuevo
  set <ticket> <clave> <valor>           escribe un campo (clave con puntos)
  child <ticket> [--worktree-id ID] [--handle H] [--task-id T] [--dispatch-id D]
  pr-add <ticket> --repo OWNER/REPO --number N [--url U]
  pr-gate <ticket> --number N --gate GREEN|RED|PENDING|SINCHECKS
  announced <ticket> [--message-url U]   marca el anuncio como enviado y verificado
  labelled <ticket>                      marca puesta la label de anunciado
  cleaned <ticket> [--images N] [--volumes N]
  close <ticket>                         colapsa la entrada y OLVIDA todo lo del hijo
  get <ticket>                           JSON de una entrada
  open-tickets                           IDs de los tickets todavia abiertos
  brief                                  estado de la tanda, compacto, para rehidratar
  list                                   el registro entero (JSON)

Variables: WORKBENCH_STATE_DIR (default ~/.claude/workbench/state),
           WORKBENCH_WORKSPACE (default: la raiz del repo actual).
USAGE
}

cmd="${1:-}"
if [ $# -gt 0 ]; then shift; fi

case "$cmd" in
  path)
    ledger_path "$(resolve_workspace)"
    ;;

  open)
    file="$(ensure_ledger)"
    ticket="${1:-}"; [ -n "$ticket" ] || die 'falta el ticket'
    shift
    slug=""; name=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --slug) slug="$2"; shift 2 ;;
        --name) name="$2"; shift 2 ;;
        *) die "opcion desconocida: $1" ;;
      esac
    done
    [ -n "$slug" ] || die 'falta --slug: es lo que ancla la limpieza al ticket'
    [ -n "$name" ] || name="$ticket"
    # Reabrir un ticket ya cerrado seria perder el rastro del anuncio, que es
    # justo lo que el registro existe para conservar. Se avisa y no se toca.
    if jq -e --arg t "$ticket" '.tickets[$t].state == "closed"' < "$file" >/dev/null 2>&1; then
      die "$ticket ya esta cerrado en el registro; usa \"set\" si de verdad hay que reabrirlo" 1
    fi
    write_jq "$file" --arg t "$ticket" --arg s "$slug" --arg n "$name" --arg at "$(now)" \
      '.tickets[$t] = ((.tickets[$t] // {}) + {
         slug: $s, name: $n, state: "open", updatedAt: $at,
         child: ((.tickets[$t].child) // {}),
         prs: ((.tickets[$t].prs) // []),
         announced: ((.tickets[$t].announced) // null),
         labelled: ((.tickets[$t].labelled) // false),
         cleaned: ((.tickets[$t].cleaned) // null)
       })'
    printf '%s abierto en el registro (slug %s)\n' "$ticket" "$slug"
    ;;

  set)
    file="$(ensure_ledger)"
    ticket="${1:-}"; key="${2:-}"; val="${3:-}"
    [ -n "$ticket" ] && [ -n "$key" ] || die 'uso: set <ticket> <clave> <valor>'
    need_ticket "$file" "$ticket"
    write_jq "$file" --arg t "$ticket" --arg at "$(now)" --arg v "$val" \
      "(.tickets[\$t].$key) = \$v | .tickets[\$t].updatedAt = \$at"
    printf '%s.%s = %s\n' "$ticket" "$key" "$val"
    ;;

  child)
    file="$(ensure_ledger)"
    ticket="${1:-}"; [ -n "$ticket" ] || die 'falta el ticket'
    shift
    need_ticket "$file" "$ticket"
    while [ $# -gt 0 ]; do
      case "$1" in
        --worktree-id) k=worktreeId ;;
        --handle)      k=handle ;;
        --task-id)     k=taskId ;;
        --dispatch-id) k=dispatchId ;;
        *) die "opcion desconocida: $1" ;;
      esac
      write_jq "$file" --arg t "$ticket" --arg k "$k" --arg v "$2" --arg at "$(now)" \
        '.tickets[$t].child[$k] = $v | .tickets[$t].updatedAt = $at'
      shift 2
    done
    printf '%s: datos del hijo actualizados\n' "$ticket"
    ;;

  pr-add)
    file="$(ensure_ledger)"
    ticket="${1:-}"; [ -n "$ticket" ] || die 'falta el ticket'
    shift
    need_ticket "$file" "$ticket"
    repo=""; number=""; url=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --repo)   repo="$2"; shift 2 ;;
        --number) number="$2"; shift 2 ;;
        --url)    url="$2"; shift 2 ;;
        *) die "opcion desconocida: $1" ;;
      esac
    done
    [ -n "$repo" ] && [ -n "$number" ] || die 'faltan --repo y --number'
    # Idempotente por (repo, number): registrar dos veces el mismo PR duplicaria
    # el monitor y podria disparar dos anuncios del mismo ticket.
    write_jq "$file" --arg t "$ticket" --arg r "$repo" --argjson n "$number" \
      --arg u "$url" --arg at "$(now)" \
      '.tickets[$t].prs = (
         [(.tickets[$t].prs // [])[] | select((.repo != $r) or (.number != $n))]
         + [{repo: $r, number: $n, url: $u, gate: "PENDING"}]
       ) | .tickets[$t].updatedAt = $at'
    printf '%s: PR %s#%s registrado\n' "$ticket" "$repo" "$number"
    ;;

  pr-gate)
    file="$(ensure_ledger)"
    ticket="${1:-}"; [ -n "$ticket" ] || die 'falta el ticket'
    shift
    need_ticket "$file" "$ticket"
    number=""; gate=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --number) number="$2"; shift 2 ;;
        --gate)   gate="$2"; shift 2 ;;
        *) die "opcion desconocida: $1" ;;
      esac
    done
    [ -n "$number" ] && [ -n "$gate" ] || die 'faltan --number y --gate'
    case "$gate" in
      GREEN|RED|PENDING|SINCHECKS|ERROR) : ;;
      *) die "gate invalido: $gate (GREEN|RED|PENDING|SINCHECKS|ERROR)" ;;
    esac
    write_jq "$file" --arg t "$ticket" --argjson n "$number" --arg g "$gate" --arg at "$(now)" \
      '.tickets[$t].prs = [(.tickets[$t].prs // [])[]
         | if .number == $n then .gate = $g else . end]
       | .tickets[$t].updatedAt = $at'
    printf '%s: PR #%s -> %s\n' "$ticket" "$number" "$gate"
    ;;

  announced)
    file="$(ensure_ledger)"
    ticket="${1:-}"; [ -n "$ticket" ] || die 'falta el ticket'
    shift
    need_ticket "$file" "$ticket"
    murl=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --message-url) murl="$2"; shift 2 ;;
        *) die "opcion desconocida: $1" ;;
      esac
    done
    # El anuncio solo se registra con todos los PRs del ticket en GREEN. Es el
    # mismo guarda que la skill pide y que un reloj no puede saltear: si el
    # gate no esta verde, no hay nada que anotar.
    if ! jq -e --arg t "$ticket" \
        '(.tickets[$t].prs | length) > 0 and all(.tickets[$t].prs[]; .gate == "GREEN")' \
        < "$file" >/dev/null 2>&1; then
      jq -r --arg t "$ticket" \
        '[.tickets[$t].prs[]? | "#\(.number)=\(.gate)"]
         | if length == 0 then "gates: (ningun PR registrado)"
           else "gates: " + join(" ") end' \
        < "$file" >&2
      die "$ticket no tiene todos sus PRs en GREEN: no se registra el anuncio" 1
    fi
    write_jq "$file" --arg t "$ticket" --arg u "$murl" --arg at "$(now)" \
      '.tickets[$t].announced = {at: $at, messageUrl: $u, verified: true}
       | .tickets[$t].updatedAt = $at'
    printf '%s: anuncio registrado\n' "$ticket"
    ;;

  labelled)
    file="$(ensure_ledger)"
    ticket="${1:-}"; [ -n "$ticket" ] || die 'falta el ticket'
    need_ticket "$file" "$ticket"
    jq -e --arg t "$ticket" '.tickets[$t].announced != null' < "$file" >/dev/null 2>&1 ||
      die "$ticket no tiene anuncio registrado: la label va despues del envio, no antes" 1
    write_jq "$file" --arg t "$ticket" --arg at "$(now)" \
      '.tickets[$t].labelled = true | .tickets[$t].updatedAt = $at'
    printf '%s: label de anunciado registrada\n' "$ticket"
    ;;

  cleaned)
    file="$(ensure_ledger)"
    ticket="${1:-}"; [ -n "$ticket" ] || die 'falta el ticket'
    shift
    need_ticket "$file" "$ticket"
    images=0; volumes=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --images)  images="$2"; shift 2 ;;
        --volumes) volumes="$2"; shift 2 ;;
        *) die "opcion desconocida: $1" ;;
      esac
    done
    write_jq "$file" --arg t "$ticket" --argjson i "$images" --argjson v "$volumes" --arg at "$(now)" \
      '.tickets[$t].cleaned = {at: $at, images: $i, volumes: $v}
       | .tickets[$t].updatedAt = $at'
    printf '%s: limpieza registrada\n' "$ticket"
    ;;

  close)
    file="$(ensure_ledger)"
    ticket="${1:-}"; [ -n "$ticket" ] || die 'falta el ticket'
    need_ticket "$file" "$ticket"
    # Un ticket se cierra anunciado y limpiado. Cerrarlo antes convertiria el
    # registro en la fuente que dice "esto ya esta" sobre trabajo abierto, que
    # es justo el error que hace que un PR verde se quede sin anunciar.
    jq -e --arg t "$ticket" '.tickets[$t].announced != null' < "$file" >/dev/null 2>&1 ||
      die "$ticket no esta anunciado: no se cierra" 1
    jq -e --arg t "$ticket" '.tickets[$t].cleaned != null' < "$file" >/dev/null 2>&1 ||
      die "$ticket no esta limpiado: no se cierra" 1
    # Aca esta el olvido. Sobrevive lo que el conductor tiene que poder decir
    # dentro de un mes: que ticket fue, que PRs salieron, cuando se anuncio y
    # cuando se limpio. Se va todo lo del hijo -- handles, taskId, dispatchId,
    # worktreeId, el turno de QA -- porque no hay hijo al que mandarselo.
    write_jq "$file" --arg t "$ticket" --arg at "$(now)" \
      '.tickets[$t] = {
         slug:       .tickets[$t].slug,
         name:       .tickets[$t].name,
         state:      "closed",
         prs:        [.tickets[$t].prs[]? | {repo, number, url}],
         announcedAt: .tickets[$t].announced.at,
         cleanedAt:   .tickets[$t].cleaned.at,
         closedAt:    $at
       }'
    printf '%s cerrado. Olvidate del hijo: handles, taskId, worktree y QA salieron del registro.\n' "$ticket"
    ;;

  get)
    file="$(ensure_ledger)"
    ticket="${1:-}"; [ -n "$ticket" ] || die 'falta el ticket'
    need_ticket "$file" "$ticket"
    jq --arg t "$ticket" '.tickets[$t]' < "$file"
    ;;

  open-tickets)
    file="$(ensure_ledger)"
    jq -r '.tickets | to_entries[] | select(.value.state != "closed") | .key' < "$file"
    ;;

  brief)
    file="$(ensure_ledger)"
    jq -r '
      def gates: if (.prs | length) == 0 then "sin PR"
                 else ([.prs[] | "#\(.number)=\(.gate)"] | join(" ")) end;
      def prlist: ([.prs[]? | "\(.repo)#\(.number)"] | join(", "));
      "REGISTRO  " + .workspace,
      "",
      "ABIERTOS  (" + ((.tickets | to_entries | map(select(.value.state != "closed")) | length) | tostring) + ")",
      ( (.tickets | to_entries | map(select(.value.state != "closed")) | sort_by(.key) | .[])
        | "  " + .key + "  " + .value.slug
          + "\n      gate: " + (.value | gates)
          + "  |  anunciado: " + (if .value.announced then "si" else "NO" end)
          + "  |  label: " + (if .value.labelled then "si" else "no" end)
          + "\n      hijo: handle=" + (.value.child.handle // "-")
          + " worktree=" + (.value.child.worktreeId // "-")
      ),
      "",
      "CERRADOS  (" + ((.tickets | to_entries | map(select(.value.state == "closed")) | length) | tostring) + ") -- una linea, sin contexto del hijo",
      ( (.tickets | to_entries | map(select(.value.state == "closed")) | sort_by(.value.closedAt) | .[])
        | "  " + .key + "  " + (.value | prlist)
          + "  anunciado " + (.value.announcedAt // "-")
      )
    ' < "$file"
    ;;

  list)
    file="$(ensure_ledger)"
    cat "$file"
    ;;

  -h|--help|help|"")
    usage
    ;;

  *)
    die "comando desconocido: $cmd"
    ;;
esac
