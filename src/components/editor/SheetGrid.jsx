import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon';
import { Btn } from './EditorUI';
import { colName, MAX_COLS, THEMES, themeById, loadTheme, saveTheme } from '../../lib/officeFmt/xlsx';
import '../../styles/css/editor.css';
import '../../styles/css/office.css';

const ROW_H = 30;
const OVERSCAN = 12;
const MIN_ROWS = 200; // like Excel, an empty sheet shows a full canvas of cells; typing into them grows the data
const MIN_COLS = 40;
// Row identity is preserved through pad -> edit -> trim, so memoised rows only re-render when their own data changed
// (the old code rebuilt ~8000 cells on every keystroke and every scroll event).
const padCache = new WeakMap(); // source row -> { w, row }
const srcOf = new WeakMap(); // padded row -> the source row it was made from
const blankCache = new Map(); // width -> shared empty row (never mutated: edits clone first)
const padRow = (row, w) => {
  const hit = padCache.get(row);
  if (hit && hit.w === w) return hit.row;
  const out = new Array(w);
  for (let c = 0; c < w; c += 1) out[c] = row[c] ?? '';
  padCache.set(row, { w, row: out }); srcOf.set(out, row);
  return out;
};
const blankRow = (w) => { let b = blankCache.get(w); if (!b) { b = new Array(w).fill(''); blankCache.set(w, b); } return b; };
const padGrid = (src, readOnly) => {
  if (readOnly) return src;
  const w = Math.min(MAX_COLS, Math.max(MIN_COLS, (src[0]?.length || 1) + 8)); const h = Math.max(MIN_ROWS, src.length + 60);
  return Array.from({ length: h }, (_, r) => (r < src.length ? padRow(src[r], w) : blankRow(w)));
};
/** Drops the empty tail (rows / columns) so the padding never becomes data. Untouched rows keep their identity. */
const trimGrid = (n) => {
  let h = n.length; while (h > 1 && n[h - 1].every((v) => (v ?? '') === '')) h -= 1;
  let w = n[0]?.length || 1;
  while (w > 1) { let empty = true; for (let r = 0; r < h; r += 1) if ((n[r][w - 1] ?? '') !== '') { empty = false; break; } if (!empty) break; w -= 1; }
  const out = new Array(h);
  for (let r = 0; r < h; r += 1) { const o = srcOf.get(n[r]); out[r] = o && o.length === w ? o : n[r].slice(0, w); }
  return out;
};
const num = (s) => (s !== '' && /^-?\d+(\.\d+)?$/.test(String(s).trim()) ? Number(s) : null);


/** One grid row, memoised: a keystroke / selection change re-renders only the rows whose own props changed. */
const GridRow = memo(function GridRow({ r, row, colW, c1, c2, leftPad, tableW, gutter, cls, selC1, selC2, activeC, editC, editV, hitCols, rowOn, h }) {
  const out = [];
  for (let c = c1; c < c2; c += 1) {
    const v = row[c] ?? '';
    out.push(
      <div key={c} className={`xg__cell${selC1 >= 0 && c >= selC1 && c <= selC2 ? ' is-sel' : ''}${activeC === c ? ' is-active' : ''}${hitCols && hitCols.has(c) ? ' is-hit' : ''}${num(v) !== null ? ' is-num' : ''}`} style={{ width: colW[c] }}
        onPointerDown={(e) => h.down(e, r, c)} onPointerEnter={() => h.enter(r, c)} onPointerUp={h.up} onDoubleClick={() => h.dbl(r, c, v)}>
        {editC === c
          ? <input className="xg__in" autoFocus dir="auto" value={editV} onChange={(e) => h.editChange(e.target.value)} onBlur={h.editBlur} onKeyDown={h.editKey} />
          : <span dir="auto">{v}</span>}
      </div>,
    );
  }
  return (
    <div className={cls} style={{ top: ROW_H + r * ROW_H, height: ROW_H, width: tableW }}>
      <div className={`xg__rowh${rowOn ? ' is-on' : ''}`} style={{ width: gutter }} onPointerDown={(e) => h.rowDown(e, r)}>{r + 1}</div>
      {leftPad > 0 && <div style={{ width: leftPad, flex: 'none' }} />}
      {out}
    </div>
  );
});

/** Theme picker: a real menu (the native <select> list was unreadable on the dark toolbar). */
function ThemeMenu({ T, onPick, tt }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="xg__theme" ref={box}>
      <button type="button" className={`xg__themebtn${open ? ' is-open' : ''}`} aria-haspopup="listbox" aria-expanded={open} title={tt('Theme', 'الثيم')} onClick={() => setOpen((o) => !o)}>
        <i style={{ background: T.swatch }} />
        <span>{tt(T.en, T.ar)}</span>
        <Icon name="chevron-down" size={13} />
      </button>
      {open && (
        <div className="xg__menu" role="listbox" aria-label={tt('Theme', 'الثيم')}>
          {THEMES.map((x) => (
            <button key={x.id} type="button" role="option" aria-selected={x.id === T.id} className={`xg__opt${x.id === T.id ? ' is-on' : ''}`} onClick={() => { onPick(x.id); setOpen(false); }}>
              <i style={{ background: x.swatch }} />
              <span>{tt(x.en, x.ar)}</span>
              {x.id === T.id && <b aria-hidden="true">✓</b>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Spreadsheet-style grid (virtualised). Controlled: `cells` (string[][]) + `onChange(nextCells)`.
 * Header row (row 1) is styled as the header; row numbers, column letters, sort, find, add/delete rows & columns,
 * column auto-widths, arrow / Tab / Enter navigation, copy / paste of ranges from Excel.
 */
function SheetGrid({ theme, onTheme, cells: src, onChange: emit, tt, rtl, undo, redo, canUndo, canRedo, readOnly = false, extraTools = null }) {
  const cells = useMemo(() => padGrid(src, readOnly), [src, readOnly]);
  const onChange = useCallback((n) => emit(readOnly ? n : trimGrid(n)), [emit, readOnly]);
  const [localTheme, setLocalTheme] = useState(loadTheme);
  const T = themeById(theme ?? localTheme);
  const pickTheme = (id) => { saveTheme(id); setLocalTheme(id); onTheme?.(id); };
  const vars = { '--xg-bg': T.bg, '--xg-fg': T.fg, '--xg-head': T.head, '--xg-head-fg': T.headFg, '--xg-head-on': T.headOn, '--xg-head-on-fg': T.headOnFg, '--xg-hd-bg': T.hdBg, '--xg-hd-fg': T.hdFg, '--xg-band': T.band || 'transparent', '--xg-line': T.line, ...(T.accent ? { '--ed-accent': T.accent } : {}) };
  const hasHeader = cells[0].some((v) => (v ?? '') !== '');
  const [sel, setSel] = useState({ r: 0, c: 0, r2: 0, c2: 0 });
  const [edit, setEdit] = useState(null); // { r, c, v }
  const [find, setFind] = useState('');
  const [widths, setWidths] = useState({});
  const [view, setView] = useState({ rt: 0, lq: 0, h: 600, w: 1000 }); // top row index + left offset (quantised): scrolling re-renders only when the window really moves
  const [sort, setSort] = useState(null); // { c, dir }
  const [headerRow, setHeaderRow] = useState(true);
  const noHeader = !headerRow;
  const wrap = useRef(null);
  const rows = cells.length;
  const cols = cells[0]?.length || 1;

  useEffect(() => {
    const el = wrap.current; if (!el) return undefined;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const rt = Math.floor(el.scrollTop / ROW_H); const lq = Math.floor(Math.abs(el.scrollLeft) / 120) * 120; const h = el.clientHeight; const w = el.clientWidth;
      setView((v) => (v.rt === rt && v.lq === lq && v.h === h && v.w === w ? v : { rt, lq, h, w }));
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure(); el.addEventListener('scroll', on, { passive: true });
    const ro = new ResizeObserver(on); ro.observe(el);
    return () => { if (raf) cancelAnimationFrame(raf); el.removeEventListener('scroll', on); ro.disconnect(); };
  }, []);

  // default widths from content
  const autoRef = useRef([]);
  const autoW = useMemo(() => {
    const n = Array.from({ length: cols }, (_, c) => {
      let m = 4;
      for (let r = 0; r < Math.min(src.length, 150); r += 1) m = Math.max(m, String(src[r]?.[c] ?? '').length);
      return Math.min(320, Math.max(80, m * 8.2 + 22));
    });
    const o = autoRef.current;
    if (o.length === n.length && o.every((x, i) => x === n[i])) return o; // same widths -> same array -> memoised rows stay untouched
    autoRef.current = n; return n;
  }, [src, cols]);
  const colW = useMemo(() => autoW.map((a, c) => widths[c] ?? a), [autoW, widths]);
  const wOf = (c) => colW[c];
  const colX = useMemo(() => { const x = new Array(colW.length + 1); x[0] = 0; for (let i = 0; i < colW.length; i += 1) x[i + 1] = x[i] + colW[i]; return x; }, [colW]);
  const gutter = Math.max(44, String(rows).length * 9 + 22);

  const set = useCallback((fn) => { const next = cells.map((r) => r.slice()); fn(next); onChange(next); }, [cells, onChange]);
  // copy-on-write: only the rows fn touches (through rw(r)) are cloned, so every other row keeps its identity
  const setCow = useCallback((fn) => { const next = cells.slice(); const done = new Set(); const rw = (r) => { if (!done.has(r)) { next[r] = next[r].slice(); done.add(r); } return next[r]; }; fn(rw); onChange(next); }, [cells, onChange]);
  const commit = useCallback(() => { if (!edit) return; if (cells[edit.r]?.[edit.c] !== edit.v) setCow((rw) => { rw(edit.r)[edit.c] = edit.v; }); setEdit(null); }, [edit, cells, setCow]);

  const move = (dr, dc, extend = false) => setSel((s) => {
    const r = Math.max(0, Math.min(rows - 1, (extend ? s.r2 : s.r) + dr)); const c = Math.max(0, Math.min(cols - 1, (extend ? s.c2 : s.c) + dc));
    return extend ? { ...s, r2: r, c2: c } : { r, c, r2: r, c2: c };
  });
  const rect = { r1: Math.min(sel.r, sel.r2), r2: Math.max(sel.r, sel.r2), c1: Math.min(sel.c, sel.c2), c2: Math.max(sel.c, sel.c2) };

  // keep the active cell in view
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    if (sel.r === 0 && sel.r2 === rows - 1 && rows > 1) return; // whole-column selection must not jump to the bottom
    const top = (sel.r2 + 1) * ROW_H; const vh = el.clientHeight - ROW_H;
    if (top - ROW_H < el.scrollTop) el.scrollTop = top - ROW_H; else if (top > el.scrollTop + vh) el.scrollTop = top - vh;
    if (!(sel.c === 0 && sel.c2 === cols - 1 && cols > 1) && colX[sel.c2 + 1] !== undefined) { // horizontal: the arrow keys used to walk off-screen
      const x0 = colX[sel.c2]; const x1 = colX[sel.c2 + 1]; const abs = Math.abs(el.scrollLeft); const vis = el.clientWidth - gutter;
      let to = abs; if (x0 < abs) to = x0; else if (x1 > abs + vis) to = x1 - vis;
      if (to !== abs) el.scrollLeft = rtl ? -to : to;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.r2, sel.c2]);

  const clearRect = () => setCow((rw) => { for (let r = rect.r1; r <= rect.r2; r += 1) { const row = rw(r); for (let c = rect.c1; c <= rect.c2; c += 1) row[c] = ''; } });

  const onKey = (e) => {
    if (edit) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); move(e.shiftKey ? -1 : 1, 0); } else if (e.key === 'Tab') { e.preventDefault(); commit(); move(0, e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') setEdit(null);
      return;
    }
    const mod = e.ctrlKey || e.metaKey; const k = e.key;
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? redo : undo)?.(); return; }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); redo?.(); return; }
    if (mod && k.toLowerCase() === 'a') { e.preventDefault(); setSel({ r: 0, c: 0, r2: rows - 1, c2: cols - 1 }); return; }
    if (mod && k.toLowerCase() === 'c') return; // native copy handler
    const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, rtl ? 1 : -1], ArrowRight: [0, rtl ? -1 : 1] }[k];
    if (d) { e.preventDefault(); move(d[0], d[1], e.shiftKey); return; }
    if (k === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return; }
    if (k === 'Home') { e.preventDefault(); setSel({ r: sel.r, c: 0, r2: sel.r, c2: 0 }); return; }
    if (k === 'PageDown') { e.preventDefault(); move(Math.floor(view.h / ROW_H) - 1, 0); return; }
    if (k === 'PageUp') { e.preventDefault(); move(-(Math.floor(view.h / ROW_H) - 1), 0); return; }
    if (readOnly) return;
    if (k === 'Enter' || k === 'F2') { e.preventDefault(); setEdit({ r: sel.r, c: sel.c, v: cells[sel.r][sel.c] }); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); clearRect(); return; }
    if (!mod && k.length === 1) { setEdit({ r: sel.r, c: sel.c, v: k }); e.preventDefault(); }
  };

  const onCopy = (e) => {
    if (edit) return;
    const t = []; for (let r = rect.r1; r <= rect.r2; r += 1) t.push(cells[r].slice(rect.c1, rect.c2 + 1).join('\t'));
    e.clipboardData.setData('text/plain', t.join('\n')); e.preventDefault();
  };
  const onCut = (e) => { if (readOnly) return; onCopy(e); clearRect(); };
  const onPaste = (e) => {
    if (edit || readOnly) return;
    const text = e.clipboardData.getData('text/plain'); if (!text) return; e.preventDefault();
    const block = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    set((n) => {
      const needC = Math.min(MAX_COLS, sel.c + Math.max(...block.map((b) => b.length)));
      block.forEach((line, i) => {
        const r = rect.r1 + i; while (n.length <= r) n.push(Array.from({ length: n[0].length }, () => ''));
        line.forEach((v, j) => { const c = rect.c1 + j; if (c >= MAX_COLS) return; for (const row of n) while (row.length < needC) row.push(''); n[r][c] = v; });
      });
    });
  };

  const addRow = (at) => set((n) => { n.splice(at, 0, Array.from({ length: cols }, () => '')); });
  const delRows = () => { if (rows - (rect.r2 - rect.r1 + 1) < 1) return; set((n) => { n.splice(rect.r1, rect.r2 - rect.r1 + 1); }); setSel((s) => ({ ...s, r: Math.min(s.r, rows - 2), r2: Math.min(s.r, rows - 2) })); };
  const addCol = (at) => { if (cols >= MAX_COLS) return; set((n) => { n.forEach((r) => r.splice(at, 0, '')); }); };
  const delCols = () => { if (cols - (rect.c2 - rect.c1 + 1) < 1) return; set((n) => { n.forEach((r) => r.splice(rect.c1, rect.c2 - rect.c1 + 1)); }); setSel((s) => ({ ...s, c: Math.min(s.c, cols - 2), c2: Math.min(s.c, cols - 2) })); };
  const doSort = (c, dir) => {
    setSort({ c, dir });
    set((n) => {
      const start = noHeader ? 0 : 1; const body = n.slice(start);
      body.sort((a, b) => { const x = a[c]; const y = b[c]; if (x === '' || y === '') return x === y ? 0 : x === '' ? 1 : -1; const nx = num(x); const ny = num(y); const cmp = nx !== null && ny !== null ? nx - ny : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }); return dir === 'asc' ? cmp : -cmp; });
      n.splice(start, body.length, ...body);
    });
  };

  const q = find.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!q) return [];
    const out = [];
    for (let r = 0; r < rows && out.length < 5000; r += 1) for (let c = 0; c < cols; c += 1) if (String(cells[r][c]).toLowerCase().includes(q)) out.push([r, c]);
    return out;
  }, [q, cells, rows, cols]);
  const hitMap = useMemo(() => { const m = new Map(); hits.forEach(([r, c]) => { let x = m.get(r); if (!x) { x = new Set(); m.set(r, x); } x.add(c); }); return m; }, [hits]);
  const hitIdx = useRef(-1);
  useEffect(() => { hitIdx.current = -1; }, [q]);
  const nextHit = (dir = 1) => { if (!hits.length) return; hitIdx.current = (hitIdx.current + dir + hits.length) % hits.length; const [r, c] = hits[hitIdx.current]; setSel({ r, c, r2: r, c2: c }); };

  const first = Math.max(0, view.rt - OVERSCAN);
  const last = Math.min(rows, view.rt + Math.ceil(view.h / ROW_H) + OVERSCAN + 1);
  // only the columns on screen (+300 px each side) are rendered: a 40-200 column sheet used to render every column of every visible row
  let vc1 = 0; let vc2 = cols;
  { const lo = view.lq - 300 - gutter; const hi = view.lq + 120 + view.w + 300;
    while (vc1 < cols - 1 && colX[vc1 + 1] <= lo) vc1 += 1;
    vc2 = vc1; while (vc2 < cols && colX[vc2] < hi) vc2 += 1; }
  const leftPad = colX[vc1] || 0;
  const total = cells.length * ROW_H;
  const sums = useMemo(() => { // status: count / sum / avg of the selected numbers
    let n = 0; let s = 0; let cnt = 0;
    for (let r = rect.r1; r <= rect.r2 && cnt < 100000; r += 1) for (let c = rect.c1; c <= rect.c2; c += 1) { cnt += 1; const v = num(cells[r]?.[c]); if (v !== null) { n += 1; s += v; } }
    return n > 1 ? { n, s, avg: s / n } : null;
  }, [cells, rect.r1, rect.r2, rect.c1, rect.c2]);

  const drag = useRef(false);
  const hLatest = useRef({}); // stable handler object for the memoised rows: always calls the latest closures
  hLatest.current = {
    down: (e, r, c) => { if (e.button !== 0) return; if (edit) commit(); drag.current = true; if (e.shiftKey) setSel((s0) => ({ ...s0, r2: r, c2: c })); else setSel({ r, c, r2: r, c2: c }); wrap.current?.focus({ preventScroll: true }); },
    enter: (r, c) => { if (drag.current) setSel((s0) => ({ ...s0, r2: r, c2: c })); },
    dbl: (r, c, v) => { if (!readOnly) setEdit({ r, c, v }); },
    rowDown: (e, r) => { if (e.button === 0) setSel({ r, c: 0, r2: r, c2: cols - 1 }); },
    editChange: (v) => setEdit((x) => (x ? { ...x, v } : x)),
    editBlur: () => commit(),
    editKey: (e) => { if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape') { onKey(e); wrap.current?.focus(); } e.stopPropagation(); },
  };
  const h = useMemo(() => ({
    down: (...a) => hLatest.current.down(...a), enter: (...a) => hLatest.current.enter(...a), up: () => { drag.current = false; },
    dbl: (...a) => hLatest.current.dbl(...a), rowDown: (...a) => hLatest.current.rowDown(...a),
    editChange: (...a) => hLatest.current.editChange(...a), editBlur: (...a) => hLatest.current.editBlur(...a), editKey: (...a) => hLatest.current.editKey(...a),
  }), []);
  const startResize = (e, c) => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX; const w0 = wOf(c); const dir = rtl ? -1 : 1;
    const mv = (ev) => setWidths((w) => ({ ...w, [c]: Math.max(40, w0 + (ev.clientX - x0) * dir) }));
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };

  const tableW = gutter + colX[cols];

  return (
    <div className="xg" data-theme={T.id} style={vars}>
      <div className="ed__top xg__tools">
        {extraTools}
        <Btn icon="ed-undo" onClick={undo} disabled={!canUndo} title={tt('Undo (Ctrl+Z)', 'تراجع (Ctrl+Z)')} />
        <Btn icon="ed-redo" onClick={redo} disabled={!canRedo} title={tt('Redo (Ctrl+Y)', 'إعادة (Ctrl+Y)')} />
        <span className="ed__sep" />
        {!readOnly && (<>
          <Btn icon="ed-row-plus" label={tt('Row', 'صف')} onClick={() => addRow(rect.r2 + 1)} title={tt('Insert row below', 'إضافة صف بعد المحدد')} />
          <Btn icon="trash" onClick={delRows} title={tt('Delete selected rows', 'حذف الصفوف المحددة')} className="ed__btn--danger" />
          <Btn icon="ed-col-plus" label={tt('Column', 'عمود')} onClick={() => addCol(rect.c2 + 1)} title={tt('Insert column after', 'إضافة عمود بعد المحدد')} />
          <Btn icon="trash" onClick={delCols} title={tt('Delete selected columns', 'حذف الأعمدة المحددة')} className="ed__btn--danger" />
          <span className="ed__sep" />
        </>)}
        <Btn icon="ed-align-left" label="A→Z" onClick={() => doSort(sel.c, 'asc')} title={tt('Sort column ascending', 'ترتيب تصاعدي')} disabled={readOnly} />
        <Btn icon="ed-align-right" label="Z→A" onClick={() => doSort(sel.c, 'desc')} title={tt('Sort column descending', 'ترتيب تنازلي')} disabled={readOnly} />
        <button type="button" role="switch" aria-checked={headerRow} className={`xg__switch${headerRow ? ' is-on' : ''}`} onClick={() => setHeaderRow((v) => !v)} title={tt('Treat the first row as a header (styled, and kept out of sorting)', 'اعتبر الصف الأول عناوين (بتتلوّن وبتتستثنى من الترتيب)')}>
          <i aria-hidden="true" />
          <span>{tt('Header row', 'صف العناوين')}</span>
        </button>
        <ThemeMenu T={T} onPick={pickTheme} tt={tt} />
        <span className="ed__sp" />
        <div className="xg__find">
          <input value={find} placeholder={tt('Find…', 'بحث…')} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); nextHit(e.shiftKey ? -1 : 1); } }} />
          {q && <span className="ed__pagecount">{hits.length}{hits.length >= 5000 ? '+' : ''}</span>}
          <Btn icon="chevron-up" onClick={() => nextHit(-1)} disabled={!hits.length} />
          <Btn icon="chevron-down" onClick={() => nextHit(1)} disabled={!hits.length} />
        </div>
      </div>
      <div className="xg__formula" dir="auto">
        <span className="xg__ref">{colName(sel.c)}{sel.r + 1}</span>
        <span className="xg__fx" aria-hidden="true">fx</span>
        <input value={edit ? edit.v : (cells[sel.r]?.[sel.c] ?? '')} readOnly={readOnly}
          onFocus={() => { if (!edit && !readOnly) setEdit({ r: sel.r, c: sel.c, v: cells[sel.r][sel.c] }); }}
          onChange={(e) => setEdit({ r: sel.r, c: sel.c, v: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); wrap.current?.focus(); } else if (e.key === 'Escape') { setEdit(null); wrap.current?.focus(); } }}
          onBlur={() => { if (edit && !document.activeElement?.classList?.contains('xg__in')) commit(); }} />
      </div>
      <div className="xg__scroll" ref={wrap} tabIndex={0} onKeyDown={onKey} onCopy={onCopy} onCut={onCut} onPaste={onPaste} dir={rtl ? 'rtl' : 'ltr'}>
        <div style={{ width: tableW, height: total + ROW_H, position: 'relative' }}>
          <div className="xg__row xg__row--head" style={{ top: 0, height: ROW_H, width: tableW }}>
            <div className="xg__corner" style={{ width: gutter }} onClick={() => setSel({ r: 0, c: 0, r2: rows - 1, c2: cols - 1 })} />
            {leftPad > 0 && <div style={{ width: leftPad, flex: 'none' }} />}
            {Array.from({ length: vc2 - vc1 }).map((_, i) => { const c = vc1 + i; return (
              <div key={c} className={`xg__colh${c >= rect.c1 && c <= rect.c2 ? ' is-on' : ''}`} style={{ width: colW[c] }}
                onPointerDown={(e) => { if (e.button === 0) setSel({ r: 0, c, r2: rows - 1, c2: c }); }}>
                {colName(c)}{sort?.c === c && <Icon name={sort.dir === 'asc' ? 'chevron-up' : 'chevron-down'} size={11} />}
                <i className="xg__rz" onPointerDown={(e) => startResize(e, c)} onDoubleClick={() => setWidths((w) => { const n = { ...w }; delete n[c]; return n; })} />
              </div>
            ); })}
          </div>
          {Array.from({ length: last - first }).map((_, i) => {
            const r = first + i;
            const inR = r >= rect.r1 && r <= rect.r2;
            return (
              <GridRow key={r} r={r} row={cells[r]} colW={colW} c1={vc1} c2={vc2} leftPad={leftPad} tableW={tableW} gutter={gutter}
                cls={`xg__row${r === 0 && !noHeader && hasHeader ? ' xg__row--hd' : ''}${r > 0 && r < src.length && r % 2 === 1 && T.band ? ' xg__row--alt' : ''}`}
                selC1={inR ? rect.c1 : -1} selC2={inR ? rect.c2 : -1} activeC={r === sel.r ? sel.c : -1}
                editC={edit && edit.r === r ? edit.c : -1} editV={edit && edit.r === r ? edit.v : ''} hitCols={hitMap.get(r)} rowOn={inR} h={h} />
            );
          })}
        </div>
      </div>
      <div className="xg__status">
        <span>{Math.max(1, src.length).toLocaleString()} {tt('rows', 'صف')} × {src[0]?.length || 1} {tt('columns', 'عمود')}</span>
        {sums && <span>{tt('Selected', 'المحدد')}: {sums.n} · Σ {+sums.s.toFixed(4)} · {tt('avg', 'متوسط')} {+sums.avg.toFixed(4)}</span>}
      </div>
    </div>
  );
}

export default memo(SheetGrid);
