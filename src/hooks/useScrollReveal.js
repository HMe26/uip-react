import { useEffect } from 'react';

/**
 * Scroll-reveal: elements matching `selector` fade + rise as they enter the viewport.
 * Adds .lp2-reveal (hidden state) then .is-in (visible) via IntersectionObserver.
 * Skipped for reduced-motion users / browsers without IntersectionObserver, and when `enabled` is false.
 * Re-runs when `deps` change (e.g. after async results render new cards).
 */
export default function useScrollReveal(selector, deps = [], enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const els = document.querySelectorAll(selector);
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    els.forEach((el, i) => {
      if (el.classList.contains('is-in')) return;
      el.classList.add('lp2-reveal');
      el.style.setProperty('--ri', String(i % 4));
      io.observe(el);
    });
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selector, enabled, ...deps]);
}
