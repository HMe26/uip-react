import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { myPcPath } from '../config/myPc';
import { useIsMobileOS } from '../desktop/useIsMobileOS';
import { belongsInDesktop } from './catalog';

/**
 * Virtual mode ("UIPE OS"): the student works on the WHOLE platform from inside the My PC desktop — every portal page
 * (courses, exams, grades, messages…) opens as a window of that desktop.
 *
 * PINNED: it is no longer a choice. For every supported role the desktop IS the platform; the old sidebar portal is not offered
 * (no switch, no "back to the normal portal"). The server answers GET /api/v1/desktop/virtual-mode with enabled = available.
 *
 *   available  the role may use it AND the feature + My PC are open for the account
 *   enabled    = available. While it is NOT available (an admin closed My PC, the account is blocked, maintenance) the student gets
 *              the normal portal instead, so nobody is pushed into a closed desktop.
 *
 * Support escape hatch: open any URL with ?vm=off to use the normal portal for the rest of this browser tab (sessionStorage only).
 *
 * Phones keep the normal portal (it already has a purpose-built phone UI): the redirect below is skipped there.
 */
export const VIRTUAL_ROLES = ['student'];
/**
 * MASTER SWITCH. false = the student portal opens as a normal portal (sidebar + pages) outside My PC, like every other portal,
 * and My PC stays its own desktop at /student/my-pc. Set to true to pin the whole platform inside the desktop again.
 */
export const VIRTUAL_MODE_ENABLED = false;
const ENDPOINT = '/api/v1/desktop/virtual-mode';
const unwrap = (r) => (r && r.data !== undefined ? r.data : r);
const cacheKey = (uid) => `uip_virtual_mode_v1_${uid ?? 'anon'}`;

export const readVirtualCache = (uid) => { try { const v = localStorage.getItem(cacheKey(uid)); return v === '1' ? true : v === '0' ? false : null; } catch { return null; } };
const BYPASS_KEY = 'uip_vm_bypass_v1';
const readBypass = () => { try { return sessionStorage.getItem(BYPASS_KEY) === '1'; } catch { return false; } };
const writeVirtualCache = (uid, on) => { try { localStorage.setItem(cacheKey(uid), on ? '1' : '0'); } catch { /* private mode */ } };

export const virtualApi = {
  get: async () => unwrap(await api.get(ENDPOINT)),
};

// A portal URL that was redirected into the desktop (a notification link, a bookmark, "Back" after an exam…): the desktop opens it as a window once.
let pendingOpen = null;
export const requestVirtualOpen = (path) => { pendingOpen = path || null; };
export const takeVirtualOpen = () => { const p = pendingOpen; pendingOpen = null; return p; };

const Ctx = createContext({ supported: false, ready: true, available: false, enabled: false, busy: false, pinned: false, setEnabled: async () => false, refresh: async () => {} });

export function VirtualModeProvider({ children }) {
  const { user } = useAuth();
  const { search } = useLocation();
  const uid = user?.id;
  const supported = VIRTUAL_MODE_ENABLED && !!user && VIRTUAL_ROLES.includes(user.role);
  const [st, setSt] = useState({ uid: null, available: false, enabled: false });
  const busy = false;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const uidRef = useRef(uid); uidRef.current = uid;

  const apply = useCallback((d) => {
    const enabled = !!(d?.available && d?.enabled);
    writeVirtualCache(uidRef.current, enabled);
    if (alive.current) setSt({ uid: uidRef.current, available: !!d?.available, enabled });
  }, []);

  const refresh = useCallback(async () => {
    if (!supported) return;
    try { apply(await virtualApi.get()); } catch { /* offline / server hiccup: keep what the cache says — a network error never locks anybody in or out */ }
  }, [supported, apply]);

  useEffect(() => { refresh(); }, [refresh, uid]);
  // another device changed the choice → follow it when this tab comes back to the front
  useEffect(() => {
    if (!supported) return undefined;
    const h = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, [supported, refresh]);

  // kept for old callers: the mode is pinned, so there is nothing to switch
  const setEnabled = useCallback(async () => true, []);

  // support escape hatch: any URL with ?vm=off shows the normal portal for the rest of this tab
  const [bypass, setBypass] = useState(readBypass);
  useEffect(() => {
    if (!supported) return;
    if (new URLSearchParams(search).get('vm') === 'off') { try { sessionStorage.setItem(BYPASS_KEY, '1'); } catch { /* ignore */ } setBypass(true); }
  }, [supported, search]);

  const fresh = st.uid === uid && uid != null; // the answer belongs to THIS account (not the one who signed out before)
  const cached = useMemo(() => (supported ? readVirtualCache(uid) : null), [supported, uid, st]); // eslint-disable-line react-hooks/exhaustive-deps
  // pinned: on whenever it is available; until the server answers, assume yes unless the last answer here was "not available"
  const enabled = supported && !bypass && (fresh ? st.enabled : cached !== false);
  const value = useMemo(() => ({ supported, ready: fresh || !supported, available: supported && fresh && st.available, enabled, busy, pinned: true, setEnabled, refresh }), [supported, fresh, st.available, enabled, busy, setEnabled, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVirtualMode() {
  return useContext(Ctx);
}

/**
 * Mounted by DashboardLayout: while the mode is on, a student's portal page (a bookmark, a notification link, a redirect after login,
 * "back to exams" after an exam…) is shown as a window of the desktop instead. Exams, meeting rooms and print pages stay full pages.
 */
export function VirtualGuard({ children }) {
  const vm = useVirtualMode();
  const mobile = useIsMobileOS();
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  const go = vm.enabled && !mobile && belongsInDesktop(pathname) && !/^\/student\/my-pc(\/|$)/.test(pathname);
  if (go) requestVirtualOpen(`${pathname}${search}`); // idempotent: the desktop picks it up once it mounts
  if (go) return <Navigate to={myPcPath(user?.role)} replace />;
  return children;
}
