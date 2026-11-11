import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import OfficeShell from './OfficeShell';
import { Btn } from './EditorUI';
import DocxRibbon from './DocxRibbon';
import { readDocx, htmlToDocx, sanitizeHtml } from '../../lib/officeFmt/docx';
import { borderCss } from '../../lib/officeFmt/docxRead';
import {
  twToPx, rgbToHex, blocksOfSelection, closestIn, saveSel, restoreSel, makeHistory, findMatches, rangeOfMatch, selectRange,
  cellOf, T, tableHtml, fitImage, countWords, normalizeUrl, printDocument, PAGE_SIZES,
} from './docxEdit';
import '../../styles/css/docx.css';
import '../../styles/css/office.css';

const BLOCK_TOP = /^(P|H[1-6]|UL|OL|TABLE|HR|BLOCKQUOTE)$/;
const INLINE = /^(SPAN|STRONG|B|EM|I|U|S|STRIKE|A|SUB|SUP|MARK|IMG|BR|FONT)$/;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const isBlank = (h) => !h || (!/<(img|span data-fld|table)/i.test(h) && !h.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim());
const WARN = { chart: ['Charts are not editable here and will be dropped on save.', 'الرسوم البيانية مش قابلة للتعديل هنا وهتتشال عند الحفظ.'], textbox: ['Text boxes are not editable here and will be dropped on save.', 'مربعات النص مش قابلة للتعديل هنا وهتتشال عند الحفظ.'], shape: ['Shapes are not editable here and will be dropped on save.', 'الأشكال مش قابلة للتعديل هنا وهتتشال عند الحفظ.'], notes: ['Footnotes / endnotes are not kept on save.', 'الحواشي مش بتتحفظ.'], firstPage: ['Only the default header / footer is kept.', 'بيتحفظ الهيدر والفوتر الافتراضي بس.'] };

const pageStyle = (pg, d, zoom) => ({
  // the header / footer sit in the flow: the page is padded by their distance from the edge and they fill up to the margin, so a tall header pushes the text down
  width: twToPx(pg.w), minHeight: twToPx(pg.h), padding: `${twToPx(Math.min(pg.header, pg.top))}px ${twToPx(pg.right)}px ${twToPx(Math.min(pg.footer, pg.bottom))}px ${twToPx(pg.left)}px`,
  '--dx-hmin': `${twToPx(Math.max(0, pg.top - pg.header))}px`, '--dx-fmin': `${twToPx(Math.max(0, pg.bottom - pg.footer))}px`,
  '--dx-font': `'${d.font}', Calibri, Arial, 'Noto Naskh Arabic', sans-serif`, '--dx-size': `${d.size}pt`, '--dx-before': `${d.before}pt`, '--dx-after': `${d.after}pt`, '--dx-line': d.line,
  '--dx-ph': `${twToPx(pg.h)}px`, '--dx-hd': `${twToPx(pg.header)}px`, '--dx-fd': `${twToPx(pg.footer)}px`, zoom,
});

/** Page borders (Word "Page Borders"): one frame per page, placed from the page edge or from the text like Word does. */
export function PageBorders({ pg, zoom }) {
  const ref = useRef(null); const [pages, setPages] = useState(1); const b = pg.borders;
  useLayoutEffect(() => {
    const host = ref.current?.parentElement; if (!host || !b) return undefined;
    const ph = twToPx(pg.h);
    const calc = () => setPages(Math.max(1, Math.ceil(host.getBoundingClientRect().height / (zoom || 1) / ph - 0.02)));
    calc(); const ro = new ResizeObserver(calc); ro.observe(host); return () => ro.disconnect();
  }, [b, pg.h, zoom]);
  if (!b) return null;
  const ph = twToPx(pg.h); const px = (p) => (p * 4) / 3;
  const edge = (k, margin) => Math.max(0, b.offsetFrom === 'text' ? twToPx(margin) - (b[k] ? px(b[k].space) : 0) : (b[k] ? px(b[k].space) : 0));
  const T = edge('top', pg.top); const L = edge('left', pg.left); const R = edge('right', pg.right); const B = edge('bottom', pg.bottom);
  const frame = {}; ['top', 'left', 'bottom', 'right'].forEach((k) => { if (b[k]) frame[`border${k[0].toUpperCase()}${k.slice(1)}`] = borderCss(b[k]); });
  return (
    <div ref={ref} className="dxp__pb" aria-hidden="true" style={{ zIndex: b.zOrder === 'back' ? 0 : 2 }}>
      {Array.from({ length: pages }, (_, i) => ((b.display === 'firstPage' && i > 0) || (b.display === 'notFirstPage' && i === 0) ? null
        : <i key={i} style={{ position: 'absolute', left: L, right: R, top: i * ph + T, height: Math.max(0, ph - T - B), ...frame }} />))}
    </div>
  );
}

/** Read-only page view of a .docx for the file viewer: real page size, margins, header and footer, scaled to the pane. */
export function DocxPreview({ blob, tt }) {
  const [doc, setDoc] = useState(null); const [err, setErr] = useState(''); const box = useRef(null); const [fit, setFit] = useState(1);
  useEffect(() => { let d = false; blob.arrayBuffer().then((b) => readDocx(b)).then((r) => !d && setDoc(r)).catch((e) => !d && setErr(e?.message || String(e))); return () => { d = true; }; }, [blob]);
  useEffect(() => {
    if (!doc || !box.current) return undefined;
    const calc = () => setFit(Math.min(1, Math.max(0.3, (box.current.clientWidth - 24) / twToPx(doc.page.w))));
    calc(); const ro = new ResizeObserver(calc); ro.observe(box.current); return () => ro.disconnect();
  }, [doc]);
  if (err) return <p className="st-fv__empty">{err}</p>;
  if (!doc) return <p className="st-fv__empty">{tt('Loading…', 'جارٍ التحميل…')}</p>;
  const d = doc.defaults;
  return (
    <div ref={box} className="dx__preview">
      <div className="dxp dxp--ro" dir={d.rtl ? 'rtl' : 'ltr'} style={pageStyle(doc.page, d, fit)}>
        <PageBorders pg={doc.page} zoom={fit} />
        {doc.header && <div className="dxp__hdr" dangerouslySetInnerHTML={{ __html: doc.header }} />}
        <div className="dxp__body" dangerouslySetInnerHTML={{ __html: doc.html }} />
        {doc.footer && <div className="dxp__ftr" dangerouslySetInnerHTML={{ __html: doc.footer }} />}
      </div>
    </div>
  );
}

/** Word editor: a paged, formatting-preserving editor that saves a real .docx (page setup, header / footer, styles, lists, tables). */
export default function DocxView({ blob, fileName, tt, rtl, guardRef, onSave, onClose, draftKey, startDirty = false }) {
  const [status, setStatus] = useState('loading'); const [err, setErr] = useState('');
  const [dirty, setDirty] = useState(startDirty); const [ver, setVer] = useState(0);
  const [pg, setPg] = useState(null); const [def, setDef] = useState(null); const [warns, setWarns] = useState([]);
  const [tab, setTab] = useState('home'); const [zoom, setZoom] = useState(1);
  const [fmt, setFmt] = useState({ has: false }); const [hist, setHist] = useState({ u: false, r: false });
  const [find, setFind] = useState({ open: false, q: '', r: '', mc: false, idx: 0, total: 0 });
  const [words, setWords] = useState(0);
  const body = useRef(null); const hdr = useRef(null); const ftr = useRef(null); const stage = useRef(null);
  const initial = useRef(null); const pgRef = useRef(null); const defRef = useRef(null); const history = useRef(null);
  const lastRange = useRef(null); const matches = useRef([]); const pendingSize = useRef(12); const selImg = useRef(null); const [imgSel, setImgSel] = useState(null);

  const roots = useCallback(() => ({ body: body.current, hdr: hdr.current, ftr: ftr.current }), []);
  const rootOf = (node) => [body.current, hdr.current, ftr.current].find((r) => r && node && r.contains(node)) || null;
  const mark = useCallback(() => { setDirty(true); setVer((v) => v + 1); }, []);

  /* ------------------------------------------------------------ load */
  useEffect(() => {
    let dead = false;
    blob.arrayBuffer().then((b) => readDocx(b)).then((r) => { if (dead) return; initial.current = r; pgRef.current = r.page; defRef.current = r.defaults; setPg(r.page); setDef(r.defaults); setWarns(r.warnings || []); setStatus('ready'); })
      .catch((e) => { if (!dead) { setErr(e?.message || String(e)); setStatus('error'); } });
    return () => { dead = true; };
  }, [blob]);

  /* ------------------------------------------------------------ DOM normalisation */
  const normalize = useCallback((root) => {
    if (!root) return;
    const sel = saveSel(roots());
    // legacy <font> and the "size 7" trick from execCommand('fontSize')
    root.querySelectorAll('font').forEach((f) => {
      const s = document.createElement('span');
      if (f.getAttribute('face')) s.style.fontFamily = f.getAttribute('face');
      if (f.getAttribute('color')) s.style.color = f.getAttribute('color');
      if (f.getAttribute('size') === '7') s.style.fontSize = `${pendingSize.current}pt`;
      while (f.firstChild) s.appendChild(f.firstChild); f.replaceWith(s);
    });
    root.querySelectorAll('[style*="xxx-large"],[style*="x-large"]').forEach((el) => { if (/font-size:\s*(-webkit-)?xx?x?-large/.test(el.getAttribute('style'))) el.style.fontSize = `${pendingSize.current}pt`; });
    root.querySelectorAll('span:not([style]):not([data-fld]):not([class]):not([dir])').forEach((s) => { s.replaceWith(...Array.from(s.childNodes)); });
    // lists nested directly in lists -> inside the previous <li>
    root.querySelectorAll('ul > ul, ul > ol, ol > ul, ol > ol').forEach((l) => {
      const prev = l.previousElementSibling;
      if (prev && prev.tagName === 'LI') prev.appendChild(l); else { const li = document.createElement('li'); l.replaceWith(li); li.appendChild(l); }
    });
    // stray top-level nodes -> paragraphs
    Array.from(root.childNodes).forEach((n) => {
      if (n.nodeType === 3) { if (n.nodeValue.trim()) { const p = document.createElement('p'); n.replaceWith(p); p.appendChild(n); } else if (root.childNodes.length > 1) n.remove(); }
      else if (n.nodeType === 1 && n.tagName === 'DIV') {
        if (n.querySelector('p,h1,h2,h3,h4,h5,h6,ul,ol,table')) n.replaceWith(...Array.from(n.childNodes));
        else { const p = document.createElement('p'); if (n.getAttribute('dir')) p.setAttribute('dir', n.getAttribute('dir')); if (n.getAttribute('style')) p.setAttribute('style', n.getAttribute('style')); while (n.firstChild) p.appendChild(n.firstChild); if (!p.firstChild) p.appendChild(document.createElement('br')); n.replaceWith(p); }
      } else if (n.nodeType === 1 && INLINE.test(n.tagName)) { const p = document.createElement('p'); n.replaceWith(p); p.appendChild(n); }
    });
    if (!root.firstChild) root.innerHTML = '<p><br></p>';
    restoreSel(roots(), sel);
  }, [roots]);

  /* ------------------------------------------------------------ history */
  useEffect(() => {
    if (status !== 'ready') return undefined;
    const r = initial.current;
    body.current.innerHTML = r.html; hdr.current.innerHTML = r.header; ftr.current.innerHTML = r.footer;
    document.execCommand('styleWithCSS', false, true); document.execCommand('defaultParagraphSeparator', false, 'p');
    history.current = makeHistory({
      read: () => ({ body: body.current.innerHTML, hdr: hdr.current.innerHTML, ftr: ftr.current.innerHTML, pg: JSON.stringify(pgRef.current), sel: saveSel(roots()) }),
      apply: (s) => {
        body.current.innerHTML = s.body; hdr.current.innerHTML = s.hdr; ftr.current.innerHTML = s.ftr; const p = JSON.parse(s.pg); pgRef.current = p; setPg(p);
        requestAnimationFrame(() => { restoreSel(roots(), s.sel); }); mark();
      },
      onChange: () => setHist({ u: history.current.canUndo, r: history.current.canRedo }),
    });
    history.current.init(); body.current.focus();
    return () => history.current?.stop();
  }, [status, roots, mark]);

  /* ------------------------------------------------------------ selection -> ribbon state */
  const updateFmt = useCallback(() => {
    const sel = window.getSelection(); if (!sel || !sel.rangeCount) return;
    const root = rootOf(sel.anchorNode);
    if (!root) return;
    lastRange.current = sel.getRangeAt(0).cloneRange();
    const n = sel.anchorNode; const el = n.nodeType === 1 ? n : n.parentElement; if (!el) return;
    const cs = getComputedStyle(el); const q = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
    const block = closestIn(root, el, 'h1,h2,h3,h4,h5,h6,li,p,blockquote'); const li = closestIn(root, el, 'li'); const list = li?.parentElement;
    const bcs = block ? getComputedStyle(block) : cs; const dirEl = el.closest('[dir]'); const isRtl = (dirEl?.getAttribute('dir') || 'ltr') === 'rtl';
    let al = bcs.textAlign; if (al === 'start') al = isRtl ? 'right' : 'left'; else if (al === 'end') al = isRtl ? 'left' : 'right';
    const px = parseFloat(cs.fontSize) || 16; const sz = Math.round(px * 0.75 * 2) / 2;
    const hl = rgbToHex(cs.backgroundColor);
    setFmt({
      has: true, root: root === body.current ? 'body' : root === hdr.current ? 'hdr' : 'ftr',
      font: cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim(), size: sz, b: q('bold'), i: q('italic'), u: q('underline'), st: q('strikeThrough'), sub: q('subscript'), sup: q('superscript'),
      color: rgbToHex(cs.color) || '#000000', hl, align: al === 'justify' ? 'justify' : al, rtl: isRtl,
      style: block?.getAttribute('data-st') || (block && /^H[1-6]$/.test(block.tagName) ? block.tagName.toLowerCase() : 'p'),
      list: list ? list.tagName.toLowerCase() : null, link: !!closestIn(root, el, 'a'), inTable: !!cellOf(root),
      line: parseFloat(bcs.lineHeight) && parseFloat(bcs.fontSize) ? Math.round((parseFloat(bcs.lineHeight) / parseFloat(bcs.fontSize)) * 100) / 100 : '',
      before: Math.round(parseFloat(bcs.marginTop) * 0.75 * 10) / 10 || 0, after: Math.round(parseFloat(bcs.marginBottom) * 0.75 * 10) / 10 || 0,
    });
    pendingSize.current = sz;
  }, []);
  useEffect(() => { document.addEventListener('selectionchange', updateFmt); return () => document.removeEventListener('selectionchange', updateFmt); }, [updateFmt]);

  /* ------------------------------------------------------------ run a command against the saved selection */
  const run = useCallback((fn, { soft = false } = {}) => {
    const r = lastRange.current; const root = (r && rootOf(r.startContainer)) || body.current;
    root.focus({ preventScroll: true });
    if (r) { const s = window.getSelection(); s.removeAllRanges(); try { s.addRange(r); } catch { /* range went stale */ } }
    fn(root);
    normalize(root); updateFmt();
    if (soft) history.current.typing(); else history.current.commit();
    mark();
  }, [normalize, updateFmt, mark]);
  const ex = (c, v) => document.execCommand(c, false, v);
  const blocksNow = (root) => blocksOfSelection(root);

  /* ------------------------------------------------------------ actions */
  const A = {
    setTab, undo: () => { history.current.undo(); updateFmt(); }, redo: () => { history.current.redo(); updateFmt(); },
    toggle: (c) => run(() => ex(c)),
    font: (f) => run(() => ex('fontName', f)),
    size: (pt) => run(() => { if (!(pt > 0)) return; pendingSize.current = pt; ex('fontSize', '7'); }),
    color: (c) => run(() => ex('foreColor', c || '#000000')),
    highlight: (c) => run(() => ex('hiliteColor', c || 'transparent')),
    clear: () => run((root) => { ex('removeFormat'); blocksNow(root).forEach((b) => { b.removeAttribute('data-st'); }); }),
    style: (id) => run((root) => {
      const bl = blocksNow(root).filter((b) => b.tagName !== 'LI'); if (!bl.length) return;
      const tag = /^h[1-4]$/.test(id) ? id : 'p'; ex('formatBlock', tag);
      blocksNow(root).filter((b) => b.tagName !== 'LI').forEach((b) => {
        b.removeAttribute('data-st'); if (['title', 'subtitle', 'quote'].includes(id)) b.setAttribute('data-st', id);
        b.querySelectorAll('[style]').forEach((x) => { x.style.removeProperty('font-size'); x.style.removeProperty('font-weight'); });
        ['font-size', 'color', 'font-family'].forEach((k) => b.style.removeProperty(k)); if (!b.getAttribute('style')) b.removeAttribute('style');
      });
    }),
    align: (a) => run(() => ex({ left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight', justify: 'justifyFull' }[a])),
    list: (kind, type) => run((root) => {
      const want = kind === 'ol' ? 'insertOrderedList' : 'insertUnorderedList'; if (!(fmt.list === kind && type)) ex(want);
      if (kind === 'ol') blocksNow(root).forEach((b) => { const ol = b.closest('ol'); if (ol) { if (type && type !== '1') ol.setAttribute('type', type); else ol.removeAttribute('type'); } });
    }),
    indent: (dir) => run((root) => {
      if (closestIn(root, window.getSelection().anchorNode, 'li')) { ex(dir > 0 ? 'indent' : 'outdent'); return; }
      blocksNow(root).forEach((b) => { const cur = parseFloat(b.style.marginInlineStart) || 0; const v = Math.max(0, cur + dir * 36); if (v) b.style.marginInlineStart = `${v}pt`; else b.style.removeProperty('margin-inline-start'); if (!b.getAttribute('style')) b.removeAttribute('style'); });
    }),
    dir: (d) => run((root) => blocksNow(root).forEach((b) => {
      b.setAttribute('dir', d); const ta = b.style.textAlign; if (ta === 'left' || ta === 'right') b.style.textAlign = d === 'rtl' ? 'right' : 'left';
      if (b.tagName === 'LI') { const l = b.parentElement; l?.setAttribute('dir', d); }
    })),
    spacing: (k, v) => run((root) => blocksNow(root).forEach((b) => {
      if (k === 'line') b.style.lineHeight = String(v); else b.style[k === 'before' ? 'marginTop' : 'marginBottom'] = `${v}pt`;
    })),
    link: () => {
      const u = window.prompt(tt('Link address (https://…)', 'عنوان الرابط (https://…)'), fmt.link ? '' : 'https://'); if (u === null) return;
      const url = normalizeUrl(u); if (!url) { if (u.trim()) setErr(tt('That address is not allowed.', 'العنوان ده مش مسموح.')); return; }
      run(() => { if (window.getSelection().isCollapsed) ex('insertHTML', `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(u.trim())}</a>`); else ex('createLink', url); });
    },
    unlink: () => run(() => ex('unlink')),
    symbol: (ch) => run(() => ex('insertText', ch)),
    pageBreak: () => run((root) => { if (root === body.current) ex('insertHTML', '<hr data-pb="1"><p><br></p>'); }),
    field: (kind) => run(() => ex('insertHTML', `<span data-fld="${kind}" contenteditable="false">1</span>`)),
    band: (which) => { const el = which === 'hdr' ? hdr.current : ftr.current; if (isBlank(el.innerHTML)) { el.innerHTML = '<p><br></p>'; mark(); history.current.commit(); } el.focus(); },
    delBand: (which) => { const el = which === 'hdr' ? hdr.current : ftr.current; el.innerHTML = '<p><br></p>'; mark(); history.current.commit(); },
    table: (r, c) => run((root) => { if (root !== body.current) return; ex('insertHTML', tableHtml(r, c, (def?.rtl))); }),
    tcell: (fn) => run((root) => { const td = cellOf(root); if (td) fn(td); }),
    tRow: (after) => A.tcell((td) => T.addRow(td, after)), tCol: (after) => A.tcell((td) => T.addCol(td, after)),
    tDelRow: () => A.tcell((td) => T.delRow(td)), tDelCol: () => A.tcell((td) => T.delCol(td)), tDel: () => A.tcell((td) => T.delTable(td)),
    tMerge: () => A.tcell((td) => T.mergeRight(td)), tSplit: () => A.tcell((td) => T.split(td)),
    tShade: (c) => A.tcell((td) => { if (c) td.style.backgroundColor = c; else td.style.removeProperty('background-color'); if (!td.getAttribute('style')) td.removeAttribute('style'); }),
    tBorders: () => A.tcell((td) => { const t = td.closest('table'); if (t.getAttribute('data-b') === 'none') t.removeAttribute('data-b'); else t.setAttribute('data-b', 'none'); }),
    tValign: (v) => A.tcell((td) => { if (v === 'top') td.style.removeProperty('vertical-align'); else td.style.verticalAlign = v; if (!td.getAttribute('style')) td.removeAttribute('style'); }),
    image: () => {
      const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp';
      i.onchange = async () => { const f = i.files?.[0]; if (f) insertPicture(f); }; i.click();
    },
    imgWidth: (w) => { const im = selImg.current; if (!im || !(w > 8)) return; run(() => { const ratio = (im.naturalHeight || 3) / (im.naturalWidth || 4); im.setAttribute('width', String(Math.round(w))); im.setAttribute('height', String(Math.round(w * ratio))); }); setImgSel({ w: Math.round(w) }); },
    imgDel: () => { const im = selImg.current; if (!im) return; run(() => im.remove()); selImg.current = null; setImgSel(null); setTab('home'); },
    pageSize: (name) => setPage((p) => { const s = PAGE_SIZES.find((x) => x[0] === name); if (!s) return p; return p.w > p.h ? { ...p, w: s[2], h: s[1] } : { ...p, w: s[1], h: s[2] }; }),
    orient: (land) => setPage((p) => { const w = Math.min(p.w, p.h); const h = Math.max(p.w, p.h); return land ? { ...p, w: h, h: w } : { ...p, w, h }; }),
    margins: (m) => setPage((p) => ({ ...p, ...m })),
    setZoom, fit: () => { const w = stage.current?.clientWidth; if (w && pg) setZoom(Math.max(0.3, Math.min(2, (w - 40) / twToPx(pg.w)))); },
    openFind: (replace) => setFind((f) => ({ ...f, open: true, showReplace: !!replace })),
    print: () => printDocument({ body: body.current.innerHTML, header: hdr.current.innerHTML, footer: ftr.current.innerHTML, page: pgRef.current, look: defRef.current, rtl: !!defRef.current.rtl }),
    cut: () => run(() => ex('cut')), copy: () => { run(() => ex('copy'), { soft: true }); },
    paste: async () => {
      try { const items = await navigator.clipboard.read(); for (const it of items) { const img = it.types.find((t) => t.startsWith('image/')); if (img) { insertPicture(await it.getType(img)); return; } if (it.types.includes('text/html')) { const h = await (await it.getType('text/html')).text(); run(() => ex('insertHTML', sanitizeHtml(h))); return; } } } catch { /* fall through to plain text */ }
      try { const t = await navigator.clipboard.readText(); run(() => ex('insertHTML', pasteText(t))); } catch { setErr(tt('Use Ctrl+V to paste here.', 'استخدم Ctrl+V للصق هنا.')); }
    },
  };
  function setPage(fn) { const next = fn(pgRef.current); pgRef.current = next; setPg(next); history.current.commit(); mark(); }
  const pasteText = (t) => String(t).replace(/\r/g, '').split('\n').map((l) => `<p>${esc(l) || '<br>'}</p>`).join('');
  async function insertPicture(file) {
    try { const { src, w, h } = await fitImage(file); run(() => ex('insertHTML', `<img src="${src}" width="${w}" height="${h}">`)); } catch (e) { setErr(e?.message === 'size' ? tt('Picture is larger than 20 MB.', 'الصورة أكبر من 20 ميجا.') : tt('Could not add that picture.', 'مقدرتش أضيف الصورة دي.')); }
  }

  /* ------------------------------------------------------------ find & replace */
  const paintFind = useCallback((cur) => {
    try { if (!CSS.highlights) return; CSS.highlights.delete('dx-find'); CSS.highlights.delete('dx-find-cur'); if (!matches.current.length) return; CSS.highlights.set('dx-find', new Highlight(...matches.current.map(rangeOfMatch))); if (cur >= 0 && matches.current[cur]) CSS.highlights.set('dx-find-cur', new Highlight(rangeOfMatch(matches.current[cur]))); } catch { /* highlight API not available */ }
  }, []);
  const doFind = useCallback((q, mc, idx = 0, jump = false) => {
    matches.current = body.current ? findMatches(body.current, q, mc) : [];
    const total = matches.current.length; const i = total ? ((idx % total) + total) % total : 0;
    setFind((f) => ({ ...f, q, mc, idx: i, total })); paintFind(total ? i : -1);
    if (jump && total) { const r = rangeOfMatch(matches.current[i]); r.startContainer.parentElement?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); }
  }, [paintFind]);
  useEffect(() => { if (find.open) doFind(find.q, find.mc, find.idx); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ver]);
  useEffect(() => { if (!find.open) { try { CSS.highlights?.delete('dx-find'); CSS.highlights?.delete('dx-find-cur'); } catch { /* none */ } } }, [find.open]);
  const replaceOne = () => {
    const m = matches.current[find.idx]; if (!m) return;
    body.current.focus(); selectRange(rangeOfMatch(m)); ex('insertText', find.r); normalize(body.current); history.current.commit(); mark(); doFind(find.q, find.mc, find.idx, true);
  };
  const replaceAll = () => {
    const list = matches.current.slice().reverse(); if (!list.length) return;
    body.current.focus(); list.forEach((m) => { selectRange(rangeOfMatch(m)); ex('insertText', find.r); });
    normalize(body.current); history.current.commit(); mark(); doFind(find.q, find.mc, 0);
  };

  /* ------------------------------------------------------------ events */
  const onInput = () => {
    const r = rootOf(window.getSelection().anchorNode) || body.current;
    if (Array.from(r.childNodes).some((n) => n.nodeType === 3 || (n.nodeType === 1 && !BLOCK_TOP.test(n.tagName))) || r.querySelector('font,[style*="xxx-large"]')) normalize(r);
    history.current.typing(); mark(); updateFmt();
  };
  const onKeyDown = (e) => {
    const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
    if (mod && !e.altKey && (k === 'z' || k === 'y')) { e.preventDefault(); if (k === 'y' || e.shiftKey) A.redo(); else A.undo(); return; }
    if (mod && k === 'f') { e.preventDefault(); A.openFind(false); return; }
    if (mod && k === 'h') { e.preventDefault(); A.openFind(true); return; }
    if (mod && k === 'k') { e.preventDefault(); A.link(); return; }
    if (mod && k === 'p') { e.preventDefault(); A.print(); return; }
    if (mod && (k === 'b' || k === 'i' || k === 'u')) { setTimeout(() => { history.current.commit(); mark(); updateFmt(); }, 0); return; }
    if (e.key === 'Tab') {
      const root = rootOf(e.target); const td = root && cellOf(root); const li = root && closestIn(root, window.getSelection().anchorNode, 'li');
      if (td) { e.preventDefault(); const cells = Array.from(td.closest('table').querySelectorAll('td,th')); const i = cells.indexOf(td); let nx = cells[i + (e.shiftKey ? -1 : 1)];
        if (!nx && !e.shiftKey) { T.addRow(td.parentElement.lastElementChild, true); nx = Array.from(td.closest('table').querySelectorAll('td,th'))[i + 1]; history.current.commit(); mark(); }
        if (nx) { const r = document.createRange(); r.selectNodeContents(nx); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } }
      else if (li) { e.preventDefault(); A.indent(e.shiftKey ? -1 : 1); }
      else { e.preventDefault(); ex('insertText', '\t'); }
    }
    if (e.key === 'Escape') { selImg.current = null; setImgSel(null); }
  };
  const onBeforeInput = (e) => { if (e.inputType === 'historyUndo') { e.preventDefault(); A.undo(); } else if (e.inputType === 'historyRedo') { e.preventDefault(); A.redo(); } };
  const onPaste = (e) => {
    e.preventDefault(); const cd = e.clipboardData; const file = Array.from(cd.files || []).find((f) => f.type.startsWith('image/'));
    if (file) { insertPicture(file); return; }
    const html = cd.getData('text/html'); const text = cd.getData('text/plain');
    run(() => ex('insertHTML', html ? sanitizeHtml(html) || pasteText(text) : pasteText(text)));
  };
  const onClick = (e) => {
    const im = e.target.tagName === 'IMG' ? e.target : null;
    if (selImg.current && selImg.current !== im) selImg.current.classList.remove('is-sel');
    selImg.current = im; if (im) { im.classList.add('is-sel'); setImgSel({ w: Math.round(im.getBoundingClientRect().width / zoom) }); setTab('picture'); } else { setImgSel(null); setTab((t) => (t === 'picture' ? 'home' : t)); }
    const a = e.target.closest?.('a'); if (a && (e.ctrlKey || e.metaKey)) window.open(a.href, '_blank', 'noopener');
  };
  useEffect(() => { // Ctrl + wheel = zoom
    const el = stage.current; if (!el) return undefined;
    const h = (e) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); setZoom((z) => Math.max(0.3, Math.min(2.5, Math.round((z - Math.sign(e.deltaY) * 0.1) * 10) / 10))); };
    el.addEventListener('wheel', h, { passive: false }); return () => el.removeEventListener('wheel', h);
  }, [status]);
  useEffect(() => { const t = setTimeout(() => { if (body.current) setWords(countWords(body.current.innerText)); }, 300); return () => clearTimeout(t); }, [ver]);

  /* ------------------------------------------------------------ save */
  const build = useCallback(() => {
    selImg.current?.classList.remove('is-sel');
    const h = hdr.current.innerHTML; const f = ftr.current.innerHTML;
    return htmlToDocx(body.current, { header: isBlank(h) ? '' : h, footer: isBlank(f) ? '' : f, page: pgRef.current, defaults: defRef.current });
  }, []);

  if (status === 'loading') return <div className="ed ed--center"><span className="st-fv-spinner" /><p className="ed__hint">{tt('Opening the document…', 'جارٍ فتح المستند…')}</p></div>;
  if (status === 'error') return <div className="ed ed--center"><p className="ed__err">{err}</p><Btn label={tt('Close', 'إغلاق')} onClick={onClose} /></div>;

  const S = { tab, fmt, pg, def, zoom, canUndo: hist.u, canRedo: hist.r, words, inTable: !!fmt.inTable, imgSel };
  const fieldProps = { contentEditable: true, suppressContentEditableWarning: true, spellCheck: true, onInput, onKeyDown, onBeforeInput, onPaste, onClick };
  const sizeName = PAGE_SIZES.find((s) => (s[1] === Math.min(pg.w, pg.h) && s[2] === Math.max(pg.w, pg.h)))?.[0] || `${Math.round(pg.w / 56.7)}×${Math.round(pg.h / 56.7)} mm`;

  return (
    <OfficeShell
      fileName={fileName} tt={tt} guardRef={guardRef} onSave={onSave} onClose={onClose} dirty={dirty} build={build} onSaved={() => setDirty(false)} draftKey={draftKey} draftToken={ver}
      tools={<DocxRibbon tt={tt} S={S} A={A} />}
      status={(
        <div className="dx__status">
          <span>{tt('Words', 'كلمات')}: {words}</span><span>{sizeName}{pg.w > pg.h ? ` · ${tt('Landscape', 'عرضي')}` : ''}</span>
          {warns.map((w) => <span key={w} className="dx__warn" title={WARN[w]?.[0]}>⚠ {tt(WARN[w]?.[0] || w, WARN[w]?.[1] || w)}</span>)}
          <span className="dx__sp" />
          <input type="range" min="30" max="250" step="5" value={Math.round(zoom * 100)} onChange={(e) => setZoom(Number(e.target.value) / 100)} aria-label={tt('Zoom', 'تكبير')} />
          <button type="button" className="dx__zoomlbl" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        </div>
      )}
    >
      {find.open && (
        <div className="dx__find" role="search" onKeyDown={(e) => { if (e.key === 'Escape') setFind((f) => ({ ...f, open: false })); }}>
          <input autoFocus placeholder={tt('Find', 'بحث')} value={find.q} onChange={(e) => doFind(e.target.value, find.mc, 0, true)} onKeyDown={(e) => { if (e.key === 'Enter') doFind(find.q, find.mc, find.idx + (e.shiftKey ? -1 : 1), true); }} />
          <span className="dx__cnt">{find.total ? `${find.idx + 1}/${find.total}` : '0'}</span>
          <Btn icon="chevron-up" title={tt('Previous', 'السابق')} onClick={() => doFind(find.q, find.mc, find.idx - 1, true)} /><Btn icon="chevron-down" title={tt('Next', 'التالي')} onClick={() => doFind(find.q, find.mc, find.idx + 1, true)} />
          <label className="dx__mc"><input type="checkbox" checked={find.mc} onChange={(e) => doFind(find.q, e.target.checked, 0, true)} />{tt('Match case', 'حروف مطابقة')}</label>
          <input placeholder={tt('Replace with', 'استبدال بـ')} value={find.r} onChange={(e) => setFind((f) => ({ ...f, r: e.target.value }))} />
          <Btn label={tt('Replace', 'استبدال')} onClick={replaceOne} disabled={!find.total} /><Btn label={tt('All', 'الكل')} onClick={replaceAll} disabled={!find.total} />
          <Btn icon="x" title={tt('Close', 'إغلاق')} onClick={() => setFind((f) => ({ ...f, open: false }))} />
        </div>
      )}
      {err && <p className="ed__err dx__err" role="alert" onClick={() => setErr('')}>{err}</p>}
      <div className="dx__stage" ref={stage}>
        <div className="dxp" dir={def.rtl ? 'rtl' : 'ltr'} style={pageStyle(pg, def, zoom)}>
          <PageBorders pg={pg} zoom={zoom} />
          <div ref={hdr} className="dxp__hdr" data-ph={tt('Header', 'رأس الصفحة')} {...fieldProps} />
          <div ref={body} className="dxp__body" spellCheck {...fieldProps} />
          <div ref={ftr} className="dxp__ftr" data-ph={tt('Footer', 'تذييل الصفحة')} {...fieldProps} />
        </div>
      </div>
    </OfficeShell>
  );
}
