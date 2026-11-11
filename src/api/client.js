/**
 * API client — React equivalent of public/assets/js/api-client.js, adapted
 * for the SPA case.
 *
 * The old client authenticated via the PHP session cookie + a CSRF token
 * (app/Middleware/CSRFMiddleware.php). That still works, but the backend
 * *also* issues a JWT access/refresh pair on JSON login specifically for
 * this purpose (see LoginController::submit — "a React client uses the
 * Bearer token"), and CSRFMiddleware explicitly exempts any request
 * carrying `Authorization: Bearer ...`. So this client uses Bearer auth:
 * no CSRF token needed, and no reliance on a same-origin cookie, so this
 * app can be hosted separately from the PHP backend if you want.
 *
 * Access tokens are short-lived (JWT_ACCESS_TTL, default 900s/15min).
 * On a 401 we transparently redeem the refresh token
 * (POST /api/v1/auth/refresh-token) and retry once — see requestWithAuth.
 *
 * The short-lived ACCESS token lives in `localStorage`, so every tab of the same
 * browser shares ONE login: opening a new tab/link keeps you signed in, and
 * logging out (or being revoked from the Security portal) signs every tab out.
 * Other tabs are told about changes through the `storage` event (see AuthContext).
 *
 * The long-lived REFRESH token is NEVER visible to JavaScript: the server keeps it
 * in an HttpOnly + Secure + SameSite cookie (path /api/v1/auth), so an XSS can no
 * longer steal a 14-day credential. The browser attaches it by itself to
 * /auth/refresh-token and /auth/logout; those two calls also carry the
 * double-submit CSRF header (X-CSRF-Token = the readable `uip_csrf` cookie).
 * The app talks to the API through same-origin relative URLs (Netlify/Vercel
 * proxy), so `credentials: 'same-origin'` is enough. If the API is ever served
 * from another origin, switch to 'include' + AUTH_COOKIE_SAMESITE=none on the API.
 *
 * Because the refresh token rotates on every use (and the server treats a
 * re-used refresh token as theft and kills all sessions), only ONE tab may
 * refresh at a time — see refreshAccessToken (Web Locks) below.
 *
 * Trade-off: to be signed in as two different accounts at once (e.g. Student
 * next to Data Analyst) use a private/incognito window or a second browser
 * profile — they have separate localStorage.
 */

import { examSessionHeaders } from '../lib/examSession';
import { getExportLang } from '../lib/exportLang';
import { getXhrChannel } from './secureTransport';
import { activityHeaders, noteNetworkFailure } from '../lib/activityTracker';
import { isNative, readNativeCookie, openUploadXhr, directUploadUrl } from '../native';

/** Fired after every successful write (POST/PUT/PATCH/DELETE) so any mounted
 *  component can refresh what it shows without a page reload. See hooks/useLive.js. */
export const MUTATION_EVENT = 'uip:mutated';

/** Fired when the server answers 403 + errors.code === 'permission_denied' (an admin
 *  took a permission away from this user's role). AuthContext listens and reloads
 *  the user's permissions so the matching button/page closes straight away. */
export const PERMISSION_DENIED_EVENT = 'uip:permission-denied';

/** Fired when the server answers 403 + errors.code === 'device_blocked' (the Security > Policies >
 *  Device restrictions policy blocks this device type). DeviceGate listens and swaps the whole app
 *  for the "this device is blocked" page — including for sessions that were already open. */
export const DEVICE_BLOCKED_EVENT = 'uip:device-blocked';

function notifyDeviceBlocked(json) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DEVICE_BLOCKED_EVENT, {
    detail: {
      message: json?.message,
      deviceType: json?.data?.device_type ?? json?.errors?.device_type,
      // Set when the block is a per-account-type rule (e.g. students on mobile) rather than a platform-wide one.
      role: json?.data?.role ?? json?.errors?.role,
    },
  }));
}

/** Fired when the server answers 403 + errors.code === 'mfa_setup_required' (Security > Policies > MFA
 *  requirements: this account's role must have 2FA and its enrollment grace period is over). MfaGate listens
 *  and swaps the app for the 2FA setup page until the person enrolls. */
export const MFA_REQUIRED_EVENT = 'uip:mfa-required';

function notifyMfaRequired(json) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(MFA_REQUIRED_EVENT, { detail: json?.data || {} }));
}

/** Fired when the server answers 403 + errors.code === 'university_approval_required' (the account is not linked
 *  to a university and has no grant for this feature). AccessGate listens: it refreshes the account's access
 *  status and shows the "needs approval" notice. */
export const ACCESS_REQUIRED_EVENT = 'uip:access-required';

function notifyAccessRequired(json) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ACCESS_REQUIRED_EVENT, { detail: { feature: json?.errors?.feature, status: json?.data || {} } }));
}

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export const ACCESS_KEY = 'uip_access_token';
// LEGACY: sessions opened before the HttpOnly-cookie change still have the refresh token here.
// It is sent once (to migrate the session to the cookie), then deleted — never written again.
export const REFRESH_KEY = 'uip_refresh_token';
const CSRF_COOKIE = 'uip_csrf';
/** Endpoints authenticated by the HttpOnly refresh cookie — these need the CSRF header. */
const COOKIE_AUTH_PATHS = ['/api/v1/auth/refresh-token', '/api/v1/auth/logout'];

function readCookie(name) {
  try {
    const hit = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
  } catch { return ''; }
}
// Display identity ({ id, role, name, email }). The access token is now encrypted by the server,
// so the UI can no longer read these from it; the login/refresh response carries them instead.
export const USER_KEY = 'uip_user';
// Remembers that the last session was a staff account, so when it ends (expiry / idle / logout)
// the person is sent back to the hidden staff sign-in instead of the public "Who are you?" page.
// Deliberately NOT cleared by clearTokens(); only the next non-staff sign-in resets it.
export const STAFF_FLAG_KEY = 'uip_staff_session';
export const STAFF_ROLES = ['admin', 'data_analyst', 'security_admin', 'security_officer'];
export function wasStaffSession() { try { return localStorage.getItem(STAFF_FLAG_KEY) === '1'; } catch { return false; } }

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
  remove(k) { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
};

// Client-side fallback messages follow the UI language (the API's own messages are translated server-side via X-Locale).
const msg = (en, ar) => (store.get('uip_locale') === 'ar' ? ar : en);


export function getTokens() {
  return {
    accessToken: store.get(ACCESS_KEY),
    refreshToken: store.get(REFRESH_KEY),
  };
}

export function getStoredUser() {
  try { return JSON.parse(store.get(USER_KEY) || 'null'); } catch { return null; }
}

export function setStoredUser(user) {
  if (user) store.set(USER_KEY, JSON.stringify(user));
}

export function setTokens({ access_token, idle_timeout_minutes, user }) {
  // User first: other tabs react to the ACCESS_KEY `storage` event and read it right away.
  if (user) {
    store.set(USER_KEY, JSON.stringify(user));
    if (STAFF_ROLES.includes(user.role)) store.set(STAFF_FLAG_KEY, '1'); else store.remove(STAFF_FLAG_KEY);
  }
  if (access_token) store.set(ACCESS_KEY, access_token);
  // The refresh token now lives in an HttpOnly cookie. Drop any legacy copy once the server has migrated it.
  store.remove(REFRESH_KEY);
  // Server-side idle window (Security > Policies > Sessions). 0 = disabled.
  if (idle_timeout_minutes !== undefined && idle_timeout_minutes !== null) store.set(IDLE_KEY, String(idle_timeout_minutes));
}

export function clearTokens() {
  store.remove(USER_KEY);
  store.remove(ACCESS_KEY);
  store.remove(REFRESH_KEY);
  store.remove(IDLE_KEY);
  store.remove(ACTIVITY_KEY);
  store.remove(USER_IDLE_KEY);
}

// ---- Idle (inactivity) tracking -------------------------------------------
// `uip_last_activity` is the time of the last REAL user interaction (mouse,
// keyboard, touch, scroll). Background polling/refreshes never touch it, so a
// tab left open overnight does not count as "in use". It lives in localStorage
// so every tab of the browser shares it (see useIdleLogout in AuthContext).
export const IDLE_KEY = 'uip_idle_minutes';
export const ACTIVITY_KEY = 'uip_last_activity';
const DEFAULT_IDLE_MINUTES = 0; // no inactivity sign-out unless the server sent a policy (persistent sign-in is the default)

export function markActivity() { store.set(ACTIVITY_KEY, String(Date.now())); }

export function getLastActivity() {
  const n = Number(store.get(ACTIVITY_KEY));
  return Number.isFinite(n) ? n : 0;
}

/** The person's OWN "sign me out after N minutes of inactivity" (Settings ▸ Security & devices). Stricter wins over the platform policy. */
export const USER_IDLE_KEY = 'uip_user_idle_minutes';
export function setUserIdleMinutes(min) {
  const n = Number(min);
  if (Number.isFinite(n) && n > 0) store.set(USER_IDLE_KEY, String(Math.round(n))); else store.remove(USER_IDLE_KEY);
}

/** Allowed inactivity in ms; 0 means the policy is disabled. */
export function getIdleMs() {
  const raw = store.get(IDLE_KEY);
  let platform = DEFAULT_IDLE_MINUTES * 60000;
  if (raw !== null && raw !== '') { const m = Number(raw); platform = Number.isFinite(m) && m > 0 ? m * 60000 : 0; }
  const own = Number(store.get(USER_IDLE_KEY));
  const ownMs = Number.isFinite(own) && own > 0 ? own * 60000 : 0;
  if (!platform) return ownMs;
  return ownMs ? Math.min(platform, ownMs) : platform;
}

function buildUrl(path, params) {
  if (!params) return path;
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    usp.append(k, v);
  });
  const qs = usp.toString();
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;
}

// A single dropped connection (Wi-Fi/mobile blip, server keep-alive reset, a proxy cold start 502/503/504)
// is not a real outage — the connection is fine a moment later. Retry those quietly instead of showing
// "network error". Only safe (idempotent) requests are retried: GET/HEAD/PUT/DELETE, plus the exam
// heartbeat. Nothing else is repeated, so a POST can never be applied twice.
const RETRY_DELAYS_MS = [400, 1200, 2500];
const TRANSIENT_STATUS = [502, 503, 504];
function isRetryable(method, path) {
  if (['GET', 'HEAD', 'PUT', 'DELETE'].includes(method)) return true;
  return method === 'POST' && /\/exam-system\/attempts\/[^/]+\/heartbeat$/.test(path);
}
// A request that never answers (stalled mobile connection, server cold start) used to keep the app on the loading
// spinner forever, because neither fetch nor CapacitorHttp has a default timeout. Give up after a while instead.
// Not applied to the AI stream / uploads (they have their own watchdogs), only to ordinary JSON calls.
const REQUEST_TIMEOUT_MS = 25000;
function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error('request timeout')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}
// ±30% random spread: with thousands of clients, identical retry delays make them all hit the server again at the same instant.
const jitter = (ms) => Math.round(ms * (0.7 + Math.random() * 0.6));
async function fetchWithRetry(method, path, url, opts) {
  const retryable = isRetryable(method, path);
  let lastErr;
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i += 1) {
    try {
      const res = await withTimeout(fetch(url, opts), REQUEST_TIMEOUT_MS);
      if (retryable && TRANSIENT_STATUS.includes(res.status) && i < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, jitter(RETRY_DELAYS_MS[i])));
        continue;
      }
      // Rate-limited (429): wait for what the server asked (Retry-After, capped at 8s) and try ONCE more instead of failing the screen.
      if (retryable && res.status === 429 && i === 0) {
        const asked = Number(res.headers?.get?.('Retry-After'));
        const wait = Math.min(8000, Math.max(RETRY_DELAYS_MS[1], Number.isFinite(asked) ? asked * 1000 : 0));
        await new Promise((r) => setTimeout(r, jitter(wait)));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (!retryable || i >= RETRY_DELAYS_MS.length) break;
      await new Promise((r) => setTimeout(r, jitter(RETRY_DELAYS_MS[i])));
    }
  }
  throw lastErr;
}

async function rawRequest(method, path, { params, body, formData, headers, asResponse, silent } = {}) {
  // While an export runs, the language picked in the export menu wins over the UI language.
  const exportLang = getExportLang();
  const url = buildUrl(path, exportLang ? { ...params, lang: exportLang } : params);
  const { accessToken } = getTokens();
  // Double-submit CSRF value for the cookie-authenticated endpoints. In the Android app the cookie belongs to the API
  // domain, so it is read from the native cookie store instead of document.cookie.
  const csrf = COOKIE_AUTH_PATHS.includes(path) ? (readCookie(CSRF_COOKIE) || (isNative ? await readNativeCookie(CSRF_COOKIE) : '')) : '';
  const opts = {
    method,
    credentials: 'same-origin', // sends/receives the HttpOnly refresh cookie on the same origin
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json',
      // The server words some errors (e.g. "account already open elsewhere") in the UI language.
      'X-Locale': (exportLang || store.get('uip_locale')) === 'ar' ? 'ar' : 'en',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      // Exam single-session: X-Device-Id (+ X-Exam-Session for /attempts/{id}) on exam-system calls only.
      ...examSessionHeaders(path),
      // Which page / browser visit this call came from (per-user activity timeline, server side).
      ...activityHeaders(),
      // Double-submit CSRF for the cookie-authenticated endpoints (the server checks it against the cookie).
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...headers,
    },
  };

  if (method !== 'GET' && method !== 'HEAD') {
    if (formData) {
      opts.body = formData;
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body || {});
    }
  }

  let response;
  const startedAt = Date.now();
  try {
    response = await fetchWithRetry(method, path, url, opts);
  } catch (netErr) {
    noteNetworkFailure({ method, path, message: netErr?.message || 'request failed', durationMs: Date.now() - startedAt });
    throw new ApiError(msg('Network error — please check your connection.', 'خطأ في الشبكة — من فضلك تحقق من اتصالك.'), 0, null);
  }

  // File downloads: a .json file is served as application/json — hand back the Response untouched instead of parsing it.
  if (asResponse && response.ok) return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) throw new ApiError(`Request failed (${response.status})`, response.status, null);
    return response;
  }

  const json = await response.json();
  // Framework-level errors (e.g. Laravel's own throttle 429) come back as JSON WITHOUT `success:false`. They used to be
  // returned as if they succeeded, so callers crashed with "Cannot read properties of undefined (reading 'status')".
  if (!response.ok && json && json.success !== true && json.success !== false) {
    const friendly = response.status === 429
      ? msg('Too many attempts. Please wait a moment and try again.', 'محاولات كتير. استنى لحظة وحاول تاني.')
      : (json.message || `Request failed (${response.status})`);
    throw new ApiError(friendly, response.status, json);
  }
  if (json && json.success === false) {
    if (response.status === 403 && json.errors?.code === 'device_blocked') notifyDeviceBlocked(json);
    if (response.status === 403 && json.errors?.code === 'mfa_setup_required') notifyMfaRequired(json);
    if (response.status === 403 && json.errors?.code === 'university_approval_required') notifyAccessRequired(json);
    if (response.status === 403 && json.errors?.code === 'permission_denied' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(PERMISSION_DENIED_EVENT, { detail: { permission: json.errors.permission } }));
    }
    throw new ApiError(json.message || msg('Request failed.', 'فشل الطلب.'), response.status, json);
  }
  if (!silent && method !== 'GET' && method !== 'HEAD' && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MUTATION_EVENT, { detail: { method, path } }));
  }
  return json;
}

// Redeems the refresh token for a new access+refresh pair. Concurrent 401s in
// this tab share one in-flight refresh, and a Web Lock serialises refreshes
// across tabs: the refresh token is single-use, so two tabs redeeming the same
// one would look like token theft to the server. `staleAccess` is the access
// token that just got a 401 — if another tab already replaced it while we
// waited for the lock, we simply reuse its result instead of refreshing again.
let refreshPromise = null;

async function doRefresh(staleAccess) {
  const { accessToken, refreshToken: legacyRefresh } = getTokens();
  // No access token and no legacy token => nobody is signed in in this browser.
  if (!accessToken && !legacyRefresh) throw new ApiError(msg('Not authenticated.', 'غير مسجّل الدخول.'), 401, null);
  if (staleAccess && accessToken && accessToken !== staleAccess) {
    return { access_token: accessToken };
  }
  // Normal case: the HttpOnly cookie carries the refresh token (empty body).
  // Legacy case: a session created before the cookie change sends its old localStorage token once.
  const json = await rawRequest('POST', '/api/v1/auth/refresh-token', {
    body: legacyRefresh ? { refresh_token: legacyRefresh } : {},
  });
  setTokens(json.data);
  return json.data;
}

/**
 * Facebook-style "stay signed in": when this browser has no access token any more (localStorage was
 * wiped / the app was reopened after a long time) but the HttpOnly refresh cookie is still there, redeem
 * it silently instead of showing the login page. The readable `uip_csrf` cookie is only present while a
 * refresh cookie exists, so a visitor who never signed in (or who signed out) makes no request at all.
 * Resolves to true when a session was restored.
 */
export function restoreSession() {
  const run = async () => {
    if (getTokens().accessToken) return true; // another tab restored it while we waited for the lock
    if (!readCookie(CSRF_COOKIE) && !(isNative && await readNativeCookie(CSRF_COOKIE))) return false;
    try {
      const json = await rawRequest('POST', '/api/v1/auth/refresh-token', { body: {} });
      setTokens(json.data);
      return true;
    } catch {
      return false;
    }
  };
  return Promise.resolve(typeof navigator !== 'undefined' && navigator.locks?.request
    ? navigator.locks.request('uip-token-refresh', run)
    : run());
}

async function refreshAccessToken(staleAccess) {
  if (!refreshPromise) {
    const run = () => doRefresh(staleAccess);
    const locked = typeof navigator !== 'undefined' && navigator.locks?.request
      ? navigator.locks.request('uip-token-refresh', run)
      : run();
    refreshPromise = Promise.resolve(locked).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

// A failed token refresh only ends the session when the server SAYS it is over (401/403/other 4xx).
// A network blip (laptop waking from sleep, Wi-Fi dropping, a proxy cold start 502, 429, a timeout)
// must NOT wipe the sign-in: the refresh cookie and the server session are still valid, and wiping
// them here left the account "open elsewhere" on the server and locked the person out of their own login.
function refreshFailureIsTransient(e) {
  if (!(e instanceof ApiError)) return true;
  return e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500;
}

async function request(method, path, opts) {
  const usedAccess = getTokens().accessToken;
  try {
    return await rawRequest(method, path, opts);
  } catch (err) {
    // Skip retry for the auth endpoints themselves to avoid loops.
    if (err instanceof ApiError && err.status === 401 && !path.startsWith('/api/v1/auth/')) {
      try {
        await refreshAccessToken(usedAccess);
      } catch (refreshErr) {
        if (refreshFailureIsTransient(refreshErr)) throw refreshErr; // keep the sign-in; the next request retries
        clearTokens();
        throw err;
      }
      return rawRequest(method, path, opts);
    }
    throw err;
  }
}

/**
 * Renders an ApiError for display. The backend's validate() helper
 * (Core\Controller::validate) returns a generic "The given data was
 * invalid." message plus a field=>[messages] `errors` map (see
 * Validator::errors()) — this surfaces those field messages instead of
 * just the generic one, same info a web form's inline field errors would
 * show, since there's no per-field rendering here (yet).
 */
export function errorMessage(err) {
  const fieldErrors = err?.payload?.errors;
  if (fieldErrors && typeof fieldErrors === 'object') {
    const messages = Object.values(fieldErrors).flat();
    if (messages.length) return messages.join(' ');
  }
  return err?.message || msg('Something went wrong. Please try again.', 'حدث خطأ ما. حاول مرة أخرى.');
}

/** Name/type/size of every file in a FormData (no content), for the diagnostics sent to the admin log. */
function describeFiles(formData) {
  const out = [];
  try {
    for (const [field, v] of formData.entries()) {
      if (typeof Blob !== 'undefined' && v instanceof Blob) out.push({ field, name: v.name || 'blob', type: v.type || '?', size: v.size });
    }
  } catch { /* odd FormData implementation */ }
  return out;
}

let reportTimes = [];
/**
 * App-only: tells the server that something failed ON THE PHONE before it ever reached the API (a dead upload, a media
 * export that threw…). Shows up in Admin → Mobile → token → Request log as "App-side failures". Fire-and-forget:
 * never throws, at most 6 reports a minute.
 */
export function reportClientIssue(kind, { method = 'POST', path = '', status = 0, message = '', bytes = null, durationMs = null, meta = {} } = {}) {
  if (!isNative) return;
  try {
    const now = Date.now();
    reportTimes = reportTimes.filter((x) => now - x < 60000);
    if (reportTimes.length >= 6) return;
    reportTimes.push(now);
    api.post('/api/v1/app/client-report', {
      kind, method, path: String(path || '').split('?')[0], status, message: String(message || '').slice(0, 500), bytes, duration_ms: durationMs,
      meta: { online: typeof navigator !== 'undefined' ? navigator.onLine : null, ...meta },
    }).catch(() => {});
  } catch { /* reporting must never break the app */ }
}

/** Turns the raw answer of an upload (XHR or fetch) into the parsed JSON, or throws the right ApiError. */
async function parseUploadResponse(status, rawText, channel, method, path) {
  let json = null;
  try {
    let text = rawText;
    if (channel) text = await channel.decrypt(text, status);
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  if (!json) {
    const friendly = status === 413
      ? msg('The file is larger than the server allows. Choose a lower quality or a shorter clip.', 'الملف أكبر من الحجم المسموح على السيرفر. اختار جودة أقل أو مقطع أقصر.')
      : status === 502 || status === 504 || status === 408
        ? msg('The server took too long to answer. Try again with a smaller file.', 'السيرفر أخد وقت طويل في الرد. جرّب ملف أصغر.')
        : `Request failed (${status})`;
    throw new ApiError(friendly, status, null);
  }
  if (status === 403 && json.errors?.code === 'device_blocked') notifyDeviceBlocked(json);
  if (status === 403 && json.errors?.code === 'mfa_setup_required') notifyMfaRequired(json);
  if (status === 403 && json.errors?.code === 'university_approval_required') notifyAccessRequired(json);
  if (json.success === false || status >= 400) {
    throw new ApiError(json.message || msg('Request failed.', 'فشل الطلب.'), status, json);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MUTATION_EVENT, { detail: { method, path } }));
  }
  return json;
}

/**
 * App fallback when the direct WebView XHR died: the browser's real fetch (native.js routes FormData bodies to it), which streams
 * the file from memory. The old fallback went through Capacitor's patched XMLHttpRequest, which crashes inside the app
 * ("Cannot set properties of undefined (setting 'X-UIP-Client')") and base64-encodes the whole video through the bridge.
 */
async function fetchUpload(method, path, formData, signal, channel) {
  const startedAt = Date.now();
  const { accessToken } = getTokens();
  const headers = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (channel) headers['X-Enc-Kid'] = channel.kid;
  let res;
  try {
    res = await fetch(directUploadUrl(path, formData), { method, headers, body: formData, signal });
  } catch (e) {
    if (e?.name === 'AbortError' || (signal && signal.aborted)) throw new ApiError(msg('Upload cancelled.', 'تم إلغاء الرفع.'), 0, null);
    reportClientIssue('upload_fetch_failed', {
      method, path, durationMs: Date.now() - startedAt, message: `fetch fallback failed: ${e?.name || 'Error'}: ${e?.message || e}`,
      meta: { stage: 'fetch-fallback', files: describeFiles(formData) },
    });
    throw new ApiError(msg('Network error — please check your connection.', 'خطأ في الشبكة — من فضلك تحقق من اتصالك.') + ' [fetch-retry]', 0, null);
  }
  return parseUploadResponse(res.status, await res.text(), channel, method, path);
}

/**
 * multipart upload WITH progress (fetch can't report upload progress, XHR can).
 * Same auth header + one refresh-on-401 retry as request(). `onProgress(pct)`
 * gets 0-100 while bytes are being sent; the promise resolves with the parsed
 * JSON body once the server answers (which, for videos, can be a while after
 * pct hits 100 because the server is processing the file).
 */
function xhrUpload(method, path, formData, onProgress, signal, channel = null, viaBridge = false) {
  return new Promise((resolve, reject) => {
    const { accessToken } = getTokens();
    if (signal && signal.aborted) { reject(new ApiError(msg('Upload cancelled.', 'تم إلغاء الرفع.'), 0, null)); return; }
    if (viaBridge) { fetchUpload(method, path, formData, signal, channel).then(resolve, reject); return; }
    // In the APK use the real WebView XHR (Capacitor's patched one has no upload progress and chokes on big files).
    const target = directUploadUrl(path, formData);   // big files skip the Vercel proxy (4.5MB body limit)
    const direct = target !== path;
    const nativeXhr = viaBridge ? null : openUploadXhr(method, target);
    // Inside the app never use the (Capacitor-patched) global XHR: its setRequestHeader crashes. Use real fetch instead.
    if (isNative && !nativeXhr) { fetchUpload(method, path, formData, signal, channel).then(resolve, reject); return; }
    const xhr = nativeXhr || new XMLHttpRequest();
    if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true });
    if (!nativeXhr) xhr.open(method, target);
    // The app authenticates uploads with the Bearer token only; cross-origin credentials are not needed (and the API
    // only allows them for explicitly listed origins).
    try {
      xhr.withCredentials = !nativeXhr && !direct;
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.setRequestHeader('Accept', 'application/json');
      if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
      // Encrypted channel: XHR bypasses the fetch wrapper, so announce the session key here (response comes back encrypted).
      if (channel) xhr.setRequestHeader('X-Enc-Kid', channel.kid);
    } catch (e) {
      if (isNative) { try { xhr.abort(); } catch { /* ignore */ } fetchUpload(method, path, formData, signal, channel).then(resolve, reject); return; }
      reject(e); return;
    }
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      };
    }
    const startedAt = Date.now();
    let sentBytes = 0;
    let totalBytes = 0;
    if (xhr.upload) {
      const prev = xhr.upload.onprogress;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) { sentBytes = e.loaded; totalBytes = e.total; }
        if (prev) prev(e);
      };
    }
    xhr.onerror = () => {
      if (nativeXhr) {
        // Direct WebView request refused before any answer: usually the API's CORS list does not include the app's
        // origin (https://localhost). Small files can still go through Capacitor's native HTTP; big ones cannot.
        let size = 0;
        let info = '';
        try {
          for (const [, v] of formData.entries()) {
            if (v instanceof Blob) { size += v.size; info += `${v.name || 'blob'}|${v.type || '?'}|${v.size}B `; }
          }
        } catch { size = Infinity; info = 'entries-failed'; }
        const willRetry = !(signal && signal.aborted);
        reportClientIssue('upload_direct_failed', {
          method, path, bytes: Number.isFinite(size) ? size : null, durationMs: Date.now() - startedAt,
          message: 'WebView XHR failed before any server answer' + (willRetry ? ' (retrying with fetch)' : ' (not retried)'),
          meta: { stage: 'direct', sent: sentBytes, total: totalBytes, readyState: xhr.readyState, status: xhr.status, willRetry, files: describeFiles(formData) },
        });
        // Direct WebView XHR died before any answer (nothing reached the server). Retry through Capacitor's native HTTP for
        // anything up to 40MB (it is slower, but it works for in-memory files such as freshly edited videos/photos/voice).
        if (!(signal && signal.aborted)) { resolve(xhrUpload(method, path, formData, onProgress, signal, channel, true)); return; }
        reject(new ApiError(msg(
          `Could not reach the server from the app. If the website works, add https://localhost to CORS_ALLOWED_ORIGINS on the server. [${info.trim()}]`,
          `تعذّر الاتصال بالسيرفر من التطبيق. لو الموقع شغال، ضيف https://localhost في CORS_ALLOWED_ORIGINS على السيرفر. [${info.trim()}]`,
        ), 0, null));
        return;
      }
      if (viaBridge) {
        reportClientIssue('upload_native_failed', {
          method, path, durationMs: Date.now() - startedAt, message: 'Native HTTP retry failed too (xhr status ' + xhr.status + ')',
          meta: { stage: 'native-retry', sent: sentBytes, total: totalBytes, readyState: xhr.readyState, status: xhr.status, files: describeFiles(formData) },
        });
      }
      reject(new ApiError(msg('Network error — please check your connection.', 'خطأ في الشبكة — من فضلك تحقق من اتصالك.') + (viaBridge ? ' [native-retry]' : ''), 0, null));
    };
    xhr.onabort = () => reject(new ApiError(msg('Upload cancelled.', 'تم إلغاء الرفع.'), 0, null));
    xhr.onload = async () => {
      try { resolve(await parseUploadResponse(xhr.status, xhr.responseText, channel, method, path)); } catch (e) { reject(e); }
    };
    xhr.send(formData);
  });
}

// 428 = the server wants (or lost) the secure-channel key: re-negotiate once and resend (it refuses before running anything).
const needsChannel = (err) => err instanceof ApiError && err.status === 428;

async function uploadOnce(method, path, formData, onProgress, signal) {
  try {
    return await xhrUpload(method, path, formData, onProgress, signal, await getXhrChannel(false));
  } catch (err) {
    if (!needsChannel(err)) throw err;
    return xhrUpload(method, path, formData, onProgress, signal, await getXhrChannel(true));
  }
}

async function uploadRequest(method, path, formData, onProgress, signal) {
  const usedAccess = getTokens().accessToken;
  try {
    return await uploadOnce(method, path, formData, onProgress, signal);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && !path.startsWith('/api/v1/auth/')) {
      try {
        await refreshAccessToken(usedAccess);
      } catch (refreshErr) {
        if (refreshFailureIsTransient(refreshErr)) throw refreshErr;
        clearTokens();
        throw err;
      }
      return uploadOnce(method, path, formData, onProgress, signal);
    }
    throw err;
  }
}

// ---- GET de-duplication ----------------------------------------------------
// Several shell components (topbar, sidebar, gates...) ask for the SAME endpoint within the same
// moment on every page load. Identical GETs that are still in flight now share ONE network request,
// and a few cheap "shell" endpoints are also remembered for a few seconds. Any successful write
// (MUTATION_EVENT) forgets everything, so screens never show stale data after a change.
const SHARED_GET_TTL_MS = 4000;
const SHAREABLE_GET = /^\/api\/v1\/(notifications(\/counts)?(\?|$)|guides(\?|$)|students\/me\/access|auth\/(permissions|mfa\/status)|device-status|app\/summary)/;
const sharedGets = new Map(); // key -> { at, settled, promise }
const cloneResult = (r) => {
  if (typeof Response !== 'undefined' && r instanceof Response) return r.clone();
  try { return typeof structuredClone === 'function' ? structuredClone(r) : JSON.parse(JSON.stringify(r)); } catch { return r; }
};
if (typeof window !== 'undefined') {
  window.addEventListener(MUTATION_EVENT, () => sharedGets.clear());
}
function sharedGet(path, params) {
  const key = `${(getTokens().accessToken || '').slice(-24)}|${path}|${params ? JSON.stringify(params) : ''}`;
  const hit = sharedGets.get(key);
  if (hit && (!hit.settled || (SHAREABLE_GET.test(path) && Date.now() - hit.at < SHARED_GET_TTL_MS))) {
    return hit.promise.then(cloneResult);
  }
  const entry = { at: Date.now(), settled: false, promise: null };
  entry.promise = request('GET', path, { params }).then(
    (r) => { entry.settled = true; entry.at = Date.now(); return r; },
    (e) => { sharedGets.delete(key); throw e; },
  );
  sharedGets.set(key, entry);
  if (sharedGets.size > 200) sharedGets.delete(sharedGets.keys().next().value);
  return entry.promise.then(cloneResult);
}

export const api = {
  get: (path, params, headers) => (headers ? request('GET', path, { params, headers }) : sharedGet(path, params)),
  /** GET a file. Same Bearer + refresh-on-401 path as every other call; returns the Response. */
  blob: (path, params, headers) => request('GET', path, { params, asResponse: true, headers: { Accept: '*/*', ...(headers || {}) } }),
  post: (path, body, headers) => request('POST', path, { body, ...(headers ? { headers } : {}) }),
  /** POST that does NOT fire MUTATION_EVENT (high-frequency background traffic such as call signaling: no page should refetch for it). */
  postQuiet: (path, body) => request('POST', path, { body, silent: true }),
  put: (path, body) => request('PUT', path, { body }),
  patch: (path, body) => request('PATCH', path, { body }),
  postForm: (path, formData) => request('POST', path, { formData }),
  /** POST multipart with upload progress: onProgress(0-100). Pass an AbortSignal to make it cancellable. */
  postFormProgress: (path, formData, onProgress, signal) => uploadRequest('POST', path, formData, onProgress, signal),
  putForm: (path, formData) => request('PUT', path, { formData }),
  del: (path, body) => request('DELETE', path, { body }),
};

// `delete` is a valid object-property name (not a reserved word in this
// position), so this is a safe alias — several pages (FacultyStudents,
// UniversityStudents, UniversityAcademicStaff, UniversitySupervisors,
// FacultyAcademicStaff) call `api.delete(...)` instead
// of `api.del(...)`, which previously threw "api.delete is not a
// function" since only `del` was exported.
api.delete = api.del;
