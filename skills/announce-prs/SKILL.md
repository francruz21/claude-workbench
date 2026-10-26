---
name: announce-prs
description: Use cuando hay que avisar en el canal del equipo que los PRs de un ticket pasaron el gate y están listos para revisar — lo pide el usuario ("anunciá TCK-12"), o lo dispara el conductor en su fase 5, o un loop agendado. Cubre el alcance (solo los tickets nombrados), el gate estricto verificado en vivo, el formato del mensaje, el transporte que el usuario configuró (navegador o bot de Discord) y la label anti-duplicado. NO usar para anunciar un PR que no pasó el gate, ni para mensajes al canal que no son anuncios de PRs.
---

# Anunciar PRs en el canal del equipo

Un mensaje **por ticket**, con todos sus PRs, cuando todos pasaron el gate. El
canal, la mención y el transporte son de cada usuario y viven en su config local;
el repo no tiene ninguno de esos valores.

## Requiere

**Capabilities**
- `capabilities.gh` — para leer los PRs y su CI.
- `capabilities.choices.announce` — `"canal"`; con `"skip"` esta skill no hace nada.
- `capabilities.choices.announceTransport` — `"browser"` (la pestaña del canal
  en el navegador de Orca, con la sesión del usuario) o `"discord-mcp"` (un bot,
  por el servidor MCP `discord`).

**Config**
- `user.author` — solo se anuncian los PRs de este handle.
- `user.announce.channelUrl` — el canal.
- `user.announce.mention.name` y `user.announce.mention.id` — a quién se
  menciona; con el id, la mención notifica.
- `project.repos` — los repos y su `tag` (el stack que dice cada línea).
- `project.notifiedLabel` — la label que marca un PR ya anunciado.
- `project.gateWorkflow` y `project.gateRequired` — el gate.

Ante un campo ausente, `core/resolve.md`: parar y preguntar, nunca completar en
silencio.

**Tools del workbench**
- `tools/conductor-ledger.sh` — el registro y el gate (`pr-state`,
  `announce-arm`). Un anuncio suelto usa el mismo registro que el conductor: es
  lo que lo pone detrás del mismo gate y del mismo hook.
- `tools/hooks/pretooluse-announce-gate.sh` — deniega el envío al canal y la
  label sin un arm vigente. En `~/.claude/settings.json`, en `PreToolUse`, además
  de las dos entradas de `Bash` que lista la skill `conductor`, una para el bot:

  ```json
  { "matcher": "mcp__discord__discord_send",
    "hooks": [{ "type": "command", "timeout": 10,
                "command": "<ruta-del-workbench>/tools/hooks/pretooluse-announce-gate.sh" }] }
  ```

## 1. El alcance: los tickets que el usuario nombró

Se anuncian los tickets que el usuario nombró, y nada más. (El conductor no
pregunta: su alcance es el ticket de la cola.) Si el usuario pide anunciar algo con
una frase elástica — "mis PRs", "los últimos que tenga", "los que estén verdes" —
eso **no** es una lista de tickets: es una pregunta sin hacer. Mostrarle los
candidatos y que marque cuáles, antes de escribir una línea del mensaje.

Lo que se pierde por asumir es caro y no se deshace: un PR de otro ticket
anunciado en el canal del equipo arrastra a un revisor a trabajo que nadie le
pidió mirar, y puede exponer trabajo que todavía se está tocando. El mensaje se
puede borrar; la notificación que ya llegó, no.

Tampoco entra un ticket **porque esté verde y sea del autor**. Verde y propio
son condiciones para *poder* anunciarlo, no razones para hacerlo.

### La label no es la única memoria del canal

`notifiedLabel` solo sabe de los anuncios que pasaron por este flujo. Un anuncio
que el usuario escribió a mano — o uno de una corrida anterior a que la label
existiera — **no dejó label**, y el filtro lo lee como "nunca se anunció".

Antes de postear, buscar en el canal si esos PRs ya fueron anunciados: por número
(`#256`), por URL, o por el id del ticket. Si aparece, **no duplicar**: decirle al
usuario qué encontró, con la fecha y quién lo mandó, y preguntar si igual quiere
mandar uno nuevo. Un segundo anuncio del mismo PR le vuelve a sonar el teléfono a
alguien que ya lo vio y ya contestó.

**Nada verde y sin anunciar** → decirlo y parar. **No** postear un mensaje de
"todo en orden": el canal es para avisos, no para latidos.

## 2. Los PRs del ticket

Una corrida por repo de `project.repos`:

```bash
gh pr list --repo "$SLUG" --state open --limit 30 --author "$AUTHOR" \
  --json number,title,url,baseRefName,headRefName,isDraft,labels \
| jq -c --arg lbl "$LABEL" --arg ticket "$TICKET" '
  [ .[]
    | select(.isDraft == false)
    | select(.headRefName | test($ticket; "i"))
    | select([.labels[].name] | index($lbl) | not)
    | { number, title, url, base: .baseRefName, head: .headRefName } ]'
```

- **`test($ticket)` sobre `headRefName`**: la convención de ramas
  (`<tipo>/TCK-<n>-<slug>`) pone el id en la rama, así que el filtro es exacto.
- **`--author`**: solo los PRs propios. Que un PR ajeno esté verde no es asunto
  de esta corrida.
- **Sin drafts**: un draft es trabajo en curso.

## 3. El gate, en vivo y por el registro

```bash
L="$WB/tools/conductor-ledger.sh"
"$L" open "$TICKET" --slug "<slug-de-la-rama>"          # si no está ya (el conductor lo abrió al crear el hijo)
"$L" pr-add "$TICKET" --repo "$SLUG" --number <n>        # cada PR del paso 2
"$L" announce-arm "$TICKET"                              # verifica el gate EN VIVO; habilita el envío 10 min
```

`announce-arm` corre `pr-state` sobre cada PR: los workflows de `gateWorkflow`
corridos en el SHA, ninguno en rojo, y los jobs de `gateRequired` (los tests, el
review automático) **pasados**, no salteados. Si devuelve otra cosa que GREEN,
no se anuncia: se dice el estado (`RED claude-review=fail`, `SINCHECKS ...`) y se
espera. **Ni una hora pedida ni un pedido explícito autorizan saltear el gate**:
"anuncialo a las 9" es *no antes de las 9*.

Un ticket se anuncia cuando **todos** sus PRs pasaron. Con el front verde y el
back corriendo no sale nada: media notificación hace abrir un PR que depende de
otro que todavía no se puede mirar.

## 4. Armar y mandar el mensaje

El formato está en [`reference/message.md`](reference/message.md), y es el mismo
para cualquier transporte. Se manda por el de `choices.announceTransport`:

- `"browser"` → [`reference/transport-browser.md`](reference/transport-browser.md)
- `"discord-mcp"` → [`reference/transport-discord-mcp.md`](reference/transport-discord-mcp.md)

Antes de enviar: que la mención resuelva, que estén todos los PRs del ticket y
ninguno ya anunciado. Después: confirmar que el mensaje está en el canal. Un
`ok` del envío no lo prueba.

## 5. Marcar como anunciado

```bash
gh pr edit <n> --repo "$SLUG" --add-label "$LABEL"
```

**El orden importa**: la label va después de que el envío salió bien. Etiquetar
antes pierde el anuncio si el canal falla — el PR queda marcado como anunciado sin
haberse anunciado.

Si un envío falla: dejar ese PR sin label, seguir con el resto, y reportar las
fallas al final. Nunca declarar éxito sin la tabla de qué se posteó y qué se
salteó, con el motivo.

Si la label no existe en el repo:

```bash
gh label create "$LABEL" --repo "$SLUG" --color 5865F2 --description "Ya anunciado"
```

### Re-anunciar

```bash
gh pr edit <n> --repo "$SLUG" --remove-label "$LABEL"
```

La próxima corrida lo vuelve a levantar. La label es lo que hace la operación
idempotente: el conductor puede correr dos veces sin duplicar mensajes.

Y en el registro, en este orden: confirmar el mensaje en el canal →
`conductor-ledger.sh announced <TICKET>` → la label → `conductor-ledger.sh
labelled <TICKET>`. El hook deniega la label si el anuncio no está registrado.
Fuera del conductor, al terminar: `conductor-ledger.sh close <TICKET>`.

## Sin dueño, en loop

Esta skill no se dispara sola. Para anuncios desatendidos, algo la tiene que
llamar: `/loop 30m /announce-prs <tickets>` en una sesión abierta, o un agente
agendado (`/schedule`). La label hace la corrida idempotente: un PR se anuncia
una vez aunque el loop corra muchas.

## Errores comunes

| Error | Consecuencia |
|---|---|
| Decidir el gate con `gh pr checks` o el `statusCheckRollup` | Muestran la última corrida de cada check: la de un `gh pr edit` saltea los tests a propósito y tapa a la que los corrió. Y un solo workflow deja pasar un `claude-review` en rojo. El gate es `pr-state`. |
| Tratar "mis PRs" o "los últimos" como una lista de tickets | Es elástico a propósito: se muestran los candidatos y se pregunta. Un ticket de más es una notificación que no se deshace. |
| Confiar solo en la label para no duplicar | Un anuncio escrito a mano no deja label. Buscar en el canal antes. |
| Poner la label antes del envío confirmado | Si el canal falla, el PR queda marcado como anunciado sin anuncio, y nadie lo anuncia nunca. |
| Guardar el canal, una mención o un token en el repo | Son datos del usuario: van en `~/.claude/workbench/user.json` (600) o en el entorno. |
