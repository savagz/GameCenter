/* ============================================================
   TOMA 6 — cliente del juego
   Estado autoritativo en el servidor; aqui solo se pinta,
   se anima y se suena.
   ============================================================ */
(function () {
'use strict';

const $ = (id) => document.getElementById(id);

/* nombre definido en el lobby de GameCenter (mismo origen, misma pestaña) */
function lobbyName() {
  try { return (sessionStorage.getItem('gc_playerName') || '').trim().slice(0, 16); } catch (_) { return ''; }
}

/* nombre y apuesta llegan de GameCenter por query string (?name=&betting=&bet=) */
const GC = (function () {
  const p = new URLSearchParams(location.search);
  return {
    name: p.get('name') || lobbyName(),
    betting: p.get('betting') === '1',
    bet: Math.max(0, Math.floor(Number(p.get('bet')) || 0))
  };
})();

const STAR_CLASS = { 1: 's1', 2: 's2', 3: 's3', 5: 's5', 7: 's7' };

/* ============================================================
   Audio — todo sintetizado con WebAudio, sin archivos externos
   ============================================================ */

const Sound = {
  ctx: null,
  enabled: localStorage.getItem('tomaseis:mute') !== '1',
  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  beep({ freq, duration = 0.09, type = 'square', gain = 0.08, slideTo = null, delay = 0 }) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  },
  sequence(notes) { notes.forEach((n) => this.beep(n)); },
  pick() { this.init(); this.beep({ freq: 480, duration: 0.05, gain: 0.06 }); },
  place() { this.init(); this.beep({ freq: 300, duration: 0.06, slideTo: 520, gain: 0.07 }); },
  take() {
    this.init();
    this.sequence([
      { freq: 220, duration: 0.1, type: 'sawtooth', gain: 0.08 },
      { freq: 160, duration: 0.16, type: 'sawtooth', gain: 0.08, delay: 0.09 }
    ]);
  },
  invalid() { this.init(); this.beep({ freq: 160, duration: 0.14, type: 'sawtooth', gain: 0.08 }); },
  turn() {
    this.init();
    this.sequence([
      { freq: 392, duration: 0.09, gain: 0.07 },
      { freq: 523.25, duration: 0.14, gain: 0.08, delay: 0.1 }
    ]);
  },
  reveal() {
    this.init();
    this.sequence([
      { freq: 523.25, duration: 0.08, delay: 0 },
      { freq: 659.25, duration: 0.08, delay: 0.09 },
      { freq: 783.99, duration: 0.14, delay: 0.18 }
    ]);
  },
  win() {
    this.init();
    this.sequence([
      { freq: 523.25, duration: 0.12, delay: 0 },
      { freq: 659.25, duration: 0.12, delay: 0.12 },
      { freq: 783.99, duration: 0.12, delay: 0.24 },
      { freq: 1046.5, duration: 0.3, delay: 0.36 }
    ]);
  },
  lose() {
    this.init();
    this.sequence([
      { freq: 400, duration: 0.15, delay: 0 },
      { freq: 320, duration: 0.15, delay: 0.15 },
      { freq: 240, duration: 0.32, delay: 0.3 }
    ]);
  }
};

/* ============================================================
   Sesion y red
   ============================================================ */

const SESSION_KEY = 'tomaseis:session';

const S = {
  me: null,
  state: null,
  source: null,
  errors: 0,
  selectedCardId: null,
  lastPlacementsLen: 0,
  lastRound: 0,
  lastEventId: 0,
  finishShownFor: null,
  rowModalShown: false,
  lastBannerKey: null,
  displayRows: null,
  animQueue: [],
  animBusy: false,
  reminderTimer: null,
  clockOffset: 0,
  clockTimer: null,
  confirmPending: false,
  confirmedCardId: null
};

function saveSession(s) { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { return null; }
}
function clearSession() { sessionStorage.removeItem(SESSION_KEY); }

async function api(action, data) {
  const body = Object.assign({}, S.me || {}, data || {});
  const res = await fetch(window.GC_BASE + 'api/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({ ok: false, error: 'Respuesta inválida.' }));
  if (!json.ok) throw new Error(json.error || 'Error desconocido.');
  return json;
}

function connect() {
  if (S.source) S.source.close();
  const q = `room=${encodeURIComponent(S.me.roomId)}&pid=${encodeURIComponent(S.me.playerId)}&token=${encodeURIComponent(S.me.token)}`;
  const src = new EventSource(window.GC_BASE + 'events?' + q);
  S.source = src;

  src.addEventListener('state', (e) => {
    S.errors = 0;
    try { applyState(JSON.parse(e.data)); } catch (err) { console.error(err); }
  });

  src.onerror = () => {
    /* 403/404: el servidor ya no reconoce al jugador o la sala no existe; el
       navegador no vuelve a intentarlo, asi que se comprueba y se vuelve al inicio */
    if (src.readyState === EventSource.CLOSED) {
      if (S.source !== src) return;
      api('state')
        .then(() => setTimeout(() => { if (S.source === src) connect(); }, 1500))
        .catch((e) => leaveToHome(/reconocido/.test(e.message)
          ? 'Ya no formas parte de esa sala.'
          : 'La sala ya no existe.'));
      return;
    }
    S.errors += 1;
    if (S.errors === 3) toast('Conexión interrumpida, reintentando…', 'info');
    if (S.errors > 12) { src.close(); leaveToHome('No se pudo restablecer la conexión.'); }
  };
}

/* ============================================================
   Pantallas
   ============================================================ */

function showScreen(name) {
  $('screenHome').classList.toggle('is-hidden', name !== 'home');
  $('screenLobby').classList.toggle('is-hidden', name !== 'lobby');
  $('screenGame').classList.toggle('is-hidden', name !== 'game');
}

function leaveToHome(message) {
  if (S.source) { S.source.close(); S.source = null; }
  clearSession();
  S.me = null; S.state = null; S.selectedCardId = null;
  S.lastPlacementsLen = 0; S.lastRound = 0; S.lastEventId = 0; S.finishShownFor = null; S.rowModalShown = false;
  S.lastBannerKey = null;
  S.displayRows = null; S.animQueue = []; S.animBusy = false; S.confirmPending = false; S.confirmedCardId = null;
  if (S.reminderTimer) { clearInterval(S.reminderTimer); S.reminderTimer = null; }
  if (S.clockTimer) { clearInterval(S.clockTimer); S.clockTimer = null; }
  $('modalGameOver').classList.add('is-hidden');
  $('modalExit').classList.add('is-hidden');
  $('modalChooseRow').classList.add('is-hidden');
  showScreen('home');
  if (message) showHomeError(message);
}

function showHomeError(msg) {
  const box = $('homeError');
  box.textContent = msg;
  box.classList.remove('is-hidden');
  Sound.invalid();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(text, kind) {
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'error' ? ' toast-error' : '');
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function initial(name) { return (name || '?').trim().charAt(0).toUpperCase(); }
function playerColor(st, id) {
  const i = st.players.findIndex((p) => p.id === id);
  return 'var(--p' + (((i < 0 ? 0 : i) % 10) + 1) + ')';
}
function playerById(st, id) { return st.players.find((p) => p.id === id) || null; }

/* ============================================================
   Cartas (DOM)
   ============================================================ */

function starsMarkup(stars) {
  if (stars <= 5) return '★'.repeat(stars);
  const top = Math.ceil(stars / 2);
  return `<span class="stars-line">${'★'.repeat(top)}</span><span class="stars-line">${'★'.repeat(stars - top)}</span>`;
}

function buildCard(num, stars, opts) {
  opts = opts || {};
  const el = document.createElement('div');
  const cls = ['card', STAR_CLASS[stars] || 's1'];
  if (opts.selectable) cls.push('selectable');
  if (opts.chosen) cls.push('chosen-mine');
  if (opts.confirming) cls.push('confirming');
  if (opts.played) cls.push('played-mine');
  if (opts.locked) cls.push('locked');
  if (opts.justPlaced) cls.push('just-placed');
  el.className = cls.join(' ');
  el.innerHTML = `<span class="num">${num}</span><span class="stars${stars > 5 ? ' stars-multi' : ''}">${starsMarkup(stars)}</span>`;
  if (opts.onClick) el.addEventListener('click', opts.onClick);
  return el;
}

/* ============================================================
   Render
   ============================================================ */

/* cuenta atras de la fase (elegir carta / elegir fila), con el reloj del
   servidor corregido por la diferencia con el reloj local */
function renderPhaseTimer() {
  const st = S.state;
  const box = $('phaseTimer');
  const active = st && st.status === 'playing' && st.deadline &&
    (st.phase === 'choosing' || st.phase === 'awaitingRow');
  if (!active) {
    box.classList.add('is-hidden');
    if (S.clockTimer) { clearInterval(S.clockTimer); S.clockTimer = null; }
    return;
  }
  const left = Math.max(0, Math.ceil((st.deadline - (Date.now() + S.clockOffset)) / 1000));
  box.textContent = `${left}s`;
  box.classList.toggle('is-urgent', left <= 10);
  box.classList.remove('is-hidden');
  if (!S.clockTimer) S.clockTimer = setInterval(renderPhaseTimer, 250);
}

function renderTopbar(st) {
  const row = $('playersRow');
  row.textContent = '';
  st.players.forEach((p) => {
    const div = document.createElement('div');
    const cls = ['chip'];
    if (!p.online) cls.push('off');
    if (p.id === st.youId) cls.push('you');
    if (st.phase === 'choosing' && p.hasChosen) cls.push('chosen');
    if (st.phase === 'awaitingRow' && st.awaitingPlayerId === p.id) cls.push('waiting-row');
    div.className = cls.join(' ');
    div.style.setProperty('--p', playerColor(st, p.id));
    div.innerHTML =
      `<span class="chip-avatar">${initial(p.name)}</span>` +
      `<span class="chip-name">${escapeHtml(p.name)}</span>` +
      `<span class="chip-stars">★ ${p.stars}</span>`;
    row.appendChild(div);
  });
  $('roundLabel').textContent = `${st.round}/${st.totalRounds}`;

  const countBox = $('chooseCount');
  const showCount = st.status === 'playing' && st.phase === 'choosing';
  countBox.classList.toggle('is-hidden', !showCount);
  if (showCount) {
    const total = st.players.length;
    const chosen = st.players.filter((p) => p.hasChosen).length;
    countBox.classList.toggle('all-in', chosen === total);
    countBox.textContent = `Eligieron ${chosen}/${total}`;
  }
}

function renderBoardRows(st) {
  const inner = $('boardInner');
  inner.textContent = '';
  const rows = S.displayRows || st.rows;

  rows.forEach((row) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'board-row';

    const count = document.createElement('span');
    count.className = 'row-count';
    count.textContent = `${row.length}/5`;
    rowEl.appendChild(count);

    for (let slot = 0; slot < 5; slot++) {
      const c = row[slot];
      const el = c ? buildCard(c.num, c.stars) : document.createElement('div');
      if (!c) el.className = 'card-slot';
      el.dataset.slot = String(slot);
      rowEl.appendChild(el);
    }

    const divider = document.createElement('div');
    divider.className = 'stage-divider';
    rowEl.appendChild(divider);

    const stage = document.createElement('div');
    stage.className = 'stage-slot';
    rowEl.appendChild(stage);

    inner.appendChild(rowEl);
  });
}

/* ============================================================
   Animacion secuencial de revelado: cada carta nueva aparece en
   el espacio de la derecha ("Jugada de XXX") y luego se desliza
   a su lugar en la fila correspondiente, una a la vez.
   ============================================================ */

const STAGE_HOLD_MS = 550;
const SLIDE_MS = 380;

function getTargetSlotEl(rowEl, item) {
  const idx = (item.taken && item.taken.length > 0) ? 0 : S.displayRows[item.rowIndex].length;
  return rowEl.querySelector(`[data-slot="${idx}"]`);
}

function animatePlacement(item, playerName) {
  return new Promise((resolve) => {
    const rowEl = $('boardInner').children[item.rowIndex];
    const stageSlot = rowEl && rowEl.querySelector('.stage-slot');
    if (!rowEl || !stageSlot) { resolve(); return; }

    const label = document.createElement('div');
    label.className = 'stage-label';
    label.textContent = `Jugada de ${playerName || '…'}`;
    stageSlot.appendChild(label);

    const cardEl = buildCard(item.card.num, item.card.stars, { justPlaced: true });
    stageSlot.appendChild(cardEl);
    Sound.place();

    setTimeout(() => {
      const targetSlot = getTargetSlotEl(rowEl, item);
      if (!targetSlot) { cardEl.remove(); label.remove(); resolve(); return; }

      const fromRect = cardEl.getBoundingClientRect();
      const toRect = targetSlot.getBoundingClientRect();

      cardEl.style.position = 'fixed';
      cardEl.style.margin = '0';
      cardEl.style.left = fromRect.left + 'px';
      cardEl.style.top = fromRect.top + 'px';
      cardEl.style.width = fromRect.width + 'px';
      cardEl.style.height = fromRect.height + 'px';
      cardEl.style.zIndex = '80';
      document.body.appendChild(cardEl);

      label.classList.add('is-fading');

      const takingOver = item.taken && item.taken.length > 0;
      if (takingOver) {
        rowEl.querySelectorAll('.card, .card-slot').forEach((el) => el.classList.add('sweep-out'));
        rowEl.classList.remove('row-flash');
        void rowEl.offsetWidth;
        rowEl.classList.add('row-flash');
      }

      void cardEl.offsetWidth;
      cardEl.style.transition = `left ${SLIDE_MS}ms cubic-bezier(.3,.65,.3,1), top ${SLIDE_MS}ms cubic-bezier(.3,.65,.3,1)`;
      cardEl.style.left = toRect.left + 'px';
      cardEl.style.top = toRect.top + 'px';

      setTimeout(() => {
        cardEl.remove();
        label.remove();
        if (takingOver) Sound.take();
        resolve();
      }, SLIDE_MS + 20);
    }, STAGE_HOLD_MS);
  });
}

function commitPlacement(item) {
  if (item.taken && item.taken.length > 0) {
    S.displayRows[item.rowIndex] = [item.card];
  } else {
    S.displayRows[item.rowIndex].push(item.card);
  }
}

function highlightLanded(item) {
  const rowEl = $('boardInner').children[item.rowIndex];
  if (!rowEl) return;
  const idx = (item.taken && item.taken.length > 0) ? 0 : S.displayRows[item.rowIndex].length - 1;
  const el = rowEl.querySelector(`[data-slot="${idx}"]`);
  if (!el) return;
  el.classList.add('landed');
  setTimeout(() => el.classList.remove('landed'), 1400);
}

function processAnimQueue() {
  if (S.animBusy) return;
  const item = S.animQueue.shift();
  if (!item) { checkTurnBanner(S.state); return; }
  S.animBusy = true;
  const player = playerById(S.state, item.playerId);
  animatePlacement(item, player ? player.name : '').then(() => {
    commitPlacement(item);
    renderBoardRows(S.state);
    highlightLanded(item);
    S.animBusy = false;
    processAnimQueue();
  });
}

function renderBoardHint(st) {
  const awaitingMe = st.phase === 'awaitingRow' && st.awaitingPlayerId === st.youId;
  let hint = '';
  if (st.status === 'playing') {
    if (st.phase === 'choosing') {
      hint = S.selectedCardId || (playerById(st, st.youId) || {}).hasChosen
        ? 'Esperando a que el resto elija su carta. Quien no elija a tiempo jugará su carta más baja.'
        : 'Elige una carta de tu mano y confirma. Si se acaba el tiempo, se jugará tu carta más baja.';
    } else if (st.phase === 'awaitingRow') {
      const p = playerById(st, st.awaitingPlayerId);
      hint = awaitingMe
        ? 'Tu carta es menor que todas: elige qué fila te llevas. Si se acaba el tiempo, te llevarás la fila más barata.'
        : `${p ? p.name : '…'} está eligiendo una fila. Si se le acaba el tiempo, se llevará la más barata.`;
    } else if (st.phase === 'resolving') {
      hint = 'Resolviendo la ronda…';
    }
  }
  $('phaseHint').textContent = hint;
}

function renderHand(st) {
  const me = playerById(st, st.youId);
  const hasChosen = !!(me && me.hasChosen);
  const row = $('handRow');
  row.textContent = '';
  const canPick = st.status === 'playing' && st.phase === 'choosing' && !hasChosen && !S.confirmPending;

  st.hand.forEach((c) => {
    const chosen = S.selectedCardId === c.id;
    const mine = S.confirmedCardId === c.id;
    row.appendChild(buildCard(c.num, c.stars, {
      selectable: canPick,
      chosen,
      confirming: S.confirmPending && chosen,
      played: hasChosen && mine,
      locked: !canPick && !chosen && !(hasChosen && mine),
      onClick: canPick ? () => {
        S.selectedCardId = chosen ? null : c.id;
        Sound.pick();
        renderHand(st);
        renderBoardHint(st);
        manageChoosingReminder(st);
      } : null
    }));
  });

  $('btnConfirm').disabled = !(canPick && S.selectedCardId);
  $('btnConfirm').textContent = S.confirmPending ? 'Enviando…' : (hasChosen ? 'Carta jugada' : 'Jugar carta');
}

function renderRowPicker(st) {
  const show = st.status === 'playing' && st.phase === 'awaitingRow' && st.awaitingPlayerId === st.youId;
  $('modalChooseRow').classList.toggle('is-hidden', !show);
  if (!show) { S.rowModalShown = false; return; }
  if (S.rowModalShown) return;
  S.rowModalShown = true;

  const item = (st.revealed || [])[st.resolveIndex];
  $('chooseRowHint').textContent = item
    ? `Tu carta (${item.num}) es menor que el final de las 4 filas. Elige cuál te llevas.`
    : 'Elige qué fila te llevas.';

  const picker = $('rowPicker');
  picker.textContent = '';
  st.rows.forEach((row, ri) => {
    const stars = row.reduce((s, c) => s + c.stars, 0);
    const opt = document.createElement('div');
    opt.className = 'row-pick-opt';
    row.forEach((c) => opt.appendChild(buildCard(c.num, c.stars)));
    const starsEl = document.createElement('span');
    starsEl.className = 'row-pick-stars';
    starsEl.textContent = `★ ${stars}`;
    opt.appendChild(starsEl);
    opt.addEventListener('click', () => {
      $('modalChooseRow').classList.add('is-hidden');
      S.rowModalShown = false;
      Sound.take();
      api('chooseRow', { rowIndex: ri }).catch((e) => {
        toast(e.message, 'error');
        Sound.invalid();
        if (S.state) renderRowPicker(S.state);
      });
    });
    picker.appendChild(opt);
  });
}

/* ---------- sala de espera ---------- */

function renderLobby(st) {
  const cfg = st.config || {};
  const max = cfg.maxPlayers || 10;
  const cash = (n) => '$' + Number(n || 0).toLocaleString('en-US');

  $('lobbyCode').textContent = st.id;
  $('lobbyCount').textContent = `${st.players.length}/${max}`;
  $('lobbyHint').textContent = `Compártelo con los demás. Máximo ${max} jugadores.`;

  const rows = [
    cfg.bettingEnabled && ['Apuesta', cash(cfg.apuesta), true],
    ['Jugadores máx.', max]
  ].filter(Boolean);
  $('lobbyConfig').innerHTML = rows.map(([k, v, gold]) =>
    `<div class="gch-stat${gold ? ' is-gold' : ''}"><dt>${k}</dt><dd>${escapeHtml(String(v))}</dd></div>`).join('');

  const list = $('lobbyPlayers');
  list.textContent = '';
  st.players.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'gch-player' + (p.online ? '' : ' is-off') + (p.id === S.me.playerId ? ' is-me' : '');
    li.style.setProperty('--p', 'var(--p' + ((i % 6) + 1) + ')');
    const tags = [];
    if (p.id === st.hostId) tags.push('<span class="gch-tag is-host">Anfitrión</span>');
    if (p.id === S.me.playerId) tags.push('<span class="gch-tag">Tú</span>');
    if (!p.online) tags.push('<span class="gch-tag is-off">Desconectado</span>');
    li.innerHTML = `<span class="gch-avatar">${escapeHtml(initial(p.name))}</span>` +
      `<span class="gch-player-name">${escapeHtml(p.name)}</span>${tags.join('')}`;
    list.appendChild(li);
  });
  for (let k = st.players.length; k < max; k++) {
    const li = document.createElement('li');
    li.className = 'gch-player is-empty';
    li.innerHTML = '<span class="gch-avatar"></span><span class="gch-player-name">Asiento libre</span>';
    list.appendChild(li);
  }

  const isHost = st.hostId === S.me.playerId;
  const enough = st.players.length >= 2;
  $('btnStart').classList.toggle('is-hidden', !isHost);
  $('btnStart').disabled = !enough;
  $('btnStart').textContent = enough ? 'Comenzar partida' : 'Esperando jugadores…';
  $('lobbyWait').classList.toggle('is-hidden', isHost);
}

/* ============================================================
   Cambios detectados (placements, revelado, ronda, fin)
   ============================================================ */

function handleDeltas(st) {
  if (st.round !== S.lastRound) {
    /* la ronda bajo: el anfitrion reinicio la partida, el tablero viejo no sirve */
    if (st.round < S.lastRound) { S.displayRows = null; S.animQueue = []; }
    S.lastRound = st.round;
    S.selectedCardId = null;
    S.confirmPending = false;
    S.confirmedCardId = null;
    S.lastPlacementsLen = 0;
  }

  /* en la fase de eleccion no hay colocaciones pendientes: si no queda ninguna
     animacion en curso, el tablero mostrado debe ser exactamente el del
     servidor (corrige reconexiones que se saltaron colocaciones) */
  const idle = !S.animBusy && S.animQueue.length === 0;
  if (!S.displayRows || (idle && st.phase === 'choosing' && !sameRows(S.displayRows, st.rows))) {
    S.displayRows = st.rows.map((r) => r.slice());
    renderBoardRows(st);
  }

  const placements = st.placements || [];
  if (placements.length > S.lastPlacementsLen) {
    if (S.lastPlacementsLen === 0) Sound.reveal();
    for (let i = S.lastPlacementsLen; i < placements.length; i++) S.animQueue.push(placements[i]);
    S.lastPlacementsLen = placements.length;
    processAnimQueue();
  }
}

function sameRows(a, b) {
  const key = (rows) => rows.map((r) => r.map((c) => c.id).join(',')).join('|');
  return key(a) === key(b);
}

/* ============================================================
   Cartel de turno (mismo mecanismo que Rummy): avisa cuando hay
   que elegir carta o fila, una sola vez por fase.
   ============================================================ */

function checkTurnBanner(st) {
  if (st.status !== 'playing' || !window.GCTurnBanner) { S.lastBannerKey = null; return; }

  let key = null;
  let text = null;
  let withTurnSound = false;
  if (st.phase === 'choosing') {
    if (S.animBusy || S.animQueue.length) return;
    key = `choose:${st.round}`;
    text = 'Selecciona una Carta';
    withTurnSound = true;
  } else if (st.phase === 'awaitingRow' && st.awaitingPlayerId === st.youId) {
    key = `row:${st.round}:${st.resolveIndex}`;
    text = 'Selecciona una Fila';
  }

  if (!key) { S.lastBannerKey = null; return; }
  if (key === S.lastBannerKey) return;
  S.lastBannerKey = key;
  if (withTurnSound) Sound.turn();
  GCTurnBanner.show(text);
}

/* ============================================================
   Recordatorio: mientras el jugador no elija carta, insiste
   cada 5s (ademas del cartel inicial de checkTurnBanner).
   ============================================================ */

function manageChoosingReminder(st) {
  const me = playerById(st, st.youId);
  const needsCard = st.status === 'playing' && st.phase === 'choosing' &&
    me && !me.hasChosen && !S.selectedCardId && !S.animBusy && !S.animQueue.length;

  if (needsCard) {
    if (!S.reminderTimer) {
      S.reminderTimer = setInterval(() => {
        Sound.turn();
        if (window.GCTurnBanner) GCTurnBanner.show('Selecciona una Carta');
      }, 10000);
    }
  } else if (S.reminderTimer) {
    clearInterval(S.reminderTimer);
    S.reminderTimer = null;
  }
}

/* ============================================================
   Aplicacion del estado recibido
   ============================================================ */

function applyState(st) {
  S.state = st;
  if (typeof st.now === 'number') S.clockOffset = st.now - Date.now();

  if (st.status === 'lobby') { renderLobby(st); showScreen('lobby'); return; }
  if ($('screenGame').classList.contains('is-hidden')) {
    showScreen('game');
    S.lastRound = st.round;
    S.lastPlacementsLen = (st.placements || []).length;
  }

  const me = playerById(st, st.youId);
  if (me && !me.hasChosen) { /* selección local se conserva mientras no se confirme */ } else { S.selectedCardId = null; S.confirmPending = false; }

  handleDeltas(st);

  renderTopbar(st);
  renderPhaseTimer();
  renderBoardHint(st);
  renderHand(st);
  renderRowPicker(st);

  checkTurnBanner(st);
  manageChoosingReminder(st);
  flushEvents(st);
  checkFinish(st);
}

function flushEvents(st) {
  for (const ev of st.events) {
    if (ev.id <= S.lastEventId) continue;
    S.lastEventId = ev.id;
    if (ev.type === 'lastRound') {
      Sound.turn();
      if (window.GCTurnBanner) GCTurnBanner.show(ev.text);
      continue;
    }
    if (ev.type === 'turn' || ev.type === 'reveal') continue;
    toast(ev.text, 'info');
  }
}

function checkFinish(st) {
  const modal = $('modalGameOver');
  if (st.status !== 'finished' || !st.result) {
    S.finishShownFor = null;
    modal.classList.add('is-hidden');
    return;
  }
  if (S.finishShownFor === st.result.seq) return;
  S.finishShownFor = st.result.seq;

  const winnerIds = st.result.winnerIds || [st.result.winnerId];
  const mine = winnerIds.includes(S.me.playerId);
  if (mine) Sound.win(); else Sound.lose();

  let banner;
  if (st.result.tie) {
    const names = (st.result.winnerNames || []).join(' y ');
    banner = {
      title: '¡EMPATE!',
      body: st.result.share > 0
        ? `${names} empatan. Cada uno recibe $${Number(st.result.share).toLocaleString('en-US')}.`
        : `${names} empatan con las mismas estrellas y cartas.`
    };
  } else {
    banner = window.GCVictoryBanner
      ? GCVictoryBanner.text({ winnerName: st.result.winnerName, amountWon: st.result.prize || 0, mine, fallback: st.result.reason })
      : { title: mine ? '¡GANASTE!' : `${st.result.winnerName} ganó`, body: st.result.reason };
  }

  $('goTitle').textContent = banner.title;
  $('goBody').textContent = banner.body;
  $('goPrizeReason').classList.toggle('is-hidden', !(st.result.prize > 0));
  $('goPrizeReason').textContent = st.result.reason;

  const tbody = $('goScores');
  tbody.textContent = '';
  [...st.result.scores].sort((a, b) => a.points - b.points || (a.cards || 0) - (b.cards || 0)).forEach((s) => {
    const tr = document.createElement('tr');
    if (winnerIds.includes(s.id)) tr.classList.add('winner');
    const cards = typeof s.cards === 'number' ? ` · ${s.cards} carta${s.cards === 1 ? '' : 's'}` : '';
    tr.innerHTML = `<td>${escapeHtml(s.name)}${s.id === S.me.playerId ? ' (tú)' : ''}</td><td>★ ${s.points}${cards}</td>`;
    tbody.appendChild(tr);
  });

  const isHost = st.hostId === S.me.playerId;
  $('btnRestart').classList.toggle('is-hidden', !isHost);
  modal.classList.remove('is-hidden');
}

/* ============================================================
   Acciones
   ============================================================ */

function confirmCard() {
  if (!S.selectedCardId || S.confirmPending) return;
  const cardId = S.selectedCardId;
  S.confirmPending = true;
  S.confirmedCardId = cardId;
  Sound.place();
  renderHand(S.state);
  api('chooseCard', { cardId }).catch((e) => {
    S.confirmPending = false;
    S.confirmedCardId = null;
    toast(e.message, 'error');
    Sound.invalid();
    renderHand(S.state);
  });
}

function toggleMute() {
  Sound.enabled = !Sound.enabled;
  localStorage.setItem('tomaseis:mute', Sound.enabled ? '0' : '1');
  $('iconSoundOn').classList.toggle('is-hidden', !Sound.enabled);
  $('iconSoundOff').classList.toggle('is-hidden', Sound.enabled);
  if (Sound.enabled) Sound.init();
}

/* ============================================================
   Eventos de interfaz
   ============================================================ */

async function doCreate() {
  const name = $('nameInput').value.trim();
  if (!name) return showHomeError('Escribe tu nombre.');
  localStorage.setItem('tomaseis:name', name);
  Sound.init();
  try {
    const res = await api('create', {
      name,
      config: {
        maxPlayers: Number($('cfgMax').value),
        bettingEnabled: GC.betting,
        apuesta: GC.betting ? GC.bet : 0
      }
    });
    S.me = { roomId: res.roomId, playerId: res.playerId, token: res.token };
    saveSession(S.me);
    connect();
  } catch (e) { showHomeError(e.message); }
}

async function doJoin() {
  const name = $('nameInput').value.trim();
  const code = $('joinCode').value.toUpperCase().trim();
  if (!name) return showHomeError('Escribe tu nombre.');
  if (code.length !== 4) return showHomeError('El código tiene 4 letras.');
  Sound.init();
  try {
    const res = await api('join', { name, roomId: code });
    S.me = { roomId: res.roomId, playerId: res.playerId, token: res.token };
    saveSession(S.me);
    connect();
  } catch (e) { showHomeError(e.message); }
}

function wire() {
  if (GC.name) $('nameInput').value = GC.name;
  else {
    const saved = localStorage.getItem('tomaseis:name');
    if (saved) $('nameInput').value = saved;
  }
  if (GC.betting) {
    $('bettingInfo').classList.remove('is-hidden');
    $('bettingAmount').textContent = '$' + GC.bet.toLocaleString('en-US');
  }

  $('btnCreate').addEventListener('click', doCreate);
  $('btnJoin').addEventListener('click', doJoin);
  $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doCreate(); });
  $('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

  $('btnStart').addEventListener('click', () => api('start').catch((e) => toast(e.message, 'error')));
  $('btnCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(S.state ? S.state.id : '');
      $('btnCopy').textContent = '¡Copiado!';
      setTimeout(() => ($('btnCopy').textContent = 'Copiar'), 1600);
    } catch (_) { toast('Copia el código manualmente: ' + (S.state ? S.state.id : '')); }
  });
  $('btnLeaveLobby').addEventListener('click', () => api('leave').catch(() => {}).then(() => leaveToHome()));

  $('btnMute').addEventListener('click', toggleMute);
  $('btnExit').addEventListener('click', () => $('modalExit').classList.remove('is-hidden'));
  $('btnExitCancel').addEventListener('click', () => $('modalExit').classList.add('is-hidden'));
  $('btnExitConfirm').addEventListener('click', () => {
    api('leave').catch(() => {}).finally(() => { window.location.href = '/'; });
  });

  $('btnConfirm').addEventListener('click', confirmCard);

  $('btnCloseGameOver').addEventListener('click', () => {
    $('modalGameOver').classList.add('is-hidden');
    api('leave').catch(() => {}).finally(() => { window.location.href = '/'; });
  });
  $('btnRestart').addEventListener('click', () => {
    api('restart').catch((e) => toast(e.message, 'error'));
    $('modalGameOver').classList.add('is-hidden');
  });

  document.addEventListener('pointerdown', () => Sound.init(), { once: true });
}

/* ============================================================
   Arranque
   ============================================================ */

async function boot() {
  wire();
  $('iconSoundOn').classList.toggle('is-hidden', !Sound.enabled);
  $('iconSoundOff').classList.toggle('is-hidden', Sound.enabled);

  const saved = loadSession();
  if (!saved) { showScreen('home'); return; }

  S.me = saved;
  $('screenHome').classList.add('is-hidden');
  try {
    await api('state');
    connect();
  } catch (_) {
    leaveToHome();
  }
}

boot();

})();
