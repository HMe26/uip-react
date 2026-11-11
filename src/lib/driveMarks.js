import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadServerState, mergedFlag, saveServerSection } from './libraryState';

/**
 * "My PC" favorites, tags and "Shared with me" — kept in this browser, per account (nothing is written to the files themselves).
 *  - favorites: ids of items you starred
 *  - tags: { [itemId]: ['Math', 'Exam'] } — at most MAX_TAGS_PER_ITEM per item, each up to MAX_TAG_LEN characters
 *  - shared: links other students sent you (the public /s/:token links); the server checks every link, so a revoked / expired one just shows as unavailable
 */
export const MAX_TAGS_PER_ITEM = 6;
export const MAX_TAG_LEN = 24;
const MAX_SHARED = 100;
const key = (uid) => `uip_drive_marks_v1_${uid ?? 'anon'}`;
const EMPTY = { fav: [], tags: {}, shared: [] };

const PALETTE = ['#0a84ff', '#bf5af2', '#ff375f', '#ff9f0a', '#30d158', '#64d2ff', '#ff453a', '#8e8e93'];
export const tagColor = (name) => { let h = 0; for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };

/** A pasted share link (".../s/TOKEN", with or without query / hash) or the bare token → the token, or null. */
export function tokenFromLink(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const m = /\/s\/([A-Za-z0-9]{8,64})(?:[/?#]|$)/.exec(s);
  if (m) return m[1];
  return /^[A-Za-z0-9]{8,64}$/.test(s) ? s : null;
}

/** Any parsed object (local storage or the server) -> a clean { fav, tags, shared }. */
function normalize(o) {
  if (!o || typeof o !== 'object') return EMPTY;
  const fav = Array.isArray(o.fav) ? [...new Set(o.fav.map(Number).filter((x) => Number.isInteger(x) && x > 0))] : [];
  const tags = {};
  if (o.tags && typeof o.tags === 'object' && !Array.isArray(o.tags)) {
    Object.keys(o.tags).forEach((id) => {
      const l = Array.isArray(o.tags[id]) ? [...new Set(o.tags[id].filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().slice(0, MAX_TAG_LEN)))].slice(0, MAX_TAGS_PER_ITEM) : [];
      if (l.length && Number.isInteger(Number(id))) tags[id] = l;
    });
  }
  const shared = Array.isArray(o.shared) ? o.shared.filter((x) => x && typeof x.token === 'string' && /^[A-Za-z0-9]{8,64}$/.test(x.token)).slice(0, MAX_SHARED) : [];
  return { fav, tags, shared };
}

function load(uid) {
  try { return normalize(JSON.parse(localStorage.getItem(key(uid)) || 'null')); } catch { return EMPTY; }
}
const store = (uid, n) => { try { localStorage.setItem(key(uid), JSON.stringify(n)); } catch { /* storage full or blocked: the marks stay for this session */ } };

/** Union of two sets of marks (first sync of a device that already had its own). */
function mergeMarks(a, b) {
  const tags = { ...b.tags };
  Object.keys(a.tags).forEach((id) => { tags[id] = [...new Set([...(tags[id] || []), ...a.tags[id]])].slice(0, MAX_TAGS_PER_ITEM); });
  const seen = new Set(b.shared.map((x) => x.token));
  return { fav: [...new Set([...b.fav, ...a.fav])], tags, shared: [...b.shared, ...a.shared.filter((x) => !seen.has(x.token))].slice(0, MAX_SHARED) };
}

export function useDriveMarks(uid) {
  const [m, setM] = useState(() => load(uid));
  useEffect(() => { setM(load(uid)); }, [uid]);
  const commit = useCallback((fn) => setM((p) => { const n = fn(p); store(uid, n); saveServerSection(uid, 'marks', n); return n; }), [uid]);

  // follow the account across devices: the server copy wins once this browser has been merged with it
  useEffect(() => {
    if (uid == null) return undefined;
    let off = false;
    loadServerState(uid).then((s) => {
      if (off || !s) return;
      const local = load(uid);
      const server = s.marks ? normalize(s.marks) : null;
      let next = local;
      if (server) next = mergedFlag.get(uid, 'marks') ? server : mergeMarks(local, server);
      mergedFlag.set(uid, 'marks');
      store(uid, next);
      setM(next);
      const same = server && JSON.stringify(server) === JSON.stringify(next);
      if (!same && (next.fav.length || next.shared.length || Object.keys(next.tags).length)) saveServerSection(uid, 'marks', next, 0);
    });
    return () => { off = true; };
  }, [uid]);

  const favSet = useMemo(() => new Set(m.fav), [m.fav]);
  const allTags = useMemo(() => {
    const c = new Map();
    Object.values(m.tags).forEach((l) => l.forEach((t) => c.set(t, (c.get(t) || 0) + 1)));
    return [...c.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  }, [m.tags]);

  return {
    favs: m.fav, tagsMap: m.tags, shared: m.shared, allTags,
    isFav: (id) => favSet.has(id),
    setFav: (ids, on) => commit((p) => ({ ...p, fav: on ? [...new Set([...p.fav, ...ids])] : p.fav.filter((x) => !ids.includes(x)) })),
    tagsOf: (id) => m.tags[id] || [],
    idsWithTag: (tag) => Object.keys(m.tags).filter((id) => m.tags[id].includes(tag)).map(Number),
    setTags: (id, list) => commit((p) => {
      const clean = [...new Set(list.map((t) => String(t).trim().slice(0, MAX_TAG_LEN)).filter(Boolean))].slice(0, MAX_TAGS_PER_ITEM);
      const tags = { ...p.tags };
      if (clean.length) tags[id] = clean; else delete tags[id];
      return { ...p, tags };
    }),
    /** items deleted for good: drop their marks */
    forget: (ids) => commit((p) => {
      const tags = { ...p.tags }; ids.forEach((id) => { delete tags[id]; });
      return { ...p, fav: p.fav.filter((x) => !ids.includes(x)), tags };
    }),
    addShared: (entry) => commit((p) => (p.shared.some((x) => x.token === entry.token) ? p : { ...p, shared: [{ ...entry, added: Date.now() }, ...p.shared].slice(0, MAX_SHARED) })),
    removeShared: (token) => commit((p) => ({ ...p, shared: p.shared.filter((x) => x.token !== token) })),
  };
}
