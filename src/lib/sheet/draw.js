import { key, colName } from './addr.js';
import { formatValue, general } from './format.js';
import { isErr, refTokens, parseRefBody } from './formula.js';
import { THEMES } from './themes.js';
import { cfAt } from './cf.js';
import { chartData, drawChart } from './chart.js';

export const DEF_W = 80; export const DEF_H = 24; export const HDR_W = 48; export const HDR_H = 24;
export const FONT = 'Calibri, "Segoe UI", system-ui, -apple-system, "Noto Sans Arabic", sans-serif';
export { THEMES };
export const REF_COLORS = ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47', '#9e480e', '#7030a0'];
const CSS_COLORS = { red: '#ff0000', blue: '#0000ff', green: '#00a000', yellow: '#e6b800', magenta: '#ff00ff', cyan: '#00b0b0', black: '#000000', white: '#ffffff' };
const RTL = /[\u0590-\u08ff]/;
const EMPTY = {};

/** Cumulative pixel offsets (logical units) for columns / rows; hidden ones are 0 wide. */
export function geometry(sheet, rows, cols) {
  const cx = new Float64Array(cols + 1); const ry = new Float64Array(rows + 1);
  for (let i = 0; i < cols; i += 1) cx[i + 1] = cx[i] + (sheet.hiddenCols.has(i) ? 0 : (sheet.colW.get(i) ?? DEF_W));
  const plain = sheet.rowH.size === 0 && sheet.hiddenRows.size === 0;
  for (let i = 0; i < rows; i += 1) ry[i + 1] = ry[i] + (plain ? DEF_H : sheet.hiddenRows.has(i) ? 0 : (sheet.rowH.get(i) ?? DEF_H));
  return { cx, ry, rows, cols };
}
/** Index i with arr[i] <= x < arr[i+1] (clamped). */
export function locate(arr, x) {
  let lo = 0; let hi = arr.length - 2;
  if (x < 0) return 0;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (arr[m] <= x) lo = m; else hi = m - 1; }
  return lo;
}
export const fontOf = (st, z) => `${st.i ? 'italic ' : ''}${st.b ? 'bold ' : ''}${Math.round((st.fs || 10.5) * (st.fs ? 1.333 : 1.333) * z * 10) / 10}px ${st.font ? `"${st.font}", ` : ''}${FONT}`;

export function mergeIndex(sheet) {
  const cover = new Map();
  for (const m of sheet.merges) for (let r = m.r1; r <= Math.min(m.r2, m.r1 + 2000); r += 1) for (let c = m.c1; c <= Math.min(m.c2, m.c1 + 200); c += 1) cover.set(key(r, c), m);
  return cover;
}

export function displayOf(wb, sheet, r, c, showF) {
  const cell = sheet.cells.get(key(r, c));
  const st = cell && cell.s ? wb.styles[cell.s] : EMPTY;
  if (showF && cell && cell.f) return { v: null, st, text: `=${cell.f}`, color: null, num: false };
  const v = wb.getValue(sheet, r, c);
  if (v === null) return { v, st, text: '', color: null, num: false };
  const f = formatValue(v, st.nf, { d1904: wb.d1904 });
  return { v, st, text: f.text, color: f.color ? CSS_COLORS[String(f.color).toLowerCase()] || null : null, num: typeof v === 'number' };
}

/** Draws everything. s = { wb, sheet, geom, W, H, sx, sy, z, dpr, theme, sel, edit, showGrid, showHead, showF, marching, fillDrag, cutRect } */
export function drawGrid(cv, s) {
  const { wb, sheet, geom, W, H, sx, sy, z, dpr } = s; const T = THEMES[s.theme] || THEMES.excel;
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = T.bg; g.fillRect(0, 0, W, H);
  const hw = s.showHead ? HDR_W : 0; const hh = s.showHead ? HDR_H : 0;
  const { cx, ry } = geom;
  const fr = Math.min(sheet.freeze.r || 0, geom.rows - 1); const fc = Math.min(sheet.freeze.c || 0, geom.cols - 1);
  const fw = cx[fc] * z; const fh = ry[fr] * z;
  const X = (c) => hw + cx[c] * z - (c < fc ? 0 : sx); const Y = (r) => hh + ry[r] * z - (r < fr ? 0 : sy);
  const c0 = Math.max(fc, locate(cx, (sx + fw) / z)); const r0 = Math.max(fr, locate(ry, (sy + fh) / z));
  let c1 = c0; while (c1 < geom.cols - 1 && X(c1) < W) c1 += 1;
  let r1 = r0; while (r1 < geom.rows - 1 && Y(r1) < H) r1 += 1;
  const cover = mergeIndex(sheet);
  g.textBaseline = 'middle';

  const cellBox = (r, c) => { const m = cover.get(key(r, c)); if (m) return { x: X(m.c1), y: Y(m.r1), w: X(m.c2 + 1) - X(m.c1), h: Y(m.r2 + 1) - Y(m.r1), m }; return { x: X(c), y: Y(r), w: X(c + 1) - X(c), h: Y(r + 1) - Y(r), m: null }; };
  const paint = (r, c, x, y, w, h, merged) => {
    const d = displayOf(wb, sheet, r, c, s.showF); const ov = cfAt(wb, sheet, r, c); const st = ov && ov.b && !d.st.b ? { ...d.st, b: 1 } : d.st;
    if (ov && ov.bg || st.bg) { g.fillStyle = (ov && ov.bg) || st.bg; g.fillRect(x, y, w, h); if (s.showGrid && !merged) { /* keep gridline look */ } }
    if (ov && ov.bar) { const b = ov.bar; const x0 = x + 2 + (w - 4) * Math.min(b.from, b.to); const bw = Math.max(1, (w - 4) * Math.abs(b.to - b.from)); const gr = g.createLinearGradient(x0, 0, x0 + bw, 0); gr.addColorStop(0, b.color); gr.addColorStop(1, `${b.color}55`); g.fillStyle = gr; g.fillRect(x0, y + 3, bw, h - 6); g.strokeStyle = b.color; g.lineWidth = 1; g.strokeRect(x0 + 0.5, y + 3.5, bw - 1, h - 7); }
    if (st.bd) {
      g.lineWidth = 1;
      for (const [side, [style, col]] of Object.entries(st.bd)) {
        g.strokeStyle = col; g.lineWidth = style === 'medium' ? 2 : style === 'thick' ? 3 : 1; g.beginPath();
        if (side === 'l') { g.moveTo(Math.round(x) + 0.5, y); g.lineTo(Math.round(x) + 0.5, y + h); } else if (side === 'r') { g.moveTo(Math.round(x + w) - 0.5, y); g.lineTo(Math.round(x + w) - 0.5, y + h); } else if (side === 't') { g.moveTo(x, Math.round(y) + 0.5); g.lineTo(x + w, Math.round(y) + 0.5); } else { g.moveTo(x, Math.round(y + h) - 0.5); g.lineTo(x + w, Math.round(y + h) - 0.5); }
        g.stroke();
      }
      g.lineWidth = 1;
    }
    if (d.text === '' || (s.edit && s.edit.r === r && s.edit.c === c)) return;
    const hdr = s.band && T.hdBg && r === 0; g.font = fontOf(hdr && !st.b ? { ...st, b: 1 } : st, z); g.fillStyle = (ov && ov.color) || d.color || st.color || (hdr ? T.hdFg : T.fg);
    let text = d.text; const pad = 4 * z;
    let tw = g.measureText(text).width;
    if (d.num && st.nf === undefined && tw > w - pad * 2 && typeof d.v === 'number') { // General numbers shrink their decimals before turning into ####
      for (let p = 10; p >= 0 && tw > w - pad * 2; p -= 1) { text = Math.abs(d.v) >= 1e11 || (Math.abs(d.v) < 1e-4 && d.v !== 0) ? d.v.toExponential(Math.max(0, Math.min(p, 5))).toUpperCase().replace('E+', 'E+') : String(+d.v.toFixed(Math.max(0, p - Math.max(0, Math.floor(Math.log10(Math.abs(d.v) || 1)))))); tw = g.measureText(text).width; }
    }
    let al = st.al || 'general';
    if (al === 'general') al = d.num || typeof d.v === 'boolean' ? (d.num ? 'right' : 'center') : isErr(d.v) ? 'center' : RTL.test(text) ? 'right' : 'left';
    const lineH = Math.round((st.fs ? st.fs * 1.333 : 14) * z * 1.2);
    g.save(); g.beginPath();
    let clipW = w;
    if (!st.wrap && !merged && tw > w - pad * 2) {
      if (d.num && !st.nf && al === 'right' && typeof d.v === 'number' && text.length) { /* fits after shrink or stays clipped */ }
      if (d.num || isErr(d.v)) { if (tw > w - pad * 2 && st.nf !== undefined) { text = '#'.repeat(Math.max(1, Math.floor((w - pad * 2) / Math.max(4, g.measureText('#').width)))); tw = g.measureText(text).width; } } else if (al === 'left') { // overflow into empty neighbours
        let extra = 0; let cc = c + 1;
        while (cc < geom.cols && X(cc) < W && w + extra < tw + pad * 2 && !cover.has(key(r, cc)) && wb.getValue(sheet, r, cc) === null) { extra += X(cc + 1) - X(cc); cc += 1; }
        clipW = w + extra;
      } else if (al === 'right') {
        let extra = 0; let cc = c - 1;
        while (cc >= 0 && w + extra < tw + pad * 2 && !cover.has(key(r, cc)) && wb.getValue(sheet, r, cc) === null) { extra += X(cc + 1) - X(cc); cc -= 1; }
        g.rect(x - extra, y, w + extra, h); g.clip(); g.textAlign = 'right'; g.fillText(text, x + w - pad, y + h / 2 + 1); g.restore();
        return;
      }
    }
    g.rect(x, y, clipW, h); g.clip();
    const ind = (st.ind || 0) * 9 * z;
    if (st.wrap && !merged || (st.wrap && merged)) {
      const words = text.split(/(\s+)/); const lines = []; let cur = '';
      for (const wd of words) { const t = cur + wd; if (g.measureText(t).width > w - pad * 2 && cur) { lines.push(cur.trimEnd()); cur = wd.trimStart(); } else cur = t; }
      lines.push(cur);
      const total = lines.length * lineH; const va = st.va || 'bottom'; let ty = va === 'top' ? y + 2 + lineH / 2 : va === 'center' ? y + (h - total) / 2 + lineH / 2 : y + h - total - 2 + lineH / 2;
      g.textAlign = al === 'center' ? 'center' : al === 'right' ? 'right' : 'left';
      const tx = al === 'center' ? x + w / 2 : al === 'right' ? x + w - pad : x + pad + ind;
      for (const ln of lines) { g.fillText(ln, tx, ty); ty += lineH; }
    } else {
      const va = st.va || 'bottom'; const ty = va === 'top' ? y + lineH / 2 + 1 : va === 'center' ? y + h / 2 + 1 : y + h - lineH / 2 - 1;
      g.textAlign = al === 'center' ? 'center' : al === 'right' ? 'right' : 'left';
      const tx = al === 'center' ? x + w / 2 : al === 'right' ? x + w - pad : x + pad + ind;
      g.fillText(text, tx, ty);
      if (st.u || st.st) { const wd = g.measureText(text).width; const sx0 = al === 'center' ? tx - wd / 2 : al === 'right' ? tx - wd : tx; g.strokeStyle = g.fillStyle; g.lineWidth = Math.max(1, z); g.beginPath(); if (st.u) { g.moveTo(sx0, ty + lineH / 2 - 2); g.lineTo(sx0 + wd, ty + lineH / 2 - 2); } if (st.st) { g.moveTo(sx0, ty); g.lineTo(sx0 + wd, ty); } g.stroke(); }
    }
    g.restore();
  };
  const region = (ra, rb, ca, cb, cl) => {
    if (ra > rb || ca > cb) return;
    g.save(); g.beginPath(); g.rect(cl[0], cl[1], cl[2], cl[3]); g.clip();
    if (s.band && T.hdBg) { const lc = Math.min(sheet.maxCol, geom.cols - 1); for (let r = ra; r <= Math.min(rb, sheet.maxRow); r += 1) { const col = r === 0 ? T.hdBg : (r % 2 === 0 ? T.band : null); if (!col) continue; g.fillStyle = col; g.fillRect(X(0), Y(r), X(lc + 1) - X(0), Y(r + 1) - Y(r)); } }
    if (s.showGrid) {
      g.strokeStyle = T.grid; g.lineWidth = 1; g.beginPath();
      for (let c = ca; c <= cb + 1; c += 1) { const x = Math.round(X(Math.min(c, geom.cols))) - 0.5; g.moveTo(x, hh); g.lineTo(x, H); }
      for (let r = ra; r <= rb + 1; r += 1) { const y = Math.round(Y(Math.min(r, geom.rows))) - 0.5; g.moveTo(hw, y); g.lineTo(W, y); }
      g.stroke();
    }
    const seen = new Set();
    const area = (cb - ca + 1) * (rb - ra + 1);
    const visit = (r, c) => { if (r < ra || r > rb || c < ca || c > cb) return; const k = key(r, c); if (cover.has(k) || seen.has(k)) return; seen.add(k); const w = X(c + 1) - X(c); if (w <= 0) return; const h = Y(r + 1) - Y(r); if (h <= 0) return; paint(r, c, X(c), Y(r), w, h, false); };
    if (area > sheet.cells.size * 3 + 200) { for (const k of sheet.cells.keys()) visit(Math.floor(k / 16384), k % 16384); sheet.spillIn(ra, ca, rb, cb, (r, c) => visit(r, c)); } else for (let r = ra; r <= rb; r += 1) for (let c = ca; c <= cb; c += 1) if (sheet.cells.has(key(r, c)) || sheet.spill.has(key(r, c))) visit(r, c);
    for (const m of sheet.merges) { if (m.r2 < ra || m.r1 > rb || m.c2 < ca || m.c1 > cb || m.r1 < ra || m.c1 < ca) continue; const b = cellBox(m.r1, m.c1); g.fillStyle = T.bg; g.fillRect(b.x, b.y, b.w, b.h); g.strokeStyle = T.grid; g.strokeRect(Math.round(b.x) - 0.5, Math.round(b.y) - 0.5, b.w, b.h); paint(m.r1, m.c1, b.x, b.y, b.w, b.h, true); }
    g.restore();
  };
  const bx0 = hw + fw; const by0 = hh + fh;
  region(r0, r1, c0, c1, [bx0, by0, W - bx0, H - by0]);
  if (fr) region(0, fr - 1, c0, c1, [bx0, hh, W - bx0, fh]);
  if (fc) region(r0, r1, 0, fc - 1, [hw, by0, fw, H - by0]);
  if (fr && fc) region(0, fr - 1, 0, fc - 1, [hw, hh, fw, fh]);
  if (fr || fc) { g.strokeStyle = T.accent; g.lineWidth = 1; g.beginPath(); if (fc) { g.moveTo(Math.round(bx0) - 0.5, hh); g.lineTo(Math.round(bx0) - 0.5, H); } if (fr) { g.moveTo(hw, Math.round(by0) - 0.5); g.lineTo(W, Math.round(by0) - 0.5); } g.stroke(); }

  // AutoFilter buttons on the header row of the filter range
  if (sheet.filter) {
    const f = sheet.filter; const act = (c) => f.cols[c] && f.cols[c].allow;
    g.save(); g.beginPath(); g.rect(hw, hh, W - hw, H - hh); g.clip();
    for (let c = f.rng.c1; c <= f.rng.c2; c += 1) {
      if (sheet.hiddenCols.has(c)) continue; const b = cellBox(f.rng.r1, c); if (b.x + b.w < hw || b.x > W || b.y + b.h < hh || b.y > H || b.w < 22 * z) continue;
      const bs = Math.min(16 * z, b.h - 4); const bx = b.x + b.w - bs - 2; const by = b.y + b.h - bs - 2;
      g.fillStyle = act(c) ? T.accent : (T.dark ? '#2b3550' : '#f3f3f3'); g.fillRect(bx, by, bs, bs); g.strokeStyle = act(c) ? T.accent : (T.dark ? T.grid : '#a6a6a6'); g.lineWidth = 1; g.strokeRect(bx + 0.5, by + 0.5, bs - 1, bs - 1);
      g.fillStyle = act(c) ? '#fff' : (T.dark ? T.fg : '#333'); g.beginPath(); const cx0 = bx + bs / 2; const cy0 = by + bs / 2; const t = bs * 0.22; g.moveTo(cx0 - t * 1.3, cy0 - t * 0.5); g.lineTo(cx0 + t * 1.3, cy0 - t * 0.5); g.lineTo(cx0, cy0 + t * 1.1); g.closePath(); g.fill();
    }
    g.restore();
  }
  // charts float above the cells
  if (sheet.charts && sheet.charts.length) {
    g.save(); g.beginPath(); g.rect(hw, hh, W - hw, H - hh); g.clip();
    for (const ch of sheet.charts) { const box = { x: hw + ch.x * z - sx, y: hh + ch.y * z - sy, w: ch.w * z, h: ch.h * z }; if (box.x > W || box.y > H || box.x + box.w < hw || box.y + box.h < hh) continue; drawChart(g, ch, chartData(wb, sheet, ch), box, T, z, s.selChart === ch.id); }
    g.restore();
  }
  // formula references being edited
  if (s.edit && s.edit.text[0] === '=') {
    refTokens(s.edit.text.slice(1)).filter((t) => t.t === 'ref').forEach((t, i) => {
      let p; try { p = parseRefBody(t.body); } catch { return; } if (t.sheet && t.sheet !== sheet.name) return;
      const bx = X(p.c1); const by = Y(p.r1); const bw = X(Math.min(p.c2, geom.cols - 1) + 1) - bx; const bh = Y(Math.min(p.r2, geom.rows - 1) + 1) - by;
      g.strokeStyle = REF_COLORS[i % REF_COLORS.length]; g.lineWidth = 2; g.setLineDash([]); g.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
    });
  }
  // cut / copy marching ants
  if (s.cutRect) { const q = s.cutRect; const bx = X(q.c1); const by = Y(q.r1); g.setLineDash([5, 4]); g.lineDashOffset = -(s.marching || 0); g.strokeStyle = T.accent; g.lineWidth = 2; g.strokeRect(bx, by, X(q.c2 + 1) - bx, Y(q.r2 + 1) - by); g.setLineDash([]); }

  // selection
  const sel = s.sel; const ar = sel.ar; const ac = sel.ac;
  const sb = cellBox(Math.min(sel.r2, geom.rows - 1), Math.min(sel.c2, geom.cols - 1));
  void sb;
  const rx = X(sel.c1); const ry0 = Y(sel.r1); const rw = X(sel.c2 + 1) - rx; const rh = Y(sel.r2 + 1) - ry0;
  const whole = sel.r2 - sel.r1 + 1 > 5000 || sel.c2 - sel.c1 + 1 > 500;
  const hx = Math.max(rx, hw); const hy = Math.max(ry0, hh);
  g.fillStyle = T.sel; g.fillRect(hx, hy, Math.min(rw - (hx - rx), W), Math.min(rh - (hy - ry0), H));
  const ab = cellBox(ar, ac);
  if (!(sel.r1 === sel.r2 && sel.c1 === sel.c2) || !s.edit) { g.fillStyle = T.bg; if (!s.edit) { /* active cell stays un-shaded like Excel */ g.save(); g.beginPath(); g.rect(ab.x, ab.y, ab.w, ab.h); g.clip(); g.clearRect(0, 0, 0, 0); g.restore(); } }
  g.strokeStyle = T.accent; g.lineWidth = 2; g.setLineDash([]);
  if (!whole) g.strokeRect(rx, ry0, rw, rh); else { g.beginPath(); g.moveTo(hx, hy); g.lineTo(W, hy); g.moveTo(hx, hy); g.lineTo(hx, H); g.stroke(); }
  if (!s.readOnly && !whole && !s.edit) { g.fillStyle = T.accent; g.fillRect(rx + rw - 4, ry0 + rh - 4, 7, 7); g.strokeStyle = T.bg; g.lineWidth = 1; g.strokeRect(rx + rw - 4.5, ry0 + rh - 4.5, 8, 8); }
  if (s.fillDrag) { const q = s.fillDrag; g.setLineDash([4, 3]); g.strokeStyle = T.fg; g.lineWidth = 1; g.strokeRect(X(q.c1), Y(q.r1), X(q.c2 + 1) - X(q.c1), Y(q.r2 + 1) - Y(q.r1)); g.setLineDash([]); }

  // headers
  if (s.showHead) {
    g.fillStyle = T.head; g.fillRect(hw, 0, W - hw, hh); g.fillRect(0, hh, hw, H - hh);
    g.font = `${12 * Math.min(1, Math.max(.8, z))}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const hcols = [...Array(fc).keys(), ...Array.from({ length: c1 - c0 + 1 }, (_, i) => c0 + i)]; const hrows = [...Array(fr).keys(), ...Array.from({ length: r1 - r0 + 1 }, (_, i) => r0 + i)];
    for (const c of hcols) { const x = X(c); const w = X(c + 1) - x; if (w <= 0) continue; if (c >= fc && x + w < hw + fw) continue; const on = c >= sel.c1 && c <= sel.c2; if (on) { g.fillStyle = sel.r1 === 0 && sel.r2 >= 1048575 ? T.accent : T.headOn; g.fillRect(x, 0, w, hh); } g.fillStyle = on ? (sel.r1 === 0 && sel.r2 >= 1048575 ? '#fff' : T.headOnFg) : T.headFg; g.fillText(colName(c), x + w / 2, hh / 2 + 1); g.strokeStyle = T.grid; g.beginPath(); g.moveTo(Math.round(x + w) - 0.5, 0); g.lineTo(Math.round(x + w) - 0.5, hh); g.stroke(); if (on) { g.fillStyle = T.accent; g.fillRect(x, hh - 2, w, 2); } }
    for (const r of hrows) { const y = Y(r); const h = Y(r + 1) - y; if (h <= 0) continue; if (r >= fr && y + h < hh + fh) continue; const on = r >= sel.r1 && r <= sel.r2; if (on) { g.fillStyle = sel.c1 === 0 && sel.c2 >= 16383 ? T.accent : T.headOn; g.fillRect(0, y, hw, h); } g.fillStyle = on ? (sel.c1 === 0 && sel.c2 >= 16383 ? '#fff' : T.headOnFg) : T.headFg; g.fillText(String(r + 1), hw / 2, y + h / 2 + 1); g.strokeStyle = T.grid; g.beginPath(); g.moveTo(0, Math.round(y + h) - 0.5); g.lineTo(hw, Math.round(y + h) - 0.5); g.stroke(); if (on) { g.fillStyle = T.accent; g.fillRect(hw - 2, y, 2, h); } }
    g.fillStyle = T.corner; g.fillRect(0, 0, hw, hh); g.fillStyle = T.headFg; g.beginPath(); g.moveTo(hw - 4, hh - 4); g.lineTo(hw - 14, hh - 4); g.lineTo(hw - 4, hh - 14); g.closePath(); g.fill();
    g.strokeStyle = T.grid; g.beginPath(); g.moveTo(0, Math.round(hh) - 0.5); g.lineTo(W, Math.round(hh) - 0.5); g.moveTo(Math.round(hw) - 0.5, 0); g.lineTo(Math.round(hw) - 0.5, H); g.stroke();
  }
}
void general;
