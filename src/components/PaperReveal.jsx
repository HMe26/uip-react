import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { isNative } from '../native.js';
import { STAFF_LOGIN_PATH } from '../config/staffPortal';
import { paperPending, subscribePaper } from '../lib/paperGate';

/**
 * "Crumpled paper unfolds" page reveal for the public pages (landing, projects, auth, verification…).
 * - First visit: the paper (already painted by #uip-boot in index.html) stays closed while the page loads, then unfolds.
 * - Navigating between public pages: a short cover -> unfold while the next page chunk loads.
 * - The signed-in app (dashboards) is never covered, so day-to-day navigation stays instant.
 * Pure CSS transforms (8 composited layers for ~0.7s), removed from the DOM afterwards. Disabled when animations are off
 * (Admin switch / Android app) or the visitor prefers reduced motion.
 */
const PUBLIC = /^\/($|(projects|p|u|universities|post|s|join|verify-certificate|privacy-policy|403|500|auth)(\/|$))/;
const isPublic = (path) => PUBLIC.test(path) || (STAFF_LOGIN_PATH && path.startsWith(STAFF_LOGIN_PATH));
// The very first screen of a tab (also the signed-in app) is covered by the paper and unfolds once; later in-app navigation stays instant.
let appOpened = false;
const enabled = () => {
  if (isNative || typeof document === 'undefined') return false;
  if (document.documentElement.dataset.motion === 'off') return false;
  try { return !window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return true; }
};

export default function PaperReveal() {
  const { pathname } = useLocation();
  const prev = useRef(pathname);
  const startedAt = useRef(performance.now());
  const [phase, setPhase] = useState(() => (enabled() && (isPublic(pathname) || !appOpened) ? 'cover' : 'idle'));
  const [soft, setSoft] = useState(false);

  // React now owns the paper: drop the static boot sheet from index.html (identical look, so no flicker).
  useLayoutEffect(() => { document.getElementById('uip-boot')?.remove(); appOpened = true; }, []);

  useLayoutEffect(() => {
    if (prev.current === pathname) return;
    prev.current = pathname;
    if (enabled() && isPublic(pathname)) {
      startedAt.current = performance.now();
      setSoft(true);
      setPhase('cover');
    }
  }, [pathname]);

  useEffect(() => {
    if (phase !== 'cover') return undefined;
    const min = soft ? 260 : 700;
    let done = false;
    let timer = 0;
    const go = () => {
      if (done) return;
      done = true;
      requestAnimationFrame(() => requestAnimationFrame(() => setPhase('open')));
    };
    const check = () => {
      if (done || paperPending() > 0) return;
      if (!soft && document.readyState !== 'complete') return;
      const wait = min - (performance.now() - startedAt.current);
      clearTimeout(timer);
      if (wait > 0) timer = setTimeout(check, wait); else go();
    };
    const cap = setTimeout(go, soft ? 3000 : 4500); // never hold the visitor hostage
    const off = subscribePaper(check);
    window.addEventListener('load', check);
    check();
    return () => { done = true; clearTimeout(timer); clearTimeout(cap); off(); window.removeEventListener('load', check); };
  }, [phase, soft]);

  useEffect(() => {
    if (phase !== 'open') return undefined;
    const t = setTimeout(() => setPhase('idle'), 1100); // fallback if animationend never fires
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === 'idle') return null;
  return (
    <div className={`pr pr--${phase}${soft ? ' pr--soft' : ''}`} aria-hidden="true">
      <div className="pr__base" />
      <div className="pr__facets">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <i key={i} className={`pr__f pr__f--${i}`} onAnimationEnd={i === 8 ? () => setPhase('idle') : undefined} />
        ))}
      </div>
      <div className="pr__creases" />
      <div className="pr__brand">
        <img src="/images/logo/uipe-logo-sm.png" srcSet="/images/logo/uipe-logo-sm.png 1x, /images/logo/uipe-logo.png 2x" width="200" height="110" alt="" decoding="async" />
        <span className="pr__bar"><b /></span>
      </div>
    </div>
  );
}
