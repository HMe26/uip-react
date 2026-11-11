/**
 * Per-user activity tracker — feeds Admin → Users → User details → Activity.
 *
 * Records, for the signed-in person only: page views, clicks (what was clicked and on which page), rage clicks, form submits
 * (form name + field NAMES), JavaScript errors, unhandled promise rejections and network failures (requests that never reached
 * the server). HTTP failures and every write request are logged by the server itself (UipActivityLogMiddleware) with the message
 * the person saw, so they are not duplicated here.
 *
 * Privacy: never reads typed values; password / OTP / card fields and anything marked data-no-track are ignored; labels are
 * the visible text of buttons/links only (clipped). Sent in small batches; at most MAX_QUEUE events are ever held.
 */

const SESSION_KEY = 'uip_activity_sid';
const FLUSH_MS = 6000;
const MAX_QUEUE = 120;
const BATCH = 40;
const TRACK_PATH = '/api/v1/activity/track';

let queue = [];
let timer = null;
let installed = false;
let enabled = false;
let currentPath = '';
let sid = '';
let sending = false;
let clickBurst = { key: '', at: 0, n: 0 };
const errorSeen = new Map(); // de-duplicates the same JS error fired in a loop

function uuid() {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch { /* old browser */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sessionId() {
  if (sid) return sid;
  try {
    sid = sessionStorage.getItem(SESSION_KEY) || '';
    if (!sid) { sid = uuid(); sessionStorage.setItem(SESSION_KEY, sid); }
  } catch { sid = uuid(); }
  return sid;
}

/** Headers added to every API call so the server log knows which page / browser visit a request came from. */
export function activityHeaders() {
  if (!enabled) return {};
  return { 'X-UIP-Page': String(currentPath || '').slice(0, 300), 'X-UIP-Activity-Session': sessionId() };
}

function clip(s, n) {
  const v = String(s ?? '').replace(/\s+/g, ' ').trim();
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
}

function push(ev) {
  if (!enabled) return;
  queue.push({ ts: Date.now(), path: currentPath, ...ev });
  if (queue.length > MAX_QUEUE) queue = queue.slice(queue.length - MAX_QUEUE);
  if (queue.length >= BATCH) flush();
}

export async function flush() {
  if (!enabled || sending || !queue.length) return;
  sending = true;
  const batch = queue.slice(0, BATCH);
  queue = queue.slice(batch.length);
  try {
    const { api } = await import('../api/client');
    await api.postQuiet(TRACK_PATH, { session_id: sessionId(), events: batch });
  } catch {
    // Offline / expired token: put them back (bounded) and try again on the next tick.
    queue = batch.concat(queue).slice(-MAX_QUEUE);
  } finally {
    sending = false;
  }
}

// ---------------------------------------------------------------- label helpers

const CLICKABLE = 'button, a, [role="button"], [role="tab"], [role="menuitem"], [role="switch"], [role="checkbox"], [role="option"], summary, label, input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"], select';

function sensitive(el) {
  if (!el || el.closest?.('[data-no-track]')) return true;
  const t = (el.getAttribute?.('type') || '').toLowerCase();
  const ac = (el.getAttribute?.('autocomplete') || '').toLowerCase();
  return t === 'password' || /one-time|cc-|current-password|new-password/.test(ac);
}

function describe(el) {
  const tag = el.tagName.toLowerCase();
  const aria = el.getAttribute('aria-label') || el.getAttribute('title') || '';
  let text = aria;
  if (!text && (tag === 'input')) text = el.getAttribute('value') && ['submit', 'button'].includes(el.type) ? el.getAttribute('value') : (el.getAttribute('name') || el.id || '');
  if (!text && tag === 'select') text = el.getAttribute('name') || el.id || 'select';
  if (!text) text = el.innerText || el.textContent || '';
  text = clip(text, 70);
  if (!text) text = clip(el.getAttribute('data-testid') || el.id || el.getAttribute('name') || el.className?.toString().split(' ')[0] || '', 50);
  let kind = tag === 'a' ? 'link' : tag === 'input' ? (el.type || 'input') : tag === 'select' ? 'dropdown' : (el.getAttribute('role') || tag);
  if (tag === 'button' || kind === 'button') kind = 'button';
  const href = tag === 'a' ? (el.getAttribute('href') || '') : '';
  return { kind, text: text || '(no label)', href: href && !/^javascript:/i.test(href) ? clip(href.replace(/^https?:\/\/[^/]+/i, ''), 200) : '' };
}

function onClick(e) {
  try {
    if (!enabled || !e.isTrusted) return;
    const raw = e.target instanceof Element ? e.target : null;
    if (!raw) return;
    const el = raw.closest(CLICKABLE) || null;
    if (!el || sensitive(el) || sensitive(raw)) return;
    const { kind, text, href } = describe(el);
    const target = `${kind} · ${text}`;
    const now = Date.now();
    const key = `${currentPath}|${target}`;
    if (clickBurst.key === key && now - clickBurst.at < 1200) clickBurst.n += 1; else clickBurst = { key, at: now, n: 1 };
    clickBurst.at = now;
    if (clickBurst.n === 3) {
      push({ type: 'rage_click', severity: 'warning', title: `Rage click on "${text}"`, target, message: 'Clicked 3+ times in a row — the control may not be responding.', details: { kind } });
      return;
    }
    if (clickBurst.n > 3) return;
    const details = { kind, x: Math.round(e.clientX), y: Math.round(e.clientY) };
    if (href) details.href = href;
    push({ type: 'click', title: `Clicked ${kind} "${text}"`, target, details });
  } catch { /* tracking must never break a click */ }
}

function onSubmit(e) {
  try {
    const form = e.target;
    if (!enabled || !(form instanceof HTMLFormElement) || form.closest('[data-no-track]')) return;
    const name = clip(form.getAttribute('aria-label') || form.getAttribute('name') || form.id || form.querySelector('button[type="submit"], input[type="submit"]')?.textContent || 'form', 80);
    const fields = [];
    let filled = 0;
    Array.from(form.elements || []).forEach((f) => {
      if (!f.name || f.type === 'password' || f.type === 'hidden' || f.type === 'submit' || f.type === 'button' || sensitive(f)) return;
      fields.push(f.name);
      if ((f.type === 'checkbox' || f.type === 'radio') ? f.checked : String(f.value || '').length > 0) filled += 1;
    });
    push({ type: 'form_submit', title: `Submitted form "${name}"`, target: name, details: { fields: fields.slice(0, 30), filled_count: filled, empty_count: Math.max(0, fields.length - filled) } });
  } catch { /* ignore */ }
}

function jsError(kind, message, extra) {
  const msg = clip(message, 400);
  const key = `${kind}|${msg}`;
  const now = Date.now();
  const last = errorSeen.get(key) || 0;
  if (now - last < 5000) return; // same error repeating in a loop
  errorSeen.set(key, now);
  if (errorSeen.size > 60) errorSeen.clear();
  push({ type: 'js_error', severity: 'error', title: kind === 'rejection' ? 'Unhandled promise rejection' : 'JavaScript error', message: msg, details: extra });
}

function onWindowError(e) {
  if (e?.target && e.target !== window && e.target.tagName) { // a <script>/<img>/<link> that failed to load
    const src = e.target.src || e.target.href || '';
    if (src && !/\.(png|jpe?g|gif|webp|svg|ico)(\?|$)/i.test(src)) jsError('resource', `Failed to load ${e.target.tagName.toLowerCase()}: ${src.replace(/^https?:\/\/[^/]+/i, '')}`, {});
    return;
  }
  if (/ResizeObserver loop/i.test(e?.message || '')) return;
  jsError('error', e?.message || 'Script error', { file: clip(String(e?.filename || '').replace(/^https?:\/\/[^/]+/i, ''), 160), line: e?.lineno, col: e?.colno, stack: clip(e?.error?.stack || '', 1200) });
}

function onRejection(e) {
  const r = e?.reason;
  if (r && r.name === 'ApiError') return; // already logged server-side with its message
  jsError('rejection', r?.message || String(r || 'Rejected'), { stack: clip(r?.stack || '', 1200) });
}

function onOnline() { push({ type: 'custom', title: 'Connection restored', details: {} }); }
function onOffline() { push({ type: 'network_error', severity: 'warning', title: 'Went offline', message: 'The browser lost its internet connection.', details: {} }); }

function onHide() {
  if (document.visibilityState === 'hidden') flush();
}

// ---------------------------------------------------------------- public API

/** Called by api/client.js when a request never got an answer (offline, timeout, DNS…). */
export function noteNetworkFailure({ method, path, message, durationMs }) {
  if (!enabled || String(path).startsWith(TRACK_PATH)) return;
  push({
    type: 'network_error', severity: 'error', title: `${method} ${String(path).split('?')[0]} — no response`,
    method, url: String(path).split('?')[0], status: 0, duration_ms: durationMs, message: clip(message, 300),
    details: { online: typeof navigator !== 'undefined' ? navigator.onLine : null },
  });
}

/** Called on every route change. */
export function trackPageView(path, title) {
  currentPath = path;
  push({ type: 'page_view', title: `Opened ${path.split('?')[0] || '/'}`, path, details: { page_title: clip(title || '', 120), referrer: clip(document.referrer ? document.referrer.replace(/^https?:\/\/[^/]+/i, '') : '', 160), viewport: `${window.innerWidth}×${window.innerHeight}`, lang: document.documentElement.lang || '' } });
}

/** Called on sign-in / sign-out transitions. */
export function trackAuthEvent(title, details = {}) {
  push({ type: 'auth', title, details });
}

export function startActivityTracking() {
  if (typeof window === 'undefined') return;
  enabled = true;
  sessionId();
  if (installed) return;
  installed = true;
  document.addEventListener('click', onClick, true);
  document.addEventListener('submit', onSubmit, true);
  window.addEventListener('error', onWindowError, true);
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);
  timer = setInterval(flush, FLUSH_MS);
}

export function stopActivityTracking() {
  flush();
  enabled = false;
  queue = [];
  if (!installed) return;
  installed = false;
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('submit', onSubmit, true);
  window.removeEventListener('error', onWindowError, true);
  window.removeEventListener('unhandledrejection', onRejection);
  window.removeEventListener('online', onOnline);
  window.removeEventListener('offline', onOffline);
  document.removeEventListener('visibilitychange', onHide);
  window.removeEventListener('pagehide', flush);
  if (timer) clearInterval(timer);
  timer = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  sid = '';
}
