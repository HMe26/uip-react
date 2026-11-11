import { Component, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Navigate, Route, Routes,
  UNSAFE_createMemoryHistory as createMemoryHistory,
  UNSAFE_DataRouterContext as DataRouterContext,
  UNSAFE_DataRouterStateContext as DataRouterStateContext,
  UNSAFE_LocationContext as LocationContext,
  UNSAFE_NavigationContext as NavigationContext,
  UNSAFE_RouteContext as RouteContext,
} from 'react-router-dom';
import Icon from '../components/Icon';
import NoPermission from '../components/NoPermission';
import PageLoading from '../components/PageLoading';
import { useAuth } from '../context/AuthContext';
import { HistoryIndexContext } from '../lib/backStack';
import { VM_BY_ID, resolveTarget } from './catalog';
import { VM_ROUTES } from './routes';
import './virtual.css';

/**
 * One window of the virtual mode = one platform page running with its OWN history (a private in-memory router) inside the desktop.
 * Same React tree as the rest of the app, so sign-in, language, theme, realtime and notifications are shared — no iframe, no second copy of the app.
 *
 * What a link does (decided by resolveTarget in ./catalog.js):
 *   - a link inside the same app    → the window navigates (its own Back / Forward)
 *   - a link to ANOTHER app         → that app's window opens / comes to the front, like clicking its icon
 *   - /student/my-pc                → the desktop's "This PC"
 *   - the exam, a meeting room      → real full pages: the desktop is left for them (they need the whole screen)
 *   - print layouts                 → a new browser tab
 */

// react-router refuses a second <Router> inside the app's BrowserRouter, so this window supplies the router CONTEXTS itself.
const ROOT_ROUTE_CTX = { outlet: null, matches: [], isDataRoute: false };

class WindowBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { try { console.error('[virtual window]', err); } catch { /* ignore */ } }
  render() {
    if (!this.state.err) return this.props.children;
    const { ar, onRetry } = this.props;
    return (
      <div className="vm-err" role="alert">
        <Icon name="alert-triangle" size={30} />
        <b>{ar ? 'حصلت مشكلة في تحميل الصفحة دي' : 'This page could not be shown'}</b>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => { this.setState({ err: null }); onRetry?.(); }}>{ar ? 'إعادة المحاولة' : 'Try again'}</button>
      </div>
    );
  }
}

const toPath = (to) => (typeof to === 'string' ? to : `${to.pathname || ''}${to.search || ''}${to.hash || ''}`);

export default function VirtualApp({ appId, start, nonce, cur, ar, onLocation, onOpenPath, onLeave, onTab }) {
  const app = VM_BY_ID[appId];
  const { can } = useAuth();
  const [hist] = useState(() => createMemoryHistory({ initialEntries: [cur || start || app?.route || '/student/dashboard'], v5Compat: true })); // v5Compat: without it the history never calls listen() — links inside a window changed the address but the page stayed the same
  const [state, setState] = useState({ action: hist.action, location: hist.location });
  useLayoutEffect(() => hist.listen(setState), [hist]);
  const [bump, setBump] = useState(0);

  // callbacks are read through a ref: the navigator below must keep ONE identity for the lifetime of the window
  const cb = useRef({});
  cb.current = { appId, onOpenPath, onLeave, onTab, onLocation };

  // a link / icon / notification asked THIS window to show another page of its app
  const lastNonce = useRef(nonce);
  useEffect(() => {
    if (nonce === lastNonce.current) return;
    lastNonce.current = nonce;
    if (start) hist.push(start);
  }, [nonce, start, hist]);

  // remember where the window is (restored after a refresh) + tell the desktop
  useEffect(() => { cb.current.onLocation?.(`${state.location.pathname}${state.location.search}`); }, [state.location.pathname, state.location.search]);

  /** Returns true when the link was handled outside this window. */
  const route = useCallback((path) => {
    const t = resolveTarget(path);
    const c = cb.current;
    if (t.kind === 'app') { if (t.app.id === c.appId) return false; c.onOpenPath?.(path); return true; }
    if (t.kind === 'explorer') { c.onOpenPath?.(path); return true; }
    if (t.kind === 'tab') { c.onTab?.(path); return true; }
    c.onLeave?.(path);
    return true;
  }, []);

  const navigator = useMemo(() => ({
    createHref: (to) => hist.createHref(to),
    encodeLocation: (to) => hist.encodeLocation(to),
    go: (n) => hist.go(n),
    push: (to, st, opts) => { if (!route(toPath(to))) hist.push(to, st, opts); },
    replace: (to, st, opts) => { if (!route(toPath(to))) hist.replace(to, st, opts); },
  }), [hist, route]);

  const navCtx = useMemo(() => ({ basename: '/', navigator, static: false, future: {} }), [navigator]);
  const locCtx = useMemo(() => ({ location: state.location, navigationType: state.action }), [state]);
  const histIndex = useCallback(() => hist.index, [hist]);

  const blocked = app?.perm && !can(app.perm);
  // The page inside runs in a WINDOW, not in the browser: tell its CSS how big that window really is, so `100vh` / `100vw`
  // (rewritten at build time to calc(N * var(--os-vh|--os-vw, 1vh|1vw)), see vite.config.js) mean "this window".
  const shellRef = useRef(null);
  useLayoutEffect(() => {
    const el = shellRef.current;
    if (!el) return undefined;
    const apply = () => {
      const w = el.clientWidth; const h = el.clientHeight;
      if (!w || !h) return;
      el.style.setProperty('--os-vw', `${w / 100}px`);
      el.style.setProperty('--os-vh', `${h / 100}px`);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return undefined;
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(apply); });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  return (
    <div ref={shellRef} className="vm-shell app-shell app-shell--insight app-shell--student" data-portal="student" data-vm-app={app?.key}>
      <div className="app-shell__content">
        <main className="app-shell__main">
          {blocked ? <NoPermission permission={app.perm} /> : (
            <WindowBoundary key={bump} ar={ar} onRetry={() => setBump((b) => b + 1)}>
              <NavigationContext.Provider value={navCtx}>
                <LocationContext.Provider value={locCtx}>
                  <DataRouterContext.Provider value={null}>
                    <DataRouterStateContext.Provider value={null}>
                      <RouteContext.Provider value={ROOT_ROUTE_CTX}>
                        <HistoryIndexContext.Provider value={histIndex}>
                          <Suspense fallback={<PageLoading />}>
                            <Routes>
                              {VM_ROUTES.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
                              <Route path="*" element={<Navigate to={app?.route || '/student/dashboard'} replace />} />
                            </Routes>
                          </Suspense>
                        </HistoryIndexContext.Provider>
                      </RouteContext.Provider>
                    </DataRouterStateContext.Provider>
                  </DataRouterContext.Provider>
                </LocationContext.Provider>
              </NavigationContext.Provider>
            </WindowBoundary>
          )}
        </main>
      </div>
    </div>
  );
}
