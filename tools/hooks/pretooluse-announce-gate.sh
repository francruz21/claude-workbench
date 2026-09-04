#!/usr/bin/env bash
#
# Hook de PreToolUse: deniega mandar el anuncio a Discord, y poner la label de
# anunciado, si el gate del ticket no se verifico en vivo.
#
# Por que existe. El guarda ya estaba escrito en la skill y se violo igual: un
# PR se anuncio con el gate de tests en `pending` porque el usuario habia pedido
# el anuncio "a las 9" y esa instruccion, mas reciente, le gano a una regla que
# vivia en un archivo que no se habia leido. Una regla en prosa se diluye a los
# 300 turnos. Un hook no.
#
# Que hace exactamente, y nada mas que eso:
#
#   1. `gh pr edit ... --add-label <notifiedLabel>` -> se deniega si el ticket
#      de ese PR no tiene el anuncio ya registrado en el registro. Es lo que
#      evita el peor caso: un PR marcado como anunciado sin anuncio, invisible
#      para la proxima pasada y que nadie anuncia nunca.
#
#   2. Cualquier comando que toque el canal de anuncios -> se deniega si no hay
#      un arm vigente de `conductor-ledger.sh announce-arm`, que es lo unico
#      que verifica el gate en vivo contra GitHub.
#
# Fuera de eso no opina. Si no hay registro para este workspace no es una sesion
# de conductor y todo pasa: los hijos, que corren en su propio worktree, nunca
# ven este hook actuar.
set -uo pipefail

# El payload entra por stdin. Con timeout, porque un PreToolUse colgado no
# frena un anuncio: frena cada tool call de la sesion. El harness ademas lo
# mata a los 10s, pero no se depende de eso.
if command -v timeout >/dev/null 2>&1; then
  PAYLOAD="$(timeout 5 cat 2>/dev/null || true)"
else
  PAYLOAD="$(cat 2>/dev/null || true)"
fi
LEDGER="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/conductor-ledger.sh"
CONFIG_DIR="${WORKBENCH_CONFIG_DIR:-$HOME/.claude/workbench}"

allow() { exit 0; }

deny() {
  # jq arma el JSON para que el motivo pueda tener comillas y saltos sin
  # romper la salida. Sin jq no se puede denegar prolijo, asi que se usa
  # exit 2 + stderr, que el harness tambien toma como bloqueo.
  if command -v jq >/dev/null 2>&1; then
    jq -nc --arg r "$1" '{hookSpecificOutput: {
       hookEventName: "PreToolUse",
       permissionDecision: "deny",
       permissionDecisionReason: $r}}'
    exit 0
  fi
  printf '%s\n' "$1" >&2
  exit 2
}

command -v jq >/dev/null 2>&1 || allow

TOOL="$(printf '%s' "$PAYLOAD" | jq -r '.tool_name // ""' 2>/dev/null || true)"
[ "$TOOL" = Bash ] || allow

CMD="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.command // ""' 2>/dev/null || true)"
[ -n "$CMD" ] || allow

# Sin registro para este workspace, esta sesion no esta conduciendo una tanda.
LEDGER_FILE="$(bash "$LEDGER" path 2>/dev/null || true)"
if [ -z "$LEDGER_FILE" ] || [ ! -f "$LEDGER_FILE" ]; then allow; fi

notified_label="$(jq -r '.notifiedLabel // ""' \
  "$(git rev-parse --show-toplevel 2>/dev/null)/.claude/workbench.project.json" 2>/dev/null || true)"
channel_url="$(jq -r '.announce.channelUrl // ""' "$CONFIG_DIR/user.json" 2>/dev/null || true)"

# --- 1. La label de anunciado ----------------------------------------------
if [ -n "$notified_label" ] &&
   printf '%s' "$CMD" | grep -qE 'gh +pr +edit' &&
   printf '%s' "$CMD" | grep -qF -- "--add-label" &&
   printf '%s' "$CMD" | grep -qF -- "$notified_label"; then

  pr_num="$(printf '%s' "$CMD" | grep -oE 'gh +pr +edit +[0-9]+' | grep -oE '[0-9]+$' | head -1)"
  if [ -z "$pr_num" ]; then
    deny "No pude leer el numero de PR de este comando, y la label '$notified_label' marca un PR como anunciado para siempre. Corre 'gh pr edit <n> --repo <owner/repo> --add-label $notified_label' con el numero explicito."
  fi

  estado="$(jq -r --argjson n "$pr_num" '
    [.tickets | to_entries[] | select(any(.value.prs[]?; .number == $n))][0]
    | if . == null then "SIN-REGISTRO"
      elif (.value.announced // null) == null then "SIN-ANUNCIO:" + .key
      else "OK" end' < "$LEDGER_FILE" 2>/dev/null || printf 'ERROR')"

  case "$estado" in
    OK) allow ;;
    SIN-REGISTRO)
      deny "El PR #$pr_num no esta en el registro de esta tanda, asi que no puedo saber si su anuncio salio. Registralo con 'conductor-ledger.sh pr-add <TICKET> --repo <owner/repo> --number $pr_num' antes de etiquetarlo." ;;
    SIN-ANUNCIO:*)
      deny "BLOQUEADO: la label '$notified_label' va DESPUES del envio verificado, no antes. ${estado#SIN-ANUNCIO:} no tiene anuncio registrado. Si el mensaje ya salio, verificalo en el canal y corre 'conductor-ledger.sh announced ${estado#SIN-ANUNCIO:}' primero. Si etiquetas antes, el PR queda marcado como anunciado con el mensaje sin llegar, invisible para la proxima pasada." ;;
    *)
      deny "No pude evaluar el estado del anuncio del PR #$pr_num en el registro. La label no se pone a ciegas: revisa '$LEDGER_FILE'." ;;
  esac
fi

# --- 2. El envio al canal de anuncios --------------------------------------
# Se reconoce por el canal configurado (su URL o su id), o por la pagina del
# canal que el conductor haya registrado con 'set <ticket> announcePage <id>'.
toca_canal=0
if [ -n "$channel_url" ]; then
  printf '%s' "$CMD" | grep -qF -- "$channel_url" && toca_canal=1
  chan_id="$(printf '%s' "$channel_url" | grep -oE '[0-9]{6,}' | tail -1)"
  if [ -n "$chan_id" ] && printf '%s' "$CMD" | grep -qF -- "$chan_id"; then toca_canal=1; fi
fi
if [ "$toca_canal" -eq 0 ]; then
  announce_page="$(jq -r '[.tickets[]?.announcePage // empty] | first // ""' \
    < "$LEDGER_FILE" 2>/dev/null || true)"
  if [ -n "$announce_page" ] &&
     printf '%s' "$CMD" | grep -qF -- "$announce_page" &&
     printf '%s' "$CMD" | grep -qE 'keypress|KeyboardEvent|terminal send|--key +Enter'; then
    toca_canal=1
  fi
fi
[ "$toca_canal" -eq 1 ] || allow

if bash "$LEDGER" announce-armed >/dev/null 2>&1; then
  allow
fi

deny "BLOQUEADO: no hay ningun ticket habilitado para anunciar. El disparador del anuncio es el gate en GREEN, no una hora ni un pedido: una hora pedida por el usuario agenda el anuncio, no autoriza saltear el gate. Corre 'conductor-ledger.sh announce-arm <TICKET>' -- verifica los checks en vivo contra GitHub y habilita el envio por 10 minutos. Si devuelve el gate en PENDING o SINCHECKS, todavia no es un PR verde: avisale al usuario con el estado y espera."
