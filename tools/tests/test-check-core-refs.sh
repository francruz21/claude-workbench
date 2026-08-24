#!/usr/bin/env bash
# El backtick de la fixture de abajo es literal, no una expansion: va en
# comillas simples a proposito.
# shellcheck disable=SC2016
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=tools/tests/lib.sh
. "$HERE/lib.sh"

CHECK="$REPO/tools/check-core-refs.sh"

fixture() {
  local dir; dir="$(mktemp -d)"
  mkdir -p "$dir/core" "$dir/skills/demo"
  touch "$dir/core/resolve.md"
  printf '%s\n' "$1" > "$dir/skills/demo/SKILL.md"
  printf '%s' "$dir"
}

d=$(fixture 'Ante un hueco, seguir `core/resolve.md`.')
assert_exit 0 "pasa cuando la skill cita el protocolo" "$CHECK" "$d"

d=$(fixture 'Esta skill no cita nada.')
assert_exit 1 "falla cuando la skill no cita el protocolo" "$CHECK" "$d"
assert_contains "demo" "nombra la skill que no cita" "$CHECK" "$d"

# --- las tres semanticas cuando skills/ no tiene nada que dar -------------

# skills/ ausente todavia (llega en la Task 13): SALTEADO, exit 0, y nunca
# afirma que todas citan sin haber revisado ninguna.
d=$(mktemp -d); mkdir -p "$d/core"; touch "$d/core/resolve.md"
assert_exit 0 "sin skills/, saltea con exit 0" "$CHECK" "$d"
assert_contains "SALTEADO" "sin skills/, lo anuncia" "$CHECK" "$d"
assert_not_contains "OK" "sin skills/, no afirma que todas citan" "$CHECK" "$d"

# skills/ presente pero sin ningun SKILL.md: FALLA, no un OK vacio.
d=$(mktemp -d); mkdir -p "$d/core" "$d/skills"; touch "$d/core/resolve.md"
assert_exit 1 "skills/ sin ningun SKILL.md falla" "$CHECK" "$d"
assert_contains "no contiene ningun SKILL.md" "nombra la razon" "$CHECK" "$d"

report "check-core-refs"
