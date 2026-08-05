/* ============================================================
   BENDITO SIETE — definicion del tablero (10 numeros)
   Compartido por el servidor (CommonJS) y el navegador (window).
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SieteBoard = api;
})(typeof self !== 'undefined' ? self : this, function () {

  /* v = numero · row/col = posicion en la rejilla 2x5 · color = acento visual */
  const NUMBERS = [
    { v: 2,  row: 0, col: 0, color: 'orange' },
    { v: 3,  row: 0, col: 1, color: 'gold' },
    { v: 4,  row: 0, col: 2, color: 'red' },
    { v: 5,  row: 0, col: 3, color: 'green' },
    { v: 6,  row: 0, col: 4, color: 'blue' },
    { v: 8,  row: 1, col: 0, color: 'green' },
    { v: 9,  row: 1, col: 1, color: 'blue' },
    { v: 10, row: 1, col: 2, color: 'red' },
    { v: 11, row: 1, col: 3, color: 'gold' },
    { v: 12, row: 1, col: 4, color: 'orange' }
  ];

  const TOTAL = NUMBERS.length; /* 10 */

  function newBoard() {
    const b = {};
    for (const n of NUMBERS) b[n.v] = false;
    return b;
  }

  function boardFilled(board) {
    let n = 0;
    for (const num of NUMBERS) if (board[num.v]) n++;
    return n;
  }

  function boardComplete(board) {
    return boardFilled(board) >= TOTAL;
  }

  return { NUMBERS, TOTAL, newBoard, boardFilled, boardComplete };
});
