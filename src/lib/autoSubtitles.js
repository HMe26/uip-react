/**
 * Automatic subtitles for <VideoPlayer>.
 *
 * The browser decodes the video's audio itself (Web Audio), cuts it into short 16 kHz mono WAV chunks and posts each one to
 * POST /api/v1/subtitles/auto — the server transcribes (Whisper) and translates. Doing the decoding here means the server needs
 * no ffmpeg and no access to the video file, and it works for any video URL the player can already fetch.
 *
 *   const { cues, language, translated, partial } = await generateAutoSubtitles({ src, target: 'ar', signal, onProgress, onCues });
 *
 * `target` is a language code ('ar', 'en', …) or 'orig' (transcribe only, no translation).
 * Throws AutoSubError with a `code`: unavailable | unsupported | fetch_failed | too_large | decode_failed | no_audio |
 * no_speech | rate_limited | cancelled | failed.
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { api } from '../api/client';

const BASE = '/api/v1/subtitles/auto';
const RATE = 16000;                       // Whisper's native rate; 16-bit mono WAV = 32 000 bytes / second
export const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // decoding keeps the whole track in memory — beyond this, tabs crash
const CACHE_PREFIX = 'uip_autosub_v1:';

export class AutoSubError extends Error {
  constructor(code, message) { super(message || code); this.name = 'AutoSubError'; this.code = code; }
}

/* ---------------------------------------------------------------- status */

let statusPromise = null;
/** { available, max_chunk_seconds } — cached for the page's lifetime (a failed lookup is retried next time). */
export function getAutoSubtitleStatus() {
  if (!statusPromise) {
    statusPromise = api.get(BASE + '/status')
      .then((r) => r?.data || { available: false })
      .catch(() => { statusPromise = null; return { available: false }; });
  }
  return statusPromise;
}

/* ---------------------------------------------------------------- cache (finished results only) */

const cacheKey = (src, target) => `${CACHE_PREFIX}${target}:${String(src).split(/[?#]/)[0]}`;

export function loadCachedSubtitles(src, target) {
  try {
    const raw = localStorage.getItem(cacheKey(src, target));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && Array.isArray(parsed.cues) && parsed.cues.length ? parsed : null;
  } catch { return null; }
}

function saveCachedSubtitles(src, target, value) {
  try { localStorage.setItem(cacheKey(src, target), JSON.stringify(value)); } catch { /* quota / private mode: just skip caching */ }
}

/* ---------------------------------------------------------------- audio */

const b64ToBuffer = (b64) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

/** On the web the site only allows same-origin requests (CSP connect-src 'self'): an absolute link to the API host
 *  is read through the same-origin /uploads proxy instead. */
function sameOriginUrl(src) {
  try {
    const u = new URL(src, location.href);
    if (u.origin !== location.origin && /^\/(uploads|api)\//.test(u.pathname)) return u.pathname + u.search;
  } catch { /* keep src */ }
  return src;
}

/** Android app: the WebView's fetch is blocked by CORS on /uploads, and Capacitor's patched fetch corrupts binary bodies.
 *  The native HTTP plugin returns the bytes as base64, which is exact. */
async function fetchNativeBytes(src, signal) {
  const apiBase = String(import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');
  const url = /^\/(?!\/)/.test(src) && apiBase ? apiBase + src : src;
  if (signal?.aborted) throw new AutoSubError('cancelled');
  const res = await CapacitorHttp.get({ url, responseType: 'arraybuffer', readTimeout: 120000, connectTimeout: 30000 });
  if (signal?.aborted) throw new AutoSubError('cancelled');
  if (res.status < 200 || res.status >= 300 || !res.data) throw new Error(`HTTP ${res.status}`);
  return typeof res.data === 'string' ? b64ToBuffer(res.data) : res.data;
}

function xhrBytes(src, signal) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('GET', src);
    x.responseType = 'arraybuffer';
    x.onload = () => ((x.status >= 200 && x.status < 300 && x.response) ? resolve(x.response) : reject(new Error(`HTTP ${x.status}`)));
    x.onerror = () => reject(new Error('network'));
    x.onabort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    signal?.addEventListener('abort', () => x.abort(), { once: true });
    x.send();
  });
}

/** The Android app plays chat videos from a local copy (https://localhost/_capacitor_file_/...). That URL lives inside the
 *  WebView, so CapacitorHttp (the phone's network stack) cannot reach it: read it with the WebView's ORIGINAL fetch
 *  (Capacitor keeps it as window.CapacitorWebFetch; the patched fetch corrupts binary bodies). */
function isLocalAppUrl(src) {
  try {
    const u = new URL(src, location.href);
    return u.pathname.includes('/_capacitor_file_/') || u.origin === location.origin || u.protocol === 'blob:' || u.protocol === 'file:';
  } catch { return false; }
}

async function fetchLocalBytes(src, signal) {
  const webFetch = (typeof window !== 'undefined' && window.CapacitorWebFetch) || fetch;
  const res = await webFetch(src, { signal });
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get('content-length') || 0) > MAX_VIDEO_BYTES) throw new AutoSubError('too_large');
  return res.arrayBuffer();
}

async function fetchVideoBytes(src, signal) {
  let buf = null;
  let lastErr = null;
  const native = Capacitor.isNativePlatform();
  const url = native ? src : sameOriginUrl(src);
  let attempts;
  if (native) {
    attempts = isLocalAppUrl(url)
      ? [() => fetchLocalBytes(url, signal), () => xhrBytes(url, signal)]
      : [() => fetchNativeBytes(url, signal), () => fetchLocalBytes(url, signal)];
  } else {
    attempts = [async () => {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (Number(res.headers.get('content-length') || 0) > MAX_VIDEO_BYTES) throw new AutoSubError('too_large');
      return res.arrayBuffer();
    }, () => xhrBytes(url, signal)];
  }
  for (const run of attempts) {
    try { buf = await run(); if (buf) break; } catch (e) {
      if (e?.name === 'AbortError' || signal?.aborted) throw new AutoSubError('cancelled');
      if (e instanceof AutoSubError) throw e;
      lastErr = e;
    }
  }
  if (!buf) { console.warn('[autoSubtitles] could not download video:', lastErr); throw new AutoSubError('fetch_failed'); }
  if (buf.byteLength > MAX_VIDEO_BYTES) throw new AutoSubError('too_large');
  return buf;
}

async function readFileBytes(file) {
  if (file.size > MAX_VIDEO_BYTES) throw new AutoSubError('too_large');
  try { return await file.arrayBuffer(); } catch { throw new AutoSubError('fetch_failed'); }
}

/** Any container the browser can play → Float32Array, mono, 16 kHz. */
async function decodeMono16k(arrayBuffer) {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  const OAC = typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
  if (!AC || !OAC) throw new AutoSubError('unsupported');
  const ctx = new AC();
  let decoded;
  try { decoded = await ctx.decodeAudioData(arrayBuffer); } catch { throw new AutoSubError('decode_failed'); } finally { try { ctx.close(); } catch { /* ignore */ } }
  if (!decoded || !decoded.length || decoded.duration < 0.5) throw new AutoSubError('no_audio');
  const off = new OAC(1, Math.max(1, Math.ceil(decoded.duration * RATE)), RATE); // 1 channel = automatic down-mix
  const node = off.createBufferSource();
  node.buffer = decoded;
  node.connect(off.destination);
  node.start();
  return (await off.startRendering()).getChannelData(0);
}

/** Cut points (sample indexes) so chunks are ≤ chunkSeconds long and, where possible, end in a quiet moment (not mid-word). */
export function planChunks(samples, chunkSeconds) {
  const max = Math.max(RATE * 15, Math.floor(chunkSeconds * RATE));
  const frame = Math.floor(RATE * 0.2);
  const parts = [];
  let a = 0;
  while (a < samples.length) {
    let b = Math.min(samples.length, a + max);
    if (b < samples.length) {
      // look for the quietest 0.2 s frame in the last 8 s of this chunk
      let best = b; let bestE = Infinity;
      for (let p = Math.max(a + frame, b - RATE * 8); p + frame <= b; p += frame) {
        let e = 0;
        for (let i = p; i < p + frame; i += 8) e += samples[i] * samples[i];
        if (e < bestE) { bestE = e; best = p + (frame >> 1); }
      }
      b = best;
    }
    parts.push([a, b]);
    a = b;
  }
  return parts;
}

function peakOf(samples, a, b) {
  let p = 0;
  for (let i = a; i < b; i += 4) { const v = Math.abs(samples[i]); if (v > p) p = v; }
  return p;
}

export function toWavBlob(samples, a, b) {
  const n = b - a;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[a + i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/* ---------------------------------------------------------------- pipeline */

async function postChunk(blob, target, signal, onUpload = null) {
  const fd = new FormData();
  fd.append('audio', blob, 'audio.wav');
  fd.append('target', target);
  try {
    return (await api.postFormProgress(BASE, fd, onUpload, signal))?.data || { cues: [] };
  } catch (err) {
    if (signal?.aborted || err?.message === 'Upload cancelled.') throw new AutoSubError('cancelled');
    if (err?.payload?.errors?.code === 'ai_unavailable') throw new AutoSubError('unavailable');
    if (err?.status === 429) throw new AutoSubError('rate_limited');
    throw new AutoSubError('failed', err?.message);
  }
}

/**
 * @param {{src?:string, file?:Blob (use instead of src when the bytes are already in memory), target:string, signal?:AbortSignal,
 *          onProgress?:(p:{stage:'download'|'decode'|'transcribe', done?:number, total?:number, pct?:number})=>void,
 *          cache?:boolean (default true; pass false for blob: URLs),
 *          onCues?:(cues:Array<{s:number,e:number,text:string}>)=>void}} opts
 */
export async function generateAutoSubtitles({ src, file = null, target = 'orig', signal, cache = true, onProgress = () => {}, onCues = () => {} }) {
  const status = await getAutoSubtitleStatus();
  if (!status.available) throw new AutoSubError('unavailable');

  onProgress({ stage: 'download' });
  // a File / Blob we already hold (pre-send editor) is read directly — no network / blob: URL fetch (CSP may block it)
  const bytes = file ? await readFileBytes(file) : await fetchVideoBytes(src, signal);
  if (signal?.aborted) throw new AutoSubError('cancelled');

  onProgress({ stage: 'decode' });
  const samples = await decodeMono16k(bytes);
  if (signal?.aborted) throw new AutoSubError('cancelled');

  const parts = planChunks(samples, Number(status.max_chunk_seconds) || 240);
  const cues = [];
  let language = null;
  let translated = true;
  let partial = false;
  let lastError = null;

  // Overall progress (0-99) that keeps moving while a chunk is in flight: real upload % first, then an eased
  // estimate of the server's transcription time (it never reaches the end of its slice until the reply arrives).
  const totalSec = Math.max(1, samples.length / RATE);
  const emit = (i, within) => {
    const [a0, b0] = parts[Math.min(i, parts.length - 1)];
    const before = parts.slice(0, i).reduce((n, [x, y]) => n + (y - x), 0) / RATE;
    const pct = Math.min(99, Math.max(1, Math.round(((before + ((b0 - a0) / RATE) * within) / totalSec) * 100)));
    onProgress({ stage: 'transcribe', done: i, total: parts.length, pct });
  };

  for (let i = 0; i < parts.length; i++) {
    const [a, b] = parts[i];
    emit(i, 0);
    if (peakOf(samples, a, b) < 0.01) continue; // silence — nothing to transcribe (and Whisper would invent text)
    const chunkSec = (b - a) / RATE;
    const expectMs = Math.max(4000, chunkSec * 250); // rough server time for this slice
    let upload = 0; // 0-1
    let t0 = null;  // set when the upload finished
    const tick = setInterval(() => {
      let within = upload * 0.25;
      if (t0 !== null) within = 0.25 + 0.7 * (1 - Math.exp(-(Date.now() - t0) / expectMs));
      emit(i, Math.min(0.95, within));
    }, 300);
    let data = null;
    try {
      for (let attempt = 0; attempt < 2 && !data; attempt++) {
        upload = 0; t0 = null;
        try {
          data = await postChunk(toWavBlob(samples, a, b), target, signal, (p) => {
            upload = Math.max(0, Math.min(1, (Number(p) || 0) / 100));
            if (upload >= 1 && t0 === null) t0 = Date.now();
          });
        } catch (err) {
          if (err.code === 'cancelled' || err.code === 'unavailable' || err.code === 'rate_limited' || attempt === 1) { lastError = err; break; }
        }
      }
    } finally {
      clearInterval(tick);
    }
    if (!data) {
      if (lastError?.code === 'cancelled' || cues.length === 0) throw lastError || new AutoSubError('failed');
      partial = true; // keep what we already have
      break;
    }
    language = language || data.language || null;
    if (data.translated === false) translated = false;
    const offset = a / RATE;
    (data.cues || []).forEach((c) => cues.push({ s: c.s + offset, e: c.e + offset, text: c.text }));
    onCues(cues.slice());
  }

  if (!cues.length) throw new AutoSubError('no_speech');
  onProgress({ stage: 'transcribe', done: parts.length, total: parts.length, pct: 100 });
  const result = { cues, language, translated, partial };
  if (!partial && cache) saveCachedSubtitles(src, target, { cues, language, translated });
  return result;
}
