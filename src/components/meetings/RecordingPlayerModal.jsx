import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import { useTranslations } from '../../context/LanguageContext';
import { saveBlob } from '../../lib/exporter';
import i18nCommon from '../../i18n/common';
import i18nMeetings from '../../i18n/shared/meetings';
import '../../styles/css/pages/recording-player.css';

const translations = { ...i18nCommon, ...i18nMeetings };
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

const fmtDuration = (sec) => {
  if (sec == null) return '';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};
const fmtSize = (b) => {
  if (b == null) return '';
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

/** File name for a saved recording: keeps the original name, otherwise builds one with the right extension. */
export function recordingFileName(r) {
  if (r.original_name) return r.original_name;
  const ext = r.extension || (r.mime_type && r.mime_type.split('/')[1]?.split(';')[0]) || (r.kind === 'audio' ? 'webm' : 'mp4');
  return `recording-${r.id}.${ext}`;
}

/**
 * Downloads a recording as a real file (blob -> save dialog) instead of opening the raw media URL in a new, unstyled
 * browser tab. If the storage host refuses a cross-origin fetch, falls back to a normal download link.
 */
export async function downloadRecording(r) {
  const name = recordingFileName(r);
  // Preferred: the backend's signed "attachment" link — the browser saves the file and never leaves the page.
  if (r.attachment_url) {
    const a = document.createElement('a');
    a.href = r.attachment_url;
    a.download = name;
    a.rel = 'noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  try {
    const res = await fetch(r.download_url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    saveBlob(await res.blob(), name);
  } catch {
    const a = document.createElement('a');
    a.href = r.download_url;
    a.download = name;
    a.rel = 'noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

/**
 * Plays a recording in place (video with controls, or an audio card) with speed buttons and a proper Download button.
 * `container` lets the live room mount it inside `.meeting-room`, so the room's light/dark tokens apply to it.
 */
export default function RecordingPlayerModal({ recording, onClose, container }) {
  const t = useTranslations(translations);
  const mediaRef = useRef(null);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const isAudio = recording.kind === 'audio' || /^audio\//.test(recording.mime_type || '');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => { if (mediaRef.current) mediaRef.current.playbackRate = speed; }, [speed]);

  const sub = [recording.started_by_display_name, recording.duration_seconds != null ? fmtDuration(recording.duration_seconds) : null, fmtSize(recording.size_bytes)]
    .filter(Boolean).join(' · ');

  const modal = (
    <div className="rec-player" onClick={onClose}>
      <div className="rec-player__box" role="dialog" aria-modal="true" aria-label={t('Preview')} onClick={(e) => e.stopPropagation()}>
        <div className="rec-player__head">
          <span className="rec-player__ico"><Icon name={isAudio ? 'mic' : 'monitor'} size={18} /></span>
          <div className="rec-player__title">
            <strong title={recordingFileName(recording)}>{recordingFileName(recording)}</strong>
            {sub && <span>{sub}</span>}
          </div>
          <button type="button" className="rec-player__close" onClick={onClose} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={16} /></button>
        </div>

        <div className="rec-player__stage">
          {!recording.download_url && <div className="rec-player__msg">{t('Recording is still being processed.')}</div>}
          {recording.download_url && failed && (
            <div className="rec-player__msg">
              <Icon name="alert-triangle" size={26} />
              <span>{t('Your browser cannot play this recording. Download it to watch it.')}</span>
            </div>
          )}
          {recording.download_url && !failed && !isAudio && (
            <video ref={mediaRef} src={recording.download_url} controls autoPlay playsInline preload="metadata" onError={() => setFailed(true)} />
          )}
          {recording.download_url && !failed && isAudio && (
            <div className="rec-player__audio">
              <span className="rec-player__audio-art"><Icon name="mic" size={40} /></span>
              <audio ref={mediaRef} src={recording.download_url} controls autoPlay preload="metadata" onError={() => setFailed(true)} />
            </div>
          )}
        </div>

        <div className="rec-player__foot">
          <div className="rec-player__speeds" role="group" aria-label={t('Speed')}>
            {SPEEDS.map((v) => (
              <button key={v} type="button" className={speed === v ? 'is-active' : ''} onClick={() => setSpeed(v)}>{v}×</button>
            ))}
          </div>
          <div className="rec-player__actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>{t('Close')}</button>
            {recording.download_url && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { await downloadRecording(recording); } finally { setBusy(false); } }}>
                <Icon name="download" size={14} /> {t('Download')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
  return typeof document !== 'undefined' ? createPortal(modal, container || document.body) : modal;
}
