import { lazy, Suspense, useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { isProtectedAttachmentUrl, loadAttachmentBlob } from '../lib/chatMedia';

const FileViewer = lazy(() => import('./FileViewer'));

// Private chat files (/api/v1/messaging/attachments/{id}/file) need the Bearer token: the viewer loads them through the API client.
const loadBlob = (file) => loadAttachmentBlob(file.url);

/**
 * Files (photos, videos, voice notes, PDFs …) that the app would otherwise open in the phone's browser sheet (which shows
 * the site's address bar) open here, inside the app, in the same viewer the rest of the platform uses.
 * native.js (APK) and the chat info panel fire `uip:open-file` ({ url, name } or { files, index }) instead of calling Browser.open for /uploads and /api file links.
 */
export default function NativeFileOpener() {
  const { locale } = useLanguage();
  const [open, setOpen] = useState(null);
  useEffect(() => {
    const on = (e) => {
      const d = e.detail || {};
      const list = Array.isArray(d.files) && d.files.length ? d.files : (d.url ? [{ url: d.url, name: d.name }] : []);
      if (!list.length) return;
      setOpen({ start: Math.max(0, Math.min(list.length - 1, d.index || 0)), files: list.map((f, i) => ({ id: `of-${i}`, original_name: f.name || 'file', url: f.url, size_human: '', size_bytes: 0, uploader_name: '', version: 1 })) });
    };
    window.addEventListener('uip:open-file', on);
    return () => window.removeEventListener('uip:open-file', on);
  }, []);
  if (!open) return null;
  const hasPrivate = open.files.some((f) => isProtectedAttachmentUrl(f.url));
  return <Suspense fallback={null}><FileViewer files={open.files} startIndex={open.start} locale={locale} loadBlob={hasPrivate ? loadBlob : undefined} onClose={() => setOpen(null)} /></Suspense>;
}
