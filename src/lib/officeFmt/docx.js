/**
 * Word (.docx) <-> editable HTML.
 *   readDocx(arrayBuffer)  -> { html, header, footer, page, defaults, warnings }   (own OOXML reader, docxRead.js)
 *   docxToHtml(arrayBuffer)-> sanitized HTML of the body only (preview)             (falls back to mammoth)
 *   htmlToDocx(root, ctx)  -> Blob   ctx = { header, footer, page, defaults }       (docx library)
 *   sanitizeHtml(html)     -> safe HTML string
 * The writer rebuilds the package from the editor DOM: fonts, sizes, colours, highlight, spacing, indents, direction,
 * lists (type / start / levels), tables (spans, shading, borders, widths), pictures, header / footer with page-number
 * fields, page size / orientation / margins and page breaks are all written back.
 */
import { readDocxRaw } from './docxRead';

const ALLOWED = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR', 'HR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE', 'SPAN', 'A', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'IMG', 'DIV', 'SUB', 'SUP', 'BLOCKQUOTE', 'MARK']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'HEAD', 'TITLE']);
const SAFE_URL = /^(https?:|mailto:|tel:|#)/i;
const SAFE_IMG = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i;
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]{3,20})$/i;
const LEN = /^-?[\d.]+(pt|px)$/;
const ST_OK = new Set(['title', 'subtitle', 'quote']);

function cleanStyle(st) {
  const out = [];
  String(st || '').split(';').forEach((d) => {
    const i = d.indexOf(':'); if (i < 0) return;
    const k = d.slice(0, i).trim().toLowerCase(); const v = d.slice(i + 1).trim();
    if (k === 'text-align' && /^(left|right|center|justify|start|end)$/.test(v)) out.push(`text-align:${v}`);
    else if (k === 'direction' && /^(rtl|ltr)$/.test(v)) out.push(`direction:${v}`);
    else if ((k === 'color' || k === 'background-color') && COLOR.test(v)) out.push(`${k}:${v}`);
    else if (k === 'font-size' && /^[\d.]+(pt|px)$/.test(v)) out.push(`font-size:${v}`);
    else if (k === 'font-family' && /^[\w\s,'"-]{1,80}$/.test(v)) out.push(`font-family:${v}`);
    else if (k === 'font-weight' && /^(bold|[5-9]00)$/.test(v)) out.push('font-weight:bold');
    else if (k === 'font-style' && v === 'italic') out.push('font-style:italic');
    else if (k === 'text-decoration' && /^(underline|line-through)( (underline|line-through))?$/.test(v)) out.push(`text-decoration:${v}`);
    else if (/^(margin-top|margin-bottom|margin-left|margin-right|margin-inline-start|margin-inline-end|text-indent)$/.test(k) && LEN.test(v)) out.push(`${k}:${v}`);
    else if (k === 'line-height' && /^([\d.]+|[\d.]+pt)$/.test(v)) out.push(`line-height:${v}`);
    else if (k === 'vertical-align' && /^(middle|bottom|top)$/.test(v)) out.push(`vertical-align:${v}`);
    else if (k === 'width' && /^[\d.]+(%|pt|px)$/.test(v)) out.push(`width:${v}`);
    else if (/^border-(top|bottom|left|right)$/.test(k) && /^[\d.]+(pt|px) (solid|double|dotted|dashed) (#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]{3,20})$/i.test(v)) out.push(`${k}:${v}`);
  });
  return out.join(';');
}

function cleanNode(node, doc) {
  if (node.nodeType === 3) return doc.createTextNode(node.nodeValue);
  if (node.nodeType !== 1) return null;
  const tag = node.tagName.toUpperCase();
  if (DROP.has(tag)) return null;
  if (!ALLOWED.has(tag)) { const f = doc.createDocumentFragment(); node.childNodes.forEach((c) => { const n = cleanNode(c, doc); if (n) f.appendChild(n); }); return f; }
  const el = doc.createElement(tag.toLowerCase());
  const st = cleanStyle(node.getAttribute('style')); if (st) el.setAttribute('style', st);
  const dir = node.getAttribute('dir'); if (dir === 'rtl' || dir === 'ltr') el.setAttribute('dir', dir);
  const ds = node.getAttribute('data-st'); if (ST_OK.has(ds)) el.setAttribute('data-st', ds);
  if (tag === 'HR') { if (node.hasAttribute('data-pb')) el.setAttribute('data-pb', '1'); else return null; return el; }
  if (tag === 'SPAN' && /^(PAGE|NUMPAGES)$/.test(node.getAttribute('data-fld') || '')) { el.setAttribute('data-fld', node.getAttribute('data-fld')); el.setAttribute('contenteditable', 'false'); el.textContent = '1'; return el; }
  if (tag === 'DIV') { // letterhead text placed on the page (w:framePr): "x,y,width" in px from the header's top-left
    const m = /^(-?\d{1,5}),(-?\d{1,5}),(\d{1,5})$/.exec(node.getAttribute('data-frame') || '');
    if (m) { el.setAttribute('data-frame', node.getAttribute('data-frame')); el.setAttribute('style', `position:absolute;left:${m[1]}px;top:${m[2]}px;width:${m[3]}px`); }
  }
  if (tag === 'TABLE' && node.getAttribute('data-b') === 'none') el.setAttribute('data-b', 'none');
  if (tag === 'OL') { const t = node.getAttribute('type'); if (/^[aAiI1]$/.test(t || '')) el.setAttribute('type', t); const s = parseInt(node.getAttribute('start'), 10); if (s > 1 && s < 10000) el.setAttribute('start', String(s)); }
  if (tag === 'A') { const h = (node.getAttribute('href') || '').trim(); if (SAFE_URL.test(h)) { el.setAttribute('href', h); el.setAttribute('rel', 'noopener noreferrer'); el.setAttribute('target', '_blank'); } }
  if (tag === 'IMG') {
    const s = (node.getAttribute('src') || '').trim(); if (!SAFE_IMG.test(s)) return null; el.setAttribute('src', s);
    ['width', 'height'].forEach((a) => { const w = parseInt(node.getAttribute(a), 10); if (w > 0 && w < 10000) el.setAttribute(a, String(w)); });
    const fl = node.getAttribute('data-fl'); if (fl === 'left' || fl === 'right') el.setAttribute('data-fl', fl);
  }
  if (tag === 'TD' || tag === 'TH') ['colspan', 'rowspan'].forEach((a) => { const v = parseInt(node.getAttribute(a), 10); if (v > 1 && v < 50) el.setAttribute(a, String(v)); });
  node.childNodes.forEach((c) => { const n = cleanNode(c, doc); if (n) el.appendChild(n); });
  return el;
}

export function sanitizeHtml(html) {
  const src = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const doc = document.implementation.createHTMLDocument('');
  const box = doc.createElement('div');
  src.body.childNodes.forEach((c) => { const n = cleanNode(c, doc); if (n) box.appendChild(n); });
  return box.innerHTML;
}

/* ---------------------------------------------------------------- docx -> HTML */
export function readDocx(arrayBuffer) {
  const r = readDocxRaw(arrayBuffer);
  return { ...r, html: sanitizeHtml(r.html || '') || '<p><br></p>', header: sanitizeHtml(r.header || ''), footer: sanitizeHtml(r.footer || '') };
}

export async function docxToHtml(arrayBuffer) {
  try { return readDocx(arrayBuffer).html; } catch (e) {
    const m = await import('mammoth/mammoth.browser.js'); const mammoth = m.default || m;
    const out = await mammoth.convertToHtml({ arrayBuffer }, {
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"],
      convertImage: mammoth.images.imgElement((img) => img.read('base64').then((b) => ({ src: `data:${img.contentType};base64,${b}` }))),
    }).catch(() => { throw e; });
    return sanitizeHtml(out.value || '<p></p>');
  }
}

/* ---------------------------------------------------------------- HTML -> docx */
const RTL_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const hex = (c) => {
  if (!c) return undefined;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (m) return (m[1].length === 3 ? m[1].replace(/./g, (x) => x + x) : m[1]).toUpperCase();
  const r = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/.exec(c);
  if (r && !(r[4] !== undefined && parseFloat(r[4]) === 0)) return [r[1], r[2], r[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  return undefined;
};
const b64bytes = (src) => { const bin = atob(src.slice(src.indexOf(',') + 1).replace(/\s/g, '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i += 1) u[i] = bin.charCodeAt(i); return u; };
const imgType = (src) => (/image\/(png|jpe?g|gif|bmp)/i.exec(src)?.[1] || 'png').toLowerCase().replace('jpeg', 'jpg');
function imgSize(u8) { // natural size from the file header (no DOM needed)
  try {
    if (u8[0] === 0x89 && u8[1] === 0x50) return [(u8[16] << 24) | (u8[17] << 16) | (u8[18] << 8) | u8[19], (u8[20] << 24) | (u8[21] << 16) | (u8[22] << 8) | u8[23]];
    if (u8[0] === 0x47 && u8[1] === 0x49) return [u8[6] | (u8[7] << 8), u8[8] | (u8[9] << 8)];
    if (u8[0] === 0x42 && u8[1] === 0x4d) return [u8[18] | (u8[19] << 8) | (u8[20] << 16), Math.abs(u8[22] | (u8[23] << 8) | (u8[24] << 16))];
    if (u8[0] === 0xff && u8[1] === 0xd8) {
      let i = 2;
      while (i < u8.length) { if (u8[i] !== 0xff) { i += 1; continue; } const m = u8[i + 1]; if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [(u8[i + 7] << 8) | u8[i + 8], (u8[i + 5] << 8) | u8[i + 6]]; i += 2 + ((u8[i + 2] << 8) | u8[i + 3]); }
    }
  } catch { /* unknown size */ }
  return null;
}
const lenPt = (v) => { const m = /^(-?[\d.]+)(pt|px)$/.exec(v || ''); return m ? (m[2] === 'px' ? Number(m[1]) * 0.75 : Number(m[1])) : undefined; };
const tw = (pt) => Math.round(pt * 20);
const fontName = (f) => String(f || '').split(',')[0].replace(/['"]/g, '').trim();

const HEADING_STYLES = {
  1: { size: 32, color: '2F5496', before: 240, after: 80 }, 2: { size: 26, color: '2F5496', before: 200, after: 80 }, 3: { size: 24, color: '1F3763', before: 160, after: 60 },
  4: { size: 22, color: '2F5496', before: 120, after: 40 }, 5: { size: 22, color: '2F5496', before: 120, after: 40 }, 6: { size: 22, color: '2F5496', before: 120, after: 40 },
};

export async function htmlToDocx(root, ctx = {}) {
  const D = await import('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, ImageRun, ExternalHyperlink, LevelFormat, BorderStyle, PageNumber, PageBreak, Header, Footer, ShadingType, VerticalAlign, TableLayoutType, LineRuleType, PageOrientation } = D;
  const def = { font: 'Calibri', size: 11, before: 0, after: 10, line: 1.15, rtl: false, ...(ctx.defaults || {}) };
  const pg = { w: 11906, h: 16838, top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708, ...(ctx.page || {}) };
  const textW = Math.max(1440, pg.w - pg.left - pg.right);
  const ALIGN = { left: AlignmentType.LEFT, right: AlignmentType.RIGHT, center: AlignmentType.CENTER, justify: AlignmentType.JUSTIFIED };
  const HEAD = { H1: HeadingLevel.HEADING_1, H2: HeadingLevel.HEADING_2, H3: HeadingLevel.HEADING_3, H4: HeadingLevel.HEADING_4, H5: HeadingLevel.HEADING_5, H6: HeadingLevel.HEADING_6 };
  const FMT = { a: LevelFormat.LOWER_LETTER, A: LevelFormat.UPPER_LETTER, i: LevelFormat.LOWER_ROMAN, I: LevelFormat.UPPER_ROMAN };
  const BULLETS = ['•', '◦', '▪'];
  const numbering = []; let listN = 0;

  const dirOf = (el) => {
    const d = el.closest?.('[dir]')?.getAttribute('dir'); if (d) return d === 'rtl';
    const s = el.closest?.('[style*="direction"]'); if (s && /direction:\s*rtl/i.test(s.getAttribute('style'))) return true;
    return def.rtl || RTL_RE.test(el.textContent || '');
  };
  const newList = (ordered, type, start) => {
    const reference = `list-${listN += 1}`;
    numbering.push({
      reference,
      levels: Array.from({ length: 9 }, (_, level) => ({
        level, format: ordered ? (level === 0 ? FMT[type] || LevelFormat.DECIMAL : [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3]) : LevelFormat.BULLET,
        text: ordered ? `%${level + 1}.` : BULLETS[level % 3], alignment: AlignmentType.START, start: level === 0 && ordered ? start : 1,
        style: { paragraph: { indent: { start: 720 * (level + 1), hanging: 360 } } },
      })),
    });
    return reference;
  };

  /* ---------- inline ---------- */
  const styleFmt = (n, f) => {
    const st = n.style; if (!st) return f;
    if (st.color) f.color = hex(st.color) || f.color;
    if (st.backgroundColor) { const h = hex(st.backgroundColor); if (h) f.shading = { type: ShadingType.CLEAR, fill: h, color: 'auto' }; }
    if (st.fontFamily) f.font = fontName(st.fontFamily);
    if (st.fontWeight === 'bold' || Number(st.fontWeight) >= 600) f.bold = true;
    if (st.fontStyle === 'italic') f.italics = true;
    if (/underline/.test(st.textDecoration || '')) f.underline = {};
    if (/line-through/.test(st.textDecoration || '')) f.strike = true;
    const fs = lenPt(st.fontSize); if (fs) f.size = Math.round(fs * 2);
    return f;
  };
  const textRuns = (text, f, rtl, forced) => {
    const out = [];
    text.replace(/\u00a0/g, ' ').split(/(\t|\n)/).forEach((s) => {
      if (s === '\t') out.push(new TextRun({ ...f, children: [new D.Tab()] }));
      else if (s === '\n') out.push(new TextRun({ break: 1 }));
      else if (s) out.push(new TextRun({ text: s, ...f, rightToLeft: (forced ? rtl : rtl && RTL_RE.test(s)) || undefined, boldComplexScript: f.bold, italicsComplexScript: f.italics, sizeComplexScript: f.size }));
    });
    return out;
  };
  function image(n) {
    const src = n.getAttribute('src') || ''; if (!/^data:image\//.test(src)) return null;
    try {
      const data = b64bytes(src); const nat = imgSize(data) || [400, 300];
      const aw = parseFloat(n.style?.width) || parseInt(n.getAttribute('width'), 10); const ah = parseFloat(n.style?.height) || parseInt(n.getAttribute('height'), 10);
      let w = aw || nat[0]; let h = ah || (aw ? Math.round((aw * nat[1]) / nat[0]) : nat[1]);
      const max = Math.round(textW / 15); if (w > max) { h = Math.round((h * max) / w); w = max; }
      const fl = n.getAttribute('data-fl');
      const floating = fl ? { horizontalPosition: { relative: D.HorizontalPositionRelativeFrom.MARGIN, align: fl === 'right' ? D.HorizontalPositionAlign.RIGHT : D.HorizontalPositionAlign.LEFT }, verticalPosition: { relative: D.VerticalPositionRelativeFrom.PARAGRAPH, offset: 0 }, wrap: { type: D.TextWrappingType.SQUARE, side: D.TextWrappingSide.BOTH_SIDES }, margins: { left: 114300, right: 114300 }, allowOverlap: true } : undefined;
      return new ImageRun({ type: imgType(src), data, transformation: { width: Math.max(1, w), height: Math.max(1, h) }, floating });
    } catch { return null; }
  }
  function runs(node, fmt, rtl, forced) {
    const out = [];
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) { if (n.nodeValue) out.push(...textRuns(n.nodeValue, fmt, rtl, forced)); return; }
      if (n.nodeType !== 1) return;
      const t = n.tagName; const f = { ...fmt };
      if (t === 'BR') { out.push(new TextRun({ break: 1 })); return; }
      if (t === 'HR' && n.hasAttribute('data-pb')) { out.push(new TextRun({ children: [new PageBreak()] })); return; }
      if (t === 'SPAN' && n.getAttribute('data-fld')) { out.push(new TextRun({ ...f, children: [n.getAttribute('data-fld') === 'NUMPAGES' ? PageNumber.TOTAL_PAGES : PageNumber.CURRENT] })); return; }
      if (t === 'STRONG' || t === 'B') f.bold = true;
      if (t === 'EM' || t === 'I') f.italics = true;
      if (t === 'U') f.underline = {};
      if (t === 'S' || t === 'STRIKE') f.strike = true;
      if (t === 'SUB') f.subScript = true;
      if (t === 'SUP') f.superScript = true;
      if (t === 'MARK') f.shading = { type: ShadingType.CLEAR, fill: 'FFFF00', color: 'auto' };
      styleFmt(n, f);
      if (t === 'IMG') { const im = image(n); if (im) out.push(im); return; }
      if (t === 'A' && /^(https?:|mailto:|tel:)/i.test(n.getAttribute('href') || '')) {
        out.push(new ExternalHyperlink({ link: n.getAttribute('href'), children: runs(n, { ...f, color: f.color || '0563C1', underline: f.underline || {} }, rtl, forced) })); return;
      }
      if (t === 'SPAN' && n.hasAttribute('dir')) { out.push(...runs(n, f, n.getAttribute('dir') === 'rtl', true)); return; }
      out.push(...runs(n, f, rtl, forced));
    });
    return out;
  }

  /* ---------- paragraphs ---------- */
  const alignOf = (el, rtl) => { // CSS alignment is visual and so are AlignmentType.LEFT / RIGHT (docx swaps them itself in a bidi paragraph)
    const a = /text-align:\s*(\w+)/i.exec(el.getAttribute('style') || '')?.[1]?.toLowerCase(); if (!a) return undefined;
    if (a === 'start') return rtl ? AlignmentType.RIGHT : AlignmentType.LEFT;
    if (a === 'end') return rtl ? AlignmentType.LEFT : AlignmentType.RIGHT;
    return ALIGN[a];
  };
  const paraProps = (el, rtl, inList) => {
    const s = el.style || {}; const p = {};
    const sp = {}; const b = lenPt(s.marginTop); const a = lenPt(s.marginBottom);
    if (b !== undefined) sp.before = tw(b);
    if (a !== undefined) sp.after = tw(a);
    if (s.lineHeight) { const lh = s.lineHeight; if (/pt$/.test(lh)) { sp.line = tw(parseFloat(lh)); sp.lineRule = LineRuleType.EXACT; } else if (parseFloat(lh) > 0) { sp.line = Math.round(parseFloat(lh) * 240); sp.lineRule = LineRuleType.AUTO; } }
    if (Object.keys(sp).length) p.spacing = sp;
    const ind = {};
    const is = lenPt(s.marginInlineStart || (rtl ? s.marginRight : s.marginLeft)); const ie = lenPt(s.marginInlineEnd || (rtl ? s.marginLeft : s.marginRight)); const ti = lenPt(s.textIndent);
    if (!inList) { if (is) ind.start = tw(is); if (ie) ind.end = tw(ie); }
    if (ti) { if (ti > 0) ind.firstLine = tw(ti); else ind.hanging = tw(-ti); }
    if (Object.keys(ind).length) p.indent = ind;
    const bd = {};
    ['top', 'bottom', 'left', 'right'].forEach((k) => {
      const m = /^([\d.]+)(pt|px)\s+(solid|double|dotted|dashed)\s+(.+)$/.exec(el.style?.getPropertyValue(`border-${k}`) || ''); if (!m) return;
      const wpt = m[2] === 'px' ? Number(m[1]) * 0.75 : Number(m[1]);
      bd[k] = { style: { solid: BorderStyle.SINGLE, double: BorderStyle.DOUBLE, dotted: BorderStyle.DOTTED, dashed: BorderStyle.DASHED }[m[3]], size: Math.max(2, Math.min(96, Math.round(wpt * 8))), color: hex(m[4]) || '000000', space: 1 };
    });
    if (Object.keys(bd).length) p.border = bd;
    return p;
  };
  function para(el, extra = {}, inList = false) {
    const rtl = dirOf(el); const f = styleFmt(el, {});
    const tag = el.tagName; const dataSt = el.getAttribute('data-st'); const props = { ...paraProps(el, rtl, inList), ...extra };
    if (/^H[1-6]$/.test(tag)) props.heading = HEAD[tag];
    else if (dataSt === 'title') props.style = 'Title'; else if (dataSt === 'subtitle') props.style = 'Subtitle'; else if (dataSt === 'quote') props.style = 'Quote';
    else if (tag === 'BLOCKQUOTE') props.indent = { ...(props.indent || {}), start: 720 };
    const fm = /^(-?\d+),(-?\d+),(\d+)$/.exec(el.closest?.('[data-frame]')?.getAttribute('data-frame') || '');
    if (fm) props.frame = { type: 'absolute', position: { x: tw(Number(fm[1]) * 0.75) + pg.left, y: tw(Number(fm[2]) * 0.75) + Math.min(pg.header, pg.top) }, width: tw(Number(fm[3]) * 0.75), anchor: { horizontal: D.FrameAnchorType.PAGE, vertical: D.FrameAnchorType.PAGE }, space: { horizontal: 180, vertical: 0 }, wrap: D.FrameWrap.AROUND };
    return new Paragraph({ children: runs(el, f, rtl), bidirectional: rtl || undefined, alignment: alignOf(el, rtl), ...props });
  }
  function list(el, level, ref, out) {
    const ordered = el.tagName === 'OL';
    const reference = ref || newList(ordered, el.getAttribute('type') || '', parseInt(el.getAttribute('start'), 10) || 1);
    Array.from(el.children).forEach((li) => {
      if (li.tagName !== 'LI') return;
      const inline = li.cloneNode(true); inline.querySelectorAll('ul,ol').forEach((x) => x.remove());
      out.push(para(inline, { numbering: { reference, level: Math.min(level, 8) }, contextualSpacing: !/margin-bottom/.test(li.getAttribute('style') || '') }, true));
      Array.from(li.children).filter((c) => c.tagName === 'UL' || c.tagName === 'OL').forEach((sub) => list(sub, level + 1, sub.tagName === el.tagName ? reference : null, out));
    });
  }

  /* ---------- tables ---------- */
  function table(el) {
    const trs = Array.from(el.querySelectorAll('tr')).filter((tr) => tr.closest('table') === el);
    const rtl = el.hasAttribute('dir') ? el.getAttribute('dir') === 'rtl' : def.rtl; const noB = el.getAttribute('data-b') === 'none';
    const line = noB ? { style: BorderStyle.NONE, size: 0, color: 'auto' } : { style: BorderStyle.SINGLE, size: 4, color: '808080' };
    const borders = { top: line, bottom: line, left: line, right: line };
    const occ = [];
    const rows = trs.map((tr, ri) => {
      let col = 0; occ[ri] = occ[ri] || [];
      return Array.from(tr.children).filter((c) => /^T[DH]$/.test(c.tagName)).map((td) => {
        while (occ[ri][col]) col += 1;
        const cs = parseInt(td.getAttribute('colspan'), 10) || 1; const rs = parseInt(td.getAttribute('rowspan'), 10) || 1;
        for (let r = 0; r < rs; r += 1) for (let c = 0; c < cs; c += 1) { occ[ri + r] = occ[ri + r] || []; occ[ri + r][col + c] = true; }
        const cell = { td, col, cs, rs }; col += cs; return cell;
      });
    });
    const n = Math.max(1, ...occ.map((r) => r.length));
    const wOf = (c) => { const m = /^([\d.]+)%$/.exec(c.td.style?.width || ''); return m ? Number(m[1]) : null; };
    const widths = new Array(n).fill(Math.floor(textW / n));
    const full = rows.find((r) => r.length === n && r.every((c) => c.cs === 1 && wOf(c)));
    if (full) { full.forEach((c) => { widths[c.col] = Math.round((wOf(c) / 100) * textW); }); widths[n - 1] += textW - widths.reduce((a, b) => a + b, 0); }
    const trows = rows.map((cells) => new TableRow({
      children: cells.map(({ td, col, cs, rs }) => {
        const kids = []; blocks(td, kids); if (!kids.length) kids.push(new Paragraph({}));
        const bg = hex(td.style?.backgroundColor); const va = td.style?.verticalAlign;
        return new TableCell({
          children: kids, columnSpan: cs > 1 ? cs : undefined, rowSpan: rs > 1 ? rs : undefined, borders,
          width: { size: widths.slice(col, col + cs).reduce((a, b) => a + b, 0), type: WidthType.DXA },
          shading: bg ? { type: ShadingType.CLEAR, fill: bg, color: 'auto' } : undefined,
          verticalAlign: va === 'middle' ? VerticalAlign.CENTER : va === 'bottom' ? VerticalAlign.BOTTOM : undefined,
          margins: { top: 40, bottom: 40, left: 100, right: 100 },
        });
      }),
    }));
    return new Table({ width: { size: textW, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, visuallyRightToLeft: rtl || undefined, rows: trows });
  }

  /* ---------- blocks ---------- */
  function blocks(parent, out) {
    let loose = [];
    const flush = () => {
      if (loose.some((x) => x.nodeType !== 3 || x.nodeValue.trim())) {
        const w = document.createElement('p'); loose.forEach((x) => w.appendChild(x.cloneNode(true)));
        const dir = parent.closest?.('[dir]')?.getAttribute('dir'); if (dir) w.setAttribute('dir', dir);
        out.push(para(w));
      }
      loose = [];
    };
    parent.childNodes.forEach((n) => {
      if (n.nodeType === 3) { loose.push(n); return; }
      if (n.nodeType !== 1) return;
      const t = n.tagName;
      if (t === 'HR') { flush(); if (n.hasAttribute('data-pb')) out.push(new Paragraph({ children: [new PageBreak()] })); }
      else if (/^(P|H[1-6]|BLOCKQUOTE)$/.test(t)) { flush(); out.push(para(n)); }
      else if (t === 'UL' || t === 'OL') { flush(); list(n, 0, null, out); }
      else if (t === 'TABLE') { flush(); out.push(table(n)); out.push(new Paragraph({ spacing: { before: 0, after: 0 } })); }
      else if (t === 'DIV') { flush(); if (n.querySelector('p,h1,h2,h3,h4,h5,h6,ul,ol,table,div')) blocks(n, out); else out.push(para(n)); }
      else loose.push(n);
    });
    flush();
  }
  const build = (html) => { const box = document.createElement('div'); box.innerHTML = html || ''; const out = []; blocks(box, out); return out; };

  /* ---------- document ---------- */
  const body = []; blocks(root, body); if (!body.length) body.push(new Paragraph({}));
  const hdr = ctx.header ? build(ctx.header) : []; const ftr = ctx.footer ? build(ctx.footer) : [];
  const landscape = pg.w > pg.h;
  function pageBorders() { // Word "Page Borders"
    const b = pg.borders; if (!b) return null;
    const names = new Set(Object.values(BorderStyle)); const out = {};
    ['top', 'left', 'bottom', 'right'].forEach((k) => { if (b[k]) out[`pageBorder${k[0].toUpperCase()}${k.slice(1)}`] = { style: names.has(b[k].val) ? b[k].val : BorderStyle.SINGLE, size: Math.min(96, b[k].sz), color: (b[k].color || '#000000').replace('#', '').toUpperCase(), space: Math.min(31, Math.round(b[k].space)) }; });
    if (!Object.keys(out).length) return null;
    const DISPLAY = { firstPage: D.PageBorderDisplay.FIRST_PAGE, notFirstPage: D.PageBorderDisplay.NOT_FIRST_PAGE };
    out.pageBorders = { display: DISPLAY[b.display] || D.PageBorderDisplay.ALL_PAGES, offsetFrom: b.offsetFrom === 'text' ? D.PageBorderOffsetFrom.TEXT : D.PageBorderOffsetFrom.PAGE, zOrder: b.zOrder === 'back' ? D.PageBorderZOrder.BACK : D.PageBorderZOrder.FRONT };
    return out;
  }
  const font = def.font; const sz = Math.round(def.size * 2);
  const hs = (lvl) => ({ id: `Heading${lvl}`, name: `heading ${lvl}`, basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font, size: HEADING_STYLES[lvl].size, color: HEADING_STYLES[lvl].color, bold: true }, paragraph: { spacing: { before: HEADING_STYLES[lvl].before, after: HEADING_STYLES[lvl].after }, keepNext: true, outlineLevel: lvl - 1 } });
  const doc = new Document({
    creator: 'UIPE', numbering: { config: numbering },
    styles: {
      default: { document: { run: { font, size: sz, sizeComplexScript: sz }, paragraph: { spacing: { before: tw(def.before), after: tw(def.after), line: Math.round(def.line * 240), lineRule: LineRuleType.AUTO } } } },
      paragraphStyles: [
        hs(1), hs(2), hs(3), hs(4), hs(5), hs(6),
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font, size: 52, color: '17365D' }, paragraph: { spacing: { after: 300, line: 240, lineRule: LineRuleType.AUTO } } },
        { id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font, size: 28, italics: true, color: '595959' } },
        { id: 'Quote', name: 'Quote', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { italics: true, color: '404040' }, paragraph: { indent: { start: 720, end: 720 } } },
      ],
    },
    sections: [{
      properties: { page: { ...(pageBorders() ? { borders: pageBorders() } : {}), size: { width: Math.min(pg.w, pg.h), height: Math.max(pg.w, pg.h), orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: pg.top, right: pg.right, bottom: pg.bottom, left: pg.left, header: pg.header, footer: pg.footer } } },
      headers: hdr.length ? { default: new Header({ children: hdr }) } : undefined,
      footers: ftr.length ? { default: new Footer({ children: ftr }) } : undefined,
      children: body,
    }],
  });
  return Packer.toBlob(doc);
}
