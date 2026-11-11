/**
 * Neural speech denoising for the video editor's "noise isolation" (عزل الضوضاء) — RNNoise and GTCRN.
 *
 * Both models ship as AudioWorklet processors. In an OfflineAudioContext they are useless for this: the processor
 * loads its wasm asynchronously and the offline render finishes first, so the output is silence. So the worklet file is
 * loaded as a plain module with a tiny AudioWorkletProcessor shim and driven by hand in 128-sample blocks. That is
 * deterministic, faster than real time, and the loop yields to the UI between chunks.
 *
 * Everything is served from our own origin (CSP: script-src 'self' 'wasm-unsafe-eval').
 *
 *   const out = await neuralDenoiseChannel('rnnoise', samples48k, { signal, onProgress });
 *
 * Input must be 48 kHz mono Float32Array; the result has the same length (processing latency is compensated).
 * Throws on anything unexpected: the caller falls back to the spectral method.
 */
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import gtcrnWorkletUrl from '@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import gtcrnWasmUrl from '@sapphi-red/web-noise-suppressor/gtcrn.wasm?url';

export const NEURAL_RATE = 48000;

/** Processing delay of each model in samples at 48 kHz (measured by cross-correlation against the input). */
const LAG = { rnnoise: 992, gtcrn: 1530 };
const BLOCK = 128;
const TAIL = 4096; // zeros appended so the delayed tail of the signal still comes out

const classes = {};
const wasms = {};

async function loadProcessorClass(kind) {
  if (classes[kind]) return classes[kind];
  const g = globalThis;
  const saved = { P: g.AudioWorkletProcessor, R: g.registerProcessor };
  let Cls = null;
  g.AudioWorkletProcessor = class {
    constructor() {
      this.port = { addEventListener() {}, postMessage() {} };
    }
  };
  g.registerProcessor = (_name, c) => {
    Cls = c;
  };
  try {
    await import(/* @vite-ignore */ kind === 'rnnoise' ? rnnoiseWorkletUrl : gtcrnWorkletUrl);
  } finally {
    g.AudioWorkletProcessor = saved.P;
    g.registerProcessor = saved.R;
    if (saved.P === undefined) delete g.AudioWorkletProcessor;
    if (saved.R === undefined) delete g.registerProcessor;
  }
  if (!Cls) throw new Error('worklet class missing');
  classes[kind] = Cls;
  return Cls;
}

async function loadWasm(kind) {
  if (!wasms[kind]) {
    wasms[kind] = (async () => {
      const lib = await import('@sapphi-red/web-noise-suppressor');
      return kind === 'rnnoise'
        ? lib.loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdUrl })
        : lib.loadGtcrn({ url: gtcrnWasmUrl });
    })().catch((e) => {
      delete wasms[kind];
      throw e;
    });
  }
  return wasms[kind];
}

const yieldUi = () => new Promise((r) => setTimeout(r, 0));

export async function neuralDenoiseChannel(kind, x, { signal, onProgress } = {}) {
  if (!LAG[kind]) throw new Error(`unknown model ${kind}`);
  const [Cls, wasm] = await Promise.all([loadProcessorClass(kind), loadWasm(kind)]);

  // the GTCRN worklet reads the global `sampleRate` while it builds its processor
  const g = globalThis;
  const hadRate = 'sampleRate' in g;
  if (!hadRate) g.sampleRate = NEURAL_RATE;
  let proc;
  try {
    proc = new Cls({ processorOptions: { wasmBinary: wasm.slice(0), maxChannels: 1 } });
    for (let i = 0; i < 400 && !proc.processor; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 15));
    }
  } finally {
    if (!hadRate) delete g.sampleRate;
  }
  if (!proc?.processor) throw new Error('model did not start');

  try {
    const lag = LAG[kind];
    const total = Math.ceil((x.length + lag + TAIL) / BLOCK) * BLOCK;
    const out = new Float32Array(total);
    const inBlock = new Float32Array(BLOCK);
    const outBlock = new Float32Array(BLOCK);
    const ins = [[inBlock]];
    const outs = [[outBlock]];
    let lastYield = performance.now();
    for (let i = 0; i < total; i += BLOCK) {
      inBlock.fill(0);
      if (i < x.length) inBlock.set(x.subarray(i, Math.min(x.length, i + BLOCK)));
      proc.process(ins, outs, {});
      out.set(outBlock, i);
      if ((i / BLOCK) % 256 === 0 && performance.now() - lastYield > 40) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        onProgress?.(i / total);
        // eslint-disable-next-line no-await-in-loop
        await yieldUi();
        lastYield = performance.now();
      }
    }
    onProgress?.(1);
    return out.slice(lag, lag + x.length);
  } finally {
    try { proc.destroy(); } catch { /* already destroyed */ }
  }
}
