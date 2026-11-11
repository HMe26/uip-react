/**
 * Call sounds, synthesized with Web Audio (no audio files to ship or cache).
 *   startTone('incoming')  soft melodic chime phrase, repeats until stopTone()
 *   startTone('outgoing')  gentle low "ba-bum" ringback (what the caller hears while the other phone rings)
 *   blip('connect'|'end')  short confirmation tones
 * Sound design: every note is a bell-like tone (sine fundamental + quiet 2nd/3rd partials with a faster decay), a soft attack
 * (no clicks), a long natural decay, all passed through a low-pass filter and a tiny feedback echo so it sounds warm and
 * "roomy" instead of the harsh flat beeps of a raw oscillator.
 * Browsers only allow audio after a user gesture: unlockAudio() is called on the first pointer/key event of the page,
 * so a call that arrives before any interaction rings silently (the visual card + system notification still show).
 */
let ctx = null;
let bus = null;
let timer = 0;
let current = null;

function getCtx() {
  if (ctx) return ctx;
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try { ctx = new AC(); } catch { ctx = null; }
  return ctx;
}

/** master chain: gain -> lowpass -> (dry + feedback echo) -> destination. Built once per context. */
function getBus() {
  const c = getCtx();
  if (!c) return null;
  if (bus && bus.c === c) return bus;
  const input = c.createGain();
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  lp.Q.value = 0.4;
  const dry = c.createGain();
  dry.gain.value = 0.9;
  const echo = c.createDelay(0.6);
  echo.delayTime.value = 0.22;
  const fb = c.createGain();
  fb.gain.value = 0.28;
  const wet = c.createGain();
  wet.gain.value = 0.32;
  input.connect(lp);
  lp.connect(dry);
  dry.connect(c.destination);
  lp.connect(echo);
  echo.connect(fb);
  fb.connect(echo);
  echo.connect(wet);
  wet.connect(c.destination);
  bus = { c, input };
  return bus;
}

export function unlockAudio() {
  const c = getCtx();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

/** One bell-like note: [fundamental, 2nd, 3rd partial] with progressively shorter decays. */
function note(freq, at, dur, vol) {
  const c = getCtx();
  const b = getBus();
  if (!c || !b || c.state !== 'running') return;
  const t0 = c.currentTime + at;
  const partials = [[1, 1, 1], [2, 0.28, 0.55], [3, 0.1, 0.35]];
  partials.forEach(([mult, amp, decay]) => {
    const o = c.createOscillator();
    const g = c.createGain();
    const len = dur * decay + 0.05;
    o.type = 'sine';
    o.frequency.value = freq * mult;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * amp), t0 + 0.02);   // soft attack
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);                          // long bell decay
    o.connect(g);
    g.connect(b.input);
    o.start(t0);
    o.stop(t0 + len + 0.05);
  });
}

// note frequencies (Hz)
const E5 = 659.25, G5 = 783.99, A5 = 880, B5 = 987.77, D6 = 1174.66, E6 = 1318.51, D5 = 587.33, B4 = 493.88, G4 = 392, A4 = 440;

const PATTERNS = {
  // incoming: a friendly rising pentatonic phrase (two bars), then a pause. cycle = ms between repeats.
  incoming: {
    cycle: 3400,
    notes: [
      [E5, 0.00, 0.9, 0.17], [G5, 0.16, 0.9, 0.17], [B5, 0.32, 0.9, 0.17], [E6, 0.50, 1.4, 0.19],
      [D6, 1.05, 0.9, 0.15], [B5, 1.21, 0.9, 0.15], [G5, 1.37, 0.9, 0.15], [A5, 1.55, 1.5, 0.16],
    ],
  },
  // outgoing ringback: two soft low pulses, long silence (calm, doesn't nag the caller)
  outgoing: {
    cycle: 4200,
    notes: [[G4, 0.00, 1.1, 0.10], [B4, 0.00, 1.1, 0.07], [A4, 0.55, 1.3, 0.09], [D5, 0.55, 1.3, 0.06]],
  },
};

export function stopTone() {
  if (timer) clearInterval(timer);
  timer = 0;
  current = null;
}

export function startTone(kind) {
  if (current === kind) return;
  stopTone();
  const p = PATTERNS[kind];
  if (!p) return;
  current = kind;
  const play = () => {
    unlockAudio();
    p.notes.forEach(([f, at, d, v]) => note(f, at, d, v));
  };
  play();
  timer = setInterval(play, p.cycle);
}

export function blip(kind) {
  unlockAudio();
  if (kind === 'connect') {
    note(E5, 0, 0.5, 0.16);
    note(B5, 0.12, 0.7, 0.16);
  } else {
    note(B5, 0, 0.45, 0.14);
    note(G5, 0.13, 0.45, 0.14);
    note(E5, 0.26, 0.7, 0.14);
  }
}
