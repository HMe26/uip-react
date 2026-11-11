/**
 * Small, dependency-free Markdown parser for the ZIP workbench preview.
 * It never produces HTML strings: the result is an AST that MarkdownView turns into React elements,
 * so nothing the author writes can inject markup or script.
 *
 * Supports: headings (ATX + setext), paragraphs, emphasis, strike, inline code, links, images (+ reference style),
 * autolinks, lists (nested, ordered, task lists), block quotes + GitHub alerts, fenced code, tables with alignment,
 * horizontal rules, front matter, emoji shortcodes and the small HTML subset READMEs rely on
 * (<p|div|center align>, <img>, <br>, <details>/<summary>, <kbd>, <sub>, <sup>, <h1-6 align>, <a>).
 */

const ESC_RE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;

/** Returns the URL when it is safe to use, otherwise null (blocks javascript:, vbscript:, data: links …). */
export function safeUrl(u, { image = false } = {}) {
  if (typeof u !== 'string') return null;
  const t = u.trim();
  if (!t) return null;
  // eslint-disable-next-line no-control-regex
  const probe = t.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(probe);
  if (!m) return t;
  const s = m[1].toLowerCase();
  if (s === 'http' || s === 'https') return t;
  if (!image && (s === 'mailto' || s === 'tel')) return t;
  if (image && s === 'data' && /^data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)[;,]/i.test(probe)) return t;
  return null;
}

export const slugify = (s) => String(s).toLowerCase().trim().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');

export function inlineText(nodes) {
  let out = '';
  for (const n of nodes || []) {
    if (n.t === 'text' || n.t === 'code') out += n.v;
    else if (n.t === 'br') out += ' ';
    else if (n.t === 'img') out += n.alt || '';
    else if (n.k) out += inlineText(n.k);
  }
  return out;
}

const EMOJI = {
  rocket: '🚀', warning: '⚠️', white_check_mark: '✅', check: '✔️', heavy_check_mark: '✔️', x: '❌', tada: '🎉', bulb: '💡', star: '⭐', fire: '🔥',
  memo: '📝', book: '📖', books: '📚', zap: '⚡', lock: '🔒', bug: '🐛', sparkles: '✨', point_right: '👉', pushpin: '📌', computer: '💻', link: '🔗',
  gear: '⚙️', wrench: '🔧', mag: '🔍', art: '🎨', package: '📦', construction: '🚧', information_source: 'ℹ️', question: '❓', exclamation: '❗',
  hammer: '🔨', eyes: '👀', thumbsup: '👍', '+1': '👍', '-1': '👎', wave: '👋', smile: '😄', heart: '❤️', clipboard: '📋', calendar: '📅', trophy: '🏆',
  chart_with_upwards_trend: '📈', file_folder: '📁', open_file_folder: '📂', email: '📧', phone: '📞', globe_with_meridians: '🌐', shield: '🛡️', key: '🔑',
  hourglass: '⌛', bell: '🔔', flags: '🎏', dart: '🎯', handshake: '🤝', raised_hands: '🙌', pencil2: '✏️', pencil: '📝', school_satchel: '🎒', mortar_board: '🎓',
};

const INLINE_MAP = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', ins: 'u', s: 's', del: 's', strike: 's', kbd: 'kbd', sub: 'sub', sup: 'sup', mark: 'mark', small: 'small' };
const SKIP_TAGS = new Set(['span', 'font', 'p', 'div', 'center', 'picture', 'source', 'details', 'summary', 'abbr', 'cite', 'q', 'var', 'samp', 'tt', 'big', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'figure', 'figcaption', 'nav', 'header', 'footer', 'main', 'aside', 'dl', 'dt', 'dd', 'blockquote', 'pre']);

const RE_AUTO = /<(https?:\/\/[^\s<>]+|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/y;
const RE_TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\s*(\/?)>/y;
const RE_BARE = /https?:\/\/[^\s<]*[^\s<.,:;"')\]!?]/y;
const RE_EMOJI = /:([a-z0-9_+-]+):/y;

const attr = (str, name) => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(str || '');
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
};

function findRun(s, run, from) {
  let i = from;
  while (i < s.length) {
    const k = s.indexOf('`', i);
    if (k < 0) return -1;
    let e = k;
    while (s[e] === '`') e++;
    if (e - k === run.length) return k;
    i = e;
  }
  return -1;
}

function matchBracket(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (ch === '\\') { j++; continue; }
    if (ch === '`') {
      let e = j;
      while (s[e] === '`') e++;
      const k = findRun(s, s.slice(j, e), e);
      j = k >= 0 ? k + (e - j) - 1 : e - 1;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) return j; }
  }
  return -1;
}

function parseDest(s, i) {
  let j = i + 1;
  while (s[j] === ' ' || s[j] === '\n') j++;
  let url = '';
  if (s[j] === '<') {
    const e = s.indexOf('>', j);
    if (e < 0) return null;
    url = s.slice(j + 1, e);
    j = e + 1;
  } else {
    let depth = 0;
    const st = j;
    for (; j < s.length; j++) {
      const ch = s[j];
      if (ch === '\\') { j++; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') { if (depth === 0) break; depth--; }
      else if (/\s/.test(ch)) break;
    }
    url = s.slice(st, j);
  }
  while (s[j] === ' ' || s[j] === '\n') j++;
  let title = '';
  if (s[j] === '"' || s[j] === "'") {
    const q = s[j];
    const e = s.indexOf(q, j + 1);
    if (e < 0) return null;
    title = s.slice(j + 1, e);
    j = e + 1;
    while (s[j] === ' ' || s[j] === '\n') j++;
  }
  if (s[j] !== ')') return null;
  return { url: url.replace(/\\(.)/g, '$1'), title, end: j + 1 };
}

const refKey = (k) => String(k).toLowerCase().trim().replace(/\s+/g, ' ');

/** Closing delimiter for emphasis: returns the index where the closing run starts, or -1. */
function findClose(s, delim, from, ch) {
  const len = delim.length;
  for (let k = from; k < s.length; k++) {
    const c = s[k];
    if (c === '\\') { k++; continue; }
    if (c === '`') {
      let e = k;
      while (s[e] === '`') e++;
      const q = findRun(s, s.slice(k, e), e);
      k = q >= 0 ? q + (e - k) - 1 : e - 1;
      continue;
    }
    if (c !== ch) continue;
    let e = k;
    while (s[e] === ch) e++;
    const r = e - k;
    const prev = s[k - 1];
    const next = s[e];
    const okRun = r === len || (ch !== '~' && len === 2 && r === 3);
    if (okRun && prev && !/\s/.test(prev) && (ch !== '_' || !next || !/[\p{L}\p{N}]/u.test(next))) return k + (r - len);
    k = e - 1;
  }
  return -1;
}

export function parseInline(src, refs = {}, breaks = true) {
  const s = src;
  const n = s.length;
  const out = [];
  let buf = '';
  let low = null;
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  const push = (node) => { flush(); out.push(node); };
  let i = 0;
  while (i < n) {
    const c = s[i];

    if (c === '\\') {
      const nx = s[i + 1];
      if (nx === '\n') { push({ t: 'br' }); i += 2; continue; }
      if (nx && ESC_RE.test(nx)) { buf += nx; i += 2; continue; }
      buf += c; i++; continue;
    }

    if (c === '\n') {
      if (breaks || / {2,}$/.test(buf)) { buf = buf.replace(/ +$/, ''); push({ t: 'br' }); } else { buf = `${buf.replace(/ +$/, '')} `; }
      i++;
      while (s[i] === ' ' || s[i] === '\t') i++;
      continue;
    }

    if (c === '`') {
      let j = i;
      while (s[j] === '`') j++;
      const run = s.slice(i, j);
      const close = findRun(s, run, j);
      if (close >= 0) {
        let code = s.slice(j, close).replace(/\n/g, ' ');
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
        push({ t: 'code', v: code });
        i = close + run.length;
        continue;
      }
      buf += run; i = j; continue;
    }

    if ((c === '!' && s[i + 1] === '[') || c === '[') {
      const isImg = c === '!';
      const lb = isImg ? i + 1 : i;
      const rb = matchBracket(s, lb);
      if (rb > 0) {
        const label = s.slice(lb + 1, rb);
        let url = null; let title = ''; let end = -1;
        if (s[rb + 1] === '(') {
          const d = parseDest(s, rb + 1);
          if (d) { url = d.url; title = d.title; end = d.end; }
        } else if (s[rb + 1] === '[') {
          const e2 = s.indexOf(']', rb + 2);
          if (e2 > 0) {
            const def = refs[refKey(s.slice(rb + 2, e2) || label)];
            if (def) { url = def.url; title = def.title; end = e2 + 1; }
          }
        } else if (!/^[ xX]?$/.test(label)) {
          const def = refs[refKey(label)];
          if (def) { url = def.url; title = def.title; end = rb + 1; }
        }
        if (url !== null) {
          if (isImg) push({ t: 'img', src: url, alt: inlineText(parseInline(label, refs, false)), title });
          else push({ t: 'a', href: url, title, k: parseInline(label, refs, breaks) });
          i = end;
          continue;
        }
      }
      buf += c; i++; continue;
    }

    if (c === '<') {
      if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i + 4); i = e < 0 ? n : e + 3; continue; }
      RE_AUTO.lastIndex = i;
      const am = RE_AUTO.exec(s);
      if (am) {
        const target = am[1];
        push({ t: 'a', href: /^https?:/i.test(target) ? target : `mailto:${target}`, title: '', k: [{ t: 'text', v: target }] });
        i = RE_AUTO.lastIndex; continue;
      }
      RE_TAG.lastIndex = i;
      const tm = RE_TAG.exec(s);
      if (tm) {
        const name = tm[2].toLowerCase();
        const end = RE_TAG.lastIndex;
        const known = name === 'br' || name === 'img' || name === 'hr' || name === 'a' || name === 'code' || INLINE_MAP[name] || SKIP_TAGS.has(name);
        if (known) {
          if (tm[1]) { i = end; continue; } // closing tags are dropped (their content was already consumed or is plain text)
          if (name === 'br') { push({ t: 'br' }); i = end; continue; }
          if (name === 'hr') { i = end; continue; }
          if (name === 'img') {
            const w = attr(tm[3], 'width'); const h = attr(tm[3], 'height');
            push({ t: 'img', src: attr(tm[3], 'src') || '', alt: attr(tm[3], 'alt') || '', title: attr(tm[3], 'title') || '', w, h });
            i = end; continue;
          }
          if (name === 'a' || name === 'code' || INLINE_MAP[name]) {
            if (!tm[4]) {
              if (low === null) low = s.toLowerCase();
              const cl = low.indexOf(`</${name}`, end);
              if (cl >= 0) {
                const inner = s.slice(end, cl);
                const closeEnd = s.indexOf('>', cl) + 1 || n;
                if (name === 'code') push({ t: 'code', v: inner });
                else if (name === 'a') push({ t: 'a', href: attr(tm[3], 'href') || '', title: attr(tm[3], 'title') || '', k: parseInline(inner, refs, breaks) });
                else push({ t: INLINE_MAP[name], k: parseInline(inner, refs, breaks) });
                i = closeEnd; continue;
              }
            }
            i = end; continue;
          }
          i = end; continue; // SKIP_TAGS: drop the tag, keep the text
        }
      }
      buf += c; i++; continue;
    }

    if (c === '*' || c === '_' || c === '~') {
      let j = i;
      while (s[j] === c) j++;
      const len = j - i;
      const L = c === '~' ? (len >= 2 ? 2 : 0) : Math.min(len, 3);
      const next = s[j];
      const prev = s[i - 1];
      let ok = L > 0 && next && !/\s/.test(next);
      if (ok && c === '_' && prev && /[\p{L}\p{N}]/u.test(prev)) ok = false;
      if (ok) {
        const delim = c.repeat(L);
        const extra = len - L;
        const close = findClose(s, delim, j, c);
        if (close > j) {
          if (extra > 0) buf += c.repeat(extra);
          const inner = parseInline(s.slice(j, close), refs, breaks);
          if (c === '~') push({ t: 's', k: inner });
          else if (L === 1) push({ t: 'i', k: inner });
          else if (L === 2) push({ t: 'b', k: inner });
          else push({ t: 'b', k: [{ t: 'i', k: inner }] });
          i = close + L;
          continue;
        }
      }
      buf += s.slice(i, j); i = j; continue;
    }

    if (c === 'h' && (i === 0 || !/[\w/]/.test(s[i - 1])) && (s.startsWith('http://', i) || s.startsWith('https://', i))) {
      RE_BARE.lastIndex = i;
      const bm = RE_BARE.exec(s);
      if (bm) { push({ t: 'a', href: bm[0], title: '', k: [{ t: 'text', v: bm[0] }] }); i = RE_BARE.lastIndex; continue; }
    }

    if (c === ':') {
      RE_EMOJI.lastIndex = i;
      const em = RE_EMOJI.exec(s);
      if (em && EMOJI[em[1]]) { buf += EMOJI[em[1]]; i = RE_EMOJI.lastIndex; continue; }
    }

    buf += c; i++;
  }
  flush();
  return out;
}

// ---- block level ------------------------------------------------------------------------------------

const reFence = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const reATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const reHR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const reQuote = /^ {0,3}>/;
const reList = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
const reSep = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const reHtmlOpen = /^\s*<(div|p|center|details|h[1-6]|section|figure|picture|a)\b([^>]*)>/i;
const reComment = /^\s*<!--/;

const listStart = (ln) => {
  const m = reList.exec(ln);
  return !!m && m[4].trim() !== '' && (!/\d/.test(m[2]) || parseInt(m[2], 10) === 1) && !reHR.test(ln);
};
const isBlockStart = (ln) => reFence.test(ln) || reATX.test(ln) || reHR.test(ln) || reQuote.test(ln) || listStart(ln) || (reHtmlOpen.test(ln) && !/^\s*<a\b/i.test(ln)) || reComment.test(ln);

function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  const cells = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '\\' && t[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const tableStart = (L, i) => !!L[i + 1] && L[i].s.includes('|') && reSep.test(L[i + 1].s) && L[i + 1].s.includes('-') && splitRow(L[i].s).length === splitRow(L[i + 1].s).length;

function matchHtmlBlock(L, i, tag) {
  const open = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const close = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 0;
  for (let j = i; j < L.length; j++) {
    depth += (L[j].s.match(open) || []).length - (L[j].s.match(close) || []).length;
    if (depth <= 0) return j;
  }
  return -1;
}

const alignOf = (tag, attrs) => {
  if (tag === 'center') return 'center';
  const a = /align\s*=\s*["']?(center|right|left)/i.exec(attrs) || /text-align\s*:\s*(center|right|left)/i.exec(attrs);
  return a ? a[1].toLowerCase() : null;
};

function parseList(L, i0, ctx) {
  let i = i0;
  const first = reList.exec(L[i].s);
  const ordered = /\d/.test(first[2]);
  const start = ordered ? parseInt(first[2], 10) : 1;
  const items = [];
  let loose = false;
  while (i < L.length) {
    const m = reList.exec(L[i].s);
    if (!m || reHR.test(L[i].s)) break;
    if (/\d/.test(m[2]) !== ordered || (!ordered && m[2] !== first[2]) || (ordered && m[2].slice(-1) !== first[2].slice(-1))) break;
    const markerLen = m[1].length + m[2].length;
    let spaces = m[3].length;
    if (m[4] === '' || spaces > 4) spaces = 1;
    const contentIndent = markerLen + spaces;
    const lines = [{ s: m[4], n: L[i].n }];
    const itemLine = L[i].n;
    i++;
    let blanks = 0;
    while (i < L.length) {
      const ln = L[i].s;
      if (ln.trim() === '') { blanks++; lines.push({ s: '', n: L[i].n }); i++; continue; }
      const ind = /^ */.exec(ln)[0].length;
      if (ind >= contentIndent) { lines.push({ s: ln.slice(contentIndent), n: L[i].n }); blanks = 0; i++; continue; }
      if (blanks === 0 && !reList.test(ln) && !isBlockStart(ln)) { lines.push({ s: ln.trimStart(), n: L[i].n }); i++; continue; }
      break;
    }
    let inner = 0;
    while (lines.length && lines[lines.length - 1].s === '') { lines.pop(); inner++; }
    let task = null;
    const tm = /^\[([ xX])\](?:[ \t]+|$)/.exec(lines[0].s);
    if (tm) { task = tm[1] !== ' '; lines[0] = { ...lines[0], s: lines[0].s.slice(tm[0].length) }; }
    items.push({ kids: parseBlocks(lines, ctx), task, line: itemLine });
    const nm = i < L.length && !reHR.test(L[i].s) ? reList.exec(L[i].s) : null;
    if (nm && /\d/.test(nm[2]) === ordered && (ordered ? nm[2].slice(-1) === first[2].slice(-1) : nm[2] === first[2])) { if (blanks > 0 || inner > 0) loose = true; continue; }
    break;
  }
  if (items.some((it) => it.kids.filter((k) => k.t === 'p').length > 1)) loose = true;
  return { node: { t: 'list', ordered, start, items: items.map(({ kids, task, line }) => ({ kids, task, line })), loose }, next: i };
}

function parseBlocks(L, ctx) {
  const out = [];
  let i = 0;
  while (i < L.length) {
    const line = L[i].s;
    if (line.trim() === '') { i++; continue; }

    if (reComment.test(line)) {
      let j = i;
      while (j < L.length && !L[j].s.includes('-->')) j++;
      const rest = j < L.length ? L[j].s.slice(L[j].s.indexOf('-->') + 3) : '';
      if (rest.trim()) { L = L.slice(); L[j] = { ...L[j], s: rest }; i = j; } else i = j + 1;
      continue;
    }

    const fm = reFence.exec(line);
    if (fm) {
      const ch = fm[1][0]; const len = fm[1].length;
      const indent = /^ */.exec(line)[0].length;
      const lang = (fm[2] || '').toLowerCase();
      const body = [];
      i++;
      const closeRe = new RegExp(`^ {0,3}\\${ch}{${len},}[ \\t]*$`);
      while (i < L.length && !closeRe.test(L[i].s)) { body.push(L[i].s.replace(new RegExp(`^ {0,${indent}}`), '')); i++; }
      i++;
      out.push({ t: 'code', lang, text: body.join('\n') });
      continue;
    }

    const am = reATX.exec(line);
    if (am) {
      const text = am[2] || '';
      const inl = parseInline(text, ctx.refs, false);
      const id = ctx.slug(inlineText(inl) || text);
      ctx.headings.push({ level: am[1].length, text: inlineText(inl), id });
      out.push({ t: 'h', level: am[1].length, inl, id, align: null });
      i++;
      continue;
    }

    if (reHR.test(line)) { out.push({ t: 'hr' }); i++; continue; }

    if (reQuote.test(line)) {
      const q = [];
      while (i < L.length) {
        const ln = L[i].s;
        if (reQuote.test(ln)) { q.push({ s: ln.replace(/^ {0,3}> ?/, ''), n: L[i].n }); i++; }
        else if (ln.trim() !== '' && q.length && q[q.length - 1].s.trim() !== '' && !isBlockStart(ln)) { q.push({ s: ln, n: L[i].n }); i++; }
        else break;
      }
      const kids = parseBlocks(q, ctx);
      let alert = null;
      const f = kids[0];
      if (f && f.t === 'p') {
        const m = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/i.exec(f.raw);
        if (m) {
          alert = m[1].toUpperCase();
          f.raw = f.raw.slice(m[0].length);
          if (f.raw.trim()) f.inl = parseInline(f.raw, ctx.refs, ctx.breaks); else kids.shift();
        }
      }
      out.push({ t: 'quote', kids, alert });
      continue;
    }

    if (listStart(line) || (reList.test(line) && !reHR.test(line))) {
      const { node, next } = parseList(L, i, ctx);
      out.push(node);
      i = next;
      continue;
    }

    const hm = reHtmlOpen.exec(line);
    if (hm) {
      const tag = hm[1].toLowerCase();
      const end = tag === 'a' ? -1 : matchHtmlBlock(L, i, tag);
      if (end >= 0) {
        const align = alignOf(tag, hm[2]);
        const inner = [];
        const openEnd = hm[0].length;
        if (end === i) {
          const closeAt = line.toLowerCase().lastIndexOf(`</${tag}`);
          inner.push({ s: line.slice(openEnd, closeAt >= openEnd ? closeAt : undefined), n: L[i].n });
        } else {
          inner.push({ s: line.slice(openEnd), n: L[i].n });
          for (let j = i + 1; j < end; j++) inner.push(L[j]);
          const lastLine = L[end].s;
          const closeAt = lastLine.toLowerCase().indexOf(`</${tag}`);
          inner.push({ s: closeAt >= 0 ? lastLine.slice(0, closeAt) : lastLine, n: L[end].n });
        }
        i = end + 1;
        if (/^h[1-6]$/.test(tag)) {
          const inl = parseInline(inner.map((x) => x.s).join(' ').trim(), ctx.refs, false);
          const id = ctx.slug(inlineText(inl));
          ctx.headings.push({ level: Number(tag[1]), text: inlineText(inl), id });
          out.push({ t: 'h', level: Number(tag[1]), inl, id, align });
        } else if (tag === 'details') {
          let joined = inner.map((x) => x.s).join('\n');
          const sm = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(joined);
          let summary = [];
          if (sm) { summary = parseInline(sm[1].trim(), ctx.refs, false); joined = joined.replace(sm[0], ''); }
          const base = inner[0].n;
          out.push({ t: 'details', summary, kids: parseBlocks(joined.split('\n').map((s, k) => ({ s, n: base + k })), ctx) });
        } else {
          out.push({ t: 'wrap', align, kids: parseBlocks(inner, ctx) });
        }
        continue;
      }
      if (tag !== 'a') { L = L.slice(); L[i] = { ...L[i], s: line.replace(reHtmlOpen, '') }; continue; }
    }

    if (tableStart(L, i)) {
      const head = splitRow(line);
      const align = splitRow(L[i + 1].s).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null));
      i += 2;
      const rows = [];
      while (i < L.length && L[i].s.trim() !== '' && L[i].s.includes('|') && !isBlockStart(L[i].s)) {
        const cells = splitRow(L[i].s);
        while (cells.length < head.length) cells.push('');
        rows.push(cells.slice(0, head.length).map((c) => parseInline(c, ctx.refs, false)));
        i++;
      }
      out.push({ t: 'table', align, head: head.map((c) => parseInline(c, ctx.refs, false)), rows });
      continue;
    }

    // paragraph (or setext heading)
    const buf = [L[i]];
    i++;
    let setext = 0;
    while (i < L.length) {
      const ln = L[i].s;
      if (ln.trim() === '') break;
      if (/^ {0,3}(=+|-+)[ \t]*$/.test(ln)) { setext = ln.trim()[0] === '=' ? 1 : 2; i++; break; }
      if (isBlockStart(ln) || tableStart(L, i)) break;
      buf.push(L[i]);
      i++;
    }
    const raw = buf.map((x) => x.s.replace(/^\s+/, '')).join('\n').replace(/\s+$/, '');
    if (setext) {
      const inl = parseInline(raw.replace(/\n/g, ' '), ctx.refs, false);
      const id = ctx.slug(inlineText(inl));
      ctx.headings.push({ level: setext, text: inlineText(inl), id });
      out.push({ t: 'h', level: setext, inl, id, align: null });
    } else {
      out.push({ t: 'p', raw, inl: parseInline(raw, ctx.refs, ctx.breaks) });
    }
  }
  return out;
}

/** @returns {{ blocks, headings, meta, words }} */
export function parseMarkdown(source, { breaks = true } = {}) {
  const src = String(source || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const refs = {};
  let fence = null;
  for (let k = 0; k < lines.length; k++) {
    const ln = lines[k];
    const f = reFence.exec(ln);
    if (fence) { if (f && f[1][0] === fence.ch && f[1].length >= fence.len && /^[ \t]*$/.test(ln.replace(reFence, ''))) fence = null; continue; }
    if (f) { fence = { ch: f[1][0], len: f[1].length }; continue; }
    if (/^\t/.test(ln)) lines[k] = ln.replace(/^\t+/, (t) => '    '.repeat(t.length));
    const d = /^ {0,3}\[([^\]]+)\]:\s*(<[^>]+>|\S+)(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*$/.exec(lines[k]);
    if (d) { refs[refKey(d[1])] = { url: d[2].replace(/^<|>$/g, ''), title: d[3] || d[4] || d[5] || '' }; lines[k] = ''; }
  }
  let start = 0;
  let meta = null;
  if (lines[0] === '---') {
    for (let k = 1; k < Math.min(lines.length, 80); k++) {
      if (/^(---|\.\.\.)\s*$/.test(lines[k])) { meta = lines.slice(1, k).join('\n'); start = k + 1; break; }
    }
  }
  const seen = new Map();
  const ctx = {
    refs, breaks, headings: [],
    slug: (text) => {
      const base = slugify(text) || 'section';
      const c = seen.get(base) || 0;
      seen.set(base, c + 1);
      return c ? `${base}-${c}` : base;
    },
  };
  const L = [];
  for (let k = start; k < lines.length; k++) L.push({ s: lines[k], n: k });
  const blocks = parseBlocks(L, ctx);
  const words = src.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(Boolean).length;
  return { blocks, headings: ctx.headings, meta, words };
}
