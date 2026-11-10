# Cucaracha — juego multijugador

Juego de dados para 2 a 6 jugadores basado en `RULES.md`, con el tablero descrito en
`BOARD.md`, `BOARD_DESIGN.md` y `CUCARACHA.md`.

## Ejecutar

El juego forma parte de GameCenter. Desde la raíz del proyecto:

```bash
npm install
npm start
# Lobby:  http://localhost:3000/
# Juego:  http://localhost:3000/games/cucaracha/
```

Variable opcional: `PORT` (por defecto 3000). Requiere Node 18 o superior.

También existe un modo independiente (`node games/cucaracha/server.js`), pero no
sirve los recursos compartidos de `/shared` (estilos de las pantallas de inicio
y sala, banner de turno), así que se recomienda arrancarlo desde GameCenter.

## Jugar

1. Quien crea la sala define la **configuración inicial**: jugadores máximos y,
   si activa **Jugar con apuesta y multa**, el importe de la apuesta y de la multa.
   Sin apuestas se juega igual, pero no hay pozo ni pagos.
2. Se genera un **código de 4 letras**. Los demás jugadores entran con ese código
   desde otro dispositivo o pestaña de la misma red.
3. El anfitrión pulsa **Iniciar partida** (mínimo 2 jugadores).

Para probar en solitario, abrir varias pestañas: cada pestaña es un jugador
distinto (la sesión se guarda en `sessionStorage`).

Si el servidor no está en la misma máquina, los demás entran por la IP local del
anfitrión, por ejemplo `http://192.168.1.20:3000`.

## Reglas implementadas

- 5 dados. Cada **1** es un acierto y se aparta; se relanzan solo los restantes.
- El turno termina cuando un lanzamiento no da ningún 1. **No hay límite de lanzamientos.**
- Los aciertos se gastan en el tablero: 1 acierto → casilla de valor 1,
  2 aciertos → casilla de valor 2, 3 aciertos → la cola.
- La casilla de valor **3** solo se habilita con las otras 23 completas.
- Sin ningún 1 en el **primer** lanzamiento: el jugador paga la multa al pozo.
- Cinco 1 acumulados en los **dos primeros** lanzamientos: los demás le pagan la multa.
- **Cuatro iguales** (distintos de 1) con un 1: los demás le pagan.
  Sin un 1: todos pagan al pozo.
- Gana quien completa las 24 posiciones o saca los **cinco dados iguales** en un
  mismo lanzamiento. El ganador se lleva el pozo.

### Decisiones tomadas donde las reglas no eran explícitas

| Punto | Decisión |
|---|---|
| Cinco dados iguales | Solo cuenta en un lanzamiento de 5 dados (el primero del turno). Cinco 1 repartidos entre dos lanzamientos aplican el pago del caso 2, no la victoria. |
| Cinco 1 en el primer lanzamiento | Cumple las dos reglas: los demás le pagan la multa y después gana la partida. |
| Los cinco dados apartados | Si se apartan los cinco dados (todos en 1), no se vuelven a lanzar: el jugador coloca sus aciertos y el turno termina. |
| Cuatro iguales | Se evalúa en lanzamientos de 4 o más dados. Con 4 dados y ninguno igual a 1, se aplica el caso "todos pagan al pozo". |
| Aciertos sin gastar | Se acumulan durante el turno (puedes guardar un 1 para formar un 2), pero se pierden al terminarlo. Si un lanzamiento no da ningún 1 y aún puedes colocar fichas, el turno espera a que las coloques o pulses **Terminar turno**. |
| Apuesta inicial | Cada jugador la aporta al pozo al empezar la partida. |
| Pozo | Se lo lleva íntegro el ganador. |
| Saldo | No hay capital inicial. El saldo de cada jugador es un contador de ganancias y pérdidas de la partida: empieza en 0 y puede ser negativo, porque los pagos se cobran completos. |
| Sin apuestas | La apuesta y la multa valen 0: no hay pozo, los eventos no muestran importes y no hay avisos de multa. |
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
| `engine.js` | Reglas puras: dados, análisis de lanzamiento, validación de posiciones. |
| `slots.js` | Las 24 posiciones (id, valor, coordenadas). Compartido servidor/navegador. |
| `game.html` | Interfaz del juego (pantallas, tablero SVG, paneles). |
| `game.css` | Estilos nuevos: pantallas, formularios, modales, avisos, animaciones. |
| `game.js` | Cliente: render, animaciones y sonido sintetizado con WebAudio. |
| `styles.css` | Variables de tema y estilos base del diseño de madera original. |

## Notas técnicas

- Transporte: `EventSource` (SSE) del servidor al cliente y `POST /api/*` del
  cliente al servidor. Sin WebSockets; el router usa Express.
- Los dados se generan en el servidor con `crypto.randomInt`; el cliente solo
  anima el resultado.
- Todos los sonidos se sintetizan en el navegador con WebAudio: no hay archivos
  de audio. El navegador exige un gesto del usuario antes de sonar.
- Las salas viven en memoria: al reiniciar el servidor se pierden.
