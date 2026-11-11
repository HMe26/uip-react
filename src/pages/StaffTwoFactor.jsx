import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, ApiError } from '../context/AuthContext';
import { errorMessage } from '../api/client';
import { roleHome } from '../config/roleHome';
import { STAFF_LOGIN_PATH } from '../config/staffPortal';
import Icon from '../components/Icon';
import StaffShell, { useStaffText } from '../components/staff/StaffShell';

/** Second step of the staff sign-in when the account has two-factor on (same pass design as the staff sign-in). */
export default function StaffTwoFactor() {
  const { completeTwoFactor, cancelTwoFactor } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const t = useStaffText();
  const challengeToken = location.state?.challengeToken ?? null;

  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // No pending sign-in (page opened directly or refreshed): start again from the staff sign-in.
  if (!challengeToken) return <Navigate to={STAFF_LOGIN_PATH} replace />;

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { role } = await completeTwoFactor(code, remember, challengeToken);
      navigate(roleHome(role), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err) : t('Something went wrong. Try again.', 'حصل خطأ. جرّب تاني.'));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setCancelling(true);
    try {
      await cancelTwoFactor(challengeToken);
    } catch {
      // Go back to the staff sign-in regardless.
    } finally {
      navigate(STAFF_LOGIN_PATH, { replace: true });
    }
  }

  return (
    <StaffShell>
      <h1 id="sl-title">{t('Two-factor authentication', 'التحقق بخطوتين')}</h1>
      <p className="sl-form__lead">
        {t('Open your authenticator app and enter the 6-digit code.', 'افتح تطبيق المصادقة واكتب الكود المكوّن من 6 أرقام.')}
      </p>

      {error && <div className="sl-error" role="alert"><Icon name="alert-triangle" size={17} /> <span>{error}</span></div>}

      <form onSubmit={submit}>
        <label className="sl-field">
          <span>{t('Authentication code', 'كود المصادقة')}</span>
          <input
            type="text" dir="ltr" inputMode="numeric" autoComplete="one-time-code" placeholder="000000"
            maxLength={10} value={code} onChange={(e) => setCode(e.target.value)} required autoFocus
            style={{ letterSpacing: '0.3em', textAlign: 'center', fontSize: 20 }}
          />
        </label>

        <label style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '0 0 16px', fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>{t('Remember this device for 30 days (skip this code next time)', 'افتكر الجهاز ده 30 يوم (من غير كود المرة الجاية)')}</span>
        </label>

        <button type="submit" className="sl-submit" disabled={busy}>
          {busy ? t('Verifying…', 'جارٍ التحقق…') : t('Verify', 'تحقق')}
          {!busy && <Icon name="arrow-right" size={18} />}
        </button>
      </form>

      <div className="sl-foot">
        <p>{t('Lost your device? Use one of your recovery codes instead.', 'ضاع جهازك؟ استخدم واحد من أكواد الاسترداد بدل الكود.')}</p>
        <button type="button" className="sl-alt sl-alt--btn" onClick={cancel} disabled={cancelling}>
          {t('Cancel and sign in as someone else', 'إلغاء والدخول بحساب تاني')}
        </button>
      </div>
    </StaffShell>
  );
}
