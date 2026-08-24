#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=tools/tests/lib.sh
. "$HERE/lib.sh"

FIXTURE="_fixture_repoint_test"

setup() {
  local home="$1" old="$2"
  mkdir -p "$home/.claude/skills" "$old/skills/$FIXTURE"
  printf '# vieja\n' > "$old/skills/$FIXTURE/SKILL.md"
  ln -s "$old/skills/$FIXTURE" "$home/.claude/skills/$FIXTURE"
}

# El repuntado necesita que el nombre del symlink viejo tenga una contraparte
# bajo skills/ del repo nuevo. Se usa un nombre de fixture descartable y NUNCA
# el de una skill real: este test borra ese directorio al final, y apuntarlo a
# una skill del repo destruiria contenido versionado. Paso exactamente eso
# cuando el nombre era "conductor" y la Task 13 migro la skill real.
mkdir -p "$REPO/skills/$FIXTURE"
printf '# nueva\n' > "$REPO/skills/$FIXTURE/SKILL.md"

# Apunta a un claude-conductor viejo: ofrece repuntar.
H="$(mktemp -d)"; OLD="$(mktemp -d)/claude-conductor"; mkdir -p "$OLD"
setup "$H" "$OLD"
OUT="$(printf 's\n' | WORKBENCH_HOME="$H" bash "$REPO/install.sh" --skills-only 2>&1 || true)"
TESTS_RUN=$((TESTS_RUN + 1))
if printf '%s' "$OUT" | grep -qi 'repunt'; then _pass "ofrece repuntar el symlink viejo"
else _fail "ofrece repuntar el symlink viejo" "no lo ofrecio"; fi

TESTS_RUN=$((TESTS_RUN + 1))
if [ "$(readlink "$H/.claude/skills/$FIXTURE")" = "$REPO/skills/$FIXTURE" ]; then
  _pass "repunto el symlink al repo nuevo"
else _fail "repunto el symlink al repo nuevo" "sigue en $(readlink "$H/.claude/skills/$FIXTURE")"; fi

# Declinar deja el symlink como estaba.
H2="$(mktemp -d)"; OLD2="$(mktemp -d)/claude-brain"; mkdir -p "$OLD2"
setup "$H2" "$OLD2"
printf 'n\n' | WORKBENCH_HOME="$H2" bash "$REPO/install.sh" --skills-only >/dev/null 2>&1 || true
TESTS_RUN=$((TESTS_RUN + 1))
if [ "$(readlink "$H2/.claude/skills/$FIXTURE")" = "$OLD2/skills/$FIXTURE" ]; then
  _pass "si declinas, no toca el symlink"
else _fail "si declinas, no toca el symlink" "lo cambio igual"; fi

# Un symlink a un tercer lugar desconocido no se ofrece repuntar.
H3="$(mktemp -d)"; OTHER="$(mktemp -d)/otra-cosa"; mkdir -p "$OTHER/skills/$FIXTURE"
printf '# x\n' > "$OTHER/skills/$FIXTURE/SKILL.md"
mkdir -p "$H3/.claude/skills"; ln -s "$OTHER/skills/$FIXTURE" "$H3/.claude/skills/$FIXTURE"
OUT3="$(WORKBENCH_HOME="$H3" bash "$REPO/install.sh" --skills-only </dev/null 2>&1 || true)"
TESTS_RUN=$((TESTS_RUN + 1))
if printf '%s' "$OUT3" | grep -q 'symlink a otro lugar'; then _pass "un destino desconocido se reporta, no se repunta"
else _fail "un destino desconocido se reporta, no se repunta" "no lo reporto"; fi

rm -rf "$REPO/skills/$FIXTURE"

report "install.sh repuntado"
