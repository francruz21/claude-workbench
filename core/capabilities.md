# Deteccion de capabilities

Cada probe responde por un hecho del sistema — algo instalado o no, algo
presente o no. Lo que es una eleccion de la persona no se detecta: se
pregunta, y va a `choices`, no a `detected` (ver `core/config-schema.md`).

| Capability | Probe | Verdadero si |
|---|---|---|
| `gh` | `command -v gh` | el binario existe en PATH |
| `orca` | `command -v orca-ide` | el binario existe en PATH |
| `python3` | `command -v python3` | el binario existe en PATH |
| `tracker` | no se detecta | se pregunta: es una eleccion, no un hecho del sistema |
| `discord` | no se detecta | se deriva de que `user.announce.channelUrl` este seteado |

La regla que separa las dos columnas es mecanica: un probe mide algo que el
sistema ya revela por si solo (un binario en el PATH, un archivo presente).
`tracker` no se detecta porque cual usar sigue siendo una decision de la
persona aunque el probe pudiera ver mas de un tracker instalado. `discord`
tampoco se detecta con un probe propio: se deriva de un campo de la capa
`user`, que ya es una decision tomada, no una medicion nueva.

Re-correr la deteccion reescribe el bloque `detected` entero y nunca toca
`choices`: es el mismo invariante que documenta `core/config-schema.md`.
