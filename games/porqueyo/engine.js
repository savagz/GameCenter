/* ============================================================
   ¿POR QUÉ SIEMPRE YO? — motor de reglas (autoritativo, corre en el servidor)
   Implementa RULES.md
   ============================================================ */

const crypto = require('crypto');
const { ZONES, BLACK, FACES, BY_ID, newBoard } = require('./zones.js');

const rollFace = () => FACES[crypto.randomInt(0, FACES.length)];

/*
   Resuelve sobre el tablero COMPARTIDO el color obtenido en el dado.
   El tablero es unico para toda la sala: las zonas no pertenecen a
   ningun jugador, son un fondo comun (RULES.md seccion 18).

   - negro:  la canica del jugador desaparece. El tablero no cambia.
   - color con hueco libre: el jugador coloca 1 canica (la zona sube 1).
   - color con la zona llena: el jugador se lleva TODAS las canicas
     acumuladas en esa zona; la zona queda vacia (RULES.md 9-12).
*/
function resolveRoll(board, face) {
  if (face === BLACK.id) {
    return { type: 'black', color: BLACK.id, board };
  }

  const zone = BY_ID[face];
  const filled = board[face] || 0;

  if (filled < zone.cap) {
    const next = Object.assign({}, board, { [face]: filled + 1 });
    return { type: 'place', color: face, board: next, filledAfter: filled + 1, cap: zone.cap };
  }

  const next = Object.assign({}, board, { [face]: 0 });
  return { type: 'steal', color: face, board: next, stolen: filled, cap: zone.cap };
}

module.exports = { BY_ID, newBoard, rollFace, resolveRoll };
