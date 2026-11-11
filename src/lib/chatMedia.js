/**
 * Private chat files.
 *
 * The server no longer exposes chat attachments under /uploads. Every attachment `url` / `thumbnail_url` is now an API path
 *   /api/v1/messaging/attachments/{id}/file  |  /thumbnail
 * that answers only to a signed-in member of the conversation (Bearer token) — anyone else gets 404.
 *
 * <img>, <audio> and the native downloaders cannot send the Authorization header, so:
 *  - images / voice notes / thumbnails are fetched THROUGH the API client (token + refresh-on-401) and shown from a blob: URL
 *    (fetchProtectedObjectUrl / useProtectedSrc);
 *  - <video> and the Android downloader get a short-lived signed link from /attachments/{id}/link (resolveMediaUrl /
 *    useSignedMediaUrl). It expires in minutes and membership is checked again when it is opened.
 *
 * Anything that is not a protected path (blob:, data:, http(s), legacy /uploads/…, a local pending upload) passes through as is.
 */
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { attachmentUrl } from '../components/messaging/format';

const PROTECTED = /^\/api\/v1\/messaging\/attachments\/(\d+)\/(file|thumbnail)$/;
const LINK_TTL_MS = 8 * 60 * 1000;   // server links live 10 min; refresh a little earlier
const MAX_OBJECT_URLS = 250;

// The personal sticker library (/messaging/stickers/{id}/file) is protected the same way (owner-only, Bearer token).
const PROTECTED_STICKER = /^\/api\/v1\/messaging\/stickers\/(\d+)\/file$/;
export const isProtectedAttachmentUrl = (u) => typeof u === 'string' && (PROTECTED.test(u.split('?')[0]) || PROTECTED_STICKER.test(u.split('?')[0]));

/** "/api/v1/messaging/attachments/12/file" -> { id: '12', variant: 'file' } */
export function parseProtectedUrl(u) {
  const m = typeof u === 'string' ? PROTECTED.exec(u.split('?')[0]) : null;
  return m ? { id: m[1], variant: m[2] } : null;
}

/** Non-protected URL -> something an <img>/<video> can load directly (adds VITE_UPLOADS_BASE for root-relative paths). */
function plainUrl(u) {
  if (!u) return u;
  return /^(blob:|data:|https?:)/.test(u) ? u : attachmentUrl(u);
}

/* ------------------------------------------------------------------ blob: URLs (token-authenticated fetch) */
const objectUrls = new Map(); // path -> Promise<string>

/** Fetches a protected file with the Bearer token and returns a blob: URL (cached; the same file is never fetched twice). */
export function fetchProtectedObjectUrl(path) {
  const key = String(path).split('?')[0];
  const hit = objectUrls.get(key);
  if (hit) return hit;
  const p = api.blob(key)
    .then((res) => res.blob())
    .then((blob) => URL.createObjectURL(blob))
    .catch((err) => { objectUrls.delete(key); throw err; });
  objectUrls.set(key, p);
  if (objectUrls.size > MAX_OBJECT_URLS) {
    // drop the oldest entries; revoke only after a grace period so a bubble that still shows one does not go blank
    const oldest = objectUrls.keys().next().value;
    const old = objectUrls.get(oldest);
    objectUrls.delete(oldest);
    old.then((u) => setTimeout(() => URL.revokeObjectURL(u), 60000)).catch(() => {});
  }
  return p;
}

/** Blob of a protected (or plain) file, for the file viewer. */
export async function loadAttachmentBlob(url) {
  if (isProtectedAttachmentUrl(url)) return (await api.blob(url.split('?')[0])).blob();
  const res = await fetch(plainUrl(url), { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.blob();
}

/** React: the displayable src for an attachment url. { src, loading, error } — src is null until a protected file has loaded. */
export function useProtectedSrc(url, { enabled = true } = {}) {
  const prot = isProtectedAttachmentUrl(url);
  const [state, setState] = useState({ src: prot ? null : (url ? plainUrl(url) : null), error: false });
  useEffect(() => {
    if (!url) { setState({ src: null, error: false }); return undefined; }
    if (!prot) { setState({ src: plainUrl(url), error: false }); return undefined; }
    if (!enabled) return undefined;
    let dead = false;
    setState((s) => (s.src ? { src: null, error: false } : s));
    fetchProtectedObjectUrl(url)
      .then((src) => { if (!dead) setState({ src, error: false }); })
      .catch(() => { if (!dead) setState({ src: null, error: true }); });
    return () => { dead = true; };
  }, [url, prot, enabled]);
  return { src: state.src, loading: prot && enabled && !state.src && !state.error, error: state.error };
}

/* ------------------------------------------------------------------ signed links (video, native downloaders) */
const links = new Map(); // path -> { url, at } | Promise

/** A short-lived URL that works WITHOUT the Authorization header. Plain URLs are returned unchanged. */
export async function resolveMediaUrl(url) {
  const info = parseProtectedUrl(url);
  if (!info) return plainUrl(url);
  const key = `${info.id}/${info.variant}`;
  const cur = links.get(key);
  if (cur && !(cur instanceof Promise) && Date.now() - cur.at < LINK_TTL_MS) return cur.url;
  if (cur instanceof Promise) return cur;
  const p = api.get(`/api/v1/messaging/attachments/${info.id}/link`, { variant: info.variant })
    .then((res) => {
      const u = attachmentUrl(res.data.url);
      links.set(key, { url: u, at: Date.now() });
      return u;
    })
    .catch((err) => { links.delete(key); throw err; });
  links.set(key, p);
  return p;
}

/** React: signed URL for a <video>; nothing is requested until `enabled`. */
export function useSignedMediaUrl(url, { enabled = true } = {}) {
  const prot = isProtectedAttachmentUrl(url);
  const [state, setState] = useState({ src: prot ? null : (url ? plainUrl(url) : null), error: false });
  useEffect(() => {
    if (!url) { setState({ src: null, error: false }); return undefined; }
    if (!prot) { setState({ src: plainUrl(url), error: false }); return undefined; }
    if (!enabled) return undefined;
    let dead = false;
    resolveMediaUrl(url)
      .then((src) => { if (!dead) setState({ src, error: false }); })
      .catch(() => { if (!dead) setState({ src: null, error: true }); });
    return () => { dead = true; };
  }, [url, prot, enabled]);
  return state;
}
