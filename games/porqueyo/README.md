# ¿Por qué siempre yo? — juego multijugador

Juego de dados y canicas para 2 a 8 jugadores basado en `RULES.md`, con el
tablero descrito en `DESIGN.png` y `BOARD.png`.

## Ejecutar

```bash
node server.js
```

Luego abrir <http://localhost:3000>.

Un solo proceso sirve el frontend y gestiona el tiempo real. No hay dependencias
externas ni `npm install`. Requiere Node 18 o superior.

Variable opcional: `PORT` (por defecto 3000).

```bash
PORT=8080 node server.js
```

## Jugar

1. Quien crea la sala define la **configuración inicial**: jugadores máximos y
   canicas iniciales por jugador.
2. Se genera un **código de 4 letras**. Los demás jugadores entran con ese código
   desde otro dispositivo o pestaña de la misma red.
3. El anfitrión pulsa **Iniciar partida** (mínimo 2 jugadores).

Para probar en solitario, abrir varias pestañas: cada pestaña es un jugador
distinto (la sesión se guarda en `sessionStorage`).

Si el servidor no está en la misma máquina, los demás entran por la IP local del
anfitrión, por ejemplo `http://192.168.1.20:3000`.

## Reglas implementadas

- El tablero es **único y compartido** por toda la sala (no hay un tablero por
  jugador): las zonas de color no pertenecen a nadie.
- 6 caras de color: blanco, amarillo, azul, verde, rojo, negro.
- En su turno, un jugador lanza el dado una vez; el resultado se resuelve
  automáticamente y el turno pasa al siguiente jugador.
- Blanco (1 hueco), amarillo (2), azul (3), verde (4), rojo (5): si la zona
  tiene espacio, el jugador coloca 1 canica (-1 a su reserva). Si la zona está
  llena, el jugador se lleva **todas** las canicas acumuladas (la zona queda
  vacía), sin importar quién las colocó.
- Negro: el jugador pierde 1 canica para siempre; no hay hueco que llenar.
- Gana el primer jugador que se queda con **0 canicas** en su reserva. La
  partida termina de inmediato.

### Decisiones tomadas donde las reglas no eran explícitas

| Punto | Decisión |
|---|---|
| Jugadores máximos | RULES.md solo indica "2 o más". Se limita a 2–8 por practicidad de sala/UI. |
| Canicas iniciales | RULES.md las fija en 10. Se dejó configurable por el anfitrión (3–30), con 10 como valor por defecto para no alterar la partida si no se cambia. |
| Elección del jugador | Ninguna regla depende de una decisión del jugador (el color obtenido determina la acción de forma automática), así que un turno equivale a un único lanzamiento sin pasos intermedios. |
| Desconexión | El jugador se marca como desconectado; si le toca el turno y lleva 25 s sin conexión, se salta. |
| Reinicio | "Nueva partida" (solo el anfitrión, con la partida terminada) vacía el tablero y devuelve a todos sus canicas iniciales, con los mismos jugadores. |

## Archivos

| Archivo | Rol |
|---|---|
| `server.js` | Servidor HTTP + SSE, salas y turnos. Estado autoritativo. |
| `engine.js` | Reglas puras: lanzamiento del dado, resolución de una zona. |
| `zones.js` | Las 5 zonas de color (id, capacidad) + la zona negra. Compartido servidor/navegador. |
| `game.html` | Interfaz del juego (pantallas home/lobby/juego, tablero SVG, paneles). |
| `game.css` | Estilos nuevos: pantallas, formularios, modales, avisos, animaciones. |
| `game.js` | Cliente: construcción del tablero SVG, render, animaciones y sonido sintetizado con WebAudio. |
| `index.html`, `styles.css` | Mock de diseño original, **sin modificar**. Visible en `/index.html`. |

## Notas técnicas

- Transporte: `EventSource` (SSE) del servidor al cliente y `POST /api/*` del
  cliente al servidor. Sin WebSockets ni dependencias.
- El dado se genera en el servidor con `crypto.randomInt`; el cliente solo
  anima el resultado.
- Todos los sonidos se sintetizan en el navegador con WebAudio: no hay archivos
  de audio. El navegador exige un gesto del usuario antes de sonar.
- Las salas viven en memoria: al reiniciar el servidor se pierden.
- El tablero SVG del juego reutiliza exactamente la misma geometría que
  `index.html` (zonas proporcionales a su capacidad, huecos con bisel, canicas
  con brillo especular), pero cada hueco se llena o vacía según el estado real
  de la sala en vez de mostrarse siempre completo.
