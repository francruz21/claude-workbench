#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=tools/tests/lib.sh
. "$HERE/lib.sh"

run_install() {
  local home="$1"; shift
  WORKBENCH_HOME="$home" bash "$REPO/install.sh" --skills-only "$@"
}

# skills/ no existe todavia en este repo (llega en la Task 13), asi que el
# test no puede asertar sobre una skill real como "conductor": se crea su
# propia fixture bajo skills/ y se borra al final, en vez de depender del
# orden de migracion (ver progress.md, Ruling 3).
FIXTURE="_fixture_symlinks_test"
mkdir -p "$REPO/skills/$FIXTURE"
printf '# fixture\n' > "$REPO/skills/$FIXTURE/SKILL.md"

# --- linkea las skills ---
H="$(mktemp -d)"
assert_exit 0 "corre limpio en un HOME vacio" run_install "$H"
TESTS_RUN=$((TESTS_RUN + 1))
if [ -L "$H/.claude/skills/$FIXTURE" ]; then _pass "creo el symlink de la fixture"
else _fail "creo el symlink de la fixture" "no existe $H/.claude/skills/$FIXTURE"; fi

# --- idempotencia: la segunda corrida no cambia nada ---
before="$(find "$H/.claude/skills" -maxdepth 1 -printf '%f %l\n' | sort)"
assert_exit 0 "la segunda corrida tambien sale 0" run_install "$H"
after="$(find "$H/.claude/skills" -maxdepth 1 -printf '%f %l\n' | sort)"
TESTS_RUN=$((TESTS_RUN + 1))
if [ "$before" = "$after" ]; then _pass "la segunda corrida no cambia el estado"
else _fail "la segunda corrida no cambia el estado" "el arbol de symlinks cambio"; fi
assert_contains "already linked" "la segunda corrida reporta ya-linkeado" run_install "$H"

rm -rf "$REPO/skills/$FIXTURE"

# --- no pisa un archivo real ---
FIXTURE2="_fixture_symlinks_real"
mkdir -p "$REPO/skills/$FIXTURE2"
printf '# fixture\n' > "$REPO/skills/$FIXTURE2/SKILL.md"
H2="$(mktemp -d)"; mkdir -p "$H2/.claude/skills/$FIXTURE2"
printf 'mio\n' > "$H2/.claude/skills/$FIXTURE2/SKILL.md"
assert_exit 0 "no falla ante un directorio real preexistente" run_install "$H2"
assert_contains "not touching" "avisa que no toca un directorio real" run_install "$H2"
TESTS_RUN=$((TESTS_RUN + 1))
if [ -f "$H2/.claude/skills/$FIXTURE2/SKILL.md" ] && grep -q mio "$H2/.claude/skills/$FIXTURE2/SKILL.md"; then
  _pass "dejo intacto el directorio real"
else _fail "dejo intacto el directorio real" "lo borro o lo piso"; fi
rm -rf "$REPO/skills/$FIXTURE2"

# --- un directorio sin SKILL.md no se linkea ---
H3="$(mktemp -d)"
mkdir -p "$REPO/skills/_vacia_test"
assert_exit 0 "corre con una skill incompleta presente" run_install "$H3"
TESTS_RUN=$((TESTS_RUN + 1))
if [ ! -e "$H3/.claude/skills/_vacia_test" ]; then _pass "no linkea un dir sin SKILL.md"
else _fail "no linkea un dir sin SKILL.md" "lo linkeo igual"; fi
rmdir "$REPO/skills/_vacia_test"

report "install.sh symlinks"
