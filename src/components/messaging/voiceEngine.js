import { createRnnoiseNode, rnnoiseSupported, RNNOISE_SAMPLE_RATE } from '../../lib/rnnoise';

/**
 * Voice-note audio engine: live level meter (drives the scrolling waveform) + optional noise cancelling.
 *
 *   mic ─┬─ raw ─────────────────────────────────────────────────────┐
 *        └─ high-pass → RNNoise → limiter → low-pass → noise gate ┴→ [recorded stream]
 *
 * "Noise cancel" ON  = RNNoise (a recurrent neural network trained on speech, runs in an AudioWorklet — it removes keyboard
 *                      clicks, fans, street noise, crowd chatter…) + the filter chain + a gentle adaptive gate.
 *                      While RNNoise is still loading (first use only) or if it is unsupported, the browser's own noise
 *                      suppression + a stricter adaptive gate cover for it, so the first seconds are never unprotected.
 * OFF                = untouched microphone signal. Can be flipped at any moment, even mid-recording (cross-faded).
 * Falls back to the plain stream when Web Audio is unavailable, so recording itself can never break.
 */
const BAR = 3;
const GAP = 2;

/**
 * WHY THE RECORDING USED TO CRACKLE: the old chain  mic → Web Audio graph (RNNoise worklet, filters, limiter, gate) →
 * MediaStreamDestination → MediaRecorder  put a real-time audio graph in the recording path. Any hiccup there is baked
 * permanently into the file: the AudioContext clock drifts against the microphone's clock (USB / Bluetooth / phone mics,
 * 44.1 vs 48 kHz), the RNNoise worklet misses its deadline on weak CPUs, the graph is re-wired live when RNNoise finishes
 * loading, and the per-frame gate gain keeps pumping the level.  Result: clicks, uneven volume, "not smooth".
 *
 * Now the recorder gets the raw microphone stream directly (the browser's native, glitch-free pipeline). The Web Audio
 * graph is used ONLY for the live level meter, so even if it stutters the recording is untouched. "Noise cancel" uses the
 * browser's own noise suppression (switchable live). Set LIVE_PROCESSING = true to bring the old RNNoise chain back.
 */
export const LIVE_PROCESSING = false;

/** getUserMedia audio constraints for a voice note. AGC is left OFF on purpose: it pumps the level in every pause. */
export function voiceConstraints(noiseCancel) {
  const live = LIVE_PROCESSING && rnnoiseSupported();
  return {
    channelCount: 1,
    echoCancellation: !(live && noiseCancel),
    noiseSuppression: live ? false : !!noiseCancel,
    autoGainControl: false,
  };
}

export function createVoiceEngine(stream, { noiseCancel = true, getCanvas } = {}) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const fallback = { recordStream: stream, setNoiseCancel() {}, stop() {}, supported: false };
  if (!AC) return fallback;
  const live = LIVE_PROCESSING && rnnoiseSupported();

  let ctx;
  try {
    // 'playback' = larger audio buffers: no crackle / dropouts when the main thread (React, the waveform) or a Bluetooth mic is busy.
    // Latency does not matter here — nothing is played back live, the stream is only recorded.
    // Meter-only context follows the device's own rate (no resampling); only the RNNoise chain needs a fixed 48 kHz.
    ctx = new AC(live ? { sampleRate: RNNOISE_SAMPLE_RATE, latencyHint: 'playback' } : { latencyHint: 'playback' });
  } catch {
    try { ctx = new AC(); } catch { return fallback; }
  }
  let on = !!noiseCancel;
  let raf = 0;
  let stopped = false;
  let neural = false; // RNNoise node is in the graph
  let neuralFailed = !live; // RNNoise cannot run here (or failed to load): the browser's own processing takes over

  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.4;
  src.connect(analyser);

  // Meter-only mode (default): nothing here touches the recording. Noise cancel = the browser's native suppression.
  const track = stream.getAudioTracks()[0];
  let dest = null; let gate = null;
  let applyMode = () => {
    try { track?.applyConstraints({ noiseSuppression: on }).catch(() => {}); } catch { /* not supported live */ }
  };

  if (live) {
    dest = ctx.createMediaStreamDestination();
    const rawGain = ctx.createGain();
    const procGain = ctx.createGain();
    src.connect(rawGain); rawGain.connect(dest);

    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 30; hp.Q.value = 0.6;   // rumble, AC hum, wind
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 16000; lp.Q.value = 0.7;   // hiss above speech
    // brick-wall limiter (no compressor: it lifted the room noise in every pause and squeezed the voice)
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -3; comp.knee.value = 0; comp.ratio.value = 20; comp.attack.value = 0.003; comp.release.value = 0.1;
    gate = ctx.createGain();
    // denoiseIn → denoiseOut is a straight wire until RNNoise finishes loading, then it is re-routed through the network.
    const denoiseIn = ctx.createGain();
    const denoiseOut = ctx.createGain();
    src.connect(hp); hp.connect(denoiseIn); denoiseIn.connect(denoiseOut);
    denoiseOut.connect(lp); lp.connect(comp); comp.connect(gate); gate.connect(procGain); procGain.connect(dest);

    applyMode = () => {
      const t = ctx.currentTime;
      rawGain.gain.setTargetAtTime(on ? 0 : 1, t, 0.03);
      procGain.gain.setTargetAtTime(on ? 1 : 0, t, 0.03);
      if (!on) gate.gain.setTargetAtTime(1, t, 0.02);
      // RNNoise does the heavy lifting; stacking the browser's echo canceller / suppressor / auto-gain on top of it only adds
      // artefacts (measured: ~4 dB lost on the cleaned voice, and the gain control lifts the room noise in every pause), so
      // they step aside while RNNoise runs or is about to. Only when it cannot run does the browser's processing take over.
      const useBrowser = !(on && !neuralFailed);
      try { track?.applyConstraints({ noiseSuppression: on && useBrowser, echoCancellation: useBrowser, autoGainControl: on && useBrowser }).catch(() => {}); } catch { /* not supported live */ }
    };
    applyMode();

    createRnnoiseNode(ctx).then((rn) => {
      if (!rn) { neuralFailed = true; applyMode(); return; }
      if (stopped) { try { rn.disconnect(); } catch { /* gone */ } return; }
      try {
        denoiseIn.disconnect(denoiseOut);
        denoiseIn.connect(rn); rn.connect(denoiseOut);
        neural = true;
        applyMode();
      } catch { /* keep the filter chain */ }
    });
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  // ---- meter + gate + waveform
  const buf = new Uint8Array(analyser.fftSize);
  const levels = [];
  let level = 0;       // smoothed 0..1 for drawing
  let floor = 0.01;    // adaptive noise floor (RMS)
  let hang = 0;        // gate hang time (ms)
  let lastPush = 0;
  let last = performance.now();
  let color = '';

  const draw = () => {
    const canvas = getCanvas?.();
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    if (!color) color = getComputedStyle(canvas).color || '#5b6cff';
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const n = Math.floor((w + GAP) / (BAR + GAP));
    const shown = levels.slice(-n);
    const mid = h / 2;
    g.fillStyle = color;
    for (let i = 0; i < n; i += 1) {
      const v = shown[shown.length - 1 - i];            // newest bar sits at the right edge
      const x = w - (i + 1) * (BAR + GAP) + GAP;
      const bh = Math.max(3, (v === undefined ? 0 : v) * (h - 2));
      g.globalAlpha = v === undefined ? 0.18 : 0.95 - Math.min(0.55, i / n * 0.55);
      g.beginPath();
      if (g.roundRect) g.roundRect(x, mid - bh / 2, BAR, bh, 1.5); else g.rect(x, mid - bh / 2, BAR, bh);
      g.fill();
    }
    g.globalAlpha = 1;
  };

  const tick = (now) => {
    if (stopped) return;
    const dt = now - last; last = now;
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i += 1) { const x = (buf[i] - 128) / 128; sum += x * x; }
    const rms = Math.sqrt(sum / buf.length);

    // noise floor: drops instantly to quieter rooms, creeps up slowly (so a long word does not become "noise")
    floor = rms < floor ? rms : floor + (rms - floor) * 0.0015;
    // The gate used to close at rms < 0.014 (~ -37 dBFS) down to x0.35 / x0.1. A normal laptop / phone mic delivers quiet speech
    // right around that level (auto-gain is off while RNNoise runs), so soft words and the tails of sentences were muted and the
    // recording came out chopped into pieces. Now: RNNoise on = no gate at all (the network already removes the noise between
    // words); RNNoise missing = a much lower threshold, a long hang time and only a mild attenuation, so speech is never cut.
    // A hidden tab stops requestAnimationFrame, so the gate must never be left closed there.
    const open = rms > Math.max(0.005, floor * 3);
    if (open) hang = 450; else hang = Math.max(0, hang - dt);
    if (live && on && gate) {
      const closed = neural ? 1 : 0.5;
      const pass = open || hang > 0 || document.hidden;
      gate.gain.setTargetAtTime(pass ? 1 : closed, ctx.currentTime, pass ? 0.01 : 0.25);
    }

    const target = Math.min(1, Math.pow(rms * 4.2, 0.8));
    level += (target - level) * (target > level ? 0.55 : 0.18); // fast attack, slow release
    if (now - lastPush > 55) { levels.push(level); if (levels.length > 600) levels.shift(); lastPush = now; }
    draw();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    supported: true,
    get neural() { return neural; },
    recordStream: dest ? dest.stream : stream, // meter-only mode records the raw mic stream directly
    setNoiseCancel(v) { on = !!v; applyMode(); },
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      try { src.disconnect(); } catch { /* already gone */ }
      ctx.close().catch(() => {});
    },
  };
}
