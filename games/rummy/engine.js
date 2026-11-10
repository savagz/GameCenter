/* ============================================================
   RUMMY — motor de reglas puras (autoritativo, servidor)
   Implementa RULES.md: grupos, escaleras, bajada inicial >= 30 pts,
   comodines, reordenamiento del tablero con validez total.
   ============================================================ */

const COLORS = ['red', 'blue', 'yellow', 'black'];

function createDeck() {
  const tiles = [];
  let id = 0;
  for (let set = 0; set < 2; set++) {
    for (const color of COLORS) {
      for (let num = 1; num <= 13; num++) {
        tiles.push({ id: 't' + id++, num, color, joker: false });
      }
    }
  }
  tiles.push({ id: 't' + id++, num: 0, color: 'joker', joker: true });
  tiles.push({ id: 't' + id++, num: 0, color: 'joker', joker: true });
  return shuffle(tiles);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Valida una combinacion (array de fichas).
 * Devuelve { valid: boolean, points: number }.
 * Los comodines cuentan como la ficha que representan (colocacion mas favorable).
 */
function validateMeld(tiles) {
  if (!Array.isArray(tiles) || tiles.length < 3) return { valid: false, points: 0 };
  const jokers = tiles.filter((t) => t.joker).length;
  const rest = tiles.filter((t) => !t.joker);
  if (rest.length === 0) return { valid: false, points: 0 };

  let best = null;

  /* GRUPO: mismo numero, colores distintos, 3-4 fichas */
  if (tiles.length <= 4) {
    const nums = new Set(rest.map((t) => t.num));
    const cols = new Set(rest.map((t) => t.color));
    if (nums.size === 1 && cols.size === rest.length) {
      best = { valid: true, points: rest[0].num * tiles.length };
    }
  }

  /* ESCALERA: mismo color, numeros consecutivos, comodines rellenan huecos/extienden puntas */
  const cols = new Set(rest.map((t) => t.color));
  if (cols.size === 1) {
    const nums = [...new Set(rest.map((t) => t.num))].sort((a, b) => a - b);
    if (nums.length === rest.length) {
      const min = nums[0];
      const max = nums[nums.length - 1];
      const gaps = max - min + 1 - nums.length;
      if (gaps >= 0 && gaps <= jokers) {
        const extra = jokers - gaps;
        const hi = Math.min(13, max + extra);
        const lo = min - (extra - (hi - max));
        if (lo >= 1) {
          const points = ((hi + lo) * (hi - lo + 1)) / 2;
          if (!best || points > best.points) best = { valid: true, points };
        }
      }
    }
  }

  return best || { valid: false, points: 0 };
}

/**
 * Valida una jugada de fin de turno.
 * @param {Object} params
 *  - oldBoard: melds (arrays de fichas) antes del turno
 *  - oldHand: mano del jugador antes del turno
 *  - newBoard: melds propuestos
 *  - newHand: mano restante propuesta
 *  - hasMelded: si el jugador ya hizo su bajada inicial de 30 pts
 * Devuelve { ok, error?, placedIds?, meldedNow? }
 */
function validateTurn({ oldBoard, oldHand, newBoard, newHand, hasMelded }) {
  const oldBoardIds = oldBoard.flat().map((t) => t.id);
  const oldHandIds = oldHand.map((t) => t.id);
  const newBoardIds = newBoard.flat().map((t) => t.id);
  const newHandIds = newHand.map((t) => t.id);

  if (new Set(newBoardIds).size !== newBoardIds.length) return { ok: false, error: 'Fichas duplicadas en la mesa.' };
  if (new Set(newHandIds).size !== newHandIds.length) return { ok: false, error: 'Fichas duplicadas en la mano.' };

  const oldHandSet = new Set(oldHandIds);
  if (!newHandIds.every((id) => oldHandSet.has(id))) return { ok: false, error: 'Fichas desconocidas en la mano.' };

  const before = [...oldBoardIds, ...oldHandIds].sort().join(',');
  const after = [...newBoardIds, ...newHandIds].sort().join(',');
  if (before !== after) return { ok: false, error: 'Las fichas no cuadran: no se pueden quitar fichas de la mesa.' };

  const newHandSet = new Set(newHandIds);
  const placedIds = oldHandIds.filter((id) => !newHandSet.has(id));
  if (placedIds.length === 0) return { ok: false, error: 'No colocaste ninguna ficha. Roba una para pasar.' };

  for (const meld of newBoard) {
    const v = validateMeld(meld);
    if (!v.valid) {
      return { ok: false, error: 'Combinación inválida en la mesa: ' + meldLabel(meld) };
    }
  }

  /* primera bajada: solo melds nuevos hechos con fichas propias, >= 30 pts, melds existentes intactos */
  if (!hasMelded) {
    const placedSet = new Set(placedIds);
    const oldKeys = oldBoard.map((m) => m.map((t) => t.id).sort().join(','));
    let points = 0;
    for (const meld of newBoard) {
      const key = meld.map((t) => t.id).sort().join(',');
      const idx = oldKeys.indexOf(key);
      if (idx >= 0) {
        oldKeys.splice(idx, 1);
        continue;
      }
      if (!meld.every((t) => placedSet.has(t.id))) {
        return { ok: false, error: 'Primera bajada: solo puedes usar fichas de tu mano (mínimo 30 puntos).' };
      }
      points += validateMeld(meld).points;
    }
    if (points < 30) {
      return { ok: false, error: `Primera bajada insuficiente: ${points} puntos (mínimo 30).` };
    }
  }

  return { ok: true, placedIds, meldedNow: !hasMelded };
}

function handPoints(hand) {
  return hand.reduce((s, t) => s + (t.joker ? 30 : t.num), 0);
}

function meldLabel(meld) {
  const names = { red: 'R', blue: 'A', yellow: 'M', black: 'N', joker: '★' };
  return meld.map((t) => (t.joker ? '★' : t.num + names[t.color])).join('-');
}

module.exports = {
  createDeck,
  validateTurn,
  handPoints
};
