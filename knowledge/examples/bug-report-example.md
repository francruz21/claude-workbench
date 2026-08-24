# Bug: el checkout envía el carrito vacío en navegación rápida

## Comportamiento esperado

Al completar el checkout, el pedido debe incluir todos los ítems que el
usuario agregó al carrito.

## Comportamiento actual

En algunos casos, el pedido se crea con el carrito vacío, sin ítems, aunque
el usuario haya agregado productos previamente.

## Pasos para reproducir

1. Agregar 2 o más productos al carrito.
2. Navegar inmediatamente (menos de ~300ms) a la pantalla de checkout.
3. Completar el pago sin esperar a que la pantalla termine de cargar del todo.
4. El pedido resultante queda vacío de ítems.

No se reproduce si se espera 1-2 segundos entre agregar productos y navegar
al checkout.

## Entorno

Producción y staging. Reproducido en Chrome y Firefox de escritorio. Más
frecuente en conexiones lentas (throttling a 3G reproduce el 100% de las veces).

## Evidencia

Logs del backend muestran que el request de creación de pedido llega con
`items: []`. El frontend, en la misma sesión, muestra el carrito con
productos en el paso anterior — la desincronización ocurre entre el estado
de React y lo que efectivamente se envía.

## Impacto

Alto: pedidos fantasma sin ítems, que además bloquean al usuario de volver a
intentar la compra sin refrescar la página manualmente. Reportado por 4
usuarios distintos en la última semana.
