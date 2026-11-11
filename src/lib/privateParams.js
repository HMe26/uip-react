import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Drop-in replacement for react-router's useSearchParams() for pages whose parameters (a folder id, a file id…)
 * should NOT appear in the address bar. The values live in the history entry's `state` instead, so Back / Forward
 * and a page refresh still work, but the URL stays a clean `/<portal>/my-pc` (nothing to read over a shoulder,
 * paste into a chat or leave in browser history / screenshots). An old link that still carries `?folder=26` is
 * accepted once and the query is stripped from the address bar right away.
 */
export function usePrivateParams() {
  const loc = useLocation();
  const navigate = useNavigate();
  const fromUrl = useMemo(() => Object.fromEntries(new URLSearchParams(loc.search)), [loc.search]);
  const stored = loc.state && typeof loc.state === 'object' ? loc.state.__p : null;
  const data = stored || fromUrl;
  const params = useMemo(() => new URLSearchParams(data), [data]);

  const L = useRef(loc); L.current = loc;
  const nav = useRef(navigate); nav.current = navigate;

  // an old / pasted link with a query: move it into state and clean the address bar
  useEffect(() => {
    if (loc.search && !stored) nav.current({ pathname: loc.pathname }, { replace: true, state: { ...(loc.state || {}), __p: fromUrl } });
  }, [loc.search, loc.pathname, loc.state, stored, fromUrl]);

  const setParams = useCallback((next, opts) => {
    const clean = {};
    new URLSearchParams(next || {}).forEach((v, k) => { clean[k] = v; });
    const cur = L.current;
    nav.current({ pathname: cur.pathname }, { replace: !!opts?.replace, state: { ...(cur.state || {}), __p: clean } });
  }, []);

  return [params, setParams];
}
