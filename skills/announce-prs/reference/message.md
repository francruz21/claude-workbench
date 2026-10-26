# El mensaje

Un formato, sea cual sea el transporte. Los valores salen del config.

Un mensaje **por ticket**. Adentro, una línea por PR de ese ticket:

```
@<mention.name> PR a <AMBIENTE> 🟢

<TICKET-ID> - rama <rama>
<TAG> -> <ambiente>: [<descripción>](<url>)
<TAG> -> <ambiente>: [<descripción>](<url>)

<N> en verde en <gateWorkflow> 👌
```

Ejemplo:

```
@Nombre Apellido PR a DEV 🟢

TCK-262 - rama fix/TCK-262-usuario-sin-rol-puede-entrar-a-una-seccion-ajena
BACK -> dev: [devuelve 403 real al entrar sin rol asignado, también por SSO](https://github.com/OWNER/repo-api/pull/191)
FRONT -> dev: [se saca la excepción que salteaba el chequeo de rol en el cliente](https://github.com/OWNER/repo-front/pull/256)

2 en verde en Tests & Coverage 👌
```

Un ticket de una sola rama es el mismo formato con una línea:

```
@Nombre Apellido PR a DEV 🟢

TCK-332 - rama fix/TCK-332-listado-muestra-contenido-de-otra-organizacion
FRONT -> dev: [el listado deja de mostrar contenido de otra organización](https://github.com/OWNER/repo-front/pull/260)

1 en verde en Tests & Coverage 👌
```

**El link envuelve la descripción, no la referencia.** El número de PR no se
escribe: quien necesita el número abre el link. Lo que el revisor lee de un
vistazo es qué cambió, no cuál es el identificador.

**El encabezado nombra el ambiente, no el ticket.** El ticket ya está en su
propia línea, y el ambiente es lo primero que decide si al lector le toca mirar.
Si los PRs del ticket van a ambientes distintos, se nombran los dos
(`PR a DEV y STAGE`); no se elige uno ni se omite.

Reglas de contenido:

- **`<TAG> -> <ambiente>`** es la etiqueta de cada línea, y las dos mitades
  juntas: `BACK -> dev`, `FRONT -> dev`, `BACK -> stage`. El `<ambiente>` es
  `baseRefName`; el `<TAG>` sale de `config.repos[].tag`.

  **Las dos mitades hacen falta en cada línea.** El revisor abre el canal y
  necesita saber, de un vistazo y por PR, *qué stack toca* y *a qué ambiente va*
  — son las dos cosas que deciden si le corresponde mirarlo y con qué cabeza. El
  encabezado dice el ambiente del mensaje, pero eso no alcanza: la línea es lo
  que se lee y lo que se cita al responder.

  La flecha va de **stack a ambiente**, que es informativa: dice qué mitad del
  sistema entra dónde. Lo que **nunca** va es una flecha de destino a destino
  (`dev -> dev`): repite el ambiente, no aclara el stack, y es ruido en el único
  lugar donde el lector busca la información.

- **El `<TAG>` sale del config, nunca del título del PR ni del nombre de la rama.**
  Y es el vocabulario del equipo: `BACK` para la API, `FRONT` para el front. No
  `API`, no `Backend`.

- **Si la rama nació de un lugar distinto del destino** (por ejemplo, cortada de
  `stage` y apuntando a `dev`), agregar `(desde <origen>)` al final de la línea.
  Solo en ese caso: cuando origen y destino coinciden, decirlo dos veces no
  informa nada.
- **Las capturas de Linear no se re-embeben en otro lado.** Las URLs de
  `uploads.linear.app` llevan una firma en el query string y **dan HTTP 401 sin
  ella** (verificado). Pegadas en el cuerpo de una PR de GitHub, o en Discord,
  quedan como imágenes rotas. Se linkea el comentario del ticket, no la imagen.
- **`<descripción>`** es la primera línea del comentario que el agente ya dejó
  en el ticket (esas 3-6 líneas de negocio + técnico del paso 12 de
  `ticket-workflow`). No se redacta de nuevo.
  **Si el PR está verde pero el ticket no tiene comentario**, pedirle la
  descripción al usuario. No inventarla ni copiar el título del PR.
- **`<N>`** es la cantidad de PRs **de ese ticket**.
- **Un ticket cuyas ramas apuntan a ambientes distintos** (raro, pero pasa: el
  back a `stage` y el front a `dev`) va igual en **un** mensaje — es un ticket.
  Cada línea ya dice su propio ambiente, así que no hay ambigüedad.
- Los mensajes van en español: los lee el equipo.
