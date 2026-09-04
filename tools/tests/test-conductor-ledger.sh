#!/usr/bin/env bash
# Tests del registro en disco del conductor.
#
# Lo que se prueba es el comportamiento observable: que el ciclo completo de un
# ticket quede registrado, que los guardas del anuncio y del cierre no se puedan
# saltear, y sobre todo que "close" borre de verdad los datos del hijo -- que es
# la razon por la que el registro existe.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tools/tests/lib.sh
. "$HERE/lib.sh"

LEDGER="$HERE/../conductor-ledger.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export WORKBENCH_STATE_DIR="$TMP/state"
export WORKBENCH_WORKSPACE="$TMP/workspace"
mkdir -p "$WORKBENCH_WORKSPACE"

led() { bash "$LEDGER" "$@"; }

# --- forma y ayuda ---------------------------------------------------------
assert_contains 'conductor-ledger.sh <comando>' 'sin argumentos imprime el uso' led
assert_exit 2 'un comando inexistente falla con exit 2' led no-existe
assert_contains "$TMP/state" 'path apunta al state dir configurado' led path

# --- abrir -----------------------------------------------------------------
assert_exit 2 'open sin --slug falla' led open TCK-1
assert_exit 0 'open con --slug funciona' led open TCK-1 --slug tck-1-un-slug-largo --name 'TCK-1 · algo'
assert_contains 'TCK-1' 'el ticket abierto aparece en open-tickets' led open-tickets
assert_contains 'tck-1-un-slug-largo' 'get devuelve el slug' led get TCK-1
assert_exit 1 'set sobre un ticket inexistente falla' led set TCK-9 state x

# --- datos del hijo --------------------------------------------------------
led child TCK-1 --handle term_abc --worktree-id wt_xyz --task-id task_1 --dispatch-id ctx_1 >/dev/null
assert_contains 'term_abc' 'el handle del hijo queda registrado' led get TCK-1
assert_contains 'wt_xyz' 'el worktreeId del hijo queda registrado' led get TCK-1

# --- el guarda del anuncio -------------------------------------------------
# Este es el error de produccion que el registro tiene que hacer imposible: se
# anuncio un PR con el gate de tests en pending porque el disparador dejo de ser
# el evento GREEN y paso a ser una hora del reloj.
assert_exit 1 'anunciar sin ningun PR registrado falla' led announced TCK-1
led pr-add TCK-1 --repo OWNER/REPO --number 376 --url 'https://example.com/pr/376' >/dev/null
assert_contains '"gate": "PENDING"' 'un PR nuevo arranca en PENDING' led get TCK-1
assert_exit 1 'anunciar con el gate en PENDING falla' led announced TCK-1
assert_contains 'no tiene todos sus PRs en GREEN' 'y dice por que' led announced TCK-1

led pr-gate TCK-1 --number 376 --gate SINCHECKS >/dev/null
assert_exit 1 'SINCHECKS no habilita a anunciar' led announced TCK-1
led pr-gate TCK-1 --number 376 --gate RED >/dev/null
assert_exit 1 'RED no habilita a anunciar' led announced TCK-1
assert_exit 2 'un gate que no existe se rechaza' led pr-gate TCK-1 --number 376 --gate VERDE

# Dos PRs, uno verde y otro no: el ticket no se anuncia a medias.
led pr-add TCK-1 --repo OWNER/REPO --number 377 >/dev/null
led pr-gate TCK-1 --number 376 --gate GREEN >/dev/null
assert_exit 1 'un ticket con un PR verde y otro pendiente no se anuncia' led announced TCK-1
led pr-gate TCK-1 --number 377 --gate GREEN >/dev/null
assert_exit 0 'con todos los PRs en GREEN el anuncio se registra' led announced TCK-1

# pr-add es idempotente: registrar dos veces el mismo PR no lo duplica.
led pr-add TCK-1 --repo OWNER/REPO --number 377 >/dev/null
TCK1_PRS="$(led get TCK-1 | jq '.prs | length')"
TESTS_RUN=$((TESTS_RUN + 1))
if [ "$TCK1_PRS" = 2 ]; then _pass 'pr-add no duplica un PR ya registrado'
else _fail 'pr-add no duplica un PR ya registrado' "esperaba 2 PRs, hay $TCK1_PRS"; fi

# --- la label va despues del envio -----------------------------------------
assert_exit 0 'la label se registra despues del anuncio' led labelled TCK-1
led open TCK-2 --slug tck-2-otro-slug-largo >/dev/null
assert_exit 1 'la label sin anuncio previo se rechaza' led labelled TCK-2
assert_contains 'la label va despues del envio' 'y explica el orden' led labelled TCK-2

# --- el guarda del cierre ---------------------------------------------------
assert_exit 1 'no se cierra un ticket sin limpiar' led close TCK-1
led cleaned TCK-1 --images 2 --volumes 1 >/dev/null
assert_exit 0 'anunciado y limpiado, se cierra' led close TCK-1
assert_exit 1 'un ticket cerrado no se puede reabrir con open' led open TCK-1 --slug tck-1-un-slug-largo

# --- el olvido, que es el punto de todo esto -------------------------------
# --- notas: lo unico que Orca no puede devolver -----------------------------
assert_exit 2 'note sin --add falla' led note TCK-2
assert_exit 0 'una nota corta se anota' led note TCK-2 --add 'gate 2 resuelto: va sobre el hook existente'
assert_contains 'va sobre el hook existente' 'la nota sale en brief' led brief
assert_exit 1 'una nota de mas de 200 caracteres se rechaza' \
  led note TCK-2 --add "$(printf 'x%.0s' $(seq 1 201))"
assert_contains 'no es una nota: es contexto' 'y explica por que' \
  led note TCK-2 --add "$(printf 'x%.0s' $(seq 1 201))"
# Se guardan las ultimas 5: un campo libre sin techo es un segundo contexto.
for i in 1 2 3 4 5 6; do led note TCK-2 --add "nota numero $i" >/dev/null; done
N_NOTES="$(led get TCK-2 | jq '.notes | length')"
TESTS_RUN=$((TESTS_RUN + 1))
if [ "$N_NOTES" = 5 ]; then _pass 'las notas se topean en 5'
else _fail 'las notas se topean en 5' "hay $N_NOTES"; fi
assert_not_contains 'nota numero 1' 'la nota mas vieja se descarta' led get TCK-2
assert_contains 'nota numero 6' 'la mas nueva queda' led get TCK-2

# --- handoff: rotar con hijos vivos ----------------------------------------
# Es el caso que importa: el conductor cierra un ticket y quiere arrancar
# limpio, pero otro hijo sigue trabajando. Rotar es seguro solo si el sucesor
# puede retomarlo, y eso pide handle y worktreeId registrados.
assert_exit 1 'no se rota con un hijo abierto sin handle registrado' led handoff
assert_contains 'TCK-2' 'y dice cual falta' led handoff
assert_contains 'NO todavia' 'y lo dice claro' led handoff
led child TCK-2 --handle term_def --worktree-id wt_def >/dev/null
assert_exit 0 'con handle y worktree registrados, se puede rotar' led handoff
assert_contains 'orchestration check --terminal term_def --all' 'y da la receta de retoma' led handoff
assert_contains 'no se pierde' 'la receta aclara que los monitores se re-arman' \
  bash -c "bash '$LEDGER' handoff | tr -d '\n' | grep -o 'monitores de gate: se re-arman' >/dev/null && echo no se pierde"
assert_contains 'nota numero 6' 'la receta arrastra el criterio anotado' led handoff

CLOSED="$(led get TCK-1)"
for gone in term_abc wt_xyz task_1 ctx_1 child notes; do
  TESTS_RUN=$((TESTS_RUN + 1))
  if printf '%s' "$CLOSED" | grep -qF "$gone"; then
    _fail "close olvida '$gone'" "todavia aparece en la entrada cerrada"
  else
    _pass "close olvida '$gone'"
  fi
done
for kept in TCK-1 376 announcedAt cleanedAt; do
  assert_contains "$kept" "close conserva '$kept'" led get TCK-1
done
assert_not_contains 'TCK-1' 'un ticket cerrado sale de open-tickets' led open-tickets

# --- brief: lo que lee una sesion nueva -------------------------------------
assert_contains 'ABIERTOS' 'brief separa abiertos' led brief
assert_contains 'CERRADOS' 'brief separa cerrados' led brief
assert_contains 'TCK-2' 'brief lista el ticket abierto' led brief
assert_contains 'sin contexto del hijo' 'brief dice que los cerrados no traen contexto' led brief

# El brief tiene que costar tokens de una linea, no de una investigacion: si
# crece con cada ticket cerrado deja de servir para rehidratar.
BRIEF_LINES="$(led brief | grep -c . || true)"
TESTS_RUN=$((TESTS_RUN + 1))
if [ "$BRIEF_LINES" -le 40 ]; then _pass "brief es compacto ($BRIEF_LINES lineas)"
else _fail 'brief es compacto' "$BRIEF_LINES lineas, mas de 40"; fi

# --- aislamiento entre workspaces ------------------------------------------
WORKBENCH_WORKSPACE="$TMP/otro" led open TCK-3 --slug tck-3-tercer-slug >/dev/null
assert_not_contains 'TCK-3' 'otro workspace no ve los tickets de este' led open-tickets
assert_not_contains 'TCK-1' 'ni este los del otro' env WORKBENCH_WORKSPACE="$TMP/otro" bash "$LEDGER" open-tickets

report 'test-conductor-ledger'
