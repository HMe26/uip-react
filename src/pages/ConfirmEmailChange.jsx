import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import AuthLayout from '../layouts/AuthLayout';
import AuthStatus from '../components/auth/AuthStatus';
import { useTranslations } from '../context/LanguageContext';
import i18nCommon from '../i18n/common';
import i18nPage from '../i18n/auth/pages';

const translations = { ...i18nCommon, ...i18nPage };

// Mirrors app/Views/auth/confirm-email-change.php + ConfirmEmailChangeController.
// Sent to the NEW address after a settings-page email change request.
export default function ConfirmEmailChange() {
  const t = useTranslations(translations);
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [status, setStatus] = useState('loading'); // 'loading' | 'confirmed' | 'invalid'
  const [newEmail, setNewEmail] = useState(null);

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      return undefined;
    }
    let cancelled = false;
    api.get('/api/v1/auth/confirm-email-change', { token })
      .then((json) => {
        if (cancelled) return;
        setNewEmail(json.data?.new_email ?? null);
        setStatus('confirmed');
      })
      .catch(() => { if (!cancelled) setStatus('invalid'); });
    return () => { cancelled = true; };
  }, [token]);

  if (status === 'loading') {
    return (
      <AuthLayout>
        <AuthStatus tone="loading" title={t('Confirm email change')}>{t('Confirming…')}</AuthStatus>
      </AuthLayout>
    );
  }

  const confirmed = status === 'confirmed';

  return (
    <AuthLayout>
      <AuthStatus
        tone={confirmed ? 'success' : 'danger'}
        icon={confirmed ? 'check-circle' : 'x-circle'}
        title={confirmed ? t('Your new email is confirmed') : t('Confirmation link invalid')}
        actions={<Link to="/auth/login" className="auth-btn">{t('Go to sign in')}</Link>}
      >
        {confirmed
          ? <>{t('You can now sign in with')} <strong dir="ltr">{newEmail}</strong></>
          : t('The link is expired or already used. Try requesting the email change again from your account settings.')}
      </AuthStatus>
    </AuthLayout>
  );
}
