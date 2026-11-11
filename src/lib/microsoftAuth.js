// Sign in with Microsoft (personal accounts + work/school) — website only (the OAuth pop-up cannot run inside the Android WebView).
// The pop-up flow lives in lib/cloud/microsoft.js (shared with the OneDrive link); the API verifies the ID token itself.
import { api } from '../api/client';
import { isNative } from '../native';

let configPromise = null;

/** { enabled, clientId, authority } — enabled only when the backend has MS_CLIENT_ID set (and not in the Android app). */
export function getMicrosoftConfig() {
  if (!configPromise) {
    configPromise = api.get('/api/v1/auth/microsoft/config')
      .then((json) => {
        const d = json?.data || {};
        return { enabled: !!d.enabled && !isNative && !!window.crypto?.subtle, client_id: d.client_id || null, authority: d.authority || 'https://login.microsoftonline.com/common' };
      })
      .catch(() => { configPromise = null; return { enabled: false }; });
  }
  return configPromise;
}

export async function microsoftSignInToken() {
  const cfg = await getMicrosoftConfig();
  if (!cfg.enabled) throw new Error('Microsoft sign-in is not set up.');
  const { microsoftIdToken } = await import('./cloud/microsoft');
  return microsoftIdToken(cfg);
}
