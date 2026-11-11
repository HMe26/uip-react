import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { attachmentUrl } from '../components/messaging/format';
import { absolutizeForNative } from '../native';
import { setWallStyle } from './wallStyle';

/**
 * Personal chat backgrounds (the person's own photos) — shared by the people-to-people messenger and the AI assistant.
 *
 * Photos are shrunk to at most 1920 px / JPEG on the way in and saved WITH THE ACCOUNT (GET/POST/DELETE
 * /api/v1/account/chat-wallpapers), so they follow the person to every device. They stay in the library until the person deletes
 * them: choosing a built-in theme later does NOT remove them. The selected background is stored by the callers as `img:<id>`.
 *
 * Fallback: if the server can't be reached (offline, old backend) the library lives in this browser's IndexedDB instead, exactly as
 * before. Photos that were saved only locally by the previous version are uploaded to the account once, keeping their ids, so
 * the saved selection `img:<id>` keeps working. If a saved `img:<id>` does not exist anywhere, callers fall back to their default.
 */
const DB = 'uip_custom_wallpapers';
const STORE = 'images';
export const MAX_CUSTOM_WALLPAPERS = 12;
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_SIDE = 1920;

export const isCustomWall = (v) => typeof v === 'string' && v.startsWith('img:');
export const customWallId = (v) => (isCustomWall(v) ? v.slice(4) : null);

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const run = (mode, fn) => open().then((db) => new Promise((resolve, reject) => {
  const tx = db.transaction(STORE, mode);
  const out = fn(tx.objectStore(STORE));
  tx.oncomplete = () => { db.close(); resolve(out && 'result' in out ? out.result : undefined); };
  tx.onerror = () => { db.close(); reject(tx.error); };
  tx.onabort = () => { db.close(); reject(tx.error); };
}));

async function listAll() {
  const rows = await run('readonly', (s) => s.getAll());
  return (rows || []).sort((a, b) => a.createdAt - b.createdAt);
}

/** Decode, shrink to MAX_SIDE and re-encode as JPEG (a 12 MP phone photo becomes a few hundred KB). */
async function shrink(file) {
  if (!file.type.startsWith('image/')) throw new Error('not_image');
  if (file.size > MAX_INPUT_BYTES) throw new Error('too_big');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('decode')); i.src = url; });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) throw new Error('encode');
    return blob;
  } finally { URL.revokeObjectURL(url); }
}

const API_PATH = '/api/v1/account/chat-wallpapers';
// stored paths are relative ("uploads/chat-wallpapers/…"): a CSS url() would resolve them against the current page, so anchor them at the root
// (the leading "/" must be added BEFORE attachmentUrl, which just glues VITE_UPLOADS_BASE + path → otherwise "…railway.appuploads/…")
const fullUrl = (path) => {
  if (!path) return '';
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  // in the Android app the page origin is https://localhost: point the photo at the API server instead
  return absolutizeForNative(attachmentUrl('/' + String(path).replace(/^\/+/, ''))) || '';
};
const serverItems = (json) => ((json && json.data && json.data.wallpapers) || []).map((w) => ({ id: w.id, url: fullUrl(w.url) }));

/**
 * const wp = useCustomWallpapers();
 * wp.items            [{ id, url }]   the library (object URLs, revoked automatically)
 * wp.urlFor('img:ab') -> url | null    for the currently selected background
 * wp.add(file, style?) -> id            throws Error('not_image' | 'too_big' | 'limit' | 'storage')
 * wp.remove(id)
 * wp.ready            false until the library was read once (so a saved selection isn't judged "missing" too early)
 */
export function useCustomWallpapers() {
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);
  const urls = useRef(new Map()); // blob URLs of the LOCAL fallback library (revoked automatically)
  const serverOk = useRef(false);

  const applyLocal = useCallback((rows) => {
    const next = new Map();
    const list = rows.map((r) => {
      const url = urls.current.get(r.id) || URL.createObjectURL(r.blob);
      next.set(r.id, url);
      return { id: r.id, url };
    });
    urls.current.forEach((u, id) => { if (!next.has(id)) URL.revokeObjectURL(u); });
    urls.current = next;
    setItems(list);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let json = await api.get(API_PATH);
        serverOk.current = true;
        // one-time move of photos the previous version kept only in this browser: same ids, so the saved selection still matches
        const local = await listAll().catch(() => []);
        if (local.length) {
          const onServer = new Set(serverItems(json).map((w) => w.id));
          for (const r of local) {
            if (!alive) return;
            try {
              if (!onServer.has(r.id)) {
                const fd = new FormData();
                fd.append('uid', r.id);
                fd.append('image', r.blob, 'wallpaper.jpg');
                await api.postForm(API_PATH, fd);
              }
              await run('readwrite', (st) => st.delete(r.id));
            } catch { /* leave it local; it is tried again next time */ }
          }
          json = await api.get(API_PATH);
        }
        if (alive) setItems(serverItems(json));
      } catch {
        serverOk.current = false;
        const rows = await listAll().catch(() => []);
        if (alive) applyLocal(rows);
      } finally { if (alive) setReady(true); }
    })();
    return () => { alive = false; };
  }, [applyLocal]);

  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); urls.current = new Map(); }, []);

  const add = useCallback(async (file, style) => {
    const blob = await shrink(file);
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    if (style) setWallStyle(id, style); // how the photo is laid out (fill / whole / width + position), chosen in the preview
    if (serverOk.current) {
      try {
        const fd = new FormData();
        fd.append('uid', id);
        fd.append('image', blob, 'wallpaper.jpg');
        await api.postForm(API_PATH, fd);
        setItems(serverItems(await api.get(API_PATH)));
        return id;
      } catch (err) {
        const msg = String((err && err.message) || '');
        throw new Error(/limit/i.test(msg) ? 'limit' : 'storage');
      }
    }
    const rows = await listAll().catch(() => []);
    if (rows.length >= MAX_CUSTOM_WALLPAPERS) throw new Error('limit');
    try { await run('readwrite', (st) => st.put({ id, blob, createdAt: Date.now() })); } catch { throw new Error('storage'); }
    applyLocal(await listAll());
    return id;
  }, [applyLocal]);

  const remove = useCallback(async (id) => {
    if (serverOk.current) {
      try { await api.del(`${API_PATH}/${encodeURIComponent(id)}`); } catch { /* keep the list as the server has it */ }
      try { setItems(serverItems(await api.get(API_PATH))); } catch { setItems((prev) => prev.filter((w) => w.id !== id)); }
      return;
    }
    try { await run('readwrite', (st) => st.delete(id)); } catch { /* nothing to delete */ }
    applyLocal(await listAll().catch(() => []));
  }, [applyLocal]);

  const urlFor = useCallback((value) => {
    const id = customWallId(value);
    return id ? (items.find((i) => i.id === id)?.url || null) : null;
  }, [items]);

  return { items, ready, add, remove, urlFor };
}
