# Transporte `discord-mcp` — postear con un bot de Discord

Para `choices.announceTransport: "discord-mcp"`: el mensaje sale por el servidor
MCP `discord`, como un bot. No depende de una pestaña abierta, así que sirve en
una sesión sin navegador o en un loop agendado.

## Enviar

El canal es el último número de `user.announce.channelUrl`
(`https://discord.com/channels/<servidor>/<canal>`): no hace falta guardarlo
aparte.

```
mcp__discord__discord_login
mcp__discord__discord_send  { channel: "<id-del-canal>", message: "<mensaje>" }
```

`discord_send` manda texto plano. Un link enmascarado (`[texto](url)`) se ve bien
desde un bot, y una mención `<@ID>` notifica, igual que en el navegador. Después
del envío, confirmar que el mensaje está en el canal (`discord_read_messages`)
antes de seguir con el marcado: un `ok` del envío no prueba que llegó.

Sin el MCP arriba (`discord_login` falla), **parar y decirlo**: no caer a un
webhook ni al navegador sin que el usuario lo elija, porque cambia quién firma el
mensaje.

## Instalarlo (una vez por máquina, nunca en el repo)

El servidor va en scope de **usuario**, así sirve en todos los proyectos y queda
fuera del `.mcp.json` de cualquier repo:

```bash
echo 'export DISCORD_TOKEN=<token-del-bot>' >> ~/.zshrc && source ~/.zshrc
claude mcp add discord --scope user -- npx -y mcp-discord
claude mcp list | grep discord
```

El servidor lee `DISCORD_TOKEN` del entorno que hereda, así el token nunca queda
en `~/.claude.json`. **No** pasarlo como `--config "$DISCORD_TOKEN"`: la shell lo
expande al registrar y lo escribe en claro en la config. Relanzar Claude Code
después del `export`.

El bot necesita los intents `Message Content` y `Server Members`, y permisos para
ver el canal, mandar mensajes y leer el historial. Referencia del servidor:
[barryyip0625/mcp-discord](https://github.com/barryyip0625/mcp-discord).

## El guarda

`tools/hooks/pretooluse-announce-gate.sh` también frena `discord_send` al canal
de anuncios si no hay un arm vigente de `announce-arm`: el bot no es una puerta
lateral para saltear el gate. Va registrado con su propio matcher (ver
*Requiere* en la skill).
