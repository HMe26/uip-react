/**
 * Where is the Reverb WebSocket server?
 *
 * Order: (1) VITE_REVERB_* baked at build time, if key + host are both set;
 *        (2) GET /api/v1/realtime/config (the API knows its own REVERB_* values — no rebuild needed);
 *        (3) the Railway Reverb service as a last resort.
 * We NEVER fall back to the frontend's own hostname/8080 any more: a Vercel domain has no WebSocket server, which is what broke meetings
 * ("WebSocket connection to wss://<app>.vercel.app:8080 failed").
 */
const FALLBACK = { key: '', host: 'uip-reverb.up.railway.app', port: 443, scheme: 'https' };

let cached = null;
let pending = null;

const clean = (h) => String(h || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/[/:].*$/, '');

function fromEnv() {
  const env = import.meta.env || {};
  const key = env.VITE_REVERB_APP_KEY || '';
  const host = clean(env.VITE_REVERB_HOST);
  if (!key || !host) return null;
  const scheme = env.VITE_REVERB_SCHEME === 'http' ? 'http' : 'https';
  return { key, host, port: Number(env.VITE_REVERB_PORT) || (scheme === 'https' ? 443 : 80), scheme };
}

async function fromApi() {
  try {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), 8000) : null;
    const res = await fetch('/api/v1/realtime/config', { headers: { Accept: 'application/json' }, signal: ctl?.signal });
    if (t) clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    const d = j && (j.data || j);
    if (!d || !d.key || !d.host) return null;
    const scheme = d.scheme === 'http' ? 'http' : 'https';
    return { key: String(d.key), host: clean(d.host), port: Number(d.port) || (scheme === 'https' ? 443 : 80), scheme };
  } catch {
    return null;
  }
}

export function getReverbConfig() {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = (async () => {
    const cfg = fromEnv() || (await fromApi()) || (() => {
      const env = import.meta.env || {};
      return { ...FALLBACK, key: env.VITE_REVERB_APP_KEY || '' };
    })();
    // only keep a usable result; a failed lookup is retried on the next call
    if (cfg.key) cached = cfg;
    pending = null;
    return cfg;
  })();
  return pending;
}
