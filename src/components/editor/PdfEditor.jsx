import useAutoDraft, { DraftChip } from '../../lib/useAutoDraft';
import { afterGuard, askUnsaved } from '../../lib/saveCenter';
import { discardDraft } from '../../lib/draftStore';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import AnnotSurface from './AnnotSurface';
import { Btn, PropsPanel, SignaturePad, Toolbar, useEditorKeys } from './EditorUI';
import useHistory from './useHistory';
import { pdfTextBoxes, replacementObjs, sampleColors } from './textedit';
import {
  DEFAULT_STYLE, applyStyle, clampN, cloneObj, fileToDataURL, loadImageEl, moveObj, renderOverlay, rotateObj90, uid,
} from './annot';
import '../../styles/css/editor.css';
import { pdfjsAssetOptions } from '../../lib/pdfjsOptions';

const dims = (pg) => (pg.rot % 180 ? { W: pg.h0, H: pg.w0 } : { W: pg.w0, H: pg.h0 });
const MAX_RENDER = 3.2;
const QUALITY_LEVELS = [{ maxPx: 4096, q: 0.95 }, { maxPx: 2800, q: 0.92 }, { maxPx: 2000, q: 0.88 }, { maxPx: 1400, q: 0.82 }, { maxPx: 1000, q: 0.75 }];
const MAX_UPLOAD = 4.4 * 1024 * 1024; // Vercel functions reject request bodies over 4.5 MB (HTTP 413)

/** Decode a data: URL without fetch() — the site's CSP (connect-src 'self') blocks fetch() of data: URLs. */
function dataUrlBytes(src) {
  const comma = src.indexOf(',');
  const head = src.slice(0, comma);
  const body = src.slice(comma + 1);
  const bin = /;base64/i.test(head) ? atob(body) : decodeURIComponent(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Embed a picture (data URL) into the output PDF at full quality first (long side capped at `maxPx`, JPEG `quality` when
 * it has no transparency). doSave() retries with the next, lower level only when the PDF would exceed the upload limit.
 * The API sits on Vercel, which rejects request bodies over 4.5 MB with a 413.
 */
async function embedPicture(doc, src, maxPx, quality) {
  try {
    const bytes = dataUrlBytes(src);
    const el = await loadImageEl(src);
    const nw = el.naturalWidth || 1; const nh = el.naturalHeight || 1;
    const scale = Math.min(1, maxPx / Math.max(nw, nh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(nw * scale)); c.height = Math.max(1, Math.round(nh * scale));
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(el, 0, 0, c.width, c.height);
    let hasAlpha = false;
    const px = g.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 255) { hasAlpha = true; break; }
    const blob = await new Promise((res) => c.toBlob(res, hasAlpha ? 'image/png' : 'image/jpeg', quality));
    if (blob) {
      const out = new Uint8Array(await blob.arrayBuffer());
      // Keep the original bytes only when nothing was shrunk and re-encoding did not help.
      if (scale < 1 || out.length < bytes.length) return hasAlpha ? await doc.embedPng(out) : await doc.embedJpg(out);
    }
    const mime = (/^data:([^;,]+)/.exec(src)?.[1] || '').toLowerCase();
    if (mime === 'image/jpeg' || mime === 'image/jpg') return await doc.embedJpg(bytes);
    return await doc.embedPng(bytes);
  } catch (e) { console.error('[pdf-editor] could not embed picture', e); return null; }
}

// pdf.js 6 uses the newest Map helpers; older browsers (and the Android WebView) need them filled in.
function polyfillMaps() {
  [Map, WeakMap].forEach((C) => {
    if (!C.prototype.getOrInsert) C.prototype.getOrInsert = function getOrInsert(k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); };
    if (!C.prototype.getOrInsertComputed) C.prototype.getOrInsertComputed = function getOrInsertComputed(k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); };
  });
}

async function loadPdfjs() {
  polyfillMaps();
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

/** Lazy visibility: true while the element is within `margin` of the viewport. */
function useNear(ref, margin, initial = false) {
  const [near, setNear] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setNear(true); return undefined; }
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return near;
}

/** Draws one page of the source PDF (or a blank sheet) into `canvasRef` at `renderScale` px per point. */
function usePageRender(canvasRef, pdf, pg, renderScale, active) {
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return undefined;
    if (!active) { c.width = 1; c.height = 1; return undefined; }
    let dead = false;
    let task = null;
    (async () => {
      const { W, H } = dims(pg);
      if (pg.src == null) {
        c.width = Math.max(1, Math.round(W * renderScale)); c.height = Math.max(1, Math.round(H * renderScale));
        const x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
        return;
      }
      const page = await pdf.getPage(pg.src + 1);
      if (dead) return;
      const vp = page.getViewport({ scale: renderScale, rotation: (pg.ibase + pg.rot) % 360 });
      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.floor(vp.width)); off.height = Math.max(1, Math.floor(vp.height));
      task = page.render({ canvas: off, canvasContext: off.getContext('2d'), viewport: vp });
      await task.promise;
      if (dead) return;
      c.width = off.width; c.height = off.height;
      c.getContext('2d').drawImage(off, 0, 0);
    })().catch((e) => { if (!dead && e?.name !== 'RenderingCancelledException') console.error("pdf page render failed", e); });
    return () => { dead = true; try { task?.cancel(); } catch { /* ignore */ } };
  }, [canvasRef, pdf, pg.src, pg.rot, pg.ibase, pg.w0, pg.h0, renderScale, active]); // eslint-disable-line react-hooks/exhaustive-deps
}

const PageView = memo(function PageView({ pg, index, pdf, scale, tool, style, selId, onSelect, onObjs, onToolChange, onActivate, setEl, loadBoxes, onEditText, autoEditId, onAutoEdit, tt }) {
  const { W, H } = dims(pg);
  const wrap = useRef(null);
  const canvas = useRef(null);
  const near = useNear(wrap, '1400px 0px', index < 2);
  const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  usePageRender(canvas, pdf, pg, Math.min(scale * dpr, MAX_RENDER), near);
  useEffect(() => { setEl(pg.id, wrap.current); return () => setEl(pg.id, null); }, [pg.id, setEl]);
  // real text of the page (only needed while the "Edit text" tool is active)
  const [boxes, setBoxes] = useState(null);
  const [used, setUsed] = useState(() => new Set());
  useEffect(() => {
    if (tool !== 'edittext' || !near) return undefined;
    let dead = false;
    setBoxes(null);
    loadBoxes(pg).then((b) => { if (!dead) setBoxes(b); }).catch(() => { if (!dead) setBoxes([]); });
    return () => { dead = true; };
  }, [tool, near, pg.src, pg.rot, pg.ibase, loadBoxes]); // eslint-disable-line react-hooks/exhaustive-deps
  const editing = tool === 'edittext';
  return (
    <div ref={wrap} className="ed__pdfpage" data-page={pg.id} style={{ width: W * scale, height: H * scale }}>
      <canvas ref={canvas} className="ed__pdfcanvas" style={{ width: W * scale, height: H * scale }} />
      <div className="ed__pdfover">
        <AnnotSurface
          objs={pg.objs}
          onChange={(next, meta) => onObjs(pg.id, next, meta)}
          width={W}
          height={H}
          scale={scale}
          tool={editing ? 'none' : tool}
          style={style}
          selId={selId}
          onSelect={(id) => onSelect(pg.id, id)}
          onToolChange={onToolChange}
          onActivate={() => onActivate(pg.id)}
          autoEditId={autoEditId}
          onAutoEdit={onAutoEdit}
        />
        {editing && boxes && boxes.filter((b) => !used.has(b.id)).map((b) => (
          <button
            key={b.id}
            type="button"
            className="ed__tbox"
            title={b.str}
            aria-label={b.str}
            style={{ left: b.cover.x * scale, top: b.cover.y * scale, width: b.cover.w * scale, height: b.cover.h * scale }}
            onClick={() => { setUsed((u) => new Set(u).add(b.id)); onEditText(pg, b, canvas.current); }}
          />
        ))}
        {editing && boxes && boxes.length === 0 && pg.src != null && <span className="ed__notext">{tt('No selectable text on this page (a scanned page?)', 'مفيش نص قابل للتحديد في الصفحة دي (صفحة ممسوحة ضوئياً؟)')}</span>}
      </div>
      <span className="ed__pageno">{index + 1}</span>
    </div>
  );
});

function Thumb({ pg, index, total, pdf, current, onGo, ops, tt }) {
  const { W, H } = dims(pg);
  const w = 112;
  const t = w / W;
  const wrap = useRef(null);
  const canvas = useRef(null);
  const near = useNear(wrap, '500px 0px', index < 8);
  usePageRender(canvas, pdf, pg, t * 1.5, near);
  return (
    <div ref={wrap} className={`ed__thumb${current ? ' is-on' : ''}`}>
      <button type="button" className="ed__thumb-pg" onClick={onGo} aria-label={`${tt('Page', 'صفحة')} ${index + 1}`} style={{ width: w, height: Math.max(40, H * t) }}>
        <canvas ref={canvas} style={{ width: w, height: Math.max(40, H * t) }} />
        {pg.objs.length > 0 && <i className="ed__thumb-dot" title={tt('Has edits', 'فيها تعديلات')} />}
      </button>
      <span className="ed__thumb-no">{index + 1}</span>
      <div className="ed__thumb-ops">
        <button type="button" onClick={() => ops.rot(index, false)} title={tt('Rotate left', 'تدوير لليسار')} aria-label={tt('Rotate left', 'تدوير لليسار')}><Icon name="ed-rotate-ccw" size={14} /></button>
        <button type="button" onClick={() => ops.rot(index, true)} title={tt('Rotate right', 'تدوير لليمين')} aria-label={tt('Rotate right', 'تدوير لليمين')}><Icon name="ed-rotate-cw" size={14} /></button>
        <button type="button" onClick={() => ops.dup(index)} title={tt('Duplicate page', 'تكرار الصفحة')} aria-label={tt('Duplicate page', 'تكرار الصفحة')}><Icon name="copy" size={14} /></button>
        <button type="button" onClick={() => ops.blank(index)} title={tt('Insert blank page after', 'إدراج صفحة فارغة بعدها')} aria-label={tt('Insert blank page after', 'إدراج صفحة فارغة بعدها')}><Icon name="ed-page-plus" size={14} /></button>
        <button type="button" onClick={() => ops.move(index, -1)} disabled={index === 0} title={tt('Move up', 'تحريك لأعلى')} aria-label={tt('Move up', 'تحريك لأعلى')}><Icon name="arrow-up" size={14} /></button>
        <button type="button" onClick={() => ops.move(index, 1)} disabled={index === total - 1} title={tt('Move down', 'تحريك لأسفل')} aria-label={tt('Move down', 'تحريك لأسفل')}><Icon name="arrow-down" size={14} /></button>
        <button type="button" className="is-danger" onClick={() => ops.del(index)} disabled={total <= 1} title={tt('Delete page', 'حذف الصفحة')} aria-label={tt('Delete page', 'حذف الصفحة')}><Icon name="trash" size={14} /></button>
      </div>
    </div>
  );
}

export default function PdfEditor({ blob, fileName, tt, rtl, guardRef, onSave, onClose, draftKey, startDirty = false }) {
  const hist = useHistory(null, startDirty);
  const pages = hist.present?.pages || [];
  const [status, setStatus] = useState('loading');
  const [loadErr, setLoadErr] = useState('');
  const [pdf, setPdf] = useState(null);
  const bytesRef = useRef(null);
  const [tool, setTool] = useState('select');
  const [style, setStyle] = useState(DEFAULT_STYLE);
  const [sel, setSel] = useState({ page: null, id: null });
  const [zoom, setZoom] = useState(1);
  const [boxW, setBoxW] = useState(800);
  const [cur, setCur] = useState(0);
  const [showThumbs, setShowThumbs] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth > 900));
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [conflict, setConflict] = useState(false);
  const [sign, setSign] = useState(false);
  const stageRef = useRef(null);
  const els = useRef(new Map());
  const pdfRef = useRef(null);
  pdfRef.current = pdf;
  const textCache = useRef(new Map());
  const [autoEdit, setAutoEdit] = useState({ page: null, id: null });
  const fileRef = useRef(null);

  /* ───────── load ───────── */
  useEffect(() => {
    let dead = false;
    let doc = null;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        bytesRef.current = bytes;
        doc = await pdfjs.getDocument({ data: bytes.slice(), ...pdfjsAssetOptions }).promise;
        const list = [];
        for (let n = 1; n <= doc.numPages; n += 1) {
          // eslint-disable-next-line no-await-in-loop
          const page = await doc.getPage(n);
          const vp = page.getViewport({ scale: 1 });
          list.push({ id: uid(), src: n - 1, ibase: page.rotate || 0, w0: vp.width, h0: vp.height, rot: 0, objs: [] });
          if (dead) return;
        }
        hist.reset({ pages: list });
        setPdf(doc);
        setStatus('ready');
      } catch (e) {
        if (dead) return;
        setLoadErr(/password/i.test(e?.name || e?.message || '') ? tt('This PDF is password-protected and cannot be edited.', 'الـ PDF ده محمي بكلمة سر ومينفعش يتعدّل.') : (e?.message || String(e)));
        setStatus('error');
      }
    })();
    return () => { dead = true; try { doc?.destroy?.(); } catch { /* ignore */ } };
  }, [blob]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status !== 'ready') return undefined;
    const el = stageRef.current;
    const upd = () => setBoxW(el.clientWidth);
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, [status, showThumbs]);

  const maxW = Math.max(1, ...pages.map((p) => dims(p).W));
  const fit = clampN((boxW - 40) / maxW, 0.25, 3);
  const scale = fit * zoom;

  const setEl = useCallback((id, el) => { if (el) els.current.set(id, el); else els.current.delete(id); }, []);
  const onScroll = useCallback(() => {
    const st = stageRef.current;
    if (!st) return;
    const mid = st.scrollTop + st.clientHeight * 0.35;
    let best = 0;
    pages.forEach((p, i) => { const el = els.current.get(p.id); if (el && el.offsetTop <= mid) best = i; });
    setCur(best);
  }, [pages]);
  const goTo = (i) => { const el = els.current.get(pages[i]?.id); if (el && stageRef.current) { stageRef.current.scrollTo({ top: el.offsetTop - 16, behavior: 'smooth' }); setCur(i); } };

  /* ───────── object edits ───────── */
  const mapPage = (id, fn) => (p) => ({ ...p, pages: p.pages.map((pg) => (pg.id === id ? fn(pg) : pg)) });
  const histRef = useRef(hist);
  histRef.current = hist;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const onObjs = useCallback((pageId, next, meta) => {
    const h = histRef.current;
    h.live(mapPage(pageId, (pg) => ({ ...pg, objs: next })));
    if (meta?.commit) h.commit(mapPage(pageId, (pg) => ({ ...pg, objs: meta.from })));
  }, []);
  const loadBoxes = useCallback(async (pg) => {
    if (pg.src == null || !pdfRef.current) return [];
    const rot = (pg.ibase + pg.rot) % 360;
    const key = `${pg.src}:${rot}`;
    let p = textCache.current.get(key);
    if (!p) { p = pdfRef.current.getPage(pg.src + 1).then((page) => pdfTextBoxes(page, rot)); textCache.current.set(key, p); }
    return p;
  }, []);
  const onEditText = useCallback((pg, box, canvasEl) => {
    const { W } = dims(pg);
    const k = canvasEl && canvasEl.width > 4 ? canvasEl.width / W : 0;
    const colors = k ? sampleColors(canvasEl, { x: box.cover.x * k, y: box.cover.y * k, w: box.cover.w * k, h: box.cover.h * k }) : { bg: '#ffffff', fg: '#000000' };
    const [cover, text] = replacementObjs(box, colors);
    histRef.current.push(mapPage(pg.id, (p) => ({ ...p, objs: [...p.objs, cover, text] })));
    setSel({ page: pg.id, id: text.id });
    setTool('select');
    setAutoEdit({ page: pg.id, id: text.id });
  }, []);
  const onAutoEdit = useCallback(() => setAutoEdit({ page: null, id: null }), []);
  const onSelect = useCallback((pageId, id) => setSel(id ? { page: pageId, id } : { page: null, id: null }), []);
  const onActivate = useCallback((pageId) => { const i = pagesRef.current.findIndex((p) => p.id === pageId); if (i >= 0) setCur(i); }, []);

  const selPage = pages.find((p) => p.id === sel.page);
  const selObj = selPage?.objs.find((o) => o.id === sel.id) || null;
  const editSel = (fn) => hist.debounced(mapPage(sel.page, (pg) => ({ ...pg, objs: pg.objs.map((o) => (o.id === sel.id ? fn(o) : o)) })));
  const updateSel = (patch) => { if (selObj) editSel((o) => applyStyle(o, patch)); };
  const delSel = () => { if (!selObj) return; hist.push(mapPage(sel.page, (pg) => ({ ...pg, objs: pg.objs.filter((o) => o.id !== sel.id) }))); setSel({ page: null, id: null }); };
  const dupSel = () => {
    if (!selObj) return;
    const n = moveObj(cloneObj(selObj), 14, 14);
    hist.push(mapPage(sel.page, (pg) => ({ ...pg, objs: [...pg.objs, n] })));
    setSel({ page: sel.page, id: n.id });
  };
  const order = (front) => {
    if (!selObj) return;
    hist.push(mapPage(sel.page, (pg) => ({ ...pg, objs: front ? [...pg.objs.filter((o) => o.id !== sel.id), selObj] : [selObj, ...pg.objs.filter((o) => o.id !== sel.id)] })));
  };

  const placeImage = (src, iw, ih) => {
    const pg = pages[cur];
    if (!pg) return;
    const { W, H } = dims(pg);
    const k = Math.min(1, (W * 0.35) / iw, (H * 0.25) / ih);
    const w = iw * k; const h = ih * k;
    const n = { id: uid(), type: 'image', src, x: (W - w) / 2, y: (H - h) / 2, w, h, rot: 0, alpha: 1 };
    hist.push(mapPage(pg.id, (p) => ({ ...p, objs: [...p.objs, n] })));
    setSel({ page: pg.id, id: n.id });
    setTool('select');
  };
  const addFile = async (file) => {
    if (!file) return;
    try { const src = await fileToDataURL(file); const im = await loadImageEl(src); placeImage(src, im.naturalWidth, im.naturalHeight); } catch (e) { setSaveErr(e.message); }
  };

  /* ───────── page operations ───────── */
  const ops = {
    rot: (i, cw) => hist.push((p) => ({
      pages: p.pages.map((pg, j) => {
        if (j !== i) return pg;
        const { W, H } = dims(pg);
        return { ...pg, rot: (pg.rot + (cw ? 90 : 270)) % 360, objs: pg.objs.map((o) => rotateObj90(o, W, H, cw)) };
      }),
    })),
    del: (i) => { if (pages.length <= 1) return; hist.push((p) => ({ pages: p.pages.filter((_, j) => j !== i) })); setSel({ page: null, id: null }); },
    dup: (i) => hist.push((p) => {
      const pg = p.pages[i];
      const copy = { ...pg, id: uid(), objs: pg.objs.map(cloneObj) };
      return { pages: [...p.pages.slice(0, i + 1), copy, ...p.pages.slice(i + 1)] };
    }),
    blank: (i) => hist.push((p) => {
      const { W, H } = dims(p.pages[i]);
      const blank = { id: uid(), src: null, ibase: 0, w0: W, h0: H, rot: 0, objs: [] };
      return { pages: [...p.pages.slice(0, i + 1), blank, ...p.pages.slice(i + 1)] };
    }),
    move: (i, d) => hist.push((p) => {
      const j = i + d;
      if (j < 0 || j >= p.pages.length) return p;
      const arr = [...p.pages];
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { pages: arr };
    }),
  };

  /* ───────── export / save ───────── */
  const buildPdf = async (level = 0) => {
    const { maxPx, q } = QUALITY_LEVELS[Math.min(level, QUALITY_LEVELS.length - 1)];
    hist.flush();
    const { PDFDocument, degrees } = await import('pdf-lib');
    const src = await PDFDocument.load(bytesRef.current, { ignoreEncryption: true });
    const out = await PDFDocument.create();
    const real = pages.filter((p) => p.src != null);
    const copied = real.length ? await out.copyPages(src, real.map((p) => p.src)) : [];
    let ci = 0;
    for (const pg of pages) {
      const page = out.addPage(pg.src == null ? [pg.w0, pg.h0] : copied[ci++]);
      const total = (((pg.src == null ? 0 : page.getRotation().angle) + pg.rot) % 360 + 360) % 360;
      page.setRotation(degrees(total));
      if (pg.objs.length) {
        const cb = page.getCropBox();
        const odd = total % 180 !== 0;
        const Wd = odd ? cb.height : cb.width;
        const Hd = odd ? cb.width : cb.height;
        const { W, H } = dims(pg);
        const s = Wd / W; // PDF points per view unit
        const origin = { 0: [cb.x, cb.y], 90: [cb.x + cb.width, cb.y], 180: [cb.x + cb.width, cb.y + cb.height], 270: [cb.x, cb.y + cb.height] }[total];
        const th = (total * Math.PI) / 180;
        // view space (y down) -> unrotated page space (y up)
        const toPdf = (vx, vy) => {
          const u = vx * s; const v = Hd - vy * s;
          return [origin[0] + u * Math.cos(th) - v * Math.sin(th), origin[1] + u * Math.sin(th) + v * Math.cos(th)];
        };
        // High-resolution raster for everything that is not a picture (text, shapes, ink): ~4x, capped by canvas limits.
        const k = Math.max(1, Math.min(4 * s, Math.sqrt(16e6 / (W * H)), 8192 / Math.max(W, H)));
        let run = [];
        const flushRun = async () => {
          if (!run.length) return;
          const overlay = await renderOverlay(run, W, H, k);
          const png = await new Promise((res) => overlay.toBlob(res, 'image/png'));
          const img = await out.embedPng(new Uint8Array(await png.arrayBuffer()));
          page.drawImage(img, { x: origin[0], y: origin[1], width: Wd, height: Hd, rotate: degrees(total) });
          run = [];
        };
        for (const o of pg.objs) {
          if (o.type !== 'image') { run.push(o); continue; }
          // Pictures are embedded at their ORIGINAL resolution (not flattened into the page raster), keeping z-order.
          // eslint-disable-next-line no-await-in-loop
          await flushRun();
          // eslint-disable-next-line no-await-in-loop
          const img = await embedPicture(out, o.src, maxPx, q);
          if (!img) throw new Error('Could not embed a picture into the PDF.');
          const r = ((o.rot || 0) * Math.PI) / 180;
          const [bx, by] = toPdf(o.x - o.h * Math.sin(r), o.y + o.h * Math.cos(r)); // bottom-left corner of the picture
          page.drawImage(img, { x: bx, y: by, width: o.w * s, height: o.h * s, rotate: degrees(total - (o.rot || 0)), opacity: o.alpha ?? 1 });
        }
        // eslint-disable-next-line no-await-in-loop
        await flushRun();
      }
    }
    const bytes = await out.save();
    return new Blob([bytes], { type: 'application/pdf' });
  };
  const doSave = async (force) => {
    if (saving) return false;
    if (!hist.dirty) return true;
    setSaving(true); setSaveErr(''); setConflict(false);
    try {
      let out = await buildPdf(0);
      // Only lower the picture quality as far as needed to fit the upload limit.
      for (let lv = 1; out.size > MAX_UPLOAD && lv < QUALITY_LEVELS.length; lv += 1) out = await buildPdf(lv); // eslint-disable-line no-await-in-loop
      if (out.size > MAX_UPLOAD) {
        throw new Error(tt(`The edited PDF is ${(out.size / 1048576).toFixed(1)} MB; the server accepts at most 4.5 MB. Use a smaller picture or remove some content.`, `حجم الـ PDF بعد التعديل ${(out.size / 1048576).toFixed(1)} ميجا والسيرفر بيقبل 4.5 ميجا بالكتير. استخدم صورة أصغر أو شيل جزء من المحتوى.`));
      }
      await onSave(out, { name: fileName, force: force === true });
      return true;
    } catch (e) {
      if (e?.status === 409) setConflict(true); else setSaveErr(e?.message || String(e));
      return false;
    } finally { setSaving(false); }
  };
  const saveRef = useRef(null); saveRef.current = () => doSave(false);
  const download = async () => {
    try {
      const out = await buildPdf();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(out);
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { setSaveErr(e.message); }
  };

  const dirty = hist.dirty;
  const draft = useAutoDraft({ draftKey, dirty, token: hist.present, build: () => (hist.present ? buildPdf(0) : null), meta: { name: fileName }, saver: () => saveRef.current?.() });
  const askLeave = () => askUnsaved({ key: draftKey, name: fileName, tt, discard: () => discardDraft(draftKey) });
  useEffect(() => {
    if (!guardRef) return undefined;
    guardRef.current = () => !dirty || askLeave();
    return () => { guardRef.current = null; };
  }, [dirty, guardRef, tt]);
  const requestClose = () => afterGuard(dirty ? askLeave() : true, onClose);

  useEditorKeys({
    undo: hist.undo, redo: hist.redo, save: () => doSave(false), dup: dupSel, del: delSel,
    nudge: (dx, dy) => editSel((o) => moveObj(o, dx, dy)), hasSel: () => !!selObj,
    esc: () => { setSel({ page: null, id: null }); setTool('select'); },
  });

  if (status === 'loading') return <div className="ed ed--center"><span className="st-fv-spinner" /><p className="ed__hint">{tt('Opening the PDF…', 'جارٍ فتح الـ PDF…')}</p></div>;
  if (status === 'error') return <div className="ed ed--center"><p className="ed__err">{loadErr}</p><Btn label={tt('Close', 'إغلاق')} onClick={onClose} /></div>;

  const zoomTo = (z) => setZoom(clampN(z, 0.4, 4));

  return (
    <div className="ed ed--pdf" dir={rtl ? 'rtl' : 'ltr'}>
      <div className="ed__top">
        <Btn icon="x" label={tt('Cancel', 'إلغاء')} onClick={requestClose} />
        <strong className="ed__title" dir="auto">{fileName}</strong>
        <span className="ed__sp" />
        <Btn icon="ed-undo" onClick={hist.undo} disabled={!hist.canUndo} title={tt('Undo (Ctrl+Z)', 'تراجع (Ctrl+Z)')} />
        <Btn icon="ed-redo" onClick={hist.redo} disabled={!hist.canRedo} title={tt('Redo (Ctrl+Shift+Z)', 'إعادة (Ctrl+Shift+Z)')} />
        <span className="ed__sep" />
        <Btn icon="ed-minus" onClick={() => zoomTo(zoom / 1.2)} title={tt('Zoom out', 'تصغير')} />
        <button type="button" className="ed__btn ed__pct" onClick={() => setZoom(1)} title={tt('Fit width', 'ملاءمة العرض')}>{Math.round(scale * 100)}%</button>
        <Btn icon="plus" onClick={() => zoomTo(zoom * 1.2)} title={tt('Zoom in', 'تكبير')} />
        <span className="ed__pagecount">{cur + 1} / {pages.length}</span>
        <span className="ed__sp" />
        {conflict && (
          <span className="ed__warn">
            {tt('A newer version was saved by someone else.', 'حد تاني حفظ نسخة أحدث.')}
            <Btn label={tt('Save over it', 'احفظ فوقها')} onClick={() => doSave(true)} />
          </span>
        )}
        {saveErr && <span className="ed__err" title={saveErr}>{saveErr}</span>}
        <Btn icon="download" label={tt('Download', 'تنزيل')} onClick={download} />
        <DraftChip draft={draft} tt={tt} />
        <Btn icon="save" label={saving ? tt('Saving…', 'جارٍ الحفظ…') : tt('Save', 'حفظ')} onClick={() => doSave(false)} disabled={!dirty || saving} primary />
      </div>

      <Toolbar tools={['select', 'edittext', 'text', 'pen', 'highlight', 'line', 'arrow', 'rect', 'ellipse', 'whiteout', 'redact', 'eraser']} tool={tool} setTool={(t) => { setTool(t); if (t !== 'select') setSel({ page: null, id: null }); }} tt={tt}>
        <span className="ed__sep" />
        <button type="button" className="ed__tool" onClick={() => fileRef.current?.click()} title={tt('Add picture', 'إضافة صورة')}><Icon name="ed-image-plus" size={18} /><span>{tt('Picture', 'صورة')}</span></button>
        <button type="button" className="ed__tool" onClick={() => setSign(true)} title={tt('Signature', 'توقيع')}><Icon name="ed-sign" size={18} /><span>{tt('Signature', 'توقيع')}</span></button>
        <span className="ed__sep" />
        <button type="button" className={`ed__tool${showThumbs ? ' is-on' : ''}`} onClick={() => setShowThumbs((v) => !v)} title={tt('Pages', 'الصفحات')} aria-pressed={showThumbs}><Icon name="layers" size={18} /><span>{tt('Pages', 'الصفحات')}</span></button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { addFile(e.target.files?.[0]); e.target.value = ''; }} />
      </Toolbar>

      <div className="ed__body">
        {showThumbs && (
          <nav className="ed__thumbs" aria-label={tt('Pages', 'الصفحات')}>
            {pages.map((pg, i) => <Thumb key={pg.id} pg={pg} index={i} total={pages.length} pdf={pdf} current={i === cur} onGo={() => goTo(i)} ops={ops} tt={tt} />)}
          </nav>
        )}
        <div className="ed__stage ed__stage--pdf" ref={stageRef} onScroll={onScroll} onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomTo(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }}>
          {pages.map((pg, i) => (
            <PageView
              key={pg.id}
              pg={pg}
              index={i}
              pdf={pdf}
              scale={scale}
              tool={tool}
              style={style}
              selId={sel.page === pg.id ? sel.id : null}
              onSelect={onSelect}
              onObjs={onObjs}
              onToolChange={setTool}
              onActivate={onActivate}
              setEl={setEl}
              loadBoxes={loadBoxes}
              onEditText={onEditText}
              autoEditId={autoEdit.page === pg.id ? autoEdit.id : null}
              onAutoEdit={onAutoEdit}
              tt={tt}
            />
          ))}
        </div>
        <aside className="ed__side">
          <div className="ed__sidebody">
            <PropsPanel tool={tool} style={style} setStyle={setStyle} sel={selObj} updateSel={updateSel} actions={{ dup: dupSel, del: delSel, front: () => order(true), back: () => order(false) }} tt={tt} />
            <p className="ed__hint ed__hint--note">
              {tt('Tip: use Edit text, click any line of the page and retype it. Page tools (rotate, delete, reorder, blank page) are in the Pages panel.', 'تلميح: استخدم «تعديل النص»، اضغط على أي سطر في الصفحة وعدّله. أدوات الصفحات (تدوير، حذف، ترتيب، صفحة فارغة) في لوحة الصفحات.')}
            </p>
          </div>
        </aside>
      </div>
      {sign && <SignaturePad tt={tt} onCancel={() => setSign(false)} onDone={(src, w, h) => { setSign(false); placeImage(src, w, h); }} />}
    </div>
  );
}
