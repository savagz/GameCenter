/* ============================================================
   ¿POR QUÉ SIEMPRE YO? — definicion de las zonas del tablero
   Compartido por el servidor (CommonJS) y el navegador (window).
   Ver RULES.md seccion 3.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PorqueyoZones = api;
})(typeof self !== 'undefined' ? self : this, function () {

  /* orden horario en el tablero, blanca centrada arriba */
  const ZONES = [
    { id: 'white',  label: 'Blanca',   short: 'BLANCO',   cap: 1 },
    { id: 'yellow', label: 'Amarilla', short: 'AMARILLO', cap: 2 },
    { id: 'blue',   label: 'Azul',     short: 'AZUL',     cap: 3 },
    { id: 'green',  label: 'Verde',    short: 'VERDE',    cap: 4 },
    { id: 'red',    label: 'Roja',     short: 'ROJO',     cap: 5 }
  ];

  const BLACK = { id: 'black', label: 'Negra', short: 'NEGRO' };

  const FACES = ZONES.map((z) => z.id).concat(BLACK.id); /* 6 caras del dado */
  const BY_ID = ZONES.reduce((m, z) => (m[z.id] = z, m), {});
  const TOTAL_SLOTS = ZONES.reduce((n, z) => n + z.cap, 0); /* 15 */

  function newBoard() {
    const b = {};
    for (const z of ZONES) b[z.id] = 0;
    return b;
  }

  return { ZONES, BLACK, FACES, BY_ID, TOTAL_SLOTS, newBoard };
});
