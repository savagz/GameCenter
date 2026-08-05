/* ============================================================
   shared/ui/turn-banner.js — cartel "TURNO DE ..." unificado (DESIGN.md §7)

   Reutiliza el markup/CSS que cada juego ya trae (#turnFlash /
   #turnFlashText, ver game.css de Cucaracha) — este módulo solo
   centraliza el comportamiento para que los 4 juegos lo compartan.
   ============================================================ */

window.GCTurnBanner = (function () {
  function show(text) {
    const box = document.getElementById('turnFlash');
    const label = document.getElementById('turnFlashText');
    if (!box || !label) return;
    label.textContent = text;
    box.classList.remove('is-hidden');
    const span = box.firstElementChild;
    if (span) {
      span.style.animation = 'none';
      void span.offsetWidth;
      span.style.animation = '';
    }
    setTimeout(() => box.classList.add('is-hidden'), 1700);
  }
  return { show };
})();
