import { E, XlErr, isErr } from './formula.js';
import { general } from './format.js';

/** A (lazy) range reference: values are read from the sheet only when a function needs them. */
export class Rng {
  constructor(sheet, r1, c1, r2, c2) { this.sheet = sheet; this.r1 = r1; this.c1 = c1; this.r2 = r2; this.c2 = c2; }
  get rows() { return this.r2 - this.r1 + 1; }
  get cols() { return this.c2 - this.c1 + 1; }
  get single() { return this.r1 === this.r2 && this.c1 === this.c2; }
}
export const isRng = (x) => x instanceof Rng;
export const isArr = (x) => Array.isArray(x);

export const throwErr = (e) => { throw e; };

/** Range clipped to the used area of its sheet (so A:A does not mean a million rows). */
export function clip(rng) {
  const s = rng.sheet;
  const r2 = Math.min(rng.r2, Math.max(rng.r1, s.maxRow));
  const c2 = Math.min(rng.c2, Math.max(rng.c1, s.maxCol));
  return new Rng(s, rng.r1, rng.c1, r2, c2);
}

export function toArr(ctx, x) {
  if (isRng(x)) {
    const g = clip(x); const out = [];
    for (let r = g.r1; r <= g.r2; r += 1) { const row = []; for (let c = g.c1; c <= g.c2; c += 1) row.push(ctx.wb.getValue(g.sheet, r, c)); out.push(row); }
    return out;
  }
  if (isArr(x)) return x;
  return [[x]];
}
/** Calls cb(value, r, c) for every non-empty cell of a range (sparse sheets stay fast). */
export function eachCell(ctx, rng, cb) {
  const s = rng.sheet;
  const area = (rng.r2 - rng.r1 + 1) * (rng.c2 - rng.c1 + 1);
  if (area > s.cells.size * 2 + 64) {
    s.cellsIn(rng.r1, rng.c1, rng.r2, rng.c2, (r, c) => cb(ctx.wb.getValue(s, r, c), r, c));
    s.spillIn(rng.r1, rng.c1, rng.r2, rng.c2, (r, c) => cb(ctx.wb.getValue(s, r, c), r, c));
    return;
  }
  for (let r = rng.r1; r <= rng.r2; r += 1) for (let c = rng.c1; c <= rng.c2; c += 1) { const v = ctx.wb.getValue(s, r, c); if (v !== null) cb(v, r, c); }
}

/** Single value: a one-cell range / 1x1 array is unwrapped; a bigger one uses implicit intersection. Errors are thrown. */
export function sc(ctx, x) {
  let v = x;
  if (isRng(x)) {
    if (x.single) v = ctx.wb.getValue(x.sheet, x.r1, x.c1);
    else if (x.cols === 1 && ctx.r >= x.r1 && ctx.r <= x.r2 && ctx.sheet === x.sheet) v = ctx.wb.getValue(x.sheet, ctx.r, x.c1);
    else if (x.rows === 1 && ctx.c >= x.c1 && ctx.c <= x.c2 && ctx.sheet === x.sheet) v = ctx.wb.getValue(x.sheet, x.r1, ctx.c);
    else throw E.VALUE;
  } else if (isArr(x)) v = x[0]?.[0] ?? null;
  if (isErr(v)) throw v;
  return v;
}

export function parseNum(s) {
  const t = String(s).trim();
  if (t === '') return null;
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return Number(t);
  let m = /^([+-]?)\s*[$€£]?\s*([\d,]+(?:\.\d+)?)\s*$/.exec(t);
  if (m && /^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(m[2])) return Number(m[1] + m[2].replace(/,/g, ''));
  m = /^([+-]?[\d.,]+)\s*%$/.exec(t);
  if (m && !isNaN(Number(m[1].replace(/,/g, '')))) return Number(m[1].replace(/,/g, '')) / 100;
  return null;
}
export function toNum(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') { const n = parseNum(v); if (n !== null) return n; const d = parseDateText(v); if (d !== null) return d; throw E.VALUE; }
  throw E.VALUE;
}
export const num = (ctx, x) => toNum(sc(ctx, x));
export function toStr(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return general(v);
  if (isErr(v)) return v.code;
  return String(v);
}
export const str = (ctx, x) => toStr(sc(ctx, x));
export function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (v === null || v === '') return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') { const u = v.toUpperCase(); if (u === 'TRUE') return true; if (u === 'FALSE') return false; }
  throw E.VALUE;
}
export const bool = (ctx, x) => toBool(sc(ctx, x));
/** Integer argument (truncated). */
export const int = (ctx, x) => Math.trunc(num(ctx, x));

/** Date text -> serial (yyyy-mm-dd, m/d/yyyy, d-mmm-yyyy, hh:mm[:ss]) or null. */
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function parseDateText(s) {
  const t = String(s).trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  let y; let mo; let d; let tm = 0;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; if (m[4]) tm = (+m[4] * 3600 + +m[5] * 60 + +(m[6] || 0)) / 86400; } else if ((m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(t))) { mo = +m[1]; d = +m[2]; y = +m[3]; if (y < 100) y += y < 30 ? 2000 : 1900; } else if ((m = /^(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s,]*(\d{2,4})$/.exec(t))) { d = +m[1]; mo = MON.indexOf(m[2].toLowerCase()) + 1; y = +m[3]; if (y < 100) y += y < 30 ? 2000 : 1900; if (!mo) return null; } else if ((m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(t))) {
    let h = +m[1]; if (m[4]) { h %= 12; if (/pm/i.test(m[4])) h += 12; }
    return (h * 3600 + +m[2] * 60 + +(m[3] || 0)) / 86400;
  } else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = Date.UTC(y, mo - 1, d);
  let days = Math.round((dt - Date.UTC(1899, 11, 30)) / 86400000);
  if (days < 61) days -= 1;
  return days + tm;
}

/** Excel ordering: numbers < text < booleans; text is case-insensitive; empty acts as 0 / "". */
const rank = (v) => (typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : typeof v === 'boolean' ? 3 : 0);
export function cmp(a, b) {
  let x = a; let y = b;
  if (x === null) x = typeof y === 'string' ? '' : typeof y === 'boolean' ? false : 0;
  if (y === null) y = typeof x === 'string' ? '' : typeof x === 'boolean' ? false : 0;
  const rx = rank(x); const ry = rank(y);
  if (rx !== ry) return rx < ry ? -1 : 1;
  if (rx === 2) { const p = x.toLowerCase(); const q = y.toLowerCase(); return p < q ? -1 : p > q ? 1 : 0; }
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Wildcards (* ? ~) -> RegExp, or null when the text has none. */
export function wildcard(pat, flags = 'i') {
  if (!/[*?~]/.test(pat)) return null;
  let re = '';
  for (let i = 0; i < pat.length; i += 1) {
    const ch = pat[i];
    if (ch === '~' && i + 1 < pat.length) { re += pat[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i += 1; } else if (ch === '*') re += '[\\s\\S]*'; else if (ch === '?') re += '[\\s\\S]'; else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, flags);
}

/** COUNTIF-style criterion -> predicate(value). */
export function criterion(crit) {
  if (typeof crit === 'number' || typeof crit === 'boolean') return (v) => (typeof crit === 'boolean' ? v === crit : typeof v === 'number' && v === crit);
  if (crit === null) return (v) => v === null || v === '';
  const s = String(crit);
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(s);
  const op = m[1] || '='; const rest = m[2];
  const n = parseNum(rest);
  const asNum = n !== null ? n : parseDateText(rest);
  const isNumeric = asNum !== null && rest.trim() !== '';
  const rx = !isNumeric ? wildcard(rest) : null;
  return (v) => {
    if (isErr(v)) return rest.toUpperCase() === v.code && op === '=';
    if (isNumeric) {
      if (typeof v !== 'number') { if (op === '<>') return true; return false; }
      switch (op) { case '=': return v === asNum; case '<>': return v !== asNum; case '>': return v > asNum; case '<': return v < asNum; case '>=': return v >= asNum; default: return v <= asNum; }
    }
    if (rest === '' && (op === '=' || op === '<>')) { const empty = v === null || v === ''; return op === '=' ? empty : !empty; }
    if (typeof v === 'boolean' && /^(true|false)$/i.test(rest)) { const b = rest.toLowerCase() === 'true'; return op === '<>' ? v !== b : v === b; }
    if (op === '=' || op === '<>') {
      const t = v === null ? '' : toStr(v);
      const hit = rx ? rx.test(t) : t.toLowerCase() === rest.toLowerCase();
      return op === '=' ? hit : !hit;
    }
    if (typeof v !== 'string') return false;
    const c = cmp(v, rest);
    return op === '>' ? c > 0 : op === '<' ? c < 0 : op === '>=' ? c >= 0 : c <= 0;
  };
}

/** All values of the arguments, flattened (ranges / arrays inside, scalars as they are). */
export function flatValues(ctx, args) {
  const out = [];
  for (const a of args) {
    if (isRng(a)) eachCell(ctx, a, (v) => out.push(v));
    else if (isArr(a)) a.forEach((row) => row.forEach((v) => out.push(v)));
    else out.push(a);
  }
  return out;
}
/** Numbers for SUM / AVERAGE / ...: text, booleans and blanks inside ranges are ignored; typed-in scalars are coerced. */
export function flatNums(ctx, args, { bools = false } = {}) {
  const out = [];
  const add = (v, direct) => {
    if (isErr(v)) throw v;
    if (typeof v === 'number') out.push(v);
    else if (direct) { if (v === null) return; out.push(toNum(v)); } else if (bools && typeof v === 'boolean') out.push(v ? 1 : 0);
  };
  for (const a of args) {
    if (isRng(a)) eachCell(ctx, a, (v) => add(v, false));
    else if (isArr(a)) a.forEach((row) => row.forEach((v) => add(v, false)));
    else add(a, true);
  }
  return out;
}
export const isMulti = (x) => (isRng(x) ? !x.single : isArr(x) && (x.length > 1 || x[0].length > 1));

/** Applies a scalar function element-wise when any argument is an array / multi-cell range. */
export function lift(fn) {
  return (ctx, args) => {
    if (!args.some(isMulti)) return fn(ctx, args.map((a) => (isRng(a) || isArr(a) ? sc(ctx, a) : a)));
    const arrs = args.map((a) => (isMulti(a) ? toArr(ctx, a) : null));
    const R = Math.max(...arrs.map((a) => (a ? a.length : 1))); const C = Math.max(...arrs.map((a) => (a ? a[0].length : 1)));
    const out = [];
    for (let r = 0; r < R; r += 1) {
      const row = [];
      for (let c = 0; c < C; c += 1) {
        try {
          row.push(fn(ctx, args.map((a, i) => { const m = arrs[i]; if (!m) return isRng(a) || isArr(a) ? sc(ctx, a) : a; const v = m[m.length === 1 ? 0 : r]?.[m[0].length === 1 ? 0 : c]; if (v === undefined) throw E.NA; if (isErr(v)) throw v; return v; })));
        } catch (e) { if (e instanceof XlErr) row.push(e); else throw e; }
      }
      out.push(row);
    }
    return out;
  };
}
