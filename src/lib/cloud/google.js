import { api } from '../../api/client';
import { BACKUP_ROOT } from './categories';
import { CloudAuthError, CloudRetryError, cloudFetch, withRetry } from './errors';

/**
 * Google Drive backup provider. Scope = drive.file (only files THIS app creates — no Google security review needed).
 * Two ways to get a token:
 *  - SERVER FLOW (preferred, cfg.server_flow): OAuth authorization-code flow run by Laravel. Google gives the server a REFRESH token
 *    (kept encrypted), and the browser asks /api/v1/cloud/google/token for a fresh 1-hour access token whenever it needs one —
 *    so the link survives closing the tab, restarts and days away. The student clicks "Connect" once.
 *  - Legacy (no server secret configured): Google Identity Services token client. Access tokens only (1 hour) and the silent
 *    renewal is often blocked by the browser, so the link keeps asking to sign in again.
 */
const CB = '/api/v1/cloud/google';
const unwrap = (r) => (r && r.data !== undefined ? r.data : r);
const FRIENDLY = {
  denied: 'Google sign-in was cancelled.',
  expired_state: 'The sign-in took too long. Try again.',
  no_refresh_token: 'Google did not allow lasting access. Remove "UIPE" from your Google account permissions, then connect again.',
  scope_missing: 'Tick the Google Drive permission on the consent screen, then connect again.',
};

async function serverToken(force = false) {
  try {
    const d = unwrap(await api.get(`${CB}/token${force ? '?force=1' : ''}`));
    return { accessToken: d.access_token, expiresAt: Date.now() + (Number(d.expires_in) || 3600) * 1000 - 60000 };
  } catch (e) {
    if (e?.status === 409) throw new CloudAuthError('Google access was revoked or expired. Connect again.', 'revoked');
    throw new CloudRetryError(e?.message || 'Could not reach the server.', e?.status || 0);
  }
}

/** Opens Google's consent page in a pop-up (must start from a click) and waits for the server callback page to report back. */
async function serverConnect(hint) {
  const popup = window.open('', 'uip-gdrive', 'width=520,height=680');
  if (!popup) throw new CloudAuthError('The sign-in window was blocked. Allow pop-ups for this site and try again.', 'popup');
  let url;
  try {
    url = unwrap(await api.post(`${CB}/connect`, hint ? { hint } : {}))?.url;
    if (!url) throw new Error('missing url');
  } catch (e) {
    popup.close();
    throw new CloudAuthError(e?.status === 503 ? 'Google Drive backup is not set up on the server yet.' : (e?.message || 'Could not start Google sign-in.'), 'load');
  }
  popup.location.href = url;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; window.removeEventListener('message', onMsg); clearInterval(watch); fn(v); };
    const onMsg = (ev) => {
      // only the pop-up we opened may report the result (any other window/iframe could forge this message)
      if (ev.source !== popup) return;
      const d = ev.data;
      if (!d || d.source !== 'uip-gdrive') return;
      if (d.ok) finish(resolve, { email: d.email || '' });
      else finish(reject, new CloudAuthError(FRIENDLY[d.reason] || 'Google sign-in failed.', d.reason || 'failed'));
    };
    window.addEventListener('message', onMsg);
    const watch = setInterval(() => { if (popup.closed) setTimeout(() => finish(reject, new CloudAuthError('The sign-in window was closed.', 'popup_closed')), 800); }, 600);
  });
}

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const ROOT_NAME = BACKUP_ROOT;
const SMALL = 4 * 1024 * 1024;

let gsiP = null;
function loadGsi() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gsiP) {
    gsiP = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = resolve; s.onerror = () => { gsiP = null; reject(new CloudAuthError('Could not load Google sign-in.', 'load')); };
      document.head.appendChild(s);
    });
  }
  return gsiP;
}

async function requestToken(clientId, { prompt, hint }) {
  await loadGsi();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPE, prompt, ...(hint ? { hint } : {}),
      callback: (r) => (r?.access_token ? resolve({ accessToken: r.access_token, expiresAt: Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60000 }) : reject(new CloudAuthError(r?.error_description || 'Google sign-in was cancelled.', r?.error || 'denied'))),
      error_callback: (e) => reject(new CloudAuthError(e?.type === 'popup_closed' ? 'The sign-in window was closed.' : 'Google sign-in could not open.', e?.type || 'popup')),
    });
    client.requestAccessToken();
  });
}

const authed = (tok, extra) => ({ ...(extra || {}), Authorization: `Bearer ${tok.accessToken}` });
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function findOrCreateFolder(tok, name, parentId) {
  const cond = `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${q(name)}' and '${parentId || 'root'}' in parents`;
  const r = await cloudFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(cond)}&fields=files(id)&pageSize=1&spaces=drive`, { headers: authed(tok) });
  const j = await r.json();
  if (j.files?.[0]) return j.files[0].id;
  const c = await cloudFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST', headers: authed(tok, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) }),
  });
  return (await c.json()).id;
}

async function uploadBytes(tok, { fileId, name, parentId, blob }) {
  const meta = fileId ? { name } : { name, parents: [parentId] };
  const mime = blob.type || 'application/octet-stream';
  if (blob.size <= SMALL) {
    const boundary = `uip${Math.random().toString(36).slice(2)}`;
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, blob, `\r\n--${boundary}--`]);
    const url = fileId ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id` : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id';
    const r = await cloudFetch(url, { method: fileId ? 'PATCH' : 'POST', headers: authed(tok, { 'Content-Type': `multipart/related; boundary=${boundary}` }), body });
    return (await r.json()).id;
  }
  const url = fileId ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=resumable&fields=id` : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id';
  const init = await cloudFetch(url, { method: fileId ? 'PATCH' : 'POST', headers: authed(tok, { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(blob.size) }), body: JSON.stringify(meta) });
  const loc = init.headers.get('Location');
  if (!loc) throw new CloudAuthError('Google did not start the upload.', 'load');
  const r = await cloudFetch(loc, { method: 'PUT', headers: { 'Content-Type': mime }, body: blob });
  return (await r.json()).id;
}

export const google = {
  id: 'google',
  label: 'Google Drive',
  enabled: (cfg) => !!cfg?.enabled && !!cfg?.client_id,

  /** Interactive (from a click). */
  async connect(cfg, hint) {
    if (cfg.server_flow) {
      const { email } = await serverConnect(hint);
      return { tok: await serverToken(true), account: email, server: true };
    }
    const tok = await requestToken(cfg.client_id, { prompt: 'consent' });
    let account = '';
    try { const r = await cloudFetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers: authed(tok) }); account = (await r.json())?.user?.emailAddress || ''; } catch { /* optional */ }
    return { tok, account };
  },
  /** Profile photo URL of the linked Google account ('' when there is none). Best effort. */
  async profile(tok) {
    try { const r = await cloudFetch('https://www.googleapis.com/drive/v3/about?fields=user(photoLink)', { headers: authed(tok) }); return { picture: (await r.json())?.user?.photoLink || '' }; } catch { return { picture: '' }; }
  },
  /** Silent renewal (no click). Throws CloudAuthError when Google wants the person to act. */
  async refresh(cfg, account, { server = false, force = false } = {}) {
    if (server) return serverToken(force);
    return requestToken(cfg.client_id, { prompt: '', hint: account || undefined });
  },

  /** Server-flow link: unlink + revoke on the server. */
  async disconnectServer() { try { await api.del(`${CB}/connection`); } catch { /* best effort */ } },

  /** Make sure the folder chain exists; returns { rootId, folders } where folders maps our node id → Drive folder id. */
  async ensureFolder(tok, state, nodeId, name, parentRemoteId) {
    if (state.folders[nodeId]) return state.folders[nodeId];
    const id = await withRetry(() => findOrCreateFolder(tok, name, parentRemoteId));
    state.folders[nodeId] = id;
    return id;
  },
  async ensureRoot(tok, state) {
    if (!state.rootId) state.rootId = await withRetry(() => findOrCreateFolder(tok, ROOT_NAME, null));
    return state.rootId;
  },

  /** Create or update one file. Returns the remote id. */
  async put(tok, { remoteId, name, parentRemoteId, blob }) {
    return withRetry(async () => {
      try { return await uploadBytes(tok, { fileId: remoteId, name, parentId: parentRemoteId, blob }); } catch (e) {
        if (remoteId && e?.status === 404) return uploadBytes(tok, { fileId: null, name, parentId: parentRemoteId, blob }); // deleted in Drive: create again
        throw e;
      }
    });
  },
};
