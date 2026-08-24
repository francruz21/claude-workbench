#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=tools/tests/lib.sh
. "$HERE/lib.sh"

# Las respuestas entran por stdin, en el orden en que se preguntan.
install_with() {
  local home="$1" answers="$2"
  printf '%s' "$answers" | WORKBENCH_HOME="$home" bash "$REPO/install.sh" >/dev/null 2>&1
}

H="$(mktemp -d)"
install_with "$H" 'un-handle
https://chat.example/c/1
Nombre Apellido

'
USER_JSON="$H/.claude/workbench/user.json"

TESTS_RUN=$((TESTS_RUN + 1))
if [ -f "$USER_JSON" ]; then _pass "escribio user.json"
else _fail "escribio user.json" "no existe"; fi

assert_exit 0 "user.json es JSON valido" python3 -m json.tool "$USER_JSON"
assert_contains 'un-handle' "guardo el handle" cat "$USER_JSON"

TESTS_RUN=$((TESTS_RUN + 1))
perms="$(stat -c '%a' "$USER_JSON")"
if [ "$perms" = 600 ]; then _pass "user.json tiene permisos 600"
else _fail "user.json tiene permisos 600" "tiene $perms"; fi

# Una comilla o un backslash en un valor no puede romper el JSON.
H2="$(mktemp -d)"
install_with "$H2" 'un-handle
https://chat.example/c/1
O'"'"'Brien "Apodo" \o/

'
assert_exit 0 "un valor con comillas y backslash produce JSON valido" \
  python3 -m json.tool "$H2/.claude/workbench/user.json"

# Re-correr no repregunta ni pisa.
H3="$(mktemp -d)"
install_with "$H3" 'handle-uno
https://chat.example/c/1
Nombre

'
assert_contains 'handle-uno' "la segunda corrida preserva el valor" \
  env WORKBENCH_HOME="$H3" bash -c "bash '$REPO/install.sh' </dev/null >/dev/null 2>&1; cat '$H3/.claude/workbench/user.json'"

# Ninguna respuesta (ni siquiera el handle) aborta el resto de la
# instalacion: solo tres de las cinco skills usan announce, y una sola
# respuesta vacia no puede dejar al usuario sin CLAUDE.md ni oferta de hook.
H4="$(mktemp -d)"
assert_exit 0 "todo vacio no aborta la instalacion" \
  bash -c "printf '\n\n\n\n' | WORKBENCH_HOME='$H4' bash '$REPO/install.sh'"
assert_exit 0 "user.json igual queda escrito y es JSON valido" \
  python3 -m json.tool "$H4/.claude/workbench/user.json"

report "install.sh user config"
