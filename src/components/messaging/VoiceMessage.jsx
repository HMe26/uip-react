import { useEffect, useMemo, useRef, useState } from 'react';
import '../../styles/css/messaging-voice.css';
import { audioToMp3 } from '../../lib/audioToMp3';
import { useVolumeBoost } from '../../lib/volumeBoost';
import VolumeBoost from '../VolumeBoost';

const PlayIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>;
const PauseIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4.5" height="14" rx="1.2" /><rect x="13.5" y="5" width="4.5" height="14" rx="1.2" /></svg>;

/** Voice notes are recorded as voice-message-<time>.webm (ThreadPanel). Old rows were stored as kind "video". */
export function isVoiceAttachment(a) {
  if (!a) return false;
  if (/^voice-message-/i.test(a.original_name || a.name || '')) return true;
  if (String(a.mime_type || '').toLowerCase().startsWith('audio/')) return true;
  return a.kind === 'audio';
}

const DownloadIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></svg>;

const MIN_BARS = 16;
const MAX_BARS = 64;
const SPEEDS = [1, 1.5, 2];

// A stable pseudo-random "waveform" per message (real peaks would need decoding the whole file).
function barsFor(seed, count) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Array.from({ length: count }, () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return 0.25 + ((h >>> 0) % 1000) / 1000 * 0.75;
  });
}

const fmt = (s) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

// MediaRecorder .webm files have no length header (duration = Infinity). The old code seeked the PLAYING element to the end
// to learn it, which made playback stall/skip. Probe it once on a throw-away element instead and remember it per file.
const durationCache = new Map();
function probeDuration(src) {
  if (durationCache.has(src)) return Promise.resolve(durationCache.get(src));
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = 'metadata';
    const done = (d) => { a.removeAttribute('src'); a.load(); durationCache.set(src, d); resolve(d); };
    a.onerror = () => done(0);
    a.onloadedmetadata = () => {
      if (Number.isFinite(a.duration)) { done(a.duration); return; }
      a.ontimeupdate = () => { if (Number.isFinite(a.duration)) { a.ontimeupdate = null; done(a.duration); } };
      a.currentTime = 1e101;
    };
    a.src = src;
  });
}

export default function VoiceMessage({ src, duration: knownDuration, disabled = false, name, downloadable = true }) {
  const audioRef = useRef(null);
  const vb = useVolumeBoost(audioRef, { src });   // up to 400% for quiet recordings
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(Number(knownDuration) || 0);
  const [speed, setSpeed] = useState(1);
  const [saving, setSaving] = useState(false);
  const [dlMenu, setDlMenu] = useState(false); // download button expands into [MP3 | original] choices
  const waveRef = useRef(null);
  const [count, setCount] = useState(36);   // how many bars fit: measured, so the wave never overflows into the time / buttons
  const [scrub, setScrub] = useState(false);
  const bars = useMemo(() => barsFor(String(src || 'x'), count), [src, count]);

  useEffect(() => {
    const el = waveRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const fit = () => { const w = el.clientWidth; if (w > 0) setCount(Math.max(MIN_BARS, Math.min(MAX_BARS, Math.floor(w / 5)))); };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return undefined;
    let alive = true;
    // Only read the length here. Old recordings without a length header are probed when they are first PLAYED (see toggle):
    // probing every voice note on mount made the whole chat download every file and seek inside it -> heavy, jumpy playback.
    const onMeta = () => { if (Number.isFinite(el.duration)) setDuration(el.duration); };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onTime = () => { if (el.currentTime < 1e100) setTime(el.currentTime); };
    const onEnd = () => { setPlaying(false); setTime(0); };
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', onEnd);
    el.addEventListener('pause', onPause);
    el.addEventListener('play', onPlay);
    return () => {
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('play', onPlay);
      alive = false;
    };
  }, [src, knownDuration]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el || disabled) return;
    if (el.paused) {
      // only one voice note at a time
      document.querySelectorAll('audio').forEach((o) => { if (o !== el && !o.hasAttribute('data-persist-media')) o.pause(); });
      el.play().catch(() => {});
      if (!duration && !Number.isFinite(el.duration)) probeDuration(src).then((d) => { if (d) setDuration(d); });
    } else el.pause();
  };
  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };
  const seekTo = (e) => {
    const el = audioRef.current; const box = waveRef.current;
    if (!el || !box || !duration) return;
    const r = box.getBoundingClientRect();
    const p = (e.clientX - r.left) / r.width;      // the card is always dir=ltr: left = start
    el.currentTime = Math.max(0, Math.min(1, p)) * duration;
    setTime(el.currentTime);
  };
  const onWaveDown = (e) => { if (!duration) return; setScrub(true); try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* unsupported */ } seekTo(e); };
  const onWaveMove = (e) => { if (scrub) seekTo(e); };
  const onWaveUp = () => setScrub(false);
  const onWaveKey = (e) => {
    const el = audioRef.current; if (!el || !duration) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); el.currentTime = Math.min(duration, el.currentTime + 5); setTime(el.currentTime); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); el.currentTime = Math.max(0, el.currentTime - 5); setTime(el.currentTime); }
  };

  // Save the recording to the device — as the original file, or converted to MP3 (done in the browser).
  // fetch → blob so the `download` name is honoured even when the uploads live on another origin.
  const download = async (format) => {
    if (!src || saving) return;
    const original = name || String(src).split('?')[0].split('/').pop() || 'voice-message.webm';
    setSaving(true);
    setDlMenu(false);
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(String(res.status));
      let blob = await res.blob();
      let fileName = original;
      if (format === 'mp3') {
        blob = await audioToMp3(blob);
        fileName = original.replace(/\.[^.]+$/, '') + '.mp3';
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      if (format !== 'mp3') window.open(src, '_blank', 'noopener'); // blocked by CORS → let the browser handle it
      else window.alert('تعذّر تحويل التسجيل إلى MP3 / Could not convert this recording to MP3.');
    } finally {
      setSaving(false);
    }
  };

  const progress = duration ? time / duration : 0;
  return (
    <div className={`vm vm--pro${playing ? ' is-playing' : ''}${scrub ? ' is-scrub' : ''}`} dir="ltr">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button type="button" className="vm__play" onClick={toggle} disabled={disabled} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="vm__main">
        <div ref={waveRef} className="vm__wave" onPointerDown={onWaveDown} onPointerMove={onWaveMove} onPointerUp={onWaveUp} onPointerCancel={onWaveUp}
          onKeyDown={onWaveKey} tabIndex={0} role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)}>
          {bars.map((h, i) => (
            <span key={i} className={i / count < progress ? 'is-done' : ''} style={{ height: `${Math.round(h * 100)}%` }} />
          ))}
        </div>
        <div className="vm__meta">
          <span className="vm__time">{fmt(playing || time > 0 ? time : duration)}{duration && (playing || time > 0) ? <i> / {fmt(duration)}</i> : null}</span>
          <span className="vm__actions">
            <button type="button" className="vm__speed" onClick={cycleSpeed} aria-label="Speed">{speed}x</button>
            {!disabled && <VolumeBoost vb={vb} variant="chip" />}
            {downloadable && !disabled && (dlMenu ? (
        <span className="vm__dlmenu" role="menu" onMouseLeave={() => setDlMenu(false)}>
          <button type="button" role="menuitem" className="vm__dlopt" onClick={() => download('mp3')} title="MP3">MP3</button>
          <button type="button" role="menuitem" className="vm__dlopt" onClick={() => download('original')} title={name || 'original'}>
            {(String(name || src).split('?')[0].split('.').pop() || 'file').toUpperCase().slice(0, 5)}
          </button>
          <button type="button" className="vm__dlopt vm__dlopt--x" onClick={() => setDlMenu(false)} aria-label="Close">×</button>
        </span>
      ) : (
        <button type="button" className="vm__dl" onClick={() => setDlMenu(true)} disabled={saving} aria-haspopup="menu" aria-label="Download" title="تنزيل / Download">
          {saving ? <span className="vm__spin" aria-hidden="true" /> : <DownloadIcon />}
        </button>
      ))}
          </span>
        </div>
      </div>
    </div>
  );
}
