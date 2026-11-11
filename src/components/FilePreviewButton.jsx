import { scanPdfBlob, confirmRiskyDownload } from '../lib/pdfSafety';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, errorMessage } from '../api/client';
import Icon from './Icon';
import { useLanguage, useTranslations } from '../context/LanguageContext';
import { parseCsv, runWithSink, saveBlob } from '../lib/exporter';
import { pdfjsAssetOptions } from '../lib/pdfjsOptions';

/**
 * Preview any file inside the platform before downloading it.
 *
 *   <FilePreviewButton path={`/${r.file_path}`} format={r.format} title="Platform KPIs" />
 *       — a file the server already stores (fetched through api.blob()).
 *
 *   <ActionPreviewButton run={() => downloadSomething()} title="…" />
 *       — any download routine that ends in saveBlob(): it is run with the final
 *         save intercepted, so the preview shows exactly what Download would save.
 *
 * Rendered by type:
 *   pdf -> the real PDF · csv / xlsx -> table (xlsx: one tab per sheet)
 *   json / xml / txt / md / html / log -> text · docx -> extracted text (mammoth)
 *   png / jpg / gif / webp / svg -> image · others -> "download to open it"
 */

const dict = {
  'Preview': 'معاينة',
  'Close': 'إغلاق',
  'Download': 'تنزيل',
  'Loading…': 'جارٍ التحميل…',
  'Showing the first': 'عرض أول',
  'of': 'من',
  'rows': 'صف',
  'Preview is not available for this file type in the browser. Download it to open it.': 'المعاينة غير متاحة لهذا النوع من الملفات داخل المتصفح. نزّله لفتحه.',
  'This file is empty.': 'الملف فارغ.',
  'The server did not return a file.': 'السيرفر لم يرجّع ملفًا.',
};

export const MAX_ROWS = 200;
const MAX_PDF_PAGES = 60;
const MAX_TEXT = 200000;
export const TEXT_EXT = ['json', 'xml', 'txt', 'md', 'log', 'html', 'htm', 'yml', 'yaml', 'sql', 'swift', 'm', 'mm', 'vb', 'scala', 'ex', 'exs', 'erl', 'fs', 'fsx', 'ml', 'clj', 'lisp', 'lsp', 'cob', 'cbl', 'asm', 'nasm', 'dpr', 'bas', 'cls', 'frm', 'ps1', 'sol', 'abap', 'sas', 'plsql', 'pls', 'tsql', 'pro', 'adb', 'ads', 'v', 'zig', 'groovy', 'gvy', 'kts', 'scm', 'rkt'];
const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];

export const extOf = (name) => (/\.([a-z0-9]+)(?:[?#].*)?$/i.exec(String(name || '')) || [])[1]?.toLowerCase() || '';
export const cellStr = (v) => (v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ') : v === null || v === undefined ? '' : String(v));

export async function describe(blob, ext) {
  if (ext === 'pdf') {
    // Never the browser's own PDF viewer (it would run the file's scripts on our origin): pdf.js canvas only,
    // and a PDF with scripts / active content is not opened at all.
    const scan = await scanPdfBlob(blob);
    if (scan.risky) return { kind: 'pdf-risky', blob, findings: scan.findings };
    return { kind: 'pdf-canvas', blob };
  }
  if (IMG_EXT.includes(ext)) return { kind: 'image', url: URL.createObjectURL(new Blob([blob], { type: ext === 'svg' ? 'image/svg+xml' : blob.type || `image/${ext}` })) };
  if (ext === 'csv') return { kind: 'table', sheets: [{ name: 'CSV', rows: parseCsv(await blob.text()) }] };
  if (ext === 'xlsx') {
    const { default: readExcelFile } = await import('read-excel-file/browser');
    const sheets = await readExcelFile(blob);
    return { kind: 'table', sheets: sheets.map((s) => ({ name: s.sheet, rows: s.data.map((r) => r.map(cellStr)) })) };
  }
  if (TEXT_EXT.includes(ext)) {
    let text = await blob.text();
    if (ext === 'json') { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* show raw */ } }
    return { kind: 'text', text: text.slice(0, MAX_TEXT) };
  }
  if (ext === 'docx') {
    const mammoth = await import('mammoth/mammoth.browser');
    const out = await (mammoth.default || mammoth).extractRawText({ arrayBuffer: await blob.arrayBuffer() });
    return { kind: 'text', text: (out.value || '').slice(0, MAX_TEXT) };
  }
  return { kind: 'unsupported' };
}

/** Draws every page of a PDF Blob into <canvas> elements (works inside the Android WebView and on phones). */
export function PdfCanvasViewer({ blob, onError }) {
  const hostRef = useRef(null);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let cancelled = false;
    let pdf = null;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), ...pdfjsAssetOptions }).promise;
        const host = hostRef.current;
        if (!host || cancelled) return;
        host.textContent = '';
        const width = host.clientWidth || 320;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const total = Math.min(pdf.numPages, MAX_PDF_PAGES);
        for (let n = 1; n <= total; n += 1) {
          if (cancelled) return;
          // eslint-disable-next-line no-await-in-loop
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          // Render at least ~1400 px wide (the host can still be mid-layout/animating, i.e. narrow, when this runs) so
          // pictures and small text stay sharp once the canvas is stretched to the panel width; cap the pixel count.
          let k = Math.max(width * dpr, 1400) / base.width;
          k = Math.min(k, Math.sqrt(3.5e6 / (base.width * base.height)));
          const viewport = page.getViewport({ scale: k });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.cssText = 'display:block;width:100%;height:auto;margin:0 auto 10px;background:#fff;border:1px solid #e5e7eb;border-radius:6px';
          host.appendChild(canvas);
          // eslint-disable-next-line no-await-in-loop
          await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
        }
        if (!cancelled) setBusy(false);
      } catch (err) {
        if (!cancelled) { setBusy(false); onError?.(errorMessage(err)); }
      }
    })();
    return () => { cancelled = true; try { pdf?.destroy?.(); } catch { /* ignore */ } };
  }, [blob]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ background: 'var(--bg-muted, #F2F4F8)', borderRadius: 8, padding: 8, minHeight: '40vh' }}>
      {busy && <p className="text-small" style={{ textAlign: 'center', margin: '8px 0' }}>…</p>}
      <div ref={hostRef} style={{ width: '100%' }} />
    </div>
  );
}

/** Modal that previews a Blob. `filename` decides how it is rendered. */
export function BlobPreviewModal({ blob, filename, title, onClose }) {
  const t = useTranslations(dict);
  const { locale } = useLanguage();
  const tt = (en, ar) => (locale === 'ar' ? ar : en);
  const ext = extOf(filename);
  const [state, setState] = useState({ loading: true, error: null, kind: null });
  const [sheet, setSheet] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    describe(blob, ext)
      .then((d) => { objectUrl = d.url || null; if (!cancelled) setState({ loading: false, error: null, ...d }); else if (objectUrl) URL.revokeObjectURL(objectUrl); })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: errorMessage(err), kind: null }); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [blob, ext]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { loading, error, kind, url, text, sheets } = state;
  const pdfBlob = state.blob;
  const rows = sheets?.[sheet]?.rows || [];
  const header = rows[0] || [];
  const body = rows.slice(1, MAX_ROWS + 1);

  // Portaled to <body>: rendered inline it was clipped / mis-positioned by any ancestor
  // that has transform, filter or backdrop-filter (glass cards, table rows, ...).
  const modal = (
    <div
      className="modal-overlay"
      style={{ position: 'fixed', inset: 0, zIndex: 'calc(var(--z-toast, 600) + 20)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(8px, 2vw, 24px)' }}
      onClick={onClose}
    >
      <div
        className="modal-box card"
        style={{ width: 'min(1100px, 100%)', maxWidth: '100%', height: kind === 'pdf-canvas' || loading ? 'min(92vh, 900px)' : undefined, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', transform: 'none', background: 'var(--bg-surface, #fff)', color: 'var(--text-primary, #111)', backdropFilter: 'none', WebkitBackdropFilter: 'none', opacity: 1, boxShadow: '0 24px 64px rgba(10,15,30,0.35)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={t('Preview')}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <h2 className="modal-box__title text-h3" style={{ margin: 0 }}>
            {title || filename || t('Preview')}
            {ext && <span className="badge badge-neutral" style={{ marginInlineStart: 8 }}>{ext.toUpperCase()}</span>}
          </h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={18} /></button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {loading && <p className="text-small">{t('Loading…')}</p>}
          {error && <p className="form-error">{error}</p>}

          {kind === 'pdf-risky' && (
            <div role="alert" style={{ padding: 20, border: '2px solid var(--color-danger, #d92d20)', borderRadius: 8 }}>
              <strong>{tt('⚠ This PDF was not opened', '⚠ الـ PDF ده اتمنع فتحه')}</strong>
              <p style={{ margin: '8px 0 0' }}>{tt(
                'It contains scripts or active content that can harm your device or account, so it is blocked from opening here.',
                'فيه سكربتات أو محتوى نشط ممكن يضر جهازك أو حسابك، فاتمنع فتحه هنا.'
              )}</p>
            </div>
          )}
          {kind === 'pdf-canvas' && <PdfCanvasViewer blob={pdfBlob} onError={(m) => setState((p) => ({ ...p, error: m }))} />}
          {kind === 'image' && <div style={{ textAlign: 'center' }}><img src={url} alt={filename || ''} style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 8 }} /></div>}

          {kind === 'table' && (
            <>
              {sheets.length > 1 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }} role="tablist">
                  {sheets.map((s, i) => (
                    <button key={i} type="button" role="tab" aria-selected={sheet === i} className={`btn btn-sm ${sheet === i ? 'btn-primary' : 'btn-outline'}`} onClick={() => setSheet(i)}>{s.name}</button>
                  ))}
                </div>
              )}
              {rows.length === 0 ? <p className="text-small">{t('This file is empty.')}</p> : (
                <>
                  <p className="text-small" style={{ marginBottom: 8 }}>
                    {rows.length - 1 > MAX_ROWS ? `${t('Showing the first')} ${MAX_ROWS} ${t('of')} ${rows.length - 1} ${t('rows')}` : `${rows.length - 1} ${t('rows')}`}
                  </p>
                  <div className="table-responsive" style={{ background: 'var(--bg-surface, #fff)' }}>
                    <table className="data-table">
                      <thead><tr>{header.map((h, i) => <th key={i}>{cellStr(h)}</th>)}</tr></thead>
                      <tbody>{body.map((r, ri) => <tr key={ri}>{header.map((_, ci) => <td key={ci}>{cellStr(r[ci])}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}

          {kind === 'text' && (text
            ? <pre dir="auto" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: 13, lineHeight: 1.6, padding: 12, borderRadius: 8, background: 'var(--bg-muted, #F2F4F8)', unicodeBidi: 'plaintext', textAlign: 'start' }}>{text}</pre>
            : <p className="text-small">{t('This file is empty.')}</p>)}

          {kind === 'unsupported' && <p className="text-small">{t('Preview is not available for this file type in the browser. Download it to open it.')}</p>}
        </div>

        <div className="modal-box__actions" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>{t('Close')}</button>
          <button type="button" className="btn btn-primary" onClick={() => { if (kind === 'pdf-risky' && !confirmRiskyDownload(tt, filename || 'file.pdf')) return; saveBlob(blob, filename || 'download'); }}><Icon name="download" size={16} /> {t('Download')}</button>
        </div>
      </div>
    </div>
  );
  return typeof document !== 'undefined' ? createPortal(modal, document.body) : modal;
}

/** Runs `run()` with its final save intercepted, then shows the captured file. */
export function usePreviewRunner() {
  const t = useTranslations(dict);
  const [captured, setCaptured] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const start = async (run) => {
    setBusy(true); setError(null);
    try {
      let got = null;
      await runWithSink((blob, filename) => { got = { blob, filename }; }, run);
      if (got) setCaptured(got);
    } catch (err) {
      setError(t(errorMessage(err)));
      window.alert(t(errorMessage(err)));
    } finally { setBusy(false); }
  };
  return { captured, busy, error, start, close: () => setCaptured(null) };
}

/** Preview button for any download routine that finishes with saveBlob(). */
export function ActionPreviewButton({ run, title, className = 'btn btn-ghost btn-sm', iconSize = 16, label = false, disabled = false }) {
  const t = useTranslations(dict);
  const { captured, busy, start, close } = usePreviewRunner();
  return (
    <>
      <button type="button" className={className} title={t('Preview')} aria-label={t('Preview')} disabled={disabled || busy} onClick={() => start(run)}>
        <Icon name="eye" size={iconSize} />{label ? ` ${t('Preview')}` : null}
      </button>
      {captured && <BlobPreviewModal blob={captured.blob} filename={captured.filename} title={title} onClose={close} />}
    </>
  );
}

/** Preview of a file stored on the server. */
export default function FilePreviewButton({ path, format, title, className = 'btn btn-ghost btn-sm', iconSize = 16, label = false }) {
  const run = async () => {
    const res = await api.blob(path);
    if (typeof res?.blob !== 'function') throw new Error('The server did not return a file.');
    const ext = String(format || '').toLowerCase() || extOf(path);
    saveBlob(await res.blob(), `${String(path).split('/').pop().replace(/\.[^.]+$/, '') || 'file'}.${ext}`);
  };
  return <ActionPreviewButton run={run} title={title} className={className} iconSize={iconSize} label={label} />;
}

/** Preview of a public upload (chat attachments etc.) — plain fetch, no auth header sent. */
export function PublicFilePreviewButton({ url, filename, title, className = 'btn btn-ghost btn-sm', iconSize = 14, label = false }) {
  const run = async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    saveBlob(await res.blob(), filename || String(url).split('?')[0].split('/').pop() || 'file');
  };
  return <ActionPreviewButton run={run} title={title || filename} className={className} iconSize={iconSize} label={label} />;
}
