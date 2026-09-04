#!/usr/bin/env bash
# Tests de la limpieza del conductor.
#
# Todo corre en dry-run sobre repos de mentira: lo que se prueba es el juicio
# --  cuando dice "limpiable" y cuando dice "no se limpio" -- no el borrado.
# Un test que borrara de verdad tendria que levantar Docker y un worktree de
# Orca, y probaria el entorno en vez del script.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tools/tests/lib.sh
. "$HERE/lib.sh"

CLEAN="$HERE/../conductor-cleanup.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

GIT="git -c user.email=nadie@example.com -c user.name=nadie -c commit.gpgsign=false -c protocol.file.allow=always"

# Arma un repo con upstream real: un bare como remoto y un clon con un commit
# ya pusheado. Ese es el estado de un ticket que el humano ya publico.
mk_repo() {
  local dir="$1"
  $GIT init -q --bare "$dir.remote"
  $GIT clone -q "$dir.remote" "$dir" 2>/dev/null
  printf 'v1\n' > "$dir/archivo.txt"
  $GIT -C "$dir" add archivo.txt
  $GIT -C "$dir" commit -qm 'commit inicial'
  $GIT -C "$dir" push -q -u origin HEAD:refs/heads/trabajo 2>/dev/null
  $GIT -C "$dir" branch -q --set-upstream-to=origin/trabajo 2>/dev/null || true
}

cl() { bash "$CLEAN" "$@"; }

# --- la guarda del slug, que es la que evita un borrado masivo --------------
# El slug entra en tres "grep -F" que alimentan tres "docker ... rm". Vacio,
# grep matchea todo y se borran las imagenes de los tickets vivos.
assert_exit 2 'sin --slug falla' cl --dry-run
assert_exit 2 'un slug vacio falla' cl --slug '' --dry-run
assert_exit 2 'un slug corto falla' cl --slug abc --dry-run
assert_contains 'demasiado corto' 'y dice por que' cl --slug abc --dry-run
assert_exit 2 'un slug con espacios falla' cl --slug 'tck 1 algo' --dry-run
assert_contains 'no puede tener espacios' 'y dice por que' cl --slug 'tck 1 algo' --dry-run
assert_contains 'uso: conductor-cleanup.sh' '--help imprime el uso' cl --help

# --- un worktree que no existe ---------------------------------------------
assert_exit 1 'un path que no existe no se limpia' \
  cl --slug tck-1-slug-largo --path "$TMP/no-existe" --dry-run

# --- limpio: publicado, sin nada suelto ------------------------------------
mk_repo "$TMP/limpio"
assert_exit 0 'un worktree publicado y limpio es limpiable' \
  cl --slug limpio-slug-largo --path "$TMP/limpio" --ticket TCK-1 --dry-run
assert_contains 'limpiable' 'y lo dice' \
  cl --slug limpio-slug-largo --path "$TMP/limpio" --ticket TCK-1 --dry-run
assert_contains 'no se borro nada' 'el dry-run avisa que no borro' \
  cl --slug limpio-slug-largo --path "$TMP/limpio" --ticket TCK-1 --dry-run

# --- sucio: cambios sin commitear ------------------------------------------
mk_repo "$TMP/sucio"
printf 'v2\n' > "$TMP/sucio/archivo.txt"
assert_exit 1 'cambios sin commitear bloquean la limpieza' \
  cl --slug sucio-slug-largo --path "$TMP/sucio" --ticket TCK-2 --dry-run
assert_contains 'sin commitear' 'y dice que quedo' \
  cl --slug sucio-slug-largo --path "$TMP/sucio" --ticket TCK-2 --dry-run
assert_contains 'NO se limpio' 'y lo dice en el reporte' \
  cl --slug sucio-slug-largo --path "$TMP/sucio" --ticket TCK-2 --dry-run

# --- sucio: commits sin pushear --------------------------------------------
mk_repo "$TMP/adelante"
printf 'v2\n' > "$TMP/adelante/archivo.txt"
$GIT -C "$TMP/adelante" commit -qam 'trabajo sin publicar'
assert_exit 1 'commits sin pushear bloquean la limpieza' \
  cl --slug adelante-slug-largo --path "$TMP/adelante" --dry-run
assert_contains 'sin pushear' 'y dice que quedo' \
  cl --slug adelante-slug-largo --path "$TMP/adelante" --dry-run

# --- sucio: la rama todavia no se publico ----------------------------------
# El hijo nunca pushea, asi que este es el estado normal hasta que el humano
# publica. Sigue siendo trabajo sin publicar: no se borra.
$GIT init -q -b trabajo "$TMP/sin-upstream"
printf 'v1\n' > "$TMP/sin-upstream/archivo.txt"
$GIT -C "$TMP/sin-upstream" add archivo.txt
$GIT -C "$TMP/sin-upstream" commit -qm 'commit inicial'
assert_exit 1 'una rama sin upstream bloquea la limpieza' \
  cl --slug sinup-slug-largo --path "$TMP/sin-upstream" --dry-run
assert_contains 'no tiene upstream' 'y dice que falta publicarla' \
  cl --slug sinup-slug-largo --path "$TMP/sin-upstream" --dry-run

# --- el filtro del stash, que es el falso positivo documentado -------------
# Los stashes son globales del repo: sin filtrar por rama, un stash hecho en
# otra rama bloquearia este worktree para siempre.
mk_repo "$TMP/stash-otra"
$GIT -C "$TMP/stash-otra" checkout -q -b otra-rama
printf 'wip\n' > "$TMP/stash-otra/archivo.txt"
$GIT -C "$TMP/stash-otra" stash -q
$GIT -C "$TMP/stash-otra" checkout -q trabajo
assert_exit 0 'un stash de OTRA rama no bloquea' \
  cl --slug stashotra-slug-largo --path "$TMP/stash-otra" --dry-run

mk_repo "$TMP/stash-propia"
printf 'wip\n' > "$TMP/stash-propia/archivo.txt"
$GIT -C "$TMP/stash-propia" stash -q
assert_exit 1 'un stash de la rama propia si bloquea' \
  cl --slug stashpropia-slug-largo --path "$TMP/stash-propia" --dry-run
assert_contains 'hay stash de la rama' 'y dice que quedo' \
  cl --slug stashpropia-slug-largo --path "$TMP/stash-propia" --dry-run

# --- detached HEAD ---------------------------------------------------------
mk_repo "$TMP/detached"
$GIT -C "$TMP/detached" checkout -q --detach HEAD
assert_exit 1 'detached HEAD bloquea la limpieza' \
  cl --slug detached-slug-largo --path "$TMP/detached" --dry-run
assert_contains 'detached HEAD' 'y lo nombra' \
  cl --slug detached-slug-largo --path "$TMP/detached" --dry-run

# --- wrapper limpio con submodulo sucio ------------------------------------
# El caso mas probable de todos: el trabajo real pasa en los submodulos.
mk_repo "$TMP/hijo-sub"
mk_repo "$TMP/wrapper"
$GIT -C "$TMP/wrapper" submodule add -q "$TMP/hijo-sub" sub 2>/dev/null
$GIT -C "$TMP/wrapper" commit -qm 'agrega submodulo'
$GIT -C "$TMP/wrapper" push -q origin HEAD:refs/heads/trabajo 2>/dev/null
printf 'sucio\n' > "$TMP/wrapper/sub/archivo.txt"
assert_exit 1 'un submodulo sucio bloquea aunque el wrapper este limpio' \
  cl --slug wrapper-slug-largo --path "$TMP/wrapper" --dry-run
assert_contains 'submodulo sub' 'y nombra el submodulo' \
  cl --slug wrapper-slug-largo --path "$TMP/wrapper" --dry-run

report 'test-conductor-cleanup'
