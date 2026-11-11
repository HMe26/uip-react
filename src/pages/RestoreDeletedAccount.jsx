import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useLanguage } from '../context/LanguageContext';
import AuthLayout from '../layouts/AuthLayout';
import Icon from '../components/Icon';
import { AuthField, PasswordField } from '../components/auth/AuthField';

/**
 * Restore a DELETED account with the email it used before.
 *   1. email  -> POST /auth/account-recovery/send (8-digit code to that email)
 *   2. code + new password -> POST /auth/account-recovery/restore
 * The old account comes back with ALL its data under a brand-new password.
 * If that email already has an active account, the server answers `needs_login_merge`:
 * sign in with it and use "Recover old account data" instead (/account/recover-data).
 * Backend: AccountRecoveryController.
 */
export default function RestoreDeletedAccount() {
  const { locale } = useLanguage();
  const tr = (en, ar) => (locale === 'ar' ? ar : en);
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState('email'); // 'email' | 'verify'
  const [email, setEmail] = useState(location.state?.email || '');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function sendCode(e) {
    e?.preventDefault();
    setError(null);
    setNeedsLogin(false);
    setBusy(true);
    try {
      const json = await api.post('/api/v1/auth/account-recovery/send', { email: email.trim() });
      setMaskedEmail(json.data?.email || email);
      setCooldown(Number(json.data?.retry_after) || 60);
      setStep('verify');
      setInfo(tr('If this email belongs to a deleted account, we sent an 8-digit code to it.', 'لو الإيميل ده كان لحساب محذوف، بعتنا رمز من 8 أرقام عليه.'));
    } catch (err) {
      const code = err?.payload?.errors?.code;
      const wait = err?.payload?.errors?.retry_after;
      if (wait) setCooldown(Number(wait));
      if (code === 'needs_login_merge') setNeedsLogin(true);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function restore(e) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(tr("Passwords don't match.", 'كلمتا السر غير متطابقتين.'));
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/v1/auth/account-recovery/restore', { email: email.trim(), otp, password, password_confirmation: confirm });
      navigate('/auth/login', {
        replace: true,
        state: { success: tr('Your account was restored with all its data. Sign in with your new password.', 'اتسترجع حسابك بكل بياناته. ادخل بكلمة السر الجديدة.') },
      });
    } catch (err) {
      if (err?.payload?.errors?.code === 'needs_login_merge') setNeedsLogin(true);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const mismatch = confirm !== '' && password !== confirm;
  const title = step === 'email' ? tr('Restore your deleted account', 'استرجاع حسابك المحذوف') : tr('Enter the code', 'اكتب الرمز');
  const lead = step === 'email'
    ? tr('Enter the email your old account used. We will email you a one-time code to prove it is yours.', 'اكتب الإيميل اللي كان عليه حسابك القديم. هنبعتلك رمز لمرة واحدة عشان نتأكد إنه بتاعك.')
    : `${tr('Code sent to', 'الرمز اتبعت إلى')} ${maskedEmail}`;

  return (
    <AuthLayout title={title} subtitle={lead} error={error} success={step === 'verify' ? info : null}>
      {needsLogin && (
        <div className="auth-footer-link" style={{ marginBottom: 12 }}>
          <Link to="/auth/login" className="auth-link">
            {tr('Sign in, then open “Recover old account data”', 'سجّل الدخول وبعدين افتح "استرجاع بيانات الحساب القديم"')}
          </Link>
        </div>
      )}

      {step === 'email' ? (
        <form onSubmit={sendCode}>
          <AuthField id="email" type="email" label={tr('Email', 'الإيميل')} icon="mail" ltr value={email}
            onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
          <button type="submit" className={`auth-btn ${busy ? 'is-loading' : ''}`} disabled={busy || !email}>
            {!busy && <Icon name="mail" size={18} />}
            <span>{busy ? tr('Sending…', 'جارٍ الإرسال…') : tr('Email me a code', 'ابعتلي الرمز على الإيميل')}</span>
          </button>
        </form>
      ) : (
        <form onSubmit={restore}>
          <AuthField id="otp" label={tr('8-digit code', 'الرمز (8 أرقام)')} icon="key" ltr inputMode="numeric"
            autoComplete="one-time-code" maxLength={8} placeholder="00000000" value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} required autoFocus />
          <PasswordField id="password" label={tr('New password', 'كلمة السر الجديدة')} value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password"
            minLength={8} showStrength showCapsWarning required />
          <PasswordField id="password_confirmation" label={tr('Confirm password', 'تأكيد كلمة السر')} value={confirm}
            onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" autoComplete="new-password"
            error={mismatch ? tr("Passwords don't match.", 'كلمتا السر غير متطابقتين.') : undefined} required />
          <button type="submit" className={`auth-btn ${busy ? 'is-loading' : ''}`} disabled={busy || otp.length !== 8 || mismatch}>
            {!busy && <Icon name="shield" size={18} />}
            <span>{busy ? tr('Restoring…', 'جارٍ الاسترجاع…') : tr('Restore my account', 'استرجع حسابي')}</span>
          </button>
          <div className="auth-footer-link" style={{ marginTop: 12 }}>
            <button type="button" className="auth-link" style={{ background: 'none', border: 0, cursor: 'pointer' }}
              disabled={busy || cooldown > 0} onClick={sendCode}>
              {cooldown > 0 ? `${tr('Resend in', 'إعادة الإرسال بعد')} ${cooldown}s` : tr('Resend the code', 'أعد إرسال الرمز')}
            </button>
          </div>
        </form>
      )}

      <div className="auth-footer-link" style={{ marginTop: 16 }}>
        <Link to="/auth/login" className="auth-link">{tr('Back to sign in', 'الرجوع لتسجيل الدخول')}</Link>
      </div>
    </AuthLayout>
  );
}
