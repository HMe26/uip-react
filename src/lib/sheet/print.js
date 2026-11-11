import { key, colName } from './addr.js';
import { displayOf, mergeIndex, DEF_W, DEF_H, FONT } from './draw.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const RTL = /[֐-ࣿ]/;

/** HTML of the used range (or the selection) of a sheet, ready to print. Hidden rows / columns are skipped, merges and the cell formatting are kept. */
export function sheetHtml(wb, sheet, { range, grid = false, landscape = false, title = '', rtl = false } = {}) {
  const g = range || { r1: 0, c1: 0, r2: Math.max(sheet.maxRow, 0), c2: Math.max(sheet.maxCol, 0) };
  const cover = mergeIndex(sheet);
  const cols = []; for (let c = g.c1; c <= g.c2; c += 1) if (!sheet.hiddenCols.has(c)) cols.push(c);
  const rows = []; for (let r = g.r1; r <= g.r2; r += 1) if (!sheet.hiddenRows.has(r)) rows.push(r);
  let body = '';
  for (const r of rows) {
    const h = sheet.rowH.get(r) ?? DEF_H;
    body += `<tr style="height:${Math.round(h * 0.75)}pt">`;
    for (const c of cols) {
      const m = cover.get(key(r, c));
      if (m && (m.r1 !== r || m.c1 !== c)) continue; // covered by a merged cell
      const d = displayOf(wb, sheet, r, c, false); const st = d.st || {};
      let css = '';
      if (st.b) css += 'font-weight:700;'; if (st.i) css += 'font-style:italic;';
      if (st.u || st.st) css += `text-decoration:${st.u ? 'underline ' : ''}${st.st ? 'line-through' : ''};`;
      if (st.fs) css += `font-size:${st.fs}pt;`; if (st.font) css += `font-family:"${st.font}",${FONT};`;
      const fg = d.color || st.color; if (fg) css += `color:${fg};`; if (st.bg) css += `background:${st.bg};`;
      const al = st.al || (d.num ? 'right' : ''); if (al) css += `text-align:${al};`;
      if (st.va) css += `vertical-align:${st.va === 'center' ? 'middle' : st.va};`;
      if (st.ind) css += `padding-inline-start:${st.ind * 7}px;`;
      if (!st.wrap) css += 'white-space:nowrap;';
      if (st.bd) for (const [side, [sty, col]] of Object.entries(st.bd)) css += `border-${{ t: 'top', b: 'bottom', l: 'left', r: 'right' }[side]}:${sty === 'thick' ? 3 : sty === 'medium' ? 2 : 1}px solid ${col};`;
      let attrs = '';
      if (m) { const rs = rows.filter((x) => x >= m.r1 && x <= m.r2).length; const cs = cols.filter((x) => x >= m.c1 && x <= m.c2).length; if (rs > 1) attrs += ` rowspan="${rs}"`; if (cs > 1) attrs += ` colspan="${cs}"`; }
      body += `<td${attrs} style="${css}" dir="${RTL.test(d.text) ? 'rtl' : 'auto'}">${esc(d.text).replace(/\n/g, '<br>')}</td>`;
    }
    body += '</tr>';
  }
  const colgroup = cols.map((c) => `<col style="width:${Math.round((sheet.colW.get(c) ?? DEF_W) * 0.75)}pt">`).join('');
  return `<!doctype html><html dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: ${FONT}; font-size: 10.5pt; color: #000; }
table { border-collapse: collapse; table-layout: fixed; }
td { padding: 1px 4px; overflow: hidden; text-overflow: clip; ${grid ? 'border: 1px solid #b6b6b6;' : ''} }
tr { page-break-inside: avoid; }
thead { display: table-header-group; }
</style></head><body><table><colgroup>${colgroup}</colgroup><tbody>${body}</tbody></table></body></html>`;
}

/** Print through a hidden iframe so only the sheet is printed (never the whole web page). */
export function printHtml(html) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(f);
  const w = f.contentWindow; const d = f.contentDocument;
  d.open(); d.write(html); d.close();
  const clean = () => setTimeout(() => f.remove(), 500);
  w.addEventListener('afterprint', clean);
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* printing blocked */ } setTimeout(clean, 60000); }, 150);
}

export const rangeLabel = (g) => `${colName(g.c1)}${g.r1 + 1}:${colName(g.c2)}${g.r2 + 1}`;
