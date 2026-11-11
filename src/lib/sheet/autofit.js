import { keyC, keyR } from './addr.js';
import { displayOf, fontOf, DEF_W } from './draw.js';

/** Column auto-fit (Excel's "AutoFit Column Width"): measures the real text with the cell's own font, Arabic included. */
export const MIN_W = 40; export const MAX_AUTO = 420; const PAD = 16;
let cx;
const ctx2d = () => { if (cx === undefined) { try { cx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null; } catch { cx = null; } } return cx; };

/** Pixel width a cell's text needs; wrapped text and merged cells do not widen a column. */
export function needWidth(wb, sheet, r, c) {
  const d = displayOf(wb, sheet, r, c, false);
  if (!d.text || d.st.wrap) return 0;
  const g = ctx2d(); let w;
  const lines = d.text.split('\n');
  if (g) { g.font = fontOf(d.st, 1); w = Math.max(...lines.map((l) => g.measureText(l).width)); } else w = Math.max(...lines.map((l) => l.length)) * 7.2;
  return Math.ceil(w + PAD + (d.st.ind || 0) * 9);
}
const inMerge = (sheet, r, c) => sheet.merges.some((m) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2 && (m.c2 > m.c1));

/** Width to fit the whole column, or null when it is empty. */
export function fitColumn(wb, sheet, c) {
  let max = 0;
  sheet.cellsIn(0, c, Math.min(sheet.maxRow, 100000), c, (r) => { if (!inMerge(sheet, r, c)) max = Math.max(max, needWidth(wb, sheet, r, c)); });
  sheet.spillIn(0, c, sheet.maxRow, c, (r) => { max = Math.max(max, needWidth(wb, sheet, r, c)); });
  return max ? Math.min(MAX_AUTO, Math.max(MIN_W, max)) : null;
}

/** After opening a file: every column without a width of its own grows to fit its content. */
export function autoFitAll(wb, sheet) {
  const best = new Map();
  let n = 0;
  for (const [k, cell] of sheet.cells) {
    if (n > 200000) break; n += 1;
    if (cell.v === null && !cell.f) continue;
    const c = keyC(k); if (sheet.colW.has(c) || sheet.manualW.has(c)) continue;
    const r = keyR(k); if (inMerge(sheet, r, c)) continue;
    const w = needWidth(wb, sheet, r, c); if (w > (best.get(c) || 0)) best.set(c, w);
  }
  for (const [c, w] of best) if (w > DEF_W) sheet.colW.set(c, Math.min(MAX_AUTO, w));
  wb.version += 1;
}

/** After typing / pasting / filling: auto-sized columns grow (never shrink) so the text is not cut off. */
export function autoGrow(wb, sheet, keys) {
  if (!Array.isArray(keys)) return;
  let changed = false;
  for (const k of keys.length > 5000 ? keys.slice(0, 5000) : keys) {
    const c = keyC(k); if (sheet.manualW.has(c)) continue;
    const r = keyR(k); if (!sheet.cells.has(k) || inMerge(sheet, r, c)) continue;
    const w = Math.min(MAX_AUTO, needWidth(wb, sheet, r, c));
    if (w > (sheet.colW.get(c) ?? DEF_W)) { sheet.colW.set(c, w); changed = true; }
  }
  if (changed) wb.version += 1;
}
