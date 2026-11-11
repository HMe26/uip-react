import { api, getTokens } from '../../../api/client';

const STALL_MS = 60 * 1000;    // no bytes for a minute -> give up
const MAX_MS = 3 * 60 * 1000;  // the whole answer

export const aiLocale = () => { try { return localStorage.getItem('uip_locale') === 'ar' ? 'ar' : 'en'; } catch { return 'en'; } };

/**
 * POST `body` as JSON and read the answer as server-sent events (`data: {json}\n\n`) with fetch + ReadableStream — the
 * request needs a body, so EventSource is not an option. Same wire protocol as /ai-code/fix and /ai-code/assist.
 *
 *   await streamPost('/api/v1/ai-code/chat', body, { signal, onEvent })
 *
 * Resolves when the stream ends. Rejects with an Error that has `.status` (HTTP status before the stream started),
 * `.serverMessage`, `.timeout` (stalled / too long) or name 'AbortError' (the caller aborted). One refresh-and-replay on a 401.
 */
export async function streamPost(url, body, { signal, onEvent }) {
  const ctrl = new AbortController();
  let timedOut = false;
  let stall = 0;
  const abortAll = () => { try { ctrl.abort(); } catch { /* already done */ } };
  const bump = () => { clearTimeout(stall); stall = setTimeout(() => { timedOut = true; abortAll(); }, STALL_MS); };
  const hard = setTimeout(() => { timedOut = true; abortAll(); }, MAX_MS);
  const onAbort = () => abortAll();
  if (signal) { if (signal.aborted) abortAll(); else signal.addEventListener('abort', onAbort); }

  const post = () => {
    const { accessToken } = getTokens();
    const ar = aiLocale() === 'ar';
    return fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Locale': ar ? 'ar' : 'en',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
  };

  try {
    bump();
    let res = await post();
    if (res.status === 401) { // expired access token: a normal client call refreshes it, then replay once
      clearTimeout(stall);
      await api.get('/api/v1/ai-code/status');
      bump();
      res = await post();
    }
    if (!res.ok || !res.body) {
      let msg = '';
      try { const j = await res.json(); msg = (j && j.message) || ''; } catch { /* not json */ }
      throw Object.assign(new Error(msg || `HTTP ${res.status}`), { status: res.status, serverMessage: msg });
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '';
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      bump();
      buf += dec.decode(value, { stream: true });
      const chunks = buf.split('\n\n');
      buf = chunks.pop();
      for (const chunk of chunks) {
        const line = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue; // eslint-disable-line no-continue
        let evt; try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; } // eslint-disable-line no-continue
        onEvent(evt);
      }
    }
  } catch (err) {
    if (timedOut) throw Object.assign(new Error('timeout'), { timeout: true });
    throw err;
  } finally {
    clearTimeout(stall);
    clearTimeout(hard);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}
