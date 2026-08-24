# Protocolo de resolucion

Este documento es el artefacto central del diseño: como una skill se
comporta ante un hueco, en vez de asumir o de morir a la mitad. Vive en un
lugar y las skills lo citan (`tools/check-core-refs.sh` valida esa cita); no
se reimplementa en cada una.

## Cuando se dispara

Tres clases de hueco, y solo esas tres:

1. **Falta una capability.** La integracion que la skill necesita no esta
   instalada (por ejemplo, no hay `orca-ide` en el PATH).
2. **Falta un valor de config.** El campo esta vacio o ausente en alguna de
   las tres capas de `core/config-schema.md`.
3. **La situacion es ambigua.** Hay dos caminos validos, o un check quedo en
   rojo y no hay una unica forma correcta de seguir.

Ante cualquiera de las tres, la skill se detiene y resuelve con el usuario
antes de seguir. No asume el camino mas probable.

## La forma de la pregunta

**Enumerar opciones concretas, cada una con su consecuencia.** Nunca
preguntar abierto cuando las opciones son enumerables. "¿Que hago?" es una
mala pregunta porque no dice que pasa segun la respuesta; una lista numerada
donde cada entrada dice que implica es una buena pregunta, porque el usuario
elige sabiendo el resultado, no adivinando.

### Ejemplo trabajado: worktree sin Orca

La skill necesita un worktree y detecta que `orca` no esta instalado
(`detected.orca = false`). En vez de preguntar "¿como querés manejar el
worktree?", presenta:

```
No encuentro Orca instalado. Como manejo el worktree de esta tarea:

1. git worktree — crea un worktree nativo de git en una carpeta hermana.
   Funciona en cualquier repo, sin dependencias nuevas.
2. checkout directo — cambia de rama en el mismo working tree, sin
   worktree separado. Mas simple, pero no se puede trabajar en dos ramas
   a la vez.
3. instalar Orca ahora e usar el worktree de Orca — la opcion mas completa,
   pero pausa esta tarea hasta que la instalacion termine.

¿Cual de las tres?
```

Cada opcion dice que hace y que sacrifica o exige. El usuario no tiene que
imaginar la consecuencia: esta escrita.

## Que persiste y que no

No toda respuesta se guarda igual. La distincion evita que el sistema
envejezca mal.

| Tipo | Ejemplo | Persiste en |
|---|---|---|
| Preferencia permanente | "sin Orca, usar siempre el fallback de git worktree" | `capabilities.choices` |
| Hecho del proyecto | "la rama base de produccion es `main`" | `project` |
| Decision de una vez | "esta PR puntual va con otro reviewer" | **no persiste** |

La tercera fila existe a proposito, y es la que mas se olvida. Si una
decision de una vez se guardara igual que una preferencia, el config se
llena de respuestas de un solo uso, y meses despues el sistema aplica en
silencio una decision que se tomo para un caso puntual y ya no aplica a
nada. La unica forma de que eso no pase es no guardarla: se responde, se usa
para esa tarea, y se descarta.

La señal para distinguir preferencia de decision de una vez: si la
respuesta empieza con "para esta tarea" o similar, es de una vez. Si
empieza con "siempre que pase esto" o "en este proyecto", persiste.

## Como se anuncia una decision ya guardada

Cuando una skill usa un valor guardado en vez de volver a preguntar, lo dice
en una linea, con el motivo — no en silencio, porque el usuario tiene que
poder notar y corregir una decision vieja sin ir a leer el config:

```
Worktree por git worktree (Orca ausente).
```

Una linea, el que, y entre parentesis el por que. No hace falta mas: si el
usuario quiere cambiarla, la siguiente seccion dice como.

## El escape: `askEveryTime`

Cualquier clave guardada en `capabilities.choices` se puede listar en
`choices.askEveryTime` (ver `core/config-schema.md`). Una clave listada ahi
nunca se lee del valor guardado: la skill vuelve a preguntar cada vez, con
la misma forma de opciones numeradas de arriba.

Esto importa porque una preferencia que no se puede cambiar deja de ser una
preferencia — se vuelve una restriccion que el usuario no pidio. El escape
es lo que mantiene la persistencia opcional en la practica, no solo en el
papel.

## La seccion `## Requiere`

Cada skill declara, cerca del principio de su `SKILL.md`, una seccion
`## Requiere` que lista las capabilities y los campos de config que usa,
calificados por capa (`capabilities.*`, `user.*`, `project.*`). Por ejemplo:

```markdown
## Requiere

- `capabilities.gh`
- `project.baseBranch`
- `project.reviewers`
```

Esa seccion tiene tres consumidores, y cada uno la lee por una razon
distinta:

1. **El instalador**, para preguntar de entrada todo lo que las skills que
   se van a usar van a necesitar, en vez de que cada una pregunte a mitad de
   una tarea.
2. **La skill misma**, al arrancar: chequea que cada campo que declara este
   presente antes de empezar a trabajar, para fallar temprano y con un
   mensaje claro en vez de morir a la mitad de la tarea con un error opaco.
3. **El validador** (`tools/check-schema-refs.sh`), para atrapar el drift en
   CI: si una skill cita un campo que `core/config-schema.md` no declara,
   el commit no pasa. Sin este tercer consumidor, una skill podria pedir un
   campo que nunca existio, y el error solo aparece en produccion, para el
   usuario, no en desarrollo.
