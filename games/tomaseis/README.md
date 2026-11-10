# Toma 6 — juego multijugador

Juego de cartas para 2 a 10 jugadores basado en `RULES.md`, con el tablero
de filas inspirado visualmente en el de `RUMMY` (misma mesa de fieltro,
mismo estilo de carta con acabado 3D).

## Ejecutar

El juego forma parte de GameCenter. Desde la raíz del proyecto:

```bash
npm install
npm start
# Lobby:  http://localhost:3000/
# Juego:  http://localhost:3000/games/tomaseis/
```

Variable opcional: `PORT` (por defecto 3000). Requiere Node 18 o superior.

También existe un modo independiente (`node games/tomaseis/server.js`), pero no
sirve los recursos compartidos de `/shared` (estilos de las pantallas de inicio
y sala, banner de turno), así que se recomienda arrancarlo desde GameCenter.

## Jugar

1. Quien crea la sala define **jugadores máximos** (2-10). Con la apuesta de
   GameCenter activa, cada jugador paga la entrada al empezar.
2. Se genera un **código de 4 letras**. Los demás jugadores entran con ese
   código.
3. El anfitrión pulsa **Comenzar partida** (mínimo 2 jugadores).

Para probar en solitario, abrir varias pestañas: cada pestaña es un jugador
distinto (la sesión se guarda en `sessionStorage`).

## Reglas implementadas (ver `RULES.md`)

- Mazo de 104 cartas repartido en manos de 10 + 4 cartas iniciales para las
  4 filas (10 jugadores × 10 cartas + 4 = 104, el máximo exacto).
- Valor en estrellas: normales = 1, terminadas en 5 = 2, terminadas en 0 = 3,
  dobles (11…99) = 5, el 55 = 7.
- Cada ronda, todos eligen una carta a la vez **sin verse entre sí**; al
  elegir todos, se revelan y se resuelven de menor a mayor.
- Colocación automática en la fila cuyo final sea el valor inmediatamente
  inferior más cercano.
- Regla de las 5 cartas (**TOMA 6**): si la fila destino ya tiene 5 cartas,
  el jugador se las lleva, suma sus estrellas y su carta abre una fila nueva.
- Si la carta es menor que el final de las 4 filas, el jugador **elige** qué
  fila se lleva completa (con reloj y elección automática si se agota el tiempo).
- 10 rondas por partida (una por cada carta de la mano). Gana quien termine
  con **menos estrellas**. Si hay empate a estrellas, gana quien se haya
  llevado **menos cartas**; si también empatan en cartas, la partida termina
  en **empate** y el bote se reparte a partes iguales.

### Decisiones tomadas donde las reglas no eran explícitas

| Punto | Decisión |
|---|---|
| Jugadores máximo | 10, porque 104 cartas solo alcanzan exacto para 10 jugadores × 10 cartas + 4 de las filas. |
| Tiempo para elegir carta | 45 s por ronda, con cuenta atrás visible. Quien no elige a tiempo juega automáticamente su carta más baja. |
| Tiempo para elegir fila | 20 s. Si se agota, se toma la fila más barata: menos estrellas; si empatan, menos cartas; si siguen empatadas, la primera. |
| Apuesta | Apuesta/CASE opcional como en Rummy: cada jugador paga la entrada al empezar y el ganador se lleva el bote. En caso de empate el bote se reparte entre los empatados. |
| Desempate | Menos estrellas; después, menos cartas recogidas; si persiste, empate. |
| Desconexión y abandono | Ver [Salas y conexión](#salas-y-conexión). |

## Salas y conexión

Reglas comunes de GameCenter (`core/room-kit.js`):

- **Identidad:** toda acción exige el token secreto que recibe cada jugador al
  crear o unirse a la sala; el identificador público no basta.
- **Sala de espera:** quien se desconecta (recarga, corte de red) conserva su
  asiento 15 s. Quien se une y no llega a conectarse sale a los 20 s.
- **Relojes:** 45 s para elegir carta y 20 s para elegir fila; al agotarse se juega
  automáticamente (ver la tabla de decisiones).
- **Desconexión en partida:** su carta o su fila se resuelven con el reloj, igual
  que si estuviera conectado.
- **Salir de la partida:** quien pulsa Salir queda fuera de los turnos, de los
  cobros y de las revanchas, y ya no puede volver a esa partida.
  Si abandona a mitad de ronda, su carta o su fila se resuelven al momento.
  Si solo queda un jugador, gana por abandono y se lleva el bote.
- **Anfitrión:** si abandona, o lleva 10 s desconectado durante la partida, el
  rol pasa al primer jugador conectado.
- **Revancha:** solo con los jugadores conectados (mínimo 2); quien abandonó o
  está desconectado sale de la sala y no paga la nueva entrada.

## Archivos

| Archivo | Rol |
|---|---|
| `server.js` | Servidor HTTP + SSE, salas, elección simultánea y resolución de rondas. Estado autoritativo. |
| `engine.js` | Reglas puras: mazo, valor en estrellas, reparto, colocación en filas. |
| `game.html` | Interfaz del juego (pantallas, mesa, mano, modal de elegir fila). |
| `game.css` | Mesa de fieltro y cartas con el mismo lenguaje visual que Rummy. |
| `game.js` | Cliente: render, animaciones y sonido sintetizado con WebAudio. |
| `RULES.md` | Especificación original del juego. |

## Notas técnicas

- Transporte: `EventSource` (SSE) del servidor al cliente y `POST /api/*` del
  cliente al servidor. Sin WebSockets; el router usa Express.
- El mazo se baraja en el servidor con `Math.random`; el cliente solo pinta
  el estado recibido.
- Todos los sonidos se sintetizan en el navegador con WebAudio: no hay
  archivos de audio.
- Las salas viven en memoria: al reiniciar el servidor se pierden.
