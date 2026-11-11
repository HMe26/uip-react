/** Pure helpers for the Word editor (DocxView / DocxRibbon): no React in here. */

export const FONTS = ['Calibri', 'Arial', 'Cambria', 'Times New Roman', 'Georgia', 'Verdana', 'Tahoma', 'Segoe UI', 'Trebuchet MS', 'Courier New', 'Consolas', 'Comic Sans MS', 'Impact', 'Cairo', 'Noto Naskh Arabic', 'Traditional Arabic', 'Simplified Arabic', 'Sakkal Majalla'];
export const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
export const PAGE_SIZES = [['A4', 11906, 16838], ['A3', 16838, 23811], ['A5', 8391, 11906], ['Letter', 12240, 15840], ['Legal', 12240, 20160]];
export const MARGIN_PRESETS = [
  ['normal', { top: 1440, right: 1440, bottom: 1440, left: 1440 }],
  ['narrow', { top: 720, right: 720, bottom: 720, left: 720 }],
  ['moderate', { top: 1440, right: 1080, bottom: 1440, left: 1080 }],
  ['wide', { top: 1440, right: 2880, bottom: 1440, left: 2880 }],
];
export const SYMBOLS = ['©', '®', '™', '§', '°', '±', '×', '÷', '—', '–', '•', '…', '€', '£', '¥', '≤', '≥', '≠', '≈', '←', '→', '↑', '↓', '✓', '✗', '★', '½', '¼', '¾', 'α', 'β', 'π', 'Ω', '∑', '√', '∞'];
export const STYLES = [
  ['p', 'Normal', 'عادي'], ['title', 'Title', 'عنوان رئيسي'], ['subtitle', 'Subtitle', 'عنوان فرعي'],
  ['h1', 'Heading 1', 'عنوان 1'], ['h2', 'Heading 2', 'عنوان 2'], ['h3', 'Heading 3', 'عنوان 3'], ['h4', 'Heading 4', 'عنوان 4'], ['quote', 'Quote', 'اقتباس'],
];

export const twToPx = (t) => t / 15; // 1440 twips = 1 in = 96 px
export const twToCm = (t) => Math.round((t / 567) * 100) / 100;
export const cmToTw = (c) => Math.round(c * 567);

export const rgbToHex = (c) => {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/.exec(c || ''); if (!m) return /^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : null;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
};

/* ------------------------------------------------------------------ blocks in the selection */
const LEAF = 'p,h1,h2,h3,h4,h5,h6';
function ownTextIntersects(li, range) { // a list item that also holds a nested list: only its own text counts
  const nested = li.querySelector(':scope > ul, :scope > ol'); if (!nested) return range.intersectsNode(li);
  const own = document.createRange(); own.setStartBefore(li.firstChild || li); own.setEndBefore(nested);
  return range.compareBoundaryPoints(Range.END_TO_START, own) <= 0 && range.compareBoundaryPoints(Range.START_TO_END, own) >= 0;
}
export function blocksOfSelection(root) {
  const sel = window.getSelection(); if (!sel || !sel.rangeCount) return [];
  const r = sel.getRangeAt(0); if (!root.contains(r.commonAncestorContainer)) return [];
  const all = Array.from(root.querySelectorAll(`${LEAF},li`)).filter((el) => (el.tagName === 'LI' ? true : !el.querySelector(LEAF)));
  const hit = all.filter((el) => (el.tagName === 'LI' ? ownTextIntersects(el, r) : r.intersectsNode(el)));
  if (hit.length) return hit;
  const n = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
  const b = n && n.closest(`${LEAF},li`); return b && root.contains(b) ? [b] : [];
}
export const closestIn = (root, node, sel) => { const el = node && (node.nodeType === 1 ? node : node.parentElement); const f = el?.closest?.(sel); return f && root.contains(f) ? f : null; };

/* ------------------------------------------------------------------ selection <-> text offsets (history, find) */
const offsetOf = (root, node, off) => { const r = document.createRange(); r.selectNodeContents(root); r.setEnd(node, off); return r.toString().length; };
const pointAt = (root, n) => {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let acc = 0; let t = w.nextNode();
  while (t) { const len = t.data.length; if (acc + len >= n) return [t, n - acc]; acc += len; t = w.nextNode(); }
  return [root, root.childNodes.length];
};
export function saveSel(roots) {
  const sel = window.getSelection(); if (!sel || !sel.rangeCount) return null; const r = sel.getRangeAt(0);
  const key = Object.keys(roots).find((k) => roots[k] && roots[k].contains(r.startContainer) && roots[k].contains(r.endContainer));
  return key ? { key, s: offsetOf(roots[key], r.startContainer, r.startOffset), e: offsetOf(roots[key], r.endContainer, r.endOffset) } : null;
}
export function restoreSel(roots, st) {
  const root = st && roots[st.key]; if (!root) return;
  try {
    const [a, ao] = pointAt(root, st.s); const [b, bo] = pointAt(root, st.e);
    const r = document.createRange(); r.setStart(a, ao); r.setEnd(b, bo);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  } catch { /* the caret simply stays where it is */ }
}

/* ------------------------------------------------------------------ history: snapshots of body / header / footer / page setup */
const IMG_RE = /src="(data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+)"/g;
export function makeHistory({ read, apply, onChange }) {
  // pictures are kept out of the snapshots (token <-> data URL) so 100 undo steps do not hold 100 copies of them
  const imgs = new Map(); const tok = new Map();
  const pack = (h) => h.replace(IMG_RE, (_, u) => { let id = tok.get(u); if (id === undefined) { id = imgs.size; imgs.set(id, u); tok.set(u, id); } return `src="@img:${id}"`; });
  const unpack = (h) => h.replace(/src="@img:(\d+)"/g, (_, id) => `src="${imgs.get(Number(id))}"`);
  let stack = []; let idx = -1; let timer = 0;
  const same = (a, b) => a.body === b.body && a.hdr === b.hdr && a.ftr === b.ftr && a.pg === b.pg;
  const snap = () => { const s = read(); return { body: pack(s.body), hdr: pack(s.hdr), ftr: pack(s.ftr), pg: s.pg, sel: s.sel }; };
  const push = () => {
    clearTimeout(timer); timer = 0;
    const s = snap();
    if (idx >= 0 && same(stack[idx], s)) { stack[idx].sel = s.sel; return false; }
    stack = stack.slice(0, idx + 1); stack.push(s); if (stack.length > 120) stack.shift();
    idx = stack.length - 1; onChange(); return true;
  };
  const go = (to) => {
    if (timer) push();
    if (to < 0 || to >= stack.length) return;
    idx = to; const s = stack[idx];
    apply({ body: unpack(s.body), hdr: unpack(s.hdr), ftr: unpack(s.ftr), pg: s.pg, sel: s.sel }); onChange();
  };
  return {
    init() { stack = [snap()]; idx = 0; clearTimeout(timer); timer = 0; },
    commit: push,
    typing() { clearTimeout(timer); timer = setTimeout(push, 500); },
    undo() { if (timer) { push(); } go(idx - 1); },
    redo() { go(idx + 1); },
    get idx() { return idx; },
    get canUndo() { return idx > 0 || !!timer; },
    get canRedo() { return idx < stack.length - 1; },
    stop() { clearTimeout(timer); },
  };
}

/* ------------------------------------------------------------------ find & replace */
const BLOCK_SEL = 'p,h1,h2,h3,h4,h5,h6,li,td,th,div,blockquote';
export function findMatches(root, query, matchCase) {
  if (!query) return [];
  const segs = []; let cur = null; let last = null;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let t = w.nextNode();
  while (t) {
    const b = t.parentElement?.closest(BLOCK_SEL) || root;
    if (b !== last) { cur = { nodes: [], text: '' }; segs.push(cur); last = b; }
    cur.nodes.push({ t, start: cur.text.length }); cur.text += t.data; t = w.nextNode();
  }
  const q = matchCase ? query : query.toLowerCase(); const out = [];
  segs.forEach((seg) => {
    const hay = matchCase ? seg.text : seg.text.toLowerCase(); let i = hay.indexOf(q);
    while (i >= 0) { out.push({ seg, s: i, e: i + q.length }); i = hay.indexOf(q, i + Math.max(1, q.length)); }
  });
  return out;
}
export function rangeOfMatch(m) {
  const at = (n) => { const hit = m.seg.nodes.find((x, k) => n <= x.start + x.t.data.length && (n > x.start || k === 0 || n === x.start)); const x = hit || m.seg.nodes[m.seg.nodes.length - 1]; return [x.t, Math.max(0, Math.min(x.t.data.length, n - x.start))]; };
  const r = document.createRange(); const [a, ao] = at(m.s); const [b, bo] = at(m.e); r.setStart(a, ao); r.setEnd(b, bo); return r;
}
export function selectRange(r) {
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  const el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement; el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}

/* ------------------------------------------------------------------ tables */
const emptyCell = (like) => {
  const td = document.createElement(like?.tagName === 'TH' ? 'th' : 'td'); const p = document.createElement('p');
  const dir = like?.querySelector('p,h1,h2,h3,li')?.getAttribute('dir') || like?.closest('[dir]')?.getAttribute('dir'); if (dir === 'rtl' || dir === 'ltr') p.setAttribute('dir', dir);
  p.appendChild(document.createElement('br')); td.appendChild(p);
  if (like?.style?.width) td.style.width = like.style.width;
  return td;
};
export const cellOf = (root) => { const sel = window.getSelection(); const n = sel?.anchorNode; const el = n && (n.nodeType === 1 ? n : n.parentElement); const c = el?.closest?.('td,th'); return c && root.contains(c) ? c : null; };
export const T = {
  addRow(td, after) { const tr = td.parentElement; const n = document.createElement('tr'); Array.from(tr.children).forEach((c) => { const x = emptyCell(c); const cs = c.getAttribute('colspan'); if (cs) x.setAttribute('colspan', cs); n.appendChild(x); }); if (after) tr.after(n); else tr.before(n); },
  addCol(td, after) { const i = Array.from(td.parentElement.children).indexOf(td); td.closest('table').querySelectorAll('tr').forEach((tr) => { const c = tr.children[i]; const x = emptyCell(c || td); if (c) { if (after) c.after(x); else c.before(x); } else tr.appendChild(x); }); },
  delRow(td) { const t = td.closest('table'); td.parentElement.remove(); if (!t.querySelector('tr')) t.remove(); },
  delCol(td) { const i = Array.from(td.parentElement.children).indexOf(td); const t = td.closest('table'); t.querySelectorAll('tr').forEach((tr) => tr.children[i]?.remove()); if (!t.querySelector('td,th')) t.remove(); },
  delTable(td) { td.closest('table').remove(); },
  mergeRight(td) {
    const nx = td.nextElementSibling; if (!nx || !/^T[DH]$/.test(nx.tagName)) return false;
    td.setAttribute('colspan', String((parseInt(td.getAttribute('colspan'), 10) || 1) + (parseInt(nx.getAttribute('colspan'), 10) || 1)));
    if (nx.textContent.trim() || nx.querySelector('img')) { if (!td.textContent.trim() && !td.querySelector('img')) td.innerHTML = ''; Array.from(nx.childNodes).forEach((c) => td.appendChild(c)); }
    nx.remove(); return true;
  },
  split(td) {
    const cs = parseInt(td.getAttribute('colspan'), 10) || 1; if (cs < 2) return false;
    td.removeAttribute('colspan'); let at = td; for (let i = 1; i < cs; i += 1) { const x = emptyCell(td); at.after(x); at = x; } return true;
  },
};
export const tableHtml = (rows, cols, rtl) => `<table><tbody>${Array.from({ length: rows }, () => `<tr>${Array.from({ length: cols }, () => `<td style="width:${Math.round((1000 / cols)) / 10}%"><p${rtl ? ' dir="rtl"' : ''}><br></p></td>`).join('')}</tr>`).join('')}</tbody></table><p${rtl ? ' dir="rtl"' : ''}><br></p>`;

/* ------------------------------------------------------------------ pictures */
const readUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('read')); r.readAsDataURL(file); });
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image')); i.src = src; });
/** -> { src, w, h } with the picture downscaled to at most `maxDim` px and shown at a sensible width. */
export async function fitImage(file, maxDim = 1600) {
  if (!/^image\/(png|jpe?g|gif|webp|bmp)$/i.test(file.type)) throw new Error('type');
  if (file.size > 20 * 1048576) throw new Error('size');
  const url = await readUrl(file); const img = await loadImg(url);
  const sc = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  let src = url;
  if (file.type !== 'image/gif' && (sc < 1 || file.size > 1.5 * 1048576)) {
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * sc)); c.height = Math.max(1, Math.round(img.naturalHeight * sc));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    src = c.toDataURL(/png|webp|bmp/i.test(file.type) ? 'image/png' : 'image/jpeg', 0.9);
  }
  const w = Math.min(img.naturalWidth, 480); return { src, w, h: Math.round((w * img.naturalHeight) / img.naturalWidth) };
}

/* ------------------------------------------------------------------ misc */
export const countWords = (text) => { const t = (text || '').replace(/\u00a0/g, ' ').trim(); return t ? t.split(/\s+/).length : 0; };

export function normalizeUrl(u) {
  const v = String(u || '').trim(); if (!v) return '';
  if (/^(https?:|mailto:|tel:)/i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return ''; // javascript:, data: ...
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  return `https://${v}`;
}

/** Print the document through a hidden frame: page size / margins from the setup, header and footer on every page. */
export function printDocument({ body, header, footer, page, look, rtl }) {
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0;visibility:hidden';
  document.body.appendChild(f);
  const d = f.contentDocument; const mm = (t) => `${Math.round((t / 56.7) * 10) / 10}mm`;
  const landscape = page.w > page.h; const pw = Math.min(page.w, page.h); const ph = Math.max(page.w, page.h);
  const field = /data-fld="PAGE"/.test(footer) ? 'footer' : /data-fld="PAGE"/.test(header) ? 'header' : null;
  const clean = (h) => h.replace(/<span data-fld="[A-Z]+">[^<]*<\/span>/g, '');
  d.open();
  d.write(`<!doctype html><html dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title></title><style>
@page{size:${mm(pw)} ${mm(ph)} ${landscape ? 'landscape' : 'portrait'};margin:${mm(page.top)} ${mm(page.right)} ${mm(page.bottom)} ${mm(page.left)};${field ? `@${field === 'footer' ? 'bottom' : 'top'}-center{content:counter(page)}` : ''}}
html,body{margin:0;padding:0}body{font:${look.size}pt '${look.font}',Calibri,Arial,'Noto Naskh Arabic',sans-serif;color:#000;white-space:pre-wrap;overflow-wrap:anywhere}
p{margin:${look.before}pt 0 ${look.after}pt;line-height:${look.line}}h1{font-size:16pt;color:#2f5496;margin:12pt 0 4pt}h2{font-size:13pt;color:#2f5496;margin:10pt 0 4pt}h3{font-size:12pt;color:#1f3763;margin:8pt 0 3pt}h4,h5,h6{font-size:11pt;color:#2f5496;margin:6pt 0 2pt}
[data-st=title]{font-size:28pt;color:#17365d}[data-st=subtitle]{font-size:14pt;font-style:italic;color:#595959}[data-st=quote]{font-style:italic;color:#404040;margin-inline:36pt}
ul,ol{margin:0 0 ${look.after}pt;padding-inline-start:36pt}li{margin:0}table{border-collapse:collapse;width:100%}td,th{border:1px solid #808080;padding:3pt 5pt;vertical-align:top}table[data-b=none] td{border-color:transparent}
img{max-width:100%;height:auto}hr[data-pb]{border:0;margin:0;break-after:page;height:0}a{color:#1d4ed8}
.h,.f{position:fixed;left:0;right:0;font-size:9pt}.h{top:-${mm(page.top - page.header)}}.f{bottom:-${mm(page.bottom - page.footer)}}
</style></head><body>${header && !field ? `<div class="h">${clean(header)}</div>` : ''}${body}${footer && !field ? `<div class="f">${clean(footer)}</div>` : ''}</body></html>`);
  d.close();
  const done = () => setTimeout(() => f.remove(), 1500);
  const go = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } finally { done(); } };
  setTimeout(go, 250);
}
