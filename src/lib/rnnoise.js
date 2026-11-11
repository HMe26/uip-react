/**
 * RNNoise (neural-network noise suppression) for the Web Audio graph — lazy-loaded, so the ~120 KB wasm + worklet are only
 * fetched the first time someone records a voice note with "Noise cancel" on.
 *
 *   const node = await createRnnoiseNode(audioContext);   // AudioContext must run at 48 000 Hz
 *   source.connect(node); node.connect(next);
 *
 * Returns null when AudioWorklet / WebAssembly is unavailable or the assets fail to load (the caller keeps its fallback chain).
 */
import workletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import wasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import simdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

let wasmPromise = null;
const loadedContexts = new WeakSet();

export const RNNOISE_SAMPLE_RATE = 48000;

/** True when this browser / WebView can run RNNoise live (AudioWorklet + WebAssembly). */
export const rnnoiseSupported = () => {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    return !!AC && typeof AudioWorkletNode !== 'undefined' && typeof WebAssembly !== 'undefined';
  } catch { return false; }
};

/**
 * Start downloading the wasm + worklet ahead of time (call when the microphone UI appears), so the network is already in
 * place when recording starts and the first words are cleaned too.
 */
export function warmRnnoise() {
  if (!rnnoiseSupported() || wasmPromise) return;
  import('@sapphi-red/web-noise-suppressor')
    .then((lib) => { if (!wasmPromise) wasmPromise = lib.loadRnnoise({ url: wasmUrl, simdUrl }); return wasmPromise; })
    .catch(() => { wasmPromise = null; });
  try { fetch(workletUrl).catch(() => {}); } catch { /* ignore */ }
}

export async function createRnnoiseNode(ctx) {
  try {
    if (!ctx.audioWorklet || typeof WebAssembly === 'undefined' || ctx.sampleRate !== RNNOISE_SAMPLE_RATE) return null;
    const lib = await import('@sapphi-red/web-noise-suppressor');
    if (!wasmPromise) wasmPromise = lib.loadRnnoise({ url: wasmUrl, simdUrl });
    const [wasmBinary] = await Promise.all([
      wasmPromise,
      loadedContexts.has(ctx) ? null : ctx.audioWorklet.addModule(workletUrl).then(() => loadedContexts.add(ctx)),
    ]);
    return new lib.RnnoiseWorkletNode(ctx, { wasmBinary, maxChannels: 1 });
  } catch (err) {
    wasmPromise = null;
    console.warn('[voice] RNNoise unavailable, using the filter chain only', err);
    return null;
  }
}
