import { memo, useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { FONT, NOTE_W, bounds, contentBounds, drawObject, hit, noteHeight } from '../../../lib/whiteboard/boardGeom';
import './whiteboard.css';

/**
 * Shared whiteboard (Miro / Jamboard style) drawn on one <canvas>. All state is in the BoardStore (outside React): the canvas is
 * repainted at most once per animation frame, and a stroke never re-renders the meeting room.
 * Pan: Space+drag / middle mouse / Hand tool / wheel / two fingers. Zoom: Ctrl+wheel / pinch / buttons.
 */
const PALETTE = ['#111827', '#6b7280', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff'];
const NOTE_COLORS = ['#fde68a', '#fbcfe8', '#bbf7d0', '#bfdbfe', '#ddd6fe', '#fed7aa'];
const WIDTHS = [2, 4, 8, 14];
const SIZES = [['S', 20], ['M', 28], ['L', 44], ['XL', 64]];
const MIN_Z = 0.1; const MAX_Z = 6;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const I = (d, extra) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}{extra}</svg>;
const ICON = {
  select: I(<path d="m5 3 14 7-6 2-2 6z" />),
  hand: I(<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6m0-1V3.5a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V14m0-3.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3 15.5a1.6 1.6 0 0 1 2.5-2L8 15" />),
  pen: I(<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />),
  hl: I(<><path d="m9 11-6 6v3h9l3-3" /><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" /></>),
  eraser: I(<><path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21" /><path d="M22 21H7M5 11l9 9" /></>),
  laser: I(<><circle cx="12" cy="12" r="2.2" fill="currentColor" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>),
  line: I(<path d="M5 19 19 5" />),
  arrow: I(<path d="M5 19 19 5M10 5h9v9" />),
  rect: I(<rect x="4" y="5" width="16" height="14" rx="2" />),
  ellipse: I(<ellipse cx="12" cy="12" rx="9" ry="7" />),
  text: I(<path d="M5 6V4h14v2M12 4v16M9 20h6" />),
  note: I(<><path d="M5 4h14a1 1 0 0 1 1 1v9l-6 6H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /><path d="M14 20v-5a1 1 0 0 1 1-1h5" /></>),
  undo: I(<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />),
  redo: I(<path d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />),
  plus: I(<path d="M12 5v14M5 12h14" />),
  minus: I(<path d="M5 12h14" />),
  fit: I(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />),
  grid: I(<path d="M4 4h16v16H4zM4 12h16M12 4v16" />),
  moon: I(<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" />),
  sun: I(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  download: I(<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3" />),
  lock: I(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>),
  unlock: I(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></>),
  trash: I(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />),
  close: I(<path d="M6 6l12 12M18 6 6 18" />),
  eyeoff: I(<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 9 6 9 6a15 15 0 0 1-3 3.6M6.6 6.6A15 15 0 0 0 3 12s3 6 9 6a9 9 0 0 0 3.4-.7" />),
};

const TOOLS = [
  ['select', 'Select', 'V'], ['hand', 'Pan', 'H'], ['pen', 'Pen', 'P'], ['hl', 'Highlighter', 'M'], ['eraser', 'Eraser', 'E'], ['laser', 'Laser pointer', 'L'],
  ['line', 'Line', 'I'], ['arrow', 'Arrow', 'A'], ['rect', 'Rectangle', 'R'], ['ellipse', 'Ellipse', 'O'], ['text', 'Text', 'T'], ['note', 'Sticky note', 'N'],
];

function readPref(k, d) { try { return localStorage.getItem(`uip.wb.${k}`) ?? d; } catch { return d; } }
function writePref(k, v) { try { localStorage.setItem(`uip.wb.${k}`, v); } catch { /* private mode */ } }

function Whiteboard({ store, t, isManager, onClose }) {
  const wrapRef = useRef(null); const cvRef = useRef(null); const edRef = useRef(null);
  const [, bump] = useReducer((n) => n + 1, 0);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#111827');
  const [width, setWidth] = useState(4);
  const [fill, setFill] = useState(false);
  const [fs, setFs] = useState(28);
  const [noteColor, setNoteColor] = useState(NOTE_COLORS[0]);
  const [bg, setBg] = useState(() => readPref('bg', 'grid'));
  const [dark, setDark] = useState(() => readPref('dark', '0') === '1');
  const [zoom, setZoom] = useState(100);
  const [sel, setSel] = useState([]);
  const [editor, setEditor] = useState(null); // { id|null, kind:'text'|'note', x, y, v, c, fs }
  const [confirmClear, setConfirmClear] = useState(false);

  const view = useRef({ x: 40, y: 40, z: 1 });
  const S = useRef({}); S.current = { tool, color, width, fill, fs, noteColor, bg, dark, sel, editor };
  const op = useRef(null); const pointers = useRef(new Map()); const gesture = useRef(null);
  const spaceDown = useRef(false); const hover = useRef(null); const dirty = useRef(true); const raf = useRef(0); const size = useRef({ w: 1, h: 1, dpr: 1 });

  const markDirty = useCallback(() => { dirty.current = true; if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; paint(); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- painting ---------- */
  function paint() {
    const cv = cvRef.current; if (!cv) return;
    dirty.current = false;
    const ctx = cv.getContext('2d'); const { w, h, dpr } = size.current; const v = view.current; const st = S.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (st.bg !== 'plain') { // grid / dots in screen space; the spacing doubles when zoomed out so it never turns into noise
      let step = 40 * v.z; while (step < 18) step *= 2;
      const ox = ((v.x % step) + step) % step; const oy = ((v.y % step) + step) % step;
      ctx.fillStyle = 'rgba(100,110,140,.38)'; ctx.strokeStyle = 'rgba(100,110,140,.16)'; ctx.lineWidth = 1;
      if (st.bg === 'grid') { ctx.beginPath(); for (let x = ox; x < w; x += step) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); } for (let y = oy; y < h; y += step) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); } ctx.stroke(); }
      else for (let x = ox; x < w; x += step) for (let y = oy; y < h; y += step) ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    ctx.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * v.x, dpr * v.y);
    const vx1 = -v.x / v.z; const vy1 = -v.y / v.z; const vx2 = (w - v.x) / v.z; const vy2 = (h - v.y) / v.z;
    store.list().forEach((o) => { const b = bounds(o); if (b && (b.x2 < vx1 || b.x1 > vx2 || b.y2 < vy1 || b.y1 > vy2)) return; drawObject(ctx, o); });
    // selection
    if (st.sel.length) {
      ctx.save(); ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5 / v.z; ctx.setLineDash([6 / v.z, 4 / v.z]);
      st.sel.forEach((id) => { const o = store.objs.get(id); const b = o && bounds(o); if (b) ctx.strokeRect(b.x1 - 4 / v.z, b.y1 - 4 / v.z, b.x2 - b.x1 + 8 / v.z, b.y2 - b.y1 + 8 / v.z); });
      ctx.restore();
    }
    // cursors, laser trails (screen space)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const now = performance.now(); let animate = false;
    store.cursors.forEach((c, key) => {
      const age = now - c.t; if (age > 6000) { store.cursors.delete(key); return; }
      const sx = c.x * v.z + v.x; const sy = c.y * v.z + v.y;
      if (c.l) {
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (let i = 1; i < c.trail.length; i += 1) { const a = c.trail[i - 1]; const b = c.trail[i]; const f = Math.max(0, 1 - (now - b[2]) / 900); if (f <= 0) continue; ctx.strokeStyle = `rgba(239,68,68,${f * 0.8})`; ctx.lineWidth = 3 + 5 * f; ctx.beginPath(); ctx.moveTo(a[0] * v.z + v.x, a[1] * v.z + v.y); ctx.lineTo(b[0] * v.z + v.x, b[1] * v.z + v.y); ctx.stroke(); }
        if (age < 1500) { ctx.fillStyle = 'rgba(239,68,68,.95)'; ctx.shadowColor = 'rgba(239,68,68,.9)'; ctx.shadowBlur = 14; ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; animate = true; }
      } else if (age < 4500) {
        ctx.fillStyle = c.c; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 4, sy + 15); ctx.lineTo(sx + 8, sy + 10); ctx.lineTo(sx + 14, sy + 9); ctx.closePath(); ctx.fill();
      }
      if (age < 4500) {
        ctx.font = `600 11px ${FONT}`; const tw = ctx.measureText(c.n || '').width;
        ctx.fillStyle = c.l ? '#ef4444' : c.c; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(sx + 12, sy + 14, tw + 12, 18, 9); else ctx.rect(sx + 12, sy + 14, tw + 12, 18); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(c.n || '', sx + 18, sy + 23);
        animate = animate || age < 4500;
      }
    });
    // my own laser trail + eraser ring
    const lt = laserTrail.current;
    if (lt.length) {
      const fresh = lt.filter((q) => now - q[2] < 900); laserTrail.current = fresh;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < fresh.length; i += 1) { const a = fresh[i - 1]; const b = fresh[i]; const f = Math.max(0, 1 - (now - b[2]) / 900); ctx.strokeStyle = `rgba(239,68,68,${f * 0.8})`; ctx.lineWidth = 3 + 5 * f; ctx.beginPath(); ctx.moveTo(a[0] * v.z + v.x, a[1] * v.z + v.y); ctx.lineTo(b[0] * v.z + v.x, b[1] * v.z + v.y); ctx.stroke(); }
      if (fresh.length) { const q = fresh[fresh.length - 1]; ctx.fillStyle = '#ef4444'; ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 14; ctx.beginPath(); ctx.arc(q[0] * v.z + v.x, q[1] * v.z + v.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; animate = true; }
    }
    if (st.tool === 'eraser' && hover.current) { ctx.strokeStyle = 'rgba(120,120,140,.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(hover.current.sx, hover.current.sy, 10, 0, Math.PI * 2); ctx.stroke(); }
    if (animate) markDirty();
  }
  const laserTrail = useRef([]);

  /* ---------- sizing ---------- */
  useLayoutEffect(() => {
    const wrap = wrapRef.current; const cv = cvRef.current; if (!wrap || !cv) return undefined;
    const fit = () => {
      const r = wrap.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size.current = { w: Math.max(1, r.width), h: Math.max(1, r.height), dpr };
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); markDirty();
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(wrap);
    return () => { ro.disconnect(); cancelAnimationFrame(raf.current); raf.current = 0; };
  }, [markDirty]);

  useEffect(() => {
    const off = store.subscribe((kind) => {
      if (kind === 'objs' || kind === 'cursors') markDirty();
      if (kind === 'meta' || kind === 'open') bump();
      if (kind === 'objs') setSel((s) => (s.length ? s.filter((id) => store.objs.has(id)) : s));
    });
    return off;
  }, [store, markDirty]);
  useEffect(() => { markDirty(); }, [bg, dark, sel, tool, markDirty]);
  useEffect(() => { wrapRef.current?.focus({ preventScroll: true }); }, []);

  /* ---------- view helpers ---------- */
  const setView = useCallback((x, y, z) => { view.current = { x, y, z }; setZoom(Math.round(z * 100)); markDirty(); }, [markDirty]);
  const zoomAt = useCallback((factor, cx, cy) => {
    const v = view.current; const z = clamp(v.z * factor, MIN_Z, MAX_Z); const k = z / v.z;
    setView(cx - (cx - v.x) * k, cy - (cy - v.y) * k, z);
  }, [setView]);
  const zoomCenter = (f) => zoomAt(f, size.current.w / 2, size.current.h / 2);
  const fitContent = useCallback(() => {
    const b = contentBounds(store.list()); const { w, h } = size.current;
    if (!b) { setView(40, 40, 1); return; }
    const pad = 70; const z = clamp(Math.min((w - pad * 2) / Math.max(1, b.x2 - b.x1), (h - pad * 2 - 60) / Math.max(1, b.y2 - b.y1)), MIN_Z, 1.6);
    setView(w / 2 - ((b.x1 + b.x2) / 2) * z, h / 2 + 20 - ((b.y1 + b.y2) / 2) * z, z);
  }, [store, setView]);
  useEffect(() => { if (store.list().length) fitContent(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toWorld = (e) => {
    const r = cvRef.current.getBoundingClientRect(); const v = view.current; const sx = e.clientX - r.left; const sy = e.clientY - r.top;
    return { x: (sx - v.x) / v.z, y: (sy - v.y) / v.z, sx, sy };
  };
  const topHit = (x, y, tol) => { const list = store.list(); for (let i = list.length - 1; i >= 0; i -= 1) if (hit(list[i], x, y, tol)) return list[i]; return null; };

  /* ---------- text / note editor ---------- */
  const openEditor = (o, p) => {
    if (o) setEditor({ id: o.id, kind: o.t, x: o.x, y: o.y, v: o.v, c: o.c, fs: o.s, w: o.w });
    else if (S.current.tool === 'note') setEditor({ id: null, kind: 'note', x: p.x - NOTE_W / 2, y: p.y - 40, v: '', c: S.current.noteColor, w: NOTE_W });
    else setEditor({ id: null, kind: 'text', x: p.x, y: p.y, v: '', c: S.current.color, fs: S.current.fs });
  };
  const commitEditor = useCallback((ed, value) => {
    if (!ed) return;
    const v = value.replace(/\s+$/g, '');
    const prev = ed.id ? store.objs.get(ed.id) : null;
    if (!v) { if (prev) store.remove([prev.id]); return; }
    if (prev && prev.v === v) return;
    const o = ed.kind === 'note'
      ? { id: ed.id || store.newId(), t: 'note', c: ed.c, x: ed.x, y: ed.y, w: ed.w || NOTE_W, h: 160, v: v.slice(0, 600) }
      : { id: ed.id || store.newId(), t: 'text', c: ed.c, s: ed.fs, x: ed.x, y: ed.y, v: v.slice(0, 1500) };
    store.put(o, true);
  }, [store]);
  const closeEditor = useCallback((save) => {
    const el = edRef.current; const ed = S.current.editor;
    if (!ed) return; // already closing (Ctrl+Enter is followed by a blur): never commit twice
    S.current.editor = null; setEditor(null);
    if (save && ed && el) commitEditor(ed, el.value);
    wrapRef.current?.focus({ preventScroll: true });
  }, [commitEditor]);
  useEffect(() => { if (editor && edRef.current) { const el = edRef.current; el.focus(); el.value = editor.v || ''; el.setSelectionRange(el.value.length, el.value.length); autoSize(el); } }, [editor?.id, editor?.x, editor?.y, !!editor]); // eslint-disable-line react-hooks/exhaustive-deps
  const autoSize = (el) => { el.style.height = '0px'; el.style.height = `${el.scrollHeight}px`; el.style.width = '0px'; el.style.width = `${Math.max(el.scrollWidth + 6, 60)}px`; };

  /* ---------- pointer input ---------- */
  const startGesture = () => {
    const pts = [...pointers.current.values()]; if (pts.length < 2) return;
    const [a, b] = pts; gesture.current = { d: Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1, mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
  };
  const cancelOp = () => {
    const o = op.current; op.current = null; if (!o) return;
    if (o.type === 'stroke') store.endStroke(o.id);
    if (o.type === 'shape') store.remove([o.o.id], false);
    if (o.type === 'erase' && o.removed.length) store._record({ u: 'del', objs: o.removed });
  };
  const eraseAt = (p, o) => {
    const tol = 9 / view.current.z; const list = store.list(); const ids = [];
    for (let i = list.length - 1; i >= 0; i -= 1) if (hit(list[i], p.x, p.y, tol)) ids.push(list[i].id);
    if (!ids.length) return;
    ids.forEach((id) => { const ob = store.objs.get(id); if (ob) o.removed.push(ob); });
    store.remove(ids, false);
  };

  const onDown = (e) => {
    if (editor) { closeEditor(true); }
    const cv = cvRef.current; cv.setPointerCapture?.(e.pointerId);
    const p = toWorld(e); pointers.current.set(e.pointerId, p);
    wrapRef.current?.focus({ preventScroll: true });
    if (pointers.current.size === 2) { cancelOp(); startGesture(); op.current = { type: 'gesture' }; return; }
    if (pointers.current.size > 2) return;
    const st = S.current; const v = view.current;
    const canDraw = store.canDraw;
    if (e.button === 1 || spaceDown.current || st.tool === 'hand' || (!canDraw && st.tool !== 'select')) { op.current = { type: 'pan', sx: p.sx, sy: p.sy, vx: v.x, vy: v.y }; cv.style.cursor = 'grabbing'; return; }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    switch (st.tool) {
      case 'pen': case 'hl': {
        const o = { id: store.newId(), t: st.tool, c: st.color, w: st.tool === 'hl' ? Math.max(14, st.width * 3) : st.width, p: [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10] };
        store.beginStroke(o); op.current = { type: 'stroke', id: o.id, lx: p.x, ly: p.y }; break;
      }
      case 'eraser': { op.current = { type: 'erase', removed: [] }; eraseAt(p, op.current); break; }
      case 'line': case 'arrow': case 'rect': case 'ellipse': {
        const o = { id: store.newId(), t: st.tool, c: st.color, w: st.width, f: st.fill && (st.tool === 'rect' || st.tool === 'ellipse') ? st.color : null, a: [p.x, p.y, p.x, p.y] };
        op.current = { type: 'shape', o, x0: p.x, y0: p.y, sx: p.sx, sy: p.sy }; break;
      }
      case 'text': case 'note': { op.current = { type: 'place', sx: p.sx, sy: p.sy, p }; break; }
      case 'laser': { op.current = { type: 'laser' }; laserTrail.current.push([p.x, p.y, performance.now()]); store.cursor(p.x, p.y, true); markDirty(); break; }
      case 'select': {
        const o = topHit(p.x, p.y, 6 / v.z);
        if (!o) { setSel([]); op.current = { type: 'pan', sx: p.sx, sy: p.sy, vx: v.x, vy: v.y }; break; }
        let ids = st.sel.includes(o.id) ? st.sel : (e.shiftKey ? [...st.sel, o.id] : [o.id]);
        if (!canDraw) { setSel(ids); break; }
        setSel(ids);
        const originals = new Map(); ids.forEach((id) => { const ob = store.objs.get(id); if (ob) originals.set(id, ob); });
        op.current = { type: 'move', ids, originals, x0: p.x, y0: p.y, moved: false }; break;
      }
      default: break;
    }
  };

  const onMove = (e) => {
    const p = toWorld(e); hover.current = p;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    const o = op.current; const st = S.current; const v = view.current;
    if (o?.type === 'gesture' && pointers.current.size >= 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()]; const d = Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1; const mx = (a.sx + b.sx) / 2; const my = (a.sy + b.sy) / 2; const g = gesture.current;
      const z = clamp(v.z * (d / g.d), MIN_Z, MAX_Z); const k = z / v.z;
      setView(mx - (g.mx - v.x) * k, my - (g.my - v.y) * k, z); gesture.current = { d, mx, my }; return;
    }
    if (!o) {
      if (store.canDraw && e.pointerType === 'mouse') store.cursor(p.x, p.y, st.tool === 'laser');
      if (st.tool === 'laser' && store.canDraw) { laserTrail.current.push([p.x, p.y, performance.now()]); if (laserTrail.current.length > 80) laserTrail.current.shift(); }
      if (st.tool === 'eraser' || st.tool === 'laser') markDirty();
      return;
    }
    switch (o.type) {
      case 'pan': setView(o.vx + (p.sx - o.sx), o.vy + (p.sy - o.sy), v.z); break;
      case 'stroke': {
        const evs = e.nativeEvent.getCoalescedEvents?.() || [e.nativeEvent]; const minD = 1.4 / v.z;
        evs.forEach((ev) => { const q = toWorld(ev); if (Math.hypot(q.x - o.lx, q.y - o.ly) >= minD) { store.extendStroke(o.id, q.x, q.y); o.lx = q.x; o.ly = q.y; } });
        store.cursor(p.x, p.y, false); break;
      }
      case 'erase': eraseAt(p, o); markDirty(); break;
      case 'shape': {
        let x = p.x; let y = p.y;
        if (e.shiftKey) { const dx = x - o.x0; const dy = y - o.y0; if (st.tool === 'line' || st.tool === 'arrow') { const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4); const len = Math.hypot(dx, dy); x = o.x0 + len * Math.cos(ang); y = o.y0 + len * Math.sin(ang); } else { const m = Math.max(Math.abs(dx), Math.abs(dy)); x = o.x0 + Math.sign(dx || 1) * m; y = o.y0 + Math.sign(dy || 1) * m; } }
        o.o = { ...o.o, a: [o.x0, o.y0, x, y] }; store.putLive(o.o); break;
      }
      case 'move': {
        const dx = p.x - o.x0; const dy = p.y - o.y0; if (!o.moved && Math.hypot(dx, dy) * v.z < 3) break; o.moved = true;
        store.moveBy(o.ids, dx, dy, o.originals); break;
      }
      case 'laser': laserTrail.current.push([p.x, p.y, performance.now()]); if (laserTrail.current.length > 80) laserTrail.current.shift(); store.cursor(p.x, p.y, true); markDirty(); break;
      default: break;
    }
  };

  const onUp = (e) => {
    const p = toWorld(e); pointers.current.delete(e.pointerId);
    const o = op.current; cvRef.current.style.cursor = '';
    if (o?.type === 'gesture') { if (pointers.current.size < 2) { op.current = null; gesture.current = null; } return; }
    op.current = null; if (!o) return;
    switch (o.type) {
      case 'stroke': store.endStroke(o.id); break;
      case 'erase': if (o.removed.length) store._record({ u: 'del', objs: o.removed }); break;
      case 'shape': {
        const a = o.o.a; if (Math.hypot(a[2] - a[0], a[3] - a[1]) * view.current.z < 4) { store.remove([o.o.id], false); break; }
        store.commitLive(o.o, null); break;
      }
      case 'move': if (o.moved) { const pairs = o.ids.map((id) => ({ before: o.originals.get(id), after: store.objs.get(id) })).filter((q) => q.before && q.after); if (pairs.length) store.commitMove(pairs); } break;
      case 'place': if (Math.hypot(p.sx - o.sx, p.sy - o.sy) < 6) { const ob = topHit(o.p.x, o.p.y, 4 / view.current.z); openEditor(ob && (ob.t === 'text' || ob.t === 'note') ? ob : null, o.p); } break;
      default: break;
    }
  };
  const onLeave = () => { hover.current = null; if (store.canDraw) store.cursorGone(); markDirty(); };
  const onDouble = (e) => { if (S.current.tool !== 'select' || !store.canDraw) return; const p = toWorld(e); const ob = topHit(p.x, p.y, 4 / view.current.z); if (ob && (ob.t === 'text' || ob.t === 'note')) openEditor(ob, p); };

  useEffect(() => { // wheel needs { passive: false } to be allowed to preventDefault (page must not scroll / browser must not zoom)
    const cv = cvRef.current; if (!cv) return undefined;
    const onWheel = (e) => {
      e.preventDefault(); const r = cv.getBoundingClientRect(); const v = view.current;
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else setView(v.x - (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX), v.y - (e.shiftKey && !e.deltaX ? 0 : e.deltaY), v.z);
    };
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => cv.removeEventListener('wheel', onWheel);
  }, [zoomAt, setView]);

  /* ---------- keyboard ---------- */
  const onKeyDown = (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    const k = e.key; const mod = e.ctrlKey || e.metaKey; let used = true;
    if (k === ' ') spaceDown.current = true;
    else if (mod && (k === 'z' || k === 'Z')) { if (e.shiftKey) store.redo(); else store.undo(); }
    else if (mod && (k === 'y' || k === 'Y')) store.redo();
    else if ((k === 'Delete' || k === 'Backspace') && sel.length && store.canDraw) { store.remove(sel); setSel([]); }
    else if (k === 'Escape') { if (sel.length) setSel([]); else onClose?.(); }
    else if (k === '+' || k === '=') zoomCenter(1.2);
    else if (k === '-') zoomCenter(1 / 1.2);
    else if (k === '0' && mod) fitContent();
    else if (!mod && !e.altKey) { const hitTool = TOOLS.find((q) => q[2].toLowerCase() === k.toLowerCase()); if (hitTool) setTool(hitTool[0]); else used = false; }
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  };
  const onKeyUp = (e) => { if (e.key === ' ') spaceDown.current = false; };

  /* ---------- export ---------- */
  const exportPng = () => {
    const all = store.list();
    // Export what is on screen (the whole visible board) PLUS any content outside it, instead of cropping to the drawn
    // objects only — a board holding just a name used to download as a tiny cut-out of that name.
    const v = view.current; const vp = { x1: -v.x / v.z, y1: -v.y / v.z, x2: (size.current.w - v.x) / v.z, y2: (size.current.h - v.y) / v.z };
    const cb = contentBounds(all);
    const pad = cb ? 40 : 0;
    const b = cb ? { x1: Math.min(vp.x1, cb.x1 - pad), y1: Math.min(vp.y1, cb.y1 - pad), x2: Math.max(vp.x2, cb.x2 + pad), y2: Math.max(vp.y2, cb.y2 + pad) } : vp;
    const scale = Math.min(2, 8000 / Math.max(1, b.x2 - b.x1), 8000 / Math.max(1, b.y2 - b.y1));
    const W = Math.max(1, Math.ceil((b.x2 - b.x1) * scale)); const H = Math.max(1, Math.ceil((b.y2 - b.y1) * scale));
    const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(scale, 0, 0, scale, -b.x1 * scale, -b.y1 * scale);
    if (bg !== 'plain') { // same grid / dots as on screen (world space, 40 units apart), so the download keeps the board's layout
      let step = 40; while ((b.x2 - b.x1) / step > 300 || (b.y2 - b.y1) / step > 300) step *= 2;
      const gx = Math.floor(b.x1 / step) * step; const gy = Math.floor(b.y1 / step) * step;
      ctx.strokeStyle = 'rgba(100,110,140,.16)'; ctx.fillStyle = 'rgba(100,110,140,.38)'; ctx.lineWidth = 1 / scale;
      if (bg === 'grid') { ctx.beginPath(); for (let x = gx; x <= b.x2; x += step) { ctx.moveTo(x, b.y1); ctx.lineTo(x, b.y2); } for (let y = gy; y <= b.y2; y += step) { ctx.moveTo(b.x1, y); ctx.lineTo(b.x2, y); } ctx.stroke(); }
      else for (let x = gx; x <= b.x2; x += step) for (let y = gy; y <= b.y2; y += step) ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    all.forEach((o) => drawObject(ctx, o));
    if (dark) { const d = document.createElement('canvas'); d.width = W; d.height = H; const dc = d.getContext('2d'); dc.filter = 'invert(1) hue-rotate(180deg)'; dc.drawImage(c, 0, 0); dc.filter = 'none'; c.getContext('2d').setTransform(1, 0, 0, 1, 0, 0); c.getContext('2d').drawImage(d, 0, 0); }
    c.toBlob((blob) => {
      if (!blob) return; const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `whiteboard-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
  };

  const setBgPref = (v) => { setBg(v); writePref('bg', v); };
  const toggleDark = () => { setDark((d) => { writePref('dark', d ? '0' : '1'); return !d; }); };
  const canDraw = store.canDraw;
  const showFill = tool === 'rect' || tool === 'ellipse';
  const showWidth = ['pen', 'hl', 'line', 'arrow', 'rect', 'ellipse'].includes(tool);
  const showText = tool === 'text';
  const showNote = tool === 'note';
  const edv = view.current;
  const edStyle = editor ? (() => {
    const z = edv.z; const left = editor.x * z + edv.x; const top = editor.y * z + edv.y;
    if (editor.kind === 'note') return { left, top, width: (editor.w || NOTE_W) * z, minHeight: Math.max(60, noteHeight({ v: '', w: editor.w || NOTE_W, h: 120 }) * z * 0.9), background: editor.c, color: '#1f2330', fontSize: 20 * z, lineHeight: `${26 * z}px`, padding: `${15 * z}px ${14 * z}px`, borderRadius: 8 * z };
    return { left, top, color: editor.c, fontSize: editor.fs * z, lineHeight: 1.3 };
  })() : null;

  return (
    <div className={`wb${dark ? ' is-dark' : ''}`} ref={wrapRef} tabIndex={0} onKeyDown={onKeyDown} onKeyUp={onKeyUp} dir="ltr" role="application" aria-label={t('Whiteboard')}>
      <canvas
        ref={cvRef} className={`wb__cv tool-${tool}${!canDraw ? ' is-view' : ''}`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onLeave} onDoubleClick={onDouble}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* top bar */}
      <div className="wb__top">
        <div className="wb__grp">
          <button type="button" className="wb__btn" onClick={() => store.undo()} disabled={!store.canUndo || !canDraw} title={`${t('Undo')} (Ctrl+Z)`} aria-label={t('Undo')}>{ICON.undo}</button>
          <button type="button" className="wb__btn" onClick={() => store.redo()} disabled={!store.canRedo || !canDraw} title={`${t('Redo')} (Ctrl+Shift+Z)`} aria-label={t('Redo')}>{ICON.redo}</button>
        </div>
        <div className="wb__grp wb__zoom">
          <button type="button" className="wb__btn" onClick={() => zoomCenter(1 / 1.2)} title={t('Zoom out')} aria-label={t('Zoom out')}>{ICON.minus}</button>
          <button type="button" className="wb__pct" onClick={() => setView(40, 40, 1)} title={t('Reset zoom')}>{zoom}%</button>
          <button type="button" className="wb__btn" onClick={() => zoomCenter(1.2)} title={t('Zoom in')} aria-label={t('Zoom in')}>{ICON.plus}</button>
          <button type="button" className="wb__btn" onClick={fitContent} title={t('Fit to content')} aria-label={t('Fit to content')}>{ICON.fit}</button>
        </div>
        <span className="wb__title">{t('Whiteboard')}{!canDraw && <em className="wb__viewonly">{t('View only')}</em>}</span>
        <div className="wb__grp">
          <button type="button" className="wb__btn" onClick={() => setBgPref(bg === 'grid' ? 'dots' : bg === 'dots' ? 'plain' : 'grid')} title={`${t('Background')}: ${bg === 'grid' ? t('Grid') : bg === 'dots' ? t('Dots') : t('Plain')}`} aria-label={t('Background')}>{ICON.grid}</button>
          <button type="button" className="wb__btn" onClick={toggleDark} title={dark ? t('Light board') : t('Dark board')} aria-label={dark ? t('Light board') : t('Dark board')}>{dark ? ICON.sun : ICON.moon}</button>
          <button type="button" className="wb__btn" onClick={exportPng} title={t('Download as image')} aria-label={t('Download as image')}>{ICON.download}</button>
          {isManager && (
            <button type="button" className={`wb__btn${store.locked ? ' is-on' : ''}`} onClick={() => store.setLocked(!store.locked)} aria-pressed={store.locked} title={store.locked ? t('Let everyone draw') : t('Only hosts can draw')} aria-label={store.locked ? t('Let everyone draw') : t('Only hosts can draw')}>{store.locked ? ICON.lock : ICON.unlock}</button>
          )}
          {canDraw && (
            <button type="button" className="wb__btn is-danger" onClick={() => setConfirmClear(true)} disabled={!store.order.length} title={t('Clear board')} aria-label={t('Clear board')}>{ICON.trash}</button>
          )}
          <button type="button" className="wb__btn" onClick={onClose} title={t('Hide whiteboard (keeps running)')} aria-label={t('Hide whiteboard (keeps running)')}>{ICON.eyeoff}</button>
          {(isManager || store.openedBy === store.myName) && (
            <button type="button" className="wb__stop" onClick={() => store.stopForAll()} title={t('Close the whiteboard for everyone')}>{ICON.close}<span>{t('End for all')}</span></button>
          )}
        </div>
      </div>

      {/* tools */}
      {canDraw ? (
        <div className="wb__tools" role="toolbar" aria-label={t('Whiteboard tools')}>
          {TOOLS.map(([id, label, key]) => (
            <button key={id} type="button" className={`wb__tool${tool === id ? ' is-on' : ''}`} onClick={() => setTool(id)} title={`${t(label)} (${key})`} aria-label={t(label)} aria-pressed={tool === id}>{ICON[id]}</button>
          ))}
        </div>
      ) : (
        <div className="wb__tools wb__tools--view" role="toolbar">
          <button type="button" className={`wb__tool${tool !== 'select' ? ' is-on' : ''}`} onClick={() => setTool('hand')} title={t('Pan')} aria-label={t('Pan')}>{ICON.hand}</button>
        </div>
      )}

      {/* style panel */}
      {canDraw && tool !== 'select' && tool !== 'hand' && tool !== 'laser' && (
        <div className="wb__style">
          {tool !== 'note' && tool !== 'eraser' && (
            <div className="wb__colors" role="radiogroup" aria-label={t('Colour')}>
              {PALETTE.map((c) => <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} className={`wb__sw${color === c ? ' is-on' : ''}`} style={{ '--c': c }} onClick={() => setColor(c)} />)}
              <label className={`wb__sw wb__sw--custom${PALETTE.includes(color) ? '' : ' is-on'}`} style={{ '--c': color }} title={t('Custom colour')}><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
            </div>
          )}
          {showNote && (
            <div className="wb__colors" role="radiogroup" aria-label={t('Note colour')}>
              {NOTE_COLORS.map((c) => <button key={c} type="button" role="radio" aria-checked={noteColor === c} aria-label={c} className={`wb__sw${noteColor === c ? ' is-on' : ''}`} style={{ '--c': c }} onClick={() => setNoteColor(c)} />)}
            </div>
          )}
          {showWidth && (
            <div className="wb__widths" role="radiogroup" aria-label={t('Thickness')}>
              {WIDTHS.map((w) => <button key={w} type="button" role="radio" aria-checked={width === w} aria-label={`${w}`} className={`wb__w${width === w ? ' is-on' : ''}`} onClick={() => setWidth(w)}><i style={{ height: Math.min(w, 12) }} /></button>)}
            </div>
          )}
          {showFill && <button type="button" className={`wb__chip${fill ? ' is-on' : ''}`} onClick={() => setFill((f) => !f)} aria-pressed={fill}>{t('Fill')}</button>}
          {showText && (
            <div className="wb__sizes" role="radiogroup" aria-label={t('Font size')}>
              {SIZES.map(([l, n]) => <button key={l} type="button" role="radio" aria-checked={fs === n} className={`wb__chip${fs === n ? ' is-on' : ''}`} onClick={() => setFs(n)}>{l}</button>)}
            </div>
          )}
          {tool === 'eraser' && <span className="wb__hintline">{t('Touch a drawing to erase it')}</span>}
        </div>
      )}

      {sel.length > 0 && canDraw && (
        <div className="wb__sel">
          <span>{sel.length} {t('selected')}</span>
          <button type="button" onClick={() => { store.remove(sel); setSel([]); }}>{ICON.trash} {t('Delete')}</button>
        </div>
      )}

      {editor && (
        <textarea
          ref={edRef} className={`wb__editor${editor.kind === 'note' ? ' is-note' : ''}`} style={edStyle} dir="auto" rows={1} spellCheck={false}
          defaultValue={editor.v} aria-label={editor.kind === 'note' ? t('Sticky note') : t('Text')} placeholder={editor.kind === 'note' ? t('Write a note…') : t('Type here…')}
          onInput={(e) => { if (editor.kind !== 'note') autoSize(e.currentTarget); }}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); closeEditor(true); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); closeEditor(true); } }}
          onBlur={() => { if (S.current.editor) closeEditor(true); }}
        />
      )}

      {confirmClear && (
        <div className="wb__modal" role="alertdialog" aria-modal="true" aria-label={t('Clear board')}>
          <div className="wb__card">
            <strong>{t('Clear the whole board for everyone?')}</strong>
            <p>{t('You can undo this right after.')}</p>
            <div className="wb__card-actions">
              <button type="button" className="wb__chip" onClick={() => setConfirmClear(false)}>{t('Cancel')}</button>
              <button type="button" className="wb__chip is-danger" onClick={() => { store.clearAll(); setSel([]); setConfirmClear(false); }}>{t('Clear')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(Whiteboard);
