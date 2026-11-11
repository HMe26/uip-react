import { CloudAuthError, CloudQuotaError, CloudRetryError, cloudFetch, withRetry } from './errors';
import { BACKUP_ROOT } from './categories';

/**
 * OneDrive backup provider (Microsoft Graph). OAuth2 authorization-code + PKCE in a pop-up (public/ms-auth.html is the redirect),
 * scopes Files.ReadWrite.AppFolder (only the app's own folder "Apps/<app name>") + User.Read. No library needed.
 * Tokens live in sessionStorage (see engine.js), never on the server.
 */
const SCOPE = 'Files.ReadWrite.AppFolder User.Read offline_access';
const ROOT = BACKUP_ROOT;
const SMALL = 4 * 1024 * 1024;
const CHUNK = 320 * 1024 * 16; // multiple of 320 KiB, as Graph requires

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const redirectUri = () => `${window.location.origin}/ms-auth.html`;
const tokenUrl = (cfg) => `${cfg.authority.replace(/\/+$/, '')}/oauth2/v2.0/token`;

async function tokenCall(cfg, params) {
  let res;
  try { res = await fetch(tokenUrl(cfg), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: cfg.client_id, scope: SCOPE, ...params }) }); } catch { throw new CloudRetryError('Network problem.', 0); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    if (res.status >= 500) throw new CloudRetryError('Microsoft is busy.', res.status);
    throw new CloudAuthError(j.error_description?.split('\r')[0] || 'Microsoft sign-in failed.', j.error || 'denied');
  }
  return { tok: { accessToken: j.access_token, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60000 }, refreshToken: j.refresh_token || null };
}

let cancelPrev = null;

/**
 * Opens Microsoft's sign-in in a pop-up and waits for /ms-auth.html to report the code.
 * Microsoft's login pages send a Cross-Origin-Opener-Policy header, which cuts the link between this window and the pop-up:
 * `popup.closed` then reads TRUE while the person is still typing their password, and `window.opener` is null inside the pop-up.
 * So neither is trusted — the result comes back over a same-origin BroadcastChannel (postMessage kept as a fallback), and the only
 * "gave up" signals are an explicit error from Microsoft or a time-out.
 */
function popupCode(cfg, scope = SCOPE) {
  if (cancelPrev) cancelPrev(); // a second click replaces the first attempt instead of leaving it waiting
  const verifier = rand(48);
  const stateNonce = rand(16);
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then((h) => new Promise((resolve, reject) => {
    const url = `${cfg.authority.replace(/\/+$/, '')}/oauth2/v2.0/authorize?${new URLSearchParams({
      client_id: cfg.client_id, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query', scope,
      state: stateNonce, code_challenge: b64url(h), code_challenge_method: 'S256', prompt: 'select_account',
    })}`;
    const w = window.open(url, 'uip-ms-auth', 'width=520,height=680');
    if (!w) { reject(new CloudAuthError('The sign-in window was blocked. Allow pop-ups and try again.', 'popup')); return; }
    let chan = null;
    try { chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('uip-ms-auth') : null; } catch { chan = null; }
    let finished = false;
    const done = (fn, v) => {
      if (finished) return; finished = true; cancelPrev = null;
      window.removeEventListener('message', onMsg); clearTimeout(timer);
      try { chan?.close(); } catch { /* ignore */ }
      try { w.close(); } catch { /* COOP: cannot reach it, the redirect page closes itself */ }
      fn(v);
    };
    const handle = (search) => {
      const p = new URLSearchParams(search || '');
      if (p.get('state') !== stateNonce) return;
      if (p.get('code')) done(resolve, { code: p.get('code'), verifier });
      else done(reject, new CloudAuthError(p.get('error_description') || 'Microsoft sign-in was cancelled.', p.get('error') || 'denied'));
    };
    function onMsg(e) { if (e.origin === window.location.origin && e.data?.type === 'uip-ms-auth') handle(e.data.search); }
    window.addEventListener('message', onMsg);
    if (chan) chan.onmessage = (e) => { if (e.data?.type === 'uip-ms-auth') handle(e.data.search); };
    const timer = setTimeout(() => done(reject, new CloudAuthError('The sign-in took too long or the window was closed. Try again.', 'popup_closed')), 4 * 60 * 1000);
    cancelPrev = () => done(reject, new CloudAuthError('Sign-in restarted.', 'popup_closed'));
  }));
}

/**
 * "Continue with Microsoft" (login / sign-up): same pop-up + PKCE flow, but with identity scopes only (no OneDrive permissions),
 * and it returns the OpenID Connect ID token. The API verifies that token itself (MicrosoftIdTokenVerifier), nothing else is trusted.
 */
export async function microsoftIdToken(cfg) {
  const scope = 'openid profile email';
  const { code, verifier } = await popupCode(cfg, scope);
  let res;
  try {
    res = await fetch(tokenUrl(cfg), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cfg.client_id, scope, grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifier }),
    });
  } catch { throw new CloudRetryError('Network problem.', 0); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.id_token) {
    if (res.status >= 500) throw new CloudRetryError('Microsoft is busy.', res.status);
    throw new CloudAuthError(j.error_description?.split('\r')[0] || 'Microsoft sign-in failed.', j.error || 'denied');
  }
  return j.id_token;
}

const authed = (tok, extra) => ({ ...(extra || {}), Authorization: `Bearer ${tok.accessToken}` });
const enc = (path) => path.split('/').map(encodeURIComponent).join('/');
const approot = (path) => `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${enc(path)}`;

/** OneDrive answers 409 (nameAlreadyExists / resourceLocked / "another upload is changing this item") when two requests touch the same
 *  folder or file at once. That is a temporary clash, not a failure: retry it with a back-off instead of reporting "Cloud error 409". */
async function graph(url, init) {
  try { return await cloudFetch(url, init); } catch (e) {
    if (e?.status === 409) throw new CloudRetryError('OneDrive is busy.', 409);
    throw e;
  }
}
/** OneDrive refuses  " * : < > ? / \ |  and a trailing dot / space in names. */
const safeName = (n) => String(n).replace(/[\\"*:<>?/|]/g, '_').replace(/[. ]+$/, '') || '_';

// `base` addresses the item: by path ("…approot:/UIP-NUB/Code/a.py:") or, for a file already uploaded, by its id ("…/items/<id>").
// By id there is no name to clash with, and an update can never create a second copy.
async function putSmall(tok, base, blob, behavior = 'replace') {
  const r = await graph(`${base}/content?@microsoft.graph.conflictBehavior=${behavior}`, { method: 'PUT', headers: authed(tok, { 'Content-Type': blob.type || 'application/octet-stream' }), body: blob });
  return (await r.json()).id;
}

async function putLarge(tok, base, blob, behavior = 'replace') {
  const s = await graph(`${base}/createUploadSession`, { method: 'POST', headers: authed(tok, { 'Content-Type': 'application/json' }), body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': behavior } }) });
  const { uploadUrl } = await s.json();
  let id = null;
  try {
    for (let off = 0; off < blob.size; off += CHUNK) {
      const end = Math.min(blob.size, off + CHUNK);
      let res;
      try { res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${off}-${end - 1}/${blob.size}` }, body: blob.slice(off, end) }); } catch { throw new CloudRetryError('Network problem.', 0); }
      if (res.status === 507) throw new CloudQuotaError();
      if (res.status >= 500 || res.status === 429) throw new CloudRetryError('Microsoft is busy.', res.status);
      if (res.status === 409) throw new CloudRetryError('OneDrive is busy.', 409);
      if (res.status === 401) throw new CloudAuthError('Your cloud session expired.', 'expired');
      if (!res.ok) throw Object.assign(new Error(`Cloud error ${res.status}.`), { status: res.status });
      if (res.status === 200 || res.status === 201) id = (await res.json()).id;
    }
  } catch (e) {
    // An abandoned upload session keeps the file name LOCKED ("A file with the same name is currently being uploaded" — 409) until it expires,
    // so every retry would clash with our own half-finished attempt. Cancel the session before anything retries.
    try { await fetch(uploadUrl, { method: 'DELETE' }); } catch { /* best effort */ }
    throw e;
  }
  return id;
}

/** Folders are created by OneDrive itself when a file is addressed by path. Two uploads creating the SAME new folder at once clash (409),
 *  so until a folder holds its first file, uploads into it go one at a time; after that they run in parallel. (A separate
 *  "create folder" call is avoided on purpose: POST .../special/approot/children answers 400 for some accounts.) */
const warm = new Set();
const lane = new Map();
function inFolder(folder, job) {
  if (warm.has(folder)) return job();
  const p = (lane.get(folder) || Promise.resolve()).catch(() => {}).then(async () => { const r = await job(); warm.add(folder); return r; });
  lane.set(folder, p);
  return p;
}

export const microsoft = {
  id: 'microsoft',
  label: 'OneDrive',
  enabled: (cfg) => !!cfg?.enabled && !!cfg?.client_id && !!window.crypto?.subtle,

  /** Interactive (from a click). Returns { tok, refreshToken, account }. */
  async connect(cfg) {
    const { code, verifier } = await popupCode(cfg);
    const r = await tokenCall(cfg, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifier });
    let account = '';
    try { const me = await cloudFetch('https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,mail', { headers: authed(r.tok) }); const j = await me.json(); account = j.mail || j.userPrincipalName || ''; } catch { /* optional */ }
    return { ...r, account };
  },
  /** Profile photo of the linked Microsoft account as a data URL ('' when there is none). Best effort. */
  async profile(tok) {
    try {
      const r = await fetch('https://graph.microsoft.com/v1.0/me/photos/96x96/$value', { headers: authed(tok) });
      if (!r.ok) return { picture: '' };
      const blob = await r.blob();
      if (!blob.type.startsWith('image/') || blob.size > 200 * 1024) return { picture: '' };
      const picture = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => res(''); fr.readAsDataURL(blob); });
      return { picture };
    } catch { return { picture: '' }; }
  },
  async refresh(cfg, refreshToken) {
    if (!refreshToken) throw new CloudAuthError('Sign in again to continue.', 'expired');
    return tokenCall(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken });
  },

  async ensureRoot() { return ROOT; },
  async ensureFolder(tok, state, nodeId, name, parentRemoteId) { return `${parentRemoteId}/${safeName(name)}`; },

  async put(tok, { name, parentRemoteId, blob, remoteId }) {
    const path = `${parentRemoteId}/${safeName(name)}`;
    const send = (base, behavior) => (blob.size <= SMALL ? putSmall(tok, base, blob, behavior) : putLarge(tok, base, blob, behavior));
    const byPath = `${approot(path)}:`;
    return inFolder(parentRemoteId, async () => {
      // 1) a file we already uploaded is updated by its id (no name involved)
      if (remoteId) {
        try { return await withRetry(() => send(`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(remoteId)}`, 'replace'), 4); } catch (e) {
          if (e?.status !== 404) throw e; // 404: it was deleted from OneDrive — upload it again by path below
        }
      }
      // 2) by path (creates the folders). A name that OneDrive still holds locked for an earlier, unfinished upload stays 409 for minutes:
      //    after the retries, save under the next free name ("name 1.ext") instead of failing — later updates then go by id.
      try { return await withRetry(() => send(byPath, 'replace'), 5); } catch (e) {
        if (e instanceof CloudRetryError && e.status === 409) return withRetry(() => send(byPath, 'rename'), 3);
        throw e;
      }
    });
  },
};
