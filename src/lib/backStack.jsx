/**
 * Back-button logic for the whole SPA (phone hardware/gesture Back, browser Back, Android app Back).
 *
 * The problem this solves: most "screens" inside the app are NOT routes - a modal, the mobile sidebar
 * drawer, an opened chat thread, a lightbox. They never created a history entry, so pressing Back skipped
 * them and jumped to the previous *page* (often the dashboard) or out of the site. Pages that finished a
 * flow with navigate('/list') also left the form/detail they came from in the stack.
 *
 * Pieces
 *  - <BackStackManager/>  mounted once inside <BrowserRouter>. Every overlay (any element matching
 *      OVERLAY_SELECTOR, plus layers registered with useBackLayer) owns one history entry:
 *        open  -> an entry is pushed, Back -> the top overlay is closed and the page stays where it is,
 *        closed from the UI (X / Cancel / backdrop) -> the entry is popped again, so the stack never fills
 *        with dead entries.  Stray "ghost" entries are skipped automatically.
 *  - useBackLayer(open, close)  explicit version for state-driven screens (e.g. a chat thread on phones).
 *  - useSeedBackStack(home)     a page opened straight from a link / refreshed as the first entry of the tab
 *      gets the portal home placed underneath it, so Back goes there instead of leaving the site.
 *  - useSmartBack(fallback) / <BackLink/>  "Back" buttons: go to the real previous screen when there is one,
 *      and only fall back to the fixed parent route when the page was opened directly.
 *
 * It relies on react-router storing the stack position in history.state.idx (same thing native.js uses).
 */
import { createContext, forwardRef, useCallback, useContext, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom';

// Everything below is "a layer on top of the page" that should be closed by Back.
// (The mobile sidebar drawer is registered with useBackLayer in DashboardLayout.)
const OVERLAY_SELECTOR = [
  '.modal-overlay', '.sec-modal-overlay', '.st-modal-overlay', '.ua-sheet-overlay',
  '.msg-modal-backdrop', '.msg-lightbox', '.pp-lightbox', '.gr-modal', '.ex-modal-scrim', '.ags-overlay', '.mr-overlay',
].join(',');

// Never touch history on these screens: the exam lock-down already owns Back there.
const EXAM_PATH = /\/exam-attempt(\/|$)/;

const MAX_DEPTH = 4;
const depthOf = (loc) => Math.min(MAX_DEPTH, Number(loc?.state?.__ov) || 0);
export const historyIndex = () => {
  const i = window.history.state && window.history.state.idx;
  return typeof i === 'number' ? i : 0;
};
export const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;

// ---- explicit layers (state-driven screens) ------------------------------------------------------
const layers = []; // [{ id, close }] oldest first
let layerSeq = 0;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

/**
 * Makes a state-driven screen closable with Back. `open` = it is currently shown, `close` = how to hide it.
 * Keep `enabled` false where the screen is a normal route (it already has its own history entry).
 */
export function useBackLayer(open, close, enabled = true) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open || !enabled) return undefined;
    const entry = { id: ++layerSeq, close: () => closeRef.current?.() };
    layers.push(entry);
    notify();
    return () => {
      const i = layers.indexOf(entry);
      if (i >= 0) layers.splice(i, 1);
      notify();
    };
  }, [open, enabled]);
}

function visibleOverlays() {
  return Array.from(document.querySelectorAll(OVERLAY_SELECTOR)).filter((el) => el.isConnected && el.getAttribute('aria-hidden') !== 'true');
}

// Closes the top-most DOM overlay the way a user would: press on its backdrop; Escape as a second try.
function closeTopOverlay(el) {
  if (!el) return;
  const opts = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
  setTimeout(() => {
    if (el.isConnected) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  }, 120);
}

export function BackStackManager() {
  const location = useLocation();
  const navigate = useNavigate();
  const navType = useNavigationType();
  const locRef = useRef(location);
  const typeRef = useRef(navType);
  const prevDepth = useRef(depthOf(location));
  const busy = useRef(false);
  const timer = useRef(0);
  const busyTimer = useRef(0);
  const idxRef = useRef(historyIndex()); // history position that matches the *rendered* location
  locRef.current = location;
  typeRef.current = navType;

  const reconcile = useCallback(() => {
    const loc = locRef.current;
    if (EXAM_PATH.test(loc.pathname)) return;
    if (busy.current) return;
    const dom = visibleOverlays();
    const want = Math.min(MAX_DEPTH, dom.length + layers.length);
    const have = depthOf(loc);

    if (want > have) {
      if (typeRef.current === 'POP' && have < prevDepth.current) {
        // Back was pressed while a layer is open -> close the top one (DOM overlays sit above layers).
        prevDepth.current = have;
        if (dom.length) closeTopOverlay(dom[dom.length - 1]);
        else layers[layers.length - 1]?.close();
        // If it refused to close (unsaved-changes guard, mandatory dialog) put its history entry back.
        clearTimeout(timer.current);
        timer.current = setTimeout(reconcile, 350);
        return;
      }
      // a layer just opened -> give it a history entry
      busy.current = true;
      clearTimeout(busyTimer.current);
      busyTimer.current = setTimeout(() => { busy.current = false; }, 600);
      navigate(`${loc.pathname}${loc.search}${loc.hash}`, { state: { ...(loc.state || {}), __ov: have + 1 } });
      return;
    }
    if (want < have) {
      // react-router v7 commits navigations inside startTransition, so a link tapped inside a menu/drawer
      // (which also closes that menu) pushes its history entry BEFORE the router location re-renders.
      // Stepping back now would undo that navigation - the tap looks like it "did nothing".
      // History is already ahead of the rendered location -> wait; the location effect reconciles again.
      if (historyIndex() !== idxRef.current) {
        clearTimeout(timer.current);
        timer.current = setTimeout(reconcile, 120);
        return;
      }
      // a layer was closed from the UI, or we landed on a stale entry: step back over it
      busy.current = true;
      clearTimeout(busyTimer.current);
      busyTimer.current = setTimeout(() => { busy.current = false; }, 600);
      navigate(-(have - want));
    }
  }, [navigate]);

  // every location change (our own push/pop included) -> bookkeeping + reconcile
  useEffect(() => {
    busy.current = false;
    idxRef.current = historyIndex();
    reconcile();
    prevDepth.current = depthOf(location);
  }, [location, reconcile]);

  // layers opened/closed in the DOM or through useBackLayer
  useEffect(() => {
    let raf = 0;
    let t = 0;
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(reconcile); };
    // Whole-body observer: coalesce bursts of DOM changes (chat polling, progress rings) into one check every ~80 ms.
    const scheduleSoon = () => { if (t) return; t = setTimeout(() => { t = 0; schedule(); }, 80); };
    const mo = new MutationObserver(scheduleSoon);
    mo.observe(document.body, { childList: true, subtree: true });
    listeners.add(schedule);
    return () => { mo.disconnect(); listeners.delete(schedule); cancelAnimationFrame(raf); clearTimeout(t); clearTimeout(timer.current); clearTimeout(busyTimer.current); };
  }, [reconcile]);

  return null;
}

// ---- first entry of the tab -----------------------------------------------------------------------
let seeded = false;
/**
 * Phone only. When a page is the very first entry of the tab (opened from a link, a notification, a
 * bookmark or after the PWA was relaunched) Back would leave the site. Put the portal home underneath it
 * so Back lands there. Done with the raw History API so nothing re-renders or remounts.
 */
export function useSeedBackStack(home, skip = false) {
  const { pathname, search, hash } = useLocation();
  useEffect(() => {
    if (seeded || skip || !home || !isPhone()) return;
    seeded = true;
    const st = window.history.state;
    const here = `${pathname}${search}${hash}`;
    if (historyIndex() !== 0 || pathname.replace(/\/+$/, '') === home || EXAM_PATH.test(pathname)) return;
    try {
      window.history.replaceState({ usr: null, key: 'seed', idx: 0 }, '', home);
      window.history.pushState({ ...(st || {}), idx: 1 }, '', here);
    } catch { /* history API refused: keep the stack as it was */ }
  }, [home, skip, pathname, search, hash]);
}

// ---- Back buttons -----------------------------------------------------------------------------------
/**
 * Returns a click handler for a "Back" control. Goes back one real step when this tab has a previous
 * screen of the app; otherwise (page opened directly) goes to `fallback`, replacing the current entry.
 */
/** A window of the virtual mode has its own in-memory history: it provides its own "position in the stack" here. */
export const HistoryIndexContext = createContext(null);

export function useSmartBack(fallback = '/') {
  const navigate = useNavigate();
  const indexOf = useContext(HistoryIndexContext);
  return useCallback((e) => {
    e?.preventDefault?.();
    if ((indexOf ? indexOf() : historyIndex()) > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, fallback, indexOf]);
}

/** Drop-in replacement for <Link to={parent}> used as a "Back to ..." control. */
export const BackLink = forwardRef(function BackLink({ to, onClick, children, ...rest }, ref) {
  const back = useSmartBack(to);
  return (
    <Link
      ref={ref}
      to={to}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        back(e);
      }}
    >
      {children}
    </Link>
  );
});
