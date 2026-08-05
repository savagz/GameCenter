/* ============================================================
   CUCARACHA — motor de reglas (autoritativo, corre en el servidor)
   Implementa RULES.md
   ============================================================ */

const crypto = require('crypto');
const { SLOTS, TOTAL, FINAL_SLOT, BY_ID } = require('./slots.js');

const DICE_COUNT = 5;

/* ---------- utilidades ---------- */

const rollDie = () => crypto.randomInt(1, 7);
const rollDice = (n) => Array.from({ length: n }, rollDie);

function countBy(dice) {
  const c = {};
  for (const d of dice) c[d] = (c[d] || 0) + 1;
  return c;
}

/* ---------- analisis de un lanzamiento ---------- */
/*
   ones      -> dados con valor 1 (exitos)
   fiveKind  -> los cinco dados con el mismo valor  => victoria inmediata
   fourKind  -> cuatro dados iguales distintos de 1
                 .withOne  true  => los demas pagan castigo al jugador
                 .withOne  false => todos pagan castigo al pozo
*/
function analyzeRoll(dice) {
  const counts = countBy(dice);
  const ones = counts[1] || 0;

  const fiveKind =
    dice.length === DICE_COUNT && Object.keys(counts).length === 1
      ? { value: dice[0] }
      : null;

  let fourKind = null;
  if (!fiveKind && dice.length >= 4) {
    for (const [val, n] of Object.entries(counts)) {
      if (Number(val) !== 1 && n === 4) {
        fourKind = { value: Number(val), withOne: ones > 0 };
        break;
      }
    }
  }

  return { ones, fiveKind, fourKind };
}

/* ---------- tablero ---------- */

function newBoard() {
  return {};
}

function boardFilled(board) {
  return Object.keys(board).length;
}

/*
   Posiciones que el jugador puede completar ahora mismo.
   - el valor de la posicion no puede superar los unos disponibles
   - la posicion de valor 3 (cola) solo se habilita cuando las otras 23 estan completas
*/
function placeableSlots(board, pending) {
  const filled = boardFilled(board);
  return SLOTS.filter((s) => {
    if (board[s.id]) return false;
    if (s.v > pending) return false;
    if (s.id === FINAL_SLOT && filled < TOTAL - 1) return false;
    return true;
  }).map((s) => s.id);
}

function canPlaceAnything(board, pending) {
  return pending > 0 && placeableSlots(board, pending).length > 0;
}

module.exports = {
  DICE_COUNT,
  TOTAL,
  FINAL_SLOT,
  BY_ID,
  SLOTS,
  rollDice,
  analyzeRoll,
  newBoard,
  boardFilled,
  placeableSlots,
  canPlaceAnything
};
