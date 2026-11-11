import { key, keyR, keyC, MAXR, MAXC, colName } from './addr.js';
import { rewrite, shiftFormula, isErr } from './formula.js';
import { cmp, parseNum } from './core.js';
import { autoGrow } from './autofit.js';

const HIST = 100;
const cloneCell = (c) => (c ? { ...c } : null);
const cloneRule = (r) => { const { _c, ...o } = r; return { ...o, rng: { ...o.rng }, fmt: o.fmt ? { ...o.fmt } : o.fmt, colors: o.colors ? [...o.colors] : o.colors }; };
const cloneFilter = (f) => (f ? { rng: { ...f.rng }, cols: Object.fromEntries(Object.entries(f.cols).map(([k, v]) => [k, { ...v, allow: v.allow ? [...v.allow] : v.allow }])), hidden: new Set(f.hidden || []) } : null);
const cloneChart = (c) => { const { _d, ...o } = c; return { ...o, rng: { ...o.rng } }; };

/** Every mutation of the workbook from the UI goes through here so undo / redo / change events stay in one place. */
export class Ctl {
  constructor(wb) { this.wb = wb; this.undoS = []; this.redoS = []; this.subs = new Set(); this.clip = null; this.savedAt = 0; this.rev = 0; }
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  emit() { this.rev += 1; this.subs.forEach((f) => f()); }
  get canUndo() { return this.undoS.length > 0; }
  get canRedo() { return this.redoS.length > 0; }
  get dirty() { return this.rev !== this.savedAt; }
  markSaved() { this.savedAt = this.rev; this.subs.forEach((f) => f()); }

  cap(sheet, keys) {
    if (keys === 'all') return { all: true, cells: new Map([...sheet.cells].map(([k, c]) => [k, { ...c }])), meta: { colW: new Map(sheet.colW), rowH: new Map(sheet.rowH), merges: sheet.merges.map((m) => ({ ...m })), hr: new Set(sheet.hiddenRows), hc: new Set(sheet.hiddenCols), freeze: { ...sheet.freeze }, cf: sheet.cf.map(cloneRule), filter: cloneFilter(sheet.filter), charts: sheet.charts.map(cloneChart) } };
    return { cells: new Map(keys.map((k) => [k, cloneCell(sheet.cells.get(k))])) };
  }
  put(sheet, snap) {
    if (snap.all) { sheet.cells = new Map([...snap.cells].map(([k, c]) => [k, { ...c }])); const m = snap.meta; sheet.colW = new Map(m.colW); sheet.rowH = new Map(m.rowH); sheet.merges = m.merges.map((x) => ({ ...x })); sheet.hiddenRows = new Set(m.hr); sheet.hiddenCols = new Set(m.hc); sheet.freeze = { ...m.freeze }; sheet.cf = (m.cf || []).map(cloneRule); sheet.filter = cloneFilter(m.filter || null); sheet.charts = (m.charts || []).map(cloneChart); } else for (const [k, c] of snap.cells) { if (c) sheet.cells.set(k, { ...c }); else sheet.cells.delete(k); }
    sheet.recomputeBounds(); this.wb.touch();
  }
  /** keys: array of cell keys that fn may touch, or 'all' for structural edits. */
  run(sheet, keys, fn) {
    const ks = keys === 'all' ? 'all' : [...new Set(keys)];
    const before = this.cap(sheet, ks); fn(); autoGrow(this.wb, sheet, ks); const after = this.cap(sheet, ks);
    this.undoS.push({ sheet, before, after }); if (this.undoS.length > HIST) this.undoS.shift(); this.redoS = [];
    this.wb.touch(); this.emit();
  }
  undo() { const e = this.undoS.pop(); if (!e) return null; this.put(e.sheet, e.before); this.redoS.push(e); this.emit(); return e.sheet; }
  redo() { const e = this.redoS.pop(); if (!e) return null; this.put(e.sheet, e.after); this.undoS.push(e); this.emit(); return e.sheet; }
  cellKeys(g) { const out = []; const area = (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1); if (area > 200000) return 'all'; for (let r = g.r1; r <= g.r2; r += 1) for (let c = g.c1; c <= g.c2; c += 1) out.push(key(r, c)); return out; }

  /* ---------- cell edits ---------- */
  input(sheet, r, c, text) {
    this.run(sheet, [key(r, c)], () => { const fmt = this.wb.setInput(sheet, r, c, text); const cur = this.wb.styleOf(sheet, r, c); if (fmt && !(cur && cur.nf)) this.wb.setStyle(sheet, r, c, { nf: fmt }); });
  }
  /** Ctrl+Enter: same entry in every selected cell (relative refs shift like a fill). */
  inputRange(sheet, g, text) {
    this.run(sheet, this.cellKeys(g), () => { for (let r = g.r1; r <= g.r2; r += 1) for (let c = g.c1; c <= g.c2; c += 1) this.wb.setInput(sheet, r, c, text[0] === '=' ? shiftFormula(text.slice(1), r - g.r1, c - g.c1).replace(/^/, '=') : text); });
  }
  clear(sheet, g, what = 'contents') {
    const ks = this.cellKeys(g); const keys = ks === 'all' ? [...sheet.cells.keys()].filter((k) => keyR(k) >= g.r1 && keyR(k) <= g.r2 && keyC(k) >= g.c1 && keyC(k) <= g.c2) : ks;
    this.run(sheet, keys, () => { for (const k of keys) { const c = sheet.cells.get(k); if (!c) continue; if (what !== 'formats') { c.v = null; c.f = null; } if (what !== 'contents') c.s = 0; if (c.v === null && !c.f && !c.s) sheet.cells.delete(k); } });
  }
  style(sheet, g, patch) {
    const ks = this.cellKeys(g); if (ks === 'all') return;
    this.run(sheet, ks, () => { for (let r = g.r1; r <= g.r2; r += 1) for (let c = g.c1; c <= g.c2; c += 1) this.wb.setStyle(sheet, r, c, typeof patch === 'function' ? patch(this.wb.styleOf(sheet, r, c) || {}, r, c) : patch); });
  }
  /** Toggle helper: if every cell in the range already has the flag, remove it; otherwise set it. */
  toggle(sheet, g, prop) {
    let all = true; for (let r = g.r1; r <= g.r2 && all; r += 1) for (let c = g.c1; c <= g.c2; c += 1) { const s = this.wb.styleOf(sheet, r, c); if (!s || !s[prop]) { all = false; break; } }
    this.style(sheet, g, { [prop]: all ? null : 1 });
  }
  borders(sheet, g, mode, style = 'thin', color = '#000000') {
    const sides = { all: 'lrtb', outer: 'o', none: '', bottom: 'b', top: 't', left: 'l', right: 'r', thickBox: 'o', inner: 'i' }[mode] ?? 'lrtb'; const st = mode === 'thickBox' ? 'medium' : style;
    this.style(sheet, g, (cur, r, c) => {
      const bd = { ...(cur.bd || {}) };
      if (mode === 'none') return { bd: null };
      const set = (s) => { bd[s] = [st, color]; };
      if (sides === 'o') { if (r === g.r1) set('t'); if (r === g.r2) set('b'); if (c === g.c1) set('l'); if (c === g.c2) set('r'); } else if (sides === 'i') { if (r > g.r1) set('t'); if (r < g.r2) set('b'); if (c > g.c1) set('l'); if (c < g.c2) set('r'); } else for (const s of sides) set(s);
      return { bd };
    });
  }
  merge(sheet, g, on = true) {
    this.run(sheet, 'all', () => {
      sheet.merges = sheet.merges.filter((m) => !(m.r1 <= g.r2 && m.r2 >= g.r1 && m.c1 <= g.c2 && m.c2 >= g.c1));
      if (on && (g.r1 !== g.r2 || g.c1 !== g.c2)) { sheet.merges.push({ ...g }); for (let r = g.r1; r <= g.r2; r += 1) for (let c = g.c1; c <= g.c2; c += 1) if ((r !== g.r1 || c !== g.c1) && sheet.cells.has(key(r, c))) { const cell = sheet.cells.get(key(r, c)); cell.v = null; cell.f = null; } }
    });
  }
  setColW(sheet, cols, w, auto = false) { this.run(sheet, 'all', () => { cols.forEach((c) => { if (w === null) { sheet.colW.delete(c); sheet.manualW.delete(c); } else { sheet.colW.set(c, w); if (auto) sheet.manualW.delete(c); else sheet.manualW.add(c); } }); }); }
  setRowH(sheet, rows, h) { this.run(sheet, 'all', () => { rows.forEach((r) => (h === null ? sheet.rowH.delete(r) : sheet.rowH.set(r, h))); }); }
  hide(sheet, axis, idx, on) { this.run(sheet, 'all', () => { const set = axis === 'r' ? sheet.hiddenRows : sheet.hiddenCols; idx.forEach((i) => (on ? set.add(i) : set.delete(i))); }); }
  freeze(sheet, r, c) { this.run(sheet, 'all', () => { sheet.freeze = { r, c }; }); }

  /* ---------- clipboard ---------- */
  copy(sheet, g, cut = false) {
    const cells = []; const text = [];
    for (let r = g.r1; r <= g.r2; r += 1) { const row = []; const trow = []; for (let c = g.c1; c <= g.c2; c += 1) { const cell = sheet.cells.get(key(r, c)); row.push(cell ? { ...cell } : null); const v = this.wb.getValue(sheet, r, c); trow.push(v === null ? '' : isErr(v) ? v.code : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v)); } cells.push(row); text.push(trow); }
    const tsv = text.map((r) => r.map((t) => (/[\t\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t)).join('\t')).join('\n');
    this.clip = { cells, g: { ...g }, sheet, cut, tsv };
    return tsv;
  }
  /** Paste the internal clipboard (values + formulas + formats) or plain text rows. mode: all | values | formulas | formats */
  paste(sheet, r0, c0, { text, mode = 'all' } = {}) {
    const clip = this.clip;
    if (clip && (text === undefined || text === clip.tsv)) {
      const H = clip.cells.length; const W = clip.cells[0].length; const g = { r1: r0, c1: c0, r2: r0 + H - 1, c2: c0 + W - 1 };
      const keys = this.cellKeys(g); const srcKeys = clip.cut ? this.cellKeys(clip.g) : [];
      this.run(sheet, keys === 'all' || srcKeys === 'all' ? 'all' : [...keys, ...(clip.sheet === sheet ? srcKeys : [])], () => {
        for (let i = 0; i < H; i += 1) for (let j = 0; j < W; j += 1) {
          const src = clip.cells[i][j]; const k = key(r0 + i, c0 + j);
          if (mode === 'formats') { if (src && src.s) this.wb.setStyle(sheet, r0 + i, c0 + j, this.wb.styles[src.s]); continue; }
          const dst = sheet.cells.get(k) || { v: null, f: null, s: 0 };
          if (!src) { dst.v = null; dst.f = null; if (mode === 'all') dst.s = 0; } else {
            if (mode === 'values') { dst.f = null; dst.v = src.f ? this.wb.getValue(clip.sheet, clip.g.r1 + i, clip.g.c1 + j) : src.v; if (isErr(dst.v) === false && dst.v === undefined) dst.v = null; } else { dst.f = src.f ? (clip.cut ? src.f : shiftFormula(src.f, r0 - clip.g.r1, c0 - clip.g.c1)) : null; dst.v = src.f ? null : src.v; }
            if (mode === 'all') dst.s = src.s;
          }
          if (dst.v === null && !dst.f && !dst.s) sheet.cells.delete(k); else { sheet.cells.set(k, dst); sheet.bump(r0 + i, c0 + j); }
        }
        if (clip.cut) { for (let r = clip.g.r1; r <= clip.g.r2; r += 1) for (let c = clip.g.c1; c <= clip.g.c2; c += 1) { if (r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2 && clip.sheet === sheet) continue; clip.sheet.cells.delete(key(r, c)); } }
      });
      if (clip.cut) { this.clip = { ...clip, cut: false, cells: clip.cells.map((row) => row.map((c) => cloneCell(c))) }; }
      return g;
    }
    const rows = parseTsv(text || ''); if (!rows.length) return null;
    const g = { r1: r0, c1: c0, r2: r0 + rows.length - 1, c2: c0 + Math.max(...rows.map((r) => r.length)) - 1 };
    this.run(sheet, this.cellKeys(g), () => { rows.forEach((row, i) => row.forEach((t, j) => { const fmt = this.wb.setInput(sheet, r0 + i, c0 + j, t); if (fmt) this.wb.setStyle(sheet, r0 + i, c0 + j, { nf: fmt }); })); });
    return g;
  }

  /* ---------- autofill ---------- */
  /** Extends `src` over `dst` (same rows or same columns). */
  fill(sheet, src, dst) {
    const down = dst.r1 > src.r2 || dst.r2 < src.r1 ? true : false; const vertical = dst.c1 === src.c1 && dst.c2 === src.c2 && (dst.r1 !== src.r1 || dst.r2 !== src.r2);
    const horizontal = !vertical && dst.r1 === src.r1 && dst.r2 === src.r2;
    void down;
    const all = { r1: Math.min(src.r1, dst.r1), c1: Math.min(src.c1, dst.c1), r2: Math.max(src.r2, dst.r2), c2: Math.max(src.c2, dst.c2) };
    const keys = this.cellKeys(all); if (keys === 'all') return;
    this.run(sheet, keys, () => {
      const lines = vertical ? src.c2 - src.c1 + 1 : src.r2 - src.r1 + 1; const n = vertical ? src.r2 - src.r1 + 1 : src.c2 - src.c1 + 1;
      for (let l = 0; l < lines; l += 1) {
        const cell = (i) => (vertical ? sheet.cells.get(key(src.r1 + i, src.c1 + l)) : sheet.cells.get(key(src.r1 + l, src.c1 + i)));
        const srcCells = Array.from({ length: n }, (_, i) => cell(i));
        const nums = srcCells.map((c) => (c && !c.f && typeof c.v === 'number' ? c.v : null));
        const series = n >= 2 && nums.every((x) => x !== null) ? (nums[n - 1] - nums[0]) / (n - 1) : null;
        const textNum = srcCells.length && srcCells.every((c) => c && !c.f && typeof c.v === 'string' && /\d+$/.test(c.v));
        const total = vertical ? (dst.r2 - dst.r1 + 1) : (dst.c2 - dst.c1 + 1); const before = vertical ? dst.r1 < src.r1 : dst.c1 < src.c1;
        for (let t = 0; t < total; t += 1) {
          const pos = before ? total - 1 - t : t; // distance from the source edge (1-based = pos + 1)
          const r = vertical ? (before ? src.r1 - 1 - pos : src.r2 + 1 + pos) : src.r1 + l; const c = vertical ? src.c1 + l : (before ? src.c1 - 1 - pos : src.c2 + 1 + pos);
          if (r < 0 || c < 0 || r >= MAXR || c >= MAXC) continue;
          const off = before ? -(pos + 1) : pos + 1 + (n - 1); const si = ((before ? n - 1 - (pos % n) : pos % n) + n) % n; const sc = srcCells[si]; const k = key(r, c);
          if (!sc) { sheet.cells.delete(k); continue; }
          const d = { v: sc.v, f: sc.f, s: sc.s };
          if (sc.f) d.f = shiftFormula(sc.f, r - (vertical ? src.r1 + si : src.r1 + l), c - (vertical ? src.c1 + l : src.c1 + si));
          else if (series !== null) d.v = nums[n - 1] + series * (before ? -(pos + 1) - 0 + (n - 1) * 0 + (-series === 0 ? 0 : 0) : pos + 1) + (before ? -(nums[n - 1] - nums[0]) + (nums[0] - nums[n - 1]) * 0 + (series * (n - 1)) * 0 : 0) - (before ? series * (n - 1) : 0) + (before ? series * 0 : 0);
          else if (textNum && n === 1) { const m = /^(.*?)(\d+)$/.exec(sc.v); d.v = m[1] + String(+m[2] + (before ? -(pos + 1) : pos + 1)).padStart(m[2].length, '0'); }
          void off;
          sheet.cells.set(k, d); sheet.bump(r, c);
        }
      }
      void horizontal;
    });
  }

  /* ---------- structure ---------- */
  /** Adjusts every formula in the workbook after rows / columns were inserted (n>0) or deleted (n<0) on `target`. */
  rewriteAll(target, axis, at, n) {
    const adj = (lo, hi) => {
      if (n > 0) return [lo >= at ? lo + n : lo, hi >= at ? hi + n : hi];
      const cnt = -n; const end = at + cnt - 1;
      if (lo >= at && hi <= end) return null;
      const nl = lo > end ? lo - cnt : lo >= at ? at : lo; const nh = hi > end ? hi - cnt : hi >= at ? at - 1 + 0 : hi;
      return [nl, hi > end ? hi - cnt : hi >= at ? at - 1 : hi];
    };
    void adj;
    const one = (lo, hi) => {
      if (n > 0) return [lo >= at ? lo + n : lo, hi >= at ? hi + n : hi];
      const cnt = -n; const end = at + cnt - 1;
      if (lo >= at && hi <= end) return null;
      const nl = lo > end ? lo - cnt : lo >= at ? at : lo;
      const nh = hi > end ? hi - cnt : hi >= at ? at - 1 : hi;
      return nh < nl ? null : [nl, nh];
    };
    for (const sh of this.wb.sheets) {
      for (const cell of sh.cells.values()) {
        if (!cell.f) continue;
        cell.f = rewrite(cell.f, (ref) => {
          const owner = ref.sheet ? this.wb.sheetByName(ref.sheet) : sh; if (owner !== target) return ref;
          if (axis === 'r') { if (ref.whole === 'col') return ref; const x = one(ref.r1, ref.r2); return x ? { r1: x[0], c1: ref.c1, r2: x[1], c2: ref.c2 } : null; }
          if (ref.whole === 'row') return ref; const x = one(ref.c1, ref.c2); return x ? { r1: ref.r1, c1: x[0], r2: ref.r2, c2: x[1] } : null;
        });
      }
    }
  }
  insert(sheet, axis, at, n = 1) { this.shiftAxis(sheet, axis, at, n); }
  remove(sheet, axis, at, n = 1) { this.shiftAxis(sheet, axis, at, -n); }
  shiftAxis(sheet, axis, at, n) {
    const snaps = this.wb.sheets.map((s) => [s, this.cap(s, 'all')]);
    const moved = new Map();
    for (const [k, cell] of sheet.cells) {
      let r = keyR(k); let c = keyC(k); const v = axis === 'r' ? r : c;
      if (n > 0 ? v >= at : v >= at && v < at - n) { if (n < 0 && v < at - n) continue; }
      if (n < 0 && v >= at && v < at - n) continue;
      if (v >= at) { if (axis === 'r') r += n; else c += n; }
      if (r < MAXR && c < MAXC) moved.set(key(r, c), cell);
    }
    sheet.cells = moved;
    const shiftMap = (m) => { const out = new Map(); for (const [i, x] of m) { if (n < 0 && i >= at && i < at - n) continue; out.set(i >= at ? i + n : i, x); } return out; };
    const shiftSet = (s) => { const out = new Set(); for (const i of s) { if (n < 0 && i >= at && i < at - n) continue; out.add(i >= at ? i + n : i); } return out; };
    if (axis === 'r') { sheet.rowH = shiftMap(sheet.rowH); sheet.hiddenRows = shiftSet(sheet.hiddenRows); } else { sheet.colW = shiftMap(sheet.colW); sheet.hiddenCols = shiftSet(sheet.hiddenCols); }
    sheet.merges = sheet.merges.map((m) => {
      const lo = axis === 'r' ? m.r1 : m.c1; const hi = axis === 'r' ? m.r2 : m.c2; let nl = lo; let nh = hi;
      if (n > 0) { if (lo >= at) nl += n; if (hi >= at) nh += n; } else { const end = at - n - 1; if (lo >= at && hi <= end) return null; nl = lo > end ? lo + n : lo >= at ? at : lo; nh = hi > end ? hi + n : hi >= at ? at - 1 : hi; }
      return axis === 'r' ? { ...m, r1: nl, r2: nh } : { ...m, c1: nl, c2: nh };
    }).filter((m) => m && (m.r1 !== m.r2 || m.c1 !== m.c2));
    // conditional formats, the filter and the charts' data follow the cells they were attached to
    const sh = (g) => { const lo = axis === 'r' ? g.r1 : g.c1; const hi = axis === 'r' ? g.r2 : g.c2; let nl = lo; let nh = hi;
      if (n > 0) { if (lo >= at) nl += n; if (hi >= at) nh += n; } else { const end = at - n - 1; if (lo >= at && hi <= end) return null; nl = lo > end ? lo + n : lo >= at ? at : lo; nh = hi > end ? hi + n : hi >= at ? at - 1 : hi; }
      return axis === 'r' ? { ...g, r1: nl, r2: nh } : { ...g, c1: nl, c2: nh }; };
    sheet.cf = sheet.cf.map((x) => { const g = sh(x.rng); return g ? { ...x, rng: g, _c: undefined } : null; }).filter(Boolean);
    sheet.charts = sheet.charts.map((x) => { const g = sh(x.rng); return g ? { ...x, rng: g, _d: undefined } : null; }).filter(Boolean);
    if (sheet.filter) { const g = sh(sheet.filter.rng); if (g) { sheet.filter = { ...sheet.filter, rng: g, hidden: new Set([...(sheet.filter.hidden || [])].filter((i) => !(axis === 'r' && (n < 0 && i >= at && i < at - n))).map((i) => (axis === 'r' && i >= at ? i + n : i))) }; } else sheet.filter = null; }
    this.rewriteAll(sheet, axis, at, n);
    sheet.recomputeBounds();
    const afters = snaps.map(([s]) => [s, this.cap(s, 'all')]);
    const entry = { multi: snaps.map(([s, b], i) => ({ sheet: s, before: b, after: afters[i][1] })) };
    this.undoS.push({ sheet, before: null, after: null, ...entry }); if (this.undoS.length > HIST) this.undoS.shift(); this.redoS = [];
    this.wb.touch(); this.emit();
  }
  sort(sheet, g, col, asc = true, header = false, post = null) {
    const keys = post ? 'all' : this.cellKeys(g); if (keys === 'all' && !post) return;
    this.run(sheet, keys, () => {
      const rows = []; for (let r = g.r1 + (header ? 1 : 0); r <= g.r2; r += 1) { const row = []; for (let c = g.c1; c <= g.c2; c += 1) row.push({ cell: sheet.cells.get(key(r, c)), r, c }); rows.push({ row, key: this.wb.getValue(sheet, r, col) }); }
      const rank = (v) => (v === null ? 9 : 0);
      rows.sort((a, b) => { const ra = rank(a.key); const rb = rank(b.key); if (ra !== rb) return ra - rb; return (asc ? 1 : -1) * cmp(a.key, b.key); });
      const r0 = g.r1 + (header ? 1 : 0);
      rows.forEach((x, i) => x.row.forEach(({ cell }, j) => { const k = key(r0 + i, g.c1 + j); if (cell) { const d = { ...cell }; if (d.f) d.f = shiftFormula(d.f, r0 + i - x.row[j].r, 0); sheet.cells.set(k, d); } else sheet.cells.delete(k); }));
      if (post) post();
    });
  }
  addSheet(name) { const s = this.wb.addSheet(name); this.emit(); return s; }
  renameSheet(sheet, name) {
    const old = sheet.name; const nm = String(name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim(); if (!nm || this.wb.sheets.some((s) => s !== sheet && s.name.toLowerCase() === nm.toLowerCase())) return false;
    for (const sh of this.wb.sheets) for (const c of sh.cells.values()) if (c.f) c.f = rewrite(c.f, (ref) => ref);
    sheet.name = nm; this.fixSheetRefs(old, nm); this.wb.touch(); this.emit(); return true;
  }
  fixSheetRefs(old, nm) {
    const q = (n) => (/^[A-Za-z_][\w.]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`); const re = new RegExp(`(?:'${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "''")}'|${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})!`, 'g');
    for (const sh of this.wb.sheets) for (const c of sh.cells.values()) if (c.f) c.f = c.f.replace(re, `${q(nm)}!`);
  }
  deleteSheet(sheet) { if (this.wb.sheets.length < 2) return false; this.wb.sheets = this.wb.sheets.filter((s) => s !== sheet); this.wb.touch(); this.emit(); return true; }
}

export function parseTsv(text) {
  const rows = []; let row = []; let f = ''; let q = false; const t = String(text).replace(/\r\n?/g, '\n');
  for (let i = 0; i < t.length; i += 1) { const ch = t[i]; if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i += 1; } else q = false; } else f += ch; } else if (ch === '"' && f === '') q = true; else if (ch === '\t') { row.push(f); f = ''; } else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else f += ch; }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
void colName; void parseNum;
