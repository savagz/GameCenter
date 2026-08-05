# Cucaracha — juego multijugador

Juego de dados para 2 a 6 jugadores basado en `RULES.md`, con el tablero descrito en
`BOARD.md`, `BOARD_DESIGN.md` y `CUCARACHA.md`.

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

1. Quien crea la sala define la **configuración inicial**: jugadores máximos,
   capital inicial, apuesta y multa.
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
| Cuatro iguales | Se evalúa en lanzamientos de 4 o más dados. Con 4 dados y ninguno igual a 1, se aplica el caso "todos pagan al pozo". |
| Aciertos sin gastar | Se acumulan durante el turno (puedes guardar un 1 para formar un 2), pero se pierden al terminarlo. |
| Apuesta inicial | Cada jugador la aporta al pozo al empezar la partida. |
| Pozo | Se lo lleva íntegro el ganador. |
| Créditos insuficientes | Se paga lo que haya; los créditos nunca bajan de 0. |
| Desconexión | El jugador se marca como desconectado; si le toca el turno y lleva 25 s sin conexión, se salta. |

## Archivos

| Archivo | Rol |
|---|---|
| `server.js` | Servidor HTTP + SSE, salas y turnos. Estado autoritativo. |
| `engine.js` | Reglas puras: dados, análisis de lanzamiento, validación de posiciones. |
| `slots.js` | Las 24 posiciones (id, valor, coordenadas). Compartido servidor/navegador. |
| `game.html` | Interfaz del juego (pantallas, tablero SVG, paneles). |
| `game.css` | Estilos nuevos: pantallas, formularios, modales, avisos, animaciones. |
| `game.js` | Cliente: render, animaciones y sonido sintetizado con WebAudio. |
| `index.html`, `styles.css` | Mock de diseño original, **sin modificar**. Visible en `/index.html`. |

## Notas técnicas

- Transporte: `EventSource` (SSE) del servidor al cliente y `POST /api/*` del
  cliente al servidor. Sin WebSockets ni dependencias.
- Los dados se generan en el servidor con `crypto.randomInt`; el cliente solo
  anima el resultado.
- Todos los sonidos se sintetizan en el navegador con WebAudio: no hay archivos
  de audio. El navegador exige un gesto del usuario antes de sonar.
- Las salas viven en memoria: al reiniciar el servidor se pierden.
