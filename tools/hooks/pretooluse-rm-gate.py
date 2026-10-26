#!/usr/bin/env python3
"""Hook de PreToolUse a nivel usuario para `rm -r`: bloquea solo los destinos
que borran la maquina o el home, y deja correr sin preguntar todo otro borrado
recursivo.

Va de la mano de permissionrequest-bypass.sh: con bypassPermissions ese hook
contesta solo el `ask` de `Bash(rm -rf:*)`, asi que esta es la red que queda.
Un conductor o un hijo sin nadie mirando quedaba congelado en ese ask mientras
limpiaba node_modules o su propio worktree; los borrados que importan se
bloquean aca.

Bloquea: `/`, una ruta a uno o dos niveles de `/` (`/home`, `/usr/lib`), `$HOME`
y sus carpetas directas (`~/Documentos`), `.`/`..`, un `*` pelado, y todo lo que
no se puede leer antes de expandir (`$VAR`, `$(...)`). Sale con 2 y el motivo.
"""
import json
import os
import re
import shlex
import sys

HOME = os.path.expanduser("~").rstrip("/")


def danger(arg):
    path = re.sub(r"^\$\{?HOME\}?(?=/|$)", HOME, arg)
    if "$" in path or "`" in path:
        return "usa una variable o una sustitución que no puedo leer"
    path = re.sub(r"^~(?=/|$)", HOME, path)
    if path in (".", "..", "*", "./*", "../*", "/*", "~"):
        return "borra el directorio actual, el de arriba o todo"
    if path.startswith("/"):
        norm = os.path.normpath(path.replace("*", "x"))
        if norm.count("/") <= 2 and not norm.startswith("/tmp/"):
            return "es la raíz o un directorio del sistema"
        if norm in (HOME,) or os.path.dirname(norm) == HOME:
            return "es tu home o una carpeta directa de él"
    return None


def main():
    try:
        payload = json.load(sys.stdin)
    except (ValueError, OSError):
        sys.exit(0)
    command = (payload.get("tool_input") or {}).get("command") or ""
    for part in re.split(r"&&|\|\||;|\n|\|", command):
        try:
            words = shlex.split(part)
        except ValueError:
            words = part.split()
        while words and (words[0] in ("sudo", "nohup", "command") or "=" in words[0]):
            words = words[1:]
        if not words or os.path.basename(words[0]) != "rm":
            continue
        flags = "".join(w[1:] for w in words[1:] if w.startswith("-") and not w.startswith("--"))
        recursive = "r" in flags.lower() or "--recursive" in words
        if not recursive:
            continue
        for target in (w for w in words[1:] if not w.startswith("-")):
            why = danger(target)
            if why:
                print(
                    "Bloqueado por rm-gate: `rm -r {}` {}. Si de verdad hay que "
                    "borrarlo, pedíselo al dev con `! <comando>`.".format(target, why),
                    file=sys.stderr,
                )
                sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
