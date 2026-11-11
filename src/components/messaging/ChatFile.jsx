import { useState } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '../../api/client';
import Icon from '../Icon';
import { BlobPreviewModal } from '../FilePreviewButton';
import { confirmRiskyDownload } from '../../lib/pdfSafety';
import { saveBlob } from '../../lib/exporter';
import { useLanguage } from '../../context/LanguageContext';
import { attachmentUrl } from './format';

/**
 * A file in a chat bubble. Click the card (or the eye) = preview inside the chat; the arrow = download.
 *
 * Files are fetched THROUGH the API (/messaging/attachments/{id}/download), never straight from /uploads:
 *  - a plain cross-origin fetch of /uploads is blocked by CORS ("Failed to fetch"), the API answers with CORS + auth;
 *  - the server scans the file (ClamAV + PDF active content) before it hands it over, and answers 423 when it is
 *    blocked. An infected file is never opened or downloaded; a PDF with scripts is only downloadable after two warnings.
 */
export default function ChatFile({ attachment: a, fmtBytes }) {
  const { locale } = useLanguage();
  const tt = (en, ar) => (locale === 'ar' ? ar : en);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null); // { blob, filename }
  const [blocked, setBlocked] = useState(null); // { reason: 'malware' | 'active_content' }
  const [error, setError] = useState('');

  const name = a.original_name || 'file';

  async function load(force = false) {
    if (a.id) {
      const res = await api.blob(`/api/v1/messaging/attachments/${a.id}/download`, force ? { force: 1 } : undefined);
      return res.blob();
    }
    // not stored yet (local pending upload): nothing to scan on the server
    const res = await fetch(attachmentUrl(a.url));
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.blob();
  }

  async function run(mode) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const blob = await load();
      if (mode === 'download') saveBlob(blob, name);
      else setPreview({ blob, filename: name });
    } catch (err) {
      if (err instanceof ApiError && err.status === 423) {
        const reason = err.payload?.errors?.blocked?.[0] || 'malware';
        setBlocked({ reason, mode });
      } else {
        setError(err instanceof ApiError ? err.message : tt('Could not load the file. Check your connection and try again.', 'تعذّر تحميل الملف. اتأكد من الاتصال وجرّب تاني.'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function downloadAnyway() {
    if (!confirmRiskyDownload(tt, name)) return;
    try {
      saveBlob(await load(true), name);
      setBlocked(null);
    } catch {
      setError(tt('Could not download the file.', 'تعذّر تنزيل الملف.'));
      setBlocked(null);
    }
  }

  const stop = (e) => e.stopPropagation();
  const malware = blocked?.reason === 'malware';

  const dialog = blocked && createPortal(
    <div className="modal-overlay" style={{ position: 'fixed', inset: 0, zIndex: 'calc(var(--z-toast, 600) + 120)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setBlocked(null)}>
      <div className="modal-box card" role="alertdialog" aria-modal="true" style={{ width: 'min(460px, 100%)', background: 'var(--bg-surface, #fff)', color: 'var(--text-primary, #111)', border: '2px solid var(--color-danger, #d92d20)', borderRadius: 16, padding: 20 }} onClick={stop}>
        <h2 className="text-h3" style={{ margin: 0, color: 'var(--color-danger, #d92d20)' }}>
          ⚠ {malware ? tt('Infected file blocked', 'تم حظر ملف مصاب') : tt('Unsafe file was not opened', 'ملف غير آمن — اتمنع فتحه')}
        </h2>
        <p style={{ margin: '10px 0 0', lineHeight: 1.7 }}>
          <strong dir="auto">{name}</strong>
          <br />
          {malware
            ? tt('Our security scan flagged this file as a virus. It cannot be opened or downloaded.', 'فحص الحماية اكتشف إن الملف ده فيه فيروس. مينفعش يتفتح ولا يتنزّل.')
            : tt('This PDF contains scripts or active content that can harm your device or account, so it was not opened.', 'ملف الـ PDF ده فيه سكربتات أو محتوى نشط ممكن يضر جهازك أو حسابك، عشان كده اتمنع فتحه.')}
        </p>
        <div className="modal-box__actions" style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {!malware && (
            <button type="button" className="btn btn-outline" onClick={downloadAnyway}>{tt('Download anyway', 'نزّله رغم كده')}</button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => setBlocked(null)}>{tt('OK', 'تمام')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );

  return (
    <>
      <span className="msg-attach-file-wrap" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
        <a
          className="msg-attach-file"
          href="#"
          role="button"
          aria-busy={busy}
          title={tt('Open', 'فتح')}
          onClick={(e) => { e.preventDefault(); run('preview'); }}
        >
          <span className="msg-attach-file__icon"><Icon name="file" size={16} /></span>
          <span className="msg-attach-file__meta">
            <span className="msg-attach-file__name">{name}</span>
            <span className="msg-attach-file__size">{fmtBytes(a.size_bytes)}</span>
          </span>
        </a>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} title={tt('Preview', 'معاينة')} aria-label={tt('Preview', 'معاينة')} onClick={() => run('preview')}>
          <Icon name="eye" size={14} />
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} title={tt('Download', 'تنزيل')} aria-label={tt('Download', 'تنزيل')} onClick={() => run('download')}>
          <Icon name="download" size={14} />
        </button>
      </span>
      {error && <span role="alert" className="form-error" style={{ display: 'block', fontSize: 12 }}>{error}</span>}
      {preview && <BlobPreviewModal blob={preview.blob} filename={preview.filename} title={name} onClose={() => setPreview(null)} />}
      {dialog}
    </>
  );
}
