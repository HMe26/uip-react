import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, useLocation, Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import AuthLayout from '../layouts/AuthLayout';
import Icon from '../components/Icon';
import { AuthField, PasswordField } from '../components/auth/AuthField';
import OtpField, { OTP_LENGTH, cleanOtp } from '../components/auth/OtpField';
import useCooldown, { cooldownKey } from '../hooks/useCooldown';
import { useTranslations } from '../context/LanguageContext';
import i18nCommon from '../i18n/common';
import i18nPage from '../i18n/auth/pages';

const translations = { ...i18nCommon, ...i18nPage };

// Mirrors app/Views/auth/reset-password.php + ResetPasswordController::submit().
export default function ResetPassword() {
  const t = useTranslations(translations);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || ''; // old emailed links only; new resets use a 6-digit code
  const [email, setEmail] = useState(location.state?.email || searchParams.get('email') || '');
  const [otp, setOtp] = useState(() => cleanOtp(new URLSearchParams(window.location.hash.replace(/^#/, '')).get('code')));
  const [info, setInfo] = useState(location.state?.sent ? t('If an account exists for this email, we sent a 6-digit code.') : null);
  const [cooldown, startCooldown] = useCooldown(location.state?.sent ? 60 : 0, cooldownKey('reset', email));
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Two steps: 1) check the emailed code, 2) only if it is right, show the new-password fields.
  // Old emailed links (?token=) skip straight to step 2.
  const [verified, setVerified] = useState(!!token);
  const [verifying, setVerifying] = useState(false);
  const autoTried = useRef(false);

  // The code came in the URL fragment (#code=123456): use it once, then clear it from the address bar.
  useEffect(() => {
    if (window.location.hash.includes('code=')) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  async function verifyCode(e) {
    e?.preventDefault();
    if (verifying || otp.length !== OTP_LENGTH || !email.trim()) return;
    setError(null);
    setVerifying(true);
    try {
      await api.post('/api/v1/auth/reset-password/verify', { email: email.trim(), otp });
      setInfo(null);
      setVerified(true);
    } catch (err) {
      setError(errorMessage(err));
      if (err?.payload?.code === 'otp_locked' || err?.payload?.code === 'otp_expired') setOtp('');
    } finally {
      setVerifying(false);
    }
  }

  // Arrived from the "copy code" page with the code (and e-mail) already filled: check it right away.
  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    if (!token && otp.length === OTP_LENGTH && email.trim()) verifyCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeCode() {
    setVerified(false);
    setPassword('');
    setPasswordConfirmation('');
    setError(null);
    setOtp('');
  }

  const mismatch = passwordConfirmation !== '' && password !== passwordConfirmation;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (password !== passwordConfirmation) {
      setError(t("Passwords don't match."));
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/api/v1/auth/reset-password', {
        ...(token ? { token } : { email: email.trim(), otp }),
        password,
        password_confirmation: passwordConfirmation,
      });
      navigate('/auth/login', {
        state: { success: t('Your password has been reset. Please log in.') },
      });
    } catch (err) {
      setError(errorMessage(err));
      const c = err?.payload?.code;
      if (!token && (c === 'otp_expired' || c === 'otp_locked' || c === 'otp_invalid')) {
        setVerified(false);
        setOtp('');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    if (!email.trim() || cooldown > 0) return;
    setError(null);
    try {
      const res = await api.post('/api/v1/auth/forgot-password', { email: email.trim() });
      setInfo(t('If an account exists for this email, we sent a new 6-digit code.'));
      setOtp('');
      setVerified(false);
      startCooldown(res?.retry_after ?? res?.data?.retry_after ?? 60);
    } catch (err) {
      setError(errorMessage(err));
      startCooldown(60);
    }
  }

  const needsCode = !token;
  const showCodeStep = needsCode && !verified;
  const canSubmit = !submitting && !mismatch && (!needsCode || (verified && otp.length === OTP_LENGTH && email.trim() !== ''));

  return (
    <AuthLayout
      title={t('Reset your password')}
      subtitle={showCodeStep ? t('Enter the code we emailed you to continue') : t('Choose a new password for your account')}
      error={error}
    >
      {showCodeStep ? (
        <form onSubmit={verifyCode}>
          {info && <p className="auth-field__hint" role="status" style={{ marginBottom: 12 }}>{info}</p>}
          <AuthField
            id="email" type="email" label={t('Email')} icon="mail" ltr value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com"
            autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} required
          />
          <OtpField label={t('Reset code')} value={otp} onChange={setOtp} autoFocus={!!email} />
          <button type="submit" className={`auth-btn ${verifying ? 'is-loading' : ''}`} disabled={verifying || otp.length !== OTP_LENGTH || !email.trim()}>
            <span>{verifying ? t('Verifying…') : t('Verify code')}</span>
            {!verifying && <span className="auth-dir-icon"><Icon name="arrow-right" size={18} /></span>}
          </button>
        </form>
      ) : (
        <form onSubmit={handleSubmit}>
          {needsCode && (
            <p className="auth-field__hint" role="status" style={{ marginBottom: 12 }}>
              {t('Code verified. Choose a new password.')}{' '}
              <button
                type="button" className="auth-link" onClick={changeCode}
                style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontWeight: 700 }}
              >{t('Use a different code')}</button>
            </p>
          )}
          <PasswordField
            id="password"
            label={t('New password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            minLength={8}
            hint={t('At least 8 characters')}
            showStrength
            showCapsWarning
            required
            autoFocus
          />
          <PasswordField
            id="password_confirmation"
            label={t('Confirm password')}
            value={passwordConfirmation}
            onChange={(e) => setPasswordConfirmation(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            minLength={8}
            error={mismatch ? t("Passwords don't match.") : undefined}
            required
          />

          <button type="submit" className={`auth-btn ${submitting ? 'is-loading' : ''}`} disabled={!canSubmit}>
            <span>{submitting ? t('Resetting…') : t('Reset password')}</span>
            {!submitting && <span className="auth-dir-icon"><Icon name="arrow-right" size={18} /></span>}
          </button>
        </form>
      )}

      <div className="auth-footer-link" style={{ display: 'grid', gap: 8 }}>
        {showCodeStep && (
          <button
            type="button" className="auth-link" onClick={resend} disabled={cooldown > 0 || !email.trim()}
            style={{ background: 'none', border: 0, padding: '6px 0', cursor: cooldown > 0 ? 'default' : 'pointer', fontWeight: 700 }}
          >
            {cooldown > 0 ? `${t('Resend code in')} ${cooldown}s` : t('Resend code')}
          </button>
        )}
        <Link to="/auth/login" className="auth-link auth-back">
          <span className="auth-dir-icon"><Icon name="arrow-left" size={16} /></span> {t('Back to sign in')}
        </Link>
      </div>
    </AuthLayout>
  );
}
