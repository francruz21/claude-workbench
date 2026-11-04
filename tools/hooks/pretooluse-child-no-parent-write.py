#!/usr/bin/env python3
"""Hook de PreToolUse a nivel usuario: un hijo no escribe en el chat de un padre.

Un hijo es una sesion que corre en un worktree de Orca bajo `~/orca/workspaces/`
(lo dice `ORCA_WORKTREE_ID`). El conductor corre en el checkout primario, asi que
no lo toca. Desde un hijo bloquea:

`orca-ide terminal send` (u `orca`) a una terminal que no es la propia
(`ORCA_TERMINAL_HANDLE`): eso tipea en el prompt de otro agente y usa su chat
como block de notas.

Toda la mensajeria interna (`orchestration send/ask/reply`, de cualquier tipo)
queda libre: es el canal ya programado para hablar con el padre.

Por que un hook: la regla ya estaba en el --spec y en la memoria, y la prosa se
pierde (el usuario vio a un hijo escribiendo sobre el chat de un padre). Sale con 2 y el motivo.
"""
import json
import os
import re
import shlex
import sys

CHILD_MARK = "/orca/workspaces/"


def is_child():
    wt = os.environ.get("ORCA_WORKTREE_ID", "")
    return CHILD_MARK in wt


def flag(words, name):
    """Value of `--name value` or `--name=value`, or None."""
    for i, w in enumerate(words):
        if w == name and i + 1 < len(words):
            return words[i + 1]
        if w.startswith(name + "="):
            return w.split("=", 1)[1]
    return None


def check(words):
    if not words or os.path.basename(words[0]) not in ("orca", "orca-ide"):
        return None
    rest = words[1:]
    if rest[:2] == ["terminal", "send"]:
        target = flag(rest, "--terminal")
        own = os.environ.get("ORCA_TERMINAL_HANDLE", "")
        if target and target != own:
            return (
                "Sos un hijo: no se escribe en la terminal de otro agente "
                f"({target}). Tu chat es tu block de notas. Al conductor solo "
                "le hablás por la mensajería interna (orca-ide orchestration ask/send)."
            )
    return None


def main():
    # Drain stdin first: exiting before reading leaves the writer with SIGPIPE.
    try:
        payload = json.load(sys.stdin)
    except (ValueError, OSError):
        sys.exit(0)
    if not is_child():
        sys.exit(0)
    command = (payload.get("tool_input") or {}).get("command") or ""
    for part in re.split(r"&&|\|\||;|\n|\|", command):
        try:
            words = shlex.split(part)
        except ValueError:
            words = part.split()
        while words and (words[0] in ("sudo", "nohup", "command", "env") or "=" in words[0]):
            words = words[1:]
        reason = check(words)
        if reason:
            print(reason, file=sys.stderr)
            sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
