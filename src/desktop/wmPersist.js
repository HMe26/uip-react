import { initialWm } from './wm';

/**
 * "Continue where you left off": the window layout of the desktop (which files / editors / folders are open, where, how big)
 * is kept in the browser and rebuilt after a refresh, a crash or a closed tab. Only plain data is stored; each window
 * rebuilds its own content, and the editors restore their unsaved edits from local drafts (lib/draftStore).
 * sessionStorage (this tab) is read first, localStorage (an earlier tab) is the fallback for up to a day.
 */
const KEY = (uid) => `uip.os.wm.${uid ?? 'anon'}`;
const MAX_AGE = 24 * 3600 * 1000;
const KEEP = ['id', 'app', 'key', 'title', 'x', 'y', 'w', 'h', 'max', 'snap', 'min', 'z', 'props', 'since', 'd'];

export function saveWm(uid, wm) {
  try {
    const list = wm.list.map((w) => Object.fromEntries(KEEP.map((k) => [k, w[k]])));
    const json = JSON.stringify({ v: 1, at: Date.now(), z: wm.z, seq: wm.seq, active: wm.active, desk: wm.desk || 0, desks: wm.desks || 1, list });
    try { sessionStorage.setItem(KEY(uid), json); } catch { /* private mode / full */ }
    localStorage.setItem(KEY(uid), json);
  } catch { /* storage unavailable or full: the desktop just starts empty next time */ }
}

export function restoreWm(uid, knownApps) {
  let raw = null;
  try { raw = sessionStorage.getItem(KEY(uid)); } catch { /* ignore */ }
  if (!raw) { try { raw = localStorage.getItem(KEY(uid)); } catch { /* ignore */ } }
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (!d || d.v !== 1 || !Array.isArray(d.list) || Date.now() - (d.at || 0) > MAX_AGE) return null;
    // windows whose app no longer exists are dropped; a viewer needs its files, an editor its node
    const list = d.list.filter((w) => w && knownApps[w.app] && typeof w.id === 'string'
      && (w.app !== 'viewer' || (Array.isArray(w.props?.files) && w.props.files.length))
      && (w.app !== 'editor' || w.props?.editor?.node));
    if (!list.length) return null;
    const maxId = Math.max(...list.map((w) => Number(String(w.id).slice(1)) || 0));
    const desks = Math.min(6, Math.max(1, Number(d.desks) || 1, ...list.map((w) => (w.d || 0) + 1)));
    const desk = Math.min(desks - 1, Math.max(0, Number(d.desk) || 0));
    return {
      ...initialWm, desks, desk, list, z: Math.max(d.z || 10, ...list.map((w) => w.z || 0)),
      seq: Math.max(d.seq || 1, maxId + 1),
      active: list.some((w) => w.id === d.active) ? d.active : null,
    };
  } catch { return null; }
}

export function clearWm(uid) {
  try { sessionStorage.removeItem(KEY(uid)); } catch { /* ignore */ }
  try { localStorage.removeItem(KEY(uid)); } catch { /* ignore */ }
}
