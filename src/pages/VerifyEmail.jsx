import { useEffect, useState } from 'react';
import { useSearchParams, useLocation, Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import AuthLayout from '../layouts/AuthLayout';
import Icon from '../components/Icon';
import AuthStatus from '../components/auth/AuthStatus';
import { AuthField } from '../components/auth/AuthField';
import OtpField, { OTP_LENGTH } from '../components/auth/OtpField';
import useCooldown, { cooldownKey } from '../hooks/useCooldown';
import { useTranslations } from '../context/LanguageContext';
import i18nCommon from '../i18n/common';
import i18nPage from '../i18n/auth/pages';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Email confirmation by a 6-digit code (VerifyEmailController::submit).
 * Old confirmation links (/auth/verify-email?token=…) that were emailed before the
 * switch to codes still work through the GET handler.
 */
export default function VerifyEmail() {
  const t = useTranslations(translations);
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [email, setEmail] = useState(location.state?.email || searchParams.get('email') || '');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(location.state?.sent ? t('We sent a 6-digit code to your email.') : null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [legacy, setLegacy] = useState(token ? 'loading' : null); // old link flow: 'loading' | 'verified' | 'invalid'
  const [cooldown, startCooldown] = useCooldown(location.state?.sent ? 60 : 0, cooldownKey('verify', email));

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    api.get('/api/v1/auth/verify-email', { token })
      .then(() => { if (!cancelled) setLegacy('verified'); })
      .catch(() => { if (!cancelled) setLegacy('invalid'); });
    return () => { cancelled = true; };
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await api.post('/api/v1/auth/verify-email', { email: email.trim(), otp });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!email.trim() || cooldown > 0) return;
    setError(null);
    try {
      const res = await api.post('/api/v1/auth/resend-verification', { email: email.trim() });
      setInfo(t('If this account needs confirmation, a new code is on its way. Check your inbox and spam.'));
      setOtp('');
      startCooldown(res?.retry_after ?? res?.data?.retry_after ?? 60);
    } catch (err) {
      setError(errorMessage(err));
      startCooldown(60);
    }
  }

  if (legacy === 'loading') {
    return (
      <AuthLayout>
        <AuthStatus tone="loading" title={t('Verify email')}>{t('Verifying your email…')}</AuthStatus>
      </AuthLayout>
    );
  }

  if (done || legacy === 'verified') {
    return (
      <AuthLayout>
        <AuthStatus
          tone="success" icon="check-circle" title={t('Email verified')}
          actions={<Link to="/auth/login" className="auth-btn">{t('Go to sign in')}</Link>}
        >
          {t('You can now sign in to your account.')}
        </AuthStatus>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t('Confirm your email')}
      subtitle={t('Enter the 6-digit code we sent to your email')}
      error={error || (legacy === 'invalid' ? t('The link is expired or incorrect.') : null)}
    >
      <form onSubmit={submit}>
        {info && <p className="auth-field__hint" role="status" style={{ marginBottom: 12 }}>{info}</p>}
        <AuthField
          id="email" type="email" label={t('Email')} icon="mail" ltr value={email}
          onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com"
          autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} required
        />
        <OtpField label={t('Confirmation code')} value={otp} onChange={setOtp} autoFocus={!!email} />

        <button type="submit" className={`auth-btn ${busy ? 'is-loading' : ''}`} disabled={busy || otp.length !== OTP_LENGTH || !email.trim()}>
          <span>{busy ? t('Verifying…') : t('Confirm email')}</span>
          {!busy && <span className="auth-dir-icon"><Icon name="arrow-right" size={18} /></span>}
        </button>
      </form>

      <div className="auth-footer-link" style={{ display: 'grid', gap: 8 }}>
        <button
          type="button" className="auth-link" onClick={resend} disabled={cooldown > 0 || !email.trim()}
          style={{ background: 'none', border: 0, padding: '6px 0', cursor: cooldown > 0 ? 'default' : 'pointer', fontWeight: 700 }}
        >
          {cooldown > 0 ? `${t('Resend code in')} ${cooldown}s` : t('Resend code')}
        </button>
        <Link to="/auth/login" className="auth-link auth-back">
          <span className="auth-dir-icon"><Icon name="arrow-left" size={16} /></span> {t('Back to sign in')}
        </Link>
      </div>
    </AuthLayout>
  );
}
