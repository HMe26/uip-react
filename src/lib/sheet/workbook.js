import { E, XlErr, isErr, parse, ERR_BY_CODE } from './formula.js';
import { key, keyR, keyC, MAXR, MAXC } from './addr.js';
import { Rng, isRng, isArr, toArr, sc, toNum, toStr, cmp, parseNum, parseDateText, clip } from './core.js';
import { FUNCS } from './funcs.js';

/**
 * Workbook = sheets + defined names. A cell is { v, f, s }:
 *   v  constant value (number | string | boolean | XlErr | null)    f  formula text without "="    s  style id (index into wb.styles)
 * Computed values live in sheet.cache (cleared on every edit; recomputed lazily). Dynamic-array results go to sheet.spill.
 */
export class Sheet {
  constructor(wb, name) {
    this.wb = wb; this.name = name;
    this.cells = new Map(); this.cache = new Map(); this.spill = new Map(); this.spillOf = new Map();
    this.colW = new Map(); this.manualW = new Set(); this.rowH = new Map(); this.hiddenCols = new Set(); this.hiddenRows = new Set();
    this.merges = []; this.freeze = { r: 0, c: 0 };
    this.cf = []; this.filter = null; this.charts = [];
    this.maxRow = 0; this.maxCol = 0;
  }
  bump(r, c) { if (r > this.maxRow) this.maxRow = r; if (c > this.maxCol) this.maxCol = c; }
  cell(r, c) { return this.cells.get(key(r, c)); }
  cellsIn(r1, c1, r2, c2, cb) { for (const [k, cell] of this.cells) { const r = keyR(k); const c = keyC(k); if (r >= r1 && r <= r2 && c >= c1 && c <= c2 && (cell.v !== null || cell.f)) cb(r, c, cell); } }
  spillIn(r1, c1, r2, c2, cb) { for (const k of this.spill.keys()) { const r = keyR(k); const c = keyC(k); if (r >= r1 && r <= r2 && c >= c1 && c <= c2 && !this.cells.has(k)) cb(r, c); } }
  recomputeBounds() { this.maxRow = 0; this.maxCol = 0; for (const [k, cell] of this.cells) if (cell.v !== null || cell.f || cell.s) this.bump(keyR(k), keyC(k)); }
}

const cmpOps = { '=': (c) => c === 0, '<>': (c) => c !== 0, '<': (c) => c < 0, '>': (c) => c > 0, '<=': (c) => c <= 0, '>=': (c) => c >= 0 };

export class Workbook {
  constructor() {
    this.sheets = []; this.names = new Map(); this.styles = [{}]; this.dirty = true; this.calculating = false; this.circular = false;
    this.volatile = false; this.d1904 = false; this.astCache = new Map(); this.version = 0;
  }
  addSheet(name) { const s = new Sheet(this, name || `Sheet${this.sheets.length + 1}`); this.sheets.push(s); this.touch(); return s; }
  sheetByName(n) { const u = String(n).toLowerCase(); return this.sheets.find((s) => s.name.toLowerCase() === u) || null; }
  touch() { this.dirty = true; this.version += 1; }
  styleId(st) { const k = JSON.stringify(st); let i = this.styles.findIndex((x) => JSON.stringify(x) === k); if (i < 0) { i = this.styles.length; this.styles.push(st); } return i; }

  /* ---------- editing ---------- */
  /** Typed-in text -> constant or formula, like Excel's entry parser. Returns the style patch (e.g. a date format) if the entry implies one. */
  setInput(sheet, r, c, text) {
    const t = String(text ?? '');
    const k = key(r, c); let cell = sheet.cells.get(k);
    if (!cell) { cell = { v: null, f: null, s: 0 }; sheet.cells.set(k, cell); }
    cell.f = null; let fmt = null;
    if (t === '') cell.v = null;
    else if (t[0] === '=' && t.length > 1) { cell.f = t.slice(1); cell.v = null; } else if (t[0] === "'") cell.v = t.slice(1);
    else if (/^(true|false)$/i.test(t.trim())) cell.v = t.trim().toLowerCase() === 'true';
    else if (ERR_BY_CODE[t.trim().toUpperCase()]) cell.v = ERR_BY_CODE[t.trim().toUpperCase()];
    else {
      const n = parseNum(t);
      if (n !== null) { cell.v = n; if (/%\s*$/.test(t)) fmt = '0%'; else if (/^[+-]?\s*[$€£]/.test(t)) fmt = '"$"#,##0.00'; } else {
        const d = parseDateText(t);
        if (d !== null && /[-/:]/.test(t)) { cell.v = d; fmt = /:/.test(t) && !/[-/]/.test(t) ? 'h:mm:ss' : /:/.test(t) ? 'yyyy-mm-dd h:mm' : 'yyyy-mm-dd'; } else cell.v = t;
      }
    }
    if (!cell.f && cell.v === null && !cell.s) sheet.cells.delete(k); else sheet.bump(r, c);
    this.touch();
    return fmt;
  }
  setValue(sheet, r, c, v) { const k = key(r, c); let cell = sheet.cells.get(k); if (!cell) { cell = { v: null, f: null, s: 0 }; sheet.cells.set(k, cell); } cell.f = null; cell.v = v; sheet.bump(r, c); this.touch(); }
  setFormula(sheet, r, c, f) { const k = key(r, c); let cell = sheet.cells.get(k); if (!cell) { cell = { v: null, f: null, s: 0 }; sheet.cells.set(k, cell); } cell.f = f.replace(/^=/, ''); cell.v = null; sheet.bump(r, c); this.touch(); }
  setStyle(sheet, r, c, patch) {
    const k = key(r, c); let cell = sheet.cells.get(k); if (!cell) { cell = { v: null, f: null, s: 0 }; sheet.cells.set(k, cell); }
    const next = { ...this.styles[cell.s] }; for (const [p, val] of Object.entries(patch)) { if (val === null || val === undefined || val === false) delete next[p]; else next[p] = val; }
    cell.s = Object.keys(next).length ? this.styleId(next) : 0; sheet.bump(r, c); this.version += 1;
  }
  styleOf(sheet, r, c) { const cell = sheet.cells.get(key(r, c)); return cell && cell.s ? this.styles[cell.s] : null; }
  /** What the formula bar shows. */
  inputText(sheet, r, c) {
    const cell = sheet.cells.get(key(r, c)); if (!cell) return '';
    if (cell.f) return `=${cell.f}`;
    const v = cell.v; if (v === null) return '';
    if (typeof v === 'string') return /^[=']/.test(v) || (parseNum(v) !== null) || /^(true|false)$/i.test(v) ? `'${v}` : v;
    return toStr(v);
  }

  /* ---------- calculation ---------- */
  ensure() { if (this.dirty && !this.calculating) this.recalc(); }
  recalc() {
    this.calculating = true; this.circular = false;
    try {
      for (let pass = 0; pass < 3; pass += 1) {
        let spilled = 0;
        for (const s of this.sheets) { s.cache.clear(); s.spill.clear(); s.spillOf.clear(); }
        this.state = new Map();
        for (const s of this.sheets) {
          const fcells = []; for (const [k, cell] of s.cells) if (cell.f) fcells.push(k);
          fcells.sort((a, b) => a - b);
          for (const k of fcells) { this.evalCell(s, keyR(k), keyC(k)); }
          spilled += s.spill.size;
        }
        if (!spilled) break;
      }
    } finally { this.calculating = false; this.dirty = false; }
  }
  /** Value of one cell (constant, computed formula, spilled value, or null). */
  getValue(sheet, r, c) {
    this.ensure();
    const k = key(r, c); const cell = sheet.cells.get(k);
    if (cell) return cell.f ? this.evalCell(sheet, r, c) : cell.v;
    const sp = sheet.spill.get(k); return sp === undefined ? null : sp;
  }
  evalCell(sheet, r, c) {
    const k = key(r, c); const cell = sheet.cells.get(k);
    if (sheet.cache.has(k)) return sheet.cache.get(k);
    const mark = `${sheet.name}!${k}`;
    if (this.state.get(mark) === 1) { this.circular = true; return 0; }
    this.state.set(mark, 1);
    let out;
    try {
      let ast = this.astCache.get(cell.f);
      if (!ast) { ast = parse(cell.f); this.astCache.set(cell.f, ast); }
      const ctx = { wb: this, sheet, r, c };
      let v = this.ev(ast, ctx);
      if (isRng(v) && v.single) v = this.getValue(v.sheet, v.r1, v.c1);
      if (isRng(v) && !v.single) { const g = clip(v); v = toArr(ctx, g); }
      if (isArr(v)) {
        const rows = v.length; const cols = v[0] ? v[0].length : 0;
        if (rows === 1 && cols === 1) out = v[0][0] ?? 0;
        else if (rows === 0 || cols === 0) out = E.CALC;
        else {
          let blocked = r + rows > MAXR || c + cols > MAXC;
          for (let i = 0; i < rows && !blocked; i += 1) for (let j = 0; j < cols; j += 1) { if ((i || j) && sheet.cells.has(key(r + i, c + j))) { blocked = true; break; } const own = sheet.spillOf.get(key(r + i, c + j)); if ((i || j) && own !== undefined && own !== k) { blocked = true; break; } }
          if (blocked) out = E.SPILL;
          else {
            for (let i = 0; i < rows; i += 1) for (let j = 0; j < cols; j += 1) { const kk = key(r + i, c + j); sheet.spillOf.set(kk, k); if (i || j) sheet.spill.set(kk, v[i][j] ?? null); sheet.bump(r + i, c + j); }
            out = v[0][0] ?? 0;
          }
        }
      } else out = v === null || v === undefined ? 0 : v;
    } catch (e) {
      if (e instanceof XlErr) out = e; else if (e instanceof Error && /Unexpected|Missing|Expected|Bad array|Unsupported/.test(e.message)) out = cell.f.includes('#REF!') ? E.REF : E.NAME; else throw e;
    }
    this.state.set(mark, 2); sheet.cache.set(k, out);
    return out;
  }

  /* ---------- evaluator: returns scalar | Rng | array; XlErr is thrown ---------- */
  resolveSheet(ctx, name) { if (!name) return ctx.sheet; const s = this.sheetByName(name); if (!s) throw E.REF; return s; }
  ev(n, ctx) {
    switch (n.t) {
      case 'num': case 'str': case 'bool': return n.v;
      case 'err': throw ERR_BY_CODE[n.v] || E.VALUE;
      case 'empty': return null;
      case 'paren': return this.ev(n.a, ctx);
      case 'ref': { const s = this.resolveSheet(ctx, n.sheet); return new Rng(s, n.r1, n.c1, n.r2, n.c2); }
      case 'rng': {
        const a = this.ev(n.a, ctx); const b = this.ev(n.b, ctx);
        if (!isRng(a) || !isRng(b) || a.sheet !== b.sheet) throw E.VALUE;
        return new Rng(a.sheet, Math.min(a.r1, b.r1), Math.min(a.c1, b.c1), Math.max(a.r2, b.r2), Math.max(a.c2, b.c2));
      }
      case 'name': {
        const def = this.names.get(n.n.toUpperCase()); if (!def) throw E.NAME;
        if (def.ref) { const s = this.sheetByName(def.ref.sheet) || ctx.sheet; return new Rng(s, def.ref.r1, def.ref.c1, def.ref.r2, def.ref.c2); }
        let ast = this.astCache.get(def.f); if (!ast) { ast = parse(def.f); this.astCache.set(def.f, ast); }
        return this.ev(ast, ctx);
      }
      case 'arr': return n.rows.map((row) => row.map((x) => { const v = this.ev(x, ctx); return isRng(v) || isArr(v) ? sc(ctx, v) : v; }));
      case 'pct': return this.lift1(ctx, this.ev(n.a, ctx), (v) => toNum(v) / 100);
      case 'un': { const v = this.ev(n.a, ctx); return this.lift1(ctx, v, (x) => (n.op === '-' ? -toNum(x) : toNum(x))); }
      case 'bin': return this.binary(ctx, n.op, this.ev(n.a, ctx), this.ev(n.b, ctx));
      case 'call': return this.call(n, ctx);
      default: throw E.VALUE;
    }
  }
  lift1(ctx, v, fn) {
    if (isRng(v) && v.single) return fn(sc(ctx, v));
    if (isRng(v) || (isArr(v) && (v.length > 1 || v[0].length > 1))) return toArr(ctx, v).map((row) => row.map((x) => { try { if (isErr(x)) return x; return fn(x); } catch (e) { if (e instanceof XlErr) return e; throw e; } }));
    return fn(sc(ctx, v));
  }
  binary(ctx, op, a, b) {
    const multi = (x) => (isRng(x) ? !x.single : isArr(x) && (x.length > 1 || x[0].length > 1));
    const f = (x, y) => this.scalarOp(op, x, y);
    if (!multi(a) && !multi(b)) return f(sc(ctx, a), sc(ctx, b));
    const A = multi(a) ? toArr(ctx, a) : null; const B = multi(b) ? toArr(ctx, b) : null;
    const sa = A ? null : sc(ctx, a); const sb = B ? null : sc(ctx, b);
    const R = Math.max(A ? A.length : 1, B ? B.length : 1); const C = Math.max(A ? A[0].length : 1, B ? B[0].length : 1);
    const out = [];
    for (let i = 0; i < R; i += 1) {
      const row = [];
      for (let j = 0; j < C; j += 1) {
        try {
          const x = A ? A[A.length === 1 ? 0 : i]?.[A[0].length === 1 ? 0 : j] : sa; const y = B ? B[B.length === 1 ? 0 : i]?.[B[0].length === 1 ? 0 : j] : sb;
          if (x === undefined || y === undefined) throw E.NA;
          if (isErr(x)) throw x; if (isErr(y)) throw y;
          row.push(f(x, y));
        } catch (e) { if (e instanceof XlErr) row.push(e); else throw e; }
      }
      out.push(row);
    }
    return out;
  }
  scalarOp(op, x, y) {
    switch (op) {
      case '+': return toNum(x) + toNum(y);
      case '-': return toNum(x) - toNum(y);
      case '*': return toNum(x) * toNum(y);
      case '/': { const d = toNum(y); if (d === 0) throw E.DIV0; return toNum(x) / d; }
      case '^': { const r = toNum(x) ** toNum(y); if (!isFinite(r)) throw E.NUM; return r; }
      case '&': return toStr(x) + toStr(y);
      default: return cmpOps[op](cmp(x, y));
    }
  }
  call(n, ctx) {
    const def = FUNCS[n.n];
    if (!def) throw E.NAME;
    if (def.lazy) return def.fn(ctx, n.args, (node) => this.ev(node, ctx), this);
    const args = n.args.map((a) => { const v = this.ev(a, ctx); if (a.t === 'empty') return null; return v; });
    if (def.min !== undefined && args.length < def.min) throw E.VALUE;
    if (def.max !== undefined && args.length > def.max) throw E.VALUE;
    return def.fn(ctx, args, this);
  }

  /** Evaluate arbitrary formula text on a sheet (used by conditional formats, validation, the name box). */
  evalFormula(sheet, r, c, f) {
    this.ensure();
    try {
      const ast = this.astCache.get(f) || parse(f); this.astCache.set(f, ast);
      const ctx = { wb: this, sheet, r, c }; let v = this.ev(ast, ctx);
      if (isRng(v)) v = v.single ? this.getValue(v.sheet, v.r1, v.c1) : toArr(ctx, clip(v));
      return v;
    } catch (e) { if (e instanceof XlErr) return e; return E.NAME; }
  }
}
