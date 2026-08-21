# Toma 6 — juego multijugador

Juego de cartas para 2 a 10 jugadores basado en `RULES.md`, con el tablero
de filas inspirado visualmente en el de `RUMMY` (misma mesa de fieltro,
mismo estilo de carta con acabado 3D).

## Ejecutar

```bash
node server.js
```

Luego abrir <http://localhost:3000>.

Un solo proceso sirve el frontend y gestiona el tiempo real. No hay dependencias
externas ni `npm install`. Requiere Node 18 o superior.

Variable opcional: `PORT` (por defecto 3000).

## Jugar

1. Quien crea la sala define **jugadores máximos** (2-10) y el **tiempo por
   ronda**.
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
  fila se lleva completa (con reloj y elección automática de reserva si se
  agota el tiempo).
- 10 rondas por partida (una por cada carta de la mano). Gana quien termine
  con **menos estrellas**.

### Decisiones tomadas donde las reglas no eran explícitas

| Punto | Decisión |
|---|---|
| Jugadores máximo | 10, porque 104 cartas solo alcanzan exacto para 10 jugadores × 10 cartas + 4 de las filas. |
| Tiempo por ronda | Configurable (45/30/15s) igual que Rummy; si alguien no elige a tiempo, se juega automáticamente su carta más baja. |
| Elegir fila sin responder | Se toma automáticamente la fila con menos estrellas (la más barata para el jugador). |
| Apuesta | Apuesta/CASE opcional como en Rummy: el ganador se lleva el bote de todos. |
| Desconexión | El jugador se marca desconectado; su carta o fila se auto-resuelve por el reloj igual que si estuviera conectado. |

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
  cliente al servidor. Sin WebSockets ni dependencias.
- El mazo se baraja en el servidor con `Math.random`; el cliente solo pinta
  el estado recibido.
- Todos los sonidos se sintetizan en el navegador con WebAudio: no hay
  archivos de audio.
- Las salas viven en memoria: al reiniciar el servidor se pierden.
