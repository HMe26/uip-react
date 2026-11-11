/**
 * Encrypted API responses (application layer, on top of TLS).
 *
 * Installs a wrapper around window.fetch for same-origin /api/v1/* calls, so every
 * existing caller (api client, heartbeat, AI widget, ...) gets it without changes:
 *  1. once per page load: ephemeral ECDH P-256 handshake (POST /api/v1/secure/handshake),
 *     key = HKDF-SHA256(shared secret, salt) -> AES-256-GCM. Nothing static lives in the bundle,
 *     and the key stays in memory only (never in storage).
 *  2. every request carries X-Enc-Kid; the server answers JSON bodies as an AES-GCM envelope
 *     which is decrypted here and handed back to the caller as an ordinary Response.
 *  0. the admin can switch the whole channel off (Admin → Platform Policy): the handshake then answers
 *     { enabled: false } and the wrapper sends plain requests, re-checking every minute.
 *  3. if the server forgot the key (428), re-handshake and retry once (the server refuses
 *     before running any controller, so retrying is safe for every method).
 * Non-JSON responses (files, images) are untouched. Without WebCrypto (non-secure context)
 * the wrapper steps aside and the server decides (plain, or 428 when enforcement is on).
 */

const HANDSHAKE_PATH = '/api/v1/secure/handshake';
// The fetch this wrapper sits on top of. In the browser that is the original window.fetch. In the APK it must be the fetch
// that native.js has already patched (it prefixes /api with the backend address and adds X-App-Token / X-UIP-Client), so the
// wrapper is installed AFTER initNative(): see installSecureFetch(). Installed before it, the wrapper only ever saw absolute
// backend URLs (different origin than https://localhost), treated them as "not an API call" and sent them without X-Enc-Kid,
// which the server answers with 428 enc_required once encryption is enforced.
let nativeFetch = typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : null;
const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;

const b64u = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => {
    const p = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
  },
};

let session = null;      // { kid, key: CryptoKey } — or { disabled: true } when the admin switched encryption off
let pending = null;      // in-flight handshake promise
let skewMs = 0;          // server clock minus this phone's clock (a phone whose clock is off by minutes made the server refuse every encrypted body)
let plainUntil = 0;      // while Date.now() < this, the server said "encryption is off": send plain, don't re-handshake
const PLAIN_RECHECK_MS = 60_000;

/** Forget the negotiated session (e.g. after the admin flips the encryption switch) so the next call re-negotiates. */
export function resetSecureChannel() { session = null; pending = null; plainUntil = 0; }

async function handshake() {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const pub = await subtle.exportKey('raw', pair.publicKey);
  let timer;
  const res = await Promise.race([
    (nativeFetch || window.fetch.bind(window))(HANDSHAKE_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ pub: b64u.enc(pub) }),
    }),
    // Every API call waits for this handshake; without a limit one stalled request froze the whole app on launch.
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('handshake timeout')), 20000); }),
  ]).finally(() => clearTimeout(timer));
  if (!res.ok) throw new Error('handshake failed: HTTP ' + res.status);
  const { data } = await res.json();
  if (data && Number(data.server_time) > 0) skewMs = Number(data.server_time) - Date.now();
  // Admin → Platform Policy turned response encryption off: no key is issued, everything is plain JSON.
  if (data && data.enabled === false) return { disabled: true };
  const serverPub = await subtle.importKey('raw', b64u.dec(data.server_pub), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await subtle.deriveBits({ name: 'ECDH', public: serverPub }, pair.privateKey, 256);
  const hkdf = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const salt = b64u.dec(data.salt);
  const derive = (info, usage) => subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(info) },
    hkdf, { name: 'AES-GCM', length: 256 }, false, [usage],
  );
  // Two separate non-extractable keys: server->client (decrypt) and client->server (encrypt).
  const [key, reqKey] = await Promise.all([derive('uip-resp-enc-v1', 'decrypt'), derive('uip-req-enc-v1', 'encrypt')]);
  return { kid: data.kid, key, reqKey };
}

function ensureSession(force) {
  if (force) { session = null; pending = null; }
  if (session) return Promise.resolve(session);
  if (!pending) {
    pending = handshake().then((s) => { session = s; return s; }).finally(() => { pending = null; });
  }
  return pending;
}

/** A request was refused with the key `failed`: negotiate a new one - but only once for all requests that failed together
 *  (a page fires a dozen calls at once; one handshake each hit the server's 60/min handshake limit and kept replacing the key). */
function renewSession(failed) {
  if (session && session !== failed && !session.disabled) return Promise.resolve(session);
  if (pending) return pending;
  return ensureSession(true);
}

function isApiCall(input) {
  try {
    const u = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, window.location.href);
    return u.origin === window.location.origin && u.pathname.startsWith('/api/v1/') && u.pathname !== HANDSHAKE_PATH;
  } catch { return false; }
}

/**
 * Channel for code that cannot use fetch (XMLHttpRequest uploads with progress): returns
 * { kid, decrypt(text, status) } so the caller can send X-Enc-Kid and open the encrypted answer,
 * or null when the channel is plain (WebCrypto missing, handshake failed, or encryption switched off).
 * The multipart body itself is not encrypted (same as fetch uploads); only the response is.
 */
export async function getXhrChannel(force = false) {
  if (!subtle || Date.now() < plainUntil) return null;
  try {
    const s = await ensureSession(force);
    if (s.disabled) { session = null; plainUntil = Date.now() + PLAIN_RECHECK_MS; return null; }
    return { kid: s.kid, decrypt: (text, status) => decryptText(text, status, s) };
  } catch { return null; }
}

const CAN_GZIP = typeof DecompressionStream !== 'undefined';

/** Server compresses JSON before encrypting (envelope flag z:1) so the encrypted answer is ~5x smaller. */
async function gunzip(buf) {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

async function decryptText(text, status, s) {
  let env;
  try { env = JSON.parse(text); } catch { return text; }
  if (!env || env.enc !== 'v1' || typeof env.d !== 'string') return text;
  const raw = b64u.dec(env.d);
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: new TextEncoder().encode(`uip-resp|${s.kid}|${status}`), tagLength: 128 },
    s.key, raw.slice(12),
  );
  return new TextDecoder().decode(env.z ? await gunzip(plain) : plain);
}

async function decryptResponse(res, s) {
  // Only JSON envelopes are touched; anything else (files, plain errors) passes through.
  if (!(res.headers.get('content-type') || '').includes('json')) return res;
  const text = await res.clone().text();
  let env;
  try { env = JSON.parse(text); } catch { return res; }
  if (!env || env.enc !== 'v1' || typeof env.d !== 'string') return res;
  const raw = b64u.dec(env.d);
  const iv = raw.slice(0, 12);
  const ctAndTag = raw.slice(12);
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`uip-resp|${s.kid}|${res.status}`), tagLength: 128 },
    s.key, ctAndTag,
  );
  const headers = new Headers(res.headers);
  ['content-length', 'content-encoding', 'etag'].forEach((h) => headers.delete(h));
  return new Response(env.z ? await gunzip(plain) : plain, { status: res.status, statusText: res.statusText, headers });
}

/** JSON string bodies of write requests are sent as an AES-GCM envelope (uploads/FormData stay as is). */
async function encryptBody(url, method, headers, body, s) {
  const ct = headers.get('content-type') || '';
  if (typeof body !== 'string' || !ct.includes('json') || ['GET', 'HEAD'].includes(method)) return body;
  const u = new URL(url, window.location.href);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const nonce = b64u.enc(crypto.getRandomValues(new Uint8Array(16)));
  const plain = new TextEncoder().encode(JSON.stringify({ t: Date.now() + skewMs, n: nonce, b: body }));
  const out = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`uip-req|${s.kid}|${method}|${u.pathname}`), tagLength: 128 },
    s.reqKey, plain,
  ); // WebCrypto returns ciphertext||tag
  const packed = new Uint8Array(12 + out.byteLength);
  packed.set(iv, 0); packed.set(new Uint8Array(out), 12);
  return JSON.stringify({ enc: 'v1', kid: s.kid, d: b64u.enc(packed) });
}

async function send(input, init, s) {
  if (input instanceof Request) {
    const headers = new Headers(input.headers);
    headers.set('X-Enc-Kid', s.kid);
    if (CAN_GZIP) headers.set('X-Enc-Z', '1');
    return nativeFetch(new Request(input.clone(), { headers }), init);
  }
  const headers = new Headers(init?.headers || undefined);
  headers.set('X-Enc-Kid', s.kid);
  if (CAN_GZIP) headers.set('X-Enc-Z', '1'); // "I can open a gzip-then-encrypted answer"
  const method = String(init?.method || 'GET').toUpperCase();
  const body = await encryptBody(input, method, headers, init?.body, s);
  return nativeFetch(input, { ...(init || {}), headers, ...(body !== undefined ? { body } : {}) });
}

async function secureFetch(input, init) {
  if (!subtle || !isApiCall(input)) return nativeFetch(input, init);
  if (Date.now() < plainUntil) return nativeFetch(input, init);
  let s;
  try {
    try {
      s = await ensureSession(false);
    } catch (first) {
      // One more try before giving up (cold server / slow mobile network): falling back to a plain request makes an enforcing
      // server answer 428 "secure channel required", which is exactly what the APK showed on the login screen.
      s = await ensureSession(true);
    }
    if (s.disabled) { session = null; plainUntil = Date.now() + PLAIN_RECHECK_MS; return nativeFetch(input, init); }
  } catch (err) {
    // Visible in the browser console: tells you the encrypted channel is NOT active.
    if (!window.__uipEncWarned) { window.__uipEncWarned = true; console.warn('[secure-channel] handshake failed, sending plain requests:', err?.message || err); }
    const plain = await nativeFetch(input, init);
    if (plain.status !== 428) return plain;
    // The server enforces encryption: negotiate now (the network may have recovered) and resend once.
    try {
      s = await renewSession(null);
      if (s.disabled) { session = null; plainUntil = Date.now() + PLAIN_RECHECK_MS; return plain; }
    } catch { return plain; }
  }

  let res = await send(input, init, s);
  for (let attempt = 0; attempt < 2 && res.status === 428; attempt += 1) {
    s = await renewSession(s);
    if (s.disabled) { session = null; plainUntil = Date.now() + PLAIN_RECHECK_MS; return nativeFetch(input, init); }
    res = await send(input, init, s);
  }
  // The server answers X-Enc: 0 when the admin has just switched encryption off: stop using the old key.
  if (res.headers.get('X-Enc') === '0') { session = null; plainUntil = Date.now() + PLAIN_RECHECK_MS; return res; }
  return decryptResponse(res, s);
}

export function installSecureFetch() {
  if (typeof window === 'undefined' || !subtle || !window.fetch || window.__uipSecureFetch) return;
  nativeFetch = window.fetch.bind(window);
  window.__uipSecureFetch = true;
  window.fetch = secureFetch;
}

// Browser: install right away. APK: main.jsx calls installSecureFetch() after initNative().
const inApp = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
if (!inApp) installSecureFetch();
