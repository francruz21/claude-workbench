#!/usr/bin/env bash
# Tests del hook que reserva la escritura en el remoto a publish-branch.sh.
# Lo que importa tanto como lo que deniega es lo que deja pasar: este hook
# corre en cada Bash de cada sesion de la maquina.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tools/tests/lib.sh
. "$HERE/lib.sh"

HOOK="$HERE/../hooks/pretooluse-git-gate.sh"

run() { jq -nc --arg c "$1" '{tool_name: "Bash", tool_input: {command: $c}}' | "$HOOK"; }

denies() {
  TESTS_RUN=$((TESTS_RUN + 1))
  if run "$1" | grep -q '"deny"'; then _pass "deniega: $1"; else _fail "deniega: $1"; fi
}
allows() {
  TESTS_RUN=$((TESTS_RUN + 1))
  if [ -z "$(run "$1")" ]; then _pass "deja pasar: $1"; else _fail "deja pasar: $1" "$(run "$1")"; fi
}

echo "git push en todas sus formas"
denies 'git push'
denies 'git push origin dev'
denies 'git push -u origin HEAD:feat/EDW-1-x'
denies 'git -C talentia-front push origin stage'
denies 'git -c core.x=1 push'
denies 'git -c alias.p=push p origin dev'
denies 'cd repo && git push --force'
denies 'bash -c "git push origin dev"'
denies "sh -c 'git -C x push'"
denies 'eval "git push origin master"'
denies '/usr/bin/git push origin dev'

echo "merge, aprobacion, sync"
denies 'gh pr merge 12 --squash'
denies 'gh -R Org/repo pr merge 12'
denies 'gh pr review 12 --approve'
denies 'gh pr review 12 -a'
denies 'gh repo sync Org/repo -b dev'

echo "gh api que escribe"
denies 'gh api -X PUT repos/o/r/pulls/1/merge'
denies 'gh api --method=POST repos/o/r/merges -f base=dev -f head=x'
denies 'gh api repos/o/r/merges -f base=dev -f head=x'
denies 'gh api -X DELETE repos/o/r/git/refs/heads/dev'
denies "gh api graphql -f query='mutation { mergePullRequest(input:{}) { clientMutationId } }'"
denies 'curl -X PUT -H "Authorization: token x" https://api.github.com/repos/o/r/pulls/1/merge'
denies 'curl -d "{}" https://api.github.com/repos/o/r/merges'

echo "lo que tiene que pasar"
allows "$HOME/claude-workbench/tools/publish-branch.sh -C talentia-front"
allows 'git status'
allows 'git stash push -m wip'
allows 'git log --oneline | grep push'
allows 'git commit -m "no hacer git push a dev"'
allows "git commit -F - <<'EOF'
fix: explica por que no se usa git push
EOF"
allows 'git ls-remote origin feat/EDW-1-x'
allows 'gh pr create --base dev --title x --body y'
allows 'gh pr view 12 --json statusCheckRollup'
allows 'gh pr review 12 --comment -b "ver linea 3"'
allows 'gh pr edit 12 --add-label notificado'
allows 'gh api repos/o/r/pulls/12'
allows 'gh api -X GET repos/o/r/commits -f sha=dev'
allows "gh api graphql -f query='{ viewer { login } }'"
allows 'curl -s https://api.github.com/repos/o/r'
allows 'echo push'

report git-gate
