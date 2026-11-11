/**
 * Big chat files (videos up to the server's MESSAGING_MAX_UPLOAD_MB, 2 GB by default) go up in 3 MB pieces, like Telegram:
 *  - each piece is retried on its own (a dropped connection costs 3 MB, not the whole file);
 *  - 3 pieces travel at once;
 *  - the upload id is remembered per file (name + size + last-modified), so Retry - or even re-opening the app - continues from
 *    the first missing piece instead of starting over;
 *  - 3 MB stays under Vercel's 4.5 MB request-body limit, which is what killed every upload above ~5 MB before.
 * The message itself is then sent with uploaded_ids[] (no file bytes). Used by pages/Messages.jsx.
 */
import { api, ApiError } from '../api/client';

export const CHUNKED_MIN_BYTES = 4 * 1024 * 1024;   // smaller files keep using the normal one-request upload
const PARALLEL = 3;
const RETRIES = 8;

const keyOf = (f) => `uip_cu:${f.name}:${f.size}:${f.lastModified || 0}`;
const remember = (f, id) => { try { localStorage.setItem(keyOf(f), id); } catch { /* not remembered */ } };
const recall = (f) => { try { return localStorage.getItem(keyOf(f)); } catch { return null; } };
export const forgetUpload = (f) => { try { localStorage.removeItem(keyOf(f)); } catch { /* ignore */ } };

const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new ApiError('Upload cancelled.', 0, null)); }, { once: true });
});

const cancelled = (signal) => !!signal && signal.aborted;
/** Worth retrying: network / timeout / server hiccup. Not: 4xx answers that will never succeed. */
const retryable = (e) => !e || !e.status || e.status === 408 || e.status === 429 || e.status >= 500;

/**
 * Uploads `file` and resolves with its upload id.
 * onProgress(sentBytes) is called as pieces complete / advance. `base` = '/api/v1/messaging'.
 */
export async function uploadChunked(file, { base, signal, onProgress }) {
  let id = recall(file);
  let state = null;
  if (id) {
    try { state = (await api.get(`${base}/uploads/${id}`)).data; } catch { id = null; }
  }
  if (!state) {
    const res = await api.post(`${base}/uploads`, { name: file.name || 'file', size: file.size, mime: file.type || null });
    state = res.data;
    id = state.upload_id;
    remember(file, id);
  }

  const chunk = state.chunk_bytes;
  const total = state.total_chunks;
  const have = new Set(state.received || []);
  const inflight = new Map();                 // index -> bytes sent of that piece
  const report = () => {
    let sent = 0;
    have.forEach((i) => { sent += Math.min(chunk, file.size - i * chunk); });
    inflight.forEach((b) => { sent += b; });
    onProgress?.(Math.min(sent, file.size));
  };
  report();

  const todo = [];
  for (let i = 0; i < total; i += 1) if (!have.has(i)) todo.push(i);

  const sendPiece = async (i) => {
    const blob = file.slice(i * chunk, Math.min(file.size, (i + 1) * chunk));
    for (let attempt = 0; ; attempt += 1) {
      if (cancelled(signal)) throw new ApiError('Upload cancelled.', 0, null);
      const fd = new FormData();
      fd.append('index', String(i));
      fd.append('chunk', blob, 'chunk.bin');
      try {
        await api.postFormProgress(`${base}/uploads/${id}/chunk`, fd, (pct) => { inflight.set(i, Math.round((blob.size * pct) / 100)); report(); }, signal);
        inflight.delete(i);
        have.add(i);
        report();
        return;
      } catch (e) {
        inflight.delete(i);
        if (cancelled(signal)) throw e;
        // the server lost the upload (expired / cleaned): forget it so the next Retry starts a fresh one
        if (e && e.status === 422 && /not found|expired/i.test(e.message || '')) { forgetUpload(file); throw e; }
        if (!retryable(e) || attempt >= RETRIES) throw e;
        await sleep(Math.min(15000, 800 * 2 ** attempt), signal);
      }
    }
  };

  let next = 0;
  let failure = null;
  const worker = async () => {
    while (!failure && next < todo.length) {
      const i = todo[next]; next += 1;
      try { await sendPiece(i); } catch (e) { failure = failure || e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));
  if (failure) throw failure;
  return id;
}
