/**
 * WhatsApp-style local copy of chat videos inside the Android app.
 * A video is downloaded ONCE (natively, streamed) into the app's private storage and every later play / thumbnail comes from
 * that file: instant start, no re-download, works offline. In a normal browser everything here is a no-op (the browser's own
 * HTTP cache applies).
 *
 *  - useCachedVideo(attachment, { auto }) -> { src, state: 'remote' | 'queued' | 'downloading' | 'ready', pct, start }
 *  - downloads run 2 at a time and are shared: the same file is never fetched twice, even if two bubbles ask for it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isNative, canCacheNatively, nativeCachedSrc, nativeCacheUrl } from '../native';
import { resolveMediaUrl } from './chatMedia';

const CONCURRENCY = 2;
const AUTO_MAX_BYTES = 80 * 1024 * 1024;     // bigger clips wait for a tap (like WhatsApp's mobile-data limit)
const subs = new Map();                       // key -> Set<fn(state)>
const live = new Map();                       // key -> { state, pct, src }
const waiting = [];
let running = 0;

const keyOf = (a) => String(a.id ?? a.url);
const extOf = (a) => (String(a.original_name || a.url || '').split('?')[0].split('.').pop() || 'mp4').toLowerCase().slice(0, 5);

function publish(key, patch) {
  const next = { ...(live.get(key) || { state: 'remote', pct: 0, src: null }), ...patch };
  live.set(key, next);
  (subs.get(key) || []).forEach((fn) => fn(next));
}

function pump() {
  while (running < CONCURRENCY && waiting.length) {
    const job = waiting.shift();
    running += 1;
    publish(job.key, { state: 'downloading', pct: 0 });
    // the file is private: the native downloader gets a short-lived signed link (it cannot send the Bearer token)
    resolveMediaUrl(job.url)
      .then((url) => nativeCacheUrl({
        url, key: job.key, ext: job.ext,
        onProgress: (loaded, total) => publish(job.key, { pct: total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0 }),
      }))
      .then((src) => publish(job.key, { state: 'ready', pct: 100, src }))
      .catch(() => publish(job.key, { state: 'remote', pct: 0 }))
      .finally(() => { running -= 1; pump(); });
  }
}

function enqueue(a) {
  const key = keyOf(a);
  const cur = live.get(key);
  if (cur && (cur.state === 'queued' || cur.state === 'downloading' || cur.state === 'ready')) return;
  waiting.push({ key, url: a.url, ext: extOf(a) });
  publish(key, { state: 'queued' });
  pump();
}

export function useCachedVideo(a, { auto = false } = {}) {
  const key = a ? keyOf(a) : '';
  const [st, setSt] = useState(() => live.get(key) || { state: 'remote', pct: 0, src: null });
  const autoRef = useRef(auto);
  autoRef.current = auto;

  useEffect(() => {
    if (!isNative || !canCacheNatively() || !a || !a.url || a.local) return undefined;
    let dead = false;
    const fn = (s) => { if (!dead) setSt(s); };
    if (!subs.has(key)) subs.set(key, new Set());
    subs.get(key).add(fn);
    const known = live.get(key);
    if (known) setSt(known);
    else {
      nativeCachedSrc(key, extOf(a)).then((src) => {
        if (dead) return;
        if (src) publish(key, { state: 'ready', pct: 100, src });
        else if (autoRef.current && (!a.size_bytes || a.size_bytes <= AUTO_MAX_BYTES)) enqueue(a);
      });
    }
    return () => { dead = true; subs.get(key)?.delete(fn); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const start = useCallback(() => { if (isNative && canCacheNatively() && a && a.url && !a.local) enqueue(a); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { src: st.state === 'ready' ? st.src : null, state: st.state, pct: st.pct, start };
}
