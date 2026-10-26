# El anuncio en la fase 5 — cuándo y de a cuántos

Cómo se anuncia (alcance, gate en vivo, mensaje, transporte y marcado) está en
la skill **`announce-prs`**, y el conductor la sigue igual que un anuncio suelto.
Acá queda solo lo propio del conductor: qué lo dispara y la cola por ticket.

## El disparador

**El disparador es el evento `GREEN` del monitor del PR**, no una revisión
manual ni un pedido del usuario. Ver
[`agents.md`](agents.md#vigilar-el-gate-de-un-pr). Cuando el último PR de un
ticket pasa a `GREEN`, sale el mensaje de ese ticket.

`SINCHECKS` **no habilita a anunciar**: un PR sin checks corridos no es un PR
verde. Tampoco `PENDING`.

**Una hora pedida por el usuario agenda el anuncio; no autoriza saltear el
gate.** "Anuncialo a las 9" es *no antes de las 9*, no *a las 9 pase lo que
pase*. Si llegó la hora y el gate no está en `GREEN`, no sale nada: se avisa con
el estado del gate y se manda cuando pase a verde. Pasó al revés una vez —el
mensaje salió a la hora pedida con el gate de tests en `pending`, y quedó verde
29 minutos después—, y por eso el guarda además está en el registro:
`conductor-ledger.sh announced` se niega a anotar un anuncio sin todos los PRs en
`GREEN`.

Y **la label va después del envío verificado**, no después del `Enter`: si el
mensaje no llegó y la label ya está puesta, ese ticket queda invisible para la
próxima pasada y nadie lo anuncia nunca. El orden es: confirmar el mensaje en el
canal → `conductor-ledger.sh announced` → la label → `conductor-ledger.sh
labelled`.

## El modelo es una COLA POR TICKET, no una tanda

**La unidad de anuncio es el ticket, y se manda solo, en cuanto ese ticket está
verde.** No se espera a que haya varios listos, no se agrupa por ambiente entre
tickets distintos, no hay "tanda".

- Un ticket que toca **front y back** → **un** mensaje con sus dos PRs juntos.
- Un ticket que toca **una sola rama** → un mensaje con ese PR.
- Dos tickets verdes al mismo tiempo → **dos** mensajes, uno por ticket.

Un ticket se anuncia cuando **todos sus PRs** pasaron el gate. Si el front está
verde y el back todavía corre, **no se manda nada**: el revisor necesita las dos
mitades para entender el cambio, y media notificación lo hace abrir un PR que
depende de otro que todavía no puede mirar.

**El conductor queda a la escucha.** Después de que un PR se publica, hay que
seguir el estado del gate hasta que resuelva, y disparar el anuncio ahí — sin que
el usuario tenga que pedirlo. Un ticket que se pone verde y nadie anuncia es un PR
que queda esperando a que alguien se acuerde.

### Este modelo reemplaza el "mostrar antes de enviar"

Antes de la cola, cada envío se le mostraba al usuario y se esperaba OK. Con la
cola eso ya no aplica: **el envío es automático** cuando el ticket está verde.

Lo que lo hace seguro es que el alcance dejó de ser una decisión. El mensaje
cubre **los PRs de ese ticket y nada más** — no "mis PRs verdes", no "los
últimos". Es determinístico, así que no hay nada que confirmar. Lo que sigue
siendo obligatorio antes de enviar es la verificación mecánica: que la mención
resuelva, que el cuerpo tenga los PRs que corresponden, y que ninguno esté ya
anunciado.

## Lo demás está en `announce-prs`

- Los PRs del ticket y el gate en vivo: pasos 2 y 3.
- El mensaje: `announce-prs/reference/message.md`.
- El envío, por el transporte de `choices.announceTransport`:
  `announce-prs/reference/transport-browser.md` o `transport-discord-mcp.md`.
- La label y el registro (`announced` → label → `labelled`): paso 5.
- Re-anunciar, y buscar en el canal un anuncio escrito a mano antes de duplicar.
