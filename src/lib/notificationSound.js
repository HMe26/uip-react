/**
 * Notification / message sounds.
 *
 * The tones are synthesised with the Web Audio API, so there is no audio
 * file to ship, cache or get blocked. Browsers only allow audio after the
 * person has interacted with the page, so the context is unlocked on the
 * first click / key press / touch anywhere in the app (see unlock()).
 *
 * The on/off choice is remembered per browser in localStorage and any
 * component can follow it through the SOUND_EVENT window event.
 */

const KEY = 'uip_sound_enabled';
export const SOUND_EVENT = 'uip:sound-changed';

let ctx = null;
let lastPlay = 0;

export function isSoundEnabled() {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable — the choice just isn't remembered */
  }
  window.dispatchEvent(new CustomEvent(SOUND_EVENT, { detail: { enabled: on } }));
}

function getCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    ctx = null;
  }
  return ctx;
}

function unlock() {
  const c = getCtx();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

if (typeof window !== 'undefined') {
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
    window.addEventListener(ev, unlock, { passive: true })
  );
}

function tone(c, { freq, start, dur, gain = 0.18, type = 'sine' }) {
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/**
 * kind: 'notification' — two-note chime (bell notifications)
 *       'message'      — short soft "pop" (incoming chat message)
 */
export function playSound(kind = 'notification') {
  if (!isSoundEnabled()) return;
  const now = Date.now();
  if (now - lastPlay < 700) return; // a burst of events = one sound
  const c = getCtx();
  if (!c || c.state !== 'running') return; // not unlocked yet: stay silent, never throw
  lastPlay = now;
  if (kind === 'message') {
    tone(c, { freq: 880, start: 0, dur: 0.12, gain: 0.14 });
    tone(c, { freq: 1175, start: 0.07, dur: 0.16, gain: 0.12 });
  } else {
    tone(c, { freq: 784, start: 0, dur: 0.22, gain: 0.18 }); // G5
    tone(c, { freq: 1047, start: 0.14, dur: 0.38, gain: 0.16 }); // C6
  }
}
