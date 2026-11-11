import { useCallback, useEffect, useRef, useState } from 'react';
import { DEVICE_BLOCKED_EVENT, clearTokens } from '../api/client';
import { useLanguage } from '../context/LanguageContext';
import { getDeviceId } from '../lib/examSession';
import PageLoading from './PageLoading';
import DeviceBlocked from './DeviceBlocked';

/**
 * Wraps the whole app (above AuthProvider). On load it asks GET /api/v1/device-status whether this
 * device type is blocked by the Device restrictions policy; if so it renders <DeviceBlocked /> INSTEAD of
 * the platform (so nothing — login, register, public pages — opens). It also flips to the blocked page when
 * any later API call answers 403 `device_blocked` (api/client.js fires DEVICE_BLOCKED_EVENT), and re-checks
 * when the tab regains focus so a policy change is picked up without a manual reload.
 *
 * Two kinds of block:
 *  - platform-wide (policy mode allowlist/denylist): known before sign-in, so the app never opens;
 *  - per account type (mode "by_role", e.g. Students blocked on mobile): the role is only known at sign-in /
 *    from the session, so it arrives through DEVICE_BLOCKED_EVENT with `role`. That page offers "sign in with
 *    another account" (clears the session) instead of auto-retrying.
 *
 * Fails OPEN: if the status call can't be completed (offline, old backend, timeout) the app opens normally —
 * the server-side middleware is the real enforcement; this gate only decides which screen to show.
 */
const CHECK_TIMEOUT_MS = 5000;

async function fetchDeviceStatus(locale) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch('/api/v1/device-status', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-Device-Id': getDeviceId(), 'X-Locale': locale === 'ar' ? 'ar' : 'en' },
    });
    const json = await res.json().catch(() => null);
    if (res.status === 403 && json?.errors?.code === 'device_blocked') {
      return { allowed: false, deviceType: json?.data?.device_type };
    }
    if (json?.success && json.data && typeof json.data.allowed === 'boolean') {
      return { allowed: json.data.allowed, deviceType: json.data.device_type };
    }
    return null; // unexpected answer -> fail open
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default function DeviceGate({ children }) {
  const { locale } = useLanguage();
  const [state, setState] = useState({ phase: 'checking', deviceType: 'unknown', role: null }); // checking | ok | blocked
  const [retrying, setRetrying] = useState(false);
  const [retriedStillBlocked, setRetriedStillBlocked] = useState(false);
  const phaseRef = useRef('checking');
  phaseRef.current = state.phase;

  const check = useCallback(async () => {
    const r = await fetchDeviceStatus(locale);
    // A per-account-type block (state.role) isn't something this global check can lift — leave it up.
    if (!r || r.allowed) setState((s) => (s.phase === 'ok' || s.role ? s : { phase: 'ok', deviceType: 'unknown', role: null }));
    else setState({ phase: 'blocked', deviceType: r.deviceType || 'unknown', role: null });
    return r;
  }, [locale]);

  // First check on load.
  useEffect(() => { check(); }, [check]);

  // A live API call got 403 device_blocked (e.g. the policy was turned on while the app was open).
  useEffect(() => {
    const onBlocked = (e) => setState({ phase: 'blocked', deviceType: e.detail?.deviceType || 'unknown', role: e.detail?.role || null });
    window.addEventListener(DEVICE_BLOCKED_EVENT, onBlocked);
    return () => window.removeEventListener(DEVICE_BLOCKED_EVENT, onBlocked);
  }, []);

  // Re-check when the person comes back to the tab (policy may have been changed in the meantime).
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState === 'visible' && phaseRef.current !== 'checking') check();
    };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [check]);

  // Per-account-type block: drop the session (if any) and go back to the start so another account can sign in.
  const switchAccount = () => {
    clearTokens();
    window.location.assign('/');
  };

  const retry = async () => {
    setRetrying(true);
    setRetriedStillBlocked(false);
    const r = await check();
    setRetrying(false);
    if (r && r.allowed === false) setRetriedStillBlocked(true);
  };

  if (state.phase === 'checking') return <PageLoading />;
  if (state.phase === 'blocked') {
    return (
      <DeviceBlocked
        deviceType={state.deviceType}
        role={state.role}
        onRetry={retry}
        onSwitchAccount={switchAccount}
        checking={retrying}
        stillBlocked={retriedStillBlocked}
      />
    );
  }
  return children;
}
