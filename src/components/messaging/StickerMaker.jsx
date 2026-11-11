import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { autoCutout, tapCutout, paintMask, applyMask } from '../../lib/stickerCutout';

/**
 * "New sticker": turn any photo or short video into a sticker.
 *  - photo  -> 512x512 transparent WebP (shape, white outline, zoom/pan, text + emoji)
 *  - video  -> looping WebM/MP4 up to 6 s (trim, zoom/pan, text + emoji); recorded from the canvas in real time
 * Everything runs in the browser; the result is handed to onSave(file) / onSend(file).
 */
const SIZE = 512;
const WORK_MAX = 800; // longest side of the working copy used for background removal
const MAX_VIDEO_SEC = 6;
const QUICK_EMOJI = ['😂', '😍', '🔥', '👍', '❤️', '😭', '🎉', '😎', '🥺', '🙏', '💯', '🤝'];
const COLORS = ['#ffffff', '#111111', '#ffd400', '#ff3b6b', '#19c37d', '#3b82f6'];
const FONT = '"Cairo","Tajawal","Segoe UI",system-ui,sans-serif';

const pathFor = (ctx, shape, inset) => {
  const a = inset; const b = SIZE - inset; const r = Math.max(0, (shape === 'circle' ? (b - a) / 2 : shape === 'rounded' ? 72 : 0) - 0);
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(SIZE / 2, SIZE / 2, (b - a) / 2, 0, Math.PI * 2);
  else if (ctx.roundRect) ctx.roundRect(a, a, b - a, b - a, r);
  else ctx.rect(a, a, b - a, b - a);
  ctx.closePath();
};

function drawOverlay(ctx, o) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (o.type === 'emoji') {
    ctx.font = `${o.size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.fillText(o.value, o.x, o.y);
  } else {
    ctx.font = `800 ${o.size}px ${FONT}`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, o.size / 6);
    ctx.strokeStyle = o.color === '#111111' || o.color === '#ffd400' ? 'rgba(255,255,255,.95)' : 'rgba(0,0,0,.85)';
    ctx.strokeText(o.value, o.x, o.y);
    ctx.fillStyle = o.color;
    ctx.fillText(o.value, o.x, o.y);
  }
  ctx.restore();
}

function overlayBox(ctx, o) {
  ctx.save();
  ctx.font = o.type === 'emoji' ? `${o.size}px sans-serif` : `800 ${o.size}px ${FONT}`;
  const w = Math.max(ctx.measureText(o.value).width, o.size * 0.7);
  ctx.restore();
  return { x: o.x - w / 2 - 8, y: o.y - o.size * 0.62, w: w + 16, h: o.size * 1.24 };
}

export default function StickerMaker({ ar, initialFile = null, onClose, onSave, onSend }) {
  const t = (en, a) => (ar ? a : en);
  const [file, setFile] = useState(initialFile);
  const [kind, setKind] = useState(null);
  const [url, setUrl] = useState(null);
  const [shape, setShape] = useState('rounded');
  const [outline, setOutline] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [overlays, setOverlays] = useState([]);
  const [sel, setSel] = useState(null);
  const [textDraft, setTextDraft] = useState('');
  const [color, setColor] = useState('#ffffff');
  const [start, setStart] = useState(0);
  const [len, setLen] = useState(MAX_VIDEO_SEC);
  const [dur, setDur] = useState(0);
  const [busy, setBusy] = useState(null); // 'save' | 'send'
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState('');
  const [fit, setFit] = useState('fill'); // 'fill' (crop to the square) | 'whole' (the whole picture, transparent margins)
  const [tool, setTool] = useState('move'); // 'move' | 'tap' | 'erase' | 'restore'
  const [tol, setTol] = useState(45);
  const [brush, setBrush] = useState(26);
  const [hasCut, setHasCut] = useState(false);
  const [cutBusy, setCutBusy] = useState(false);

  const canvasRef = useRef(null);
  const mediaRef = useRef(null);
  const pan = useRef({ x: 0, y: 0 });
  const drag = useRef(null);
  const live = useRef({});
  const exporting = useRef(false);
  // background removal: working copy of the picture + mask (255 keep / 0 removed) + the composed cut-out and its white silhouette
  const cut = useRef({ w: 0, h: 0, pix: null, mask: null, canvas: null, sil: null, dirty: false, history: [] });

  // classify the chosen file and create the object URL
  useEffect(() => {
    if (!file) return undefined;
    const isVideo = file.type.startsWith('video/');
    if (!isVideo && !file.type.startsWith('image/')) { setErr(t('Choose a photo or a video.', 'اختار صورة أو فيديو.')); setFile(null); return undefined; }
    const u = URL.createObjectURL(file);
    setKind(isVideo ? 'video' : 'image');
    setUrl(u);
    setErr('');
    pan.current = { x: 0, y: 0 };
    setZoom(1); setOverlays([]); setSel(null); setStart(0);
    setFit('fill'); setTool('move'); setHasCut(false);
    cut.current = { w: 0, h: 0, pix: null, mask: null, canvas: null, sil: null, dirty: false, history: [] };
    if (isVideo) { setShape('square'); setOutline(false); } else { setShape('rounded'); setOutline(true); }
    return () => URL.revokeObjectURL(u);
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  // the latest drawing state, readable from the rAF loop without restarting it
  live.current = { ...live.current, kind, shape, outline, zoom, overlays, sel, fit, hasCut };

  /* ---------------------------------------------------- background removal */
  const rebuildCut = () => {
    const c = cut.current;
    if (!c.pix) return;
    c.dirty = false;
    const id = new ImageData(c.w, c.h);
    applyMask(c.pix, c.mask, c.w, c.h, id.data);
    const cx = c.canvas.getContext('2d');
    cx.putImageData(id, 0, 0);
    const sx = c.sil.getContext('2d');
    sx.globalCompositeOperation = 'source-over'; sx.clearRect(0, 0, c.w, c.h);
    sx.drawImage(c.canvas, 0, 0);
    sx.globalCompositeOperation = 'source-in'; sx.fillStyle = '#fff'; sx.fillRect(0, 0, c.w, c.h);
    sx.globalCompositeOperation = 'source-over';
  };
  // working copy of the picture (downscaled) — made the first time a removal tool is used
  const ensureCut = () => {
    const c = cut.current;
    if (c.pix) return true;
    const im = mediaRef.current;
    if (!im || !im.naturalWidth) return false;
    const k = Math.min(1, WORK_MAX / Math.max(im.naturalWidth, im.naturalHeight));
    c.w = Math.max(1, Math.round(im.naturalWidth * k)); c.h = Math.max(1, Math.round(im.naturalHeight * k));
    const cv = document.createElement('canvas'); cv.width = c.w; cv.height = c.h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(im, 0, 0, c.w, c.h);
    c.pix = cx.getImageData(0, 0, c.w, c.h).data;
    c.mask = new Uint8Array(c.w * c.h).fill(255);
    c.canvas = document.createElement('canvas'); c.canvas.width = c.w; c.canvas.height = c.h;
    c.sil = document.createElement('canvas'); c.sil.width = c.w; c.sil.height = c.h;
    c.dirty = true;
    return true;
  };
  const snapshot = () => { const c = cut.current; c.history.push(c.mask.slice()); if (c.history.length > 12) c.history.shift(); };
  const markCut = () => { cut.current.dirty = true; setHasCut(true); };
  const doAuto = () => {
    if (!ensureCut()) return;
    setCutBusy(true); setErr('');
    setTimeout(() => { // let the spinner paint first
      const c = cut.current; snapshot();
      const n = autoCutout(c.pix, c.w, c.h, c.mask, tol);
      if (!n) { c.history.pop(); setErr(t('Could not find a plain background to remove. Try "Tap to remove" or the eraser.', 'مقدرتش ألاقي خلفية واضحة أشيلها. جرّب "اضغط للإزالة" أو الممحاة.')); } else { markCut(); setFit('whole'); }
      setCutBusy(false);
    }, 30);
  };
  const undoCut = () => {
    const c = cut.current; const prev = c.history.pop();
    if (!prev) return;
    c.mask = prev; c.dirty = true;
    setHasCut(c.mask.some((v) => v === 0));
  };
  const resetCut = () => { const c = cut.current; if (!c.mask) return; snapshot(); c.mask.fill(255); c.dirty = true; setHasCut(false); };
  // canvas point -> pixel of the working copy
  const toWork = (p) => {
    const c = cut.current; const xf = live.current.xf;
    if (!xf || !c.pix) return null;
    return { x: ((p.x - xf.ox) / xf.dw) * c.w, y: ((p.y - xf.oy) / xf.dh) * c.h, k: c.w / xf.dw };
  };

  const render = useCallback(() => {
    const cv = canvasRef.current; const m = mediaRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const { kind: k, shape: sh, outline: ol, zoom: z, overlays: ovs, sel: s, fit: ft, hasCut: hc } = live.current;
    const c = cut.current;
    if (c.dirty) rebuildCut();
    const cutOn = k === 'image' && hc && c.canvas;
    ctx.clearRect(0, 0, SIZE, SIZE);
    const src = cutOn ? c.canvas : m;
    const ready = src && (cutOn ? true : k === 'video' ? m.readyState >= 2 : m.complete && m.naturalWidth);
    const inset = ol && k === 'image' && !cutOn ? 14 : 0;
    ctx.save();
    if (ol && k === 'image' && !cutOn) { pathFor(ctx, sh, 0); ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0; }
    if (!cutOn) { pathFor(ctx, sh, inset); ctx.clip(); }
    if (ready) {
      const w = cutOn ? c.w : k === 'video' ? m.videoWidth : m.naturalWidth; const h = cutOn ? c.h : k === 'video' ? m.videoHeight : m.naturalHeight;
      const base = ft === 'whole' ? Math.min(SIZE / w, SIZE / h) : Math.max(SIZE / w, SIZE / h);
      const sc = base * z;
      const dw = w * sc; const dh = h * sc;
      const maxX = Math.max(0, (dw - SIZE) / 2); const maxY = Math.max(0, (dh - SIZE) / 2);
      pan.current.x = Math.max(-maxX, Math.min(maxX, pan.current.x));
      pan.current.y = Math.max(-maxY, Math.min(maxY, pan.current.y));
      if (k === 'video') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, SIZE, SIZE); }
      const ox = (SIZE - dw) / 2 + pan.current.x; const oy = (SIZE - dh) / 2 + pan.current.y;
      live.current.xf = { ox, oy, dw, dh };
      if (cutOn && ol && c.sil) { // white sticker border that follows the shape of what is left
        const r = 9; ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 8;
        for (let a = 0; a < 16; a += 1) ctx.drawImage(c.sil, ox + Math.cos((a / 16) * Math.PI * 2) * r, oy + Math.sin((a / 16) * Math.PI * 2) * r, dw, dh);
        ctx.restore();
      }
      ctx.drawImage(src, ox, oy, dw, dh);
    }
    ctx.restore();
    ovs.forEach((o) => drawOverlay(ctx, o));
    const so = ovs.find((o) => o.id === s);
    if (so && !exporting.current) {
      const b = overlayBox(ctx, so);
      ctx.save(); ctx.setLineDash([8, 6]); ctx.lineWidth = 3; ctx.strokeStyle = '#7c5cff'; ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.restore();
    }
  }, []);

  useEffect(() => {
    let raf = 0;
    const loop = () => { render(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [render]);

  // video preview: loop only the chosen window
  useEffect(() => {
    const v = mediaRef.current;
    if (kind !== 'video' || !v) return undefined;
    const tick = () => { if (!exporting.current && v.currentTime >= start + len - 0.05) v.currentTime = start; };
    v.addEventListener('timeupdate', tick);
    v.currentTime = start;
    v.play().catch(() => {});
    return () => v.removeEventListener('timeupdate', tick);
  }, [kind, start, len, url]);

  const onMeta = (e) => {
    const d = e.currentTarget.duration || 0;
    setDur(d);
    setLen(Math.min(MAX_VIDEO_SEC, d || MAX_VIDEO_SEC));
  };

  /* ---------------------------------------------------- pointer: pan background / drag overlays */
  const toCanvas = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * SIZE, y: ((e.clientY - r.top) / r.height) * SIZE };
  };
  const onDown = (e) => {
    const p = toCanvas(e);
    if (kind === 'image' && (tool === 'tap' || tool === 'erase' || tool === 'restore')) {
      if (!ensureCut()) return;
      const q = toWork(p);
      if (!q) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const c = cut.current;
      snapshot();
      if (tool === 'tap') { if (tapCutout(c.pix, c.w, c.h, c.mask, q.x, q.y, tol)) markCut(); else c.history.pop(); return; }
      drag.current = { type: 'brush', value: tool === 'erase' ? 0 : 255 };
      paintMask(c.mask, c.w, c.h, q.x, q.y, brush * q.k, drag.current.value); markCut();
      return;
    }
    const ctx = canvasRef.current.getContext('2d');
    const hit = [...overlays].reverse().find((o) => { const b = overlayBox(ctx, o); return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h; });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (hit) { setSel(hit.id); drag.current = { type: 'overlay', id: hit.id, dx: hit.x - p.x, dy: hit.y - p.y }; } else { setSel(null); drag.current = { type: 'pan', sx: p.x, sy: p.y, ox: pan.current.x, oy: pan.current.y }; }
  };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    const p = toCanvas(e);
    if (d.type === 'brush') {
      const q = toWork(p); const c = cut.current;
      if (q) { paintMask(c.mask, c.w, c.h, q.x, q.y, brush * q.k, d.value); c.dirty = true; if (d.value === 255) setHasCut(c.mask.some((v) => v === 0)); }
      return;
    }
    if (d.type === 'pan') pan.current = { x: d.ox + (p.x - d.sx), y: d.oy + (p.y - d.sy) };
    else setOverlays((list) => list.map((o) => (o.id === d.id ? { ...o, x: Math.max(0, Math.min(SIZE, p.x + d.dx)), y: Math.max(0, Math.min(SIZE, p.y + d.dy)) } : o)));
  };
  const onUp = () => { const d = drag.current; drag.current = null; if (d?.type === 'brush') setHasCut(cut.current.mask.some((v) => v === 0)); };
  const onWheel = (e) => { setZoom((z) => Math.max(0.5, Math.min(4, +(z - e.deltaY * 0.0015).toFixed(3)))); };

  /* ---------------------------------------------------- overlays */
  const addOverlay = (o) => { const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; setOverlays((l) => [...l, { id, x: SIZE / 2, y: SIZE / 2, ...o }]); setSel(id); };
  const addText = () => { const v = textDraft.trim(); if (!v) return; addOverlay({ type: 'text', value: v.slice(0, 40), size: 64, color }); setTextDraft(''); };
  const selected = overlays.find((o) => o.id === sel);
  const patchSel = (patch) => setOverlays((l) => l.map((o) => (o.id === sel ? { ...o, ...patch } : o)));
  const removeSel = () => { setOverlays((l) => l.filter((o) => o.id !== sel)); setSel(null); };

  /* ---------------------------------------------------- export */
  const exportImage = async () => {
    exporting.current = true; setSel(null);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const cv = canvasRef.current;
    const toBlob = (type, q) => new Promise((res) => cv.toBlob(res, type, q));
    let blob = null;
    for (const q of [0.92, 0.8, 0.65]) {
      blob = await toBlob('image/webp', q);
      if (blob && blob.type === 'image/webp' && blob.size < 900 * 1024) break;
    }
    if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/png');
    exporting.current = false;
    if (!blob) throw new Error('export');
    return new File([blob], `sticker-${Date.now()}.${blob.type === 'image/png' ? 'png' : 'webp'}`, { type: blob.type });
  };

  const exportVideo = async () => {
    const v = mediaRef.current; const cv = canvasRef.current;
    if (!window.MediaRecorder || !cv.captureStream) throw new Error(t('Your browser cannot record video stickers. Try Chrome or Edge.', 'متصفحك مش بيدعم تسجيل ستيكر فيديو. جرّب Chrome أو Edge.'));
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) throw new Error(t('Video recording is not supported here.', 'تسجيل الفيديو مش مدعوم هنا.'));
    exporting.current = true; setSel(null);
    v.muted = true; v.currentTime = start;
    await new Promise((r) => { const h = () => { v.removeEventListener('seeked', h); r(); }; v.addEventListener('seeked', h); });
    const rec = new MediaRecorder(cv.captureStream(30), { mimeType: mime, videoBitsPerSecond: 1_200_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    const done = new Promise((r) => { rec.onstop = r; });
    await v.play();
    rec.start(200);
    const t0 = performance.now();
    const ms = len * 1000;
    await new Promise((resolve) => {
      const iv = setInterval(() => {
        const el = performance.now() - t0;
        setProgress(Math.min(100, Math.round((el / ms) * 100)));
        if (el >= ms) { clearInterval(iv); resolve(); }
      }, 120);
    });
    rec.stop();
    await done;
    exporting.current = false;
    v.currentTime = start;
    const type = mime.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
    const blob = new Blob(chunks, { type });
    if (blob.size > 4 * 1024 * 1024 - 1) throw new Error(t('The sticker is too large. Shorten the clip.', 'الستيكر كبير. قصّر المقطع.'));
    return new File([blob], `sticker-${Date.now()}.${type === 'video/mp4' ? 'mp4' : 'webm'}`, { type });
  };

  const run = async (mode) => {
    if (busy || !url) return;
    setBusy(mode); setErr(''); setProgress(0);
    try {
      const out = kind === 'video' ? await exportVideo() : await exportImage();
      if (mode === 'send') await onSend(out); else await onSave(out);
      onClose?.();
    } catch (e) {
      exporting.current = false;
      setErr(e?.message || t('Could not create the sticker.', 'تعذّر إنشاء الستيكر.'));
    } finally { setBusy(null); }
  };

  const shapes = useMemo(() => [
    { id: 'rounded', label: t('Rounded', 'حواف مدوّرة') },
    { id: 'circle', label: t('Circle', 'دائرة') },
    { id: 'square', label: t('Square', 'مربّع') },
  ], [ar]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="smk-overlay" role="dialog" aria-modal="true" aria-label={t('New sticker', 'ستيكر جديد')} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}>
      <div className="smk">
        <header className="smk-head">
          <h3>{t('New sticker', 'ستيكر جديد')}</h3>
          <button type="button" className="smk-x" onClick={onClose} disabled={!!busy} aria-label={t('Close', 'إغلاق')}>×</button>
        </header>

        {!file ? (
          <div
            className="smk-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
          >
            <div className="smk-drop__art" aria-hidden="true">✨</div>
            <p className="smk-drop__title">{t('Make a sticker from any photo or video', 'اعمل ستيكر من أي صورة أو فيديو')}</p>
            <p className="smk-drop__sub">{t('Crop it, add text and emoji, then send it in any chat.', 'قصّها، ضيف كتابة وإيموجي، وابعتها في أي شات.')}</p>
            <label className="smk-btn smk-btn--primary">
              {t('Choose photo or video', 'اختار صورة أو فيديو')}
              <input type="file" accept="image/*,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ''; }} />
            </label>
            {err && <p className="smk-err">{err}</p>}
          </div>
        ) : (
          <div className="smk-body">
            <div className="smk-stage">
              <div className={`smk-canvas-wrap${kind === 'image' ? ' is-checker' : ''}`}>
                <canvas ref={canvasRef} width={SIZE} height={SIZE} className="smk-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel} />
                {busy && kind === 'video' && <div className="smk-rec"><span className="smk-rec__dot" />{t('Recording', 'جارٍ التسجيل')} {progress}%</div>}
              </div>
              <p className="smk-hint">{tool === 'move' || kind !== 'image' ? t('Drag to move · scroll or slider to zoom', 'اسحب لتحريك الصورة · اللف أو السلايدر للتكبير') : tool === 'tap' ? t('Tap the part you want to remove', 'اضغط على الجزء اللي عايز تشيله') : t('Paint over the picture', 'ارسم على الصورة')}</p>
              {kind === 'video' ? <video ref={mediaRef} src={url} className="smk-src" muted playsInline loop onLoadedMetadata={onMeta} /> : <img ref={mediaRef} src={url} alt="" className="smk-src" />}
            </div>

            <div className="smk-tools">
              <label className="smk-row">
                <span>{t('Zoom', 'تكبير')}</span>
                <input type="range" min="0.5" max="4" step="0.01" value={zoom} onChange={(e) => setZoom(+e.target.value)} />
              </label>

              <div className="smk-row smk-row--wrap">
                <span>{t('Fit', 'العرض')}</span>
                <div className="smk-seg">
                  <button type="button" className={fit === 'fill' ? 'is-on' : ''} onClick={() => { setFit('fill'); pan.current = { x: 0, y: 0 }; }}>{t('Fill', 'تغطية')}</button>
                  <button type="button" className={fit === 'whole' ? 'is-on' : ''} onClick={() => { setFit('whole'); pan.current = { x: 0, y: 0 }; }}>{t('Whole picture', 'الصورة كاملة')}</button>
                </div>
              </div>

              {kind === 'image' && (
                <div className="smk-sec">
                  <span className="smk-sec__title">{t('Remove background', 'عزل الخلفية')}</span>
                  <div className="smk-textrow">
                    <button type="button" className="smk-btn smk-btn--primary" onClick={doAuto} disabled={cutBusy || !!busy}>{cutBusy ? t('Working…', 'جارٍ العمل…') : t('Remove automatically', 'عزل تلقائي')}</button>
                    <button type="button" className="smk-btn" onClick={undoCut} disabled={!cut.current.history.length}>{t('Undo', 'تراجع')}</button>
                    <button type="button" className="smk-btn" onClick={resetCut} disabled={!hasCut}>{t('Reset', 'إعادة')}</button>
                  </div>
                  <label className="smk-row">
                    <span>{t('Sensitivity', 'الحساسية')}</span>
                    <input type="range" min="10" max="140" value={tol} onChange={(e) => setTol(+e.target.value)} />
                  </label>
                  <div className="smk-seg">
                    {[['move', t('Move', 'تحريك')], ['tap', t('Tap to remove', 'اضغط للإزالة')], ['erase', t('Eraser', 'ممحاة')], ['restore', t('Restore', 'استرجاع')]].map(([id, label]) => (
                      <button key={id} type="button" className={tool === id ? 'is-on' : ''} onClick={() => setTool(id)}>{label}</button>
                    ))}
                  </div>
                  {(tool === 'erase' || tool === 'restore') && (
                    <label className="smk-row">
                      <span>{t('Brush size', 'حجم الفرشاة')}</span>
                      <input type="range" min="6" max="90" value={brush} onChange={(e) => setBrush(+e.target.value)} />
                    </label>
                  )}
                  <p className="smk-note">{t('Automatic removal works best on a plain background; fix the rest with the eraser.', 'العزل التلقائي بيشتغل أحسن مع خلفية سادة؛ وكمّل الباقي بالممحاة.')}</p>
                </div>
              )}

              {kind === 'image' ? (
                <>
                  {!hasCut && <div className="smk-row smk-row--wrap">
                    <span>{t('Shape', 'الشكل')}</span>
                    <div className="smk-seg">
                      {shapes.map((s) => <button key={s.id} type="button" className={shape === s.id ? 'is-on' : ''} onClick={() => setShape(s.id)}>{s.label}</button>)}
                    </div>
                  </div>}
                  <label className="smk-check"><input type="checkbox" checked={outline} onChange={(e) => setOutline(e.target.checked)} /> {t('White outline', 'إطار أبيض')}</label>
                </>
              ) : (
                <>
                  <label className="smk-row">
                    <span>{t('Start', 'البداية')} {start.toFixed(1)}s</span>
                    <input type="range" min="0" max={Math.max(0, dur - 0.5)} step="0.1" value={start} onChange={(e) => { const s = +e.target.value; setStart(s); setLen((l) => Math.min(l, Math.max(0.5, dur - s), MAX_VIDEO_SEC)); }} />
                  </label>
                  <label className="smk-row">
                    <span>{t('Length', 'المدة')} {len.toFixed(1)}s</span>
                    <input type="range" min="0.5" max={Math.max(0.5, Math.min(MAX_VIDEO_SEC, dur - start))} step="0.1" value={len} onChange={(e) => setLen(+e.target.value)} />
                  </label>
                  <p className="smk-note">{t('Video stickers loop, are silent and last up to 6 seconds.', 'ستيكر الفيديو بيتكرر وبدون صوت وأقصاه 6 ثواني.')}</p>
                </>
              )}

              <div className="smk-sec">
                <span className="smk-sec__title">{t('Text', 'كتابة')}</span>
                <div className="smk-textrow">
                  <input value={textDraft} maxLength={40} dir="auto" placeholder={t('Type something…', 'اكتب حاجة…')} onChange={(e) => setTextDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addText(); } }} />
                  <button type="button" className="smk-btn" onClick={addText} disabled={!textDraft.trim()}>{t('Add', 'إضافة')}</button>
                </div>
                <div className="smk-colors">
                  {COLORS.map((c) => <button key={c} type="button" aria-label={c} className={color === c ? 'is-on' : ''} style={{ background: c }} onClick={() => { setColor(c); if (selected?.type === 'text') patchSel({ color: c }); }} />)}
                </div>
              </div>

              <div className="smk-sec">
                <span className="smk-sec__title">{t('Emoji', 'إيموجي')}</span>
                <div className="smk-emoji">
                  {QUICK_EMOJI.map((e) => <button key={e} type="button" onClick={() => addOverlay({ type: 'emoji', value: e, size: 110 })}>{e}</button>)}
                </div>
              </div>

              {selected && (
                <div className="smk-sec smk-sel">
                  <label className="smk-row">
                    <span>{t('Size', 'الحجم')}</span>
                    <input type="range" min="28" max="260" value={selected.size} onChange={(e) => patchSel({ size: +e.target.value })} />
                  </label>
                  <button type="button" className="smk-btn smk-btn--danger" onClick={removeSel}>{t('Remove', 'حذف')}</button>
                </div>
              )}
              {err && <p className="smk-err">{err}</p>}
            </div>
          </div>
        )}

        {file && (
          <footer className="smk-foot">
            <button type="button" className="smk-btn" onClick={() => { setFile(null); setUrl(null); }} disabled={!!busy}>{t('Change file', 'غيّر الملف')}</button>
            <span className="smk-foot__fill" />
            {onSave && <button type="button" className="smk-btn" onClick={() => run('save')} disabled={!!busy}>{busy === 'save' ? t('Saving…', 'جارٍ الحفظ…') : t('Save', 'حفظ')}</button>}
            {onSend && <button type="button" className="smk-btn smk-btn--primary" onClick={() => run('send')} disabled={!!busy}>{busy === 'send' ? t('Sending…', 'جارٍ الإرسال…') : t('Save & send', 'حفظ وإرسال')}</button>}
          </footer>
        )}
      </div>
    </div>
  );
}
