/**
 * Android (Capacitor) glue. Does nothing in a normal browser.
 *  - prefixes relative /api and /uploads calls with the backend address (the web build relies on a
 *    Vercel/Netlify proxy that does not exist inside the app);
 *  - marks <html class="is-native"> so CSS can adjust for the app;
 *  - hides the splash screen once React has painted;
 *  - Android back button: go back in history, exit only from the home screen.
 */
import { Capacitor, CapacitorCookies, registerPlugin } from '@capacitor/core';
import { STAFF_LOGIN_PATH } from './config/staffPortal';
import { getDeviceId } from './lib/examSession';

export const isNative = Capacitor.isNativePlatform();

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');

/**
 * Reads a cookie of the API domain from the native cookie store. Inside the app the page runs on https://localhost while the
 * API lives on another domain, so document.cookie never shows the API's `uip_csrf` cookie. Without it the refresh call has no
 * X-CSRF-Token and the server answers 403: the 15-minute access token could not be renewed and the person was signed out.
 */
export async function readNativeCookie(name) {
  if (!isNative || !API_BASE) return '';
  try {
    const all = await CapacitorCookies.getCookies({ url: API_BASE });
    const v = all?.[name];
    return v ? decodeURIComponent(v) : '';
  } catch { return ''; }
}

// Build-time app token (issued from /admin/mobile, baked into the APK via VITE_APP_TOKEN). The API refuses app
// requests without a valid one once APP_TOKEN_REQUIRED=true on the server.
// Runtime token: fetched from /api/v1/app-config at launch (set in Admin → Platform Policy, no rebuild), cached in
// localStorage; the build-time VITE_APP_TOKEN stays as the last-resort fallback.
const TOKEN_CACHE_KEY = 'uip_app_token';
let APP_TOKEN = (() => {
  try { return (localStorage.getItem(TOKEN_CACHE_KEY) || '').trim(); } catch { return ''; }
})() || (import.meta.env.VITE_APP_TOKEN || '').trim();
let tokenReady = Promise.resolve();

function loadRuntimeToken(rawFetch) {
  tokenReady = Promise.race([
    rawFetch(`${API_BASE}/api/v1/app-config`, { headers: { 'X-UIP-Client': 'android' }, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const t = String(j?.data?.app_token || '').trim();
        if (t) APP_TOKEN = t;
        try { t ? localStorage.setItem(TOKEN_CACHE_KEY, t) : localStorage.removeItem(TOKEN_CACHE_KEY); } catch { /* storage blocked */ }
      })
      .catch(() => {}),
    new Promise((res) => setTimeout(res, 4000)), // never hold the app hostage to a slow call
  ]);
}
/**
 * Big uploads skip the Vercel proxy. Everything under /api normally goes browser -> Vercel (rewrite + middleware) -> Railway, and
 * Vercel refuses request bodies over ~4.5MB: the phone saw it as "failed before any server answer" (the refusal carries no CORS
 * headers) for every video above that size while small ones went through. Files bigger than DIRECT_UPLOAD_MIN go straight to the
 * API host instead (its CORS already allows the app origin). Override with VITE_DIRECT_UPLOAD_BASE; set it to "off" to disable.
 */
const DIRECT_RAW = (import.meta.env.VITE_DIRECT_UPLOAD_BASE ?? (import.meta.env.PROD ? 'https://uip-laravel-production.up.railway.app' : '')).trim();
export const DIRECT_UPLOAD_BASE = DIRECT_RAW === 'off' ? '' : DIRECT_RAW.replace(/\/+$/, '');
export const DIRECT_UPLOAD_MIN = 3 * 1024 * 1024;
export function directUploadUrl(path, formData) {
  if (!DIRECT_UPLOAD_BASE || typeof path !== 'string' || !/^\/api\//.test(path)) return path;
  let size = 0;
  try { for (const [, v] of formData.entries()) if (v instanceof Blob) size += v.size; } catch { return path; }
  return size > DIRECT_UPLOAD_MIN ? DIRECT_UPLOAD_BASE + path : path;
}

const isApiUrl = (u) => typeof u === 'string' && /^\/(api)(\/|\?|$)/.test(u)
  || (typeof u === 'string' && !!API_BASE && u.startsWith(`${API_BASE}/api`))
  || (typeof u === 'string' && !!DIRECT_UPLOAD_BASE && u.startsWith(`${DIRECT_UPLOAD_BASE}/api`));

function withAppHeaders(headers) {
  const h = new Headers(headers || {});
  h.set('X-UIP-Client', 'android');
  h.set('X-Device-Id', getDeviceId()); // one stable id per install, so the admin token page counts this phone once
  if (APP_TOKEN) h.set('X-App-Token', APP_TOKEN);
  return h;
}

function showUnauthorizedApp() {
  if (document.getElementById('uip-app-blocked')) return;
  const ar = (document.documentElement.lang || navigator.language || '').startsWith('ar');
  const d = document.createElement('div');
  d.id = 'uip-app-blocked';
  d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#F4F6FF;color:#1b2559;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px;font-family:system-ui,sans-serif';
  d.dir = ar ? 'rtl' : 'ltr';
  d.innerHTML = `<h2 style="margin:0 0 12px">${ar ? 'هذه النسخة من التطبيق غير مصرّح بها' : 'This app build is not authorized'}</h2><p style="margin:0;max-width:320px;line-height:1.6">${ar ? 'يرجى تثبيت أحدث نسخة رسمية من التطبيق.' : 'Please install the latest official version of the app.'}</p>`;
  document.body.appendChild(d);
}

async function guard(promise) {
  const res = await promise;
  if (res.status === 403) {
    try { if ((await res.clone().json())?.code === 'app_token_invalid') showUnauthorizedApp(); } catch { /* not JSON */ }
  }
  return res;
}

/** In the app the page origin is https://localhost, so root-relative /uploads and /api paths must point at the API server. */
export function absolutizeForNative(url) {
  return isNative ? absolutize(url) : url;
}

function absolutize(url) {
  return typeof url === 'string' && API_BASE && /^\/(api|uploads)(\/|\?|$)/.test(url) ? API_BASE + url : url;
}

/**
 * XHR for big multipart uploads (videos, audio, files) inside the app.
 *
 * With `CapacitorHttp.enabled` Capacitor replaces window.XMLHttpRequest by a version that reads every File into a
 * base64 string, ships it through the JS<->native bridge and fires NO upload progress events. A short clip froze the
 * bubble on "0%" forever (and photos only worked because they are small). Capacitor keeps the real WebView XHR in
 * window.CapacitorWebXMLHttpRequest.fullObject; it streams the file straight from disk and reports real progress.
 *
 * Returns an opened XHR (headers for the API already set) or null when not in the app / the original is missing,
 * so the caller falls back to the normal XHR. The call goes straight from the WebView to the API: the API's CORS
 * middleware already echoes the Origin and allows Authorization / X-App-Token / X-UIP-Client / X-Enc-Kid.
 */
export function openUploadXhr(method, url) {
  try {
    const W = isNative && window.CapacitorWebXMLHttpRequest;
    const Orig = W && W.fullObject;
    if (!Orig) return null;
    const xhr = new Orig();
    // Capacitor patches the PROTOTYPE of this same class (open / send / setRequestHeader keep a private `_headers` store that does
    // not exist on this instance), which is what threw "Cannot set properties of undefined (setting 'X-UIP-Client')". Put the
    // browser's ORIGINAL methods (saved by Capacitor in window.CapacitorWebXMLHttpRequest) on the instance so they win.
    ['open', 'send', 'setRequestHeader', 'abort', 'getAllResponseHeaders', 'getResponseHeader', 'overrideMimeType'].forEach((k) => {
      if (typeof W[k] === 'function') { try { xhr[k] = W[k].bind(xhr); } catch { /* keep prototype method */ } }
    });
    const target = absolutize(String(url));
    xhr.open(method, target);
    if (isApiUrl(target)) {
      xhr.setRequestHeader('X-UIP-Client', 'android');
      xhr.setRequestHeader('X-Device-Id', getDeviceId());
      if (APP_TOKEN) xhr.setRequestHeader('X-App-Token', APP_TOKEN);
    }
    return xhr;
  } catch {
    return null; // caller falls back to fetch (streams the file, no progress) instead of crashing
  }
}

export function initNative() {
  if (!isNative) return;
  document.documentElement.classList.add('is-native');
  // [ANDROID-PERF] No decorative animations inside the app (114 infinite CSS animations keep the WebView repainting). Spinners / loaders
  // are kept by the data-motion="off" rule itself. motionPolicy.js never switches it back on in the app.
  document.documentElement.dataset.motion = 'off';

  const nativeFetch = window.fetch.bind(window);
  // Capacitor keeps the browser's own fetch in window.CapacitorWebFetch. Uploads (FormData bodies) must use it:
  // CapacitorHttp's fetch reads every file into base64 and pushes it through the JS<->native bridge, which fails or
  // hangs for videos and other big files. The real fetch streams the file straight from the WebView.
  const webFetch = typeof window.CapacitorWebFetch === 'function' ? window.CapacitorWebFetch.bind(window) : null;
  const isLocalAsset = (u) => typeof u === 'string' && (/^\/(?!\/)/.test(u) || u.startsWith(location.origin)) && !isApiUrl(u);
  const isUpload = (init) => !!webFetch && typeof FormData !== 'undefined' && init?.body instanceof FormData;
  // Server-Sent Events (the AI assistant's streamed answer): CapacitorHttp's fetch buffers the whole response until the server
  // closes it, so the bubble sat on "analysing…" and the turn stalled/timed out. The real fetch streams chunk by chunk.
  // Only headers the API's CORS list allows are sent on this path (Content-Type, Accept, Authorization, X-Requested-With + app headers).
  const isStream = (init) => !!webFetch && /text\/event-stream/i.test(String(new Headers(init?.headers || {}).get('Accept') || ''));
  loadRuntimeToken(nativeFetch);
  window.fetch = (input, init) => {
    if (typeof input === 'string') {
      const target = absolutize(input);
      const api = isApiUrl(target);
      if (api && !target.includes('/api/v1/app-config')) {
        return tokenReady.then(() => guard((isUpload(init) || isStream(init) ? webFetch : nativeFetch)(target, { ...init, headers: withAppHeaders(init?.headers) })));
      }
      // our own files (wasm models, worklets, fonts) live on https://localhost inside the WebView: CapacitorHttp cannot reach
      // them, so they use the browser's real fetch
      return guard((isLocalAsset(target) ? (webFetch || nativeFetch) : nativeFetch)(target, init));
    }
    if (input instanceof Request) {
      const path = input.url.startsWith(location.origin) ? input.url.slice(location.origin.length) : input.url;
      const target = absolutize(path);
      const api = isApiUrl(target);
      const req = target === path ? input : new Request(target, input);
      if (api) { return tokenReady.then(() => guard(nativeFetch(new Request(req, { headers: withAppHeaders(req.headers) }), init))); }
      return (isLocalAsset(target) ? (webFetch || nativeFetch) : nativeFetch)(req, init);
    }
    return nativeFetch(input, init);
  };
  // Capacitor re-installs its own XHR methods on the prototype every time a request object is created, so
  // patching the prototype does not stick. Wrap the constructor instead and rewrite the URL in open().
  // (Without this, POST/PUT uploads such as photos went out with a relative URL and failed with
  //  "setRequestHeader ... state must be OPENED".)
  const NativeXHR = window.XMLHttpRequest;
  function UipXHR() {
    const target = new NativeXHR();
    return new Proxy(target, {
      get(o, p) {
        if (p === 'open') {
          return (method, url, ...rest) => {
            const target = absolutize(String(url));
            const r = o.open(method, target, ...rest);
            if (isApiUrl(target)) {
              // Capacitor's patched XHR can throw here ("Cannot set properties of undefined") when its header store is not
              // ready yet. Never let that kill the request: retry right before send(), and ignore if it still refuses.
              const hdrs = [['X-UIP-Client', 'android'], ['X-Device-Id', getDeviceId()]];
              if (APP_TOKEN) hdrs.push(['X-App-Token', APP_TOKEN]);
              const pending = [];
              hdrs.forEach(([k, v]) => { try { o.setRequestHeader(k, v); } catch { pending.push([k, v]); } });
              if (pending.length) o.__uipPending = pending;
            }
            return r;
          };
        }
        if (p === 'send') {
          return (...args) => {
            (o.__uipPending || []).forEach(([k, v]) => { try { o.setRequestHeader(k, v); } catch { /* give up on this header */ } });
            o.__uipPending = null;
            return o.send(...args);
          };
        }
        const v = o[p];
        return typeof v === 'function' ? v.bind(o) : v;
      },
      set(o, p, v) { o[p] = v; return true; },
    });
  }
  UipXHR.prototype = NativeXHR.prototype;
  Object.assign(UipXHR, NativeXHR);
  window.XMLHttpRequest = UipXHR;

  checkWebViewVersion();
  patchDomUrls();
  setupBackButton();
  setupPullToRefresh();
  setupStaffAccess();
  setupExternalLinks();
  setTimeout(requestStartupPermissions, 2500);
  setupMediaPermissions();
  import('@capacitor/app').then(({ App }) => { App.addListener('appStateChange', (st) => { if (st.isActive) { recheckPermissions(); resyncPushOnResume(); } }); }).catch(() => {});
}


// ---- Old Android System WebView ---------------------------------------------------------------------------------------------
// The app's styles need a reasonably modern WebView (CSS inset / logical properties / flex gap / aspect-ratio / container queries,
// i.e. Chrome 105+). On Android 10 and older the WebView often stays at its factory version (Chrome 74-90), so the layout falls
// apart. The WebView is a normal Play Store app that updates independently of Android itself: tell the person to update it.
const MIN_WEBVIEW = 105;
function checkWebViewVersion() {
  try {
    const m = /Chrome\/(\d+)/.exec(navigator.userAgent || '');
    const v = m ? parseInt(m[1], 10) : 0;
    if (!v) return;
    document.documentElement.dataset.webview = String(v);
    if (v >= MIN_WEBVIEW) return;
    document.documentElement.classList.add('old-webview');
    const KEY = 'uip_webview_hint';
    try { if (localStorage.getItem(KEY) === String(v) && Date.now() - Number(localStorage.getItem(KEY + '_at') || 0) < 86400000) return; } catch { /* storage blocked */ }
    const ar = (document.documentElement.lang || localStorage.getItem('uip_locale') || navigator.language || '').startsWith('ar');
    const box = document.createElement('div');
    box.dir = ar ? 'rtl' : 'ltr';
    box.style.cssText = 'position:fixed;left:10px;right:10px;bottom:10px;z-index:2147483000;background:#1b2559;color:#fff;padding:14px 16px;border-radius:14px;font:600 13px/1.6 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.4)';
    const t = document.createElement('div');
    t.textContent = ar
      ? `نسخة Android System WebView على جهازك قديمة (${v}) فشكل التطبيق ممكن يبقى مكسور. حدّثها من Google Play وبعدها افتح التطبيق تاني.`
      : `Your Android System WebView is outdated (${v}), so the app may look broken. Update it from Google Play, then reopen the app.`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap';
    const a = document.createElement('a');
    a.href = 'https://play.google.com/store/apps/details?id=com.google.android.webview';
    a.target = '_blank';
    a.textContent = ar ? 'تحديث WebView' : 'Update WebView';
    a.style.cssText = 'background:#fff;color:#1b2559;padding:8px 14px;border-radius:999px;text-decoration:none;font-weight:700';
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = ar ? 'لاحقاً' : 'Later';
    b.style.cssText = 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5);padding:8px 14px;border-radius:999px;font:inherit';
    b.onclick = () => { try { localStorage.setItem(KEY, String(v)); localStorage.setItem(KEY + '_at', String(Date.now())); } catch { /* ignore */ } box.remove(); };
    row.append(a, b);
    box.append(t, row);
    const show = () => document.body.appendChild(box);
    document.body ? setTimeout(show, 1500) : window.addEventListener('DOMContentLoaded', () => setTimeout(show, 1500));
  } catch { /* never break the app for a hint */ }
}

// ---- Android back button ---------------------------------------------------
// react-router stores the position in the history stack in history.state.idx (0 = first page of this
// launch), which is more reliable than WebView.canGoBack(). Back goes one page back; on the first page
// it asks for a second press within 2 s before closing the app.
function setupBackButton() {
  let lastPress = 0;
  // A layer only counts when it is really on screen: chat pages keep hidden panels / dialogs in the DOM, and treating those as
  // "open" made the first back press do nothing (it only sent Escape to something invisible) - several presses were needed.
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && el.getAttribute('aria-hidden') !== 'true';
  };
  const findLayer = () => Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], .mr-menu, .msg-lightbox, .msg-emoji-popover')).find(visible) || null;
  import('@capacitor/app').then(({ App }) => {
    const goBack = () => {
      const idx = window.history.state && typeof window.history.state.idx === 'number' ? window.history.state.idx : 0;
      if (idx > 0) { window.history.back(); return; }
      const now = Date.now();
      if (now - lastPress < 2000) { App.exitApp(); return; }
      lastPress = now;
      toast(document.documentElement.lang === 'ar' || localStorage.getItem('uip_locale') === 'ar'
        ? 'اضغط مرة أخرى للخروج' : 'Press back again to exit');
    };
    App.addListener('backButton', () => {
      // Let an open dialog / menu / lightbox / emoji picker close first (they listen for Escape). If it is still there a moment
      // later it has no Escape handler, so go back right away instead of trapping the user.
      const layer = findLayer();
      if (layer) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        setTimeout(() => { if (visible(layer)) goBack(); }, 80);
        return;
      }
      goBack();
    });
  }).catch(() => {});
}

export function showToast(text) { toast(text); }

function toast(text) {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:99999;background:rgba(20,24,40,.92);color:#fff;padding:10px 18px;border-radius:999px;font:600 14px system-ui,sans-serif;pointer-events:none;';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

// ---- Pull to refresh -------------------------------------------------------
// Works with the page's own scroll containers: a pull only counts when the touched element and every
// scrollable ancestor is at the very top. Disabled during exams and inside meeting rooms, where a
// reload would lose the session.
function setupPullToRefresh() {
  const THRESHOLD = 80, MAX = 130;
  const blocked = () => /exam-attempt|\/room\b|\/live\b/.test(window.location.pathname);
  // Chats never do a full reload (lost draft / scroll). A pull inside the conversation list, the message list or the
  // chat-center page asks the page to refresh its own data instead ('uip:pull-refresh', see Messages.jsx / MessagesCenter.jsx).
  const inChat = () => document.body.classList.contains('msg-page-active') || document.body.classList.contains('msg-center-active');
  const CHAT_ZONE = '[data-conversation-list],[data-message-list],.mc';
  const ind = document.createElement('div');
  ind.setAttribute('aria-hidden', 'true');
  ind.style.cssText = 'position:fixed;top:8px;left:50%;z-index:99998;width:40px;height:40px;margin-left:-20px;border-radius:50%;background:#fff;box-shadow:0 4px 16px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;opacity:0;transform:translateY(-60px);pointer-events:none;transition:none;';
  ind.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4F5BE8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>';
  document.body.appendChild(ind);

  let startY = 0, startX = 0, pulling = false, dist = 0, active = false;

  const atTop = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight && n.scrollTop > 0) return false;
    }
    return (document.scrollingElement?.scrollTop || 0) <= 0;
  };
  const reset = () => {
    ind.style.transition = 'transform .2s, opacity .2s';
    ind.style.opacity = '0'; ind.style.transform = 'translateY(-60px)';
    pulling = false; dist = 0;
  };

  document.addEventListener('touchstart', (e) => {
    if (active || blocked() || e.touches.length !== 1) { pulling = false; return; }
    const t = e.target;
    if (t.closest && t.closest('input,textarea,select,[contenteditable],[role="dialog"],[aria-modal="true"],.modal,iframe,video,canvas')) { pulling = false; return; }
    if (inChat() && !(t.closest && t.closest(CHAT_ZONE))) { pulling = false; return; }
    startY = e.touches[0].clientY; startX = e.touches[0].clientX;
    pulling = atTop(t); dist = 0;
    ind.style.transition = 'none';
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!pulling || active) return;
    const dy = e.touches[0].clientY - startY, dx = Math.abs(e.touches[0].clientX - startX);
    if (dy <= 0 || dx > dy) { if (dy < -4) pulling = false; return; }
    dist = Math.min(MAX, dy * 0.5);
    ind.style.opacity = String(Math.min(1, dist / THRESHOLD));
    ind.style.transform = `translateY(${dist - 20 + 8}px) rotate(${dist * 4}deg)`;
  }, { passive: true });

  const end = () => {
    if (!pulling || active) return;
    if (dist >= THRESHOLD) {
      active = true;
      ind.style.transition = 'transform .15s';
      ind.style.opacity = '1';
      ind.style.transform = 'translateY(60px)';
      ind.firstChild.style.animation = 'uipSpin .8s linear infinite';
      if (!inChat()) { setTimeout(() => window.location.reload(), 250); return; }
      // chat: soft refresh. Pages register their loaders through detail.wait(promise); we spin until they finish (max 8 s).
      const jobs = [];
      try { window.dispatchEvent(new CustomEvent('uip:pull-refresh', { detail: { wait: (p) => jobs.push(Promise.resolve(p).catch(() => {})) } })); } catch { /* ignore */ }
      Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 8000))]).then(() => new Promise((r) => setTimeout(r, 350))).then(() => {
        ind.firstChild.style.animation = '';
        active = false;
        reset();
      });
    } else reset();
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', reset, { passive: true });

  const st = document.createElement('style');
  st.textContent = '@keyframes uipSpin{to{transform:rotate(360deg)}}';
  document.head.appendChild(st);
}

/** Called after the first React render. */
/** [ANDROID-PERF] Web fonts are requested only after the first paint (the <link> is removed from the native index.html). */
function loadFontsLater() {
  const href = document.querySelector('meta[name="uip-fonts"]')?.getAttribute('content');
  if (!href || document.getElementById('uip-fonts')) return;
  const add = () => { const l = document.createElement('link'); l.id = 'uip-fonts'; l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); };
  (window.requestIdleCallback || ((f) => setTimeout(f, 600)))(add, { timeout: 2500 });
}

export function hideSplash() {
  if (!isNative) return;
  loadFontsLater();
  import('@capacitor/splash-screen').then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration: 250 })).catch(() => {});
}

// ---- Staff sign-in (admin / data analyst / security) ----------------------------
// The staff page is deliberately not linked anywhere and the app has no address bar, so it is reached by
//  1) tapping the UIPE logo 7 times in a row (within 4 s) on any public/sign-in screen, or
//  2) opening a link:  uip://staff-access  (or https://uip-nub.vercel.app/staff-access if the phone is set
//     to open that site's links in the app).
function goTo(path) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function setupStaffAccess() {
  let taps = 0, timer = null;
  document.addEventListener('click', (e) => {
    const logo = e.target.closest && e.target.closest('.auth-brand, img[src*="logo/uipe-"]');
    if (!logo) return;
    taps += 1;
    clearTimeout(timer);
    timer = setTimeout(() => { taps = 0; }, 4000);
    if (taps >= 7) { taps = 0; goTo(STAFF_LOGIN_PATH); }
  }, true);

  import('@capacitor/app').then(({ App }) => {
    App.addListener('appUrlOpen', ({ url }) => {
      try {
        const u = new URL(url);
        const path = u.protocol === 'uip:' ? `/${u.host}${u.pathname}`.replace(/\/+$/, '') : u.pathname;
        if (path === STAFF_LOGIN_PATH || path.startsWith(`${STAFF_LOGIN_PATH}/`)) goTo(path + u.search);
      } catch { /* ignore malformed link */ }
    });
  }).catch(() => {});
}

// ---- Images / media / links ---------------------------------------------------
// Many pages write <img src="/uploads/avatars/x.jpg"> directly. On the web that resolves against the site
// (and the host proxies it); inside the app it would resolve against the app itself and break. Rewrite
// those URLs to the backend the moment they are assigned.
function patchDomUrls() {
  const SRC_TAGS = new Set(['IMG', 'VIDEO', 'AUDIO', 'SOURCE', 'IFRAME', 'EMBED', 'TRACK']);
  const fixAttr = (el, name, value) => {
    if (typeof value !== 'string') return value;
    const lower = name.toLowerCase();
    if ((lower === 'src' || lower === 'poster') && (SRC_TAGS.has(el.tagName) || lower === 'poster')) return absolutize(value);
    if (lower === 'href' && el.tagName === 'A') return absolutize(value);
    if (lower === 'srcset' && el.tagName === 'IMG') return value.replace(/(^|,\s*)(\/(?:uploads|api)\/[^\s,]+)/g, (m, p, u) => p + absolutize(u));
    return value;
  };

  const setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) { return setAttr.call(this, name, fixAttr(this, name, value)); };

  const wrapProp = (proto, prop) => {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.set) return;
    Object.defineProperty(proto, prop, { ...d, set(v) { d.set.call(this, fixAttr(this, prop, v)); } });
  };
  [[HTMLImageElement.prototype, 'src'], [HTMLImageElement.prototype, 'srcset'], [HTMLMediaElement.prototype, 'src'],
   [HTMLMediaElement.prototype, 'poster'], [HTMLVideoElement.prototype, 'poster'], [HTMLSourceElement.prototype, 'src'],
   [HTMLIFrameElement.prototype, 'src'], [HTMLAnchorElement.prototype, 'href']].forEach(([p, n]) => wrapProp(p, n));

  // inline styles: style={{ backgroundImage: 'url(/uploads/...)' }}
  const fixCss = (v) => (typeof v === 'string' ? v.replace(/url\((['"]?)(\/(?:uploads|api)\/[^)'"]+)\1\)/g, (m, q, u) => `url(${q}${absolutize(u)}${q})`) : v);
  const bg = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'backgroundImage');
  if (bg && bg.set) Object.defineProperty(CSSStyleDeclaration.prototype, 'backgroundImage', { ...bg, set(v) { bg.set.call(this, fixCss(v)); } });
  const sp = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function (n, v, pr) { return sp.call(this, n, /background|image|mask|cursor/.test(n) ? fixCss(v) : v, pr); };

  const open = window.open;
  window.open = (u, ...rest) => {
    if (typeof u === 'string' && !/^(blob:|data:|about:)/.test(u) && handleLink(absolutize(u))) return null;
    return open.call(window, typeof u === 'string' ? absolutize(u) : u, ...rest);
  };

  // anything rendered before the patch ran
  document.querySelectorAll('img[src^="/uploads"],img[src^="/api"],a[href^="/uploads"]').forEach((el) => {
    const attr = el.tagName === 'A' ? 'href' : 'src';
    setAttr.call(el, attr, absolutize(el.getAttribute(attr)));
  });
}

// ---- Links that would open "outside" / in a new tab -----------------------------
// The WebView cannot open new tabs, so target="_blank" links did nothing or jumped to the phone's browser.
//  - app pages  -> opened right here (same tab);
//  - websites / files -> opened in an in-app browser sheet; closing it (or Back) returns to the same screen.
function handleLink(href) {
  let u;
  try { u = new URL(href, window.location.href); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  if (u.origin === window.location.origin && !/^\/(uploads|api)(\/|$)/.test(u.pathname)) {
    goTo(u.pathname + u.search + u.hash);
    return true;
  }
  // Our own uploaded files open in the in-app viewer (no browser sheet, no address bar).
  const ownFile = /^\/(uploads|api)(\/|$)/.test(u.pathname) && (u.origin === window.location.origin || (API_BASE && u.origin === new URL(API_BASE).origin));
  if (ownFile) {
    let name = ''; try { name = decodeURIComponent(u.pathname.split('/').pop() || ''); } catch { name = u.pathname.split('/').pop() || ''; }
    window.dispatchEvent(new CustomEvent('uip:open-file', { detail: { url: u.href, name } }));
    return true;
  }
  import('@capacitor/browser').then(({ Browser }) => Browser.open({ url: u.href, presentationStyle: 'popover' })).catch(() => {});
  return true;
}

function setupExternalLinks() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button > 0) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const raw = a.getAttribute('href') || '';
    if (!raw || raw.startsWith('#') || /^(mailto:|tel:|sms:|javascript:|blob:|data:)/i.test(raw)) return;
    let u;
    try { u = new URL(a.href, window.location.href); } catch { return; }
    const internal = u.origin === window.location.origin && !/^\/(uploads|api)(\/|$)/.test(u.pathname);
    // plain in-app links are handled by react-router; only take over new-tab links and outside URLs
    if (internal && a.target !== '_blank') return;
    if (handleLink(a.href)) e.preventDefault();
  }, true);
}

// ---- Notifications ------------------------------------------------------------------
// Asks Android 13+ for the notification permission and lets the app show a system notification when a new
// UIPE notification arrives (see Topbar). While the app is closed, phone notifications need push (Firebase)
// on the backend as well - that is not part of this build.
let notifReady = false;
let localTapListening = false;
// ---- Permissions: ask at launch, and keep asking (politely) until they are granted --------------------------------------
// Notifications, then camera + microphone (chat voice/video, AI voice, meetings, exams). Whatever is still missing is asked
// again on later launches / returns to the app, but at most PERM_MAX_PER_DAY times per day and not closer than
// PERM_MIN_GAP_MS apart. Android stops showing its own dialog after a few refusals, so when a request comes back
// instantly refused, a small in-app card sends the person to the app's Settings page instead.
const PERM_LOG_KEY = 'uip_perm_prompts_v2';
const PERM_MAX_PER_DAY = 2;
const PERM_MIN_GAP_MS = 4 * 60 * 60 * 1000;
const NativeLinksPerm = isNative ? registerPlugin('NativeLinks') : null;

function permQuotaAllows() {
  try {
    const day = new Date().toDateString();
    const log = JSON.parse(localStorage.getItem(PERM_LOG_KEY) || 'null') || {};
    const n = log.day === day ? (log.n || 0) : 0;
    return n < PERM_MAX_PER_DAY && Date.now() - (log.last || 0) >= PERM_MIN_GAP_MS;
  } catch { return true; }
}
function permQuotaRecord() {
  try {
    const day = new Date().toDateString();
    const log = JSON.parse(localStorage.getItem(PERM_LOG_KEY) || 'null') || {};
    localStorage.setItem(PERM_LOG_KEY, JSON.stringify({ day, n: (log.day === day ? (log.n || 0) : 0) + 1, last: Date.now() }));
  } catch { /* storage blocked */ }
}

async function notificationsGranted() {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    return (await LocalNotifications.checkPermissions()).display === 'granted';
  } catch { return true; } // plugin unavailable: nothing to ask
}
/** true = both granted, false = at least one is not, null = the WebView cannot tell (then ask only on the first launch). */
async function mediaGranted() {
  if (!navigator.permissions?.query) return null;
  try {
    const states = await Promise.all(['camera', 'microphone'].map((name) => navigator.permissions.query({ name }).then((r) => r.state)));
    return states.every((x) => x === 'granted');
  } catch { return null; }
}

function showSettingsCard() {
  if (document.getElementById('uip-perm-card')) return;
  const ar = (localStorage.getItem('uip_locale') || document.documentElement.lang || '').startsWith('ar');
  const d = document.createElement('div');
  d.id = 'uip-perm-card';
  d.dir = ar ? 'rtl' : 'ltr';
  d.style.cssText = 'position:fixed;left:12px;right:12px;bottom:18px;z-index:99999;background:#fff;color:#1b2559;border-radius:18px;padding:14px 16px;box-shadow:0 12px 40px rgba(20,24,60,.28);font:600 14px/1.5 system-ui,sans-serif;display:flex;gap:10px;align-items:center;';
  const text = document.createElement('span');
  text.style.flex = '1';
  text.textContent = ar ? 'فعّل الإشعارات والكاميرا والميكروفون من إعدادات التطبيق عشان تشتغل كل الميزات.' : 'Turn on notifications, camera and microphone in the app settings so every feature works.';
  const go = document.createElement('button');
  go.type = 'button';
  go.textContent = ar ? 'الإعدادات' : 'Settings';
  go.style.cssText = 'border:0;border-radius:999px;background:#4F5BE8;color:#fff;padding:9px 16px;font:700 13px system-ui,sans-serif;';
  go.onclick = () => { d.remove(); NativeLinksPerm?.openAppSettings?.().catch(() => {}); };
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', ar ? 'إغلاق' : 'Close');
  close.style.cssText = 'border:0;background:transparent;color:#6b7399;font-size:22px;line-height:1;padding:2px 6px;';
  close.onclick = () => d.remove();
  d.append(text, go, close);
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 12000);
}

// ---- Background delivery (WhatsApp-style): Android battery optimisation / OEM auto-start kill closed apps and block their pushes ----
const BG_PROMPT_KEY = 'uip_bg_prompt_v1';
async function showBackgroundCard() {
  if (document.getElementById('uip-bg-card')) return;
  const ar = (localStorage.getItem('uip_locale') || document.documentElement.lang || '').startsWith('ar');
  const d = document.createElement('div');
  d.id = 'uip-bg-card';
  d.dir = ar ? 'rtl' : 'ltr';
  d.style.cssText = 'position:fixed;left:12px;right:12px;bottom:18px;z-index:99999;background:#fff;color:#1b2559;border-radius:18px;padding:14px 16px;box-shadow:0 12px 40px rgba(20,24,60,.28);font:600 14px/1.5 system-ui,sans-serif;display:flex;flex-direction:column;gap:10px;';
  const text = document.createElement('span');
  text.textContent = ar
    ? 'عشان توصلك الرسائل والإشعارات فورًا زي الواتساب حتى لو التطبيق مقفول، اسمح للتطبيق بالعمل في الخلفية.'
    : 'To receive messages and notifications instantly, like WhatsApp, even when the app is closed, allow it to run in the background.';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;';
  const btn = (label, primary, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = `border:0;border-radius:999px;padding:9px 16px;font:700 13px system-ui,sans-serif;${primary ? 'background:#4F5BE8;color:#fff;' : 'background:#eef0ff;color:#2a3470;'}`;
    b.onclick = fn;
    return b;
  };
  row.append(
    btn(ar ? 'السماح' : 'Allow', true, async () => { d.remove(); try { await NativeLinksPerm?.requestIgnoreBatteryOptimizations?.(); } catch { /* ignore */ } }),
    btn(ar ? 'إعدادات التشغيل التلقائي' : 'Auto-start settings', false, () => { d.remove(); NativeLinksPerm?.openAutoStartSettings?.().catch(() => {}); }),
    btn(ar ? 'لاحقًا' : 'Later', false, () => d.remove()),
  );
  d.append(text, row);
  document.body.appendChild(d);
}
/** Shown at most 3 times, a week apart, and only while Android still restricts the app in the background. */
async function ensureBackgroundDelivery() {
  if (!isNative || !NativeLinksPerm?.batteryStatus) return;
  try {
    if (!(await notificationsGranted())) return;
    const st = await NativeLinksPerm.batteryStatus();
    if (st?.ignoring) return;
    let log = { n: 0, ts: 0 };
    try { log = JSON.parse(localStorage.getItem(BG_PROMPT_KEY) || '') || log; } catch { /* first time */ }
    if (log.n >= 3 || Date.now() - log.ts < 7 * 24 * 3600 * 1000) return;
    try { localStorage.setItem(BG_PROMPT_KEY, JSON.stringify({ n: log.n + 1, ts: Date.now() })); } catch { /* storage blocked */ }
    showBackgroundCard();
  } catch { /* old APK without the new native methods */ }
}


// ---- Incoming-call screen (WhatsApp style): needs "display over other apps" + (Android 14+) full-screen notifications ----
const CALL_PROMPT_KEY = 'uip_call_screen_prompt_v1';
async function ensureCallScreenPermissions() {
  if (!isNative || !NativeLinksPerm?.callScreenStatus) return;
  try {
    if (!(await notificationsGranted())) return;
    const st = await NativeLinksPerm.callScreenStatus();
    if (st?.fsi !== false && st?.overlay !== false) return;
    let log = { n: 0, ts: 0 };
    try { log = JSON.parse(localStorage.getItem(CALL_PROMPT_KEY) || '') || log; } catch { /* first time */ }
    if (log.n >= 4 || Date.now() - log.ts < 2 * 24 * 3600 * 1000) return;
    try { localStorage.setItem(CALL_PROMPT_KEY, JSON.stringify({ n: log.n + 1, ts: Date.now() })); } catch { /* storage blocked */ }
    const pick = await permissionCard('uip-call-card',
      'عشان شاشة المكالمة تظهر لك على طول زي الواتساب حتى والتطبيق مقفول، فعّل "الظهور فوق التطبيقات الأخرى" للتطبيق.',
      'So the call screen pops up instantly like WhatsApp, even with the app closed, allow "Display over other apps" for UIPE.',
      [{ id: 'go', ar: 'تفعيل', en: 'Enable', primary: true }, { id: 'later', ar: 'لاحقًا', en: 'Later' }]);
    if (pick === 'go') await NativeLinksPerm.openCallScreenSettings({ kind: st.overlay === false ? 'overlay' : 'fsi' });
  } catch { /* old APK without the new native methods */ }
}

// ---- Location permission, asked the way polished apps do: a short reason first, then Android's own dialog ----
const LOC_PROMPT_KEY = 'uip_loc_prompt_v1';
async function locationPermState() {
  try {
    const { Geolocation } = await import('@capacitor/geolocation');
    const p = await Geolocation.checkPermissions();
    if (p.location === 'granted' || p.coarseLocation === 'granted') return 'granted';
    return p.location === 'denied' ? 'denied' : 'prompt';
  } catch { return 'unsupported'; }
}
/** Card with a reason + buttons. Resolves with the id of the button that was pressed ('later' when closed/ignored). */
function permissionCard(id, textAr, textEn, buttons) {
  return new Promise((resolve) => {
    document.getElementById(id)?.remove();
    const ar = (localStorage.getItem('uip_locale') || document.documentElement.lang || '').startsWith('ar');
    const d = document.createElement('div');
    d.id = id;
    d.dir = ar ? 'rtl' : 'ltr';
    d.style.cssText = 'position:fixed;left:12px;right:12px;bottom:18px;z-index:99999;background:#fff;color:#1b2559;border-radius:18px;padding:16px;box-shadow:0 12px 40px rgba(20,24,60,.28);font:600 14px/1.6 system-ui,sans-serif;display:flex;flex-direction:column;gap:12px;';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;gap:10px;align-items:flex-start;';
    head.innerHTML = '<span style="flex:none;width:38px;height:38px;border-radius:50%;background:#e9ecff;display:grid;place-items:center;color:#4F5BE8"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg></span>';
    const text = document.createElement('span');
    text.style.flex = '1';
    text.textContent = ar ? textAr : textEn;
    head.appendChild(text);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;';
    const done = (v) => { d.remove(); resolve(v); };
    buttons.forEach((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = ar ? b.ar : b.en;
      el.style.cssText = `border:0;border-radius:999px;padding:9px 18px;font:700 13px system-ui,sans-serif;${b.primary ? 'background:#4F5BE8;color:#fff;' : 'background:#eef0ff;color:#2a3470;'}`;
      el.onclick = () => done(b.id);
      row.appendChild(el);
    });
    d.append(head, row);
    document.body.appendChild(d);
    setTimeout(() => done('later'), 30000);
  });
}
/** First run / after an update: explain why, then show the system dialog. A permission refused for good gets a Settings card instead. */
async function ensureLocationPermission() {
  if (!isNative) return;
  try {
    const st = await locationPermState();
    if (st === 'granted' || st === 'unsupported') return;
    let log = { n: 0, ts: 0 };
    try { log = JSON.parse(localStorage.getItem(LOC_PROMPT_KEY) || '') || log; } catch { /* first time */ }
    if (log.n >= 3 || Date.now() - log.ts < 3 * 24 * 3600 * 1000) return;
    try { localStorage.setItem(LOC_PROMPT_KEY, JSON.stringify({ n: log.n + 1, ts: Date.now() })); } catch { /* storage blocked */ }
    if (st === 'denied') {
      const r = await permissionCard('uip-loc-card',
        'إذن الموقع مرفوض. فعّله من إعدادات التطبيق عشان تقدر ترسل موقعك وتشارك موقعك المباشر في المحادثات.',
        'Location is turned off. Enable it in the app settings to send your location and share live location in chats.',
        [{ id: 'later', ar: 'لاحقًا', en: 'Later' }, { id: 'settings', ar: 'الإعدادات', en: 'Settings', primary: true }]);
      if (r === 'settings') NativeLinksPerm?.openAppSettings?.().catch(() => {});
      return;
    }
    const r = await permissionCard('uip-loc-card',
      'اسمح بالوصول لموقعك لإرسال مكانك ومشاركة موقعك المباشر في المحادثات. بنستخدمه فقط لما تختار مشاركته.',
      'Allow location access to send your place and share live location in chats. It is only used when you choose to share it.',
      [{ id: 'later', ar: 'ليس الآن', en: 'Not now' }, { id: 'allow', ar: 'السماح', en: 'Allow', primary: true }]);
    if (r === 'allow') {
      const { Geolocation } = await import('@capacitor/geolocation');
      await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
    }
  } catch { /* plugin unavailable */ }
}
/** Android: opens the GPS / location switch. */
export function openLocationSettings() { return NativeLinksPerm?.openLocationSettings?.().catch(() => {}); }

let permRunning = false;
async function requestStartupPermissions() {
  if (!isNative || permRunning) return;
  permRunning = true;
  try {
    await requestNotificationPermission(); // sets up the channel when already granted; asks when still undecided
    const notifOk = await notificationsGranted();
    const media = await mediaGranted();
    let firstLaunch = false;
    try { firstLaunch = localStorage.getItem(PERM_LOG_KEY) === null; } catch { /* storage blocked */ }
    const mediaMissing = media === false || (media === null && firstLaunch);
    if (notifOk && !mediaMissing) return;
    if (!permQuotaAllows()) return;
    permQuotaRecord();

    const t0 = Date.now();
    if (!notifOk) {
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        const r = await LocalNotifications.requestPermissions();
        if (r.display === 'granted') await requestNotificationPermission();
      } catch { /* plugin unavailable */ }
    }
    if (mediaMissing) {
      try {
        if (navigator.mediaDevices?.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          stream.getTracks().forEach((tr) => tr.stop());
        }
      } catch { /* refused */ }
    }
    // Everything came back refused in well under a second: Android did not show a dialog (refused too often) -> Settings card.
    const stillMissing = !(await notificationsGranted()) || (await mediaGranted()) === false;
    if (stillMissing && Date.now() - t0 < 800) showSettingsCard();
  } finally { permRunning = false; ensurePushRegistered(); setTimeout(async () => { await ensureLocationPermission(); setTimeout(async () => { await ensureCallScreenPermissions(); ensureBackgroundDelivery(); }, 1500); }, 1500); }
}
/** Opens this app's page in Android Settings (where a permission that was refused for good can be switched on). */
export function openAppSettings() { return NativeLinksPerm?.openAppSettings?.().catch(() => {}); }
export function recheckPermissions() { setTimeout(requestStartupPermissions, 1200); }

async function requestNotificationPermission() {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const p = await LocalNotifications.checkPermissions(); // only checks: the asking (and its twice-a-day cap) is requestStartupPermissions
    if (p.display === 'granted') {
      await LocalNotifications.createChannel({ id: 'uip', name: 'UIPE', description: 'UIPE notifications', importance: 4, visibility: 1, vibration: true });
      await LocalNotifications.createChannel(ALERT_CHANNEL);
      if (!localTapListening) {
        localTapListening = true;
        LocalNotifications.addListener('localNotificationActionPerformed', (a) => openFromPush(a?.notification?.extra)).catch(() => { localTapListening = false; });
      }
      notifReady = true;
    }
  } catch { /* plugin unavailable */ }
}

// Channels: "uip" = everything, "uip-alerts" = problems reported by the app itself (max importance, red light, own sound
// switch in Android's settings). Created for local notifications here and for FCM in ensurePushRegistered.
const ALERT_CHANNEL = { id: 'uip-alerts', name: 'تنبيهات الأعطال / App alerts', description: 'App failures reported to admins', importance: 5, visibility: 1, vibration: true, lights: true, lightColor: '#E5484D' };
const hashId = (s) => { let h = 0; for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) % 2147483000; };

/** Phone notification while the app is open. opts: { link, alert } — tapping it opens `link`; alerts use the red high-priority channel. */
export async function nativeNotify(title, body, opts = {}) {
  if (!isNative || !notifReady) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const alert = !!opts.alert;
    await LocalNotifications.schedule({ notifications: [{
      // alerts about the same screen replace each other instead of piling up
      id: alert && opts.link ? hashId(opts.link) : Math.floor(Date.now() % 2147483000),
      title: title || 'UIPE', body: String(body || '').split('\n')[0], largeBody: body || '', summaryText: alert ? 'UIPE' : undefined,
      channelId: alert ? ALERT_CHANNEL.id : 'uip', smallIcon: 'ic_stat_uip', iconColor: alert ? '#E5484D' : '#4F5BE8',
      extra: { link_url: opts.link || '' },
    }] });
  } catch { /* ignore */ }
}

// ---- Camera / microphone ------------------------------------------------------------
// Android only shows its permission dialog when the page first calls getUserMedia. For exams that would be
// in the middle of the attempt, so ask as soon as the student opens an exam page (and the microphone too for
// meetings). The system dialog appears once; if it was refused, the app falls back to its own
// "camera blocked" message and the permission can be turned on in Settings > Apps > UIPE > Permissions.
const mediaAsked = { video: false, audio: false };

async function ensureMedia({ video, audio }) {
  const want = { video: video && !mediaAsked.video, audio: audio && !mediaAsked.audio };
  if (!want.video && !want.audio) return;
  if (want.video) mediaAsked.video = true;
  if (want.audio) mediaAsked.audio = true;
  if (!navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: !!want.video, audio: !!want.audio });
    stream.getTracks().forEach((t) => t.stop());
  } catch { /* refused - the exam/meeting screen shows its own message */ }
}

function setupMediaPermissions() {
  const onRoute = () => {
    const p = window.location.pathname;
    applyScreenSecurity(p);
    if (/\/student\/(my-exams|exam-attempt)\b/.test(p)) ensureMedia({ video: true });
    else if (/\/meetings?\b/.test(p)) ensureMedia({ video: true, audio: true });
  };
  ['pushState', 'replaceState'].forEach((fn) => {
    const orig = window.history[fn];
    window.history[fn] = function (...args) {
      const r = orig.apply(this, args);
      setTimeout(onRoute, 0);
      return r;
    };
  });
  window.addEventListener('popstate', onRoute);
  setTimeout(onRoute, 1500);
}

// ---- Exam mode: block screenshots and screen recording -----------------------------
// Android's FLAG_SECURE (through the privacy-screen plugin) turns screenshots into a blocked/black capture,
// stops screen recording and Cast, and hides the app preview in the recent-apps list. It is switched on only
// while an exam attempt is open (not on the result page) or a My PC share page (/s/<token>) is open, and off everywhere else.
let screenSecure = null;
let routeSecure = false;   // the current page needs it (exam / shared PC page)
let extraSecure = 0;       // overlays that need it while open (view-once media)
function syncScreenSecurity() {
  const want = routeSecure || extraSecure > 0;
  if (want === screenSecure) return;
  screenSecure = want;
  import('@capacitor-community/privacy-screen')
    .then(({ PrivacyScreen }) => (want ? PrivacyScreen.enable() : PrivacyScreen.disable()))
    .catch(() => { screenSecure = null; });
}
function applyScreenSecurity(path) {
  routeSecure = /^\/student\/exam-attempt\/[^/]+\/?$/.test(path) || /^\/s\/[A-Za-z0-9]+\/?$/.test(path);
  syncScreenSecurity();
}
/**
 * Turn Android's FLAG_SECURE on while something sensitive is on screen (view-once photo / video) and off again after.
 * Ref-counted, so it never fights the exam / shared-PC rule above. In a normal browser there is no such switch: no-op.
 */
export function setContentSecure(on) {
  if (!isNative) return;
  extraSecure = Math.max(0, extraSecure + (on ? 1 : -1));
  syncScreenSecurity();
}

// ---- Exam mode: full screen + screen pinning ---------------------------------------------
// Native side: native/android/ExamLockPlugin.java (copied into android/ by scripts/patch-android.mjs).
//  - hides the status bar and the 3 navigation buttons (immersive full screen);
//  - pins the screen, so Home / Recents are disabled and the notification shade cannot be pulled down.
// If the plugin is missing (android/ not patched) or the device refuses pinning, every call below fails
// quietly and the exam page falls back to its normal behaviour.
const ExamLock = isNative ? registerPlugin('ExamLock') : null;

let warnedMissing = false;
export async function enterExamMode() {
  if (!ExamLock) return { active: false, pinned: false };
  try { return await ExamLock.enable(); } catch {
    // The native part is missing from this APK: android/ was not patched, or the APK is an old build.
    if (!warnedMissing) {
      warnedMissing = true;
      toast(document.documentElement.lang === 'ar' || localStorage.getItem('uip_locale') === 'ar'
        ? 'وضع الامتحان الكامل غير مفعّل في هذا الـ APK - شغّل npm run android:sync وابنِ التطبيق من جديد'
        : 'Full exam mode is not in this APK - run npm run android:sync and rebuild the app');
    }
    return { active: false, pinned: false };
  }
}

export async function exitExamMode() {
  if (!ExamLock) return;
  try { await ExamLock.disable(); } catch { /* ignore */ }
}

/**
 * Calls onLost() when screen pinning that was on gets switched off (the student long-pressed Back + Overview
 * to un-pin). Returns a function that stops watching. Does nothing if pinning was never accepted.
 */
export function watchExamMode(onLost) {
  if (!ExamLock) return () => {};
  let wasPinned = false;
  let busy = false;
  const iv = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const s = await ExamLock.status();
      if (s?.pinned) wasPinned = true;
      else if (wasPinned) { wasPinned = false; onLost(); }
    } catch { /* ignore */ } finally { busy = false; }
  }, 1200);
  return () => clearInterval(iv);
}
// ---- Printing -------------------------------------------------------------------------------
// window.print() does nothing inside the Android WebView. Native side: native/android/NativePrintPlugin.java
// opens Android's print dialog (which also offers "Save as PDF") for the current page, using the page's
// @media print CSS. In a normal browser this is just window.print().
const NativePrint = isNative ? registerPlugin('NativePrint') : null;

export async function printPage({ name = 'UIPE', landscape = false } = {}) {
  if (NativePrint) {
    try { await NativePrint.print({ name, landscape }); return; } catch {
      toast(document.documentElement.lang === 'ar' || localStorage.getItem('uip_locale') === 'ar'
        ? 'الطباعة غير مفعّلة في هذا الـ APK - شغّل npm run android:sync وابنِ التطبيق من جديد'
        : 'Printing is not in this APK - run npm run android:sync and rebuild the app');
      return;
    }
  }
  window.print();
}

// ---- Saving / opening files -----------------------------------------------------------------
// The Android WebView ignores <a download> on blob: URLs, so "Download" did nothing inside the app.
// Native side: native/android/NativeFilesPlugin.java writes the file to the phone's Downloads folder
// (MediaStore, no storage permission needed) and opens it in an installed viewer.
const NativeFiles = isNative ? registerPlugin('NativeFiles') : null;
export const canSaveNatively = () => !!NativeFiles;

const MIME_BY_EXT = {
  pdf: 'application/pdf', csv: 'text/csv', json: 'application/json', txt: 'text/plain', md: 'text/markdown',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', zip: 'application/zip',
};

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const v = String(reader.result || ''); resolve(v.slice(v.indexOf(',') + 1)); };
    reader.onerror = () => reject(reader.error || new Error('read_failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Chat media auto-save: the phone downloads the file straight from its URL (streamed natively, never through JS)
 * into Pictures / Movies / Music / Documents  >  "UIPE". Rejects if the plugin is missing (old APK) or the storage
 * permission is not granted yet (Android 9-), so the caller can simply try again later.
 */
export async function nativeSaveUrl({ url, filename, mimeType, kind }) {
  if (!NativeFiles) throw new Error('native_files_unavailable');
  return NativeFiles.saveUrl({ url: absolutize(String(url || '')), filename: filename || 'file', mimeType: mimeType || 'application/octet-stream', kind: kind || 'file' });
}

/**
 * Chat media cache: downloads a file ONCE into the app's private storage and returns a URL the <video> can play from
 * (served by Capacitor's local server, with Range support). Both calls reject on an old APK without the methods.
 */
export const canCacheNatively = () => !!NativeFiles;
const toLocalSrc = (path) => (path ? Capacitor.convertFileSrc(path) : null);
export async function nativeCachedSrc(key, ext) {
  if (!NativeFiles) return null;
  try { const r = await NativeFiles.cachedPath({ key: String(key), ext: ext || '' }); return toLocalSrc(r?.path); } catch { return null; }
}
export async function nativeCacheUrl({ url, key, ext, onProgress }) {
  if (!NativeFiles) throw new Error('native_files_unavailable');
  let handle = null;
  if (onProgress) {
    try { handle = await NativeFiles.addListener('cacheProgress', (e) => { if (e && e.key === String(key)) onProgress(e.loaded, e.total); }); } catch { /* progress is optional */ }
  }
  try {
    const r = await NativeFiles.cacheUrl({ url: absolutize(String(url || '')), key: String(key), ext: ext || '' });
    return toLocalSrc(r.path);
  } finally { try { handle && handle.remove(); } catch { /* ignore */ } }
}
export async function nativeClearMediaCache() {
  if (!NativeFiles) return 0;
  try { return (await NativeFiles.clearCache())?.freed || 0; } catch { return 0; }
}

/** Saves a Blob to Downloads and opens it. Rejects if the plugin is missing (old APK) so the caller can fall back. */
export async function nativeSaveFile(blob, filename, { open = true } = {}) {
  if (!NativeFiles) throw new Error('native_files_unavailable');
  const ext = String(filename || '').split('.').pop().toLowerCase();
  const mimeType = String(blob.type || '').split(';')[0] || MIME_BY_EXT[ext] || 'application/octet-stream';
  const res = await NativeFiles.save({ filename: filename || 'download', mimeType, data: await blobToBase64(blob), open });
  const ar = document.documentElement.lang === 'ar' || localStorage.getItem('uip_locale') === 'ar';
  if (res?.where === 'downloads') toast(ar ? 'تم حفظ الملف في مجلد التنزيلات' : 'Saved to your Downloads folder');
  else if (!res?.opened) toast(ar ? 'مفيش تطبيق على الموبايل يفتح الملف ده' : 'No app on this phone can open this file');
  return res;
}

// ---- Push notifications (Firebase Cloud Messaging) ---------------------------------------------------------------------
// Flow: signed in + notification permission granted -> PushNotifications.register() gives this phone's FCM token ->
// POST /api/v1/push/devices. The API then pushes every new in-app notification to the phone, even with the app closed
// (FCM shows it itself, on the "uip" channel). Tapping it opens the notification's link. Logout removes the token.
// Needs android/app/google-services.json (copied from native/android by scripts/patch-android.mjs).
const PUSH_TOKEN_KEY = 'uip_push_token';
let PushPlugin = null;
let pushListening = false;
let pushWanted = false; // true while someone is signed in
// Push problems used to fail silently. Show the reason once per launch (and keep it in localStorage as uip_push_debug).
let pushDebugShown = false;
function pushBanner(text, ms = 15000) {
  try {
    // Diagnostics are for developers: people never see them. Turn them on with localStorage.uip_push_debug_ui = '1'.
    if (localStorage.getItem('uip_push_debug_ui') !== '1') return;
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:fixed;left:12px;right:12px;top:60px;z-index:2147483000;background:#1b2559;color:#fff;padding:12px 14px;border-radius:12px;font:600 13px/1.5 system-ui,sans-serif;direction:ltr;text-align:left;box-shadow:0 6px 24px rgba(0,0,0,.35)';
    el.onclick = () => el.remove();
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  } catch { /* ignore */ }
}
function pushDebug(msg) {
  try { localStorage.setItem('uip_push_debug', `${new Date().toISOString()} ${msg}`); } catch { /* storage blocked */ }
  if (pushDebugShown) return;
  pushDebugShown = true;
  pushBanner(`Push problem: ${msg} (tap to close)`);
}
/** Shown once, ~10 s after sign-in in the app: what the phone knows about push right now. */
async function pushStatusBanner() {
  try {
    const Push = (await loadPush())?.plugin;
    let perm = 'plugin-missing';
    if (Push) { try { perm = (await Push.checkPermissions()).receive; } catch (e) { perm = `error:${e?.message || e}`; } }
    let token = '';
    try { token = localStorage.getItem(PUSH_TOKEN_KEY) || ''; } catch { /* storage blocked */ }
    let last = '';
    try { last = localStorage.getItem('uip_push_debug') || ''; } catch { /* storage blocked */ }
    pushBanner(`Push status — permission: ${perm} | token: ${token ? 'yes (' + token.length + ' chars)' : 'NO'}${last ? ' | last problem: ' + last.slice(24) : ''} (tap to close)`, 20000);
  } catch { /* ignore */ }
}

/** Returns { plugin } (never the plugin itself): a Capacitor plugin is a Proxy, and returning/awaiting it from an async function makes
 *  JS call plugin.then(), which Capacitor rejects with '"PushNotifications.then()" is not implemented on android' - registerPush used
 *  to die on that line, silently, before ever asking for the token. */
async function loadPush() {
  if (!isNative) return null;
  if (!PushPlugin) {
    try { ({ PushNotifications: PushPlugin } = await import('@capacitor/push-notifications')); } catch (e) { PushPlugin = null; pushDebug(`push plugin failed to load: ${String(e?.message || e).slice(0, 100)}`); }
  }
  return PushPlugin ? { plugin: PushPlugin } : null;
}

const PUSH_SENT_KEY = 'uip_push_sent';
let pushSending = false;
/** Sends this phone's token to the API. A failed send is usually just a moment without network (the app was resumed, the phone
 *  switched wifi/data): that is retried quietly a few times and is not recorded as a "problem". The same token is not re-sent
 *  more than once every 30 minutes (resume used to post it every time the app came to the foreground). */
async function sendPushToken(attempt = 0) {
  let token = '';
  try { token = localStorage.getItem(PUSH_TOKEN_KEY) || ''; } catch { /* storage blocked */ }
  if (!token || !pushWanted || pushSending) return;
  try {
    const sent = JSON.parse(localStorage.getItem(PUSH_SENT_KEY) || 'null');
    if (sent && sent.t === token && Date.now() - sent.at < 30 * 60 * 1000) return;
  } catch { /* unreadable: just send */ }
  pushSending = true;
  try {
    const { api } = await import('./api/client'); // dynamic: client.js imports this file
    await api.post('/api/v1/push/devices', { token, platform: 'android', locale: localStorage.getItem('uip_locale') === 'ar' ? 'ar' : 'en' });
    try { localStorage.setItem(PUSH_SENT_KEY, JSON.stringify({ t: token, at: Date.now() })); localStorage.removeItem('uip_push_debug'); } catch { /* storage blocked */ }
  } catch (e) {
    if (!e?.status && attempt < 3) {
      // status 0 = the request never reached the server (no network right now): try again shortly, silently
      setTimeout(() => sendPushToken(attempt + 1), [8000, 30000, 90000][attempt]);
    } else {
      pushDebug(`server refused the token (${e?.status || ''} ${String(e?.message || e).slice(0, 80)})`); /* retried at the next launch / token refresh */
    }
  } finally { pushSending = false; }
}

/** Opens the screen a tapped notification points to (internal paths only). */
function openFromPush(data) {
  const link = typeof data?.link_url === 'string' ? data.link_url : '';
  if (!link.startsWith('/') || link.startsWith('//')) return;
  if (link === window.location.pathname + window.location.search) return;
  window.history.pushState({}, '', link);
  window.dispatchEvent(new PopStateEvent('popstate')); // react-router follows the new URL
}


/** If the plugin's 'registration' event never delivers a token (seen on some builds/phones), ask Firebase directly through our own
 *  native method and report the exact failure reason. Needs the APK built with the updated NativeLinksPlugin; older APKs skip it. */
let nativeTokenTries = 0;
async function nativeTokenFallback() {
  if (nativeTokenTries >= 4) return;
  if (!NativeLinksPerm?.getPushToken) { pushDebug('native getPushToken missing: old APK build'); return; }
  nativeTokenTries += 1;
  setTimeout(async () => {
    try { if (localStorage.getItem(PUSH_TOKEN_KEY)) return; } catch { /* storage blocked */ }
    try {
      const r = await NativeLinksPerm.getPushToken();
      try { console.log('[UIPE-PUSH] native token ' + (r?.token ? 'ok' : 'empty')); } catch { /* ignore */ }
      if (r?.token) {
        try { localStorage.setItem(PUSH_TOKEN_KEY, String(r.token)); } catch { /* storage blocked */ }
        sendPushToken();
      }
    } catch (e) { pushDebug(`FCM token failed: ${String(e?.message || e?.code || e).slice(0, 140)}`); }
  }, 5000);
}

/** Registers this phone for push when the permission is granted (never asks: requestStartupPermissions owns the prompts). */
async function ensurePushRegistered() {
  if (!pushWanted) return;
  const Push = (await loadPush())?.plugin;
  if (!Push) return;
  try {
    const p = await Push.checkPermissions();
    if (p.receive !== 'granted') { pushDebug('notification permission is not granted'); return; }
    await Push.createChannel({ id: 'uip', name: 'UIPE', description: 'UIPE notifications', importance: 4, visibility: 1, vibration: true, lights: true });
    await Push.createChannel(ALERT_CHANNEL);
    await Push.register();
    nativeTokenFallback();
  } catch (e) { pushDebug(`register failed: ${String(e?.message || e).slice(0, 100)}`); /* plugin unavailable / Firebase not configured in this build */ }
}

/** App came to the foreground: re-send the FCM token (also refreshes last_seen_at / recovers a failed first send) and open what a notification pointed to. */
function resyncPushOnResume() {
  if (!pushWanted) return;
  sendPushToken();
  ensurePushRegistered();
  handleNativeLaunch();
  try { window.dispatchEvent(new CustomEvent('uip:push-received', { detail: { resume: '1' } })); } catch { /* ignore */ }
}

/** The app was opened from our own incoming-call notification: go to that chat and poll for the call right now. */
async function handleNativeLaunch() {
  if (!isNative || !NativeLinksPerm?.consumeLaunch) return;
  try {
    const r = await NativeLinksPerm.consumeLaunch();
    if (r?.link) openFromPush({ link_url: r.link });
    if (r?.call_id) window.dispatchEvent(new CustomEvent('uip:push-received', { detail: { type: 'incoming_call', call_id: String(r.call_id) } }));
  } catch { /* old APK without the method */ }
}
if (typeof window !== 'undefined') window.addEventListener('uip:native-launch', () => { handleNativeLaunch(); });

export async function registerPush() {
  if (!isNative) return;
  pushWanted = true;
  try { localStorage.removeItem(PUSH_SENT_KEY); } catch { /* storage blocked */ } // signed in / app started: send the token once for this account
  try { console.log('[UIPE-PUSH] registerPush start'); } catch { /* ignore */ }
  // Status banner + native token path do not depend on the Capacitor push plugin, so a plugin that fails to load is visible, not silent.
  if (!window.__uipPushStatusShown) { window.__uipPushStatusShown = true; setTimeout(pushStatusBanner, 10000); }
  nativeTokenFallback();
  const Push = (await loadPush())?.plugin;
  if (!Push) { pushDebug('push plugin is not available in this build'); setTimeout(sendPushToken, 8000); return; }
  if (!pushListening) {
    pushListening = true;
    try {
      await Push.addListener('registration', ({ value }) => {
        try { localStorage.setItem(PUSH_TOKEN_KEY, String(value || '')); } catch { /* storage blocked */ }
        sendPushToken();
      });
      await Push.addListener('registrationError', (e) => { pushDebug(`Firebase registration error: ${String(e?.error || e?.message || JSON.stringify(e)).slice(0, 100)}`); });
      // App open: FCM does not draw its own copy, so tell the bell to sync right now (it then shows the phone notification
      // and plays the sound) instead of waiting for the next 30 s poll. Pages that mirror server data listen too.
      await Push.addListener('pushNotificationReceived', (n) => {
        try { window.dispatchEvent(new CustomEvent('uip:push-received', { detail: n?.data || {} })); } catch { /* ignore */ }
      });
      await Push.addListener('pushNotificationActionPerformed', (a) => openFromPush(a?.notification?.data));
    } catch { pushListening = false; }
  }
  await ensurePushRegistered();
  handleNativeLaunch();
  // token is only sent when the plugin reports it; if that send failed earlier, try again shortly
  setTimeout(sendPushToken, 8000);
}

export async function unregisterPush() {
  pushWanted = false;
  if (!isNative) return;
  let token = '';
  try { token = localStorage.getItem(PUSH_TOKEN_KEY) || ''; } catch { /* storage blocked */ }
  const work = (async () => {
    if (token) {
      try { const { api } = await import('./api/client'); await api.del('/api/v1/push/devices', { token }); } catch { /* server unreachable: it drops dead tokens by itself */ }
    }
    // Delete the phone's FCM token too, so the next account that signs in here gets a fresh one.
    try { const Push = (await loadPush())?.plugin; await Push?.unregister?.(); } catch { /* ignore */ }
    try { localStorage.removeItem(PUSH_TOKEN_KEY); localStorage.removeItem(PUSH_SENT_KEY); localStorage.removeItem('uip_push_debug'); } catch { /* storage blocked */ }
  })();
  await Promise.race([work, new Promise((res) => setTimeout(res, 4000))]); // never block the sign-out button
}
