#!/usr/bin/env bash
# Finding 6 del fix wave: "channel" y "mention_name" eran obligatorios y un
# Enter vacio abortaba la instalacion entera antes de llegar al bloque de
# CLAUDE.md o a la oferta del hook — aunque "announce: skip" sea una eleccion
# documentada (ver core/config-schema.md) y tres de las cinco skills no
# dependan de esto para nada. Este archivo prueba el camino sin canal: tiene
# que llegar igual al final, avisando en vez de abortar.
#
# Corre sobre una copia de install.sh dentro de un repo git temporal, igual
# que test-install-hook.sh: install_precommit_hook toca .git/hooks del repo
# donde vive install.sh (REPO_DIR), y este test no puede arriesgarse a
# instalar o pisar el hook del propio checkout de desarrollo.
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

assert_str_contains() {
  local needle="$1" desc="$2" haystack="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then _pass "$desc"
  else _fail "$desc" "no aparecio: $needle"; fi
}

# --- camino sin canal: no aborta, llega al final -----------------------
d=$(setup_repo)
home=$(mktemp -d)
out=$(cd "$d" && printf 'un-handle\n\nn\n' | WORKBENCH_HOME="$home" bash ./install.sh 2>&1)

assert_str_contains 'claude-workbench' "el camino sin canal llega al bloque de CLAUDE.md" "$out"
# read -p no imprime el prompt cuando stdin no es una terminal (asi corren
# estos tests): la evidencia de que se llego a la oferta del hook es el
# printf que la antecede, el mismo que usa test-install-hook.sh.
assert_str_contains 'Se puede saltear con' "el camino sin canal llega a la oferta del hook" "$out"

TESTS_RUN=$((TESTS_RUN + 1))
if [ -f "$home/.claude/workbench/user.json" ]; then _pass "escribio user.json"
else _fail "escribio user.json" "no existe"; fi

assert_contains '"announce": "skip"' "capabilities.json guarda el skip de announce" \
  cat "$home/.claude/workbench/capabilities.json"

assert_not_contains 'announce' "user.json no tiene bloque announce sin canal" \
  cat "$home/.claude/workbench/user.json"

TESTS_RUN=$((TESTS_RUN + 1))
if [ ! -e "$d/.git/hooks/pre-commit" ]; then _pass "declinar el hook no lo deja instalado"
else _fail "declinar el hook no lo deja instalado" "quedo instalado"; fi

# --- camino con canal: sigue guardando choices.announce = canal ---------
d2=$(setup_repo)
home2=$(mktemp -d)
(cd "$d2" && printf 'un-handle\nhttps://chat.example/c/1\nNombre Apellido\n\nn\n' \
    | WORKBENCH_HOME="$home2" bash ./install.sh >/dev/null 2>&1)

assert_contains '"announce": "canal"' "con canal guarda choices.announce = canal" \
  cat "$home2/.claude/workbench/capabilities.json"
assert_contains 'channelUrl' "con canal si escribe el bloque announce en user.json" \
  cat "$home2/.claude/workbench/user.json"

# --- ni siquiera el handle es obligatorio para llegar al final ----------
d3=$(setup_repo)
home3=$(mktemp -d)
out3=$(cd "$d3" && printf '\n\nn\n' | WORKBENCH_HOME="$home3" bash ./install.sh 2>&1)

assert_str_contains 'claude-workbench' "sin handle ni canal, tambien llega al bloque de CLAUDE.md" "$out3"
assert_str_contains 'no va a poder filtrar por autor' \
  "avisa claramente que el filtro de autor no va a funcionar sin handle" "$out3"

TESTS_RUN=$((TESTS_RUN + 1))
if [ -f "$home3/.claude/workbench/user.json" ]; then _pass "sin handle igual escribe user.json"
else _fail "sin handle igual escribe user.json" "no existe"; fi

report "install.sh announce opcional"
