import { useEffect, useRef, useState } from 'react';
import { pdfjsAssetOptions } from '../../lib/pdfjsOptions';
import { burnWatermark } from '../../lib/sharedGuard';

const MAX_PDF_PAGES = 200;

/**
 * Image drawn into a <canvas> with the watermark burned into the pixels: there is no <img> to "Save image as", drag out
 * or open in a new tab, and the object URL used to decode it is revoked immediately.
 */
export function ProtectedImage({ blob, mark, onFail }) {
  const ref = useRef(null);
  useEffect(() => {
    let live = true;
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const c = ref.current;
      if (!live || !c) return;
      const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight, 1));
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      burnWatermark(c, mark);
    };
    img.onerror = () => { URL.revokeObjectURL(url); if (live) onFail?.(); };
    img.src = url;
    return () => { live = false; URL.revokeObjectURL(url); };
  }, [blob, mark]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className="shp-canvas" aria-label="" />;
}

/** PDF pages drawn to canvases (no text layer, no embedded viewer, no download button), rendered lazily as they scroll in. */
export function ProtectedPdf({ blob, mark, onFail }) {
  const hostRef = useRef(null);
  const [pages, setPages] = useState(0);
  const [ratio, setRatio] = useState(1.414);
  const docRef = useRef(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), ...pdfjsAssetOptions }).promise;
        if (!live) { pdf.destroy?.(); return; }
        docRef.current = pdf;
        const first = await pdf.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        if (!live) return;
        setRatio(vp.height / vp.width);
        setPages(Math.min(pdf.numPages, MAX_PDF_PAGES));
      } catch { if (live) onFail?.(); }
    })();
    return () => { live = false; try { docRef.current?.destroy?.(); } catch { /* ignore */ } docRef.current = null; };
  }, [blob]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const host = hostRef.current;
    const pdf = docRef.current;
    if (!host || !pdf || !pages) return undefined;
    let live = true;
    const done = new Set();
    const io = new IntersectionObserver((entries) => {
      entries.forEach(async (en) => {
        if (!en.isIntersecting) return;
        const canvas = en.target;
        const n = Number(canvas.dataset.page);
        if (done.has(n)) return;
        done.add(n);
        io.unobserve(canvas);
        try {
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          let k = Math.max(canvas.clientWidth * dpr, 1100) / base.width;
          k = Math.min(k, Math.sqrt(4e6 / (base.width * base.height)));
          const viewport = page.getViewport({ scale: k });
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
          if (live) { burnWatermark(canvas, mark); canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`; canvas.classList.add('is-ready'); }
        } catch { /* a page that fails to draw stays blank */ }
      });
    }, { rootMargin: '600px 0px' });
    host.querySelectorAll('canvas').forEach((c) => io.observe(c));
    return () => { live = false; io.disconnect(); };
  }, [pages, mark]);

  return (
    <div className="shp-pdf" ref={hostRef}>
      {pages === 0 && <span className="lp2-spinner" aria-hidden="true" />}
      {Array.from({ length: pages }, (_, i) => (
        <canvas key={i} data-page={i + 1} className="shp-canvas shp-canvas--page" style={{ aspectRatio: `1 / ${ratio}` }} />
      ))}
    </div>
  );
}
