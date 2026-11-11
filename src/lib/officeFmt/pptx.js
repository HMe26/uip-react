/**
 * PowerPoint (.pptx) reader. Writing lives in ./pptxEdit.js (it edits the package files directly).
 *   loadDeck(files, session) -> { files, cx, cy, theme, layouts, slides: [{ index, path, layoutPath, bg, fg, shapes }] }
 *   loadPptx(arrayBuffer)    -> same, from raw bytes, with revoke()
 * Every shape carries `xi` = its position in flatShapes(slide tree), so the writer finds the same XML element again.
 */
import { strFromU8, unzipSync } from 'fflate';

export const parseXml = (s) => new DOMParser().parseFromString(s, 'application/xml');
export const kids = (el, n) => (el ? Array.from(el.children).filter((c) => !n || c.localName === n) : []);
export const kid = (el, n) => kids(el, n)[0] || null;
export const walk = (el, ...names) => names.reduce((e, n) => (e ? kid(e, n) : null), el);
export const at = (el, n) => (el ? el.getAttribute(n) : null);
export const num = (v, d = 0) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
export const resolve = (base, target) => {
  if (/^https?:/i.test(target)) return null;
  const parts = (target.startsWith('/') ? target.slice(1) : `${base.slice(0, base.lastIndexOf('/') + 1)}${target}`).split('/');
  const out = []; parts.forEach((p) => { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); });
  return out.join('/');
};
export const relsOf = (files, path) => {
  const rp = `${path.slice(0, path.lastIndexOf('/') + 1)}_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`;
  const f = files[rp]; const map = {};
  if (f) Array.from(parseXml(strFromU8(f)).getElementsByTagName('Relationship')).forEach((r) => { map[r.getAttribute('Id')] = { type: r.getAttribute('Type') || '', target: resolve(path, r.getAttribute('Target') || '') }; });
  return map;
};

/* ---- colours */
const SCHEME = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };
export function themeColors(files) {
  const f = files['ppt/theme/theme1.xml']; const out = {};
  if (!f) return out;
  const cs = Array.from(parseXml(strFromU8(f)).getElementsByTagNameNS('*', 'clrScheme'))[0];
  kids(cs).forEach((c) => { const v = kid(c); out[c.localName] = v.localName === 'sysClr' ? `#${at(v, 'lastClr') || '000000'}` : `#${at(v, 'val')}`; });
  return out;
}
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (r) => `#${r.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
function adjust(hex, node) {
  let [r, g, b] = hexToRgb(hex);
  kids(node).forEach((m) => {
    const v = num(at(m, 'val'), 100000) / 100000;
    if (m.localName === 'lumMod' || m.localName === 'lumOff') {
      const mx = Math.max(r, g, b) / 255; const mn = Math.min(r, g, b) / 255; let l = (mx + mn) / 2; const d = mx - mn;
      let h = 0; let s = 0;
      if (d) { s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r / 255 ? (g - b) / 255 / d + (g < b ? 6 : 0) : mx === g / 255 ? (b - r) / 255 / d + 2 : (r - g) / 255 / d + 4; h /= 6; }
      l = m.localName === 'lumMod' ? l * v : l + v;
      l = Math.max(0, Math.min(1, l));
      const f = (p, q, t) => { let x = t; if (x < 0) x += 1; if (x > 1) x -= 1; if (x < 1 / 6) return p + (q - p) * 6 * x; if (x < 1 / 2) return q; if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6; return p; };
      if (!s) { r = g = b = l * 255; } else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q; r = f(p, q, h + 1 / 3) * 255; g = f(p, q, h) * 255; b = f(p, q, h - 1 / 3) * 255; }
    } else if (m.localName === 'tint') { r = 255 - (255 - r) * v; g = 255 - (255 - g) * v; b = 255 - (255 - b) * v; } else if (m.localName === 'shade') { r *= v; g *= v; b *= v; }
  });
  return toHex([r, g, b]);
}
export function colorOf(fillEl, theme) {
  const c = kids(fillEl).find((k) => ['srgbClr', 'schemeClr', 'sysClr', 'prstClr'].includes(k.localName));
  if (!c) return null;
  let hex = null;
  if (c.localName === 'srgbClr') hex = `#${at(c, 'val')}`;
  else if (c.localName === 'sysClr') hex = `#${at(c, 'lastClr') || '000000'}`;
  else if (c.localName === 'schemeClr') { const k = at(c, 'val'); hex = theme[k] || theme[SCHEME[k]] || null; }
  else if (c.localName === 'prstClr') hex = at(c, 'val') === 'white' ? '#ffffff' : '#000000';
  return hex && /^#[0-9a-f]{6}$/i.test(hex) ? adjust(hex, c) : null;
}
const solid = (spPr, theme) => { const f = kid(spPr, 'solidFill'); return f ? colorOf(f, theme) : null; };

/* ---- geometry */
export const SHAPE_TAGS = ['sp', 'pic', 'graphicFrame', 'cxnSp'];
export const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
/** Every drawable element of a shape tree in document order (groups are flattened). The index in this list is the shape's `xi`. */
export function flatShapes(treeEl, out = []) {
  kids(treeEl).forEach((el) => { if (el.localName === 'grpSp') flatShapes(el, out); else if (SHAPE_TAGS.includes(el.localName)) out.push(el); });
  return out;
}
export function xfrmOf(spPr) {
  const x = kid(spPr, 'xfrm'); if (!x) return null;
  const off = kid(x, 'off'); const ext = kid(x, 'ext'); if (!off || !ext) return null;
  return { x: num(at(off, 'x')), y: num(at(off, 'y')), w: num(at(ext, 'cx')), h: num(at(ext, 'cy')), rot: num(at(x, 'rot')) / 60000, flipH: at(x, 'flipH') === '1', flipV: at(x, 'flipV') === '1' };
}
export const phOf = (el) => { const ph = walk(el, 'nvSpPr', 'nvPr', 'ph') || walk(el, 'nvPicPr', 'nvPr', 'ph'); return ph ? { type: at(ph, 'type') || 'body', idx: at(ph, 'idx') } : null; };
export const tree = (doc) => walk(Array.from(doc.getElementsByTagNameNS('*', 'cSld'))[0], 'spTree');
const sameKind = (a, b) => { const g = (t) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' ? 'body' : t); return g(a) === g(b); };
function findPh(shapes, ph) {
  if (!ph) return null;
  return shapes.find((s) => s.ph && ph.idx !== null && s.ph.idx === ph.idx && sameKind(s.ph.type, ph.type)) || shapes.find((s) => s.ph && sameKind(s.ph.type, ph.type)) || null;
}
function phShapes(treeEl) { return kids(treeEl, 'sp').map((sp) => ({ ph: phOf(sp), xfrm: xfrmOf(kid(sp, 'spPr')), el: sp })).filter((s) => s.ph); }

/* ---- fills & lines */
function fillOf(spPr, th, el) {
  if (kid(spPr, 'noFill')) return { c: null };
  const sf = kid(spPr, 'solidFill'); if (sf) return { c: colorOf(sf, th) };
  const gf = kid(spPr, 'gradFill');
  if (gf) {
    const stops = kids(kid(gf, 'gsLst'), 'gs').map((g) => ({ pos: num(at(g, 'pos')) / 1000, c: colorOf(g, th) })).filter((g) => g.c);
    const lin = kid(gf, 'lin');
    if (stops.length) return { c: stops[0].c, grad: { stops, angle: lin ? num(at(lin, 'ang')) / 60000 : 90 } };
  }
  const ref = walk(el, 'style', 'fillRef'); if (ref && at(ref, 'idx') !== '0') return { c: colorOf(ref, th) };
  return { c: null };
}
function lineOf(spPr, th, el) {
  const ln = kid(spPr, 'ln'); if (ln && kid(ln, 'noFill')) return null;
  let color = ln && kid(ln, 'solidFill') ? colorOf(kid(ln, 'solidFill'), th) : null; let w = ln ? num(at(ln, 'w'), 0) : 0;
  if (!color) { const ref = walk(el, 'style', 'lnRef'); if (ref && at(ref, 'idx') !== '0') { color = colorOf(ref, th); if (!w) w = 12700; } }
  if (!color) return null;
  const end = (n) => { const t = at(kid(ln, n), 'type'); return t && t !== 'none' ? t : null; };
  return { color, w: w || 12700, head: ln ? end('headEnd') : null, tail: ln ? end('tailEnd') : null, dash: at(kid(ln, 'prstDash'), 'val') || null };
}

/* ---- text */
function defaultSz(ph, lvl, layoutPh, masterEl) {
  const lay = layoutPh && walk(layoutPh.el, 'txBody', 'lstStyle', `lvl${lvl + 1}pPr`);
  const l1 = lay && walk(lay, 'defRPr'); if (l1 && at(l1, 'sz')) return num(at(l1, 'sz'));
  const st = walk(masterEl, 'txStyles'); const group = !ph ? 'otherStyle' : /title/i.test(ph.type) ? 'titleStyle' : 'bodyStyle';
  const d = walk(st, group, `lvl${lvl + 1}pPr`, 'defRPr'); return d && at(d, 'sz') ? num(at(d, 'sz')) : 1800;
}
const tri = (v) => (v === '1' || v === 'true' ? true : v === '0' || v === 'false' ? false : null);
const runProps = (rPr, th) => ({
  b: tri(at(rPr, 'b')), i: tri(at(rPr, 'i')), u: !!at(rPr, 'u') && at(rPr, 'u') !== 'none', st: !!at(rPr, 'strike') && at(rPr, 'strike') !== 'noStrike',
  sz: at(rPr, 'sz') ? num(at(rPr, 'sz')) : null, color: kid(rPr, 'solidFill') ? colorOf(kid(rPr, 'solidFill'), th) : null, font: at(kid(rPr, 'latin'), 'typeface') || null,
});
/** Sizes are the raw hundredths of a point; `fs` is the autofit font scale the viewer multiplies by. */
export function readParas(txBody, ctx) {
  const bodyPr = kid(txBody, 'bodyPr'); const fs = num(at(walk(bodyPr, 'normAutofit'), 'fontScale'), 100000) / 100000;
  const paras = kids(txBody, 'p').map((p) => {
    const pPr = kid(p, 'pPr'); const lvl = num(at(pPr, 'lvl'));
    const endRPr = kid(p, 'endParaRPr'); const end = endRPr ? runProps(endRPr, ctx.theme) : {};
    const base = defaultSz(ctx.ph, lvl, ctx.layoutPh, ctx.master);
    const noBullet = !!kid(pPr, 'buNone'); const bu = kid(pPr, 'buChar'); const num_ = kid(pPr, 'buAutoNum');
    const bullet = noBullet ? '' : bu ? at(bu, 'char') : num_ ? '#' : (ctx.ph && /^(body|obj)$/i.test(ctx.ph.type) && ctx.ph.idx !== null ? '•' : (ctx.ph && /^body$/i.test(ctx.ph.type) ? '•' : ''));
    const runs = [];
    kids(p).forEach((r) => {
      if (r.localName === 'br') { runs.push({ t: '\n' }); return; }
      if (r.localName !== 'r' && r.localName !== 'fld') return;
      runs.push({ t: kid(r, 't')?.textContent || '', ...runProps(kid(r, 'rPr'), ctx.theme) });
    });
    const algn = at(pPr, 'algn'); const rtl = at(pPr, 'rtl') === '1' || (!runs.length ? false : /[\u0590-\u08FF]/.test(runs.map((r) => r.t).join('')));
    const sp = num(at(walk(pPr, 'lnSpc', 'spcPct'), 'val'), 0) / 1000;
    return { algn: algn || (ctx.ph && ctx.ph.type === 'ctrTitle' ? 'ctr' : null), lvl, bullet, rtl, sz: end.sz || base, end, mar: num(at(pPr, 'marL')), lnSpc: sp || null, runs, text: runs.map((r) => r.t).join('') };
  });
  return { paras, fs, anchor: at(bodyPr, 'anchor') || (ctx.ph && /title/i.test(ctx.ph.type) ? 'ctr' : 't'), ins: [num(at(bodyPr, 'lIns'), 91440), num(at(bodyPr, 'tIns'), 45720), num(at(bodyPr, 'rIns'), 91440), num(at(bodyPr, 'bIns'), 45720)], wrap: at(bodyPr, 'wrap') !== 'none' };
}

/* ---- slide */
function readShapes(treeEl, ctx, map, out, tbIndex) {
  kids(treeEl).forEach((el) => {
    const n = el.localName;
    if (n === 'grpSp') {
      const gx = kid(kid(el, 'grpSpPr'), 'xfrm'); let m2 = map;
      if (gx) {
        const off = kid(gx, 'off'); const ext = kid(gx, 'ext'); const co = kid(gx, 'chOff'); const ce = kid(gx, 'chExt');
        const sx = num(at(ext, 'cx')) / (num(at(ce, 'cx')) || 1); const sy = num(at(ext, 'cy')) / (num(at(ce, 'cy')) || 1);
        const ox = num(at(off, 'x')); const oy = num(at(off, 'y')); const cx0 = num(at(co, 'x')); const cy0 = num(at(co, 'y'));
        m2 = (r) => map({ ...r, x: ox + (r.x - cx0) * sx, y: oy + (r.y - cy0) * sy, w: r.w * sx, h: r.h * sy });
      }
      readShapes(el, { ...ctx, grouped: true }, m2, out, tbIndex); return;
    }
    if (!SHAPE_TAGS.includes(n)) return;
    const spPr = kid(el, 'spPr') || kid(el, 'xfrm'); const ph = phOf(el);
    let rect = n === 'graphicFrame' ? (() => { const x = kid(el, 'xfrm'); const o = kid(x, 'off'); const e = kid(x, 'ext'); return o && e ? { x: num(at(o, 'x')), y: num(at(o, 'y')), w: num(at(e, 'cx')), h: num(at(e, 'cy')), rot: 0 } : null; })() : xfrmOf(spPr);
    const layoutPh = ph ? findPh(ctx.layoutPhs, ph) : null; const masterPh = ph ? findPh(ctx.masterPhs, ph) : null;
    if (!rect && ph) rect = layoutPh?.xfrm || masterPh?.xfrm || null;
    if (!rect) return;
    rect = map(rect);
    const nv = el.getElementsByTagNameNS('*', 'cNvPr')[0];
    const base = { x: rect.x, y: rect.y, w: rect.w, h: rect.h, rot: rect.rot || 0, flipH: !!rect.flipH, flipV: !!rect.flipV, ph, xi: ctx.xi.get(el), grouped: !!ctx.grouped, name: at(nv, 'name') || '', id: at(nv, 'id') };
    if (n === 'pic') {
      const bl = walk(el, 'blipFill', 'blip'); const rid = bl && (bl.getAttributeNS(NS_R, 'embed') || at(bl, 'r:embed'));
      const rel = ctx.rels[rid]; const f = rel && ctx.files[rel.target];
      const ext = (rel?.target.split('.').pop() || '').toLowerCase(); const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' }[ext];
      const sr = walk(el, 'blipFill', 'srcRect'); const pc = (k) => num(at(sr, k)) / 100000;
      const crop = sr ? { l: pc('l'), t: pc('t'), r: pc('r'), b: pc('b') } : null;
      if (f && mime) out.push({ ...base, kind: 'pic', url: ctx.url(f, mime), crop, alt: at(nv, 'descr') || '' });
      return;
    }
    if (n === 'graphicFrame') {
      const tbl = Array.from(el.getElementsByTagNameNS('*', 'tbl'))[0]; if (!tbl) return;
      const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => num(at(g, 'w')));
      const rows = kids(tbl, 'tr').map((tr) => ({ h: num(at(tr, 'h')), cells: kids(tr, 'tc').map((tc) => {
        const tb = kid(tc, 'txBody'); const k = tb ? tbIndex.get(tb) : null; const tcPr = kid(tc, 'tcPr');
        return { k, fill: solid(tcPr, ctx.theme), span: num(at(tc, 'gridSpan'), 1), skip: at(tc, 'hMerge') === '1' || at(tc, 'vMerge') === '1', rspan: num(at(tc, 'rowSpan'), 1), text: tb ? readParas(tb, { ...ctx, ph: null, layoutPh: null }) : { paras: [], fs: 1, anchor: 't', ins: [91440, 45720, 91440, 45720] } };
      }) }));
      out.push({ ...base, kind: 'table', cols, rows, firstRow: !!at(kid(tbl, 'tblPr'), 'firstRow'), accent: ctx.theme.accent1 || '#4472C4' }); return;
    }
    const tb = kid(el, 'txBody'); const fl = fillOf(spPr, ctx.theme, el); const line = lineOf(spPr, ctx.theme, el);
    const geom = at(kid(spPr, 'prstGeom'), 'prst') || (kid(spPr, 'custGeom') ? 'custom' : null);
    const text = tb ? readParas(tb, { ...ctx, ph, layoutPh }) : null;
    const hasText = text && text.paras.some((p) => p.text.trim());
    if (!hasText && !fl.c && !line && !(tb && ph) && !(tb && at(kid(el, 'nvSpPr') && walk(el, 'nvSpPr', 'cNvSpPr'), 'txBox') === '1')) return;
    out.push({ ...base, kind: 'shape', k: tb ? tbIndex.get(tb) : null, fill: fl.c, grad: fl.grad || null, line, geom, text, editable: true, isLine: n === 'cxnSp' || /^(line|straightConnector1)$/.test(geom || ''), txBox: at(walk(el, 'nvSpPr', 'cNvSpPr'), 'txBox') === '1' });
  });
}

export function layoutsOf(files) {
  return Object.keys(files).filter((k) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(k)).sort((a, b) => num(a.match(/(\d+)\.xml$/)[1]) - num(b.match(/(\d+)\.xml$/)[1]))
    .map((path) => { const d = parseXml(strFromU8(files[path])); const c = Array.from(d.getElementsByTagNameNS('*', 'cSld'))[0]; return { path, name: at(c, 'name') || path.split('/').pop() }; });
}

/** A session keeps image object-URLs and parsed slides alive between edits so only changed slides are re-read. */
export function createSession() {
  const urls = new Set(); const byBytes = new WeakMap(); const slides = new WeakMap();
  return {
    url(bytes, mime) { let u = byBytes.get(bytes); if (!u) { u = URL.createObjectURL(new Blob([bytes], { type: mime })); byBytes.set(bytes, u); urls.add(u); } return u; },
    slides,
    revoke() { urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear(); },
  };
}

export function loadDeck(files, session = createSession()) {
  if (!files['ppt/presentation.xml']) throw new Error('Not a PowerPoint file.');
  const pres = parseXml(strFromU8(files['ppt/presentation.xml']));
  const sz = Array.from(pres.getElementsByTagNameNS('*', 'sldSz'))[0]; const cx = num(at(sz, 'cx'), 9144000); const cy = num(at(sz, 'cy'), 6858000);
  const prels = relsOf(files, 'ppt/presentation.xml'); const theme = themeColors(files);
  const ids = Array.from(pres.getElementsByTagNameNS('*', 'sldId')).filter((e) => e.parentNode.localName === 'sldIdLst' && e.parentNode.parentNode.localName === 'presentation').map((s) => s.getAttributeNS(NS_R, 'id') || s.getAttribute('r:id'));
  const cacheL = new Map(); const url = (b, m) => session.url(b, m);
  const slides = ids.map((rid, index) => {
    const path = prels[rid]?.target;
    if (!path || !files[path]) return { index, path, bg: '#fff', shapes: [] };
    const relsPath = `${path.slice(0, path.lastIndexOf('/') + 1)}_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`;
    const hit = session.slides.get(files[path]);
    if (hit && hit.rels === files[relsPath]) return hit.res.index === index ? hit.res : { ...hit.res, index };
    const doc = parseXml(strFromU8(files[path])); const rels = relsOf(files, path);
    const layoutPath = Object.values(rels).find((r) => /slideLayout$/.test(r.type))?.target;
    let layoutPhs = []; let masterPhs = []; let master = null; let layoutBg = null; let baseTheme = mapTheme(theme, null);
    if (layoutPath && files[layoutPath]) {
      if (!cacheL.has(layoutPath)) {
        const ld = parseXml(strFromU8(files[layoutPath])); const lr = relsOf(files, layoutPath);
        const mp = Object.values(lr).find((r) => /slideMaster$/.test(r.type))?.target; const md = mp && files[mp] ? parseXml(strFromU8(files[mp])) : null;
        const th = mapTheme(theme, md ? kid(md.documentElement, 'clrMap') : null);
        cacheL.set(layoutPath, { lph: phShapes(tree(ld)), mph: md ? phShapes(tree(md)) : [], master: md ? md.documentElement : null, th, bg: bgOf(ld, th, files, lr, url) || (md ? bgOf(md, th, files, relsOf(files, mp), url) : null) });
      }
      const L = cacheL.get(layoutPath); layoutPhs = L.lph; masterPhs = L.mph; master = L.master; layoutBg = L.bg; baseTheme = L.th;
    }
    const root = tree(doc);
    const ov = Array.from(doc.getElementsByTagNameNS('*', 'overrideClrMapping'))[0]; const th = ov ? mapTheme(theme, ov) : baseTheme;
    const tbIndex = new Map(); Array.from(doc.getElementsByTagNameNS('*', 'txBody')).forEach((tb, i) => tbIndex.set(tb, i));
    const xi = new Map(); flatShapes(root).forEach((el, i) => xi.set(el, i));
    const shapes = []; readShapes(root, { files, rels, theme: th, layoutPhs, masterPhs, master, url, xi }, (r) => r, shapes, tbIndex);
    const res = { index, path, layoutPath, bg: bgOf(doc, th, files, rels, url) || layoutBg || '#ffffff', fg: th.tx1 || '#000000', hasBg: !!Array.from(doc.getElementsByTagNameNS('*', 'bg'))[0], shapes };
    session.slides.set(files[path], { rels: files[relsPath], res });
    return res;
  });
  return { files, cx, cy, slides, theme, layouts: layoutsOf(files) };
}

export async function loadPptx(buf) {
  const session = createSession();
  const deck = loadDeck(unzipSync(new Uint8Array(buf)), session);
  return { ...deck, revoke: () => session.revoke() };
}
export function mapTheme(theme, map) {
  const th = { ...theme };
  ['bg1', 'tx1', 'bg2', 'tx2'].forEach((k) => { const to = (map && at(map, k)) || SCHEME[k]; if (theme[to]) th[k] = theme[to]; });
  return th;
}
export function bgOf(doc, th, files, rels, url) {
  const bg = Array.from(doc.getElementsByTagNameNS('*', 'bg'))[0]; if (!bg) return null;
  const pr = kid(bg, 'bgPr');
  if (pr) {
    const c = solid(pr, th); if (c) return c;
    const g = kid(pr, 'gradFill');
    if (g) { const gs = kids(kid(g, 'gsLst'), 'gs').map((x) => colorOf(x, th)).filter(Boolean); if (gs.length) return gs.length > 1 ? `linear-gradient(180deg, ${gs[0]}, ${gs[gs.length - 1]})` : gs[0]; }
    const b = kid(pr, 'blipFill');
    if (b) {
      const bl = kid(b, 'blip'); const rid = bl && (bl.getAttributeNS(NS_R, 'embed') || at(bl, 'r:embed'));
      const rel = rels[rid]; const f = rel && files[rel.target]; const ext = (rel?.target.split('.').pop() || '').toLowerCase();
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[ext];
      if (f && mime) return `center / cover no-repeat url("${url(f, mime)}")`;
    }
    return null;
  }
  const ref = kid(bg, 'bgRef'); return ref ? colorOf(ref, th) : null;
}
