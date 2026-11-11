/**
 * Shared annotation model for the image editor and the PDF editor.
 *
 * Every object lives in "document units" (image pixels, or PDF points) so the same object list can be drawn
 * on screen at any zoom and again at export resolution. Types:
 *   pen · rect · ellipse · line · arrow · pixel (mosaic) · text · image
 * Flags on a rect: `hl` (highlighter) and `cover` (white-out / redact).
 */

export const uid = () => Math.random().toString(36).slice(2, 10);
export const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const RAD = Math.PI / 180;
const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
export const LINE_H = 1.28;

export const FONTS = [
  { id: 'Arial', label: 'Arial' },
  { id: 'Tahoma', label: 'Tahoma' },
  { id: '"Times New Roman"', label: 'Times' },
  { id: '"Courier New"', label: 'Courier' },
  { id: 'Georgia', label: 'Georgia' },
  { id: '"Segoe Script", "Brush Script MT", cursive', label: 'Script' },
];

export const DEFAULT_STYLE = {
  color: '#e5484d', width: 4, alpha: 1,
  fill: null, fillColor: '#ffe14d',
  size: 28, font: 'Arial', bold: false, italic: false,
  hl: '#ffe14d', hlAlpha: 0.4,
  block: 14,
};

let measureCtx;
const mctx = () => { if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d'); return measureCtx; };
const scratch = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };

export const fontCss = (o) => `${o.italic ? 'italic ' : ''}${o.bold ? '700 ' : '400 '}${o.size}px ${o.font || 'Arial'}, "Segoe UI", Tahoma, sans-serif`;

export function textLayout(o) {
  const c = mctx();
  c.font = fontCss(o);
  const lines = String(o.text ?? '').split('\n');
  const w = Math.max(o.size * 0.6, ...lines.map((l) => c.measureText(l).width));
  return { lines, w, h: lines.length * o.size * LINE_H, rtl: RTL_RE.test(o.text || '') };
}

/* ───────── images used by `image` objects ───────── */
const imgCache = new Map();
export function getImage(src, onReady) {
  let e = imgCache.get(src);
  if (!e) {
    const el = new Image();
    e = { el, ready: false, cbs: [] };
    el.onload = () => { e.ready = true; e.cbs.splice(0).forEach((f) => f()); };
    el.onerror = () => { e.cbs.splice(0).forEach((f) => f()); };
    el.src = src;
    imgCache.set(src, e);
  }
  if (e.ready) return e.el;
  if (onReady) e.cbs.push(onReady);
  return null;
}
export const whenImagesReady = (objs) => Promise.all(
  objs.filter((o) => o.type === 'image').map((o) => new Promise((res) => { if (getImage(o.src, res)) res(); })),
);
export const loadImageEl = (src) => new Promise((res, rej) => {
  const el = new Image();
  el.onload = () => res(el);
  el.onerror = () => rej(new Error('Could not read this image.'));
  el.src = src;
});
export const fileToDataURL = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(file);
});

/* ───────── drawing ───────── */
const box = (o) => ({ x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) });

export function drawObj(ctx, o, env = {}) {
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (o.type) {
    case 'pen': {
      const p = o.pts;
      if (!p.length) break;
      ctx.strokeStyle = o.color;
      ctx.lineWidth = o.width;
      ctx.beginPath();
      ctx.moveTo(p[0][0], p[0][1]);
      if (p.length === 1) ctx.lineTo(p[0][0] + 0.01, p[0][1]);
      for (let i = 1; i < p.length - 1; i += 1) {
        const mx = (p[i][0] + p[i + 1][0]) / 2;
        const my = (p[i][1] + p[i + 1][1]) / 2;
        ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my);
      }
      if (p.length > 1) ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
      ctx.stroke();
      break;
    }
    case 'rect': {
      const b = box(o);
      if (o.fill) { ctx.fillStyle = o.fill; ctx.fillRect(b.x, b.y, b.w, b.h); }
      if (o.color && o.width > 0 && !o.hl && !o.cover) { ctx.strokeStyle = o.color; ctx.lineWidth = o.width; ctx.strokeRect(b.x, b.y, b.w, b.h); }
      break;
    }
    case 'ellipse': {
      const b = box(o);
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, Math.max(0.1, b.w / 2), Math.max(0.1, b.h / 2), 0, 0, Math.PI * 2);
      if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
      if (o.width > 0) { ctx.strokeStyle = o.color; ctx.lineWidth = o.width; ctx.stroke(); }
      break;
    }
    case 'line':
    case 'arrow': {
      ctx.strokeStyle = o.color;
      ctx.fillStyle = o.color;
      ctx.lineWidth = o.width;
      const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
      const head = Math.max(10, o.width * 4);
      let ex = o.x2; let ey = o.y2;
      if (o.type === 'arrow') { ex -= Math.cos(ang) * head * 0.6; ey -= Math.sin(ang) * head * 0.6; }
      ctx.beginPath();
      ctx.moveTo(o.x1, o.y1);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      if (o.type === 'arrow') {
        ctx.beginPath();
        ctx.moveTo(o.x2, o.y2);
        ctx.lineTo(o.x2 - head * Math.cos(ang - 0.42), o.y2 - head * Math.sin(ang - 0.42));
        ctx.lineTo(o.x2 - head * Math.cos(ang + 0.42), o.y2 - head * Math.sin(ang + 0.42));
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'pixel': {
      const b = box(o);
      if (!env.base || b.w < 1 || b.h < 1) break;
      const blk = Math.max(2, o.block || 12);
      const sw = Math.max(1, Math.round(b.w / blk));
      const sh = Math.max(1, Math.round(b.h / blk));
      const t = scratch(sw, sh);
      const tc = t.getContext('2d');
      tc.imageSmoothingEnabled = true;
      tc.drawImage(env.base, b.x, b.y, b.w, b.h, 0, 0, sw, sh);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(t, 0, 0, sw, sh, b.x, b.y, b.w, b.h);
      break;
    }
    case 'text': {
      const L = textLayout(o);
      ctx.translate(o.x, o.y);
      ctx.rotate((o.rot || 0) * RAD);
      ctx.font = fontCss(o);
      ctx.fillStyle = o.color;
      ctx.textBaseline = 'top';
      ctx.direction = L.rtl ? 'rtl' : 'ltr';
      ctx.textAlign = L.rtl ? 'right' : 'left';
      L.lines.forEach((ln, i) => ctx.fillText(ln, L.rtl ? L.w : 0, i * o.size * LINE_H + (o.size * (LINE_H - 1)) / 2));
      break;
    }
    case 'image': {
      const el = getImage(o.src, env.onImage);
      if (!el) break;
      ctx.translate(o.x, o.y);
      ctx.rotate((o.rot || 0) * RAD);
      ctx.drawImage(el, 0, 0, o.w, o.h);
      break;
    }
    default: break;
  }
  ctx.restore();
}

export const drawObjects = (ctx, objs, env) => objs.forEach((o) => drawObj(ctx, o, env));

/* ───────── geometry ───────── */
export const isFrame = (o) => o.type === 'text' || o.type === 'image';
export const isBoxShape = (o) => o.type === 'rect' || o.type === 'ellipse' || o.type === 'pixel';

export function localBox(o) {
  if (o.type === 'text') { const L = textLayout(o); return { x: 0, y: 0, w: L.w, h: L.h }; }
  return { x: 0, y: 0, w: o.w, h: o.h };
}
const toWorld = (o, lx, ly) => {
  const r = (o.rot || 0) * RAD;
  return [o.x + lx * Math.cos(r) - ly * Math.sin(r), o.y + lx * Math.sin(r) + ly * Math.cos(r)];
};
const toLocal = (o, x, y) => {
  const r = -(o.rot || 0) * RAD;
  const dx = x - o.x; const dy = y - o.y;
  return [dx * Math.cos(r) - dy * Math.sin(r), dx * Math.sin(r) + dy * Math.cos(r)];
};
export const frameCorners = (o) => { const b = localBox(o); return [[0, 0], [b.w, 0], [b.w, b.h], [0, b.h]].map(([x, y]) => toWorld(o, x, y)); };

export function worldBox(o) {
  let pts;
  if (isFrame(o)) pts = frameCorners(o);
  else if (o.type === 'pen') pts = o.pts;
  else pts = [[o.x1, o.y1], [o.x2, o.y2]];
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const pad = isFrame(o) || o.cover || o.hl ? 0 : (o.width || 0) / 2;
  const x = Math.min(...xs) - pad; const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax; const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? clampN(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

export function hit(o, x, y, tol) {
  switch (o.type) {
    case 'text':
    case 'image': {
      const [lx, ly] = toLocal(o, x, y);
      const b = localBox(o);
      return lx >= -tol && ly >= -tol && lx <= b.w + tol && ly <= b.h + tol;
    }
    case 'rect':
    case 'pixel': {
      const b = box(o);
      const inside = x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol;
      if (o.fill || o.type === 'pixel') return inside;
      const inner = x > b.x + tol && x < b.x + b.w - tol && y > b.y + tol && y < b.y + b.h - tol;
      return inside && !inner;
    }
    case 'ellipse': {
      const b = box(o);
      const rx = b.w / 2 + tol; const ry = b.h / 2 + tol;
      const nx = (x - (b.x + b.w / 2)) / rx; const ny = (y - (b.y + b.h / 2)) / ry;
      const d = nx * nx + ny * ny;
      if (o.fill) return d <= 1;
      const irx = Math.max(0.1, b.w / 2 - tol); const iry = Math.max(0.1, b.h / 2 - tol);
      const inx = (x - (b.x + b.w / 2)) / irx; const iny = (y - (b.y + b.h / 2)) / iry;
      return d <= 1 && inx * inx + iny * iny >= 1;
    }
    case 'line':
    case 'arrow':
      return segDist(x, y, o.x1, o.y1, o.x2, o.y2) <= tol + o.width / 2;
    case 'pen': {
      const p = o.pts;
      if (p.length === 1) return Math.hypot(x - p[0][0], y - p[0][1]) <= tol + o.width / 2;
      for (let i = 0; i < p.length - 1; i += 1) if (segDist(x, y, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]) <= tol + o.width / 2) return true;
      return false;
    }
    default: return false;
  }
}

export function handlesOf(o) {
  if (isFrame(o)) { const b = localBox(o); const [x, y] = toWorld(o, b.w, b.h); return [{ id: 'br', x, y }]; }
  if (o.type === 'line' || o.type === 'arrow') return [{ id: 'p1', x: o.x1, y: o.y1 }, { id: 'p2', x: o.x2, y: o.y2 }];
  if (isBoxShape(o)) {
    const b = box(o);
    return [{ id: 'tl', x: b.x, y: b.y }, { id: 'tr', x: b.x + b.w, y: b.y }, { id: 'bl', x: b.x, y: b.y + b.h }, { id: 'br', x: b.x + b.w, y: b.y + b.h }];
  }
  return [];
}

export function normalizeBox(o) {
  if (!isBoxShape(o)) return o;
  const b = box(o);
  return { ...o, x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h };
}

export function dragHandle(o, id, x, y, start) {
  if (isFrame(o)) {
    const [lx] = toLocal(start, x, y);
    const k = Math.max(0.05, lx / Math.max(1, localBox(start).w));
    if (o.type === 'text') return { ...o, size: clampN(Math.round(start.size * k * 10) / 10, 4, 800) };
    return { ...o, w: Math.max(6, start.w * k), h: Math.max(6, start.h * k) };
  }
  const n = { ...o };
  if (id === 'p1') { n.x1 = x; n.y1 = y; return n; }
  if (id === 'p2') { n.x2 = x; n.y2 = y; return n; }
  if (id.includes('l') || id === 'tl' || id === 'bl') n.x1 = x; else n.x2 = x;
  if (id[0] === 't') n.y1 = y; else n.y2 = y;
  return n;
}

export function moveObj(o, dx, dy) {
  if (o.type === 'pen') return { ...o, pts: o.pts.map(([x, y]) => [x + dx, y + dy]) };
  if (isFrame(o)) return { ...o, x: o.x + dx, y: o.y + dy };
  return { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy };
}

const mapPoints = (o, f) => {
  if (o.type === 'pen') return { ...o, pts: o.pts.map(([x, y]) => f(x, y)) };
  const a = f(o.x1, o.y1); const b = f(o.x2, o.y2);
  return { ...o, x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
};

/** Rotate an object together with a W×H surface by 90° (clockwise when `cw`). */
export function rotateObj90(o, W, H, cw = true) {
  const f = cw ? (x, y) => [H - y, x] : (x, y) => [y, W - x];
  if (isFrame(o)) {
    const [x, y] = f(o.x, o.y);
    return { ...o, x, y, rot: (((o.rot || 0) + (cw ? 90 : -90)) % 360 + 360) % 360 };
  }
  return mapPoints(o, f);
}

/** Mirror an object inside a W×H surface (text / pictures keep their glyphs, only their position is mirrored). */
export function flipObj(o, W, H, axis) {
  const f = axis === 'h' ? (x, y) => [W - x, y] : (x, y) => [x, H - y];
  if (isFrame(o)) {
    const b = localBox(o);
    const [cx, cy] = toWorld(o, b.w / 2, b.h / 2);
    const [nx, ny] = f(cx, cy);
    const r = (o.rot || 0) * RAD;
    const ox = (b.w / 2) * Math.cos(r) - (b.h / 2) * Math.sin(r);
    const oy = (b.w / 2) * Math.sin(r) + (b.h / 2) * Math.cos(r);
    return { ...o, x: nx - ox, y: ny - oy };
  }
  return mapPoints(o, f);
}

export function scaleObj(o, kx, ky = kx) {
  const k = Math.sqrt(kx * ky);
  const base = { ...o };
  if (o.width != null) base.width = o.width * k;
  if (o.block != null) base.block = o.block * k;
  if (o.type === 'pen') return { ...base, pts: o.pts.map(([x, y]) => [x * kx, y * ky]) };
  if (o.type === 'text') return { ...base, x: o.x * kx, y: o.y * ky, size: o.size * k };
  if (o.type === 'image') return { ...base, x: o.x * kx, y: o.y * ky, w: o.w * k, h: o.h * k };
  return { ...base, x1: o.x1 * kx, y1: o.y1 * ky, x2: o.x2 * kx, y2: o.y2 * ky };
}

export const cloneObj = (o) => ({ ...o, id: uid(), ...(o.pts ? { pts: o.pts.map((p) => [...p]) } : {}) });

/* ───────── style <-> object mapping (used by the properties panel) ───────── */
export function kindOf(o) {
  if (!o) return null;
  if (o.hl) return 'highlight';
  if (o.cover) return 'cover';
  return o.type;
}

export function applyStyle(o, patch) {
  const n = { ...o };
  if ('color' in patch) { if (o.hl || o.cover) n.fill = patch.color; else n.color = patch.color; }
  if ('alpha' in patch) n.alpha = patch.alpha;
  if ('width' in patch) n.width = patch.width;
  if ('fill' in patch && (o.type === 'rect' || o.type === 'ellipse') && !o.hl && !o.cover) n.fill = patch.fill;
  if ('size' in patch && o.type === 'text') n.size = patch.size;
  if ('font' in patch && o.type === 'text') n.font = patch.font;
  if ('bold' in patch && o.type === 'text') n.bold = patch.bold;
  if ('italic' in patch && o.type === 'text') n.italic = patch.italic;
  if ('block' in patch && o.type === 'pixel') n.block = patch.block;
  return n;
}

export function createObj(tool, p, st) {
  const id = uid();
  const common = { id };
  switch (tool) {
    case 'pen': return { ...common, type: 'pen', pts: [[p.x, p.y]], color: st.color, width: st.width, alpha: st.alpha };
    case 'rect':
    case 'ellipse':
      return { ...common, type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: st.color, width: st.width, alpha: st.alpha, fill: st.fill || null };
    case 'line':
    case 'arrow':
      return { ...common, type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: st.color, width: st.width, alpha: st.alpha };
    case 'highlight': return { ...common, type: 'rect', hl: true, x1: p.x, y1: p.y, x2: p.x, y2: p.y, fill: st.hl, alpha: st.hlAlpha, width: 0 };
    case 'whiteout': return { ...common, type: 'rect', cover: true, x1: p.x, y1: p.y, x2: p.x, y2: p.y, fill: '#ffffff', alpha: 1, width: 0 };
    case 'redact': return { ...common, type: 'rect', cover: true, x1: p.x, y1: p.y, x2: p.x, y2: p.y, fill: '#000000', alpha: 1, width: 0 };
    case 'pixel': return { ...common, type: 'pixel', x1: p.x, y1: p.y, x2: p.x, y2: p.y, block: st.block, alpha: 1 };
    case 'text': return { ...common, type: 'text', x: p.x, y: p.y, text: '', size: st.size, color: st.color, font: st.font, bold: st.bold, italic: st.italic, rot: 0, alpha: st.alpha };
    default: return null;
  }
}

/** Draw `objs` on a fresh transparent canvas: `W×H` units at `k` pixels per unit. */
export async function renderOverlay(objs, W, H, k, env = {}) {
  await whenImagesReady(objs);
  const c = scratch(Math.round(W * k), Math.round(H * k));
  const ctx = c.getContext('2d');
  ctx.scale(k, k);
  drawObjects(ctx, objs, env);
  return c;
}
