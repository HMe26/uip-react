import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

/**
 * Sticky notes + widgets on the desktop (clock, calendar, to-do list). Kept in the browser (instant, offline) and on the
 * server (GET/PUT /api/v1/desktop/widgets → table `desktop_widgets`) so they follow the student to every device.
 * Newest `updatedAt` wins; a device pushes ~1.2 s after a change and pulls on focus / every 45 s while it has no unsent edits.
 */
const keyOf = (uid) => `uip_desktop_widgets_v1_${uid ?? 'anon'}`;
const TYPES = new Set(['note', 'clock', 'calendar', 'todo']);
const unwrap = (r) => (r && r.data !== undefined ? r.data : r);

function readLocal(uid) {
  try {
    const o = JSON.parse(localStorage.getItem(keyOf(uid)) || 'null');
    if (o && Array.isArray(o.items)) return { at: Number(o.at) || 0, items: o.items.filter((i) => i && typeof i.id === 'string' && TYPES.has(i.type)) };
  } catch { /* private mode / corrupt */ }
  return { at: 0, items: [] };
}
function writeLocal(uid, at, items) { try { localStorage.setItem(keyOf(uid), JSON.stringify({ at, items })); } catch { /* full / private mode */ } }

export const WIDGET_DEFAULTS = {
  note: { w: 220, h: 200, color: 'yellow' },
  clock: { w: 220, h: 120 },
  calendar: { w: 260, h: 270 },
  todo: { w: 250, h: 260 },
};
export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function useDesktopWidgets(uid) {
  const init = useRef(null);
  if (init.current === null) init.current = readLocal(uid);
  const [items, setItems] = useState(init.current.items);
  const R = useRef({ uid, items: init.current.items, at: init.current.at, dirty: false, busy: false, timer: null, ready: false });
  R.current.uid = uid;

  const push = useCallback(async () => {
    const r = R.current;
    if (r.busy) { r.dirty = true; return; }
    r.busy = true;
    const sentAt = r.at;
    try {
      const res = unwrap(await api.put('/api/v1/desktop/widgets', { updatedAt: sentAt || Date.now(), items: r.items }));
      if (res?.stale) {
        r.at = Number(res.updatedAt) || 0; r.items = Array.isArray(res.items) ? res.items : []; r.dirty = false;
        writeLocal(r.uid, r.at, r.items); setItems(r.items);
      } else if (r.at === sentAt) r.dirty = false;
    } catch { r.dirty = true; } finally { r.busy = false; }
    if (r.dirty) { clearTimeout(r.timer); r.timer = setTimeout(push, 5000); }
  }, []);

  const pull = useCallback(async (first) => {
    const r = R.current;
    if (r.dirty || r.busy) return;
    try {
      const rem = unwrap(await api.get('/api/v1/desktop/widgets'));
      if (R.current.dirty) return;
      if (rem?.exists && Number(rem.updatedAt) > r.at) {
        r.at = Number(rem.updatedAt); r.items = Array.isArray(rem.items) ? rem.items : [];
        writeLocal(r.uid, r.at, r.items); setItems(r.items);
      } else if (first && r.items.length && (!rem?.exists || r.at > Number(rem.updatedAt || 0))) {
        r.at = r.at || Date.now(); r.dirty = true; push();
      }
      r.ready = true;
    } catch { /* offline / not ready — retried below */ }
  }, [push]);

  useEffect(() => {
    if (uid == null) return undefined;
    pull(true);
    const retry = setInterval(() => { if (!R.current.ready) pull(true); }, 5000);
    const tick = setInterval(() => { if (document.visibilityState === 'visible') pull(false); }, 45000);
    let lastBack = 0; // focus + visibilitychange both fire when the tab returns: pull once, and not more than every 20 s
    const back = () => { if (document.visibilityState === 'visible') { if (Date.now() - lastBack < 20000) return; lastBack = Date.now(); pull(false); } else if (R.current.dirty) { clearTimeout(R.current.timer); push(); } };
    const flush = () => { if (R.current.dirty) { clearTimeout(R.current.timer); push(); } };
    document.addEventListener('visibilitychange', back); window.addEventListener('focus', back); window.addEventListener('pagehide', flush);
    return () => { clearInterval(retry); clearInterval(tick); clearTimeout(R.current.timer); document.removeEventListener('visibilitychange', back); window.removeEventListener('focus', back); window.removeEventListener('pagehide', flush); };
  }, [uid, pull, push]);

  /** fn(currentItems) -> nextItems (same array back = no change). */
  const commit = useCallback((fn) => {
    const r = R.current;
    const next = fn(r.items);
    if (next === r.items) return;
    r.items = next; r.at = Date.now(); r.dirty = true;
    writeLocal(r.uid, r.at, next); setItems(next);
    clearTimeout(r.timer); r.timer = setTimeout(push, 1200);
  }, [push]);

  const topZ = () => R.current.items.reduce((m, i) => Math.max(m, i.z || 0), 0);
  const add = useCallback((type, at) => {
    const id = newId();
    commit((list) => {
      const z = list.reduce((m, i) => Math.max(m, i.z || 0), 0) + 1;
      return [...list, { id, type, x: Math.max(0, Math.round(at?.x ?? 60)), y: Math.max(0, Math.round(at?.y ?? 60)), z, ...WIDGET_DEFAULTS[type], ...(type === 'note' ? { text: '' } : null), ...(type === 'todo' ? { title: '', todos: [] } : null) }];
    });
    return id;
  }, [commit]);
  const update = useCallback((id, patch) => commit((list) => {
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return list;
    const next = list.slice(); next[i] = { ...list[i], ...patch };
    return next;
  }), [commit]);
  const remove = useCallback((id) => commit((list) => (list.some((x) => x.id === id) ? list.filter((x) => x.id !== id) : list)), [commit]);
  const front = useCallback((id) => commit((list) => {
    const it = list.find((x) => x.id === id);
    if (!it || (it.z || 0) >= list.reduce((m, i) => Math.max(m, i.z || 0), 0)) return list; // already on top
    return list.map((x) => (x.id === id ? { ...x, z: topZ() + 1 } : x));
  }), [commit]); // eslint-disable-line react-hooks/exhaustive-deps

  return { items, add, update, remove, front };
}
