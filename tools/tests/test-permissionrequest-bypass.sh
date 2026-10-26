#!/usr/bin/env bash
# Tests del hook de PermissionRequest (contesta los `ask` en bypass) y del
# rm-gate (la red que queda para `rm -r`).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tools/tests/lib.sh
. "$HERE/lib.sh"

BYPASS="$HERE/../hooks/permissionrequest-bypass.sh"
RMGATE="$HERE/../hooks/pretooluse-rm-gate.py"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export WORKBENCH_STATE_DIR="$TMP/state"

ask() {
  jq -nc --arg m "$1" '{hook_event_name: "PermissionRequest", permission_mode: $m,
    tool_name: "mcp__linear-server__save_comment", tool_input: {id: "c1", body: "x"}, cwd: "/w"}' \
  | bash "$BYPASS"
}

assert_contains '"behavior":"allow"' 'en bypass contesta allow' ask bypassPermissions
assert_contains 'save_comment' 'y lo deja anotado' cat "$TMP/state/auto-allowed.log"
assert_not_contains 'behavior' 'en modo default no opina: el dialogo sale' ask default
assert_not_contains 'behavior' 'en plan tampoco' ask plan
assert_exit 0 'una entrada rota no rompe la sesion' bash "$BYPASS" </dev/null

rm_cmd() { jq -nc --arg c "$1" '{tool_input: {command: $c}}' | python3 "$RMGATE"; }

# shellcheck disable=SC2016 # los $ son literales: es el comando que ve el hook
for c in 'rm -rf node_modules' 'rm -rf /tmp/x/y' 'cd a && rm -rf ./dist' \
         "rm -rf $HOME/Documentos/wt/edw-1-x" 'rm -rf $HOME/.cache/foo' 'rm -f /etc/hosts'; do
  assert_exit 0 "pasa: $c" rm_cmd "$c"
done
# shellcheck disable=SC2016
for c in 'rm -rf /' 'rm -rf /*' 'rm -rf ~' 'rm -rf ~/Documentos' 'rm -rf $HOME' \
         'rm -rf "$DIR"' 'rm -rf .' 'sudo rm -fr /usr/lib' 'rm -rf *' 'rm -r --no-preserve-root /home'; do
  assert_exit 2 "bloquea: $c" rm_cmd "$c"
done
assert_contains 'rm-gate' 'y dice quien lo bloqueo' rm_cmd 'rm -rf ~'

report 'test-permissionrequest-bypass'
