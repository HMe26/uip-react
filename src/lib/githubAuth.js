// Sign in with GitHub — website only (the OAuth pop-up cannot run inside the Android WebView).
// GitHub has no ID token, so the API does the code exchange. The pop-up and this tab are tied together by a secret `nonce`
// that never leaves this tab: /auth/github/start gives the GitHub URL, and /auth/github/claim (polled) returns the result once.
// The result has the same shape as /auth/google (signed in, 2FA needed, or "finish your details").
import { api } from '../api/client';
import { isNative } from '../native';

let configPromise = null;

/** { enabled } — enabled only when the backend has the GitHub OAuth App configured (and not in the Android app). */
export function getGithubConfig() {
  if (!configPromise) {
    configPromise = api.get('/api/v1/auth/github/config')
      .then((json) => ({ enabled: !!json?.data?.enabled && !isNative }))
      .catch(() => { configPromise = null; return { enabled: false }; });
  }
  return configPromise;
}

const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
const err = (message, code) => Object.assign(new Error(message), { code });
const POLL_MS = 1500;
const GIVE_UP_MS = 4 * 60 * 1000;

let cancelPrev = null;

/** Stops a sign-in that is still waiting (the pop-up stays open, but its result is ignored). */
export function cancelGithubSignIn() {
  if (cancelPrev) cancelPrev();
}

/**
 * Must be called straight from a click (the pop-up is opened before any await so browsers don't block it).
 * Resolves with the API's `data` object; rejects with an Error whose `.code` is 'popup' | 'popup_closed' | 'cancelled' for "not worth showing".
 */
export function githubSignIn() {
  cancelGithubSignIn();
  const popup = window.open('', 'uip-github-auth', 'width=560,height=720');
  if (!popup) return Promise.reject(err('The sign-in window was blocked. Allow pop-ups and try again.', 'popup'));

  const nonce = hex(32);
  return new Promise((resolve, reject) => {
    let finished = false;
    let timer = null;
    const finish = (fn, v) => {
      if (finished) return;
      finished = true; cancelPrev = null; clearTimeout(timer);
      try { popup.close(); } catch { /* ignore */ }
      fn(v);
    };
    cancelPrev = () => finish(reject, err('Sign-in cancelled.', 'cancelled'));
    const deadline = Date.now() + GIVE_UP_MS;

    const poll = async () => {
      if (finished) return;
      if (Date.now() > deadline) { finish(reject, err('The sign-in took too long. Try again.', 'popup_closed')); return; }
      try {
        const json = await api.post('/api/v1/auth/github/claim', { nonce });
        if (finished) return;
        if (json?.data?.pending) { timer = setTimeout(poll, POLL_MS); return; }
        finish(resolve, json.data);
      } catch (e) {
        if (finished) return;
        if (e?.status === 429) { timer = setTimeout(poll, POLL_MS * 3); return; } // rate limited: slow down, keep waiting
        finish(reject, e);
      }
    };

    api.post('/api/v1/auth/github/start', { nonce }).then((json) => {
      if (finished) return;
      const url = json?.data?.url;
      if (!url) { finish(reject, err('Could not start GitHub sign-in.', 'load')); return; }
      popup.location.href = url;
      timer = setTimeout(poll, POLL_MS);
    }).catch((e) => finish(reject, e));
  });
}
