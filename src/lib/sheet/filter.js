import { displayOf } from './draw.js';
import { cmp } from './core.js';

/**
 * AutoFilter. sheet.filter = { rng:{r1,c1,r2,c2}, cols:{ [c]: { allow:[displayText…] } }, hidden:Set<row> }
 * The first row of rng is the header; rows hidden by the filter are tracked in `hidden` so that clearing the filter never un-hides rows the user hid by hand.
 */
export const BLANK = '\u0000blank';

export const textAt = (wb, sheet, r, c) => { const t = displayOf(wb, sheet, r, c, false).text; return t === '' ? BLANK : t; };

/** Distinct values of a column (data rows only), sorted like Excel: numbers, then text. */
export function uniqueValues(wb, sheet, f, c) {
  const seen = new Map();
  for (let r = f.rng.r1 + 1; r <= f.rng.r2; r += 1) {
    const t = textAt(wb, sheet, r, c); if (seen.has(t)) { seen.get(t).n += 1; continue; }
    seen.set(t, { t, v: wb.getValue(sheet, r, c), n: 1 });
  }
  return [...seen.values()].sort((a, b) => { if (a.t === BLANK) return 1; if (b.t === BLANK) return -1; return cmp(a.v, b.v); });
}

/** Recomputes which rows are hidden by the filter. */
export function applyFilter(wb, sheet) {
  const f = sheet.filter; if (!f) return;
  for (const r of f.hidden || []) sheet.hiddenRows.delete(r);
  f.hidden = new Set();
  const active = Object.entries(f.cols).filter(([, v]) => v && v.allow).map(([c, v]) => [+c, new Set(v.allow)]);
  if (active.length) {
    for (let r = f.rng.r1 + 1; r <= f.rng.r2; r += 1) {
      if (active.every(([c, set]) => set.has(textAt(wb, sheet, r, c)))) continue;
      sheet.hiddenRows.add(r); f.hidden.add(r);
    }
  }
  wb.touch();
}

export function clearFilter(wb, sheet) {
  const f = sheet.filter; if (!f) return;
  for (const r of f.hidden || []) sheet.hiddenRows.delete(r);
  sheet.filter = null; wb.touch();
}

export const activeCount = (f) => (f ? Object.values(f.cols).filter((v) => v && v.allow).length : 0);
export const visibleCount = (f) => (f ? f.rng.r2 - f.rng.r1 - (f.hidden ? f.hidden.size : 0) : 0);
