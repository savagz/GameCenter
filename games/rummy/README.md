# Rummikub II

Juego de Rummikub multijugador online (2-4 jugadores) con tablero realista, fichas 3D, drag & drop y soporte táctil. Reglas completas en [RULES.md](RULES.md).

## Stack

- **Cliente:** React 18 + Vite. Drag & drop propio basado en Pointer Events (mouse y touch).
- **Servidor:** Node.js + Express + Socket.IO. Servidor autoritativo: valida todas las jugadas.

## Ejecutar

```bash
npm install

# Desarrollo (servidor :3001 + Vite :5173 con proxy websocket)
npm run dev
# Abrir http://localhost:5173

# Producción (build + un solo servidor)
npm run build
npm start
# Abrir http://localhost:3001
```

Para jugar desde otros dispositivos en la misma red, abre `http://<IP-local>:5173` (dev) o `:3001` (prod).

## Cómo se juega

1. Un jugador crea sala y comparte el código de 4 letras.
2. Se unen hasta 4 jugadores; el anfitrión inicia la partida.
3. Cada uno recibe 14 fichas. En tu turno:
   - Arrastra fichas del atril a la mesa para formar **grupos** (mismo número, colores distintos) o **escaleras** (números consecutivos, mismo color).
   - **Primera bajada:** mínimo 30 puntos usando solo fichas de tu mano.
   - Después puedes reorganizar la mesa libremente; al terminar el turno toda la mesa debe ser válida.
   - Si no juegas, pulsa **Robar** para tomar ficha y pasar.
4. Gana quien se queda sin fichas. Si se agota el pozo, gana la menor puntuación.

El servidor valida cada jugada (conservación de fichas, combinaciones, primera bajada, comodines). Turnos con límite de 2 minutos; al agotarse se roba automáticamente.

## Estructura

```
server/
  index.js    Salas, turnos, timer, Socket.IO
  game.js     Motor de reglas (mazo, validación de melds y turnos, puntajes)
src/
  App.jsx     Lobby / sala de espera / fin de partida
  components/
    Lobby.jsx Crear o unirse a sala
    Game.jsx  Tablero, atril, drag & drop, acciones de turno
    Tile.jsx  Ficha 3D
  styles.css  Mesa de fieltro, atril de madera, fichas marfil, animaciones
```
