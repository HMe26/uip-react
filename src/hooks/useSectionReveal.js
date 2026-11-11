import { useLayoutEffect, useRef } from 'react';
import { isNative } from '../native.js';

/**
 * Landing scroll reveal: section headings rise out of a soft blur and the cards under them "turn up" one after another like
 * pages (staggered tilt + lift), the first time they scroll into view. Pure CSS transitions on the individual transform
 * properties (translate / rotate / scale, see styles/css/section-reveal.css), so it never fights a card's own hover transform.
 * The hidden state is only ever set from here (data-rv), so with animations off / reduced motion / the Android app nothing is
 * hidden at all. A safety timer reveals everything even if the observer never fires.
 */
const ITEMS = [
  '.lp4-head', '.lp4-bento > *', '.lp4-steps > li', '.lp5-trust > *', '.lp5-comm > *', '.lp5-feed > *',
  '.public-projects-grid > *', '.lp4-roles', '.lp4-app', '.lp4-final',
].join(',');

export default function useSectionReveal(sectionSelector = '.lp4-section') {
  const st = useRef(null);
  useLayoutEffect(() => {
    if (isNative || typeof document === 'undefined' || typeof IntersectionObserver === 'undefined') return;
    if (document.documentElement.dataset.motion === 'off') return;
    try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch { /* ignore */ }
    if (!st.current) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const el = e.target;
          io.unobserve(el);
          el.dataset.rv = 'show';
          setTimeout(() => { delete el.dataset.rv; el.style.removeProperty('--rv-i'); }, 1600); // hand transitions back to the card
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
      st.current = io;
    }
    const io = st.current;
    document.querySelectorAll(sectionSelector).forEach((sec) => {
      sec.querySelectorAll(ITEMS).forEach((el) => {
        if (el.dataset.rv) return;
        const r = el.getBoundingClientRect();
        if (r.top < (window.innerHeight || 800) * 0.9 && r.bottom > 0) return; // already on screen at load: leave it alone
        const sibs = el.parentElement ? Array.from(el.parentElement.children) : [el];
        el.style.setProperty('--rv-i', String(Math.min(5, Math.max(0, sibs.indexOf(el)))));
        el.dataset.rv = 'hide';
        io.observe(el);
      });
    });
  });
  useLayoutEffect(() => () => { st.current?.disconnect(); st.current = null; }, []);
}
