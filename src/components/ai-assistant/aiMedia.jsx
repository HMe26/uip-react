import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client';
import { saveBlob } from '../../lib/exporter';
import { generateAutoSubtitles, AutoSubError } from '../../lib/autoSubtitles';
import { NR_LEVELS, NoiseError, decodeForDenoise, denoiseBuffer } from '../../lib/noiseReduce';
import { audioToMp3 } from '../../lib/audioToMp3';
import Icon from '../Icon';
import VoiceMessage from '../messaging/VoiceMessage';
import VideoPlayer from '../VideoPlayer';
import { fmtSize } from './aiAssistantUtils';

/**
 * AI assistant media: attachments inside chat bubbles (same look as the people-to-people messenger), composer file cards and the
 * automatic speech-to-text of recordings.
 *
 * - The AI download endpoint needs the Bearer token, so <img>/<audio>/<video src="/api/…"> can never load it. Files are fetched
 *   through the API client (token + refresh-on-401) into blob: URLs; files the user just picked use their local object URL.
 * - Audio / video picked or recorded in the composer are transcribed in the browser → /subtitles/auto (Whisper) and the text is
 *   sent INSIDE the message, so models that cannot hear recordings still receive what was said.
 */

/* ---------------------------------------------------------------- kinds */

const EXT_KIND = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg'],
  video: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'opus', 'weba'],
};

/** image | audio | video | file — by mime / name first (a recorded voice note is .webm and used to be stored as "video"). */
export function mediaKindOf(x) {
  if (!x) return 'file';
  const name = String(x.original_name || x.name || '');
  const mime = String(x.mime_type || x.type || '').toLowerCase();
  if (/^voice-message-/i.test(name) || mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  const ext = (name.split('.').pop() || '').toLowerCase();
  for (const k of Object.keys(EXT_KIND)) if (EXT_KIND[k].includes(ext)) return k;
  return x.kind && ['image', 'audio', 'video'].includes(x.kind) ? x.kind : 'file';
}

export const isTranscribable = (x) => ['audio', 'video'].includes(mediaKindOf(x));

/* ---------------------------------------------------------------- transcript ⇄ message text */

const MAX_TRANSCRIPT_CHARS = 12000;
const BLOCK_RE = /\[Transcript of "([^"\n]*)" \(auto speech-to-text\)\]\n([\s\S]*?)\n\[End transcript\]/g;

/** Text block appended to the message the model receives (readable by any model, parsed back for display). */
export function transcriptBlock(name, text) {
  const clean = String(text || '').trim().slice(0, MAX_TRANSCRIPT_CHARS);
  const nm = String(name || 'recording').replace(/["\n\r]/g, ' ').trim();
  return `[Transcript of "${nm}" (auto speech-to-text)]\n${clean}\n[End transcript]`;
}

/** { text: message without the transcript blocks, transcripts: [{name, text}] } */
export function splitTranscripts(content) {
  const transcripts = [];
  const src = String(content || '');
  const text = src.replace(BLOCK_RE, (_m, name, body) => { transcripts.push({ name, text: body }); return ''; }).replace(/\n{3,}/g, '\n\n').trim();
  return { text, transcripts };
}

/* ---------------------------------------------------------------- transcription */

/** Whisper returns "." / "…" for silence — only text with at least one letter or digit counts as speech. */
export const hasSpeech = (txt) => /[\p{L}\p{N}]/u.test(String(txt || ''));

/** Speech-to-text of a recording / video the user picked. Resolves { text, lang }. Throws AutoSubError (code: unavailable | no_speech | …). */
export async function transcribeFile(file, { signal, onProgress } = {}) {
  const res = await generateAutoSubtitles({ file, target: 'orig', signal, cache: false, onProgress });
  const text = (res.cues || []).map((c) => String(c.text || '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (!hasSpeech(text)) throw new AutoSubError('no_speech');
  return { text, lang: res.language || null };
}

/* ---------------------------------------------------------------- noise removal for audio files */

function bufferToWav(buf) {
  const ch = 1; // voice → mono
  const rate = buf.sampleRate;
  const len = buf.length;
  const data = new DataView(new ArrayBuffer(44 + len * 2));
  const w = (o, str) => { for (let i = 0; i < str.length; i += 1) data.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); data.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
  data.setUint32(24, rate, true); data.setUint32(28, rate * 2, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true);
  w(36, 'data'); data.setUint32(40, len * 2, true);
  const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  for (let i = 0; i < len; i += 1) {
    let v = 0;
    for (let c = 0; c < chans.length; c += 1) v += chans[c][i];
    v /= chans.length;
    data.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true);
  }
  return new Blob([data], { type: 'audio/wav' });
}

/**
 * Removes background noise (RNNoise / GTCRN, on the device) from a recording and returns a new File (mp3, WAV as fallback).
 * Voice notes keep the voice-message- prefix so they still render as voice notes. Throws NoiseError (code: unsupported |
 * too_large | too_long | no_audio | cancelled | failed).
 */
export async function denoiseAudioFile(file, level = 'med', { signal, onProgress } = {}) {
  const buf = await decodeForDenoise(file);
  const clean = await denoiseBuffer(buf, level, { signal, onProgress: (p) => onProgress?.(p * 0.9) });
  const wav = bufferToWav(clean);
  let blob = wav;
  let ext = 'wav';
  try { blob = await audioToMp3(wav, { kbps: 96 }); ext = 'mp3'; } catch { /* WAV is fine, only bigger */ }
  onProgress?.(1);
  const base = String(file.name || 'voice-message').replace(/\.[^.]+$/, '').replace(/-clean$/, '');
  return new File([blob], `${base}-clean.${ext}`, { type: blob.type });
}
export { NR_LEVELS, NoiseError };

/** Stable map of AbortControllers (one running transcription per pending file). */
export function useAbortRegistry() {
  const ref = useRef(null);
  if (!ref.current) {
    const map = new Map();
    ref.current = {
      set(id, ctrl) { map.get(id)?.abort(); map.set(id, ctrl); },
      abort(id) { map.get(id)?.abort(); map.delete(id); },
      done(id, ctrl) { if (!ctrl || map.get(id) === ctrl) map.delete(id); },
      abortAll() { map.forEach((c) => c.abort()); map.clear(); },
    };
  }
  useEffect(() => () => ref.current.abortAll(), []);
  return ref.current;
}

/* ---------------------------------------------------------------- authenticated file → blob: URL */

const blobCache = new Map(); // path → blob (session only)
const isLocalUrl = (u) => /^(blob:|data:)/i.test(String(u || ''));

/** Absolute or root-relative API URL → path the API client understands. */
function apiPathOf(url) {
  try {
    const u = new URL(url, window.location.href);
    return u.pathname + u.search;
  } catch { return url; }
}

async function fetchBlob(url, mime) {
  const path = apiPathOf(url);
  if (blobCache.has(path)) return blobCache.get(path);
  const res = await api.blob(path);
  let blob = await res.blob();
  if (mime && (!blob.type || blob.type === 'application/octet-stream')) blob = new Blob([blob], { type: mime });
  blobCache.set(path, blob);
  return blob;
}

/**
 * { src, status: 'idle'|'loading'|'ready'|'error', load(), retry() }
 * Local (blob:/data:) URLs are ready immediately. `auto=false` waits for load() (used for videos — tap to download & play).
 */
function useAuthedSrc(url, mime, auto = true) {
  const [state, setState] = useState(() => {
    if (!url) return { src: null, status: 'error' };
    if (isLocalUrl(url)) return { src: url, status: 'ready' };
    return { src: null, status: 'idle' };
  });
  const objRef = useRef(null);
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; if (objRef.current) URL.revokeObjectURL(objRef.current); }; }, []);

  const load = useCallback(() => {
    if (!url || isLocalUrl(url)) return;
    setState((s) => (s.status === 'loading' || s.status === 'ready' ? s : { src: null, status: 'loading' }));
    fetchBlob(url, mime).then((blob) => {
      if (!aliveRef.current) return;
      if (objRef.current) URL.revokeObjectURL(objRef.current);
      objRef.current = URL.createObjectURL(blob);
      setState({ src: objRef.current, status: 'ready' });
    }).catch(() => { if (aliveRef.current) setState({ src: null, status: 'error' }); });
  }, [url, mime]);

  useEffect(() => {
    if (!url) { setState({ src: null, status: 'error' }); return; }
    if (isLocalUrl(url)) { setState({ src: url, status: 'ready' }); return; }
    setState({ src: null, status: 'idle' });
    if (auto) load();
  }, [url, auto, load]);

  return { ...state, load, retry: load };
}

/* ---------------------------------------------------------------- bubble attachments */

function ImageLightbox({ src, name, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="ai-lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <img src={src} alt={name || ''} onClick={(e) => e.stopPropagation()} />
      <button type="button" className="ai-lightbox__x" onClick={onClose} aria-label="Close"><Icon name="x" size={20} /></button>
    </div>,
    document.body,
  );
}

function ImageAttachment({ a }) {
  const s = useAuthedSrc(a.url, a.mime_type, true);
  const [open, setOpen] = useState(false);
  if (s.status === 'error') return <FileAttachment a={a} />;
  if (s.status !== 'ready') return <div className="ai-media ai-media--skeleton ai-media--image" aria-busy="true" />;
  return (
    <>
      <button type="button" className="ai-media ai-media--image" onClick={() => setOpen(true)} aria-label={a.original_name}>
        <img src={s.src} alt={a.original_name || ''} />
      </button>
      {open && <ImageLightbox src={s.src} name={a.original_name} onClose={() => setOpen(false)} />}
    </>
  );
}

function AudioAttachment({ a, t }) {
  const s = useAuthedSrc(a.url, a.mime_type || 'audio/webm', true);
  if (s.status === 'error') return <FileAttachment a={a} t={t} />;
  if (s.status !== 'ready') return <div className="ai-media ai-media--skeleton ai-media--audio" aria-busy="true" />;
  const isVoice = /^voice-message-/i.test(a.original_name || '');
  return (
    <div className="ai-media ai-media--audio">
      <div className="ai-media__audio-head">
        <Icon name="mic" size={12} />
        <span dir="auto">{isVoice ? t('voiceNote') : a.original_name}</span>
        {a.size_bytes ? <span className="ai-media__audio-size">{fmtSize(a.size_bytes)}</span> : null}
      </div>
      <VoiceMessage src={s.src} name={a.original_name} />
    </div>
  );
}

function VideoAttachment({ a, t }) {
  const s = useAuthedSrc(a.url, a.mime_type || 'video/mp4', false);
  const [playing, setPlaying] = useState(false);
  const start = () => { setPlaying(true); s.load(); };

  if (playing && s.status === 'ready') {
    return (
      <div className="ai-media ai-media--video is-playing">
        <VideoPlayer src={s.src} autoPlay />
      </div>
    );
  }
  const busy = playing && s.status === 'loading';
  const failed = s.status === 'error';
  const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (failed ? s.retry : start)(); } };
  return (
    <div
      className={`ai-media ai-media--video ai-vid${failed ? ' is-failed' : ''}${busy ? ' is-busy' : ''}`}
      role="button"
      tabIndex={0}
      onClick={failed ? s.retry : start}
      onKeyDown={onKey}
      aria-label={`${t('playVideo')} ${a.original_name || ''}`}
    >
      {isLocalUrl(a.url) && <video src={a.url} preload="metadata" muted playsInline tabIndex={-1} onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = 0.1; } catch { /* not seekable yet */ } }} />}
      <span className="ai-vid__badge" aria-hidden="true">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="6" width="13" height="12" rx="2.5" /><path d="m15.5 10.5 6-3.5v10l-6-3.5" /></svg>
        {(String(a.original_name || '').split('.').pop() || 'video').toUpperCase().slice(0, 4)}
      </span>
      <span className="ai-vid__play" aria-hidden="true">
        {busy ? <span className="ai-media__spin" /> : failed
          ? <Icon name="refresh" size={22} />
          : <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>}
      </span>
      <span className="ai-vid__cap">
        <span className="ai-vid__name" dir="auto">{failed ? t('loadFailed') : (a.original_name || t('playVideo'))}</span>
        {!failed && a.size_bytes ? <span className="ai-vid__size">{fmtSize(a.size_bytes)}</span> : null}
      </span>
    </div>
  );
}

function FileAttachment({ a, t }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    if (busy) return;
    setBusy(true);
    try { saveBlob(await fetchBlob(a.url, a.mime_type), a.original_name || 'file'); } catch { /* shown as nothing: the chip stays clickable */ }
    setBusy(false);
  };
  return (
    <button type="button" className="ai-attachment-chip ai-attachment-chip--file" onClick={download} disabled={busy} title={t ? t('download') : undefined}>
      <Icon name={busy ? 'refresh' : 'file'} size={14} />
      <span>{a.original_name}{a.size_bytes ? ` · ${fmtSize(a.size_bytes)}` : ''}</span>
    </button>
  );
}

export function AiAttachment({ a, t }) {
  const kind = mediaKindOf(a);
  if (kind === 'image') return <ImageAttachment a={a} />;
  if (kind === 'audio') return <AudioAttachment a={a} t={t} />;
  if (kind === 'video') return <VideoAttachment a={a} t={t} />;
  return <FileAttachment a={a} t={t} />;
}

/* ---------------------------------------------------------------- transcript card */

export function TranscriptCard({ name, text, t }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const long = text.length > 220 || text.split('\n').length > 3;
  if (!hasSpeech(text)) return null;
  const copy = () => {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1200); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => {});
  };
  return (
    <div className="ai-transcript">
      <div className="ai-transcript__head">
        <Icon name="mic" size={13} />
        <strong>{t('transcript')}</strong>
        {name ? <span className="ai-transcript__name" dir="auto">{name}</span> : null}
        <button type="button" className="ai-transcript__btn" onClick={copy} title={t('copy')} aria-label={t('copy')}><Icon name={copied ? 'check' : 'copy'} size={13} /></button>
      </div>
      <p className={`ai-transcript__body${long && !open ? ' is-clamped' : ''}`} dir="auto">{text}</p>
      {long && (
        <button type="button" className="ai-transcript__more" onClick={() => setOpen((o) => !o)}>
          {open ? t('showLess') : t('showMore')}
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- composer card */

const KIND_ICON = { audio: 'mic', video: 'play', image: 'image', file: 'file' };

function trStatus(pf, t) {
  const tr = pf.tr;
  if (!tr) return null;
  if (tr.state === 'running') return { tone: 'busy', text: <>{t('transcribing')} {tr.pct ? <bdi dir="ltr">{tr.pct}%</bdi> : '…'}</> };
  if (tr.state === 'done') return { tone: 'ok', text: t('transcribed') };
  if (tr.state === 'none') return { tone: 'warn', text: t('noSpeech') };
  if (tr.state === 'off') return { tone: 'warn', text: t('transcribeOff') };
  if (tr.state === 'error') return { tone: 'warn', text: t('transcribeFailed') };
  return null;
}

export function PendingFileChip({ pf, t, onRemove, onRetryTranscript }) {
  const kind = pf.kind || mediaKindOf(pf);
  const st = trStatus(pf, t);
  const uploading = pf.status === 'uploading';
  const failed = pf.status === 'error';
  const canRetry = pf.tr && pf.tr.state === 'error' && pf.tr.retryable && onRetryTranscript;
  return (
    <div className={`ai-pending${uploading ? ' is-uploading' : ''}${failed ? ' is-error' : ''}`} title={failed ? (pf.errorMessage || t('errorGeneric')) : undefined}>
      <span className="ai-pending__ico"><Icon name={failed ? 'alert' : KIND_ICON[kind] || 'file'} size={16} /></span>
      <span className="ai-pending__col">
        <span className="ai-pending__name" dir="auto">{kind === 'audio' && /^voice-message-/i.test(pf.name) ? t('voiceNote') : pf.name}</span>
        <span className="ai-pending__meta">
          {fmtSize(pf.size)}
          {uploading ? <> · {t('uploading')}</> : null}
          {st ? <> · <span className={`ai-pending__st ai-pending__st--${st.tone}`}>{st.text}</span></> : null}
          {canRetry ? <> · <button type="button" className="ai-pending__retry" onClick={() => onRetryTranscript(pf)}>{t('retry')}</button></> : null}
        </span>
      </span>
      <button type="button" className="ai-pending__x" onClick={() => onRemove(pf.tempId)} aria-label={t('remove')} title={t('remove')}><Icon name="x" size={13} /></button>
    </div>
  );
}

/* ---------------------------------------------------------------- composer review card (audio / video) */

const clampN = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * What the user sees under the composer for a recording / video before sending: preview, noise removal (audio) or the full
 * video editor (trim, subtitles, noise, mute), and the speech-to-text — editable, so a wrong transcript is fixed BEFORE the
 * assistant reads it.
 */
export function PendingMediaCard({ pf, t, h }) {
  const kind = pf.kind || mediaKindOf(pf);
  const isAudio = kind === 'audio';
  const tr = pf.tr;
  const running = !!tr && tr.state === 'running';
  const st = trStatus(pf, t);
  const nr = pf.nr || { status: 'idle', level: 'med', progress: 0 };
  const working = nr.status === 'working';
  const uploading = pf.status === 'uploading';
  const failed = pf.status === 'error';
  const text = pf.trText || '';
  const edited = !!pf.trEdited;
  const hasClean = !!(pf.versions && pf.versions.clean);
  const title = isAudio && /^voice-message-/i.test(pf.name) ? t('voiceNote') : pf.name;
  const rows = clampN(Math.ceil(text.length / 46) + (text.match(/\n/g) || []).length, 2, 7);

  return (
    <div className={`ai-pm${failed ? ' is-error' : ''}`}>
      <div className="ai-pm__head">
        <span className="ai-pm__ico"><Icon name={failed ? 'alert' : isAudio ? 'mic' : 'play'} size={15} /></span>
        <span className="ai-pm__col">
          <span className="ai-pm__name" dir="auto">{title}</span>
          <span className="ai-pm__meta">
            {fmtSize(pf.size)}
            {uploading ? <> · {t('uploading')} {pf.pct ? <bdi dir="ltr">{pf.pct}%</bdi> : null}</> : null}
            {failed ? <> · <span className="ai-pending__st--warn">{pf.errorMessage || t('errorGeneric')}</span></> : null}
          </span>
        </span>
        <button type="button" className="ai-pm__x" onClick={() => h.remove(pf.tempId)} aria-label={t('remove')} title={t('remove')}><Icon name="x" size={14} /></button>
      </div>

      {pf.localUrl && (
        <div className="ai-pm__preview">
          {isAudio
            ? <VoiceMessage key={pf.localUrl} src={pf.localUrl} name={pf.name} downloadable={false} />
            : <video key={pf.localUrl} className="ai-pm__video" src={pf.localUrl} controls playsInline preload="metadata" />}
        </div>
      )}

      {/* tools */}
      <div className="ai-pm__tools">
        {!isAudio && (
          <button type="button" className="ai-pm__tool" onClick={() => h.editVideo(pf)} disabled={working || uploading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></svg>
            {t('editVideo')}
          </button>
        )}
        {isAudio && !working && (
          <>
            <span className="ai-pm__lbl">{t('nrStrength')}</span>
            {Object.keys(NR_LEVELS).map((k) => (
              <button key={k} type="button" className={`ai-pm__chip${nr.level === k ? ' is-on' : ''}`} onClick={() => h.setNrLevel(pf, k)} disabled={uploading}>{t(`nr_${k}`)}</button>
            ))}
            <button type="button" className="ai-pm__tool ai-pm__tool--accent" onClick={() => h.denoise(pf, nr.level)} disabled={uploading}>✨ {hasClean ? t('nrAgain') : t('nrRun')}</button>
          </>
        )}
        {working && (
          <span className="ai-pm__work" role="status">
            <span>{t('nrWorking')}</span>
            <span className="ai-pm__bar"><i style={{ width: `${Math.max(6, Math.round((nr.progress || 0) * 100))}%` }} /></span>
            <button type="button" className="ai-pm__chip" onClick={() => h.cancelDenoise(pf)}>{t('cancel')}</button>
          </span>
        )}
      </div>

      {isAudio && hasClean && !working && (
        <div className="ai-pm__ab" role="group" aria-label={t('nrCompare')}>
          <button type="button" className={pf.active !== 'clean' ? 'is-on' : ''} onClick={() => h.useVersion(pf, 'orig')}>{t('nrBefore')}</button>
          <button type="button" className={pf.active === 'clean' ? 'is-on' : ''} onClick={() => h.useVersion(pf, 'clean')}>✨ {t('nrAfter')}</button>
        </div>
      )}
      {nr.status === 'error' && nr.msg ? <p className="ai-pm__err" role="alert">{nr.msg}</p> : null}

      {/* editable transcript */}
      {tr || text ? (
        <div className="ai-pm__tr">
          <div className="ai-pm__trhead">
            <Icon name="mic" size={12} />
            <strong>{t('transcript')}</strong>
            {st ? <span className={`ai-pending__st ai-pending__st--${st.tone}`}>{st.text}</span> : null}
            {edited && !running ? <span className="ai-pm__badge">{t('trEdited')}</span> : null}
            <span className="ai-pm__trspacer" />
            {edited && pf.trOrig ? <button type="button" className="ai-pm__link" onClick={() => h.resetTranscript(pf)}>{t('trReset')}</button> : null}
            {pf.file && !running ? <button type="button" className="ai-pm__link" onClick={() => h.retranscribe(pf)}>↻ {t('trRedo')}</button> : null}
          </div>
          <textarea
            className="ai-pm__text"
            dir="auto"
            rows={rows}
            value={text}
            disabled={running}
            onChange={(e) => h.editTranscript(pf, e.target.value)}
            placeholder={running ? `${t('transcribing')}…` : t('trManual')}
            aria-label={t('transcript')}
            spellCheck="false"
          />
          <p className="ai-pm__hint">{running ? t('waitTranscribe') : t('trEditHint')}</p>
        </div>
      ) : null}
    </div>
  );
}
