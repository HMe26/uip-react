/**
 * Line diff (LCS) for the version-history dialog: compares two texts line by line.
 * Returns ops [{ t: '=' | '-' | '+', s: line }] in file order, or null when the files are too big to compare cheaply.
 *   '-' = line only in `a` (the old version) · '+' = line only in `b` (the current file)
 */
const MAX_CELLS = 4_000_000; // size of the LCS table (a few MB): beyond it the dialog just shows the content

export function lineDiff(aText, bText) {
  const a = aText.split('\n');
  const b = bText.split('\n');
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s += 1;
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea -= 1; eb -= 1; }
  const A = a.slice(s, ea);
  const B = b.slice(s, eb);
  const n = A.length;
  const m = B.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) return null;

  const out = [];
  for (let i = 0; i < s; i += 1) out.push({ t: '=', s: a[i] });

  const w = m + 1;
  const L = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      L[i * w + j] = A[i] === B[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: '=', s: A[i] }); i += 1; j += 1; }
    else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) { out.push({ t: '-', s: A[i] }); i += 1; }
    else { out.push({ t: '+', s: B[j] }); j += 1; }
  }
  while (i < n) { out.push({ t: '-', s: A[i] }); i += 1; }
  while (j < m) { out.push({ t: '+', s: B[j] }); j += 1; }

  for (let k = ea; k < a.length; k += 1) out.push({ t: '=', s: a[k] });
  return out;
}

/** Collapses long unchanged stretches: keeps `ctx` lines around every change, the rest becomes { t: 'gap', n }. */
export function foldDiff(ops, ctx = 3) {
  const keep = Array.from({ length: ops.length }, () => false);
  ops.forEach((o, i) => {
    if (o.t === '=') return;
    for (let k = Math.max(0, i - ctx); k <= Math.min(ops.length - 1, i + ctx); k += 1) keep[k] = true;
  });
  const out = [];
  let gap = 0;
  ops.forEach((o, i) => {
    if (keep[i]) { if (gap) { out.push({ t: 'gap', n: gap }); gap = 0; } out.push(o); } else gap += 1;
  });
  if (gap) out.push({ t: 'gap', n: gap });
  return out;
}

export const diffStats = (ops) => ops.reduce((r, o) => { if (o.t === '+') r.added += 1; else if (o.t === '-') r.removed += 1; return r; }, { added: 0, removed: 0 });
