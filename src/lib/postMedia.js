import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { attachmentUrl } from '../components/messaging/format';

/**
 * Post attachments live outside public/: every byte goes through the API (Bearer token) so visibility rules apply.
 *  - images / thumbnails / pdf.js  -> fetched as a Blob (fetchMediaBlob) and shown from an object URL (useMediaUrl)
 *  - <video> / <audio>             -> cannot send the token, so they play from a short-lived signed link (resolveSignedUrl)
 */
const BASE = '/api/v1/posts/media';
const PUBLIC_BASE = '/api/v1/public/posts/media';
/** Media of the public post page (/post/:id) arrive with urls under /api/v1/public/posts/media (no sign-in needed); everything else uses the signed-in endpoints. */
export const mediaBaseOf = (media) => (typeof media?.urls?.file === 'string' && media.urls.file.startsWith(PUBLIC_BASE) ? PUBLIC_BASE : BASE);

const CACHE = 'uip-post-media-v1';
const PERSIST = new Set(['thumbnail', 'preview']); // thumbnails / previews and small images survive reloads / offline (Cache Storage)
const PERSIST_MAX = 1.5 * 1024 * 1024;

export async function fetchMediaBlob(id, variant = 'file', base = BASE) {
  const keep = base === BASE && typeof caches !== 'undefined';
  const key = `/__uip-post-media/${id}/${variant}`;
  if (keep) {
    try { const hit = await (await caches.open(CACHE)).match(key); if (hit) return await hit.blob(); } catch { /* ignore */ }
  }
  const res = await api.blob(`${base}/${id}/${variant}`);
  const blob = await res.blob();
  if (keep && blob.size <= PERSIST_MAX && (PERSIST.has(variant) || (blob.type || '').startsWith('image/'))) {
    caches.open(CACHE).then((c) => c.put(key, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } }))).catch(() => {});
  }
  return blob;
}

/** Forget the persisted thumbnails (another account signed in on this browser). */
export function clearPersistedMedia() { try { caches?.delete(CACHE); } catch { /* ignore */ } }

const blobCache = new Map(); // `${id}/${variant}` -> Promise<string objectURL>
export function cachedBlobUrl(id, variant, base = BASE) {
  const key = `${base}/${id}/${variant}`;
  if (!blobCache.has(key)) {
    const p = fetchMediaBlob(id, variant, base).then((b) => URL.createObjectURL(b)).catch((e) => { blobCache.delete(key); throw e; });
    blobCache.set(key, p);
    if (blobCache.size > 150) blobCache.delete(blobCache.keys().next().value); // forget (not revoke): a card on screen may still hold it
  }
  return blobCache.get(key);
}

/** { url, error } for a media row's variant (thumbnail | preview | file). Nothing is requested while `enabled` is false. */
export function useMediaUrl(media, variant = 'file', { enabled = true } = {}) {
  const has = media && (variant === 'file' || media.urls?.[variant]);
  const [state, setState] = useState({ url: null, error: false });
  useEffect(() => {
    if (!has || !enabled) { setState({ url: null, error: false }); return undefined; }
    let dead = false;
    cachedBlobUrl(media.id, variant, mediaBaseOf(media))
      .then((url) => { if (!dead) setState({ url, error: false }); })
      .catch(() => { if (!dead) setState({ url: null, error: true }); });
    return () => { dead = true; };
  }, [media?.id, variant, has, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

const links = new Map(); // `${id}/${variant}` -> { url, at } | Promise
const LINK_TTL = 8 * 60 * 1000;
export async function resolveSignedUrl(id, variant = 'file', base = BASE) {
  const key = `${base}/${id}/${variant}`;
  const cur = links.get(key);
  if (cur && !(cur instanceof Promise) && Date.now() - cur.at < LINK_TTL) return cur.url;
  if (cur instanceof Promise) return cur;
  const p = api.get(`${base}/${id}/link`, { variant })
    .then((r) => { const u = attachmentUrl(r.data.url); links.set(key, { url: u, at: Date.now() }); return u; })
    .catch((e) => { links.delete(key); throw e; });
  links.set(key, p);
  return p;
}

export function useSignedUrl(media, variant = 'file', enabled = true) {
  const [state, setState] = useState({ url: null, error: false });
  useEffect(() => {
    if (!media || !enabled) return undefined;
    let dead = false;
    resolveSignedUrl(media.id, variant, mediaBaseOf(media))
      .then((url) => { if (!dead) setState({ url, error: false }); })
      .catch(() => { if (!dead) setState({ url: null, error: true }); });
    return () => { dead = true; };
  }, [media?.id, variant, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

export function fmtDuration(s) {
  const n = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(n / 3600); const m = Math.floor((n % 3600) / 60); const sec = n % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function compact(n) {
  const v = Number(n) || 0;
  return v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(v);
}
