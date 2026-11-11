import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { registerPush, unregisterPush } from '../native'; // [ANDROID]
import { getGateToken } from '../config/staffGate';
import { clearCache } from '../lib/draftStore';
import { fetchSummary, resetSummary } from '../lib/appSummary';
import { wipeLocalData } from '../lib/wipeLocalData';
import { api, ApiError, getTokens, setTokens, clearTokens, restoreSession, markActivity, getLastActivity, getIdleMs, getStoredUser, setStoredUser, ACCESS_KEY, PERMISSION_DENIED_EVENT } from '../api/client';

const AuthContext = createContext(null);

/** LEGACY ONLY: the server now encrypts the access token, so this works just for a plain JWT
 *  issued before that change (a session that was already open at deploy time). Normal sign-ins
 *  take the user from the response (`data.user`) instead. Never trust this for authorization. */
function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

/** Builds the `user` state shape from decoded JWT claims — `name`/`email`
 *  are the display claims UipJwtService::issueTokenPair() now embeds
 *  alongside `sub`/`role` (both nullable for tokens issued before that
 *  change / a since-deleted user), used anywhere the app needs to show
 *  the signed-in user's name. */
function userFromClaims(claims) {
  return { id: claims.sub, role: claims.role, full_name: claims.name ?? null, name_ar: claims.name_ar ?? null, name_en: claims.name_en ?? null, email: claims.email ?? null };
}

/** `data.user` from login / 2FA / refresh -> the `user` state shape. */
function userFromResponse(u) {
  return { id: u.id, role: u.role, full_name: u.name ?? null, name_ar: u.name_ar ?? null, name_en: u.name_en ?? null, email: u.email ?? null };
}

/** Current identity for this browser: the stored user, else (legacy plain token) the token's claims. */
function readIdentity(accessToken) {
  const stored = getStoredUser();
  if (stored?.id) return userFromResponse(stored);
  const claims = accessToken ? decodeJwt(accessToken) : null;
  return claims?.sub ? userFromClaims(claims) : null;
}

/** Pages where someone can sit for a long time without touching anything
 *  (taking an exam, being in a meeting). The idle logout pauses there. */
const IDLE_EXEMPT = /\/exam-attempt\/[^/]+\/?$|\/meetings?\/|\/room(\/|$)/i;

/** Fired by any Settings/Profile page after the signed-in person's name changes. */
export const PROFILE_EVENT = 'uip:profile-updated';
export const announceProfile = (patch) => window.dispatchEvent(new CustomEvent(PROFILE_EVENT, { detail: patch || {} }));

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // { id, role, full_name, email } | null
  const [status, setStatus] = useState('loading'); // 'loading' | 'authenticated' | 'guest'
  // Effective permissions of the signed-in user: null until loaded, then { admin, set }.
  // UI-only (hides buttons/pages) — the server enforces every permission on its own.
  const [permissions, setPermissions] = useState(null);
  // Joker accounts (every role) get a role switcher; empty for everyone else.
  const [jokerRoles, setJokerRoles] = useState([]);

  useEffect(() => {
    let cancelled = false;
    // Persistent sign-in: the long-lived refresh cookie may still be valid even though this browser has no
    // usable access token (storage wiped, app reopened after months, token from an older build). Restore the
    // session silently, like Facebook, instead of asking for the password again.
    const tryRestore = () => {
      // Never leave the app on the launch spinner: if the server has not answered after 12s show the sign-in page
      // (a late successful restore below still signs the person in).
      const watchdog = setTimeout(() => { if (!cancelled) setStatus((s) => (s === 'loading' ? 'guest' : s)); }, 12000);
      restoreSession().catch(() => false).then((ok) => {
        clearTimeout(watchdog);
        if (cancelled) return;
        const identity = ok ? readIdentity(getTokens().accessToken) : null;
        if (identity) {
          markActivity();
          setUser(identity);
          setStatus('authenticated');
        } else {
          setStatus('guest');
        }
      });
    };

    const { accessToken } = getTokens();
    if (!accessToken) {
      tryRestore();
      return () => { cancelled = true; };
    }
    const idleMs = getIdleMs();
    const last = getLastActivity();
    if (idleMs && last && Date.now() - last > idleMs) {
      // Away longer than the allowed inactivity (only when persistent sign-in is switched off): end the
      // session on the server too, then show login.
      const { refreshToken } = getTokens(); // legacy sessions only; otherwise the cookie identifies the session
      api.post('/api/v1/auth/logout', refreshToken ? { refresh_token: refreshToken } : undefined)
        .catch(() => {})
        .finally(() => { clearTokens(); setUser(null); setStatus('guest'); });
      return undefined;
    }
    const identity = readIdentity(accessToken);
    if (identity) {
      setUser(identity);
      setStatus('authenticated');
    } else {
      clearTokens();
      tryRestore();
      return () => { cancelled = true; };
    }
    return undefined;
  }, []);

  /** Tabs share one login (tokens live in localStorage). The `storage` event
   *  fires in every OTHER tab when this one signs in, signs out, or switches
   *  account, so they follow along: sign-out/revoke => guest, a different
   *  account => swap the UI identity. A plain token refresh for the same
   *  user changes nothing visible. */
  useEffect(() => {
    const onStorage = (e) => {
      if (e.storageArea !== localStorage) return;
      if (e.key === null) { // storage.clear()
        setUser(null); setStatus('guest');
        return;
      }
      if (e.key !== ACCESS_KEY) return;
      if (!e.newValue) {
        setUser(null); setStatus('guest');
        return;
      }
      const next = readIdentity(e.newValue);
      if (!next) return;
      setUser((u) => (u && String(u.id) === String(next.id) && u.role === next.role ? u : next));
      setStatus('authenticated');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /** Merge fresh profile fields into the signed-in user. The name in the
   *  access token is frozen at login, so after the person edits their name
   *  the UI must be patched here (and re-synced from the API on load). */
  const updateUser = useCallback((patch) => {
    setUser((u) => {
      if (!u || !patch) return u;
      const next = { ...u };
      let changed = false;
      for (const k of ['full_name', 'name_ar', 'name_en', 'email']) {
        if (patch[k] && patch[k] !== u[k]) { next[k] = patch[k]; changed = true; }
      }
      if (changed) setStoredUser({ id: next.id, role: next.role, name: next.full_name, name_ar: next.name_ar, name_en: next.name_en, email: next.email });
      return changed ? next : u;
    });
  }, []);

  useEffect(() => {
    const onProfile = (e) => updateUser(e.detail);
    window.addEventListener(PROFILE_EVENT, onProfile);
    return () => window.removeEventListener(PROFILE_EVENT, onProfile);
  }, [updateUser]);

  /** POST /api/v1/auth/login. Returns { requiresTwoFactor, challengeToken } on
   *  success so the caller can route to the 2FA screen with the token it
   *  needs (see completeTwoFactor below); throws ApiError on failure. */
  const login = useCallback(async (email, password, portal, loginAs) => {
    const body = { email, password };
    if (portal) body.portal = portal;       // 'staff' = hidden staff sign-in
    if (portal === 'staff') { const g = getGateToken(); if (g) body.gate_token = g; }  // ticket from the staff access-code gate
    if (loginAs) body.login_as = loginAs;   // account type picked on the public login
    const json = await api.post('/api/v1/auth/login', body);
    if (json.data?.requires_2fa) {
      return { requiresTwoFactor: true, challengeToken: json.data.challenge_token };
    }
    setTokens(json.data);
    markActivity();
    const me = userFromResponse(json.data.user);
    setUser(me);
    setStatus('authenticated');
    return { requiresTwoFactor: false, role: me.role };
  }, []);

  /** Result of /auth/google and /auth/google/complete: signed in, 2FA needed, or "finish your details" first. */
  const adoptGoogleResult = useCallback((data) => {
    if (data?.needs_registration) {
      return { needsRegistration: true, registrationToken: data.registration_token, profile: data.profile || {}, missing: data.missing || [], deletedAccount: data.deleted_account || null };
    }
    if (data?.requires_2fa) {
      return { requiresTwoFactor: true, challengeToken: data.challenge_token };
    }
    setTokens(data);
    markActivity();
    const me = userFromResponse(data.user);
    setUser(me);
    setStatus('authenticated');
    return { requiresTwoFactor: false, role: me.role };
  }, []);

  /** POST /api/v1/auth/google — sign in (or start signing up) with a Google ID token. */
  const loginWithGoogle = useCallback(async (idToken) => {
    const json = await api.post('/api/v1/auth/google', { id_token: idToken });
    return adoptGoogleResult(json.data);
  }, [adoptGoogleResult]);

  /** POST /api/v1/auth/microsoft — same as loginWithGoogle, with a Microsoft ID token. Details / restore reuse the /auth/google/* endpoints. */
  const loginWithMicrosoft = useCallback(async (idToken) => {
    const json = await api.post('/api/v1/auth/microsoft', { id_token: idToken });
    return adoptGoogleResult(json.data);
  }, [adoptGoogleResult]);

  /** GitHub sign-in: the pop-up flow (lib/githubAuth.js) already got the API's answer — same shape as /auth/google. */
  const loginWithGithub = useCallback(async (data) => adoptGoogleResult(data), [adoptGoogleResult]);

  /** POST /api/v1/auth/google/complete — creates the student account from the Google profile + the details they filled in. */
  const completeGoogleSignup = useCallback(async (payload) => {
    const json = await api.post('/api/v1/auth/google/complete', payload);
    return adoptGoogleResult(json.data);
  }, [adoptGoogleResult]);

  /** POST /api/v1/auth/google/restore — Google proved the email, so the deleted account comes back with all its data and signs in. */
  const restoreGoogleDeleted = useCallback(async (registrationToken) => {
    const json = await api.post('/api/v1/auth/google/restore', { registration_token: registrationToken });
    return adoptGoogleResult(json.data);
  }, [adoptGoogleResult]);

  /** POST /api/v1/auth/two-factor/verify — step 2 of login when the account
   *  has 2FA enabled (see login() above). Same shape as login(): stores the
   *  issued tokens and marks the user authenticated on success.
   *
   *  The API is stateless: login hands back a short-lived (5 min) signed
   *  `challenge_token` alongside `requires_2fa`, and this call sends it back
   *  (see LoginController::submit / TwoFactorChallengeController). */
  const completeTwoFactor = useCallback(async (code, rememberDevice, challengeToken) => {
    const json = await api.post('/api/v1/auth/two-factor/verify', {
      code,
      remember_device: rememberDevice,
      challenge_token: challengeToken,
    });
    setTokens(json.data);
    markActivity();
    const me = userFromResponse(json.data.user);
    setUser(me);
    setStatus('authenticated');
    return { role: me.role };
  }, []);

  /** Adopts a token pair that the API issued outside the normal login (e.g. account recovery
   *  with an email OTP): stores it and marks the person signed in. */
  const adoptSession = useCallback((data) => {
    setTokens(data);
    markActivity();
    const me = userFromResponse(data.user);
    setUser(me);
    setStatus('authenticated');
    return { role: me.role };
  }, []);

  /** POST /api/v1/auth/two-factor/cancel — "sign in as someone else" from
   *  the two-factor screen. Stateless on the server — just sends the same challenge token. */
  const cancelTwoFactor = useCallback(async (challengeToken) => {
    await api.post('/api/v1/auth/two-factor/cancel', { challenge_token: challengeToken });
  }, []);

  const logout = useCallback(async (opts) => {
    const wipe = !!opts && opts.wipe === true; // "sign out and erase my data from this device" (called from the desktop's sign-out dialog)
    // The button used to wait for the push-token cleanup (up to 4 s) and THEN the server call (up to 25 s on a bad connection),
    // so the app looked frozen. Both start together and run in the background; the screen switches after at most ~1 s, and a
    // request that is still in flight keeps going (it already carries its own auth headers).
    const { refreshToken } = getTokens();
    clearCache(); // local copies of private files are not left behind on a shared computer
    const cleanup = Promise.allSettled([
      unregisterPush(), // [ANDROID] stop phone notifications for this account (no-op in the browser)
      // The HttpOnly refresh cookie tells the server which session to end (the client adds the CSRF header).
      // A legacy localStorage token, if present, is sent in the body instead.
      api.post('/api/v1/auth/logout', refreshToken ? { refresh_token: refreshToken } : undefined),
    ]);
    await Promise.race([cleanup, new Promise((res) => setTimeout(res, 1000))]);
    // Even if the server call fails or is slow, clear local tokens so the UI reflects the logged-out state.
    clearTokens();
    setUser(null);
    setStatus('guest');
    if (wipe) {
      await wipeLocalData();
      window.location.replace('/'); // a fresh page: nothing of the previous person stays in memory either
    }
  }, []);

  const applyPermissions = useCallback((d) => {
    setPermissions({ admin: !!d?.is_admin, set: new Set(d?.permissions || []) });
    setJokerRoles(d?.is_joker ? (d?.available_roles || []) : []);
  }, []);

  const loadPermissions = useCallback(async (maxAge = 8000) => {
    try {
      // One combined call (permissions + heartbeat + counters); the old endpoint is only the fallback.
      const sum = await fetchSummary({ maxAge });
      if (sum?.permissions) { applyPermissions(sum.permissions); return; }
      api.get('/api/v1/session/heartbeat').catch(() => {}); // older backend without /app/summary
      const json = await api.get('/api/v1/auth/permissions');
      applyPermissions(json.data);
    } catch {
      /* keep the last known set; the server still enforces everything */
    }
  }, [applyPermissions]);

  /** Load the permissions after sign-in and keep them fresh: when the tab regains focus (at most once a minute),
   *  right after the server says "permission_denied", and once a minute while the tab is visible — so a permission
   *  an admin revokes (or grants) in /admin/roles reaches an open session without re-login. The same request is the
   *  session heartbeat and carries the notification / unread-message counters (see lib/appSummary.js). */
  useEffect(() => {
    if (status !== 'authenticated') { setPermissions(null); resetSummary(); return undefined; }
    registerPush(); // [ANDROID] phone notifications (no-op in the browser)
    loadPermissions();
    const onVisible = () => { if (document.visibilityState === 'visible') loadPermissions(55000); };
    // A polled endpoint (e.g. the unread-messages badge) can answer 403 every few seconds:
    // reload the list at most once per 10s so that never turns into a request storm.
    let lastDenied = 0;
    const onDenied = () => {
      const now = Date.now();
      if (now - lastDenied < 10000) return;
      lastDenied = now;
      loadPermissions(0);
    };
    window.addEventListener(PERMISSION_DENIED_EVENT, onDenied);
    document.addEventListener('visibilitychange', onVisible);
    // Only while visible: a hidden tab does not need a heartbeat (the server keeps the session until logout).
    // 60s ±10s (random per tick): after a deploy / outage everybody reconnects together, and a fixed period would keep
    // all of them hitting /app/summary in the same second forever.
    let timer = null;
    const schedule = () => {
      timer = setTimeout(() => {
        if (document.visibilityState === 'visible') loadPermissions(55000);
        schedule();
      }, 50000 + Math.random() * 20000);
    };
    schedule();
    return () => {
      window.removeEventListener(PERMISSION_DENIED_EVENT, onDenied);
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(timer);
    };
  }, [status, user?.id, loadPermissions]);

  /** can('ai.request_analysis') — true for admins, for a falsy slug, and until the list
   *  has loaded (no flicker; a blocked action still fails server-side with 403). */
  const can = useCallback((slug) => {
    if (!slug || !permissions || permissions.admin) return true;
    return permissions.set.has(slug);
  }, [permissions]);

  /** Signs the person out after the allowed time with no real interaction
   *  (mouse / keyboard / touch / scroll) — server policy `timeout_minutes`. */
  useEffect(() => {
    if (status !== 'authenticated') return undefined;
    const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'];
    let lastWrite = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastWrite > 5000) { lastWrite = now; markActivity(); }
    };
    if (!getLastActivity()) markActivity();
    EVENTS.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true, capture: true }));

    const check = () => {
      if (IDLE_EXEMPT.test(window.location.pathname)) { markActivity(); return; }
      const idleMs = getIdleMs();
      const last = getLastActivity();
      if (idleMs && last && Date.now() - last > idleMs) logout();
    };
    const timer = setInterval(check, 30000);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      EVENTS.forEach((ev) => window.removeEventListener(ev, onActivity, { capture: true }));
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [status, logout]);

  // (the 20-second GET /session/heartbeat is gone: GET /app/summary above is the heartbeat, once a minute)

  /** POST /api/v1/auth/switch-role — joker accounts only. Swaps the token pair to the chosen role. */
  const switchRole = useCallback(async (role) => {
    const json = await api.post('/api/v1/auth/switch-role', { role });
    setTokens(json.data);
    markActivity();
    const me = userFromResponse(json.data.user);
    setPermissions(null);
    setUser(me);
    return { role: me.role, redirect: json.data.redirect };
  }, []);

  const value = useMemo(
    () => ({ user, status, login, loginWithGoogle, loginWithMicrosoft, loginWithGithub, completeGoogleSignup, restoreGoogleDeleted, completeTwoFactor, cancelTwoFactor, adoptSession, logout, updateUser, can, permissionsReady: permissions !== null, isJoker: jokerRoles.length > 0, availableRoles: jokerRoles, switchRole }),
    [user, status, login, loginWithGoogle, loginWithMicrosoft, loginWithGithub, completeGoogleSignup, restoreGoogleDeleted, completeTwoFactor, cancelTwoFactor, adoptSession, logout, updateUser, can, permissions, jokerRoles, switchRole]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export { ApiError };
