#!/usr/bin/env bash
#
# Hook de PermissionRequest a nivel usuario: en una sesion con
# bypassPermissions, contesta el mismo los `ask` que todavia levantan un
# dialogo, para que nadie quede esperando una respuesta.
#
# Por que existe. Bypass no saltea todo: una regla `ask` de settings y un hook
# de PreToolUse que devuelve `ask` (los de un repo de trabajo, que el workbench
# no toca) igual abren el dialogo. Un conductor o un hijo corriendo sin nadie
# mirando queda congelado ahi hasta que el usuario vuelve. Ejemplo real: un
# guard de Linear del proyecto que pregunta en cada `save_comment` que no puede
# atribuir a un ticket, y el conductor trabaja en una rama sin ticket.
#
# Que contesta:
#   - permission_mode = bypassPermissions -> allow. El usuario eligio no
#     contestar permisos; un `ask` que se lo pide igual contradice esa eleccion.
#   - cualquier otro modo -> sin opinion: el dialogo sale como siempre.
#
# Que no toca: lo que se bloquea de verdad (un deny, un hook que sale con 2) ni
# siquiera llega a este evento. Los guardrails que importan tienen que ser
# bloqueos, no preguntas. Cada allow queda anotado en
# $WORKBENCH_STATE_DIR/auto-allowed.log para poder revisarlo despues.
set -uo pipefail

if command -v timeout >/dev/null 2>&1; then
  PAYLOAD="$(timeout 5 cat 2>/dev/null || true)"
else
  PAYLOAD="$(cat 2>/dev/null || true)"
fi

command -v jq >/dev/null 2>&1 || exit 0

mode="$(jq -r '.permission_mode // empty' <<<"$PAYLOAD" 2>/dev/null)"
[ "$mode" = "bypassPermissions" ] || exit 0

state="${WORKBENCH_STATE_DIR:-$HOME/.claude/workbench/state}"
if mkdir -p "$state" 2>/dev/null; then
  jq -c --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{at: $at, tool: .tool_name, cwd: .cwd, input: (.tool_input | tostring | .[0:300])}' \
    <<<"$PAYLOAD" >>"$state/auto-allowed.log" 2>/dev/null || true
fi

printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}'
