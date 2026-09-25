#!/usr/bin/env bash
# Tests de publish-branch.sh contra un remoto bare local: que publique la rama
# del ticket y que rechace todo lo demas (ambientes, patron, force, ramas
# ajenas, argumentos extra).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tools/tests/lib.sh
. "$HERE/lib.sh"

PUB="$HERE/../publish-branch.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export GIT_CONFIG_GLOBAL="$TMP/gitconfig"
git config --global user.email yo@test
git config --global user.name yo
git config --global init.defaultBranch dev

git init -q --bare "$TMP/remote.git"
REPO="$TMP/repo"
git clone -q "$TMP/remote.git" "$REPO" 2>/dev/null
mkdir -p "$REPO/.claude"
cat > "$REPO/.claude/workbench.project.json" <<'JSON'
{"baseBranch": "qa-env",
 "baseBranchFromTicketLabel": {"prod": "live"},
 "branchNameCI": {"pattern": "^(feat|fix)/EX-[0-9]+-[a-z0-9-]+$"}}
JSON
printf '.claude/\n' > "$REPO/.gitignore"
git -C "$REPO" add .gitignore && git -C "$REPO" commit -qm base
git -C "$REPO" push -q origin dev 2>/dev/null

remote_sha() { git -C "$REPO" ls-remote --heads origin "refs/heads/$1" | awk '{print $1}'; }
on() { git -C "$REPO" checkout -q -B "$1" "${2:-dev}"; }
commit() { printf '%s\n' "$1" >> "$REPO/f"; git -C "$REPO" add f; git -C "$REPO" commit -qm "$1"; }

echo "ramas de ambiente y patron"
for b in dev main master stage qa-env live; do
  on "$b"
  assert_contains "rama de ambiente" "rechaza la rama de ambiente $b" "$PUB" -C "$REPO"
done
on feat/sin-ticket
assert_contains "no cumple el patron" "rechaza una rama fuera del patron" "$PUB" -C "$REPO"
git -C "$REPO" checkout -q --detach
assert_contains "desacoplado" "rechaza HEAD desacoplado" "$PUB" -C "$REPO"

echo "argumentos"
on feat/EX-1-algo
assert_exit 2 "no acepta una rama como argumento" "$PUB" -C "$REPO" dev
assert_exit 2 "no acepta --force" "$PUB" -C "$REPO" --force

echo "primera publicacion"
commit uno
assert_contains "dry-run OK" "dry-run valida sin empujar" "$PUB" -C "$REPO" --dry-run
assert_exit 0 "publica la rama del ticket" "$PUB" -C "$REPO"
TESTS_RUN=$((TESTS_RUN + 1))
if [ "$(remote_sha feat/EX-1-algo)" = "$(git -C "$REPO" rev-parse HEAD)" ]; then _pass "origin apunta al HEAD local"; else _fail "origin apunta al HEAD local"; fi
TESTS_RUN=$((TESTS_RUN + 1))
if [ "$(git -C "$REPO" config --get branch.feat/EX-1-algo.workbenchPublished)" = true ]; then _pass "deja la marca de publicada"; else _fail "deja la marca de publicada"; fi

echo "arreglos despues del review"
commit dos
assert_exit 0 "empuja un commit nuevo a su propia rama" "$PUB" -C "$REPO"
assert_contains "nada que empujar" "sin commits nuevos no hace nada" "$PUB" -C "$REPO"
git -C "$REPO" reset -q --hard HEAD~1
commit reescrito
assert_contains "sin force" "rechaza lo que necesitaria force" "$PUB" -C "$REPO"

echo "rama ajena"
OTRO="$TMP/otro"
git clone -q "$TMP/remote.git" "$OTRO" 2>/dev/null
git -C "$OTRO" checkout -q -b fix/EX-2-ajena
git -C "$OTRO" -c user.email=colega@test commit -q --allow-empty -m ajeno
git -C "$OTRO" push -q origin fix/EX-2-ajena 2>/dev/null
git -C "$REPO" fetch -q origin
on fix/EX-2-ajena origin/fix/EX-2-ajena
commit mio
assert_contains "no es tuya" "rechaza la rama remota de un compañero" "$PUB" -C "$REPO"

echo "rama propia publicada a mano"
git -C "$OTRO" checkout -q -b fix/EX-3-propia dev
git -C "$OTRO" commit -q --allow-empty -m mio-a-mano
git -C "$OTRO" push -q origin fix/EX-3-propia 2>/dev/null
git -C "$REPO" fetch -q origin
on fix/EX-3-propia origin/fix/EX-3-propia
commit arreglo
assert_exit 0 "adopta una rama propia publicada a mano" "$PUB" -C "$REPO"

echo "submodulo sin config propio"
SUPER="$TMP/super"
mkdir -p "$SUPER/.claude"
cp "$REPO/.claude/workbench.project.json" "$SUPER/.claude/"
git init -q "$SUPER"
git -C "$SUPER" -c protocol.file.allow=always submodule -q add "$TMP/remote.git" sub 2>/dev/null
git -C "$SUPER/sub" checkout -q -b feat/EX-4-sub origin/dev
git -C "$SUPER/sub" commit -q --allow-empty -m sub
assert_contains "dry-run OK" "toma el config del superproyecto" "$PUB" -C "$SUPER/sub" --dry-run

report publish-branch
