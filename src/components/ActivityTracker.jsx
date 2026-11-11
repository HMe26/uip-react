import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { startActivityTracking, stopActivityTracking, trackPageView, trackAuthEvent } from '../lib/activityTracker';

/** Mounted once inside <AuthProvider> + <BrowserRouter>: runs the per-user activity tracker for whoever is signed in. */
export default function ActivityTracker() {
  const { user } = useAuth();
  const loc = useLocation();
  const uid = user?.id ?? null;
  const prevUid = useRef(null);

  useEffect(() => {
    if (uid) {
      startActivityTracking();
      if (prevUid.current !== uid) trackAuthEvent(prevUid.current ? 'Switched account' : 'Session started', { role: user?.role || '' });
    } else if (prevUid.current) {
      trackAuthEvent('Signed out', {});
      stopActivityTracking();
    }
    prevUid.current = uid;
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (uid) trackPageView(`${loc.pathname}${loc.search}`, document.title);
  }, [uid, loc.pathname, loc.search]);

  return null;
}
