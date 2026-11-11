import { createRnnoiseNode, rnnoiseSupported, RNNOISE_SAMPLE_RATE } from '../rnnoise';

/**
 * Real noise isolation for calls. The browser's built-in "noiseSuppression" only removes steady hiss; fans, keyboards, traffic and
 * background chatter pass straight through. RNNoise is a neural voice-activity/denoise model that keeps the voice and drops the rest.
 *
 *   mic track -> [RNNoise] -> gain -> destination track   (what we send)
 *            \-> gain(raw) -/                              (bypass, when the user switches isolation off)
 *
 * Switching on/off mid-call is just a crossfade between the two gains, so the track the peer connection already sends never changes.
 * Anything that goes wrong (no AudioWorklet, wasm blocked, 44.1 kHz-only device...) returns null and the call simply keeps the
 * browser's own suppression - it must never break a call.
 */

export const noiseSuppressSupported = () => rnnoiseSupported();

/**
 * @param {MediaStream} stream  a stream from getUserMedia (audio and optionally video)
 * @param {boolean} enabled     initial state of the isolation switch
 * @returns {Promise<null | { stream: MediaStream, setEnabled: (on: boolean) => void }>}
 */
export async function attachNoiseSuppressor(stream, enabled = true, opts = {}) {
  if (!noiseSuppressSupported()) return null;
  const micTrack = stream && stream.getAudioTracks && stream.getAudioTracks()[0];
  if (!micTrack) return null;

  let ctx = null;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ sampleRate: RNNOISE_SAMPLE_RATE, latencyHint: 'interactive' }); // RNNoise works at 48 kHz only
    const rnnoise = await createRnnoiseNode(ctx);
    if (!rnnoise) { ctx.close(); return null; }
    if (ctx.state === 'suspended') { try { ctx.resume().catch(() => {}); } catch { /* resumes on the next gesture */ } } // never await: it stays pending until a tap and would freeze the call start

    const src = ctx.createMediaStreamSource(new MediaStream([micTrack]));
    const dest = ctx.createMediaStreamDestination();
    const gainClean = ctx.createGain();
    const gainRaw = ctx.createGain();
    // start silent on both paths so the first milliseconds can never play dry + cleaned at the same time (that doubled voice is an echo)
    gainClean.gain.value = 0;
    gainRaw.gain.value = 0;

    // Voice clean-up chain (all inside the browser, no network):
    //   high-pass 85 Hz  -> removes rumble / table knocks / handling noise
    //   [RNNoise | raw]  -> neural noise isolation (or bypass)
    //   low-pass 12 kHz  -> removes the high-pitched hiss / whine above the voice band
    //   notch (adaptive) -> parks itself on a feedback whistle if one starts, releases when it stops
    //   limiter          -> a sudden loud peak (or the start of a howl) is clipped softly instead of squealing
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 85; hp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 16000; lp.Q.value = 0.7;
    const mix = ctx.createGain();
    const howl = ctx.createBiquadFilter();
    howl.type = 'notch'; howl.frequency.value = 20000; howl.Q.value = 28;
    // Loudness: RNNoise (and a laptop mic array) hand back a quiet voice. A gentle compressor evens out soft/loud speech, then a
    // make-up gain brings it to a normal call level; the limiter right after it catches peaks so the boost can never clip or squeal.
    // No compressor / make-up gain here any more: boosting after the echo canceller amplified the leftover echo and distorted the voice.
    const limiter = ctx.createDynamicsCompressor(); // only a safety net against clipping
    limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.003; limiter.release.value = 0.1;

    src.connect(hp);
    hp.connect(rnnoise); rnnoise.connect(gainClean); gainClean.connect(mix);
    hp.connect(gainRaw); gainRaw.connect(mix);
    mix.connect(lp); lp.connect(howl); howl.connect(limiter); limiter.connect(dest);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    mix.connect(analyser);
    const stopHowl = watchHowl(ctx, analyser, howl, opts && opts.onFeedback);

    let first = true;
    const setEnabled = (on) => {
      const t = ctx.currentTime;
      gainClean.gain.setTargetAtTime(on ? 1 : 0, t, 0.015);
      gainRaw.gain.setTargetAtTime(on ? 0 : 1, t, 0.015);
      // the browser's own suppression follows the switch too (the capture track is the one that owns it)
      if (!first) { try { micTrack.applyConstraints({ noiseSuppression: !!on, echoCancellation: true }).catch(() => {}); } catch { /* not supported live */ } }
      first = false;
    };
    setEnabled(!!enabled);
    try { dest.stream.getAudioTracks()[0].contentHint = 'speech'; } catch { /* optional */ }

    const outAudio = dest.stream.getAudioTracks()[0];
    if (!outAudio) { ctx.close(); return null; }

    // Stopping the track the call sends must also release the real microphone and the audio graph.
    const realStop = outAudio.stop.bind(outAudio);
    let released = false;
    outAudio.stop = () => {
      if (released) return;
      released = true;
      try { realStop(); } catch { /* already stopped */ }
      try { micTrack.stop(); } catch { /* already stopped */ }
      try { stopHowl(); } catch { /* ignore */ }
      try { src.disconnect(); rnnoise.disconnect(); } catch { /* ignore */ }
      try { rnnoise.destroy && rnnoise.destroy(); } catch { /* ignore */ }
      try { ctx.close(); } catch { /* ignore */ }
    };
    // If the OS/browser ends the microphone (unplugged, permission revoked), end ours too.
    micTrack.addEventListener('ended', () => { if (!released) outAudio.stop(); });

    const out = new MediaStream([outAudio, ...stream.getVideoTracks()]);
    return { stream: out, setEnabled };
  } catch (e) {
    try { console.warn('[call] noise isolation unavailable, using the browser filter:', e && e.message); } catch { /* diagnostics only */ }
    try { ctx && ctx.close(); } catch { /* ignore */ }
    return null;
  }
}

/**
 * Acoustic-feedback ("whistle") guard. A howl is a very pure tone that stays on one frequency and grows; speech never looks like that
 * (voiced sound has a comb of harmonics, not one spike). Every 100 ms we look for a spectral peak that stands >30 dB above its
 * neighbourhood and stays on the same bin for ~0.8 s, then park a narrow notch on it. When the peak is gone for ~3 s the notch is
 * moved out of the audible range again. Returns a function that stops the watcher.
 */
function watchHowl(ctx, analyser, notch, onFeedback) {
  const n = analyser.frequencyBinCount;
  const data = new Float32Array(n);
  const binHz = ctx.sampleRate / analyser.fftSize;
  const lo = Math.ceil(500 / binHz);
  const hi = Math.floor(7000 / binHz);
  let cand = -1;
  let hold = 0;
  let quiet = 0;
  let active = false;
  const id = setInterval(() => {
    try {
      analyser.getFloatFrequencyData(data);
      let k = lo;
      for (let i = lo; i <= hi; i += 1) if (data[i] > data[k]) k = i;
      let sum = 0;
      let cnt = 0;
      for (let i = Math.max(lo, k - 14); i <= Math.min(hi, k + 14); i += 1) {
        if (Math.abs(i - k) > 2) { sum += data[i]; cnt += 1; }
      }
      const contrast = data[k] - sum / Math.max(1, cnt);
      const isTone = contrast > 30 && data[k] > -50;
      if (isTone) {
        quiet = 0;
        if (Math.abs(k - cand) <= 1) hold += 1; else { cand = k; hold = 1; }
        if (hold >= 8 && !active) {
          active = true;
          notch.frequency.setTargetAtTime(k * binHz, ctx.currentTime, 0.01);
          try { console.warn('[call] feedback tone suppressed at', Math.round(k * binHz), 'Hz'); } catch { /* diagnostics only */ }
          try { if (onFeedback) onFeedback(Math.round(k * binHz)); } catch { /* the callback must never break the call */ }
        }
      } else {
        hold = 0;
        if (active) {
          quiet += 1;
          if (quiet >= 30) { active = false; notch.frequency.setTargetAtTime(20000, ctx.currentTime, 0.05); }
        }
      }
    } catch { /* never break the call */ }
  }, 100);
  return () => clearInterval(id);
}
