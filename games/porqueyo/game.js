/* ============================================================
   ¿POR QUÉ SIEMPRE YO? — cliente del juego
   Estado autoritativo en el servidor; aqui solo se pinta,
   se anima y se suena.
   ============================================================ */
(function () {
'use strict';

const { ZONES } = window.PorqueyoZones;
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

/* ============================================================
   Audio — todo sintetizado con WebAudio, sin archivos externos
   ============================================================ */

const Sound = {
  ctx: null,
  enabled: localStorage.getItem('porqueyo:mute') !== '1',

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

  dice() {
    this.init(); if (!this.enabled || !this.ctx) return;
    const t = this.t;
    for (let i = 0; i < 9; i++) {
      const at = t + Math.random() * 0.7;
      this.noise(at, 0.05, { gain: 0.1, freq: 900 + Math.random() * 1600, q: 2 });
    }
  },

  land() {
    this.init(); if (!this.enabled || !this.ctx) return;
    const t = this.t;
    this.noise(t, 0.07, { gain: 0.16, freq: 700, q: 1.5 });
    this.tone(180, t, 0.09, { type: 'triangle', gain: 0.12, to: 120 });
  },

  place() {
    this.init(); if (!this.enabled || !this.ctx) return;
    const t = this.t;
    this.tone(520, t, 0.14, { type: 'sine', gain: 0.28, to: 880 });
    this.noise(t, 0.05, { gain: 0.08, freq: 2400, q: 3 });
  },

  steal() {
    this.init(); if (!this.enabled || !this.ctx) return;
    const t = this.t;
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone(f, t + i * 0.08, 0.2, { type: 'square', gain: 0.13 }));
  },

  success() {
    this.init(); if (!this.enabled || !this.ctx) return;
    const t = this.t;
    [659, 880, 1175].forEach((f, i) =>
      this.tone(f, t + i * 0.09, 0.22, { type: 'triangle', gain: 0.2 }));
    this.noise(t + 0.24, 0.15, { gain: 0.05, freq: 4200, q: 0.8 });
  },

  turn() {
    this.init(); if (!this.enabled || !this.ctx) return;
    const t = this.t;
    this.tone(784, t, 0.3, { type: 'sine', gain: 0.16 });
    this.tone(1175, t + 0.09, 0.32, { type: 'sine', gain: 0.11 });
  },

  win() {
    this.init(); if (!this.enabled || !this.ctx) return;
    const t = this.t;
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => {
      this.tone(f, t + i * 0.1, 0.5, { type: 'triangle', gain: 0.2 });
      this.tone(f * 2, t + i * 0.1, 0.3, { type: 'sine', gain: 0.06 });
    });
    this.noise(t + 0.6, 0.5, { gain: 0.06, freq: 5200, q: 0.7 });
  },

  error() {
    this.init(); if (!this.enabled || !this.ctx) return;
    this.tone(140, this.t, 0.15, { type: 'square', gain: 0.14, to: 90 });
  },

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('porqueyo:mute', this.enabled ? '0' : '1');
    if (this.enabled) { this.init(); this.turn(); }
    return this.enabled;
  }
};

/* ============================================================
   Sesion y red
   ============================================================ */

const SESSION_KEY = 'porqueyo:session';

const S = {
  me: null,
  state: null,
  prevBoard: null,
  prevMarbles: {},
  lastTurnSeq: 0,
  lastCurrentId: null,
  lastEventId: 0,
  animating: false,
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
  S.me = null; S.state = null; S.prevBoard = null; S.prevMarbles = {};
  S.lastTurnSeq = 0; S.lastCurrentId = null; S.lastEventId = 0; S.animating = false;
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
   Tablero — construccion (geometria identica a index.html)
   ============================================================ */

const SVG_NS = 'http://www.w3.org/2000/svg';
const CX = 300, CY = 300;
const R_OUTER = 296, R_RIM_INNER = 244, R_SECTOR_INNER = 150, R_RING_INNER = 112, R_BLACK = 112;
const GAP_DEG = 3, CORNER = 15;
const BEZEL_R = 31, PIT_R = 25, MARBLE_R = 21.5;

const ZONE_VISUAL = {
  white:  { base: '#e7dcc2', light: '#f7efd9', dark: '#c9b98f', marble: 'marble-white' },
  yellow: { base: '#b9861c', light: '#e0b23f', dark: '#7c5710', marble: 'marble-yellow' },
  blue:   { base: '#1f4d78', light: '#3f79ae', dark: '#122c46', marble: 'marble-blue' },
  green:  { base: '#33591f', light: '#5c8a37', dark: '#1c3210', marble: 'marble-green' },
  red:    { base: '#7a231c', light: '#a8392c', dark: '#4a130e', marble: 'marble-red' }
};

const toRad = (deg) => (deg * Math.PI) / 180;
function polar(angleDeg, r) {
  const a = toRad(angleDeg);
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
}
function arcPathAbs(cx, cy, r, a0, a1) {
  const p0 = [cx + r * Math.sin(toRad(a0)), cy - r * Math.cos(toRad(a0))];
  const p1 = [cx + r * Math.sin(toRad(a1)), cy - r * Math.cos(toRad(a1))];
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${p0[0]} ${p0[1]} A ${r} ${r} 0 ${large} 1 ${p1[0]} ${p1[1]}`;
}
const LIGHT_A0 = -115, LIGHT_A1 = 25;
const SHADE_A0 = 65, SHADE_A1 = 205;

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}

function roundedWedgePath(a0, a1, rOuter, rInner, corner) {
  const dOuter = (corner / rOuter) * (180 / Math.PI);
  const dInner = (corner / rInner) * (180 / Math.PI);
  const oStartArc = polar(a0 + dOuter, rOuter);
  const oStartEdge = polar(a0, rOuter - corner);
  const oEndArc = polar(a1 - dOuter, rOuter);
  const oEndEdge = polar(a1, rOuter - corner);
  const iEndArc = polar(a1 - dInner, rInner);
  const iEndEdge = polar(a1, rInner + corner);
  const iStartArc = polar(a0 + dInner, rInner);
  const iStartEdge = polar(a0, rInner + corner);
  return [
    `M ${oStartArc[0]} ${oStartArc[1]}`,
    `A ${rOuter} ${rOuter} 0 0 1 ${oEndArc[0]} ${oEndArc[1]}`,
    `A ${corner} ${corner} 0 0 1 ${oEndEdge[0]} ${oEndEdge[1]}`,
    `L ${iEndEdge[0]} ${iEndEdge[1]}`,
    `A ${corner} ${corner} 0 0 1 ${iEndArc[0]} ${iEndArc[1]}`,
    `A ${rInner} ${rInner} 0 0 0 ${iStartArc[0]} ${iStartArc[1]}`,
    `A ${corner} ${corner} 0 0 1 ${iStartEdge[0]} ${iStartEdge[1]}`,
    `L ${oStartEdge[0]} ${oStartEdge[1]}`,
    `A ${corner} ${corner} 0 0 1 ${oStartArc[0]} ${oStartArc[1]}`,
    'Z'
  ].join(' ');
}

const holesByZone = {};   /* zoneId -> [{marbleGroup}] en orden de llenado */
let centerMarbleNode = null;

function buildBoard() {
  const svg = $('board-svg');
  svg.textContent = '';

  const defs = svgEl('defs', {});
  svg.appendChild(defs);

  function radial(id, stops, cx, cy, r) {
    const g = svgEl('radialGradient', { id, cx: cx ?? '38%', cy: cy ?? '28%', r: r ?? '75%' });
    stops.forEach(([off, color, op]) => {
      g.appendChild(svgEl('stop', { offset: off, 'stop-color': color, 'stop-opacity': op ?? 1 }));
    });
    defs.appendChild(g);
    return `url(#${id})`;
  }

  const woodRim = radial('wood-rim', [
    ['0%', '#a9754a'], ['35%', '#8a5a34'], ['70%', '#5c3a20'], ['100%', '#331e0f']
  ], '35%', '22%', '85%');
  const woodGap = radial('wood-gap', [['0%', '#7c5330'], ['100%', '#4a3018']], '40%', '30%', '90%');
  const blackDisc = radial('black-disc', [
    ['0%', '#3c352c'], ['45%', '#221d17'], ['100%', '#0d0a07']
  ], '42%', '34%', '80%');
  const bezelGrad = radial('hole-bezel', [
    ['0%', '#6b492b'], ['55%', '#432c18'], ['100%', '#1c1109']
  ], '35%', '25%', '80%');
  const pitGrad = radial('hole-pit', [['0%', '#150f0a'], ['70%', '#000000'], ['100%', '#000000']], '45%', '38%', '75%');

  const fillId = {};
  ZONES.forEach((z) => {
    const v = ZONE_VISUAL[z.id];
    fillId[z.id] = radial(`fill-${z.id}`, [['0%', v.light], ['55%', v.base], ['100%', v.dark]], '36%', '24%', '78%');
  });

  const marbleColors = {
    'marble-white':  ['#ffffff', '#efe4cd', '#b6a88f', '#7b7060'],
    'marble-yellow': ['#ffe9a4', '#f2b91f', '#b57c0b', '#7a5205'],
    'marble-blue':   ['#8fc4f5', '#2a72c4', '#1a4a86', '#0f2f57'],
    'marble-green':  ['#b0dd7c', '#4f8f27', '#34641a', '#1f3f0e'],
    'marble-red':    ['#f19a8c', '#c0392b', '#86251a', '#521309'],
    'marble-black':  ['#5c5650', '#231f1a', '#100d0a', '#000000']
  };
  const marbleFill = {};
  Object.keys(marbleColors).forEach((key) => {
    const [c0, c1, c2, c3] = marbleColors[key];
    marbleFill[key] = radial(key, [['0%', c0], ['42%', c1], ['78%', c2], ['100%', c3]], '34%', '26%', '72%');
  });

  const lightSheen = radial('light-sheen', [
    ['0%', '#fff6e2', 0.75], ['40%', '#fff6e2', 0.18], ['100%', '#fff6e2', 0]
  ], '26%', '16%', '78%');
  const shadowSheen = radial('shadow-sheen', [
    ['0%', '#000000', 0], ['55%', '#000000', 0.12], ['100%', '#000000', 0.42]
  ], '80%', '82%', '78%');

  const grainFilter = svgEl('filter', { id: 'grain', x: '-20%', y: '-20%', width: '140%', height: '140%' });
  grainFilter.appendChild(svgEl('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.022 0.1', numOctaves: '4', seed: '11', result: 'n' }));
  grainFilter.appendChild(svgEl('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.33 0.33 0.34 0 -0.12', result: 'a' }));
  const grainBoost = svgEl('feComponentTransfer', { in: 'a' });
  grainBoost.appendChild(svgEl('feFuncA', { type: 'linear', slope: '1.5', intercept: '-0.22' }));
  grainFilter.appendChild(grainBoost);
  defs.appendChild(grainFilter);

  const blurFilter = svgEl('filter', { id: 'soft-blur', x: '-60%', y: '-60%', width: '220%', height: '220%' });
  blurFilter.appendChild(svgEl('feGaussianBlur', { stdDeviation: '1.1' }));
  defs.appendChild(blurFilter);

  const rimBevel = svgEl('linearGradient', { id: 'rim-bevel', x1: '10%', y1: '6%', x2: '90%', y2: '94%' });
  [['0%', '#fff2d0', 0.65], ['30%', '#fff2d0', 0.15], ['58%', '#000000', 0], ['100%', '#000000', 0.45]]
    .forEach(([off, color, op]) => rimBevel.appendChild(svgEl('stop', { offset: off, 'stop-color': color, 'stop-opacity': op })));
  defs.appendChild(rimBevel);

  /* ---------- construccion ---------- */

  svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: R_OUTER, fill: woodRim }));
  svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: R_OUTER - 4, fill: 'none', stroke: 'url(#rim-bevel)', 'stroke-width': 8 }));
  svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: R_OUTER - 1.5, fill: 'none', stroke: '#f3d9ab', 'stroke-opacity': 0.25, 'stroke-width': 1.5 }));
  svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: R_RIM_INNER, fill: woodGap }));

  const SLICE_DEG = 360 / 15;
  const RAW_START = -(ZONES[0].cap * SLICE_DEG) / 2;
  let cumDeg = 0;
  const zoneBounds = ZONES.map((z) => {
    const start = RAW_START + cumDeg;
    const end = start + z.cap * SLICE_DEG;
    cumDeg += z.cap * SLICE_DEG;
    return [start, end];
  });
  function zoneSpan(i) {
    const [s, e] = zoneBounds[i];
    return [s + GAP_DEG / 2, e - GAP_DEG / 2];
  }

  ZONES.forEach((z, i) => {
    const [start, end] = zoneSpan(i);
    const path = roundedWedgePath(start, end, R_RIM_INNER, R_SECTOR_INNER, CORNER);
    svg.appendChild(svgEl('path', { d: path, fill: fillId[z.id] }));
    svg.appendChild(svgEl('path', { d: path, fill: 'none', stroke: '#000000', 'stroke-opacity': 0.16, 'stroke-width': 1.4 }));
  });

  const innerRing = svgEl('path', {
    d: `M ${CX - R_SECTOR_INNER} ${CY} A ${R_SECTOR_INNER} ${R_SECTOR_INNER} 0 1 1 ${CX + R_SECTOR_INNER} ${CY} A ${R_SECTOR_INNER} ${R_SECTOR_INNER} 0 1 1 ${CX - R_SECTOR_INNER} ${CY} Z ` +
       `M ${CX - R_RING_INNER} ${CY} A ${R_RING_INNER} ${R_RING_INNER} 0 1 0 ${CX + R_RING_INNER} ${CY} A ${R_RING_INNER} ${R_RING_INNER} 0 1 0 ${CX - R_RING_INNER} ${CY} Z`,
    fill: woodRim, 'fill-rule': 'evenodd'
  });
  svg.appendChild(innerRing);
  svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: R_RING_INNER + 1, fill: 'none', stroke: '#000000', 'stroke-opacity': 0.4, 'stroke-width': 2 }));

  svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: R_BLACK, fill: blackDisc }));
  svg.appendChild(svgEl('circle', {
    cx: CX, cy: CY, r: R_OUTER, fill: '#000000', filter: 'url(#grain)',
    'clip-path': `circle(${R_OUTER}px at ${CX}px ${CY}px)`
  }));

  function drawMarble(g, x, y, r, marbleKey) {
    g.appendChild(svgEl('circle', { cx: x, cy: y, r, fill: marbleFill[marbleKey] }));
    g.appendChild(svgEl('path', {
      d: arcPathAbs(x, y, r - 0.6, SHADE_A0, SHADE_A1),
      fill: 'none', stroke: '#000000', 'stroke-opacity': 0.3, 'stroke-width': r * 0.14, 'stroke-linecap': 'round'
    }));
    g.appendChild(svgEl('ellipse', {
      cx: x - r * 0.3, cy: y - r * 0.34, rx: r * 0.46, ry: r * 0.32, fill: '#ffffff', opacity: 0.4, filter: 'url(#soft-blur)'
    }));
    g.appendChild(svgEl('ellipse', {
      cx: x - r * 0.34, cy: y - r * 0.38, rx: r * 0.14, ry: r * 0.1, fill: '#ffffff', opacity: 0.9
    }));
  }

  function buildHoleSlot(angleDeg, radius, marbleKey) {
    const [x, y] = polar(angleDeg, radius);
    const g = svgEl('g', {});
    g.appendChild(svgEl('circle', { cx: x, cy: y, r: BEZEL_R, fill: bezelGrad }));
    g.appendChild(svgEl('circle', { cx: x, cy: y, r: BEZEL_R - 1, fill: 'none', stroke: '#000000', 'stroke-opacity': 0.35, 'stroke-width': 1.5 }));
    g.appendChild(svgEl('circle', { cx: x, cy: y, r: PIT_R, fill: pitGrad }));
    g.appendChild(svgEl('path', { d: arcPathAbs(x, y, BEZEL_R - 2, SHADE_A0, SHADE_A1), fill: 'none', stroke: '#000000', 'stroke-opacity': 0.4, 'stroke-width': 3, 'stroke-linecap': 'round' }));
    g.appendChild(svgEl('path', { d: arcPathAbs(x, y, BEZEL_R - 2, LIGHT_A0, LIGHT_A1), fill: 'none', stroke: '#ffedc4', 'stroke-opacity': 0.3, 'stroke-width': 3, 'stroke-linecap': 'round' }));

    const marbleGroup = svgEl('g', { class: 'slot-marble is-empty' });
    drawMarble(marbleGroup, x, y, MARBLE_R, marbleKey);
    g.appendChild(marbleGroup);

    g.appendChild(svgEl('circle', { cx: x, cy: y, r: BEZEL_R, fill: 'none', stroke: '#fff2d6', 'stroke-opacity': 0.12, 'stroke-width': 1 }));
    svg.appendChild(g);
    return marbleGroup;
  }

  ZONES.forEach((z, i) => {
    const [start, end] = zoneSpan(i);
    const span = end - start;
    const n = z.cap;
    const slots = [];
    for (let k = 0; k < n; k++) {
      const angle = start + ((k + 0.5) * span) / n;
      const rMin = R_SECTOR_INNER + BEZEL_R + 6;
      const rMax = R_RIM_INNER - BEZEL_R - 6;
      const radius = (rMin + rMax) / 2;
      slots.push(buildHoleSlot(angle, radius, ZONE_VISUAL[z.id].marble));
    }
    holesByZone[z.id] = slots;
  });

  (function drawCenterMarble() {
    const r = MARBLE_R * 1.05;
    const g = svgEl('g', { class: 'center-marble' });
    g.appendChild(svgEl('circle', { cx: CX, cy: CY, r: r + 6, fill: pitGrad }));
    drawMarble(g, CX, CY, r, 'marble-black');
    svg.appendChild(g);
    centerMarbleNode = g;
  })();

  svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: R_OUTER, fill: shadowSheen, style: 'mix-blend-mode:multiply', 'pointer-events': 'none' }));
  svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: R_OUTER, fill: lightSheen, style: 'mix-blend-mode:overlay', 'pointer-events': 'none' }));
}

function renderBoardFill(board) {
  for (const z of ZONES) {
    const count = (board && board[z.id]) || 0;
    const slots = holesByZone[z.id] || [];
    slots.forEach((marbleGroup, idx) => {
      marbleGroup.classList.toggle('is-empty', idx >= count);
    });
  }
}

/* ============================================================
   Render — jugadores, turno, resultado, historial
   ============================================================ */

function initial(name) { return (name || '?').trim().charAt(0).toUpperCase(); }
function playerColor(st, id) {
  const i = st.players.findIndex((p) => p.id === id);
  return 'var(--p' + (((i < 0 ? 0 : i) % 6) + 1) + ')';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function playerById(st, id) { return st.players.find((p) => p.id === id) || null; }

function renderTopMeta(st) {
  $('metaRoomLabel').textContent = 'MESA ' + st.id;
  $('metaPlayers').textContent = `${st.players.length}/${st.config.maxPlayers}`;
}

function renderPlayers(st, marblesOverride) {
  const list = $('playerList');
  list.textContent = '';

  st.players.forEach((p) => {
    const marbles = marblesOverride && marblesOverride[p.id] !== undefined ? marblesOverride[p.id] : p.marbles;
    const li = document.createElement('li');
    li.className = 'player-row';
    li.style.setProperty('--p', playerColor(st, p.id));
    if (!p.online) li.classList.add('off');
    if (p.id === st.currentId) li.setAttribute('data-turn', '');
    if (p.id === S.me.playerId) li.setAttribute('data-me', '');

    li.innerHTML = `
      <span class="avatar">${initial(p.name)}</span>
      <div class="player-info">
        <span class="player-name">${escapeHtml(p.name)}</span>
        <span class="player-meta">${marbles} canicas</span>
      </div>
      ${p.id === st.currentId ? '<span class="turn-tag">TURNO</span>' : ''}`;
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

function renderTurnPill(st) {
  renderTurnClock(st);
  const cur = playerById(st, st.currentId);
  if (!cur) {
    $('turnLabelTop').textContent = st.status === 'finished' ? 'PARTIDA' : 'TURNO DE';
    $('turnNameTop').textContent = st.status === 'finished' ? 'TERMINADA' : '—';
    return;
  }
  const mine = cur.id === S.me.playerId;
  $('turnLabelTop').textContent = 'TURNO DE';
  $('turnNameTop').textContent = cur.name + (mine ? ' (tú)' : '');
  const av = $('turnAvatarTop');
  av.textContent = initial(cur.name);
  av.style.setProperty('--p', playerColor(st, cur.id));
}

const RESULT_LABEL = { white: 'BLANCO', yellow: 'AMARILLO', blue: 'AZUL', green: 'VERDE', red: 'ROJO', black: 'NEGRO' };

/* resultado visible: la tirada del turno actual o, si aun no se lanzo, la
   ultima jugada de la partida. El dado se coloca en esa misma jugada */
function lastPlay(st) {
  return st.turn || st.lastRoll || null;
}

function renderResult(turn, fresh, isPrevious) {
  const panel = $('resultRow').closest('.result-panel');
  if (!turn) {
    $('resultDot').className = 'result-dot';
    $('resultName').textContent = '—';
    $('resultSub').textContent = 'Aún no se ha lanzado el dado';
    panel.classList.remove('is-fresh');
    return;
  }
  const color = turn.face;
  $('resultDot').className = 'result-dot d-' + color;
  $('resultName').textContent = RESULT_LABEL[color];
  $('resultName').className = 'result-name c-' + (color === 'black' ? 'red' : color);

  let sub;
  if (turn.resolution.type === 'black') {
    sub = 'ZONA NEGRA — canica eliminada';
  } else if (turn.resolution.type === 'steal') {
    sub = `ZONA ${RESULT_LABEL[color]} LLENA — ${turn.playerName} se lleva ${turn.resolution.stolen}`;
  } else {
    sub = `ZONA ${RESULT_LABEL[color]} (${turn.resolution.filledAfter}/${turn.resolution.cap})`;
  }
  $('resultSub').textContent = isPrevious ? `ÚLTIMA JUGADA DE ${turn.playerName.toUpperCase()} · ${sub}` : sub;

  if (fresh) {
    panel.classList.remove('is-fresh');
    void panel.offsetWidth;
    panel.classList.add('is-fresh');
  }
}

function renderRollButton(st) {
  const btn = $('btnRoll');
  const label = $('throwLabel');
  const myTurn = st.status === 'playing' && st.currentId === S.me.playerId;

  if (S.animating) { btn.disabled = true; return; }

  if (st.status === 'finished') { btn.disabled = true; label.textContent = 'PARTIDA TERMINADA'; return; }
  if (st.status !== 'playing') { btn.disabled = true; label.textContent = 'ESPERANDO…'; return; }

  if (!myTurn) {
    btn.disabled = true;
    const cur = playerById(st, st.currentId);
    label.textContent = cur ? `TURNO DE ${cur.name.toUpperCase()}` : 'ESPERANDO…';
    return;
  }
  /* ya lance en este turno: el servidor pasa el turno tras la animacion */
  if (st.turn && st.turn.playerId === st.currentId) {
    btn.disabled = true;
    label.textContent = 'ESPERANDO…';
    return;
  }
  btn.disabled = false;
  label.textContent = 'LANZAR DADO';
}

function renderMyMarbles(st, marblesOverride) {
  const me = playerById(st, S.me.playerId);
  const marbles = marblesOverride !== undefined ? marblesOverride : (me ? me.marbles : 0);
  $('myMarbleCount').textContent = marbles;

  const tray = $('marbleTray');
  const shown = Math.min(marbles, 30);
  if (tray.childElementCount !== shown) {
    tray.textContent = '';
    for (let i = 0; i < shown; i++) {
      const m = document.createElement('i');
      m.className = 'marble m-white sm';
      tray.appendChild(m);
    }
  }
}

function renderHistory(st) {
  const ul = $('historyLog');
  ul.textContent = '';
  const events = st.events.filter((e) => e.type !== 'info');
  if (!events.length) {
    ul.innerHTML = '<li class="log-empty">Aún no hay jugadas.</li>';
    return;
  }
  for (const ev of events.slice().reverse()) {
    const li = document.createElement('li');
    li.textContent = ev.text;
    ul.appendChild(li);
  }
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

/* ============================================================
   Aplicacion del estado recibido
   ============================================================ */

function snapshotMarbles(st) {
  const m = {};
  for (const p of st.players) m[p.id] = p.marbles;
  return m;
}

function applyState(st) {
  S.state = st;

  if (st.status === 'lobby') { renderLobby(st); showScreen('lobby'); return; }

  /* primera vez que este cliente ve la pantalla de juego (inicio de partida o
     reconexion a mitad de partida): no hay "antes" que animar, se pinta tal cual */
  const enteringGame = $('screenGame').classList.contains('is-hidden');
  if (enteringGame) {
    showScreen('game');
    buildBoard();
    S.lastTurnSeq = st.turn ? st.turn.seq : 0;
    S.lastCurrentId = st.currentId;
    paintAll(st);
    renderResult(lastPlay(st), false, !st.turn);
    snapshotPrev(st);
    checkFinish(st);   /* recarga con la partida ya terminada: modal y "Nueva partida" */
    return;
  }

  const newRoll = st.turn && st.turn.seq !== S.lastTurnSeq;

  if (newRoll && !S.animating) {
    S.lastTurnSeq = st.turn.seq;
    animateRoll(st);
    return;
  }

  if (S.animating) return; /* el estado nuevo se recoge al terminar la animacion */

  paintAll(st);
  renderResult(lastPlay(st), false, !st.turn);
  flushEvents(st);
  checkTurnChange(st);
  checkFinish(st);
  snapshotPrev(st);
}

function snapshotPrev(st) {
  S.prevBoard = st.board;
  S.prevMarbles = snapshotMarbles(st);
}

function paintAll(st, boardOverride, marblesOverride) {
  if (!S.animating && lastPlay(st)) showDieFace(lastPlay(st).face);
  renderTopMeta(st);
  renderPlayers(st, marblesOverride);
  renderTurnPill(st);
  renderBoardFill(boardOverride || st.board);
  renderRollButton(st);
  renderMyMarbles(st, marblesOverride ? marblesOverride[S.me.playerId] : undefined);
  renderHistory(st);
}

/* colores de las 6 caras del dado real (RULES.md): cada uno con su propio
   degradado claro/medio/oscuro, reutilizado en las 3 caras visibles del cubo */
const DIE_FACE_COLORS = {
  white:  ['#fffaf0', '#eadfc4', '#b7a983'],
  yellow: ['#ffe9a4', '#caa233', '#8a640f'],
  blue:   ['#8fc4f5', '#2f6fa8', '#153a5e'],
  green:  ['#9ed177', '#4a7d27', '#26400f'],
  red:    ['#ea6a5c', '#c0392b', '#821f16'],
  black:  ['#5a544c', '#231f1a', '#0c0a08']
};
const DIE_FACE_NAMES = Object.keys(DIE_FACE_COLORS);

function setDieFaceColor(face, colorName) {
  const [c0, c1, c2] = DIE_FACE_COLORS[colorName];
  $(`die-face-${face}-s0`).setAttribute('stop-color', c0);
  $(`die-face-${face}-s1`).setAttribute('stop-color', c1);
  $(`die-face-${face}-s2`).setAttribute('stop-color', c2);
}

/* caras laterales fijas para cada color de arriba: el dado queda siempre en
   la misma posicion para una jugada, aunque se repinte o se recargue */
const DIE_SIDES = {
  white:  ['red', 'blue'],
  yellow: ['green', 'white'],
  blue:   ['yellow', 'red'],
  green:  ['black', 'yellow'],
  red:    ['green', 'white'],
  black:  ['blue', 'green']
};

function showDieFace(top) {
  const [left, right] = DIE_SIDES[top] || DIE_SIDES.red;
  setDieFaceColor('top', top);
  setDieFaceColor('left', left);
  setDieFaceColor('right', right);
}

function randomColorExcept(exclude) {
  let c;
  do { c = DIE_FACE_NAMES[Math.floor(Math.random() * DIE_FACE_NAMES.length)]; } while (exclude.includes(c));
  return c;
}

let dieSpinTimer = null;

/* el dado "gira" cambiando el color de sus 3 caras al azar, en vez de rotar en el espacio */
function startDieSpin() {
  if (dieSpinTimer) clearInterval(dieSpinTimer);
  const tick = () => {
    const top = DIE_FACE_NAMES[Math.floor(Math.random() * DIE_FACE_NAMES.length)];
    const left = randomColorExcept([top]);
    const right = randomColorExcept([top, left]);
    setDieFaceColor('top', top);
    setDieFaceColor('left', left);
    setDieFaceColor('right', right);
  };
  tick();
  dieSpinTimer = setInterval(tick, 110);
  $('die-svg').classList.add('is-rolling');
}

/* se detiene con la cara superior mostrando el color realmente obtenido */
function stopDieSpin(resultColor) {
  if (dieSpinTimer) { clearInterval(dieSpinTimer); dieSpinTimer = null; }
  $('die-svg').classList.remove('is-rolling');
  showDieFace(resultColor);
}

function animateRoll(st) {
  S.animating = true;
  const turn = st.turn;

  /* fase 1: pintar con el estado ANTERIOR (tablero/canicas aun sin cambiar) */
  paintAll(st, S.prevBoard, S.prevMarbles);
  renderRollButton(st);

  startDieSpin();
  $('btnRoll').querySelector('.throw-disc').classList.add('is-rolling');
  Sound.dice();

  setTimeout(() => {
    Sound.land();
    stopDieSpin(turn.face);
    $('btnRoll').querySelector('.throw-disc').classList.remove('is-rolling');

    /* fase 2: revelar el resultado real */
    paintAll(st);
    renderResult(turn, true);

    if (turn.resolution.type === 'place') Sound.place();
    else if (turn.resolution.type === 'steal') Sound.steal();
    else Sound.success();

    if (turn.resolution.type === 'black') {
      centerMarbleNode.classList.remove('is-move');
      void centerMarbleNode.offsetWidth;
      centerMarbleNode.classList.add('is-move');
    }

    snapshotPrev(st);
    S.animating = false;

    flushEvents(st);
    checkTurnChange(st);
    checkFinish(st);

    /* durante la animacion pudieron llegar estados nuevos: aplicar el ultimo */
    if (S.state !== st) applyState(S.state);
  }, 900);
}

function flushEvents(st) {
  for (const ev of st.events) {
    if (ev.id <= S.lastEventId) continue;
    S.lastEventId = ev.id;
  }
}

function checkTurnChange(st) {
  if (st.status !== 'playing') { S.lastCurrentId = st.currentId; return; }
  if (st.currentId === S.lastCurrentId) return;
  S.lastCurrentId = st.currentId;

  const cur = playerById(st, st.currentId);
  if (!cur) return;

  renderTurnPill(st);
  renderPlayers(st);
  renderRollButton(st);

  if (cur.id === S.me.playerId) {
    turnFlash('¡Es tu turno!');
    Sound.turn();
  } else {
    turnFlash(`Turno de ${cur.name}`);
  }
}

function checkFinish(st) {
  const modal = $('modalWin');
  if (st.status !== 'finished') { modal.classList.add('is-hidden'); return; }
  if (!modal.classList.contains('is-hidden')) return;

  Sound.win();
  const winner = playerById(st, st.winnerId);
  const mine = winner && winner.id === S.me.playerId;

  const banner = window.GCVictoryBanner
    ? GCVictoryBanner.text({
        winnerName: winner && winner.name,
        amountWon: st.prize || 0,
        mine,
        fallback: winner ? `${winner.name} se quedó sin canicas primero.` : 'La partida terminó.'
      })
    : { title: mine ? '¡Ganaste!' : 'Fin de la partida', body: winner ? `${winner.name} se quedó sin canicas primero.` : 'La partida terminó.' };
  $('winTitle').textContent = banner.title;
  $('winText').textContent = banner.body;

  const scores = $('winScores');
  scores.textContent = '';
  [...st.players].sort((a, b) => a.marbles - b.marbles).forEach((p) => {
    const li = document.createElement('li');
    if (p.id === st.winnerId) li.classList.add('is-winner');
    li.innerHTML = `
      <span class="avatar avatar-sm" style="--p:${playerColor(st, p.id)}">${initial(p.name)}</span>
      <span class="sc-name">${escapeHtml(p.name)}${p.id === S.me.playerId ? ' (tú)' : ''}</span>
      <span class="sc-val">${p.marbles} ${p.marbles === 1 ? 'canica' : 'canicas'}</span>`;
    scores.appendChild(li);
  });

  const isHost = st.hostId === S.me.playerId;
  $('btnRestart').classList.toggle('is-hidden', !isHost);
  $('winWait').classList.toggle('is-hidden', isHost);

  modal.classList.remove('is-hidden');
}

/* ---------- sala de espera ---------- */

function renderLobby(st) {
  const cfg = st.config || {};
  const max = cfg.maxPlayers || 8;
  const cash = (n) => '$' + Number(n || 0).toLocaleString('en-US');

  $('lobbyCode').textContent = st.id;
  $('lobbyCount').textContent = `${st.players.length}/${max}`;
  $('lobbyHint').textContent = `Compártelo con los demás. Máximo ${max} jugadores.`;

  const rows = [
    ['Canicas iniciales', cfg.startMarbles, true],
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
  $('btnStart').textContent = enough ? 'Iniciar partida' : 'Faltan jugadores (mín. 2)';
  $('lobbyWait').classList.toggle('is-hidden', isHost);
}

/* ============================================================
   Eventos de interfaz
   ============================================================ */

function wire() {
  /* datos que llegan de GameCenter: nombre y apuesta pre-cargados */
  if (GC.name) { $('createName').value = GC.name; $('joinName').value = GC.name; }
  if (GC.betting) {
    $('cfgApuestaWrap').classList.remove('is-hidden');
    $('cfgApuesta').value = GC.bet;
  }

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-on', t === tab));
      const create = tab.dataset.tab === 'create';
      $('formCreate').classList.toggle('is-hidden', !create);
      $('formJoin').classList.toggle('is-hidden', create);
      $('homeError').classList.add('is-hidden');
    });
  });

  $('formCreate').addEventListener('submit', async (e) => {
    e.preventDefault();
    Sound.init();
    try {
      const res = await api('create', {
        name: $('createName').value,
        config: {
          maxPlayers: Number($('cfgMax').value),
          startMarbles: Number($('cfgMarbles').value),
          bettingEnabled: GC.betting,
          apuesta: GC.betting ? GC.bet : 0
        }
      });
      S.me = { roomId: res.roomId, playerId: res.playerId, token: res.token };
      saveSession(S.me);
      connect();
    } catch (err) { showHomeError(err.message); }
  });

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

  $('btnCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(S.state ? S.state.id : '');
      $('btnCopy').textContent = '¡Copiado!';
      setTimeout(() => ($('btnCopy').textContent = 'Copiar'), 1600);
    } catch (_) { toast('Código: ' + (S.state ? S.state.id : ''), 'info'); }
  });

  $('btnStart').addEventListener('click', () => {
    api('start').catch((e) => toast(e.message, 'penalty'));
  });

  $('btnLeaveLobby').addEventListener('click', () => {
    api('leave').catch(() => {}).then(() => leaveToHome());
  });

  $('btnRoll').addEventListener('click', () => {
    if ($('btnRoll').disabled) return;
    api('roll').catch((e) => { toast(e.message, 'penalty'); Sound.error(); });
  });

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

  $('btnRules').addEventListener('click', () => $('modalRules').classList.remove('is-hidden'));
  $('btnCloseRules').addEventListener('click', () => $('modalRules').classList.add('is-hidden'));

  $('btnHistory').addEventListener('click', () => {
    if (S.state) renderHistory(S.state);
    $('modalHistory').classList.remove('is-hidden');
  });
  $('btnCloseHistory').addEventListener('click', () => $('modalHistory').classList.add('is-hidden'));

  document.addEventListener('keydown', (e) => {
    if ($('screenGame').classList.contains('is-hidden')) return;
    if (e.code === 'Space' && !$('btnRoll').disabled) { e.preventDefault(); $('btnRoll').click(); }
    if (e.key === 'Escape') {
      $('modalRules').classList.add('is-hidden');
      $('modalHistory').classList.add('is-hidden');
    }
  });

  document.addEventListener('pointerdown', () => Sound.init(), { once: true });
}

/* ============================================================
   Arranque
   ============================================================ */

async function boot() {
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

document.addEventListener('DOMContentLoaded', boot);

})();
