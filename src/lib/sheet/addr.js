/** A1-style address helpers (0-based rows / columns inside the engine). */
export const MAXR = 1048576;
export const MAXC = 16384;

export const colName = (i) => { let s = ''; let n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
export const colIndex = (s) => { let n = 0; const u = s.toUpperCase(); for (let i = 0; i < u.length; i += 1) n = n * 26 + (u.charCodeAt(i) - 64); return n - 1; };
export const addr = (r, c, ar = false, ac = false) => `${ac ? '$' : ''}${colName(c)}${ar ? '$' : ''}${r + 1}`;

const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;
export function parseCell(s) {
  const m = CELL.exec(String(s).trim());
  if (!m) return null;
  const c = colIndex(m[2]); const r = Number(m[4]) - 1;
  if (c >= MAXC || r < 0 || r >= MAXR) return null;
  return { r, c, ar: !!m[3], ac: !!m[1] };
}
/** "A1", "A1:C5", "A:A", "2:4" -> { r1, c1, r2, c2 } (whole columns / rows get the sheet limits). */
export function parseRange(s) {
  const t = String(s).trim().replace(/\$/g, '');
  const parts = t.split(':');
  if (parts.length === 1) { const a = parseCell(parts[0]); return a ? { r1: a.r, c1: a.c, r2: a.r, c2: a.c } : null; }
  if (parts.length !== 2) return null;
  const a = parseCell(parts[0]); const b = parseCell(parts[1]);
  if (a && b) return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
  if (/^[A-Za-z]{1,3}$/.test(parts[0]) && /^[A-Za-z]{1,3}$/.test(parts[1])) { const x = colIndex(parts[0]); const y = colIndex(parts[1]); return { r1: 0, c1: Math.min(x, y), r2: MAXR - 1, c2: Math.max(x, y) }; }
  if (/^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) { const x = Number(parts[0]) - 1; const y = Number(parts[1]) - 1; return { r1: Math.min(x, y), c1: 0, r2: Math.max(x, y), c2: MAXC - 1 }; }
  return null;
}
export const rangeStr = (g) => (g.r1 === g.r2 && g.c1 === g.c2 ? addr(g.r1, g.c1) : `${addr(g.r1, g.c1)}:${addr(g.r2, g.c2)}`);
export const key = (r, c) => r * MAXC + c;
export const keyR = (k) => Math.floor(k / MAXC);
export const keyC = (k) => k % MAXC;
