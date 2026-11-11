/**
 * "Edit existing text" helpers shared by the PDF editor (real text from the PDF) and the image editor (text found by OCR).
 * A text box is replaced by two annotation objects: a cover patch in the background colour + a text object with the
 * same position, size and colour, which then opens for typing.
 */
import { LINE_H, clampN, textLayout, uid } from './annot';
import { heavyAssetOrigin } from '../../lib/heavyAssets';

const hex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(clampN(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;

/** Background + ink colour around/inside `r` (canvas pixels). */
export function sampleColors(canvas, r) {
  const fallback = { bg: '#ffffff', fg: '#000000' };
  try {
    const cw = canvas.width; const ch = canvas.height;
    if (cw < 4 || ch < 4) return fallback;
    const x0 = clampN(Math.floor(r.x), 0, cw - 1); const y0 = clampN(Math.floor(r.y), 0, ch - 1);
    const x1 = clampN(Math.ceil(r.x + r.w), x0 + 1, cw); const y1 = clampN(Math.ceil(r.y + r.h), y0 + 1, ch);
    const pad = 3;
    const ax = clampN(x0 - pad, 0, cw - 1); const ay = clampN(y0 - pad, 0, ch - 1);
    const bx = clampN(x1 + pad, ax + 1, cw); const by = clampN(y1 + pad, ay + 1, ch);
    const { data, width } = canvas.getContext('2d').getImageData(ax, ay, bx - ax, by - ay);
    // background = most common colour of the frame just outside the box
    const buckets = new Map();
    const inside = [];
    for (let y = ay; y < by; y += 1) {
      for (let x = ax; x < bx; x += 1) {
        const i = ((y - ay) * width + (x - ax)) * 4;
        const R = data[i]; const G = data[i + 1]; const B = data[i + 2];
        if (x >= x0 && x < x1 && y >= y0 && y < y1) { inside.push(i); continue; }
        const k = ((R >> 4) << 8) | ((G >> 4) << 4) | (B >> 4);
        const e = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
        e.n += 1; e.r += R; e.g += G; e.b += B;
        buckets.set(k, e);
      }
    }
    let best = null;
    buckets.forEach((e) => { if (!best || e.n > best.n) best = e; });
    if (!best) return fallback;
    let bg = [best.r / best.n, best.g / best.n, best.b / best.n];
    if (Math.min(...bg) >= 238) bg = [255, 255, 255]; // plain paper: avoid a faintly visible patch
    else if (Math.max(...bg) <= 14) bg = [0, 0, 0];
    // ink = the pixels inside the box that differ most from the background
    const dist = (i) => Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
    const sorted = inside.map((i) => [dist(i), i]).sort((a, b) => b[0] - a[0]);
    const take = Math.max(1, Math.round(sorted.length * 0.06));
    let fr = 0; let fg = 0; let fb = 0;
    for (let k = 0; k < take; k += 1) { const i = sorted[k][1]; fr += data[i]; fg += data[i + 1]; fb += data[i + 2]; }
    let ink = [fr / take, fg / take, fb / take];
    if (!sorted.length || sorted[0][0] < 60) ink = (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) > 140 ? [0, 0, 0] : [255, 255, 255];
    return { bg: hex(...bg), fg: hex(...ink) };
  } catch { return fallback; }
}

const mul = (m1, m2) => [
  m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1], m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

const aabb = (pts, pad = 0) => {
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs) - pad; const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
};

const fontFor = (family = '') => (/mono|courier/i.test(family) ? '"Courier New"' : /serif/i.test(family) && !/sans/i.test(family) ? '"Times New Roman"' : 'Arial');

/** Text lines of a PDF page, in the page's current view space (points). */
export async function pdfTextBoxes(page, rotation) {
  const vp = page.getViewport({ scale: 1, rotation });
  const tc = await page.getTextContent();
  const runs = [];
  tc.items.forEach((it) => {
    if (typeof it.str !== 'string' || !it.str.trim()) return;
    const t = mul(vp.transform, it.transform);
    const size = Math.hypot(t[0], t[1]);
    if (!(size > 1)) return;
    const st = tc.styles?.[it.fontName] || {};
    const a = Math.atan2(t[1], t[0]);
    runs.push({
      str: it.str, size, a, px: t[4], py: t[5], w: it.width, family: st.fontFamily, asc: st.ascent > 0 ? clampN(st.ascent, 0.85, 1.1) : 0.95, desc: st.descent < 0 ? clampN(-st.descent, 0.22, 0.4) : 0.28,
    });
  });
  // glue runs that sit on the same baseline right next to each other into one editable line
  const lines = [];
  runs.forEach((r) => {
    const l = lines[lines.length - 1];
    if (l && Math.abs(l.a - r.a) < 0.02) {
      const ux = Math.cos(l.a); const uy = Math.sin(l.a);
      const dx = r.px - l.px; const dy = r.py - l.py;
      const along = dx * ux + dy * uy;
      const across = -dx * uy + dy * ux;
      const gap = along - l.w;
      if (Math.abs(across) < 0.35 * l.size && gap > -0.3 * l.size && gap < 0.8 * l.size) {
        const space = gap > 0.15 * l.size && !/\s$/.test(l.str) && !/^\s/.test(r.str) ? ' ' : '';
        l.str += space + r.str;
        l.w = along + r.w;
        l.size = Math.max(l.size, r.size);
        return;
      }
    }
    lines.push({ ...r });
  });
  return lines.map((l, i) => {
    const ux = Math.cos(l.a); const uy = Math.sin(l.a);
    const vx = -uy; const vy = ux; // "down" in the text's own frame
    const s = l.size;
    const top = [l.px - vx * l.asc * s, l.py - vy * l.asc * s];
    const h = (l.asc + l.desc) * s;
    const corners = [top, [top[0] + ux * l.w, top[1] + uy * l.w], [top[0] + vx * h, top[1] + vy * h], [top[0] + ux * l.w + vx * h, top[1] + uy * l.w + vy * h]];
    return {
      id: `p${i}`, str: l.str, size: s, w: l.w, font: fontFor(l.family), rot: ((Math.round((l.a * 180) / Math.PI) % 360) + 360) % 360,
      x: l.px - vx * 0.94 * s, y: l.py - vy * 0.94 * s, // top-left of the text object (its line box is centred on the glyphs)
      cover: aabb(corners, Math.max(2, 0.08 * s)), // a little generous: anti-aliased edges / wide fonts must not peek out
    };
  });
}

/* ───────── OCR (tesseract.js, self-hosted under /ocr — see scripts/copy-ocr-assets.mjs) ───────── */
let ocrWorker = null;
let ocrLangs = '';
const ocrBase = () => (heavyAssetOrigin() ? `${heavyAssetOrigin()}/ocr` : new URL(`${import.meta.env.BASE_URL || '/'}ocr/`, window.location.href).href.replace(/\/$/, ''));
let progressCb = null;

export async function ocrDispose() {
  const w = ocrWorker;
  ocrWorker = null; ocrLangs = '';
  try { await w?.terminate(); } catch { /* ignore */ }
}

/** Text lines found in `canvas`. `langs` = 'eng' | 'ara' | 'ara+eng'. onProgress(percent, label). */
export async function ocrLines(canvas, langs, onProgress) {
  progressCb = onProgress;
  const { createWorker } = await import('tesseract.js');
  if (!ocrWorker || ocrLangs !== langs) {
    await ocrDispose();
    const base = ocrBase();
    ocrWorker = await createWorker(langs.split('+'), 1, {
      workerPath: `${base}/worker.min.js`, corePath: `${base}/core`, langPath: `${base}/lang`, gzip: true, workerBlobURL: false,
      logger: (m) => progressCb?.(Math.round((m.progress || 0) * 100), m.status),
    });
    ocrLangs = langs;
  }
  const maxSide = 3200;
  const k = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  let src = canvas;
  if (k < 1) {
    src = document.createElement('canvas');
    src.width = Math.round(canvas.width * k); src.height = Math.round(canvas.height * k);
    src.getContext('2d').drawImage(canvas, 0, 0, src.width, src.height);
  }
  const { data } = await ocrWorker.recognize(src, {}, { blocks: true });
  const out = [];
  (data.blocks || []).forEach((b) => b.paragraphs.forEach((p) => p.lines.forEach((l) => {
    const str = (l.text || '').replace(/\s+$/g, '');
    if (!str.trim() || l.confidence < 35) return;
    const { x0, y0, x1, y1 } = l.bbox;
    out.push({ id: `o${out.length}`, str, conf: l.confidence, box: { x: x0 / k, y: y0 / k, w: (x1 - x0) / k, h: (y1 - y0) / k } });
  })));
  return out;
}

/** OCR line → the same box description the PDF side produces (text sized to fit the found width). */
export function ocrBoxToText(line, style) {
  const { x, y, w, h } = line.box;
  let size = Math.max(6, h * 0.86);
  const probe = { type: 'text', text: line.str, size, font: style.font || 'Arial', bold: false, italic: false };
  const m = textLayout(probe).w;
  if (m > 0) size = clampN(size * clampN(w / m, 0.6, 1.5), 6, 400);
  const cy = y + h / 2;
  return { str: line.str, size, w, font: style.font || 'Arial', rot: 0, x, y: cy - (size * LINE_H) / 2, cover: { x: x - 2, y: y - 2, w: w + 4, h: h + 4 } };
}

/** The two objects that replace a piece of text: background patch + editable text. */
export function replacementObjs(t, colors) {
  const c = t.cover;
  const cover = { id: uid(), type: 'rect', cover: true, x1: c.x, y1: c.y, x2: c.x + c.w, y2: c.y + c.h, fill: colors.bg, alpha: 1, width: 0 };
  // The PDF's own font is not available in the browser, so a stand-in font is used. Fit the stand-in to the width
  // of the original line (within limits) so the new text does not spill past / fall short of the cover patch.
  let size = t.size;
  if (t.w > 0 && t.str) {
    const m = textLayout({ type: 'text', text: t.str, size, font: t.font || 'Arial', bold: false, italic: false }).w;
    if (m > 0) size = clampN(size * clampN(t.w / m, 0.75, 1.25), 4, 800);
  }
  const text = { id: uid(), type: 'text', x: t.x, y: t.y, text: t.str, size, color: colors.fg, font: t.font || 'Arial', bold: false, italic: false, rot: t.rot || 0, alpha: 1 };
  return [cover, text];
}
