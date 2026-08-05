/* ============================================================
   shared/ui/bet-modal.js — modal "APUESTA DE LA PARTIDA" (DESIGN.md §6)

   Uso desde cada juego (dentro de su propio applyState/render):
     GCBetModal.render(state.betGate, myPlayerId, {
       onConfirm: () => api('betConfirm'),
       onCancel:  () => api('betCancel')
     });

   Con state.betGate === null se oculta automáticamente.
   ============================================================ */

window.GCBetModal = (function () {
  function ensureCss() {
    if (document.getElementById('gcBetModalCss')) return;
    const link = document.createElement('link');
    link.id = 'gcBetModalCss';
    link.rel = 'stylesheet';
    link.href = '/shared/ui/bet-modal.css';
    document.head.appendChild(link);
  }

  function ensureDom() {
    if (document.getElementById('gcBetModal')) return;
    ensureCss();
    const box = document.createElement('div');
    box.id = 'gcBetModal';
    box.className = 'is-hidden';
    box.innerHTML = `
      <div class="gc-bet-box">
        <h3>Apuesta de la partida</h3>
        <div class="gc-bet-amounts" id="gcBetAmount">$0</div>
        <p class="gc-bet-penalty" id="gcBetPenalty"></p>
        <p class="gc-bet-progress" id="gcBetProgress"></p>
        <div class="gc-bet-actions">
          <button class="gc-bet-cancel" id="gcBetCancelBtn">CANCELAR</button>
          <button class="gc-bet-ok" id="gcBetOkBtn">OK — COLOCAR APUESTA</button>
        </div>
      </div>`;
    document.body.appendChild(box);
  }

  function render(gate, myPlayerId, { onConfirm, onCancel } = {}) {
    ensureDom();
    const box = document.getElementById('gcBetModal');
    if (!gate || !gate.pending) {
      box.classList.add('is-hidden');
      return;
    }
    box.classList.remove('is-hidden');
    document.getElementById('gcBetAmount').textContent =
      'Apuesta: $' + Number(gate.amount || 0).toLocaleString('en-US');
    const penaltyEl = document.getElementById('gcBetPenalty');
    penaltyEl.textContent = gate.penalty
      ? 'Jugada de castigo: $' + Number(gate.penalty).toLocaleString('en-US')
      : '';
    penaltyEl.style.display = gate.penalty ? '' : 'none';

    const total = gate.requiredIds.length;
    const done = gate.confirmedIds.length;
    document.getElementById('gcBetProgress').textContent = `Confirmaron ${done}/${total} jugadores`;

    const mine = myPlayerId && gate.confirmedIds.includes(myPlayerId);
    const okBtn = document.getElementById('gcBetOkBtn');
    const cancelBtn = document.getElementById('gcBetCancelBtn');
    okBtn.disabled = !!mine;
    okBtn.textContent = mine ? 'ESPERANDO A LOS DEMÁS…' : 'OK — COLOCAR APUESTA';
    okBtn.onclick = mine ? null : () => onConfirm && onConfirm();
    cancelBtn.onclick = () => onCancel && onCancel();
  }

  function hide() {
    const box = document.getElementById('gcBetModal');
    if (box) box.classList.add('is-hidden');
  }

  return { render, hide };
})();
