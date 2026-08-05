// Tiny 8-bit sound engine — pure Web Audio synthesis, no audio files.

let ctx = null;
function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

let muted = localStorage.getItem('rmk-muted') === '1';
export function isMuted() {
  return muted;
}
export function setMuted(v) {
  muted = v;
  localStorage.setItem('rmk-muted', v ? '1' : '0');
}

function beep({ freq, duration = 0.09, type = 'square', gain = 0.08, slideTo = null, delay = 0 }) {
  if (muted) return;
  const c = getCtx();
  if (c.state === 'suspended') c.resume();
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function sequence(notes) {
  notes.forEach((n) => beep(n));
}

export const sfx = {
  pickup() {
    beep({ freq: 520, duration: 0.045, gain: 0.05 });
  },
  place() {
    beep({ freq: 300, duration: 0.06, slideTo: 520, gain: 0.07 });
  },
  invalid() {
    sequence([
      { freq: 180, duration: 0.12, type: 'sawtooth', gain: 0.08 },
      { freq: 120, duration: 0.16, type: 'sawtooth', gain: 0.08, delay: 0.1 },
    ]);
  },
  draw() {
    beep({ freq: 420, duration: 0.05, slideTo: 260, gain: 0.06 });
  },
  yourTurn() {
    sequence([
      { freq: 523.25, duration: 0.08, delay: 0 },
      { freq: 659.25, duration: 0.08, delay: 0.09 },
      { freq: 783.99, duration: 0.14, delay: 0.18 },
    ]);
  },
  tick(urgent) {
    beep({ freq: urgent ? 900 : 660, duration: 0.055, gain: urgent ? 0.09 : 0.06 });
  },
  win() {
    sequence([
      { freq: 523.25, duration: 0.12, delay: 0 },
      { freq: 659.25, duration: 0.12, delay: 0.12 },
      { freq: 783.99, duration: 0.12, delay: 0.24 },
      { freq: 1046.5, duration: 0.3, delay: 0.36 },
    ]);
  },
  lose() {
    sequence([
      { freq: 400, duration: 0.15, delay: 0 },
      { freq: 320, duration: 0.15, delay: 0.15 },
      { freq: 240, duration: 0.32, delay: 0.3 },
    ]);
  },
};
