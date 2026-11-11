/**
 * Rich-text bridge for the slide editor.
 *   parasToHtml(text, cx)  model paragraphs  -> HTML for a contentEditable
 *   htmlToParas(root, cx)  contentEditable   -> [{ algn?, runs: [{ t, b, i, u, st, sz, color, font }] }] for pptxEdit.setParas
 * Font sizes are rendered in cqw (a share of the slide width) exactly like the viewer, so what you edit is what you see.
 * Run properties are tri-state on purpose: a property the editor never set is left out, so it keeps inheriting from the layout.
 */
export const FONT_STACK = "'Segoe UI', Tahoma, 'Noto Naskh Arabic', Arial, sans-serif";
export const cqOf = (sz, cx) => `${(((sz / 100) * 12700) / cx) * 100}cqw`; // sz = hundredths of a point
export const szOfCq = (cqw, cx) => (cqw * cx) / 12700;
const ALIGN = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' };
const ALIGN_BACK = { left: 'l', start: 'l', center: 'ctr', right: 'r', end: 'r', justify: 'just' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function runStyle(r, cx) {
  const css = [];
  if (r.b === true) css.push('font-weight:700'); else if (r.b === false) css.push('font-weight:400');
  if (r.i === true) css.push('font-style:italic'); else if (r.i === false) css.push('font-style:normal');
  const td = [r.u && 'underline', r.st && 'line-through'].filter(Boolean).join(' ');
  if (td) css.push(`text-decoration:${td}`);
  if (r.color) css.push(`color:${r.color}`);
  if (r.sz) css.push(`font-size:${cqOf(r.sz, cx)}`);
  if (r.font && !String(r.font).startsWith('+')) css.push(`font-family:'${esc(r.font)}',${FONT_STACK}`);
  return css.join(';');
}
export function parasToHtml(text, cx) {
  return text.paras.map((p) => {
    const hang = (p.mar || (p.bullet ? 342900 : 0)) / cx * 100;
    const st = [`font-size:${cqOf(p.sz, cx)}`, p.algn && `text-align:${ALIGN[p.algn] || 'left'}`, `padding-inline-start:${hang + p.lvl * 3}cqw`, `--bu-x:${p.lvl * 3 + Math.max(0, hang - 2.2)}cqw`].filter(Boolean).join(';');
    const bu = p.bullet ? ` data-bu="${p.bullet === '#' ? '•' : esc(p.bullet)}"` : '';
    const inner = p.runs.length
      ? p.runs.map((r) => (r.t === '\n' ? '<br>' : `<span style="${esc(runStyle(r, cx))}">${esc(r.t)}</span>`)).join('')
      : `<span style="${esc(runStyle(p.end || {}, cx))}"><br></span>`;
    return `<div dir="${p.rtl ? 'rtl' : 'ltr'}"${bu} style="${st}">${inner}</div>`;
  }).join('') || '<div><br></div>';
}

/* ---------- HTML -> model ---------- */
const NAMED = { white: '#ffffff', black: '#000000', red: '#ff0000', blue: '#0000ff', green: '#008000', yellow: '#ffff00' };
export function toHex(v) {
  if (!v) return null; const s = String(v).trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  let m = /^#([0-9a-f]{3})$/.exec(s); if (m) return `#${m[1].split('').map((c) => c + c).join('')}`;
  m = /^#([0-9a-f]{6})$/.exec(s); if (m) return `#${m[1]}`;
  m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s);
  return m ? `#${[m[1], m[2], m[3]].map((n) => Math.min(255, +n).toString(16).padStart(2, '0')).join('')}` : null;
}
const decls = (el) => { // read the style attribute ourselves: the CSSOM may drop units it does not know (cqw)
  const o = {}; (el.getAttribute && el.getAttribute('style') || '').split(';').forEach((d) => { const i = d.indexOf(':'); if (i > 0) o[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim(); }); return o;
};
const family = (v) => { const f = String(v).split(',')[0].trim().replace(/^['"]|['"]$/g, ''); return f && !/^(sans-serif|serif|monospace|inherit)$/i.test(f) ? f : null; };
function styleOf(el, cx) {
  const o = {}; const tag = (el.tagName || '').toLowerCase(); const d = decls(el);
  if (tag === 'b' || tag === 'strong') o.b = true;
  if (tag === 'i' || tag === 'em') o.i = true;
  if (tag === 'u') o.u = true;
  if (tag === 's' || tag === 'strike' || tag === 'del') o.st = true;
  if (tag === 'font') { if (el.getAttribute('color')) o.color = toHex(el.getAttribute('color')); if (el.getAttribute('face')) o.font = family(el.getAttribute('face')); }
  if (d['font-weight']) o.b = d['font-weight'] === 'bold' || d['font-weight'] === 'bolder' || parseInt(d['font-weight'], 10) >= 600;
  if (d['font-style']) o.i = /italic|oblique/.test(d['font-style']);
  const td = d['text-decoration-line'] ?? d['text-decoration'];
  if (td !== undefined) { o.u = /underline/.test(td); o.st = /line-through/.test(td); }
  if (d.color) o.color = toHex(d.color);
  if (d['font-size']) { const m = /^([\d.]+)cqw$/.exec(d['font-size']); if (m) o.sz = szOfCq(parseFloat(m[1]), cx); }
  if (d['font-family']) o.font = family(d['font-family']);
  return o;
}
const BLOCK = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
function collect(node, inh, runs, cx) {
  if (node.nodeType === 3) {
    const t = node.nodeValue.replace(/[\u200b\ufeff]/g, '').replace(/\u00a0/g, ' ');
    if (t) runs.push({ ...inh, t }); return;
  }
  if (node.nodeType !== 1) return;
  if (node.tagName === 'BR') { runs.push({ ...inh, t: '\n' }); return; }
  if (node.hasAttribute('data-px-ghost')) return;
  const next = { ...inh, ...styleOf(node, cx) };
  Array.from(node.childNodes).forEach((c) => (c.nodeType === 1 && BLOCK.has(c.tagName) ? runs.push({ t: '\n', ...next }, ...(() => { const sub = []; collect(c, next, sub, cx); return sub; })()) : collect(c, next, runs, cx)));
}
const sameProps = (a, b) => ['b', 'i', 'u', 'st', 'sz', 'color', 'font'].every((k) => (a[k] ?? null) === (b[k] ?? null));
function finish(runs) {
  while (runs.length && runs[runs.length - 1].t === '\n') runs.pop(); // a trailing <br> is only the browser keeping an empty line open
  const out = [];
  runs.forEach((r) => {
    const last = out[out.length - 1];
    if (last && last.t !== '\n' && r.t !== '\n' && sameProps(last, r)) last.t += r.t; else out.push({ ...r });
  });
  return out;
}
export function htmlToParas(root, cx) {
  const paras = []; let loose = null;
  Array.from(root.childNodes).forEach((n) => {
    if (n.nodeType === 1 && BLOCK.has(n.tagName)) {
      loose = null; const runs = []; Array.from(n.childNodes).forEach((c) => collect(c, {}, runs, cx));
      const a = decls(n)['text-align']; const p = { runs: finish(runs) }; if (a && ALIGN_BACK[a]) p.algn = ALIGN_BACK[a];
      paras.push(p);
    } else {
      if (!loose) { loose = { runs: [] }; paras.push(loose); }
      collect(n, {}, loose.runs, cx);
    }
  });
  paras.forEach((p) => { if (p.runs.length && p.runs[p.runs.length - 1]?.t === '\n') p.runs = finish(p.runs); else p.runs = finish(p.runs); });
  return paras;
}

/* ---------- formatting commands for a live selection ---------- */
const doc = () => (typeof document !== 'undefined' ? document : null);
export function selectAll(root) {
  const d = doc(); if (!d) return; const r = d.createRange(); r.selectNodeContents(root);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
}
export const hasRange = (root) => { const s = window.getSelection(); return !!(s && s.rangeCount && !s.isCollapsed && root.contains(s.anchorNode)); };
/** Run an execCommand-style formatting command. With only a caret (no range) it applies to the whole text, like selecting the shape. */
export function format(root, name, value) {
  const d = doc(); if (!d || !d.execCommand) return false;
  root.focus(); if (!hasRange(root)) selectAll(root);
  d.execCommand('styleWithCSS', false, true);
  d.execCommand(name, false, value);
  return true;
}
export function formatSize(root, sz, cx) {
  const d = doc(); if (!d || !d.execCommand) return false;
  root.focus(); if (!hasRange(root)) selectAll(root);
  d.execCommand('styleWithCSS', false, false); d.execCommand('fontSize', false, '7'); d.execCommand('styleWithCSS', false, true);
  root.querySelectorAll('font[size="7"]').forEach((f) => {
    const s = d.createElement('span'); s.setAttribute('style', `font-size:${cqOf(sz, cx)}`);
    while (f.firstChild) s.appendChild(f.firstChild);
    s.querySelectorAll('[style*="font-size"]').forEach((c) => { c.style.removeProperty('font-size'); });
    f.replaceWith(s);
  });
  return true;
}
export function insertPlain(text) {
  const d = doc(); if (!d || !d.execCommand) return;
  text.replace(/\r/g, '').split('\n').forEach((l, i) => { if (i) d.execCommand('insertParagraph'); if (l) d.execCommand('insertText', false, l); });
}
/** What the selection looks like, for the toolbar (needs a real browser selection). */
export function liveFormat(root, cx) {
  const d = doc(); const s = window.getSelection(); if (!d || !s || !s.rangeCount || !root.contains(s.anchorNode)) return null;
  const q = (c) => { try { return d.queryCommandState(c); } catch { return false; } };
  let el = s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode; if (!el) return null;
  const cs = window.getComputedStyle(el); const slide = root.closest('.px__slide'); const w = slide ? slide.getBoundingClientRect().width : 0;
  const px = parseFloat(cs.fontSize); const sz = w && px ? Math.round(((px * cx) / (12700 * w)) * 2) / 2 : null;
  return { b: q('bold'), i: q('italic'), u: q('underline'), st: q('strikeThrough'), sz: sz ? sz * 100 : null, color: toHex(cs.color), font: family(cs.fontFamily) };
}
