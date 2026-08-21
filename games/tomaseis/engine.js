/* ============================================================
   TOMA 6 — motor de reglas puras (autoritativo, servidor)
   Implementa RULES.md: mazo de 104 cartas, valor en estrellas,
   4 filas, colocación por vecino inferior más cercano, regla de
   las 5 cartas ("TOMA 6") y elección manual de fila.
   ============================================================ */

const HAND_SIZE = 10;
const ROWS = 4;
const ROW_LIMIT = 5;

function starValue(num) {
  if (num === 55) return 7;
  if (num % 11 === 0) return 5; /* 11,22,33,44,66,77,88,99 (55 ya cubierto arriba) */
  if (num % 10 === 0) return 3;
  if (num % 5 === 0) return 2;
  return 1;
}

function createDeck() {
  const cards = [];
  for (let n = 1; n <= 104; n++) cards.push({ id: 'c' + n, num: n, stars: starValue(n) });
  return shuffle(cards);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* reparte manos de 10 cartas y arma las 4 filas iniciales a partir del
   mismo mazo barajado (104 cartas alcanzan exacto para 10 jugadores) */
function dealGame(playerCount) {
  const deck = createDeck();
  const hands = [];
  for (let i = 0; i < playerCount; i++) {
    hands.push(deck.splice(0, HAND_SIZE).sort((a, b) => a.num - b.num));
  }
  const rows = [];
  for (let i = 0; i < ROWS; i++) rows.push([deck.splice(0, 1)[0]]);
  return { hands, rows };
}

function rowStars(row) {
  return row.reduce((s, c) => s + c.stars, 0);
}

/* determina qué le pasa a una carta jugada frente al estado actual de las filas.
   - needChoice: la carta es menor que el final de las 4 filas (regla 8)
   - take: la fila destino ya tiene 5 cartas (regla 7, TOMA 6)
   - append: se coloca normalmente al final de la fila destino */
function placeCard(rows, card) {
  let bestIdx = -1;
  let bestLast = -1;
  rows.forEach((row, i) => {
    const last = row[row.length - 1];
    if (last.num < card.num && last.num > bestLast) { bestLast = last.num; bestIdx = i; }
  });
  if (bestIdx === -1) return { type: 'needChoice' };
  if (rows[bestIdx].length >= ROW_LIMIT) return { type: 'take', rowIndex: bestIdx };
  return { type: 'append', rowIndex: bestIdx };
}

module.exports = {
  HAND_SIZE, ROWS, ROW_LIMIT,
  starValue, createDeck, shuffle, dealGame, rowStars, placeCard
};
