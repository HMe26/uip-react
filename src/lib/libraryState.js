import { drive } from './driveApi';

/**
 * Server-side copy of the person's My Library preferences (favorites, tags, hidden items, smart folders…).
 * The browser keeps a local copy too, so the page opens instantly and still works offline; the server copy is what
 * follows the person to another device. Rules:
 *  - one fetch per account per page load, shared by every component that asks;
 *  - nothing is sent to the server until that first fetch succeeded (an offline device can never overwrite newer data);
 *  - saves are debounced per section, and a failed save is silent (the local copy still has the change).
 */
const loaded = new Map(); // uid -> Promise<{ marks, library } | null>
const reachable = new Set();
const timers = new Map();

export function loadServerState(uid) {
  const k = String(uid ?? 'anon');
  if (!loaded.has(k)) {
    loaded.set(k, drive.libraryState()
      .then((r) => { reachable.add(k); return { marks: r?.marks ?? null, library: r?.library ?? null }; })
      .catch(() => { loaded.delete(k); return null; }));
  }
  return loaded.get(k);
}

/** Debounced PUT of one section ('marks' | 'library'); a no-op until the first fetch worked. */
export function saveServerSection(uid, section, value, delay = 700) {
  const k = String(uid ?? 'anon');
  if (!reachable.has(k)) return;
  const tk = `${k}:${section}`;
  clearTimeout(timers.get(tk));
  timers.set(tk, setTimeout(() => { timers.delete(tk); drive.saveLibraryState({ [section]: value }).catch(() => {}); }, delay));
}

/** "Has this browser been merged with the server copy yet?" — the first time we union both so nothing local is lost. */
export const mergedFlag = {
  get: (uid, section) => { try { return localStorage.getItem(`uip_library_merged_${section}_${uid ?? 'anon'}`) === '1'; } catch { return false; } },
  set: (uid, section) => { try { localStorage.setItem(`uip_library_merged_${section}_${uid ?? 'anon'}`, '1'); } catch { /* ignore */ } },
};
