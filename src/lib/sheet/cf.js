import { key } from './addr.js';
import { shiftFormula } from './formula.js';
import { toStr } from './core.js';

/**
 * Conditional formatting. A rule lives in sheet.cf (array = priority order):
 *   { id, rng:{r1,c1,r2,c2}, kind, ...params, fmt:{bg,color,b} }
 *   kind 'cell'  op gt|lt|ge|le|eq|ne|btw|nbtw, v1, v2      kind 'text' tmode contains|notcontains|begins|ends, text
 *   kind 'dup' | 'uniq'                                      kind 'top' n, bottom, pct          kind 'avg' below
 *   kind 'scale' colors:[lo,(mid),hi]                         kind 'bar' color                   kind 'expr' expr (formula, relative to the range's first cell)
 * cfAt() returns the visual overlay of one cell: { bg, color, b, bar:{p,color} } or null.
 */

export const HILITE = [
  { id: 'redfill', en: 'Light red fill with dark red text', ar: 'تعبئة حمراء فاتحة بنص أحمر داكن', fmt: { bg: '#ffc7ce', color: '#9c0006' } },
  { id: 'yellow', en: 'Yellow fill with dark yellow text', ar: 'تعبئة صفراء بنص أصفر داكن', fmt: { bg: '#ffeb9c', color: '#9c5700' } },
  { id: 'green', en: 'Green fill with dark green text', ar: 'تعبئة خضراء بنص أخضر داكن', fmt: { bg: '#c6efce', color: '#006100' } },
  { id: 'redfill2', en: 'Light red fill', ar: 'تعبئة حمراء فاتحة', fmt: { bg: '#ffc7ce' } },
  { id: 'redtext', en: 'Red text', ar: 'نص أحمر', fmt: { color: '#9c0006' } },
  { id: 'boldred', en: 'Bold red text', ar: 'نص أحمر غامق', fmt: { color: '#c00000', b: 1 } },
  { id: 'blue', en: 'Blue fill with dark blue text', ar: 'تعبئة زرقاء بنص أزرق داكن', fmt: { bg: '#ddebf7', color: '#1f4e78' } },
];
export const SCALES = [
  { id: 'gyr', en: 'Green – Yellow – Red', ar: 'أخضر – أصفر – أحمر', colors: ['#63be7b', '#ffeb84', '#f8696b'] },
  { id: 'ryg', en: 'Red – Yellow – Green', ar: 'أحمر – أصفر – أخضر', colors: ['#f8696b', '#ffeb84', '#63be7b'] },
  { id: 'gwr', en: 'Green – White – Red', ar: 'أخضر – أبيض – أحمر', colors: ['#63be7b', '#ffffff', '#f8696b'] },
  { id: 'rwg', en: 'Red – White – Green', ar: 'أحمر – أبيض – أخضر', colors: ['#f8696b', '#ffffff', '#63be7b'] },
  { id: 'bwr', en: 'Blue – White – Red', ar: 'أزرق – أبيض – أحمر', colors: ['#5a8ac6', '#ffffff', '#f8696b'] },
  { id: 'wg', en: 'White – Green', ar: 'أبيض – أخضر', colors: ['#ffffff', '#63be7b'] },
  { id: 'wr', en: 'White – Red', ar: 'أبيض – أحمر', colors: ['#ffffff', '#f8696b'] },
  { id: 'wb', en: 'White – Blue', ar: 'أبيض – أزرق', colors: ['#ffffff', '#5a8ac6'] },
];
export const BARS = [
  { id: 'blue', en: 'Blue', ar: 'أزرق', color: '#638ec6' }, { id: 'green', en: 'Green', ar: 'أخضر', color: '#63c384' }, { id: 'red', en: 'Red', ar: 'أحمر', color: '#ff555a' },
  { id: 'orange', en: 'Orange', ar: 'برتقالي', color: '#ffb628' }, { id: 'purple', en: 'Purple', ar: 'بنفسجي', color: '#a55fa7' }, { id: 'teal', en: 'Light blue', ar: 'أزرق فاتح', color: '#6fc4d6' },
];
export const OPS = { gt: '>', lt: '<', ge: '≥', le: '≤', eq: '=', ne: '≠' };

let seq = 1;
export const newId = () => `cf${Date.now().toString(36)}${seq++}`;
export const inRng = (g, r, c) => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const hex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h); const n = m ? parseInt(m[1], 16) : 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => { const A = hex(a); const B = hex(b); return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(',')})`; };
const norm = (v) => (typeof v === 'string' ? `s:${v.toLowerCase()}` : `${typeof v}:${v}`);

/** Statistics of a rule over its range, cached per workbook version. */
function stats(wb, sheet, rule) {
  const c = rule._c; if (c && c.ver === wb.version) return c;
  const g = rule.rng; const r2 = Math.min(g.r2, Math.max(sheet.maxRow, g.r1)); const c2 = Math.min(g.c2, Math.max(sheet.maxCol, g.c1));
  const nums = []; const counts = new Map();
  for (let r = g.r1; r <= r2; r += 1) for (let cc = g.c1; cc <= c2; cc += 1) {
    const v = wb.getValue(sheet, r, cc); if (v === null || v === undefined || v === '') continue;
    const n = num(v); if (n !== null) nums.push(n);
    if (rule.kind === 'dup' || rule.kind === 'uniq') { const k = norm(v); counts.set(k, (counts.get(k) || 0) + 1); }
  }
  nums.sort((a, b) => a - b);
  const out = { ver: wb.version, counts, min: nums[0], max: nums[nums.length - 1], mid: nums.length ? nums[Math.floor((nums.length - 1) / 2)] : 0, avg: nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : 0, thr: null };
  if (rule.kind === 'top' && nums.length) { const k = rule.pct ? Math.max(1, Math.ceil((nums.length * rule.n) / 100)) : Math.max(1, Math.min(nums.length, rule.n)); out.thr = rule.bottom ? nums[Math.min(k, nums.length) - 1] : nums[nums.length - Math.min(k, nums.length)]; }
  rule._c = out; return out;
}

const cmpVal = (v, rule) => {
  const a = typeof v === 'number' ? v : Number.NaN; const t1 = Number(rule.v1); const t2 = Number(rule.v2);
  const numeric = Number.isFinite(t1) && String(rule.v1).trim() !== '';
  if (!numeric) { const s = typeof v === 'string' ? v.toLowerCase() : String(v ?? '').toLowerCase(); const w = String(rule.v1 ?? '').toLowerCase(); if (rule.op === 'eq') return s === w; if (rule.op === 'ne') return s !== w; return false; }
  if (!Number.isFinite(a)) return rule.op === 'ne';
  switch (rule.op) {
    case 'gt': return a > t1; case 'lt': return a < t1; case 'ge': return a >= t1; case 'le': return a <= t1; case 'eq': return a === t1; case 'ne': return a !== t1;
    case 'btw': return a >= Math.min(t1, t2) && a <= Math.max(t1, t2); case 'nbtw': return a < Math.min(t1, t2) || a > Math.max(t1, t2);
    default: return false;
  }
};

/** Overlay for one cell, or null. */
export function cfAt(wb, sheet, r, c) {
  const rules = sheet.cf; if (!rules || !rules.length) return null;
  let out = null;
  for (const rule of rules) {
    if (!inRng(rule.rng, r, c)) continue;
    const v = wb.getValue(sheet, r, c); let hit = false;
    switch (rule.kind) {
      case 'cell': hit = v !== null && v !== '' && cmpVal(v, rule); break;
      case 'text': { if (v === null) break; const s = toStr(v).toLowerCase(); const t = String(rule.text || '').toLowerCase(); hit = rule.tmode === 'contains' ? s.includes(t) : rule.tmode === 'notcontains' ? !s.includes(t) : rule.tmode === 'begins' ? s.startsWith(t) : s.endsWith(t); break; }
      case 'dup': case 'uniq': { if (v === null || v === '') break; const n = stats(wb, sheet, rule).counts.get(norm(v)) || 0; hit = rule.kind === 'dup' ? n > 1 : n === 1; break; }
      case 'top': { const n = num(v); if (n === null) break; const s = stats(wb, sheet, rule); hit = s.thr !== null && (rule.bottom ? n <= s.thr : n >= s.thr); break; }
      case 'avg': { const n = num(v); if (n === null) break; const s = stats(wb, sheet, rule); hit = rule.below ? n < s.avg : n > s.avg; break; }
      case 'expr': { if (!rule.expr) break; let x; try { x = wb.evalFormula(sheet, r, c, shiftFormula(rule.expr.replace(/^=/, ''), r - rule.rng.r1, c - rule.rng.c1)); } catch { x = null; } hit = x === true || (typeof x === 'number' && x !== 0); break; }
      case 'scale': {
        const n = num(v); if (n === null) break; const s = stats(wb, sheet, rule); if (s.min === undefined) break;
        const cols = rule.colors; const span = s.max - s.min || 1; let t = (n - s.min) / span;
        let col;
        if (cols.length === 3) { const midT = ((s.mid - s.min) / span) || 0.5; col = t <= midT ? mix(cols[0], cols[1], midT ? t / midT : 0) : mix(cols[1], cols[2], (t - midT) / (1 - midT || 1)); } else col = mix(cols[0], cols[1], t);
        out = out || {}; if (!out.bg) out.bg = col; continue;
      }
      case 'bar': {
        const n = num(v); if (n === null) break; const s = stats(wb, sheet, rule); if (s.min === undefined) break;
        const lo = Math.min(0, s.min); const hi = Math.max(0, s.max); const span = hi - lo || 1;
        out = out || {}; if (!out.bar) out.bar = { from: (0 - lo) / span, to: (n - lo) / span, color: rule.color, neg: n < 0 }; continue;
      }
      default: break;
    }
    if (hit && rule.fmt) { out = out || {}; if (rule.fmt.bg && !out.bg) out.bg = rule.fmt.bg; if (rule.fmt.color && !out.color) out.color = rule.fmt.color; if (rule.fmt.b && !out.b) out.b = 1; if (rule.stop) break; }
  }
  return out;
}

/** Human description of a rule (Manage Rules list). */
export function describe(rule, tt) {
  switch (rule.kind) {
    case 'cell': return rule.op === 'btw' || rule.op === 'nbtw' ? `${rule.op === 'btw' ? tt('Between', 'بين') : tt('Not between', 'ليس بين')} ${rule.v1} ${tt('and', 'و')} ${rule.v2}` : `${tt('Cell value', 'قيمة الخلية')} ${OPS[rule.op]} ${rule.v1}`;
    case 'text': return `${{ contains: tt('Contains', 'يحتوي'), notcontains: tt('Does not contain', 'لا يحتوي'), begins: tt('Begins with', 'يبدأ بـ'), ends: tt('Ends with', 'ينتهي بـ') }[rule.tmode]} “${rule.text}”`;
    case 'dup': return tt('Duplicate values', 'القيم المكررة'); case 'uniq': return tt('Unique values', 'القيم الفريدة');
    case 'top': return `${rule.bottom ? tt('Bottom', 'الأدنى') : tt('Top', 'الأعلى')} ${rule.n}${rule.pct ? '%' : ''}`;
    case 'avg': return rule.below ? tt('Below average', 'أقل من المتوسط') : tt('Above average', 'أعلى من المتوسط');
    case 'scale': return `${tt('Color scale', 'تدرج لوني')} (${rule.colors.length})`; case 'bar': return tt('Data bar', 'شريط بيانات');
    case 'expr': return `${tt('Formula', 'صيغة')}: =${String(rule.expr).replace(/^=/, '')}`;
    default: return rule.kind;
  }
}
