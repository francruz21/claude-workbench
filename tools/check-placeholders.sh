#!/usr/bin/env bash
#
# Verifica que ningun archivo commiteado contenga datos reales de una persona
# o un proyecto. Dos chequeos independientes: por forma (patrones sensibles
# sin importar el valor) y data-driven (comparacion contra la config local).
#
# Politica (sin excepciones): ninguna cuenta de nadie puede aparecer en el
# repo publicado — ni un handle personal, ni un handle de trabajo, ni un
# login de ningun servicio, ni el nombre de una persona real. Todo lo
# relacionado a identidad se configura localmente, fuera del repo. No hay
# excepcion para un link autorreferencial al propio repo.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALLOWLIST="$HERE/placeholder-allowlist.txt"
MODE="tracked"
CONFIG_DIR="$HOME/.claude/workbench"

while [ $# -gt 0 ]; do
  case "$1" in
    --staged)     MODE="staged"; shift ;;
    --config-dir) CONFIG_DIR="$2"; shift 2 ;;
    --allowlist)  ALLOWLIST="$2"; shift 2 ;;
    -h|--help)    printf 'uso: %s [--staged] [--config-dir DIR] [--allowlist PATH]\n' "$0"; exit 0 ;;
    *)            printf 'opcion desconocida: %s\n' "$1" >&2; exit 2 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"
ROOT="$PWD"
PROJECT_FILE="$ROOT/.claude/workbench.project.json"

# La allowlist tiene comentarios. Pasada cruda a grep -f, cada "# ..." seria un
# patron que matchea cualquier linea que contenga ese texto, y podria
# blanquear hallazgos reales por accidente. Se filtra a un temporal.
ALLOW_RX="$(mktemp)"
trap 'rm -f "$ALLOW_RX"' EXIT
grep -vE '^\s*(#|$)' "$ALLOWLIST" > "$ALLOW_RX" || true

if [ "$MODE" = staged ]; then
  mapfile -t FILES < <(git diff --cached --name-only --diff-filter=ACM)
else
  mapfile -t FILES < <(git ls-files)
fi

# Cero archivos para chequear no puede pasar como si el chequeo hubiera
# corrido: es el mismo principio que ya aplican el chequeo data-driven y los
# dos ref-validators (SALTEADO explicito o FALLA, nunca un OK vacio).
#
# Esto solo aplica al modo tracked (la corrida default sobre todo el repo):
# cero archivos trackeados ahi es siempre una senal de que algo esta mal
# (repo vacio, corrida desde el lugar equivocado). En modo --staged, cero
# archivos es el caso normal de un commit que no toca ningun archivo (por
# ejemplo "git commit --allow-empty" o un commit sin cambios stageados): no
# hay nada que pudiera haber filtrado, asi que no es una falla del chequeo.
if [ "$MODE" = tracked ] && [ "${#FILES[@]}" -eq 0 ]; then
  printf 'FALLA: no hay ningun archivo para chequear (modo %s).\n' "$MODE" >&2
  printf 'Un chequeo que reviso cero archivos no corrio: no puede pasar.\n' >&2
  exit 1
fi

# En modo tracked, un archivo que git lista pero que no existe en el arbol de
# trabajo es un error duro, nunca un skip silencioso: si no se pudo leer, el
# chequeo no corrio para ese archivo, y un chequeo que no corrio no puede
# contar como pasado. (En modo staged no aplica: el contenido se lee del
# indice via "git show", que por definicion existe para un archivo
# ACM en el diff cacheado.)
if [ "$MODE" = tracked ]; then
  MISSING=()
  for f in "${FILES[@]}"; do
    [ -n "$f" ] || continue
    [ -f "$f" ] || MISSING+=("$f")
  done
  if [ "${#MISSING[@]}" -gt 0 ]; then
    printf 'FALLA: %d archivo(s) trackeado(s) no existen en el arbol de trabajo:\n' \
      "${#MISSING[@]}" >&2
    for f in "${MISSING[@]}"; do printf '  %s\n' "$f" >&2; done
    printf 'No se chequearon: no corrieron, y un chequeo que no corrio para un\n' >&2
    printf 'archivo no puede pasar como si lo hubiera revisado.\n' >&2
    exit 1
  fi
fi

# Un archivo staged se lee del indice, no del working tree: es el contenido
# que realmente se va a commitear.
read_file() {
  if [ "$MODE" = staged ]; then git show ":$1" 2>/dev/null || true
  else cat "$1" 2>/dev/null || true; fi
}

FINDINGS=0

report_hit() {
  FINDINGS=$((FINDINGS + 1))
  printf '  %s:%s  [%s]  %s\n' "$1" "$2" "$3" "$4"
}

# --- Chequeo 1: por forma ---------------------------------------------------
# Cada entrada es "etiqueta|regex-extendida".
SHAPES=(
  'mail|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
  'id-largo|\b[0-9]{15,22}\b'
  'webhook|https?://[A-Za-z0-9.-]+/api/webhooks/[0-9]+/[A-Za-z0-9_-]+'
  'token|(ghp_|gho_|ghs_|github_pat_|lin_api_)[A-Za-z0-9_]{10,}|sk-[A-Za-z0-9]{20}|xox[baprs]-[A-Za-z0-9-]{10,}'
  'clave-privada|BEGIN [A-Z ]*PRIVATE KEY'
  'ruta-home|/(home|Users)/[A-Za-z0-9._-]+'
  'aws|AKIA[0-9A-Z]{16}'
)

printf 'Chequeo por forma (%d archivos)\n' "${#FILES[@]}"
for f in "${FILES[@]}"; do
  [ -n "$f" ] || continue
  content="$(read_file "$f")"
  [ -n "$content" ] || continue
  for shape in "${SHAPES[@]}"; do
    label="${shape%%|*}"; rx="${shape#*|}"
    while IFS=: read -r lineno hit; do
      [ -n "$lineno" ] || continue
      # Occurrence-scoped: la allowlist excusa el texto matcheado en si, no
      # el resto de la linea. Si se testeara contra la linea entera, un
      # placeholder de otro campo en la misma linea blanquearia un hallazgo
      # real que no tiene nada que ver con ese placeholder.
      if grep -qE -f "$ALLOW_RX" <<<"$hit" 2>/dev/null; then continue; fi
      report_hit "$f" "$lineno" "$label" "$hit"
    done < <(printf '%s' "$content" | grep -nEo "$rx" || true)
  done
done

if [ "$FINDINGS" -eq 0 ]; then printf '  sin hallazgos\n'; fi

printf '\n'

# --- Chequeo 2: data-driven -------------------------------------------------
# Compara contra los valores reales de la config local. Nunca nombra un valor
# en el repo: los lee del disco. Un valor de 3 caracteres o menos se descarta
# porque genera ruido, no senal.
#
# Tres fuentes, las tres capas de core/config-schema.md:
#   - $CONFIG_DIR/user.json            (capa user)
#   - $CONFIG_DIR/*.json (menos capabilities.json, ver mas abajo)
#   - $PROJECT_FILE = <repo>/.claude/workbench.project.json (capa project)
#
# capabilities.json queda afuera de esta comparacion a proposito, siempre,
# aunque el directorio exista: solo contiene booleans y valores de un enum
# fijo y documentado (ver core/config-schema.md). Ninguno de esos valores
# identifica a una persona o a un proyecto, que es lo unico que esta
# comparacion cubre. Compararlo de todas formas generaria falsos positivos
# mecanicos: en cuanto alguien responda una pregunta de instalacion (por
# ejemplo choices.worktrees = "git-worktree"), ese valor coincide letra por
# letra con el literal del propio enum documentado en
# core/config-schema.md, y el chequeo fallaria contra su propia
# documentacion. Una excepcion por archivo completo, con esta razon escrita
# acá, es mas simple y mas principista que una lista de excepciones por
# campo.
HAS_CONFIG_DIR=0
[ -d "$CONFIG_DIR" ] && HAS_CONFIG_DIR=1
HAS_PROJECT_FILE=0
[ -f "$PROJECT_FILE" ] && HAS_PROJECT_FILE=1

printf 'Chequeo data-driven (config: %s; project: %s)\n' "$CONFIG_DIR" "$PROJECT_FILE"

if [ "$HAS_CONFIG_DIR" -eq 0 ] && [ "$HAS_PROJECT_FILE" -eq 0 ]; then
  printf '  SALTEADO: no existe %s ni %s.\n' "$CONFIG_DIR" "$PROJECT_FILE"
  printf '  El chequeo por forma corrio igual. En una maquina con la config\n'
  printf '  instalada, o en un repo de trabajo con capa project, este\n'
  printf '  chequeo tambien corre.\n'
else
  VALUES_FILE="$(mktemp)"
  ERRORS_FILE="$(mktemp)"
  # El trap acumula: sobreescribirlo aca filtraria los temporales previos.
  trap 'rm -f "$ALLOW_RX" "$VALUES_FILE" "$ERRORS_FILE"' EXIT

  # Aplana cada *.json de $CONFIG_DIR (menos capabilities.json, ver arriba)
  # mas el archivo de la capa project si existe, a lineas
  # "archivo<TAB>ruta<TAB>valor". Lo que va a stderr usa dos prefijos:
  # "ERROR:" para un *.json que no se pudo leer/parsear (esa capa no se
  # comparo, ver mas abajo) y "AVISO:" para un valor con salto de linea, que
  # no se soporta y no se compara pero no es por si solo motivo de falla.
  python3 - "$CONFIG_DIR" "$PROJECT_FILE" "$HAS_CONFIG_DIR" "$HAS_PROJECT_FILE" \
    > "$VALUES_FILE" 2>"$ERRORS_FILE" <<'PY'
import io, json, os, sys
cfg_dir, project_file, has_cfg_dir, has_project_file = sys.argv[1:5]

def walk(obj, path, out, warnings):
    if isinstance(obj, dict):
        for k, v in obj.items():
            walk(v, f"{path}.{k}" if path else k, out, warnings)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            walk(v, f"{path}[{i}]", out, warnings)
    elif isinstance(obj, str) and len(obj) > 3:
        if "\n" in obj:
            warnings.append(path)
        else:
            out.append((path, obj))

def process(name, full):
    try:
        data = json.load(io.open(full, encoding="utf-8"))
    except (ValueError, OSError) as exc:
        print(f"ERROR: {name}: no se pudo leer/parsear ({exc})", file=sys.stderr)
        return
    rows = []
    warnings = []
    walk(data, "", rows, warnings)
    for path in warnings:
        print(f"AVISO: {name}:{path} tiene un valor con salto de linea, "
              "no soportado: no se compara.", file=sys.stderr)
    for path, val in rows:
        print(f"{name}\t{path}\t{val}")

if has_cfg_dir == "1":
    for name in sorted(os.listdir(cfg_dir)):
        if not name.endswith(".json"):
            continue
        if name == "capabilities.json":
            # Excluido siempre: ver el comentario en check-placeholders.sh.
            continue
        process(name, os.path.join(cfg_dir, name))

if has_project_file == "1":
    process(os.path.basename(project_file), project_file)
PY

  if [ -s "$ERRORS_FILE" ]; then
    cat "$ERRORS_FILE" >&2
  fi

  if grep -q '^ERROR:' "$ERRORS_FILE" 2>/dev/null; then
    printf '\n' >&2
    printf 'FALLA: al menos un *.json de config no se pudo leer/parsear (ver arriba).\n' >&2
    printf 'Sus valores reales nunca se compararon, aunque otras fuentes si hayan\n' >&2
    printf 'rendido valores: un chequeo que pasa cuando no pudo correr para una\n' >&2
    printf 'capa es tan malo como si no corriera para ninguna.\n' >&2
    exit 1
  fi

  VALUE_COUNT="$(wc -l < "$VALUES_FILE" | tr -d ' ')"

  if [ "$VALUE_COUNT" -eq 0 ]; then
    printf '\n' >&2
    printf 'FALLA: hay config presente pero no rindio ningun valor comparable.\n' >&2
    printf 'Un chequeo que pasa cuando no pudo correr es peor que no tenerlo:\n' >&2
    printf 'da la confianza sin el trabajo. Revisar que los *.json tengan\n' >&2
    printf 'valores de mas de 3 caracteres y sean JSON valido.\n' >&2
    exit 1
  fi

  printf '  %d valor(es) cargados\n' "$VALUE_COUNT"

  while IFS=$'\t' read -r src path value; do
    [ -n "$value" ] || continue
    # Occurrence-scoped: la allowlist excusa el valor en si (por ejemplo un
    # dominio reservado o un placeholder que coincida), no la linea entera
    # donde aparece. Sin este chequeo aparte, una linea con un placeholder
    # legitimo en otra parte blanquearia este valor real sin relacion.
    if grep -qE -f "$ALLOW_RX" <<<"$value" 2>/dev/null; then continue; fi
    for f in "${FILES[@]}"; do
      [ -n "$f" ] || continue
      content="$(read_file "$f")"
      [ -n "$content" ] || continue
      while IFS=: read -r lineno _line; do
        [ -n "$lineno" ] || continue
        report_hit "$f" "$lineno" "config:$src:$path" "valor local filtrado"
      done < <(printf '%s' "$content" | grep -niF -- "$value" || true)
    done
  done < "$VALUES_FILE"

  if [ "$FINDINGS" -eq 0 ]; then printf '  sin hallazgos\n'; fi
fi

printf '\n'
if [ "$FINDINGS" -gt 0 ]; then
  printf 'FALLA: %d hallazgo(s). Reemplazar por placeholders o agregar a %s.\n' \
    "$FINDINGS" "$(basename "$ALLOWLIST")" >&2
  exit 1
fi
printf 'OK\n'
