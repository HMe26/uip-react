import { useEffect, useRef, useState } from 'react';
import { getGoogleConfig, isNative, loadGoogleIdentity, nativeGoogleIdToken } from '../../lib/googleAuth';
import { useLanguage } from '../../context/LanguageContext';

const GoogleLogo = () => (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

/**
 * "Continue with Google". Calls onToken(idToken) with the Google ID token; the caller sends it to the API.
 * Renders nothing when Google sign-in isn't configured on the backend.
 */
// google.accounts.id.initialize() should run once per client id: the button can mount more than once (StrictMode, switching screens),
// and Google warns about repeated calls. The callback goes through a module-level handler that the mounted button keeps up to date.
let gsiInitFor = null;
let gsiHandler = null;
const BTN_H = 52;   // height of our own button (px) - keep in sync with .auth-google in auth.css
const GIS_H = 40;   // height of Google's "large" button, which we scale to BTN_H

export default function GoogleSignInButton({ onToken, onError, disabled = false }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [width, setWidth] = useState(0);
  const wrapRef = useRef(null);
  const boxRef = useRef(null);
  const gisRef = useRef(null);
  const latest = useRef({ onToken, onError });
  latest.current = { onToken, onError };

  const label = ar ? 'المتابعة بحساب جوجل' : 'Continue with Google';

  useEffect(() => {
    let alive = true;
    getGoogleConfig().then((c) => { if (alive) setCfg(c); });
    return () => { alive = false; };
  }, []);

  // Browser: load Google's script once. Google's own button is an <iframe> that cannot be restyled (it stayed
  // white in dark mode and was cut off on phones), so we draw OUR button and lay Google's real button over it,
  // invisible: a tap lands on Google's button (it opens Google's popup and returns the ID token as before).
  useEffect(() => {
    if (isNative || !cfg?.enabled) return undefined;
    let alive = true;
    loadGoogleIdentity().then((google) => {
      if (!alive) return;
      gsiHandler = (credential) => latest.current.onToken(credential);
      if (gsiInitFor !== cfg.clientId) {
        gsiInitFor = cfg.clientId;
        google.accounts.id.initialize({
          client_id: cfg.clientId,
          ux_mode: 'popup',
          auto_select: false,
          callback: (res) => { if (res?.credential) gsiHandler?.(res.credential); },
        });
      }
      gisRef.current = google;
      setReady(true);
    }).catch(() => {
      latest.current.onError?.(ar ? 'مقدرناش نحمّل تسجيل الدخول بجوجل. اتأكد من الإنترنت وجرّب تاني.' : "Couldn't load Google sign-in. Check your connection and try again.");
    });
    return () => { alive = false; };
  }, [cfg]); // eslint-disable-line react-hooks/exhaustive-deps

  // follow the container width (phones, rotation, window resize)
  useEffect(() => {
    if (isNative || !cfg?.enabled || !wrapRef.current) return undefined;
    const el = wrapRef.current;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [cfg]);

  // Google's button is 200-400px wide: draw it at that size and stretch it (CSS scale) to cover our button.
  const gisWidth = Math.min(400, Math.max(200, width || 320));
  useEffect(() => {
    const google = gisRef.current;
    if (!ready || !google || !boxRef.current || !width) return;
    boxRef.current.innerHTML = '';
    google.accounts.id.renderButton(boxRef.current, {
      type: 'standard', theme: 'outline', size: 'large', shape: 'pill', logo_alignment: 'left',
      text: 'continue_with', locale: ar ? 'ar' : 'en', width: gisWidth,
    });
  }, [ready, width, gisWidth, ar]);

  if (!cfg?.enabled) return null;

  if (!isNative) {
    return (
      <div ref={wrapRef} className={`auth-google-wrap ${disabled ? 'is-disabled' : ''}`}>
        <div className="auth-google" aria-hidden="true">
          <GoogleLogo />
          <span>{label}</span>
        </div>
        <div
          ref={boxRef}
          className="auth-google-gis"
          style={{ width: gisWidth, transform: `scale(${(width || gisWidth) / gisWidth}, ${BTN_H / GIS_H})` }}
        />
      </div>
    );
  }

  async function handleNative() {
    setBusy(true);
    try {
      const idToken = await nativeGoogleIdToken(cfg.clientId);
      await latest.current.onToken(idToken);
    } catch (e) {
      if (!e?.cancelled) {
        // Show Google's real reason (e.g. "[28444] Developer console is not set up correctly") — the generic
        // sentence alone hides whether it is a phone problem or an app/console setup problem.
        const raw = String(e?.code ? `${e.code} ${e?.message || ''}` : (e?.message || e || '')).replace(/\s+/g, ' ').trim().slice(0, 140);
        // eslint-disable-next-line no-console
        console.error('[google-sign-in]', e);
        const base = ar
          ? 'مقدرناش نسجّل الدخول بجوجل. اتأكد إن فيه حساب جوجل على الموبايل وجرّب تاني.'
          : "Couldn't sign in with Google. Make sure a Google account is set up on this phone and try again.";
        latest.current.onError?.(raw ? `${base} (${raw})` : base);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="auth-google" onClick={handleNative} disabled={disabled || busy}>
      <GoogleLogo />
      <span>{label}</span>
    </button>
  );
}
