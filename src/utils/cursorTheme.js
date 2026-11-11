/**
 * cursorTheme.js — themed mouse cursors (arrow / hand / text) drawn as inline SVG.
 *
 * Cursor images cannot read CSS variables, so the SVGs are generated here from the
 * active look and published as CSS custom properties on <html>:
 *   --cur-default  --cur-pointer  --cur-text   (each a full `cursor` value incl. hotspot + keyword fallback)
 * styles/css/cursors.css (and every `cursor: pointer|default|text` in the stylesheets) consume them.
 *
 * Look:   Light  → near-black arrow, white outline        Classic → indigo-ink arrow, white outline
 *         Dark   → white arrow, near-black outline         (both dark looks)
 * Hand / links always use the portal's accent colour (read from --color-primary), so a
 * different accent automatically gives a different cursor.
 */

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
function parseColor(c, fallback) {
  const s = String(c || '').trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(s);
  return m ? [+m[1], +m[2], +m[3]] : fallback;
}
const hex = ([r, g, b]) => `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const ARROW = 'M4 3v15.6l4.1-3.9 2.7 6.3 2.9-1.2-2.7-6.2 5.7-.3z';
const HAND = 'M9.4 3.4a1.55 1.55 0 0 1 3.1 0v5.9a1.45 1.45 0 0 1 1.75.9 1.45 1.45 0 0 1 1.75.9 1.45 1.45 0 0 1 1.6 1.1l.3 3.6c.2 3-1.9 5.6-4.9 5.6h-1.3c-1.7 0-3.1-.8-4-2.2l-3-4.6a1.35 1.35 0 0 1 2.2-1.6l1.4 1.5z';

const svg = (body, size = 28) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${body}</svg>`;
const uri = (s) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;

export function buildCursors({ dark, ink, outline, accent }) {
  const shadow = (d) => `<path d="${d}" transform="translate(.9 1.3)" fill="#000" opacity="${dark ? '.45' : '.22'}"/>`;
  const shape = (d, fill, stroke) =>
    `${shadow(d)}<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round"/>`;

  const arrow = svg(shape(ARROW, ink, outline));
  const hand = svg(shape(HAND, accent, outline));
  // I-beam: outline pass first, ink pass on top
  const beamD = 'M9 4h6M12 4v16M9 20h6';
  const text = svg(
    `<path d="${beamD}" fill="none" stroke="${outline}" stroke-width="4" stroke-linecap="round"/>` +
    `<path d="${beamD}" fill="none" stroke="${ink}" stroke-width="1.7" stroke-linecap="round"/>`,
  );

  return {
    '--cur-default': `${uri(arrow)} 5 3, default`,
    '--cur-pointer': `${uri(hand)} 13 4, pointer`,
    '--cur-text': `${uri(text)} 14 14, text`,
  };
}

let last = '';
export function applyCursorTheme() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const touchOnly = window.matchMedia && window.matchMedia('(hover: none)').matches;
  if (touchOnly) return;

  const dark = root.getAttribute('data-theme') === 'dark';
  const palette = root.getAttribute('data-palette');
  const host = document.querySelector('.app-shell') || root;
  const accentRgb = parseColor(getComputedStyle(host).getPropertyValue('--color-primary'), [81, 95, 255]);

  let ink; let outline;
  if (dark) { ink = '#FFFFFF'; outline = '#0B0E16'; }
  else if (palette === 'white') { ink = '#111318'; outline = '#FFFFFF'; }
  else { ink = hex(mix(accentRgb, [15, 20, 36], 0.78)); outline = '#FFFFFF'; } // classic: indigo-tinted ink

  const key = [dark, palette, hex(accentRgb)].join('|');
  if (key === last) return;
  last = key;

  const vars = buildCursors({ dark, ink, outline, accent: hex(accentRgb) });
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
}

/** Apply now, and again shortly after (the .app-shell that carries the accent mounts after the provider). */
export function scheduleCursorTheme() {
  applyCursorTheme();
  [60, 400, 1500].forEach((ms) => setTimeout(applyCursorTheme, ms));
}
