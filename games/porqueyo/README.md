# ¿Por qué siempre yo? — juego multijugador

Juego de dados y canicas para 2 a 8 jugadores basado en `RULES.md`, con el
tablero descrito en `DESIGN.png` y `BOARD.png`.

## Ejecutar

El juego forma parte de GameCenter. Desde la raíz del proyecto:

```bash
npm install
npm start
# Lobby:  http://localhost:3000/
# Juego:  http://localhost:3000/games/porqueyo/
```

Variable opcional: `PORT` (por defecto 3000). Requiere Node 18 o superior.

También existe un modo independiente (`node games/porqueyo/server.js`), pero no
sirve los recursos compartidos de `/shared` (estilos de las pantallas de inicio
y sala, banner de turno), así que se recomienda arrancarlo desde GameCenter.

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
| Canicas iniciales | RULES.md las fija en 10. Configurable por el anfitrión entre 10 y 20, con 10 como valor por defecto. |
| Elección del jugador | Ninguna regla depende de una decisión del jugador (el color obtenido determina la acción de forma automática), así que un turno equivale a un único lanzamiento sin pasos intermedios. |
| Desconexión y abandono | Ver [Salas y conexión](#salas-y-conexión). |
| Reinicio | "Nueva partida" (solo el anfitrión, con la partida terminada) vacía el tablero y devuelve a todos sus canicas iniciales, con los jugadores que sigan conectados. |

## Salas y conexión

Reglas comunes de GameCenter (`core/room-kit.js`):

- **Identidad:** toda acción exige el token secreto que recibe cada jugador al
  crear o unirse a la sala; el identificador público no basta.
- **Sala de espera:** quien se desconecta (recarga, corte de red) conserva su
  asiento 15 s. Quien se une y no llega a conectarse sale a los 20 s.
- **Primer turno:** se sortea al empezar cada partida.
- **Turno inactivo:** si el jugador de turno está conectado y pasa 45 s sin lanzar,
  el dado se lanza automáticamente por él y la jugada se resuelve como cualquier otra.
- **Desconexión en partida:** el turno pasa siempre al jugador de al lado. Si le
  toca a alguien desconectado, se espera 25 s y luego se salta su turno.
- **Salir de la partida:** quien pulsa Salir queda fuera de los turnos, de los
  cobros y de las revanchas, y ya no puede volver a esa partida.
  Si solo queda un jugador, gana por abandono y se lleva el bote.
- **Anfitrión:** si abandona, o lleva 10 s desconectado durante la partida, el
  rol pasa al primer jugador conectado.
- **Revancha:** solo con los jugadores conectados (mínimo 2); quien abandonó o
  está desconectado sale de la sala y no paga la nueva entrada.

## Archivos

| Archivo | Rol |
|---|---|
| `server.js` | Servidor HTTP + SSE, salas y turnos. Estado autoritativo. |
| `engine.js` | Reglas puras: lanzamiento del dado, resolución de una zona. |
| `zones.js` | Las 5 zonas de color (id, capacidad) + la zona negra. Compartido servidor/navegador. |
| `game.html` | Interfaz del juego (pantallas home/lobby/juego, tablero SVG, paneles). |
| `game.css` | Estilos nuevos: pantallas, formularios, modales, avisos, animaciones. |
| `game.js` | Cliente: construcción del tablero SVG, render, animaciones y sonido sintetizado con WebAudio. |
| `styles.css` | Variables de tema y estilos base de la interfaz de partida. |

## Notas técnicas

- Transporte: `EventSource` (SSE) del servidor al cliente y `POST /api/*` del
  cliente al servidor. Sin WebSockets; el router usa Express.
- El dado se genera en el servidor con `crypto.randomInt`; el cliente solo
  anima el resultado.
- Todos los sonidos se sintetizan en el navegador con WebAudio: no hay archivos
  de audio. El navegador exige un gesto del usuario antes de sonar.
- Las salas viven en memoria: al reiniciar el servidor se pierden.
- El tablero SVG del juego (geometría definida en `game.js`): zonas proporcionales
  a su capacidad, huecos con bisel, canicas con brillo especular, pero cada hueco se
  llena o vacía según el estado real de la sala en vez de mostrarse siempre completo.
