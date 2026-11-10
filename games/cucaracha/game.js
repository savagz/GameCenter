/* ============================================================
   CUCARACHA — cliente del juego
   Estado autoritativo en el servidor; aqui solo se pinta,
   se anima y se suena.
   ============================================================ */
(function () {
'use strict';

const { SLOTS, FINAL_SLOT, BY_ID } = window.CucarachaSlots;
const $ = (id) => document.getElementById(id);
const money = (n) => '$' + Number(n || 0).toLocaleString('en-US');

/* nombre definido en el lobby de GameCenter (mismo origen, misma pestaña) */
function lobbyName() {
  try { return (sessionStorage.getItem('gc_playerName') || '').trim().slice(0, 16); } catch (_) { return ''; }
}

/* nombre y apuesta llegan de GameCenter por query string (?name=&betting=&bet=&penalty=) */
const GC = (function () {
  const p = new URLSearchParams(location.search);
  return {
    name: p.get('name') || lobbyName(),
    betting: p.get('betting') === '1',
    bet: Math.max(0, Math.floor(Number(p.get('bet')) || 0)),
    penalty: Math.max(0, Math.floor(Number(p.get('penalty')) || 0))
  };
})();

/* ============================================================
   Audio — todo sintetizado con WebAudio, sin archivos externos
   ============================================================ */

const Sound = {
  ctx: null,
  enabled: localStorage.getItem('cucaracha:mute') !== '1',

  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },

  get t() { return this.ctx.currentTime; },

  tone(freq, at, dur, { type = 'sine', gain = 0.25, to = null } = {}) {
    if (!this.enabled || !this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.master);
    o.start(at);
    o.stop(at + dur + 0.03);
  },

  noise(at, dur, { gain = 0.2, freq = 1200, q = 1 } = {}) {
    if (!this.enabled || !this.ctx) return;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start(at);
  },

  /* --- efectos --- */

  dice(count) {
    this.init(); if (!this.enabled || !this.ctx) return;
    const t = this.t;
    const hits = 5 + (count || 5) * 2;
    for (let i = 0; i < hits; i++) {
      const at = t + Math.random() * 0.62;
      this.noise(at, 0.05, { gain: 0.11, freq: 900 + Math.random() * 1600, q: 2 });
    }
  },

  land() {
    this.init(); if (!this.enabled || !this.ctx) return;
    const t = this.t;
    this.noise(t, 0.07, { gain: 0.16, freq: 700, q: 1.5 });
    this.tone(180, t, 0.09, { type: 'triangle', gain: 0.12, to: 120 });
  },

  hit(i) {
    this.init(); if (!this.enabled || !this.ctx) return;
    const at = this.t + (i || 0) * 0.11;
    this.tone(880, at, 0.16, { type: 'triangle', gain: 0.22, to: 1450 });
    this.tone(1760, at, 0.1, { type: 'sine', gain: 0.08 });
  },

  place() {
    this.init(); if (!this.enabled || !this.ctx) return;
    const t = this.t;
    this.tone(520, t, 0.14, { type: 'sine', gain: 0.28, to: 880 });
    this.noise(t, 0.05, { gain: 0.08, freq: 2400, q: 3 });
  },

  penalty() {
    this.init(); if (!this.enabled || !this.ctx) return;
    const t = this.t;
    this.tone(240, t, 0.42, { type: 'sawtooth', gain: 0.18, to: 90 });
    this.tone(180, t + 0.05, 0.4, { type: 'square', gain: 0.08, to: 70 });
  },

  reward() {
    this.init(); if (!this.enabled || !this.ctx) return;
    const t = this.t;
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone(f, t + i * 0.085, 0.22, { type: 'square', gain: 0.13 }));
  },

  fanfare() {
    this.init(); if (!this.enabled || !this.ctx) return;
    const t = this.t;
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => {
      this.tone(f, t + i * 0.1, 0.5, { type: 'triangle', gain: 0.2 });
      this.tone(f * 2, t + i * 0.1, 0.3, { type: 'sine', gain: 0.06 });
    });
    this.noise(t + 0.6, 0.5, { gain: 0.06, freq: 5200, q: 0.7 });
  },

  turn() {
    this.init(); if (!this.enabled || !this.ctx) return;
    const t = this.t;
    this.tone(784, t, 0.3, { type: 'sine', gain: 0.16 });
    this.tone(1175, t + 0.09, 0.32, { type: 'sine', gain: 0.11 });
  },

  error() {
    this.init(); if (!this.enabled || !this.ctx) return;
    this.tone(140, this.t, 0.15, { type: 'square', gain: 0.14, to: 90 });
  },

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('cucaracha:mute', this.enabled ? '0' : '1');
    if (this.enabled) { this.init(); this.turn(); }
    return this.enabled;
  }
};

/* ============================================================
   Sesion y red
   ============================================================ */

const SESSION_KEY = 'cucaracha:session';

const S = {
  me: null,          /* {roomId, playerId, token} */
  state: null,
  prev: null,
  viewId: null,
  follow: true,
  animating: false,
  animGen: 0,
  animTimer: null,
  dirty: false,
  pendingWarn: 0,
  lastEventId: 0,
  lastRollNo: -1,
  lastCurrentId: null,
  lastBoards: {},
  source: null,
  errors: 0
};

/* sessionStorage y no localStorage: cada pestaña es un jugador distinto,
   lo que permite probar la partida con varias pestañas abiertas */
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
  S.me = null; S.state = null; S.lastEventId = 0; S.lastRollNo = -1;
  S.lastCurrentId = null; S.lastBoards = {};
  S.animating = false; S.dirty = false; S.animGen++;
  if (S.animTimer) { clearTimeout(S.animTimer); S.animTimer = null; }
  $('modalWin').classList.add('is-hidden');
  showScreen('home');
  if (message) showHomeError(message);
}

function showHomeError(msg) {
  const box = $('homeError');
  box.textContent = msg;
  box.classList.remove('is-hidden');
  box.style.animation = 'none';
  void box.offsetWidth;
  box.style.animation = '';
  Sound.error();
}

/* ============================================================
   Tablero — construccion de las 24 posiciones
   ============================================================ */

const SVG_NS = 'http://www.w3.org/2000/svg';

function buildSlots() {
  const g = $('slots');
  g.textContent = '';
  for (const s of SLOTS) {
    const node = document.createElementNS(SVG_NS, 'g');
    node.setAttribute('class', 'slot' + (s.id === FINAL_SLOT ? ' slot-tail' : ''));
    node.setAttribute('data-slot', s.id);
    node.setAttribute('data-value', String(s.v));
    node.setAttribute('transform', `translate(${s.x},${s.y})`);

    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('class', 'chip');
    c.setAttribute('r', s.id === FINAL_SLOT ? '24' : '21');

    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('class', 'num');
    t.setAttribute('y', s.id === FINAL_SLOT ? '8' : '7');
    t.textContent = String(s.v);

    node.appendChild(c);
    node.appendChild(t);
    g.appendChild(node);
  }
  g.addEventListener('click', onSlotClick);
}

function onSlotClick(ev) {
  const node = ev.target.closest('.slot');
  if (!node || !S.state) return;
  const st = S.state;
  const meId = S.me.playerId;

  if (st.status !== 'playing') return;
  if (st.currentId !== meId) { toast('No es tu turno.', 'info'); Sound.error(); return; }
  if (S.viewId !== meId) { setView(meId); toast('Volviste a tu tablero.', 'info'); return; }

  const id = node.getAttribute('data-slot');
  if (!st.turn || !st.turn.placeable.includes(id)) {
    const slot = BY_ID[id];
    const mine = st.players.find((p) => p.id === meId);
    if (mine && mine.board[id]) return;
    if (slot && slot.id === FINAL_SLOT) toast('La cola (valor 3) se completa al final.', 'info');
    else if (slot) toast(`Necesitas ${slot.v} unos para esa posición.`, 'info');
    Sound.error();
    return;
  }

  node.classList.add('is-selected');
  api('place', { slotId: id }).catch((e) => {
    node.classList.remove('is-selected');
    toast(e.message, 'penalty');
    Sound.error();
  });
}

/* ============================================================
   Render
   ============================================================ */

function playerById(st, id) { return st.players.find((p) => p.id === id) || null; }
function initial(name) { return (name || '?').trim().charAt(0).toUpperCase(); }
function playerColor(st, id) {
  const i = st.players.findIndex((p) => p.id === id);
  return 'var(--p' + (((i < 0 ? 0 : i) % 6) + 1) + ')';
}

function setView(id) {
  S.viewId = id;
  S.follow = (S.state && id === S.state.currentId);
  if (S.state) renderBoard(S.state);
  if (S.state) renderPlayers(S.state);
}

/* keepDice: conserva los dados recien aterrizados para no cortar su animacion */
function render(st, keepDice) {
  renderInfo(st);
  renderPlayers(st);
  renderTurnBar(st);
  renderBoard(st);
  if (!keepDice) renderDice(st);
  renderRollPanel(st);
  renderLog(st);
  renderEvent(st);
}

function renderInfo(st) {
  const betting = st.config.bettingEnabled;
  $('infoRoom').textContent = st.id;
  $('infoPlayers').textContent = `${st.players.length} / ${st.config.maxPlayers}`;
  $('infoApuesta').textContent = money(st.config.apuesta);
  $('infoCastigo').textContent = money(st.config.castigo);
  $('infoPot').textContent = money(st.pot);
  ['infoApuesta', 'infoCastigo', 'infoPot'].forEach((id) => {
    $(id).closest('.stat-row').style.display = betting ? '' : 'none';
  });
  $('infoCredits').closest('.stat-row').style.display = 'none';
}

function renderPlayers(st) {
  const list = $('playerList');
  list.textContent = '';

  st.players.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'player-row';
    li.style.setProperty('--p', playerColor(st, p.id));
    if (!p.online) li.classList.add('off');
    if (p.id === st.currentId) li.setAttribute('data-turn', '');
    if (p.id === S.me.playerId) li.setAttribute('data-me', '');
    if (p.id === S.viewId) li.classList.add('is-view');
    li.dataset.pid = p.id;

    li.innerHTML = `
      <span class="avatar">${initial(p.name)}</span>
      <span class="player-info">
        <span class="player-name">${escapeHtml(p.name)}</span>
        <span class="player-meta">${p.filled} / ${st.total} casillas</span>
      </span>
      ${p.id === st.currentId ? '<span class="turn-tag">TURNO</span>' : ''}`;

    li.addEventListener('click', () => { setView(p.id); S.follow = false; });
    list.appendChild(li);
  });
}

/* cuenta atras del turno con pitido desde 10 s (solo en mi turno) */
function renderTurnClock(st) {
  if (!window.GCTurnClock) return;
  GCTurnClock.update({
    element: $('turnClock'),
    deadline: st.turnDeadline,
    now: st.now,
    mine: st.status === 'playing' && st.currentId === S.me.playerId,
    sound: Sound.enabled
  });
}

function renderTurnBar(st) {
  renderTurnClock(st);
  const cur = playerById(st, st.currentId);
  $('turnAvatar').textContent = cur ? initial(cur.name) : '?';
  $('turnAvatar').className = 'avatar avatar-lg';
  $('turnAvatar').style.setProperty('--p', cur ? playerColor(st, cur.id) : 'var(--gold)');

  if (!cur) {
    $('turnName').textContent = st.status === 'finished' ? 'Partida terminada' : '—';
    return;
  }
  const mine = cur.id === S.me.playerId;
  $('turnName').innerHTML = `${escapeHtml(cur.name)} <em>${mine ? '(tú)' : ''}</em>`;
}

function renderBoard(st) {
  const owner = playerById(st, S.viewId) || playerById(st, S.me.playerId);
  if (!owner) return;
  S.viewId = owner.id;

  const mine = owner.id === S.me.playerId;
  const myTurn = st.currentId === S.me.playerId && st.status === 'playing';
  const placeable = myTurn && mine && st.turn ? st.turn.placeable : [];

  $('boardOwner').textContent = mine ? 'Tu tablero' : `Tablero de ${owner.name}`;
  $('boardOwner').classList.toggle('is-mine', mine);
  $('boardProgress').textContent = `${owner.filled} / ${st.total}`;

  const frame = $('boardFrame');
  frame.classList.toggle('is-my-turn', myTurn && mine);
  frame.classList.toggle('is-readonly', !(myTurn && mine));

  const before = S.lastBoards[owner.id] || {};
  const fresh = [];

  for (const node of $('slots').children) {
    const id = node.getAttribute('data-slot');
    const filled = !!owner.board[id];
    const wasFilled = !!before[id];

    node.classList.toggle('is-filled', filled);
    node.classList.toggle('is-available', !filled && placeable.includes(id));
    node.classList.remove('is-selected');

    if (filled && !wasFilled) {
      fresh.push(node);
      node.classList.add('just-placed');
      setTimeout(() => node.classList.remove('just-placed'), 900);
    }
  }

  if (fresh.length) Sound.place();
  S.lastBoards[owner.id] = Object.assign({}, owner.board);
}

/* ---------- dados ---------- */

function dieEl(face, extra) {
  const el = document.createElement('span');
  el.className = `die f${face}${extra ? ' ' + extra : ''}`;
  el.innerHTML = '<i></i>'.repeat(face);
  return el;
}

function renderDice(st, faces) {
  const tray = $('diceTray');
  const t = st.turn;
  tray.textContent = '';

  if (!t || t.rollNo === 0) {
    for (let i = 0; i < 5; i++) tray.appendChild(dieEl(faces ? faces[i] : (i % 6) + 1, 'is-spent'));
    $('diceRemaining').textContent = '5';
    return;
  }

  const lastLog = t.log[t.log.length - 1] || { ones: 0, dice: [] };
  const carried = Math.max(0, t.kept - lastLog.ones);
  const shown = faces || t.dice;

  for (let i = 0; i < carried; i++) tray.appendChild(dieEl(1, 'is-kept is-spent'));
  shown.forEach((d) => tray.appendChild(dieEl(d, d === 1 ? 'is-kept' : '')));

  $('diceRemaining').textContent = String(t.remaining);
}

function animateRoll(st, done) {
  const t = st.turn;
  const lastLog = t.log[t.log.length - 1] || { ones: 0, dice: [] };
  const n = lastLog.dice.length || t.dice.length;
  const carried = Math.max(0, t.kept - lastLog.ones);

  if (S.animTimer) clearTimeout(S.animTimer);
  const myGen = ++S.animGen;
  S.animating = true;
  Sound.dice(n);

  const tray = $('diceTray');
  const started = Date.now();
  const DURATION = 850;

  const tick = () => {
    if (myGen !== S.animGen) return;          /* animación obsoleta */
    tray.textContent = '';
    for (let i = 0; i < carried; i++) tray.appendChild(dieEl(1, 'is-kept is-spent'));
    for (let i = 0; i < n; i++) tray.appendChild(dieEl(1 + Math.floor(Math.random() * 6), 'is-rolling'));

    if (Date.now() - started < DURATION) {
      S.animTimer = setTimeout(tick, 70);
    } else {
      renderDice(st);
      for (const el of tray.children) el.classList.add('is-landing');
      Sound.land();
      const ones = lastLog.ones;
      for (let i = 0; i < ones; i++) setTimeout(() => Sound.hit(0), 180 + i * 120);
      S.animating = false;
      S.animTimer = null;
      done();
    }
  };
  tick();
}

/* ---------- panel de lanzamiento ---------- */

function renderRollPanel(st) {
  const btn = $('btnRoll');
  const sub = $('rollSub');
  const end = $('btnEndTurn');
  const box = $('pendingBox');
  const t = st.turn;
  const myTurn = st.status === 'playing' && st.currentId === S.me.playerId;

  end.classList.add('is-hidden');
  box.classList.add('is-hidden');
  btn.classList.remove('is-hot');

  if (st.status !== 'playing') {
    btn.disabled = true;
    sub.textContent = st.status === 'finished' ? 'Partida terminada' : 'Esperando…';
    return;
  }

  if (!myTurn) {
    const cur = playerById(st, st.currentId);
    btn.disabled = true;
    sub.textContent = cur ? `Turno de ${cur.name}` : 'Esperando…';
    $('diceCaption').textContent = t && t.rollNo
      ? `Lanzamiento ${t.rollNo} de ${cur ? cur.name : '—'}`
      : 'Esperando el primer lanzamiento';
    return;
  }

  if (t.pending > 0) {
    box.classList.remove('is-hidden');
    $('pendingCount').textContent = String(t.pending);
  }

  $('diceCaption').textContent =
    t.rollNo === 0 ? 'Tu turno: lanza los 5 dados' : `Lanzamiento ${t.rollNo}`;

  if (t.phase === 'ending') {
    btn.disabled = true;
    const canPlace = t.pending > 0 && t.placeable && t.placeable.length > 0;
    sub.textContent = canPlace ? 'Ningún 1: coloca tus fichas y termina el turno' : 'Ningún 1: tu turno terminó';
    end.textContent = canPlace ? 'Terminar turno (perderás fichas)' : 'Continuar';
    end.classList.remove('is-hidden');
    return;
  }

  if (t.mustEnd) {
    btn.disabled = true;
    sub.textContent = 'No quedan dados por lanzar';
    end.textContent = t.pending > 0 ? 'Terminar turno (perderás fichas)' : 'Terminar turno';
    end.classList.remove('is-hidden');
    return;
  }

  btn.disabled = false;
  btn.classList.add('is-hot');
  sub.textContent = t.rollNo === 0
    ? 'Lanzas los 5 dados'
    : `Vuelves a lanzar ${t.remaining} dado${t.remaining === 1 ? '' : 's'}`;
}

function renderLog(st) {
  const ul = $('rollLog');
  const t = st.turn;
  ul.textContent = '';

  if (!t || !t.log.length) {
    ul.innerHTML = '<li class="log-empty">Aún no hay lanzamientos.</li>';
    return;
  }

  for (const entry of t.log) {
    const li = document.createElement('li');
    const hits = entry.ones
      ? Array.from({ length: entry.ones }, () => '<i class="hit">1</i>').join('')
      : '<span class="roll-hits none">&ndash;</span>';
    li.innerHTML = `
      <span class="roll-n">${entry.n}</span>
      <span class="roll-vals">${entry.dice.join(' - ')}</span>
      ${entry.ones ? `<span class="roll-hits">${hits}</span>` : hits}`;
    ul.appendChild(li);
  }
}

function renderEvent(st) {
  const last = st.events[st.events.length - 1];
  if (!last) return;
  $('eventText').innerHTML = escapeHtml(last.text)
    .replace(/\$[\d,]+/g, (m) => `<b class="${/pag|castig/i.test(last.text) ? 'val-red' : 'val-gold'}">${m}</b>`);
  $('eventTime').textContent = 'Ahora';
}

/* ============================================================
   Avisos
   ============================================================ */

function toast(text, type) {
  const el = document.createElement('div');
  el.className = 'toast t-' + (type || 'info');
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 320);
  }, 4200);
}

/* en modo independiente (node server.js) no se sirve /shared: sin banner */
const turnFlash = (window.GCTurnBanner && window.GCTurnBanner.show) || (() => {});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============================================================
   Aplicacion del estado recibido
   ============================================================ */

function applyState(st) {
  const first = !S.state;
  S.state = st;                      /* S.state es siempre el estado vigente */

  /* al entrar (o reconectar) los tableros ya existentes no deben "sonar" */
  if (first) for (const p of st.players) S.lastBoards[p.id] = Object.assign({}, p.board);

  /* pantalla correspondiente */
  if (st.status === 'lobby') { renderLobby(st); showScreen('lobby'); return; }

  if ($('screenGame').classList.contains('is-hidden')) {
    showScreen('game');
    S.viewId = S.me.playerId;
  }

  /* si hay una animación en curso, el repintado se hace al terminarla:
     nunca se pinta un estado viejo encima de uno nuevo */
  if (S.animating) { S.dirty = true; return; }

  frame(first);
}

/* pinta el estado vigente; anima si trae un lanzamiento nuevo */
function frame(silent) {
  const st = S.state;
  const rollNo = st.turn ? st.turn.rollNo : 0;
  const newRoll = !!st.turn && rollNo > 0 && rollNo !== S.lastRollNo;
  S.lastRollNo = rollNo;

  if (newRoll && !silent) {
    renderInfo(st); renderPlayers(st); renderTurnBar(st); renderRollPanel(st);
    animateRoll(st, () => {
      if (S.dirty) { S.dirty = false; frame(false); return; }   /* llegó algo nuevo */
      settle(false, true);
    });
    return;
  }

  settle(silent, false);
}

/* cierre de cuadro: siempre sobre S.state */
function settle(silent, keepDice) {
  const st = S.state;
  render(st, keepDice);
  flushEvents(st, silent);
  checkTurnChange(st, silent);
  checkFinish(st);
}

function checkTurnChange(st, silent) {
  if (st.status !== 'playing') return;
  if (st.currentId === S.lastCurrentId) return;
  S.lastCurrentId = st.currentId;
  if (silent) return;

  const cur = playerById(st, st.currentId);
  if (!cur) return;

  if (cur.id === S.me.playerId) {
    turnFlash('¡Es tu turno!');
    Sound.turn();
    if (S.follow || S.viewId !== S.me.playerId) setView(S.me.playerId);
  } else {
    turnFlash(`Turno de ${cur.name}`);
    if (S.follow) setView(cur.id);
  }
}

const TOAST_TYPES = { penalty: 'penalty', reward: 'reward', jackpot: 'jackpot', win: 'win' };

function flushEvents(st, silent) {
  for (const ev of st.events) {
    if (ev.id <= S.lastEventId) continue;
    S.lastEventId = ev.id;
    if (silent) continue;
    if (ev.type === 'turn' || ev.type === 'info') continue;

    toast(ev.text, TOAST_TYPES[ev.type] || 'info');
    if (ev.type === 'penalty') Sound.penalty();
    else if (ev.type === 'reward') Sound.reward();
    else if (ev.type === 'jackpot' || ev.type === 'win') Sound.fanfare();
  }
  renderEvent(st);
}

function checkFinish(st) {
  const modal = $('modalWin');
  if (st.status !== 'finished') { modal.classList.add('is-hidden'); return; }
  if (!modal.classList.contains('is-hidden')) return;

  /* la partida siguiente debe anunciar su primer turno y devolverme a mi tablero */
  S.lastCurrentId = null;
  S.follow = true;

  const winner = playerById(st, st.winnerId);
  const mine = winner && winner.id === S.me.playerId;

  const banner = window.GCVictoryBanner
    ? GCVictoryBanner.text({
        winnerName: winner && winner.name,
        amountWon: st.prize || 0,
        mine,
        fallback: winner ? `${winner.name} completó la partida y se lleva el pozo.` : 'La partida terminó.'
      })
    : { title: mine ? '¡Ganaste!' : 'Fin de la partida', body: winner ? `${winner.name} completó la partida.` : 'La partida terminó.' };
  $('winTitle').textContent = banner.title;
  $('winText').textContent = banner.body;

  const scores = $('winScores');
  scores.textContent = '';
  [...st.players].sort((a, b) => b.credits - a.credits).forEach((p) => {
    const li = document.createElement('li');
    if (p.id === st.winnerId) li.classList.add('is-winner');
    li.innerHTML = `
      <span class="avatar" style="--p:${playerColor(st, p.id)}">${initial(p.name)}</span>
      <span class="sc-name">${escapeHtml(p.name)}${p.id === S.me.playerId ? ' (tú)' : ''}</span>`;
    scores.appendChild(li);
  });

  const isHost = st.hostId === S.me.playerId;
  $('btnRestart').classList.toggle('is-hidden', !isHost);
  $('winWait').classList.toggle('is-hidden', isHost);

  modal.classList.remove('is-hidden');
  $('bug').classList.add('is-winner');
  setTimeout(() => $('bug').classList.remove('is-winner'), 2600);
}

/* ---------- sala de espera ---------- */

function renderLobby(st) {
  const cfg = st.config || {};
  const max = cfg.maxPlayers || 6;
  const cash = (n) => '$' + Number(n || 0).toLocaleString('en-US');

  $('lobbyCode').textContent = st.id;
  $('lobbyCount').textContent = `${st.players.length}/${max}`;
  $('lobbyHint').textContent = `Compártelo con los demás. Máximo ${max} jugadores.`;

  const rows = [
    cfg.bettingEnabled && ['Apuesta inicial', cash(cfg.apuesta), true],
    cfg.bettingEnabled && ['Multa', cash(cfg.castigo)],
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
  $('btnStart').textContent = enough ? 'Iniciar partida' : 'Faltan jugadores (mín. 2)';
  $('lobbyWait').classList.toggle('is-hidden', isHost);
}

/* ============================================================
   Eventos de interfaz
   ============================================================ */

function wire() {
  /* datos que llegan de GameCenter: nombre y apuesta pre-cargados */
  if (GC.name) { $('createName').value = GC.name; $('joinName').value = GC.name; }
  const syncBetting = () => {
    const on = $('cfgBetting').checked;
    $('cfgApuestaWrap').classList.toggle('is-hidden', !on);
    $('cfgCastigoWrap').classList.toggle('is-hidden', !on);
  };
  if (GC.betting) {
    $('cfgBetting').checked = true;
    $('cfgBetting').disabled = true;
    $('cfgApuesta').value = GC.bet;
    $('cfgApuesta').readOnly = true;
    $('cfgCastigo').value = GC.penalty;
    $('cfgCastigo').readOnly = true;
  }
  $('cfgBetting').addEventListener('change', syncBetting);
  syncBetting();

  /* pestañas de inicio */
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-on', t === tab));
      const create = tab.dataset.tab === 'create';
      $('formCreate').classList.toggle('is-hidden', !create);
      $('formJoin').classList.toggle('is-hidden', create);
      $('homeError').classList.add('is-hidden');
    });
  });

  /* crear sala */
  $('formCreate').addEventListener('submit', async (e) => {
    e.preventDefault();
    Sound.init();
    try {
      const res = await api('create', {
        name: $('createName').value,
        config: {
          maxPlayers: Number($('cfgMax').value),
          apuesta: GC.betting ? GC.bet : Number($('cfgApuesta').value),
          castigo: GC.betting ? GC.penalty : Number($('cfgCastigo').value),
          bettingEnabled: GC.betting || $('cfgBetting').checked
        }
      });
      S.me = { roomId: res.roomId, playerId: res.playerId, token: res.token };
      saveSession(S.me);
      connect();
    } catch (err) { showHomeError(err.message); }
  });

  /* unirse */
  $('formJoin').addEventListener('submit', async (e) => {
    e.preventDefault();
    Sound.init();
    try {
      const res = await api('join', {
        name: $('joinName').value,
        roomId: $('joinCode').value.toUpperCase().trim()
      });
      S.me = { roomId: res.roomId, playerId: res.playerId, token: res.token };
      saveSession(S.me);
      connect();
    } catch (err) { showHomeError(err.message); }
  });

  /* sala de espera */
  $('btnCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(S.state ? S.state.id : '');
      $('btnCopy').textContent = '¡Copiado!';
      setTimeout(() => ($('btnCopy').textContent = 'Copiar'), 1600);
    } catch (_) { toast('Copia el código manualmente: ' + (S.state ? S.state.id : ''), 'info'); }
  });

  $('btnStart').addEventListener('click', () => {
    api('start').catch((e) => toast(e.message, 'penalty'));
  });

  $('btnLeaveLobby').addEventListener('click', () => {
    api('leave').catch(() => {}).then(() => leaveToHome());
  });

  /* juego */
  $('btnRoll').addEventListener('click', () => {
    const t = S.state && S.state.turn;
    if (!t) return;

    /* aviso si quedan fichas sin colocar */
    if (t.pending > 0 && t.placeable.length && Date.now() - S.pendingWarn > 6000) {
      S.pendingWarn = Date.now();
      const w = $('rollWarn');
      w.textContent = `Tienes ${t.pending} ficha${t.pending === 1 ? '' : 's'} sin colocar. Vuelve a pulsar para lanzar igualmente.`;
      w.classList.remove('is-hidden');
      Sound.error();
      setTimeout(() => w.classList.add('is-hidden'), 6000);
      return;
    }
    $('rollWarn').classList.add('is-hidden');
    S.pendingWarn = 0;

    $('btnRoll').disabled = true;
    api('roll').catch((e) => { toast(e.message, 'penalty'); Sound.error(); });
  });

  $('btnEndTurn').addEventListener('click', () => {
    api('endturn').catch((e) => toast(e.message, 'penalty'));
  });

  $('btnPrevBoard').addEventListener('click', () => stepBoard(-1));
  $('btnNextBoard').addEventListener('click', () => stepBoard(1));

  $('btnRestart').addEventListener('click', () => {
    api('restart').catch((e) => toast(e.message, 'penalty'));
  });
  $('btnLeaveEnd').addEventListener('click', () => {
    api('leave').catch(() => {}).finally(() => { window.location.href = '/'; });
  });

  $('btnSound').addEventListener('click', () => {
    const on = Sound.toggle();
    $('btnSound').style.opacity = on ? '1' : '.45';
    toast(on ? 'Sonido activado' : 'Sonido silenciado', 'info');
  });

  $('btnExit').addEventListener('click', () => $('modalExit').classList.remove('is-hidden'));
  $('btnExitCancel').addEventListener('click', () => $('modalExit').classList.add('is-hidden'));
  $('btnExitConfirm').addEventListener('click', () => {
    api('leave').catch(() => {}).finally(() => { window.location.href = '/'; });
  });

  $('btnFull').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });

  $('btnRules').addEventListener('click', () => $('modalRules').classList.remove('is-hidden'));
  $('btnCloseRules').addEventListener('click', () => $('modalRules').classList.add('is-hidden'));

  /* atajos */
  document.addEventListener('keydown', (e) => {
    if ($('screenGame').classList.contains('is-hidden')) return;
    if (e.code === 'Space' && !$('btnRoll').disabled) { e.preventDefault(); $('btnRoll').click(); }
    if (e.key === 'Escape') $('modalRules').classList.add('is-hidden');
  });

  /* primer gesto: habilitar audio */
  document.addEventListener('pointerdown', () => Sound.init(), { once: true });
}

function stepBoard(dir) {
  if (!S.state) return;
  const ids = S.state.players.map((p) => p.id);
  const i = Math.max(0, ids.indexOf(S.viewId));
  setView(ids[(i + dir + ids.length) % ids.length]);
  S.follow = false;
}

/* ============================================================
   Arranque
   ============================================================ */

async function boot() {
  buildSlots();
  wire();
  $('btnSound').style.opacity = Sound.enabled ? '1' : '.45';

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
