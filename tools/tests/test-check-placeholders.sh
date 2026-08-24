#!/usr/bin/env bash
# Se omite -e a proposito: un assert que falla no debe abortar la corrida,
# porque entonces se reportarian menos casos de los que en verdad corrieron.
# La senal de fallo es el exit no-cero de report(), no que el script muera.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=tools/tests/lib.sh
. "$HERE/lib.sh"

CHECK="$REPO/tools/check-placeholders.sh"

# Cada caso corre en un repo git de juguete, para no depender del repo real.
make_fixture() {
  local dir; dir="$(mktemp -d)"
  git -C "$dir" init -q
  git -C "$dir" config user.email t@example.com
  git -C "$dir" config user.name t
  printf '%s\n' "$2" > "$dir/$1"
  git -C "$dir" add -A
  printf '%s' "$dir"
}

# Un repo de juguete sin ningun archivo trackeado (init sin agregar nada).
make_empty_fixture() {
  local dir; dir="$(mktemp -d)"
  git -C "$dir" init -q
  git -C "$dir" config user.email t@example.com
  git -C "$dir" config user.name t
  printf '%s' "$dir"
}

run_in() { local d="$1"; shift; ( cd "$d" && "$@" ); }

# Los fixtures de mas abajo se ensamblan en fragmentos: concatenados en
# tiempo de ejecucion dan el mismo valor de siempre (y el checker lo sigue
# detectando en el archivo de fixture, que es lo que prueban los asserts),
# pero como texto plano en este archivo no aparecen contiguos, asi que este
# mismo test no dispara su propio checker al quedar trackeado en el repo.
mail_fixture="alguien@""empresa-""real.com"
id_fixture="1234567890""12345678"
token_fixture="ghp_""AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
home_fixture="/home/""alguien"
hook_fixture="https://discord.com/api/""webhooks/1/aaaaaaaaaaaaaaaaaaaaaa"

# --- por forma: lo que tiene que agarrar ---
d=$(make_fixture doc.md "contacto: $mail_fixture")
assert_exit 1 "agarra un mail" run_in "$d" "$CHECK" --config-dir /nonexistent
assert_contains "$mail_fixture" "reporta el mail encontrado" \
  run_in "$d" "$CHECK" --config-dir /nonexistent

d=$(make_fixture doc.md "canal id $id_fixture")
assert_exit 1 "agarra un id de 18 digitos" run_in "$d" "$CHECK" --config-dir /nonexistent

d=$(make_fixture doc.md "token $token_fixture")
assert_exit 1 "agarra un token de github" run_in "$d" "$CHECK" --config-dir /nonexistent

d=$(make_fixture doc.md "ruta $home_fixture/proyecto")
assert_exit 1 "agarra una ruta absoluta de home" run_in "$d" "$CHECK" --config-dir /nonexistent

d=$(make_fixture doc.md "hook $hook_fixture")
assert_exit 1 "agarra una url de webhook" run_in "$d" "$CHECK" --config-dir /nonexistent

# --- por forma: lo que NO tiene que agarrar (por la allowlist) ---
# Los tres casos siguientes matchean el shape "mail" igual que los de
# arriba; lo unico que cambia el resultado a exit 0 es que el dominio esta
# en la allowlist. Eso es lo que se prueba mas abajo: sin allowlist, el
# mismo valor SI se agarra.
d=$(make_fixture doc.md 'mail de ejemplo: admin@example.com')
assert_exit 0 "no agarra un dominio de ejemplo reservado" run_in "$d" "$CHECK" --config-dir /nonexistent

d=$(make_fixture doc.md 'contacto de prueba: alguien@acme.test')
assert_exit 0 "no agarra el dominio .test reservado para acme" run_in "$d" "$CHECK" --config-dir /nonexistent

d=$(make_fixture doc.md 'mail del workspace: alguien@empresa.atlassian.net')
assert_exit 0 "no agarra el subdominio atlassian de la empresa" run_in "$d" "$CHECK" --config-dir /nonexistent

# --- la allowlist es la que hace la diferencia, no que el shape no matchee ---
d=$(make_fixture doc.md 'mail de ejemplo: admin@example.com')
assert_exit 1 "sin allowlist el mismo mail de ejemplo si se agarra" \
  run_in "$d" "$CHECK" --config-dir /nonexistent --allowlist /dev/null

# --- allowlist occurrence-scoped, no line-scoped ---------------------------
# Bug real: un allowlist entry como "<[a-z-]+>" o "localhost|127.0.0.1" se
# aplicaba contra la LINEA entera. Una linea con un placeholder legitimo en
# una parte y un dato real sin relacion en otra quedaba blanqueada entera.
# La correccion: la allowlist excusa el texto matcheado, no el resto de la
# linea. Caso de falla exacto que tenia que dejar de commitear limpio.
# Fragmentado igual que mail_fixture mas arriba, para que este mismo test no
# dispare su propio checker al quedar trackeado en el repo.
mail2_fixture="real@""empresa.com"
d=$(make_fixture doc.md "- ver <ver-abajo>: mail $mail2_fixture")
assert_exit 1 "un placeholder en la linea ya no blanquea un mail real distinto en la misma linea" \
  run_in "$d" "$CHECK" --config-dir /nonexistent
assert_contains "$mail2_fixture" "reporta el mail real, no lo tapa el placeholder" \
  run_in "$d" "$CHECK" --config-dir /nonexistent

d=$(make_fixture doc.md "server en localhost, contacto $mail2_fixture")
assert_exit 1 "localhost en la linea tampoco blanquea un mail real distinto en la misma linea" \
  run_in "$d" "$CHECK" --config-dir /nonexistent

# El placeholder en si mismo sigue permitido cuando es lo unico que matchea.
d=$(make_fixture doc.md 'ejemplo de uso: <placeholder-cualquiera>')
assert_exit 0 "el placeholder en si mismo sigue sin marcarse" \
  run_in "$d" "$CHECK" --config-dir /nonexistent

# --- data-driven ---
make_config() {
  local dir; dir="$(mktemp -d)"
  printf '%s\n' "$1" > "$dir/user.json"
  printf '%s' "$dir"
}

# Un valor del config que se colo en un archivo: tiene que agarrarlo, sin que
# el valor este escrito en ningun lado del repo.
cfg=$(make_config '{"author":"un-login-muy-particular","discord":{"channelUrl":"https://chat.invalido/c/999"}}')
d=$(make_fixture doc.md 'ejemplo de rama: un-login-muy-particular/tck-1-algo')
assert_exit 1 "agarra un valor del config filtrado" run_in "$d" "$CHECK" --config-dir "$cfg"
assert_contains "user.json" "dice de que capa vino el valor" \
  run_in "$d" "$CHECK" --config-dir "$cfg"

# El mismo config, un archivo limpio: pasa.
d=$(make_fixture doc.md 'ejemplo de rama: <usuario>/tck-1-algo')
assert_exit 0 "no marca nada si el archivo usa placeholders" run_in "$d" "$CHECK" --config-dir "$cfg"

# El caso que mas importa: existe la config pero no rinde valores. Es un
# chequeo que no pudo correr, y tiene que FALLAR, no pasar.
cfg_vacio=$(make_config '{}')
d=$(make_fixture doc.md 'contenido inocuo')
assert_exit 1 "FALLA si la config existe y no rinde valores" run_in "$d" "$CHECK" --config-dir "$cfg_vacio"
assert_contains "no rindio ningun valor" "explica por que fallo" \
  run_in "$d" "$CHECK" --config-dir "$cfg_vacio"

# Config ausente: skip anunciado, no falla. Es el caso de CI y de un clon nuevo.
d=$(make_fixture doc.md 'contenido inocuo')
assert_exit 0 "no falla si no hay config (clon nuevo, CI)" run_in "$d" "$CHECK" --config-dir /nonexistent
assert_contains "SALTEADO" "anuncia que salteo el data-driven" \
  run_in "$d" "$CHECK" --config-dir /nonexistent

# Valores demasiado cortos no cuentan: generarian ruido, no senal.
cfg_corto=$(make_config '{"tag":"ok"}')
d=$(make_fixture doc.md 'todo ok por aca')
assert_exit 1 "un valor de 2 chars no cuenta como valor comparable" run_in "$d" "$CHECK" --config-dir "$cfg_corto"

# --- la allowlist tambien filtra hallazgos data-driven, ocurrencia por ocurrencia ---
# El valor real ("valor-de-config-unico") no matchea ningun patron de la
# allowlist por si mismo: que la MISMA linea tenga un placeholder <...> ya no
# alcanza para blanquearlo (ver el bloque de occurrence-scoping mas arriba).
cfg_prop=$(make_config '{"secreto":"valor-de-config-unico"}')
d=$(make_fixture doc.md 'plantilla: <placeholder> valor-de-config-unico')
assert_exit 1 "un placeholder en la linea ya no blanquea un valor de config real y distinto" \
  run_in "$d" "$CHECK" --config-dir "$cfg_prop"

# Si el valor real coincide con un patron reservado de la allowlist (por
# ejemplo un dominio de ejemplo), si se excusa: la allowlist sigue
# aplicando al valor en si.
cfg_reservado=$(make_config '{"mailDeAyuda":"soporte@example.com"}')
d=$(make_fixture doc.md 'escribir a soporte@example.com por dudas')
assert_exit 0 "un valor de config que cae en un dominio reservado si se excusa" \
  run_in "$d" "$CHECK" --config-dir "$cfg_reservado"

# --- fix: matching case-insensitive del valor de config ---
cfg_case=$(make_config '{"author":"Un-Login-Con-Mayusculas"}')
d=$(make_fixture doc.md 'aparece como un-login-con-mayusculas en minusculas')
assert_exit 1 "el mismo valor con distinto case tambien se agarra" \
  run_in "$d" "$CHECK" --config-dir "$cfg_case"

# --- un *.json (que no sea capabilities.json) malformado no puede fallar en silencio ---
# Un solo archivo invalido no puede esconderse detras de otro *.json valido
# de la misma config: si sus valores reales nunca se compararon, el chequeo
# no corrio para esa capa y tiene que FALLAR, no pasar.
cfg_mixto="$(mktemp -d)"
printf '%s\n' '{"author":"un-valor-cualquiera-largo"}' > "$cfg_mixto/user.json"
printf '%s\n' '{esto no es json valido' > "$cfg_mixto/other.json"
d=$(make_fixture doc.md 'contenido inocuo')
assert_exit 1 "FALLA si un *.json de la config es invalido, aunque otro sea valido" \
  run_in "$d" "$CHECK" --config-dir "$cfg_mixto"
assert_contains "other.json" "nombra el archivo malformado" \
  run_in "$d" "$CHECK" --config-dir "$cfg_mixto"

# --- capabilities.json queda afuera de la comparacion, siempre --------------
# Ruling: capabilities.json solo tiene booleans y valores de un enum fijo y
# documentado; ninguno identifica a una persona o un proyecto. Se excluye
# por archivo completo, no por campo, incluso si esta malformado o si su
# valor aparece textualmente en un archivo trackeado.
cfg_caps_malo="$(mktemp -d)"
printf '%s\n' '{"author":"un-valor-cualquiera-largo"}' > "$cfg_caps_malo/user.json"
printf '%s\n' '{esto no es json valido' > "$cfg_caps_malo/capabilities.json"
d=$(make_fixture doc.md 'contenido inocuo')
assert_exit 0 "capabilities.json malformado no causa FALLA: nunca se lee" \
  run_in "$d" "$CHECK" --config-dir "$cfg_caps_malo"

cfg_caps_valor="$(mktemp -d)"
printf '%s\n' '{"author":"un-valor-cualquiera-largo"}' > "$cfg_caps_valor/user.json"
printf '%s\n' '{"detected":{},"choices":{"worktrees":"un-valor-de-choice-largo"}}' \
  > "$cfg_caps_valor/capabilities.json"
d=$(make_fixture doc.md 'este doc menciona un-valor-de-choice-largo sin problema')
assert_exit 0 "un valor de capabilities.json en un archivo trackeado no se marca" \
  run_in "$d" "$CHECK" --config-dir "$cfg_caps_valor"

# --- capa project: <repo>/.claude/workbench.project.json --------------------
# Se compara como fuente adicional, con el mismo skip/fail que las otras
# capas. Vive en la raiz del repo de trabajo, no en $CONFIG_DIR.
project_layer_fixture() {
  local dir; dir="$(make_fixture "$1" "$2")"
  mkdir -p "$dir/.claude"
  printf '%s\n' "$3" > "$dir/.claude/workbench.project.json"
  printf '%s' "$dir"
}

d=$(project_layer_fixture doc.md 'proyecto: valor-de-proyecto-unico/algo' \
  '{"trackerPrefix":"valor-de-proyecto-unico"}')
assert_exit 1 "agarra un valor de la capa project (workbench.project.json)" \
  run_in "$d" "$CHECK" --config-dir /nonexistent
assert_contains "workbench.project.json" "dice que vino de la capa project" \
  run_in "$d" "$CHECK" --config-dir /nonexistent

d=$(project_layer_fixture doc.md 'proyecto: <prefijo>/algo' \
  '{"trackerPrefix":"valor-de-proyecto-unico"}')
assert_exit 0 "capa project presente pero archivo limpio: pasa" \
  run_in "$d" "$CHECK" --config-dir /nonexistent

d=$(project_layer_fixture doc.md 'contenido inocuo' '{}')
assert_exit 1 "capa project presente pero sin valores comparables: FALLA" \
  run_in "$d" "$CHECK" --config-dir /nonexistent

# Ninguna de las dos fuentes presente: SALTEADO, no falla.
d=$(make_fixture doc.md 'contenido inocuo')
assert_exit 0 "sin config_dir ni capa project: saltea, no falla" \
  run_in "$d" "$CHECK" --config-dir /nonexistent
assert_contains "SALTEADO" "anuncia el salteo sin ninguna de las dos fuentes" \
  run_in "$d" "$CHECK" --config-dir /nonexistent

# --- archivo trackeado que falta en el arbol de trabajo: FALLA dura --------
# read_file hacia "cat ... || true" y el llamador seguia de largo si el
# contenido vino vacio: cuatro archivos borrados hacian que el checker
# imprimiera un conteo mayor al que en verdad revisaba, en silencio. Un
# archivo que git lista pero que no existe en disco tiene que ser un error
# duro que nombra el archivo, nunca un skip silencioso.
d=$(make_fixture doc.md 'contenido inocuo')
rm "$d/doc.md"
assert_exit 1 "un archivo trackeado que falta en el arbol de trabajo es FALLA dura" \
  run_in "$d" "$CHECK" --config-dir /nonexistent
assert_contains "doc.md" "nombra el archivo faltante" \
  run_in "$d" "$CHECK" --config-dir /nonexistent

# --- cero archivos para chequear: FALLA, no un OK vacio ---------------------
# El chequeo por forma no tenia guard de "no revise nada": imprimia
# "(0 archivos)" -> "sin hallazgos" -> "OK". Igual que el chequeo
# data-driven y los dos ref-validators, cero archivos es una falla.
d=$(make_empty_fixture)
assert_exit 1 "cero archivos trackeados es FALLA, no OK" \
  run_in "$d" "$CHECK" --config-dir /nonexistent
assert_contains "no hay ningun archivo" "explica por que fallo" \
  run_in "$d" "$CHECK" --config-dir /nonexistent

report "check-placeholders (forma)"
