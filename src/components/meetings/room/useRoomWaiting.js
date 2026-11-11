import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../../api/client';

const POLL_MS = 4000;

/**
 * Waiting-room requests for the host / moderator, usable from INSIDE the room (the same endpoints MeetingWaitingRoomPanel uses on
 * the meeting details page). Polls while enabled; pauses while the tab is hidden.
 */
export function useRoomWaiting(meetingUuid, enabled) {
  const [requests, setRequests] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [busyAll, setBusyAll] = useState(false);
  const [error, setError] = useState(null);
  const alive = useRef(true);

  const load = useCallback(() => api.get(`/api/v1/meetings/${meetingUuid}/waiting-room`)
    .then((json) => { if (alive.current) setRequests(Array.isArray(json.data) ? json.data : []); }), [meetingUuid]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) { setRequests([]); return undefined; }
    load().catch(() => {});
    const id = setInterval(() => { if (document.visibilityState !== 'hidden') load().catch(() => {}); }, POLL_MS);
    return () => { alive.current = false; clearInterval(id); };
  }, [enabled, load]);

  const decide = useCallback(async (id, admit) => {
    setBusyId(id); setError(null);
    try {
      await api.post(`/api/v1/meetings/${meetingUuid}/waiting-room/${id}/${admit ? 'accept' : 'reject'}`);
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } catch (e) { setError(errorMessage(e)); } finally { setBusyId(null); }
  }, [meetingUuid]);

  const decideAll = useCallback(async (admit) => {
    setBusyAll(true); setError(null);
    try {
      await api.post(`/api/v1/meetings/${meetingUuid}/waiting-room/${admit ? 'accept-all' : 'reject-all'}`);
      setRequests([]);
    } catch (e) { setError(errorMessage(e)); } finally { setBusyAll(false); }
  }, [meetingUuid]);

  return { requests, busyId, busyAll, error, admit: (id) => decide(id, true), reject: (id) => decide(id, false), admitAll: () => decideAll(true), rejectAll: () => decideAll(false), reload: load };
}
