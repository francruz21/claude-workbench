#!/usr/bin/env bash
# Ruling A del batch B: install.sh tiene que ofrecer instalar
# tools/hooks/pre-commit como .git/hooks/pre-commit, opt-in, idempotente.
# Ningun task del plan lo cablea; el spec lo exige explicitamente
# ("pre-commit, instalado por install.sh de forma opt-in").
#
# Corre sobre una copia de install.sh dentro de un repo git temporal, nunca
# sobre este repo: el paso toca .git/hooks del repo donde vive install.sh
# (REPO_DIR), y este test no puede arriesgarse a instalar o pisar el hook
# del propio checkout de desarrollo.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=tools/tests/lib.sh
. "$HERE/lib.sh"

setup_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q
  mkdir -p "$d/tools/hooks"
  cp "$REPO/install.sh" "$d/install.sh"
  cp "$REPO/tools/hooks/pre-commit" "$d/tools/hooks/pre-commit"
  chmod +x "$d/install.sh" "$d/tools/hooks/pre-commit"
  printf '%s' "$d"
}

run_hook_step() {
  local d="$1" answer="$2"
  ( cd "$d" && printf '%s\n' "$answer" | WORKBENCH_HOME="$(mktemp -d)" bash ./install.sh --hook-only )
}

# --- aceptar instala el symlink ---
d=$(setup_repo)
assert_exit 0 "corre limpio aceptando el hook" run_hook_step "$d" s
TESTS_RUN=$((TESTS_RUN + 1))
if [ -L "$d/.git/hooks/pre-commit" ] \
  && [ "$(readlink "$d/.git/hooks/pre-commit")" = "$d/tools/hooks/pre-commit" ]; then
  _pass "instalo el symlink al hook del repo"
else
  _fail "instalo el symlink al hook del repo" "no quedo linkeado a $d/tools/hooks/pre-commit"
fi
# El aviso de --no-verify sale antes de preguntar, en una corrida nueva
# (la anterior ya instalo el hook y ahora tomaria el camino de "ya
# instalado", que no vuelve a mostrar el aviso).
d_msg=$(setup_repo)
assert_contains "puede saltear" "avisa que se puede bypasear con --no-verify" run_hook_step "$d_msg" n

# --- declinar no deja hook ---
d2=$(setup_repo)
run_hook_step "$d2" n >/dev/null 2>&1
TESTS_RUN=$((TESTS_RUN + 1))
if [ ! -e "$d2/.git/hooks/pre-commit" ]; then _pass "declinar no deja hook"
else _fail "declinar no deja hook" "quedo instalado igual"; fi

# --- un hook ajeno preexistente se preserva, nunca se pisa ---
d3=$(setup_repo)
printf '#!/bin/sh\necho ajeno\n' > "$d3/.git/hooks/pre-commit"
chmod +x "$d3/.git/hooks/pre-commit"
run_hook_step "$d3" s >/dev/null 2>&1
TESTS_RUN=$((TESTS_RUN + 1))
if [ -f "$d3/.git/hooks/pre-commit" ] && [ ! -L "$d3/.git/hooks/pre-commit" ] \
  && grep -q ajeno "$d3/.git/hooks/pre-commit"; then
  _pass "un hook ajeno preexistente se preserva"
else
  _fail "un hook ajeno preexistente se preserva" "se piso o se borro"
fi
assert_contains "no se toca" "avisa que no toca un hook ajeno" run_hook_step "$d3" s

# --- idempotencia: correr dos veces no cambia nada ---
d4=$(setup_repo)
run_hook_step "$d4" s >/dev/null 2>&1
before="$(readlink "$d4/.git/hooks/pre-commit")"
run_hook_step "$d4" s >/dev/null 2>&1
after="$(readlink "$d4/.git/hooks/pre-commit")"
TESTS_RUN=$((TESTS_RUN + 1))
if [ "$before" = "$after" ]; then _pass "correr dos veces no cambia el hook"
else _fail "correr dos veces no cambia el hook" "cambio de $before a $after"; fi
assert_contains "already linked" "la segunda corrida reporta ya instalado" run_hook_step "$d4" s

report "install.sh hook de pre-commit"
