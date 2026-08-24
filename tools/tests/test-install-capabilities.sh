#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=tools/tests/lib.sh
. "$HERE/lib.sh"

detect() { WORKBENCH_HOME="$1" bash "$REPO/install.sh" --detect-only; }

H="$(mktemp -d)"
assert_exit 0 "la deteccion corre sola" detect "$H"
CAP="$H/.claude/workbench/capabilities.json"

TESTS_RUN=$((TESTS_RUN + 1))
if [ -f "$CAP" ]; then _pass "escribio capabilities.json"
else _fail "escribio capabilities.json" "no existe $CAP"; fi

assert_exit 0 "capabilities.json es JSON valido" python3 -m json.tool "$CAP"
assert_contains '"detected"' "tiene el bloque detected" cat "$CAP"
assert_contains '"choices"' "tiene el bloque choices" cat "$CAP"

# El invariante central: re-detectar NO borra las decisiones del usuario.
python3 - "$CAP" <<'PY'
import io, json, sys
p = sys.argv[1]
d = json.load(io.open(p))
d["choices"]["worktrees"] = "git-worktree"
json.dump(d, io.open(p, "w"), indent=2)
PY
detect "$H" >/dev/null 2>&1
assert_contains 'git-worktree' "re-detectar preserva choices" cat "$CAP"

report "install.sh capabilities"
