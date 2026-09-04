#!/usr/bin/env bash
# Tests del hook de PreToolUse que gatea el anuncio.
#
# Se le pasa por stdin el mismo payload que le pasa el harness y se mira lo que
# devuelve: `deny` con motivo, o nada (allow). Lo que se prueba es el juicio y,
# sobre todo, que NO opine de nada que no sea el anuncio: un hook de PreToolUse
# que bloquea de mas rompe todas las sesiones de la maquina.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tools/tests/lib.sh
. "$HERE/lib.sh"

HOOK="$HERE/../hooks/pretooluse-announce-gate.sh"
LEDGER="$HERE/../conductor-ledger.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export WORKBENCH_STATE_DIR="$TMP/state"
export WORKBENCH_CONFIG_DIR="$TMP/config"
mkdir -p "$WORKBENCH_CONFIG_DIR"
cat > "$WORKBENCH_CONFIG_DIR/user.json" <<'JSON'
{"author": "alguien", "announce": {"channelUrl": "https://discord.test/channels/111222333444/555666777888"}}
JSON

# Un workspace de mentira con su config de proyecto, porque el hook lee
# notifiedLabel desde la raiz del repo.
WS="$TMP/workspace"
mkdir -p "$WS/.claude"
git -c init.defaultBranch=main init -q "$WS"
cat > "$WS/.claude/workbench.project.json" <<'JSON'
{"notifiedLabel": "discord-notificado"}
JSON
export WORKBENCH_WORKSPACE="$WS"

led() { bash "$LEDGER" "$@"; }

# El hook resuelve notifiedLabel con `git rev-parse` sobre el cwd, asi que
# corre desde el workspace de mentira.
run_hook() {
  printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(printf '%s' "$1" | jq -Rs .)" |
    (cd "$WS" && bash "$HOOK")
}

# --- fuera de una tanda el hook no existe ----------------------------------
assert_not_contains 'deny' 'sin registro, la label pasa' \
  run_hook 'gh pr edit 376 --repo OWNER/REPO --add-label discord-notificado'
assert_not_contains 'deny' 'sin registro, el envio al canal pasa' \
  run_hook 'orca-ide keypress --page abc --key Enter https://discord.test/channels/111222333444/555666777888'

# Desde aca ya hay tanda.
led open TCK-1 --slug tck-1-un-slug-largo >/dev/null
led pr-add TCK-1 --repo OWNER/REPO --number 376 >/dev/null

# --- lo que el hook NO debe tocar ------------------------------------------
# Es la mitad importante del test: un PreToolUse que bloquea de mas es peor
# que el problema que viene a resolver.
for inocente in \
  'git status --porcelain' \
  'gh pr checks 376 --repo OWNER/REPO' \
  'gh pr view 376 --repo OWNER/REPO --json statusCheckRollup' \
  'gh pr create --base dev --title algo --body algo' \
  'gh pr edit 376 --repo OWNER/REPO --add-label otra-label' \
  'gh pr edit 376 --repo OWNER/REPO --body "texto"' \
  'docker ps -a' \
  'orca-ide keypress --page otra-pagina --key Enter' \
  'orca-ide worktree list --json' \
  'npm test' ; do
  assert_not_contains 'deny' "no toca: $inocente" run_hook "$inocente"
done

# Tampoco opina de otras tools.
run_hook_raw() { printf '%s' "$1" | (cd "$WS" && bash "$HOOK"); }
assert_not_contains 'deny' 'no toca las tools que no son Bash' \
  run_hook_raw '{"tool_name":"Read","tool_input":{"file_path":"/x"}}'
assert_not_contains 'deny' 'un payload sin comando pasa' \
  run_hook_raw '{"tool_name":"Bash","tool_input":{}}'

# --- 1. la label sin anuncio registrado ------------------------------------
assert_contains '"permissionDecision":"deny"' 'la label sin anuncio se deniega' \
  run_hook 'gh pr edit 376 --repo OWNER/REPO --add-label discord-notificado'
assert_contains 'va DESPUES del envio verificado' 'y explica el orden' \
  run_hook 'gh pr edit 376 --repo OWNER/REPO --add-label discord-notificado'
assert_contains 'TCK-1' 'y nombra el ticket' \
  run_hook 'gh pr edit 376 --repo OWNER/REPO --add-label discord-notificado'

# Un PR que no esta en el registro tampoco se etiqueta a ciegas.
assert_contains 'no esta en el registro' 'un PR ajeno al registro se deniega' \
  run_hook 'gh pr edit 999 --repo OWNER/REPO --add-label discord-notificado'

# Con el anuncio registrado, la label pasa.
# announced pide un arm vigente; announce-arm verifica contra GitHub de
# verdad, asi que aca se arma el registro a mano.
led pr-gate TCK-1 --number 376 --gate GREEN >/dev/null
LF="$(led path)" TK=TCK-1 python3 -c '
import json, os, time
p = os.environ["LF"]
d = json.load(open(p))
d["armedTicket"] = os.environ["TK"]
d["armedUntil"] = int(time.time()) + 600
json.dump(d, open(p, "w"))
'
led announced TCK-1 >/dev/null
assert_not_contains 'deny' 'con el anuncio registrado, la label pasa' \
  run_hook 'gh pr edit 376 --repo OWNER/REPO --add-label discord-notificado'

# --- 2. el envio al canal ---------------------------------------------------
led open TCK-2 --slug tck-2-otro-slug-largo >/dev/null
led pr-add TCK-2 --repo OWNER/REPO --number 380 >/dev/null

# `announced` consumio el arm de TCK-1, asi que no hay ninguno vigente.
assert_contains '"permissionDecision":"deny"' 'sin arm vigente, el envio se deniega' \
  run_hook 'orca-ide eval --page p --expression "..." https://discord.test/channels/111222333444/555666777888'
assert_contains 'El disparador del anuncio es el gate en GREEN, no una hora' \
  'y dice por que, con el caso del reloj' \
  run_hook 'orca-ide keypress --page p --key Enter https://discord.test/channels/111222333444/555666777888'
assert_contains 'announce-arm' 'y dice como destrabarlo' \
  run_hook 'orca-ide keypress --page p --key Enter https://discord.test/channels/111222333444/555666777888'

# Se reconoce el canal por su id, no solo por la URL entera.
assert_contains '"permissionDecision":"deny"' 'reconoce el canal por su id' \
  run_hook 'orca-ide eval --page 555666777888 --expression "send()"'

# Un arm a mano en el registro habilita el envio: el hook lee el arm, no
# reimplementa la verificacion (eso es de announce-arm, que llama a gh).
LF="$(led path)"
python3 - "$LF" <<'PY'
import json,sys,time
p=sys.argv[1]; d=json.load(open(p))
d['armedTicket']='TCK-2'; d['armedUntil']=int(time.time())+600
json.dump(d,open(p,'w'))
PY
assert_not_contains 'deny' 'con arm vigente, el envio pasa' \
  run_hook 'orca-ide keypress --page p --key Enter https://discord.test/channels/111222333444/555666777888'

# Un arm vencido no habilita nada.
python3 - "$LF" <<'PY'
import json,sys,time
p=sys.argv[1]; d=json.load(open(p))
d['armedUntil']=int(time.time())-1
json.dump(d,open(p,'w'))
PY
assert_contains '"permissionDecision":"deny"' 'un arm vencido no habilita' \
  run_hook 'orca-ide keypress --page p --key Enter https://discord.test/channels/111222333444/555666777888'

# --- announce-armed, que es lo que consulta el hook ------------------------
assert_exit 1 'announce-armed falla con el arm vencido' led announce-armed
python3 - "$LF" <<'PY'
import json,sys,time
p=sys.argv[1]; d=json.load(open(p))
d['armedUntil']=int(time.time())+600
json.dump(d,open(p,'w'))
PY
assert_exit 0 'announce-armed pasa con el arm vigente' led announce-armed
assert_contains 'TCK-2' 'y dice de que ticket es el arm' led announce-armed

# announced consume el arm: un envio no deja la puerta abierta para el proximo.
led pr-gate TCK-2 --number 380 --gate GREEN >/dev/null
led announced TCK-2 >/dev/null
assert_exit 1 'announced consume el arm' led announce-armed

report 'test-pretooluse-announce-gate'
