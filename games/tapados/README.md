# Tapados — juego multijugador

Juego de dados para 2 a 6 jugadores basado en `RULES.md`, con el tablero
inspirado en el de `BENDITO SIETE`. Arquitectura calcada de `CUCARACHA_II`.

## Ejecutar

El juego forma parte de GameCenter. Desde la raíz del proyecto:

```bash
npm install
npm start
# Lobby:  http://localhost:3000/
# Juego:  http://localhost:3000/games/tapados/
```

Variable opcional: `PORT` (por defecto 3000). Requiere Node 18 o superior.

También existe un modo independiente (`node games/tapados/server.js`), pero no
sirve los recursos compartidos de `/shared` (estilos de las pantallas de inicio
y sala, banner de turno), así que se recomienda arrancarlo desde GameCenter.

## Jugar

1. Quien crea la sala define la **configuración inicial**: jugadores máximos.
2. Se genera un **código de 4 letras**. Los demás jugadores entran con ese código
   desde otro dispositivo o pestaña de la misma red.
3. El anfitrión pulsa **Iniciar partida** (mínimo 2 jugadores).

Para probar en solitario, abrir varias pestañas: cada pestaña es un jugador
distinto (la sesión se guarda en `sessionStorage`).

## Reglas implementadas

- Tablero de 6 posiciones por jugador: 1·2·3·4·5·6, una por cada cara del dado.
- Cada turno: se lanza **un único dado, una sola vez**.
- Si la posición obtenida está destapada, se tapa. Si ya estaba tapada, se destapa.
- El turno termina de inmediato tras ese lanzamiento, sin importar el resultado.
- Gana al instante quien consiga tener las 6 posiciones tapadas a la vez al
  finalizar su turno.

### Decisiones tomadas donde las reglas no eran explícitas

| Punto | Decisión |
|---|---|
| Jugadores máximo | Fijado en 6 por regla explícita ("de 2 a 6 jugadores"). |
| Apuesta | Sin jugada de castigo prevista en las reglas, se ofrece solo apuesta/CASE opcional (como en Rummy y ¿Por qué siempre yo?): el ganador se lleva el bote formado por la apuesta de todos. |
| Desconexión y abandono | Ver [Salas y conexión](#salas-y-conexión). |

## Salas y conexión

Reglas comunes de GameCenter (`core/room-kit.js`):

- **Identidad:** toda acción exige el token secreto que recibe cada jugador al
  crear o unirse a la sala; el identificador público no basta.
- **Sala de espera:** quien se desconecta (recarga, corte de red) conserva su
  asiento 15 s. Quien se une y no llega a conectarse sale a los 20 s.
- **Primer turno:** se sortea al empezar cada partida.
- **Turno inactivo:** si el jugador de turno está conectado y pasa 45 s sin hacer
  nada, pierde el turno ("X no jugó en 45 s").
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
| `engine.js` | Reglas puras: dado, tablero. |
| `board.js` | Las 6 casillas del tablero (valor, posición en la rejilla, color). Compartido servidor/navegador. |
| `game.html` | Interfaz del juego (pantallas, tablero de madera, paneles). |
| `game.css` | Estilos nuevos: pantallas, formularios, modales, avisos, animaciones. |
| `game.js` | Cliente: render, animaciones y sonido sintetizado con WebAudio. |
| `styles.css` | Layout base, paneles, dado, tablero. |
| `RULES.md` | Especificación original del juego. |

## Notas técnicas

- Transporte: `EventSource` (SSE) del servidor al cliente y `POST /api/*` del
  cliente al servidor. Sin WebSockets; el router usa Express.
- El dado se genera en el servidor con `crypto.randomInt`; el cliente solo
  anima el resultado.
- Todos los sonidos se sintetizan en el navegador con WebAudio: no hay archivos
  de audio. El navegador exige un gesto del usuario antes de sonar.
- Las salas viven en memoria: al reiniciar el servidor se pierden.
