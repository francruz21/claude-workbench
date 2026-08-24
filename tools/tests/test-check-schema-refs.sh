#!/usr/bin/env bash
# Los backticks de las fixtures de abajo son literales, no expansiones: van
# en comillas simples a proposito.
# shellcheck disable=SC2016
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=tools/tests/lib.sh
. "$HERE/lib.sh"

CHECK="$REPO/tools/check-schema-refs.sh"

fixture() {
  local dir; dir="$(mktemp -d)"
  mkdir -p "$dir/core" "$dir/skills/demo"
  printf '%s\n' '## Capa `project`' '' '| Campo | Tipo |' '|---|---|' "$1" \
    > "$dir/core/config-schema.md"
  printf '%s\n' "$2" > "$dir/skills/demo/SKILL.md"
  printf '%s' "$dir"
}

# Fixture con dos capas distintas, para probar que el campo tiene que
# coincidir con la capa que la skill declara, no solo existir en cualquiera.
fixture_layers() {
  local dir; dir="$(mktemp -d)"
  mkdir -p "$dir/core" "$dir/skills/demo"
  {
    printf '%s\n' '## Capa `project`' '' '| Campo | Tipo |' '|---|---|' '| `repos` | array |'
    printf '%s\n' '' '## Capa `user`' '' '| Campo | Tipo |' '|---|---|' '| `author` | string |'
    printf '%s\n' '' '## Capa `capabilities`' '' '| Campo | Tipo |' '|---|---|' '| `gh` | boolean |'
  } > "$dir/core/config-schema.md"
  printf '%s\n' "$1" > "$dir/skills/demo/SKILL.md"
  printf '%s' "$dir"
}

d=$(fixture '| `baseBranch` | string |' '## Requiere
- `project.baseBranch`')
assert_exit 0 "pasa cuando el campo existe en el schema" "$CHECK" "$d"

d=$(fixture '| `baseBranch` | string |' '## Requiere
- `project.ramaInventada`')
assert_exit 1 "falla cuando la skill pide un campo inexistente" "$CHECK" "$d"
assert_contains "ramaInventada" "nombra el campo que falta" "$CHECK" "$d"

d=$(fixture '| `baseBranch` | string |' 'sin seccion de requisitos')
assert_exit 1 "falla si una skill no declara ## Requiere" "$CHECK" "$d"

# --- las tres semanticas cuando skills/ no tiene nada que dar -------------

# skills/ ausente todavia (llega en la Task 13): SALTEADO, exit 0, y nunca
# afirma consistencia sin haber validado nada.
d=$(mktemp -d); mkdir -p "$d/core"
printf '%s\n' '| Campo | Tipo |' '|---|---|' '| `baseBranch` | string |' \
  > "$d/core/config-schema.md"
assert_exit 0 "sin skills/, saltea con exit 0" "$CHECK" "$d"
assert_contains "SALTEADO" "sin skills/, lo anuncia" "$CHECK" "$d"
assert_not_contains "OK" "sin skills/, no afirma consistencia" "$CHECK" "$d"

# skills/ presente pero sin ningun SKILL.md: FALLA, no un OK vacio.
d=$(mktemp -d); mkdir -p "$d/core" "$d/skills"
printf '%s\n' '## Capa `project`' '' '| Campo | Tipo |' '|---|---|' '| `baseBranch` | string |' \
  > "$d/core/config-schema.md"
assert_exit 1 "skills/ sin ningun SKILL.md falla" "$CHECK" "$d"
assert_contains "no contiene ningun SKILL.md" "nombra la razon" "$CHECK" "$d"

# skills/ presente con SKILL.md pero cero referencias citadas: FALLA, no un
# OK que en realidad no valido nada.
d=$(fixture '| `baseBranch` | string |' '## Requiere

Nada que declarar todavia.')
assert_exit 1 "cero referencias validadas falla, no pasa en silencio" "$CHECK" "$d"

# --- finding 7: KNOWN calificado por capa, no un set plano -----------------
# `repos` existe, pero solo en la capa `project`. Referenciarlo como
# `user.repos` tiene que fallar aunque el nombre del campo exista en otra
# capa del mismo schema — exactamente la ubicacion pre-migracion que
# core/config-schema.md explica que estaba mal.
d=$(fixture_layers '## Requiere
- `user.repos`')
assert_exit 1 "user.repos falla: repos es de la capa project, no user" "$CHECK" "$d"
assert_contains "user.repos" "nombra la referencia mal calificada" "$CHECK" "$d"

d=$(fixture_layers '## Requiere
- `project.repos`')
assert_exit 0 "project.repos pasa: coincide capa y campo" "$CHECK" "$d"

d=$(fixture_layers '## Requiere
- `capabilities.gateWorkflow`')
assert_exit 1 "capabilities.gateWorkflow falla: gateWorkflow es de la capa project" "$CHECK" "$d"

d=$(fixture_layers '## Requiere
- `project.author`')
assert_exit 1 "project.author falla: author es de la capa user" "$CHECK" "$d"

# La forma canonica corta (`capabilities.gh`, sin pasar por el bloque
# "detected") tiene que seguir validando: es la que usan las cinco skills
# reales y la que documenta core/resolve.md tras la Task 13.
d=$(fixture_layers '## Requiere
- `capabilities.gh`')
assert_exit 0 "capabilities.gh (forma corta) sigue validando contra la capa capabilities" "$CHECK" "$d"

report "check-schema-refs"
