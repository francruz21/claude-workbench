#!/usr/bin/env bash
# Tests del gate de un PR (`pr-state` y `announce-arm`), contra un `gh` falso.
#
# Los casos son los que el gate viejo resolvia mal en produccion: una corrida
# `edited` que saltea los tests tapaba a la del push, un job salteado contaba
# como verde, y solo se miraba un workflow, asi que un `claude-review` en rojo
# se anunciaba igual.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tools/tests/lib.sh
. "$HERE/lib.sh"

LEDGER="$HERE/../conductor-ledger.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export WORKBENCH_STATE_DIR="$TMP/state"
export WORKBENCH_WORKSPACE="$TMP/workspace"
mkdir -p "$WORKBENCH_WORKSPACE/.claude" "$TMP/bin" "$TMP/gh"

# `gh` falso: el SHA del PR, los runs de ese SHA y los jobs de cada run salen de
# $TMP/gh, que cada caso escribe.
cat > "$TMP/bin/gh" <<'GH'
#!/usr/bin/env bash
case "$1 $2" in
  "pr view")  echo "abc1234def" ;;
  "run list") cat "$FAKE_GH/runs.json" ;;
  "run view") cat "$FAKE_GH/jobs-$3.json" ;;
  *) exit 1 ;;
esac
GH
chmod +x "$TMP/bin/gh"
export PATH="$TMP/bin:$PATH" FAKE_GH="$TMP/gh"

cat > "$WORKBENCH_WORKSPACE/.claude/workbench.project.json" <<'JSON'
{ "gateWorkflow": ["Tests & Coverage", "Claude Code Review"],
  "gateRequired": ["Unit tests", "claude-review"] }
JSON

# runs '<id> <workflow> <status> <createdAt>'...
runs() {
  local out='[]' id wf st at
  for spec in "$@"; do
    IFS='|' read -r id wf st at <<<"$spec"
    out="$(jq -c --argjson i "$id" --arg w "$wf" --arg s "$st" --arg a "$at" \
      '. + [{databaseId: $i, workflowName: $w, status: $s, createdAt: $a}]' <<<"$out")"
  done
  printf '%s' "$out" > "$TMP/gh/runs.json"
}

# jobs <id> '<name>=<conclusion>'...
jobs() {
  local id="$1" out='[]' name concl; shift
  for spec in "$@"; do
    name="${spec%=*}"; concl="${spec##*=}"
    out="$(jq -c --arg n "$name" --arg c "$concl" '. + [{name: $n, status: "completed", conclusion: $c}]' <<<"$out")"
  done
  jq -c '{jobs: .}' <<<"$out" > "$TMP/gh/jobs-$id.json"
}

state() { bash "$LEDGER" pr-state --repo o/r --number 7; }

# --- la corrida `edited` no tapa a la del push ------------------------------
runs '1|Tests & Coverage|completed|2026-10-23T10:00:00Z' \
     '2|Claude Code Review|completed|2026-10-23T10:00:00Z' \
     '3|Tests & Coverage|completed|2026-10-23T10:01:00Z'
jobs 1 'Branch name=success' 'Unit tests=success'
jobs 2 'claude-review=success'
jobs 3 'Branch name=success' 'Unit tests=skipped'
assert_contains 'GREEN' 'tests corridos en el push y salteados en el edit: verde' state

# --- claude-review en rojo frena el anuncio ---------------------------------
jobs 2 'claude-review=failure'
assert_contains 'RED' 'claude-review en rojo es rojo, aunque los tests pasen' state
assert_contains 'claude-review=fail' 'y dice que job' state

# --- un job requerido que nunca corrio no es verde --------------------------
jobs 1 'Branch name=success' 'Unit tests=skipped'
jobs 2 'claude-review=success'
assert_contains 'SINCHECKS' 'tests salteados en todas las corridas del SHA: no es verde' state
assert_contains 'Unit tests' 'y nombra el job que falta' state

# --- un workflow que no corrio en el SHA ------------------------------------
runs '1|Tests & Coverage|completed|2026-10-23T10:00:00Z'
jobs 1 'Branch name=success' 'Unit tests=success'
assert_contains 'SINCHECKS' 'sin Claude Code Review en el SHA: no es verde' state
assert_contains 'Claude Code Review no corrio' 'y dice cual' state

# --- un run sin terminar ----------------------------------------------------
runs '1|Tests & Coverage|in_progress|2026-10-23T10:00:00Z' \
     '2|Claude Code Review|completed|2026-10-23T10:00:00Z'
assert_contains 'PENDING' 'un run en curso es pendiente' state

# --- cancelado sin otra corrida que lo pruebe -------------------------------
runs '1|Tests & Coverage|completed|2026-10-23T10:00:00Z' \
     '2|Claude Code Review|completed|2026-10-23T10:00:00Z'
jobs 1 'Branch name=success' 'Unit tests=cancelled'
assert_contains 'RED' 'un job solo cancelado no probo nada: rojo' state

# --- un re-run que pasa despues de un rojo ----------------------------------
runs '1|Tests & Coverage|completed|2026-10-23T10:00:00Z' \
     '2|Claude Code Review|completed|2026-10-23T10:00:00Z' \
     '4|Tests & Coverage|completed|2026-10-23T11:00:00Z'
jobs 1 'Branch name=success' 'Unit tests=failure'
jobs 4 'Branch name=success' 'Unit tests=success'
assert_contains 'GREEN' 'la ultima corrida que corrio el job manda: verde' state

# --- otros workflows no cuentan ---------------------------------------------
runs '1|Tests & Coverage|completed|2026-10-23T10:00:00Z' \
     '2|Claude Code Review|completed|2026-10-23T10:00:00Z' \
     '5|Claude Interactive|completed|2026-10-23T10:00:00Z'
jobs 1 'Branch name=success' 'Unit tests=success'
jobs 5 'claude=failure'
assert_contains 'GREEN' 'un workflow fuera del gate no lo pone en rojo' state

# --- announce-arm usa el mismo calculo y lo anota ---------------------------
bash "$LEDGER" open TCK-1 --slug tck-1 >/dev/null
bash "$LEDGER" pr-add TCK-1 --repo o/r --number 7 >/dev/null
jobs 2 'claude-review=failure'
assert_exit 1 'announce-arm se niega con claude-review en rojo' bash "$LEDGER" announce-arm TCK-1
assert_contains '"RED"' 'y deja el gate anotado en rojo para el despertador' bash "$LEDGER" get TCK-1
jobs 2 'claude-review=success'
assert_exit 0 'con todo verde habilita el anuncio' bash "$LEDGER" announce-arm TCK-1

report 'test-pr-state'
