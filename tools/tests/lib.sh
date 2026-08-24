#!/usr/bin/env bash
# Harness minimo. Sin dependencias: bash y coreutils.
TESTS_RUN=0
TESTS_FAILED=0

_fail() {
  TESTS_FAILED=$((TESTS_FAILED + 1))
  printf '  FAIL  %s\n' "$1" >&2
  [ $# -gt 1 ] && printf '        %s\n' "$2" >&2
  return 0
}

_pass() { printf '  ok    %s\n' "$1"; }

# assert_exit <codigo-esperado> <descripcion> <comando...>
assert_exit() {
  local want="$1" desc="$2"; shift 2
  TESTS_RUN=$((TESTS_RUN + 1))
  local got=0
  "$@" >/dev/null 2>&1 || got=$?
  if [ "$got" = "$want" ]; then _pass "$desc"; else _fail "$desc" "exit esperado $want, obtenido $got"; fi
}

# assert_contains <aguja> <descripcion> <comando...>
assert_contains() {
  local needle="$1" desc="$2"; shift 2
  TESTS_RUN=$((TESTS_RUN + 1))
  local out; out="$("$@" 2>&1 || true)"
  if printf '%s' "$out" | grep -qF -- "$needle"; then _pass "$desc"
  else _fail "$desc" "no aparecio: $needle"; fi
}

# assert_not_contains <aguja> <descripcion> <comando...>
assert_not_contains() {
  local needle="$1" desc="$2"; shift 2
  TESTS_RUN=$((TESTS_RUN + 1))
  local out; out="$("$@" 2>&1 || true)"
  if printf '%s' "$out" | grep -qF -- "$needle"; then _fail "$desc" "no deberia aparecer: $needle"
  else _pass "$desc"; fi
}

report() {
  printf '\n%s: %d corridos, %d fallados\n' "${1:-tests}" "$TESTS_RUN" "$TESTS_FAILED"
  [ "$TESTS_FAILED" -eq 0 ]
}
