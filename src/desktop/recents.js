/** "Recent" list of the desktop: the last files / folders opened, per account (shown first in Spotlight). Stored locally, newest first. */
const KEY = (uid) => `uip_desktop_recents_v1_${uid ?? 'anon'}`;
export const RECENTS_MAX = 12;
export const RECENTS_EVENT = 'uip-recents-changed';

/** An entry: { id, name, type: 'file' | 'folder', how?: 'editor-folder', size_bytes?, ts }. */
export function loadRecents(uid) {
  try {
    const list = JSON.parse(localStorage.getItem(KEY(uid)) || '[]');
    if (!Array.isArray(list)) return [];
    return list.filter((r) => r && r.id != null && typeof r.name === 'string').slice(0, RECENTS_MAX);
  } catch { return []; }
}

function save(uid, list) {
  try { localStorage.setItem(KEY(uid), JSON.stringify(list)); } catch { /* storage blocked: the list just is not remembered */ }
  window.dispatchEvent(new Event(RECENTS_EVENT));
  return list;
}

/** Puts `entry` on top (an older entry for the same item is replaced, not duplicated). */
export function addRecent(uid, entry) {
  if (!entry || entry.id == null || !entry.name) return loadRecents(uid);
  const id = String(entry.id);
  const item = { id: entry.id, name: String(entry.name), type: entry.type === 'folder' ? 'folder' : 'file', ts: Date.now() };
  if (entry.how) item.how = entry.how;
  if (Number.isFinite(Number(entry.size_bytes))) item.size_bytes = Number(entry.size_bytes);
  const rest = loadRecents(uid).filter((r) => String(r.id) !== id);
  return save(uid, [item, ...rest].slice(0, RECENTS_MAX));
}

export function removeRecent(uid, id) {
  return save(uid, loadRecents(uid).filter((r) => String(r.id) !== String(id)));
}

export function clearRecents(uid) {
  return save(uid, []);
}
