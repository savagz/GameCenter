/* ============================================================
   CUCARACHA — definicion de las 24 posiciones del tablero
   Coordenadas del viewBox "0 0 700 780" (mismas que index.html)
   Compartido por el servidor (CommonJS) y el navegador (window).
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CucarachaSlots = api;
})(typeof self !== 'undefined' ? self : this, function () {

  /* id, valor, x, y — simetricos respecto al eje x = 350 */
  const SLOTS = [
    /* valor 2 · antenas (4) */
    { id: 'p01', v: 2, x: 238, y: 44,  zone: 'antena-izq' },
    { id: 'p02', v: 2, x: 462, y: 44,  zone: 'antena-der' },
    { id: 'p03', v: 2, x: 293, y: 128, zone: 'antena-izq' },
    { id: 'p04', v: 2, x: 407, y: 128, zone: 'antena-der' },

    /* valor 2 · cabeza (3) */
    { id: 'p05', v: 2, x: 350, y: 180, zone: 'cabeza' },
    { id: 'p06', v: 2, x: 265, y: 248, zone: 'cabeza' },
    { id: 'p07', v: 2, x: 435, y: 248, zone: 'cabeza' },

    /* valor 1 · patas delanteras (4) */
    { id: 'p08', v: 1, x: 162, y: 193, zone: 'pata1' },
    { id: 'p09', v: 1, x: 538, y: 193, zone: 'pata2' },
    { id: 'p10', v: 1, x: 110, y: 303, zone: 'pata3' },
    { id: 'p11', v: 1, x: 590, y: 303, zone: 'pata4' },

    /* valor 1 · hombros y brazos (4) */
    { id: 'p12', v: 1, x: 277, y: 337, zone: 'hombro-izq' },
    { id: 'p13', v: 1, x: 423, y: 337, zone: 'hombro-der' },
    { id: 'p14', v: 1, x: 249, y: 408, zone: 'brazo-izq' },
    { id: 'p15', v: 1, x: 451, y: 408, zone: 'brazo-der' },

    /* valor 1 · patas medias (4) */
    { id: 'p16', v: 1, x: 110, y: 481, zone: 'pata5' },
    { id: 'p17', v: 1, x: 590, y: 481, zone: 'pata6' },
    { id: 'p18', v: 1, x: 236, y: 486, zone: 'costado-izq' },
    { id: 'p19', v: 1, x: 464, y: 486, zone: 'costado-der' },

    /* valor 1 · abdomen y patas traseras (4) */
    { id: 'p20', v: 1, x: 155, y: 625, zone: 'pata7' },
    { id: 'p21', v: 1, x: 545, y: 625, zone: 'pata8' },
    { id: 'p22', v: 1, x: 281, y: 605, zone: 'abdomen-izq' },
    { id: 'p23', v: 1, x: 419, y: 605, zone: 'abdomen-der' },

    /* valor 3 · cola — siempre la ultima */
    { id: 'p24', v: 3, x: 350, y: 682, zone: 'cola' }
  ];

  const TOTAL = SLOTS.length;                 /* 24 */
  const FINAL_SLOT = 'p24';                   /* debe completarse al final */
  const BY_ID = SLOTS.reduce((m, s) => (m[s.id] = s, m), {});

  return { SLOTS, TOTAL, FINAL_SLOT, BY_ID };
});
