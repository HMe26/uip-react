import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadServerState, mergedFlag, saveServerSection } from './libraryState';

/**
 * My Library preferences: hidden items, what the page shows (all My PC / added here only), grid or list, and smart folders.
 * Kept in this browser for an instant start and synced to the server (GET/PUT /drive/library-state) so they follow the account.
 */
const key = (uid) => `uip_library_prefs_v2_${uid ?? 'anon'}`;
const PERIODS = ['any', 'today', '7d', '30d', 'month', 'year'];
export const MAX_SMART = 30;
const EMPTY = { hidden: [], source: 'all', view: 'grid', smart: [] };

export function cleanRules(r) {
  const o = r && typeof r === 'object' ? r : {};
  const mb = (x) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) || Number(x) < 0 ? null : Math.min(1048576, Number(x)));
  return {
    kinds: Array.isArray(o.kinds) ? [...new Set(o.kinds.filter((k) => typeof k === 'string'))] : [],
    period: PERIODS.includes(o.period) ? o.period : 'any',
    min_mb: mb(o.min_mb), max_mb: mb(o.max_mb),
    tag: typeof o.tag === 'string' ? o.tag.trim().slice(0, 24) : '',
    fav: !!o.fav,
    contains: typeof o.contains === 'string' ? o.contains.trim().slice(0, 60) : '',
  };
}

export function normalizePrefs(o) {
  if (!o || typeof o !== 'object') return EMPTY;
  const hidden = Array.isArray(o.hidden) ? [...new Set(o.hidden.map(Number).filter((x) => Number.isInteger(x) && x > 0))] : [];
  const smart = [];
  (Array.isArray(o.smart) ? o.smart : []).forEach((s) => {
    if (!s || typeof s.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(s.id) || typeof s.name !== 'string' || !s.name.trim() || smart.some((x) => x.id === s.id)) return;
    if (smart.length < MAX_SMART) smart.push({ id: s.id, name: s.name.trim().slice(0, 40), rules: cleanRules(s.rules) });
  });
  return { hidden, source: o.source === 'lib' ? 'lib' : 'all', view: o.view === 'list' ? 'list' : 'grid', smart };
}

function readLocal(uid) {
  try {
    const cur = JSON.parse(localStorage.getItem(key(uid)) || 'null');
    if (cur) return normalizePrefs(cur);
    // first run after the upgrade: bring over what the earlier version kept in separate keys
    const old = (k, fb) => { try { return JSON.parse(localStorage.getItem(`uip_library_${k}_v1_${uid ?? 'anon'}`) || 'null') ?? fb; } catch { return fb; } };
    return normalizePrefs({ hidden: old('hidden', []), source: old('source', 'all'), view: old('view', 'grid'), smart: [] });
  } catch { return EMPTY; }
}
const writeLocal = (uid, p) => { try { localStorage.setItem(key(uid), JSON.stringify(p)); } catch { /* blocked */ } };

function mergePrefs(local, server) {
  const ids = new Set(server.smart.map((s) => s.id));
  return { ...server, hidden: [...new Set([...server.hidden, ...local.hidden])], smart: [...server.smart, ...local.smart.filter((s) => !ids.has(s.id))].slice(0, MAX_SMART) };
}

export function useLibraryPrefs(uid) {
  const [p, setP] = useState(() => readLocal(uid));
  useEffect(() => { setP(readLocal(uid)); }, [uid]);

  const commit = useCallback((fn) => setP((prev) => { const n = normalizePrefs(fn(prev)); writeLocal(uid, n); saveServerSection(uid, 'library', n); return n; }), [uid]);

  useEffect(() => {
    if (uid == null) return undefined;
    let off = false;
    loadServerState(uid).then((s) => {
      if (off || !s) return;
      const local = readLocal(uid);
      const server = s.library ? normalizePrefs(s.library) : null;
      const next = !server ? local : mergedFlag.get(uid, 'library') ? server : mergePrefs(local, server);
      mergedFlag.set(uid, 'library');
      writeLocal(uid, next);
      setP(next);
      const has = next.hidden.length || next.smart.length || next.source !== 'all' || next.view !== 'grid';
      if (has && JSON.stringify(server) !== JSON.stringify(next)) saveServerSection(uid, 'library', next, 0);
    });
    return () => { off = true; };
  }, [uid]);

  const hidden = useMemo(() => new Set(p.hidden), [p.hidden]);
  return {
    hidden, source: p.source, view: p.view, smart: p.smart,
    setSource: (source) => commit((x) => ({ ...x, source })),
    setView: (view) => commit((x) => ({ ...x, view })),
    hide: (ids) => commit((x) => ({ ...x, hidden: [...x.hidden, ...ids] })),
    unhide: (ids) => commit((x) => ({ ...x, hidden: x.hidden.filter((i) => !ids.includes(i)) })),
    saveSmart: (item) => commit((x) => ({ ...x, smart: x.smart.some((s) => s.id === item.id) ? x.smart.map((s) => (s.id === item.id ? item : s)) : [...x.smart, item] })),
    removeSmart: (id) => commit((x) => ({ ...x, smart: x.smart.filter((s) => s.id !== id) })),
  };
}

export const newSmartId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Does one file satisfy a smart folder's rules? ctx = { isFav(id), tagsOf(id), now } */
export function matchSmart(rules, n, ctx) {
  const r = rules;
  if (r.kinds.length && !r.kinds.includes(n.kind)) return false;
  if (r.fav && !ctx.isFav(n.id)) return false;
  const mb = n.size_bytes / 1048576;
  if (r.min_mb !== null && mb < r.min_mb) return false;
  if (r.max_mb !== null && mb > r.max_mb) return false;
  if (r.tag && !ctx.tagsOf(n.id).some((t) => t.toLowerCase() === r.tag.toLowerCase())) return false;
  if (r.contains && !n.name.toLowerCase().includes(r.contains.toLowerCase())) return false;
  if (r.period !== 'any') {
    const t = Date.parse(n.updated_at);
    if (!Number.isFinite(t)) return false;
    const now = new Date(ctx.now);
    const start = r.period === 'today' ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      : r.period === '7d' ? ctx.now - 7 * 864e5
        : r.period === '30d' ? ctx.now - 30 * 864e5
          : r.period === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1).getTime()
            : new Date(now.getFullYear(), 0, 1).getTime();
    if (t < start) return false;
  }
  return true;
}

/** One-click starting points. */
export const SMART_PRESETS = [
  { en: 'Images this month', ar: 'صور هذا الشهر', rules: { kinds: ['image'], period: 'month' } },
  { en: 'Large files (50 MB+)', ar: 'ملفات كبيرة (+50 ميجا)', rules: { min_mb: 50 } },
  { en: 'Favorite videos', ar: 'فيديوهاتي المفضلة', rules: { kinds: ['video'], fav: true } },
  { en: 'Code this week', ar: 'أكواد آخر أسبوع', rules: { kinds: ['code'], period: '7d' } },
];
