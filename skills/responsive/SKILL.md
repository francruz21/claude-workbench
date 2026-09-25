---
name: responsive
description: Use SOLO cuando el usuario pide explícitamente adaptar una pantalla o diseño a mobile/tablet ("hacé responsive este diseño", "que se vea bien en el celu", `/responsive`), o cuando el ticket que se está trabajando pide explícitamente responsive, mobile o un breakpoint (en el título, la descripción o los criterios de aceptación). NO usar en cualquier cambio de UI por las dudas, ni en un ticket que no menciona mobile aunque toque componentes visuales.
---

# Responsive

## Propósito

Adaptar una pantalla a mobile y tablet, y **demostrar** que quedó bien:
medida en el navegador de Orca a 320, 375 y 768 px, no a ojo sobre el código.

## Requiere

- `capabilities.orca` — la medición corre en el navegador embebido de Orca. Si
  falta, no hay otro navegador que la reemplace: ver `core/resolve.md` y parar
  a preguntar, en vez de medir en el Chrome del usuario o a ojo.

## Cuándo usarla

Solo con una de estas dos señales, que se pueden verificar:

- **El usuario lo pide en ese mensaje:** "hacé responsive X", "adaptalo a
  mobile", "se rompe en el celular", `/responsive`.
- **El ticket lo pide:** el título, la descripción o los criterios de
  aceptación dicen responsive, mobile, celular, tablet o un ancho/breakpoint.
  El hijo de `ticket-workflow` que lee eso en el paso 2 la invoca solo, sin
  preguntar.

## Cuándo NO usarla

- Un cambio de UI cualquiera (un botón nuevo, un texto, un color) donde nadie
  habló de mobile. Que la pantalla tenga Tailwind no es una señal.
- Un ticket que menciona mobile solo al pasar ("después vemos mobile") o como
  fuera de alcance.
- Diseño visual nuevo desde cero: eso es `frontend-design`. Si además pide
  mobile, primero ese y después esta.

## Pasos detallados

1. **Relevar sin tocar código.** Levantá la pantalla (en un hijo, dentro del
   turno de QA del paso 8 de `ticket-workflow`) y corré el inspector en los
   tres anchos (ver "Medir"). Así sabés qué está roto antes de cambiar nada.
2. **Arreglar con las reglas R1–R6** (abajo), mobile-first: las clases sin
   prefijo son el celular, y `sm:`/`md:`/`lg:` agregan hacia arriba. No
   dupliques el componente para mobile.
3. **Volver a medir** los tres anchos. Tiene que dar `verdict: "PASS"`.
4. **Una captura por ancho**, en la misma pestaña, y los números del
   inspector como evidencia. Cerrá la pestaña al terminar.

### Medir

El inspector es [`scripts/inspect-viewport.js`](scripts/inspect-viewport.js).
Por cada ancho, en este orden, porque **`goto` resetea el viewport emulado**:

```bash
P=<browserPageId de orca-ide tab list --json>   # --page siempre
orca-ide goto --page $P --url <url> && orca-ide wait --page $P
orca-ide exec --page $P --command "set viewport 375 812 0.9643"
sleep 2
orca-ide eval --page $P --expression "$(cat ~/.claude/skills/responsive/scripts/inspect-viewport.js)" --json
```

| Ancho | Comando `set viewport` | Qué simula |
|---|---|---|
| 320 | `320 568 1` | celular chico (el piso) |
| 375 | `375 812 0.9643` | iPhone típico |
| 768 | `768 1024 0.7646` | tablet, cruza `md:` |

La escala es `min(1, 882/ancho, 783/alto)`. Con una escala mayor la captura
sale en mosaico. Si `innerWidth` no coincide con el ancho pedido, la medición
no vale: repetí el `set viewport`.

Cómo leer el resultado:

- `hasHorizontalOverflow` / `overflowing[]` → **bloquea.** Cada entrada es el
  elemento más externo que se sale de la pantalla. Lo que vive dentro de un
  `overflow-x-auto` no se cuenta, porque se asume que ese scroll es a propósito.
- `wideMedia[]` o `viewportMeta: null` → **bloquea.**
- `smallTargets[]` (< 24 px, WCAG 2.5.8 AA) → arreglarlo si el componente es
  tuyo; si no, reportarlo. `under44Count` es solo informativo.

## Reglas

- **R1 · Sin anchos fijos de layout.** Nada de `w-[600px]` ni `width: 600px`.
  Usá `w-full max-w-xl`, `min()`, `clamp()` o `minmax()`. Un ancho fijo chico
  en un ícono está bien.
- **R2 · Tocables de 44 px en lo que agregás vos** (`min-h-11 min-w-11`, o
  padding). En lo existente, lo mínimo es 24 px.
- **R3 · El texto dinámico no empuja el layout.** Emails, URLs y nombres van
  con `break-words` o `truncate`, y en un hijo de flex con `min-w-0`, que es el
  culpable más común.
- **R4 · Media fluida.** `max-w-full h-auto` en `img`, `video` e `iframe`.
- **R5 · Meta viewport** en el layout raíz.
- **R6 · Un drawer cerrado no ocupa lugar.** Si se esconde con
  `translate-x-full` o un `right` negativo, agregale `invisible` o
  `pointer-events-none` mientras está cerrado.

## Checklist

- [ ] La señal para usar la skill existe (pedido explícito o ticket).
- [ ] `verdict: "PASS"` en 320, 375 y 768, con `innerWidth` verificado en cada uno.
- [ ] Desktop (1280) sigue igual que antes.
- [ ] Una captura por ancho, y la pestaña cerrada.
- [ ] `smallTargets` restantes: arreglados o declarados.

## Ejemplos

Un landing en producción a 320 px:

```json
{"innerWidth":320,"hasHorizontalOverflow":true,
 "overflowing":[{"selector":"nav.flex.items-center.gap-8","width":326,"overflowByPx":11}],
 "smallTargets":["LinkedIn 20x20","Instagram 20x20","..."],"verdict":"FAIL"}
```

El desborde se debe a un `nav` con `gap-8` fijo. Se arregla con un `gap-4 sm:gap-8` o
`flex-wrap`, y después se vuelve a medir. A 375 y 768 da PASS.

## Errores comunes

- **Medir después de un `goto` sin volver a setear el viewport.** Da el ancho
  de desktop y un PASS falso.
- **Hacerlo en otro navegador.** El QA va en Orca (`~/.claude/CLAUDE.md`): ni
  `claude-in-chrome`, ni `playwright`, ni un iframe angosto, porque el iframe
  no cruza los breakpoints de verdad.
- **Arreglar con `overflow-x-hidden` en el `body`.** Esconde el síntoma y
  corta contenido. Arreglá el elemento que reporta `overflowing[]`.
- **Confiar en la captura por encima del JSON.** La foto puede ir un frame
  atrás. Cuando no coinciden, gana el DOM.
- **Dar por probado lo táctil.** El navegador de Orca no emite eventos touch
  ni tiene un UA mobile: lo que depende de `ontouchstart` o del UA queda como
  hueco declarado.
