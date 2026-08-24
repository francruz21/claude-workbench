#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=tools/tests/lib.sh
. "$HERE/lib.sh"

# El hook corre sobre el indice, no sobre el working tree. Un archivo sucio
# sin stagear no lo tiene que frenar; el mismo archivo stageado si.
d="$(mktemp -d)"
git -C "$d" init -q
git -C "$d" config user.email t@example.com
git -C "$d" config user.name t
mkdir -p "$d/tools"
cp "$REPO/tools/check-placeholders.sh" "$d/tools/"
cp "$REPO/tools/placeholder-allowlist.txt" "$d/tools/"
mkdir -p "$d/.git/hooks"
cp "$REPO/tools/hooks/pre-commit" "$d/.git/hooks/pre-commit" 2>/dev/null || true
chmod +x "$d/.git/hooks/pre-commit" 2>/dev/null || true
git -C "$d" add -A
git -C "$d" commit -qm base --no-verify

# El checker default lee $HOME/.claude/workbench para el chequeo data-driven.
# En una maquina donde esa config exista, este test podria fallar por
# hallazgos que no tienen nada que ver con el hook. Se apunta HOME a un
# directorio vacio para que ese chequeo se saltee de forma determinista y lo
# unico bajo prueba sea el chequeo por forma sobre el indice.
HOMETMP="$(mktemp -d)"

sucio_mail="alguien@""empresa-real.com"
printf 'mail: %s\n' "$sucio_mail" > "$d/sucio.md"
assert_exit 0 "un archivo sucio SIN stagear no frena el commit" \
  env -C "$d" HOME="$HOMETMP" git commit -q --allow-empty -m vacio

git -C "$d" add sucio.md
assert_exit 1 "el mismo archivo stageado SI frena el commit" \
  env -C "$d" HOME="$HOMETMP" git commit -q -m "intento"

report "pre-commit hook"
