import { api } from '../api/client';

/**
 * ONE call (GET /api/v1/app/summary) for everything the app shell polls:
 * permissions + session heartbeat + notification counters + unread-messages badge.
 * Before, each of those was its own request on every page load AND on every poll.
 *
 * `fetchSummary` shares one in-flight request between all callers and re-uses a result younger than `maxAge` ms.
 * Resolves to the summary object, or null when the server has no such endpoint yet / the call failed
 * (callers then fall back to the old individual endpoints).
 */
let inflight = null;
let last = null;
let lastAt = 0;
let unsupported = false;

export function fetchSummary({ maxAge = 8000 } = {}) {
  if (unsupported) return Promise.resolve(null);
  if (last && Date.now() - lastAt < maxAge) return Promise.resolve(last);
  if (inflight) return inflight;
  inflight = api.get('/api/v1/app/summary')
    .then((json) => {
      last = json?.data || null;
      lastAt = Date.now();
      return last;
    })
    .catch((e) => {
      if (e?.status === 404 || e?.status === 405) unsupported = true; // older backend: keep using the individual endpoints
      return null;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Forget the cached summary (sign-out / account switch). */
export function resetSummary() { last = null; lastAt = 0; inflight = null; }
