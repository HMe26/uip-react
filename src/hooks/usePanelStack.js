import { useLayoutEffect } from 'react';
import { isNative } from '../native.js';

/**
 * Stacked-pages scroll for the public pages.
 *
 * Every `.pnl` block is a "page" (full-screen, opaque). Scrolling DOWN: the page you are on stays put and recedes (scales back,
 * tilts away, dims) while the next page is pulled up from below over it, flattening out of a 3D tilt. Scrolling UP: the mirror:
 * the page below stays put and the page above is pulled down over it from the top. Layer order flips with the direction, and the
 * flip is eased so nothing pops when you reverse mid-way.
 *
 * Nothing here is stateful: every frame is a pure function of scrollY (+ a single eased direction weight `w`: 0 = down, 1 = up),
 * so anchors, reloads mid-page and fast flicks always land on a correct picture. It only writes transform / z-index / three CSS
 * vars (--dim, --sha, --shy); styles/css/panel-stack.css does the rest. Layout is never changed by the transforms.
 * Skipped when animations are off (Admin switch / Android app) or the visitor prefers reduced motion.
 */
const FULL = 0.98;      // a panel only stacks if it fills the screen (short ones, e.g. the footer, just scroll normally)
const LIFT = 80;        // px the arriving page travels extra, so it feels pulled rather than scrolled
const TILT = 13;        // deg the arriving page starts tilted back
const R_TILT = 5;       // deg the covered page tilts away
const R_SCALE = 0.07;   // how much the covered page shrinks
const RADIUS = 32;      // corner radius of the arriving page's leading edge
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t) => t * t * (3 - 2 * t);

function enabled() {
  if (isNative || typeof document === 'undefined') return false;
  if (document.documentElement.dataset.motion === 'off') return false;
  try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch { /* ignore */ }
  return true;
}

function docTop(el) { // layout position, unaffected by the transforms we apply
  let y = 0;
  for (let n = el; n; n = n.offsetParent) y += n.offsetTop;
  return y;
}

function reset(el) {
  el.classList.remove('pnl-on');
  el.style.transform = '';
  el.style.transformOrigin = '';
  el.style.zIndex = '';
  el.style.borderRadius = '';
  ['--dim', '--sha', '--shy'].forEach((k) => el.style.removeProperty(k));
}

export default function usePanelStack(selector = '.pnl') {
  useLayoutEffect(() => {
    if (!enabled()) return undefined;
    let mode = 0;   // target direction: 0 down, 1 up
    let w = 0;      // eased direction weight
    let lastY = window.scrollY || 0;
    let raf = 0;
    let els = [];

    const frame = () => {
      raf = 0;
      els = Array.from(document.querySelectorAll(selector)); // re-queried: panels that render late (app band) join in
      const n = els.length;
      if (n < 2) return;
      els.forEach((el) => el.classList.add('pnl-on'));

      const vh = window.innerHeight || 800;
      const y = window.scrollY || 0;
      const dy = y - lastY;
      if (Math.abs(dy) > 1) { mode = dy > 0 ? 0 : 1; lastY = y; }
      w += (mode - w) * 0.22;
      if (Math.abs(mode - w) < 0.004) w = mode;

      const H = els.map((el) => el.offsetHeight);          // reads first...
      const T = els.map((el) => docTop(el) - y);
      const full = (i) => i >= 0 && i < n && H[i] >= vh * FULL;

      els.forEach((el, i) => {                              // ...then writes
        const t = T[i];
        const b = t + H[i];

        // DOWN: this page arrives over the previous one / is held while the next one arrives over it
        const nextCovers = full(i + 1) && i < n - 1;
        const eD = i > 0 && full(i) ? clamp((vh - t) / vh) : 1;
        const holdD = nextCovers ? clamp(vh - b, 0, H[i + 1]) : 0;
        const cD = nextCovers ? clamp((vh - b) / vh) : 0;
        // UP: mirror image
        const prevCovers = i > 0 && full(i - 1);
        const eU = i < n - 1 && full(i) ? clamp(b / vh) : 1;
        const holdU = prevCovers ? -clamp(t, 0, H[i - 1]) : 0;
        const cU = prevCovers ? clamp(t / vh) : 0;

        const sD = ease(eD); const sU = ease(eU);
        const tyD = holdD + (1 - sD) * LIFT;
        const tyU = holdU - (1 - sU) * LIFT;
        const rxD = (1 - sD) * TILT + cD * R_TILT;
        const rxU = -(1 - sU) * TILT - cU * R_TILT;
        const scD = (0.95 + 0.05 * sD) * (1 - R_SCALE * cD);
        const scU = (0.95 + 0.05 * sU) * (1 - R_SCALE * cU);
        const oyD = eD < 1 ? 0 : vh / 2 - (t + tyD);        // arriving: hinge on its leading edge; held: scale about the screen centre
        const oyU = eU < 1 ? H[i] : vh / 2 - (t + tyU);

        const mix = (a, c) => a * (1 - w) + c * w;
        const ty = mix(tyD, tyU);
        const rx = mix(rxD, rxU);
        const sc = mix(scD, scU);
        const oy = mix(oyD, oyU);
        const idle = Math.abs(ty) < 0.05 && Math.abs(rx) < 0.02 && Math.abs(sc - 1) < 0.0005;

        el.style.transform = idle ? '' : `translate3d(0, ${ty.toFixed(1)}px, 0) perspective(1600px) rotateX(${rx.toFixed(2)}deg) scale(${sc.toFixed(4)})`;
        el.style.transformOrigin = `50% ${oy.toFixed(0)}px`;
        el.style.zIndex = String(w < 0.5 ? i + 1 : n - i);  // down: later pages on top; up: earlier pages on top
        el.style.setProperty('--dim', (mix(cD, cU) * 0.55).toFixed(3));
        el.style.setProperty('--sha', (mix(1 - sD, 1 - sU) * 0.4).toFixed(3));
        el.style.setProperty('--shy', `${mix(-28, 28).toFixed(0)}px`);
        const rT = (1 - w) * RADIUS * (1 - sD);
        const rB = w * RADIUS * (1 - sU);
        el.style.borderRadius = `${rT.toFixed(1)}px ${rT.toFixed(1)}px ${rB.toFixed(1)}px ${rB.toFixed(1)}px`;
      });

      if (w !== mode) raf = requestAnimationFrame(frame);   // keep easing the direction flip until it settles
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

    window.addEventListener('scroll', kick, { passive: true });
    window.addEventListener('resize', kick);
    window.addEventListener('load', kick);
    let ro;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(kick); ro.observe(document.body); }
    frame();

    return () => {
      window.removeEventListener('scroll', kick);
      window.removeEventListener('resize', kick);
      window.removeEventListener('load', kick);
      if (ro) ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      document.querySelectorAll(selector).forEach(reset);
    };
  }, [selector]);
}
