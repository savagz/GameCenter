/* ============================================================
   TAPADOS — definicion del tablero (6 posiciones)
   Compartido por el servidor (CommonJS) y el navegador (window).
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TapadosBoard = api;
})(typeof self !== 'undefined' ? self : this, function () {

  /* v = numero (cara del dado) · row/col = posicion en la rejilla 2x3 · color = acento visual */
  const NUMBERS = [
    { v: 1, row: 0, col: 0, color: 'orange' },
    { v: 2, row: 0, col: 1, color: 'gold' },
    { v: 3, row: 0, col: 2, color: 'red' },
    { v: 4, row: 1, col: 0, color: 'green' },
    { v: 5, row: 1, col: 1, color: 'blue' },
    { v: 6, row: 1, col: 2, color: 'purple' }
  ];

  const TOTAL = NUMBERS.length; /* 6 */

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
