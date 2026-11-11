import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import AuthLayout from '../layouts/AuthLayout';
import Icon from '../components/Icon';
import { AuthField } from '../components/auth/AuthField';
import { useTranslations } from '../context/LanguageContext';
import i18nCommon from '../i18n/common';
import i18nPage from '../i18n/auth/pages';
import { cooldownKey, setCooldown } from '../hooks/useCooldown';

const translations = { ...i18nCommon, ...i18nPage };

// Mirrors app/Views/auth/forgot-password.php + ForgotPasswordController::submit().
export default function ForgotPassword() {
  const t = useTranslations(translations);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post('/api/v1/auth/forgot-password', { email: email.trim() });
      setCooldown(cooldownKey('reset', email), res?.retry_after ?? res?.data?.retry_after ?? 60);
      // Same answer whether or not the email exists — ForgotPasswordController never reveals which.
      navigate('/auth/reset-password', { state: { email: email.trim(), sent: true } });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title={t('Forgot your password?')}
      subtitle={t("Enter your email and we'll send you a reset code")}
      error={error}
    >
      <form onSubmit={handleSubmit}>
        <AuthField
          id="email"
          type="email"
          label={t('Email')}
          icon="mail"
          ltr
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
        />

        <button type="submit" className={`auth-btn ${submitting ? 'is-loading' : ''}`} disabled={submitting}>
          <span>{submitting ? t('Sending…') : t('Send reset code')}</span>
          {!submitting && <span className="auth-dir-icon"><Icon name="arrow-right" size={18} /></span>}
        </button>
      </form>

      <div className="auth-footer-link">
        <Link to="/auth/login" className="auth-link auth-back">
          <span className="auth-dir-icon"><Icon name="arrow-left" size={16} /></span> {t('Back to sign in')}
        </Link>
      </div>
    </AuthLayout>
  );
}
