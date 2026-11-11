import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';

/**
 * Exam lock-down state for the student portal.
 *
 * While a student has an in-progress exam attempt the whole portal shell is
 * locked: no sidebar / topbar / bottom nav, no AI assistant, and every route
 * except the attempt page itself redirects back to it (see DashboardLayout).
 *
 * The source of truth is the server (GET /api/v1/exam-system/active-attempt),
 * so a reload, a second tab, a typed URL or another device cannot get around
 * the lock. The attempt page also calls engage()/release() directly so the
 * lock switches on the instant an exam starts and off the instant it ends,
 * without waiting for the next poll.
 */
const Ctx = createContext({
  locked: false,
  ready: true,
  attemptId: null,
  title: '',
  engage: () => {},
  release: () => {},
  refresh: () => Promise.resolve(),
});

const POLL_MS = 60000;

export function ExamLockProvider({ enabled, children }) {
  const [state, setState] = useState({ ready: !enabled, attemptId: null, title: '' });

  const refresh = useCallback(() => (
    api.get('/api/v1/exam-system/active-attempt')
      .then((json) => {
        const d = json?.data;
        setState({ ready: true, attemptId: d?.active ? d.attempt_id : null, title: d?.title || '' });
      })
      // Network/API failure must never lock a student out of the portal; the
      // server still enforces the timer and the AI lock on its own.
      .catch(() => setState((s) => ({ ...s, ready: true })))
  ), []);

  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    const iv = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS); // hidden tab: no request
    return () => clearInterval(iv);
  }, [enabled, refresh]);

  const engage = useCallback((attemptId, title) => {
    setState((s) => (s.attemptId === Number(attemptId) && s.ready ? s : { ready: true, attemptId: Number(attemptId), title: title || s.title }));
  }, []);
  const release = useCallback(() => {
    setState((s) => (s.attemptId == null ? s : { ...s, attemptId: null, title: '' }));
  }, []);

  const value = useMemo(() => ({
    locked: enabled && state.attemptId != null,
    ready: state.ready,
    attemptId: state.attemptId,
    title: state.title,
    engage,
    release,
    refresh,
  }), [enabled, state, engage, release, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useExamLock() {
  return useContext(Ctx);
}
