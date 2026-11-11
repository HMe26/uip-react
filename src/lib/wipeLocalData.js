import { nativeClearMediaCache } from '../native';
import { ACCESS_KEY, REFRESH_KEY, USER_KEY, IDLE_KEY, ACTIVITY_KEY, USER_IDLE_KEY } from '../api/client';

/**
 * "Sign out and erase my data from this device" — for shared computers.
 * Removes everything this site stored in THIS browser: localStorage / sessionStorage (desktop layout, settings, recent files,
 * notifications, widgets, cached identity…), every IndexedDB database (unsaved editor drafts, cached file copies), the Cache Storage
 * and the Android app's media cache. The account itself and its files on the server are not touched.
 * Only the interface language survives (the next person still needs a readable sign-in page).
 * Browser-managed data (the browser's own saved-password list / autofill) can't be reached from a web page.
 */
const KEEP = ['uip_locale', 'uip_staff_session'];
/** "Reset my PC" keeps the person signed in: these hold the session. */
const SESSION = [ACCESS_KEY, REFRESH_KEY, USER_KEY, IDLE_KEY, ACTIVITY_KEY, USER_IDLE_KEY];

export function wipeStorageSync(extraKeep = []) {
  const keep = {};
  try { [...KEEP, ...extraKeep].forEach((k) => { const v = localStorage.getItem(k); if (v !== null) keep[k] = v; }); } catch { /* blocked */ }
  try { localStorage.clear(); } catch { /* blocked */ }
  try { sessionStorage.clear(); } catch { /* blocked */ }
  try { Object.entries(keep).forEach(([k, v]) => localStorage.setItem(k, v)); } catch { /* blocked */ }
}

async function wipeAsync() {
  const jobs = [];
  try {
    if (typeof indexedDB !== 'undefined') {
      const list = typeof indexedDB.databases === 'function' ? await indexedDB.databases().catch(() => []) : [];
      const names = new Set([...(list || []).map((d) => d && d.name).filter(Boolean), 'uip-drafts', 'uip-thumbs']);
      names.forEach((name) => jobs.push(new Promise((res) => {
        try { const rq = indexedDB.deleteDatabase(name); rq.onsuccess = rq.onerror = rq.onblocked = () => res(); } catch { res(); }
      })));
    }
  } catch { /* ignore */ }
  try { if (typeof caches !== 'undefined') jobs.push(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).catch(() => {})); } catch { /* ignore */ }
  try { jobs.push(nativeClearMediaCache()); } catch { /* ignore */ }
  // a database that is still open elsewhere answers "blocked" — never wait on it for more than a moment
  await Promise.race([Promise.allSettled(jobs), new Promise((res) => setTimeout(res, 1500))]);
}

export async function wipeLocalData({ keepSession = false } = {}) {
  const extra = keepSession ? SESSION : [];
  const wipe = () => wipeStorageSync(extra);
  wipe();
  // things that write on their way out (desktop sync flush, window layout…) must not bring data back
  try { window.addEventListener('pagehide', wipe); } catch { /* ignore */ }
  await wipeAsync();
  wipe();
}
