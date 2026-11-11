/**
 * Noise reduction for the video editor (عزل الضوضاء) — runs entirely on the device (browser and Android app), no server.
 *
 *   const buf = await decodeForDenoise(file);                       // AudioBuffer of the video's sound
 *   const clean = await denoiseBuffer(buf, 'med', { signal, onProgress });  // AudioBuffer (48 kHz when a neural model ran)
 *   getDenoiseInfo(clean)  // { engine: 'neural' | 'spectral', model, music }
 *
 * Main method: a neural speech-enhancement model (RNNoise for low / medium, the stronger GTCRN for high), run offline
 * faster than real time. Unlike the old spectral subtraction it also handles noise that changes (keyboard, traffic,
 * wind gusts, crowd) and it does not make the voice quieter: the speech level is restored after processing.
 * Music guard: the models are trained on speech and would "clean" music away. The two models are cross-checked on the
 * loudest part of the clip (they agree on speech, diverge on music); on music, or when a channel loses more than ~6 dB,
 * only the steady noise (hiss, hum) is removed with the spectral method, which leaves the music intact.
 * Fallback: spectral subtraction (STFT, noise profile learned from the quietest ~12 % of the clip), used when the
 * neural models cannot start on the device. Neither method can separate a voice from another voice.
 *
 * Errors are NoiseError with a `code`: unsupported | too_large | too_long | no_audio | cancelled | failed.
 */

export const NR_MAX_BYTES = 300 * 1024 * 1024; // decoding keeps the whole track in memory
export const NR_MAX_SECONDS = 8 * 60;

export class NoiseError extends Error {
  constructor(code, message) { super(message || code); this.name = 'NoiseError'; this.code = code; }
}

/**
 * model/wet drive the neural path (wet = share of the processed sound, the rest is the original: "low" keeps more of the
 * room). alpha/beta drive the spectral method (alpha = how much of the noise profile is subtracted, beta = the quietest
 * a bin may get).
 */
export const NR_LEVELS = {
  low: { model: 'rnnoise', wet: 0.7, alpha: 1.2, beta: 0.2 },
  med: { model: 'rnnoise', wet: 1, alpha: 1.8, beta: 0.12 },
  high: { model: 'gtcrn', wet: 1, alpha: 2.6, beta: 0.07 },
};
/** GTCRN is about 4x slower than RNNoise: past this length "high" uses RNNoise so a phone doesn't grind for minutes. */
const GTCRN_MAX_SECONDS = 90;
const AGREE_MIN = 8; // dB: speech + noise measured 10-13, music 6
const MUSIC_RATIO = 0.5; // the model removed more than 6 dB of the loud parts: it was erasing music, not noise
const PROBE_SECONDS = 12;
const INFO = new WeakMap();
export const getDenoiseInfo = (buf) => INFO.get(buf) || null;

const N = 2048;
const HOP = N / 4;
const BINS = N / 2 + 1;
const OLA_NORM = 1.5; // sum of squared periodic-Hann windows at 75 % overlap

const WIN = (() => {
  const w = new Float32Array(N);
  for (let i = 0; i < N; i += 1) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  return w;
})();

const fft = (() => {
  const levels = Math.log2(N);
  const rev = new Uint32Array(N);
  for (let i = 0; i < N; i += 1) rev[i] = (rev[i >> 1] >> 1) | ((i & 1) << (levels - 1));
  const cos = new Float32Array(N / 2);
  const sin = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i += 1) {
    cos[i] = Math.cos((2 * Math.PI * i) / N);
    sin[i] = Math.sin((2 * Math.PI * i) / N);
  }
  /** In-place complex FFT. inverse=true also divides by N. */
  return (re, im, inverse) => {
    for (let i = 0; i < N; i += 1) {
      const j = rev[i];
      if (j > i) {
        const tr = re[i]; re[i] = re[j]; re[j] = tr;
        const ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    const sgn = inverse ? 1 : -1;
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1;
      const step = N / size;
      for (let i = 0; i < N; i += size) {
        for (let j = i, k = 0; j < i + half; j += 1, k += step) {
          const l = j + half;
          const c = cos[k];
          const s = sgn * sin[k];
          const tr = re[l] * c - im[l] * s;
          const ti = re[l] * s + im[l] * c;
          re[l] = re[j] - tr; im[l] = im[j] - ti;
          re[j] += tr; im[j] += ti;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < N; i += 1) { re[i] /= N; im[i] /= N; }
    }
  };
})();

const tick = () => new Promise((r) => setTimeout(r, 0));
const cancelled = () => new NoiseError('cancelled');

/** Video file → AudioBuffer (all channels, native sample rate). */
export async function decodeForDenoise(file) {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) throw new NoiseError('unsupported');
  if (file.size > NR_MAX_BYTES) throw new NoiseError('too_large');
  let bytes;
  try { bytes = await file.arrayBuffer(); } catch { throw new NoiseError('failed'); }
  const ctx = new AC();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(bytes);
  } catch {
    throw new NoiseError('no_audio'); // no audio track, or a codec the browser can't read
  } finally {
    try { ctx.close(); } catch { /* ignore */ }
  }
  if (!decoded || !decoded.length || decoded.duration < 0.3) throw new NoiseError('no_audio');
  if (decoded.duration > NR_MAX_SECONDS) throw new NoiseError('too_long');
  return decoded;
}

/** Noise profile: mean magnitude spectrum of the quietest frames (ignoring digital silence). null = nothing to learn from. */
function learnNoise(x, total) {
  // prefix sums of the energy, to get each frame's RMS without touching every sample again
  const cs = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i += 1) cs[i + 1] = cs[i] + x[i] * x[i];
  const frames = [];
  for (let f = 0; f < total; f += 1) {
    const a = f * HOP;
    const rms = Math.sqrt(Math.max(0, cs[a + N] - cs[a]) / N);
    if (rms > 1e-5) frames.push({ f, rms });
  }
  if (frames.length < 4) return null;
  frames.sort((p, q) => p.rms - q.rms);
  const take = Math.min(400, Math.max(4, Math.floor(frames.length * 0.12)));
  const picked = frames.slice(0, take);
  const noise = new Float32Array(BINS);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  picked.forEach(({ f }) => {
    const a = f * HOP;
    for (let i = 0; i < N; i += 1) { re[i] = x[a + i] * WIN[i]; im[i] = 0; }
    fft(re, im, false);
    for (let k = 0; k < BINS; k += 1) noise[k] += Math.hypot(re[k], im[k]);
  });
  for (let k = 0; k < BINS; k += 1) noise[k] /= picked.length;
  return noise;
}

async function denoiseChannel(input, { alpha, beta }, signal, report) {
  const pad = N;
  const len = input.length;
  const x = new Float32Array(len + pad * 2);
  x.set(input, pad);
  const total = Math.floor((x.length - N) / HOP) + 1;
  const noise = learnNoise(x, total);
  if (!noise) return new Float32Array(input); // silent / too short: nothing to clean

  const out = new Float32Array(x.length);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const g = new Float32Array(BINS);
  const prev = new Float32Array(BINS).fill(1);

  for (let f = 0; f < total; f += 1) {
    if (signal?.aborted) throw cancelled();
    const a = f * HOP;
    for (let i = 0; i < N; i += 1) { re[i] = x[a + i] * WIN[i]; im[i] = 0; }
    fft(re, im, false);

    for (let k = 0; k < BINS; k += 1) {
      const mag = Math.hypot(re[k], im[k]);
      g[k] = mag > 1e-9 ? Math.max(beta, 1 - (alpha * noise[k]) / mag) : beta;
    }
    // smooth over frequency (3 taps), then over time (fast attack so word onsets stay crisp, slower release)
    for (let k = 0; k < BINS; k += 1) {
      const lo = g[k > 0 ? k - 1 : 0];
      const hi = g[k < BINS - 1 ? k + 1 : BINS - 1];
      let s = (lo + 2 * g[k] + hi) / 4;
      s = s > prev[k] ? 0.25 * prev[k] + 0.75 * s : 0.6 * prev[k] + 0.4 * s;
      prev[k] = s;
      re[k] *= s; im[k] *= s;
      if (k > 0 && k < N / 2) { re[N - k] *= s; im[N - k] *= s; }
    }

    fft(re, im, true);
    for (let i = 0; i < N; i += 1) out[a + i] += re[i] * WIN[i];

    if (f % 120 === 0) {
      report(f / total);
      // eslint-disable-next-line no-await-in-loop
      await tick();
    }
  }

  const res = new Float32Array(len);
  for (let i = 0; i < len; i += 1) {
    const v = out[pad + i] / OLA_NORM;
    res[i] = v > 1 ? 1 : v < -1 ? -1 : v;
  }
  return res;
}

/** Spectral subtraction. AudioBuffer → cleaned AudioBuffer (same channels / rate / length). */
async function spectralDenoiseBuffer(buf, level = 'med', { signal, onProgress } = {}) {
  const cfg = NR_LEVELS[level] || NR_LEVELS.med;
  const OAC = typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
  if (!OAC) throw new NoiseError('unsupported');
  const chs = buf.numberOfChannels;
  const out = new OAC(1, 1, buf.sampleRate).createBuffer(chs, buf.length, buf.sampleRate);
  try {
    for (let c = 0; c < chs; c += 1) {
      const dry = buf.getChannelData(c);
      // eslint-disable-next-line no-await-in-loop
      const cleaned = await denoiseChannel(dry, cfg, signal, (p) => onProgress?.((c + p) / chs));
      applyGain(cleaned, makeupGain(dry, cleaned));
      out.copyToChannel(cleaned, c);
    }
  } catch (e) {
    if (e instanceof NoiseError) throw e;
    throw new NoiseError('failed');
  }
  onProgress?.(1);
  INFO.set(out, { engine: 'spectral', model: null, music: false });
  return out;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Neural path                                                                                                        */
/* ------------------------------------------------------------------------------------------------------------------ */

/** One channel → Float32Array at `rate` (browser resampler, offline, fast). Never modifies the buffer. */
async function channelTo(buf, c, rate) {
  const src = buf.getChannelData(c);
  if (buf.sampleRate === rate) return src;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const tmp = new OAC(1, 1, buf.sampleRate).createBuffer(1, buf.length, buf.sampleRate);
  tmp.copyToChannel(src, 0);
  const ctx = new OAC(1, Math.max(1, Math.round((buf.length * rate) / buf.sampleRate)), rate);
  const node = ctx.createBufferSource();
  node.buffer = tmp;
  node.connect(ctx.destination);
  node.start();
  const r = await ctx.startRendering();
  return r.getChannelData(0).slice();
}

/** Mean absolute difference between two channels: ~0 means mono sound stored as stereo (process once). */
const channelsMatch = (a, b) => {
  let d = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(a.length / 20000));
  for (let i = 0; i < a.length; i += step) { d += Math.abs(a[i] - b[i]); n += 1; }
  return d / Math.max(1, n) < 1e-4;
};

const FRAME = 480; // 10 ms at 48 kHz

function frameRms(x, n) {
  const k = Math.floor(x.length / n);
  const r = new Float32Array(k);
  for (let f = 0; f < k; f += 1) {
    let e = 0;
    for (let i = f * n; i < (f + 1) * n; i += 1) e += x[i] * x[i];
    r[f] = Math.sqrt(e / n);
  }
  return r;
}

/** Level of the loudest 40 % of the original's frames after processing, relative to before (1 = unchanged). */
function levelRatio(orig, clean) {
  const ro = frameRms(orig, FRAME);
  const rc = frameRms(clean, FRAME);
  const k = Math.min(ro.length, rc.length);
  if (k < 10) return 1;
  const idx = Array.from({ length: k }, (_, i) => i).sort((p, q) => ro[q] - ro[p]).slice(0, Math.max(5, Math.floor(k * 0.4)));
  let so = 0;
  let sc = 0;
  idx.forEach((i) => { so += ro[i]; sc += rc[i]; });
  return so < 1e-6 ? 1 : sc / so;
}

/** The models take a little level off the voice: restore it (at most +5 dB, never past full scale). */
function makeupGain(orig, clean) {
  const r = levelRatio(orig, clean);
  if (r < 1e-6) return 1;
  let g = Math.min(1.78, Math.max(1, 1 / r));
  let peak = 0;
  for (let i = 0; i < clean.length; i += 1) { const v = Math.abs(clean[i]); if (v > peak) peak = v; }
  if (peak * g > 0.98) g = Math.max(1, 0.98 / Math.max(peak, 1e-6));
  return g;
}

function applyGain(x, g) {
  for (let i = 0; i < x.length; i += 1) {
    const v = x[i] * g;
    x[i] = v > 1 ? 1 : v < -1 ? -1 : v;
  }
}

/** Scale-invariant SNR (dB) of `a` against `b`: how closely two cleaned versions of the same clip agree. */
function agreement(a, b) {
  const n = Math.min(a.length, b.length);
  let ab = 0;
  let bb = 0;
  for (let i = 0; i < n; i += 1) { ab += a[i] * b[i]; bb += b[i] * b[i]; }
  if (bb < 1e-9) return 99;
  const k = ab / bb;
  let sig = 0;
  let err = 0;
  for (let i = 0; i < n; i += 1) { const t = k * b[i]; const e = a[i] - t; sig += t * t; err += e * e; }
  return 10 * Math.log10((sig + 1e-12) / (err + 1e-12));
}

/**
 * Is this clip music / non-speech? Both models run on the loudest ~12 s: on speech + noise they agree closely, on music
 * they diverge (the strong one smears the notes, the light one thins them out).
 */
async function looksLikeMusic(dry, neuralDenoiseChannel, rate, { signal, onProgress }) {
  if (dry.length < 3 * rate) return false;
  const step = rate / 2;
  const parts = Math.floor(dry.length / step);
  const e = new Float64Array(parts + 1);
  for (let k = 0; k < parts; k += 1) {
    let sum = 0;
    for (let i = k * step; i < (k + 1) * step; i += 4) sum += dry[i] * dry[i];
    e[k + 1] = e[k] + sum;
  }
  const span = Math.min(parts, Math.round((PROBE_SECONDS * rate) / step));
  let best = 0;
  let bestSum = -1;
  for (let k = 0; k + span <= parts; k += 1) {
    const v = e[k + span] - e[k];
    if (v > bestSum) { bestSum = v; best = k; }
  }
  const seg = dry.subarray(best * step, Math.min(dry.length, (best + span) * step));
  const light = await neuralDenoiseChannel('rnnoise', seg, { signal, onProgress: (p) => onProgress?.(p * 0.3) });
  const strong = await neuralDenoiseChannel('gtcrn', seg, { signal, onProgress: (p) => onProgress?.(0.3 + p * 0.7) });
  return agreement(strong, light) < AGREE_MIN;
}

async function neuralDenoiseBuffer(buf, level, { signal, onProgress } = {}) {
  const cfg = NR_LEVELS[level] || NR_LEVELS.med;
  const { neuralDenoiseChannel, NEURAL_RATE } = await import('./neuralDenoise');
  const model = cfg.model === 'gtcrn' && buf.duration > GTCRN_MAX_SECONDS ? 'rnnoise' : cfg.model;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const chs = buf.numberOfChannels;
  const len = Math.max(1, Math.round((buf.length * NEURAL_RATE) / buf.sampleRate));
  const out = new OAC(1, 1, NEURAL_RATE).createBuffer(chs, len, NEURAL_RATE);
  const twin = chs === 2 && channelsMatch(buf.getChannelData(0), buf.getChannelData(1));
  const jobs = twin ? 1 : chs;

  // one probe for the whole clip (first channel) before any heavy work
  const first = await channelTo(buf, 0, NEURAL_RATE);
  const music = await looksLikeMusic(first, neuralDenoiseChannel, NEURAL_RATE, { signal, onProgress: (p) => onProgress?.(p * 0.15) });

  for (let c = 0; c < jobs; c += 1) {
    const share = (p) => onProgress?.(0.15 + 0.85 * ((c + p) / jobs));
    // eslint-disable-next-line no-await-in-loop
    const dry = c === 0 ? first : await channelTo(buf, c, NEURAL_RATE);
    let mixed = null;
    if (!music) {
      // eslint-disable-next-line no-await-in-loop
      const wet = await neuralDenoiseChannel(model, dry, { signal, onProgress: (p) => share(p * 0.95) });
      if (levelRatio(dry, wet) >= MUSIC_RATIO) {
        mixed = new Float32Array(dry.length);
        for (let i = 0; i < dry.length; i += 1) mixed[i] = cfg.wet * wet[i] + (1 - cfg.wet) * dry[i];
      }
    }
    if (!mixed) {
      // music / non-speech: only the steady noise (hiss, hum) goes, the speech models would smear or erase the rest
      // eslint-disable-next-line no-await-in-loop
      mixed = await denoiseChannel(dry, cfg, signal, (p) => share(music ? p : 0.95 + p * 0.05));
      INFO.set(out, { engine: 'neural', model, music: true });
    }
    applyGain(mixed, makeupGain(dry, mixed));
    out.copyToChannel(mixed, c);
    if (twin) out.copyToChannel(mixed, 1);
  }
  onProgress?.(1);
  const prev = INFO.get(out);
  INFO.set(out, { engine: 'neural', model, music: music || !!prev?.music });
  return out;
}

/** AudioBuffer → cleaned AudioBuffer (same channels / duration; 48 kHz when the neural path ran). `onProgress(0..1)`. */
export async function denoiseBuffer(buf, level = 'med', opts = {}) {
  try {
    return await neuralDenoiseBuffer(buf, level, opts);
  } catch (e) {
    if (e?.name === 'AbortError' || opts.signal?.aborted) throw cancelled();
    if (e instanceof NoiseError) throw e;
    console.warn('[noise] neural model unavailable, using the spectral fallback:', e?.message || e);
    return spectralDenoiseBuffer(buf, level, opts);
  }
}
