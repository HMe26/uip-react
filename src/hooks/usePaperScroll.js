import { useLayoutEffect, useRef } from 'react';
import { isNative } from '../native.js';

/**
 * Scroll reveal: scrolling a section into view UNFOLDS it like a crumpled sheet of paper (styles in paper-reveal.css, .pf).
 * The hook only measures: per section it writes --p (0 -> 1, smoothstep) from how far the section has climbed into the
 * viewport, and CSS turns that one number into the fold of 8 facets, so the paper follows the wheel. Monotonic: once a
 * section is open it stays open (scrolling back up never re-covers it). One passive scroll listener + rAF, no layout work
 * besides one getBoundingClientRect per still-closed section; the sheet is removed from the DOM when finished.
 * Skipped when animations are off (Admin switch / Android app) or the visitor prefers reduced motion.
 */
const FACETS = 8;
const START = 0.97; // fraction of the viewport height where the section's top edge starts the unfold
const SPAN = 0.62;  // how much scrolling (of viewport height) the unfold takes
const clamp = (v) => Math.min(1, Math.max(0, v));
const ease = (t) => t * t * (3 - 2 * t);

function progress(el) {
  const vh = window.innerHeight || 800;
  return ease(clamp((vh * START - el.getBoundingClientRect().top) / (vh * SPAN)));
}

export default function usePaperScroll(selector = '.lp4-section') {
  const st = useRef(null);
  // No deps on purpose: runs after every render and only picks up sections it has not seen yet.
  useLayoutEffect(() => {
    if (isNative || typeof document === 'undefined') return;
    if (document.documentElement.dataset.motion === 'off') return;
    try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch { /* ignore */ }
    if (!st.current) {
      const live = new Set();
      let raf = 0;
      const finish = (s) => {
        live.delete(s);
        setTimeout(() => { s.el.classList.add('pr-done'); s.pf?.remove(); }, 420); // let the last eased step play out
      };
      const tick = () => {
        raf = 0;
        live.forEach((s) => {
          const p = progress(s.el);
          if (p <= s.p) return;
          s.p = p;
          s.el.style.setProperty('--p', p.toFixed(3));
          if (p > 0.3) s.el.classList.add('is-in');
          if (p >= 0.999) finish(s);
        });
      };
      const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
      window.addEventListener('scroll', kick, { passive: true });
      window.addEventListener('resize', kick);
      st.current = { live, kick, off: () => { window.removeEventListener('scroll', kick); window.removeEventListener('resize', kick); if (raf) cancelAnimationFrame(raf); } };
    }
    const { live, kick } = st.current;
    document.querySelectorAll(selector).forEach((el) => {
      if (el.dataset.pr) return;
      el.dataset.pr = '1';
      el.classList.add('pr-sec');
      if (progress(el) >= 0.999) { el.classList.add('pr-done', 'is-in'); return; } // already on screen at load: nothing to unfold
      const pf = document.createElement('div');
      pf.className = 'pf';
      pf.setAttribute('aria-hidden', 'true');
      pf.innerHTML = `<div class="pf__sheet">${Array.from({ length: FACETS }, (_, i) => `<i class="pf__f pf__f--${i + 1}"></i>`).join('')}</div><div class="pf__creases pr__creases"></div>`;
      el.appendChild(pf);
      live.add({ el, pf, p: 0 });
    });
    kick();
  });
  useLayoutEffect(() => () => { st.current?.off(); st.current = null; }, []);
}
