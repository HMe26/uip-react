import { useCallback, useEffect, useState } from 'react';
import { api, MFA_REQUIRED_EVENT } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { roleHome } from '../config/roleHome';
import Icon from './Icon';
import TotpQrCode, { ManualKey } from './TotpQrCode';
import './MfaGate.css';

/**
 * Enforces Security > Policies > "MFA Requirements Policy" on the client.
 *
 * The server is the real enforcement (UipAuthMiddleware answers 403 `mfa_setup_required` on every protected
 * call once the role's grace period is over). This gate only decides which screen to show:
 *  - after sign-in it asks GET /api/v1/auth/mfa/status (that call also starts the grace-period clock), and
 *  - it also reacts to MFA_REQUIRED_EVENT, fired by api/client.js on any 403 `mfa_setup_required`, so a session
 *    that was already open when the policy was switched on is caught too.
 * While restricted, the whole app is replaced by <MfaSetup /> — the only thing the account can do is enroll
 * (or sign out). When enrollment succeeds the page reloads into the person's portal.
 */
export default function MfaGate({ children }) {
  const { status, user } = useAuth();
  const [required, setRequired] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated') { setRequired(false); return undefined; }
    let cancelled = false;
    api.get('/api/v1/auth/mfa/status')
      .then((json) => { if (!cancelled && json?.data?.restricted) setRequired(true); })
      .catch(() => { /* fail open: the server still blocks every protected call */ });
    return () => { cancelled = true; };
  }, [status, user?.id]);

  useEffect(() => {
    const on = () => setRequired(true);
    window.addEventListener(MFA_REQUIRED_EVENT, on);
    return () => window.removeEventListener(MFA_REQUIRED_EVENT, on);
  }, []);

  if (status === 'authenticated' && required) return <MfaSetup role={user?.role} />;
  return children;
}

function MfaSetup({ role }) {
  const { logout } = useAuth();
  const { locale, toggleLocale } = useLanguage();
  const isAr = locale === 'ar';
  const t = (en, ar) => (isAr ? ar : en);

  const [stage, setStage] = useState('intro'); // intro | scan | codes
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState([]);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const json = await api.post('/api/v1/auth/mfa/setup', {});
      setSetup(json.data);
      setStage('scan');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, []);

  async function confirm(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const json = await api.post('/api/v1/auth/mfa/confirm', { code: code.trim(), setup_token: setup?.setup_token });
      setCodes(json.data?.recovery_codes || []);
      setStage('codes');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyCodes() {
    try { await navigator.clipboard.writeText(codes.join('\n')); setCopied(true); } catch { /* clipboard blocked */ }
  }

  const finish = () => window.location.assign(roleHome(role));

  return (
    <main className="mfagate">
      <div className="mfagate__card">
        <div className="mfagate__icon" aria-hidden="true"><Icon name="shield" size={34} /></div>

        {stage === 'intro' && (
          <>
            <h1 className="mfagate__title">{t('Two-factor authentication is required', 'المصادقة الثنائية (2FA) إلزامية على حسابك')}</h1>
            <p className="mfagate__desc">
              {t(
                'Your account type must have two-factor authentication turned on. Set it up now with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…) to keep using the platform.',
                'نوع حسابك لازم يكون مفعّل عليه المصادقة الثنائية. فعّلها دلوقتي بتطبيق مصادقة (Google Authenticator أو Microsoft Authenticator أو Authy…) علشان تكمل استخدام المنصة.'
              )}
            </p>
            {error && <p className="mfagate__error" role="alert">{error}</p>}
            <div className="mfagate__actions">
              <button type="button" className="btn btn-primary" onClick={start} disabled={busy}>
                <Icon name="shield" size={16} /> {busy ? t('Preparing…', 'جاري التجهيز…') : t('Set up 2FA', 'ابدأ التفعيل')}
              </button>
            </div>
          </>
        )}

        {stage === 'scan' && setup && (
          <form onSubmit={confirm}>
            <h1 className="mfagate__title">{t('Scan the code, then confirm', 'امسح الكود وبعدها أكّد')}</h1>
            <ol className="mfagate__steps">
              <li>{t('Open your authenticator app and scan the QR code.', 'افتح تطبيق المصادقة وامسح الـ QR.')}</li>
              <li>{t('Type the 6-digit code it shows.', 'اكتب الكود المكوّن من 6 أرقام اللي بيظهرلك.')}</li>
            </ol>
            {setup.otpauth_uri && <div className="mfagate__qr"><TotpQrCode uri={setup.otpauth_uri} /></div>}
            <ManualKey className="mfagate__key" value={setup.manual_key} />
            <input
              className="form-input mfagate__code"
              type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={8} dir="ltr"
              placeholder="000000" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus
            />
            {error && <p className="mfagate__error" role="alert">{error}</p>}
            <div className="mfagate__actions">
              <button type="submit" className="btn btn-primary" disabled={busy || code.trim().length < 6}>
                <Icon name="check-circle" size={16} /> {busy ? t('Verifying…', 'جاري التحقق…') : t('Confirm & enable', 'تأكيد وتفعيل')}
              </button>
            </div>
          </form>
        )}

        {stage === 'codes' && (
          <>
            <h1 className="mfagate__title">{t('2FA is on — save your recovery codes', 'اتفعّلت — احفظ أكواد الاسترداد')}</h1>
            <p className="mfagate__desc">
              {t('Each code works once if you lose your phone. They are shown only now.', 'كل كود بيشتغل مرة واحدة لو فقدت موبايلك. بتظهر دلوقتي بس.')}
            </p>
            <div className="mfagate__codes" dir="ltr">{codes.map((c) => <code key={c}>{c}</code>)}</div>
            <button type="button" className="btn btn-outline btn-sm" onClick={copyCodes}>{copied ? t('Copied', 'اتنسخت') : t('Copy codes', 'انسخ الأكواد')}</button>
            <label className="mfagate__ack">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
              {t('I saved these codes somewhere safe', 'حفظت الأكواد في مكان آمن')}
            </label>
            <div className="mfagate__actions">
              <button type="button" className="btn btn-primary" onClick={finish} disabled={!saved}>{t('Continue to the platform', 'كمّل للمنصة')}</button>
            </div>
          </>
        )}

        {stage !== 'codes' && (
          <div className="mfagate__foot">
            <button type="button" className="btn btn-outline btn-sm" onClick={toggleLocale} aria-label={isAr ? 'English' : 'العربية'} title={isAr ? 'English' : 'العربية'}><Icon name="globe" size={16} /></button>
            <button type="button" className="btn btn-outline btn-sm" onClick={logout}>{t('Sign out', 'تسجيل الخروج')}</button>
          </div>
        )}
      </div>
    </main>
  );
}
