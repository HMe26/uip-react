import { useEffect, useState } from 'react';
import { desktopApi } from '../desktop/desktopApi';

/**
 * Is "My PC" open for this account? (Admin → My PC Control: the global switch, the allowed portals/roles, per-user block.)
 * Asks GET /desktop/access and keeps the last answer per user for a short while so the sidebar and the page agree
 * without a request storm. While the first answer is on its way `allowed` is null (unknown) — callers treat that as "show".
 * A failed request also counts as unknown: the API itself still refuses everything for a closed account.
 */
const TTL = 30_000;
const cache = new Map(); // uid -> { at, value }
const inflight = new Map();

export function invalidateMyPcAccess() { cache.clear(); inflight.clear(); }

function load(uid) {
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.value);
  if (inflight.has(uid)) return inflight.get(uid);
  const p = desktopApi.access()
    .then((v) => { const value = { allowed: v?.allowed !== false, code: v?.code || null, message: v?.message || '', readonly: !!v?.readonly }; cache.set(uid, { at: Date.now(), value }); return value; })
    .catch(() => null)
    .finally(() => inflight.delete(uid));
  inflight.set(uid, p);
  return p;
}

export function useMyPcAccess(uid) {
  const [state, setState] = useState(() => cache.get(uid)?.value || { allowed: null, code: null, message: '', readonly: false });
  useEffect(() => {
    if (uid == null) return undefined;
    let live = true;
    load(uid).then((v) => { if (live && v) setState(v); });
    return () => { live = false; };
  }, [uid]);
  return state;
}
