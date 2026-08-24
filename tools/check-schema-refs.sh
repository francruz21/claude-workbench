#!/usr/bin/env bash
#
# Valida que todo campo que una skill declara en su seccion "## Requiere"
# exista en core/config-schema.md, y que toda skill declare esa seccion.
#
# Los backticks de los patrones grep de abajo son literales de markdown, no
# expansiones: van en comillas simples a proposito.
# shellcheck disable=SC2016
set -euo pipefail

ROOT="${1:-$(git rev-parse --show-toplevel)}"
SCHEMA="$ROOT/core/config-schema.md"
SKILLS_DIR="$ROOT/skills"

# Semantica de tres vias, igual que el checker data-driven de placeholders:
# ausente -> SALTEADO (todavia no hay nada que validar, llega en la Task 13);
# presente pero sin nada que rinda una referencia -> FALLA, nunca un OK que
# afirme consistencia sin haber validado nada.
if [ ! -d "$SKILLS_DIR" ]; then
  printf 'SALTEADO: no existe %s todavia (llega en la Task 13). Nada que validar.\n' "$SKILLS_DIR"
  exit 0
fi

[ -f "$SCHEMA" ] || { printf 'no existe %s\n' "$SCHEMA" >&2; exit 1; }

# Los nombres de campo del schema son la primera celda de cada fila de tabla,
# entre backticks. Se registran calificados por la capa a la que pertenecen
# (la seccion "## Capa `X`" mas cercana hacia arriba), no en un set plano:
# sin esto, `user.repos`, `capabilities.gateWorkflow` o `project.author`
# pasarian aunque el campo exista en una capa distinta de la que la skill
# declara — justo la ubicacion pre-migracion que el propio schema explica
# que estaba mal.
KNOWN="$(awk '
  /^## Capa `/ {
    layer = $0
    sub(/^## Capa `/, "", layer)
    sub(/`.*/, "", layer)
    next
  }
  layer != "" && /^\| *`[A-Za-z0-9_.]+`/ {
    field = $0
    sub(/^\| *`/, "", field)
    sub(/`.*/, "", field)
    print layer "\t" field
  }
' "$SCHEMA")"
[ -n "$KNOWN" ] || { printf 'el schema no declara ningun campo\n' >&2; exit 1; }

mapfile -t SKILL_FILES < <(find "$SKILLS_DIR" -mindepth 2 -maxdepth 2 -name SKILL.md 2>/dev/null | sort)

if [ "${#SKILL_FILES[@]}" -eq 0 ]; then
  printf 'FALLA: %s existe pero no contiene ningun SKILL.md.\n' "$SKILLS_DIR" >&2
  exit 1
fi

FAILED=0
VALIDATED=0
for skill in "${SKILL_FILES[@]}"; do
  name="$(basename "$(dirname "$skill")")"

  if ! grep -q '^## Requiere' "$skill"; then
    printf 'FALLA: %s no declara una seccion "## Requiere".\n' "$name" >&2
    FAILED=$((FAILED + 1))
    continue
  fi

  # Campos citados como `capa.campo` o `capa.bloque.campo`.
  refs="$(sed -n '/^## Requiere/,/^## /p' "$skill" \
          | grep -oE '`(capabilities|user|project)\.[A-Za-z0-9_.]+`' \
          | tr -d '`' | sort -u || true)"

  while IFS= read -r ref; do
    [ -n "$ref" ] || continue
    VALIDATED=$((VALIDATED + 1))
    layer="${ref%%.*}"
    rest="${ref#*.}"
    leaf="${ref##*.}"
    if ! printf '%s\n' "$KNOWN" | grep -qxF "$(printf '%s\t%s' "$layer" "$rest")" \
       && ! printf '%s\n' "$KNOWN" | grep -qxF "$(printf '%s\t%s' "$layer" "$leaf")"; then
      printf 'FALLA: %s referencia %s, ausente del schema (o mal calificado por capa).\n' \
        "$name" "$ref" >&2
      FAILED=$((FAILED + 1))
    fi
  done <<< "$refs"
done

if [ "$FAILED" -gt 0 ]; then
  printf '\n%d problema(s) de consistencia entre skills y schema.\n' "$FAILED" >&2
  exit 1
fi

if [ "$VALIDATED" -eq 0 ]; then
  printf 'FALLA: se revisaron %d skill(s) pero ninguna referencio ningun campo del schema.\n' \
    "${#SKILL_FILES[@]}" >&2
  exit 1
fi

printf 'OK: %d skill(s), %d referencia(s) validadas contra el schema.\n' \
  "${#SKILL_FILES[@]}" "$VALIDATED"
