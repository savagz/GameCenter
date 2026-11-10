/* ============================================================
   shared/ui/turn-clock.js — cuenta atrás del turno

   Muestra los segundos que le quedan al jugador de turno antes de
   perderlo por inactividad (o de que se salte a un desconectado).
   Desde 10 s se pone en rojo y, si el turno es del jugador que mira
   la pantalla, suena un pitido por segundo (más agudo en los 3
   últimos). El servidor manda `deadline` y su hora `now`, así que la
   cuenta no depende del reloj del dispositivo.
   ============================================================ */

window.GCTurnClock = (function () {
  const WARN_FROM = 10;
  let el = null;
  let deadline = null;
  let offset = 0;
  let mine = false;
  let sound = true;
  let timer = null;
  let lastBeep = null;
  let ctx = null;

  function beep(urgent) {
    if (!sound) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!ctx) ctx = new AC();
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = urgent ? 1320 : 880;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + (urgent ? 0.18 : 0.12));
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    } catch (_) { /* sin audio disponible */ }
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function tick() {
    if (!el) return;
    if (!deadline) { el.classList.add('is-hidden'); stop(); return; }
    const left = Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000));
    el.textContent = `${left}s`;
    el.classList.toggle('is-urgent', left <= WARN_FROM);
    el.classList.remove('is-hidden');
    if (mine && left > 0 && left <= WARN_FROM && left !== lastBeep) {
      lastBeep = left;
      beep(left <= 3);
    }
  }

  /* element: nodo donde pintar; deadline: ms del servidor o null;
     now: hora del servidor al generar el estado; mine: es mi turno;
     sound: el jugador no silencio el juego */
  function update(opts) {
    el = opts.element || el;
    if (typeof opts.now === 'number') offset = opts.now - Date.now();
    const d = opts.deadline || null;
    if (d !== deadline) lastBeep = null;
    deadline = d;
    mine = !!opts.mine;
    sound = opts.sound !== false;
    tick();
    if (deadline && !timer) timer = setInterval(tick, 250);
  }

  return { update };
})();
