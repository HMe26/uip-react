import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { startRealtime, stopRealtime } from '../lib/realtime';

/** Opens the single realtime socket while someone is signed in, closes it on sign-out / account switch. */
export default function RealtimeBridge() {
  const { user, status } = useAuth();
  const uid = status === 'authenticated' ? user?.id : null;
  useEffect(() => {
    if (!uid) { stopRealtime(); return undefined; }
    startRealtime(uid);
    return () => stopRealtime();
  }, [uid]);
  return null;
}
