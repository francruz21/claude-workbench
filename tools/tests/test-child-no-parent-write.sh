#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=tools/tests/lib.sh
. "$HERE/lib.sh"

HOOK="$REPO/tools/hooks/pretooluse-child-no-parent-write.py"
CHILD="repo::/srv/orca/workspaces/app/tck-1-x"
PARENT="repo::/srv/app"

# run <worktree-id> <command>: feeds the hook a Bash tool call
run() {
  printf '{"tool_input":{"command":%s}}' "$(printf '%s' "$2" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    | ORCA_WORKTREE_ID="$1" ORCA_TERMINAL_HANDLE=term_me python3 "$HOOK"
}

assert_exit 2 "hijo: terminal send a otra terminal se bloquea" \
  run "$CHILD" 'orca-ide terminal send --terminal term_parent --text hola --enter'
assert_exit 2 "hijo: terminal send con --terminal=otra se bloquea" \
  run "$CHILD" 'orca terminal send --terminal=term_parent --text hola'
assert_exit 2 "hijo: terminal send escondido tras && se bloquea" \
  run "$CHILD" 'cd /tmp && orca-ide terminal send --terminal term_parent --text x'
assert_exit 0 "hijo: terminal send a su propia terminal pasa" \
  run "$CHILD" 'orca-ide terminal send --terminal term_me --text x'
assert_exit 0 "hijo: orchestration send status pasa (canal interno)" \
  run "$CHILD" 'orca-ide orchestration send --to term_parent --subject avance --type status'
assert_exit 0 "hijo: orchestration send sin tipo pasa (canal interno)" \
  run "$CHILD" 'orca-ide orchestration send --to term_parent --subject nota'
assert_exit 0 "hijo: worker_done pasa" \
  run "$CHILD" 'orca-ide orchestration send --to term_parent --subject done --type worker_done'
assert_exit 0 "hijo: escalation pasa" \
  run "$CHILD" 'orca-ide orchestration send --to term_parent --subject trabado --type escalation'
assert_exit 0 "hijo: heartbeat pasa" \
  run "$CHILD" 'orca-ide orchestration send --to term_parent --subject alive --type heartbeat'
assert_exit 0 "hijo: ask pasa" \
  run "$CHILD" 'orca-ide orchestration ask --to term_parent --question "turno?"'
assert_exit 0 "hijo: reply pasa" \
  run "$CHILD" 'orca-ide orchestration reply --id msg_1 --body ok'
assert_exit 0 "padre: terminal send a un hijo pasa" \
  run "$PARENT" 'orca-ide terminal send --terminal term_child --text sigue --enter'
assert_exit 0 "padre: orchestration send status pasa" \
  run "$PARENT" 'orca-ide orchestration send --to term_child --subject x --type status'
assert_contains "Tu chat es tu block de notas" "el motivo explica qué hacer" \
  run "$CHILD" 'orca-ide terminal send --terminal term_parent --text x'

report "child-no-parent-write hook"
