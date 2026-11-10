# Rummy

Rummy de fichas multijugador (2 a 4 jugadores) con mesa de fieltro, atril de madera, fichas 3D y arrastrar y soltar con ratón o táctil. Forma parte de GameCenter y se sirve en `/games/rummy/`. Reglas completas en [INFO/RULES.md](INFO/RULES.md).

## Stack

- **Cliente:** HTML, CSS y JavaScript sin framework (`game.html`, `game.css`, `game.js`). Arrastrar y soltar propio con Pointer Events.
- **Servidor:** router de Express (`server.js`) montado por el servidor de GameCenter. El estado de la sala llega a cada jugador por Server-Sent Events y las acciones van por `POST`. El servidor es autoritativo: valida cada jugada.
- **Motor:** `engine.js`, sin dependencias (mazo, validación de combinaciones y turnos, puntuación).

## Ejecutar

Desde la raíz de GameCenter:

```bash
npm install
npm start
# Lobby:  http://localhost:3000/
# Rummy:  http://localhost:3000/games/rummy/
```

Variable opcional: `PORT` (por defecto 3000).

También existe un modo independiente (`node games/rummy/server.js`), pero no sirve los recursos compartidos de `/shared` (banners de turno y estilos de las pantallas de inicio y sala), así que se recomienda arrancarlo siempre desde GameCenter.

Para probar en solitario, abre varias pestañas: cada pestaña es un jugador distinto porque la sesión se guarda en `sessionStorage`.

## Cómo se juega

1. Un jugador crea la sala desde el lobby de GameCenter o desde la pantalla de inicio del juego, elige el nivel (Relajado 120 s, Normal 90 s, Experto 45 s por turno) y comparte el código de 4 letras.
2. Se unen hasta 4 jugadores y el anfitrión inicia la partida (mínimo 2). El primer turno se sortea.
3. Cada jugador recibe 14 fichas. En tu turno:
   - Arrastra fichas del atril a la mesa para formar **grupos** (mismo número, colores distintos, 3 o 4 fichas) o **escaleras** (números consecutivos del mismo color, 3 o más).
   - **Primera bajada:** mínimo 30 puntos usando solo fichas de tu mano. El comodín vale lo que representa.
   - Después de tu primera bajada puedes reorganizar la mesa libremente, incluidos los comodines. Al terminar el turno toda la mesa debe ser válida y ninguna ficha de la mesa puede volver a tu atril.
   - Si no juegas, pulsa **Robar** para tomar una ficha y pasar.
4. Si se agota el tiempo del turno, se acepta la jugada en curso si es válida; si no, robas automáticamente.

## Fin de la partida

- Gana quien se quede sin fichas.
- Cuando el pozo se vacía, la partida termina en ese momento. Se suman las fichas sin jugar de cada jugador (cada ficha vale su número y el comodín vale 10) y gana quien tenga menos puntos. En caso de empate gana el primero en orden de asiento.
- Con la apuesta de GameCenter activa, cada jugador paga la entrada al empezar y el ganador se lleva el bote.

## API

Todas las acciones son `POST /games/rummy/api/<acción>` con JSON. Las de partida requieren `roomId`, `playerId` y `token`.

| Acción | Uso |
|---|---|
| `create` | Crea sala (`name`, `config: { turnSeconds, bettingEnabled, apuesta }`). |
| `join` | Se une con `name` y `roomId`. |
| `start` / `restart` | El anfitrión inicia o repite la partida. |
| `liveBoard` | Envía la jugada en curso para mostrarla a los rivales. Solo se acepta si redistribuye las fichas de la mesa y de la mano del jugador. |
| `endTurn` | Confirma la jugada; el servidor la valida completa. |
| `drawTile` | Roba una ficha y pasa. |
| `state` / `leave` | Estado actual / salir de la sala. |

`GET /games/rummy/events?room=&pid=&token=` abre el stream SSE con el estado de la sala (cada jugador recibe solo su propia mano).

## Estructura

```
games/rummy/
  server.js     Router: salas, turnos, temporizador, SSE y acciones
  engine.js     Motor de reglas: mazo, validación de combinaciones y turnos, puntos
  game.html     Pantallas de inicio, sala de espera y partida
  game.css      Mesa, atril, fichas y animaciones
  game.js       Cliente: estado, arrastrar y soltar, sonido y acciones
  INFO/RULES.md Reglas del juego
```

La infraestructura común de salas está en `core/room-kit.js` y las apuestas en `core/ledger.js`.
