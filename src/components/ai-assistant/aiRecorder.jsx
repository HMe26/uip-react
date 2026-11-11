import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { createVoiceEngine, voiceConstraints } from '../messaging/voiceEngine';

/**
 * Voice recording for the AI assistant composer.
 *
 *   const rec = useVoiceRecorder({ onComplete(file), onError(code) });
 *   rec.state     'idle' | 'recording' | 'paused'
 *   rec.elapsed   seconds recorded (pauses excluded)
 *   rec.canvasRef canvas the live waveform is drawn on · rec.noiseCancel / setNoiseCancel(bool) (RNNoise, switchable live)
 *   rec.start() · rec.stop() (keep + attach) · rec.cancel() (discard) · rec.togglePause()
 *
 * <RecorderBar rec={rec} t={t} /> replaces the text box while recording: discard · live timer · live waveform · pause · done.
 */

const MIN_SECONDS = 0.6;          // shorter than this is an accidental tap
const MAX_SECONDS = 15 * 60;      // hard stop

export function fmtClock(s) {
  const n = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

export function useVoiceRecorder({ onComplete, onError } = {}) {
  const [state, setState] = useState('idle');
  const [elapsed, setElapsed] = useState(0);
  const [noiseCancel, setNoiseCancelState] = useState(() => { try { return localStorage.getItem('uip_voice_nc') !== '0'; } catch { return true; } });
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const ncRef = useRef(noiseCancel);

  const recRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const discardRef = useRef(false);
  const startedRef = useRef(null); // Date.now() of the running segment, null while paused / idle
  const bankedRef = useRef(0);    // seconds from earlier segments (before a pause)
  const cbRef = useRef({ onComplete, onError });
  cbRef.current = { onComplete, onError };

  const release = useCallback(() => {
    if (streamRef.current) streamRef.current.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (engineRef.current) { engineRef.current.stop(); engineRef.current = null; }
  }, []);

  // live timer
  useEffect(() => {
    if (state !== 'recording') return undefined;
    startedRef.current = Date.now();
    const id = setInterval(() => {
      const total = bankedRef.current + (startedRef.current ? (Date.now() - startedRef.current) / 1000 : 0);
      setElapsed(total);
      if (total >= MAX_SECONDS && recRef.current && recRef.current.state !== 'inactive') { bank(); recRef.current.stop(); }
    }, 200);
    return () => clearInterval(id);
  }, [state]);

  const bank = () => {
    if (startedRef.current) { bankedRef.current += (Date.now() - startedRef.current) / 1000; startedRef.current = null; }
  };

  const start = useCallback(async () => {
    if (recRef.current && recRef.current.state !== 'inactive') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      cbRef.current.onError?.('unsupported');
      return;
    }
    let stream;
    try {
      const nc = ncRef.current;
      stream = await navigator.mediaDevices.getUserMedia({ audio: voiceConstraints(nc) });
    } catch (err) {
      cbRef.current.onError?.(err && (err.name === 'NotAllowedError' || err.name === 'SecurityError') ? 'denied' : 'nomic');
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    discardRef.current = false;
    bankedRef.current = 0;
    startedRef.current = null;
    setElapsed(0);

    // live meter + noise cancelling sit between the mic and the recorder (same engine as the people-to-people chat)
    const engine = createVoiceEngine(stream, { noiseCancel: ncRef.current, getCanvas: () => canvasRef.current });
    engineRef.current = engine;

    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
    const recorder = mime ? new MediaRecorder(engine.recordStream, { mimeType: mime, audioBitsPerSecond: 48000 }) : new MediaRecorder(engine.recordStream);
    recRef.current = recorder;
    recorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); });
    recorder.addEventListener('stop', () => {
      const seconds = bankedRef.current;
      release();
      setState('idle');
      setElapsed(0);
      recRef.current = null;
      if (discardRef.current) return;
      if (seconds < MIN_SECONDS || !chunksRef.current.length) { cbRef.current.onError?.('short'); return; }
      const type = String(recorder.mimeType || 'audio/webm').split(';')[0];
      const blob = new Blob(chunksRef.current, { type });
      const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
      cbRef.current.onComplete?.(new File([blob], `voice-message-${Date.now()}.${ext}`, { type }));
    });
    recorder.start(250);
    setState('recording');
  }, [release]);

  const finish = useCallback((discard) => {
    discardRef.current = discard;
    const r = recRef.current;
    if (r && r.state !== 'inactive') {
      bank();   // the 'stop' handler reads the total
      r.stop();
    }
  }, []);

  const togglePause = useCallback(() => {
    const r = recRef.current;
    if (!r) return;
    if (r.state === 'recording') { bank(); r.pause(); setState('paused'); }
    else if (r.state === 'paused') { r.resume(); setState('recording'); }
  }, []);

  // never leave the microphone open
  useEffect(() => () => {
    discardRef.current = true;
    const r = recRef.current;
    if (r && r.state !== 'inactive') { try { r.stop(); } catch { /* already stopped */ } }
    release();
  }, [release]);

  const setNoiseCancel = useCallback((v) => {
    ncRef.current = v;
    setNoiseCancelState(v);
    try { localStorage.setItem('uip_voice_nc', v ? '1' : '0'); } catch { /* ignore */ }
    engineRef.current?.setNoiseCancel(v);   // can be flipped mid-recording
  }, []);

  return { state, elapsed, canvasRef, noiseCancel, setNoiseCancel, start, stop: () => finish(false), cancel: () => finish(true), togglePause };
}

/* ---------------------------------------------------------------- bar shown while recording */

export function RecorderBar({ rec, t }) {
  const paused = rec.state === 'paused';
  return (
    <div className={`ai-rec${paused ? ' is-paused' : ''}`} role="group" aria-label={t('recording')}>
      <button type="button" className="ai-rec__btn ai-rec__btn--cancel" onClick={rec.cancel} aria-label={t('recCancel')} title={t('recCancel')}>
        <Icon name="trash" size={17} />
      </button>

      <div className="ai-rec__main" dir="ltr">
        <span className="ai-rec__dot" aria-hidden="true" />
        <span className="ai-rec__time" role="timer" aria-live="off">{fmtClock(rec.elapsed)}</span>
        <canvas ref={rec.canvasRef} className="ai-rec__wave" aria-hidden="true" />
      </div>

      <button type="button" className={`ai-rec__nc${rec.noiseCancel ? ' is-on' : ''}`} aria-pressed={rec.noiseCancel} onClick={() => rec.setNoiseCancel(!rec.noiseCancel)} title={t('ncHint')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12h2M7 8v8M11 4v16M15 8v8M19 11v2" /></svg>
        <span>{t('ncLabel')}</span>
      </button>

      <button type="button" className="ai-rec__btn ai-rec__btn--pause" onClick={rec.togglePause} aria-label={paused ? t('recResume') : t('recPause')} title={paused ? t('recResume') : t('recPause')}>
        {paused
          ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>
          : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4.5" height="14" rx="1.2" /><rect x="13.5" y="5" width="4.5" height="14" rx="1.2" /></svg>}
      </button>
      <button type="button" className="ai-rec__btn ai-rec__btn--done" onClick={rec.stop} aria-label={t('recDone')} title={t('recDone')}>
        <Icon name="check" size={18} />
      </button>
    </div>
  );
}
