import { useLayoutEffect } from 'react';
import { isNative } from '../native.js';

/**
 * Public-page scroll effect (replaces the old paper unfold): cards, headings and the final call-to-action "flip up" out of the
 * depth of the page as they scroll into view, and the hero scene recedes as it leaves.
 *
 * Weight: this hook only TAGS elements once (data-s3d / --s3d-c / --ry) and never runs while scrolling.
 *  - Modern browsers: styles/css/scroll3d.css drives everything with CSS scroll-driven animations (animation-timeline: view()).
 *    They run on the compositor thread, so there is no scroll listener, no JS per frame and no per-frame style recalculation.
 *  - Others (older Firefox / Safari): one IntersectionObserver adds .is-in once per element and a CSS transition plays.
 * Skipped (nothing tagged, nothing hidden) when animations are off (Admin switch / Android app) or reduced motion is requested.
 * Called after every render on purpose, so late content (e.g. projects loaded from the API) is picked up; already-tagged
 * elements are skipped, so it is a single cheap querySelectorAll.
 */
const ITEMS = [
  // [selector, type]
  ['.lp4-head', 'head'],
  ['.lp4-row', 'head'],
  ['.lp7-faq__head', 'head'],
  ['.lp4-bento > *', 'card'],
  ['.lp4-steps > li', 'card'],
  ['.lp5-trust > *', 'card'],
  ['.lp5-comm > *', 'card'],
  ['.public-projects-grid > *', 'card'],
  ['.lp4-roles', 'card'],
  ['.lp7-faq__list', 'card'],
  ['.lp4-app', 'card'],
  ['.lp4-final', 'pop'],
  // projects showcase / project detail / privacy policy (.lp2 pages)
  ['.lp2-ex-toolbar', 'head'],
  ['.lp2-ex-pager', 'head'],
  ['.lp2-ex-empty', 'card'],
  ['.lp2-pv__sec', 'card'],
  ['.lp2-pv__note', 'card'],
  ['.lp2-pd__sec', 'card'],
  ['.lp2-pd__panel', 'card'],
  ['.lp2-pd__person', 'card'],
  ['.lp4-stage', 'hero'],
  ['.lp4-float', 'float'],
];
const SELECTOR = ITEMS.map(([s]) => s).join(',');
const REVEAL = new Set(['head', 'card', 'pop']); // types that need the fallback observer
const LEAN = [0.32, 0, -0.32]; // column-dependent sideways lean so a row of cards fans out instead of moving as one slab
const PZ = [-70, -120, -45, -95];

const supportsTimeline = () => {
  try { return typeof CSS !== 'undefined' && CSS.supports('animation-timeline: view()'); } catch { return false; }
};

function enabled() {
  if (isNative || typeof document === 'undefined') return false;
  if (document.documentElement.dataset.motion === 'off') return false;
  try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch { /* ignore */ }
  return true;
}

let io = null;
const getObserver = () => {
  if (io || typeof IntersectionObserver === 'undefined') return io;
  io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target;
      io.unobserve(el);
      el.classList.add('is-in');
      setTimeout(() => { // hand the element back to its own hover transitions
        el.classList.remove('is-in');
        delete el.dataset.s3d;
        el.style.removeProperty('--s3d-c');
        el.style.removeProperty('--ry');
      }, 1500);
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
  return io;
};

function typeOf(el) {
  for (let i = 0; i < ITEMS.length; i += 1) if (el.matches(ITEMS[i][0])) return ITEMS[i][1];
  return null;
}

export default function useScroll3D(rootSelector = '.lp4') {
  useLayoutEffect(() => {
    if (!enabled()) return;
    const native = supportsTimeline();
    const vh = window.innerHeight || 800;
    document.querySelectorAll(rootSelector).forEach((root) => {
      const seen = new Map(); // parent -> number of tagged children so far (drives the stagger column)
      root.querySelectorAll(SELECTOR).forEach((el) => {
        if (el.dataset.s3d) return;
        const type = typeOf(el);
        if (!type) return;
        const r = el.getBoundingClientRect();
        // Elements already on screen at load stay untouched (nothing flashes in); the hero is the exception, it only animates on the way out.
        if (REVEAL.has(type) && r.top < vh * 0.92 && r.bottom > 0) return;
        const parent = el.parentElement;
        const n = seen.get(parent) || 0;
        seen.set(parent, n + 1);
        el.dataset.s3d = type;
        el.style.setProperty('--s3d-c', String(n % 3));
        if (type === 'card') el.style.setProperty('--ry', String(LEAN[n % 3]));
        if (type === 'float') el.style.setProperty('--pz', String(PZ[n % PZ.length]));
        if (type !== 'float' && parent) parent.dataset.s3dStage = '1'; // perspective lives on the parent, so each row shares one vanishing point
        if (!native && REVEAL.has(type)) getObserver()?.observe(el);
      });
    });
  });
}
