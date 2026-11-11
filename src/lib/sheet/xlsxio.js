import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { Workbook } from './workbook.js';
import { ERR_BY_CODE, isErr } from './formula.js';
import { key, keyR, keyC, colName, parseRange, rangeStr } from './addr.js';
import { parseCell } from './addr.js';
import { dxfXml, cfXml, readCf, readDxfs, filterXml, readFilter, chartParts, readCharts } from './xlsxext.js';

/* ---------- tiny XML parser (works in browser and node) ---------- */
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
export function parseXml(src) {
  const root = { n: '#root', a: {}, c: [], t: '' }; const st = [root]; const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/)?([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/)?>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) { st[st.length - 1].t += m[1]; continue; }
    if (m[6] !== undefined) { st[st.length - 1].t += unesc(m[6]); continue; }
    if (m[3] === undefined) continue;
    if (m[2]) { if (st.length > 1) st.pop(); continue; }
    const a = {}; const ar = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let x;
    while ((x = ar.exec(m[4] || ''))) a[x[1]] = unesc(x[2] ?? x[3]);
    const node = { n: m[3].replace(/^[\w.-]+:/, ''), a, c: [], t: '' }; st[st.length - 1].c.push(node);
    if (!m[5]) st.push(node);
  }
  return root;
}
const kids = (n, name) => (n ? n.c.filter((x) => x.n === name) : []);
const kid = (n, name) => (n ? n.c.find((x) => x.n === name) : undefined);
const textOf = (n) => (n ? n.t + n.c.map(textOf).join('') : '');
const siText = (si) => { const r = kids(si, 'r'); return r.length ? r.map((x) => textOf(kid(x, 't'))).join('') : textOf(kid(si, 't')); };

const BUILTIN_FMT = { 0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??', 14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yyyy h:mm', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss.0', 48: '##0.0E+0', 49: '@' };
const rgb = (c) => { if (!c) return null; if (c.a.rgb) return `#${c.a.rgb.slice(-6)}`; return null; };

export async function readXlsx(data) {
  const files = unzipSync(data instanceof Uint8Array ? data : new Uint8Array(data));
  const get = (p) => (files[p] ? strFromU8(files[p]) : null);
  const wbX = parseXml(get('xl/workbook.xml') || ''); const wbN = kid(wbX, 'workbook');
  const rels = {}; kids(kid(parseXml(get('xl/_rels/workbook.xml.rels') || ''), 'Relationships'), 'Relationship').forEach((r) => { rels[r.a.Id] = r.a.Target; });
  const sst = []; const sx = get('xl/sharedStrings.xml'); if (sx) kids(kid(parseXml(sx), 'sst'), 'si').forEach((si) => sst.push(siText(si)));
  // styles
  const stX = kid(parseXml(get('xl/styles.xml') || '<styleSheet/>'), 'styleSheet');
  const fmts = {}; kids(kid(stX, 'numFmts'), 'numFmt').forEach((f) => { fmts[f.a.numFmtId] = f.a.formatCode; });
  const fonts = kids(kid(stX, 'fonts'), 'font').map((f) => ({ b: !!kid(f, 'b'), i: !!kid(f, 'i'), u: !!kid(f, 'u'), strike: !!kid(f, 'strike'), color: rgb(kid(f, 'color')), fs: kid(f, 'sz') ? +kid(f, 'sz').a.val : null, font: kid(f, 'name') ? kid(f, 'name').a.val : null }));
  const fills = kids(kid(stX, 'fills'), 'fill').map((f) => { const p = kid(f, 'patternFill'); return p && p.a.patternType === 'solid' ? rgb(kid(p, 'fgColor')) : null; });
  const borders = kids(kid(stX, 'borders'), 'border').map((b) => { const o = {}; ['left', 'right', 'top', 'bottom'].forEach((s) => { const e = kid(b, s); if (e && e.a.style) o[s[0]] = [e.a.style, rgb(kid(e, 'color')) || '#000000']; }); return Object.keys(o).length ? o : null; });
  const xfs = kids(kid(stX, 'cellXfs'), 'xf');
  const defaultFont = { b: false, i: false, u: false, strike: false, color: null };
  return (async () => {
    const wb = new Workbook(); wb.d1904 = !!(kid(wbN, 'workbookPr') && kid(wbN, 'workbookPr').a.date1904 === '1');
    const styleCache = new Map();
    const styleOf = (xi) => {
      if (styleCache.has(xi)) return styleCache.get(xi);
      const xf = xfs[xi]; let id = 0;
      if (xf) {
        const st = {}; const nf = +xf.a.numFmtId || 0; const code = fmts[nf] ?? BUILTIN_FMT[nf]; if (code && code !== 'General') st.nf = code;
        const f = fonts[+xf.a.fontId || 0]; if (f) { if (f.b) st.b = 1; if (f.i) st.i = 1; if (f.u) st.u = 1; if (f.strike) st.st = 1; if (f.color && f.color !== '#000000') st.color = f.color; if (f.fs && f.fs !== 11) st.fs = f.fs; if (f.font && f.font !== 'Calibri') st.font = f.font; }
        const fl = fills[+xf.a.fillId || 0]; if (fl && fl !== '#FFFFFF') st.bg = fl;
        const bd = borders[+xf.a.borderId || 0]; if (bd) st.bd = bd;
        const al = kid(xf, 'alignment'); if (al) { if (al.a.horizontal && al.a.horizontal !== 'general') st.al = al.a.horizontal; if (al.a.vertical) st.va = al.a.vertical; if (al.a.wrapText === '1') st.wrap = 1; if (al.a.indent) st.ind = +al.a.indent; }
        id = Object.keys(st).length ? wb.styleId(st) : 0;
      }
      styleCache.set(xi, id); return id;
    };
    void defaultFont;
    const H = { kids, kid, textOf, parseXml, strFromU8 }; const dxfs = readDxfs(H, stX);
    for (const sh of kids(kid(wbN, 'sheets'), 'sheet')) {
      const rid = sh.a['r:id'] || Object.entries(sh.a).find(([k]) => /:id$/.test(k))?.[1];
      let target = rels[rid] || ''; target = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
      const x = get(target); const sheet = wb.addSheet(sh.a.name); if (!x) continue;
      const ws = kid(parseXml(x), 'worksheet');
      const sd = kid(ws, 'sheetData');
      for (const row of kids(sd, 'row')) {
        const r0 = +row.a.r - 1; if (row.a.ht && row.a.customHeight === '1') sheet.rowH.set(r0, +row.a.ht * (96 / 72)); if (row.a.hidden === '1') sheet.hiddenRows.add(r0);
        for (const c of kids(row, 'c')) {
          const p = parseCell(c.a.r); if (!p) continue;
          const t = c.a.t; const vN = kid(c, 'v'); const fN = kid(c, 'f'); const isN = kid(c, 'is');
          let v = null;
          if (t === 's') v = sst[+textOf(vN)] ?? ''; else if (t === 'str') v = textOf(vN); else if (t === 'inlineStr') v = siText(isN); else if (t === 'b') v = textOf(vN) === '1'; else if (t === 'e') v = ERR_BY_CODE[textOf(vN)] || ERR_BY_CODE['#VALUE!'];
          else if (vN && textOf(vN) !== '') v = Number(textOf(vN));
          const cell = { v, f: null, s: c.a.s ? styleOf(+c.a.s) : 0 };
          if (fN && textOf(fN) && fN.a.t !== 'shared' && fN.a.t !== 'array') cell.f = textOf(fN);
          else if (fN && fN.a.t === 'shared') { if (textOf(fN)) { (sheet._sh ||= {})[fN.a.si] = { f: textOf(fN), r: p.r, c: p.c }; cell.f = textOf(fN); } else if (sheet._sh?.[fN.a.si]) { cell.f = { shared: sheet._sh[fN.a.si], r: p.r, c: p.c }; } } else if (fN && fN.a.t === 'array' && textOf(fN)) cell.f = textOf(fN);
          if (cell.v === null && !cell.f && !cell.s) continue;
          sheet.cells.set(key(p.r, p.c), cell); sheet.bump(p.r, p.c);
        }
      }
      // resolve shared formulas lazily with the same shifting rules as fill
      if (sheet._sh) { const { shiftFormula } = await import('./formula.js'); for (const cell of sheet.cells.values()) if (cell.f && typeof cell.f === 'object') { const { shared, r, c } = cell.f; cell.f = shiftFormula(shared.f, r - shared.r, c - shared.c); } delete sheet._sh; }
      // formulas keep their last value only as a cache-less hint: the engine recomputes
      const cols = kid(ws, 'cols'); kids(cols, 'col').forEach((c) => { for (let i = +c.a.min - 1; i <= Math.min(+c.a.max - 1, 300); i += 1) { if (c.a.width) { sheet.colW.set(i, Math.round(+c.a.width * 7 + 5)); if (c.a.customWidth === '1') sheet.manualW.add(i); } if (c.a.hidden === '1') sheet.hiddenCols.add(i); } });
      kids(kid(ws, 'mergeCells'), 'mergeCell').forEach((m) => { const g = parseRange(m.a.ref); if (g) sheet.merges.push(g); });
      sheet.cf = readCf(H, ws, dxfs); sheet.filter = readFilter(H, ws, sheet); sheet.charts = readCharts(H, files, target, ws, sheet);
      const pane = kid(kid(kid(ws, 'sheetViews'), 'sheetView'), 'pane'); if (pane && pane.a.state && /frozen/.test(pane.a.state)) sheet.freeze = { r: +(pane.a.ySplit || 0), c: +(pane.a.xSplit || 0) };
    }
    kids(kid(wbN, 'definedNames'), 'definedName').forEach((d) => { const f = textOf(d); const m = /^(?:'([^']+)'|([\w.]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(f); const g = m ? parseRange(`${m[3]}${m[4]}${m[5] ? `:${m[5]}${m[6]}` : ''}`) : null; wb.names.set(d.a.name.toUpperCase(), g ? { ref: { sheet: m[1] || m[2], ...g }, name: d.a.name } : { f, name: d.a.name }); });
    if (!wb.sheets.length) wb.addSheet('Sheet1');
    wb.touch(); return wb;
  })();
}

/* ---------- writer ---------- */
const argb = (c) => `FF${String(c).replace('#', '').toUpperCase()}`;
export function writeXlsx(wb) {
  wb.ensure();
  const sst = []; const sidx = new Map(); const addS = (s) => { let i = sidx.get(s); if (i === undefined) { i = sst.length; sst.push(s); sidx.set(s, i); } return i; };
  // styles
  const fontsL = ['<font><sz val="11"/><name val="Calibri"/></font>']; const fillsL = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']; const bordL = ['<border><left/><right/><top/><bottom/><diagonal/></border>']; const nfL = []; const xfL = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>'];
  const pool = (arr, x) => { let i = arr.indexOf(x); if (i < 0) { i = arr.length; arr.push(x); } return i; };
  const xfOf = new Map(); xfOf.set(0, 0);
  wb.styles.forEach((st, i) => {
    if (!i) return;
    const font = `<font>${st.b ? '<b/>' : ''}${st.i ? '<i/>' : ''}${st.st ? '<strike/>' : ''}${st.u ? '<u/>' : ''}<sz val="${st.fs || 11}"/>${st.color ? `<color rgb="${argb(st.color)}"/>` : ''}<name val="${esc(st.font || 'Calibri')}"/></font>`;
    const fill = st.bg ? `<fill><patternFill patternType="solid"><fgColor rgb="${argb(st.bg)}"/><bgColor indexed="64"/></patternFill></fill>` : null;
    const bd = st.bd ? `<border>${[['l', 'left'], ['r', 'right'], ['t', 'top'], ['b', 'bottom']].map(([k, n]) => (st.bd[k] ? `<${n} style="${st.bd[k][0]}"><color rgb="${argb(st.bd[k][1])}"/></${n}>` : `<${n}/>`)).join('')}<diagonal/></border>` : null;
    let nfId = 0; if (st.nf) { const b = Object.entries(BUILTIN_FMT).find(([, v]) => v === st.nf); if (b) nfId = +b[0]; else { let k = nfL.indexOf(st.nf); if (k < 0) { k = nfL.length; nfL.push(st.nf); } nfId = 164 + k; } }
    const al = st.al || st.va || st.wrap || st.ind ? `<alignment${st.al ? ` horizontal="${st.al}"` : ''}${st.va ? ` vertical="${st.va}"` : ''}${st.wrap ? ' wrapText="1"' : ''}${st.ind ? ` indent="${st.ind}"` : ''}/>` : '';
    const xf = `<xf numFmtId="${nfId}" fontId="${pool(fontsL, font)}" fillId="${fill ? pool(fillsL, fill) : 0}" borderId="${bd ? pool(bordL, bd) : 0}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${al ? ' applyAlignment="1">' + al + '</xf>' : '/>'}`;
    xfOf.set(i, xfL.length); xfL.push(xf);
  });
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${nfL.length ? `<numFmts count="${nfL.length}">${nfL.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(f)}"/>`).join('')}</numFmts>` : ''}<fonts count="${fontsL.length}">${fontsL.join('')}</fonts><fills count="${fillsL.length}">${fillsL.join('')}</fills><borders count="${bordL.length}">${bordL.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfL.length}">${xfL.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>@@DXFS@@</styleSheet>`;
  const dxfL = []; const dxfIx = new Map(); const dxf = (f) => { const k = JSON.stringify(f); if (!dxfIx.has(k)) { dxfIx.set(k, dxfL.length); dxfL.push(dxfXml(f)); } return dxfIx.get(k); };
  const extra = {}; let chartNo = 1;
  const sheetsXml = wb.sheets.map((s, si) => {
    const rows = new Map();
    for (const [k, cell] of s.cells) { const r = keyR(k); if (!rows.has(r)) rows.set(r, []); rows.get(r).push([keyC(k), cell]); }
    for (const r of s.rowH.keys()) if (!rows.has(r)) rows.set(r, []);
    const body = [...rows.keys()].sort((a, b) => a - b).map((r) => {
      const cs = rows.get(r).sort((a, b) => a[0] - b[0]).map(([c, cell]) => {
        const ref = `${colName(c)}${r + 1}`; const sA = cell.s && xfOf.has(cell.s) ? ` s="${xfOf.get(cell.s)}"` : '';
        const val = cell.f ? wb.getValue(s, r, c) : cell.v; const f = cell.f ? `<f>${esc(cell.f)}</f>` : '';
        if (val === null || val === undefined) return f || sA ? `<c r="${ref}"${sA}>${f}</c>` : '';
        if (isErr(val)) return `<c r="${ref}"${sA} t="e">${f}<v>${esc(val.code)}</v></c>`;
        if (typeof val === 'number') return `<c r="${ref}"${sA}>${f}<v>${val}</v></c>`;
        if (typeof val === 'boolean') return `<c r="${ref}"${sA} t="b">${f}<v>${val ? 1 : 0}</v></c>`;
        if (cell.f) return `<c r="${ref}"${sA} t="str">${f}<v>${esc(val)}</v></c>`;
        return `<c r="${ref}"${sA} t="s"><v>${addS(String(val))}</v></c>`;
      }).join('');
      const h = s.rowH.get(r);
      return `<row r="${r + 1}"${h ? ` ht="${(h * 72) / 96}" customHeight="1"` : ''}${s.hiddenRows.has(r) ? ' hidden="1"' : ''}>${cs}</row>`;
    }).join('');
    const cols = [...new Set([...s.colW.keys(), ...s.hiddenCols])].sort((a, b) => a - b).map((c) => `<col min="${c + 1}" max="${c + 1}" width="${s.colW.has(c) ? ((s.colW.get(c) - 5) / 7).toFixed(2) : 8.43}" customWidth="1"${s.hiddenCols.has(c) ? ' hidden="1"' : ''}/>`).join('');
    const pane = s.freeze.r || s.freeze.c ? `<sheetViews><sheetView workbookViewId="0"><pane${s.freeze.c ? ` xSplit="${s.freeze.c}"` : ''}${s.freeze.r ? ` ySplit="${s.freeze.r}"` : ''} topLeftCell="${colName(s.freeze.c)}${s.freeze.r + 1}" state="frozen"/></sheetView></sheetViews>` : '';
    const cp = chartParts(wb, s, si + 1, chartNo); if (cp) { chartNo += cp.charts.length; extra[si + 1] = cp; }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"${cp ? ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' : ''}>${pane}${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${body}</sheetData>${filterXml(s)}${s.merges.length ? `<mergeCells count="${s.merges.length}">${s.merges.map((g) => `<mergeCell ref="${rangeStr(g)}"/>`).join('')}</mergeCells>` : ''}${cfXml(s, dxf)}${cp ? '<drawing r:id="rId1"/>' : ''}</worksheet>`;
  });
  const names = [...wb.names.values()].filter((n) => n.ref).map((n) => `<definedName name="${esc(n.name)}">'${esc(n.ref.sheet)}'!${rangeStr(n.ref).replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName>`).join('');
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${wb.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>@@CT@@</Types>`,
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${wb.sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${names ? `<definedNames>${names}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wb.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${wb.sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${wb.sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    'xl/styles.xml': stylesXml,
  };
  sheetsXml.forEach((x, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = x; });
  files['xl/sharedStrings.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sst.length}" uniqueCount="${sst.length}">${sst.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`;
  let ct = '';
  for (const [no, cp] of Object.entries(extra)) {
    files[`xl/worksheets/_rels/sheet${no}.xml.rels`] = cp.sheetRels; files[`xl/drawings/drawing${no}.xml`] = cp.drawing; files[`xl/drawings/_rels/drawing${no}.xml.rels`] = cp.drawingRels;
    ct += `<Override PartName="/xl/drawings/drawing${no}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`;
    for (const c of cp.charts) { files[`xl/charts/chart${c.n}.xml`] = c.xml; ct += `<Override PartName="/xl/charts/chart${c.n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`; }
  }
  files['[Content_Types].xml'] = files['[Content_Types].xml'].replace('@@CT@@', ct);
  files['xl/styles.xml'] = files['xl/styles.xml'].replace('@@DXFS@@', dxfL.length ? `<dxfs count="${dxfL.length}">${dxfL.join('')}</dxfs>` : '');
  const out = {}; for (const [k, v] of Object.entries(files)) out[k] = strToU8(v);
  return zipSync(out, { level: 6 });
}

/* ---------- csv / tsv ---------- */
export function parseDelimited(text, d = ',') {
  const rows = []; let row = []; let f = ''; let q = false; const t = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i += 1) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i += 1; } else q = false; } else f += ch; } else if (ch === '"' && f === '') q = true; else if (ch === d) { row.push(f); f = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i += 1; row.push(f); rows.push(row); row = []; f = ''; } else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
export function csvToWorkbook(text, d = ',') {
  const wb = new Workbook(); const s = wb.addSheet(d === '\t' ? 'TSV' : 'CSV');
  parseDelimited(text, d).forEach((row, r) => row.forEach((v, c) => { if (v !== '') { const fmt = wb.setInput(s, r, c, /^[=']/.test(v) ? `'${v}` : v); if (fmt) wb.setStyle(s, r, c, { nf: fmt }); } }));
  return wb;
}
export function workbookToCsv(wb, d = ',', sheetIx = 0) {
  wb.ensure(); const s = wb.sheets[sheetIx]; const { fmtText } = wb._fmt || {};
  void fmtText; const lines = [];
  for (let r = 0; r <= s.maxRow; r += 1) {
    const row = [];
    for (let c = 0; c <= s.maxCol; c += 1) { const v = wb.getValue(s, r, c); let t = v === null ? '' : isErr(v) ? v.code : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v); if (t.includes('"') || t.includes(d) || /[\r\n]/.test(t)) t = `"${t.replace(/"/g, '""')}"`; row.push(t); }
    lines.push(row.join(d));
  }
  return lines.join('\r\n');
}

/* ---------- JSON snapshot for local drafts (cheap, no zip) ---------- */
export function serializeWb(wb) {
  const enc = (v) => (isErr(v) ? { e: v.code } : v);
  return JSON.stringify({ v: 1, styles: wb.styles, names: [...wb.names.values()], sheets: wb.sheets.map((s) => ({ name: s.name, cells: [...s.cells].map(([k, c]) => [k, enc(c.v), c.f, c.s]), colW: [...s.colW], rowH: [...s.rowH], hr: [...s.hiddenRows], hc: [...s.hiddenCols], merges: s.merges, freeze: s.freeze, cf: s.cf.map(({ _c, ...r }) => r), filter: s.filter ? { rng: s.filter.rng, cols: s.filter.cols, hidden: [...(s.filter.hidden || [])] } : null, charts: s.charts.map(({ _d, ...c }) => c) })) });
}
export function deserializeWb(text) {
  const j = JSON.parse(text); const wb = new Workbook(); wb.styles = j.styles || [{}];
  (j.names || []).forEach((n) => wb.names.set(n.name.toUpperCase(), n));
  for (const sj of j.sheets) {
    const s = wb.addSheet(sj.name);
    for (const [k, v, f, st] of sj.cells) { s.cells.set(k, { v: v && typeof v === 'object' && v.e ? ERR_BY_CODE[v.e] : v, f, s: st }); s.bump(keyR(k), keyC(k)); }
    s.colW = new Map(sj.colW); s.manualW = new Set(sj.colW.map((x) => x[0])); s.rowH = new Map(sj.rowH); s.hiddenRows = new Set(sj.hr); s.hiddenCols = new Set(sj.hc); s.merges = sj.merges || []; s.freeze = sj.freeze || { r: 0, c: 0 };
    s.cf = sj.cf || []; s.charts = sj.charts || []; s.filter = sj.filter ? { rng: sj.filter.rng, cols: sj.filter.cols || {}, hidden: new Set(sj.filter.hidden || []) } : null;
  }
  wb.touch(); return wb;
}
