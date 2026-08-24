# claude-workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar `claude-conductor` y `claude-brain` en un repo público que cualquiera pueda clonar sin heredar el stack ni los datos de quien lo escribió.

**Architecture:** Un `core/` de tres documentos (schema de config, probes de capabilities, protocolo de resolución) que las cinco skills citan en vez de repetir. Tres capas de config: `capabilities` detectable, `user` personal, `project` por repo de trabajo. Un `install.sh` único reemplaza los dos actuales. Un checker de placeholders con dos chequeos independientes, cableado a pre-commit y CI, se construye **antes** de migrar contenido.

**Tech Stack:** Bash (`set -euo pipefail`), `python3` para encoding/parsing de JSON (ya es dependencia de los instaladores actuales), `shellcheck` para lint, `git`. Sin dependencias externas nuevas. Documentación en Markdown.

**Spec:** `docs/superpowers/specs/2026-08-24-claude-workbench-design.md`

## Global Constraints

- Licencia: Apache 2.0. El `LICENSE` viene de los dos repos anteriores y es idéntico en ambos.
- Sin dependencias externas nuevas: sólo bash, `python3`, `git`, y `shellcheck` para el lint.
- Todo script bash arranca con `set -euo pipefail`, excepto los test runners bajo `tools/tests/`, que usan `set -uo pipefail` (sin `-e`) porque un assert que falla no debe abortar la corrida y esconder los casos que quedaban por correr.
- Rutas exactas, sin variantes: `~/.claude/workbench/capabilities.json`, `~/.claude/workbench/user.json`, `<repo-de-trabajo>/.claude/workbench.project.json`.
- `user.json` se escribe con `umask 077` y termina en `chmod 600`.
- Todo JSON se escribe pasando por el encoder de `python3`, nunca por heredoc: una comilla o un backslash en un valor no puede producir un archivo roto.
- **Ningún valor real de ninguna persona o proyecto en ningún archivo commiteado.** Todo es placeholder. Sin excepciones: ni siquiera un link autorreferencial al propio repo puede llevar la cuenta real de nadie.
- Ningún documento del repo nombra los valores que se están saneando.
- El repo no importa la historia de los dos repos anteriores. La historia arranca en el commit del spec.
- Los mensajes de commit van en español, sin acentos, siguiendo conventional commits.

---

### Task 1: Scaffold y checker por forma

Construye el guardarraíl antes que cualquier contenido. El chequeo por forma
agarra patrones sensibles independientemente del valor, así que funciona en un
repo recién clonado sin ninguna config.

**Files:**
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `tools/check-placeholders.sh`
- Create: `tools/placeholder-allowlist.txt`
- Create: `tools/tests/lib.sh`
- Test: `tools/tests/test-check-placeholders.sh`

**Interfaces:**
- Consumes: nada.
- Produces: `tools/check-placeholders.sh`, invocable como
  `check-placeholders.sh [--staged] [--config-dir DIR]`, exit `0` limpio y
  exit `1` con hallazgos. `tools/tests/lib.sh` expone `assert_exit`,
  `assert_contains`, `assert_not_contains`, `report`.

- [ ] **Step 1: Copiar el LICENSE y crear el .gitignore**

```bash
cp <ruta-al-repo-de-conocimiento>/LICENSE LICENSE
cat > .gitignore <<'EOF'
# La config local nunca entra al repo: el repo es publico.
.claude/workbench.project.json
*.local.json
EOF
```

- [ ] **Step 2: Escribir el harness de tests**

`tools/tests/lib.sh`:

```bash
#!/usr/bin/env bash
# Harness minimo. Sin dependencias: bash y coreutils.
TESTS_RUN=0
TESTS_FAILED=0

_fail() {
  TESTS_FAILED=$((TESTS_FAILED + 1))
  printf '  FAIL  %s\n' "$1" >&2
  [ $# -gt 1 ] && printf '        %s\n' "$2" >&2
  return 0
}

_pass() { printf '  ok    %s\n' "$1"; }

# assert_exit <codigo-esperado> <descripcion> <comando...>
assert_exit() {
  local want="$1" desc="$2"; shift 2
  TESTS_RUN=$((TESTS_RUN + 1))
  local got=0
  "$@" >/dev/null 2>&1 || got=$?
  if [ "$got" = "$want" ]; then _pass "$desc"; else _fail "$desc" "exit esperado $want, obtenido $got"; fi
}

# assert_contains <aguja> <descripcion> <comando...>
assert_contains() {
  local needle="$1" desc="$2"; shift 2
  TESTS_RUN=$((TESTS_RUN + 1))
  local out; out="$("$@" 2>&1 || true)"
  if printf '%s' "$out" | grep -qF -- "$needle"; then _pass "$desc"
  else _fail "$desc" "no aparecio: $needle"; fi
}

# assert_not_contains <aguja> <descripcion> <comando...>
assert_not_contains() {
  local needle="$1" desc="$2"; shift 2
  TESTS_RUN=$((TESTS_RUN + 1))
  local out; out="$("$@" 2>&1 || true)"
  if printf '%s' "$out" | grep -qF -- "$needle"; then _fail "$desc" "no deberia aparecer: $needle"
  else _pass "$desc"; fi
}

report() {
  printf '\n%s: %d corridos, %d fallados\n' "${1:-tests}" "$TESTS_RUN" "$TESTS_FAILED"
  [ "$TESTS_FAILED" -eq 0 ]
}
```

- [ ] **Step 3: Escribir el test que falla**

`tools/tests/test-check-placeholders.sh`:

```bash
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

report "check-placeholders (forma)"
```

- [ ] **Step 4: Correr el test y verificar que falla**

Run: `bash tools/tests/test-check-placeholders.sh`
Expected: FAIL — `tools/check-placeholders.sh: No such file or directory`, todos los casos en FAIL.

- [ ] **Step 5: Escribir la allowlist**

`tools/placeholder-allowlist.txt`:

```
# Una expresion por linea. Se aplican como regex extendida sobre la linea
# completa: si alguna matchea, el hallazgo de esa linea se descarta.
# Dominios reservados por la RFC 2606 para documentacion.
@example\.(com|org|net)
@example\.test
@acme\.(test|com)
@empresa\.atlassian\.net
# Loopback: no identifica a nadie.
(localhost|127\.0\.0\.1)
# Los placeholders del propio repo.
REPLACE_WITH_[A-Z_]+
<[a-z-]+>
OWNER/REPO
```

- [ ] **Step 6: Implementar el chequeo por forma**

`tools/check-placeholders.sh`:

```bash
#!/usr/bin/env bash
#
# Verifica que ningun archivo commiteado contenga datos reales de una persona
# o un proyecto. Dos chequeos independientes: por forma (patrones sensibles
# sin importar el valor) y data-driven (comparacion contra la config local).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALLOWLIST="$HERE/placeholder-allowlist.txt"
MODE="tracked"
# CONFIG_DIR se reserva para el chequeo 2 (data-driven), que se agrega en una
# tarea posterior. Ya se acepta y valida aca para que la interfaz de la CLI
# no cambie despues.
# shellcheck disable=SC2034
CONFIG_DIR="$HOME/.claude/workbench"

while [ $# -gt 0 ]; do
  case "$1" in
    --staged)     MODE="staged"; shift ;;
    --config-dir) # shellcheck disable=SC2034
                  CONFIG_DIR="$2"; shift 2 ;;
    --allowlist)  ALLOWLIST="$2"; shift 2 ;;
    -h|--help)    printf 'uso: %s [--staged] [--config-dir DIR] [--allowlist PATH]\n' "$0"; exit 0 ;;
    *)            printf 'opcion desconocida: %s\n' "$1" >&2; exit 2 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"

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
      line="$(printf '%s' "$content" | sed -n "${lineno}p")"
      if grep -qE -f "$ALLOW_RX" <<<"$line" 2>/dev/null; then continue; fi
      report_hit "$f" "$lineno" "$label" "$hit"
    done < <(printf '%s' "$content" | grep -nEo "$rx" || true)
  done
done

if [ "$FINDINGS" -eq 0 ]; then printf '  sin hallazgos\n'; fi

printf '\n'
if [ "$FINDINGS" -gt 0 ]; then
  printf 'FALLA: %d hallazgo(s). Reemplazar por placeholders o agregar a %s.\n' \
    "$FINDINGS" "$(basename "$ALLOWLIST")" >&2
  exit 1
fi
printf 'OK\n'
```

- [ ] **Step 7: Correr el test y verificar que pasa**

Run: `bash tools/tests/test-check-placeholders.sh`
Expected: PASS — 8 corridos, 0 fallados.

- [ ] **Step 8: Pasar shellcheck**

Run: `shellcheck tools/check-placeholders.sh tools/tests/lib.sh tools/tests/test-check-placeholders.sh`
Expected: sin salida (exit 0).

- [ ] **Step 9: Commit**

```bash
chmod +x tools/check-placeholders.sh tools/tests/test-check-placeholders.sh
git add .gitignore LICENSE tools/
git commit -m "feat(tools): checker de placeholders por forma, con tests

Construye el guardarrail antes de migrar contenido. El chequeo por forma
agarra mails, ids largos, webhooks, tokens, claves privadas y rutas de home
sin importar el valor, asi que corre en un clon sin ninguna config."
```

---

### Task 2: Chequeo data-driven, con semántica explícita de skip y falla

El chequeo que compara contra la config local. Agarra cualquier valor sin
nombrarlo en el repo. La parte crítica es la distinción entre "no hay config
que comparar" (skip anunciado) y "hay config pero no extraje nada" (falla):
el segundo caso es un chequeo que no pudo correr, y pasar en silencio da la
confianza sin el trabajo.

**Files:**
- Modify: `tools/check-placeholders.sh`
- Modify: `tools/tests/test-check-placeholders.sh`

**Interfaces:**
- Consumes: `check-placeholders.sh` y el harness de la Task 1.
- Produces: el mismo script, ahora con exit `1` también cuando la config
  existe y no rinde valores comparables.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `tools/tests/test-check-placeholders.sh`, antes de la
línea `report`:

```bash
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
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `bash tools/tests/test-check-placeholders.sh`
Expected: los 8 de forma en `ok`; los 8 nuevos en FAIL (el script ignora
`--config-dir` y siempre sale 0 con contenido limpio).

- [ ] **Step 3: Implementar el chequeo data-driven**

Insertar en `tools/check-placeholders.sh`, entre el bloque de forma y el
bloque final de resultado:

```bash
# --- Chequeo 2: data-driven -------------------------------------------------
# Compara contra los valores reales de la config local. Nunca nombra un valor
# en el repo: los lee del disco. Un valor de 3 caracteres o menos se descarta
# porque genera ruido, no senal.
printf 'Chequeo data-driven (config: %s)\n' "$CONFIG_DIR"

if [ ! -d "$CONFIG_DIR" ]; then
  printf '  SALTEADO: no existe %s.\n' "$CONFIG_DIR"
  printf '  El chequeo por forma corrio igual. En una maquina con la config\n'
  printf '  instalada este chequeo tambien corre.\n'
else
  VALUES_FILE="$(mktemp)"
  # El trap acumula: sobreescribirlo aca filtraria el temporal de la allowlist.
  trap 'rm -f "$ALLOW_RX" "$VALUES_FILE"' EXIT

  # Aplana cada *.json de la config a lineas "archivo<TAB>ruta<TAB>valor".
  python3 - "$CONFIG_DIR" > "$VALUES_FILE" <<'PY'
import io, json, os, sys
cfg_dir = sys.argv[1]
def walk(obj, path, out):
    if isinstance(obj, dict):
        for k, v in obj.items():
            walk(v, f"{path}.{k}" if path else k, out)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            walk(v, f"{path}[{i}]", out)
    elif isinstance(obj, str) and len(obj) > 3:
        out.append((path, obj))
for name in sorted(os.listdir(cfg_dir)):
    if not name.endswith(".json"):
        continue
    full = os.path.join(cfg_dir, name)
    try:
        data = json.load(io.open(full, encoding="utf-8"))
    except (ValueError, OSError):
        continue
    rows = []
    walk(data, "", rows)
    for path, val in rows:
        print(f"{name}\t{path}\t{val}")
PY

  VALUE_COUNT="$(wc -l < "$VALUES_FILE" | tr -d ' ')"

  if [ "$VALUE_COUNT" -eq 0 ]; then
    printf '\n' >&2
    printf 'FALLA: %s existe pero no rindio ningun valor comparable.\n' "$CONFIG_DIR" >&2
    printf 'Un chequeo que pasa cuando no pudo correr es peor que no tenerlo:\n' >&2
    printf 'da la confianza sin el trabajo. Revisar que los *.json tengan\n' >&2
    printf 'valores de mas de 3 caracteres y sean JSON valido.\n' >&2
    exit 1
  fi

  printf '  %d valor(es) cargados de %s\n' "$VALUE_COUNT" "$CONFIG_DIR"

  while IFS=$'\t' read -r src path value; do
    [ -n "$value" ] || continue
    for f in "${FILES[@]}"; do
      [ -n "$f" ] || continue
      content="$(read_file "$f")"
      [ -n "$content" ] || continue
      while IFS=: read -r lineno _; do
        [ -n "$lineno" ] || continue
        report_hit "$f" "$lineno" "config:$src:$path" "valor local filtrado"
      done < <(printf '%s' "$content" | grep -nF -- "$value" | cut -d: -f1 | sed 's/$/:/' || true)
    done
  done < "$VALUES_FILE"

  if [ "$FINDINGS" -eq 0 ]; then printf '  sin hallazgos\n'; fi
fi
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `bash tools/tests/test-check-placeholders.sh`
Expected: PASS — 16 corridos, 0 fallados.

- [ ] **Step 5: Pasar shellcheck**

Run: `shellcheck tools/check-placeholders.sh`
Expected: sin salida.

- [ ] **Step 6: Commit**

```bash
git add tools/
git commit -m "feat(tools): chequeo data-driven con skip y falla explicitos

Compara los archivos contra los valores reales de la config local, sin
nombrar ninguno en el repo. La distincion que importa: config ausente es un
skip anunciado (clon nuevo, CI); config presente que no rinde valores es una
FALLA, porque es un chequeo que no pudo correr."
```

---

### Task 3: Cableado del checker — pre-commit y CI

El hook se saltea con `--no-verify`, así que CI no es redundante: es el que
no se puede saltear.

**Files:**
- Create: `tools/hooks/pre-commit`
- Create: `.github/workflows/placeholders.yml`
- Test: `tools/tests/test-hook.sh`

**Interfaces:**
- Consumes: `tools/check-placeholders.sh --staged` de la Task 2.
- Produces: `tools/hooks/pre-commit`, instalable por symlink a
  `.git/hooks/pre-commit`.

- [ ] **Step 1: Escribir el test que falla**

`tools/tests/test-hook.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
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

sucio_mail="alguien@""empresa-real.com"
printf 'mail: %s\n' "$sucio_mail" > "$d/sucio.md"
assert_exit 0 "un archivo sucio SIN stagear no frena el commit" \
  env -C "$d" git commit -q --allow-empty -m vacio

git -C "$d" add sucio.md
assert_exit 1 "el mismo archivo stageado SI frena el commit" \
  env -C "$d" git commit -q -m "intento"

report "pre-commit hook"
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bash tools/tests/test-hook.sh`
Expected: FAIL en el segundo caso — sin hook, el commit pasa (exit 0, se
esperaba 1).

- [ ] **Step 3: Implementar el hook**

`tools/hooks/pre-commit`:

```bash
#!/usr/bin/env bash
# Instalado por install.sh como symlink a .git/hooks/pre-commit.
# Corre sobre el contenido staged, que es el que realmente se va a commitear.
set -euo pipefail
REPO="$(git rev-parse --show-toplevel)"
exec "$REPO/tools/check-placeholders.sh" --staged
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `chmod +x tools/hooks/pre-commit && bash tools/tests/test-hook.sh`
Expected: PASS — 2 corridos, 0 fallados.

- [ ] **Step 5: Escribir el workflow de CI**

`.github/workflows/placeholders.yml`:

```yaml
name: placeholders

on:
  push:
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: shellcheck
        run: shellcheck tools/*.sh tools/hooks/pre-commit tools/tests/*.sh install.sh
      - name: chequeo de placeholders
        # En CI no hay config local, asi que el data-driven se saltea con
        # aviso y corre el chequeo por forma. Es honesto: el hook local es el
        # que tiene los valores reales para comparar.
        run: ./tools/check-placeholders.sh
      - name: tests
        run: |
          for t in tools/tests/test-*.sh; do
            echo "== $t"
            bash "$t"
          done
```

- [ ] **Step 6: Verificar que los tests corren todos juntos**

Run: `for t in tools/tests/test-*.sh; do bash "$t" || exit 1; done`
Expected: los dos suites en 0 fallados.

- [ ] **Step 7: Commit**

```bash
chmod +x tools/hooks/pre-commit tools/tests/test-hook.sh
git add tools/ .github/
git commit -m "feat(ci): cablea el checker a pre-commit y a CI

El hook corre sobre el indice, no sobre el working tree. CI no es redundante
con el hook: es el que no se puede saltear con --no-verify."
```

---

### Task 4: `core/config-schema.md` y el validador de consistencia

Fusiona los dos schemas actuales en uno de tres capas, y agrega el script que
impide que las cinco skills se desincronicen de él.

**Files:**
- Create: `core/config-schema.md`
- Create: `tools/check-schema-refs.sh`
- Test: `tools/tests/test-check-schema-refs.sh`

**Interfaces:**
- Consumes: el harness de la Task 1.
- Produces: `core/config-schema.md` con una tabla por capa donde la primera
  columna es el nombre exacto del campo; `tools/check-schema-refs.sh`, exit
  `1` si una skill referencia un campo ausente del schema.

- [ ] **Step 1: Escribir el schema**

`core/config-schema.md`. Tres secciones, una por capa. Cada campo en una
tabla cuya primera columna es el nombre exacto entre backticks, porque el
validador del Step 3 parsea justamente eso.

Contenido a escribir:

- **Encabezado**: las tres rutas exactas, y la regla de que nada de esto entra
  al repo.
- **Capa `capabilities`** (`~/.claude/workbench/capabilities.json`): la
  partición `detected` / `choices`, con la razón — el probe sólo pisa
  `detected`, así que re-detectar no borra decisiones.

  Campos de `detected`, y **sólo** hechos del sistema: `orca` (boolean), `gh`
  (boolean), `python3` (boolean).

  Campos de `choices`, todo lo que es elección y no hecho: `tracker`
  (string o `null` — es una elección, no algo que el sistema revele),
  `worktrees` (`"orca" | "git-worktree" | "checkout"`), `announce`
  (`"canal" | "skip"`), y `askEveryTime` (string[], claves a re-preguntar
  siempre).

  La línea divisoria tiene que quedar escrita en el documento: un probe
  responde por hechos del sistema; una elección del usuario se pregunta y va a
  `choices`. Mezclarlas es lo que haría que re-detectar pise decisiones.
- **Capa `user`** (`~/.claude/workbench/user.json`, `chmod 600`): `author`
  (string, handle del remoto), `announce.channelUrl` (string),
  `announce.mention.name` (string), `announce.mention.id` (string, opcional).
- **Capa `project`** (`<repo>/.claude/workbench.project.json`): todo el
  esquema que hoy tiene `ticket-workflow` —`trackerPrefix`, `tracker`,
  `branchTypes`, `descriptionLanguage`, `baseBranch`,
  `baseBranchFromTicketLabel`, `environmentLabelGroup`, `environmentLabels`,
  `typeLabelMap`, `commitConvention`, `branchPattern`, `branchNameCI`,
  `orca.repoId`, `orca.useWorktrees`, `orca.worktreeLevel`, `reviewers`,
  `qa`— más los cinco campos que bajan de la capa de usuario: `repos`
  (array de `{slug, tag}`), `orca.wrapperRepoId`, `gateWorkflow`,
  `notifiedLabel`, `relayGates`.
- **Sección de recolocación**: por qué esos cinco bajaron, en una frase — a
  nivel usuario atan a un solo workspace.
- **Ejemplo completo por capa**, con placeholders y sin un solo valor real.

- [ ] **Step 2: Escribir el test que falla**

`tools/tests/test-check-schema-refs.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
. "$HERE/lib.sh"

CHECK="$REPO/tools/check-schema-refs.sh"

fixture() {
  local dir; dir="$(mktemp -d)"
  mkdir -p "$dir/core" "$dir/skills/demo"
  printf '%s\n' '| Campo | Tipo |' '|---|---|' "$1" > "$dir/core/config-schema.md"
  printf '%s\n' "$2" > "$dir/skills/demo/SKILL.md"
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

report "check-schema-refs"
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `bash tools/tests/test-check-schema-refs.sh`
Expected: FAIL — script inexistente.

- [ ] **Step 4: Implementar el validador**

`tools/check-schema-refs.sh`:

```bash
#!/usr/bin/env bash
#
# Valida que todo campo que una skill declara en su seccion "## Requiere"
# exista en core/config-schema.md, y que toda skill declare esa seccion.
set -euo pipefail

ROOT="${1:-$(git rev-parse --show-toplevel)}"
SCHEMA="$ROOT/core/config-schema.md"

[ -f "$SCHEMA" ] || { printf 'no existe %s\n' "$SCHEMA" >&2; exit 1; }

# Los nombres de campo del schema son la primera celda de cada fila de tabla,
# entre backticks.
KNOWN="$(grep -oE '^\| *`[A-Za-z0-9_.]+`' "$SCHEMA" | tr -d '|` ' | sort -u)"
[ -n "$KNOWN" ] || { printf 'el schema no declara ningun campo\n' >&2; exit 1; }

FAILED=0
for skill in "$ROOT"/skills/*/SKILL.md; do
  [ -f "$skill" ] || continue
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
    leaf="${ref##*.}"
    if ! printf '%s\n' "$KNOWN" | grep -qx "$leaf" \
       && ! printf '%s\n' "$KNOWN" | grep -qx "${ref#*.}"; then
      printf 'FALLA: %s referencia %s, ausente del schema.\n' "$name" "$ref" >&2
      FAILED=$((FAILED + 1))
    fi
  done <<< "$refs"
done

if [ "$FAILED" -gt 0 ]; then
  printf '\n%d problema(s) de consistencia entre skills y schema.\n' "$FAILED" >&2
  exit 1
fi
printf 'OK: skills y schema consistentes.\n'
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `bash tools/tests/test-check-schema-refs.sh`
Expected: PASS — 4 corridos, 0 fallados.

- [ ] **Step 6: Verificar el checker de placeholders sobre el schema nuevo**

Run: `./tools/check-placeholders.sh`
Expected: OK. El schema tiene ejemplos, y ninguno con un valor real.

- [ ] **Step 7: Commit**

```bash
chmod +x tools/check-schema-refs.sh tools/tests/test-check-schema-refs.sh
git add core/config-schema.md tools/
git commit -m "feat(core): schema de las tres capas y validador de consistencia

Fusiona los dos config-schema anteriores en uno de tres capas y baja a la capa
project los cinco campos que estaban a nivel usuario y ataban a un solo
workspace. El validador impide que las skills se desincronicen del schema."
```

---

### Task 5: `core/resolve.md` — el protocolo de resolución

El artefacto central del diseño. Es documento, no código, pero se le puede
poner un test: que las cinco skills lo citen.

**Files:**
- Create: `core/resolve.md`
- Create: `tools/check-core-refs.sh`
- Test: `tools/tests/test-check-core-refs.sh`

**Interfaces:**
- Consumes: el harness de la Task 1.
- Produces: `core/resolve.md`; `tools/check-core-refs.sh`, exit `1` si una
  skill no cita el protocolo.

- [ ] **Step 1: Escribir el protocolo**

`core/resolve.md`. Contenido a escribir:

- **Cuándo se dispara**: las tres clases de hueco — falta una capability,
  falta un valor de config, la situación es ambigua.
- **La forma de la pregunta**: enumerar opciones concretas con su
  consecuencia. Nunca preguntar abierto cuando las opciones son enumerables.
  Con el ejemplo del worktree sin Orca: tres opciones numeradas, cada una
  diciendo qué implica.
- **Qué persiste y qué no**, en tabla: preferencia permanente → `choices`;
  hecho del proyecto → `project`; decisión de una vez → **no persiste**. Con
  la razón explícita de por qué la tercera fila existe: sin ella el config se
  llena de respuestas de un solo uso y meses después aplica en silencio una
  decisión tomada para un caso puntual.
- **Cómo se anuncia** una decisión ya guardada: una línea, con el motivo.
  Ejemplo: `Worktree por git worktree (Orca ausente).`
- **El escape**: `askEveryTime` desancla cualquier decisión guardada.
- **La sección `## Requiere`**: qué forma tiene, y sus tres consumidores —
  instalador, skill, validador.

- [ ] **Step 2: Escribir el test que falla**

`tools/tests/test-check-core-refs.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
. "$HERE/lib.sh"

CHECK="$REPO/tools/check-core-refs.sh"

fixture() {
  local dir; dir="$(mktemp -d)"
  mkdir -p "$dir/core" "$dir/skills/demo"
  touch "$dir/core/resolve.md"
  printf '%s\n' "$1" > "$dir/skills/demo/SKILL.md"
  printf '%s' "$dir"
}

d=$(fixture 'Ante un hueco, seguir `core/resolve.md`.')
assert_exit 0 "pasa cuando la skill cita el protocolo" "$CHECK" "$d"

d=$(fixture 'Esta skill no cita nada.')
assert_exit 1 "falla cuando la skill no cita el protocolo" "$CHECK" "$d"
assert_contains "demo" "nombra la skill que no cita" "$CHECK" "$d"

report "check-core-refs"
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `bash tools/tests/test-check-core-refs.sh`
Expected: FAIL — script inexistente.

- [ ] **Step 4: Implementar el validador**

`tools/check-core-refs.sh`:

```bash
#!/usr/bin/env bash
#
# El protocolo de resolucion vive en un lugar y las skills lo citan. Si una
# skill no lo cita, es candidata a divergir: reimplementa la convencion por su
# cuenta y con el tiempo deja de coincidir con las otras.
set -euo pipefail

ROOT="${1:-$(git rev-parse --show-toplevel)}"
[ -f "$ROOT/core/resolve.md" ] || { printf 'no existe core/resolve.md\n' >&2; exit 1; }

FAILED=0
for skill in "$ROOT"/skills/*/SKILL.md; do
  [ -f "$skill" ] || continue
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
printf 'OK: todas las skills citan el protocolo.\n'
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `bash tools/tests/test-check-core-refs.sh`
Expected: PASS — 3 corridos, 0 fallados.

- [ ] **Step 6: Commit**

```bash
chmod +x tools/check-core-refs.sh tools/tests/test-check-core-refs.sh
git add core/resolve.md tools/
git commit -m "feat(core): protocolo de resolucion, y validador de que las skills lo citen

El protocolo vive en un lugar y se referencia. La distincion que evita que el
sistema envejezca mal: una decision de una sola vez no se guarda."
```

---

### Task 6: `install.sh` — symlinks e idempotencia

La base del instalador unificado. Es el bloque que hoy está duplicado en los
dos repos. La idempotencia es su promesa declarada ("safe to re-run") y hoy no
está probada.

**Files:**
- Create: `install.sh`
- Test: `tools/tests/test-install-symlinks.sh`

**Interfaces:**
- Consumes: nada.
- Produces: `install.sh` con `--skills-only` para poder testear el linkeo sin
  el flujo interactivo, y `WORKBENCH_HOME` como override de `$HOME`.

- [ ] **Step 1: Escribir el test que falla**

`tools/tests/test-install-symlinks.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
. "$HERE/lib.sh"

run_install() {
  local home="$1"; shift
  WORKBENCH_HOME="$home" bash "$REPO/install.sh" --skills-only "$@"
}

# --- linkea las skills ---
H="$(mktemp -d)"
assert_exit 0 "corre limpio en un HOME vacio" run_install "$H"
TESTS_RUN=$((TESTS_RUN + 1))
if [ -L "$H/.claude/skills/conductor" ]; then _pass "creo el symlink de conductor"
else _fail "creo el symlink de conductor" "no existe $H/.claude/skills/conductor"; fi

# --- idempotencia: la segunda corrida no cambia nada ---
before="$(find "$H/.claude/skills" -maxdepth 1 -printf '%f %l\n' | sort)"
assert_exit 0 "la segunda corrida tambien sale 0" run_install "$H"
after="$(find "$H/.claude/skills" -maxdepth 1 -printf '%f %l\n' | sort)"
TESTS_RUN=$((TESTS_RUN + 1))
if [ "$before" = "$after" ]; then _pass "la segunda corrida no cambia el estado"
else _fail "la segunda corrida no cambia el estado" "el arbol de symlinks cambio"; fi
assert_contains "already linked" "la segunda corrida reporta ya-linkeado" run_install "$H"

# --- no pisa un archivo real ---
H2="$(mktemp -d)"; mkdir -p "$H2/.claude/skills/conductor"
printf 'mio\n' > "$H2/.claude/skills/conductor/SKILL.md"
assert_exit 0 "no falla ante un directorio real preexistente" run_install "$H2"
assert_contains "not touching" "avisa que no toca un directorio real" run_install "$H2"
TESTS_RUN=$((TESTS_RUN + 1))
if [ -f "$H2/.claude/skills/conductor/SKILL.md" ]; then _pass "dejo intacto el directorio real"
else _fail "dejo intacto el directorio real" "lo borro"; fi

# --- un directorio sin SKILL.md no se linkea ---
H3="$(mktemp -d)"
mkdir -p "$REPO/skills/_vacia_test"
assert_exit 0 "corre con una skill incompleta presente" run_install "$H3"
TESTS_RUN=$((TESTS_RUN + 1))
if [ ! -e "$H3/.claude/skills/_vacia_test" ]; then _pass "no linkea un dir sin SKILL.md"
else _fail "no linkea un dir sin SKILL.md" "lo linkeo igual"; fi
rmdir "$REPO/skills/_vacia_test"

report "install.sh symlinks"
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bash tools/tests/test-install-symlinks.sh`
Expected: FAIL — `install.sh` no existe.

- [ ] **Step 3: Implementar el instalador base**

`install.sh`:

```bash
#!/usr/bin/env bash
#
# Instala claude-workbench: linkea las skills en ~/.claude/skills/ para que
# Claude Code las descubra en cualquier proyecto, y crea la config local en
# ~/.claude/workbench/ — nunca dentro del repo, porque el repo es publico.
# Seguro de re-correr.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# WORKBENCH_HOME existe para que los tests corran contra un HOME temporal.
HOME_DIR="${WORKBENCH_HOME:-$HOME}"
SKILLS_SRC="$REPO_DIR/skills"
SKILLS_DEST="$HOME_DIR/.claude/skills"
CONFIG_DIR="$HOME_DIR/.claude/workbench"

SKILLS_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --skills-only) SKILLS_ONLY=1; shift ;;
    -h|--help) printf 'uso: %s [--skills-only]\n' "$0"; exit 0 ;;
    *) printf 'opcion desconocida: %s\n' "$1" >&2; exit 2 ;;
  esac
done

mkdir -p "$SKILLS_DEST"

printf 'Instalando skills de %s en %s\n\n' "$SKILLS_SRC" "$SKILLS_DEST"

for skill_dir in "$SKILLS_SRC"/*/; do
  [ -d "$skill_dir" ] || continue
  name="$(basename "$skill_dir")"
  target="${skill_dir%/}"
  dest="$SKILLS_DEST/$name"

  # Un directorio sin SKILL.md no es una skill usable todavia. Linkearlo
  # dejaria una entrada rota en ~/.claude/skills/.
  if [ ! -f "$target/SKILL.md" ]; then
    printf '  skip    %s (sin SKILL.md)\n' "$name"
    continue
  fi

  if [ -L "$dest" ]; then
    current="$(readlink "$dest")"
    if [ "$current" = "$target" ]; then
      printf '  ok      %s (already linked)\n' "$name"
    else
      printf '  skip    %s (symlink a otro lugar: %s)\n' "$name" "$current"
    fi
  elif [ -e "$dest" ]; then
    printf '  skip    %s (archivo o dir real ya existe, not touching it)\n' "$name"
  else
    ln -s "$target" "$dest"
    printf '  linked  %s -> %s\n' "$name" "$dest"
  fi
done

printf '\n'

if [ "$SKILLS_ONLY" -eq 1 ]; then
  printf 'Modo --skills-only: no se toca la config.\n'
  exit 0
fi

mkdir -p "$CONFIG_DIR"
printf 'Config en %s\n' "$CONFIG_DIR"
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `chmod +x install.sh && bash tools/tests/test-install-symlinks.sh`
Expected: PASS — 9 corridos, 0 fallados.

- [ ] **Step 5: Pasar shellcheck**

Run: `shellcheck install.sh`
Expected: sin salida.

- [ ] **Step 6: Commit**

```bash
git add install.sh tools/
git commit -m "feat(install): instalador unificado, linkeo de skills con test de idempotencia

Reemplaza el bloque de symlinks duplicado en los dos repos anteriores. La
idempotencia era una promesa declarada y sin probar: ahora hay un test que
corre el instalador dos veces y compara el arbol de symlinks."
```

---

### Task 7: `install.sh` — detección de capabilities y `core/capabilities.md`

**Files:**
- Create: `core/capabilities.md`
- Modify: `install.sh`
- Test: `tools/tests/test-install-capabilities.sh`

**Interfaces:**
- Consumes: `install.sh` de la Task 6.
- Produces: `capabilities.json` con la partición `detected`/`choices`, y la
  garantía de que re-correr no toca `choices`.

- [ ] **Step 1: Escribir el test que falla**

`tools/tests/test-install-capabilities.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
. "$HERE/lib.sh"

detect() { WORKBENCH_HOME="$1" bash "$REPO/install.sh" --detect-only; }

H="$(mktemp -d)"
assert_exit 0 "la deteccion corre sola" detect "$H"
CAP="$H/.claude/workbench/capabilities.json"

TESTS_RUN=$((TESTS_RUN + 1))
if [ -f "$CAP" ]; then _pass "escribio capabilities.json"
else _fail "escribio capabilities.json" "no existe $CAP"; fi

assert_exit 0 "capabilities.json es JSON valido" python3 -m json.tool "$CAP"
assert_contains '"detected"' "tiene el bloque detected" cat "$CAP"
assert_contains '"choices"' "tiene el bloque choices" cat "$CAP"

# El invariante central: re-detectar NO borra las decisiones del usuario.
python3 - "$CAP" <<'PY'
import io, json, sys
p = sys.argv[1]
d = json.load(io.open(p))
d["choices"]["worktrees"] = "git-worktree"
json.dump(d, io.open(p, "w"), indent=2)
PY
detect "$H" >/dev/null 2>&1
assert_contains 'git-worktree' "re-detectar preserva choices" cat "$CAP"

report "install.sh capabilities"
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bash tools/tests/test-install-capabilities.sh`
Expected: FAIL — `--detect-only` es una opción desconocida, exit 2.

- [ ] **Step 3: Escribir `core/capabilities.md`**

Documenta cada probe con el comando exacto y qué se concluye:

| Capability | Probe | Verdadero si |
|---|---|---|
| `gh` | `command -v gh` | el binario existe en PATH |
| `orca` | `command -v orca-ide` | el binario existe en PATH |
| `python3` | `command -v python3` | el binario existe en PATH |
| `tracker` | no se detecta | se pregunta: es una elección, no un hecho del sistema |
| `discord` | no se detecta | se deriva de que `user.announce.channelUrl` esté seteado |

Y la regla: un probe responde por hechos del sistema. Lo que es una elección
del usuario no se detecta, se pregunta — y va a `choices`, no a `detected`.

- [ ] **Step 4: Implementar la detección**

En `install.sh`, agregar `--detect-only` al parseo de opciones y esta función,
llamada antes del bloque de config:

```bash
detect_capabilities() {
  local cap="$CONFIG_DIR/capabilities.json"
  mkdir -p "$CONFIG_DIR"

  local has_gh=false has_orca=false has_py=false
  command -v gh        >/dev/null 2>&1 && has_gh=true
  command -v orca-ide  >/dev/null 2>&1 && has_orca=true
  command -v python3   >/dev/null 2>&1 && has_py=true

  printf 'Detectando integraciones\n'
  printf '  gh        %s\n' "$has_gh"
  printf '  orca-ide  %s\n' "$has_orca"
  printf '  python3   %s\n' "$has_py"

  # Escribe solo el bloque detected. choices es del usuario: lo preserva tal
  # cual, o lo crea vacio si es la primera corrida.
  python3 - "$cap" "$has_gh" "$has_orca" "$has_py" <<'PY'
import io, json, os, sys
path, gh, orca, py = sys.argv[1:5]
prev = {}
if os.path.exists(path):
    try:
        prev = json.load(io.open(path, encoding="utf-8"))
    except ValueError:
        prev = {}
data = {
    "detected": {
        "gh": gh == "true",
        "orca": orca == "true",
        "python3": py == "true",
    },
    "choices": prev.get("choices", {}),
}
with io.open(path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
PY
  printf '  escrito %s\n\n' "$cap"
}
```

Y en el flujo principal, después del linkeo:

```bash
detect_capabilities
if [ "$DETECT_ONLY" -eq 1 ]; then exit 0; fi
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `bash tools/tests/test-install-capabilities.sh`
Expected: PASS — 6 corridos, 0 fallados.

- [ ] **Step 6: Commit**

```bash
git add core/capabilities.md install.sh tools/
git commit -m "feat(install): deteccion de capabilities preservando las decisiones

El probe escribe solo el bloque detected. choices es del usuario y no se toca:
re-detectar Orca no vuelve a preguntar que hacer sin Orca."
```

---

### Task 8: `install.sh` — config de usuario interactiva

**Files:**
- Modify: `install.sh`
- Test: `tools/tests/test-install-user.sh`

**Interfaces:**
- Consumes: `install.sh` de la Task 7.
- Produces: `user.json` con permisos `600`, escrito por el encoder de
  `python3`.

- [ ] **Step 1: Escribir el test que falla**

`tools/tests/test-install-user.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
. "$HERE/lib.sh"

# Las respuestas entran por stdin, en el orden en que se preguntan.
install_with() {
  local home="$1" answers="$2"
  printf '%s' "$answers" | WORKBENCH_HOME="$home" bash "$REPO/install.sh" >/dev/null 2>&1
}

H="$(mktemp -d)"
install_with "$H" 'un-handle
https://chat.example/c/1
Nombre Apellido

'
USER_JSON="$H/.claude/workbench/user.json"

TESTS_RUN=$((TESTS_RUN + 1))
if [ -f "$USER_JSON" ]; then _pass "escribio user.json"
else _fail "escribio user.json" "no existe"; fi

assert_exit 0 "user.json es JSON valido" python3 -m json.tool "$USER_JSON"
assert_contains 'un-handle' "guardo el handle" cat "$USER_JSON"

TESTS_RUN=$((TESTS_RUN + 1))
perms="$(stat -c '%a' "$USER_JSON")"
if [ "$perms" = 600 ]; then _pass "user.json tiene permisos 600"
else _fail "user.json tiene permisos 600" "tiene $perms"; fi

# Una comilla o un backslash en un valor no puede romper el JSON.
H2="$(mktemp -d)"
install_with "$H2" 'un-handle
https://chat.example/c/1
O'"'"'Brien "Apodo" \o/

'
assert_exit 0 "un valor con comillas y backslash produce JSON valido" \
  python3 -m json.tool "$H2/.claude/workbench/user.json"

# Re-correr no repregunta ni pisa.
H3="$(mktemp -d)"
install_with "$H3" 'handle-uno
https://chat.example/c/1
Nombre

'
assert_contains 'handle-uno' "la segunda corrida preserva el valor" \
  env WORKBENCH_HOME="$H3" bash -c "bash '$REPO/install.sh' </dev/null >/dev/null 2>&1; cat '$H3/.claude/workbench/user.json'"

# Un campo obligatorio vacio no escribe nada.
H4="$(mktemp -d)"
assert_exit 1 "un campo obligatorio vacio aborta" \
  bash -c "printf '\n\n\n\n' | WORKBENCH_HOME='$H4' bash '$REPO/install.sh'"

report "install.sh user config"
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bash tools/tests/test-install-user.sh`
Expected: FAIL — no se escribe `user.json`.

- [ ] **Step 3: Implementar la creación de la config de usuario**

En `install.sh`:

```bash
create_user_config() {
  local uf="$CONFIG_DIR/user.json"

  if [ -f "$uf" ]; then
    printf 'Ya existe %s, no se toca.\n' "$uf"
    printf 'Para empezar de cero: rm %s && ./install.sh\n\n' "$uf"
    return 0
  fi

  if [ ! -t 0 ]; then
    printf 'Nota: stdin no es una terminal, las respuestas se leen del pipe.\n\n'
  fi

  printf 'No hay config de usuario. Creando %s.\n' "$uf"
  printf 'Este archivo nunca entra al repo: el repo es publico.\n\n'

  local author channel mention_name mention_id
  read -r -p "Tu handle del remoto (solo tus PRs se anuncian): " author
  read -r -p "URL del canal donde anunciar: " channel
  read -r -p "Nombre a tipear despues del @: " mention_name
  read -r -p "Id de usuario para la mencion (opcional, Enter para saltear): " mention_id

  local missing=""
  [ -n "$author" ]       || missing="$missing handle"
  [ -n "$channel" ]      || missing="$missing canal"
  [ -n "$mention_name" ] || missing="$missing nombre-de-mencion"
  if [ -n "$missing" ]; then
    printf '\nError: falta(n)%s. No se escribio nada.\n' "$missing" >&2
    exit 1
  fi

  # Por el encoder de python, no por heredoc: una comilla o un backslash en un
  # valor no puede producir un archivo roto.
  umask 077
  python3 - "$uf" "$author" "$channel" "$mention_name" "$mention_id" <<'PY'
import io, json, sys
path, author, channel, mention_name, mention_id = sys.argv[1:6]
config = {
    "author": author,
    "announce": {
        "channelUrl": channel,
        "mention": {"name": mention_name, "id": mention_id},
    },
}
with io.open(path, "w", encoding="utf-8") as fh:
    json.dump(config, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
PY

  python3 -m json.tool "$uf" > /dev/null || {
    printf 'Error: %s no es JSON valido. Revisar a mano.\n' "$uf" >&2
    exit 1
  }
  chmod 600 "$uf"

  printf '\nEscrito %s (permisos %s), JSON valido.\n' "$uf" "$(stat -c '%a' "$uf")"
  if [ -z "$mention_id" ]; then
    printf 'Nota: sin id de mencion, el flujo no puede verificar que una\n'
    printf 'mencion resolvio, asi que va a ser mas cauto antes de anunciar.\n'
  fi
  printf '\n'
}
```

Llamarla después de `detect_capabilities`.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bash tools/tests/test-install-user.sh`
Expected: PASS — 7 corridos, 0 fallados.

- [ ] **Step 5: Commit**

```bash
git add install.sh tools/
git commit -m "feat(install): config de usuario interactiva con permisos 600

Todo valor pasa por el encoder de python y no por heredoc: una comilla o un
backslash en un nombre no puede producir un config roto. Hay test para eso."
```

---

### Task 9: `install.sh` — migración del config anterior con reparto visible

**Files:**
- Modify: `install.sh`
- Test: `tools/tests/test-install-migrate.sh`

**Interfaces:**
- Consumes: `install.sh` de la Task 8.
- Produces: importación de `~/.claude/conductor.config.json`, mostrando el
  reparto por capa antes de escribir.

- [ ] **Step 1: Escribir el test que falla**

`tools/tests/test-install-migrate.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
. "$HERE/lib.sh"

seed_old() {
  local home="$1"; mkdir -p "$home/.claude"
  local id_fixture="100000000""000000001"
  cat > "$home/.claude/conductor.config.json" <<EOF
{
  "author": "handle-viejo",
  "discord": { "channelUrl": "https://chat.example/c/7",
               "mention": { "name": "Nombre Apellido", "id": "$id_fixture" } },
  "repos": [ { "slug": "OWNER/repo-front", "tag": "FRONT" } ],
  "gateWorkflow": "Tests & Coverage",
  "notifiedLabel": "ya-anunciado",
  "relayGates": "all",
  "orca": { "wrapperRepoId": "00000000-0000-0000-0000-000000000000" }
}
EOF
}

H="$(mktemp -d)"; seed_old "$H"
OUT="$(printf 's\n' | WORKBENCH_HOME="$H" bash "$REPO/install.sh" 2>&1 || true)"

TESTS_RUN=$((TESTS_RUN + 1))
if printf '%s' "$OUT" | grep -q 'conductor.config.json'; then _pass "detecta el config anterior"
else _fail "detecta el config anterior" "no lo menciono"; fi

TESTS_RUN=$((TESTS_RUN + 1))
if printf '%s' "$OUT" | grep -q 'user.json' && printf '%s' "$OUT" | grep -q 'project'; then
  _pass "muestra el reparto por capa"
else _fail "muestra el reparto por capa" "no mostro las dos capas destino"; fi

U="$H/.claude/workbench/user.json"
assert_contains 'handle-viejo' "importo el handle a la capa user" cat "$U"

TESTS_RUN=$((TESTS_RUN + 1))
if ! grep -q 'gateWorkflow' "$U"; then _pass "no metio campos de project en user"
else _fail "no metio campos de project en user" "gateWorkflow quedo en user.json"; fi

# Los campos de project se dejan listados, no se escriben: no se sabe todavia
# a que repo pertenecen.
TESTS_RUN=$((TESTS_RUN + 1))
if printf '%s' "$OUT" | grep -qi 'repos'; then _pass "lista los campos de project pendientes"
else _fail "lista los campos de project pendientes" "no los menciono"; fi

# Declinar la importacion no escribe nada.
H2="$(mktemp -d)"; seed_old "$H2"
printf 'n\nhandle-nuevo\nhttps://chat.example/c/1\nNombre\n\n' \
  | WORKBENCH_HOME="$H2" bash "$REPO/install.sh" >/dev/null 2>&1 || true
assert_contains 'handle-nuevo' "si declinas la importacion, pregunta de cero" \
  cat "$H2/.claude/workbench/user.json"

report "install.sh migracion"
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bash tools/tests/test-install-migrate.sh`
Expected: FAIL — no hay lógica de migración.

- [ ] **Step 3: Implementar la migración**

En `install.sh`, antes de `create_user_config`:

```bash
migrate_old_config() {
  local old="$HOME_DIR/.claude/conductor.config.json"
  local uf="$CONFIG_DIR/user.json"
  [ -f "$old" ] || return 0
  [ ! -f "$uf" ] || return 0

  printf 'Encontre un config anterior en %s\n\n' "$old"
  printf 'Reparto propuesto:\n\n'
  printf '  -> user.json (es tuyo, vale para cualquier proyecto)\n'
  printf '       author, discord.channelUrl, discord.mention\n\n'
  printf '  -> project (es del proyecto, va en el repo de trabajo)\n'
  printf '       repos, orca.wrapperRepoId, gateWorkflow,\n'
  printf '       notifiedLabel, relayGates\n\n'
  printf 'Los campos de project no se escriben ahora: todavia no se sabe a que\n'
  printf 'repo pertenecen. Se piden la primera vez que trabajes en uno, y este\n'
  printf 'archivo queda donde esta para consultarlo.\n\n'

  local answer
  read -r -p "Importar el bloque de usuario? [s/N] " answer
  case "$answer" in
    s|S|si|SI|y|Y) ;;
    *) printf 'No se importa. Se preguntan los valores de cero.\n\n'; return 0 ;;
  esac

  umask 077
  python3 - "$old" "$uf" <<'PY'
import io, json, sys
src, dst = sys.argv[1:3]
old = json.load(io.open(src, encoding="utf-8"))
disc = old.get("discord", {}) or {}
ment = disc.get("mention", {}) or {}
new = {
    "author": old.get("author", ""),
    "announce": {
        "channelUrl": disc.get("channelUrl", ""),
        "mention": {"name": ment.get("name", ""), "id": ment.get("id", "")},
    },
}
with io.open(dst, "w", encoding="utf-8") as fh:
    json.dump(new, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
PY
  chmod 600 "$uf"
  printf 'Importado a %s.\n\n' "$uf"
}
```

Llamarla antes de `create_user_config` — que ya no hace nada si el archivo
existe, así que la migración gana sin condicional extra.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bash tools/tests/test-install-migrate.sh`
Expected: PASS — 6 corridos, 0 fallados.

- [ ] **Step 5: Commit**

```bash
git add install.sh tools/
git commit -m "feat(install): importa el config anterior con reparto visible

Muestra que campo va a que capa antes de escribir. Los cinco campos que bajan
a project no se escriben todavia: no se sabe a que repo pertenecen."
```

---

### Task 10: `install.sh` — repuntado de symlinks de los repos anteriores

El riesgo que el spec marca: el instalador actual saltea un symlink que apunta
a otro lado, así que instalás el repo nuevo y seguís corriendo las skills
viejas sin aviso.

**Files:**
- Modify: `install.sh`
- Test: `tools/tests/test-install-repoint.sh`

**Interfaces:**
- Consumes: `install.sh` de la Task 9.
- Produces: detección de symlinks que apuntan a `claude-brain` o
  `claude-conductor`, con confirmación por cada uno.

- [ ] **Step 1: Escribir el test que falla**

`tools/tests/test-install-repoint.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
. "$HERE/lib.sh"

setup() {
  local home="$1" old="$2"
  mkdir -p "$home/.claude/skills" "$old/skills/conductor"
  printf '# vieja\n' > "$old/skills/conductor/SKILL.md"
  ln -s "$old/skills/conductor" "$home/.claude/skills/conductor"
}

# Apunta a un claude-conductor viejo: ofrece repuntar.
H="$(mktemp -d)"; OLD="$(mktemp -d)/claude-conductor"; mkdir -p "$OLD"
setup "$H" "$OLD"
OUT="$(printf 's\n' | WORKBENCH_HOME="$H" bash "$REPO/install.sh" --skills-only 2>&1 || true)"
TESTS_RUN=$((TESTS_RUN + 1))
if printf '%s' "$OUT" | grep -qi 'repunt'; then _pass "ofrece repuntar el symlink viejo"
else _fail "ofrece repuntar el symlink viejo" "no lo ofrecio"; fi

TESTS_RUN=$((TESTS_RUN + 1))
if [ "$(readlink "$H/.claude/skills/conductor")" = "$REPO/skills/conductor" ]; then
  _pass "repunto el symlink al repo nuevo"
else _fail "repunto el symlink al repo nuevo" "sigue en $(readlink "$H/.claude/skills/conductor")"; fi

# Declinar deja el symlink como estaba.
H2="$(mktemp -d)"; OLD2="$(mktemp -d)/claude-brain"; mkdir -p "$OLD2"
setup "$H2" "$OLD2"
printf 'n\n' | WORKBENCH_HOME="$H2" bash "$REPO/install.sh" --skills-only >/dev/null 2>&1 || true
TESTS_RUN=$((TESTS_RUN + 1))
if [ "$(readlink "$H2/.claude/skills/conductor")" = "$OLD2/skills/conductor" ]; then
  _pass "si declinas, no toca el symlink"
else _fail "si declinas, no toca el symlink" "lo cambio igual"; fi

# Un symlink a un tercer lugar desconocido no se ofrece repuntar.
H3="$(mktemp -d)"; OTHER="$(mktemp -d)/otra-cosa"; mkdir -p "$OTHER/skills/conductor"
printf '# x\n' > "$OTHER/skills/conductor/SKILL.md"
mkdir -p "$H3/.claude/skills"; ln -s "$OTHER/skills/conductor" "$H3/.claude/skills/conductor"
OUT3="$(WORKBENCH_HOME="$H3" bash "$REPO/install.sh" --skills-only </dev/null 2>&1 || true)"
TESTS_RUN=$((TESTS_RUN + 1))
if printf '%s' "$OUT3" | grep -q 'symlink a otro lugar'; then _pass "un destino desconocido se reporta, no se repunta"
else _fail "un destino desconocido se reporta, no se repunta" "no lo reporto"; fi

report "install.sh repuntado"
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bash tools/tests/test-install-repoint.sh`
Expected: FAIL — no hay lógica de repuntado; el symlink queda intacto.

- [ ] **Step 3: Implementar el repuntado**

En `install.sh`, reemplazar la rama `if [ -L "$dest" ]` del loop por:

```bash
  if [ -L "$dest" ]; then
    current="$(readlink "$dest")"
    if [ "$current" = "$target" ]; then
      printf '  ok      %s (already linked)\n' "$name"
    elif printf '%s' "$current" | grep -qE '/(claude-brain|claude-conductor)(/|$)'; then
      # Los dos repos que este reemplaza. Si no se ofrece repuntar, el usuario
      # instala el repo nuevo y sigue corriendo las skills viejas sin aviso.
      printf '  %s apunta a un repo anterior:\n' "$name"
      printf '      %s\n' "$current"
      local answer=""
      read -r -p "      Repuntar a $target? [s/N] " answer || answer=""
      case "$answer" in
        s|S|si|SI|y|Y)
          rm "$dest"; ln -s "$target" "$dest"
          printf '      repuntado\n' ;;
        *) printf '      se deja como esta\n' ;;
      esac
    else
      printf '  skip    %s (symlink a otro lugar: %s)\n' "$name" "$current"
    fi
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bash tools/tests/test-install-repoint.sh`
Expected: PASS — 4 corridos, 0 fallados.

- [ ] **Step 5: Verificar que la idempotencia sigue en pie**

Run: `bash tools/tests/test-install-symlinks.sh`
Expected: PASS — 9 corridos, 0 fallados. El repuntado no rompió el caso base.

- [ ] **Step 6: Commit**

```bash
git add install.sh tools/
git commit -m "feat(install): ofrece repuntar los symlinks de los repos anteriores

Sin esto, instalar el repo nuevo deja las skills viejas corriendo en silencio:
el instalador anterior saltea un symlink que apunta a otro lado. Un destino
desconocido se reporta y no se toca."
```

---

### Task 11: `install.sh` — bloque de `CLAUDE.md` con las rutas de `knowledge/`

**Files:**
- Modify: `install.sh`
- Test: `tools/tests/test-install-claudemd.sh`

**Interfaces:**
- Consumes: `install.sh` de la Task 10.
- Produces: impresión del bloque para pegar, con rutas bajo `knowledge/`.

- [ ] **Step 1: Escribir el test que falla**

`tools/tests/test-install-claudemd.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
. "$HERE/lib.sh"

run_it() { WORKBENCH_HOME="$1" bash "$REPO/install.sh" --print-claude-md; }

H="$(mktemp -d)"
assert_contains 'knowledge/rules' "el bloque usa las rutas de knowledge/" run_it "$H"
assert_contains 'knowledge/playbooks' "incluye playbooks bajo knowledge/" run_it "$H"
assert_not_contains 'claude-brain/rules' "no usa las rutas del repo anterior" run_it "$H"

# Si ya esta referenciado, no repite el bloque.
H2="$(mktemp -d)"; mkdir -p "$H2/.claude"
printf '# claude-workbench\nya referenciado\n' > "$H2/.claude/CLAUDE.md"
assert_contains 'ya referencia' "detecta que ya esta referenciado" run_it "$H2"

# Nunca escribe el CLAUDE.md del usuario.
H3="$(mktemp -d)"; mkdir -p "$H3/.claude"
printf 'mis instrucciones\n' > "$H3/.claude/CLAUDE.md"
run_it "$H3" >/dev/null 2>&1 || true
assert_contains 'mis instrucciones' "no pisa el CLAUDE.md del usuario" cat "$H3/.claude/CLAUDE.md"

report "install.sh bloque de CLAUDE.md"
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bash tools/tests/test-install-claudemd.sh`
Expected: FAIL — `--print-claude-md` es opción desconocida.

- [ ] **Step 3: Implementar la impresión del bloque**

En `install.sh`:

```bash
print_claude_md_block() {
  local md="$HOME_DIR/.claude/CLAUDE.md"
  local block
  block="# claude-workbench
- **claude-workbench** (\`$REPO_DIR\`) - skills y base de conocimiento:
  reglas, playbooks, templates. Revisar \`$REPO_DIR/knowledge/rules/\`,
  \`$REPO_DIR/knowledge/playbooks/\` y \`$REPO_DIR/knowledge/templates/\`
  antes de inventar convenciones nuevas. Las reglas del repo en el que se
  trabaja siempre ganan sobre estas."

  if [ -f "$md" ] && grep -q 'claude-workbench' "$md"; then
    printf '%s ya referencia claude-workbench, no hay nada que agregar.\n' "$md"
    return 0
  fi

  printf '%s todavia no referencia claude-workbench.\n' "$md"
  printf 'Pegar este bloque a mano — no se escribe automaticamente, para no\n'
  printf 'pisar tus instrucciones globales:\n\n'
  printf -- '-----------------------------------------------------------------\n'
  printf '%s\n' "$block"
  printf -- '-----------------------------------------------------------------\n'
}
```

Agregar `--print-claude-md` al parseo, que llama a la función y sale; y
llamarla al final del flujo normal.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bash tools/tests/test-install-claudemd.sh`
Expected: PASS — 5 corridos, 0 fallados.

- [ ] **Step 5: Correr toda la suite y shellcheck**

Run:
```bash
shellcheck install.sh tools/*.sh tools/hooks/pre-commit tools/tests/*.sh
for t in tools/tests/test-*.sh; do echo "== $t"; bash "$t" || exit 1; done
```
Expected: shellcheck sin salida; todas las suites en 0 fallados.

- [ ] **Step 6: Commit**

```bash
git add install.sh tools/
git commit -m "feat(install): bloque de CLAUDE.md con las rutas de knowledge/

Se imprime para pegar a mano, nunca se escribe: pisar el CLAUDE.md global del
usuario seria destructivo y no reversible."
```

---

### Task 12: Migrar `knowledge/`, saneado

Primera migración de contenido, y ya con el checker en pie para verificarla.

**Files:**
- Create: `knowledge/rules/` (5 archivos), `knowledge/playbooks/` (8),
  `knowledge/templates/` (7), `knowledge/checklists/` (3),
  `knowledge/examples/` (3), `knowledge/architecture/` (1)

**Interfaces:**
- Consumes: `tools/check-placeholders.sh` de la Task 2.
- Produces: `knowledge/`, con cero hallazgos del checker.

- [ ] **Step 1: Copiar los seis directorios**

```bash
SRC=<ruta-al-repo-de-conocimiento>
mkdir -p knowledge
for d in rules playbooks templates checklists examples architecture; do
  cp -r "$SRC/$d" "knowledge/$d"
done
git add knowledge/
```

- [ ] **Step 2: Correr el checker y ver qué hay que sanear**

Run: `./tools/check-placeholders.sh --staged`
Expected: FAIL, con los hallazgos listados por archivo y línea. Esa lista es
la lista de trabajo del Step 3. No adivinar qué hay que cambiar: leerla.

- [ ] **Step 3: Reemplazar cada hallazgo por un placeholder**

Regla por tipo de hallazgo:

| Tipo | Reemplazo |
|---|---|
| id de ticket real | `TCK-<n>` |
| nombre en clave de proyecto | `<proyecto>` |
| login de persona | `<usuario>` |
| slug de feature interna | `<descripcion-de-la-rama>` |
| mail real | `alguien@example.com` |
| id numerico largo | `<id-de-usuario>` |
| ruta absoluta de home | `~/...` |

El reemplazo tiene que dejar el texto legible: si una frase se apoyaba en el
nombre real para explicar algo, reescribir la frase, no sustituir la palabra y
dejar una oración rota.

- [ ] **Step 4: Correr el checker y verificar que pasa**

Run: `./tools/check-placeholders.sh --staged`
Expected: OK, cero hallazgos, con el conteo de valores cargados del
data-driven visible en la salida (no `SALTEADO`, porque la máquina tiene
config local).

- [ ] **Step 5: Commit**

```bash
git add knowledge/
git commit -m "feat(knowledge): migra reglas, playbooks, templates y checklists

Agrupa las seis carpetas de saber bajo knowledge/. Los valores reales que
traian se reemplazaron por placeholders, verificado por el checker."
```

---

### Task 13: Migrar `skills/`, saneadas y con `## Requiere`

**Files:**
- Create: `skills/conductor/` (SKILL.md + 3 referencias)
- Create: `skills/ticket-workflow/` (SKILL.md + 3 referencias)
- Create: `skills/bug-fix/SKILL.md`, `skills/code-review/SKILL.md`,
  `skills/feature-development/SKILL.md`, `skills/TEMPLATE.md`

**Interfaces:**
- Consumes: `core/config-schema.md` (Task 4), `core/resolve.md` (Task 5),
  `tools/check-schema-refs.sh`, `tools/check-core-refs.sh`,
  `tools/check-placeholders.sh`.
- Produces: cinco skills que pasan los tres validadores.

- [ ] **Step 1: Copiar las cinco skills**

```bash
cp -r <ruta-al-repo-de-orquestacion>/skills/conductor skills/
for s in ticket-workflow bug-fix code-review feature-development; do
  cp -r "<ruta-al-repo-de-conocimiento>/skills/$s" skills/
done
cp <ruta-al-repo-de-conocimiento>/skills/TEMPLATE.md skills/
git add skills/
```

- [ ] **Step 2: Absorber los dos config-schema de referencia**

Los dos `reference/config-schema.md` (el de conductor y el de
ticket-workflow) quedan reemplazados por una cita a `core/config-schema.md`.
Es la única fusión de contenido real de todo el plan.

```bash
git rm -q skills/conductor/reference/config-schema.md
git rm -q skills/ticket-workflow/reference/config-schema.md
```

En cada `SKILL.md`, donde antes apuntaba a su schema propio, apuntar a
`core/config-schema.md`.

- [ ] **Step 3: Agregar la sección `## Requiere` a las cinco skills**

Cada `SKILL.md` recibe una sección que declara capabilities y campos con su
capa, usando los nombres exactos del schema de la Task 4. Por ejemplo, para
`conductor`:

```markdown
## Requiere

**Capabilities**
- `capabilities.gh` — para leer el estado de las PRs.
- `capabilities.orca` — opcional. Sin ella, ver `core/resolve.md`: se
  pregunta una vez y se recuerda la respuesta en `choices.worktrees`.

**Config**
- `user.author` — sólo se anuncian las PRs de este handle.
- `user.announce.channelUrl` — dónde anunciar.
- `project.repos` — los repos del workspace, con su tag.
- `project.gateWorkflow` — el workflow que actúa de gate.
- `project.notifiedLabel` — la label que marca lo ya anunciado.
- `project.relayGates` — política de relay.
- `project.orca.wrapperRepoId` — el repo wrapper en Orca.

Ante un campo ausente o una capability que falta, seguir `core/resolve.md`.
No completar en silencio.
```

- [ ] **Step 4: Correr los tres validadores y verificar que pasan**

Run:
```bash
./tools/check-schema-refs.sh
./tools/check-core-refs.sh
./tools/check-placeholders.sh --staged
```
Expected: los tres en OK. Si `check-schema-refs` marca un campo ausente, el
arreglo va en el schema o en la skill según quién tenga razón — no silenciar
el validador.

- [ ] **Step 5: Commit**

```bash
git add skills/
git commit -m "feat(skills): migra las cinco skills con su seccion Requiere

Los dos config-schema de referencia se absorben en core/config-schema.md, que
es la unica fusion de contenido real. Cada skill declara que capabilities y
que campos usa, y cita el protocolo de resolucion."
```

---

### Task 14: README, migración de specs y auditoría final

**Files:**
- Create: `README.md`
- Create: `docs/superpowers/specs/` (los specs de los dos repos, saneados)
- Test: la suite completa

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: el repo listo para publicar.

- [ ] **Step 1: Migrar los specs de los dos repos, saneados**

```bash
cp <ruta-al-repo-de-orquestacion>/docs/superpowers/specs/*.md docs/superpowers/specs/
cp <ruta-al-repo-de-conocimiento>/docs/superpowers/specs/*.md docs/superpowers/specs/
git add docs/
./tools/check-placeholders.sh --staged
```

Sanear cada hallazgo con la misma tabla de reemplazos de la Task 12, hasta que
el checker dé OK.

- [ ] **Step 2: Escribir el README**

Cubre: qué es (skills más base de conocimiento para Claude Code), qué trae
(las cinco skills y las seis carpetas de `knowledge/`), cómo se instala
(`git clone` y `./install.sh`), las tres capas de config con sus rutas, y la
regla de que ningún dato real entra al repo, con el `tools/check-placeholders.sh`
como el mecanismo que lo sostiene.

Ningún nombre propio va en el README, ni siquiera en el link de `git clone`:
el segmento owner va como placeholder (`OWNER`), y el lector clona el repo
que tiene delante, no uno con una cuenta hardcodeada.

- [ ] **Step 3: Correr la suite completa**

Run:
```bash
shellcheck install.sh tools/*.sh tools/hooks/pre-commit tools/tests/*.sh
for t in tools/tests/test-*.sh; do echo "== $t"; bash "$t" || exit 1; done
./tools/check-schema-refs.sh
./tools/check-core-refs.sh
./tools/check-placeholders.sh
```
Expected: todo en OK y 0 fallados.

- [ ] **Step 4: Auditoría de la historia completa**

Run:
```bash
for c in $(git rev-list --all); do
  git grep -ihoE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$c" -- . 2>/dev/null
done | sort -u
git log --all --format='%an <%ae>%n%cn <%ce>' | sort -u
```
Expected: los únicos mails son de dominios de ejemplo; la única identidad de
commit es la del `noreply`. Si aparece cualquier otra cosa, **no publicar**:
arreglar antes, que en esta etapa todavía es barato.

- [ ] **Step 5: Verificar la instalación de punta a punta**

Run:
```bash
H="$(mktemp -d)"
printf 'un-handle\nhttps://chat.example/c/1\nNombre Apellido\n\n' \
  | WORKBENCH_HOME="$H" bash ./install.sh
ls -l "$H/.claude/skills/"
cat "$H/.claude/workbench/capabilities.json"
stat -c '%a' "$H/.claude/workbench/user.json"
```
Expected: las cinco skills linkeadas, `capabilities.json` con `detected` y
`choices`, y `user.json` en `600`.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/
git commit -m "docs: README y specs migrados, auditoria final en verde

Cierra la unificacion: las cinco skills, las seis carpetas de knowledge, el
core de tres documentos y el instalador unico, con la suite y los tres
validadores en verde."
```

---

## Notas para quien ejecute

**El orden no es negociable en un punto:** las Tasks 1 a 3 construyen el
checker antes de que se migre una sola línea de contenido. Migrar primero y
auditar después es exactamente lo que produjo la reescritura de historia que
originó este repo.

**Los Steps 2 de las Tasks 12 y 13 son de lectura, no de adivinanza.** El
checker imprime archivo, línea y tipo de cada hallazgo. Esa salida es la lista
de trabajo. No sustituir a ojo.

**Ningún validador se silencia para que pase una task.** Si
`check-schema-refs.sh` marca un campo ausente, o el schema le falta un campo o
la skill cita uno que no existe. Las dos son arreglos reales; agregar una
excepción al validador no lo es.
