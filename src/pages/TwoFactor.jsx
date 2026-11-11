import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth, ApiError } from '../context/AuthContext';
import { errorMessage } from '../api/client';
import AuthLayout from '../layouts/AuthLayout';
import Icon from '../components/Icon';
import { useTranslations } from '../context/LanguageContext';
import i18nCommon from '../i18n/common';
import i18nPage from '../i18n/auth/pages';
import { roleHome } from '../config/roleHome';
import { STAFF_LOGIN_PATH } from '../config/staffPortal';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/auth/two-factor.php + TwoFactorChallengeController.
 * Step 2 of login when the account has TOTP enabled. The CSRF token is
 * forwarded from Login.jsx via navigate(..., { state }); without it there is
 * no valid session to challenge, so we send the user back to /auth/login
 * (same as the PHP show() does when !Session::get('_2fa_pending_user_id')).
 */
export default function TwoFactor() {
  const t = useTranslations(translations);
  const { completeTwoFactor, cancelTwoFactor } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const challengeToken = location.state?.challengeToken ?? null;
  // Staff reach this screen from the hidden staff sign-in; send them back there, not to the public login.
  const backToLogin = location.state?.portal === 'staff' ? STAFF_LOGIN_PATH : '/auth/login';
  const [code, setCode] = useState('');
  const [rememberDevice, setRememberDevice] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  if (!challengeToken) {
    navigate(backToLogin, { replace: true });
    return null;
  }

  // 6 digits = TOTP; anything longer/alphanumeric = recovery code (maxLength 10 as before).
  const isRecovery = /[^0-9\s]/.test(code) || code.replace(/\s/g, '').length > 6;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { role } = await completeTwoFactor(code, rememberDevice, challengeToken);
      navigate(roleHome(role), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err) : t('Something went wrong. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(e) {
    e.preventDefault();
    setCancelling(true);
    try {
      await cancelTwoFactor(challengeToken);
    } catch {
      // Fall through to /auth/login regardless — same as the PHP GET
      // /auth/two-factor/cancel, which always redirects there.
    } finally {
      navigate(backToLogin);
    }
  }

  return (
    <AuthLayout
      title={t('Two-Factor Authentication')}
      subtitle={t('Open your authenticator app and enter the 6-digit code.')}
      error={error}
    >
      <form onSubmit={handleSubmit}>
        <div className="auth-field">
          <div className="auth-field__head">
            <label className="auth-field__label" htmlFor="code">{t('Authentication code')}</label>
          </div>
          <input
            id="code"
            name="code"
            dir="ltr"
            className={`auth-field__input auth-otp ${isRecovery ? 'is-recovery' : ''}`}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            maxLength={10}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoFocus
          />
        </div>

        <label className="auth-check" htmlFor="remember_device">
          <input
            type="checkbox"
            id="remember_device"
            checked={rememberDevice}
            onChange={(e) => setRememberDevice(e.target.checked)}
          />
          <span>{t('Remember this device for 30 days (skip this code next time)')}</span>
        </label>

        <button type="submit" className={`auth-btn ${submitting ? 'is-loading' : ''}`} disabled={submitting}>
          {!submitting && <Icon name="shield" size={18} />}
          <span>{submitting ? t('Verifying…') : t('Verify')}</span>
        </button>
      </form>

      <p className="auth-note">{t('Lost your device? Use one of your recovery codes instead.')}</p>

      <div className="auth-footer-link" style={{ marginTop: 16 }}>
        <a href="/auth/two-factor/cancel" className="auth-link" onClick={handleCancel} aria-disabled={cancelling}>
          {t('Cancel and sign in as someone else')}
        </a>
      </div>
    </AuthLayout>
  );
}
