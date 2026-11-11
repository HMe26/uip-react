/** Excel number-format engine: General, 0.00, #,##0, %, E+, dates / times, [Red], conditions, text sections, fractions. */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ---------- date serials (Excel 1900 system, with its fake 1900-02-29) ---------- */
const DAY = 86400000;
const EPOCH = Date.UTC(1899, 11, 30);
export function serialToParts(serial, d1904 = false) {
  let s = serial;
  if (d1904) s += 1462;
  let ms = Math.round(s * DAY);
  let days = Math.floor(ms / DAY); let rem = ms - days * DAY;
  if (rem >= DAY) { rem -= DAY; days += 1; }
  let y; let m; let d; let dow;
  if (days === 60) { y = 1900; m = 2; d = 29; dow = 3; } else {
    const adj = days < 60 ? days + 1 : days; // before the fake leap day Excel is one day behind our proleptic calendar
    const dt = new Date(EPOCH + adj * DAY);
    y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate(); dow = dt.getUTCDay();
    if (days < 60) { const dt2 = new Date(EPOCH + (days + 1) * DAY); dow = dt2.getUTCDay(); }
  }
  const H = Math.floor(rem / 3600000); const M = Math.floor((rem % 3600000) / 60000); const S = Math.floor((rem % 60000) / 1000); const ms3 = rem % 1000;
  return { y, m, d, dow, H, M, S, ms: ms3, days, rem };
}
export function partsToSerial(y, m, d) {
  const mm = m - 1; const yy = y + Math.floor(mm / 12); const mo = ((mm % 12) + 12) % 12;
  const t = Date.UTC(yy, mo, 1) + (d - 1) * DAY;
  let days = Math.round((t - EPOCH) / DAY);
  if (days < 61) days -= 1; // serial 1 = 1900-01-01
  return days;
}
export const timeFrac = (h, mi, s) => (h * 3600 + mi * 60 + s) / 86400;

/* ---------- General ---------- */
export function general(x) {
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e11 || a < 1e-9) {
    let s = x.toExponential(5).replace(/\.?0+e/, 'e');
    s = s.replace('e+', 'E+').replace('e-', 'E-');
    return s.replace(/E([+-])(\d)$/, 'E$10$2');
  }
  let s = String(+x.toPrecision(15));
  if (/e/i.test(s)) s = x.toFixed(10).replace(/\.?0+$/, '');
  return s;
}

/* ---------- parsing a format code ---------- */
const COLORS = { red: '#ff3b30', blue: '#3b82f6', green: '#22c55e', black: '#111111', white: '#ffffff', yellow: '#facc15', cyan: '#06b6d4', magenta: '#d946ef' };
const cache = new Map();

function splitSections(code) {
  const out = []; let cur = ''; let q = false; let br = false;
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '\\') { cur += ch + (code[i + 1] || ''); i += 1; continue; }
    if (ch === '"') q = !q; else if (!q && ch === '[') br = true; else if (!q && ch === ']') br = false;
    if (ch === ';' && !q && !br) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseSection(src) {
  const sec = { tokens: [], color: null, cond: null, date: false, text: false, pct: 0, scale: 0, sci: false, grouping: false, frac: null, ampm: false, elapsed: false };
  let i = 0;
  const s = src;
  const push = (t) => sec.tokens.push(t);
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') { const j = s.indexOf('"', i + 1); const e = j < 0 ? s.length : j; push({ k: 'lit', v: s.slice(i + 1, e) }); i = e + 1; continue; }
    if (ch === '\\') { push({ k: 'lit', v: s[i + 1] || '' }); i += 2; continue; }
    if (ch === '_') { push({ k: 'lit', v: ' ' }); i += 2; continue; }
    if (ch === '*') { i += 2; continue; }
    if (ch === '[') {
      const j = s.indexOf(']', i); const inner = s.slice(i + 1, j < 0 ? s.length : j); i = (j < 0 ? s.length : j) + 1;
      const low = inner.toLowerCase();
      if (COLORS[low]) { sec.color = COLORS[low]; continue; }
      if (/^color\s*\d+$/.test(low)) { sec.color = '#3b82f6'; continue; }
      const cm = /^(<=|>=|<>|<|>|=)\s*(-?[\d.]+)$/.exec(inner);
      if (cm) { sec.cond = { op: cm[1], v: Number(cm[2]) }; continue; }
      if (/^\$/.test(inner)) { const cur = /^\$([^-]*)/.exec(inner); if (cur && cur[1]) push({ k: 'lit', v: cur[1] }); continue; }
      if (/^(h+|m+|s+)$/.test(low)) { sec.date = true; sec.elapsed = true; push({ k: 'el', v: low[0], n: low.length }); continue; }
      continue;
    }
    const rest = s.slice(i);
    let m;
    if ((m = /^(am\/pm|a\/p)/i.exec(rest))) { sec.date = true; sec.ampm = true; push({ k: 'ampm', v: m[1], upper: m[1] === m[1].toUpperCase() }); i += m[1].length; continue; }
    if ((m = /^(yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s)/i.exec(rest))) { sec.date = true; push({ k: 'd', v: m[1].toLowerCase() }); i += m[1].length; continue; }
    if ((m = /^e[+-]/i.exec(rest))) { sec.sci = true; push({ k: 'e', v: m[0] }); i += 2; continue; }
    if (ch === '@') { sec.text = true; push({ k: 'at' }); i += 1; continue; }
    if (ch === '%') { sec.pct += 1; push({ k: 'lit', v: '%' }); i += 1; continue; }
    if (ch === '0' || ch === '#' || ch === '?') { push({ k: 'ph', v: ch }); i += 1; continue; }
    if (ch === '.') { push({ k: 'dot' }); i += 1; continue; }
    if (ch === ',') { push({ k: 'comma' }); i += 1; continue; }
    if (ch === '/') { push({ k: 'slash' }); i += 1; continue; }
    push({ k: 'lit', v: ch }); i += 1;
  }
  // minute vs month: "m" directly after h or before s is minutes
  const dt = sec.tokens;
  for (let k = 0; k < dt.length; k += 1) {
    const t = dt[k];
    if (t.k === 'd' && (t.v === 'm' || t.v === 'mm')) {
      let p = k - 1; while (p >= 0 && (dt[p].k === 'lit' && /^[:\s.]$/.test(dt[p].v))) p -= 1;
      let n = k + 1; while (n < dt.length && (dt[n].k === 'lit' && /^[:\s.]$/.test(dt[n].v))) n += 1;
      if ((p >= 0 && ((dt[p].k === 'd' && /^h/.test(dt[p].v)) || (dt[p].k === 'el' && dt[p].v === 'h'))) || (n < dt.length && dt[n].k === 's' || (n < dt.length && dt[n].k === 'd' && /^s/.test(dt[n].v)))) t.min = true;
    }
  }
  if (!sec.date) {
    // thousands grouping / scaling commas / fractions
    const tk = sec.tokens;
    const phIdx = tk.map((t, k) => (t.k === 'ph' ? k : -1)).filter((k) => k >= 0);
    if (phIdx.length) {
      const first = phIdx[0]; const last = phIdx[phIdx.length - 1];
      for (let k = first; k <= last; k += 1) if (tk[k].k === 'comma') sec.grouping = true;
      let k = last + 1; let sc = 0; while (k < tk.length && tk[k].k === 'comma') { sc += 1; k += 1; }
      if (sc && !tk.some((t) => t.k === 'dot')) { sec.scale = sc; for (let j = last + 1; j < last + 1 + sc; j += 1) tk[j].k = 'skip'; }
    }
    const si = tk.findIndex((t) => t.k === 'slash');
    if (si > 0) {
      let a = si - 1; while (a >= 0 && tk[a].k === 'ph') a -= 1;
      let b = si + 1; while (b < tk.length && tk[b].k === 'ph') b += 1;
      const num = si - 1 - a; const den = b - si - 1;
      if (num > 0 && den > 0) {
        const fixed = tk.slice(si + 1, b).every((t) => t.v === '0' || t.v === '?' || t.v === '#') && /^\d+$/.test(tk.slice(si + 1, b).map((t) => t.v).join('')) ;
        sec.frac = { start: a + 1, slash: si, end: b, denDigits: den, whole: a >= 0 && tk.slice(0, a + 1).some((t) => t.k === 'ph'), fixed: fixed ? Number(tk.slice(si + 1, b).map((t) => t.v).join('')) : 0 };
      }
    }
  }
  return sec;
}

function parseFormat(code) {
  let f = cache.get(code);
  if (f) return f;
  const raw = splitSections(code);
  const secs = raw.map(parseSection);
  f = { secs, code };
  if (cache.size > 500) cache.clear();
  cache.set(code, f);
  return f;
}

/* ---------- number rendering ---------- */
const round = (x, d) => { if (!isFinite(x)) return x; const s = Number(`${Math.round(Number(`${Math.abs(x)}e${d}`))}e-${d}`); return x < 0 ? -s : s; };
const group = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function renderNumber(sec, xIn, neg) {
  let x = Math.abs(xIn);
  x *= 100 ** sec.pct;
  if (sec.scale) x /= 1000 ** sec.scale;
  const tk = sec.tokens;
  if (sec.frac) return renderFraction(sec, x, neg);
  if (sec.sci) return renderSci(sec, x, neg);
  const dot = tk.findIndex((t) => t.k === 'dot');
  const intT = dot < 0 ? tk : tk.slice(0, dot); const fracT = dot < 0 ? [] : tk.slice(dot + 1);
  const fDigits = fracT.filter((t) => t.k === 'ph').length;
  const r = round(x, fDigits);
  let [ip, fp = ''] = r.toFixed(fDigits).split('.');
  if (/e/i.test(String(r))) { ip = BigInt(Math.round(r)).toString(); }
  const intPh = intT.filter((t) => t.k === 'ph');
  const minInt = intPh.filter((t) => t.v === '0').length;
  let digits = ip === '0' && minInt === 0 ? '' : ip;
  if (digits.length < minInt) digits = digits.padStart(minInt, '0');
  const hasLits = intT.some((t, k) => t.k === 'lit' && k > intT.findIndex((u) => u.k === 'ph') && k < intT.length - [...intT].reverse().findIndex((u) => u.k === 'ph'));
  let out = '';
  if (!intPh.length) {
    out = intT.map((t) => (t.k === 'lit' ? t.v : '')).join('');
  } else if (sec.grouping || !hasLits) {
    const gs = sec.grouping ? group(digits) : digits;
    let placed = false;
    for (const t of intT) {
      if (t.k === 'ph') { if (!placed) { out += gs; placed = true; } } else if (t.k === 'lit') out += t.v;
    }
  } else {
    let di = digits.length - 1; const slots = []; 
    for (let k = intT.length - 1; k >= 0; k -= 1) {
      const t = intT[k];
      if (t.k === 'ph') {
        let ch = di >= 0 ? digits[di] : (t.v === '0' ? '0' : (t.v === '?' ? ' ' : '')); di -= 1;
        if (k === intT.findIndex((u) => u.k === 'ph') && di >= 0) { ch = digits.slice(0, di + 2); di = -1; }
        slots.unshift(ch);
      } else slots.unshift(t.k === 'lit' ? t.v : '');
    }
    out = slots.join('');
  }
  if (dot >= 0) {
    let f = '';
    let fi = 0;
    // trim trailing '#' zeros, '?' -> space
    const phs = fracT.filter((t) => t.k === 'ph');
    const chars = fp.split('');
    for (let k = phs.length - 1; k >= 0; k -= 1) {
      if (phs[k].v !== '0' && chars[k] === '0') { chars[k] = phs[k].v === '?' ? ' ' : ''; } else break;
    }
    for (const t of fracT) { if (t.k === 'ph') { f += chars[fi] ?? ''; fi += 1; } else if (t.k === 'lit') f += t.v; }
    out += `.${f}`;
  }
  const after = tk.slice(dot < 0 ? intT.length : intT.length + 1 + fracT.length);
  void after;
  return (neg ? '-' : '') + out;
}

function renderSci(sec, x, neg) {
  const tk = sec.tokens;
  const ei = tk.findIndex((t) => t.k === 'e');
  const mant = tk.slice(0, ei); const expT = tk.slice(ei + 1);
  const dot = mant.findIndex((t) => t.k === 'dot');
  const fd = dot < 0 ? 0 : mant.slice(dot + 1).filter((t) => t.k === 'ph').length;
  const id = Math.max(1, (dot < 0 ? mant : mant.slice(0, dot)).filter((t) => t.k === 'ph').length);
  let e = x === 0 ? 0 : Math.floor(Math.log10(x)) - (id - 1);
  let m = x === 0 ? 0 : x / 10 ** e;
  m = round(m, fd);
  if (m >= 10 ** id) { m /= 10; e += 1; }
  const ed = expT.filter((t) => t.k === 'ph').length;
  const es = String(Math.abs(e)).padStart(ed, '0');
  const sign = e < 0 ? '-' : (tk[ei].v === 'E+' || tk[ei].v === 'e+' ? '+' : '');
  return `${neg ? '-' : ''}${m.toFixed(fd)}${tk[ei].v[0]}${sign}${es}`;
}

function renderFraction(sec, x, neg) {
  const f = sec.frac; const tk = sec.tokens;
  let whole = Math.floor(x); let frac = x - whole;
  if (!f.whole) { whole = 0; frac = x; }
  const maxD = f.fixed || 10 ** f.denDigits - 1;
  let bn = 0; let bd = 1; let best = Math.abs(frac);
  if (f.fixed) { bd = f.fixed; bn = Math.round(frac * bd); } else {
    for (let d = 1; d <= maxD; d += 1) { const n = Math.round(frac * d); const err = Math.abs(frac - n / d); if (err < best - 1e-12) { best = err; bn = n; bd = d; } if (err < 1e-10) break; }
  }
  if (bn === bd) { whole += f.whole ? 1 : 0; bn = 0; bd = 1; if (!f.whole) { bn = 1; } }
  let out = '';
  const showWhole = f.whole && !(whole === 0 && bn > 0 && tk.slice(0, f.start).some((t) => t.k === 'ph' && t.v === '#'));
  if (showWhole) out += `${whole}`;
  if (bn === 0 && f.whole) return (neg ? '-' : '') + out + ' '.repeat(f.denDigits * 2 + 2);
  out += (showWhole ? ' ' : '') + `${bn}/${bd}`;
  return (neg ? '-' : '') + out;
}

function renderDate(sec, serial, d1904) {
  const p = serialToParts(serial, d1904);
  const tk = sec.tokens;
  const h12 = sec.ampm ? ((p.H % 12) || 12) : p.H;
  let out = '';
  for (const t of tk) {
    if (t.k === 'lit') out += t.v;
    else if (t.k === 'ampm') { const pm = p.H >= 12; out += /^a\/p$/i.test(t.v) ? (pm ? 'P' : 'A') : (pm ? 'PM' : 'AM'); if (!t.upper) out = out.slice(0, out.length - (/^a\/p$/i.test(t.v) ? 1 : 2)) + (/^a\/p$/i.test(t.v) ? (pm ? 'p' : 'a') : (pm ? 'pm' : 'am')); }
    else if (t.k === 'el') { const tot = Math.floor(serial * 86400 + 1e-6); const v = t.v === 'h' ? Math.floor(tot / 3600) : t.v === 'm' ? Math.floor(tot / 60) : tot; out += String(v).padStart(t.n, '0'); }
    else if (t.k === 'd') {
      switch (t.v) {
        case 'yyyy': out += String(p.y).padStart(4, '0'); break;
        case 'yy': out += String(p.y % 100).padStart(2, '0'); break;
        case 'mmmmm': out += MONTHS[p.m - 1][0]; break;
        case 'mmmm': out += MONTHS[p.m - 1]; break;
        case 'mmm': out += MONTHS[p.m - 1].slice(0, 3); break;
        case 'mm': out += t.min ? String(p.M).padStart(2, '0') : String(p.m).padStart(2, '0'); break;
        case 'm': out += t.min ? String(p.M) : String(p.m); break;
        case 'dddd': out += DAYS[p.dow]; break;
        case 'ddd': out += DAYS[p.dow].slice(0, 3); break;
        case 'dd': out += String(p.d).padStart(2, '0'); break;
        case 'd': out += String(p.d); break;
        case 'hh': out += String(h12).padStart(2, '0'); break;
        case 'h': out += String(h12); break;
        case 'ss': out += String(p.S).padStart(2, '0'); break;
        case 's': out += String(p.S); break;
        default: break;
      }
    } else if (t.k === 'dot') out += '.';
    else if (t.k === 'comma') out += ',';
    else if (t.k === 'slash') out += '/';
    else if (t.k === 'ph' && t.v === '0') out += String(Math.floor(p.ms / 100));
  }
  return out;
}

/** Format one value. Returns { text, color } . `v` is number | string | boolean | null. */
export function formatValue(v, code, opts = {}) {
  if (v === null || v === undefined || v === '') return { text: '', color: null };
  if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', color: null };
  if (typeof v === 'object' && v.code) return { text: v.code, color: null };
  if (!code || code === 'General' || code === 'general') {
    if (typeof v === 'number') return { text: isFinite(v) ? general(v) : '#NUM!', color: null };
    return { text: String(v), color: null };
  }
  const f = parseFormat(code);
  const secs = f.secs;
  if (typeof v === 'string') {
    const ts = secs.find((s) => s.text) || (secs.length === 1 && secs[0].text ? secs[0] : null);
    if (ts) return { text: ts.tokens.map((t) => (t.k === 'at' ? v : t.k === 'lit' ? t.v : '')).join(''), color: ts.color };
    return { text: v, color: null };
  }
  if (!isFinite(v)) return { text: '#NUM!', color: null };
  // choose section
  let sec; let neg = v < 0; let val = v;
  const conds = secs.filter((s) => s.cond);
  if (conds.length) {
    const ok = (s) => { const c = s.cond; return c.op === '>' ? v > c.v : c.op === '<' ? v < c.v : c.op === '>=' ? v >= c.v : c.op === '<=' ? v <= c.v : c.op === '=' ? v === c.v : v !== c.v; };
    sec = secs.find((s) => s.cond && ok(s));
    if (!sec) sec = secs.find((s) => !s.cond && !s.text) || secs[secs.length - 1];
    neg = sec === secs[1] || (secs.length > 1 && !secs[0].cond ? false : v < 0 && sec === secs[0]) ? v < 0 : v < 0;
  } else if (secs.length >= 2 && v < 0) { sec = secs[1]; neg = false; val = Math.abs(v); } else if (secs.length >= 3 && v === 0) { sec = secs[2]; } else sec = secs[0];
  if (secs.length >= 3 && v === 0 && !conds.length) sec = secs[2];
  if (sec.text && !sec.tokens.some((t) => t.k === 'ph')) return { text: sec.tokens.map((t) => (t.k === 'lit' ? t.v : t.k === 'at' ? String(v) : '')).join(''), color: sec.color };
  if (sec.date) {
    if (v < 0) return { text: '#'.repeat(10), color: null };
    return { text: renderDate(sec, val, opts.d1904), color: sec.color };
  }
  if (!sec.tokens.some((t) => t.k === 'ph' || t.k === 'e')) {
    return { text: sec.tokens.map((t) => (t.k === 'lit' ? t.v : '')).join(''), color: sec.color };
  }
  // literals before / after the number body
  const tk = sec.tokens;
  const firstPh = tk.findIndex((t) => t.k === 'ph'); let lastPh = -1;
  tk.forEach((t, k) => { if (t.k === 'ph' || t.k === 'e') lastPh = k; });
  const pre = tk.slice(0, firstPh).map((t) => (t.k === 'lit' ? t.v : '')).join('');
  const post = tk.slice(lastPh + 1).map((t) => (t.k === 'lit' ? t.v : '')).join('');
  const body = renderNumber({ ...sec, tokens: tk.slice(firstPh, lastPh + 1) }, val, neg && secs.length < 2 || (neg && sec === secs[0]));
  const sign = body.startsWith('-') ? '-' : '';
  return { text: sign + pre + body.replace(/^-/, '') + post, color: sec.color };
}

export const fmtText = (v, code, opts) => formatValue(v, code, opts).text;
export const isDateFormat = (code) => !!code && code !== 'General' && parseFormat(code).secs.some((s) => s.date);

/* ---------- presets used by the ribbon ---------- */
export const NUM_FORMATS = [
  { id: 'General', en: 'General', ar: 'عام', code: 'General' },
  { id: 'number', en: 'Number', ar: 'رقم', code: '0.00' },
  { id: 'thousands', en: 'Number (1,000)', ar: 'رقم بفواصل', code: '#,##0.00' },
  { id: 'currency', en: 'Currency', ar: 'عملة', code: '"$"#,##0.00' },
  { id: 'accounting', en: 'Accounting', ar: 'محاسبي', code: '_("$"* #,##0.00_);_("$"* (#,##0.00);_("$"* "-"??_);_(@_)' },
  { id: 'date', en: 'Short date', ar: 'تاريخ قصير', code: 'yyyy-mm-dd' },
  { id: 'datel', en: 'Long date', ar: 'تاريخ طويل', code: 'dddd, mmmm d, yyyy' },
  { id: 'time', en: 'Time', ar: 'وقت', code: 'h:mm:ss' },
  { id: 'percent', en: 'Percentage', ar: 'نسبة مئوية', code: '0.00%' },
  { id: 'fraction', en: 'Fraction', ar: 'كسر', code: '# ?/?' },
  { id: 'sci', en: 'Scientific', ar: 'علمي', code: '0.00E+00' },
  { id: 'text', en: 'Text', ar: 'نص', code: '@' },
];
