import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import VideoPlayer from './VideoPlayer';
import VoiceMessage from './messaging/VoiceMessage';
import { BoostedAudio } from './VolumeBoost';
import { useBackLayer } from '../lib/backStack';
import { lockScroll } from '../lib/scrollLock';
import { downloadPdfChecked, confirmRiskyDownload } from '../lib/pdfSafety';
import { saveBlob } from '../lib/exporter';
import { describe, extOf, cellStr, MAX_ROWS, PdfCanvasViewer } from './FilePreviewButton';
import { agoText, discardDraft, getDraft } from '../lib/draftStore';
import useDraftScope from '../lib/useDraftScope';
import { afterGuard } from '../lib/saveCenter';
import { generateAutoSubtitles, AutoSubError, MAX_VIDEO_BYTES } from '../lib/autoSubtitles';
import { JSON_EXT } from '../lib/driveFileKinds';
import '../styles/css/drafts.css';
import '../styles/css/file-viewer.css';

const ZipWorkbench = lazy(() => import('./zipbench/ZipWorkbench'));
const JsonViewer = lazy(() => import('./admin/JsonViewer'));
const ImageEditor = lazy(() => import('./editor/ImageEditor'));
const PdfEditor = lazy(() => import('./editor/PdfEditor'));
const XlsxEditor = lazy(() => import('./editor/XlsxView'));
const DocxEditor = lazy(() => import('./editor/DocxView'));
const PptxEditor = lazy(() => import('./editor/PptxView'));
const MediaEditor = lazy(() => import('./messaging/MediaEditorModal')); // the same trim / crop / filters / subtitles editor the chat uses
const DocxPreview = lazy(() => import('./editor/DocxView').then((m) => ({ default: m.DocxPreview })));
const XlsxPreview = lazy(() => import('./editor/XlsxView').then((m) => ({ default: m.XlsxPreview })));
const PptxPreview = lazy(() => import('./editor/PptxView').then((m) => ({ default: m.PptxPreview })));

/**
 * In-page file viewer (lightbox) — a project's files open right here, never in another page.
 *
 *   (optional readOnly: viewers who are not the owner — ZIP files open without editing / AI / add / delete; canDownload / canRun mirror the publisher's choices)
 *   (optional projectId enables the sandbox: real servers / terminal for ZIP projects)
 *   (optional loadBlob(file, { signal, onProgress }) => Promise<Blob>: for PRIVATE files that need an authenticated
 *    request (My PC). Video / audio then load as blobs too, and the download / new-tab links are replaced by blob downloads.)
 *   <FileViewer files={[{ id, original_name, url, size_human, size_bytes, uploader_name, version }]}
 *               startIndex={0} locale="ar" onClose={() => …} />
 *
 * - Images: zoom (buttons / wheel / double-click / pinch), drag to pan, rotate.
 * - PDF (real viewer on desktop, pdf.js canvas on phones), CSV / XLSX tables, DOCX text,
 *   text & source code (line numbers), video / audio, and the contents list of a ZIP.
 * - Anything else: a clear "download / open in a new tab" card.
 * - Prev / next across all the files (buttons, ← →, swipe, thumbnails strip), download,
 *   fullscreen, and an explicit "new tab" button — the only thing that leaves the page.
 *
 * Styles: styles/css/file-viewer.css (.st-fv*).
 */

const KIND_COLORS = {
  pdf: '#e5484d', doc: '#3b82f6', docx: '#3b82f6', odt: '#3b82f6', rtf: '#3b82f6', txt: '#64748b', md: '#64748b',
  xls: '#16a34a', xlsx: '#16a34a', csv: '#16a34a', ods: '#16a34a',
  ppt: '#f97316', pptx: '#f97316', odp: '#f97316', key: '#f97316',
  zip: '#d4a017', rar: '#d4a017', '7z': '#d4a017', tar: '#d4a017', gz: '#d4a017',
  png: '#8b5cf6', jpg: '#8b5cf6', jpeg: '#8b5cf6', gif: '#8b5cf6', webp: '#8b5cf6', svg: '#8b5cf6', bmp: '#8b5cf6',
  mp4: '#ec4899', mov: '#ec4899', webm: '#ec4899', avi: '#ec4899', mkv: '#ec4899',
};
const colorOf = (name) => KIND_COLORS[extOf(name)] || '#64748b';

const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' };
const IMAGE_EXT = Object.keys(IMAGE_MIME);
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'ogv'];
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'm4a', 'aac'];
const CODE_EXT = ['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'php', 'css', 'scss', 'sh', 'ini', 'toml', 'rb', 'go', 'rs', 'kt', 'swift', 'vue', 'dart', 'lua', 'pl', 'r', 'jl', 'hs', 'f90', 'pas', 'swift', 'm', 'mm', 'vb', 'scala', 'ex', 'exs', 'erl', 'fs', 'fsx', 'ml', 'clj', 'lisp', 'lsp', 'cob', 'cbl', 'asm', 'nasm', 'dpr', 'bas', 'cls', 'frm', 'ps1', 'sol', 'abap', 'sas', 'plsql', 'pls', 'tsql', 'pro', 'adb', 'ads', 'v', 'zig', 'groovy', 'gvy', 'kts', 'scm', 'rkt', 'sql', 'json', 'xml', 'yml', 'yaml', 'html', 'htm'];
const PLAIN_TEXT_EXT = ['txt', 'md', 'log', 'env', 'gitignore'];
const MAX_TEXT = 200000;
const MAX_JSON_BYTES = 12 * 1024 * 1024; // bigger files stay in the plain text view
const MAX_LINE_NUMBERS = 3000;
const CACHE_LIMIT = 8;
const PREFETCH_MAX_BYTES = 6 * 1024 * 1024;
const MIN_Z = 1;
const MAX_Z = 8;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isBlobUrl = (u) => typeof u === 'string' && u.startsWith('blob:');
const revoke = (data) => { if (data && isBlobUrl(data.url)) URL.revokeObjectURL(data.url); };
// All versions of one file share a root id; the viewer follows that, so a saved ZIP (new row, new id) stays on screen.
const rootOf = (f) => (f ? (f.root_id ?? f.id) : null);
/** Chat voice notes are recorded as voice-message-<time>.webm: audio only, although .webm normally means video. */
const isVoiceNote = (name, type) => /^voice-message-/i.test(name || '') || String(type || '').toLowerCase().startsWith('audio/');
const directKind = (ext, name) => (isVoiceNote(name) ? 'audio' : VIDEO_EXT.includes(ext) ? 'video' : AUDIO_EXT.includes(ext) ? 'audio' : null);

function humanBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/** fetch → Blob with a progress callback (percent, only when the server sends Content-Length). */
async function fetchBlob(url, signal, onProgress) {
  const res = await fetch(url, { signal, credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const type = res.headers.get('content-type') || '';
  if (!res.body || !res.body.getReader || !onProgress) return res.blob();
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total) onProgress(Math.min(99, Math.round((got / total) * 100)));
  }
  return new Blob(chunks, { type });
}

/** Blob -> what the stage renders. Image/PDF/table/docx/text reuse describe() from FilePreviewButton. */
async function buildView(file, blob) {
  const ext = extOf(file.original_name);
  if (IMAGE_EXT.includes(ext)) {
    return { kind: 'image', url: URL.createObjectURL(new Blob([blob], { type: IMAGE_MIME[ext] })), blob };
  }
  if (VIDEO_EXT.includes(ext) || AUDIO_EXT.includes(ext)) {
    const k = isVoiceNote(file.original_name, blob.type) ? 'audio' : VIDEO_EXT.includes(ext) ? 'video' : 'audio';
    return { kind: k, url: URL.createObjectURL(new Blob([blob], { type: blob.type || (k === 'video' ? 'video/mp4' : 'audio/mpeg') })), blob };
  }
  if (ext === 'zip') {
    return { kind: 'zip', blob };
  }
  if (JSON_EXT.has(ext) && blob.size <= MAX_JSON_BYTES) {
    const raw = (await blob.text()).replace(/^\uFEFF/, '');
    try {
      const value = ext === 'jsonl' || ext === 'ndjson'
        ? raw.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l))
        : JSON.parse(raw);
      if (value !== null && typeof value === 'object') return { kind: 'json', value, raw };
    } catch (e) { return { kind: 'text', text: raw.slice(0, MAX_TEXT), code: true, jsonError: e?.message || String(e) }; }
    return { kind: 'text', text: raw.slice(0, MAX_TEXT), code: true };
  }
  if (CODE_EXT.includes(ext) || PLAIN_TEXT_EXT.includes(ext)) {
    let text = await blob.text();
    if (ext === 'json') { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ } }
    return { kind: 'text', text: text.slice(0, MAX_TEXT), code: CODE_EXT.includes(ext) };
  }
  if (ext === 'pptx') return { kind: 'pptx', blob };
  if (ext === 'docx') return { kind: 'docx', blob };
  if (ext === 'tsv') return { kind: 'table', blob, sheets: [{ name: 'TSV', rows: [] }] };
  const d = await describe(blob, ext);
  return ext === 'pdf' || ext === 'xlsx' || ext === 'csv' || ext === 'tsv' ? { ...d, blob } : d;
}

function Spinner() {
  return <span className="st-fv-spinner" aria-hidden="true" />;
}

/** Image with zoom (buttons / wheel / double-click / pinch), drag-to-pan and rotate. */
function ImageStage({ url, alt, tt, apiRef, onSwipe, rtl }) {
  const [z, setZ] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [rot, setRot] = useState(0);
  const boxRef = useRef(null);
  const imgRef = useRef(null);
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const state = useRef({ z: 1, pos: { x: 0, y: 0 }, rot: 0 });
  state.current = { z, pos, rot };

  const bounds = useCallback((nextZ, nextRot) => {
    const box = boxRef.current;
    const img = imgRef.current;
    if (!box || !img) return { x: 0, y: 0 };
    const quarter = Math.abs(nextRot / 90) % 2 === 1;
    const w = quarter ? img.offsetHeight : img.offsetWidth;
    const h = quarter ? img.offsetWidth : img.offsetHeight;
    return { x: Math.max(0, (w * nextZ - box.clientWidth) / 2), y: Math.max(0, (h * nextZ - box.clientHeight) / 2) };
  }, []);

  const place = useCallback((nextZ, nextPos, nextRot = state.current.rot) => {
    const b = bounds(nextZ, nextRot);
    setZ(nextZ);
    setPos(nextZ === 1 ? { x: 0, y: 0 } : { x: clamp(nextPos.x, -b.x, b.x), y: clamp(nextPos.y, -b.y, b.y) });
  }, [bounds]);

  /** Zoom keeping the point under (cx, cy) — relative to the stage centre — still. */
  const zoomAt = useCallback((target, cx = 0, cy = 0) => {
    const { z: cur, pos: p } = state.current;
    const next = clamp(target, MIN_Z, MAX_Z);
    const k = next / cur;
    place(next, { x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k });
  }, [place]);

  const rotate = useCallback(() => {
    const next = (state.current.rot + 90) % 360;
    setRot(next);
    place(state.current.z, state.current.pos, next);
  }, [place]);

  const reset = useCallback(() => { setRot(0); setZ(1); setPos({ x: 0, y: 0 }); }, []);

  useEffect(() => {
    if (apiRef) apiRef.current = { zoomIn: () => zoomAt(state.current.z * 1.4), zoomOut: () => zoomAt(state.current.z / 1.4), reset, rotate };
    return () => { if (apiRef) apiRef.current = null; };
  }, [apiRef, zoomAt, reset, rotate]);

  // Wheel needs a non-passive listener so Ctrl+wheel doesn't zoom the whole browser page.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(state.current.z * (e.deltaY < 0 ? 1.18 : 1 / 1.18), e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: state.current.z };
    } else {
      gesture.current = { type: 'drag', sx: e.clientX, sy: e.clientY, px: state.current.pos.x, py: state.current.pos.y, moved: 0 };
    }
  };
  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.type === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      zoomAt(g.z0 * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist));
    } else if (g.type === 'drag') {
      const dx = e.clientX - g.sx;
      const dy = e.clientY - g.sy;
      g.moved = Math.max(g.moved, Math.hypot(dx, dy));
      if (state.current.z > 1) place(state.current.z, { x: g.px + dx, y: g.py + dy });
    }
  };
  const onPointerUp = (e) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (g?.type === 'drag' && state.current.z === 1 && onSwipe) {
      const dx = e.clientX - g.sx;
      if (Math.abs(dx) > 70 && Math.abs(e.clientY - g.sy) < 60) onSwipe(dx);
    }
    if (pointers.current.size === 0) gesture.current = null;
  };
  const onDoubleClick = (e) => {
    const r = boxRef.current.getBoundingClientRect();
    if (state.current.z > 1) zoomAt(1);
    else zoomAt(2.5, e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
  };

  const pct = Math.round(z * 100);
  return (
    <div
      ref={boxRef}
      className={`st-fv__image${z > 1 ? ' is-zoomed' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      <img
        ref={imgRef}
        src={url}
        alt={alt}
        draggable={false}
        style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${z}) rotate(${rot}deg)` }}
      />
      <div className="st-fv__dock" dir={rtl ? 'rtl' : 'ltr'} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => zoomAt(z / 1.4)} disabled={z <= MIN_Z} aria-label={tt('Zoom out', 'تصغير')} title={tt('Zoom out (-)', 'تصغير (-)')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
        </button>
        <button type="button" className="st-fv__pct" onClick={() => zoomAt(1)} title={tt('Fit to screen (0)', 'ملاءمة الشاشة (0)')}>{pct}%</button>
        <button type="button" onClick={() => zoomAt(z * 1.4)} disabled={z >= MAX_Z} aria-label={tt('Zoom in', 'تكبير')} title={tt('Zoom in (+)', 'تكبير (+)')}><Icon name="plus" size={16} /></button>
        <span className="st-fv__dock-sep" aria-hidden="true" />
        <button type="button" onClick={rotate} aria-label={tt('Rotate', 'تدوير')} title={tt('Rotate (R)', 'تدوير (R)')}><Icon name="refresh" size={16} /></button>
      </div>
    </div>
  );
}


/** Voice note / audio file: extract the text (Whisper) or translate it, right inside the viewer. */
const SUB_ERR = {
  unavailable: ['Transcription is not available right now.', 'استخراج النص غير متاح حاليًا.'],
  unsupported: ['This browser cannot decode this audio.', 'المتصفح مش قادر يفك تشفير الصوت ده.'],
  fetch_failed: ['Could not read the audio.', 'تعذّرت قراءة الصوت.'],
  too_large: ['The file is too large to transcribe.', 'الملف كبير أوي لاستخراج النص.'],
  decode_failed: ['Could not decode the audio.', 'تعذّر فك تشفير الصوت.'],
  no_audio: ['There is no audio in this file.', 'مفيش صوت في الملف ده.'],
  no_speech: ['No speech was detected.', 'ماتسمعش كلام في التسجيل.'],
  rate_limited: ['Too many requests — try again in a minute.', 'طلبات كتير — جرّب بعد دقيقة.'],
  cancelled: ['Cancelled.', 'اتلغى.'],
};
function AudioTranscript({ blob, url, name, tt }) {
  const [st, setSt] = useState({ phase: 'idle' }); // idle | busy | done | error
  const ctl = useRef(null);
  useEffect(() => () => ctl.current?.abort(), []);
  useEffect(() => { ctl.current?.abort(); setSt({ phase: 'idle' }); }, [blob, url]);
  const run = async (target) => {
    ctl.current?.abort();
    const ac = new AbortController(); ctl.current = ac;
    setSt({ phase: 'busy', target, pct: 0 });
    try {
      const out = await generateAutoSubtitles({
        src: url, file: blob || null, target, signal: ac.signal,
        onProgress: (p) => { if (!ac.signal.aborted) setSt((c) => (c.phase === 'busy' ? { ...c, pct: Math.round(p?.percent ?? p?.pct ?? c.pct ?? 0), stage: p?.stage } : c)); },
        onCues: (cues) => { if (!ac.signal.aborted) setSt((c) => (c.phase === 'busy' ? { ...c, cues } : c)); },
      });
      if (!ac.signal.aborted) setSt({ phase: 'done', target, cues: out.cues || [], partial: !!out.partial });
    } catch (e) {
      if (ac.signal.aborted) return;
      const m = e instanceof AutoSubError ? SUB_ERR[e.code] : null;
      setSt({ phase: 'error', msg: m ? tt(m[0], m[1]) : tt('Could not process this audio.', 'تعذّرت معالجة الصوت.') });
    }
  };
  const text = (st.cues || []).map((c) => c.text).filter(Boolean).join('\n');
  const copy = async () => { try { await navigator.clipboard.writeText(text); } catch { /* blocked */ } };
  const save = () => saveBlob(new Blob([`\ufeff${text}`], { type: 'text/plain;charset=utf-8' }), `${String(name || 'audio').replace(/\.[^.]+$/, '')}-${st.target || 'text'}.txt`);
  const busy = st.phase === 'busy';
  return (
    <div className="st-fv__row" style={{ flexDirection: 'column', alignItems: 'stretch', width: 'min(520px, 88vw)', gap: 10 }}>
      <div className="st-fv__row" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
        <button type="button" className="st-fv__btn st-fv__btn--primary" disabled={busy} onClick={() => run('orig')}><Icon name="file" size={16} /> {tt('Extract text', 'استخراج النص')}</button>
        <button type="button" className="st-fv__btn" disabled={busy} onClick={() => run('ar')}>{tt('Translate → Arabic', 'ترجمة للعربي')}</button>
        <button type="button" className="st-fv__btn" disabled={busy} onClick={() => run('en')}>{tt('Translate → English', 'ترجمة للإنجليزي')}</button>
        {busy && <button type="button" className="st-fv__btn" onClick={() => ctl.current?.abort()}>{tt('Cancel', 'إلغاء')}</button>}
      </div>
      {busy && <p style={{ margin: 0, textAlign: 'center', opacity: 0.8 }}>{tt('Working on it…', 'جاري المعالجة…')}{st.pct ? ` ${st.pct}%` : ''}</p>}
      {st.phase === 'error' && <p style={{ margin: 0, textAlign: 'center', color: '#e5484d' }}>{st.msg}</p>}
      {text && (
        <>
          <div dir="auto" style={{ maxHeight: 220, overflow: 'auto', textAlign: 'start', whiteSpace: 'pre-wrap', lineHeight: 1.7, padding: 12, borderRadius: 10, border: '1px solid rgba(128,128,128,.3)', userSelect: 'text' }}>{text}</div>
          {!busy && (
            <div className="st-fv__row" style={{ justifyContent: 'center' }}>
              <button type="button" className="st-fv__btn" onClick={copy}><Icon name="copy" size={16} /> {tt('Copy', 'نسخ')}</button>
              <button type="button" className="st-fv__btn" onClick={save}><Icon name="download" size={16} /> {tt('Save as .txt', 'حفظ كـ txt')}</button>
            </div>
          )}
          {st.partial && !busy && <p style={{ margin: 0, textAlign: 'center', opacity: 0.7 }}>{tt('Part of the audio could not be processed.', 'جزء من الصوت ماتعالجش.')}</p>}
        </>
      )}
    </div>
  );
}

export default function FileViewer({ files, startIndex = 0, onClose: onCloseProp, locale = 'en', onSaveZip, onSaveFile, onEditText, projectId, loadBlob, sandboxTokenPathOf, embedded = false, registerGuard, canDownload = true, readOnly = false, canRun = true }) {
  const rtl = locale === 'ar';
  const tt = useCallback((en, ar) => (locale === 'ar' ? ar : en), [locale]);
  const list = useMemo(() => files.filter((f) => f && f.url), [files]);
  // Track the open file by id (not position) so a reload of the list can't swap it for another file.
  const [activeId, setActiveId] = useState(() => list[clamp(startIndex, 0, Math.max(0, list.length - 1))]?.id);
  const lastRoot = useRef(null);
  let found = list.findIndex((f) => f.id === activeId);
  if (found < 0 && lastRoot.current != null) found = list.findIndex((f) => rootOf(f) === lastRoot.current); // list reloaded with a newer version
  const index = Math.max(0, found);
  const [view, setView] = useState({ status: 'loading', progress: 0 });
  const [retryKey, setRetryKey] = useState(0);
  // Realtime (My PC): the file being viewed was saved on another tab/device → show the new content right away.
  // Skipped while this viewer is in edit mode so unsaved local changes are never overwritten.
  const openIdRef = useRef(null);
  useEffect(() => {
    const h = (e) => {
      const id = e?.detail?.id;
      const cur = openIdRef.current;
      if (id == null || cur == null || String(id) !== String(cur) || editingRef.current) return;
      setRetryKey((k) => k + 1);
    };
    window.addEventListener('uip-drive-node-changed', h);
    return () => window.removeEventListener('uip-drive-node-changed', h);
  }, []);
  const [sheet, setSheet] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [mediaFile, setMediaFile] = useState(null); // a video being edited in the chat's media editor
  const savingMedia = useRef(false);
  const [restored, setRestored] = useState(null); // { blob, at } — the editor was reopened from a local draft
  const scope = useDraftScope();
  const editingRef = useRef(false);
  editingRef.current = editing;
  const rootRef = useRef(null);
  const closeRef = useRef(null);
  const thumbsRef = useRef(null);
  const imageApi = useRef(null);
  const guardRef = useRef(null); // the ZIP workbench asks before discarding unsaved edits
  // A guard answers true / false, or a Promise<boolean> (the "Save changes?" dialog: Save / Don't save / Cancel).
  const onClose = useCallback(() => {
    afterGuard(guardRef.current?.(), () => onCloseProp?.());
  }, [onCloseProp]);
  const cache = useRef(new Map());

  const file = list[index];
  openIdRef.current = file ? (file.driveId ?? file.id) : null;
  lastRoot.current = rootOf(file);
  const ext = extOf(file?.original_name);
  const canSave = !!(onSaveFile || onSaveZip);
  const draftKey = file && canSave ? `ed:${scope}:${projectId ?? 'drive'}:${rootOf(file)}` : '';
  const color = colorOf(file?.original_name);
  const downloadName = file?.original_name || 'file';
  const getBlob = useCallback((f, signal, onProgress) => (loadBlob ? loadBlob(f, { signal, onProgress }) : fetchBlob(f.url, signal, onProgress)), [loadBlob]);

  const remember = useCallback((id, data) => {
    const c = cache.current;
    c.set(id, data);
    while (c.size > CACHE_LIMIT) {
      const oldest = c.keys().next().value;
      revoke(c.get(oldest));
      c.delete(oldest);
    }
  }, []);

  // "Save" from the ZIP workbench or the image / PDF editor: uploads the new file as the newest version, then keeps
  // showing it without reloading.
  const saveFile = useCallback(async (blob, opts) => {
    const save = onSaveFile || onSaveZip;
    const saved = await save(file, blob, opts);
    const name = opts?.name || saved?.original_name || file.original_name;
    const data = await buildView({ original_name: name }, blob);
    cache.current.delete(file.id);
    if (draftKey) discardDraft(draftKey);
    setRestored(null);
    remember(saved?.id ?? file.id, data);
    if (saved?.id != null) setActiveId(saved.id);
    setView({ status: 'ready', data });
    setEditing(false);
    return saved;
  }, [onSaveFile, onSaveZip, file, remember, draftKey]);
  const leaveEditing = useCallback(() => { if (draftKey) discardDraft(draftKey); setRestored(null); setEditing(false); }, [draftKey]);

  const go = useCallback((delta) => {
    const target = list[clamp(index + delta, 0, list.length - 1)];
    if (target) afterGuard(guardRef.current?.(), () => { setActiveId(target.id); setSheet(0); });
  }, [list, index]);
  const jump = (i) => { if (list[i]) afterGuard(guardRef.current?.(), () => { setActiveId(list[i].id); setSheet(0); }); };

  useEffect(() => { setEditing(false); setRestored(null); setMediaFile(null); }, [file?.id]);

  // A refresh / crash / lost connection while editing: reopen the editor with the unsaved edits found on this device.
  const triedDraft = useRef('');
  useEffect(() => {
    if (view.status !== 'ready' || !draftKey || triedDraft.current === draftKey) return undefined;
    const k = view.data?.kind;
    const editable = (k === 'image' && ext !== 'svg') || k === 'pdf' || k === 'pdf-canvas' || k === 'pptx' || k === 'docx' || (k === 'table' && ['xlsx', 'csv', 'tsv'].includes(ext));
    if (!editable || !view.data?.blob) return undefined;
    triedDraft.current = draftKey;
    let dead = false;
    getDraft(draftKey).then((d) => { if (!dead && d?.kind === 'blob' && d.blob) { setRestored({ blob: d.blob, at: d.at }); setEditing(true); } });
    return () => { dead = true; };
  }, [view, draftKey, ext]);

  // Load the current file (cached → instant; video/audio stream straight from the URL).
  useEffect(() => {
    if (!file) return undefined;
    const cached = cache.current.get(file.id);
    if (cached) { setView({ status: 'ready', data: cached }); return undefined; }
    const direct = directKind(ext, file.original_name);
    if (direct && !loadBlob) { setView({ status: 'ready', data: { kind: direct, url: file.url } }); return undefined; }
    const ctrl = new AbortController();
    setView({ status: 'loading', progress: 0 });
    (async () => {
      try {
        const blob = await getBlob(file, ctrl.signal, (p) => setView((v) => (v.status === 'loading' ? { ...v, progress: p } : v)));
        const data = await buildView(file, blob);
        if (ctrl.signal.aborted) { revoke(data); return; }
        remember(file.id, data);
        setView({ status: 'ready', data });
      } catch (err) {
        if (!ctrl.signal.aborted) setView({ status: 'error', error: String(err?.message || err) });
      }
    })();
    return () => ctrl.abort();
  }, [file, ext, retryKey, remember, getBlob, loadBlob]);

  // Warm the neighbours (images / small PDFs) so prev / next feels instant.
  useEffect(() => {
    if (view.status !== 'ready') return undefined;
    const ctrl = new AbortController();
    [index + 1, index - 1].forEach((i) => {
      const f = list[i];
      if (!f || cache.current.has(f.id)) return;
      const e = extOf(f.original_name);
      if (!IMAGE_EXT.includes(e) && e !== 'pdf') return;
      if (!(Number(f.size_bytes) > 0) || Number(f.size_bytes) > PREFETCH_MAX_BYTES) return;
      getBlob(f, ctrl.signal).then((b) => buildView(f, b)).then((d) => {
        if (ctrl.signal.aborted) { revoke(d); return; }
        remember(f.id, d);
      }).catch(() => {});
    });
    return () => ctrl.abort();
  }, [view.status, index, list, remember, getBlob]);

  // Free every blob URL when the viewer closes.
  useEffect(() => {
    const c = cache.current;
    return () => { c.forEach(revoke); c.clear(); };
  }, []);

  // Phone/browser Back closes the viewer and stays on the page (instead of leaving it).
  useBackLayer(!!file && !embedded, onClose);

  // desktop window: lets the window frame ask before closing over unsaved edits
  useEffect(() => {
    if (!registerGuard) return undefined;
    registerGuard(() => !guardRef.current || guardRef.current());
    return () => registerGuard(null);
  }, [registerGuard]);

  // Lock the page behind, move focus in, and give it back on close.
  useEffect(() => {
    const previous = document.activeElement;
    const unlock = embedded ? () => {} : lockScroll();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      unlock();
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else rootRef.current?.requestFullscreen?.().catch(() => {});
  };

  // Keyboard: Esc close · arrows (RTL aware) · + − 0 R · Tab stays inside.
  useEffect(() => {
    const onKey = (e) => {
      if (embedded && !rootRef.current?.contains(e.target)) return; // a window only listens while focus is inside it
      if (embedded && (e.key === 'Escape' || e.key === 'Tab')) return;
      if (e.target?.closest?.('.zb')) return; // the code workbench owns its keys (arrows, Tab, Esc…)
      if (editingRef.current && e.key !== 'Tab') return; // so do the image / PDF editors
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(rtl ? -1 : 1); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(rtl ? 1 : -1); return; }
      if (e.key === '+' || e.key === '=') imageApi.current?.zoomIn();
      else if (e.key === '-' || e.key === '_') imageApi.current?.zoomOut();
      else if (e.key === '0') imageApi.current?.reset();
      else if (e.key === 'r' || e.key === 'R') imageApi.current?.rotate();
      else if (e.key === 'Tab' && rootRef.current) {
        const items = [...rootRef.current.querySelectorAll('a[href], button:not([disabled]), input, [tabindex="0"]')].filter((n) => n.offsetParent !== null);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose, rtl, embedded]);

  // Keep the active thumbnail in view.
  useEffect(() => {
    const el = thumbsRef.current?.querySelector('.is-on');
    el?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [index]);

  const onSwipe = useCallback((dx) => {
    // Finger moves left → reveal the item that sits on the right (LTR: next · RTL: previous).
    const toward = dx < 0 ? 1 : -1;
    go(rtl ? -toward : toward);
  }, [go, rtl]);

  if (!file) return null;

  const data = view.status === 'ready' ? view.data : null;
  const stage = view.status === 'ready' ? data.kind : view.status;
  const sheets = data?.sheets || [];
  const rows = sheets[sheet]?.rows || [];
  const header = rows[0] || [];
  const body = rows.slice(1, MAX_ROWS + 1);
  const lines = data?.kind === 'text' && data.text && data.text.split('\n').length <= MAX_LINE_NUMBERS ? data.text.split('\n') : null;
  const meta = [file.size_human, file.uploader_name, Number(file.version) > 1 && `v${file.version}`].filter(Boolean).join(' · ');
  const canEdit = !!(onSaveFile || onSaveZip) && view.status === 'ready' && !editing && ((data.kind === 'image' && ext !== 'svg' && data.blob) || ((data.kind === 'pdf' || data.kind === 'pdf-canvas') && data.blob) || (data.kind === 'pptx' && data.blob) || (data.kind === 'docx' && data.blob) || (data.kind === 'table' && data.blob && ['xlsx', 'csv', 'tsv'].includes(ext)));
  const canEditVideo = !!(onSaveFile || onSaveZip) && view.status === 'ready' && !editing && data.kind === 'video' && !!data.blob;
  const openVideoEditor = () => {
    const type = data.blob.type && data.blob.type.startsWith('video/') ? data.blob.type : (ext === 'webm' ? 'video/webm' : 'video/mp4');
    setMediaFile(new File([data.blob], downloadName, { type }));
  };
  const saveEditedVideo = async (out) => {
    if (savingMedia.current) return;
    savingMedia.current = true;
    try {
      const base = downloadName.replace(/\.[^.]+$/, '');
      const outExt = extOf(out.name) || ext || 'mp4';
      await saveFile(out, { name: `${base}.${outExt}` }); // replaces the file in place (new version), keeps its name
      setMediaFile(null);
    } catch (err) {
      window.alert(tt('Could not save the edited video.', 'تعذّر حفظ الفيديو بعد التعديل.') + (err?.message ? `\n${err.message}` : ''));
    } finally { savingMedia.current = false; }
  };
  const hasMany = list.length > 1 && !editing;
  const prevIcon = rtl ? 'chevron-right' : 'chevron-left';
  const nextIcon = rtl ? 'chevron-left' : 'chevron-right';

  // PDFs never download straight from the link: they are scanned first (flagged ones need two confirmations).
  const onDownloadClick = async (e) => {
    if (ext === 'pdf') {
      e.preventDefault();
      downloadPdfChecked({ url: file.url, name: downloadName, blob: data?.blob, tt });
      return;
    }
    if (!loadBlob) return;
    e.preventDefault(); // private file: the link has no usable URL, so the bytes come through the authenticated loader
    try { saveBlob(data?.blob || await loadBlob(file, {}), downloadName); } catch { /* the viewer already shows load errors */ }
  };

  const node = (
    <div ref={rootRef} className={`st-fv${embedded ? ' st-fv--win' : ''}`} role="dialog" aria-modal={!embedded} aria-label={downloadName} dir={rtl ? 'rtl' : 'ltr'}>
      <div className="st-fv__backdrop" onClick={embedded ? undefined : onClose} aria-hidden="true" />

      <header className="st-fv__bar">
        <div className="st-fv__title">
          <span className="st-fv__badge" style={{ '--k': color }}>{(ext || 'file').slice(0, 4).toUpperCase()}</span>
          <div>
            <strong dir="auto" title={downloadName}>{downloadName}</strong>
            <small>{[hasMany && `${index + 1} / ${list.length}`, meta].filter(Boolean).join(' · ')}</small>
          </div>
        </div>
        <div className="st-fv__actions">
          {data?.kind === 'json' && onEditText && !editing && (
            <button type="button" className="st-fv__btn st-fv__btn--primary" onClick={() => onEditText(file)} title={tt('Edit as text in the code editor', 'تعديل كنص في محرر الأكواد')}>
              <Icon name="edit" size={17} /><span>{tt('Edit', 'تعديل')}</span>
            </button>
          )}
          {canEdit && (
            <button type="button" className="st-fv__btn st-fv__btn--primary" onClick={() => setEditing(true)} title={tt('Edit this file', 'تعديل الملف')}>
              <Icon name="edit" size={17} /><span>{tt('Edit', 'تعديل')}</span>
            </button>
          )}
          {canEditVideo && (
            <button type="button" className="st-fv__btn st-fv__btn--primary" onClick={openVideoEditor} title={tt('Edit this video (trim, crop, filters, subtitles)', 'تعديل الفيديو (قص، تقطيع، فلاتر، ترجمة)')}>
              <Icon name="edit" size={17} /><span>{tt('Edit', 'تعديل')}</span>
            </button>
          )}
          {canDownload && (
            <a className="st-fv__btn" href={file.url} download={downloadName} title={tt('Download', 'تنزيل')} onClick={onDownloadClick}>
              <Icon name="download" size={17} /><span>{tt('Download', 'تنزيل')}</span>
            </a>
          )}
          {canDownload && ext !== 'pdf' && !loadBlob && (
            <a className="st-fv__btn" href={file.url} target="_blank" rel="noopener noreferrer" title={tt('Open in a new tab', 'فتح في تبويب جديد')}>
              <Icon name="expand" size={17} /><span>{tt('New tab', 'تبويب جديد')}</span>
            </a>
          )}
          {document.fullscreenEnabled && (
            <button type="button" className="st-fv__btn st-fv__btn--icon" onClick={toggleFullscreen} title={fullscreen ? tt('Exit full screen', 'إنهاء ملء الشاشة') : tt('Full screen', 'ملء الشاشة')} aria-label={tt('Full screen', 'ملء الشاشة')}>
              <Icon name="maximize" size={17} />
            </button>
          )}
          {!embedded && (
            <button type="button" ref={closeRef} className="st-fv__btn st-fv__btn--icon st-fv__btn--close" onClick={onClose} title={tt('Close (Esc)', 'إغلاق (Esc)')} aria-label={tt('Close', 'إغلاق')}>
              <Icon name="x" size={18} />
            </button>
          )}
        </div>
      </header>

      <main className={`st-fv__stage${stage === 'zip' || editing ? ' st-fv__stage--bench' : ''}`} key={rootOf(file)}>
        {stage === 'loading' && (
          <div className="st-fv__center">
            <Spinner />
            <p>{tt('Loading…', 'جارٍ التحميل…')}{view.progress ? ` ${view.progress}%` : ''}</p>
            {view.progress > 0 && <span className="st-fv__progress"><i style={{ width: `${view.progress}%` }} /></span>}
          </div>
        )}
        {stage === 'error' && (
          <div className="st-fv__center st-fv__card">
            <Icon name="alert-triangle" size={30} />
            <strong>{tt('Could not load this file', 'تعذّر تحميل هذا الملف')}</strong>
            <p>{view.error}</p>
            <div className="st-fv__row">
              <button type="button" className="st-fv__btn st-fv__btn--primary" onClick={() => setRetryKey((k) => k + 1)}><Icon name="refresh" size={16} /> {tt('Retry', 'إعادة المحاولة')}</button>
              {ext !== 'pdf' && !loadBlob && <a className="st-fv__btn" href={file.url} target="_blank" rel="noopener noreferrer"><Icon name="expand" size={16} /> {tt('New tab', 'تبويب جديد')}</a>}
            </div>
          </div>
        )}
        {stage === 'unsupported' && (
          <div className="st-fv__center st-fv__card">
            <span className="st-fv__bigbadge" style={{ '--k': color }}>{(ext || 'file').slice(0, 4).toUpperCase()}</span>
            <strong>{tt('No in-page preview for this file type', 'لا توجد معاينة داخل الصفحة لهذا النوع من الملفات')}</strong>
            <p>{tt('Download it, or open it in a new tab.', 'نزّله أو افتحه في تبويب جديد.')}</p>
            <div className="st-fv__row">
              {canDownload && <a className="st-fv__btn st-fv__btn--primary" href={file.url} download={downloadName} onClick={onDownloadClick}><Icon name="download" size={16} /> {tt('Download', 'تنزيل')}</a>}
              {ext !== 'pdf' && !loadBlob && <a className="st-fv__btn" href={file.url} target="_blank" rel="noopener noreferrer"><Icon name="expand" size={16} /> {tt('New tab', 'تبويب جديد')}</a>}
            </div>
          </div>
        )}
        {editing && restored && (
          <div className="uip-draftbar" role="status">
            <span>↺ <strong>{tt('Your unsaved edits were restored', 'رجّعنا تعديلاتك اللي ما اتحفظتش')}</strong> · {agoText(restored.at, rtl)} — {tt('they are only on this device until you press Save.', 'لسه على جهازك بس لحد ما تدوس حفظ.')}</span>
            <span className="uip-draftbar__sp" />
            <button type="button" onClick={() => { if (window.confirm(tt('Discard the restored edits and go back to the saved file?', 'تتجاهل التعديلات المسترجعة وترجع للملف المحفوظ؟'))) leaveEditing(); }}>{tt('Discard', 'تجاهل')}</button>
          </div>
        )}
        {editing && data?.blob && (
          <Suspense fallback={<div className="st-fv__center"><Spinner /></div>}>
            {data.kind === 'image'
              ? <ImageEditor blob={restored?.blob || data.blob} fileName={downloadName} tt={tt} rtl={rtl} guardRef={guardRef} onSave={saveFile} onClose={leaveEditing} draftKey={draftKey} startDirty={!!restored} />
              : data.kind === 'pptx'
                ? <PptxEditor blob={restored?.blob || data.blob} fileName={downloadName} tt={tt} rtl={rtl} guardRef={guardRef} onSave={saveFile} onClose={leaveEditing} draftKey={draftKey} startDirty={!!restored} />
                : data.kind === 'docx'
                  ? <DocxEditor blob={restored?.blob || data.blob} fileName={downloadName} tt={tt} rtl={rtl} guardRef={guardRef} onSave={saveFile} onClose={leaveEditing} draftKey={draftKey} startDirty={!!restored} />
                  : data.kind === 'table'
                    ? <XlsxEditor blob={restored?.blob || data.blob} ext={ext} fileName={downloadName} tt={tt} rtl={rtl} guardRef={guardRef} onSave={saveFile} onClose={leaveEditing} draftKey={draftKey} startDirty={!!restored} />
                    : <PdfEditor blob={restored?.blob || data.blob} fileName={downloadName} tt={tt} rtl={rtl} guardRef={guardRef} onSave={saveFile} onClose={leaveEditing} draftKey={draftKey} startDirty={!!restored} />}
          </Suspense>
        )}
        {!editing && stage === 'image' && <ImageStage url={data.url} alt={downloadName} tt={tt} apiRef={imageApi} onSwipe={hasMany ? onSwipe : undefined} rtl={rtl} />}
               {!editing && stage === 'pdf-risky' && (
          <div className="st-fv__center st-fv__card" role="alert">
            <span className="st-fv__bigbadge" style={{ '--k': '#d92d20' }}>PDF</span>
            <strong>{tt('⚠ This PDF was not opened', '⚠ الـ PDF ده اتمنع فتحه')}</strong>
            <p>{tt(
              'It contains scripts or active content that can harm your device or your account, so it is blocked from opening here.',
              'فيه سكربتات أو محتوى نشط ممكن يضر جهازك أو حسابك، فاتمنع فتحه هنا.'
            )}</p>
            <div className="st-fv__row">
              <button type="button" className="st-fv__btn" hidden={!canDownload} onClick={() => { if (confirmRiskyDownload(tt, downloadName)) saveBlob(data.blob, downloadName); }}>
                <Icon name="download" size={16} /> {tt('Download anyway…', 'نزّله رغم كده…')}
              </button>
            </div>
          </div>
        )}
        {!editing && stage === 'pdf-canvas' && (
          <div className="st-fv__sheet">
            <PdfCanvasViewer blob={data.blob} onError={(m) => setView({ status: 'error', error: m })} />
          </div>
        )}
        {!editing && stage === 'pptx' && (
          <div className="st-fv__sheet st-fv__sheet--doc"><Suspense fallback={<div className="st-fv__center"><Spinner /></div>}><PptxPreview blob={data.blob} tt={tt} /></Suspense></div>
        )}
        {!editing && stage === 'docx' && (
          <div className="st-fv__sheet st-fv__sheet--doc"><Suspense fallback={<div className="st-fv__center"><Spinner /></div>}><DocxPreview blob={data.blob} tt={tt} /></Suspense></div>
        )}
        {stage === 'video' && <VideoPlayer key={data.url} src={data.url} autoPlay />}
        {stage === 'audio' && (
          <div className="st-fv__center st-fv__card">
            <span className="st-fv__bigbadge" style={{ '--k': color }}>{(ext || 'audio').slice(0, 4).toUpperCase()}</span>
            {isVoiceNote(file?.original_name) ? (
              <div className="msg-voice" style={{ width: 'min(420px, 86vw)', maxWidth: '100%' }}>
                <VoiceMessage key={data.url} src={data.url} name={downloadName} />
              </div>
            ) : (
              <BoostedAudio src={data.url} autoPlay style={{ width: 'min(420px, 80vw)' }} />
            )}
            <AudioTranscript blob={data.blob && data.blob.size <= MAX_VIDEO_BYTES ? data.blob : null} url={data.url} name={downloadName} tt={tt} />
          </div>
        )}
        {stage === 'zip' && (
          <Suspense fallback={<div className="st-fv__center"><Spinner /></div>}>
            <ZipWorkbench key={rootOf(file)} blob={data.blob} fileName={downloadName} tt={tt} guardRef={guardRef} projectId={projectId} sandboxTokenPath={sandboxTokenPathOf ? sandboxTokenPathOf(file) : undefined} onSave={(onSaveFile || onSaveZip) ? saveFile : undefined} draftKey={draftKey} readOnly={readOnly} canDownload={canDownload} canRun={canRun} />
          </Suspense>
        )}
        {!editing && stage === 'table' && data.blob && ['xlsx', 'csv', 'tsv'].includes(ext) && (
          <div className="st-fv__sheet st-fv__sheet--grid"><Suspense fallback={<div className="st-fv__center"><Spinner /></div>}><XlsxPreview blob={data.blob} ext={ext} tt={tt} rtl={rtl} /></Suspense></div>
        )}
        {stage === 'table' && !(data.blob && ['xlsx', 'csv', 'tsv'].includes(ext)) && (
          <div className="st-fv__sheet">
            {sheets.length > 1 && (
              <div className="st-fv__tabs" role="tablist">
                {sheets.map((s, i) => (
                  <button key={s.name || i} type="button" role="tab" aria-selected={sheet === i} className={sheet === i ? 'is-on' : ''} onClick={() => setSheet(i)}>{s.name}</button>
                ))}
              </div>
            )}
            {rows.length === 0 ? <p className="st-fv__empty">{tt('This file is empty.', 'الملف فارغ.')}</p> : (
              <>
                <p className="st-fv__hint">
                  {rows.length - 1 > MAX_ROWS
                    ? tt(`Showing the first ${MAX_ROWS} of ${rows.length - 1} rows`, `عرض أول ${MAX_ROWS} من ${rows.length - 1} صف`)
                    : tt(`${rows.length - 1} rows`, `${rows.length - 1} صف`)}
                </p>
                <div className="st-fv__tablewrap">
                  <table>
                    <thead><tr>{header.map((h, i) => <th key={i}>{cellStr(h)}</th>)}</tr></thead>
                    <tbody>{body.map((r, ri) => <tr key={ri}>{header.map((_, ci) => <td key={ci}>{cellStr(r[ci])}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
        {stage === 'json' && (
          <div className="st-fv__sheet st-fv__sheet--json">
            <Suspense fallback={<div className="st-fv__center"><Spinner /></div>}>
              <JsonViewer key={rootOf(file)} value={data.value} text={data.raw} filename={downloadName}
                meta={ext === 'jsonl' || ext === 'ndjson' ? 'JSON Lines' : undefined}
                labels={{ tree: tt('Tree', 'شجرة'), outline: tt('Outline', 'هيكل'), theme: tt('Theme', 'الثيم'), dark: tt('Dark', 'داكن'), light: tt('Light', 'فاتح'), code: tt('Code', 'كود'), search: tt('Search keys & values…', 'ابحث في المفاتيح والقيم…'), expand: tt('Expand all', 'فتح الكل'), collapse: tt('Collapse all', 'طي الكل'), copy: tt('Copy', 'نسخ'), copied: tt('Copied', 'تم النسخ'), download: tt('Download', 'تنزيل'), full: tt('Full screen', 'ملء الشاشة'), exit: tt('Exit full screen', 'إنهاء ملء الشاشة'), nodes: tt('nodes', 'عقدة'), lines: tt('lines', 'سطر'), path: tt('Click a node to see its path', 'اضغط على عقدة لعرض مسارها'), matches: tt('matches', 'نتيجة'), wrap: tt('Wrap', 'التفاف'), zoomIn: tt('Zoom in', 'تكبير'), zoomOut: tt('Zoom out', 'تصغير'), zoomHint: tt('Ctrl + mouse wheel to zoom', 'Ctrl + عجلة الماوس للتكبير'), fit: tt('Fit to screen', 'ملاءمة الشاشة'), resetLayout: tt('Reset layout', 'إعادة الترتيب'), dragHint: tt('drag to move', 'اسحب للتحريك'), resize: tt('Drag to resize', 'اسحب لتغيير الحجم') }} />
            </Suspense>
          </div>
        )}
        {stage === 'text' && (
          <div className="st-fv__sheet">
            {data.jsonError && <p className="st-fv__empty" role="alert" dir="ltr">{tt('Not valid JSON — shown as text:', 'مش JSON صالح — معروض كنص:')} {data.jsonError}</p>}
            {!data.text ? <p className="st-fv__empty">{tt('This file is empty.', 'الملف فارغ.')}</p> : lines ? (
              <pre dir="ltr" className={`st-fv__code${data.code ? ' is-code' : ''}`}>{lines.map((ln, i) => <span key={i} className="st-fv__ln">{ln || ' '}{'\n'}</span>)}</pre>
            ) : (
              <pre dir="auto" className="st-fv__code">{data.text}</pre>
            )}
          </div>
        )}
      </main>

      {hasMany && (
        <>
          <button type="button" className="st-fv__nav st-fv__nav--prev" onClick={() => go(-1)} disabled={index === 0} aria-label={tt('Previous file', 'الملف السابق')}>
            <Icon name={prevIcon} size={26} />
          </button>
          <button type="button" className="st-fv__nav st-fv__nav--next" onClick={() => go(1)} disabled={index === list.length - 1} aria-label={tt('Next file', 'الملف التالي')}>
            <Icon name={nextIcon} size={26} />
          </button>
          <footer className="st-fv__thumbs" ref={thumbsRef}>
            {list.map((f, i) => {
              const e = extOf(f.original_name);
              const thumb = !loadBlob && IMAGE_EXT.includes(e) && e !== 'svg' && Number(f.size_bytes) > 0 && Number(f.size_bytes) < 4 * 1024 * 1024;
              return (
                <button
                  key={f.id}
                  type="button"
                  className={i === index ? 'is-on' : ''}
                  style={{ '--k': colorOf(f.original_name) }}
                  onClick={() => jump(i)}
                  title={f.original_name}
                  aria-label={f.original_name}
                  aria-current={i === index}
                >
                  {thumb ? <img src={f.url} alt="" loading="lazy" draggable={false} /> : <span>{(e || 'file').slice(0, 4).toUpperCase()}</span>}
                </button>
              );
            })}
          </footer>
        </>
      )}
      {mediaFile && (
        <Suspense fallback={null}>
          <MediaEditor saveMode file={mediaFile} onCancel={() => setMediaFile(null)} onDone={saveEditedVideo} onSend={saveEditedVideo} />
        </Suspense>
      )}
    </div>
  );
  return embedded ? node : createPortal(node, document.body);
}
