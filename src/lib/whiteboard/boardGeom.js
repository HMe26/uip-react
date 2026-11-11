/**
 * Whiteboard geometry + canvas drawing. Pure functions: no React, no network.
 * Object shapes (world coordinates, JSON-friendly so they can be whispered to everyone):
 *   pen / hl   { id, t, c, w, p:[x0,y0,x1,y1,…] }
 *   line/arrow { id, t, c, w, a:[x1,y1,x2,y2] }
 *   rect/ellipse { id, t, c, w, f (fill colour | null), a:[x1,y1,x2,y2] }
 *   text       { id, t:'text', c, s (font px), x, y, v }
 *   note       { id, t:'note', c (paper colour), x, y, w, h, v }
 */
export const FONT = '"Noto Sans Arabic", Inter, "Segoe UI", system-ui, -apple-system, sans-serif';
export const NOTE_W = 230;
const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
export const isRtl = (s) => RTL_RE.test(s || '');

let _mctx = null;
const mctx = () => {
  if (!_mctx) { const c = typeof document !== 'undefined' ? document.createElement('canvas') : null; _mctx = c ? c.getContext('2d') : null; }
  return _mctx;
};

/** Word-wrap `text` to `maxW` (explicit \n kept). Falls back to character breaks for very long words / CJK / Arabic without spaces. */
export function wrapLines(ctx, text, maxW) {
  const out = [];
  String(text || '').split('\n').forEach((para) => {
    if (!para) { out.push(''); return; }
    let line = '';
    para.split(/(\s+)/).forEach((tok) => {
      const test = line + tok;
      if (ctx.measureText(test).width <= maxW || !line) {
        if (ctx.measureText(test).width > maxW && tok.length > 1) { // single long word: break by characters
          let cur = line;
          for (const ch of tok) { if (ctx.measureText(cur + ch).width > maxW && cur) { out.push(cur); cur = ch; } else cur += ch; }
          line = cur;
        } else line = test;
      } else { out.push(line.trimEnd()); line = tok.trimStart(); }
    });
    out.push(line.trimEnd());
  });
  return out;
}

const textLines = (o) => String(o.v || '').split('\n');
export function textBox(o) {
  const ctx = mctx(); const lh = o.s * 1.3;
  if (!ctx) return { x: o.x, y: o.y, w: 40, h: lh };
  ctx.font = `${o.s}px ${FONT}`;
  const lines = textLines(o);
  const w = Math.max(10, ...lines.map((l) => ctx.measureText(l).width));
  return { x: o.x, y: o.y, w, h: lines.length * lh };
}
export function noteHeight(o) {
  const ctx = mctx();
  if (!ctx) return o.h || NOTE_W;
  ctx.font = `20px ${FONT}`;
  return Math.max(o.h || NOTE_W * 0.7, wrapLines(ctx, o.v, o.w - 28).length * 26 + 30);
}

/** Axis-aligned bounds {x1,y1,x2,y2} in world units (stroke width included). */
export function bounds(o) {
  if (o.t === 'pen' || o.t === 'hl') {
    const p = o.p; if (!p.length) return null;
    if (o._bn === p.length && o._b) return o._b;
    let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
    for (let i = 0; i < p.length; i += 2) { if (p[i] < x1) x1 = p[i]; if (p[i] > x2) x2 = p[i]; if (p[i + 1] < y1) y1 = p[i + 1]; if (p[i + 1] > y2) y2 = p[i + 1]; }
    const h = o.w / 2 + 2; const b = { x1: x1 - h, y1: y1 - h, x2: x2 + h, y2: y2 + h };
    Object.defineProperty(o, '_b', { value: b, writable: true, enumerable: false, configurable: true });
    Object.defineProperty(o, '_bn', { value: p.length, writable: true, enumerable: false, configurable: true });
    return b;
  }
  if (o.a) { const h = o.w / 2 + (o.t === 'arrow' ? 10 : 2); return { x1: Math.min(o.a[0], o.a[2]) - h, y1: Math.min(o.a[1], o.a[3]) - h, x2: Math.max(o.a[0], o.a[2]) + h, y2: Math.max(o.a[1], o.a[3]) + h }; }
  if (o.t === 'text') { const b = textBox(o); return { x1: b.x - 2, y1: b.y - 2, x2: b.x + b.w + 2, y2: b.y + b.h + 2 }; }
  if (o.t === 'note') return { x1: o.x, y1: o.y, x2: o.x + o.w, y2: o.y + noteHeight(o) };
  return null;
}

const segDist = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1; const dy = y2 - y1; const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

/** Is the world point (x,y) on / inside the object (with `tol` world-units of slack)? */
export function hit(o, x, y, tol) {
  const b = bounds(o); if (!b || x < b.x1 - tol || x > b.x2 + tol || y < b.y1 - tol || y > b.y2 + tol) return false;
  if (o.t === 'pen' || o.t === 'hl') {
    const p = o.p; const r = o.w / 2 + tol;
    if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) <= r;
    for (let i = 0; i + 3 < p.length; i += 2) if (segDist(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= r) return true;
    return false;
  }
  if (o.t === 'line' || o.t === 'arrow') return segDist(x, y, o.a[0], o.a[1], o.a[2], o.a[3]) <= o.w / 2 + tol;
  if (o.t === 'rect' || o.t === 'ellipse') {
    const [x1, y1, x2, y2] = [Math.min(o.a[0], o.a[2]), Math.min(o.a[1], o.a[3]), Math.max(o.a[0], o.a[2]), Math.max(o.a[1], o.a[3])];
    if (o.t === 'rect') {
      if (o.f) return true;
      const inner = x > x1 + tol && x < x2 - tol && y > y1 + tol && y < y2 - tol;
      return !inner;
    }
    const cx = (x1 + x2) / 2; const cy = (y1 + y2) / 2; const rx = Math.max(1, (x2 - x1) / 2); const ry = Math.max(1, (y2 - y1) / 2);
    const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
    return o.f ? d <= 1 + tol / Math.min(rx, ry) : Math.abs(d - 1) <= (o.w / 2 + tol) / Math.min(rx, ry);
  }
  return true; // text / note: the bounds test above is enough
}

export function translate(o, dx, dy) {
  const n = { ...o };
  if (o.p) { n.p = o.p.slice(); for (let i = 0; i < n.p.length; i += 2) { n.p[i] += dx; n.p[i + 1] += dy; } }
  if (o.a) n.a = [o.a[0] + dx, o.a[1] + dy, o.a[2] + dx, o.a[3] + dy];
  if (o.x != null) { n.x = o.x + dx; n.y = o.y + dy; }
  return n;
}

export function contentBounds(objs) {
  let r = null;
  objs.forEach((o) => { const b = bounds(o); if (!b) return; r = r ? { x1: Math.min(r.x1, b.x1), y1: Math.min(r.y1, b.y1), x2: Math.max(r.x2, b.x2), y2: Math.max(r.y2, b.y2) } : { ...b }; });
  return r;
}

const traceSmooth = (ctx, p) => {
  ctx.beginPath(); ctx.moveTo(p[0], p[1]);
  if (p.length === 2) { ctx.lineTo(p[0] + 0.01, p[1]); return; }
  for (let i = 2; i < p.length - 2; i += 2) ctx.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
  ctx.lineTo(p[p.length - 2], p[p.length - 1]);
};

export function drawObject(ctx, o) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (o.t) {
    case 'pen': case 'hl': {
      if (!o.p.length) break;
      ctx.strokeStyle = o.c; ctx.lineWidth = o.w;
      if (o.t === 'hl') { ctx.globalAlpha = 0.38; ctx.lineCap = 'butt'; }
      traceSmooth(ctx, o.p); ctx.stroke(); break;
    }
    case 'line': case 'arrow': {
      const [x1, y1, x2, y2] = o.a; ctx.strokeStyle = o.c; ctx.lineWidth = o.w;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (o.t === 'arrow') {
        const ang = Math.atan2(y2 - y1, x2 - x1); const hl = Math.max(12, o.w * 4);
        ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - hl * Math.cos(ang - 0.45), y2 - hl * Math.sin(ang - 0.45));
        ctx.moveTo(x2, y2); ctx.lineTo(x2 - hl * Math.cos(ang + 0.45), y2 - hl * Math.sin(ang + 0.45)); ctx.stroke();
      }
      break;
    }
    case 'rect': case 'ellipse': {
      const x = Math.min(o.a[0], o.a[2]); const y = Math.min(o.a[1], o.a[3]); const w = Math.abs(o.a[2] - o.a[0]); const h = Math.abs(o.a[3] - o.a[1]);
      ctx.strokeStyle = o.c; ctx.lineWidth = o.w; ctx.beginPath();
      if (o.t === 'rect') { const r = Math.min(10, w / 4, h / 4); if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.max(0, r)); else ctx.rect(x, y, w, h); } else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      if (o.f) { ctx.globalAlpha = 0.22; ctx.fillStyle = o.f; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.stroke(); break;
    }
    case 'text': {
      ctx.font = `${o.s}px ${FONT}`; ctx.fillStyle = o.c; ctx.textBaseline = 'top';
      const lh = o.s * 1.3; const box = textBox(o);
      textLines(o).forEach((line, i) => {
        if (isRtl(line)) { ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.fillText(line, o.x + box.w, o.y + i * lh); } else { ctx.direction = 'ltr'; ctx.textAlign = 'left'; ctx.fillText(line, o.x, o.y + i * lh); }
      });
      break;
    }
    case 'note': {
      const h = noteHeight(o);
      ctx.shadowColor = 'rgba(0,0,0,.22)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
      ctx.fillStyle = o.c; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(o.x, o.y, o.w, h, 8); else ctx.rect(o.x, o.y, o.w, h); ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.fillStyle = '#1f2330'; ctx.font = `20px ${FONT}`; ctx.textBaseline = 'top';
      wrapLines(ctx, o.v, o.w - 28).forEach((line, i) => {
        if (isRtl(line)) { ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.fillText(line, o.x + o.w - 14, o.y + 15 + i * 26); } else { ctx.direction = 'ltr'; ctx.textAlign = 'left'; ctx.fillText(line, o.x + 14, o.y + 15 + i * 26); }
      });
      break;
    }
    default: break;
  }
  ctx.restore();
}
