/**
 * Background removal for stickers — pure pixel maths, no libraries and no network (the app's CSP allows no external scripts/models).
 * Works best on plain / evenly-lit backgrounds; anything harder is finished by hand with the erase / restore brush and "tap to remove".
 * mask: Uint8Array (w*h), 255 = keep, 0 = removed.  pix: RGBA Uint8ClampedArray (w*h*4).
 */
const d2 = (pix, i, r, g, b) => { const a = pix[i] - r; const c = pix[i + 1] - g; const e = pix[i + 2] - b; return a * a + c * c + e * e; };

/** Up to 3 dominant colours along the picture's border = the background colours. */
export function borderColors(pix, w, h) {
  const samples = [];
  const push = (x, y) => { const i = (y * w + x) * 4; if (pix[i + 3] > 10) samples.push([pix[i], pix[i + 1], pix[i + 2]]); };
  const stepX = Math.max(1, Math.floor(w / 160)); const stepY = Math.max(1, Math.floor(h / 160));
  for (let x = 0; x < w; x += stepX) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y += stepY) { push(0, y); push(w - 1, y); }
  if (!samples.length) return [];
  const clusters = [];
  samples.forEach((s) => {
    let best = null; let bd = 40 * 40;
    clusters.forEach((c) => { const dd = (c.m[0] - s[0]) ** 2 + (c.m[1] - s[1]) ** 2 + (c.m[2] - s[2]) ** 2; if (dd < bd) { bd = dd; best = c; } });
    if (best) { best.n += 1; best.s[0] += s[0]; best.s[1] += s[1]; best.s[2] += s[2]; best.m = best.s.map((v) => v / best.n); } else if (clusters.length < 6) clusters.push({ n: 1, s: [...s], m: [...s] });
  });
  clusters.sort((a, b) => b.n - a.n);
  return clusters.filter((c) => c.n >= samples.length * 0.08).slice(0, 3).map((c) => c.m);
}

/** Flood from the given seed indices; a pixel is background if it is within `tol` of any colour in `colors`. Mutates mask. Returns removed count. */
function flood(pix, w, h, mask, seeds, colors, tol) {
  const t2 = tol * tol;
  const stack = [];
  const seen = new Uint8Array(w * h);
  const match = (p) => {
    const i = p * 4;
    if (pix[i + 3] < 10) return true;
    for (let k = 0; k < colors.length; k += 1) if (d2(pix, i, colors[k][0], colors[k][1], colors[k][2]) <= t2) return true;
    return false;
  };
  seeds.forEach((p) => { if (!seen[p] && match(p)) { seen[p] = 1; stack.push(p); } });
  let n = 0;
  while (stack.length) {
    const p = stack.pop();
    if (mask[p]) { mask[p] = 0; n += 1; }
    const x = p % w; const y = (p / w) | 0;
    if (x > 0 && !seen[p - 1] && match(p - 1)) { seen[p - 1] = 1; stack.push(p - 1); }
    if (x < w - 1 && !seen[p + 1] && match(p + 1)) { seen[p + 1] = 1; stack.push(p + 1); }
    if (y > 0 && !seen[p - w] && match(p - w)) { seen[p - w] = 1; stack.push(p - w); }
    if (y < h - 1 && !seen[p + w] && match(p + w)) { seen[p + w] = 1; stack.push(p + w); }
  }
  return n;
}

/** Remove everything that looks like the border background and is connected to the border. */
export function autoCutout(pix, w, h, mask, tol = 45) {
  const colors = borderColors(pix, w, h);
  const seeds = [];
  for (let x = 0; x < w; x += 1) { seeds.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y += 1) { seeds.push(y * w, y * w + w - 1); }
  return flood(pix, w, h, mask, seeds, colors, tol);
}

/** "Tap to remove": flood from one point, colours similar to the tapped pixel. */
export function tapCutout(pix, w, h, mask, x, y, tol = 45) {
  x = Math.max(0, Math.min(w - 1, Math.round(x))); y = Math.max(0, Math.min(h - 1, Math.round(y)));
  const i = (y * w + x) * 4;
  return flood(pix, w, h, mask, [y * w + x], [[pix[i], pix[i + 1], pix[i + 2]]], tol);
}

/** Round brush: value 0 erases, 255 restores. */
export function paintMask(mask, w, h, cx, cy, radius, value) {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius)); const x1 = Math.min(w - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius)); const y1 = Math.min(h - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) mask[y * w + x] = value;
}

/** Writes pix + mask into out (RGBA) with a 1-pixel soft edge (3x3 average of the mask). */
export function applyMask(pix, mask, w, h, out) {
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x; const i = p * 4;
      let a = 0; let c = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx += 1) { const xx = x + dx; if (xx < 0 || xx >= w) continue; a += mask[yy * w + xx]; c += 1; }
      }
      out[i] = pix[i]; out[i + 1] = pix[i + 1]; out[i + 2] = pix[i + 2];
      out[i + 3] = mask[p] ? Math.round((a / c) * (pix[i + 3] / 255)) : Math.round((a / c) * (pix[i + 3] / 255) * 0.35);
    }
  }
}
