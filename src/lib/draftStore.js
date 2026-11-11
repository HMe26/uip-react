/**
 * Local drafts in IndexedDB: unsaved editor work survives a refresh, a crash, a closed tab or a lost connection.
 * A draft is one record per key: { key, at, kind: 'blob' | 'json', blob?, ...meta }. Records older than 14 days are dropped.
 * Every function resolves (never throws) so a browser without IndexedDB (private mode) just behaves as "no drafts".
 */
const DB = 'uip-drafts';
const STORE = 'drafts';
const MAX_AGE = 14 * 24 * 3600 * 1000;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE, { keyPath: 'key' }); };
      rq.onsuccess = () => { const d = rq.result; d.onversionchange = () => { try { d.close(); } catch { /* ignore */ } dbp = null; }; resolve(d); }; // lets "erase my data" delete the database
      rq.onerror = () => resolve(null);
      rq.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}

const tx = async (mode, fn) => {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const res = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(res && 'result' in res ? res.result : true);
      t.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
};

// keys whose draft was discarded / saved: late writes from an unmounting editor must not resurrect them
const blocked = new Set();
export const allowDraft = (key) => { blocked.delete(key); };
export const putDraft = async (key, data) => (blocked.has(key) ? false : !!(await tx('readwrite', (s) => s.put({ ...data, key, at: Date.now() }))));
export const getDraft = async (key) => {
  const r = await tx('readonly', (s) => s.get(key));
  if (!r || typeof r !== 'object') return null;
  if (Date.now() - (r.at || 0) > MAX_AGE) { delDraft(key); return null; }
  return r;
};
export const delDraft = async (key) => { await tx('readwrite', (s) => s.delete(key)); };
/** delete + refuse later writes until allowDraft(key) (an editor mounting again calls it) */
export const discardDraft = async (key) => { if (!key) return; blocked.add(key); await delDraft(key); };
/** Drop every draft of an account (used on sign-out). */
export const clearDrafts = async (prefix) => {
  const db = await open();
  if (!db) return;
  await new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, 'readwrite');
      const rq = t.objectStore(STORE).openCursor();
      rq.onsuccess = () => { const c = rq.result; if (c) { if (!prefix || String(c.key).startsWith(prefix)) c.delete(); c.continue(); } };
      t.oncomplete = resolve; t.onerror = resolve; t.onabort = resolve;
    } catch { resolve(); }
  });
};

const CACHE_KEEP = 25;
const CACHE_BYTES = 300 * 1024 * 1024;
/** keep the newest cached files (kind 'cache') within a count / size budget; drafts are never touched */
export async function pruneCache() {
  const db = await open();
  if (!db) return;
  await new Promise((resolve) => {
    try {
      const rows = [];
      const t = db.transaction(STORE, 'readwrite');
      const st = t.objectStore(STORE);
      const rq = st.openCursor();
      rq.onsuccess = () => {
        const c = rq.result;
        if (c) { if (c.value?.kind === 'cache') rows.push({ key: c.key, at: c.value.at || 0, size: c.value.blob?.size || 0 }); c.continue(); return; }
        rows.sort((a, b) => b.at - a.at);
        let bytes = 0;
        rows.forEach((r, i) => { bytes += r.size; if (i >= CACHE_KEEP || bytes > CACHE_BYTES) st.delete(r.key); });
      };
      t.oncomplete = resolve; t.onerror = resolve; t.onabort = resolve;
    } catch { resolve(); }
  });
}
/** forget every cached file (sign-out on a shared computer) — unsaved-edit drafts stay */
export async function clearCache() {
  const db = await open();
  if (!db) return;
  await new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, 'readwrite');
      const rq = t.objectStore(STORE).openCursor();
      rq.onsuccess = () => { const c = rq.result; if (c) { if (c.value?.kind === 'cache') c.delete(); c.continue(); } };
      t.oncomplete = resolve; t.onerror = resolve; t.onabort = resolve;
    } catch { resolve(); }
  });
}

export function agoText(at, ar) {
  const s = Math.max(1, Math.round((Date.now() - at) / 1000));
  if (s < 60) return ar ? 'من لحظات' : 'moments ago';
  const m = Math.round(s / 60);
  if (m < 60) return ar ? `من ${m} دقيقة` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return ar ? `من ${h} ساعة` : `${h} h ago`;
  const d = Math.round(h / 24);
  return ar ? `من ${d} يوم` : `${d} d ago`;
}
