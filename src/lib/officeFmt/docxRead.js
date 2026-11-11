/**
 * Word (.docx) reader. Opens the OOXML package itself (fflate) so the editor keeps what mammoth drops:
 * fonts, sizes, colours, highlight, paragraph spacing / indents / direction, cell shading, merged cells, page size,
 * margins, orientation, header, footer and page-number fields.
 *
 *   readDocxRaw(arrayBuffer) -> { html, header, footer, page, defaults, warnings }
 *
 * The HTML is NOT sanitized here; docx.js runs it through sanitizeHtml() before it is shown.
 */
import { unzipSync, strFromU8 } from 'fflate';

const HL = { yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff' };
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };
const NUM_TYPE = { lowerLetter: 'a', upperLetter: 'A', lowerRoman: 'i', upperRoman: 'I' };

const parseXml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const kids = (el, n) => (el ? Array.from(el.children).filter((c) => c.nodeName === n) : []);
const kid = (el, n) => kids(el, n)[0] || null;
const A = (el, n) => (el ? el.getAttribute(n) : null);
const V = (el) => A(el, 'w:val');
const flag = (el) => { if (!el) return undefined; const v = V(el); return !(v !== null && /^(0|false|off|none)$/i.test(v)); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escA = (s) => esc(s).replace(/"/g, '&quot;');
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; };
const pt = (n) => `${Math.round(n * 100) / 100}pt`;
const hexOk = (c) => (c && /^[0-9a-f]{6}$/i.test(c) ? `#${c.toLowerCase()}` : undefined);
const RTL_CHARS = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const merge = (a, b) => { const o = { ...a }; Object.keys(b || {}).forEach((k) => { if (b[k] !== undefined) o[k] = b[k]; }); return o; };

/* ------------------------------------------------------------------ run / paragraph property parsing */
function parseRpr(rPr, theme) {
  if (!rPr) return {};
  const o = {};
  const f = kid(rPr, 'w:rFonts');
  if (f) {
    const th = (t) => (t ? (/^major/i.test(t) ? theme.major : theme.minor) : undefined);
    o.fontA = A(f, 'w:ascii') || A(f, 'w:hAnsi') || th(A(f, 'w:asciiTheme')) || th(A(f, 'w:hAnsiTheme')) || A(f, 'w:eastAsia') || undefined;
    o.fontCs = A(f, 'w:cs') || th(A(f, 'w:cstheme')) || undefined;
  }
  const sz = num(V(kid(rPr, 'w:sz'))); if (sz) o.sz = sz / 2;
  const szCs = num(V(kid(rPr, 'w:szCs'))); if (szCs) o.szCs = szCs / 2;
  const c = V(kid(rPr, 'w:color')); if (c && c !== 'auto') o.color = hexOk(c);
  const hl = V(kid(rPr, 'w:highlight')); if (hl) o.bg = hl === 'none' ? null : HL[hl];
  const shd = kid(rPr, 'w:shd'); if (shd && o.bg === undefined) { const fill = A(shd, 'w:fill'); if (fill && fill !== 'auto') o.bg = hexOk(fill); }
  const b = flag(kid(rPr, 'w:b')); if (b !== undefined) o.b = b;
  const bcs = flag(kid(rPr, 'w:bCs')); if (bcs !== undefined) o.bCs = bcs;
  const i = flag(kid(rPr, 'w:i')); if (i !== undefined) o.i = i;
  const ics = flag(kid(rPr, 'w:iCs')); if (ics !== undefined) o.iCs = ics;
  const u = kid(rPr, 'w:u'); if (u) o.u = V(u) !== 'none';
  const st = flag(kid(rPr, 'w:strike')); if (st !== undefined) o.st = st;
  const dst = flag(kid(rPr, 'w:dstrike')); if (dst) o.st = true;
  const va = V(kid(rPr, 'w:vertAlign')); if (va) o.va = va === 'superscript' ? 'sup' : va === 'subscript' ? 'sub' : null;
  const caps = flag(kid(rPr, 'w:caps')); if (caps !== undefined) o.caps = caps;
  const rs = V(kid(rPr, 'w:rStyle')); if (rs) o.rStyle = rs;
  const rt = flag(kid(rPr, 'w:rtl')); if (rt !== undefined) o.rtl = rt;
  return o;
}

/** <w:top w:val="single" w:sz="6" w:space="1" w:color="8EAADB"/> -> { val, sz (1/8 pt), space (pt), color } | null (no line) */
function parseBorder(el) {
  if (!el) return null;
  const val = V(el); if (!val || /^(nil|none)$/i.test(val)) return null;
  const c = A(el, 'w:color');
  return { val, sz: Math.max(2, num(A(el, 'w:sz')) || 4), space: num(A(el, 'w:space')) || 0, color: hexOk(c) || '#000000' };
}
const CSS_LINE = (v) => (/double|triple|thinThick|thickThin/i.test(v) ? 'double' : /dot/i.test(v) ? 'dotted' : /dash/i.test(v) ? 'dashed' : 'solid');
export const borderCss = (b) => `${Math.max(CSS_LINE(b.val) === 'double' ? 3 : 0.5, Math.round((b.sz / 8) * 100) / 100)}pt ${CSS_LINE(b.val)} ${b.color}`;

/** EMF pictures (Word keeps pasted logos as .emf): the usual case is one embedded DIB (EMR_STRETCHDIBITS) — rewrap it as a .bmp the browser can show. */
function emfToBmp(u8) {
  try {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let i = 0;
    while (i + 8 <= u8.length) {
      const type = dv.getUint32(i, true); const size = dv.getUint32(i + 4, true); if (size < 8) return null;
      if (type === 81) { // EMR_STRETCHDIBITS
        const offBmi = dv.getUint32(i + 48, true); const cbBmi = dv.getUint32(i + 52, true); const offBits = dv.getUint32(i + 56, true); const cbBits = dv.getUint32(i + 60, true);
        if (!cbBmi || !cbBits || i + offBits + cbBits > u8.length || i + offBmi + cbBmi > u8.length) return null;
        const comp = dv.getUint32(i + offBmi + 16, true); if (comp !== 0 && comp !== 3) return null; // plain / bit-fields only (no RLE, JPEG, PNG)
        const out = new Uint8Array(14 + cbBmi + cbBits); const o = new DataView(out.buffer);
        out[0] = 0x42; out[1] = 0x4d; o.setUint32(2, out.length, true); o.setUint32(10, 14 + cbBmi, true);
        out.set(u8.subarray(i + offBmi, i + offBmi + cbBmi), 14); out.set(u8.subarray(i + offBits, i + offBits + cbBits), 14 + cbBmi);
        return out;
      }
      if (type === 14) break; // EMR_EOF
      i += size;
    }
  } catch { /* not a bitmap EMF */ }
  return null;
}

function parsePpr(pPr) {
  if (!pPr) return {};
  const o = {};
  const jc = V(kid(pPr, 'w:jc')); if (jc) o.jc = jc;
  const bidi = flag(kid(pPr, 'w:bidi')); if (bidi !== undefined) o.bidi = bidi;
  const sp = kid(pPr, 'w:spacing');
  if (sp) {
    const bf = num(A(sp, 'w:before')); if (bf !== undefined) o.before = bf / 20;
    const af = num(A(sp, 'w:after')); if (af !== undefined) o.after = af / 20;
    const ln = num(A(sp, 'w:line')); if (ln !== undefined) { const rule = A(sp, 'w:lineRule') || 'auto'; o.line = rule === 'auto' ? { ratio: ln / 240 } : { pt: ln / 20 }; }
  }
  const ind = kid(pPr, 'w:ind');
  if (ind) {
    const st = num(A(ind, 'w:start') ?? A(ind, 'w:left')); if (st !== undefined) o.indStart = st / 20;
    const en = num(A(ind, 'w:end') ?? A(ind, 'w:right')); if (en !== undefined) o.indEnd = en / 20;
    const fl = num(A(ind, 'w:firstLine')); if (fl !== undefined) { o.first = fl / 20; }
    const hg = num(A(ind, 'w:hanging')); if (hg !== undefined) { o.first = -hg / 20; }
  }
  const np = kid(pPr, 'w:numPr');
  if (np) { const id = num(V(kid(np, 'w:numId'))); const lv = num(V(kid(np, 'w:ilvl'))); if (id !== undefined) o.numId = id; if (lv !== undefined) o.ilvl = lv; }
  const ps = V(kid(pPr, 'w:pStyle')); if (ps) o.pStyle = ps;
  const pb = flag(kid(pPr, 'w:pageBreakBefore')); if (pb) o.pbb = true;
  const bd = kid(pPr, 'w:pBdr');
  if (bd) {
    const b = {};
    ['top', 'bottom', 'left', 'right'].forEach((k) => { const x = parseBorder(kid(bd, `w:${k}`) || kid(bd, `w:${k === 'left' ? 'start' : k === 'right' ? 'end' : k}`)); if (x) b[k] = x; });
    if (Object.keys(b).length) o.bdr = b;
  }
  return o;
}

/* ------------------------------------------------------------------ package parts */
function loadStyles(files, theme) {
  const styles = new Map(); const out = { styles, defRpr: {}, defPpr: {}, defPara: null, defChar: null };
  if (!files['word/styles.xml']) return out;
  const doc = parseXml(strFromU8(files['word/styles.xml']));
  const root = doc.documentElement;
  const dd = kid(root, 'w:docDefaults');
  out.defRpr = parseRpr(kid(kid(dd, 'w:rPrDefault'), 'w:rPr'), theme);
  out.defPpr = parsePpr(kid(kid(dd, 'w:pPrDefault'), 'w:pPr'));
  kids(root, 'w:style').forEach((s) => {
    const id = A(s, 'w:styleId'); if (!id) return;
    const type = A(s, 'w:type');
    const tb = kid(kid(s, 'w:tblPr'), 'w:tblBorders');
    styles.set(id, { id, type, name: V(kid(s, 'w:name')) || id, basedOn: V(kid(s, 'w:basedOn')), rpr: parseRpr(kid(s, 'w:rPr'), theme), ppr: parsePpr(kid(s, 'w:pPr')), tblBorders: tb ? hasBorders(tb) : undefined });
    if (A(s, 'w:default') === '1') { if (type === 'paragraph') out.defPara = id; if (type === 'character') out.defChar = id; }
  });
  return out;
}

function chain(styles, id, field, depth = 0) { // resolved rpr / ppr along basedOn
  const s = id && styles.get(id); if (!s || depth > 12) return {};
  return merge(chain(styles, s.basedOn, field, depth + 1), s[field]);
}
function tableBorderOf(styles, id, depth = 0) {
  const s = id && styles.get(id); if (!s || depth > 12) return undefined;
  return s.tblBorders !== undefined ? s.tblBorders : tableBorderOf(styles, s.basedOn, depth + 1);
}
function hasBorders(el) { return ['w:top', 'w:left', 'w:bottom', 'w:right', 'w:start', 'w:end', 'w:insideH', 'w:insideV'].some((n) => { const b = kid(el, n); const v = V(b); return b && v && !/^(nil|none)$/i.test(v); }); }

function loadTheme(files) {
  const t = { major: undefined, minor: undefined };
  const f = Object.keys(files).find((k) => /^word\/theme\/theme\d*\.xml$/.test(k)); if (!f) return t;
  const d = parseXml(strFromU8(files[f]));
  const mj = d.getElementsByTagName('a:majorFont')[0]; const mn = d.getElementsByTagName('a:minorFont')[0];
  t.major = A(kid(mj, 'a:latin'), 'typeface') || undefined; t.minor = A(kid(mn, 'a:latin'), 'typeface') || undefined;
  return t;
}

function loadNumbering(files) {
  const nums = new Map(); const abs = new Map();
  if (!files['word/numbering.xml']) return { nums, abs };
  const root = parseXml(strFromU8(files['word/numbering.xml'])).documentElement;
  kids(root, 'w:abstractNum').forEach((a) => {
    const lv = new Map();
    kids(a, 'w:lvl').forEach((l) => lv.set(num(A(l, 'w:ilvl')) || 0, { fmt: V(kid(l, 'w:numFmt')) || 'decimal', start: num(V(kid(l, 'w:start'))) ?? 1 }));
    abs.set(num(A(a, 'w:abstractNumId')), lv);
  });
  kids(root, 'w:num').forEach((n) => {
    const ov = new Map();
    kids(n, 'w:lvlOverride').forEach((o) => { const so = num(V(kid(o, 'w:startOverride'))); if (so !== undefined) ov.set(num(A(o, 'w:ilvl')) || 0, so); });
    nums.set(num(A(n, 'w:numId')), { abs: num(V(kid(n, 'w:abstractNumId'))), ov });
  });
  return { nums, abs };
}

function loadRels(files, path) {
  const m = new Map(); const f = files[path]; if (!f) return m;
  kids(parseXml(strFromU8(f)).documentElement, 'Relationship').forEach((r) => m.set(r.getAttribute('Id'), { target: r.getAttribute('Target'), ext: r.getAttribute('TargetMode') === 'External', type: r.getAttribute('Type') || '' }));
  return m;
}
const relsPathOf = (part) => part.replace(/([^/]+)$/, '_rels/$1.rels');
const resolvePath = (target) => { const parts = []; `word/${target}`.replace(/^word\/\//, '').split('/').forEach((p) => { if (p === '..') parts.pop(); else if (p && p !== '.') parts.push(p); }); return parts.join('/'); };

/* ------------------------------------------------------------------ conversion */
class Conv {
  constructor(files) {
    this.files = files; this.warn = new Set();
    this.theme = loadTheme(files); this.st = loadStyles(files, this.theme); this.nb = loadNumbering(files);
    this.docRels = loadRels(files, 'word/_rels/document.xml.rels');
    this.rels = this.docRels; this.fld = []; this.count = new Map(); this.tblPpr = null; this.tblRpr = null;
    this.base = merge(this.st.defRpr, chain(this.st.styles, this.st.defPara, 'rpr'));
    this.basePpr = merge(this.st.defPpr, chain(this.st.styles, this.st.defPara, 'ppr'));
  }

  /* effective run props of a paragraph: defaults <- paragraph style (incl. the document's default one) */
  paraEff(ppr) { // a table style's run props beat the document defaults for paragraphs in the default paragraph style
    const sid = ppr.pStyle || this.st.defPara; const e = merge(this.st.defRpr, chain(this.st.styles, sid, 'rpr'));
    return this.tblRpr && sid === this.st.defPara ? merge(e, this.tblRpr) : e;
  }
  paraPpr(pPrEl) {
    const direct = parsePpr(pPrEl);
    const sid = direct.pStyle || this.st.defPara;
    const p = merge(merge(this.st.defPpr, chain(this.st.styles, sid, 'ppr')), this.tblPpr && sid === this.st.defPara ? this.tblPpr : {});
    return merge(p, direct);
  }

  size(r, rtl) { return rtl ? (r.szCs ?? r.sz) : r.sz; }
  font(r, rtl) { return rtl ? (r.fontCs || r.fontA) : (r.fontA || r.fontCs); }
  bold(r, rtl) { return rtl ? (r.bCs ?? r.b) : r.b; }
  ital(r, rtl) { return rtl ? (r.iCs ?? r.i) : r.i; }

  imageOf(el) {
    const blip = el.getElementsByTagName('a:blip')[0]; const vd = el.getElementsByTagName('v:imagedata')[0];
    const rid = blip ? A(blip, 'r:embed') : vd ? A(vd, 'r:id') : null; if (!rid) return '';
    const rel = this.rels.get(rid); if (!rel || rel.ext) return '';
    const path = resolvePath(rel.target); const ext = path.split('.').pop().toLowerCase();
    let bytes = this.files[path]; let mime = MIME[ext];
    if (bytes && ext === 'emf') { const bmp = emfToBmp(bytes); if (bmp) { bytes = bmp; mime = MIME.bmp; } }
    if (!mime || !bytes) { this.warn.add('image'); return ''; } let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const ex = el.getElementsByTagName('wp:extent')[0]; const dp = el.getElementsByTagName('wp:docPr')[0];
    const w = ex ? Math.round(num(A(ex, 'cx')) / 9525) : 0; const h = ex ? Math.round(num(A(ex, 'cy')) / 9525) : 0;
    let fl = ''; // anchored (floating) picture: remember the side it sits on so the logos of a header stay left / right of the text
    const anc = el.getElementsByTagName('wp:anchor')[0];
    if (anc) {
      const ph = kid(anc, 'wp:positionH'); const al = (kid(ph, 'wp:align')?.textContent || '').trim(); const off = kid(ph, 'wp:posOffset');
      if (al === 'right' || al === 'outside') fl = 'right'; else if (al === 'left' || al === 'inside') fl = 'left';
      else if (off) { const cx = ex ? num(A(ex, 'cx')) || 0 : 0; const mid = (num(off.textContent) || 0) / 635 + cx / 635 / 2; const base = A(ph, 'relativeFrom') === 'page' ? this.pageW : this.textW; fl = mid > base / 2 ? 'right' : 'left'; }
    }
    return `<img src="data:${mime};base64,${btoa(bin)}"${fl ? ` data-fl="${fl}"` : ''}${w > 0 ? ` width="${w}"` : ''}${h > 0 && w > 0 ? ` height="${h}"` : ''}${dp && A(dp, 'descr') ? ` alt="${escA(A(dp, 'descr'))}"` : ''}>`;
  }

  /** Colour of a DrawingML fill: srgbClr, or a scheme colour (tx2 -> dk2 ...) looked up in the theme. */
  drawColor(el) {
    const rgb = el.getElementsByTagName('a:srgbClr')[0]; if (rgb) return hexOk(A(rgb, 'val')) || '#000000';
    const sc = el.getElementsByTagName('a:schemeClr')[0]; if (!sc) return '#000000';
    if (!this.themeXml) { const f = Object.keys(this.files).find((k) => /^word\/theme\/theme\d*\.xml$/.test(k)); this.themeXml = f ? strFromU8(this.files[f]) : ''; }
    const name = { tx1: 'dk1', tx2: 'dk2', bg1: 'lt1', bg2: 'lt2' }[A(sc, 'val')] || A(sc, 'val');
    const m = new RegExp(`<a:${name}>\\s*<a:(?:srgbClr val|sysClr[^>]*lastClr)="([0-9A-Fa-f]{6})"`).exec(this.themeXml);
    return m ? `#${m[1]}` : '#000000';
  }

  /** A straight line shape (Word's "Straight Connector", used as the rule under letterheads). Queued; paragraph() draws it after its text. */
  lineShape(c) {
    const wsp = c.getElementsByTagName('wps:wsp')[0]; if (!wsp) return false;
    if (wsp.getElementsByTagName('wps:txbx').length) return false;
    const geom = wsp.getElementsByTagName('a:prstGeom')[0]; if (!/^(line|straightConnector1)$/.test(A(geom, 'prst') || '')) return false;
    const ex = c.getElementsByTagName('wp:extent')[0]; const cx = ex ? num(A(ex, 'cx')) || 0 : 0; const cy = ex ? num(A(ex, 'cy')) || 0 : 0;
    if (cx <= 0 || cy > cx / 20) return false; // horizontal lines only
    const ln = wsp.getElementsByTagName('a:ln')[0];
    const wPt = Math.max(0.5, Math.round(((ln ? num(A(ln, 'w')) || 9525 : 9525) / 12700) * 100) / 100);
    const color = ln ? this.drawColor(ln) : '#000000';
    const ph = c.getElementsByTagName('wp:positionH')[0]; const pv = c.getElementsByTagName('wp:positionV')[0];
    const off = (e) => num(kid(e, 'wp:posOffset')?.textContent) || 0;
    (this.pendingLines ||= []).push({ w: Math.round(cx / 9525), ml: ph ? Math.round(off(ph) / 9525) : 0, mt: pv ? Math.round(off(pv) / 9525) : 0, wPt, color });
    return true;
  }

  /* one run -> list of { html } | { pb: true }, formatted relative to the paragraph's own look */
  run(r, para) {
    const { eff, rtl } = para;
    const own = parseRpr(kid(r, 'w:rPr'), this.theme);
    const cs = own.rStyle ? chain(this.st.styles, own.rStyle, 'rpr') : {};
    const e = merge(merge(eff, cs), own);
    const parts = []; let text = '';
    const flush = () => { if (text) { parts.push({ text }); text = ''; } };
    const hidden = () => this.fld.some((f) => f.phase === 'instr' || f.suppress);
    const walk = (el) => {
      Array.from(el.children).forEach((c) => {
        const n = c.nodeName;
        if (n === 'w:t') { if (!hidden()) text += c.textContent; }
        else if (n === 'w:tab') { if (!hidden()) text += '\t'; }
        else if (n === 'w:noBreakHyphen') text += '\u2011';
        else if (n === 'w:br') { if (A(c, 'w:type') === 'page') { flush(); parts.push({ pb: true }); } else { flush(); parts.push({ html: '<br>' }); } }
        else if (n === 'w:cr') { flush(); parts.push({ html: '<br>' }); }
        else if (n === 'w:instrText') { const f = this.fld[this.fld.length - 1]; if (f && f.phase === 'instr') f.instr += c.textContent; }
        else if (n === 'w:fldChar') this.fldChar(A(c, 'w:fldCharType'), parts, flush);
        else if (n === 'w:drawing' || n === 'w:pict' || n === 'w:object') {
          if (c.getElementsByTagName('c:chart').length) this.warn.add('chart');
          if (c.getElementsByTagName('wps:txbx').length || c.getElementsByTagName('w:txbxContent').length) this.warn.add('textbox');
          const im = this.imageOf(c); if (im) { flush(); parts.push({ html: im }); } else if (this.lineShape(c)) { /* drawn as a rule under the paragraph */ } else if (c.getElementsByTagName('wps:wsp').length || c.getElementsByTagName('v:shape').length) this.warn.add('shape');
        } else if (n === 'mc:AlternateContent') { const ch = kid(c, 'mc:Choice'); if (ch) walk(ch); }
        else if (n === 'w:footnoteReference' || n === 'w:endnoteReference') this.warn.add('notes');
        else if (n === 'w:sym') text += '\u2022';
      });
    };
    walk(r); flush();
    const href = [...this.fld].reverse().find((f) => f.href)?.href;

    const st = [];
    const font = this.font(e, rtl); if (font && font !== this.font(eff, rtl)) st.push(`font-family:${/[^\w\s-]/.test(font) ? `'${font.replace(/'/g, '')}'` : font}`);
    const sz = this.size(e, rtl); if (sz && sz !== this.size(eff, rtl)) st.push(`font-size:${pt(sz)}`);
    if (e.color && e.color !== eff.color) st.push(`color:${e.color}`);
    if (e.bg && e.bg !== eff.bg) st.push(`background-color:${e.bg}`);
    if (e.caps && !eff.caps) st.push('text-transform:uppercase');
    const b = !!this.bold(e, rtl); const i = !!this.ital(e, rtl);
    if (b !== !!this.bold(eff, rtl) && !b) st.push('font-weight:normal');
    if (i !== !!this.ital(eff, rtl) && !i) st.push('font-style:normal');
    const wrapT = (h, iso) => {
      let o = iso ? `<span dir="ltr">${h}</span>` : h; // Word lays a run that is not flagged right-to-left out left-to-right, even inside a bidi paragraph
      if (e.va === 'sup') o = `<sup>${o}</sup>`; else if (e.va === 'sub') o = `<sub>${o}</sub>`;
      if (e.st && !eff.st) o = `<s>${o}</s>`;
      if (e.u && !eff.u) o = `<u>${o}</u>`;
      if (i && !this.ital(eff, rtl)) o = `<em>${o}</em>`;
      if (b && !this.bold(eff, rtl)) o = `<strong>${o}</strong>`;
      if (st.length) o = `<span style="${escA(st.join(';'))}">${o}</span>`;
      return href ? `<a href="${escA(href)}">${o}</a>` : o;
    };
    return parts.map((p) => (p.pb ? p : p.text !== undefined ? { html: wrapT(esc(p.text), rtl && !e.rtl && !RTL_CHARS.test(p.text)) } : { html: p.html === '<br>' ? '<br>' : p.html }));
  }

  fldChar(type, parts, flush) {
    if (type === 'begin') this.fld.push({ phase: 'instr', instr: '', suppress: false, href: null });
    else if (type === 'separate') {
      const f = this.fld[this.fld.length - 1]; if (!f) return;
      f.phase = 'result';
      const ins = f.instr.trim();
      const m = /^(PAGE|NUMPAGES|SECTIONPAGES)\b/i.exec(ins);
      if (m) { flush(); f.suppress = true; parts.push({ html: `<span data-fld="${m[1].toUpperCase() === 'PAGE' ? 'PAGE' : 'NUMPAGES'}">1</span>` }); }
      const h = /^HYPERLINK\s+"([^"]+)"/i.exec(ins); if (h) f.href = h[1];
    } else if (type === 'end') this.fld.pop();
  }

  /* children of a paragraph (hyperlinks, fields, smart tags, tracked insertions ...) -> parts */
  inline(el, para, out, href) {
    Array.from(el.children).forEach((c) => {
      const n = c.nodeName;
      if (n === 'w:r') {
        const parts = this.run(c, para);
        parts.forEach((p) => out.push(href && p.html ? { html: `<a href="${escA(href)}">${p.html}</a>` } : p));
      } else if (n === 'w:hyperlink') {
        const rid = A(c, 'r:id'); const rel = rid && this.rels.get(rid);
        this.inline(c, para, out, rel && rel.ext ? rel.target : href);
      } else if (n === 'w:fldSimple') {
        const ins = (A(c, 'w:instr') || '').trim(); const m = /^(PAGE|NUMPAGES|SECTIONPAGES)\b/i.exec(ins);
        if (m) out.push({ html: `<span data-fld="${m[1].toUpperCase() === 'PAGE' ? 'PAGE' : 'NUMPAGES'}">1</span>` });
        else this.inline(c, para, out, href);
      } else if (n === 'w:ins' || n === 'w:smartTag' || n === 'w:customXml' || n === 'w:sdt') this.inline(n === 'w:sdt' ? (kid(c, 'w:sdtContent') || c) : c, para, out, href);
      else if (n === 'w:sdtContent') this.inline(c, para, out, href);
      else if (n === 'm:oMath' || n === 'm:oMathPara') this.warn.add('equation');
    });
  }

  blockStyle(ppr, rtl, isHead, eff, forList) {
    const st = [];
    if (ppr.jc) {
      const j = ppr.jc; let a = null;
      if (j === 'center') a = 'center'; else if (j === 'both' || j === 'distribute' || j === 'thaiDistribute') a = 'justify';
      else if (j === 'left' || j === 'start') a = rtl ? 'right' : 'left'; else if (j === 'right' || j === 'end') a = rtl ? 'left' : 'right';
      if (a) st.push(`text-align:${a}`);
    }
    const bp = this.basePpr;
    if (!forList) {
      if (ppr.before !== undefined && ppr.before !== bp.before) st.push(`margin-top:${pt(ppr.before)}`);
      if (ppr.after !== undefined && ppr.after !== bp.after) st.push(`margin-bottom:${pt(ppr.after)}`);
      if (ppr.bdr) ['top', 'bottom', 'left', 'right'].forEach((k) => { if (ppr.bdr[k]) st.push(`border-${k}:${borderCss(ppr.bdr[k])}`); });
      if (ppr.indStart) st.push(`margin-inline-start:${pt(ppr.indStart)}`);
      if (ppr.indEnd) st.push(`margin-inline-end:${pt(ppr.indEnd)}`);
      if (ppr.first) st.push(`text-indent:${pt(ppr.first)}`);
    }
    if (ppr.line && JSON.stringify(ppr.line) !== JSON.stringify(bp.line)) st.push(`line-height:${ppr.line.ratio !== undefined ? Math.round(ppr.line.ratio * 1000) / 1000 : pt(ppr.line.pt)}`);
    const base = this.base;
    const f = this.font(eff, rtl); if (f && (f !== this.font(base, rtl))) st.push(`font-family:${/[^\w\s-]/.test(f) ? `'${f.replace(/'/g, '')}'` : f}`);
    const sz = this.size(eff, rtl); if (sz && (isHead || sz !== this.size(base, rtl))) st.push(`font-size:${pt(sz)}`);
    if (eff.color && eff.color !== base.color) st.push(`color:${eff.color}`);
    if (this.bold(eff, rtl) && !this.bold(base, rtl) && !isHead) st.push('font-weight:bold');
    if (this.ital(eff, rtl) && !this.ital(base, rtl)) st.push('font-style:italic');
    if (eff.u && !base.u) st.push('text-decoration:underline');
    return st.join(';');
  }

  /* one w:p -> { blocks: [html|{pb}], list: {numId, ilvl, ordered, type, start, html, style, dir} | null } */
  paragraph(p) {
    const pPrEl = kid(p, 'w:pPr'); const ppr = this.paraPpr(pPrEl);
    const rtl = !!ppr.bidi; const eff = this.paraEff(ppr);
    const sname = (this.st.styles.get(ppr.pStyle || this.st.defPara)?.name || '').toLowerCase();
    let tag = 'p'; let dataSt = '';
    const hm = /^heading\s*([1-6])$/.exec(sname);
    if (hm) tag = `h${hm[1]}`; else if (sname === 'title') dataSt = 'title'; else if (sname === 'subtitle') dataSt = 'subtitle'; else if (/^(quote|intense quote)$/.test(sname)) dataSt = 'quote';
    const para = { eff, rtl };
    const parts = []; this.pendingLines = []; this.inline(p, para, parts); const lines = this.pendingLines; this.pendingLines = [];
    const dir = ` dir="${rtl ? 'rtl' : 'ltr'}"`;
    const isList = !!ppr.numId && !hm;
    const css = this.blockStyle(ppr, rtl, !!hm || !!dataSt, eff, isList);
    const attrs = `${dir}${dataSt ? ` data-st="${dataSt}"` : ''}${css ? ` style="${escA(css)}"` : ''}`;

    // split around page breaks
    const blocks = []; let cur = '';
    const close = (force) => { if (cur || force) { blocks.push(`<${tag}${attrs}>${cur || '<br>'}</${tag}>`); } cur = ''; };
    if (ppr.pbb) blocks.push({ pb: true });
    parts.forEach((x) => { if (x.pb) { close(false); blocks.push({ pb: true }); } else cur += x.html; });
    if (!blocks.length || cur || !parts.length) close(!blocks.length || (!cur && !parts.length));
    lines.forEach((l) => blocks.push(`<div style="width:${l.w}px;margin-inline-start:${l.ml}px;margin-top:${Math.max(0, l.mt - 16)}px;margin-bottom:6px;border-top:${l.wPt}pt solid ${l.color}"></div>`));
    if (isList) {
      const lv = ppr.ilvl || 0; const nm = this.nb.nums.get(ppr.numId);
      const lvl = nm && this.nb.abs.get(nm.abs)?.get(lv);
      const fmt = lvl ? lvl.fmt : 'bullet';
      const ordered = fmt !== 'bullet' && fmt !== 'none';
      const key = `${ppr.numId}:${lv}`;
      const start = (nm?.ov.get(lv) ?? lvl?.start ?? 1);
      const seen = this.count.get(key) || 0; this.count.set(key, seen + 1);
      const inner = parts.filter((x) => !x.pb).map((x) => x.html).join('');
      const lcss = this.blockStyle(ppr, rtl, false, eff, true);
      return { blocks: blocks.filter((b) => typeof b !== 'string'), list: { numId: ppr.numId, ilvl: lv, ordered, type: NUM_TYPE[fmt] || '', start: start + seen, first: seen === 0, li: `<li${dir}${lcss ? ` style="${escA(lcss)}"` : ''}>${inner || '<br>'}`, seen } };
    }
    return { blocks, list: null };
  }

  /* a container (body, cell, header ...) -> html */
  container(el) {
    let out = ''; const stack = [];
    const closeTo = (level) => { while (stack.length && stack[stack.length - 1].level > level) { const t = stack.pop(); out += `</li></${t.tag}>`; } };
    const closeAll = () => closeTo(-1);
    const push = (item) => {
      const L = item.ilvl; const tag = item.ordered ? 'ol' : 'ul';
      closeTo(L);
      let top = stack[stack.length - 1];
      if (top && top.level === L && (top.numId !== item.numId || top.tag !== tag)) { stack.pop(); out += `</li></${top.tag}>`; top = stack[stack.length - 1]; }
      if (top && top.level === L) out += '</li>';
      else { out += `<${tag}${item.ordered && item.type ? ` type="${item.type}"` : ''}${item.ordered && item.start > 1 ? ` start="${item.start}"` : ''}>`; stack.push({ tag, level: L, numId: item.numId }); }
      out += item.li;
    };
    // Paragraphs with a frame (w:framePr) are positioned on the page (the letterhead text of a header): gather neighbours with the same frame into one absolutely placed box.
    let fr = null;
    const flushFrame = () => { if (fr) { out += `<div data-frame="${fr.x},${fr.y},${fr.w}">${fr.html}</div>`; fr = null; } };
    const frameOf = (p) => {
      if (!this.frameOrigin) return null;
      const f = kid(kid(p, 'w:pPr'), 'w:framePr'); if (!f || A(f, 'w:hAnchor') !== 'page' || A(f, 'w:vAnchor') !== 'page') return null;
      const x = num(A(f, 'w:x')); const y = num(A(f, 'w:y')); const w = num(A(f, 'w:w')); if (x === undefined || y === undefined || !w) return null;
      return { x: Math.round((x - this.frameOrigin.x) / 15), y: Math.round((y - this.frameOrigin.y) / 15), w: Math.round(w / 15) };
    };
    const visit = (parent) => {
      Array.from(parent.children).forEach((c) => {
        const n = c.nodeName;
        if (n === 'w:p') {
          const r = this.paragraph(c); const f = r.list ? null : frameOf(c);
          if (f) { closeAll(); if (fr && (fr.x !== f.x || fr.y !== f.y || fr.w !== f.w)) flushFrame(); fr = fr || { ...f, html: '' }; r.blocks.forEach((b) => { if (typeof b === 'string') fr.html += b; }); return; }
          flushFrame();
          r.blocks.forEach((b) => { closeAll(); out += typeof b === 'string' ? b : '<hr data-pb="1">'; });
          if (r.list) push(r.list);
        } else if (n === 'w:tbl') { flushFrame(); closeAll(); out += this.table(c); }
        else if (n === 'w:sdt') visit(kid(c, 'w:sdtContent') || c);
        else if (n === 'w:sdtContent' || n === 'w:ins' || n === 'w:customXml') visit(c);
      });
    };
    visit(el); flushFrame(); closeAll();
    return out;
  }

  table(tbl) {
    const tp = kid(tbl, 'w:tblPr'); const grid = kids(kid(tbl, 'w:tblGrid'), 'w:gridCol').map((g) => num(A(g, 'w:w')) || 0);
    const total = grid.reduce((a, b) => a + b, 0) || 0;
    let bordered; const tb = kid(tp, 'w:tblBorders'); if (tb) bordered = hasBorders(tb); else bordered = !!tableBorderOf(this.st.styles, V(kid(tp, 'w:tblStyle')));
    const rtl = !!flag(kid(tp, 'w:bidiVisual'));
    const tsid = V(kid(tp, 'w:tblStyle')); const savePpr = this.tblPpr; const saveRpr = this.tblRpr;
    this.tblPpr = tsid ? chain(this.st.styles, tsid, 'ppr') : null; this.tblRpr = tsid ? chain(this.st.styles, tsid, 'rpr') : null;
    if (this.tblPpr && !Object.keys(this.tblPpr).length) this.tblPpr = null;
    if (this.tblRpr && !Object.keys(this.tblRpr).length) this.tblRpr = null;
    const rows = kids(tbl, 'w:tr').map((tr) => {
      let col = 0;
      return kids(tr, 'w:tc').map((tc) => {
        const pr = kid(tc, 'w:tcPr'); const span = num(V(kid(pr, 'w:gridSpan'))) || 1; const vm = kid(pr, 'w:vMerge');
        const cell = { tc, pr, col, span, vm: vm ? (V(vm) === 'restart' ? 'restart' : 'cont') : null };
        col += span; return cell;
      });
    });
    let html = `<table${bordered ? '' : ' data-b="none"'}${rtl ? ' dir="rtl"' : ' dir="ltr"'}><tbody>`;
    rows.forEach((cells, ri) => {
      html += '<tr>';
      cells.forEach((c) => {
        if (c.vm === 'cont') return;
        let rs = 1;
        if (c.vm === 'restart') for (let r = ri + 1; r < rows.length; r += 1) { const nx = rows[r].find((x) => x.col === c.col); if (nx && nx.vm === 'cont') rs += 1; else break; }
        const st = [];
        const fill = A(kid(c.pr, 'w:shd'), 'w:fill'); if (fill && fill !== 'auto' && hexOk(fill)) st.push(`background-color:${hexOk(fill)}`);
        const va = V(kid(c.pr, 'w:vAlign')); if (va === 'center') st.push('vertical-align:middle'); else if (va === 'bottom') st.push('vertical-align:bottom');
        if (total && grid.length) { const w = grid.slice(c.col, c.col + c.span).reduce((a, b) => a + b, 0); if (w) st.push(`width:${Math.round((w / total) * 1000) / 10}%`); }
        const inner = this.container(c.tc) || '<p><br></p>';
        html += `<td${c.span > 1 ? ` colspan="${c.span}"` : ''}${rs > 1 ? ` rowspan="${rs}"` : ''}${st.length ? ` style="${st.join(';')}"` : ''}>${inner}</td>`;
      });
      html += '</tr>';
    });
    this.tblPpr = savePpr; this.tblRpr = saveRpr;
    return `${html}</tbody></table>`;
  }

  part(path) { // header / footer file -> html
    const f = this.files[path]; if (!f) return '';
    const saveRels = this.rels; const saveFld = this.fld;
    this.rels = loadRels(this.files, relsPathOf(path)); this.fld = [];
    const html = this.container(parseXml(strFromU8(f)).documentElement);
    this.rels = saveRels; this.fld = saveFld;
    return html;
  }
}

export function readDocxRaw(arrayBuffer) {
  const files = unzipSync(new Uint8Array(arrayBuffer));
  if (!files['word/document.xml']) throw new Error('Not a Word document (word/document.xml is missing)');
  const cv = new Conv(files);
  const doc = parseXml(strFromU8(files['word/document.xml']));
  const body = doc.getElementsByTagName('w:body')[0];
  if (!body) throw new Error('The document has no body');
  const sect = kid(body, 'w:sectPr');
  const sz = kid(sect, 'w:pgSz'); const mg = kid(sect, 'w:pgMar');
  const tw = (n, d) => { const v = num(A(mg, n)); return v === undefined ? d : v; };
  const page = {
    w: num(A(sz, 'w:w')) || 11906, h: num(A(sz, 'w:h')) || 16838,
    top: tw('w:top', 1440), right: tw('w:right', 1440), bottom: tw('w:bottom', 1440), left: tw('w:left', 1440), header: tw('w:header', 708), footer: tw('w:footer', 708),
  };
  if (A(sz, 'w:orient') === 'landscape' && page.w < page.h) [page.w, page.h] = [page.h, page.w];
  const pbEl = kid(sect, 'w:pgBorders');
  if (pbEl) {
    const b = {}; ['top', 'left', 'bottom', 'right'].forEach((k) => { const x = parseBorder(kid(pbEl, `w:${k}`)); if (x) b[k] = x; });
    if (Object.keys(b).length) page.borders = { ...b, offsetFrom: A(pbEl, 'w:offsetFrom') || 'page', display: A(pbEl, 'w:display') || 'allPages', zOrder: A(pbEl, 'w:zOrder') || 'front' };
  }
  cv.pageW = page.w; cv.textW = Math.max(1440, page.w - page.left - page.right);
  const html = cv.container(body);
  const ref = (kind) => {
    const r = kids(sect, `w:${kind}Reference`).find((x) => (A(x, 'w:type') || 'default') === 'default');
    const rel = r && cv.docRels.get(A(r, 'r:id'));
    return rel ? cv.part(resolvePath(rel.target)) : '';
  };
  cv.frameOrigin = { x: page.left, y: Math.min(page.header, page.top) };
  const header = ref('header'); cv.frameOrigin = null; const footer = ref('footer');
  if (kid(sect, 'w:titlePg') && (kids(sect, 'w:headerReference').length > 1 || kids(sect, 'w:footerReference').length > 1)) cv.warn.add('firstPage');
  const defaults = {
    font: cv.base.fontA || cv.base.fontCs || 'Calibri', size: cv.base.sz || 11,
    before: cv.basePpr.before ?? 0, after: cv.basePpr.after ?? 0, line: cv.basePpr.line?.ratio ?? 1,
    rtl: !!cv.basePpr.bidi,
  };
  return { html, header, footer, page, defaults, warnings: [...cv.warn] };
}
