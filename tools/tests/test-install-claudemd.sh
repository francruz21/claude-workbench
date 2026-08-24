#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=tools/tests/lib.sh
. "$HERE/lib.sh"

run_it() { WORKBENCH_HOME="$1" bash "$REPO/install.sh" --print-claude-md; }

H="$(mktemp -d)"
assert_contains 'knowledge/rules' "el bloque usa las rutas de knowledge/" run_it "$H"
assert_contains 'knowledge/playbooks' "incluye playbooks bajo knowledge/" run_it "$H"
assert_not_contains 'claude-brain/rules' "no usa las rutas del repo anterior" run_it "$H"

# Si ya esta referenciado, no repite el bloque.
H2="$(mktemp -d)"; mkdir -p "$H2/.claude"
printf '# claude-workbench\nya referenciado\n' > "$H2/.claude/CLAUDE.md"
assert_contains 'ya referencia' "detecta que ya esta referenciado" run_it "$H2"

# Nunca escribe el CLAUDE.md del usuario.
H3="$(mktemp -d)"; mkdir -p "$H3/.claude"
printf 'mis instrucciones\n' > "$H3/.claude/CLAUDE.md"
run_it "$H3" >/dev/null 2>&1 || true
assert_contains 'mis instrucciones' "no pisa el CLAUDE.md del usuario" cat "$H3/.claude/CLAUDE.md"

report "install.sh bloque de CLAUDE.md"
