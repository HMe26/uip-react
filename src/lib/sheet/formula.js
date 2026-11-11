import { colIndex, colName, MAXC, MAXR } from './addr.js';

/** Formula errors travel as values (instances of XlErr). */
export class XlErr {
  constructor(code) { this.code = code; }
  toString() { return this.code; }
}
export const E = {
  NULL: new XlErr('#NULL!'), DIV0: new XlErr('#DIV/0!'), VALUE: new XlErr('#VALUE!'), REF: new XlErr('#REF!'),
  NAME: new XlErr('#NAME?'), NUM: new XlErr('#NUM!'), NA: new XlErr('#N/A'), SPILL: new XlErr('#SPILL!'), CALC: new XlErr('#CALC!'),
};
export const ERR_BY_CODE = Object.fromEntries(Object.values(E).map((e) => [e.code, e]));
export const isErr = (v) => v instanceof XlErr;

const SHEET = "(?:'(?:[^']|'')+'|[A-Za-z_\\u0080-\\uFFFF][\\w.\\u0080-\\uFFFF]*)!";
const CELLP = '\\$?[A-Za-z]{1,3}\\$?\\d+';
const REF_RE = new RegExp(`(${SHEET})?(${CELLP}(?::${CELLP})?|\\$?[A-Za-z]{1,3}:\\$?[A-Za-z]{1,3}|\\$?\\d+:\\$?\\d+)(?![\\w(.])`, 'y');
const NUM_RE = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const ERR_RE = /#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|SPILL!|CALC!)/y;
const NAME_RE = /[A-Za-z_\\\u0080-\uFFFF][\w.\u0080-\uFFFF]*/y;
const OPS = ['<=', '>=', '<>', '<', '>', '=', '+', '-', '*', '/', '^', '&', '%', ':', '@'];

export function tokenize(src) {
  const out = []; let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (/\s/.test(ch)) { let j = i; while (j < n && /\s/.test(src[j])) j += 1; out.push({ t: 'ws', raw: src.slice(i, j) }); i = j; continue; }
    if (ch === '"') {
      let j = i + 1; let s = '';
      while (j < n) { if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += src[j]; j += 1; }
      out.push({ t: 'str', v: s, raw: src.slice(i, j + 1) }); i = j + 1; continue;
    }
    if (ch === '#') { ERR_RE.lastIndex = i; const m = ERR_RE.exec(src); if (m) { out.push({ t: 'err', v: m[0], raw: m[0] }); i += m[0].length; continue; } }
    REF_RE.lastIndex = i;
    const rm = REF_RE.exec(src);
    if (rm && (i === 0 || !/[\w.]/.test(src[i - 1]) || rm[1])) {
      out.push({ t: 'ref', sheet: rm[1] ? unq(rm[1].slice(0, -1)) : null, body: rm[2], raw: rm[0], sheetRaw: rm[1] || '' }); i += rm[0].length; continue;
    }
    if (/[\d.]/.test(ch)) { NUM_RE.lastIndex = i; const m = NUM_RE.exec(src); if (m) { out.push({ t: 'num', v: Number(m[0]), raw: m[0] }); i += m[0].length; continue; } }
    if (ch === "'") { // quoted sheet name followed by ! + a name or something we cannot parse as ref
      const m = /'(?:[^']|'')+'!/y; m.lastIndex = i; const r = m.exec(src);
      if (r) { out.push({ t: 'sheetq', raw: r[0] }); i += r[0].length; continue; }
    }
    NAME_RE.lastIndex = i;
    const nm = NAME_RE.exec(src);
    if (nm) {
      const j = i + nm[0].length;
      if (src[j] === '(') out.push({ t: 'fn', v: nm[0].toUpperCase(), raw: nm[0] }); else out.push({ t: 'name', v: nm[0], raw: nm[0] });
      i = j; continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) { out.push({ t: 'op', v: op, raw: op }); i += op.length; continue; }
    if (ch === '(') { out.push({ t: 'lp', raw: ch }); i += 1; continue; }
    if (ch === ')') { out.push({ t: 'rp', raw: ch }); i += 1; continue; }
    if (ch === ',') { out.push({ t: 'comma', raw: ch }); i += 1; continue; }
    if (ch === ';') { out.push({ t: 'semi', raw: ch }); i += 1; continue; }
    if (ch === '{') { out.push({ t: 'lb', raw: ch }); i += 1; continue; }
    if (ch === '}') { out.push({ t: 'rb', raw: ch }); i += 1; continue; }
    if (ch === '!') { out.push({ t: 'op', v: '!', raw: ch }); i += 1; continue; }
    throw new Error(`Unexpected "${ch}"`);
  }
  return out;
}
const unq = (s) => (s.startsWith("'") ? s.slice(1, -1).replace(/''/g, "'") : s);

/** Parses a ref body like "$A$1:B2", "A:A" or "3:5" into numbers + absolute flags. */
export function parseRefBody(body) {
  const parts = body.split(':');
  const one = (p) => {
    const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(p);
    if (m) return { c: colIndex(m[2]), r: Number(m[4]) - 1, ac: !!m[1], ar: !!m[3] };
    const mc = /^(\$?)([A-Za-z]{1,3})$/.exec(p);
    if (mc) return { c: colIndex(mc[2]), r: null, ac: !!mc[1], ar: false };
    const mr = /^(\$?)(\d+)$/.exec(p);
    return { c: null, r: Number(mr[2]) - 1, ar: !!mr[1], ac: false };
  };
  const a = one(parts[0]); const b = parts[1] ? one(parts[1]) : a;
  const whole = a.r === null ? 'col' : a.c === null ? 'row' : null;
  return {
    r1: a.r === null ? 0 : Math.min(a.r, b.r), c1: a.c === null ? 0 : Math.min(a.c, b.c),
    r2: a.r === null ? MAXR - 1 : Math.max(a.r, b.r), c2: a.c === null ? MAXC - 1 : Math.max(a.c, b.c),
    a1: a, b1: b, whole, single: parts.length === 1,
  };
}

const BP = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };

export function parse(src) {
  const toks = tokenize(src).filter((t) => t.t !== 'ws');
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  function expr(min) {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t) break;
      if (t.t === 'op' && t.v === '%') { next(); left = { t: 'pct', a: left }; continue; }
      if (t.t !== 'op' || !(t.v in BP) || BP[t.v] < min) break;
      next();
      const right = expr(BP[t.v] + 1);
      left = { t: 'bin', op: t.v, a: left, b: right };
    }
    return left;
  }
  function unary() {
    const t = peek();
    if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) { next(); return { t: 'un', op: t.v, a: expr(6) }; }
    if (t && t.t === 'op' && t.v === '@') { next(); return unary(); }
    return range();
  }
  function range() {
    let left = primary();
    while (peek() && peek().t === 'op' && peek().v === ':') { next(); left = { t: 'rng', a: left, b: primary() }; }
    return left;
  }
  function primary() {
    const t = next();
    if (!t) throw new Error('Unexpected end');
    switch (t.t) {
      case 'num': return { t: 'num', v: t.v };
      case 'str': return { t: 'str', v: t.v };
      case 'err': return { t: 'err', v: t.v };
      case 'ref': return { t: 'ref', sheet: t.sheet, ...parseRefBody(t.body) };
      case 'sheetq': throw new Error('Unsupported sheet reference');
      case 'name': {
        const u = t.v.toUpperCase();
        if (u === 'TRUE') return { t: 'bool', v: true };
        if (u === 'FALSE') return { t: 'bool', v: false };
        return { t: 'name', n: t.v };
      }
      case 'fn': {
        next(); // (
        const args = [];
        if (peek() && peek().t === 'rp') { next(); return { t: 'call', n: t.v, args }; }
        for (;;) {
          const k = peek();
          if (k && (k.t === 'comma' || k.t === 'rp')) args.push({ t: 'empty' }); else args.push(expr(1));
          const d = next();
          if (!d) throw new Error('Missing )');
          if (d.t === 'rp') break;
          if (d.t !== 'comma' && d.t !== 'semi') throw new Error('Expected , or )');
        }
        return { t: 'call', n: t.v, args };
      }
      case 'lp': {
        const e = expr(1);
        const d = next();
        if (!d || d.t !== 'rp') throw new Error('Missing )');
        return { t: 'paren', a: e };
      }
      case 'lb': {
        const rows = [[]];
        for (;;) {
          rows[rows.length - 1].push(expr(1));
          const d = next();
          if (!d) throw new Error('Missing }');
          if (d.t === 'rb') break;
          if (d.t === 'semi') rows.push([]); else if (d.t !== 'comma') throw new Error('Bad array');
        }
        return { t: 'arr', rows };
      }
      default: throw new Error(`Unexpected ${t.raw}`);
    }
  }
  const ast = expr(1);
  if (p < toks.length) throw new Error('Unexpected token');
  return ast;
}

/** Calls fn(node) for every node of the AST. */
export function walk(n, fn) {
  if (!n || typeof n !== 'object') return;
  fn(n);
  if (n.a) walk(n.a, fn);
  if (n.b) walk(n.b, fn);
  if (n.args) n.args.forEach((x) => walk(x, fn));
  if (n.rows) n.rows.forEach((r) => r.forEach((x) => walk(x, fn)));
}

const refText = (r, c, ar, ac) => `${ac ? '$' : ''}${colName(c)}${ar ? '$' : ''}${r + 1}`;

/**
 * Re-emits a formula after moving / adjusting its references.
 *   map(ref) -> { r1,c1,r2,c2 } | null (null = #REF!);  ref = { sheet, r1,c1,r2,c2, a1,b1, whole }
 */
export function rewrite(src, map) {
  let toks;
  try { toks = tokenize(src); } catch { return src; }
  return toks.map((t) => {
    if (t.t !== 'ref') return t.raw;
    const ref = { sheet: t.sheet, ...parseRefBody(t.body) };
    const m = map(ref);
    if (!m) return `${t.sheetRaw}#REF!`;
    const { a1, b1 } = ref;
    let body;
    if (ref.whole === 'col') body = `${a1.ac ? '$' : ''}${colName(m.c1)}:${b1.ac ? '$' : ''}${colName(m.c2)}`;
    else if (ref.whole === 'row') body = `${a1.ar ? '$' : ''}${m.r1 + 1}:${b1.ar ? '$' : ''}${m.r2 + 1}`;
    else if (ref.single) body = refText(m.r1, m.c1, a1.ar, a1.ac);
    else body = `${refText(m.r1, m.c1, a1.ar, a1.ac)}:${refText(m.r2, m.c2, b1.ar, b1.ac)}`;
    return t.sheetRaw + body;
  }).join('');
}

/** Copy / fill: moves relative references by (dr, dc), absolute ones stay. */
export function shiftFormula(src, dr, dc) {
  if (!dr && !dc) return src;
  return rewrite(src, (ref) => {
    const mv = (p, dRow, dCol) => ({ r: p.ar || p.r === null ? p.r : p.r + dRow, c: p.ac || p.c === null ? p.c : p.c + dCol });
    const a = mv(ref.a1, dr, dc); const b = mv(ref.b1, dr, dc);
    const r1 = ref.whole === 'col' ? 0 : Math.min(a.r, b.r); const r2 = ref.whole === 'col' ? MAXR - 1 : Math.max(a.r, b.r);
    const c1 = ref.whole === 'row' ? 0 : Math.min(a.c, b.c); const c2 = ref.whole === 'row' ? MAXC - 1 : Math.max(a.c, b.c);
    if ((ref.whole !== 'col' && (r1 < 0 || r2 >= MAXR)) || (ref.whole !== 'row' && (c1 < 0 || c2 >= MAXC))) return null;
    return { r1, c1, r2, c2 };
  });
}

/** Tokens for the formula bar colouring: refs get a colour index. */
export function refTokens(src) {
  try { return tokenize(src); } catch { return []; }
}
