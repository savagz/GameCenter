/* ============================================================
   TAPADOS — motor de reglas puras (autoritativo, servidor)
   Implementa RULES.md
   ============================================================ */

const crypto = require('crypto');
const { TOTAL, newBoard, boardFilled, boardComplete } = require('./board.js');

const rollDie = () => crypto.randomInt(1, 7);

module.exports = {
  TOTAL,
  newBoard,
  boardFilled,
  boardComplete,
  rollDie
};
