import { useMemo } from 'react';
import FileViewer from '../../FileViewer';
import { extOf } from '../../FilePreviewButton';
import { useLanguage } from '../../../context/LanguageContext';

const IMG = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'];
const VID = ['mp4', 'webm', 'mov', 'm4v', 'ogv'];
const AUD = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'oga', 'opus', 'weba'];

/** image | video | audio | file — by extension first, then by mime type. */
export function fileKind(file) {
  const ext = (file?.extension || extOf(file?.original_name || file?.name) || '').toLowerCase();
  const mime = String(file?.mime_type || file?.mime || '').toLowerCase();
  if (IMG.includes(ext) || mime.startsWith('image/')) return 'image';
  if (VID.includes(ext) || mime.startsWith('video/')) return 'video';
  if (AUD.includes(ext) || mime.startsWith('audio/')) return 'audio';
  return 'file';
}

/**
 * Uploaded files are served from the Laravel host. The page itself only talks to its own origin (CSP + Vercel rewrite), so any
 * `.../uploads/...` URL is turned into the same-origin `/uploads/...` path — the same bytes, no cross-origin request.
 */
export function sameOriginUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url, window.location.origin);
    const i = u.pathname.indexOf('/uploads/');
    if (i !== -1) return u.pathname.slice(i) + u.search;
    return u.href;
  } catch { return url; }
}

export function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Small file-type icon name for the file cards. */
export function fileIcon(file) {
  const k = fileKind(file);
  if (k === 'image') return 'image';
  if (k === 'video') return 'video';
  if (k === 'audio') return 'mic';
  return 'file';
}

/**
 * Preview of shared meeting files — the platform's own FileViewer (the one My PC and project files use), so every type opens
 * the same way: images (zoom / pan / rotate), PDF, Word / Excel / PowerPoint, CSV, code and text, JSON, ZIP contents, video and
 * audio; anything else gets a clear download card. It is full-screen, swipeable, and responsive down to phones.
 *
 * `file` = the one to open; `files` = the list it can step through with prev / next (defaults to just `file`).
 * Each item: { id?, original_name, download_url, size_bytes?, uploader_display_name? }.
 */
export default function MeetingFilePreview({ file, files, onClose }) {
  const { locale } = useLanguage();
  const { list, start } = useMemo(() => {
    const src = (files && files.length ? files : [file]).filter((f) => f && f.download_url);
    const toViewer = (f) => ({
      id: f.id ?? f.download_url,
      original_name: f.original_name || f.name || 'file',
      url: sameOriginUrl(f.download_url),
      size_bytes: f.size_bytes,
      size_human: f.size_bytes != null ? formatSize(f.size_bytes) : undefined,
      uploader_name: f.uploader_display_name,
    });
    const mapped = src.map(toViewer);
    const key = file?.id ?? file?.download_url;
    return { list: mapped, start: Math.max(0, mapped.findIndex((f) => f.id === key)) };
  }, [file, files]);
  if (!list.length) return null;
  return <FileViewer files={list} startIndex={start} locale={locale} onClose={onClose} />;
}
