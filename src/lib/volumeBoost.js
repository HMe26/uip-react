import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Volume boost — lets the user raise any <audio> / <video> above the browser's 100% ceiling, up to 400%.
 *
 *   const vb = useVolumeBoost(ref, { src });     // ref → the <audio>/<video> element
 *   vb.boost        1 … 4   (1 = normal, 4 = 400%)
 *   vb.setBoost(2)  user's choice
 *   vb.status       'idle' | 'loading' | 'error'
 *
 * How: element → MediaElementSource → GainNode (the boost) → WaveShaper (soft clipper, active only while boosting, so
 * loud peaks at 300–400% are rounded off instead of hard-clipping into crackle; quiet material gets the exact gain) → speakers. The element's own `volume` / `muted` still apply BEFORE the gain, so the normal
 * volume slider keeps working. Works the same in the browser and inside the Capacitor Android WebView.
 *
 * Cross-origin media: once an element is attached to Web Audio, the browser outputs SILENCE if the file came from
 * another origin without CORS headers (which is exactly the APK case: page = https://localhost, files = the API
 * host). So media is only attached when the user actually asks for more than 100%, and in that case a cross-origin
 * file is first downloaded to a same-origin blob: URL (playback position / paused state / speed are kept). If the
 * download fails, the element is left untouched and plays normally at 100% (status = 'error').
 *
 * Live MediaStreams (meeting participants, `el.srcObject`) are routed through a MediaStreamSource instead.
 *
 * The boost is deliberately NOT remembered between files — a value picked for a quiet recording would blast the
 * next, normal-level one.
 */

export const MAX_BOOST = 4;
export const BOOST_PRESETS = [1, 2, 3, 4];

const clampBoost = (x) => Math.min(MAX_BOOST, Math.max(1, Number(x) || 1));
const pct = (x) => `${Math.round(clampBoost(x) * 100)}%`;
export const boostLabel = pct;

let sharedCtx = null; // browsers cap the number of AudioContexts, so every element shares one
// Live calls (MediaStream elements) get their OWN low-latency context: playing a remote voice through a 'playback' (large-buffer) context
// delays the speaker output by 100s of ms relative to what the browser's echo canceller expects, so the canceller stops matching the echo
// and a boosted participant can start repeating / whistling. Files keep the big-buffer context (no crackle on weak phones).
let liveCtx = null;
function getLiveCtx() {
  if (liveCtx && liveCtx.state !== 'closed') return liveCtx;
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try { liveCtx = new AC({ latencyHint: 'interactive' }); } catch { try { liveCtx = new AC(); } catch { liveCtx = null; } }
  return liveCtx;
}
function getCtx() {
  if (sharedCtx && sharedCtx.state !== 'closed') return sharedCtx;
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  // 'playback' = big audio buffers: a bit more latency (irrelevant for media) but no stutter/crackle on weak phones / Android WebView
  try { sharedCtx = new AC({ latencyHint: 'playback' }); } catch { try { sharedCtx = new AC(); } catch { sharedCtx = null; } }
  return sharedCtx;
}

/** element → { gain, comp, source, stream, blobUrl, origSrc } — createMediaElementSource may only be called ONCE per element. */
const graphs = new WeakMap();

function isSafeUrl(url) {
  if (!url) return true;
  if (/^(blob:|data:)/i.test(url)) return true;
  try { return new URL(url, window.location.href).origin === window.location.origin; } catch { return false; }
}

function once(el, evt, ms = 20000) {
  return new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error('media error')); };
    const timer = setTimeout(bad, ms);
    const cleanup = () => { clearTimeout(timer); el.removeEventListener(evt, ok); el.removeEventListener('error', bad); };
    el.addEventListener(evt, ok, { once: true });
    el.addEventListener('error', bad, { once: true });
  });
}

const MIME_BY_EXT = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', ogv: 'video/ogg',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', aac: 'audio/aac', weba: 'audio/webm',
};
/** A blob without a proper type often refuses to play in Android WebView — fall back to the extension. */
function guessMime(url, fallback = 'video/mp4') {
  const ext = String(url).split(/[?#]/)[0].split('.').pop().toLowerCase();
  return MIME_BY_EXT[ext] || fallback;
}

const snapshot = (el) => ({ t: el.currentTime, paused: el.paused, rate: el.playbackRate });
function restore(el, keep) {
  try { el.currentTime = keep.t; } catch { /* not seekable */ }
  el.playbackRate = keep.rate;
  if (!keep.paused) el.play().catch(() => {});
}

/**
 * 1st way for a cross-origin file: let the element itself load it with CORS (crossorigin="anonymous"). Nothing is copied, it keeps
 * streaming. If the server sends no CORS headers the element fires `error` right away — that is the probe — and everything is put back.
 */
async function viaCorsElement(el, rec, url) {
  const keep = snapshot(el);
  const prev = el.getAttribute('crossorigin');
  el.crossOrigin = 'anonymous';
  el.load();
  try {
    await once(el, 'loadedmetadata', 30000);
  } catch {
    if (prev === null) el.removeAttribute('crossorigin'); else el.setAttribute('crossorigin', prev);
    el.load();
    await once(el, 'loadedmetadata', 15000).catch(() => {});
    restore(el, keep);
    return false;
  }
  rec.corsUrl = url;
  restore(el, keep);
  return true;
}

/** 2nd way: download the file into a same-origin blob: URL. A failed attempt puts the original source back (playback must never break). */
async function downloadAsBlob(el, rec, url) {
  let blob;
  try {
    let res;
    try { res = await fetch(url, { mode: 'cors', credentials: 'omit' }); } catch { return { ok: false, reason: 'cors' }; }
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    blob = await res.blob();
  } catch { return { ok: false, reason: 'download' }; }
  if (!blob.size) return { ok: false, reason: 'empty' };
  if (!blob.type || blob.type === 'application/octet-stream') blob = new Blob([blob], { type: guessMime(url) });

  const keep = snapshot(el);
  const nextUrl = URL.createObjectURL(blob);
  el.src = nextUrl;
  try {
    await once(el, 'loadedmetadata', 60000);
  } catch {
    URL.revokeObjectURL(nextUrl);
    el.src = url;
    await once(el, 'loadedmetadata', 15000).catch(() => {});
    restore(el, keep);
    return { ok: false, reason: 'decode' };
  }
  if (rec.blobUrl) URL.revokeObjectURL(rec.blobUrl);
  rec.blobUrl = nextUrl;
  rec.origSrc = url;
  restore(el, keep);
  return { ok: true };
}

/** Make a cross-origin media element safe for Web Audio. Resolves { ok, reason? } (reason: cors | http_<n> | download | empty | decode). */
async function toSameOrigin(el, rec) {
  const url = el.src || el.currentSrc;
  if (isSafeUrl(url) || rec.corsUrl === url) return { ok: true };
  if (await viaCorsElement(el, rec, url)) return { ok: true };
  return downloadAsBlob(el, rec, url);
}

function wire(el, rec) {
  const ctx = rec.ctx && rec.ctx.state !== 'closed' ? rec.ctx : ((el.srcObject instanceof MediaStream) ? getLiveCtx() : getCtx());
  if (!ctx) return false;
  rec.ctx = ctx;
  if (!rec.gain) {
    rec.gain = ctx.createGain();
    rec.shaper = ctx.createWaveShaper();
    rec.shaper.oversample = 'none'; // cheaper on the CPU; the shoulder is gentle so aliasing is inaudible
    rec.gain.connect(rec.shaper);
    rec.shaper.connect(ctx.destination);
  }
  const stream = el.srcObject instanceof MediaStream ? el.srcObject : null;
  if (stream) {
    if (rec.stream === stream && rec.source) return true;
    try { rec.source?.disconnect(); } catch { /* already gone */ }
    if (!stream.getAudioTracks().length) return false;
    rec.source = ctx.createMediaStreamSource(stream);
    rec.source.connect(rec.gain);
    rec.stream = stream;
    rec.mutedBefore = el.muted;
    el.muted = true; // the graph plays it now; the element must not play it a second time
    return true;
  }
  if (!rec.source) {
    rec.source = ctx.createMediaElementSource(el);
    rec.source.connect(rec.gain);
  }
  return true;
}

let clipCurve = null;
/**
 * Soft-clip curve. The shaper's input is the signal × (boost / MAX_BOOST), so its [-1, 1] domain covers a boost of up
 * to MAX_BOOST without ever being clamped; the curve multiplies back by MAX_BOOST. Result: exact gain up to ±0.6 of
 * full scale, then a smooth tanh shoulder that approaches ±1.
 */
function softClipCurve() {
  if (clipCurve) return clipCurve;
  const N = 8193, knee = 0.6;
  clipCurve = new Float32Array(N);
  for (let i = 0; i < N; i += 1) {
    const v = ((i / (N - 1)) * 2 - 1) * MAX_BOOST, av = Math.abs(v);
    clipCurve[i] = av <= knee ? v : Math.sign(v) * (knee + (1 - knee) * Math.tanh((av - knee) / (1 - knee)));
  }
  return clipCurve;
}

function setGain(rec, x) {
  const ctx = rec.ctx || getCtx();
  if (!ctx || !rec.gain) return;
  const t = ctx.currentTime;
  clearTimeout(rec.bypassTimer);
  if (x > 1.001 || rec.shaped) {
    // boosted (or on the way back to 100%): signal × x/MAX through the soft-clip curve
    if (!rec.shaped) {
      rec.shaper.curve = softClipCurve();
      rec.gain.gain.setValueAtTime((rec.level || 1) / MAX_BOOST, t); // same loudness as the bypassed path, so no click
      rec.shaped = true;
    }
    rec.gain.gain.setTargetAtTime(x / MAX_BOOST, t, 0.015);
    if (x <= 1.001) {
      // back at 100%: once the ramp is done leave the shaper out of the path completely (null curve = pass-through)
      rec.bypassTimer = setTimeout(() => {
        const c = rec.ctx || getCtx();
        if (!c || !rec.shaped) return;
        rec.gain.gain.cancelScheduledValues(c.currentTime);
        rec.gain.gain.setValueAtTime(1, c.currentTime);
        rec.shaper.curve = null;
        rec.shaped = false;
      }, 120);
    }
  } else {
    rec.gain.gain.setTargetAtTime(1, t, 0.015);
  }
  rec.level = x;
}

/** Apply `x` (1…4) to the element. Resolves { ok } — false when it could not be done (media stays at normal volume). */
export async function applyBoost(el, x) {
  if (!el) return { ok: false, reason: 'no_element' };
  x = clampBoost(x);
  let rec = graphs.get(el);
  if (!rec) {
    if (x <= 1) return { ok: true }; // nothing to do, don't touch the element at all
    rec = {};
    graphs.set(el, rec);
  }
  if (rec.busy) await rec.busy.catch(() => {});
  if (x > 1 && !(el.srcObject instanceof MediaStream)) {
    // (re)check on every call: React may have swapped the src for a cross-origin one since last time
    const cur = el.src || el.currentSrc;
    if (!rec.source || (!isSafeUrl(cur) && rec.corsUrl !== cur)) {
      rec.busy = toSameOrigin(el, rec);
      const r = await rec.busy;
      rec.busy = null;
      if (!r.ok && !rec.source) { graphs.delete(el); return { ok: false, reason: r.reason }; }
      if (!r.ok) return { ok: false, reason: r.reason };
    }
  }
  try {
    if (!wire(el, rec)) { if (!rec.source) graphs.delete(el); return { ok: false, reason: 'no_audio' }; }
  } catch {
    if (!rec.source) graphs.delete(el);
    return { ok: false, reason: 'graph' };
  }
  const ctx = rec.ctx || getCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  setGain(rec, x);
  return { ok: true };
}

/**
 * React hook. `ref` points at the media element; pass `src` so the boost is re-applied when the file changes
 * and `stream` for srcObject-based elements.
 */
export function useVolumeBoost(ref, { src, stream } = {}) {
  const [boost, setBoostState] = useState(1);
  const [status, setStatus] = useState('idle');
  const [reason, setReason] = useState(null); // why a boost failed (shown next to the error note: cors | http_404 | decode | …)
  const applied = useRef({ el: null, boost: 1, src: null, stream: null });

  const setBoost = useCallback((x) => setBoostState(clampBoost(x)), []);

  // no dependency array on purpose: the element can be re-created (picture-in-picture window), so compare each render
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const a = applied.current;
    if (a.el === el && a.boost === boost && a.src === src && a.stream === stream) return undefined;
    a.el = el; a.boost = boost; a.src = src; a.stream = stream;
    if (boost <= 1 && !graphs.has(el)) return undefined;
    let dead = false;
    if (boost > 1 && !graphs.get(el)?.source) setStatus('loading');
    applyBoost(el, boost).then((r) => { if (!dead) { setStatus(r.ok ? 'idle' : 'error'); setReason(r.ok ? null : (r.reason || 'unknown')); } });
    return () => { dead = true; };
  });

  // a user gesture (play) is the moment browsers allow a suspended AudioContext to start
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const wake = () => { const g = graphs.get(el); const c = (g && g.ctx) || getCtx(); if (c && c.state === 'suspended' && g) c.resume().catch(() => {}); };
    el.addEventListener('play', wake);
    return () => el.removeEventListener('play', wake);
  });

  // release the downloaded copy when the player goes away
  useEffect(() => () => {
    const el = applied.current.el;
    const rec = el && graphs.get(el);
    if (rec?.blobUrl) { const u = rec.blobUrl; rec.blobUrl = null; setTimeout(() => URL.revokeObjectURL(u), 500); }
  }, []);

  return { boost, setBoost, status, reason, label: pct(boost) };
}
