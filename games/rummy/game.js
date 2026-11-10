/* ============================================================
   RUMMY — cliente del juego
   Estado autoritativo en el servidor; aqui solo se pinta,
   se anima, se arrastra y se suena.
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

const RACK_COLS = 14;
const RACK_ROWS = 3;
const RACK_SLOTS = RACK_COLS * RACK_ROWS;
const COLOR_ORDER = { red: 0, blue: 1, yellow: 2, black: 3, joker: 4 };

let localUidCounter = 0;
const uid = () => 'm' + (++localUidCounter);

/* ============================================================
   Audio — todo sintetizado con WebAudio, sin archivos externos
   ============================================================ */

const Sound = {
  ctx: null,
  enabled: localStorage.getItem('rummy:mute') !== '1',

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

  pickup() { this.init(); this.beep({ freq: 520, duration: 0.045, gain: 0.05 }); },
  place() { this.init(); this.beep({ freq: 300, duration: 0.06, slideTo: 520, gain: 0.07 }); },
  invalid() {
    this.init();
    this.sequence([
      { freq: 180, duration: 0.12, type: 'sawtooth', gain: 0.08 },
      { freq: 120, duration: 0.16, type: 'sawtooth', gain: 0.08, delay: 0.1 }
    ]);
  },
  draw() { this.init(); this.beep({ freq: 420, duration: 0.05, slideTo: 260, gain: 0.06 }); },
  yourTurn() {
    this.init();
    this.sequence([
      { freq: 523.25, duration: 0.08, delay: 0 },
      { freq: 659.25, duration: 0.08, delay: 0.09 },
      { freq: 783.99, duration: 0.14, delay: 0.18 }
    ]);
  },
  tick(urgent) { this.init(); this.beep({ freq: urgent ? 900 : 660, duration: 0.055, gain: urgent ? 0.09 : 0.06 }); },
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

const SESSION_KEY = 'rummy:session';

const S = {
  me: null,              /* {roomId, playerId, token} */
  state: null,
  source: null,
  errors: 0,
  board: [],              /* [{id, tiles:[]}] copia de trabajo */
  rack: Array(RACK_SLOTS).fill(null),
  placed: new Set(),
  drag: null,
  liveBoard: null,
  snapshot: null,
  prevTurnKey: null,
  lastLiveEmit: 0,
  liveTimer: null,
  pendingSend: null,
  lastTickSecond: null,
  lastEventId: 0,
  lastCurrentId: null,
  finishShownFor: null,
  turnTime: 120
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

  src.addEventListener('liveBoard', (e) => {
    try {
      const melds = JSON.parse(e.data);
      S.liveBoard = melds.map((tiles) => ({ id: uid(), tiles }));
      renderBoard();
    } catch (err) { console.error(err); }
  });

  src.onerror = () => {
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
  S.me = null; S.state = null;
  S.board = []; S.rack = Array(RACK_SLOTS).fill(null); S.placed = new Set();
  S.drag = null; S.liveBoard = null; S.snapshot = null; S.prevTurnKey = null;
  S.lastEventId = 0; S.lastCurrentId = null; S.finishShownFor = null;
  $('modalGameOver').classList.add('is-hidden');
  $('modalExit').classList.add('is-hidden');
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

function fmt(s) {
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}

function isMyTurn(st) {
  return !!st && st.status === 'playing' && st.currentId === S.me.playerId;
}

/* ============================================================
   Reglas de acomodo (puro, sin red)
   ============================================================ */

function isRunMeld(tiles) {
  const nonJoker = tiles.filter((t) => !t.joker);
  if (nonJoker.length < 2) return false;
  return new Set(nonJoker.map((t) => t.color)).size === 1;
}

/* si las fichas forman una escalera (mismo color, numeros distintos), las
   devuelve ordenadas ascendente con los comodines rellenando huecos.
   En cualquier otro caso (grupos, mezclas invalidas) las deja igual */
function sortRunMeld(tiles) {
  const jokers = tiles.filter((t) => t.joker);
  const rest = tiles.filter((t) => !t.joker);
  if (rest.length < 2) return tiles;

  const colors = new Set(rest.map((t) => t.color));
  if (colors.size !== 1) return tiles;

  const nums = new Set(rest.map((t) => t.num));
  if (nums.size !== rest.length) return tiles;

  const sorted = [...rest].sort((a, b) => a.num - b.num);
  const min = sorted[0].num;
  const max = sorted[sorted.length - 1].num;

  const firstRestIdx = tiles.findIndex((t) => !t.joker);
  const leadingJokers = tiles.slice(0, firstRestIdx).filter((t) => t.joker).length;

  const pool = [...jokers];
  const seq = [];
  for (let n = min; n <= max; n++) {
    const t = sorted.find((x) => x.num === n);
    if (t) seq.push(t);
    else if (pool.length) seq.push(pool.pop());
    else return tiles;
  }
  let hi = max;
  let lo = min;
  let lead = Math.min(leadingJokers, pool.length);
  while (lead > 0 && lo > 1) {
    lo--;
    seq.unshift(pool.pop());
    lead--;
  }
  while (pool.length) {
    if (hi < 13) {
      hi++;
      seq.push(pool.pop());
    } else if (lo > 1) {
      lo--;
      seq.unshift(pool.pop());
    } else {
      seq.push(...pool);
      break;
    }
  }
  return seq;
}

/* ============================================================
   Fichas (DOM)
   ============================================================ */

function jokerFaceSvg() {
  return `<svg class="joker-face" viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="2.4"/>
    <circle cx="11.5" cy="13" r="2" fill="currentColor"/>
    <circle cx="20.5" cy="13" r="2" fill="currentColor"/>
    <path d="M10 19.5c1.8 2.6 4 3.8 6 3.8s4.2-1.2 6-3.8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
  </svg>`;
}

function buildTile(tile, opts) {
  opts = opts || {};
  const el = document.createElement('div');
  const cls = ['tile', tile.joker ? 't-joker' : 't-' + tile.color];
  if (opts.dragging) cls.push('dragging-src');
  if (opts.ghost) cls.push('drag-ghost');
  if (opts.placed) cls.push('just-placed');
  if (opts.locked) cls.push('locked');
  el.className = cls.join(' ');

  const face = document.createElement('div');
  face.className = 'tile-face';
  face.innerHTML = (tile.joker ? jokerFaceSvg() : `<span class="num">${tile.num}</span>`) + '<span class="pip"></span>';
  el.appendChild(face);

  if (!opts.ghost && opts.from) {
    el.addEventListener('pointerdown', (e) => startDrag(e, tile, opts.from));
  }
  return el;
}

/* ============================================================
   Render
   ============================================================ */

/* st.hand del servidor no se actualiza hasta terminar el turno: mientras
   arrastro fichas a la mesa, los eventos de liveBoard siguen trayendo mi
   mano completa. Hay que excluir las que ya tengo colocadas en S.board
   para no reinsertarlas en el atril y duplicarlas al terminar turno. */
function mergeRack(hand) {
  const boardIds = new Set(S.board.flatMap((m) => m.tiles.map((t) => t.id)));
  const handIds = new Set(hand.map((t) => t.id).filter((id) => !boardIds.has(id)));
  const next = S.rack.map((t) => (t && handIds.has(t.id) ? t : null));
  const present = new Set(next.filter(Boolean).map((t) => t.id));
  for (const t of hand) {
    if (boardIds.has(t.id) || present.has(t.id)) continue;
    const free = next.indexOf(null);
    if (free === -1) break;
    next[free] = t;
  }
  S.rack = next;
}

function renderTopbar(st) {
  const row = $('playersRow');
  row.textContent = '';
  st.players.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'chip' +
      (p.isTurn ? ' active' : '') +
      (!p.online ? ' off' : '') +
      (p.id === S.me.playerId ? ' you' : '');
    div.style.setProperty('--p', 'var(--p' + ((i % 6) + 1) + ')');
    div.innerHTML =
      `<span class="chip-avatar">${initial(p.name)}</span>` +
      `<span class="chip-name">${escapeHtml(p.name)}</span><span class="chip-count">${p.tiles}</span>` +
      (!p.hasMelded ? '<span class="chip-lock" title="Sin bajada inicial">30</span>' : '');
    row.appendChild(div);
  });
  $('potCount').textContent = st.potCount;
}

function initial(name) { return (name || '?').trim().charAt(0).toUpperCase(); }

function renderBoard() {
  const st = S.state;
  if (!st) return;
  const myTurn = isMyTurn(st);
  const shown = myTurn ? S.board : (S.liveBoard || S.board);

  $('screenGame').dataset.drag = S.drag ? '1' : '0';

  const inner = $('boardInner');
  inner.textContent = '';
  const meHasMelded = (st.players.find((p) => p.id === S.me.playerId) || {}).hasMelded;

  shown.forEach((meld, mi) => {
    const meldEl = document.createElement('div');
    meldEl.className = 'meld';
    meld.tiles.forEach((t, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'slot-wrap';
      wrap.dataset.drop = `meld:${mi}:${i}`;
      wrap.appendChild(buildTile(t, {
        dragging: S.drag && S.drag.tile.id === t.id,
        placed: S.placed.has(t.id),
        locked: myTurn && !meHasMelded && !S.placed.has(t.id),
        from: { type: 'meld', meldIndex: mi, index: i }
      }));
      meldEl.appendChild(wrap);
    });
    const tail = document.createElement('div');
    tail.className = 'meld-tail';
    tail.dataset.drop = `meld:${mi}:${meld.tiles.length}`;
    meldEl.appendChild(tail);
    inner.appendChild(meldEl);
  });

  if (S.drag) {
    const hint = document.createElement('div');
    hint.className = 'newmeld-hint';
    hint.dataset.drop = 'newmeld';
    hint.textContent = '+ Nueva combinación';
    inner.appendChild(hint);
  }

  if (shown.length === 0 && !S.drag) {
    const empty = document.createElement('div');
    empty.className = 'board-empty';
    const activePlayer = st.players.find((p) => p.id === st.currentId);
    empty.textContent = myTurn
      ? 'Arrastra fichas aquí para formar grupos o escaleras'
      : (activePlayer ? `Turno de ${activePlayer.name}…` : '');
    inner.appendChild(empty);
  }

  renderGhost();
}

function renderRack() {
  const st = S.state;
  const myTurn = isMyTurn(st);
  const rackEl = $('rack');
  rackEl.classList.toggle('my-turn', myTurn);
  rackEl.textContent = '';
  S.rack.forEach((t, i) => {
    const slot = document.createElement('div');
    slot.className = 'rack-slot';
    slot.dataset.drop = `rack:${i}`;
    if (t) {
      slot.appendChild(buildTile(t, {
        dragging: S.drag && S.drag.tile.id === t.id,
        from: { type: 'rack', index: i }
      }));
    }
    rackEl.appendChild(slot);
  });
  renderFooterButtons(st, myTurn);
}

function renderFooterButtons(st, myTurn) {
  $('btnUndo').disabled = !myTurn || S.placed.size === 0;
  $('btnDraw').disabled = !myTurn || !st || st.potCount === 0;
  $('btnEndTurn').disabled = !myTurn || S.placed.size === 0;
  const value = S.rack.filter(Boolean).reduce((s, t) => s + (t.joker ? 10 : t.num), 0);
  $('handValue').textContent = value + ' pts';
}

function renderGhost() {
  let layer = document.getElementById('ghostLayer');
  if (!S.drag) { if (layer) layer.remove(); return; }
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'ghostLayer';
    layer.className = 'ghost-layer';
    document.body.appendChild(layer);
  }
  layer.style.width = S.drag.w + 'px';
  layer.style.height = S.drag.h + 'px';
  layer.style.transform = `translate(${S.drag.x - S.drag.dx}px, ${S.drag.y - S.drag.dy}px)`;
  layer.textContent = '';
  layer.appendChild(buildTile(S.drag.tile, { ghost: true }));
}

/* ---------- sala de espera ---------- */

function renderLobby(st) {
  const cfg = st.config || {};
  const max = cfg.maxPlayers || 4;
  const cash = (n) => '$' + Number(n || 0).toLocaleString('en-US');

  $('lobbyCode').textContent = st.id;
  $('lobbyCount').textContent = `${st.players.length}/${max}`;
  $('lobbyHint').textContent = `Compártelo con los demás. Máximo ${max} jugadores.`;

  const rows = [
    ['Nivel', (cfg.turnSeconds || 120) + 's / turno', true],
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
   Reloj de turno
   ============================================================ */

function tickClock() {
  const st = S.state;
  const box = $('timerBox');
  if (!st || st.status !== 'playing' || !st.turnDeadline) {
    box.classList.add('is-hidden');
    return;
  }
  const remaining = Math.max(0, Math.ceil((st.turnDeadline - Date.now()) / 1000));
  box.classList.remove('is-hidden');
  box.textContent = fmt(remaining);
  box.classList.toggle('danger', remaining <= 15);

  const myTurn = isMyTurn(st);
  if (myTurn && remaining <= 10 && remaining >= 1 && S.lastTickSecond !== remaining) {
    S.lastTickSecond = remaining;
    Sound.tick(remaining <= 5);
  }
  /* si el turno esta por acabar, envia ya el ultimo liveBoard pendiente
     para que el servidor pueda aceptarlo si el reloj llega a cero */
  if (myTurn && S.pendingSend && st.turnDeadline - Date.now() <= 1000) {
    clearTimeout(S.liveTimer);
    const fn = S.pendingSend;
    S.pendingSend = null;
    fn();
  }
}

/* ============================================================
   Arrastre (pointer events => funciona con touch)
   ============================================================ */

function startDrag(e, tile, from) {
  const st = S.state;
  if (!st) return;
  const myTurn = isMyTurn(st);
  if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
  if (from.type === 'meld') {
    if (!myTurn) return;
    const meHasMelded = (st.players.find((p) => p.id === S.me.playerId) || {}).hasMelded;
    if (!meHasMelded && !S.placed.has(tile.id)) {
      toast('Antes de tu primera bajada (30 pts) no puedes tocar la mesa.', 'error');
      return;
    }
  }
  e.preventDefault();
  Sound.pickup();
  const rect = e.currentTarget.getBoundingClientRect();
  S.drag = {
    tile, from,
    x: e.clientX, y: e.clientY,
    dx: e.clientX - rect.left, dy: e.clientY - rect.top,
    w: rect.width, h: rect.height
  };
  renderBoard();
  renderRack();
}

function nearestMeldWithin(x, y, margin) {
  const tails = document.querySelectorAll('.meld-tail[data-drop]');
  let best = null;
  let bestDist = margin;
  for (const tail of tails) {
    const r = tail.getBoundingClientRect();
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const dist = Math.hypot(dx, dy);
    if (dist <= bestDist) { bestDist = dist; best = tail; }
  }
  return best;
}

function finishDrag(x, y) {
  const d = S.drag;
  S.drag = null;
  if (!d) { renderBoard(); renderRack(); return; }

  let el = document.elementFromPoint(x, y)?.closest('[data-drop]');
  if (el?.getAttribute('data-drop') === 'newmeld') {
    const near = nearestMeldWithin(x, y, 28);
    if (near) el = near;
  }
  if (!el) { renderBoard(); renderRack(); return; }

  const spec = el.getAttribute('data-drop');
  const rect = el.getBoundingClientRect();
  let to = null;

  if (spec === 'newmeld') to = { type: 'newmeld' };
  else if (spec.startsWith('rack:')) to = { type: 'rack', index: +spec.slice(5) };
  else if (spec.startsWith('meld:')) {
    const [, mi, pos] = spec.split(':');
    let p = +pos;
    if (el.classList.contains('slot-wrap') && x > rect.left + rect.width / 2) p++;
    to = { type: 'meld', meldIndex: +mi, pos: p };
  }
  if (!to) { renderBoard(); renderRack(); return; }

  const st = S.state;
  const myTurn = isMyTurn(st);
  if (to.type !== 'rack' && !myTurn) {
    toast('No es tu turno.', 'error');
    renderBoard(); renderRack();
    return;
  }
  if (d.from.type === 'meld' && to.type === 'rack' && !S.placed.has(d.tile.id)) {
    toast('Solo puedes devolver a tu atril fichas que colocaste este turno.', 'error');
    renderBoard(); renderRack();
    return;
  }
  applyMove(d.from, to, d.tile);
}

function applyMove(from, to, tile) {
  let b = S.board.map((m) => ({ id: m.id, tiles: m.tiles.slice() }));
  const r = S.rack.slice();
  const p = new Set(S.placed);

  if (from.type === 'rack' && to.type === 'rack' && from.index === to.index) { renderBoard(); renderRack(); return; }
  if (from.type === 'meld' && to.type === 'meld' && from.meldIndex === to.meldIndex &&
      (to.pos === from.index || to.pos === from.index + 1)) { renderBoard(); renderRack(); return; }

  let splitTiles = null;
  if (from.type === 'rack') {
    r[from.index] = null;
  } else {
    const meldTiles = b[from.meldIndex].tiles;
    const stayingInSameMeld = to.type === 'meld' && to.meldIndex === from.meldIndex;
    const removedAtEdge = from.index === 0 || from.index === meldTiles.length - 1;
    const wasRun = !stayingInSameMeld && !removedAtEdge && isRunMeld(meldTiles);
    meldTiles.splice(from.index, 1);
    if (wasRun && meldTiles.length > 0) splitTiles = meldTiles.splice(from.index);
  }

  if (to.type === 'meld') {
    let pos = to.pos;
    if (from.type === 'meld' && from.meldIndex === to.meldIndex && from.index < pos) pos--;
    b[to.meldIndex].tiles.splice(pos, 0, tile);
    b[to.meldIndex].tiles = sortRunMeld(b[to.meldIndex].tiles);
  } else if (to.type === 'newmeld') {
    b.push({ id: uid(), tiles: [tile] });
  } else {
    const displaced = r[to.index];
    r[to.index] = tile;
    if (displaced) {
      if (from.type === 'rack') {
        r[from.index] = displaced;
      } else {
        const free = r.indexOf(null);
        if (free === -1) { toast('Atril lleno.', 'error'); renderBoard(); renderRack(); return; }
        r[free] = displaced;
      }
    }
  }

  if (splitTiles && splitTiles.length > 0) b.push({ id: uid(), tiles: splitTiles });
  b = b.filter((m) => m.tiles.length > 0);

  if (from.type === 'rack' && to.type !== 'rack') p.add(tile.id);
  if (from.type === 'meld' && to.type === 'rack') p.delete(tile.id);

  if (to.type === 'meld' || to.type === 'newmeld') Sound.place();

  S.board = b;
  S.rack = r;
  S.placed = p;

  if (isMyTurn(S.state)) emitLive(b, r);
  renderBoard();
  renderRack();
}

function emitLive(b, r) {
  const send = () => {
    S.lastLiveEmit = Date.now();
    S.pendingSend = null;
    api('liveBoard', {
      board: b.map((m) => m.tiles.map((t) => t.id)),
      hand: (r || S.rack).filter(Boolean).map((t) => t.id)
    }).catch(() => {});
  };
  clearTimeout(S.liveTimer);
  const elapsed = Date.now() - S.lastLiveEmit;
  if (elapsed > 200) send();
  else { S.pendingSend = send; S.liveTimer = setTimeout(send, 220 - elapsed); }
}

/* ============================================================
   Acciones
   ============================================================ */

function undo() {
  const st = S.state;
  if (!isMyTurn(st) || !S.snapshot) return;
  const snap = S.snapshot;
  S.board = snap.board.map((tiles) => ({ id: uid(), tiles: tiles.slice() }));
  S.placed = new Set();

  const handIds = new Set(snap.hand.map((t) => t.id));
  const next = S.rack.map((t) => (t && handIds.has(t.id) ? t : null));
  const present = new Set(next.filter(Boolean).map((t) => t.id));
  for (const t of snap.hand) {
    if (present.has(t.id)) continue;
    const free = next.indexOf(null);
    if (free !== -1) next[free] = t;
  }
  S.rack = next;

  emitLive(S.board, S.rack);
  renderBoard();
  renderRack();
}

function endTurn() {
  if (!isMyTurn(S.state)) return;
  api('endTurn', {
    board: S.board.map((m) => m.tiles.map((t) => t.id)),
    hand: S.rack.filter(Boolean).map((t) => t.id)
  }).catch((e) => { toast(e.message, 'error'); Sound.invalid(); });
}

function draw() {
  if (!isMyTurn(S.state)) return;
  if (S.placed.size > 0) undo();
  const handIds = (S.snapshot ? S.snapshot.hand : S.rack.filter(Boolean)).map((t) => t.id);
  Sound.draw();
  api('drawTile', { hand: handIds }).catch((e) => toast(e.message, 'error'));
}

function toggleMute() {
  Sound.enabled = !Sound.enabled;
  localStorage.setItem('rummy:mute', Sound.enabled ? '0' : '1');
  $('iconSoundOn').classList.toggle('is-hidden', !Sound.enabled);
  $('iconSoundOff').classList.toggle('is-hidden', Sound.enabled);
  if (Sound.enabled) Sound.init();
}

function sortRack(mode) {
  const tiles = S.rack.filter(Boolean);
  tiles.sort((a, b) => {
    if (a.joker !== b.joker) return a.joker ? 1 : -1;
    if (mode === 'runs') return COLOR_ORDER[a.color] - COLOR_ORDER[b.color] || a.num - b.num;
    return a.num - b.num || COLOR_ORDER[a.color] - COLOR_ORDER[b.color];
  });
  const next = Array(RACK_SLOTS).fill(null);
  tiles.forEach((t, i) => (next[i] = t));
  S.rack = next;
  renderRack();
}

/* ============================================================
   Aplicacion del estado recibido
   ============================================================ */

function applyState(st) {
  S.state = st;

  if (st.status === 'lobby') { renderLobby(st); showScreen('lobby'); return; }

  if ($('screenGame').classList.contains('is-hidden')) showScreen('game');

  const myTurn = isMyTurn(st);

  mergeRack(st.hand);

  const turnKey = `${st.currentId}:${st.status}:${st.turnDeadline}`;
  const isNewTurn = S.prevTurnKey !== turnKey;
  S.prevTurnKey = turnKey;

  if (isNewTurn && myTurn) { Sound.yourTurn(); S.lastTickSecond = null; }

  if (!myTurn || isNewTurn) {
    S.board = st.board.map((tiles) => ({ id: uid(), tiles: tiles.slice() }));
    S.placed = new Set();
    if (isNewTurn) S.liveBoard = null;
    if (myTurn) S.snapshot = { board: st.board.map((tiles) => tiles.slice()), hand: st.hand.slice() };
  }

  renderTopbar(st);
  renderBoard();
  renderRack();

  checkTurnChange(st);
  flushEvents(st);
  checkFinish(st);
}

function checkTurnChange(st) {
  if (st.status !== 'playing') { S.lastCurrentId = null; return; }
  if (st.currentId === S.lastCurrentId) return;
  S.lastCurrentId = st.currentId;
  const cur = st.players.find((p) => p.id === st.currentId);
  if (!cur || !window.GCTurnBanner) return;
  GCTurnBanner.show(cur.id === S.me.playerId ? '¡Es tu turno!' : `Turno de ${cur.name}`);
}

function flushEvents(st) {
  for (const ev of st.events) {
    if (ev.id <= S.lastEventId) continue;
    S.lastEventId = ev.id;
    if (ev.type === 'turn') continue;
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

  const mine = st.result.winnerId === S.me.playerId;
  if (mine) Sound.win(); else Sound.lose();

  const banner = window.GCVictoryBanner
    ? GCVictoryBanner.text({ winnerName: st.result.winnerName, amountWon: st.result.prize || 0, mine, fallback: st.result.reason })
    : { title: mine ? '¡GANASTE!' : `${st.result.winnerName} ganó`, body: st.result.reason };

  $('goTitle').textContent = banner.title;
  $('goBody').textContent = banner.body;
  $('goPrizeReason').classList.toggle('is-hidden', !(st.result.prize > 0));
  $('goPrizeReason').textContent = st.result.reason;

  const tbody = $('goScores');
  tbody.textContent = '';
  [...st.result.scores].sort((a, b) => a.points - b.points).forEach((s) => {
    const tr = document.createElement('tr');
    if (s.id === st.result.winnerId) tr.classList.add('winner');
    tr.innerHTML = `<td>${escapeHtml(s.name)}${s.id === S.me.playerId ? ' (tú)' : ''}</td><td>${s.points} pts</td>`;
    tbody.appendChild(tr);
  });

  const isHost = st.hostId === S.me.playerId;
  $('btnRestart').classList.toggle('is-hidden', !isHost);
  modal.classList.remove('is-hidden');
}

/* ============================================================
   Eventos de interfaz
   ============================================================ */

async function doCreate() {
  const name = $('nameInput').value.trim();
  if (!name) return showHomeError('Escribe tu nombre.');
  localStorage.setItem('rummy:name', name);
  Sound.init();
  try {
    const res = await api('create', {
      name,
      config: { turnSeconds: S.turnTime, bettingEnabled: GC.betting, apuesta: GC.betting ? GC.bet : 0 }
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
    const saved = localStorage.getItem('rummy:name');
    if (saved) $('nameInput').value = saved;
  }
  if (GC.betting) {
    $('bettingInfo').classList.remove('is-hidden');
    $('bettingAmount').textContent = '$' + GC.bet.toLocaleString('en-US');
  }

  $('levelPicker').querySelectorAll('.level-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('levelPicker').querySelectorAll('.level-opt').forEach((b) => {
        b.classList.toggle('selected', b === btn);
        b.setAttribute('aria-checked', b === btn ? 'true' : 'false');
      });
      S.turnTime = Number(btn.dataset.seconds);
    });
  });

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

  $('btnSortGroups').addEventListener('click', () => sortRack('groups'));
  $('btnSortRuns').addEventListener('click', () => sortRack('runs'));
  $('btnUndo').addEventListener('click', undo);
  $('btnDraw').addEventListener('click', draw);
  $('btnEndTurn').addEventListener('click', endTurn);

  $('btnCloseGameOver').addEventListener('click', () => {
    $('modalGameOver').classList.add('is-hidden');
    api('leave').catch(() => {}).finally(() => { window.location.href = '/'; });
  });
  $('btnRestart').addEventListener('click', () => {
    api('restart').catch((e) => toast(e.message, 'error'));
    $('modalGameOver').classList.add('is-hidden');
  });

  window.addEventListener('pointermove', (e) => {
    if (!S.drag) return;
    e.preventDefault();
    S.drag.x = e.clientX; S.drag.y = e.clientY;
    renderGhost();
  }, { passive: false });
  window.addEventListener('pointerup', (e) => { if (S.drag) finishDrag(e.clientX, e.clientY); });
  window.addEventListener('pointercancel', () => { S.drag = null; renderBoard(); renderRack(); });

  document.addEventListener('pointerdown', () => Sound.init(), { once: true });
  setInterval(tickClock, 500);
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
