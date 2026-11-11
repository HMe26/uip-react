import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import '../../styles/css/sheet.css';
import { key, parseCell, parseRange, rangeStr, addr, MAXR, MAXC, keyR, keyC } from '../../lib/sheet/addr.js';
import { E, isErr, tokenize, shiftFormula } from '../../lib/sheet/formula.js';
import { eachCell, Rng, toStr } from '../../lib/sheet/core.js';
import { FUNCS } from '../../lib/sheet/funcs.js';
import { DEF_H, DEF_W, HDR_H, HDR_W, FONT, THEMES, drawGrid, geometry, locate, displayOf, fontOf, mergeIndex } from '../../lib/sheet/draw.js';
import { fitColumn } from '../../lib/sheet/autofit.js';
import { loadThemeId, saveThemeId, themeOf } from '../../lib/sheet/themes.js';
import SheetRibbon, { FONTS } from './SheetRibbon';
import SheetFileMenu from './SheetFileMenu';
import SxIcon from './SheetIcons';
import { PromptDialog, ConfirmDialog, ShortcutsDialog, InsertFnDialog, FormatCellsDialog } from './SheetDialogs';
import { chord, browserOwned, isTextField } from '../../lib/sheet/keys.js';
import { CELL_STYLES, TABLE_STYLES, QUICK_NF, tableStylePatch } from '../../lib/sheet/presets.js';
import { sheetHtml, printHtml } from '../../lib/sheet/print.js';
import { newId as newCfId } from '../../lib/sheet/cf.js';
import { applyFilter, clearFilter } from '../../lib/sheet/filter.js';
import { newChartId, handles, HANDLE_NAMES } from '../../lib/sheet/chart.js';
import { CfRuleDialog, ManageRulesDialog, ChartDialog, FilterMenu } from './SheetCfCharts';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mkSel = (ar, ac, r2 = ar, c2 = ac) => ({ ar, ac, r1: Math.min(ar, r2), c1: Math.min(ac, c2), r2: Math.max(ar, r2), c2: Math.max(ac, c2) });
const FN_NAMES = Object.keys(FUNCS).sort();

/** Next / previous editing position that follows Excel: jump to the edge of a data block with Ctrl+Arrow. */
function jump(wb, sheet, r, c, dr, dc) {
  const has = (rr, cc) => wb.getValue(sheet, rr, cc) !== null;
  let nr = r + dr; let nc = c + dc;
  const inb = (rr, cc) => rr >= 0 && cc >= 0 && rr < MAXR && cc < MAXC;
  if (!inb(nr, nc)) return [r, c];
  if (has(r, c) && has(nr, nc)) { while (inb(nr + dr, nc + dc) && has(nr + dr, nc + dc)) { nr += dr; nc += dc; } return [nr, nc]; }
  const lastR = Math.max(sheet.maxRow, 0); const lastC = Math.max(sheet.maxCol, 0);
  while (inb(nr, nc) && !has(nr, nc)) { if ((dr > 0 && nr > lastR) || (dc > 0 && nc > lastC)) return [dr > 0 ? Math.min(MAXR - 1, nr) : nr, dc > 0 ? Math.min(MAXC - 1, nc) : nc].map((v, i) => (i === 0 ? (dr > 0 ? Math.min(lastR + 0, MAXR - 1) : v) : (dc > 0 ? Math.min(lastC + 0, MAXC - 1) : v))); nr += dr; nc += dc; }
  return inb(nr, nc) ? [nr, nc] : [clamp(nr, 0, MAXR - 1), clamp(nc, 0, MAXC - 1)];
}

export default function SheetApp({ ctl, readOnly = false, tt, rtl, onToast, saveKeyRef, actionsRef, fileName = '' }) {
  const rootRef = useRef(null);
  const shortcutRef = useRef(null); const overlayRef = useRef(false); const findOpenRef = useRef(false);
  /* Keyboard shortcuts belong to the sheet, not to the browser.
     • They are matched on the LOGICAL key (keys.js), so Ctrl+S works on an Arabic layout (where the key types "س") too.
     • While this editor is the active surface (its desktop window is focused) the combos are caught on the window in the capture phase, wherever the
       focus is — the grid, a ribbon button, the title bar, the page body — so Ctrl+S / P / F / G / H / D / U … never reach the browser. */
  useEffect(() => {
    const root = rootRef.current; if (!root) return undefined;
    const NATIVE_TEXT = new Set(['a', 'c', 'v', 'x', 'z', 'y']);
    const active = () => {
      if (!root.isConnected || root.getClientRects().length === 0) return false;
      const win = root.closest('.os-win'); if (win && (!win.classList.contains('is-active') || win.classList.contains('is-min'))) return false;
      for (const m of document.querySelectorAll('[aria-modal="true"]')) { if (!root.contains(m) && m.getClientRects().length) return false; } // another modal (e.g. "Save changes?") is on top
      return true;
    };
    const h = (e) => {
      if (e.isComposing || e.key === 'Process') return;
      const c = chord(e); const t = e.target; const inside = root.contains(t); const field = isTextField(t);
      if (readOnly) { if (inside && browserOwned(c) && !NATIVE_TEXT.has(c.k)) e.preventDefault(); return; } // read-only previews only guard their own keys
      if (!active()) return;
      if (!inside && field) return; // typing somewhere else on the site keeps its own keys
      if (overlayRef.current) { if (browserOwned(c) && !(field && c.ctrl && NATIVE_TEXT.has(c.k))) e.preventDefault(); return; } // a dialog / the File menu is open: it handles its own keys
      if (field) {
        // cell editor / formula bar / name box / find box: text editing stays native, but the browser's own UI never opens
        if (c.ctrl && !c.alt && (c.k === 's' || c.k === 'p')) { e.preventDefault(); e.stopPropagation(); shortcutRef.current?.(c, e); return; }
        if (browserOwned(c) && !(c.ctrl && NATIVE_TEXT.has(c.k))) e.preventDefault();
        return;
      }
      if (shortcutRef.current?.(c, e)) { e.preventDefault(); e.stopPropagation(); return; }
      if (browserOwned(c)) e.preventDefault();
    };
    window.addEventListener('keydown', h, true);
    if (!readOnly) requestAnimationFrame(() => root.querySelector('.sx__grid')?.focus({ preventScroll: true }));
    return () => window.removeEventListener('keydown', h, true);
  }, [readOnly]);
  const wb = ctl.wb;
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => ctl.on(force), [ctl]);
  const [six, setSix] = useState(0);
  const sheet = wb.sheets[Math.min(six, wb.sheets.length - 1)];
  const [theme, setThemeS] = useState(() => loadThemeId(readOnly));
  const setTheme = (t) => { setThemeS(t); saveThemeId(t); };
  const [view, setView] = useState({ grid: true, head: true, showF: false, bar: true, band: true, z: 1, land: false, pgrid: false, psel: false });
  const [sel, setSelS] = useState(() => mkSel(0, 0));
  const selRef = useRef(sel); selRef.current = sel;
  const setSel = useCallback((s) => { selRef.current = s; setSelS(s); }, []);
  const [edit, setEditS] = useState(null);
  const editRef = useRef(null); editRef.current = edit;
  const setEdit = useCallback((e) => { editRef.current = e; setEditS(e); }, []);
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [menu, setMenu] = useState(null);
  const [find, setFind] = useState(null);
  const [dragUi, setDragUi] = useState(null);
  const [tabEdit, setTabEdit] = useState(null);
  const [hint, setHint] = useState('');
  const [tab, setTab] = useState('home'); const [collapsed, setCollapsed] = useState(false);
  const [dlg, setDlg] = useState(null); const [fileOpen, setFileOpen] = useState(false);
  const [fmenu, setFmenu] = useState(null); const [selChart, setSelChart] = useState(null); const selChartRef = useRef(null); selChartRef.current = selChart;
  const [painter, setPainter] = useState(null); const painterRef = useRef(null); painterRef.current = painter;
  overlayRef.current = !!dlg || fileOpen || !!fmenu; findOpenRef.current = !!find;
  const scrollRef = useRef(null); const cvRef = useRef(null); const taRef = useRef(null); const mode = useRef(null); const drawRef = useRef(null);
  const sheetSel = useRef(new Map());
  const z = view.z;

  // extents of the virtual sheet grow with the data and the cursor
  const rows = Math.max(sheet.maxRow + 40, sel.r2 + 40, 120); const cols = Math.max(sheet.maxCol + 10, sel.c2 + 8, 30);
  const geom = useMemo(() => geometry(sheet, rows, cols), [sheet, rows, cols, wb.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const hw = view.head ? HDR_W : 0; const hh = view.head ? HDR_H : 0;
  const totalW = hw + geom.cx[cols] * z + 60; const totalH = hh + geom.ry[rows] * z + 60;
  const fr = Math.min(sheet.freeze.r || 0, rows - 1); const fc = Math.min(sheet.freeze.c || 0, cols - 1); const fw = geom.cx[fc] * z; const fh = geom.ry[fr] * z;
  const X = (c) => hw + geom.cx[c] * z - (c < fc ? 0 : scroll.x); const Y = (r) => hh + geom.ry[r] * z - (r < fr ? 0 : scroll.y);

  useEffect(() => {
    const el = scrollRef.current; if (!el) return undefined;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /* ---------- drawing ---------- */
  const cutRect = ctl.clip && ctl.clip.sheet === sheet ? ctl.clip.g : null;
  useLayoutEffect(() => {
    const cv = cvRef.current; if (!cv) return;
    const dpr = window.devicePixelRatio || 1; const W = size.w; const H = size.h;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = `${W}px`; cv.style.height = `${H}px`; }
    const st = { wb, sheet, geom, W, H, sx: scroll.x, sy: scroll.y, z, dpr, theme, sel, edit, showGrid: view.grid, showHead: view.head, band: view.band, showF: view.showF, readOnly, fillDrag: dragUi && dragUi.fill, cutRect, marching: 0, selChart };
    drawRef.current = (extra) => drawGrid(cv, { ...st, ...extra });
    drawGrid(cv, st);
  });
  useEffect(() => {
    if (!cutRect) return undefined; let o = 0; const t = setInterval(() => { o = (o + 1) % 9; drawRef.current && drawRef.current({ marching: o }); }, 110); return () => clearInterval(t);
  }, [cutRect]);

  /* ---------- scrolling / visibility ---------- */
  const reveal = useCallback((r, c) => {
    const el = scrollRef.current; if (!el) return;
    const g = geometry(sheet, Math.max(rows, r + 40), Math.max(cols, c + 8));
    const L = g.cx[c] * z; const R = g.cx[c + 1] * z; const T = g.ry[r] * z; const B = g.ry[r + 1] * z;
    const vw = el.clientWidth - hw; const vh = el.clientHeight - hh;
    if (c >= fc) { if (L - fw < el.scrollLeft) el.scrollLeft = Math.max(0, L - fw); else if (R > el.scrollLeft + vw) el.scrollLeft = R - vw + 16; }
    if (r >= fr) { if (T - fh < el.scrollTop) el.scrollTop = Math.max(0, T - fh); else if (B > el.scrollTop + vh) el.scrollTop = B - vh + 16; }
  }, [sheet, rows, cols, z, hw, hh, fr, fc, fw, fh]);
  const moveTo = useCallback((r, c, extend = false) => {
    const s = selRef.current; const nr = clamp(r, 0, MAXR - 1); const nc = clamp(c, 0, MAXC - 1);
    setSel(extend ? mkSel(s.ar, s.ac, nr, nc) : mkSel(nr, nc));
    requestAnimationFrame(() => reveal(nr, nc));
  }, [reveal, setSel]);

  /* ---------- helpers ---------- */
  const cur = () => selRef.current;
  const rangeOf = () => { const s = cur(); return { r1: s.r1, c1: s.c1, r2: s.r2, c2: s.c2 }; };
  const toast = (m) => { setHint(m); if (onToast) onToast(m); setTimeout(() => setHint(''), 2500); };
  const activeText = () => wb.inputText(sheet, cur().ar, cur().ac);
  const hit = (e) => {
    const el = scrollRef.current; const b = el.getBoundingClientRect(); const px = e.clientX - b.left; const py = e.clientY - b.top;
    if (px > el.clientWidth || py > el.clientHeight) return null;
    const lx = (px - hw < fw ? px - hw : px - hw + scroll.x) / z; const ly = (py - hh < fh ? py - hh : py - hh + scroll.y) / z;
    const onCol = px < hw; const onRow = py < hh;
    const c = locate(geom.cx, Math.max(0, lx)); const r = locate(geom.ry, Math.max(0, ly));
    return { px, py, c, r, corner: view.head && onCol && onRow, colHead: view.head && onRow && !onCol, rowHead: view.head && onCol && !onRow, lx, ly };
  };
  const nearEdge = (h) => {
    if (h.colHead) { const x = X(h.c + 1); if (Math.abs(h.px - x) <= 4) return { axis: 'c', idx: h.c }; const x0 = X(h.c); if (h.c > 0 && Math.abs(h.px - x0) <= 4) return { axis: 'c', idx: h.c - 1 }; }
    if (h.rowHead) { const y = Y(h.r + 1); if (Math.abs(h.py - y) <= 4) return { axis: 'r', idx: h.r }; const y0 = Y(h.r); if (h.r > 0 && Math.abs(h.py - y0) <= 4) return { axis: 'r', idx: h.r - 1 }; }
    return null;
  };
  /** AutoFilter button under the pointer → column index. */
  const filterBtnAt = (h) => {
    const f = sheet.filter; if (!f || h.colHead || h.rowHead || h.corner || h.r !== f.rng.r1 || h.c < f.rng.c1 || h.c > f.rng.c2) return null;
    const x = X(h.c); const w = (geom.cx[h.c + 1] - geom.cx[h.c]) * z; const y = Y(h.r); const hgt = (geom.ry[h.r + 1] - geom.ry[h.r]) * z;
    if (w < 22 * z) return null; const bs = Math.min(16 * z, hgt - 4); const bx = x + w - bs - 2; const by = y + hgt - bs - 2;
    return h.px >= bx && h.px <= bx + bs && h.py >= by && h.py <= by + bs ? { c: h.c, bx, by: by + bs } : null;
  };
  /** Chart under the pointer (topmost first) → { ch, grip } where grip is a handle name, 'move' or null. */
  const chartAt = (h) => {
    if (!sheet.charts.length || h.colHead || h.rowHead || h.corner) return null;
    const bo = (ch) => ({ x: hw + ch.x * z - scroll.x, y: hh + ch.y * z - scroll.y, w: ch.w * z, h: ch.h * z });
    const sel = sheet.charts.find((c) => c.id === selChartRef.current);
    if (sel && !readOnly) { const hs = handles(bo(sel)); for (let i = 0; i < hs.length; i += 1) if (Math.abs(h.px - hs[i][0]) <= 6 && Math.abs(h.py - hs[i][1]) <= 6) return { ch: sel, grip: HANDLE_NAMES[i] }; }
    for (let i = sheet.charts.length - 1; i >= 0; i -= 1) { const ch = sheet.charts[i]; const b = bo(ch); if (h.px >= b.x && h.px <= b.x + b.w && h.py >= b.y && h.py <= b.y + b.h) return { ch, grip: 'move' }; }
    return null;
  };
  const GRIP_CUR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move' };
  const onHandle = (h) => { const s = cur(); if (readOnly || editRef.current) return false; const x = X(s.c2 + 1); const y = Y(s.r2 + 1); return Math.abs(h.px - x) <= 6 && Math.abs(h.py - y) <= 6 && s.r2 - s.r1 < 5000; };

  /* ---------- editing ---------- */
  const editOn = !!edit; const editR = edit ? edit.r : -1; const editC = edit ? edit.c : -1; const editHow = edit ? edit.how : '';
  useLayoutEffect(() => { const ta = taRef.current; if (!editOn || !ta || editHow === 'bar') return; ta.focus(); const p = editRef.current ? editRef.current.caret : 0; ta.setSelectionRange(p, p); }, [editOn, editR, editC, editHow]);
  const startEdit = (text, how = 'edit', pos) => {
    if (readOnly) return; const s = cur(); const t = text ?? activeText();
    setEdit({ r: s.ar, c: s.ac, text: t, how, caret: pos ?? t.length }); requestAnimationFrame(() => { const ta = taRef.current; if (ta) { ta.focus(); const p = pos ?? t.length; ta.setSelectionRange(p, p); } });
  };
  const commit = (dr = 0, dc = 0, keep = false) => {
    const ed = editRef.current; if (!ed) return;
    const s = cur(); setEdit(null);
    const prev = wb.inputText(sheet, ed.r, ed.c);
    if (ed.text !== prev) ctl.input(sheet, ed.r, ed.c, ed.text);
    if (keep) return;
    // Enter inside a multi-cell selection cycles through it, like Excel
    if (s.r1 !== s.r2 || s.c1 !== s.c2) {
      let nr = s.ar + dr; let nc = s.ac + dc;
      if (nr > s.r2) { nr = s.r1; nc += 1; } if (nr < s.r1) { nr = s.r2; nc -= 1; } if (nc > s.c2) { nc = s.c1; nr += 1; } if (nc < s.c1) { nc = s.c2; nr -= 1; }
      setSel({ ...s, ar: clamp(nr, s.r1, s.r2), ac: clamp(nc, s.c1, s.c2) }); requestAnimationFrame(() => scrollRef.current?.focus()); return;
    }
    moveTo(ed.r + dr, ed.c + dc); requestAnimationFrame(() => scrollRef.current?.focus());
  };
  const cancel = () => { setEdit(null); requestAnimationFrame(() => scrollRef.current?.focus()); };
  const canPoint = (t, caret) => { if (!t || t[0] !== '=') return false; const p = t.slice(0, caret).replace(/\s+$/, ''); return p === '=' || /[(,+\-*/^&=<>:;{]$/.test(p); };
  const insertRef = (text) => {
    const ed = editRef.current; const ta = taRef.current; const caret = ta ? ta.selectionStart : ed.caret;
    const pt = ed.pt && ed.pt.at === caret ? ed.pt : null; const start = pt ? pt.start : caret; const end = pt ? pt.end : caret;
    const nt = ed.text.slice(0, start) + text + ed.text.slice(end); const np = start + text.length;
    setEdit({ ...ed, text: nt, caret: np, pt: { start, end: np, at: np } }); requestAnimationFrame(() => { const t2 = taRef.current; if (t2) { t2.focus(); t2.setSelectionRange(np, np); } });
  };
  const refText = (g) => `${sheet === wb.sheets[six] ? '' : ''}${rangeStr(g)}`;

  /* ---------- pointer ---------- */
  const onDown = (e) => {
    if (e.button === 2) return;
    const h = hit(e); if (!h) return; scrollRef.current.focus({ preventScroll: true }); setMenu(null);
    const ed = editRef.current;
    if (ed && !h.colHead && !h.rowHead && !h.corner) {
      const ta = taRef.current; const caret = ta ? ta.selectionStart : ed.caret;
      if (canPoint(ed.text, caret) || (ed.pt && ed.pt.at === caret)) { mode.current = { t: 'point', r: h.r, c: h.c }; insertRef(rangeStr({ r1: h.r, c1: h.c, r2: h.r, c2: h.c })); e.preventDefault(); scrollRef.current.setPointerCapture(e.pointerId); return; }
      commit(0, 0, true);
    }
    scrollRef.current.setPointerCapture(e.pointerId);
    const fb = !readOnly && filterBtnAt(h);
    if (fb) { const r0 = scrollRef.current.getBoundingClientRect(); setFmenu({ c: fb.c, x: r0.left + fb.bx - 200, y: r0.top + fb.by + 2, vw: window.innerWidth }); try { scrollRef.current.releasePointerCapture(e.pointerId); } catch { /* */ } return; }
    const cg = chartAt(h);
    if (cg) { setSelChart(cg.ch.id); selChartRef.current = cg.ch.id; if (!readOnly) mode.current = { t: 'chart', ch: cg.ch, grip: cg.grip, cx: e.clientX, cy: e.clientY, o: { x: cg.ch.x, y: cg.ch.y, w: cg.ch.w, h: cg.ch.h }, moved: false }; return; }
    if (selChartRef.current) setSelChart(null);
    if (h.corner) { setSel({ ar: 0, ac: 0, r1: 0, c1: 0, r2: MAXR - 1, c2: MAXC - 1 }); return; }
    const edge = nearEdge(h);
    if (edge && !readOnly) { const orig = edge.axis === 'c' ? (sheet.colW.get(edge.idx) ?? DEF_W) : (sheet.rowH.get(edge.idx) ?? DEF_H); const s = cur(); const group = edge.axis === 'c' ? (edge.idx >= s.c1 && edge.idx <= s.c2 ? Array.from({ length: s.c2 - s.c1 + 1 }, (_, i) => s.c1 + i) : [edge.idx]) : (edge.idx >= s.r1 && edge.idx <= s.r2 ? Array.from({ length: s.r2 - s.r1 + 1 }, (_, i) => s.r1 + i) : [edge.idx]); mode.current = { t: 'resize', edge, orig, start: edge.axis === 'c' ? h.px : h.py, group, olds: group.map((i) => (edge.axis === 'c' ? sheet.colW.get(i) : sheet.rowH.get(i))) }; return; }
    if (onHandle(h)) { mode.current = { t: 'fill', src: rangeOf() }; return; }
    if (h.colHead) { const s = cur(); const a = e.shiftKey ? s.ac : h.c; setSel({ ar: 0, ac: e.shiftKey ? s.ac : h.c, r1: 0, r2: MAXR - 1, c1: Math.min(a, h.c), c2: Math.max(a, h.c) }); mode.current = { t: 'cols', a }; return; }
    if (h.rowHead) { const s = cur(); const a = e.shiftKey ? s.ar : h.r; setSel({ ar: e.shiftKey ? s.ar : h.r, ac: 0, c1: 0, c2: MAXC - 1, r1: Math.min(a, h.r), r2: Math.max(a, h.r) }); mode.current = { t: 'rows', a }; return; }
    const m = mergeIndex(sheet).get(key(h.r, h.c));
    if (e.shiftKey) { const s = cur(); setSel(mkSel(s.ar, s.ac, h.r, h.c)); } else if (e.ctrlKey || e.metaKey) { setSel(mkSel(h.r, h.c)); } else if (m) setSel({ ar: m.r1, ac: m.c1, r1: m.r1, c1: m.c1, r2: m.r2, c2: m.c2 }); else setSel(mkSel(h.r, h.c));
    mode.current = { t: 'cells' };
  };
  const onMove = (e) => {
    const md = mode.current; const el = scrollRef.current;
    if (!md) { const h = hit(e); if (h) { const cg = chartAt(h); if (cg) { el.style.cursor = readOnly ? 'default' : (GRIP_CUR[cg.grip] || 'move'); return; } if (!readOnly && filterBtnAt(h)) { el.style.cursor = 'pointer'; return; } const edge = nearEdge(h); el.style.cursor = edge ? (edge.axis === 'c' ? 'col-resize' : 'row-resize') : onHandle(h) ? 'crosshair' : h.colHead || h.rowHead ? 'pointer' : 'cell'; } return; }
    if (md.t === 'chart') {
      const dx = (e.clientX - md.cx) / z; const dy = (e.clientY - md.cy) / z; const ch = md.ch; const o = md.o; const g = md.grip; const MINW = 120; const MINH = 90;
      let { x, y, w, h: hh2 } = o;
      if (g === 'move') { x = o.x + dx; y = o.y + dy; } else {
        if (g.includes('e')) w = Math.max(MINW, o.w + dx); if (g.includes('s')) hh2 = Math.max(MINH, o.h + dy);
        if (g.includes('w')) { w = Math.max(MINW, o.w - dx); x = o.x + o.w - w; } if (g.includes('n')) { hh2 = Math.max(MINH, o.h - dy); y = o.y + o.h - hh2; }
      }
      ch.x = Math.max(0, Math.round(x)); ch.y = Math.max(0, Math.round(y)); ch.w = Math.round(w); ch.h = Math.round(hh2); md.moved = true; wb.version += 1; force(); return;
    }
    const h = hit({ clientX: e.clientX, clientY: e.clientY }) || null; const b = el.getBoundingClientRect();
    // auto-scroll while dragging beyond the edges
    const dx = e.clientX < b.left + hw ? -20 : e.clientX > b.right - 20 ? 20 : 0; const dy = e.clientY < b.top + hh ? -20 : e.clientY > b.bottom - 20 ? 20 : 0;
    if (md.t !== 'resize' && (dx || dy)) { el.scrollLeft += dx; el.scrollTop += dy; }
    const px = clamp(e.clientX - b.left, hw, el.clientWidth - 1); const py = clamp(e.clientY - b.top, hh, el.clientHeight - 1);
    const c = locate(geom.cx, (px - hw < fw ? px - hw : px - hw + el.scrollLeft) / z); const r = locate(geom.ry, (py - hh < fh ? py - hh : py - hh + el.scrollTop) / z);
    void h;
    if (md.t === 'cells') { const s = cur(); if (s.r2 !== r || s.c2 !== c || s.ar !== s.r1) setSel(mkSel(s.ar, s.ac, r, c)); } else if (md.t === 'cols') { const s = cur(); setSel({ ...s, c1: Math.min(md.a, c), c2: Math.max(md.a, c) }); } else if (md.t === 'rows') { const s = cur(); setSel({ ...s, r1: Math.min(md.a, r), r2: Math.max(md.a, r) }); } else if (md.t === 'point') {
      const g = { r1: Math.min(md.r, r), c1: Math.min(md.c, c), r2: Math.max(md.r, r), c2: Math.max(md.c, c) }; insertRef(rangeStr(g));
    } else if (md.t === 'resize') {
      const d = ((md.edge.axis === 'c' ? e.clientX - b.left : e.clientY - b.top) - md.start) / z; const nv = Math.max(md.edge.axis === 'c' ? 12 : 8, Math.round(md.orig + d));
      md.group.forEach((i) => { if (md.edge.axis === 'c') { sheet.colW.set(i, nv); sheet.manualW.add(i); } else sheet.rowH.set(i, nv); }); md.val = nv; wb.version += 1; force();
    } else if (md.t === 'fill') {
      const s0 = md.src; let dst = null;
      if (r > s0.r2 && Math.abs(r - s0.r2) >= Math.abs(c - s0.c2) * 0.6 || (r > s0.r2 && c >= s0.c1 && c <= s0.c2)) dst = { r1: s0.r2 + 1, r2: r, c1: s0.c1, c2: s0.c2 };
      else if (r < s0.r1 && c >= s0.c1 && c <= s0.c2) dst = { r1: r, r2: s0.r1 - 1, c1: s0.c1, c2: s0.c2 };
      else if (c > s0.c2) dst = { c1: s0.c2 + 1, c2: c, r1: s0.r1, r2: s0.r2 };
      else if (c < s0.c1) dst = { c1: c, c2: s0.c1 - 1, r1: s0.r1, r2: s0.r2 };
      md.dst = dst; setDragUi(dst ? { fill: { r1: Math.min(s0.r1, dst.r1), c1: Math.min(s0.c1, dst.c1), r2: Math.max(s0.r2, dst.r2), c2: Math.max(s0.c2, dst.c2) } } : null);
    }
  };
  const onUp = (e) => {
    const md = mode.current; mode.current = null; try { scrollRef.current.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (!md) return;
    if (md.t === 'cells' && painterRef.current) { const pst = painterRef.current.style; setPainter(null); ctl.style(sheet, rangeOf(), { b: null, i: null, u: null, st: null, font: null, fs: null, color: null, bg: null, al: null, va: null, wrap: null, ind: null, nf: null, bd: null, ...pst }); }
    if (md.t === 'resize') { md.group.forEach((i, k) => { if (md.edge.axis === 'c') { if (md.olds[k] === undefined) sheet.colW.delete(i); else sheet.colW.set(i, md.olds[k]); } else if (md.olds[k] === undefined) sheet.rowH.delete(i); else sheet.rowH.set(i, md.olds[k]); }); if (md.val) { if (md.edge.axis === 'c') ctl.setColW(sheet, md.group, md.val); else ctl.setRowH(sheet, md.group, md.val); } }
    if (md.t === 'fill') { setDragUi(null); if (md.dst) { ctl.fill(sheet, md.src, md.dst); setSel(mkSel(Math.min(md.src.r1, md.dst.r1), Math.min(md.src.c1, md.dst.c1), Math.max(md.src.r2, md.dst.r2), Math.max(md.src.c2, md.dst.c2))); } }
    if (md.t === 'chart' && md.moved) { const ch = md.ch; const nv = { x: ch.x, y: ch.y, w: ch.w, h: ch.h }; Object.assign(ch, md.o); ctl.run(sheet, 'all', () => { Object.assign(ch, nv); }); }
    if (md.t === 'point') requestAnimationFrame(() => taRef.current?.focus());
  };
  const autofit = (axis, idx) => {
    if (axis === 'c') { const s = cur(); const cols = idx >= s.c1 && idx <= s.c2 && s.c2 > s.c1 ? Array.from({ length: s.c2 - s.c1 + 1 }, (_, i) => s.c1 + i) : [idx]; cols.forEach((c) => { const w = fitColumn(wb, sheet, c); ctl.setColW(sheet, [c], w, true); }); return; }
    const cv = document.createElement('canvas').getContext('2d');
    { let mh = DEF_H; for (let c = 0; c <= Math.min(sheet.maxCol, 200); c += 1) { const d = displayOf(wb, sheet, idx, c, false); if (d.st.wrap && d.text) { cv.font = fontOf(d.st, 1); const w = sheet.colW.get(c) ?? DEF_W; const lines = Math.ceil(cv.measureText(d.text).width / Math.max(10, w - 8)); mh = Math.max(mh, lines * 19 + 5); } else if (d.st.fs) mh = Math.max(mh, d.st.fs * 1.333 * 1.3 + 6); } ctl.setRowH(sheet, [idx], mh > DEF_H ? Math.ceil(mh) : null); }
  };
  const onDbl = (e) => {
    const h = hit(e); if (!h) return; const edge = nearEdge(h); if (edge && !readOnly) { autofit(edge.axis, edge.idx); return; }
    if (h.colHead || h.rowHead || h.corner) return;
    const cg = chartAt(h); if (cg) { if (!readOnly) A.openDialog('chart', { chart: cg.ch }); return; }
    if (filterBtnAt(h)) return;
    if (!readOnly) { const m = mergeIndex(sheet).get(key(h.r, h.c)); if (m) setSel({ ar: m.r1, ac: m.c1, r1: m.r1, c1: m.c1, r2: m.r2, c2: m.c2 }); else setSel(mkSel(h.r, h.c)); const t = wb.inputText(sheet, h.r, h.c); setEdit({ r: m ? m.r1 : h.r, c: m ? m.c1 : h.c, text: t, how: 'edit', caret: t.length }); requestAnimationFrame(() => { const ta = taRef.current; if (ta) { ta.focus(); ta.setSelectionRange(t.length, t.length); } }); }
  };
  const onCtx = (e) => {
    e.preventDefault(); const h = hit(e); if (!h) return; const s = cur();
    const cg = chartAt(h); if (cg) { setSelChart(cg.ch.id); selChartRef.current = cg.ch.id; setMenu({ x: e.clientX, y: e.clientY, kind: 'chart', id: cg.ch.id }); return; }
    if (!(h.r >= s.r1 && h.r <= s.r2 && h.c >= s.c1 && h.c <= s.c2) || h.colHead || h.rowHead) {
      if (h.colHead) setSel({ ar: 0, ac: h.c, r1: 0, r2: MAXR - 1, c1: h.c, c2: h.c }); else if (h.rowHead) setSel({ ar: h.r, ac: 0, c1: 0, c2: MAXC - 1, r1: h.r, r2: h.r }); else if (!h.corner) setSel(mkSel(h.r, h.c));
    }
    setMenu({ x: e.clientX, y: e.clientY, kind: h.colHead ? 'col' : h.rowHead ? 'row' : 'cell' });
  };

  /** The block of data around the active cell (Excel's "current region"), or the selection when it already spans several cells. */
  const regionOf = () => {
    const s = cur(); if (s.r1 !== s.r2 || s.c1 !== s.c2) return rangeOf();
    const has = (rr, cc) => rr >= 0 && cc >= 0 && wb.getValue(sheet, rr, cc) !== null;
    let r1 = s.ar; let r2 = s.ar; let c1 = s.ac; let c2 = s.ac; let grew = true; let guard = 0;
    const rowHas = (rr) => { for (let cc = Math.max(0, c1 - 1); cc <= c2 + 1; cc += 1) if (has(rr, cc)) return true; return false; };
    const colHas = (cc) => { for (let rr = Math.max(0, r1 - 1); rr <= r2 + 1; rr += 1) if (has(rr, cc)) return true; return false; };
    while (grew && guard < 400) { grew = false; guard += 1; if (r1 > 0 && rowHas(r1 - 1)) { r1 -= 1; grew = true; } if (r2 < sheet.maxRow && rowHas(r2 + 1)) { r2 += 1; grew = true; } if (c1 > 0 && colHas(c1 - 1)) { c1 -= 1; grew = true; } if (c2 < sheet.maxCol && colHas(c2 + 1)) { c2 += 1; grew = true; } }
    return { r1, c1, r2, c2 };
  };
  const gotoSheet = (i) => { setFmenu(null); setSelChart(null); sheetSel.current.set(six, sel); setSix(i); setSel(sheetSel.current.get(i) || mkSel(0, 0)); setEdit(null); };

  /* ---------- actions (used by ribbon, menu and keyboard) ---------- */
  const A = {
    sheet, sel, edit, view, theme, wb, ctl, readOnly, autofit,
    setView: (p) => setView((v) => ({ ...v, ...p })), setTheme,
    range: rangeOf,
    style: (patch) => { if (editRef.current) commit(0, 0, true); ctl.style(sheet, rangeOf(), patch); },
    toggle: (prop) => ctl.toggle(sheet, rangeOf(), prop),
    borders: (m, st, col) => ctl.borders(sheet, rangeOf(), m, st, col),
    merge: (on = true) => ctl.merge(sheet, rangeOf(), on),
    clear: (what) => ctl.clear(sheet, rangeOf(), what),
    copy: async (cut = false) => { const t = ctl.copy(sheet, rangeOf(), cut); try { await navigator.clipboard.writeText(t); } catch { /* clipboard blocked */ } force(); },
    paste: async (modeP = 'all') => {
      const s = cur(); let text; try { text = await navigator.clipboard.readText(); } catch { text = undefined; }
      if (ctl.clip && (text === undefined || text === ctl.clip.tsv)) { const g = ctl.paste(sheet, s.r1, s.c1, { mode: modeP }); if (g) setSel({ ar: g.r1, ac: g.c1, r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2 }); } else if (text) { const g = ctl.paste(sheet, s.r1, s.c1, { text }); if (g) setSel({ ar: g.r1, ac: g.c1, r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2 }); } else toast(tt('Clipboard access was blocked — use Ctrl+V.', 'الحافظة محجوبة — استخدم Ctrl+V.'));
    },
    undo: () => { const s = ctl.undo(); if (s) { const i = wb.sheets.indexOf(s); if (i >= 0) setSix(i); } }, redo: () => { const s = ctl.redo(); if (s) { const i = wb.sheets.indexOf(s); if (i >= 0) setSix(i); } },
    fillDown: () => { const s = cur(); if (s.r1 === s.r2) return; ctl.fill(sheet, { r1: s.r1, c1: s.c1, r2: s.r1, c2: s.c2 }, { r1: s.r1 + 1, c1: s.c1, r2: s.r2, c2: s.c2 }); },
    fillRight: () => { const s = cur(); if (s.c1 === s.c2) return; ctl.fill(sheet, { r1: s.r1, c1: s.c1, r2: s.r2, c2: s.c1 }, { r1: s.r1, c1: s.c1 + 1, r2: s.r2, c2: s.c2 }); },
    insertRows: () => { const s = cur(); ctl.insert(sheet, 'r', s.r1, s.r2 - s.r1 + 1); }, deleteRows: () => { const s = cur(); ctl.remove(sheet, 'r', s.r1, s.r2 - s.r1 + 1); },
    insertCols: () => { const s = cur(); ctl.insert(sheet, 'c', s.c1, s.c2 - s.c1 + 1); }, deleteCols: () => { const s = cur(); ctl.remove(sheet, 'c', s.c1, s.c2 - s.c1 + 1); },
    hide: (axis, on) => { const s = cur(); const idx = axis === 'r' ? Array.from({ length: s.r2 - s.r1 + 1 }, (_, i) => s.r1 + i) : Array.from({ length: s.c2 - s.c1 + 1 }, (_, i) => s.c1 + i); ctl.hide(sheet, axis, idx, on); },
    unhideAll: () => { ctl.hide(sheet, 'r', [...sheet.hiddenRows], false); ctl.hide(sheet, 'c', [...sheet.hiddenCols], false); },
    sort: (asc) => {
      const s = cur(); let g = { r1: s.r1, c1: s.c1, r2: s.r2, c2: s.c2 };
      if (s.r1 === s.r2 && s.c1 === s.c2) { let r1 = s.ar; let r2 = s.ar; while (r1 > 0 && wb.getValue(sheet, r1 - 1, s.ac) !== null) r1 -= 1; while (r2 < sheet.maxRow && wb.getValue(sheet, r2 + 1, s.ac) !== null) r2 += 1; let c1 = s.ac; let c2 = s.ac; while (c1 > 0 && wb.getValue(sheet, s.ar, c1 - 1) !== null) c1 -= 1; while (c2 < sheet.maxCol && wb.getValue(sheet, s.ar, c2 + 1) !== null) c2 += 1; g = { r1, c1, r2, c2 }; setSel({ ...mkSel(g.r1, g.c1, g.r2, g.c2), ar: s.ar, ac: s.ac }); }
      const hdr = typeof wb.getValue(sheet, g.r1, s.ac) === 'string' && g.r2 > g.r1 && typeof wb.getValue(sheet, g.r1 + 1, s.ac) === 'number';
      ctl.sort(sheet, g, s.ac, asc, hdr);
    },
    autoSum: () => A.autoFn('SUM'),
    autoFn: (fn = 'SUM') => {
      const s = cur(); if (editRef.current) return;
      if (s.r1 === s.r2 && s.c1 === s.c2) { let r = s.ar - 1; while (r >= 0 && typeof wb.getValue(sheet, r, s.ac) === 'number') r -= 1; if (r === s.ar - 1) { let c = s.ac - 1; while (c >= 0 && typeof wb.getValue(sheet, s.ar, c) === 'number') c -= 1; if (c === s.ac - 1) { startEdit(`=${fn}()`, 'edit', fn.length + 2); return; } ctl.input(sheet, s.ar, s.ac, `=${fn}(${rangeStr({ r1: s.ar, c1: c + 1, r2: s.ar, c2: s.ac - 1 })})`); return; } ctl.input(sheet, s.ar, s.ac, `=${fn}(${rangeStr({ r1: r + 1, c1: s.ac, r2: s.ar - 1, c2: s.ac })})`); return; }
      const ks = []; const w = s.c2 - s.c1 + 1; const h = s.r2 - s.r1 + 1; void ks;
      ctl.run(sheet, Array.from({ length: w }, (_, i) => key(s.r2 + 1, s.c1 + i)), () => { for (let i = 0; i < w; i += 1) wb.setFormula(sheet, s.r2 + 1, s.c1 + i, `${fn}(${rangeStr({ r1: s.r1, c1: s.c1 + i, r2: s.r2, c2: s.c1 + i })})`); }); void h;
    },
    /* ---- added: ribbon / dialog / file actions ---- */
    fonts: FONTS, painter: !!painter,
    togglePainter: () => {
      if (painterRef.current) { setPainter(null); return; }
      const s = cur(); setPainter({ style: { ...(wb.styleOf(sheet, s.ar, s.ac) || {}) } }); toast(tt('Format Painter: select the cells to format (Esc to cancel)', 'ناسخ التنسيق: حدّد الخلايا المراد تنسيقها (Esc للإلغاء)'));
    },
    cellStyle: (cs) => { ctl.style(sheet, rangeOf(), cs.patch); },
    tableStyle: (ts) => { const g = regionOf(); ctl.style(sheet, g, tableStylePatch(ts, g)); setSel(mkSel(g.r1, g.c1, g.r2, g.c2)); },
    openDialog: (type, payload = {}) => {
      if (editRef.current) commit(0, 0, true);
      if (type === 'goto') {
        const names = [...wb.names.values()].filter((n) => n.ref).map((n) => ({ name: n.name, ref: `${n.ref.sheet}!${rangeStr(n.ref)}` }));
        setDlg({ type: 'prompt', title: tt('Go To', 'اذهب إلى'), label: tt('Reference (e.g. B12, A1:C9 or a name)', 'المرجع (مثال B12 أو A1:C9 أو اسم)'), value: '', names, okLabel: tt('Go', 'اذهب'), onOk: (v) => (A.goto(v) ? true : tt('The reference is not valid.', 'المرجع غير صالح.')) });
      } else setDlg({ type, ...payload });
    },
    /* ---- conditional formatting / filter / charts ---- */
    cfSave: (r, id) => {
      ctl.run(sheet, 'all', () => {
        if (id) { const i = sheet.cf.findIndex((x) => x.id === id); if (i >= 0) { sheet.cf[i] = { ...r, id }; return; } }
        sheet.cf.unshift({ ...r, id: newCfId() });
      });
    },
    cfPreset: (kind, params = {}, fmt) => { if (editRef.current) commit(0, 0, true); A.cfSave({ kind, rng: rangeOf(), ...params, ...(fmt ? { fmt: { ...fmt } } : {}) }); },
    cfClear: (what) => {
      const g = rangeOf();
      ctl.run(sheet, 'all', () => { sheet.cf = what === 'sheet' ? [] : sheet.cf.filter((r) => !(r.rng.r1 <= g.r2 && r.rng.r2 >= g.r1 && r.rng.c1 <= g.c2 && r.rng.c2 >= g.c1)); });
    },
    cfDelete: (id) => ctl.run(sheet, 'all', () => { sheet.cf = sheet.cf.filter((r) => r.id !== id); }),
    cfMove: (id, d) => ctl.run(sheet, 'all', () => { const i = sheet.cf.findIndex((r) => r.id === id); const j = i + d; if (i < 0 || j < 0 || j >= sheet.cf.length) return; [sheet.cf[i], sheet.cf[j]] = [sheet.cf[j], sheet.cf[i]]; }),
    filterToggle: () => {
      if (editRef.current) commit(0, 0, true);
      if (sheet.filter) { ctl.run(sheet, 'all', () => clearFilter(wb, sheet)); return; }
      const g = regionOf(); if (g.r1 === g.r2 && wb.getValue(sheet, g.r1, g.c1) === null) { toast(tt('Select a cell inside your data first.', 'حدّد خلية جوه البيانات الأول.')); return; }
      ctl.run(sheet, 'all', () => { sheet.filter = { rng: g, cols: {}, hidden: new Set() }; });
    },
    filterSet: (c, allow) => ctl.run(sheet, 'all', () => { const f = sheet.filter; if (!f) return; if (allow === null) delete f.cols[c]; else f.cols[c] = { allow }; applyFilter(wb, sheet); }),
    filterClearAll: () => ctl.run(sheet, 'all', () => { const f = sheet.filter; if (!f) return; f.cols = {}; applyFilter(wb, sheet); }),
    filterReapply: () => ctl.run(sheet, 'all', () => applyFilter(wb, sheet)),
    filterSort: (c, asc) => { const f = sheet.filter; if (f) ctl.sort(sheet, f.rng, c, asc, true, () => applyFilter(wb, sheet)); },
    chartSave: (p, id) => {
      let newSel = id;
      ctl.run(sheet, 'all', () => {
        if (id) { const ch = sheet.charts.find((x) => x.id === id); if (ch) { Object.assign(ch, p); delete ch._d; } return; }
        const W = 480; const Hh = 288; const gx = Math.min(p.rng.c2 + 1, cols); const x = geom.cx[gx] + 24; const y = geom.ry[Math.min(p.rng.r1, rows)];
        const ch = { id: newChartId(), x: Math.round(x), y: Math.round(y), w: W, h: Hh, ...p }; sheet.charts.push(ch); newSel = ch.id;
      });
      setSelChart(newSel);
    },
    chartInsert: (ctype) => {
      if (editRef.current) commit(0, 0, true);
      const g = regionOf(); if (g.r1 === g.r2 && g.c1 === g.c2 && wb.getValue(sheet, g.r1, g.c1) === null) { toast(tt('Select the data to chart first.', 'حدّد البيانات الأول.')); return; }
      A.openDialog('chart', { ctype, rng: g });
    },
    chartDelete: () => { const id = selChartRef.current; if (!id) return; setSelChart(null); ctl.run(sheet, 'all', () => { sheet.charts = sheet.charts.filter((c) => c.id !== id); }); },
    chart: () => sheet.charts.find((c) => c.id === selChartRef.current) || null,
    openFileMenu: () => { if (editRef.current) commit(0, 0, true); setFileOpen(true); },
    toggleRibbon: () => setCollapsed((c) => !c),
    file: {
      save: async () => {
        if (readOnly) return;
        if (editRef.current) commit(0, 0, true);
        if (!ctl.dirty) { toast(tt('No changes to save.', 'مفيش تعديلات للحفظ.')); return; }
        const ok = saveKeyRef?.current ? await saveKeyRef.current() : false; if (ok) toast(tt('Saved.', 'تم الحفظ.'));
      },
      download: () => { if (editRef.current) commit(0, 0, true); actionsRef?.current?.download?.(); },
      exportAs: (ext) => { if (editRef.current) commit(0, 0, true); actionsRef?.current?.exportAs?.(ext, six); },
      close: () => actionsRef?.current?.close?.(),
    },
    print: () => {
      if (editRef.current) commit(0, 0, true);
      const s = cur(); const part = view.psel && (s.r1 !== s.r2 || s.c1 !== s.c2);
      const range = part ? { r1: s.r1, c1: s.c1, r2: Math.min(s.r2, Math.max(sheet.maxRow, s.r1)), c2: Math.min(s.c2, Math.max(sheet.maxCol, s.c1)) } : null;
      if (!part && sheet.maxRow < 0) { toast(tt('The sheet is empty — nothing to print.', 'الورقة فاضية — مفيش حاجة للطباعة.')); return; }
      printHtml(sheetHtml(wb, sheet, { range, grid: !!view.pgrid, landscape: !!view.land, title: `${fileName} — ${sheet.name}`, rtl }));
    },
    newSheet: () => { let n = wb.sheets.length + 1; while (wb.sheetByName(`Sheet${n}`)) n += 1; ctl.addSheet(`Sheet${n}`); setSix(wb.sheets.length - 1); setSel(mkSel(0, 0)); setEdit(null); },
    deleteSheet: () => { if (wb.sheets.length < 2) return; setDlg({ type: 'confirm', title: tt('Delete sheet', 'حذف الورقة'), label: tt(`Delete “${sheet.name}”? This can be undone with Ctrl+Z only until you save.`, `حذف «${sheet.name}»؟`), okLabel: tt('Delete', 'حذف'), onOk: () => { ctl.deleteSheet(sheet); setSix(0); setSel(mkSel(0, 0)); } }); },
    renameSheet: () => setDlg({ type: 'prompt', title: tt('Rename sheet', 'إعادة تسمية الورقة'), label: tt('Sheet name', 'اسم الورقة'), value: sheet.name, onOk: (v) => { const n = v.trim(); if (!n) return tt('Enter a name.', 'اكتب اسم.'); if (n !== sheet.name && wb.sheetByName(n)) return tt('A sheet with this name already exists.', 'فيه ورقة بنفس الاسم.'); ctl.renameSheet(sheet, n); return true; } }),
    askRowH: () => { const s = cur(); setDlg({ type: 'prompt', title: tt('Row Height', 'ارتفاع الصف'), label: tt('Row height (pixels)', 'ارتفاع الصف (بكسل)'), value: String(sheet.rowH.get(s.r1) ?? DEF_H), onOk: (v) => { const n = +v; if (!(n > 0 && n < 1000)) return tt('Enter a number between 1 and 999.', 'اكتب رقم من 1 لـ 999.'); ctl.setRowH(sheet, Array.from({ length: s.r2 - s.r1 + 1 }, (_, i) => s.r1 + i), n); return true; } }); },
    askColW: () => { const s = cur(); setDlg({ type: 'prompt', title: tt('Column Width', 'عرض العمود'), label: tt('Column width (pixels)', 'عرض العمود (بكسل)'), value: String(sheet.colW.get(s.c1) ?? DEF_W), onOk: (v) => { const n = +v; if (!(n > 0 && n < 2000)) return tt('Enter a number between 1 and 1999.', 'اكتب رقم من 1 لـ 1999.'); ctl.setColW(sheet, Array.from({ length: s.c2 - s.c1 + 1 }, (_, i) => s.c1 + i), n); return true; } }); },
    askName: () => setDlg({ type: 'prompt', title: tt('Define Name', 'تعريف اسم'), label: tt('Name for the selection', 'اسم للتحديد'), value: '', hint: tt('Letters, digits, _ and . — it must start with a letter or _.', 'حروف وأرقام و _ و . — لازم يبدأ بحرف أو _.'), onOk: (v) => { if (!/^[A-Za-z_][\w.]*$/.test(v) || parseCell(v)) return tt('This is not a valid name.', 'الاسم ده غير صالح.'); A.defineName(v); return true; } }),
    stamp: (withTime) => { if (readOnly) return; const s = cur(); const d = new Date(); ctl.input(sheet, s.ar, s.ac, withTime ? `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`); },
    zoomTo: (v) => setView((o) => ({ ...o, z: clamp(Math.round(v * 100) / 100, 0.4, 3) })),
    zoomBy: (d) => setView((o) => ({ ...o, z: clamp(Math.round((o.z + d) * 10) / 10, 0.4, 3) })),
    zoomSel: () => {
      const s = cur(); const sw = geom.cx[Math.min(s.c2 + 1, cols)] - geom.cx[s.c1]; const sh = geom.ry[Math.min(s.r2 + 1, rows)] - geom.ry[s.r1]; if (!(sw > 0 && sh > 0)) return;
      const nz = clamp(Math.floor(Math.min((size.w - hw - 20) / sw, (size.h - hh - 20) / sh) * 100) / 100, 0.4, 3); setView((o) => ({ ...o, z: nz }));
      requestAnimationFrame(() => { const el = scrollRef.current; if (el) { el.scrollLeft = geom.cx[s.c1] * nz; el.scrollTop = geom.ry[s.r1] * nz; } });
    },
    recalc: () => { wb.touch(); force(); toast(tt('Recalculated.', 'تمت إعادة الحساب.')); },
    selectAll: () => { const s = cur(); if (s.r1 === 0 && s.c1 === 0 && s.r2 >= sheet.maxRow && s.c2 >= sheet.maxCol) return setSel({ ar: 0, ac: 0, r1: 0, c1: 0, r2: MAXR - 1, c2: MAXC - 1 }); return setSel({ ar: s.ar, ac: s.ac, r1: 0, c1: 0, r2: Math.max(sheet.maxRow, 0), c2: Math.max(sheet.maxCol, 0) }); },
    hideSmart: () => { const s = cur(); A.hide(s.r1 === 0 && s.r2 >= MAXR - 1 ? 'c' : 'r', true); },
    gotoSheetByObj: (sh) => { const i = wb.sheets.indexOf(sh); if (i >= 0 && i !== six) gotoSheet(i); },
    stepSheet: (d) => { const n = clamp(six + d, 0, wb.sheets.length - 1); if (n !== six) gotoSheet(n); },
    insertFn: (name) => { if (editRef.current) { const ed = editRef.current; const t = ed.text[0] === '=' ? ed.text + name + '(' : `=${name}(`; setEdit({ ...ed, text: t, caret: t.length }); requestAnimationFrame(() => taRef.current?.focus()); } else startEdit(`=${name}()`, 'edit', name.length + 2); },
    goto: (txt) => {
      const t = txt.trim(); const nm = wb.names.get(t.toUpperCase());
      if (nm && nm.ref) { const i = wb.sheets.findIndex((s) => s.name === nm.ref.sheet); if (i >= 0) setSix(i); setSel(mkSel(nm.ref.r1, nm.ref.c1, nm.ref.r2, nm.ref.c2)); requestAnimationFrame(() => reveal(nm.ref.r1, nm.ref.c1)); return true; }
      let body = t; let sh = null; const m = /^(?:'([^']+)'|([\w.]+))!(.+)$/.exec(t); if (m) { sh = wb.sheetByName(m[1] || m[2]); body = m[3]; if (!sh) return false; }
      const g = parseRange(body); if (!g) return false;
      if (sh) setSix(wb.sheets.indexOf(sh));
      const wholeCol = /^\$?[A-Za-z]+:\$?[A-Za-z]+$/.test(body); const wholeRow = /^\$?\d+:\$?\d+$/.test(body);
      setSel({ ar: g.r1, ac: g.c1, r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2, ...(wholeCol || wholeRow ? {} : {}) }); requestAnimationFrame(() => reveal(g.r1, g.c1)); return true;
    },
    defineName: (name) => { const s = cur(); wb.names.set(name.toUpperCase(), { name, ref: { sheet: sheet.name, r1: s.r1, c1: s.c1, r2: s.r2, c2: s.c2 } }); wb.touch(); ctl.emit(); },
    openFind: (replace = false) => setFind((f) => ({ q: f?.q || '', rep: f?.rep || '', replace, cs: f?.cs || false, whole: f?.whole || false, scope: f?.scope || 'sheet', n: 0 })),
    freeze: (r, c) => ctl.freeze(sheet, r, c),
    activeText, startEdit,
  };

  /* ---------- keyboard (grid focus) ---------- */
  /** Every non-typing shortcut (Ctrl / F-keys / Alt+…). Returns true when it handled the key. Matches the logical key, so it works on any keyboard layout. */
  const shortcut = (c) => {
    const { k, ctrl, shift, alt } = c; const s = cur();
    if (readOnly) {
      if (ctrl && !alt && !shift) { if (k === 'a') { A.selectAll(); return true; } if (k === 'c') { A.copy(false); return true; } if (k === 'f') { A.openFind(false); return true; } if (k === 'g') { A.openDialog('goto'); return true; } }
      return false;
    }
    if (!ctrl && !alt) {
      if (k === 'F1') { A.openDialog('shortcuts'); return true; }
      if (shift && k === 'F3') { A.openDialog('insertfn'); return true; }
      if (shift && k === 'F11') { A.newSheet(); return true; }
      if (shift) return false;
      if (k === 'F2') { startEdit(activeText(), 'edit'); return true; }
      if (k === 'F5') { A.openDialog('goto'); return true; }
      if (k === 'F9') { A.recalc(); return true; }
      if (k === 'F3') return true; // the browser's "find next" must not open
      return false;
    }
    if (alt && !ctrl) {
      if (k === '=') { A.autoFn('SUM'); return true; }
      if (k === 'PageDown') { moveTo(s.ar, s.ac + 8, shift); return true; }
      if (k === 'PageUp') { moveTo(s.ar, s.ac - 8, shift); return true; }
      return false; // Alt+letters belong to the desktop (Alt+S, Alt+E …)
    }
    if (!ctrl || alt) return false;
    // ---- Ctrl combos ----
    if (k === 's') { if (shift) A.file.download(); else A.file.save(); return true; }
    if (k === 'p') { A.print(); return true; }
    if (k === 'F1') { A.toggleRibbon(); return true; }
    if (k === 'PageDown' || k === 'PageUp') { if (shift) return false; A.stepSheet(k === 'PageDown' ? 1 : -1); return true; }
    if (k === 'v') { scrollRef.current?.focus({ preventScroll: true }); return false; } // let the native paste event land on the grid
    if (k === 'a' && !shift) { A.selectAll(); return true; }
    if (k === 'c' && !shift) { A.copy(false); return true; }
    if (k === 'x' && !shift) { A.copy(true); return true; }
    if (k === 'f' && !shift) { A.openFind(false); return true; }
    if (k === 'h' && !shift) { A.openFind(true); return true; }
    if (k === 'g' && !shift) { A.openDialog('goto'); return true; }
    if (k === 'z') { if (shift) A.redo(); else A.undo(); return true; }
    if (k === 'y') { A.redo(); return true; }
    if (k === 'b' && !shift) { A.toggle('b'); return true; }
    if (k === 'i' && !shift) { A.toggle('i'); return true; }
    if (k === 'u' && !shift) { A.toggle('u'); return true; }
    if (k === '5' && !shift) { A.toggle('st'); return true; }
    if (k === 'd' && !shift) { A.fillDown(); return true; }
    if (k === 'r' && !shift) { A.fillRight(); return true; }
    if (k === 'l' && !shift) { A.tableStyle(TABLE_STYLES[0]); return true; }
    if (k === 'l' && shift) { A.filterToggle(); return true; }
    if (k === ';') { A.stamp(shift); return true; }
    if (k === '1' && !shift) { A.openDialog('format'); return true; }
    if (k === '`' && !shift) { A.setView({ showF: !view.showF }); return true; }
    if (shift && QUICK_NF[k]) { A.style({ nf: QUICK_NF[k] === 'General' ? null : QUICK_NF[k] }); return true; }
    if (shift && k === '7') { A.borders('outer'); return true; }
    if (shift && k === '-') { A.borders('none'); return true; }
    if (k === '9' || k === '0') { const axis = k === '9' ? 'r' : 'c'; if (shift) { const g = rangeOf(); const lo = axis === 'r' ? g.r1 - 1 : g.c1 - 1; const hi = axis === 'r' ? g.r2 + 1 : g.c2 + 1; ctl.hide(sheet, axis, Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter((i) => i >= 0), false); } else A.hide(axis, true); return true; }
    if (k === ' ' && !shift) { setSel({ ...s, c1: s.c1, c2: s.c2, r1: 0, r2: MAXR - 1, ar: 0 }); return true; }
    if (k === '-' && !shift) { if (s.r1 === 0 && s.r2 >= MAXR - 1) A.deleteCols(); else if (s.c1 === 0 && s.c2 >= MAXC - 1) A.deleteRows(); else setMenu({ x: 200, y: 200, kind: 'cell' }); return true; }
    if (k === '=' || k === '+') { if (s.r1 === 0 && s.r2 >= MAXR - 1) A.insertCols(); else if (s.c1 === 0 && s.c2 >= MAXC - 1) A.insertRows(); else setMenu({ x: 200, y: 200, kind: 'cell' }); return true; }
    return false;
  };
  shortcutRef.current = shortcut;

  const onKey = (e) => {
    if (editRef.current) return;
    if (shortcut(chord(e))) { e.preventDefault(); return; }
    const s = cur(); const k = e.key; const ctrl = e.ctrlKey || e.metaKey; const shift = e.shiftKey;
    const nav = (dr, dc) => {
      e.preventDefault(); const ext = shift;
      const base = ext ? [s.ar === s.r1 ? s.r2 : s.r1, s.ac === s.c1 ? s.c2 : s.c1] : [s.ar, s.ac];
      let [nr, nc] = ctrl ? jump(wb, sheet, base[0], base[1], dr, dc) : [base[0] + dr, base[1] + dc];
      const skip = (rr, cc) => (dr && sheet.hiddenRows.has(rr)) || (dc && sheet.hiddenCols.has(cc));
      while (skip(nr, nc) && nr > 0 && nc > 0 && nr < MAXR - 1) { nr += dr; nc += dc; }
      moveTo(nr, nc, ext);
    };
    if (k === 'ArrowDown') return nav(1, 0); if (k === 'ArrowUp') return nav(-1, 0); if (k === 'ArrowLeft') return nav(0, -1); if (k === 'ArrowRight') return nav(0, 1);
    if (k === 'PageDown') { e.preventDefault(); return moveTo(s.ar + 20, s.ac, shift); } if (k === 'PageUp') { e.preventDefault(); return moveTo(s.ar - 20, s.ac, shift); }
    if (k === 'Home') { e.preventDefault(); return ctrl ? moveTo(0, 0, shift) : moveTo(s.ar, 0, shift); }
    if (k === 'End' && ctrl) { e.preventDefault(); return moveTo(sheet.maxRow, sheet.maxCol, shift); }
    if (k === 'Tab') { e.preventDefault(); return shift ? moveTo(s.ar, s.ac - 1) : moveTo(s.ar, s.ac + 1); }
    if (k === 'Enter') {
      e.preventDefault(); if (readOnly) return moveTo(s.ar + 1, s.ac);
      if (ctrl) return startEdit(activeText(), 'edit'); // Ctrl+Enter on a selection with typed text is handled in the editor
      if (s.r1 !== s.r2 || s.c1 !== s.c2) { const nr = s.ar + (shift ? -1 : 1); return setSel({ ...s, ar: nr > s.r2 ? s.r1 : nr < s.r1 ? s.r2 : nr, ac: nr > s.r2 ? (s.ac + 1 > s.c2 ? s.c1 : s.ac + 1) : s.ac }); }
      return moveTo(s.ar + (shift ? -1 : 1), s.ac);
    }
    if (ctrl) return null; // unknown Ctrl combos never type a character
    if (k === ' ' && shift) { e.preventDefault(); return setSel({ ar: s.ar, ac: 0, r1: s.r1, r2: s.r2, c1: 0, c2: MAXC - 1 }); }
    if (readOnly) return null;
    if (k === 'F2') { e.preventDefault(); return startEdit(activeText(), 'edit'); }
    if (k === 'F4') { e.preventDefault(); return null; }
    if ((k === 'Delete' || k === 'Backspace') && selChartRef.current) { e.preventDefault(); return A.chartDelete(); }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); return A.clear('contents'); }
    if (e.altKey && k === '=') { e.preventDefault(); return A.autoSum(); }
    if (k === 'Escape') { if (selChartRef.current) setSelChart(null); if (painterRef.current) setPainter(null); if (ctl.clip) { ctl.clip = null; force(); } return null; }
    if (k.length === 1 && !e.altKey) { e.preventDefault(); return startEdit(k, 'enter'); }
    return null;
  };
  const onPaste = (e) => {
    if (editRef.current || readOnly) return; e.preventDefault(); const text = e.clipboardData.getData('text/plain'); const s = cur();
    const g = ctl.paste(sheet, s.r1, s.c1, { text }); if (g) setSel({ ar: g.r1, ac: g.c1, r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2 });
  };

  /* ---------- editor textarea ---------- */
  const onEditKey = (e) => {
    e.stopPropagation();
    const ed = editRef.current; const ta = e.target;
    if (e.key === 'Escape') { e.preventDefault(); return cancel(); }
    if (e.key === 'Enter') { if (e.altKey) { e.preventDefault(); const p = ta.selectionStart; setEdit({ ...ed, text: `${ed.text.slice(0, p)}\n${ed.text.slice(ta.selectionEnd)}`, caret: p + 1 }); requestAnimationFrame(() => ta.setSelectionRange(p + 1, p + 1)); return null; } e.preventDefault(); if (e.ctrlKey || e.metaKey) { commit(0, 0, true); const s = cur(); if (s.r1 !== s.r2 || s.c1 !== s.c2) ctl.inputRange(sheet, rangeOf(), ed.text); return null; } return commit(e.shiftKey ? -1 : 1, 0); }
    if (e.key === 'Tab') { e.preventDefault(); const ac = suggest(ed.text, ta.selectionStart); if (ac.length && !e.shiftKey) { pickFn(ac[0]); return null; } return commit(0, e.shiftKey ? -1 : 1); }
    if (ed.how === 'enter' && !ed.text.startsWith('=')) { const mv = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]; if (mv) { e.preventDefault(); return commit(mv[0], mv[1]); } }
    if (ed.how === 'enter' && ed.text.startsWith('=') && canPoint(ed.text, ta.selectionStart) && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault(); const d = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]; const base = ed.ptCell || [ed.r, ed.c]; const nr = clamp(base[0] + d[0], 0, MAXR - 1); const nc = clamp(base[1] + d[1], 0, MAXC - 1);
      insertRef(addr(nr, nc)); setEdit({ ...editRef.current, ptCell: [nr, nc] }); return null;
    }
    if (e.key === 'F4') { e.preventDefault(); const p = ta.selectionStart; const m = /(\$?[A-Za-z]{1,3}\$?\d+)$/.exec(ed.text.slice(0, p)) || /(\$?[A-Za-z]{1,3}\$?\d+)/.exec(ed.text.slice(Math.max(0, p - 12))); if (m) { const old = m[1]; const mm = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/.exec(old); const nxt = [`$${mm[2]}$${mm[4]}`, `${mm[2]}$${mm[4]}`, `$${mm[2]}${mm[4]}`, `${mm[2]}${mm[4]}`][mm[1] && mm[3] ? 1 : !mm[1] && mm[3] ? 2 : mm[1] && !mm[3] ? 3 : 0]; const st = ed.text.lastIndexOf(old, p); setEdit({ ...ed, text: ed.text.slice(0, st) + nxt + ed.text.slice(st + old.length) }); } return null; }
    return null;
  };
  const suggest = (text, caret) => { if (!text || text[0] !== '=') return []; const m = /([A-Za-z][A-Za-z0-9.]*)$/.exec(text.slice(0, caret)); if (!m || /[0-9]$/.test(m[1]) && /^[A-Za-z]{1,3}\d+$/.test(m[1])) return []; const u = m[1].toUpperCase(); return FN_NAMES.filter((n) => n.startsWith(u) && n !== u).slice(0, 8); };
  const pickFn = (name) => { const ed = editRef.current; const ta = taRef.current; const caret = ta ? ta.selectionStart : ed.caret; const m = /([A-Za-z][A-Za-z0-9.]*)$/.exec(ed.text.slice(0, caret)); const st = caret - m[1].length; const t = `${ed.text.slice(0, st)}${name}(${ed.text.slice(caret)}`; const p = st + name.length + 1; setEdit({ ...ed, text: t, caret: p }); requestAnimationFrame(() => { taRef.current?.focus(); taRef.current?.setSelectionRange(p, p); }); };

  /* ---------- selection stats ---------- */
  const stats = useMemo(() => {
    const s = sel; const area = (s.r2 - s.r1 + 1) * (s.c2 - s.c1 + 1); if (area <= 1 && !(sheet.cells.get(key(s.ar, s.ac)))) return null;
    let n = 0; let cnt = 0; let sum = 0; let mn = Infinity; let mx = -Infinity;
    eachCell({ wb }, new Rng(sheet, s.r1, s.c1, Math.min(s.r2, sheet.maxRow), Math.min(s.c2, sheet.maxCol)), (v) => { if (v === null) return; cnt += 1; if (typeof v === 'number') { n += 1; sum += v; if (v < mn) mn = v; if (v > mx) mx = v; } });
    return { n, cnt, sum, mn, mx, avg: n ? sum / n : 0 };
  }, [sel, sheet, wb.version]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- find ---------- */
  const matches = useMemo(() => {
    if (!find || !find.q) return [];
    const out = []; const q = find.cs ? find.q : find.q.toLowerCase();
    const sheets = find.scope === 'book' ? wb.sheets : [sheet];
    for (const sh of sheets) {
      const ks = [...sh.cells.keys()].sort((a, b) => a - b);
      for (const k of ks) { const r = keyR(k); const c = keyC(k); const d = displayOf(wb, sh, r, c, false).text; const t = find.cs ? d : d.toLowerCase(); if (find.whole ? t === q : t.includes(q)) out.push({ sh, r, c }); }
    }
    return out;
  }, [find, sheet, wb.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const gotoMatch = (i) => { if (!matches.length) return; const m = matches[(i + matches.length) % matches.length]; setFind((f) => ({ ...f, n: (i + matches.length) % matches.length })); const si = wb.sheets.indexOf(m.sh); if (si !== six) setSix(si); setSel(mkSel(m.r, m.c)); requestAnimationFrame(() => reveal(m.r, m.c)); };
  const replaceAll = () => {
    if (!find.q || !matches.length) return; let n = 0;
    const rx = new RegExp(find.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), find.cs ? 'g' : 'gi');
    const bySheet = new Map(); matches.forEach((m) => { if (!bySheet.has(m.sh)) bySheet.set(m.sh, []); bySheet.get(m.sh).push(m); });
    for (const [sh, list] of bySheet) ctl.run(sh, list.map((m) => key(m.r, m.c)), () => { list.forEach((m) => { const cell = sh.cells.get(key(m.r, m.c)); if (!cell) return; if (cell.f) { const nf = cell.f.replace(rx, find.rep); if (nf !== cell.f) { cell.f = nf; n += 1; } } else if (typeof cell.v === 'string') { const nv = find.whole ? find.rep : cell.v.replace(rx, find.rep); wb.setInput(sh, m.r, m.c, nv); n += 1; } }); });
    toast(tt(`Replaced ${n}.`, `تم استبدال ${n}.`));
  };

  /* ---------- layout bits ---------- */
  const T = themeOf(theme);
  const ab = { x: X(sel.ac), y: Y(sel.ar) };
  const merged = mergeIndex(sheet).get(key(edit ? edit.r : sel.ar, edit ? edit.c : sel.ac));
  const eb = edit ? (() => { const m = mergeIndex(sheet).get(key(edit.r, edit.c)); const x = X(m ? m.c1 : edit.c); const y = Y(m ? m.r1 : edit.r); return { x, y, w: X((m ? m.c2 : edit.c) + 1) - x, h: Y((m ? m.r2 : edit.r) + 1) - y }; })() : null;
  void ab; void merged;
  const est = edit ? displayOf(wb, sheet, edit.r, edit.c, false).st : {};
  const sugg = edit ? suggest(edit.text, edit.caret) : [];
  const nameBox = sel.r1 === sel.r2 && sel.c1 === sel.c2 ? addr(sel.ar, sel.ac) : (sel.r2 - sel.r1 + 1 >= MAXR ? `${addr(0, sel.c1).replace(/\d+/, '')}:${addr(0, sel.c2).replace(/\d+/, '')}` : sel.c2 - sel.c1 + 1 >= MAXC ? `${sel.r1 + 1}:${sel.r2 + 1}` : `${sel.r2 - sel.r1 + 1}R x ${sel.c2 - sel.c1 + 1}C`);
  const fxText = edit ? edit.text : activeText();
  const cell = sheet.cells.get(key(sel.ar, sel.ac)); const ast = cell ? wb.styles[cell.s] || {} : {};
  A.activeStyle = ast; void tokenize; void shiftFormula; void toStr; void FONT; void E; void isErr; void parseCell; void refText; void T; void setSix;

  return (
    <div ref={rootRef} className="sx" style={T.vars} dir="ltr" onClick={(e) => { if (!e.target.closest?.('input,select,textarea,.sx__grid,.sx__find,.sx__menu,.sxd__back,.sxf') && !editRef.current && !findOpenRef.current && !overlayRef.current) requestAnimationFrame(() => scrollRef.current?.focus({ preventScroll: true })); }} data-rtl={rtl ? '1' : undefined}>
      {!readOnly && <SheetRibbon A={A} tt={tt} rtl={rtl} tab={tab} setTab={setTab} collapsed={collapsed} setCollapsed={setCollapsed} state={{ ast, sel, canUndo: ctl.canUndo, canRedo: ctl.canRedo, clip: !!ctl.clip }} />}
      {view.bar && (
        <div className="sx__fx">
          <input className="sx__name" aria-label={tt('Name box', 'مربع الاسم')} defaultValue={nameBox} key={nameBox} onKeyDown={(e) => { if (e.key === 'Enter') { const ok = A.goto(e.target.value); if (!ok && /^[A-Za-z_][\w.]*$/.test(e.target.value) && !readOnly) { A.defineName(e.target.value); } scrollRef.current?.focus(); } if (e.key === 'Escape') scrollRef.current?.focus(); }} onFocus={(e) => e.target.select()} />
          {!readOnly && <span className="sx__fxb">
            <button type="button" aria-label={tt('Cancel', 'إلغاء')} title="Esc" disabled={!edit} onMouseDown={(e) => e.preventDefault()} onClick={cancel}><SxIcon name="close" size={14} /></button>
            <button type="button" aria-label={tt('Enter', 'إدخال')} title="Enter" disabled={!edit} onMouseDown={(e) => e.preventDefault()} onClick={() => commit(1, 0)}>✓</button>
          </span>}
          <button type="button" className="sx__fxl" title={tt('Insert function (Shift+F3)', 'إدراج دالة (Shift+F3)')} aria-label={tt('Insert function', 'إدراج دالة')} disabled={readOnly} onMouseDown={(e) => e.preventDefault()} onClick={() => A.openDialog('insertfn')}>fx</button>
          <input className="sx__fxin" dir="auto" spellCheck={false} value={fxText} readOnly={readOnly}
            onFocus={() => { if (!editRef.current && !readOnly) setEdit({ r: sel.ar, c: sel.ac, text: activeText(), how: 'bar', caret: activeText().length }); }}
            onChange={(e) => setEdit({ ...(editRef.current || { r: sel.ar, c: sel.ac, how: 'bar' }), text: e.target.value, caret: e.target.selectionStart })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(1, 0); } else if (e.key === 'Escape') { e.preventDefault(); cancel(); } }} />
        </div>
      )}
      <div className="sx__body">
        <div className="sx__grid" ref={scrollRef} tabIndex={0} onKeyDown={onKey} onPaste={onPaste} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={onDbl} onContextMenu={onCtx}
          onScroll={(e) => setScroll({ x: e.currentTarget.scrollLeft, y: e.currentTarget.scrollTop })}
          onWheel={(e) => { if (e.ctrlKey) { e.preventDefault(); setView((v) => ({ ...v, z: clamp(Math.round((v.z - Math.sign(e.deltaY) * 0.1) * 10) / 10, 0.4, 3) })); } }}>
          <div style={{ width: totalW, height: totalH, pointerEvents: 'none' }} />
          <canvas ref={cvRef} className="sx__cv" style={{ left: 0, top: 0, transform: `translate(${scroll.x}px, ${scroll.y}px)` }} />
          {edit && eb && (
            <div className="sx__ed" style={{ left: eb.x + scroll.x, top: eb.y + scroll.y, minWidth: eb.w, minHeight: eb.h }}>
              <textarea ref={taRef} className="sx__ta" dir="auto" spellCheck={false} value={edit.text} rows={Math.max(1, edit.text.split('\n').length)}
                style={{ font: fontOf(est, z), color: est.color || T.fg, background: T.bg, minWidth: eb.w, minHeight: eb.h, width: `${Math.max(eb.w, Math.min(600, edit.text.length * 8 * z + 30))}px`, textAlign: est.al === 'right' || (est.al === undefined && /^[-+]?[\d.,]+%?$/.test(edit.text)) ? 'right' : est.al === 'center' ? 'center' : 'left' }}
                onChange={(e) => setEdit({ ...editRef.current, text: e.target.value, caret: e.target.selectionStart, pt: null, ptCell: null })} onKeyDown={onEditKey}
                onSelect={(e) => { const ed = editRef.current; if (ed && ed.caret !== e.target.selectionStart) setEdit({ ...ed, caret: e.target.selectionStart }); }}
                onBlur={() => { /* clicking the grid / formula bar keeps the edit alive; commit happens via pointer handlers */ }} />
              {sugg.length > 0 && <ul className="sx__ac">{sugg.map((n) => <li key={n}><button type="button" onMouseDown={(e) => { e.preventDefault(); pickFn(n); }}>{n}</button></li>)}</ul>}
            </div>
          )}
        </div>
        {find && (
          <div className="sx__find" role="dialog" aria-label={tt('Find', 'بحث')}>
            <div className="sx__frow"><input autoFocus value={find.q} placeholder={tt('Find', 'بحث')} onChange={(e) => setFind({ ...find, q: e.target.value, n: 0 })} onKeyDown={(e) => { if (e.key === 'Enter') gotoMatch(find.n + (e.shiftKey ? -1 : 1)); if (e.key === 'Escape') setFind(null); }} />
              <span className="sx__cnt">{matches.length ? `${Math.min(find.n + 1, matches.length)}/${matches.length}` : find.q ? '0' : ''}</span>
              <button type="button" onClick={() => gotoMatch(find.n - 1)} aria-label={tt('Previous', 'السابق')}>▲</button><button type="button" onClick={() => gotoMatch(find.n + 1)} aria-label={tt('Next', 'التالي')}>▼</button>
              <button type="button" onClick={() => setFind(null)} aria-label={tt('Close', 'إغلاق')}>✕</button></div>
            {find.replace && !readOnly && <div className="sx__frow"><input value={find.rep} placeholder={tt('Replace with', 'استبدال بـ')} onChange={(e) => setFind({ ...find, rep: e.target.value })} /><button type="button" onClick={replaceAll}>{tt('Replace all', 'استبدال الكل')}</button></div>}
            <div className="sx__frow sx__fopts">
              <label><input type="checkbox" checked={find.cs} onChange={(e) => setFind({ ...find, cs: e.target.checked })} />{tt('Match case', 'حساسية الحروف')}</label>
              <label><input type="checkbox" checked={find.whole} onChange={(e) => setFind({ ...find, whole: e.target.checked })} />{tt('Entire cell', 'الخلية كاملة')}</label>
              <label><input type="checkbox" checked={find.scope === 'book'} onChange={(e) => setFind({ ...find, scope: e.target.checked ? 'book' : 'sheet' })} />{tt('Whole workbook', 'المصنف كله')}</label>
            </div>
          </div>
        )}
        {menu && <CtxMenu menu={menu} A={A} tt={tt} readOnly={readOnly} close={() => setMenu(null)} />}
      </div>
      <div className="sx__tabsbar">
        <button type="button" className="sx__tnav" aria-label={tt('Previous sheet', 'الورقة السابقة')} disabled={six === 0} onClick={() => A.stepSheet(-1)}>◀</button>
        <button type="button" className="sx__tnav" aria-label={tt('Next sheet', 'الورقة التالية')} disabled={six >= wb.sheets.length - 1} onClick={() => A.stepSheet(1)}>▶</button>
        <div className="sx__tabs" role="tablist">
          {wb.sheets.map((s, i) => (
            <span key={s.name + i} className={`sx__tab${i === six ? ' is-on' : ''}`} role="tab" aria-selected={i === six}
              onClick={() => gotoSheet(i)}
              onDoubleClick={() => !readOnly && setTabEdit({ i, text: s.name })}
              onContextMenu={(e) => { e.preventDefault(); if (readOnly) return; setMenu({ x: e.clientX, y: e.clientY - 120, kind: 'tab', i }); }}>
              {tabEdit && tabEdit.i === i ? <input autoFocus value={tabEdit.text} onChange={(e) => setTabEdit({ ...tabEdit, text: e.target.value })} onBlur={() => { ctl.renameSheet(s, tabEdit.text); setTabEdit(null); }} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setTabEdit(null); }} /> : s.name}
            </span>
          ))}
          {!readOnly && <button type="button" className="sx__addtab" aria-label={tt('New sheet (Shift+F11)', 'ورقة جديدة (Shift+F11)')} title={tt('New sheet (Shift+F11)', 'ورقة جديدة (Shift+F11)')} onClick={A.newSheet}>+</button>}
        </div>
      </div>
      <div className="sx__status">
        <span className="sx__mode">{edit ? (edit.how === 'enter' ? tt('Enter', 'إدخال') : tt('Edit', 'تحرير')) : painter ? tt('Format Painter', 'ناسخ التنسيق') : tt('Ready', 'جاهز')}</span>
        {hint && <span className="sx__hint" role="status">{hint}</span>}
        {wb.circular && <span className="sx__warn">{tt('Circular reference', 'مرجع دائري')}</span>}
        <span className="sx__sp" />
        {stats && <span className="sx__stats">{stats.n > 0
          ? [[tt('Average', 'المتوسط'), +stats.avg.toFixed(6)], [tt('Count', 'العدد'), stats.cnt], [tt('Min', 'الأصغر'), +stats.mn.toFixed(6)], [tt('Max', 'الأكبر'), +stats.mx.toFixed(6)], [tt('Sum', 'المجموع'), +stats.sum.toFixed(6)]].map(([l, v]) => <span key={l}>{l}: <b>{v}</b></span>)
          : <span>{tt('Count', 'العدد')}: <b>{stats.cnt}</b></span>}</span>}
        <span className="sx__zoom">
          <button type="button" aria-label={tt('Zoom out', 'تصغير')} onClick={() => A.zoomBy(-0.1)}>−</button>
          <input type="range" min="40" max="300" step="10" value={Math.round(z * 100)} aria-label={tt('Zoom', 'تكبير')} onChange={(e) => A.zoomTo(+e.target.value / 100)} />
          <button type="button" aria-label={tt('Zoom in', 'تكبير')} onClick={() => A.zoomBy(0.1)}>+</button>
          <button type="button" className="sx__zpct" title={tt('Reset to 100%', 'رجوع لـ 100%')} onClick={() => A.zoomTo(1)}>{Math.round(z * 100)}%</button>
        </span>
      </div>
      {fmenu && sheet.filter && <FilterMenu A={A} tt={tt} c={fmenu.c} pos={fmenu} onClose={() => { setFmenu(null); requestAnimationFrame(() => scrollRef.current?.focus({ preventScroll: true })); }} />}
      {fileOpen && <SheetFileMenu A={A} tt={tt} fileName={fileName} dirty={ctl.dirty} onClose={() => { setFileOpen(false); requestAnimationFrame(() => scrollRef.current?.focus({ preventScroll: true })); }} />}
      {dlg && (() => {
        const close = () => { setDlg(null); requestAnimationFrame(() => scrollRef.current?.focus({ preventScroll: true })); };
        if (dlg.type === 'prompt') return <PromptDialog d={dlg} tt={tt} onClose={close} />;
        if (dlg.type === 'confirm') return <ConfirmDialog d={dlg} tt={tt} onClose={close} />;
        if (dlg.type === 'shortcuts') return <ShortcutsDialog tt={tt} rtl={rtl} onClose={close} />;
        if (dlg.type === 'insertfn') return <InsertFnDialog tt={tt} onClose={close} onPick={(n) => { setDlg(null); requestAnimationFrame(() => A.insertFn(n)); }} />;
        if (dlg.type === 'format') return <FormatCellsDialog A={A} tt={tt} tab={dlg.tab} onClose={close} />;
        if (dlg.type === 'cfrule') return <CfRuleDialog d={dlg} A={A} tt={tt} onClose={close} />;
        if (dlg.type === 'cfmanage') return <ManageRulesDialog A={A} tt={tt} onClose={close} />;
        if (dlg.type === 'chart') return <ChartDialog d={dlg} A={A} tt={tt} onClose={close} />;
        return null;
      })()}
    </div>
  );
}

function CtxMenu({ menu, A, tt, readOnly, close }) {
  const sel = A.sel; const ref = useRef(null);
  useEffect(() => { const h = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); }; window.addEventListener('pointerdown', h, true); return () => window.removeEventListener('pointerdown', h, true); }, [close]);
  const go = (fn) => () => { close(); fn(); };
  const sep = <li className="sx__msep" role="separator" />;
  const item = (label, fn, dis) => <li><button type="button" disabled={dis} onClick={go(fn)}>{label}</button></li>;
  let items;
  if (menu.kind === 'chart') {
    items = [item(tt('Chart settings…', 'إعدادات الرسم…'), () => A.openDialog('chart', { chart: A.chart() }), readOnly), item(tt('Delete chart', 'حذف الرسم'), A.chartDelete, readOnly)];
  } else if (menu.kind === 'tab') {
    const s = A.wb.sheets[menu.i];
    items = [item(tt('Rename', 'إعادة تسمية'), () => { A.gotoSheetByObj(s); setTimeout(A.renameSheet, 0); }), item(tt('Insert sheet', 'إدراج ورقة'), A.newSheet), item(tt('Delete', 'حذف'), () => { A.gotoSheetByObj(s); setTimeout(A.deleteSheet, 0); }, A.wb.sheets.length < 2)];
  } else {
    const rowsSel = sel.c1 === 0 && sel.c2 >= MAXC - 1; const colsSel = sel.r1 === 0 && sel.r2 >= MAXR - 1;
    items = [
      item(tt('Cut', 'قص'), () => A.copy(true), readOnly), item(tt('Copy', 'نسخ'), () => A.copy(false)), item(tt('Paste', 'لصق'), () => A.paste('all'), readOnly),
      item(tt('Paste values only', 'لصق القيم فقط'), () => A.paste('values'), readOnly || !A.ctl.clip), item(tt('Paste formats only', 'لصق التنسيق فقط'), () => A.paste('formats'), readOnly || !A.ctl.clip), sep,
      ...(menu.kind !== 'cell' || rowsSel || colsSel ? [] : [item(tt('Insert row above', 'إدراج صف أعلى'), A.insertRows, readOnly), item(tt('Insert column left', 'إدراج عمود يسار'), A.insertCols, readOnly), item(tt('Delete rows', 'حذف الصفوف'), A.deleteRows, readOnly), item(tt('Delete columns', 'حذف الأعمدة'), A.deleteCols, readOnly)]),
      ...(menu.kind === 'row' || rowsSel ? [item(tt('Insert rows', 'إدراج صفوف'), A.insertRows, readOnly), item(tt('Delete rows', 'حذف الصفوف'), A.deleteRows, readOnly), item(tt('Hide rows', 'إخفاء الصفوف'), () => A.hide('r', true), readOnly), item(tt('Unhide all', 'إظهار الكل'), A.unhideAll, readOnly)] : []),
      ...(menu.kind === 'col' || colsSel ? [item(tt('Insert columns', 'إدراج أعمدة'), A.insertCols, readOnly), item(tt('Delete columns', 'حذف الأعمدة'), A.deleteCols, readOnly), item(tt('Hide columns', 'إخفاء الأعمدة'), () => A.hide('c', true), readOnly), item(tt('Unhide all', 'إظهار الكل'), A.unhideAll, readOnly)] : []),
      sep, item(tt('Clear contents', 'مسح المحتوى'), () => A.clear('contents'), readOnly), item(tt('Clear formats', 'مسح التنسيق'), () => A.clear('formats'), readOnly),
      item(tt('Sort A → Z', 'ترتيب تصاعدي'), () => A.sort(true), readOnly), item(tt('Sort Z → A', 'ترتيب تنازلي'), () => A.sort(false), readOnly),
    ];
  }
  const style = { left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 40 * items.length) };
  return <ul ref={ref} className="sx__menu" style={{ position: 'fixed', ...style }} role="menu">{items.map((it, i) => <Fragment key={i}>{it}</Fragment>)}</ul>;
}
