# Tapados — juego multijugador

Juego de dados para 2 a 6 jugadores basado en `RULES.md`, con el tablero
inspirado en el de `BENDITO SIETE`. Arquitectura calcada de `CUCARACHA_II`.

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
| Desconexión | El jugador se marca como desconectado; si le toca el turno y lleva 25 s sin conexión, se salta. |

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
  cliente al servidor. Sin WebSockets ni dependencias.
- El dado se genera en el servidor con `crypto.randomInt`; el cliente solo
  anima el resultado.
- Todos los sonidos se sintetizan en el navegador con WebAudio: no hay archivos
  de audio. El navegador exige un gesto del usuario antes de sonar.
- Las salas viven en memoria: al reiniciar el servidor se pierden.
