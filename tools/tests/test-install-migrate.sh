#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=tools/tests/lib.sh
. "$HERE/lib.sh"

seed_old() {
  local home="$1"; mkdir -p "$home/.claude"
  local id_fixture="100000000""000000001"
  cat > "$home/.claude/conductor.config.json" <<EOF
{
  "author": "handle-viejo",
  "discord": { "channelUrl": "https://chat.example/c/7",
               "mention": { "name": "Nombre Apellido", "id": "$id_fixture" } },
  "repos": [ { "slug": "OWNER/repo-front", "tag": "FRONT" } ],
  "gateWorkflow": "Tests & Coverage",
  "notifiedLabel": "ya-anunciado",
  "relayGates": "all",
  "orca": { "wrapperRepoId": "00000000-0000-0000-0000-000000000000" }
}
EOF
}

H="$(mktemp -d)"; seed_old "$H"
OUT="$(printf 's\n' | WORKBENCH_HOME="$H" bash "$REPO/install.sh" 2>&1 || true)"

TESTS_RUN=$((TESTS_RUN + 1))
if printf '%s' "$OUT" | grep -q 'conductor.config.json'; then _pass "detecta el config anterior"
else _fail "detecta el config anterior" "no lo menciono"; fi

TESTS_RUN=$((TESTS_RUN + 1))
if printf '%s' "$OUT" | grep -q 'user.json' && printf '%s' "$OUT" | grep -q 'project'; then
  _pass "muestra el reparto por capa"
else _fail "muestra el reparto por capa" "no mostro las dos capas destino"; fi

U="$H/.claude/workbench/user.json"
assert_contains 'handle-viejo' "importo el handle a la capa user" cat "$U"

TESTS_RUN=$((TESTS_RUN + 1))
if ! grep -q 'gateWorkflow' "$U"; then _pass "no metio campos de project en user"
else _fail "no metio campos de project en user" "gateWorkflow quedo en user.json"; fi

# Los campos de project se dejan listados, no se escriben: no se sabe todavia
# a que repo pertenecen.
TESTS_RUN=$((TESTS_RUN + 1))
if printf '%s' "$OUT" | grep -qi 'repos'; then _pass "lista los campos de project pendientes"
else _fail "lista los campos de project pendientes" "no los menciono"; fi

# Declinar la importacion no escribe nada.
H2="$(mktemp -d)"; seed_old "$H2"
printf 'n\nhandle-nuevo\nhttps://chat.example/c/1\nNombre\n\n' \
  | WORKBENCH_HOME="$H2" bash "$REPO/install.sh" >/dev/null 2>&1 || true
assert_contains 'handle-nuevo' "si declinas la importacion, pregunta de cero" \
  cat "$H2/.claude/workbench/user.json"

report "install.sh migracion"
