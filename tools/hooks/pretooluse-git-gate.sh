#!/usr/bin/env bash
#
# Hook de PreToolUse a nivel usuario: la unica forma de escribir en el remoto
# es `publish-branch.sh`, y nadie mergea ni aprueba PRs.
#
# Por que existe. Un deny del harness no alcanza. `Bash(git push:*)` no frena
# `git -C repo push`, ni `bash -c "git push origin dev"`, ni `gh api -X PUT
# .../merge`, y un allow `Bash(gh:*)` deja pasar `gh pr merge`. Este hook
# lee el comando entero y deniega:
#
#   1. `git push` en cualquier forma (con -C, -c, alias o dentro de `bash -c`
#      / `eval`). La puerta es tools/publish-branch.sh, que valida la rama.
#   2. `gh pr merge`, `gh pr review --approve`, `gh repo sync`.
#   3. `gh api` que escribe: metodo distinto de GET, campos (-f/-F/--input)
#      sin `-X GET`, o una mutation de graphql.
#   4. `curl` que escribe contra api.github.com.
#
# Todo lo demas pasa sin opinar: un PreToolUse que bloquea de mas rompe todas
# las sesiones de la maquina. Los comandos `!` del usuario no pasan por aca.
set -uo pipefail

if command -v timeout >/dev/null 2>&1; then
  PAYLOAD="$(timeout 5 cat 2>/dev/null || true)"
else
  PAYLOAD="$(cat 2>/dev/null || true)"
fi

deny() {
  if command -v jq >/dev/null 2>&1; then
    jq -nc --arg r "git-gate: $1" '{hookSpecificOutput: {
       hookEventName: "PreToolUse",
       permissionDecision: "deny",
       permissionDecisionReason: $r}}'
    exit 0
  fi
  printf 'git-gate: %s\n' "$1" >&2
  exit 2
}

command -v jq >/dev/null 2>&1 || exit 0
[ "$(printf '%s' "$PAYLOAD" | jq -r '.tool_name // ""' 2>/dev/null)" = Bash ] || exit 0
CMD="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.command // ""' 2>/dev/null)"
[ -n "$CMD" ] || exit 0

PUBLISH="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/publish-branch.sh"

# Vista sin heredocs ni strings: lo que se ejecuta, no la prosa de un commit.
SAFE="$(printf '%s' "$CMD" | python3 -c '
import re, sys
c = sys.stdin.read()
c = re.sub(r"<<-?\s*[\x27\"]?(\w+)[\x27\"]?.*?\n\1\s*$", " ", c, flags=re.S | re.M)
c = re.sub(r"\x27[^\x27]*\x27", " ", c)
c = re.sub(r"\"[^\"]*\"", " ", c)
print(c.replace("\n", " ; "))' 2>/dev/null)" || SAFE="$CMD"

# Cada comando simple por separado, para que "push" de uno no se mezcle con
# el "git" de otro.
segments() { printf '%s\n' "$1" | sed -E 's/(\|\||&&|;|\||&)/\n/g'; }

is_git_push() {
  # git [opciones...] ... push   (excepto `git stash push`)
  printf '%s' "$1" | grep -qE '(^|[[:space:]/])git([[:space:]]|$)' || return 1
  printf '%s' "$1" | grep -qE '(^|[[:space:]=])push([[:space:]]|$)' || return 1
  printf '%s' "$1" | grep -qE 'stash[[:space:]]+push' && return 1
  return 0
}

MSG_PUSH="git push esta reservado: para publicar la rama del ticket usá $PUBLISH (valida la rama y no admite force)"

# 1a. git push directo.
while IFS= read -r seg; do
  is_git_push "$seg" && deny "$MSG_PUSH"
done < <(segments "$SAFE")

# 1b. git push escondido en un string que otro shell va a ejecutar.
if printf '%s' "$SAFE" | grep -qE '(^|[[:space:]/])(bash|sh|zsh|dash)[[:space:]]+(-[a-z]*c|-c)|(^|[[:space:]])(eval|xargs)([[:space:]]|$)'; then
  while IFS= read -r seg; do
    is_git_push "$seg" && deny "$MSG_PUSH (tambien dentro de bash -c / eval)"
  done < <(segments "$(printf '%s' "$CMD" | tr -d "\"'")")
fi

while IFS= read -r seg; do
  seg="$(printf '%s' "$seg" | sed -E 's/^[[:space:]]+//')"

  # 2. Merge, aprobacion y sync.
  if printf '%s' "$seg" | grep -qE '(^|[[:space:]/])gh[[:space:]]'; then
    printf '%s' "$seg" | grep -qE 'gh[[:space:]].*\bpr[[:space:]]+merge\b' \
      && deny "gh pr merge esta prohibido: el merge lo hace una persona"
    printf '%s' "$seg" | grep -qE 'gh[[:space:]].*\bpr[[:space:]]+review\b' \
      && printf '%s' "$seg" | grep -qE '(^|[[:space:]])(--approve|-a)([[:space:]]|$)' \
      && deny "gh pr review --approve esta prohibido: la aprobacion la da una persona"
    printf '%s' "$seg" | grep -qE 'gh[[:space:]].*\brepo[[:space:]]+sync\b' \
      && deny "gh repo sync escribe en ramas del remoto"

    # 3. gh api que escribe.
    if printf '%s' "$seg" | grep -qE 'gh[[:space:]].*\bapi([[:space:]]|$)'; then
      METHOD="$(printf '%s' "$seg" | grep -oE '(-X|--method)[[:space:]=]+[A-Za-z]+' | tail -1 | grep -oE '[A-Za-z]+$' | tr a-z A-Z)"
      if [ -n "$METHOD" ] && [ "$METHOD" != GET ]; then
        deny "gh api -X $METHOD esta prohibido: solo lectura (GET)"
      fi
      if [ -z "$METHOD" ] && printf '%s' "$seg" | grep -qE '(^|[[:space:]])(-f|-F|--field|--raw-field|--input)([[:space:]=]|$)'; then
        printf '%s' "$seg" | grep -qE '(^|[[:space:]])graphql([[:space:]]|$)' || \
          deny "gh api con campos y sin -X GET hace POST: solo lectura"
      fi
    fi
  fi
done < <(segments "$SAFE")

# 3b. Mutations de graphql (viajan entre comillas: se mira el comando entero).
if printf '%s' "$SAFE" | grep -qE 'gh[[:space:]].*\bapi[[:space:]]+graphql\b' \
   && printf '%s' "$CMD" | grep -qE '\bmutation\b'; then
  deny "gh api graphql con mutation esta prohibido: solo lectura"
fi

# 4. curl que escribe contra la API de GitHub.
if printf '%s' "$CMD" | grep -qE 'api\.github\.com' \
   && printf '%s' "$CMD" | grep -qE '(^|[[:space:]/])curl[[:space:]]' \
   && printf '%s' "$CMD" | grep -qE '(-X|--request)[[:space:]=]*(POST|PUT|PATCH|DELETE)|(^|[[:space:]])(-d|--data[a-z-]*|-F|--form)([[:space:]=]|$)'; then
  deny "curl que escribe en api.github.com esta prohibido"
fi

exit 0
