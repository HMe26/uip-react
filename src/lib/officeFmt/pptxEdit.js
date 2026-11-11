/**
 * PowerPoint (.pptx) editing operations. Each one takes the package `files` ({ path: Uint8Array }) and returns a NEW files
 * object ({ files, xi? }) in which only the parts it touched are new — so history snapshots are cheap and everything else
 * in the file (themes, animations, media, notes…) is carried over byte-for-byte.
 * Shapes are addressed by `xi` (their index in flatShapes(slide tree)); text bodies by a target: { xi } or { xi, r, c } for a table cell.
 */
import { strFromU8, strToU8 } from 'fflate';
import { NS_R, at, flatShapes, kid, kids, num, parseXml, relsOf, tree, walk } from './pptx';

export const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const T = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT_SLIDE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const CT_NOTES = 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_DECL = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`;
export const EMU_IN = 914400;

/* ───────────────────────────── plumbing ───────────────────────────── */
const ser = (doc) => strToU8(DECL + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, ''));
const read = (files, path) => parseXml(strFromU8(files[path]));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ee = (doc, q, attrs = {}, ...ch) => {
  const e = doc.createElementNS(q.startsWith('p:') ? NS_P : NS_A, q);
  Object.entries(attrs).forEach(([k, v]) => { if (v !== undefined && v !== null) e.setAttribute(k, String(v)); });
  ch.forEach((c) => c && e.appendChild(c)); return e;
};
const hex6 = (c) => String(c).replace('#', '').toUpperCase();
const fillEl = (doc, hex) => (hex ? ee(doc, 'a:solidFill', {}, ee(doc, 'a:srgbClr', { val: hex6(hex) })) : ee(doc, 'a:noFill'));
/** Parse a fragment of XML that uses the a:/p:/r: prefixes into a node owned by `doc`. */
const frag = (doc, xml) => doc.importNode(parseXml(`<x ${NS_DECL}>${xml}</x>`).documentElement.firstElementChild, true);
function insertOrdered(parent, child, order) {
  const idx = order.indexOf(child.localName);
  parent.insertBefore(child, kids(parent).find((c) => order.indexOf(c.localName) > idx) || null);
}
function mutate(files, path, fn) {
  const doc = read(files, path); const out = fn(doc);
  return { files: { ...files, [path]: ser(doc) }, ...(out && typeof out === 'object' ? out : {}) };
}
const FILL_TAGS = ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'];
const SPPR = ['xfrm', 'custGeom', 'prstGeom', ...FILL_TAGS, 'ln', 'effectLst', 'effectDag', 'scene3d', 'sp3d', 'extLst'];
const LN = ['noFill', 'solidFill', 'gradFill', 'pattFill', 'prstDash', 'custDash', 'round', 'bevel', 'miter', 'headEnd', 'tailEnd', 'extLst'];
const RPR = ['ln', ...FILL_TAGS, 'effectLst', 'effectDag', 'highlight', 'uLnTx', 'uLn', 'uFillTx', 'uFill', 'latin', 'ea', 'cs', 'sym', 'hlinkClick', 'hlinkMouseOver', 'rtl', 'extLst'];
const PPR = ['lnSpc', 'spcBef', 'spcAft', 'buClrTx', 'buClr', 'buSzTx', 'buSzPct', 'buSzPts', 'buFontTx', 'buFont', 'buNone', 'buAutoNum', 'buChar', 'buBlip', 'tabLst', 'defRPr', 'extLst'];
const TCPR = ['lnL', 'lnR', 'lnT', 'lnB', 'lnTlToBr', 'lnBlToTr', 'cell3D', ...FILL_TAGS, 'headers', 'extLst'];

const nextNum = (files, re) => Math.max(0, ...Object.keys(files).map((k) => (k.match(re) ? num(k.match(re)[1]) : 0))) + 1;
const nextId = (doc) => Math.max(1, ...Array.from(doc.getElementsByTagNameNS('*', 'cNvPr')).map((e) => num(at(e, 'id')))) + 1;
export function slideSize(files) {
  const sz = Array.from(read(files, 'ppt/presentation.xml').getElementsByTagNameNS('*', 'sldSz'))[0];
  return { cx: num(at(sz, 'cx'), 9144000), cy: num(at(sz, 'cy'), 6858000) };
}
const shapeAt = (doc, xi) => { const s = flatShapes(tree(doc))[xi]; if (!s) throw new Error('Shape not found.'); return s; };
const GROUP_MSG = 'This object is inside a group. Ungroup it in PowerPoint to move or resize it.';
const spTreeOf = (doc) => tree(doc);
const appendShape = (doc, node) => { const t = spTreeOf(doc); t.insertBefore(node, kids(t, 'extLst')[0] || null); return flatShapes(t).indexOf(node); };
const nvName = (sh) => sh.getElementsByTagNameNS('*', 'cNvPr')[0];

/* ───────────────────────── relationships & content types ───────────────────────── */
const relsPathOf = (p) => `${p.slice(0, p.lastIndexOf('/') + 1)}_rels/${p.slice(p.lastIndexOf('/') + 1)}.rels`;
const relative = (from, to) => {
  const a = from.split('/').slice(0, -1); const b = to.split('/');
  while (a.length && b.length > 1 && a[0] === b[0]) { a.shift(); b.shift(); }
  return [...a.map(() => '..'), ...b].join('/');
};
function relsDoc(files, path) {
  const rp = relsPathOf(path);
  return files[rp] ? read(files, rp) : parseXml(`<Relationships xmlns="${NS_REL}"/>`);
}
function addRel(files, ownerPath, type, target) {
  const doc = relsDoc(files, ownerPath); const rel = relative(ownerPath, target);
  const all = Array.from(doc.getElementsByTagNameNS('*', 'Relationship'));
  const hit = all.find((r) => at(r, 'Type') === type && at(r, 'Target') === rel);
  if (hit) return { files, id: at(hit, 'Id') };
  const id = `rId${Math.max(0, ...all.map((r) => num((at(r, 'Id') || '').replace(/\D/g, '')))) + 1}`;
  const r = doc.createElementNS(NS_REL, 'Relationship'); r.setAttribute('Id', id); r.setAttribute('Type', type); r.setAttribute('Target', rel);
  doc.documentElement.appendChild(r);
  return { files: { ...files, [relsPathOf(ownerPath)]: ser(doc) }, id };
}
function ctEdit(files, fn) { const doc = read(files, '[Content_Types].xml'); fn(doc, (n, o) => { const e = doc.createElementNS(NS_CT, n); Object.entries(o).forEach(([k, v]) => e.setAttribute(k, v)); doc.documentElement.appendChild(e); return e; }); return { ...files, '[Content_Types].xml': ser(doc) }; }
const addOverride = (files, part, ct) => ctEdit(files, (d, mk) => { if (!Array.from(d.getElementsByTagNameNS('*', 'Override')).some((o) => at(o, 'PartName') === part)) mk('Override', { PartName: part, ContentType: ct }); });
const removeOverride = (files, part) => ctEdit(files, (d) => { Array.from(d.getElementsByTagNameNS('*', 'Override')).filter((o) => at(o, 'PartName') === part).forEach((o) => o.remove()); });
const ensureDefault = (files, ext, ct) => ctEdit(files, (d, mk) => { if (!Array.from(d.getElementsByTagNameNS('*', 'Default')).some((o) => (at(o, 'Extension') || '').toLowerCase() === ext)) mk('Default', { Extension: ext, ContentType: ct }); });
const without = (files, ...keys) => { const o = { ...files }; keys.forEach((k) => delete o[k]); return o; };

/* ───────────────────────────── geometry / appearance ───────────────────────────── */
function xfrmEl(doc, sh, create) {
  if (sh.localName === 'graphicFrame') {
    let x = kid(sh, 'xfrm');
    if (!x && create) { x = ee(doc, 'p:xfrm'); sh.insertBefore(x, kid(sh, 'nvGraphicFramePr').nextSibling); }
    return x;
  }
  let spPr = kid(sh, 'spPr');
  if (!spPr && create) { spPr = ee(doc, 'p:spPr'); sh.insertBefore(spPr, kids(sh)[1] || null); }
  let x = spPr && kid(spPr, 'xfrm');
  if (!x && create) { x = ee(doc, 'a:xfrm'); spPr.insertBefore(x, spPr.firstChild); }
  return x;
}
export function setRect(files, path, xi, r) {
  return mutate(files, path, (doc) => {
    const sh = shapeAt(doc, xi); if (sh.parentNode.localName === 'grpSp') throw new Error(GROUP_MSG);
    const x = xfrmEl(doc, sh, true);
    if (r.rot !== undefined) { const v = Math.round((((r.rot % 360) + 360) % 360) * 60000); if (v) x.setAttribute('rot', String(v)); else x.removeAttribute('rot'); }
    ['flipH', 'flipV'].forEach((k) => { if (r[k] !== undefined) { if (r[k]) x.setAttribute(k, '1'); else x.removeAttribute(k); } });
    let off = kid(x, 'off'); let ext = kid(x, 'ext');
    if (!off) { off = ee(doc, 'a:off', { x: 0, y: 0 }); x.insertBefore(off, x.firstChild); }
    if (!ext) { ext = ee(doc, 'a:ext', { cx: 0, cy: 0 }); off.after(ext); }
    const ow = num(at(ext, 'cx')); const oh = num(at(ext, 'cy'));
    if (r.x !== undefined) off.setAttribute('x', String(Math.round(r.x)));
    if (r.y !== undefined) off.setAttribute('y', String(Math.round(r.y)));
    if (r.w !== undefined) ext.setAttribute('cx', String(Math.max(0, Math.round(r.w))));
    if (r.h !== undefined) ext.setAttribute('cy', String(Math.max(0, Math.round(r.h))));
    if (sh.localName === 'graphicFrame') { // keep the table grid in step with its frame
      const tbl = sh.getElementsByTagNameNS('*', 'tbl')[0];
      if (tbl) {
        const nw = num(at(ext, 'cx')); const nh = num(at(ext, 'cy'));
        const cols = kids(kid(tbl, 'tblGrid'), 'gridCol'); const sw = cols.reduce((a, c) => a + num(at(c, 'w')), 0) || ow || 1;
        cols.forEach((c) => c.setAttribute('w', String(Math.round((num(at(c, 'w')) * nw) / sw))));
        const rows = kids(tbl, 'tr'); const sh2 = rows.reduce((a, c) => a + num(at(c, 'h')), 0) || oh || 1;
        rows.forEach((c) => c.setAttribute('h', String(Math.round((num(at(c, 'h')) * nh) / sh2))));
      }
    }
  });
}
export function setFill(files, path, xi, fill) { // fill: '#hex' | null (no fill) | { grad: { c1, c2, angle } }
  return mutate(files, path, (doc) => {
    const sh = shapeAt(doc, xi); let spPr = kid(sh, 'spPr'); if (!spPr) throw new Error('This object has no fill.');
    kids(spPr).filter((c) => FILL_TAGS.includes(c.localName)).forEach((c) => c.remove());
    let f;
    if (fill && fill.grad) {
      f = ee(doc, 'a:gradFill', { rotWithShape: 1 }, ee(doc, 'a:gsLst', {}, ee(doc, 'a:gs', { pos: 0 }, ee(doc, 'a:srgbClr', { val: hex6(fill.grad.c1) })), ee(doc, 'a:gs', { pos: 100000 }, ee(doc, 'a:srgbClr', { val: hex6(fill.grad.c2) }))), ee(doc, 'a:lin', { ang: Math.round((fill.grad.angle || 0) * 60000), scaled: 0 }));
    } else f = fillEl(doc, fill);
    insertOrdered(spPr, f, SPPR);
  });
}
export function setLine(files, path, xi, o) { // o: { color: '#hex'|null, w (EMU), dash, head, tail }
  return mutate(files, path, (doc) => {
    const sh = shapeAt(doc, xi); const spPr = kid(sh, 'spPr'); if (!spPr) throw new Error('This object has no outline.');
    let ln = kid(spPr, 'ln'); if (!ln) { ln = ee(doc, 'a:ln'); insertOrdered(spPr, ln, SPPR); }
    if ('color' in o) {
      kids(ln).filter((c) => ['noFill', 'solidFill', 'gradFill', 'pattFill'].includes(c.localName)).forEach((c) => c.remove());
      insertOrdered(ln, fillEl(doc, o.color), LN);
      if (o.color && !at(ln, 'w')) ln.setAttribute('w', '12700');
    }
    if (o.w != null) ln.setAttribute('w', String(Math.round(o.w)));
    if ('dash' in o) { kids(ln, 'prstDash').forEach((c) => c.remove()); if (o.dash && o.dash !== 'solid') insertOrdered(ln, ee(doc, 'a:prstDash', { val: o.dash }), LN); }
    ['head', 'tail'].forEach((k) => {
      if (!(k in o)) return;
      kids(ln, `${k}End`).forEach((c) => c.remove());
      if (o[k]) insertOrdered(ln, ee(doc, `a:${k}End`, { type: o[k], w: 'med', len: 'med' }), LN);
    });
  });
}
export function setBackground(files, path, hex) {
  return mutate(files, path, (doc) => {
    const cSld = Array.from(doc.getElementsByTagNameNS('*', 'cSld'))[0];
    kids(cSld, 'bg').forEach((b) => b.remove());
    if (hex) cSld.insertBefore(ee(doc, 'p:bg', {}, ee(doc, 'p:bgPr', {}, fillEl(doc, hex), ee(doc, 'a:effectLst'))), cSld.firstChild);
  });
}

/* ───────────────────────────── shapes: delete / duplicate / copy / paste / order ───────────────────────────── */
export const deleteShape = (files, path, xi) => mutate(files, path, (doc) => { shapeAt(doc, xi).remove(); });
function placeClone(doc, sh, c, dx, dy, rect) {
  nvName(c).setAttribute('id', String(nextId(doc)));
  kids(kid(c, 'nvSpPr') && kid(kid(c, 'nvSpPr'), 'nvPr'), 'ph').forEach((p) => p.remove());
  const x = xfrmEl(doc, c, true);
  let off = kid(x, 'off'); let ext = kid(x, 'ext');
  if (!off) { off = ee(doc, 'a:off', { x: 0, y: 0 }); x.insertBefore(off, x.firstChild); }
  if (!ext) { ext = ee(doc, 'a:ext', { cx: rect.w, cy: rect.h }); off.after(ext); }
  off.setAttribute('x', String(Math.round((rect.x ?? num(at(off, 'x'))) + dx))); off.setAttribute('y', String(Math.round((rect.y ?? num(at(off, 'y'))) + dy)));
  if (!at(ext, 'cx') || at(ext, 'cx') === '0') ext.setAttribute('cx', String(Math.round(rect.w)));
}
export function duplicateShape(files, path, xi, rect) {
  return mutate(files, path, (doc) => {
    const sh = shapeAt(doc, xi); if (sh.parentNode.localName === 'grpSp') throw new Error(GROUP_MSG);
    const c = sh.cloneNode(true); placeClone(doc, sh, c, 228600, 228600, rect);
    sh.parentNode.insertBefore(c, sh.nextSibling);
    return { xi: flatShapes(tree(doc)).indexOf(c) };
  });
}
/** Serialise a shape (plus the relationship targets it needs, e.g. its image) so it can be pasted on any slide. */
export function copyShape(files, path, xi, rect) {
  const doc = read(files, path); const sh = shapeAt(doc, xi); const rels = relsOf(files, path); const used = {};
  const scan = (e) => { Array.from(e.attributes).forEach((a) => { if (a.namespaceURI === NS_R && rels[a.value]) used[a.value] = rels[a.value]; }); kids(e).forEach(scan); };
  scan(sh);
  return { xml: new XMLSerializer().serializeToString(sh), rect, rels: used };
}
export function pasteShape(files, path, clip, nudge = 1) {
  let cur = files; const map = {};
  Object.entries(clip.rels).forEach(([id, r]) => { const out = addRel(cur, path, r.type, r.target); cur = out.files; map[id] = out.id; });
  const res = mutate(cur, path, (doc) => {
    const c = doc.importNode(parseXml(clip.xml).documentElement, true);
    const remap = (e) => { Array.from(e.attributes).forEach((a) => { if (a.namespaceURI === NS_R && map[a.value]) a.value = map[a.value]; }); kids(e).forEach(remap); };
    remap(c); placeClone(doc, c, c, 228600 * nudge, 228600 * nudge, clip.rect);
    return { xi: appendShape(doc, c) };
  });
  return res;
}
const SH_TAGS = ['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp'];
export function reorder(files, path, xi, dir) {
  return mutate(files, path, (doc) => {
    const sh = shapeAt(doc, xi); const par = sh.parentNode;
    if (par.localName !== 'spTree') throw new Error(GROUP_MSG);
    const sib = kids(par).filter((c) => SH_TAGS.includes(c.localName)); const i = sib.indexOf(sh);
    if (dir === 'front') par.insertBefore(sh, kids(par, 'extLst')[0] || null);
    else if (dir === 'back') par.insertBefore(sh, sib[0]);
    else if (dir === 'forward' && sib[i + 1]) sib[i + 1].after(sh);
    else if (dir === 'backward' && sib[i - 1]) sib[i - 1].before(sh);
    return { xi: flatShapes(tree(doc)).indexOf(sh) };
  });
}

/* ───────────────────────────── inserting objects ───────────────────────────── */
const centered = (files, w, h) => { const { cx, cy } = slideSize(files); return { x: Math.round((cx - w) / 2), y: Math.round((cy - h) / 2), w, h }; };
const xfrmXml = (r, extra = '') => `<a:xfrm${extra}><a:off x="${Math.round(r.x)}" y="${Math.round(r.y)}"/><a:ext cx="${Math.round(r.w)}" cy="${Math.round(r.h)}"/></a:xfrm>`;
export function addTextBox(files, path, text = 'Text') {
  const r = centered(files, 3200400, 461000);
  return mutate(files, path, (doc) => {
    const id = nextId(doc);
    const n = frag(doc, `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="TextBox ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrmXml(r)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${esc(text)}</a:t></a:r></a:p></p:txBody></p:sp>`);
    return { xi: appendShape(doc, n) };
  });
}
export function addShape(files, path, geom, { fill = '#4472C4', line = '#2F528F', arrow = false } = {}) {
  const isLine = geom === 'line' || geom === 'arrow';
  const r = isLine ? centered(files, 2743200, 0) : centered(files, 2286000, 1371600);
  return mutate(files, path, (doc) => {
    const id = nextId(doc);
    if (isLine) {
      const n = frag(doc, `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${geom === 'arrow' ? 'Arrow' : 'Line'} ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrmXml(r)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="28575"><a:solidFill><a:srgbClr val="404040"/></a:solidFill>${geom === 'arrow' || arrow ? '<a:tailEnd type="triangle" w="med" len="med"/>' : ''}</a:ln></p:spPr></p:cxnSp>`);
      return { xi: appendShape(doc, n) };
    }
    const n = frag(doc, `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrmXml(r)}<a:prstGeom prst="${esc(geom)}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${hex6(fill)}"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="${hex6(line)}"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:endParaRPr lang="en-US" sz="1800"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:endParaRPr></a:p></p:txBody></p:sp>`);
    return { xi: appendShape(doc, n) };
  });
}
const MIME_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };
export function addImage(files, path, { bytes, ext, w, h, name = 'Picture' }) {
  const e = ext.toLowerCase(); if (!MIME_EXT[e]) throw new Error('Use a PNG, JPG or GIF image.');
  const media = `ppt/media/image${nextNum(files, /^ppt\/media\/image(\d+)\./)}.${e}`;
  let f = ensureDefault({ ...files, [media]: bytes }, e, MIME_EXT[e]);
  const rel = addRel(f, path, `${T}/image`, media); f = rel.files;
  const { cx, cy } = slideSize(files); const k = Math.min((cx * 0.6) / w, (cy * 0.6) / h, 1e9);
  const r = centered(files, Math.round(w * k), Math.round(h * k));
  return mutate(f, path, (doc) => {
    const id = nextId(doc);
    const n = frag(doc, `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${esc(name)} ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rel.id}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrmXml(r)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
    return { xi: appendShape(doc, n) };
  });
}
const cellXml = (head, accent) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US" sz="1400"${head ? ' b="1"' : ''}>${head ? '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>' : ''}</a:endParaRPr></a:p></a:txBody><a:tcPr>${['L', 'R', 'T', 'B'].map((s) => `<a:ln${s} w="12700"><a:solidFill><a:srgbClr val="9CA3AF"/></a:solidFill></a:ln${s}>`).join('')}${head ? `<a:solidFill><a:srgbClr val="${accent}"/></a:solidFill>` : ''}</a:tcPr></a:tc>`;
export function addTable(files, path, rows = 3, cols = 3, accent = '4472C4') {
  const { cx } = slideSize(files); const w = Math.round(cx * 0.8); const rh = 370840; const r = centered(files, w, rh * rows);
  return mutate(files, path, (doc) => {
    const id = nextId(doc); const cw = Math.round(w / cols);
    const grid = Array.from({ length: cols }, () => `<a:gridCol w="${cw}"/>`).join('');
    const trs = Array.from({ length: rows }, (_, i) => `<a:tr h="${rh}">${Array.from({ length: cols }, () => cellXml(i === 0, accent)).join('')}</a:tr>`).join('');
    const n = frag(doc, `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${r.x}" y="${r.y}"/><a:ext cx="${cw * cols}" cy="${r.h}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${grid}</a:tblGrid>${trs}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`);
    return { xi: appendShape(doc, n) };
  });
}

/* ───────────────────────────── tables ───────────────────────────── */
function tblOf(doc, xi) {
  const t = shapeAt(doc, xi).getElementsByTagNameNS('*', 'tbl')[0]; if (!t) throw new Error('Select a table first.');
  if (Array.from(t.getElementsByTagNameNS('*', 'tc')).some((c) => at(c, 'gridSpan') || at(c, 'rowSpan') || at(c, 'hMerge') || at(c, 'vMerge'))) throw new Error('Tables with merged cells can only be restructured in PowerPoint.');
  return t;
}
const blankCell = (tc) => {
  const c = tc.cloneNode(true); const tb = kid(c, 'txBody');
  kids(tb, 'p').forEach((p, i) => { if (i) p.remove(); else { kids(p).filter((k) => k.localName !== 'pPr' && k.localName !== 'endParaRPr').forEach((k) => k.remove()); } });
  return c;
};
export function tableOp(files, path, xi, op, r, c) { // op: addRow | delRow | addCol | delCol  (r / c = the active cell)
  return mutate(files, path, (doc) => {
    const t = tblOf(doc, xi); const sh = shapeAt(doc, xi); const rows = kids(t, 'tr'); const grid = kid(t, 'tblGrid'); const gc = kids(grid, 'gridCol');
    if (op === 'addRow') { const src = rows[r]; const n = src.cloneNode(true); kids(n, 'tc').forEach((tc) => tc.replaceWith(blankCell(tc))); src.after(n); }
    if (op === 'delRow') { if (rows.length < 2) throw new Error('A table needs at least one row.'); rows[r].remove(); }
    if (op === 'addCol') {
      const w = num(at(gc[c], 'w')); const n = gc[c].cloneNode(true); gc[c].after(n);
      rows.forEach((tr) => { const tcs = kids(tr, 'tc'); tcs[c].after(blankCell(tcs[c])); });
      const all = kids(grid, 'gridCol'); const tot = all.reduce((a, g) => a + num(at(g, 'w')), 0); const want = tot - w;
      all.forEach((g) => g.setAttribute('w', String(Math.round((num(at(g, 'w')) * want) / tot))));
    }
    if (op === 'delCol') {
      if (gc.length < 2) throw new Error('A table needs at least one column.');
      const w = num(at(gc[c], 'w')); gc[c].remove(); rows.forEach((tr) => kids(tr, 'tc')[c].remove());
      const all = kids(grid, 'gridCol'); all.forEach((g) => g.setAttribute('w', String(Math.round(num(at(g, 'w')) + w / all.length))));
    }
    const ext = kid(kid(sh, 'xfrm'), 'ext');
    ext.setAttribute('cy', String(kids(t, 'tr').reduce((a, tr) => a + num(at(tr, 'h')), 0)));
    ext.setAttribute('cx', String(kids(grid, 'gridCol').reduce((a, g) => a + num(at(g, 'w')), 0)));
  });
}
export function setCellFill(files, path, xi, r, c, hex) {
  return mutate(files, path, (doc) => {
    const tc = kids(kids(shapeAt(doc, xi).getElementsByTagNameNS('*', 'tbl')[0], 'tr')[r], 'tc')[c];
    let pr = kid(tc, 'tcPr'); if (!pr) { pr = ee(doc, 'a:tcPr'); tc.appendChild(pr); }
    kids(pr).filter((k) => FILL_TAGS.includes(k.localName)).forEach((k) => k.remove());
    insertOrdered(pr, fillEl(doc, hex), TCPR);
  });
}

/* ───────────────────────────── text ───────────────────────────── */
function txBodies(doc, target) { // every text body a text command applies to
  const sh = shapeAt(doc, target.xi);
  if (target.r !== undefined) { const tr = kids(sh.getElementsByTagNameNS('*', 'tbl')[0], 'tr')[target.r]; const tb = kid(kids(tr, 'tc')[target.c], 'txBody'); return tb ? [tb] : []; }
  if (sh.localName === 'graphicFrame') return Array.from(sh.getElementsByTagNameNS('*', 'tc')).map((tc) => kid(tc, 'txBody')).filter(Boolean);
  const tb = kid(sh, 'txBody'); return tb ? [tb] : [];
}
function ensureTxBody(doc, target) {
  const have = txBodies(doc, target)[0]; if (have) return have;
  const sh = shapeAt(doc, target.xi);
  if (sh.localName !== 'sp') throw new Error('This object cannot hold text.');
  const tb = frag(doc, '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>');
  sh.insertBefore(tb, kids(sh, 'extLst')[0] || null); return tb;
}
const MANAGED_ATTR = ['b', 'i', 'u', 'strike', 'sz'];
const MANAGED_KIDS = ['noFill', 'solidFill', 'gradFill', 'latin', 'cs', 'hlinkClick', 'hlinkMouseOver'];
function applyRun(doc, rPr, p) { // p: { b, i, u, st, sz, color, font } — undefined/null = leave as is (callers clear first when rebuilding)
  if (p.b != null) rPr.setAttribute('b', p.b ? '1' : '0');
  if (p.i != null) rPr.setAttribute('i', p.i ? '1' : '0');
  if (p.u !== undefined && p.u !== null) { if (p.u) rPr.setAttribute('u', 'sng'); else rPr.removeAttribute('u'); }
  if (p.st !== undefined && p.st !== null) { if (p.st) rPr.setAttribute('strike', 'sngStrike'); else rPr.removeAttribute('strike'); }
  if (p.sz != null) rPr.setAttribute('sz', String(Math.max(100, Math.min(400000, Math.round(p.sz)))));
  if (p.color) { kids(rPr).filter((k) => FILL_TAGS.includes(k.localName)).forEach((k) => k.remove()); insertOrdered(rPr, fillEl(doc, p.color), RPR); }
  if (p.font) { ['latin', 'cs'].forEach((n) => { kids(rPr, n).forEach((k) => k.remove()); insertOrdered(rPr, ee(doc, `a:${n}`, { typeface: p.font }), RPR); }); }
}
const isRun = (c) => c.localName === 'r' || c.localName === 'fld';
/** Apply character formatting to every run of the target text (used when a whole shape is selected, not a text range). */
export function formatText(files, path, target, props) {
  return mutate(files, path, (doc) => {
    txBodies(doc, target).forEach((tb) => kids(tb, 'p').forEach((p) => {
      const runs = kids(p).filter(isRun);
      runs.forEach((r) => { let rp = kid(r, 'rPr'); if (!rp) { rp = ee(doc, 'a:rPr', { lang: 'en-US' }); r.insertBefore(rp, r.firstChild); } applyRun(doc, rp, props); });
      let end = kid(p, 'endParaRPr'); if (!end) { end = ee(doc, 'a:endParaRPr', { lang: 'en-US' }); p.appendChild(end); }
      applyRun(doc, end, props);
    }));
  });
}
/** Paragraph formatting for every paragraph of the target: { algn, rtl, bullet: 'none'|'dot'|'num', lnSpc (percent), anchor } */
export function formatParas(files, path, target, o) {
  return mutate(files, path, (doc) => {
    txBodies(doc, target).forEach((tb) => {
      if (o.anchor) { const bp = kid(tb, 'bodyPr'); if (bp) bp.setAttribute('anchor', o.anchor); }
      kids(tb, 'p').forEach((p) => {
        let pPr = kid(p, 'pPr'); if (!pPr) { pPr = ee(doc, 'a:pPr'); p.insertBefore(pPr, p.firstChild); }
        if (o.algn) pPr.setAttribute('algn', o.algn);
        if (o.rtl !== undefined) { if (o.rtl) pPr.setAttribute('rtl', '1'); else pPr.removeAttribute('rtl'); }
        if (o.lnSpc) { kids(pPr, 'lnSpc').forEach((k) => k.remove()); insertOrdered(pPr, ee(doc, 'a:lnSpc', {}, ee(doc, 'a:spcPct', { val: Math.round(o.lnSpc * 1000) })), PPR); }
        if (o.bullet) {
          kids(pPr).filter((k) => ['buNone', 'buAutoNum', 'buChar', 'buFont', 'buBlip'].includes(k.localName)).forEach((k) => k.remove());
          if (o.bullet === 'none') { pPr.setAttribute('marL', '0'); pPr.setAttribute('indent', '0'); insertOrdered(pPr, ee(doc, 'a:buNone'), PPR); }
          else {
            if (!num(at(pPr, 'marL'))) { pPr.setAttribute('marL', '342900'); pPr.setAttribute('indent', '-342900'); }
            if (o.bullet === 'dot') { insertOrdered(pPr, ee(doc, 'a:buFont', { typeface: 'Arial' }), PPR); insertOrdered(pPr, ee(doc, 'a:buChar', { char: '•' }), PPR); }
            else { insertOrdered(pPr, ee(doc, 'a:buFont', { typeface: '+mj-lt' }), PPR); insertOrdered(pPr, ee(doc, 'a:buAutoNum', { type: 'arabicPeriod' }), PPR); }
          }
        }
      });
    });
  });
}
const rPrFrom = (doc, p) => { // formatting template for a paragraph: its first run, else its end-of-paragraph properties
  const r = kids(p).find(isRun); const src = r && kid(r, 'rPr');
  if (src) return src.cloneNode(true);
  const end = kid(p, 'endParaRPr'); const n = ee(doc, 'a:rPr');
  if (end) { Array.from(end.attributes).forEach((a) => n.setAttribute(a.name, a.value)); kids(end).forEach((k) => n.appendChild(k.cloneNode(true))); }
  if (!at(n, 'lang')) n.setAttribute('lang', 'en-US');
  return n;
};
const cleanRPr = (rp) => { MANAGED_ATTR.forEach((a) => rp.removeAttribute(a)); kids(rp).filter((k) => MANAGED_KIDS.includes(k.localName)).forEach((k) => k.remove()); rp.removeAttribute('err'); rp.removeAttribute('dirty'); return rp; };
/**
 * Replace the paragraphs of a text body with the ones the editor produced.
 * paras: [{ algn?: 'l'|'ctr'|'r'|'just', runs: [{ t, b, i, u, st, sz, color, font }  |  { t: '\n' }] }]
 * Each paragraph keeps its own paragraph properties; run formatting is rebuilt from what the editor reports.
 */
export function setParas(files, path, target, paras) {
  return mutate(files, path, (doc) => {
    const tb = ensureTxBody(doc, target); const ps = kids(tb, 'p');
    const list = paras.length ? paras : [{ runs: [] }];
    list.forEach((pm, i) => {
      let p = ps[i];
      if (!p) { p = (ps[ps.length - 1] || ee(doc, 'a:p')).cloneNode(true); tb.appendChild(p); ps.push(p); }
      const tpl = cleanRPr(rPrFrom(doc, p)); const end = kid(p, 'endParaRPr');
      kids(p).filter((c) => c.localName !== 'pPr' && c.localName !== 'endParaRPr').forEach((c) => c.remove());
      if (pm.algn) { let pPr = kid(p, 'pPr'); if (!pPr) { pPr = ee(doc, 'a:pPr'); p.insertBefore(pPr, p.firstChild); } pPr.setAttribute('algn', pm.algn); }
      pm.runs.filter((r) => r.t !== '').forEach((r) => {
        const rp = tpl.cloneNode(true);
        if (r.t === '\n') { p.insertBefore(ee(doc, 'a:br', {}, rp), end || null); return; }
        applyRun(doc, rp, r);
        const run = ee(doc, 'a:r', {}, rp, ee(doc, 'a:t')); run.lastChild.textContent = r.t;
        p.insertBefore(run, end || null);
      });
    });
    ps.slice(list.length).forEach((p) => p.remove());
  });
}

/* ───────────────────────────── slides ───────────────────────────── */
export function slideList(files) {
  const pres = read(files, 'ppt/presentation.xml'); const rels = relsOf(files, 'ppt/presentation.xml');
  return Array.from(pres.getElementsByTagNameNS(NS_P, 'sldId')).filter((e) => e.parentNode.localName === 'sldIdLst').map((e) => ({ id: at(e, 'id'), rid: e.getAttributeNS(NS_R, 'id'), path: rels[e.getAttributeNS(NS_R, 'id')]?.target }));
}
const sectionIds = (pres, id) => Array.from(pres.getElementsByTagNameNS('*', 'sldId')).filter((e) => e.namespaceURI !== NS_P && at(e, 'id') === String(id));
const sldIdEl = (pres, id) => Array.from(pres.getElementsByTagNameNS(NS_P, 'sldId')).find((e) => at(e, 'id') === String(id));
function placeId(pres, newEl, refId, after) { // keep the main list and (if present) the section lists in the same order
  const place = (el, ref) => { if (!ref) return false; if (after) ref.after(el); else ref.before(el); return true; };
  const main = sldIdEl(pres, refId);
  if (!place(newEl.main, main)) { const lst = kid(pres.documentElement, 'sldIdLst'); lst.appendChild(newEl.main); }
  if (newEl.sec) { const ref = sectionIds(pres, refId)[0]; if (!place(newEl.sec, ref)) { const last = Array.from(pres.getElementsByTagNameNS('*', 'sldId')).filter((e) => e.namespaceURI !== NS_P).pop(); if (last) last.after(newEl.sec); } }
}
function registerSlide(files, slidePath, afterIndex) {
  const list = slideList(files); const ref = list[afterIndex] || list[0];
  let f = addOverride(files, `/${slidePath}`, CT_SLIDE);
  const rel = addRel(f, 'ppt/presentation.xml', `${T}/slide`, slidePath); f = rel.files;
  const pres = read(f, 'ppt/presentation.xml');
  const id = Math.max(255, ...Array.from(pres.getElementsByTagNameNS('*', 'sldId')).map((e) => num(at(e, 'id')))) + 1;
  const main = pres.createElementNS(NS_P, 'p:sldId'); main.setAttribute('id', String(id)); main.setAttributeNS(NS_R, 'r:id', rel.id);
  const sec0 = ref && sectionIds(pres, ref.id)[0]; let sec = null;
  if (sec0) { sec = sec0.cloneNode(false); sec.setAttribute('id', String(id)); }
  if (afterIndex < 0 && list.length) placeId(pres, { main, sec }, list[0].id, false); else placeId(pres, { main, sec }, ref?.id, true);
  return { ...f, 'ppt/presentation.xml': ser(pres) };
}
const SKIP_PH = ['dt', 'ftr', 'sldNum', 'hdr', 'sldImg', 'chart', 'tbl', 'media', 'clipArt', 'dgm'];
export function addSlide(files, { layoutPath, after }) {
  const n = nextNum(files, /^ppt\/slides\/slide(\d+)\.xml$/); const slidePath = `ppt/slides/slide${n}.xml`;
  const ld = read(files, layoutPath); let id = 1;
  const sps = flatShapes(tree(ld)).filter((s) => s.localName === 'sp').map((s) => ({ ph: walk(s, 'nvSpPr', 'nvPr', 'ph'), name: at(nvName(s), 'name') })).filter((s) => s.ph && !SKIP_PH.includes(at(s.ph, 'type') || 'body'));
  const body = sps.map((s) => {
    id += 1; const a = ['type', 'idx', 'sz', 'orient'].map((k) => (at(s.ph, k) ? ` ${k}="${esc(at(s.ph, k))}"` : '')).join('');
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(s.name || `Placeholder ${id}`)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph${a}/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`;
  }).join('');
  const xml = `${DECL}<p:sld ${NS_DECL}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  let f = { ...files, [slidePath]: strToU8(xml), [relsPathOf(slidePath)]: strToU8(`${DECL}<Relationships xmlns="${NS_REL}"><Relationship Id="rId1" Type="${T}/slideLayout" Target="${relative(slidePath, layoutPath)}"/></Relationships>`) };
  f = registerSlide(f, slidePath, after);
  return { files: f, index: after + 1 };
}
const UNSAFE = /\/(chart|diagramData|diagramLayout|diagramColors|diagramQuickStyle|oleObject|package|vmlDrawing|control)$/;
export function duplicateSlide(files, index) {
  const list = slideList(files); const src = list[index]; if (!src?.path) throw new Error('Slide not found.');
  const rels = relsDoc(files, src.path); const all = Array.from(rels.getElementsByTagNameNS('*', 'Relationship'));
  if (all.some((r) => UNSAFE.test(at(r, 'Type')))) throw new Error('Slides with charts, diagrams or embedded objects can only be duplicated in PowerPoint.');
  const notes = all.find((r) => /\/notesSlide$/.test(at(r, 'Type'))); const noteText = notes ? readNotes(files, src.path).text : '';
  all.filter((r) => /\/notesSlide$/.test(at(r, 'Type'))).forEach((r) => r.remove());
  const n = nextNum(files, /^ppt\/slides\/slide(\d+)\.xml$/); const slidePath = `ppt/slides/slide${n}.xml`;
  let f = { ...files, [slidePath]: files[src.path], [relsPathOf(slidePath)]: ser(rels) };
  f = registerSlide(f, slidePath, index);
  if (noteText) { try { f = setNotes(f, slidePath, noteText); } catch { /* notes are optional */ } }
  return { files: f, index: index + 1 };
}
export function deleteSlide(files, index) {
  const list = slideList(files); if (list.length < 2) throw new Error('A presentation needs at least one slide.');
  const s = list[index]; if (!s) throw new Error('Slide not found.');
  const pres = read(files, 'ppt/presentation.xml');
  sldIdEl(pres, s.id)?.remove(); sectionIds(pres, s.id).forEach((e) => e.remove());
  let f = { ...files, 'ppt/presentation.xml': ser(pres) };
  const prDoc = relsDoc(f, 'ppt/presentation.xml'); Array.from(prDoc.getElementsByTagNameNS('*', 'Relationship')).filter((r) => at(r, 'Id') === s.rid).forEach((r) => r.remove());
  f['ppt/_rels/presentation.xml.rels'] = ser(prDoc);
  const np = notesPathOf(f, s.path);
  f = removeOverride(without(f, s.path, relsPathOf(s.path)), `/${s.path}`);
  if (np) f = removeOverride(without(f, np, relsPathOf(np)), `/${np}`);
  return { files: f };
}
export function moveSlide(files, from, to) {
  const list = slideList(files); if (from === to || !list[from] || !list[to]) return { files };
  const pres = read(files, 'ppt/presentation.xml'); const id = list[from].id; const ref = list[to].id; const after = to > from;
  const main = sldIdEl(pres, id); const secs = sectionIds(pres, id); main.remove(); secs.forEach((e) => e.remove());
  placeId(pres, { main, sec: secs[0] || null }, ref, after);
  return { files: { ...files, 'ppt/presentation.xml': ser(pres) }, index: to };
}

/* ───────────────────────────── speaker notes ───────────────────────────── */
const notesPathOf = (files, slidePath) => Object.values(relsOf(files, slidePath)).find((r) => /\/notesSlide$/.test(r.type))?.target || null;
export function readNotes(files, slidePath) {
  const np = slidePath && notesPathOf(files, slidePath); if (!np || !files[np]) return { path: null, text: '' };
  const body = flatShapes(tree(read(files, np))).find((s) => /^(body)$/.test(at(walk(s, 'nvSpPr', 'nvPr', 'ph'), 'type') || ''));
  const tb = body && kid(body, 'txBody');
  return { path: np, text: tb ? kids(tb, 'p').map((p) => kids(p).map((c) => (c.localName === 'br' ? '\n' : isRun(c) ? kid(c, 't')?.textContent || '' : '')).join('')).join('\n') : '' };
}
export function setNotes(files, slidePath, text) {
  const lines = String(text).split('\n'); const paras = (doc) => lines.map((l) => frag(doc, l ? `<a:p><a:r><a:rPr lang="en-US"/><a:t>${esc(l)}</a:t></a:r></a:p>` : '<a:p><a:endParaRPr lang="en-US"/></a:p>'));
  const cur = readNotes(files, slidePath);
  if (cur.path) {
    return mutate(files, cur.path, (doc) => {
      const body = flatShapes(tree(doc)).find((s) => at(walk(s, 'nvSpPr', 'nvPr', 'ph'), 'type') === 'body'); const tb = body && kid(body, 'txBody');
      if (!tb) throw new Error('The notes page has no text area.');
      kids(tb, 'p').forEach((p) => p.remove()); paras(doc).forEach((p) => tb.appendChild(p));
    }).files;
  }
  if (!text.trim()) return files;
  const master = Object.keys(files).find((k) => /^ppt\/notesMasters\/notesMaster\d+\.xml$/.test(k));
  if (!master) throw new Error('This presentation has no notes master, so notes can only be added in PowerPoint.');
  const n = nextNum(files, /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/); const np = `ppt/notesSlides/notesSlide${n}.xml`;
  const doc = parseXml(`<p:notes ${NS_DECL}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`);
  const tb = Array.from(doc.getElementsByTagNameNS('*', 'txBody'))[0]; paras(doc).forEach((p) => tb.appendChild(p));
  let f = { ...files, [np]: ser(doc) };
  f = addRel(f, np, `${T}/notesMaster`, master).files; f = addRel(f, np, `${T}/slide`, slidePath).files;
  f = addRel(f, slidePath, `${T}/notesSlide`, np).files;
  return addOverride(f, `/${np}`, CT_NOTES);
}
