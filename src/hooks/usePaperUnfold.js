import { useLayoutEffect, useRef } from 'react';
import { isNative } from '../native.js';

/**
 * Landing scroll effect: every section arrives as a CRUMPLED sheet of paper that is pulled up from below and smoothed flat as
 * you scroll it into view (scrubbed by the scrollbar, so it also re-crumples if you scroll back up).
 *  - the section itself tilts back in 3D and lifts into place (transform only),
 *  - a jittered triangle mesh (SVG, generated here, one sheet per section) paints light/dark facets and fold lines over it;
 *    each facet flattens at its own moment, bottom rows first, which is what makes it read as a pulled sheet,
 *  - content fades in underneath as the sheet opens.
 * The hook only measures: it writes one eased number --p (0 -> 1) per section; styles/css/paper-unfold.css derives the rest.
 * Skipped when animations are off (Admin switch / Android app) or the visitor prefers reduced motion; nothing is ever hidden then.
 * Cleanup removes everything it added, so React StrictMode's double mount in dev works.
 */
const COLS_FULL = 8;
const ROWS_FULL = 6;
const LITE = typeof window !== 'undefined' && window.innerWidth < 700; // phones: fewer facets = fewer paints
const START = 0.97; // viewport fraction where a section's top edge starts the unfold
const SPAN = 0.85;  // how much scrolling (in viewport heights) the unfold takes
const clamp = (v) => Math.min(1, Math.max(0, v));
const ease = (t) => t * t * (3 - 2 * t);

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function sheetSvg(seed) {
  const r = rng(seed * 7919 + 13);
  const COLS = LITE ? 5 : COLS_FULL;
  const ROWS = LITE ? 4 : ROWS_FULL;
  const pts = [];
  for (let j = 0; j <= ROWS; j += 1) {
    const row = [];
    for (let i = 0; i <= COLS; i += 1) {
      const edgeX = i === 0 || i === COLS;
      const edgeY = j === 0 || j === ROWS;
      row.push([
        (i / COLS) * 100 + (edgeX ? 0 : (r() - 0.5) * (100 / COLS) * 0.8),
        (j / ROWS) * 100 + (edgeY ? 0 : (r() - 0.5) * (100 / ROWS) * 0.8),
      ]);
    }
    pts.push(row);
  }
  let out = '';
  const tri = (a, b, c) => {
    const hi = r() < 0.5;
    const alpha = hi ? 0.22 + r() * 0.55 : 0.12 + r() * 0.4;
    const cy = (a[1] + b[1] + c[1]) / 3;
    const delay = (1 - cy / 100) * 0.3 + r() * 0.12; // lower facets flatten first: the sheet is pulled from below
    out += `<polygon points="${a[0].toFixed(1)},${a[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)} ${c[0].toFixed(1)},${c[1].toFixed(1)}" class="${hi ? 'pu-h' : 'pu-l'}" style="--a:${alpha.toFixed(2)};--d:${delay.toFixed(2)}"/>`;
  };
  for (let j = 0; j < ROWS; j += 1) {
    for (let i = 0; i < COLS; i += 1) {
      const a = pts[j][i]; const b = pts[j][i + 1]; const c = pts[j + 1][i + 1]; const d = pts[j + 1][i];
      if (r() < 0.5) { tri(a, b, c); tri(a, c, d); } else { tri(a, b, d); tri(b, c, d); }
    }
  }
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">${out}</svg>`;
}

function enabled() {
  if (isNative || typeof document === 'undefined') return false;
  if (document.documentElement.dataset.motion === 'off') return false;
  try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch { /* ignore */ }
  return true;
}

export default function usePaperUnfold(selector = '.lp4-section') {
  const st = useRef(null);
  // No deps on purpose: after every render it picks up sections it has not seen yet (e.g. ones that render late).
  useLayoutEffect(() => {
    if (!enabled()) return;
    if (!st.current) {
      const items = [];
      let raf = 0;
      const pOf = (el) => {
        const vh = window.innerHeight || 800;
        const top = el.getBoundingClientRect().top;
        // Sections near the bottom of the page can never climb as high as the others: shrink their span so they still finish
        // exactly when the page ends (otherwise the last section / footer would stay half-crumpled forever).
        const room = Math.max(0, (document.documentElement.scrollHeight - vh) - (window.scrollY || 0));
        const lowest = top - room;
        const span = clamp((vh * START - lowest) / vh, 0.25, SPAN) * vh;
        if (room < 3 && top < vh * 0.98) return 1;
        return ease(clamp((vh * START - top) / span));
      };
      const tick = () => {
        raf = 0;
        for (let k = items.length - 1; k >= 0; k -= 1) { // sections React removed (filters, pagination...) leave the list
          if (!items[k].el.isConnected) { items[k].sheet.remove(); items.splice(k, 1); }
        }
        items.forEach((it) => {
          const p = pOf(it.el);
          if (p === it.p) return;
          it.p = p;
          it.el.style.setProperty('--p', p.toFixed(3));
          it.el.classList.toggle('pu-done', p >= 0.999);
        });
      };
      const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
      window.addEventListener('scroll', kick, { passive: true });
      window.addEventListener('resize', kick);
      st.current = {
        items,
        kick,
        pOf,
        destroy: () => {
          window.removeEventListener('scroll', kick);
          window.removeEventListener('resize', kick);
          if (raf) cancelAnimationFrame(raf);
          items.forEach(({ el, sheet }) => {
            sheet.remove();
            el.classList.remove('pu-sec', 'pu-done');
            el.style.removeProperty('--p');
            delete el.dataset.pu;
          });
          items.length = 0;
        },
      };
    }
    const { items, kick } = st.current;
    const vh = window.innerHeight || 800;
    document.querySelectorAll(selector).forEach((el, i) => {
      if (el.dataset.pu) return;
      el.dataset.pu = '1';
      const top = el.getBoundingClientRect().top;
      // The first screen is never covered (the page-open paper already plays there); anything above the fold stays flat.
      if (top < vh * 0.55) { el.classList.add('pu-sec', 'pu-done'); return; }
      el.classList.add('pu-sec');
      const sheet = document.createElement('div');
      sheet.className = 'pu';
      sheet.setAttribute('aria-hidden', 'true');
      sheet.innerHTML = `<i class="pu__base"></i>${sheetSvg(i + 1 + items.length)}`;
      el.appendChild(sheet);
      items.push({ el, sheet, p: -1 });
    });
    kick();
  });
  useLayoutEffect(() => () => { st.current?.destroy(); st.current = null; }, []);
}
