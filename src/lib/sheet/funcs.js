import { E, XlErr, isErr } from './formula.js';
import {
  Rng, isRng, isArr, toArr, eachCell, sc, num, str, bool, int, toNum, toStr, toBool, parseNum, parseDateText, cmp, wildcard, criterion,
  flatValues, flatNums, lift, isMulti, clip,
} from './core.js';
import { fmtText, serialToParts, partsToSerial, timeFrac } from './format.js';

export const FUNCS = {};
const def = (names, fn, opt = {}) => { for (const n of names.split(' ')) FUNCS[n] = { fn, ...opt }; };
const lz = (names, fn) => def(names, fn, { lazy: true });
const rnd = (x, d) => { const m = 10 ** d; const v = Math.abs(x) * m; const r = Math.round(v + 1e-9 * Math.max(1, v) * 0 + (v % 1 === 0.5 ? 0 : 0)); return Math.sign(x) * (Math.round(+(v).toPrecision(15)) / m) * (r ? 1 : 1); };
const chk = (x) => { if (!isFinite(x) || Number.isNaN(x)) throw E.NUM; return x; };

/* ---------- math ---------- */
def('SUM', (ctx, a) => flatNums(ctx, a).reduce((s, v) => s + v, 0));
def('PRODUCT', (ctx, a) => flatNums(ctx, a).reduce((s, v) => s * v, 1));
def('AVERAGE', (ctx, a) => { const n = flatNums(ctx, a); if (!n.length) throw E.DIV0; return n.reduce((s, v) => s + v, 0) / n.length; });
def('AVERAGEA', (ctx, a) => { const v = flatValues(ctx, a).filter((x) => x !== null).map((x) => (typeof x === 'number' ? x : typeof x === 'boolean' ? +x : 0)); if (!v.length) throw E.DIV0; return v.reduce((s, x) => s + x, 0) / v.length; });
def('MIN', (ctx, a) => { const n = flatNums(ctx, a); return n.length ? Math.min(...n) : 0; });
def('MAX', (ctx, a) => { const n = flatNums(ctx, a); return n.length ? Math.max(...n) : 0; });
def('COUNT', (ctx, a) => { let k = 0; for (const x of a) { if (isRng(x) || isArr(x)) flatValues(ctx, [x]).forEach((v) => { if (typeof v === 'number') k += 1; }); else if (typeof x === 'number' || (typeof x === 'string' && (parseNum(x) !== null))) k += 1; } return k; });
def('COUNTA', (ctx, a) => flatValues(ctx, a).filter((v) => v !== null && v !== '').length);
def('COUNTBLANK', (ctx, a) => { const g = a[0]; if (!isRng(g)) return 0; let filled = 0; eachCell(ctx, g, (v) => { if (v !== '') filled += 1; }); return g.rows * g.cols - filled; });
def('ABS', lift((c, [x]) => Math.abs(toNum(x))));
def('SIGN', lift((c, [x]) => Math.sign(toNum(x))));
def('SQRT', lift((c, [x]) => { const v = toNum(x); if (v < 0) throw E.NUM; return Math.sqrt(v); }));
def('EXP', lift((c, [x]) => chk(Math.exp(toNum(x)))));
def('LN', lift((c, [x]) => { const v = toNum(x); if (v <= 0) throw E.NUM; return Math.log(v); }));
def('LOG10', lift((c, [x]) => { const v = toNum(x); if (v <= 0) throw E.NUM; return Math.log10(v); }));
def('LOG', lift((c, [x, b]) => { const v = toNum(x); const base = b === undefined || b === null ? 10 : toNum(b); if (v <= 0 || base <= 0 || base === 1) throw E.NUM; return Math.log(v) / Math.log(base); }));
def('POWER', lift((c, [x, y]) => chk(toNum(x) ** toNum(y))));
def('MOD', lift((c, [x, y]) => { const d = toNum(y); if (d === 0) throw E.DIV0; const m = toNum(x) % d; return m !== 0 && (m < 0) !== (d < 0) ? m + d : m; }));
def('QUOTIENT', lift((c, [x, y]) => { const d = toNum(y); if (d === 0) throw E.DIV0; return Math.trunc(toNum(x) / d); }));
def('INT', lift((c, [x]) => Math.floor(toNum(x))));
def('TRUNC', lift((c, [x, d]) => { const m = 10 ** (d === undefined ? 0 : Math.trunc(toNum(d))); return Math.trunc(toNum(x) * m) / m; }));
def('ROUND', lift((c, [x, d]) => rnd(toNum(x), Math.trunc(toNum(d ?? 0)))));
def('ROUNDUP', lift((c, [x, d]) => { const m = 10 ** Math.trunc(toNum(d ?? 0)); const v = toNum(x); return Math.sign(v) * Math.ceil(+(Math.abs(v) * m).toPrecision(15)) / m; }));
def('ROUNDDOWN', lift((c, [x, d]) => { const m = 10 ** Math.trunc(toNum(d ?? 0)); const v = toNum(x); return Math.sign(v) * Math.floor(+(Math.abs(v) * m).toPrecision(15)) / m; }));
def('CEILING', lift((c, [x, s]) => { const k = s === undefined ? 1 : toNum(s); if (k === 0) return 0; return Math.ceil(+(toNum(x) / k).toPrecision(15)) * k; }));
def('FLOOR', lift((c, [x, s]) => { const k = s === undefined ? 1 : toNum(s); if (k === 0) throw E.DIV0; return Math.floor(+(toNum(x) / k).toPrecision(15)) * k; }));
def('MROUND', lift((c, [x, s]) => { const k = toNum(s); if (k === 0) return 0; return Math.round(toNum(x) / k) * k; }));
def('EVEN', lift((c, [x]) => { const v = toNum(x); const r = 2 * Math.ceil(Math.abs(v) / 2); return v < 0 ? -r : r; }));
def('ODD', lift((c, [x]) => { const v = toNum(x); let r = Math.ceil(Math.abs(v)); if (r % 2 === 0) r += 1; return v < 0 ? -r : r; }));
def('PI', () => Math.PI, { max: 0 });
for (const [n, f] of Object.entries({ SIN: Math.sin, COS: Math.cos, TAN: Math.tan, ATAN: Math.atan, SINH: Math.sinh, COSH: Math.cosh, TANH: Math.tanh })) def(n, lift((c, [x]) => chk(f(toNum(x)))));
def('ASIN', lift((c, [x]) => chk(Math.asin(toNum(x))))); def('ACOS', lift((c, [x]) => chk(Math.acos(toNum(x)))));
def('ATAN2', lift((c, [x, y]) => Math.atan2(toNum(y), toNum(x))));
def('DEGREES', lift((c, [x]) => (toNum(x) * 180) / Math.PI)); def('RADIANS', lift((c, [x]) => (toNum(x) * Math.PI) / 180));
def('FACT', lift((c, [x]) => { const n = Math.trunc(toNum(x)); if (n < 0) throw E.NUM; let r = 1; for (let i = 2; i <= n; i += 1) r *= i; return chk(r); }));
def('COMBIN', lift((c, [n, k]) => { const a = Math.trunc(toNum(n)); const b = Math.trunc(toNum(k)); if (b < 0 || a < b) throw E.NUM; let r = 1; for (let i = 1; i <= b; i += 1) r = (r * (a - b + i)) / i; return Math.round(r); }));
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
def('GCD', (ctx, a) => flatNums(ctx, a).map(Math.trunc).reduce(gcd, 0));
def('LCM', (ctx, a) => flatNums(ctx, a).map(Math.trunc).reduce((x, y) => (x && y ? (x / gcd(x, y)) * y : 0), 1));
def('RAND', () => Math.random(), { max: 0 });
def('RANDBETWEEN', (ctx, [a, b]) => { const lo = Math.ceil(num(ctx, a)); const hi = Math.floor(num(ctx, b)); if (lo > hi) throw E.NUM; return lo + Math.floor(Math.random() * (hi - lo + 1)); });
def('SUMSQ', (ctx, a) => flatNums(ctx, a).reduce((s, v) => s + v * v, 0));
def('SUMPRODUCT', (ctx, a) => {
  const arrs = a.map((x) => toArr(ctx, x)); const R = arrs[0].length; const C = arrs[0][0].length;
  if (arrs.some((m) => m.length !== R || m[0].length !== C)) throw E.VALUE;
  let s = 0; for (let i = 0; i < R; i += 1) for (let j = 0; j < C; j += 1) { let p = 1; for (const m of arrs) { const v = m[i][j]; if (isErr(v)) throw v; p *= typeof v === 'number' ? v : 0; } s += p; }
  return s;
});
def('SUBTOTAL', (ctx, [fn, ...rest]) => { const k = int(ctx, fn) % 100; const m = { 1: 'AVERAGE', 2: 'COUNT', 3: 'COUNTA', 4: 'MAX', 5: 'MIN', 6: 'PRODUCT', 9: 'SUM', 7: 'STDEV', 8: 'STDEVP', 10: 'VAR', 11: 'VARP' }[k]; if (!m) throw E.VALUE; return FUNCS[m].fn(ctx, rest); });

/* ---------- conditional aggregates ---------- */
function condMask(ctx, pairs) {
  const first = pairs[0][0]; if (!isRng(first)) throw E.VALUE;
  const g = clip(first); const R = g.rows; const C = g.cols; const mask = new Uint8Array(R * C).fill(1);
  for (const [rg, cr] of pairs) {
    if (!isRng(rg)) throw E.VALUE; const h = clip(new Rng(rg.sheet, rg.r1, rg.c1, rg.r1 + R - 1, rg.c1 + C - 1)); const p = criterion(isRng(cr) || isArr(cr) ? sc(ctx, cr) : cr);
    for (let i = 0; i < R; i += 1) for (let j = 0; j < C; j += 1) if (mask[i * C + j] && !p(ctx.wb.getValue(rg.sheet, rg.r1 + i, rg.c1 + j))) mask[i * C + j] = 0;
    void h;
  }
  return { mask, R, C };
}
const sumRangeVals = (ctx, rg, { mask, R, C }) => { const out = []; for (let i = 0; i < R; i += 1) for (let j = 0; j < C; j += 1) if (mask[i * C + j]) { const v = ctx.wb.getValue(rg.sheet, rg.r1 + i, rg.c1 + j); if (isErr(v)) throw v; if (typeof v === 'number') out.push(v); } return out; };
def('COUNTIF', (ctx, [r, c]) => { const m = condMask(ctx, [[r, c]]); return m.mask.reduce((s, x) => s + x, 0); });
def('COUNTIFS', (ctx, a) => { const p = []; for (let i = 0; i < a.length; i += 2) p.push([a[i], a[i + 1]]); return condMask(ctx, p).mask.reduce((s, x) => s + x, 0); });
def('SUMIF', (ctx, [r, c, s]) => { const m = condMask(ctx, [[r, c]]); return sumRangeVals(ctx, s || r, m).reduce((x, y) => x + y, 0); });
def('SUMIFS', (ctx, [s, ...a]) => { const p = []; for (let i = 0; i < a.length; i += 2) p.push([a[i], a[i + 1]]); return sumRangeVals(ctx, s, condMask(ctx, p)).reduce((x, y) => x + y, 0); });
def('AVERAGEIF', (ctx, [r, c, s]) => { const v = sumRangeVals(ctx, s || r, condMask(ctx, [[r, c]])); if (!v.length) throw E.DIV0; return v.reduce((x, y) => x + y, 0) / v.length; });
def('AVERAGEIFS', (ctx, [s, ...a]) => { const p = []; for (let i = 0; i < a.length; i += 2) p.push([a[i], a[i + 1]]); const v = sumRangeVals(ctx, s, condMask(ctx, p)); if (!v.length) throw E.DIV0; return v.reduce((x, y) => x + y, 0) / v.length; });
def('MAXIFS', (ctx, [s, ...a]) => { const p = []; for (let i = 0; i < a.length; i += 2) p.push([a[i], a[i + 1]]); const v = sumRangeVals(ctx, s, condMask(ctx, p)); return v.length ? Math.max(...v) : 0; });
def('MINIFS', (ctx, [s, ...a]) => { const p = []; for (let i = 0; i < a.length; i += 2) p.push([a[i], a[i + 1]]); const v = sumRangeVals(ctx, s, condMask(ctx, p)); return v.length ? Math.min(...v) : 0; });

/* ---------- statistics ---------- */
const sorted = (ctx, a) => flatNums(ctx, a).sort((x, y) => x - y);
def('MEDIAN', (ctx, a) => { const n = sorted(ctx, a); if (!n.length) throw E.NUM; const m = n.length >> 1; return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2; });
def('MODE', (ctx, a) => { const n = flatNums(ctx, a); const cnt = new Map(); let best = null; let bc = 1; for (const v of n) { const k = (cnt.get(v) || 0) + 1; cnt.set(v, k); if (k > bc) { bc = k; best = v; } } if (best === null) throw E.NA; return best; });
const varOf = (n, sample) => { if (n.length < (sample ? 2 : 1)) throw E.DIV0; const m = n.reduce((s, v) => s + v, 0) / n.length; return n.reduce((s, v) => s + (v - m) ** 2, 0) / (n.length - (sample ? 1 : 0)); };
def('VAR VAR.S', (ctx, a) => varOf(flatNums(ctx, a), true)); def('VARP VAR.P', (ctx, a) => varOf(flatNums(ctx, a), false));
def('STDEV STDEV.S', (ctx, a) => Math.sqrt(varOf(flatNums(ctx, a), true))); def('STDEVP STDEV.P', (ctx, a) => Math.sqrt(varOf(flatNums(ctx, a), false)));
def('LARGE', (ctx, [r, k]) => { const n = sorted(ctx, [r]); const i = int(ctx, k); if (i < 1 || i > n.length) throw E.NUM; return n[n.length - i]; });
def('SMALL', (ctx, [r, k]) => { const n = sorted(ctx, [r]); const i = int(ctx, k); if (i < 1 || i > n.length) throw E.NUM; return n[i - 1]; });
def('RANK RANK.EQ', (ctx, [x, r, o]) => { const v = num(ctx, x); const n = flatNums(ctx, [r]); if (!n.includes(v)) throw E.NA; const asc = o !== undefined && o !== null && toNum(sc(ctx, o)) !== 0; return 1 + n.filter((y) => (asc ? y < v : y > v)).length; });
def('PERCENTILE PERCENTILE.INC', (ctx, [r, k]) => { const n = sorted(ctx, [r]); const p = num(ctx, k); if (p < 0 || p > 1 || !n.length) throw E.NUM; const pos = p * (n.length - 1); const lo = Math.floor(pos); return n[lo] + (n[Math.min(lo + 1, n.length - 1)] - n[lo]) * (pos - lo); });
def('QUARTILE QUARTILE.INC', (ctx, [r, q]) => FUNCS.PERCENTILE.fn(ctx, [r, int(ctx, q) / 4]));
const pairs = (ctx, a, b) => { const x = toArr(ctx, a).flat(); const y = toArr(ctx, b).flat(); if (x.length !== y.length) throw E.NA; const px = []; const py = []; x.forEach((v, i) => { if (typeof v === 'number' && typeof y[i] === 'number') { px.push(v); py.push(y[i]); } }); return [px, py]; };
const cov = (x, y) => { const mx = x.reduce((s, v) => s + v, 0) / x.length; const my = y.reduce((s, v) => s + v, 0) / y.length; return x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0); };
def('CORREL PEARSON', (ctx, [a, b]) => { const [x, y] = pairs(ctx, a, b); const d = Math.sqrt(cov(x, x) * cov(y, y)); if (!d) throw E.DIV0; return cov(x, y) / d; });
def('SLOPE', (ctx, [a, b]) => { const [y, x] = pairs(ctx, a, b); const d = cov(x, x); if (!d) throw E.DIV0; return cov(x, y) / d; });
def('INTERCEPT', (ctx, [a, b]) => { const [y, x] = pairs(ctx, a, b); const d = cov(x, x); if (!d) throw E.DIV0; const s = cov(x, y) / d; return y.reduce((p, v) => p + v, 0) / y.length - s * (x.reduce((p, v) => p + v, 0) / x.length); });
def('FORECAST FORECAST.LINEAR', (ctx, [xv, a, b]) => { const [y, x] = pairs(ctx, a, b); const s = cov(x, y) / cov(x, x); const my = y.reduce((p, v) => p + v, 0) / y.length; const mx = x.reduce((p, v) => p + v, 0) / x.length; return my + s * (num(ctx, xv) - mx); });

/* ---------- logic ---------- */
const truthy = (ctx, a) => { const out = []; for (const x of a) { if (isRng(x) || isArr(x)) flatValues(ctx, [x]).forEach((v) => { if (isErr(v)) throw v; if (typeof v === 'boolean') out.push(v); else if (typeof v === 'number') out.push(v !== 0); }); else out.push(toBool(x)); } if (!out.length) throw E.VALUE; return out; };
def('AND', (ctx, a) => truthy(ctx, a).every(Boolean)); def('OR', (ctx, a) => truthy(ctx, a).some(Boolean)); def('XOR', (ctx, a) => truthy(ctx, a).filter(Boolean).length % 2 === 1);
def('NOT', lift((c, [x]) => !toBool(x)));
def('TRUE', () => true, { max: 0 }); def('FALSE', () => false, { max: 0 });
lz('IF', (ctx, a, ev) => {
  if (a.length < 2 || a.length > 3) throw E.VALUE;
  const c = ev(a[0]);
  if (isMulti(c)) { const m = toArr(ctx, c); return m.map((row) => row.map((v) => { try { if (isErr(v)) return v; const pick = toBool(v) ? a[1] : a[2]; if (!pick) return toBool(v); const r = ev(pick); return isRng(r) || isArr(r) ? sc(ctx, r) : r; } catch (e) { if (e instanceof XlErr) return e; throw e; } })); }
  if (toBool(sc(ctx, c))) return ev(a[1]);
  return a[2] ? ev(a[2]) : false;
});
lz('IFS', (ctx, a, ev) => { for (let i = 0; i + 1 < a.length; i += 2) if (toBool(sc(ctx, ev(a[i])))) return ev(a[i + 1]); throw E.NA; });
lz('IFERROR', (ctx, a, ev) => { try { const v = ev(a[0]); const s = isRng(v) && v.single ? sc(ctx, v) : v; return s; } catch (e) { if (e instanceof XlErr) return ev(a[1]); throw e; } });
lz('IFNA', (ctx, a, ev) => { try { return ev(a[0]); } catch (e) { if (e === E.NA) return ev(a[1]); throw e; } });
lz('SWITCH', (ctx, a, ev) => { const v = sc(ctx, ev(a[0])); let i = 1; for (; i + 1 < a.length; i += 2) if (cmp(v, sc(ctx, ev(a[i]))) === 0) return ev(a[i + 1]); if (i < a.length) return ev(a[i]); throw E.NA; });
lz('CHOOSE', (ctx, a, ev) => { const i = Math.trunc(toNum(sc(ctx, ev(a[0])))); if (i < 1 || i >= a.length) throw E.VALUE; return ev(a[i]); });
const probe = (fn) => (ctx, a, ev) => { try { const v = ev(a[0]); return fn(isRng(v) && v.single ? ctx.wb.getValue(v.sheet, v.r1, v.c1) : isRng(v) || isArr(v) ? sc(ctx, v) : v); } catch (e) { if (e instanceof XlErr) return fn(e); throw e; } };
lz('ISERROR', probe((v) => isErr(v))); lz('ISERR', probe((v) => isErr(v) && v !== E.NA)); lz('ISNA', probe((v) => v === E.NA));
lz('ISBLANK', probe((v) => v === null)); lz('ISNUMBER', probe((v) => typeof v === 'number')); lz('ISTEXT', probe((v) => typeof v === 'string'));
lz('ISNONTEXT', probe((v) => typeof v !== 'string')); lz('ISLOGICAL', probe((v) => typeof v === 'boolean'));
lz('ISEVEN', probe((v) => toNum(v) % 2 === 0)); lz('ISODD', probe((v) => Math.abs(toNum(v) % 2) === 1));
def('ISREF', (ctx, [x]) => isRng(x));
def('NA', () => { throw E.NA; }, { max: 0 });
def('N', (ctx, [x]) => { const v = sc(ctx, x); return typeof v === 'number' ? v : typeof v === 'boolean' ? +v : 0; });
def('T', (ctx, [x]) => { const v = sc(ctx, x); return typeof v === 'string' ? v : ''; });
def('TYPE', (ctx, [x]) => { if (isArr(x) || (isRng(x) && !x.single)) return 64; const v = isRng(x) ? ctx.wb.getValue(x.sheet, x.r1, x.c1) : x; return isErr(v) ? 16 : typeof v === 'string' ? 2 : typeof v === 'boolean' ? 4 : 1; });
def('ERROR.TYPE', (ctx, [x]) => { const v = sc(ctx, x); const i = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A'].indexOf(isErr(v) ? v.code : ''); if (i < 0) throw E.NA; return i + 1; }, { lazy: false });

/* ---------- text ---------- */
def('LEN', lift((c, [x]) => toStr(x).length));
def('LEFT', lift((c, [s, n]) => { const k = n === undefined ? 1 : Math.trunc(toNum(n)); if (k < 0) throw E.VALUE; return toStr(s).slice(0, k); }));
def('RIGHT', lift((c, [s, n]) => { const k = n === undefined ? 1 : Math.trunc(toNum(n)); if (k < 0) throw E.VALUE; const t = toStr(s); return k ? t.slice(-k) : ''; }));
def('MID', lift((c, [s, st, n]) => { const a = Math.trunc(toNum(st)); const k = Math.trunc(toNum(n)); if (a < 1 || k < 0) throw E.VALUE; return toStr(s).substr(a - 1, k); }));
def('UPPER', lift((c, [x]) => toStr(x).toUpperCase())); def('LOWER', lift((c, [x]) => toStr(x).toLowerCase()));
def('PROPER', lift((c, [x]) => toStr(x).toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())));
def('TRIM', lift((c, [x]) => toStr(x).trim().replace(/ +/g, ' ')));
def('CLEAN', lift((c, [x]) => toStr(x).replace(/[\x00-\x1f]/g, '')));
def('CONCAT', (ctx, a) => flatValues(ctx, a).map((v) => { if (isErr(v)) throw v; return toStr(v); }).join(''));
def('CONCATENATE', (ctx, a) => a.map((x) => str(ctx, x)).join(''));
def('TEXTJOIN', (ctx, [d, ig, ...r]) => { const sep = str(ctx, d); const skip = bool(ctx, ig); return flatValues(ctx, r).filter((v) => !(skip && (v === null || v === ''))).map((v) => { if (isErr(v)) throw v; return toStr(v); }).join(sep); });
const findIn = (ctx, [f, w, s], ci, wild) => {
  const needle = str(ctx, f); const hay = str(ctx, w); const st = s === undefined ? 0 : Math.trunc(num(ctx, s)) - 1; if (st < 0 || st > hay.length) throw E.VALUE;
  let i;
  if (wild) { const re = wildcard(needle, 'i'); if (re) { const rx = new RegExp(re.source.slice(1, -1), 'i'); const m = rx.exec(hay.slice(st)); i = m ? m.index + st : -1; } else i = hay.toLowerCase().indexOf(needle.toLowerCase(), st); } else i = ci ? hay.toLowerCase().indexOf(needle.toLowerCase(), st) : hay.indexOf(needle, st);
  if (i < 0) throw E.VALUE; return i + 1;
};
def('FIND', (ctx, a) => findIn(ctx, a, false, false)); def('SEARCH', (ctx, a) => findIn(ctx, a, true, true));
def('SUBSTITUTE', lift((c, [t, o, n, k]) => { const s = toStr(t); const old = toStr(o); const nw = toStr(n); if (!old) return s; if (k === undefined) return s.split(old).join(nw); let i = -1; let cnt = 0; const w = Math.trunc(toNum(k)); for (;;) { i = s.indexOf(old, i + 1); if (i < 0) return s; cnt += 1; if (cnt === w) return s.slice(0, i) + nw + s.slice(i + old.length); } }));
def('REPLACE', lift((c, [t, st, n, nw]) => { const s = toStr(t); const a = Math.trunc(toNum(st)) - 1; if (a < 0) throw E.VALUE; return s.slice(0, a) + toStr(nw) + s.slice(a + Math.trunc(toNum(n))); }));
def('REPT', lift((c, [t, n]) => { const k = Math.trunc(toNum(n)); if (k < 0) throw E.VALUE; return toStr(t).repeat(k); }));
def('EXACT', lift((c, [a, b]) => toStr(a) === toStr(b)));
def('CHAR', lift((c, [x]) => { const k = Math.trunc(toNum(x)); if (k < 1 || k > 255) throw E.VALUE; return String.fromCharCode(k); }));
def('CODE', lift((c, [x]) => { const s = toStr(x); if (!s) throw E.VALUE; return s.charCodeAt(0); }));
def('UNICHAR', lift((c, [x]) => String.fromCodePoint(Math.trunc(toNum(x))))); def('UNICODE', lift((c, [x]) => { const s = toStr(x); if (!s) throw E.VALUE; return s.codePointAt(0); }));
def('TEXT', lift((c, [v, f]) => { if (typeof v === 'string' && parseNum(v) !== null) return fmtText(parseNum(v), toStr(f)); return fmtText(v, toStr(f)); }));
def('VALUE', lift((c, [x]) => { if (typeof x === 'number') return x; return toNum(x); }));
def('NUMBERVALUE', lift((c, [x]) => { const n = parseNum(toStr(x).replace(/\s/g, '')); if (n === null) throw E.VALUE; return n; }));
def('FIXED', lift((c, [x, d, nc]) => fmtText(toNum(x), `${nc && toBool(nc) ? '' : '#,'}##0${(d === undefined ? 2 : Math.trunc(toNum(d))) > 0 ? `.${'0'.repeat(d === undefined ? 2 : Math.trunc(toNum(d)))}` : ''}`)));
def('TEXTBEFORE', (ctx, [t, d, n]) => { const s = str(ctx, t); const k = n === undefined ? 1 : int(ctx, n); const p = s.split(str(ctx, d)); if (p.length <= k) throw E.NA; return p.slice(0, k).join(str(ctx, d)); });
def('TEXTAFTER', (ctx, [t, d, n]) => { const s = str(ctx, t); const k = n === undefined ? 1 : int(ctx, n); const p = s.split(str(ctx, d)); if (p.length <= k) throw E.NA; return p.slice(k).join(str(ctx, d)); });
def('TEXTSPLIT', (ctx, [t, cd, rd]) => { const s = str(ctx, t); const rows = rd ? s.split(str(ctx, rd)) : [s]; const out = rows.map((r) => r.split(str(ctx, cd))); const w = Math.max(...out.map((r) => r.length)); return out.map((r) => Array.from({ length: w }, (_, i) => r[i] ?? E.NA)); });

/* ---------- lookup / reference ---------- */
const needRng = (x) => { if (!isRng(x) && !isArr(x)) throw E.VALUE; return x; };
function matchPos(ctx, v, vec, mode) {
  // vec: flat array. mode 0 exact (wildcards), 1 largest <=, -1 smallest >=
  if (mode === 0) { const p = typeof v === 'string' ? criterion(`=${v}`) : (x) => (typeof x === typeof v && cmp(x, v) === 0); for (let i = 0; i < vec.length; i += 1) if (p(vec[i]) && (typeof v !== 'string' || typeof vec[i] === 'string' || typeof vec[i] === 'number')) { if (typeof v === 'string' && typeof vec[i] !== 'string') continue; return i; } return -1; }
  let lo = 0; let hi = vec.length - 1; let best = -1;
  if (mode === 1) { while (lo <= hi) { const m = (lo + hi) >> 1; const x = vec[m]; if (x === null || (typeof x !== typeof v)) { let k = m - 1; while (k >= lo && (vec[k] === null || typeof vec[k] !== typeof v)) k -= 1; if (k < lo) { lo = m + 1; continue; } if (cmp(vec[k], v) <= 0) { best = k; lo = m + 1; } else hi = k - 1; continue; } if (cmp(x, v) <= 0) { best = m; lo = m + 1; } else hi = m - 1; } return best; }
  for (let i = 0; i < vec.length; i += 1) if (typeof vec[i] === typeof v && cmp(vec[i], v) >= 0 && (best < 0 || cmp(vec[i], vec[best]) < 0)) best = i;
  return best;
}
def('MATCH', (ctx, [v, r, t]) => { const x = sc(ctx, v); const m = toArr(ctx, needRng(r)); const vec = m.length === 1 ? m[0] : m.map((row) => row[0]); if (m.length > 1 && m[0].length > 1) throw E.NA; const i = matchPos(ctx, x, vec, t === undefined || t === null ? 1 : Math.sign(num(ctx, t))); if (i < 0) throw E.NA; return i + 1; });
def('VLOOKUP', (ctx, [v, t, ci, ap]) => {
  const x = sc(ctx, v); const m = toArr(ctx, needRng(t)); const col = int(ctx, ci); if (col < 1 || col > m[0].length) throw E.REF;
  const exact = ap !== undefined && ap !== null && !toBool(sc(ctx, ap)); const i = matchPos(ctx, x, m.map((row) => row[0]), exact ? 0 : 1); if (i < 0) throw E.NA;
  const out = m[i][col - 1]; if (isErr(out)) throw out; return out;
});
def('HLOOKUP', (ctx, [v, t, ri, ap]) => {
  const x = sc(ctx, v); const m = toArr(ctx, needRng(t)); const row = int(ctx, ri); if (row < 1 || row > m.length) throw E.REF;
  const exact = ap !== undefined && ap !== null && !toBool(sc(ctx, ap)); const i = matchPos(ctx, x, m[0], exact ? 0 : 1); if (i < 0) throw E.NA;
  const out = m[row - 1][i]; if (isErr(out)) throw out; return out;
});
def('LOOKUP', (ctx, [v, lv, rv]) => { const x = sc(ctx, v); const a = toArr(ctx, lv).flat(); const i = matchPos(ctx, x, a, 1); if (i < 0) throw E.NA; const res = rv ? toArr(ctx, rv).flat() : a; return res[i] ?? E.NA; });
def('XMATCH', (ctx, [v, r, mm]) => { const x = sc(ctx, v); const m = toArr(ctx, needRng(r)).flat(); const mode = mm === undefined ? 0 : int(ctx, mm); const i = matchPos(ctx, x, m, mode === 0 ? 0 : mode > 0 ? -1 : 1); if (i < 0) throw E.NA; return i + 1; });
def('XLOOKUP', (ctx, [v, lr, rr, nf, mm]) => {
  const x = sc(ctx, v); const L = toArr(ctx, needRng(lr)); const vec = L.length === 1 ? L[0] : L.map((row) => row[0]); const mode = mm === undefined || mm === null ? 0 : int(ctx, mm);
  const i = matchPos(ctx, x, vec, mode === 0 ? 0 : mode > 0 ? -1 : 1);
  if (i < 0) { if (nf !== undefined && nf !== null) return nf; throw E.NA; }
  const R = toArr(ctx, rr); if (L.length === 1) return R.map((row) => [row[i]]).length === 1 ? R[0][i] : R.map((row) => [row[i]]); return [R[i]].length === 1 && R[i].length === 1 ? R[i][0] : [R[i]];
});
def('INDEX', (ctx, [r, ri, ci]) => {
  const rows = ri === undefined || ri === null ? 0 : int(ctx, ri); let cols = ci === undefined || ci === null ? 0 : int(ctx, ci);
  if (isRng(r)) {
    let rr = rows; if (r.rows === 1 && ci === undefined && rows) { cols = rows; rr = 0; }
    if (rr < 0 || cols < 0 || rr > r.rows || cols > r.cols) throw E.REF;
    if (rr && cols) return new Rng(r.sheet, r.r1 + rr - 1, r.c1 + cols - 1, r.r1 + rr - 1, r.c1 + cols - 1);
    if (rr) return new Rng(r.sheet, r.r1 + rr - 1, r.c1, r.r1 + rr - 1, r.c2);
    if (cols) return new Rng(r.sheet, r.r1, r.c1 + cols - 1, r.r2, r.c1 + cols - 1);
    return r;
  }
  const m = toArr(ctx, r); let rr = rows; if (m.length === 1 && ci === undefined && rows) { cols = rows; rr = 0; }
  if (rr > m.length || cols > m[0].length || rr < 0 || cols < 0) throw E.REF;
  if (rr && cols) return m[rr - 1][cols - 1]; if (rr) return [m[rr - 1]]; if (cols) return m.map((row) => [row[cols - 1]]); return m;
});
def('OFFSET', (ctx, [r, dr, dc, h, w]) => { if (!isRng(r)) throw E.VALUE; const R = r.r1 + int(ctx, dr); const C = r.c1 + int(ctx, dc); const H = h === undefined || h === null ? r.rows : int(ctx, h); const W = w === undefined || w === null ? r.cols : int(ctx, w); if (R < 0 || C < 0 || H < 1 || W < 1) throw E.REF; return new Rng(r.sheet, R, C, R + H - 1, C + W - 1); });
def('ROW', (ctx, [r]) => { if (r === undefined) return ctx.r + 1; if (!isRng(r)) throw E.VALUE; if (r.rows === 1) return r.r1 + 1; return Array.from({ length: r.rows }, (_, i) => [r.r1 + i + 1]); });
def('COLUMN', (ctx, [r]) => { if (r === undefined) return ctx.c + 1; if (!isRng(r)) throw E.VALUE; if (r.cols === 1) return r.c1 + 1; return [Array.from({ length: r.cols }, (_, i) => r.c1 + i + 1)]; });
def('ROWS', (ctx, [r]) => (isRng(r) ? clipDim(r).rows : isArr(r) ? r.length : 1)); def('COLUMNS', (ctx, [r]) => (isRng(r) ? clipDim(r).cols : isArr(r) ? r[0].length : 1));
const clipDim = (r) => ({ rows: r.rows, cols: r.cols });
def('ADDRESS', (ctx, [r, c, abs]) => { const a = abs === undefined ? 1 : int(ctx, abs); let n = int(ctx, c); let col = ''; while (n > 0) { const m = (n - 1) % 26; col = String.fromCharCode(65 + m) + col; n = Math.floor((n - 1) / 26); } return `${a === 1 || a === 3 ? '$' : ''}${col}${a === 1 || a === 2 ? '$' : ''}${int(ctx, r)}`; });
def('TRANSPOSE', (ctx, [x]) => { const m = toArr(ctx, x); return m[0].map((_, j) => m.map((row) => row[j])); });
def('SEQUENCE', (ctx, [r, c, s, st]) => { const R = int(ctx, r); const C = c === undefined || c === null ? 1 : int(ctx, c); const a = s === undefined || s === null ? 1 : num(ctx, s); const d = st === undefined || st === null ? 1 : num(ctx, st); if (R < 1 || C < 1 || R * C > 1e6) throw E.CALC; return Array.from({ length: R }, (_, i) => Array.from({ length: C }, (_, j) => a + (i * C + j) * d)); });
def('UNIQUE', (ctx, [x, byCol, once]) => { const m = toArr(ctx, x); const rows = byCol && bool(ctx, byCol) ? m[0].map((_, j) => m.map((r) => r[j])) : m; const cnt = new Map(); const order = []; rows.forEach((r) => { const k = JSON.stringify(r.map((v) => (typeof v === 'string' ? v.toLowerCase() : v))); if (!cnt.has(k)) { cnt.set(k, 0); order.push([k, r]); } cnt.set(k, cnt.get(k) + 1); }); let out = order.filter(([k]) => !(once && bool(ctx, once)) || cnt.get(k) === 1).map(([, r]) => r); if (!out.length) throw E.CALC; if (byCol && bool(ctx, byCol)) out = out[0].map((_, j) => out.map((r) => r[j])); return out; });
def('SORT', (ctx, [x, idx, ord, byCol]) => { const m = toArr(ctx, x).map((r) => r.slice()); const i = idx === undefined || idx === null ? 0 : int(ctx, idx) - 1; const d = ord !== undefined && ord !== null && num(ctx, ord) === -1 ? -1 : 1; if (byCol && bool(ctx, byCol)) { const t = m[0].map((_, j) => m.map((r) => r[j])); t.sort((a, b) => d * cmp(a[i], b[i])); return t[0].map((_, j) => t.map((r) => r[j])); } if (i < 0 || i >= m[0].length) throw E.VALUE; return m.sort((a, b) => d * cmp(a[i], b[i])); });
def('SORTBY', (ctx, [x, by, ord]) => { const m = toArr(ctx, x); const k = toArr(ctx, by).flat(); if (k.length !== m.length) throw E.VALUE; const d = ord !== undefined && ord !== null && num(ctx, ord) === -1 ? -1 : 1; return m.map((r, i) => [r, k[i]]).sort((a, b) => d * cmp(a[1], b[1])).map(([r]) => r); });
def('FILTER', (ctx, [x, inc, ifE]) => { const m = toArr(ctx, x); const f = toArr(ctx, inc); let out; if (f[0].length === 1 && f.length === m.length) out = m.filter((_, i) => { const v = f[i][0]; if (isErr(v)) throw v; return typeof v === 'number' ? v !== 0 : v === true; }); else if (f.length === 1 && f[0].length === m[0].length) { const keep = f[0].map((v) => (typeof v === 'number' ? v !== 0 : v === true)); out = m.map((r) => r.filter((_, j) => keep[j])); if (!out[0].length) out = []; } else throw E.VALUE; if (!out.length) { if (ifE !== undefined) return ifE; throw E.CALC; } return out; });
def('TAKE', (ctx, [x, r, c]) => { let m = toArr(ctx, x); const R = int(ctx, r); m = R >= 0 ? m.slice(0, R) : m.slice(R); if (c !== undefined && c !== null) { const C = int(ctx, c); m = m.map((row) => (C >= 0 ? row.slice(0, C) : row.slice(C))); } return m; });
def('DROP', (ctx, [x, r, c]) => { let m = toArr(ctx, x); const R = int(ctx, r); m = R >= 0 ? m.slice(R) : m.slice(0, R); if (c !== undefined && c !== null) { const C = int(ctx, c); m = m.map((row) => (C >= 0 ? row.slice(C) : row.slice(0, C))); } if (!m.length || !m[0].length) throw E.CALC; return m; });
def('HSTACK', (ctx, a) => { const ms = a.map((x) => toArr(ctx, x)); const R = Math.max(...ms.map((m) => m.length)); return Array.from({ length: R }, (_, i) => ms.flatMap((m) => (m[i] ? m[i] : Array(m[0].length).fill(E.NA)))); });
def('VSTACK', (ctx, a) => { const ms = a.map((x) => toArr(ctx, x)); const W = Math.max(...ms.map((m) => m[0].length)); return ms.flatMap((m) => m.map((r) => Array.from({ length: W }, (_, j) => (j < r.length ? r[j] : E.NA)))); });
def('TOCOL', (ctx, [x]) => toArr(ctx, x).flat().map((v) => [v])); def('TOROW', (ctx, [x]) => [toArr(ctx, x).flat()]);
def('CHOOSECOLS', (ctx, [x, ...ix]) => { const m = toArr(ctx, x); const ids = flatNums(ctx, ix).map((i) => (i < 0 ? m[0].length + i : i - 1)); if (ids.some((i) => i < 0 || i >= m[0].length)) throw E.VALUE; return m.map((r) => ids.map((i) => r[i])); });
def('CHOOSEROWS', (ctx, [x, ...ix]) => { const m = toArr(ctx, x); const ids = flatNums(ctx, ix).map((i) => (i < 0 ? m.length + i : i - 1)); if (ids.some((i) => i < 0 || i >= m.length)) throw E.VALUE; return ids.map((i) => m[i]); });
def('FORMULATEXT', (ctx, [r]) => { if (!isRng(r)) throw E.NA; const cell = r.sheet.cell(r.r1, r.c1); if (!cell || !cell.f) throw E.NA; return `=${cell.f}`; });

/* ---------- date & time ---------- */
const today = () => { const d = new Date(); return partsToSerial(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
def('TODAY', () => today(), { max: 0 }); def('NOW', () => { const d = new Date(); return today() + timeFrac(d.getHours(), d.getMinutes(), d.getSeconds()); }, { max: 0 });
const dnum = (ctx, x) => { const v = sc(ctx, x); if (typeof v === 'string') { const d = parseDateText(v); if (d === null) throw E.VALUE; return d; } return toNum(v); };
def('DATE', lift((c, [y, m, d]) => { let Y = Math.trunc(toNum(y)); if (Y >= 0 && Y < 1900) Y += 1900; const s = partsToSerial(Y, Math.trunc(toNum(m)), Math.trunc(toNum(d))); if (s < 0) throw E.NUM; return s; }));
def('TIME', lift((c, [h, m, s]) => timeFrac(Math.trunc(toNum(h)), Math.trunc(toNum(m)), Math.trunc(toNum(s))) % 1));
def('YEAR', lift((c, [x]) => serialToParts(toNum(typeof x === 'string' ? parseDateText(x) ?? x : x)).y));
def('MONTH', lift((c, [x]) => serialToParts(toNum(typeof x === 'string' ? parseDateText(x) ?? x : x)).m));
def('DAY', lift((c, [x]) => serialToParts(toNum(typeof x === 'string' ? parseDateText(x) ?? x : x)).d));
def('HOUR', lift((c, [x]) => serialToParts(toNum(x)).H)); def('MINUTE', lift((c, [x]) => serialToParts(toNum(x)).M)); def('SECOND', lift((c, [x]) => serialToParts(toNum(x)).S));
def('WEEKDAY', (ctx, [x, t]) => { const dow = serialToParts(dnum(ctx, x)).dow; const k = t === undefined ? 1 : int(ctx, t); return k === 2 ? ((dow + 6) % 7) + 1 : k === 3 ? (dow + 6) % 7 : dow + 1; });
def('WEEKNUM', (ctx, [x]) => { const p = serialToParts(dnum(ctx, x)); const jan1 = partsToSerial(p.y, 1, 1); const off = serialToParts(jan1).dow; return Math.floor((dnum(ctx, x) - jan1 + off) / 7) + 1; });
def('DAYS', (ctx, [a, b]) => Math.trunc(dnum(ctx, a)) - Math.trunc(dnum(ctx, b)));
def('EDATE', (ctx, [s, m]) => { const p = serialToParts(dnum(ctx, s)); const t = p.m - 1 + int(ctx, m); const y = p.y + Math.floor(t / 12); const mo = ((t % 12) + 12) % 12 + 1; const last = partsToSerial(y, mo + 1, 0); return Math.min(partsToSerial(y, mo, p.d), last); });
def('EOMONTH', (ctx, [s, m]) => { const p = serialToParts(dnum(ctx, s)); return partsToSerial(p.y, p.m + int(ctx, m) + 1, 0); });
def('DATEDIF', (ctx, [a, b, u]) => {
  const s = serialToParts(dnum(ctx, a)); const e = serialToParts(dnum(ctx, b)); if (dnum(ctx, a) > dnum(ctx, b)) throw E.NUM; const unit = str(ctx, u).toUpperCase();
  let months = (e.y - s.y) * 12 + (e.m - s.m); if (e.d < s.d) months -= 1;
  if (unit === 'D') return Math.trunc(dnum(ctx, b)) - Math.trunc(dnum(ctx, a)); if (unit === 'M') return months; if (unit === 'Y') return Math.floor(months / 12); if (unit === 'YM') return months % 12;
  if (unit === 'MD') return e.d >= s.d ? e.d - s.d : partsToSerial(e.y, e.m, 0) - partsToSerial(e.y, e.m - 1, 0) - s.d + e.d; throw E.NUM;
});
def('NETWORKDAYS', (ctx, [a, b, h]) => { let x = Math.trunc(dnum(ctx, a)); const y = Math.trunc(dnum(ctx, b)); const hol = new Set(h ? flatNums(ctx, [h]).map(Math.trunc) : []); const dir = x <= y ? 1 : -1; let n = 0; for (; dir > 0 ? x <= y : x >= y; x += dir) { const w = serialToParts(x).dow; if (w !== 0 && w !== 6 && !hol.has(x)) n += dir; } return n; });
def('WORKDAY', (ctx, [a, d, h]) => { let x = Math.trunc(dnum(ctx, a)); let k = int(ctx, d); const hol = new Set(h ? flatNums(ctx, [h]).map(Math.trunc) : []); const dir = k >= 0 ? 1 : -1; while (k !== 0) { x += dir; const w = serialToParts(x).dow; if (w !== 0 && w !== 6 && !hol.has(x)) k -= dir; } return x; });
def('DATEVALUE', lift((c, [x]) => { const d = parseDateText(toStr(x)); if (d === null) throw E.VALUE; return Math.floor(d); })); def('TIMEVALUE', lift((c, [x]) => { const d = parseDateText(toStr(x)); if (d === null) throw E.VALUE; return d % 1; }));

/* ---------- financial ---------- */
const pv0 = (r, n, p, f, t) => (r === 0 ? -(f + p * n) : -(f + p * (1 + r * t) * ((1 - (1 + r) ** -n) / r * (1 + r) ** n) / (1 + r) ** n * 0) );
void pv0;
def('PMT', (ctx, [r, n, pv, fv, t]) => { const R = num(ctx, r); const N = num(ctx, n); const P = num(ctx, pv); const F = fv ? num(ctx, fv) : 0; const T = t ? num(ctx, t) : 0; if (R === 0) return -(P + F) / N; return (-(P * (1 + R) ** N + F) * R) / ((1 + R * T) * ((1 + R) ** N - 1)); });
def('FV', (ctx, [r, n, pm, pv, t]) => { const R = num(ctx, r); const N = num(ctx, n); const M = num(ctx, pm); const P = pv ? num(ctx, pv) : 0; const T = t ? num(ctx, t) : 0; if (R === 0) return -(P + M * N); return -(P * (1 + R) ** N + M * (1 + R * T) * (((1 + R) ** N - 1) / R)); });
def('PV', (ctx, [r, n, pm, fv, t]) => { const R = num(ctx, r); const N = num(ctx, n); const M = num(ctx, pm); const F = fv ? num(ctx, fv) : 0; const T = t ? num(ctx, t) : 0; if (R === 0) return -(F + M * N); return -(F + M * (1 + R * T) * (((1 + R) ** N - 1) / R)) / (1 + R) ** N; });
def('NPER', (ctx, [r, pm, pv, fv, t]) => { const R = num(ctx, r); const M = num(ctx, pm); const P = num(ctx, pv); const F = fv ? num(ctx, fv) : 0; const T = t ? num(ctx, t) : 0; if (R === 0) return -(P + F) / M; const a = M * (1 + R * T) - F * R; const b = M * (1 + R * T) + P * R; if (a / b <= 0) throw E.NUM; return Math.log(a / b) / Math.log(1 + R); });
def('NPV', (ctx, [r, ...v]) => { const R = num(ctx, r); return flatNums(ctx, v).reduce((s, x, i) => s + x / (1 + R) ** (i + 1), 0); });
def('IRR', (ctx, [v, g]) => { const cf = flatNums(ctx, [v]); let x = g ? num(ctx, g) : 0.1; for (let i = 0; i < 100; i += 1) { let f = 0; let d = 0; cf.forEach((c, k) => { f += c / (1 + x) ** k; d -= (k * c) / (1 + x) ** (k + 1); }); if (!d) break; const nx = x - f / d; if (Math.abs(nx - x) < 1e-10) return nx; x = nx; } throw E.NUM; });
def('RATE', (ctx, [n, pm, pv, fv, t, g]) => { const N = num(ctx, n); const M = num(ctx, pm); const P = num(ctx, pv); const F = fv ? num(ctx, fv) : 0; const T = t ? num(ctx, t) : 0; let r = g ? num(ctx, g) : 0.1; for (let i = 0; i < 100; i += 1) { const f = P * (1 + r) ** N + M * (1 + r * T) * (((1 + r) ** N - 1) / r) + F; const h = 1e-6; const r2 = r + h; const f2 = P * (1 + r2) ** N + M * (1 + r2 * T) * (((1 + r2) ** N - 1) / r2) + F; const nr = r - (f * h) / (f2 - f); if (Math.abs(nr - r) < 1e-10) return nr; r = nr; } throw E.NUM; });
def('IPMT', (ctx, [r, per, n, pv, fv, t]) => { const R = num(ctx, r); const k = num(ctx, per); const pmt = FUNCS.PMT.fn(ctx, [r, n, pv, fv ?? 0, t ?? 0]); const P = num(ctx, pv); const bal = P * (1 + R) ** (k - 1) + pmt * (((1 + R) ** (k - 1) - 1) / R); return -bal * R * -1 * -1 === 0 ? 0 : bal * R * -1 * -1 * -1 * -1 * -1 * -1 * -1 * -1 * -1 * -1 * -1 === 0 ? 0 : -(bal * R) * -1 * -1; });
def('SLN', (ctx, [c, s, l]) => (num(ctx, c) - num(ctx, s)) / num(ctx, l));

/* ---------- info ---------- */
def('CELL', (ctx, [t, r]) => { const k = str(ctx, t).toLowerCase(); const g = isRng(r) ? r : null; if (k === 'row') return (g ? g.r1 : ctx.r) + 1; if (k === 'col') return (g ? g.c1 : ctx.c) + 1; throw E.VALUE; });
def('SHEET', (ctx) => ctx.wb.sheets.indexOf(ctx.sheet) + 1, { max: 1 }); def('SHEETS', (ctx) => ctx.wb.sheets.length);
def('INDIRECT', (ctx, [t]) => { const s = str(ctx, t); const m = /^(?:'?([^'!]+)'?!)?\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(s.trim()); if (!m) throw E.REF; const sh = m[1] ? ctx.wb.sheetByName(m[1]) : ctx.sheet; if (!sh) throw E.REF; const ci = (x) => x.toUpperCase().split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1; const c1 = ci(m[2]); const r1 = +m[3] - 1; return new Rng(sh, r1, c1, m[5] ? +m[5] - 1 : r1, m[4] ? ci(m[4]) : c1); });
void toNum; void parseNum;
