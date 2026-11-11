import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';

/**
 * Finds one row of an existing admin LIST endpoint by id. No detail endpoint is assumed:
 *  1. the row handed over by the list page through router state (instant), else
 *  2. the list is scanned page by page (max 15 pages) until the id is found.
 * Returns { row, setRow, loading, error, notFound, reload }.
 */
export default function useRowLookup(listPath, id, params = {}) {
  const location = useLocation();
  const fromState = location.state?.row;
  const initial = fromState && String(fromState.id) === String(id) ? fromState : null;
  const [row, setRow] = useState(initial);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [tick, setTick] = useState(0);
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    let cancelled = false;
    // Always refresh in the background so actions (verify, moderate…) show the new status.
    async function scan() {
      setError(null);
      try {
        let firstLen = 0;
        for (let page = 1; page <= 15; page += 1) {
          const json = await api.get(listPath, { ...JSON.parse(paramsKey), page });
          if (cancelled) return;
          const data = json.data || [];
          if (page === 1) firstLen = data.length;
          const hit = data.find((r) => String(r.id) === String(id));
          if (hit) { setRow(hit); setNotFound(false); return; }
          if (data.length === 0 || data.length < firstLen) break;
        }
        if (!cancelled) setNotFound(true);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    scan();
    return () => { cancelled = true; };
  }, [listPath, id, paramsKey, tick]);

  return { row, setRow, loading, error, notFound: notFound && !row, reload: () => setTick((n) => n + 1) };
}
