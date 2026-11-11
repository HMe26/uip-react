import { useEffect, useState } from 'react';
import { drive } from './driveApi';

const EMPTY = { items: [], pending: 0, loading: false, q: '' };

/**
 * Search INSIDE My PC text files (code, notes, CSV…) — GET /drive/search-content. Debounced; needs 2+ characters.
 * The server indexes files lazily while it answers, so while `pending > 0` (files still being indexed) the request repeats
 * every ~1.2 s (up to 8 times) and the list fills in.
 */
export function useContentSearch(query, enabled = true) {
  const [st, setSt] = useState(EMPTY);
  useEffect(() => {
    const q = String(query || '').trim();
    if (!enabled || q.length < 2) { setSt((s) => (s === EMPTY ? s : EMPTY)); return undefined; }
    let dead = false; let timer = null; let tries = 0;
    const run = async () => {
      setSt((s) => ({ ...s, loading: true, q }));
      try {
        const r = await drive.searchContent(q);
        const d = (r && r.data !== undefined ? r.data : r) || {};
        if (dead) return;
        setSt({ items: d.items || [], pending: d.pending || 0, loading: false, q });
        if ((d.pending || 0) > 0 && tries < 8) { tries += 1; timer = setTimeout(run, 1200); }
      } catch { if (!dead) setSt({ ...EMPTY, q }); }
    };
    timer = setTimeout(run, 450);
    return () => { dead = true; clearTimeout(timer); };
  }, [query, enabled]);
  return st;
}
