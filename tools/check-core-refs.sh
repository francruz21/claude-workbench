#!/usr/bin/env bash
#
# El protocolo de resolucion vive en un lugar y las skills lo citan. Si una
# skill no lo cita, es candidata a divergir: reimplementa la convencion por su
# cuenta y con el tiempo deja de coincidir con las otras.
set -euo pipefail

ROOT="${1:-$(git rev-parse --show-toplevel)}"
[ -f "$ROOT/core/resolve.md" ] || { printf 'no existe core/resolve.md\n' >&2; exit 1; }

SKILLS_DIR="$ROOT/skills"

# Semantica de tres vias, igual que el checker data-driven de placeholders:
# ausente -> SALTEADO (todavia no hay nada que validar, llega en la Task 13);
# presente pero sin ningun SKILL.md -> FALLA, nunca un OK que afirme que
# todas citan el protocolo sin haber revisado ninguna.
if [ ! -d "$SKILLS_DIR" ]; then
  printf 'SALTEADO: no existe %s todavia (llega en la Task 13). Nada que validar.\n' "$SKILLS_DIR"
  exit 0
fi

mapfile -t SKILL_FILES < <(find "$SKILLS_DIR" -mindepth 2 -maxdepth 2 -name SKILL.md 2>/dev/null | sort)

if [ "${#SKILL_FILES[@]}" -eq 0 ]; then
  printf 'FALLA: %s existe pero no contiene ningun SKILL.md.\n' "$SKILLS_DIR" >&2
  exit 1
fi

FAILED=0
for skill in "${SKILL_FILES[@]}"; do
  name="$(basename "$(dirname "$skill")")"
  if ! grep -q 'core/resolve\.md' "$skill"; then
    printf 'FALLA: %s no cita core/resolve.md.\n' "$name" >&2
    FAILED=$((FAILED + 1))
  fi
done

if [ "$FAILED" -gt 0 ]; then
  printf '\n%d skill(s) sin citar el protocolo.\n' "$FAILED" >&2
  exit 1
fi
printf 'OK: %d skill(s) citan el protocolo.\n' "${#SKILL_FILES[@]}"
