import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import VideoPlayer from '../VideoPlayer';
import VoiceMessage from '../messaging/VoiceMessage';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import { postsApi } from '../../api/postsApi';
import { fetchMediaBlob, fmtBytes, fmtDuration, mediaBaseOf, useMediaUrl, useSignedUrl } from '../../lib/postMedia';
import PdfCarousel from './PdfCarousel';
import CodeCard from './CodeCard';
import { canCarousel } from './OfficeCarousel';


const OfficeCarousel = lazy(() => import('./OfficeCarousel')); // Word / PowerPoint / Excel as swipeable pages (rendered in the browser)
const FileViewer = lazy(() => import('../FileViewer')); // the platform's viewer / editor: PDF, Office, CSV / XLSX, ZIP, images, text, video, audio

function Img({ m, onOpen, className = '' }) {
  const thumb = useMediaUrl(m, m.has_thumbnail ? 'thumbnail' : 'file');
  return (
    <button type="button" className={`pp-img ${className}`} onClick={() => onOpen(m)} style={m.width && m.height ? { aspectRatio: `${m.width}/${m.height}` } : undefined}>
      {thumb.url ? <img src={thumb.url} alt={m.alt_text || m.original_name} loading="lazy" /> : <span className={thumb.error ? 'pp-img__err' : 'pp-skel'}>{thumb.error && <Icon name="image" size={28} />}</span>}
    </button>
  );
}

export function Lightbox({ items, start, onClose }) {
  const [i, setI] = useState(start);
  const m = items[i];
  const full = useMediaUrl(m, 'file');
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') setI((v) => Math.min(items.length - 1, v + 1)); if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1)); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [items.length, onClose]);
  return createPortal(
    <div className="pp-lb" role="dialog" aria-modal="true" onClick={onClose}>
      <button type="button" className="pp-lb__x" onClick={onClose} aria-label="Close"><Icon name="x" size={22} /></button>
      {i > 0 && <button type="button" className="pp-lb__nav is-prev" onClick={(e) => { e.stopPropagation(); setI(i - 1); }}><Icon name="chevron-left" size={26} /></button>}
      {i < items.length - 1 && <button type="button" className="pp-lb__nav is-next" onClick={(e) => { e.stopPropagation(); setI(i + 1); }}><Icon name="chevron-right" size={26} /></button>}
      <div className="pp-lb__body" onClick={(e) => e.stopPropagation()}>
        {full.url ? <img src={full.url} alt={m.alt_text || m.original_name} /> : <span className="pp-skel" style={{ width: 240, height: 240 }} />}
        {m.caption && <p>{m.caption}</p>}
      </div>
    </div>, document.body);
}

function OpenBtn({ onOpen, label }) {
  return <button type="button" className="pp-open" onClick={(e) => { e.stopPropagation(); onOpen(); }} title={label} aria-label={label}><Icon name="expand" size={16} /></button>;
}

function Video({ m, onOpen, openLabel }) {
  const [play, setPlay] = useState(false);
  const poster = useMediaUrl(m, 'thumbnail');
  const src = useSignedUrl(m, 'file', play);
  return (
    <div className="pp-video" style={m.width && m.height ? { aspectRatio: `${m.width}/${m.height}`, maxHeight: 560 } : undefined}>
      {onOpen && <OpenBtn onOpen={onOpen} label={openLabel} />}
      {play && src.url ? <VideoPlayer src={src.url} poster={poster.url || undefined} autoPlay />
        : (
          <button type="button" className="pp-video__cover" onClick={() => setPlay(true)} aria-label="Play">
            {poster.url ? <img src={poster.url} alt="" /> : <span className="pp-skel" />}
            <span className="pp-doc__play"><Icon name="play" size={24} /></span>
            {m.duration_seconds ? <span className="pp-video__dur">{fmtDuration(m.duration_seconds)}</span> : null}
            {play && !src.url && !src.error && <span className="pp-doc__spin" />}
            {src.error && <span className="pp-doc__err">!</span>}
          </button>
        )}
    </div>
  );
}

function Audio({ m, onOpen, openLabel }) {
  const [go, setGo] = useState(false);
  const src = useSignedUrl(m, 'file', go);
  return (
    <div className="pp-audio">
      <span className="pp-audio__ico"><Icon name="audio-wave" size={20} /></span>
      <div className="pp-audio__main">
        <strong dir="ltr">{m.original_name}</strong>
        {onOpen && <OpenBtn onOpen={onOpen} label={openLabel} />}
        {go && src.url
          ? <VoiceMessage src={src.url} duration={m.duration_seconds} name={m.original_name} downloadable={false} />
          : <button type="button" className="pp-btn" onClick={() => setGo(true)}><Icon name="play" size={14} /> {m.duration_seconds ? fmtDuration(m.duration_seconds) : 'Play'}</button>}
      </div>
    </div>
  );
}

const EXT_COLOR = { pdf: '#e5484d', doc: '#3b82f6', docx: '#3b82f6', odt: '#3b82f6', rtf: '#3b82f6', txt: '#64748b', log: '#64748b', xls: '#16a34a', xlsx: '#16a34a', csv: '#16a34a', ppt: '#f97316', pptx: '#f97316', odp: '#f97316', zip: '#d4a017', rar: '#d4a017', '7z': '#d4a017' };

/** Downloads a post attachment through the API (honours the author's "allow download" switch: the server refuses otherwise). */
async function downloadMedia(m) {
  const res = await api.blob(m.urls.download); const blob = await res.blob();
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = m.original_name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** An attachment with no inline preview: icon badge, name, size, Open (platform viewer / editor) and Download. */
function FileCard({ m, canDownload, onOpen }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const color = EXT_COLOR[(m.extension || '').toLowerCase()] || '#64748b';
  const dl = async (e) => {
    e?.stopPropagation();
    setBusy(true);
    try {
      const res = await api.blob(m.urls.download); const blob = await res.blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = m.original_name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch { /* download blocked by the author */ } finally { setBusy(false); }
  };
  return (
    <div className="pp-file" role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>
      <span className="pp-file__ico" style={{ color, background: `${color}1f` }}><Icon name={m.kind === 'archive' ? 'folder' : 'file'} size={22} /></span>
      <div className="pp-file__main"><strong dir="ltr">{m.original_name}</strong><small>{(m.extension || '').toUpperCase()} · {fmtBytes(m.size_bytes)}</small></div>
      <button type="button" className="pp-btn" onClick={(e) => { e.stopPropagation(); onOpen(); }}><Icon name="eye" size={14} /> {ar ? 'فتح' : 'Open'}</button>
      {canDownload && <button type="button" className="pp-btn" onClick={dl} disabled={busy}><Icon name="download" size={14} /> {ar ? 'تنزيل' : 'Download'}</button>}
    </div>
  );
}

/** Renders a post's attachments by kind: image grid + lightbox, video, audio, PDF/Office carousel, runnable code, other files.
 *  Everything except images/code opens in the platform's FileViewer; the post's author can also edit and save (the edited file replaces the attachment). */
export default function PostMedia({ media = [], canDownload = true, canRun = true, post = null, onPostChange }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [lb, setLb] = useState(null);
  const [viewer, setViewer] = useState(null); // media id
  const canEdit = !!(post && post.can?.edit && onPostChange);
  const files = useMemo(() => media.filter((m) => m.urls?.file).map((m) => ({
    id: m.id, original_name: m.original_name, url: m.urls.file, size_human: fmtBytes(m.size_bytes), size_bytes: m.size_bytes, uploader_name: post?.author?.name, version: 1,
  })), [media, post?.author?.name]);
  const loadBlob = useCallback((f, { onProgress } = {}) => {
    const m = media.find((x) => x.id === f.id);
    onProgress?.(0);
    return fetchMediaBlob(f.id, 'file', mediaBaseOf(m)).then((b) => { onProgress?.(100); return b; });
  }, [media]);
  // Save from the viewer: upload the edited file as a new attachment, swap it in for the old one (keeps order / caption), and refresh the post.
  const saveFile = useCallback(async (file, blob, opts) => {
    const old = media.find((x) => x.id === file.id);
    const name = opts?.name || file.original_name;
    const up = await postsApi.uploadMedia(new File([blob], name, { type: blob.type || undefined }));
    const ids = media.map((x) => (x.id === file.id ? up.id : x.id));
    const updated = await postsApi.update(post.id, { media_ids: ids, media_details: { [up.id]: { alt_text: old?.alt_text || null, caption: old?.caption || null } } });
    onPostChange(updated);
    return { id: up.id, original_name: up.original_name || name };
  }, [media, post?.id, onPostChange]);

  if (!media.length) return null;
  const open = (m) => setViewer(m.id);
  const images = media.filter((m) => m.kind === 'image');
  const rest = media.filter((m) => m.kind !== 'image');
  const shown = images.slice(0, 4);
  const startIndex = Math.max(0, files.findIndex((f) => f.id === viewer));
  const openLabel = ar ? 'فتح في العارض' : 'Open in viewer';
  return (
    <div className="pp-media">
      {images.length > 0 && (
        <div className={`pp-grid is-${Math.min(images.length, 4)}`}>
          {shown.map((m, i) => (
            <div key={m.id} className="pp-grid__c">
              <Img m={m} onOpen={() => setLb(images.indexOf(m))} />
              {i === 3 && images.length > 4 && <span className="pp-grid__more">+{images.length - 4}</span>}
            </div>
          ))}
        </div>
      )}
      {rest.map((m) => {
        const ext = (m.extension || '').toLowerCase();
        if (m.kind === 'video') return <Video key={m.id} m={m} onOpen={() => open(m)} openLabel={openLabel} />;
        if (m.kind === 'audio') return <Audio key={m.id} m={m} onOpen={() => open(m)} openLabel={openLabel} />;
        const dlFn = canDownload && m.urls?.download ? () => downloadMedia(m).catch(() => {}) : undefined;
        if (m.kind === 'pdf' || (m.has_preview && m.kind === 'document')) return <PdfCarousel key={m.id} media={m} onOpenFull={() => open(m)} onDownload={dlFn} />;
        if (m.kind === 'document' && canCarousel(m)) return <Suspense key={m.id} fallback={<div className="pp-skel" style={{ height: 240 }} />}><OfficeCarousel media={m} onOpenFull={() => open(m)} onDownload={dlFn} /></Suspense>;
        if (m.kind === 'code' || (m.is_text && ext !== 'csv')) return <CodeCard key={m.id} canRun={canRun} media={{ ...m, urls: { ...m.urls, download: canDownload ? m.urls.download : null } }} />;
        return <FileCard key={m.id} m={m} canDownload={canDownload} onOpen={() => open(m)} />;
      })}
      {lb != null && <Lightbox items={images} start={lb} onClose={() => setLb(null)} />}
      {viewer != null && files.length > 0 && (
        <Suspense fallback={null}>
          <FileViewer
            files={files} startIndex={startIndex} locale={locale} onClose={() => setViewer(null)}
            loadBlob={loadBlob} canDownload={canDownload}
            readOnly={!canEdit} canRun={canEdit || canRun}
            onSaveFile={canEdit ? saveFile : undefined}
          />
        </Suspense>
      )}
    </div>
  );
}
