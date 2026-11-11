/**
 * Offline-first cache for the posts pages (Facebook style): what you already loaded is shown instantly the next time you open the page —
 * even with no internet — and the server is only asked for what changed.
 *   memory Map  → synchronous, survives tab switches inside the SPA
 *   IndexedDB   → survives reloads / app restarts / being offline
 * Entries are per signed-in user; other users' entries are purged. Image thumbnails are kept in Cache Storage (see postMedia.js).
 */
const DB = 'uip-posts-cache';
const STORE = 'kv';
const MAX_ITEMS = 60;      // posts kept per feed key (6 pages of 10)
const MAX_KEYS = 24;       // feed keys kept (tabs / tags / searches)
export const FRESH_MS = 45 * 1000; // younger than this: do not even ask the server

const mem = new Map();
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => { rq.result.createObjectStore(STORE); };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => resolve(null);
      rq.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}

async function idb(mode, fn) {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

export const feedKey = (uid, parts) => `feed:${uid}:${parts.map((p) => p ?? '').join('|')}`;

/** Synchronous read of the in-memory copy (null on a miss). */
export const peekFeed = (key) => mem.get(key) || null;

/** Memory first, then IndexedDB. Resolves { items, page, more, at } or null. */
export async function readFeed(key) {
  if (mem.has(key)) return mem.get(key);
  const v = await idb('readonly', (s) => s.get(key));
  if (v && Array.isArray(v.items)) { mem.set(key, v); return v; }
  return null;
}

const timers = new Map();
/** Remember a feed state. `at` = when the server last confirmed it (drives FRESH_MS). Trims to MAX_ITEMS. */
export function writeFeed(key, { items, page, more, at }) {
  let list = items;
  let pg = page; let mr = more;
  if (list.length > MAX_ITEMS) { list = list.slice(0, MAX_ITEMS); pg = Math.ceil(MAX_ITEMS / 10); mr = true; }
  const entry = { items: list, page: pg, more: mr, at: at || Date.now() };
  mem.set(key, entry);
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    idb('readwrite', (s) => { s.put(entry, key); return null; }).then(trim).catch(() => {});
  }, 400));
}

export function forgetFeed(key) {
  mem.delete(key);
  idb('readwrite', (s) => { s.delete(key); return null; });
}

async function trim() {
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const s = tx.objectStore(STORE);
    const rq = s.openCursor();
    const rows = [];
    rq.onsuccess = () => {
      const c = rq.result;
      if (c) { rows.push({ k: c.key, at: c.value?.at || 0 }); c.continue(); return; }
      rows.sort((a, b) => b.at - a.at).slice(MAX_KEYS).forEach((r) => { s.delete(r.k); mem.delete(r.k); });
    };
  } catch { /* best effort */ }
}

/** Drop every entry that does not belong to this user (another account used this browser before). */
export async function purgeOthers(uid) {
  const prefix = `feed:${uid}:`;
  for (const k of [...mem.keys()]) if (!k.startsWith(prefix)) mem.delete(k);
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const s = tx.objectStore(STORE);
    const rq = s.openCursor();
    rq.onsuccess = () => { const c = rq.result; if (c) { if (!String(c.key).startsWith(prefix)) s.delete(c.key); c.continue(); } };
  } catch { /* best effort */ }
}

/** Small JSON blobs with a time-to-live (trending tags, people suggestions, posts config) — cuts repeat requests. */
export function readSmall(key, ttlMs) {
  try {
    const raw = sessionStorage.getItem(`uip.pc.${key}`);
    if (!raw) return null;
    const { at, v } = JSON.parse(raw);
    return Date.now() - at < ttlMs ? v : null;
  } catch { return null; }
}
export function writeSmall(key, v) {
  try { sessionStorage.setItem(`uip.pc.${key}`, JSON.stringify({ at: Date.now(), v })); } catch { /* quota / private mode */ }
}
