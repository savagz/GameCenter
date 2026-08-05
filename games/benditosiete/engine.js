/* ============================================================
   BENDITO SIETE — motor de reglas puras (autoritativo, servidor)
   Implementa RULES.md
   ============================================================ */

const crypto = require('crypto');
const { NUMBERS, TOTAL, newBoard, boardFilled, boardComplete } = require('./board.js');

const DICE_COUNT = 2;
const SEVEN = 7;

const rollDie = () => crypto.randomInt(1, 7);
const rollDice = () => [rollDie(), rollDie()];
const sumDice = (dice) => dice[0] + dice[1];

module.exports = {
  DICE_COUNT,
  SEVEN,
  TOTAL,
  NUMBERS,
  newBoard,
  boardFilled,
  boardComplete,
  rollDice,
  sumDice
};
