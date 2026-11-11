/* ------------------------------------------------------------------------------------------------------------------
 * Scientific calculator engine (fx-991 style). No eval, no dependencies.
 *
 * Every value is { f, ex }:  f  = the floating-point number,
 *                            ex = an EXACT form (Map "k|p" -> [num, den]  meaning  num/den · √k · π^p) or null.
 * So 1/3 + 1/6 -> 1/2,  √2/2 + √2/3 -> 5√2/6,  sin(60°) -> √3/2,  π/2 stays "π/2" until S⇔D is pressed.
 * ---------------------------------------------------------------------------------------------------------------- */

const SYN = 'Syntax ERROR';
const MATH = 'Math ERROR';
const BIG = 9e15;

/* ---------- exact rational helpers ---------- */
const gcd = (a, b) => { let x = Math.abs(a); let y = Math.abs(b); while (y) { [x, y] = [y, x % y]; } return x; };
const rat = (n, d = 1) => {
  if (d === 0) throw new Error(MATH);
  if (d < 0) { n = -n; d = -d; }
  if (Math.abs(n) > BIG || d > BIG) throw new Error('ovf');
  const g = gcd(n, d) || 1;
  return [n / g, d / g];
};
const rAdd = (a, b) => rat(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const rMul = (a, b) => rat(a[0] * b[0], a[1] * b[1]);
const key = (k, p) => `${k}|${p}`;
const unkey = (s) => s.split('|').map(Number);

/** m = o²·s with s square-free -> [o, s] */
function sqf(m) {
  let o = 1; let s = m;
  for (let i = 2; i * i <= s; i += 1) { while (s % (i * i) === 0) { s /= i * i; o *= i; } }
  return [o, s];
}
const clean = (m) => { for (const [k, c] of m) if (c[0] === 0) m.delete(k); return m; };
const safe = (fn) => { try { return fn(); } catch (e) { if (e.message === MATH) throw e; return null; } };

const exAdd = (a, b) => (!a || !b ? null : safe(() => {
  const m = new Map(a);
  for (const [k, c] of b) m.set(k, m.has(k) ? rAdd(m.get(k), c) : c);
  return clean(m);
}));
const exMul = (a, b) => (!a || !b ? null : safe(() => {
  const m = new Map();
  for (const [ka, ca] of a) for (const [kb, cb] of b) {
    const [k1, p1] = unkey(ka); const [k2, p2] = unkey(kb);
    if (p1 + p2 > 1) return null;
    const [o, s] = sqf(k1 * k2);
    const c = rMul(rMul(ca, cb), [o, 1]);
    const kk = key(s, p1 + p2);
    m.set(kk, m.has(kk) ? rAdd(m.get(kk), c) : c);
  }
  return clean(m);
}));
const exInv = (a) => {
  if (!a || a.size !== 1) return null;
  const [[kk, c]] = [...a]; const [k, p] = unkey(kk);
  if (p !== 0) return null;
  if (c[0] === 0) throw new Error(MATH);
  return safe(() => new Map([[key(k, 0), rat(c[1], c[0] * k)]])); // 1/(c√k) = √k/(c·k)
};
const exInt = (a) => { if (!a || a.size !== 1) return null; const [[kk, c]] = [...a]; return kk === '1|0' && c[1] === 1 ? c[0] : null; };

/* ---------- values ---------- */
export const ratV = (n, d = 1) => { const c = rat(n, d); return { f: n / d, ex: c[0] === 0 ? new Map() : new Map([['1|0', c]]) }; };
const surd = (n, d, k) => ({ f: (n / d) * Math.sqrt(k), ex: n === 0 ? new Map() : new Map([[key(k, 0), rat(n, d)]]) });
const PI = { f: Math.PI, ex: new Map([['1|1', [1, 1]]]) };
const fl = (f) => { if (!Number.isFinite(f)) throw new Error(MATH); return { f, ex: null }; };
const tidy = (f) => { if (!Number.isFinite(f)) throw new Error(MATH); const r = Number(f.toPrecision(14)); return Math.abs(r) < 1e-14 ? 0 : r; };
const mk = (f) => { const r = tidy(f); return Number.isInteger(r) && Math.abs(r) < 1e14 ? ratV(r) : { f: r, ex: null }; };

function numV(s) {
  const [i, dec = ''] = s.split('.');
  const digits = `${i}${dec}`;
  const f = parseFloat(s);
  if (digits.length <= 15) { const den = 10 ** dec.length; if (den <= BIG) return { f, ex: safe(() => new Map([['1|0', rat(parseInt(digits || '0', 10), den)]])) }; }
  return { f, ex: null };
}
const vAdd = (a, b) => ({ f: a.f + b.f, ex: exAdd(a.ex, b.ex) });
const vNeg = (a) => ({ f: -a.f, ex: a.ex && new Map([...a.ex].map(([k, c]) => [k, [-c[0], c[1]]])) });
const vSub = (a, b) => vAdd(a, vNeg(b));
const vMul = (a, b) => ({ f: a.f * b.f, ex: exMul(a.ex, b.ex) });
const vDiv = (a, b) => {
  if (b.f === 0) throw new Error(MATH);
  return { f: a.f / b.f, ex: exMul(a.ex, exInv(b.ex)) };
};
function vPow(a, b) {
  const f = a.f ** b.f;
  if (!Number.isFinite(f)) throw new Error(MATH);
  const e = exInt(b.ex);
  if (e !== null && Math.abs(e) <= 40 && a.ex) {
    if (a.f === 0 && e < 0) throw new Error(MATH);
    let base = a.ex; let out = new Map([['1|0', [1, 1]]]);
    for (let i = 0; i < Math.abs(e); i += 1) out = exMul(out, base);
    if (e < 0) out = exInv(out);
    return { f, ex: out };
  }
  return mk(f);
}
function vSqrt(a) {
  if (a.f < 0) throw new Error(MATH);
  const f = Math.sqrt(a.f);
  if (a.ex && a.ex.size === 1 && a.ex.has('1|0')) {
    const [n, d] = a.ex.get('1|0');
    const [o, s] = sqf(n * d);
    if (n * d <= BIG) return surd(o, d, s);
  }
  return mk(f);
}
function vCbrt(a) {
  const f = Math.cbrt(a.f);
  if (a.ex && a.ex.size === 1 && a.ex.has('1|0')) {
    const [n, d] = a.ex.get('1|0'); const rn = Math.round(Math.cbrt(n)); const rd = Math.round(Math.cbrt(d));
    if (rn ** 3 === n && rd ** 3 === d) return ratV(rn, rd);
  }
  return mk(f);
}
const intOnly = (v) => { if (!Number.isInteger(v.f) || v.f < 0) throw new Error(MATH); return v.f; };
const fact = (n) => { if (n > 170) throw new Error(MATH); let r = 1; for (let i = 2; i <= n; i += 1) r *= i; return r; };
const fromInt = (r) => (r < BIG ? ratV(r) : fl(r));

/* ---------- trig ---------- */
const toDeg = (f, ang) => (ang === 'D' ? f : ang === 'R' ? (f * 180) / Math.PI : f * 0.9);
const fromDeg = (d, ang) => (ang === 'D' ? d : ang === 'R' ? (d * Math.PI) / 180 : d / 0.9);
const SIN = { 0: [0, 1, 1], 30: [1, 2, 1], 45: [1, 2, 2], 60: [1, 2, 3], 90: [1, 1, 1] };
function exSin(d) {
  let x = ((d % 360) + 360) % 360; let s = 1;
  if (x >= 180) { x -= 180; s = -1; }
  if (x > 90) x = 180 - x;
  const t = SIN[x]; if (!t) return null;
  return surd(s * t[0], t[1], t[2]);
}
function trig(name, v, ang) {
  const deg = toDeg(v.f, ang); const r = Math.round(deg);
  if (Math.abs(deg - r) < 1e-9 * Math.max(1, Math.abs(deg))) {
    if (name === 'sin') { const e = exSin(r); if (e) return e; }
    if (name === 'cos') { const e = exSin(r + 90); if (e) return e; }
    if (name === 'tan') { const s = exSin(r); const c = exSin(r + 90); if (s && c) return vDiv(s, c); }
  }
  const rad = (deg * Math.PI) / 180;
  if (name === 'tan' && Math.abs(Math.cos(rad)) < 1e-12) throw new Error(MATH);
  return mk(Math[name](rad));
}

/* ---------- tokenizer ---------- */
const FN = ['sinh⁻¹(', 'cosh⁻¹(', 'tanh⁻¹(', 'sin⁻¹(', 'cos⁻¹(', 'tan⁻¹(', 'sinh(', 'cosh(', 'tanh(', 'sin(', 'cos(', 'tan(', 'logb(', 'log(', 'ln(',
  '√(', '∛(', 'root(', 'abs(', '∫(', 'd/dx(', 'Σ(', 'e^(', '10^('];
const CONST = ['Ans', 'Ran#', 'π', 'e'];
export const MULTI = [...FN, ...CONST, 'nPr', 'nCr', '^(−1)', '×10^'].sort((a, b) => b.length - a.length);
const OPS = '+−×÷^!%→=,';

export function tokenize(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    const rest = src.slice(i); const c = rest[0];
    if (c === ' ') { i += 1; continue; }
    const num = /^(\d+\.?\d*|\.\d+)/.exec(rest);
    if (num) { out.push({ t: 'num', v: num[0] }); i += num[0].length; continue; }
    const fn = FN.find((f) => rest.startsWith(f));
    if (fn) { out.push({ t: 'fn', v: fn.slice(0, -1) }); i += fn.length; continue; }
    const cs = CONST.find((f) => rest.startsWith(f));
    if (cs) { out.push({ t: 'const', v: cs }); i += cs.length; continue; }
    if (rest.startsWith('nPr') || rest.startsWith('nCr')) { out.push({ t: 'op', v: rest.slice(0, 3) }); i += 3; continue; }
    if (c === '(' || c === ')') { out.push({ t: c }); i += 1; continue; }
    if (c === ',') { out.push({ t: ',' }); i += 1; continue; }
    if (OPS.includes(c)) { out.push({ t: 'op', v: c }); i += 1; continue; }
    if (/[A-FXYM]/.test(c)) { out.push({ t: 'var', v: c }); i += 1; continue; }
    throw new Error(SYN);
  }
  return out;
}
export const varsIn = (src) => { try { return [...new Set(tokenize(src).filter((t) => t.t === 'var').map((t) => t.v))]; } catch { return []; } };

/* ---------- parser -> AST ---------- */
export function parseTop(src) {
  const toks = tokenize(src); let i = 0;
  const pk = () => toks[i]; const nx = () => { const t = toks[i]; i += 1; return t; };
  const isOp = (...v) => pk() && pk().t === 'op' && v.includes(pk().v);
  const isStart = (t) => t && (t.t === 'num' || t.t === 'var' || t.t === 'const' || t.t === 'fn' || t.t === '(');
  let add; let pw;
  const prim = () => {
    const t = nx(); if (!t) throw new Error(SYN);
    if (t.t === 'num' || t.t === 'const' || t.t === 'var') return { t: t.t, v: t.v };
    if (t.t === '(') { const a = add(); if (pk() && pk().t === ')') nx(); return a; }
    if (t.t === 'fn') {
      const args = [add()];
      while (pk() && pk().t === ',') { nx(); args.push(add()); }
      if (pk() && pk().t === ')') nx();
      return { t: 'fn', v: t.v, args };
    }
    throw new Error(SYN);
  };
  const post = () => { let a = prim(); while (isOp('!', '%')) a = { t: 'post', o: nx().v, a }; return a; };
  const sg = () => { if (isOp('−')) { nx(); return { t: 'neg', a: sg() }; } if (isOp('+')) { nx(); return sg(); } return pw(); };
  pw = () => { const a = post(); if (isOp('^')) { nx(); return { t: 'bin', o: '^', a, b: sg() }; } return a; };
  const imp = () => { let a = pw(); while (isStart(pk())) a = { t: 'bin', o: '×', a, b: pw() }; return a; };
  const perm = () => { let a = imp(); while (isOp('nPr', 'nCr')) { const o = nx().v; a = { t: 'bin', o, a, b: imp() }; } return a; };
  const un = () => { if (isOp('−')) { nx(); return { t: 'neg', a: un() }; } if (isOp('+')) { nx(); return un(); } return perm(); };
  const mul = () => { let a = un(); while (isOp('×', '÷')) { const o = nx().v; a = { t: 'bin', o, a, b: un() }; } return a; };
  add = () => { let a = mul(); while (isOp('+', '−')) { const o = nx().v; a = { t: 'bin', o, a, b: mul() }; } return a; };
  const ast = add(); let store = null;
  if (isOp('→')) { nx(); const t = nx(); if (!t || t.t !== 'var') throw new Error(SYN); store = t.v; }
  if (i < toks.length) throw new Error(SYN);
  return { ast, store };
}

/* ---------- evaluator ---------- */
const ZERO = ratV(0);
export function ev(n, env) {
  switch (n.t) {
    case 'num': return numV(n.v);
    case 'var': return env.vars[n.v] || ZERO;
    case 'const':
      if (n.v === 'π') return PI;
      if (n.v === 'e') return fl(Math.E);
      if (n.v === 'Ans') return env.ans || ZERO;
      return ratV(Math.floor(Math.random() * 1000), 1000);
    case 'neg': return vNeg(ev(n.a, env));
    case 'post': {
      const a = ev(n.a, env);
      return n.o === '%' ? vDiv(a, ratV(100)) : fromInt(fact(intOnly(a)));
    }
    case 'bin': {
      const a = ev(n.a, env); const b = ev(n.b, env);
      switch (n.o) {
        case '+': return vAdd(a, b);
        case '−': return vSub(a, b);
        case '×': return vMul(a, b);
        case '÷': return vDiv(a, b);
        case '^': return vPow(a, b);
        default: {
          const x = intOnly(a); const r = intOnly(b); if (r > x) throw new Error(MATH);
          let p = 1; for (let i = 0; i < r; i += 1) p *= x - i;
          return fromInt(n.o === 'nPr' ? p : Math.round(p / fact(r)));
        }
      }
    }
    default: return fnEval(n, env);
  }
}
const withX = (env, x) => ({ ...env, vars: { ...env.vars, X: x } });
function fnEval(n, env) {
  const { v: name, args } = n;
  const a = () => ev(args[0], env);
  const need = (k) => { if (args.length < k) throw new Error(SYN); };
  switch (name) {
    case 'sin': case 'cos': case 'tan': return trig(name, a(), env.ang);
    case 'sin⁻¹': case 'cos⁻¹': case 'tan⁻¹': {
      const x = a().f; const m = { 'sin⁻¹': 'asin', 'cos⁻¹': 'acos', 'tan⁻¹': 'atan' }[name];
      const r = Math[m](x); if (Number.isNaN(r)) throw new Error(MATH);
      return mk(fromDeg((r * 180) / Math.PI, env.ang));
    }
    case 'sinh': case 'cosh': case 'tanh': return mk(Math[name](a().f));
    case 'sinh⁻¹': case 'cosh⁻¹': case 'tanh⁻¹': { const r = Math[{ 'sinh⁻¹': 'asinh', 'cosh⁻¹': 'acosh', 'tanh⁻¹': 'atanh' }[name]](a().f); if (Number.isNaN(r)) throw new Error(MATH); return mk(r); }
    case 'log': { const x = a().f; if (x <= 0) throw new Error(MATH); return mk(Math.log10(x)); }
    case 'ln': { const x = a().f; if (x <= 0) throw new Error(MATH); return mk(Math.log(x)); }
    case 'logb': { need(2); const b = a().f; const x = ev(args[1], env).f; if (b <= 0 || b === 1 || x <= 0) throw new Error(MATH); return mk(Math.log(x) / Math.log(b)); }
    case '√': return vSqrt(a());
    case '∛': return vCbrt(a());
    case 'root': { need(2); const k = a().f; const x = ev(args[1], env).f; if (k === 0) throw new Error(MATH); if (x < 0 && Number.isInteger(k) && k % 2 !== 0) return mk(-((-x) ** (1 / k))); if (x < 0) throw new Error(MATH); return mk(x ** (1 / k)); }
    case 'abs': { const x = a(); return x.f < 0 ? vNeg(x) : x; }
    case 'e^': return mk(Math.exp(a().f));
    case '10^': return vPow(ratV(10), a());
    case '∫': {
      need(3); const lo = ev(args[1], env).f; const hi = ev(args[2], env).f;
      const g = (x) => ev(args[0], withX(env, fl(x))).f;
      const N = 2000; const h = (hi - lo) / N; let s = g(lo) + g(hi);
      for (let i = 1; i < N; i += 1) s += g(lo + i * h) * (i % 2 ? 4 : 2);
      return mk(Number(((s * h) / 3).toPrecision(10)));
    }
    case 'd/dx': {
      need(2); const x0 = ev(args[1], env).f; const g = (x) => ev(args[0], withX(env, fl(x))).f; const h = 1e-3;
      return mk(Number(((-g(x0 + 2 * h) + 8 * g(x0 + h) - 8 * g(x0 - h) + g(x0 - 2 * h)) / (12 * h)).toPrecision(9)));
    }
    case 'Σ': {
      need(3); const lo = Math.round(ev(args[1], env).f); const hi = Math.round(ev(args[2], env).f);
      if (hi - lo > 100000) throw new Error(MATH);
      let s = ZERO; for (let x = lo; x <= hi; x += 1) s = vAdd(s, ev(args[0], withX(env, ratV(x))));
      return s;
    }
    default: throw new Error(SYN);
  }
}

export function run(src, env) {
  const { ast, store } = parseTop(src);
  return { v: ev(ast, env), store };
}

/** SOLVE: finds X so that LHS = RHS (or expression = 0), starting near x0 */
export function solve(src, env, x0) {
  const [l, r] = src.split('=');
  const L = parseTop(l).ast; const R = r != null && r !== '' ? parseTop(r).ast : null;
  const fx = (x) => { try { const e = withX(env, fl(x)); return ev(L, e).f - (R ? ev(R, e).f : 0); } catch { return NaN; } };
  let x = x0; let ok = false;
  for (let i = 0; i < 80; i += 1) {
    const y = fx(x); if (!Number.isFinite(y)) break;
    if (Math.abs(y) < 1e-13) { ok = true; break; }
    const h = 1e-6 * Math.max(1, Math.abs(x)); const d = (fx(x + h) - fx(x - h)) / (2 * h);
    if (!d || !Number.isFinite(d)) break;
    const nx = x - y / d;
    if (Math.abs(nx - x) < 1e-14 * Math.max(1, Math.abs(x))) { x = nx; ok = Math.abs(fx(x)) < 1e-8; break; }
    x = nx;
  }
  if (!ok) {
    let br = null;
    for (let s = 0.5; s <= 1e4 && !br; s *= 2) {
      let px = x0 - s; let py = fx(px);
      for (let i = 1; i <= 80; i += 1) { const cx = x0 - s + (2 * s * i) / 80; const cy = fx(cx); if (Number.isFinite(py) && Number.isFinite(cy) && py * cy <= 0) { br = [px, cx]; break; } px = cx; py = cy; }
    }
    if (!br) throw new Error("Can't Solve");
    let [lo, hi] = br; const flo = fx(lo);
    for (let i = 0; i < 200; i += 1) { const mid = (lo + hi) / 2; const fm = fx(mid); if (fm === 0) { lo = mid; hi = mid; break; } if (flo * fm < 0) hi = mid; else lo = mid; }
    x = (lo + hi) / 2;
  }
  const v = mk(Number(x.toPrecision(11)));
  return { v, resid: fx(v.f) };
}

/* ---------- formatting ---------- */
export function fmt(f) {
  const r = Number(f.toPrecision(10));
  if (r === 0) return '0';
  const a = Math.abs(r);
  if (a >= 1e10 || a < 1e-4) { const [m, e] = r.toExponential(9).split('e'); return `${Number(m)}×10^${Number(e)}`; }
  return String(r);
}

/** Natural form: { neg, terms:[{c,k,p}], den } (c = positive-or-negative integer) or null when a plain number is enough */
export function natural(ex) {
  if (!ex || ex.size === 0 || exInt(ex) !== null) return null;
  const list = [...ex].map(([kk, c]) => { const [k, p] = unkey(kk); return { k, p, c }; });
  const den = list.reduce((l, t) => (l * t.c[1]) / gcd(l, t.c[1]), 1);
  let terms = list.map((t) => ({ k: t.k, p: t.p, c: (t.c[0] * den) / t.c[1] }));
  const g = terms.reduce((x, t) => gcd(x, t.c), den);
  terms = terms.map((t) => ({ ...t, c: t.c / g }));
  const d = den / g;
  terms.sort((a, b) => (a.k === 1 && a.p === 0 ? -1 : b.k === 1 && b.p === 0 ? 1 : a.p - b.p || a.k - b.k));
  const neg = terms.every((t) => t.c < 0);
  if (neg) terms = terms.map((t) => ({ ...t, c: -t.c }));
  return { neg, terms, den: d };
}
