/* ============================================================
   shared/ui/victory-banner.js — mensaje de victoria unificado (DESIGN.md §8)

   Da el título y cuerpo de texto para el modal de victoria que cada
   juego ya tiene (mismo estilo visual que el cartel de cambio de
   turno). No toca DOM directamente: cada juego decide dónde pintar
   el resultado (ya tiene su propio #winTitle/#winText o equivalente).
   ============================================================ */

window.GCVictoryBanner = (function () {
  function text({ winnerName, amountWon, mine, fallback }) {
    const title = mine ? '¡GANASTE!' : winnerName ? `¡${winnerName.toUpperCase()} GANÓ!` : 'Fin de la partida';
    if (amountWon > 0) {
      return { title, body: `Ganancia: $${Number(amountWon).toLocaleString('en-US')}` };
    }
    return { title, body: fallback || (winnerName ? `${winnerName} ganó la partida.` : 'La partida terminó.') };
  }
  return { text };
})();
