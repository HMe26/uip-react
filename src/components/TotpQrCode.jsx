import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import Icon from './Icon';
import { registerPlugin } from '@capacitor/core';
import { isNative } from '../native';
import { useLanguage } from '../context/LanguageContext';

const NativeLinks = isNative ? registerPlugin('NativeLinks') : null;
const AUTH_PLAY_STORE = 'market://details?id=com.google.android.apps.authenticator2';
const AUTH_PLAY_WEB = 'https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2';

/**
 * Android app only: a phone cannot scan its own screen, so this hands the otpauth:// link straight to the
 * authenticator app installed on the phone (Google Authenticator, Microsoft Authenticator, Authy, ...),
 * which adds the account with the secret already filled in. If no app handles it, offers the Play Store.
 */
function OpenAuthenticatorButton({ uri }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [missing, setMissing] = useState(false);

  async function open() {
    setMissing(false);
    try {
      await NativeLinks.openOtpAuth({ uri });
    } catch (e) {
      const msg = String(e?.code || e?.message || '');
      if (/no_app/i.test(msg)) { setMissing(true); return; }
      // Older APK without the native plugin: let the WebView hand the link to Android itself.
      if (/unimplemented|not implemented|not available/i.test(msg)) { window.location.href = uri; return; }
      setMissing(true);
    }
  }

  async function store() {
    try {
      const { App } = await import('@capacitor/app');
      const res = await App.openUrl({ url: AUTH_PLAY_STORE });
      if (res && res.completed === false) await App.openUrl({ url: AUTH_PLAY_WEB });
    } catch { window.open(AUTH_PLAY_WEB, '_blank'); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)', width: '100%' }}>
      <button type="button" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={open}>
        <Icon name="shield" size={16} /> {ar ? 'افتح تطبيق المصادقة' : 'Open authenticator app'}
      </button>
      {missing && (
        <p className="text-caption" role="alert" style={{ margin: 0, textAlign: 'center' }}>
          {ar ? 'مفيش تطبيق مصادقة على الموبايل. ' : 'No authenticator app found on this phone. '}
          <button type="button" className="auth-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }} onClick={store}>
            {ar ? 'نزّل Google Authenticator' : 'Install Google Authenticator'}
          </button>
        </p>
      )}
    </div>
  );
}

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;user-select:text;-webkit-user-select:text';
    document.body.appendChild(ta);
    ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

/**
 * The manual setup key under the QR code, with a Copy button. The Android app switches text selection off
 * (styles/css/native.css), so long-press copying is impossible there; this copies the key without the
 * spaces, which every authenticator app accepts.
 */
export function ManualKey({ value, className, style }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [state, setState] = useState('idle'); // idle | copied | failed
  if (!value) return null;

  async function copy() {
    const ok = await copyText(String(value).replace(/\s+/g, ''));
    setState(ok ? 'copied' : 'failed');
    setTimeout(() => setState('idle'), 2000);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
      <p className={className} dir="ltr" style={{ ...style, userSelect: 'text', WebkitUserSelect: 'text', margin: 0 }}>{value}</p>
      <button type="button" className="btn btn-outline btn-sm" onClick={copy}>
        <Icon name={state === 'copied' ? 'check-circle' : 'copy'} size={14} />{' '}
        {state === 'copied' ? (ar ? 'تم النسخ' : 'Copied') : state === 'failed' ? (ar ? 'تعذّر النسخ' : 'Copy failed') : (ar ? 'نسخ الرمز' : 'Copy key')}
      </button>
    </div>
  );
}

/**
 * Renders the otpauth:// URI returned by TwoFactorService::generateSetup()
 * as a scannable QR code, entirely client-side.
 *
 * Mirrors the PHP views' approach (each portal's two-factor-setup.php, which
 * use davidshimjs/qrcodejs from cdnjs): the secret is already sent to the
 * browser in plain text as `otpauth_uri`/`manual_key` regardless, so turning
 * it into a QR code locally adds no exposure — nothing is sent to a third
 * party. Here it's done with the `qrcode` npm package instead of a CDN
 * script tag, since this is a bundled React app.
 *
 * If generation fails for any reason, the code just doesn't render and the
 * manual key (always shown alongside this) remains the fallback — every
 * authenticator app supports typing it in by hand.
 */
export default function TotpQrCode({ uri, size = 200 }) {
  const canvasRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (!uri || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, uri, { width: size, margin: 1 }, (err) => {
      if (err && !cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [uri, size]);

  if (!uri) return null;

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)', maxWidth: '100%' }}>
      {isNative && <OpenAuthenticatorButton uri={uri} />}
      {/* The canvas stays mounted (hidden if QR generation failed) so the effect above can always draw into it. */}
      <div style={{ display: failed ? 'none' : 'inline-block', padding: 'var(--space-3)', background: '#fff', borderRadius: 'var(--radius-md)' }}>
        <canvas ref={canvasRef} width={size} height={size} />
      </div>
    </div>
  );
}
