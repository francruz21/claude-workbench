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

install_precommit_hook() {
  local hook_src="$REPO_DIR/tools/hooks/pre-commit"
  local hook_dst="$REPO_DIR/.git/hooks/pre-commit"

  if [ ! -d "$REPO_DIR/.git" ]; then
    printf 'No hay .git en %s, no se instala el hook.\n\n' "$REPO_DIR"
    return 0
  fi

  if [ -L "$hook_dst" ]; then
    local current
    current="$(readlink "$hook_dst")"
    if [ "$current" = "$hook_src" ]; then
      printf 'Hook de pre-commit ya instalado (already linked).\n\n'
    else
      printf 'Ya hay un hook de pre-commit distinto (symlink a %s), no se toca.\n\n' "$current"
    fi
    return 0
  elif [ -e "$hook_dst" ]; then
    printf 'Ya hay un hook de pre-commit propio en %s, no se toca.\n\n' "$hook_dst"
    return 0
  fi

  printf 'El repo trae un chequeo de placeholders (%s)\n' "$hook_src"
  printf 'para correr antes de cada commit local. Se puede saltear con\n'
  printf '"git commit --no-verify" — por eso CI corre el mismo chequeo tambien.\n\n'

  local answer=""
  read -r -p "Instalar el hook de pre-commit? [s/N] " answer || answer=""
  case "$answer" in
    s|S|si|SI|y|Y)
      mkdir -p "$(dirname "$hook_dst")"
      ln -s "$hook_src" "$hook_dst"
      printf 'Hook instalado (symlink a %s).\n\n' "$hook_src" ;;
    *)
      printf 'No se instala el hook. Se puede instalar despues con:\n'
      printf '  ln -s %s %s\n\n' "$hook_src" "$hook_dst" ;;
  esac
}

SKILLS_ONLY=0
DETECT_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --skills-only) SKILLS_ONLY=1; shift ;;
    --detect-only) DETECT_ONLY=1; shift ;;
    --print-claude-md) print_claude_md_block; exit 0 ;;
    --hook-only) install_precommit_hook; exit 0 ;;
    -h|--help)
      printf 'uso: %s [--skills-only] [--detect-only] [--print-claude-md] [--hook-only]\n' "$0"
      exit 0 ;;
    *) printf 'opcion desconocida: %s\n' "$1" >&2; exit 2 ;;
  esac
done

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

set_capability_choice() {
  # Escribe una clave dentro de "choices" en capabilities.json, preservando
  # el resto de choices y todo detected. detect_capabilities ya corrio antes
  # que esto en el flujo principal, asi que el archivo deberia existir; si
  # no existiera (por ejemplo, alguien llama a esta funcion suelta), se crea
  # en vez de fallar.
  local cap="$1" key="$2" value="$3"
  python3 - "$cap" "$key" "$value" <<'PY'
import io, json, os, sys
path, key, value = sys.argv[1:4]
data = {"detected": {}, "choices": {}}
if os.path.exists(path):
    try:
        data = json.load(io.open(path, encoding="utf-8"))
    except ValueError:
        data = {"detected": {}, "choices": {}}
data.setdefault("choices", {})[key] = value
with io.open(path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
PY
}

create_user_config() {
  local uf="$CONFIG_DIR/user.json"
  local cap="$CONFIG_DIR/capabilities.json"

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

  # "announce: skip" es una eleccion documentada (ver core/config-schema.md):
  # tres de las cinco skills no necesitan nada de esto, asi que dejar el
  # canal vacio no puede abortar el resto de la instalacion. El unico campo
  # que sigue siendo "el importante" es el handle — pero ni ese aborta: si
  # falta, se avisa que el filtro de autor de los anuncios no va a funcionar
  # y se sigue igual, porque un install que no escribe nada deja al usuario
  # sin CLAUDE.md ni oferta de hook por culpa de una sola respuesta vacia.
  local author channel="" mention_name="" mention_id=""
  read -r -p "Tu handle del remoto (solo tus PRs se anuncian): " author

  if [ -z "$author" ]; then
    printf '\nOjo: sin handle, ninguna skill puede saber cuales PRs son tuyos, asi\n'
    printf 'que el flujo de anuncios no va a poder filtrar por autor. El resto de\n'
    printf 'la instalacion sigue igual; se puede completar despues editando %s.\n\n' "$uf"
  fi

  read -r -p "URL del canal donde anunciar (Enter para no anunciar): " channel

  if [ -z "$channel" ]; then
    printf '\nSin canal: no se pregunta mencion. Las skills que no anuncian\n'
    printf '(bug-fix, code-review, feature-development) no dependen de esto.\n\n'
  else
    read -r -p "Nombre a tipear despues del @: " mention_name
    read -r -p "Id de usuario para la mencion (opcional, Enter para saltear): " mention_id
    if [ -z "$mention_name" ]; then
      printf '\nOjo: sin nombre de mencion, un anuncio no va a poder mencionar a\n'
      printf 'nadie por @. Se puede completar despues editando %s.\n\n' "$uf"
    fi
  fi

  # Por el encoder de python, no por heredoc: una comilla o un backslash en un
  # valor no puede producir un archivo roto.
  umask 077
  python3 - "$uf" "$author" "$channel" "$mention_name" "$mention_id" <<'PY'
import io, json, sys
path, author, channel, mention_name, mention_id = sys.argv[1:6]
config = {"author": author}
if channel:
    config["announce"] = {
        "channelUrl": channel,
        "mention": {"name": mention_name, "id": mention_id},
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

  if [ -z "$channel" ]; then
    set_capability_choice "$cap" "announce" "skip"
  else
    set_capability_choice "$cap" "announce" "canal"
  fi

  printf '\nEscrito %s (permisos %s), JSON valido.\n' "$uf" "$(stat -c '%a' "$uf")"
  if [ -n "$channel" ] && [ -z "$mention_id" ]; then
    printf 'Nota: sin id de mencion, el flujo no puede verificar que una\n'
    printf 'mencion resolvio, asi que va a ser mas cauto antes de anunciar.\n'
  fi
  printf '\n'
}

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
    elif printf '%s' "$current" | grep -qE '/(claude-brain|claude-conductor)(/|$)'; then
      # Los dos repos que este reemplaza. Si no se ofrece repuntar, el usuario
      # instala el repo nuevo y sigue corriendo las skills viejas sin aviso.
      printf '  %s apunta a un repo anterior:\n' "$name"
      printf '      %s\n' "$current"
      answer=""
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

detect_capabilities
if [ "$DETECT_ONLY" -eq 1 ]; then exit 0; fi

migrate_old_config
create_user_config

print_claude_md_block
install_precommit_hook
