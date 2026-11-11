import { rangeStr, parseRange, colName } from './addr.js';
import { DEF_W, DEF_H } from './draw.js';
import { chartData } from './chart.js';
import { BLANK } from './filter.js';
import { newId } from './cf.js';
import { newChartId } from './chart.js';

/** xlsx round-trip of the features the grid adds on top of cells: conditional formats, AutoFilter and charts. */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const argb = (c) => `FF${String(c).replace('#', '').toUpperCase()}`;
const unargb = (c) => (c ? `#${String(c).slice(-6).toLowerCase()}` : null);
const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart'; const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'; const NS_XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const OPS = { gt: 'greaterThan', lt: 'lessThan', ge: 'greaterThanOrEqual', le: 'lessThanOrEqual', eq: 'equal', ne: 'notEqual', btw: 'between', nbtw: 'notBetween' };
const OPS_BACK = Object.fromEntries(Object.entries(OPS).map(([k, v]) => [v, k]));
const PALETTE = ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '264478', '9E480E'];

/* =============================================================== conditional formatting */
export const dxfXml = (f) => `<dxf>${f.color || f.b ? `<font>${f.b ? '<b/>' : ''}${f.color ? `<color rgb="${argb(f.color)}"/>` : ''}</font>` : ''}${f.bg ? `<fill><patternFill><bgColor rgb="${argb(f.bg)}"/></patternFill></fill>` : ''}</dxf>`;
const lit = (v) => (v !== '' && Number.isFinite(Number(v)) ? String(Number(v)) : `"${String(v).replace(/"/g, '""')}"`);

/** <conditionalFormatting> elements for a sheet. `dxf(fmt)` returns the dxf index. */
export function cfXml(sheet, dxf) {
  let pr = 1;
  return sheet.cf.map((r) => {
    const sq = rangeStr(r.rng); const tl = `${colName(r.rng.c1)}${r.rng.r1 + 1}`; const d = r.fmt ? ` dxfId="${dxf(r.fmt)}"` : ''; let rule = '';
    switch (r.kind) {
      case 'cell': rule = `<cfRule type="cellIs"${d} priority="${pr}" operator="${OPS[r.op]}"><formula>${esc(lit(r.v1))}</formula>${r.op === 'btw' || r.op === 'nbtw' ? `<formula>${esc(lit(r.v2))}</formula>` : ''}</cfRule>`; break;
      case 'text': { const t = esc(r.text || ''); const q = `"${String(r.text || '').replace(/"/g, '""')}"`;
        const f = { contains: [`containsText`, `containsText`, `NOT(ISERROR(SEARCH(${q},${tl})))`], notcontains: [`notContainsText`, `notContains`, `ISERROR(SEARCH(${q},${tl}))`], begins: [`beginsWith`, `beginsWith`, `LEFT(${tl},LEN(${q}))=${q}`], ends: [`endsWith`, `endsWith`, `RIGHT(${tl},LEN(${q}))=${q}`] }[r.tmode];
        rule = `<cfRule type="${f[0]}"${d} priority="${pr}" operator="${f[1]}" text="${t}"><formula>${esc(f[2])}</formula></cfRule>`; break; }
      case 'dup': rule = `<cfRule type="duplicateValues"${d} priority="${pr}"/>`; break;
      case 'uniq': rule = `<cfRule type="uniqueValues"${d} priority="${pr}"/>`; break;
      case 'top': rule = `<cfRule type="top10"${d} priority="${pr}" rank="${r.n}"${r.pct ? ' percent="1"' : ''}${r.bottom ? ' bottom="1"' : ''}/>`; break;
      case 'avg': rule = `<cfRule type="aboveAverage"${d} priority="${pr}"${r.below ? ' aboveAverage="0"' : ''}/>`; break;
      case 'expr': rule = `<cfRule type="expression"${d} priority="${pr}"><formula>${esc(String(r.expr).replace(/^=/, ''))}</formula></cfRule>`; break;
      case 'scale': rule = `<cfRule type="colorScale" priority="${pr}"><colorScale><cfvo type="min"/>${r.colors.length === 3 ? '<cfvo type="percentile" val="50"/>' : ''}<cfvo type="max"/>${r.colors.map((c) => `<color rgb="${argb(c)}"/>`).join('')}</colorScale></cfRule>`; break;
      case 'bar': rule = `<cfRule type="dataBar" priority="${pr}"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="${argb(r.color)}"/></dataBar></cfRule>`; break;
      default: return '';
    }
    pr += 1; return `<conditionalFormatting sqref="${sq}">${rule}</conditionalFormatting>`;
  }).join('');
}

export function readCf(H, ws, dxfs) {
  const { kids, kid, textOf } = H; const out = [];
  for (const cf of kids(ws, 'conditionalFormatting')) {
    const refs = String(cf.a.sqref || '').split(/\s+/).map((x) => parseRange(x)).filter(Boolean);
    for (const cr of kids(cf, 'cfRule')) {
      const t = cr.a.type; const fm = kids(cr, 'formula').map(textOf); const dx = cr.a.dxfId !== undefined ? dxfs[+cr.a.dxfId] : null; const unq = (s) => { const m = /^"(.*)"$/.exec(s || ''); return m ? m[1].replace(/""/g, '"') : s; };
      let base = null;
      if (t === 'cellIs' && OPS_BACK[cr.a.operator]) base = { kind: 'cell', op: OPS_BACK[cr.a.operator], v1: unq(fm[0]), v2: unq(fm[1]), fmt: dx };
      else if (t === 'containsText' || t === 'notContainsText' || t === 'beginsWith' || t === 'endsWith') base = { kind: 'text', tmode: { containsText: 'contains', notContainsText: 'notcontains', beginsWith: 'begins', endsWith: 'ends' }[t], text: cr.a.text || '', fmt: dx };
      else if (t === 'duplicateValues') base = { kind: 'dup', fmt: dx }; else if (t === 'uniqueValues') base = { kind: 'uniq', fmt: dx };
      else if (t === 'top10') base = { kind: 'top', n: +cr.a.rank || 10, pct: cr.a.percent === '1', bottom: cr.a.bottom === '1', fmt: dx };
      else if (t === 'aboveAverage') base = { kind: 'avg', below: cr.a.aboveAverage === '0', fmt: dx };
      else if (t === 'expression') base = { kind: 'expr', expr: fm[0] || '', fmt: dx };
      else if (t === 'colorScale') { const cols = kids(kid(cr, 'colorScale'), 'color').map((c) => unargb(c.a.rgb)).filter(Boolean); if (cols.length >= 2) base = { kind: 'scale', colors: cols.slice(0, 3) }; }
      else if (t === 'dataBar') { const c = kid(kid(cr, 'dataBar'), 'color'); base = { kind: 'bar', color: (c && unargb(c.a.rgb)) || '#638ec6' }; }
      if (!base || ((base.kind !== 'scale' && base.kind !== 'bar') && !base.fmt)) continue;
      for (const g of refs) out.push({ id: newId(), rng: g, ...base, _p: +cr.a.priority || 0 });
    }
  }
  out.sort((a, b) => a._p - b._p); out.forEach((r) => { delete r._p; }); return out;
}
export function readDxfs(H, stX) {
  const { kids, kid } = H;
  return kids(kid(stX, 'dxfs'), 'dxf').map((d) => { const f = kid(d, 'font'); const fl = kid(kid(d, 'fill'), 'patternFill'); const o = {};
    if (f && kid(f, 'b')) o.b = 1; const fc = f && kid(f, 'color'); if (fc && fc.a.rgb) o.color = unargb(fc.a.rgb);
    const bg = fl && (kid(fl, 'bgColor') || kid(fl, 'fgColor')); if (bg && bg.a.rgb) o.bg = unargb(bg.a.rgb); return o; });
}

/* =============================================================== AutoFilter */
export function filterXml(sheet) {
  const f = sheet.filter; if (!f) return '';
  const cols = Object.entries(f.cols).filter(([, v]) => v && v.allow).map(([c, v]) => `<filterColumn colId="${+c - f.rng.c1}"><filters${v.allow.includes(BLANK) ? ' blank="1"' : ''}>${v.allow.filter((x) => x !== BLANK).map((x) => `<filter val="${esc(x)}"/>`).join('')}</filters></filterColumn>`).join('');
  return `<autoFilter ref="${rangeStr(f.rng)}">${cols}</autoFilter>`;
}
export function readFilter(H, ws, sheet) {
  const { kids, kid } = H; const af = kid(ws, 'autoFilter'); if (!af || !af.a.ref) return null; const rng = parseRange(af.a.ref); if (!rng) return null;
  const cols = {};
  for (const fc of kids(af, 'filterColumn')) { const fl = kid(fc, 'filters'); if (!fl) continue; const allow = kids(fl, 'filter').map((x) => x.a.val); if (fl.a.blank === '1') allow.push(BLANK); cols[rng.c1 + +fc.a.colId] = { allow }; }
  const hidden = new Set(); for (let r = rng.r1 + 1; r <= rng.r2; r += 1) if (sheet.hiddenRows.has(r)) hidden.add(r);
  return { rng, cols, hidden };
}

/* =============================================================== charts */
const sheetRef = (s) => `'${s.name.replace(/'/g, "''")}'`;
const absRef = (sheet, r1, c1, r2, c2) => `${sheetRef(sheet)}!$${colName(c1)}$${r1 + 1}${r1 === r2 && c1 === c2 ? '' : `:$${colName(c2)}$${r2 + 1}`}`;
const strCache = (arr) => `<c:strCache><c:ptCount val="${arr.length}"/>${arr.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
const numCache = (arr) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${arr.length}"/>${arr.map((v, i) => (v === null ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('')}</c:numCache>`;

function pxToAnchor(sheet, x, y) {
  let c = 0; let acc = 0; let w = 0; while (true) { w = sheet.hiddenCols.has(c) ? 0 : (sheet.colW.get(c) ?? DEF_W); if (acc + w > x || c > 16000) break; acc += w; c += 1; }
  let r = 0; let accy = 0; let h = 0; while (true) { h = sheet.hiddenRows.has(r) ? 0 : (sheet.rowH.get(r) ?? DEF_H); if (accy + h > y || r > 1048000) break; accy += h; r += 1; }
  return { col: c, colOff: Math.round((x - acc) * 9525), row: r, rowOff: Math.round((y - accy) * 9525) };
}

export function chartXml(wb, sheet, ch) {
  const d = chartData(wb, sheet, ch); const g = ch.rng; const h = d.hdr ? 1 : 0; const l = d.lab ? 1 : 0; const byRow = d.byRow;
  const pie = ch.type === 'pie' || ch.type === 'donut'; const scatter = ch.type === 'scatter';
  const catRef = d.lab || d.hdr ? (byRow ? (d.hdr ? absRef(sheet, g.r1, g.c1 + l, g.r1, g.c2) : null) : (d.lab ? absRef(sheet, g.r1 + h, g.c1, g.r2, g.c1) : null)) : null;
  const sers = d.series.map((s, i) => {
    if (pie && i > 0) return '';
    const valRef = byRow ? absRef(sheet, g.r1 + h + i, g.c1 + l, g.r1 + h + i, g.c2) : absRef(sheet, g.r1 + h, g.c1 + l + i, g.r2, g.c1 + l + i);
    const nameRef = byRow ? (d.lab ? absRef(sheet, g.r1 + h + i, g.c1, g.r1 + h + i, g.c1) : null) : (d.hdr ? absRef(sheet, g.r1, g.c1 + l + i, g.r1, g.c1 + l + i) : null);
    const tx = nameRef ? `<c:tx><c:strRef><c:f>${esc(nameRef)}</c:f>${strCache([s.name])}</c:strRef></c:tx>` : `<c:tx><c:v>${esc(s.name)}</c:v></c:tx>`;
    const colr = PALETTE[i % PALETTE.length];
    const sp = scatter ? `<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="7"/><c:spPr><a:solidFill><a:srgbClr val="${colr}"/></a:solidFill></c:spPr></c:marker>` : ch.type === 'line' ? `<c:spPr><a:ln w="28575"><a:solidFill><a:srgbClr val="${colr}"/></a:solidFill></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>` : pie ? '' : `<c:spPr><a:solidFill><a:srgbClr val="${colr}"/></a:solidFill></c:spPr>`;
    const dpts = pie ? d.cats.map((_, k) => `<c:dPt><c:idx val="${k}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${PALETTE[k % PALETTE.length]}"/></a:solidFill></c:spPr></c:dPt>`).join('') : '';
    const cat = catRef ? (scatter ? `<c:xVal><c:numRef><c:f>${esc(catRef)}</c:f>${numCache(d.xs)}</c:numRef></c:xVal>` : `<c:cat><c:strRef><c:f>${esc(catRef)}</c:f>${strCache(d.cats)}</c:strRef></c:cat>`) : (scatter ? `<c:xVal><c:numLit><c:ptCount val="${d.xs.length}"/>${d.xs.map((v, k) => `<c:pt idx="${k}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numLit></c:xVal>` : '');
    const val = `<c:${scatter ? 'yVal' : 'val'}><c:numRef><c:f>${esc(valRef)}</c:f>${numCache(s.vals)}</c:numRef></c:${scatter ? 'yVal' : 'val'}>`;
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}${sp}${dpts}${cat}${val}${scatter ? '<c:smooth val="0"/>' : ''}</c:ser>`;
  }).join('');
  const ax1 = '<c:axId val="111111"/><c:axId val="222222"/>';
  const horiz = ch.type === 'bar';
  let plot;
  if (ch.type === 'col' || ch.type === 'bar') plot = `<c:barChart><c:barDir val="${horiz ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${sers}<c:gapWidth val="150"/>${ax1}</c:barChart>`;
  else if (ch.type === 'line') plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${sers}<c:marker val="1"/>${ax1}</c:lineChart>`;
  else if (ch.type === 'area') plot = `<c:areaChart><c:grouping val="standard"/><c:varyColors val="0"/>${sers}${ax1}</c:areaChart>`;
  else if (pie) plot = ch.type === 'pie' ? `<c:pieChart><c:varyColors val="1"/>${sers}<c:firstSliceAng val="0"/></c:pieChart>` : `<c:doughnutChart><c:varyColors val="1"/>${sers}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`;
  else plot = `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${sers}${ax1}</c:scatterChart>`;
  const axTail = (id, cross, pos) => `<c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${pos}"/>`;
  const common = (cross) => `<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/>`;
  let axes = '';
  if (!pie) {
    if (scatter) axes = `<c:valAx>${axTail(111111, 222222, 'b')}${common(222222)}<c:crossBetween val="midCat"/></c:valAx><c:valAx>${axTail(222222, 111111, 'l')}<c:majorGridlines/>${common(111111)}<c:crossBetween val="midCat"/></c:valAx>`;
    else axes = `<c:catAx>${axTail(111111, 222222, horiz ? 'l' : 'b')}${common(222222)}<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx><c:valAx>${axTail(222222, 111111, horiz ? 'b' : 'l')}<c:majorGridlines/>${common(111111)}<c:crossBetween val="between"/></c:valAx>`;
  }
  const title = ch.title ? `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${esc(ch.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` : '<c:autoTitleDeleted val="1"/>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:roundedCorners val="0"/><c:chart>${title}<c:plotArea><c:layout/>${plot}${axes}</c:plotArea>${ch.legend === false ? '' : '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>'}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}

/** Parts for the charts of one sheet: { drawing, drawingRels, sheetRels, charts:[{n,xml}] } (chart numbers continue from `first`). */
export function chartParts(wb, sheet, sheetNo, first) {
  if (!sheet.charts.length) return null;
  const charts = []; let anchors = ''; let rels = '';
  sheet.charts.forEach((ch, i) => {
    const n = first + i; charts.push({ n, xml: chartXml(wb, sheet, ch) });
    const a = pxToAnchor(sheet, ch.x, ch.y); const b = pxToAnchor(sheet, ch.x + ch.w, ch.y + ch.h);
    rels += `<Relationship Id="rId${i + 1}" Type="${NS_R}/chart" Target="../charts/chart${n}.xml"/>`;
    anchors += `<xdr:twoCellAnchor><xdr:from><xdr:col>${a.col}</xdr:col><xdr:colOff>${a.colOff}</xdr:colOff><xdr:row>${a.row}</xdr:row><xdr:rowOff>${a.rowOff}</xdr:rowOff></xdr:from><xdr:to><xdr:col>${b.col}</xdr:col><xdr:colOff>${b.colOff}</xdr:colOff><xdr:row>${b.row}</xdr:row><xdr:rowOff>${b.rowOff}</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
  });
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return {
    charts,
    drawing: `${head}<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}">${anchors}</xdr:wsDr>`,
    drawingRels: `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
    sheetRels: `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_R}/drawing" Target="../drawings/drawing${sheetNo}.xml"/></Relationships>`,
  };
}

const CHART_TYPE = { barChart: 'col', bar3DChart: 'col', lineChart: 'line', line3DChart: 'line', stockChart: 'line', areaChart: 'area', area3DChart: 'area', pieChart: 'pie', pie3DChart: 'pie', ofPieChart: 'pie', doughnutChart: 'donut', scatterChart: 'scatter', bubbleChart: 'scatter' };
const textsOf = (n, textOf) => (n ? textOf(n) : '');

/** Reads the charts of a worksheet. `files` = unzipped package, `sheetPath` = e.g. "xl/worksheets/sheet1.xml". */
export function readCharts(H, files, sheetPath, ws, sheet) {
  const { kids, kid, textOf, parseXml } = H; const get = (p) => (files[p] ? H.strFromU8(files[p]) : null);
  const drawingEl = kid(ws, 'drawing'); if (!drawingEl) return [];
  const rid = Object.entries(drawingEl.a).find(([k]) => /(^|:)id$/.test(k))?.[1]; if (!rid) return [];
  const dir = sheetPath.slice(0, sheetPath.lastIndexOf('/')); const base = sheetPath.slice(sheetPath.lastIndexOf('/') + 1);
  const resolve = (from, target) => { if (target.startsWith('/')) return target.slice(1); const parts = from.split('/'); parts.pop(); for (const t of target.split('/')) { if (t === '..') parts.pop(); else if (t !== '.') parts.push(t); } return parts.join('/'); };
  const relsOf = (path) => { const rp = `${path.slice(0, path.lastIndexOf('/'))}/_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`; const x = get(rp); const m = {}; if (x) kids(kid(parseXml(x), 'Relationships'), 'Relationship').forEach((r) => { m[r.a.Id] = r.a.Target; }); return m; };
  const sRels = relsOf(`${dir}/${base}`); if (!sRels[rid]) return [];
  const drawingPath = resolve(`${dir}/${base}`, sRels[rid]); const dx = get(drawingPath); if (!dx) return [];
  const dRels = relsOf(drawingPath); const out = [];
  const px = (v) => (+v || 0) / 9525;
  const colX = (c) => { let x = 0; for (let i = 0; i < c; i += 1) x += sheet.hiddenCols.has(i) ? 0 : (sheet.colW.get(i) ?? DEF_W); return x; };
  const rowY = (r) => { let y = 0; for (let i = 0; i < r; i += 1) y += sheet.hiddenRows.has(i) ? 0 : (sheet.rowH.get(i) ?? DEF_H); return y; };
  const root = kid(parseXml(dx), 'wsDr'); if (!root) return [];
  for (const an of root.c) {
    const gf = kid(an, 'graphicFrame'); const cEl = gf && kid(kid(kid(gf, 'graphic'), 'graphicData'), 'chart'); if (!cEl) continue;
    const crid = Object.entries(cEl.a).find(([k]) => /(^|:)id$/.test(k))?.[1]; const cpath = dRels[crid] && resolve(drawingPath, dRels[crid]); const cx = cpath && get(cpath); if (!cx) continue;
    let x = 0; let y = 0; let w = 480; let h = 288;
    const fr = kid(an, 'from'); const to = kid(an, 'to');
    if (fr) { x = colX(+textOf(kid(fr, 'col'))) + px(textOf(kid(fr, 'colOff'))); y = rowY(+textOf(kid(fr, 'row'))) + px(textOf(kid(fr, 'rowOff'))); }
    if (fr && to) { w = Math.max(120, colX(+textOf(kid(to, 'col'))) + px(textOf(kid(to, 'colOff'))) - x); h = Math.max(90, rowY(+textOf(kid(to, 'row'))) + px(textOf(kid(to, 'rowOff'))) - y); } else { const ext = kid(an, 'ext'); if (ext) { w = px(ext.a.cx) || w; h = px(ext.a.cy) || h; } }
    const cs = kid(parseXml(cx), 'chartSpace'); const chart = kid(cs, 'chart'); const plot = kid(chart, 'plotArea'); if (!plot) continue;
    const typeEl = plot.c.find((e) => CHART_TYPE[e.n]); if (!typeEl) continue;
    let type = CHART_TYPE[typeEl.n]; if (type === 'col' && kid(typeEl, 'barDir')?.a.val === 'bar') type = 'bar';
    let r1 = Infinity; let c1 = Infinity; let r2 = -1; let c2 = -1; let allRows = true; let nref = 0;
    const take = (f, isVal) => { const m = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(String(f).trim()); if (!m) return; const nm = (m[1] || m[2]).replace(/''/g, "'"); if (nm.toLowerCase() !== sheet.name.toLowerCase()) return; const g = parseRange(m[3].replace(/\$/g, '')); if (!g) return; r1 = Math.min(r1, g.r1); c1 = Math.min(c1, g.c1); r2 = Math.max(r2, g.r2); c2 = Math.max(c2, g.c2); if (isVal) { nref += 1; if (!(g.r1 === g.r2 && g.c1 < g.c2)) allRows = false; } };
    const walk = (n, isVal) => { if (n.n === 'f') take(textOf(n), isVal); n.c.forEach((k) => walk(k, isVal || n.n === 'val' || n.n === 'yVal')); };
    kids(typeEl, 'ser').forEach((s) => walk(s, false));
    if (r2 < 0) continue;
    const title = kid(chart, 'title') ? [...(function* t(n) { if (n.n === 't') yield n.t; for (const k of n.c) yield* t(k); }(kid(chart, 'title')))].join('') : '';
    out.push({ id: newChartId(), type, rng: { r1, c1, r2, c2 }, title, legend: !!kid(chart, 'legend'), byRow: nref > 0 && allRows && nref > 0 ? true : null, hdr: null, lab: null, x, y, w, h });
  }
  void textsOf; return out;
}
