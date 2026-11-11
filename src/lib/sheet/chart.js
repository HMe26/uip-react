import { displayOf } from './draw.js';

/**
 * Charts. sheet.charts = [{ id, type, rng:{r1,c1,r2,c2}, title, legend, byRow?, hdr?, lab?, x, y, w, h }]   (x,y,w,h in sheet pixels at 100 %)
 *   type: col | bar | line | area | pie | donut | scatter
 * hdr / lab / byRow are auto-detected when null, like Excel's "Recommended" layout.
 */
export const CHART_TYPES = [
  { id: 'col', en: 'Column', ar: 'أعمدة' }, { id: 'bar', en: 'Bar', ar: 'أشرطة' }, { id: 'line', en: 'Line', ar: 'خطي' }, { id: 'area', en: 'Area', ar: 'مساحة' },
  { id: 'pie', en: 'Pie', ar: 'دائري' }, { id: 'donut', en: 'Doughnut', ar: 'دونات' }, { id: 'scatter', en: 'Scatter', ar: 'نقطي (XY)' },
];
export const PALETTE = ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47', '#264478', '#9e480e', '#636363', '#997300'];
let seq = 1; export const newChartId = () => `ch${Date.now().toString(36)}${seq++}`;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Series / categories of a chart, read from the sheet. */
export function chartData(wb, sheet, ch) {
  if (ch._d && ch._d.ver === wb.version && ch._d.sig === sigOf(ch)) return ch._d.data;
  const g = ch.rng; const rows = g.r2 - g.r1 + 1; const cols = g.c2 - g.c1 + 1;
  const raw = (i, j) => wb.getValue(sheet, g.r1 + i, g.c1 + j);
  const label = (i, j) => displayOf(wb, sheet, g.r1 + i, g.c1 + j, false).text;
  const byRow = ch.byRow ?? (rows < cols);
  // header row / label column detection
  let hdr = ch.hdr; let lab = ch.lab;
  if (hdr == null) { let t = 0; let n = 0; for (let j = 1; j < cols; j += 1) { const v = raw(0, j); if (v !== null) { n += 1; if (!isNum(v)) t += 1; } } hdr = rows > 1 && n > 0 && t >= n / 2; }
  if (lab == null) { let t = 0; let n = 0; for (let i = hdr ? 1 : 0; i < rows; i += 1) { const v = raw(i, 0); if (v !== null) { n += 1; if (!isNum(v)) t += 1; } } lab = cols > 1 && n > 0 && t >= n / 2; }
  if (ch.type === 'scatter' && cols > 1 && ch.lab == null) lab = true;
  const h = hdr ? 1 : 0; const l = lab ? 1 : 0;
  const nSeries = Math.max(0, byRow ? rows - h : cols - l); const nCats = Math.max(0, byRow ? cols - l : rows - h);
  const val = (s, c) => (byRow ? raw(s + h, c + l) : raw(c + h, s + l));
  const series = []; const cats = [];
  for (let c = 0; c < nCats; c += 1) cats.push(byRow ? (hdr ? label(0, c + l) : String(c + 1)) : (lab ? label(c + h, 0) : String(c + 1)));
  for (let s = 0; s < nSeries; s += 1) {
    const name = byRow ? (lab ? label(s + h, 0) : `Series${s + 1}`) : (hdr ? label(0, s + l) : `Series${s + 1}`);
    const vals = []; for (let c = 0; c < nCats; c += 1) { const v = val(s, c); vals.push(isNum(v) ? v : (typeof v === 'boolean' ? +v : null)); }
    series.push({ name: name || `Series${s + 1}`, vals });
  }
  const xs = cats.map((t, i) => { const n = Number(String(t).replace(/,/g, '')); return Number.isFinite(n) && String(t).trim() !== '' ? n : i + 1; });
  const data = { cats, series, xs, hdr, lab, byRow };
  ch._d = { ver: wb.version, sig: sigOf(ch), data };
  return data;
}
const sigOf = (ch) => `${ch.type}|${ch.rng.r1},${ch.rng.c1},${ch.rng.r2},${ch.rng.c2}|${ch.byRow}|${ch.hdr}|${ch.lab}`;

/* ------------------------------------------------------------------ drawing */
const niceScale = (lo, hi, ticks = 5) => {
  if (lo === hi) { if (lo === 0) { hi = 1; } else { lo = Math.min(0, lo); hi = Math.max(0, hi) || 1; } }
  const span = hi - lo; const raw = span / ticks; const mag = 10 ** Math.floor(Math.log10(raw)); const f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
  const a = Math.floor(lo / step) * step; const b = Math.ceil(hi / step) * step; const out = [];
  for (let v = a; v <= b + step / 2; v += step) out.push(Math.round(v / step) * step);
  return out;
};
const fmtNum = (v) => { const a = Math.abs(v); if (a >= 1e9) return `${+(v / 1e9).toFixed(2)}B`; if (a >= 1e6) return `${+(v / 1e6).toFixed(2)}M`; if (a >= 1e4) return `${+(v / 1e3).toFixed(1)}K`; return String(+v.toFixed(4)); };
const trunc = (g, t, w) => { let s = String(t); if (g.measureText(s).width <= w) return s; while (s.length > 1 && g.measureText(`${s}…`).width > w) s = s.slice(0, -1); return `${s}…`; };

/** Draws chart `ch` into box {x,y,w,h} (screen px). `T` = sheet theme colours. */
export function drawChart(g, ch, data, box, T, z, selected) {
  const { x, y, w, h } = box; const fs = Math.max(8, 11 * z);
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = T.bg === '#ffffff' || !T.dark ? '#ffffff' : T.bg; g.fillRect(x, y, w, h);
  const ink = T.dark ? T.fg : '#404040'; const soft = T.dark ? T.grid : '#d9d9d9';
  g.textBaseline = 'middle'; g.textAlign = 'center';
  let top = y + 8 * z;
  if (ch.title) { g.font = `600 ${fs * 1.35}px "Segoe UI", Calibri, "Noto Sans Arabic", sans-serif`; g.fillStyle = ink; g.fillText(trunc(g, ch.title, w - 20 * z), x + w / 2, y + 18 * z); top = y + 34 * z; }
  const series = data.series.filter((s) => s.vals.some((v) => v !== null));
  const pie = ch.type === 'pie' || ch.type === 'donut';
  const legendItems = pie ? data.cats.map((c, i) => ({ name: c, col: PALETTE[i % PALETTE.length] })) : data.series.map((s, i) => ({ name: s.name, col: PALETTE[i % PALETTE.length] }));
  let bottom = y + h - 8 * z;
  if (ch.legend !== false && legendItems.length && (pie || legendItems.length > 1 || ch.title === undefined)) {
    g.font = `${fs}px "Segoe UI", Calibri, "Noto Sans Arabic", sans-serif`; g.textAlign = 'left';
    const itemW = (i) => g.measureText(trunc(g, i.name, 110 * z)).width + 26 * z; let total = 0; legendItems.forEach((i) => { total += itemW(i); });
    let lx = x + Math.max(8 * z, (w - total) / 2); const ly = y + h - 14 * z;
    legendItems.forEach((i) => { if (lx + itemW(i) > x + w) return; g.fillStyle = i.col; g.fillRect(lx, ly - 4 * z, 9 * z, 9 * z); g.fillStyle = ink; g.fillText(trunc(g, i.name, 110 * z), lx + 14 * z, ly); lx += itemW(i); });
    bottom = y + h - 28 * z;
  }
  g.font = `${fs}px "Segoe UI", Calibri, "Noto Sans Arabic", sans-serif`;
  if (!series.length) { g.fillStyle = ink; g.textAlign = 'center'; g.fillText('—', x + w / 2, y + h / 2); }
  else if (pie) {
    const s = series[0]; const vals = s.vals.map((v) => Math.max(0, v || 0)); const sum = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = x + w / 2; const cy = (top + bottom) / 2; const R = Math.max(10, Math.min((w - 20 * z) / 2, (bottom - top) / 2) - 4 * z);
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => { const a1 = a0 + (v / sum) * Math.PI * 2; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a1); g.closePath(); g.fillStyle = PALETTE[i % PALETTE.length]; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke();
      if (v / sum > 0.04) { const am = (a0 + a1) / 2; g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = `600 ${fs}px sans-serif`; g.fillText(`${Math.round((v / sum) * 100)}%`, cx + Math.cos(am) * R * (ch.type === 'donut' ? 0.78 : 0.62), cy + Math.sin(am) * R * (ch.type === 'donut' ? 0.78 : 0.62)); } a0 = a1; });
    if (ch.type === 'donut') { g.beginPath(); g.arc(cx, cy, R * 0.55, 0, Math.PI * 2); g.fillStyle = g.canvas && T.dark ? T.bg : '#ffffff'; g.fill(); }
  } else {
    const horiz = ch.type === 'bar'; const scatter = ch.type === 'scatter';
    const all = series.flatMap((s) => s.vals).filter((v) => v !== null);
    let lo = Math.min(0, ...all); let hi = Math.max(0, ...all); if (scatter) { lo = Math.min(...all); hi = Math.max(...all); }
    const ticks = niceScale(lo, hi, horiz ? Math.max(3, Math.floor((w - 80 * z) / (70 * z))) : Math.max(3, Math.floor((bottom - top) / (34 * z))));
    const vmin = ticks[0]; const vmax = ticks[ticks.length - 1];
    g.font = `${fs}px "Segoe UI", Calibri, sans-serif`;
    const labW = Math.max(...ticks.map((t) => g.measureText(fmtNum(t)).width), 10);
    const catH = horiz ? 0 : 20 * z;
    const catW = horiz ? Math.min(w * 0.3, Math.max(...data.cats.map((c) => g.measureText(String(c)).width), 10)) + 8 * z : 0;
    const px0 = x + (horiz ? catW + 10 * z : labW + 16 * z); const px1 = x + w - 14 * z; const py0 = top + 4 * z; const py1 = bottom - (horiz ? 18 * z : catH);
    const pw = Math.max(10, px1 - px0); const ph = Math.max(10, py1 - py0);
    const vx = (v) => px0 + ((v - vmin) / (vmax - vmin || 1)) * pw; const vy = (v) => py1 - ((v - vmin) / (vmax - vmin || 1)) * ph;
    g.strokeStyle = soft; g.lineWidth = 1; g.fillStyle = ink; g.beginPath();
    ticks.forEach((t) => { if (horiz) { const gx = Math.round(vx(t)) + 0.5; g.moveTo(gx, py0); g.lineTo(gx, py1); } else { const gy = Math.round(vy(t)) + 0.5; g.moveTo(px0, gy); g.lineTo(px1, gy); } }); g.stroke();
    ticks.forEach((t) => { if (horiz) { g.textAlign = 'center'; g.fillText(fmtNum(t), vx(t), py1 + 11 * z); } else { g.textAlign = 'right'; g.fillText(fmtNum(t), px0 - 6 * z, vy(t)); } });
    const n = data.cats.length || 1; const ns = series.length;
    if (scatter) {
      const xsv = data.xs; const xlo = Math.min(...xsv); const xhi = Math.max(...xsv); const xt = niceScale(xlo, xhi, 5); const xmin = xt[0]; const xmax = xt[xt.length - 1];
      const sx = (v) => px0 + ((v - xmin) / (xmax - xmin || 1)) * pw;
      g.textAlign = 'center'; xt.forEach((t) => g.fillText(fmtNum(t), sx(t), py1 + 11 * z));
      series.forEach((s, si) => { g.fillStyle = PALETTE[si % PALETTE.length]; s.vals.forEach((v, i) => { if (v === null) return; g.beginPath(); g.arc(sx(xsv[i]), vy(v), 3.5 * z, 0, Math.PI * 2); g.fill(); }); });
    } else if (horiz) {
      const band = ph / n; const bw = Math.min(band * 0.7 / ns, 40 * z);
      data.cats.forEach((c, i) => { g.fillStyle = ink; g.textAlign = 'right'; g.fillText(trunc(g, c, catW), px0 - 6 * z, py0 + band * (i + 0.5)); });
      series.forEach((s, si) => { g.fillStyle = PALETTE[si % PALETTE.length]; s.vals.forEach((v, i) => { if (v === null) return; const yy = py0 + band * (i + 0.5) - (bw * ns) / 2 + bw * si; const a = vx(0); const b = vx(v); g.fillRect(Math.min(a, b), yy, Math.abs(b - a), bw - 1); }); });
    } else {
      const band = pw / n; g.fillStyle = ink; g.textAlign = 'center';
      const step = Math.max(1, Math.ceil((g.measureText(String(data.cats.reduce((a, b) => (String(b).length > String(a).length ? b : a), ''))).width + 6) / band));
      data.cats.forEach((c, i) => { if (i % step === 0) g.fillText(trunc(g, c, band * step - 4), px0 + band * (i + 0.5), py1 + 12 * z); });
      if (ch.type === 'col') {
        const bw = Math.min(band * 0.72 / ns, 46 * z);
        series.forEach((s, si) => { g.fillStyle = PALETTE[si % PALETTE.length]; s.vals.forEach((v, i) => { if (v === null) return; const xx = px0 + band * (i + 0.5) - (bw * ns) / 2 + bw * si; const a = vy(0); const b = vy(v); g.fillRect(xx, Math.min(a, b), bw - 1, Math.abs(b - a)); }); });
      } else {
        series.forEach((s, si) => {
          const col = PALETTE[si % PALETTE.length]; const pts = s.vals.map((v, i) => (v === null ? null : [px0 + band * (i + 0.5), vy(v)]));
          if (ch.type === 'area') { g.beginPath(); let started = false; let last = null; pts.forEach((p) => { if (!p) return; if (!started) { g.moveTo(p[0], vy(0)); g.lineTo(p[0], p[1]); started = true; } else g.lineTo(p[0], p[1]); last = p; }); if (last) { g.lineTo(last[0], vy(0)); g.closePath(); g.globalAlpha = 0.45; g.fillStyle = col; g.fill(); g.globalAlpha = 1; } }
          g.beginPath(); let pen = false; g.strokeStyle = col; g.lineWidth = 2.2 * z; g.lineJoin = 'round';
          pts.forEach((p) => { if (!p) { pen = false; return; } if (!pen) { g.moveTo(p[0], p[1]); pen = true; } else g.lineTo(p[0], p[1]); }); g.stroke();
          if (ch.type === 'line') { g.fillStyle = col; pts.forEach((p) => { if (!p) return; g.beginPath(); g.arc(p[0], p[1], 3 * z, 0, Math.PI * 2); g.fill(); }); }
        });
      }
    }
    g.strokeStyle = ink; g.lineWidth = 1; g.beginPath(); if (horiz) { const a = Math.round(vx(Math.max(vmin, Math.min(0, vmax)))) + 0.5; g.moveTo(a, py0); g.lineTo(a, py1); } else { const a = Math.round(vy(Math.max(vmin, Math.min(0, vmax)))) + 0.5; g.moveTo(px0, a); g.lineTo(px1, a); } g.stroke();
  }
  g.restore();
  g.strokeStyle = selected ? '#217346' : (T.dark ? T.grid : '#bfbfbf'); g.lineWidth = selected ? 2 : 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (selected) { g.fillStyle = '#ffffff'; g.strokeStyle = '#217346'; g.lineWidth = 1.5; for (const [hx, hy] of handles(box)) { g.fillRect(hx - 4, hy - 4, 8, 8); g.strokeRect(hx - 4, hy - 4, 8, 8); } }
}

/** The 8 resize handles of a box, in order nw n ne e se s sw w. */
export const handles = ({ x, y, w, h }) => [[x, y], [x + w / 2, y], [x + w, y], [x + w, y + h / 2], [x + w, y + h], [x + w / 2, y + h], [x, y + h], [x, y + h / 2]];
export const HANDLE_NAMES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
