# Bendito Siete — juego multijugador

Juego de dados para 2 o más jugadores basado en `RULES.md`, con el tablero
inspirado en `BOARD.png`. Arquitectura calcada de `CUCARACHA_II`.

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
   lances consecutivos por turno.
2. Se genera un **código de 4 letras**. Los demás jugadores entran con ese código
   desde otro dispositivo o pestaña de la misma red.
3. El anfitrión pulsa **Iniciar partida** (mínimo 2 jugadores).

Para probar en solitario, abrir varias pestañas: cada pestaña es un jugador
distinto (la sesión se guarda en `sessionStorage`).

## Reglas implementadas

- Tablero de 10 números por jugador: 2·3·4·5·6·8·9·10·11·12. El 7 no aparece.
- Cada turno: lanzas 2 dados y sumas su valor.
- Suma destapada → se tapa y, si quedan lances, se vuelve a lanzar.
- Suma ya tapada → el turno termina y ese número pasa al siguiente jugador,
  quien lo tapa en su propio tablero.
- Suma 7 → el turno termina de inmediato, sin tapar nada.
- El turno también termina al agotar los lances consecutivos configurados.
- Al tapar los 10 números entra la **fase final**: un único lanzamiento, sin
  límite de lances. Si suma 7, gana la partida; si no, pierde la oportunidad
  y el turno pasa al siguiente jugador (conservando su tablero completo).

### Decisiones tomadas donde las reglas no eran explícitas

| Punto | Decisión |
|---|---|
| Fase final permanente | Una vez completado el tablero, **todos** los turnos futuros de ese jugador son de fase final (un lanzamiento, solo gana con 7), ya que no quedan números por tapar. |
| Número pasado ya tapado también en el receptor | Si el jugador siguiente también lo tiene tapado (o ya completó su tablero), simplemente no se tapa nada y el turno pasa igual. |
| Jugadores máximo | Las reglas no fijan un tope; se limita a 8 por diseño de la sala (código de 4 letras, paleta de avatares). |
| Lances consecutivos | Se configura al crear la sala (mínimo 1, máximo 10), igual que la apuesta/multa en Cucaracha. |
| Desconexión | El jugador se marca como desconectado; si le toca el turno y lleva 25 s sin conexión, se salta. |

## Archivos

| Archivo | Rol |
|---|---|
| `server.js` | Servidor HTTP + SSE, salas y turnos. Estado autoritativo. |
| `engine.js` | Reglas puras: dados, tablero. |
| `board.js` | Las 10 casillas del tablero (valor, posición en la rejilla, color). Compartido servidor/navegador. |
| `game.html` | Interfaz del juego (pantallas, tablero de madera, paneles). |
| `game.css` | Estilos nuevos: pantallas, formularios, modales, avisos, animaciones. |
| `game.js` | Cliente: render, animaciones y sonido sintetizado con WebAudio. |
| `styles.css` | Layout base, paneles, dados, tablero. |
| `RULES.md`, `BOARD.png` | Especificación original del juego. |

## Notas técnicas

- Transporte: `EventSource` (SSE) del servidor al cliente y `POST /api/*` del
  cliente al servidor. Sin WebSockets ni dependencias.
- Los dados se generan en el servidor con `crypto.randomInt`; el cliente solo
  anima el resultado.
- Todos los sonidos se sintetizan en el navegador con WebAudio: no hay archivos
  de audio. El navegador exige un gesto del usuario antes de sonar.
- Las salas viven en memoria: al reiniciar el servidor se pierden.
