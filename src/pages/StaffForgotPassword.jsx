import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { STAFF_LOGIN_PATH } from '../config/staffPortal';
import Icon from '../components/Icon';
import StaffShell, { useStaffText } from '../components/staff/StaffShell';
import { cooldownKey, setCooldown } from '../hooks/useCooldown';

export default function StaffForgotPassword() {
  const t = useStaffText();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Same answer whether or not the email exists — the server never reveals which.
      const res = await api.post('/api/v1/auth/forgot-password', { email: email.trim() });
      setCooldown(cooldownKey('reset', email), res?.retry_after ?? res?.data?.retry_after ?? 60);
      navigate(`${STAFF_LOGIN_PATH}/reset-password`, { state: { email: email.trim(), sent: true } });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <Link to={STAFF_LOGIN_PATH} className="sl-back">
      <Icon name="arrow-left" size={16} /> {t('Back to staff sign-in', 'الرجوع لدخول الفريق')}
    </Link>
  );

  return (
    <StaffShell>
      <h1 id="sl-title">{t('Reset your password', 'استرجاع كلمة المرور')}</h1>
      <p className="sl-form__lead">{t("Enter your work email and we'll send you a reset code.", 'اكتب بريدك وهنبعتلك كود إعادة التعيين.')}</p>

      {error && <div className="sl-error" role="alert"><Icon name="alert-triangle" size={17} /> <span>{error}</span></div>}

      <form onSubmit={submit}>
        <label className="sl-field">
          <span>{t('Work email', 'البريد الإلكتروني')}</span>
          <input
            type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)}
            autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false}
            placeholder="name@organisation.com" required autoFocus
          />
        </label>
        <button type="submit" className="sl-submit" disabled={busy}>
          {busy ? t('Sending…', 'جارٍ الإرسال…') : t('Send reset code', 'إرسال كود إعادة التعيين')}
          {!busy && <Icon name="arrow-right" size={18} />}
        </button>
      </form>

      <div className="sl-foot">{back}</div>
    </StaffShell>
  );
}
