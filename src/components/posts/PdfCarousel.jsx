import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { fetchMediaBlob, mediaBaseOf, useMediaUrl } from '../../lib/postMedia';
import { pdfjsAssetOptions } from '../../lib/pdfjsOptions';
import useNearScreen from '../../lib/useNearScreen';

const AUTO_MAX_BYTES = 25 * 1024 * 1024; // no server thumbnail: the first page is drawn in the browser instead (up to this size)

/**
 * PDF / converted presentation shown as a swipeable carousel (LinkedIn-style document post).
 * Cover = server thumbnail (cheap). The PDF itself is only downloaded once the reader presses the cover or arrows;
 * pages are drawn lazily (current ± 1) with pdf.js into canvases. Scroll-snap = native swipe on touch, arrows + keys on desktop.
 */
export default function PdfCarousel({ media, previewOf = false, onOpenFull, onDownload }) {
  const { locale } = useLanguage();
  const tt = (en, ar) => (locale === 'ar' ? ar : en);
  const rtl = locale === 'ar';
  const [started, setStarted] = useState(false);
  const { ref: wrapRef, seen } = useNearScreen();
  const hasCover = !!media.urls?.thumbnail;
  // No server thumbnail (poppler missing / old upload): open the document by itself when it scrolls into view, so page 1 is the cover
  // instead of a grey placeholder with a play icon.
  useEffect(() => { if (seen && !hasCover && !started && (Number(media.size_bytes) || 0) <= AUTO_MAX_BYTES) setStarted(true); }, [seen, hasCover, started, media.size_bytes]);
  const [pages, setPages] = useState(media.page_count || 0);
  const [idx, setIdx] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const pdfRef = useRef(null);
  const railRef = useRef(null);
  const drawn = useRef(new Set());
  const cover = useMediaUrl(media, 'thumbnail');
  const src = previewOf || media.has_preview ? 'preview' : 'file';

  const load = useCallback(async () => {
    if (pdfRef.current || busy) return;
    setBusy(true); setErr('');
    try {
      const blob = await fetchMediaBlob(media.id, src, mediaBaseOf(media));
      const pdfjs = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      pdfRef.current = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), ...pdfjsAssetOptions }).promise;
      setPages(pdfRef.current.numPages);
    } catch {
      setErr(tt('Could not open this document.', 'تعذّر فتح المستند.'));
    } finally { setBusy(false); }
  }, [media.id, src, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const draw = useCallback(async (n) => {
    const pdf = pdfRef.current;
    const slide = railRef.current?.querySelector(`[data-page="${n}"] canvas`);
    if (!pdf || !slide || drawn.current.has(n) || n < 1 || n > pdf.numPages) return;
    drawn.current.add(n);
    try {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const k = Math.min(1600 / base.width, Math.sqrt(3e6 / (base.width * base.height)));
      const vp = page.getViewport({ scale: k });
      slide.width = Math.floor(vp.width); slide.height = Math.floor(vp.height);
      await page.render({ canvas: slide, canvasContext: slide.getContext('2d'), viewport: vp }).promise;
      slide.dataset.ready = '1';
    } catch { drawn.current.delete(n); }
  }, []);

  useEffect(() => { if (started) load(); }, [started, load]);
  useEffect(() => {
    if (!started || !pdfRef.current) return;
    [idx, idx + 1, idx + 2, idx + 3].forEach(draw);
  }, [started, idx, pages, draw]);
  useEffect(() => () => { try { pdfRef.current?.destroy?.(); } catch { /* ignore */ } pdfRef.current = null; }, []);

  const go = (n) => {
    const total = pages || 1;
    const next = Math.max(0, Math.min(total - 1, n));
    const el = railRef.current?.children[next];
    if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    setIdx(next);
  };
  const onScroll = () => {
    const r = railRef.current; if (!r || !r.clientWidth) return;
    const i = Math.round(Math.abs(r.scrollLeft) / r.clientWidth);
    if (i !== idx) setIdx(i);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + (rtl ? -1 : 1)); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx + (rtl ? 1 : -1)); }
  };

  const total = pages || media.page_count || 0;
  const prevIcon = rtl ? 'chevron-right' : 'chevron-left';
  const nextIcon = rtl ? 'chevron-left' : 'chevron-right';

  if (!started) {
    return (
      <div ref={wrapRef}>
        <button type="button" className="pp-doc pp-doc--cover" onClick={() => setStarted(true)} aria-label={tt('Open document', 'افتح المستند')}>
          {cover.url ? <img src={cover.url} alt={media.alt_text || media.original_name} loading="lazy" /> : <span className="pp-doc__ph"><Icon name="file" size={44} /></span>}
          <span className="pp-doc__badge"><Icon name="file" size={14} /> {media.original_name}{total ? ` · ${total} ${tt('pages', 'صفحة')}` : ''}</span>
          <span className="pp-doc__open"><Icon name="eye" size={14} /> {tt('View', 'عرض')}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="pp-doc" ref={wrapRef} tabIndex={0} onKeyDown={onKey} role="region" aria-label={media.original_name}>
      <div className="pp-doc__rail" ref={railRef} onScroll={onScroll}>
        {Array.from({ length: Math.max(total, 1) }, (_, i) => (
          <div key={i} className="pp-doc__slide" data-page={i + 1}>
            <canvas aria-label={`${tt('Page', 'صفحة')} ${i + 1}`} />
            {busy && i === 0 && <span className="pp-doc__spin" />}
          </div>
        ))}
      </div>
      {err && <p className="pp-doc__err">{err}</p>}
      {total > 1 && (
        <>
          <button type="button" className="pp-doc__nav is-prev" onClick={() => go(idx - 1)} disabled={idx === 0} aria-label={tt('Previous page', 'الصفحة السابقة')}><Icon name={prevIcon} size={20} /></button>
          <button type="button" className="pp-doc__nav is-next" onClick={() => go(idx + 1)} disabled={idx >= total - 1} aria-label={tt('Next page', 'الصفحة التالية')}><Icon name={nextIcon} size={20} /></button>
        </>
      )}
      <div className="pp-doc__bar">
        <span>{idx + 1} / {total || '…'}</span>
        <div className="pp-doc__dots" aria-hidden="true">
          {total > 1 && total <= 14 && Array.from({ length: total }, (_, i) => <i key={i} className={i === idx ? 'is-on' : ''} />)}
        </div>
        {onDownload && <button type="button" className="pp-doc__full" onClick={onDownload} title={tt('Download', 'تنزيل')}><Icon name="download" size={15} /></button>}
        {onOpenFull && <button type="button" className="pp-doc__full" onClick={() => onOpenFull(media, idx)} title={tt('Full screen', 'ملء الشاشة')}><Icon name="maximize" size={15} /></button>}
      </div>
    </div>
  );
}
