import useAutoDraft, { DraftChip } from '../../lib/useAutoDraft';
import { afterGuard, askUnsaved } from '../../lib/saveCenter';
import { discardDraft } from '../../lib/draftStore';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon';
import AnnotSurface from './AnnotSurface';
import { Btn, PropsPanel, Range, Section, SignaturePad, Toolbar, useEditorKeys } from './EditorUI';
import useHistory from './useHistory';
import { ocrBoxToText, ocrDispose, ocrLines, replacementObjs, sampleColors } from './textedit';
import {
  DEFAULT_STYLE, applyStyle, clampN, cloneObj, drawObjects, fileToDataURL, flipObj, loadImageEl, moveObj, rotateObj90, scaleObj, uid, whenImagesReady,
} from './annot';
import { extOf } from '../FilePreviewButton';
import '../../styles/css/editor.css';

const MAX_SIDE = 6000;
const DEFAULT_ADJ = { brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, gray: 0, sepia: 0, invert: 0 };
const PRESETS = [
  { id: 'orig', en: 'Original', ar: 'الأصلية', adj: {} },
  { id: 'bw', en: 'B&W', ar: 'أبيض وأسود', adj: { gray: 100, contrast: 112 } },
  { id: 'sepia', en: 'Sepia', ar: 'سيبيا', adj: { sepia: 85, contrast: 105 } },
  { id: 'vivid', en: 'Vivid', ar: 'حيوية', adj: { saturate: 150, contrast: 110 } },
  { id: 'warm', en: 'Warm', ar: 'دافئة', adj: { sepia: 25, saturate: 120, brightness: 104 } },
  { id: 'cool', en: 'Cool', ar: 'باردة', adj: { hue: 12, saturate: 110, brightness: 102 } },
  { id: 'fade', en: 'Fade', ar: 'باهتة', adj: { contrast: 86, brightness: 112, saturate: 80 } },
  { id: 'drama', en: 'Drama', ar: 'درامية', adj: { contrast: 145, saturate: 90, brightness: 92 } },
];
const ASPECTS = [
  { id: 'free', en: 'Free', ar: 'حر', r: 0 }, { id: 'orig', en: 'Original', ar: 'الأصلية', r: -1 },
  { id: '1:1', en: '1:1', ar: '1:1', r: 1 }, { id: '4:3', en: '4:3', ar: '4:3', r: 4 / 3 }, { id: '3:2', en: '3:2', ar: '3:2', r: 3 / 2 },
  { id: '16:9', en: '16:9', ar: '16:9', r: 16 / 9 }, { id: '3:4', en: '3:4', ar: '3:4', r: 3 / 4 }, { id: '9:16', en: '9:16', ar: '9:16', r: 9 / 16 },
];
const ADJ_SLIDERS = [
  ['brightness', 'Brightness', 'السطوع', 0, 200, '%'], ['contrast', 'Contrast', 'التباين', 0, 200, '%'], ['saturate', 'Saturation', 'التشبّع', 0, 200, '%'],
  ['hue', 'Hue', 'درجة اللون', -180, 180, '°'], ['blur', 'Blur', 'تمويه', 0, 20, 'px'], ['gray', 'Grayscale', 'تدرّج رمادي', 0, 100, '%'],
  ['sepia', 'Sepia', 'سيبيا', 0, 100, '%'], ['invert', 'Invert', 'عكس الألوان', 0, 100, '%'],
];
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const isDefaultAdj = (a) => Object.keys(DEFAULT_ADJ).every((k) => a[k] === DEFAULT_ADJ[k]);
const HAS_FILTER = (() => { try { return 'filter' in document.createElement('canvas').getContext('2d'); } catch { return false; } })();
const filterStr = (a) => `brightness(${a.brightness}%) contrast(${a.contrast}%) saturate(${a.saturate}%) hue-rotate(${a.hue}deg) grayscale(${a.gray}%) sepia(${a.sepia}%) invert(${a.invert}%)${a.blur ? ` blur(${a.blur}px)` : ''}`;

function pixelAdjust(ctx, w, h, a) {
  const im = ctx.getImageData(0, 0, w, h);
  const d = im.data;
  const b = a.brightness / 100; const c = a.contrast / 100; const s = a.saturate / 100; const g = a.gray / 100; const se = a.sepia / 100; const iv = a.invert / 100;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] * b; let gg = d[i + 1] * b; let bl = d[i + 2] * b;
    r = (r - 128) * c + 128; gg = (gg - 128) * c + 128; bl = (bl - 128) * c + 128;
    const l = 0.299 * r + 0.587 * gg + 0.114 * bl;
    r = l + (r - l) * s; gg = l + (gg - l) * s; bl = l + (bl - l) * s;
    if (g) { r += (l - r) * g; gg += (l - gg) * g; bl += (l - bl) * g; }
    if (se) {
      const tr = 0.393 * r + 0.769 * gg + 0.189 * bl; const tg = 0.349 * r + 0.686 * gg + 0.168 * bl; const tb = 0.272 * r + 0.534 * gg + 0.131 * bl;
      r += (tr - r) * se; gg += (tg - gg) * se; bl += (tb - bl) * se;
    }
    if (iv) { r += (255 - 2 * r) * iv; gg += (255 - 2 * gg) * iv; bl += (255 - 2 * bl) * iv; }
    d[i] = clampN(r, 0, 255); d[i + 1] = clampN(gg, 0, 255); d[i + 2] = clampN(bl, 0, 255);
  }
  ctx.putImageData(im, 0, 0);
}

function makeFiltered(base, adj) {
  if (isDefaultAdj(adj)) return base;
  const c = mk(base.width, base.height);
  const ctx = c.getContext('2d');
  if (HAS_FILTER) { ctx.filter = filterStr(adj); ctx.drawImage(base, 0, 0); } else { ctx.drawImage(base, 0, 0); pixelAdjust(ctx, c.width, c.height, adj); }
  return c;
}

function fitAspect(r, W, H) {
  if (W / H > r) return { x: (W - H * r) / 2, y: 0, w: H * r, h: H };
  return { x: 0, y: (H - W / r) / 2, w: W, h: W / r };
}

function dragCrop(r, id, dx, dy, W, H, aspect) {
  const MIN = 16;
  if (id === 'move') return { ...r, x: clampN(r.x + dx, 0, W - r.w), y: clampN(r.y + dy, 0, H - r.h) };
  let x1 = r.x; let y1 = r.y; let x2 = r.x + r.w; let y2 = r.y + r.h;
  if (id.includes('l')) x1 = clampN(x1 + dx, 0, x2 - MIN);
  if (id.includes('r')) x2 = clampN(x2 + dx, x1 + MIN, W);
  if (id.includes('t')) y1 = clampN(y1 + dy, 0, y2 - MIN);
  if (id.includes('b')) y2 = clampN(y2 + dy, y1 + MIN, H);
  if (aspect) {
    const horiz = id.includes('l') || id.includes('r');
    if (horiz) {
      const h = (x2 - x1) / aspect;
      if (id.includes('t')) y1 = y2 - h; else if (id.includes('b')) y2 = y1 + h; else { const cy = r.y + r.h / 2; y1 = cy - h / 2; y2 = cy + h / 2; }
    } else {
      const w = (y2 - y1) * aspect;
      const cx = r.x + r.w / 2;
      x1 = cx - w / 2; x2 = cx + w / 2;
    }
    if (x1 < -0.5 || y1 < -0.5 || x2 > W + 0.5 || y2 > H + 0.5) return r;
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function CropOverlay({ rect, setRect, aspect, imgW, imgH, scale }) {
  const drag = useRef(null);
  const start = (id) => (e) => { e.stopPropagation(); e.currentTarget.setPointerCapture?.(e.pointerId); drag.current = { id, x: e.clientX, y: e.clientY, rect: { ...rect } }; };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    setRect(dragCrop(d.rect, d.id, (e.clientX - d.x) / scale, (e.clientY - d.y) / scale, imgW, imgH, aspect));
  };
  const end = () => { drag.current = null; };
  const ev = (id) => ({ onPointerDown: start(id), onPointerMove: move, onPointerUp: end, onPointerCancel: end });
  return (
    <div className="ed__crop" style={{ left: rect.x * scale, top: rect.y * scale, width: rect.w * scale, height: rect.h * scale }} {...ev('move')}>
      {['tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br'].map((h) => <i key={h} className={`ed__crop-h ed__crop-h--${h}`} {...ev(h)} />)}
      <span className="ed__crop-size">{Math.round(rect.w)} × {Math.round(rect.h)}</span>
    </div>
  );
}

export default function ImageEditor({ blob, fileName, tt, rtl, guardRef, onSave, onClose, draftKey, startDirty = false }) {
  const hist = useHistory(null, startDirty);
  const present = hist.present;
  const [status, setStatus] = useState('loading');
  const [loadErr, setLoadErr] = useState('');
  const [tool, setTool] = useState('select');
  const [style, setStyle] = useState(DEFAULT_STYLE);
  const [selId, setSelId] = useState(null);
  const [tab, setTab] = useState('annotate');
  const [zoom, setZoom] = useState(1);
  const [box, setBox] = useState({ w: 800, h: 600 });
  const [cropping, setCropping] = useState(false);
  const [crop, setCrop] = useState(null);
  const [aspectId, setAspectId] = useState('free');
  const [fmt, setFmt] = useState('keep');
  const [quality, setQuality] = useState(92);
  const [resizeW, setResizeW] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [conflict, setConflict] = useState(false);
  const [sign, setSign] = useState(false);
  const [ocr, setOcr] = useState({ status: 'idle', progress: 0, label: '', lines: [], base: null, langs: '', error: '' });
  const [ocrLang, setOcrLang] = useState(rtl ? 'ara+eng' : 'eng');
  const [used, setUsed] = useState(() => new Set());
  const [autoEdit, setAutoEdit] = useState(null);
  const stageRef = useRef(null);
  const fileRef = useRef(null);
  const rootRef = useRef(null);

  const base = present?.base;
  const objs = present?.objs || [];
  const adj = present?.adj || DEFAULT_ADJ;
  const deferredAdj = useDeferredValue(adj);

  /* ───────── load ───────── */
  useEffect(() => {
    let dead = false;
    const url = URL.createObjectURL(blob);
    loadImageEl(url).then((im) => {
      if (dead) return;
      let w = im.naturalWidth || im.width || 1024; let h = im.naturalHeight || im.height || 768;
      const k = Math.min(1, MAX_SIDE / Math.max(w, h));
      w = Math.round(w * k); h = Math.round(h * k);
      const c = mk(w, h);
      c.getContext('2d').drawImage(im, 0, 0, w, h);
      hist.reset({ base: c, objs: [], adj: DEFAULT_ADJ });
      setStatus('ready');
    }).catch((e) => { if (!dead) { setLoadErr(e.message); setStatus('error'); } });
    return () => { dead = true; URL.revokeObjectURL(url); };
  }, [blob]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status !== 'ready') return undefined;
    const el = stageRef.current;
    const upd = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, [status]);

  const filtered = useMemo(() => (base ? makeFiltered(base, deferredAdj) : null), [base, deferredAdj]);
  const drawBase = useCallback((ctx) => { if (filtered) ctx.drawImage(filtered, 0, 0); }, [filtered]);
  const env = useMemo(() => ({ base: filtered }), [filtered]);

  const W = base?.width || 1; const H = base?.height || 1;
  const fit = Math.max(0.02, Math.min(2, (box.w - 40) / W, (box.h - 40) / H));
  const scale = fit * zoom;

  /* ───────── object edits ───────── */
  const onChange = useCallback((next, meta) => {
    hist.live((p) => ({ ...p, objs: next }));
    if (meta?.commit) hist.commit((p) => ({ ...p, objs: meta.from }));
  }, [hist]);

  const sel = objs.find((o) => o.id === selId) || null;
  const updateSel = (patch) => { if (selId) hist.debounced((p) => ({ ...p, objs: p.objs.map((o) => (o.id === selId ? applyStyle(o, patch) : o)) })); };
  const delSel = () => { if (!selId) return; hist.push((p) => ({ ...p, objs: p.objs.filter((o) => o.id !== selId) })); setSelId(null); };
  const dupSel = () => {
    if (!sel) return;
    const n = moveObj(cloneObj(sel), 16, 16);
    hist.push((p) => ({ ...p, objs: [...p.objs, n] }));
    setSelId(n.id);
  };
  const order = (front) => {
    if (!sel) return;
    hist.push((p) => ({ ...p, objs: front ? [...p.objs.filter((o) => o.id !== selId), sel] : [sel, ...p.objs.filter((o) => o.id !== selId)] }));
  };
  const nudge = (dx, dy) => { if (selId) hist.debounced((p) => ({ ...p, objs: p.objs.map((o) => (o.id === selId ? moveObj(o, dx, dy) : o)) })); };

  const placeImage = (src, iw, ih) => {
    const k = Math.min(1, (W * 0.4) / iw, (H * 0.4) / ih);
    const w = iw * k; const h = ih * k;
    const n = { id: uid(), type: 'image', src, x: (W - w) / 2, y: (H - h) / 2, w, h, rot: 0, alpha: 1 };
    hist.push((p) => ({ ...p, objs: [...p.objs, n] }));
    setSelId(n.id);
    setTool('select');
    setTab('annotate');
  };
  const addFile = async (file) => {
    if (!file) return;
    try { const src = await fileToDataURL(file); const im = await loadImageEl(src); placeImage(src, im.naturalWidth, im.naturalHeight); } catch (e) { setSaveErr(e.message); }
  };

  /* ───────── geometry ops (bake into the base picture) ───────── */
  const rotate = (cw) => {
    hist.push((p) => {
      const w = p.base.width; const h = p.base.height;
      const c = mk(h, w);
      const x = c.getContext('2d');
      x.translate(cw ? h : 0, cw ? 0 : w);
      x.rotate((cw ? 1 : -1) * (Math.PI / 2));
      x.drawImage(p.base, 0, 0);
      return { ...p, base: c, objs: p.objs.map((o) => rotateObj90(o, w, h, cw)) };
    });
    setSelId(null);
  };
  const flip = (axis) => {
    hist.push((p) => {
      const w = p.base.width; const h = p.base.height;
      const c = mk(w, h);
      const x = c.getContext('2d');
      if (axis === 'h') { x.translate(w, 0); x.scale(-1, 1); } else { x.translate(0, h); x.scale(1, -1); }
      x.drawImage(p.base, 0, 0);
      return { ...p, base: c, objs: p.objs.map((o) => flipObj(o, w, h, axis)) };
    });
    setSelId(null);
  };
  const resize = (nw) => {
    const w = clampN(Math.round(nw), 16, MAX_SIDE);
    if (!w || w === W) return;
    hist.push((p) => {
      const k = w / p.base.width;
      const h = Math.max(1, Math.round(p.base.height * k));
      const c = mk(w, h);
      const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.drawImage(p.base, 0, 0, w, h);
      return { ...p, base: c, objs: p.objs.map((o) => scaleObj(o, w / p.base.width, h / p.base.height)) };
    });
    setSelId(null);
    setResizeW('');
  };
  const startCrop = () => { setTool('select'); setSelId(null); setCropping(true); setCrop({ x: W * 0.08, y: H * 0.08, w: W * 0.84, h: H * 0.84 }); setAspectId('free'); };
  const cancelCrop = useCallback(() => { setCropping(false); setCrop(null); }, []);
  const applyCrop = () => {
    if (!crop) return;
    const x = Math.round(crop.x); const y = Math.round(crop.y);
    const w = Math.max(1, Math.round(crop.w)); const h = Math.max(1, Math.round(crop.h));
    hist.push((p) => {
      const c = mk(w, h);
      c.getContext('2d').drawImage(p.base, x, y, w, h, 0, 0, w, h);
      return { ...p, base: c, objs: p.objs.map((o) => moveObj(o, -x, -y)) };
    });
    cancelCrop();
  };
  const pickAspect = (a) => {
    setAspectId(a.id);
    if (a.r === 0) return;
    setCrop(fitAspect(a.r === -1 ? W / H : a.r, W, H));
  };
  useEffect(() => { if (tab !== 'transform' && cropping) cancelCrop(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const aspectVal = (() => { const a = ASPECTS.find((x) => x.id === aspectId); return !a || a.r === 0 ? 0 : (a.r === -1 ? W / H : a.r); })();

  /* ───────── adjustments ───────── */
  const setAdj = (patch) => hist.debounced((p) => ({ ...p, adj: { ...p.adj, ...patch } }));
  const applyPreset = (pr) => hist.push((p) => ({ ...p, adj: { ...DEFAULT_ADJ, ...pr.adj } }));

  /* ───────── export / save ───────── */
  const srcExt = extOf(fileName);
  const outMime = fmt === 'keep' ? (MIME[srcExt] || 'image/png') : fmt === 'jpg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png';
  const outExt = outMime === 'image/jpeg' ? 'jpg' : outMime === 'image/webp' ? 'webp' : 'png';
  const stem = String(fileName || 'image').replace(/\.[a-z0-9]+$/i, '');
  const outName = fmt === 'keep' && MIME[srcExt] ? fileName : `${stem}.${outExt}`;

  const exportBlob = async () => {
    hist.flush();
    await whenImagesReady(objs);
    const f = makeFiltered(base, adj);
    const c = mk(base.width, base.height);
    const ctx = c.getContext('2d');
    if (outMime === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(f, 0, 0);
    drawObjects(ctx, objs, { base: f });
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not create the image.'))), outMime, quality / 100));
  };
  const doSave = async (force) => {
    if (saving) return false;
    if (!hist.dirty) return true;
    setSaving(true); setSaveErr(''); setConflict(false);
    try {
      const out = await exportBlob();
      await onSave(out, { name: outName, force: force === true });
      return true;
    } catch (e) {
      if (e?.status === 409) setConflict(true); else setSaveErr(e?.message || String(e));
      return false;
    } finally { setSaving(false); }
  };
  const saveRef = useRef(null); saveRef.current = () => doSave(false);
  const download = async () => {
    try {
      const out = await exportBlob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(out);
      a.download = outName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { setSaveErr(e.message); }
  };

  /* ───────── edit existing text (OCR) ───────── */
  const runOcr = async () => {
    const b = base; const lg = ocrLang;
    setOcr({ status: 'running', progress: 0, label: '', lines: [], base: b, langs: lg, error: '' });
    try {
      const lines = await ocrLines(b, lg, (p, l) => setOcr((o) => (o.base === b && o.status === 'running' ? { ...o, progress: p, label: l } : o)));
      setOcr({ status: 'done', progress: 100, label: '', lines, base: b, langs: lg, error: '' });
      setUsed(new Set());
    } catch (e) {
      setOcr({ status: 'error', progress: 0, label: '', lines: [], base: b, langs: lg, error: e?.message || String(e) });
    }
  };
  useEffect(() => {
    if (tool !== 'edittext' || tab !== 'annotate' || !base || cropping) return;
    if (ocr.status === 'running') return;
    if (ocr.base === base && ocr.langs === ocrLang) return;
    runOcr();
  }, [tool, tab, base, ocrLang, ocr.status, ocr.base, ocr.langs, cropping]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { ocrDispose(); }, []);
  const editLine = (ln) => {
    const t = ocrBoxToText(ln, style);
    const colors = sampleColors(filtered, t.cover);
    const [cover, text] = replacementObjs(t, colors);
    hist.push((p) => ({ ...p, objs: [...p.objs, cover, text] }));
    setUsed((u) => new Set(u).add(ln.id));
    setSelId(text.id);
    setTool('select');
    setAutoEdit(text.id);
  };
  const ocrReady = ocr.base === base && ocr.status === 'done';

  const dirty = hist.dirty;
  const draft = useAutoDraft({ draftKey, dirty, token: hist.present, build: () => (hist.present ? exportBlob() : null), meta: { name: outName }, saver: () => saveRef.current?.() });
  const askLeave = () => askUnsaved({ key: draftKey, name: outName, tt, discard: () => discardDraft(draftKey) });
  useEffect(() => {
    if (!guardRef) return undefined;
    guardRef.current = () => !dirty || askLeave();
    return () => { guardRef.current = null; };
  }, [dirty, guardRef, tt]);
  const requestClose = () => afterGuard(dirty ? askLeave() : true, onClose);

  useEditorKeys({
    undo: hist.undo, redo: hist.redo, save: () => doSave(false), dup: dupSel, del: delSel, nudge, hasSel: () => !!selId && !cropping,
    esc: () => { if (cropping) cancelCrop(); else { setSelId(null); setTool('select'); } },
  });

  if (status === 'loading') return <div className="ed ed--center"><span className="st-fv-spinner" /></div>;
  if (status === 'error') return <div className="ed ed--center"><p className="ed__err">{loadErr}</p><Btn label={tt('Close', 'إغلاق')} onClick={onClose} /></div>;

  const tabs = [['annotate', tt('Annotate', 'تعليق')], ['adjust', tt('Adjust', 'ألوان')], ['transform', tt('Transform', 'تحويل')], ['export', tt('Export', 'تصدير')]];
  const zoomTo = (z) => setZoom(clampN(z, 0.25, 6));

  return (
    <div className="ed" dir={rtl ? 'rtl' : 'ltr'} ref={rootRef}>
      <div className="ed__top">
        <Btn icon="x" label={tt('Cancel', 'إلغاء')} onClick={requestClose} />
        <strong className="ed__title" dir="auto">{fileName}</strong>
        <span className="ed__sp" />
        <Btn icon="ed-undo" onClick={hist.undo} disabled={!hist.canUndo} title={tt('Undo (Ctrl+Z)', 'تراجع (Ctrl+Z)')} />
        <Btn icon="ed-redo" onClick={hist.redo} disabled={!hist.canRedo} title={tt('Redo (Ctrl+Shift+Z)', 'إعادة (Ctrl+Shift+Z)')} />
        <span className="ed__sep" />
        <Btn icon="ed-minus" onClick={() => zoomTo(zoom / 1.25)} title={tt('Zoom out', 'تصغير')} />
        <button type="button" className="ed__btn ed__pct" onClick={() => setZoom(1)} title={tt('Fit', 'ملاءمة')}>{Math.round(scale * 100)}%</button>
        <Btn icon="plus" onClick={() => zoomTo(zoom * 1.25)} title={tt('Zoom in', 'تكبير')} />
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

      <Toolbar tools={['select', 'edittext', 'text', 'pen', 'highlight', 'line', 'arrow', 'rect', 'ellipse', 'redact', 'pixel', 'eraser']} tool={tool} setTool={(t) => { if (cropping) cancelCrop(); setTool(t); if (t !== 'select') setSelId(null); setTab('annotate'); }} tt={tt}>
        <span className="ed__sep" />
        <button type="button" className="ed__tool" onClick={() => fileRef.current?.click()} title={tt('Add picture', 'إضافة صورة')}><Icon name="ed-image-plus" size={18} /><span>{tt('Picture', 'صورة')}</span></button>
        <button type="button" className="ed__tool" onClick={() => setSign(true)} title={tt('Signature', 'توقيع')}><Icon name="ed-sign" size={18} /><span>{tt('Signature', 'توقيع')}</span></button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { addFile(e.target.files?.[0]); e.target.value = ''; }} />
      </Toolbar>

      <div className="ed__body">
        <div
          className="ed__stage"
          ref={stageRef}
          onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomTo(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }}
        >
          <div className="ed__pad ed__checker" style={{ width: W * scale, height: H * scale }}>
            <AnnotSurface
              objs={objs}
              onChange={onChange}
              width={W}
              height={H}
              scale={scale}
              tool={cropping || tool === 'edittext' ? 'none' : tool}
              style={style}
              selId={selId}
              onSelect={setSelId}
              onToolChange={setTool}
              drawBase={drawBase}
              baseKey={filtered}
              env={env}
              editable={!cropping}
              autoEditId={autoEdit}
              onAutoEdit={() => setAutoEdit(null)}
            >
              {tool === 'edittext' && ocrReady && ocr.lines.filter((l) => !used.has(l.id)).map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className="ed__tbox"
                  title={l.str}
                  aria-label={l.str}
                  style={{ left: (l.box.x - 2) * scale, top: (l.box.y - 2) * scale, width: (l.box.w + 4) * scale, height: (l.box.h + 4) * scale }}
                  onClick={() => editLine(l)}
                />
              ))}
              {cropping && crop && <CropOverlay rect={crop} setRect={setCrop} aspect={aspectVal} imgW={W} imgH={H} scale={scale} />}
            </AnnotSurface>
          </div>
        </div>

        <aside className="ed__side">
          <div className="ed__tabs" role="tablist">
            {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>{label}</button>)}
          </div>
          <div className="ed__sidebody">
            {tab === 'annotate' && tool === 'edittext' && (
              <div className="ed__ocr">
                <div className="ed__seg">
                  {[['eng', 'English'], ['ara', 'العربية'], ['ara+eng', tt('Both', 'الاتنين')]].map(([id, l]) => (
                    <button key={id} type="button" className={ocrLang === id ? 'is-on' : ''} onClick={() => setOcrLang(id)} disabled={ocr.status === 'running'}>{l}</button>
                  ))}
                </div>
                {ocr.status === 'running' && (
                  <>
                    <p className="ed__hint">{tt('Reading the text in the image…', 'جارٍ قراءة النص في الصورة…')} {ocr.progress}%</p>
                    <div className="ed__bar"><i style={{ width: `${ocr.progress}%` }} /></div>
                  </>
                )}
                {ocr.status === 'error' && <p className="ed__err" style={{ whiteSpace: 'normal' }}>{tt('Could not read the text', 'تعذّرت قراءة النص')}: {ocr.error}</p>}
                {ocrReady && (
                  <p className="ed__hint">
                    {ocr.lines.length
                      ? tt(`Found ${ocr.lines.length} lines — click one to edit it.`, `لقيت ${ocr.lines.length} سطر — اضغط على أي سطر لتعديله.`)
                      : tt('No text was found in this image.', 'ما لقيتش نص في الصورة دي.')}
                  </p>
                )}
                {ocr.status !== 'running' && <Btn label={tt('Scan again', 'إعادة القراءة')} onClick={() => runOcr()} />}
              </div>
            )}
            {tab === 'annotate' && (
              <PropsPanel tool={tool} style={style} setStyle={setStyle} sel={sel} updateSel={updateSel} actions={{ dup: dupSel, del: delSel, front: () => order(true), back: () => order(false) }} tt={tt} />
            )}

            {tab === 'adjust' && (
              <>
                <Section title={tt('Filters', 'فلاتر')}>
                  <div className="ed__presets">
                    {PRESETS.map((p) => (
                      <button key={p.id} type="button" onClick={() => applyPreset(p)}>
                        <canvas
                          width={64}
                          height={44}
                          ref={(c) => {
                            if (!c || !base) return;
                            const x = c.getContext('2d');
                            x.clearRect(0, 0, 64, 44);
                            const k = Math.max(64 / base.width, 44 / base.height);
                            if (HAS_FILTER) x.filter = filterStr({ ...DEFAULT_ADJ, ...p.adj });
                            x.drawImage(base, (64 - base.width * k) / 2, (44 - base.height * k) / 2, base.width * k, base.height * k);
                          }}
                        />
                        <span>{tt(p.en, p.ar)}</span>
                      </button>
                    ))}
                  </div>
                </Section>
                <Section title={tt('Adjust', 'ضبط')}>
                  {ADJ_SLIDERS.filter(([k]) => HAS_FILTER || (k !== 'hue' && k !== 'blur')).map(([k, en, ar, lo, hi, unit]) => (
                    <Range key={k} label={tt(en, ar)} value={adj[k]} min={lo} max={hi} unit={unit} onChange={(v) => setAdj({ [k]: v })} />
                  ))}
                  <Btn label={tt('Reset adjustments', 'إعادة الضبط')} onClick={() => applyPreset(PRESETS[0])} disabled={isDefaultAdj(adj)} />
                </Section>
              </>
            )}

            {tab === 'transform' && (
              <>
                <Section title={tt('Crop', 'قص')}>
                  {!cropping ? (
                    <Btn icon="ed-crop" label={tt('Crop image', 'قص الصورة')} onClick={startCrop} />
                  ) : (
                    <>
                      <div className="ed__chips">
                        {ASPECTS.map((a) => <button key={a.id} type="button" className={aspectId === a.id ? 'is-on' : ''} onClick={() => pickAspect(a)}>{tt(a.en, a.ar)}</button>)}
                      </div>
                      <p className="ed__hint">{tt('Drag the frame or its handles, then apply.', 'اسحب الإطار أو مقابضه وبعدين اضغط تطبيق.')}</p>
                      <div className="ed__row">
                        <Btn icon="check" label={tt('Apply crop', 'تطبيق القص')} onClick={applyCrop} primary />
                        <Btn label={tt('Cancel', 'إلغاء')} onClick={cancelCrop} />
                      </div>
                    </>
                  )}
                </Section>
                <Section title={tt('Rotate & flip', 'تدوير وقلب')}>
                  <div className="ed__row">
                    <Btn icon="ed-rotate-ccw" label={tt('Left', 'يسار')} onClick={() => rotate(false)} />
                    <Btn icon="ed-rotate-cw" label={tt('Right', 'يمين')} onClick={() => rotate(true)} />
                    <Btn icon="ed-flip-h" label={tt('Flip H', 'أفقي')} onClick={() => flip('h')} />
                    <Btn icon="ed-flip-v" label={tt('Flip V', 'رأسي')} onClick={() => flip('v')} />
                  </div>
                </Section>
                <Section title={tt('Resize', 'تغيير الحجم')}>
                  <p className="ed__hint">{W} × {H} px</p>
                  <div className="ed__chips">
                    {[25, 50, 75, 150, 200].map((p) => <button key={p} type="button" onClick={() => resize((W * p) / 100)}>{p}%</button>)}
                  </div>
                  <div className="ed__row">
                    <input className="ed__input" type="number" min={16} max={MAX_SIDE} placeholder={tt('Width (px)', 'العرض (px)')} value={resizeW} onChange={(e) => setResizeW(e.target.value)} />
                    <Btn label={tt('Apply', 'تطبيق')} onClick={() => resize(Number(resizeW))} disabled={!Number(resizeW)} />
                  </div>
                </Section>
              </>
            )}

            {tab === 'export' && (
              <Section title={tt('Save as', 'صيغة الحفظ')}>
                <div className="ed__seg">
                  {[['keep', tt('Original', 'الأصلية')], ['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WEBP']].map(([id, l]) => <button key={id} type="button" className={fmt === id ? 'is-on' : ''} onClick={() => setFmt(id)}>{l}</button>)}
                </div>
                {outMime !== 'image/png' && <Range label={tt('Quality', 'الجودة')} value={quality} min={40} max={100} unit="%" onChange={setQuality} />}
                <p className="ed__hint">{outName} · {W} × {H} px</p>
                {outName !== fileName && <p className="ed__hint">{tt('The file will be saved under this new name.', 'الملف هيتحفظ بالاسم الجديد ده.')}</p>}
              </Section>
            )}
          </div>
        </aside>
      </div>
      {sign && <SignaturePad tt={tt} onCancel={() => setSign(false)} onDone={(src, w, h) => { setSign(false); placeImage(src, w, h); }} />}
    </div>
  );
}
