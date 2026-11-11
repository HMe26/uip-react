// Sign in with Google — one flow for the website and the Android (Capacitor) app.
//
// Both paths end with a Google *ID token* that the Laravel API verifies itself
// (POST /api/v1/auth/google), so nothing coming from the browser/app is trusted.
//   • Browser : Google Identity Services (the official "Sign in with Google" button).
//   • Android : native account picker (Credential Manager) through @capgo/capacitor-social-login —
//               Google blocks OAuth inside a WebView, so the web button can't be used in the APK.
// The Web client ID comes from the API (GOOGLE_CLIENT_IDS in the backend .env), so the frontend
// needs no extra env var; both the website and the APK use that same Web client ID.
import { api } from '../api/client';
import { isNative } from '../native';

let configPromise = null;

/** { enabled, client_id } — enabled only when the backend has GOOGLE_CLIENT_IDS set. */
export function getGoogleConfig() {
  if (!configPromise) {
    configPromise = api.get('/api/v1/auth/google/config')
      .then((json) => ({ enabled: !!json?.data?.enabled, clientId: json?.data?.client_id || null }))
      .catch(() => {
        configPromise = null; // offline / API down: try again next time
        return { enabled: false, clientId: null };
      });
  }
  return configPromise;
}

let gisPromise = null;

/** Loads Google's own script once. Resolves with window.google. */
export function loadGoogleIdentity() {
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      if (window.google?.accounts?.id) { resolve(window.google); return; }
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
      s.onload = () => resolve(window.google);
      s.onerror = () => { gisPromise = null; s.remove(); reject(new Error('Could not load Google sign-in.')); };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

let nativeReady = null;

/** Opens the Android account picker and returns the Google ID token. Rejects with err.cancelled = true if dismissed. */
export async function nativeGoogleIdToken(clientId) {
  const { SocialLogin } = await import('@capgo/capacitor-social-login');
  if (!nativeReady) {
    nativeReady = SocialLogin.initialize({ google: { webClientId: clientId } }).catch((e) => { nativeReady = null; throw e; });
  }
  await nativeReady;
  try {
    const res = await SocialLogin.login({ provider: 'google' });
    // No `scopes` option on purpose: passing one makes the plugin reject with "You CANNOT use scopes without
    // modifying the main activity". The ID token already carries email + name + picture by default.
    const idToken = res?.result?.idToken;
    if (!idToken) throw new Error('Google did not return an ID token.');
    return idToken;
  } catch (e) {
    const msg = String(e?.message || e || '').toLowerCase();
    if (e?.code === 'CANCELED' || /cancel|dismiss|no credential available|user closed/.test(msg)) {
      const err = new Error('cancelled');
      err.cancelled = true;
      throw err;
    }
    throw e;
  }
}

export { isNative };
