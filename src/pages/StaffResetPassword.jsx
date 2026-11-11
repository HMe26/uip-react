import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { STAFF_LOGIN_PATH } from '../config/staffPortal';
import Icon from '../components/Icon';
import StaffShell, { useStaffText } from '../components/staff/StaffShell';
import useCooldown, { cooldownKey } from '../hooks/useCooldown';
import { cleanOtp, handleOtpPaste, OTP_LENGTH } from '../components/auth/OtpField';

export default function StaffResetPassword() {
  const t = useStaffText();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const token = params.get('token') || ''; // old emailed links only; new resets use a 6-digit code
  const [email, setEmail] = useState(location.state?.email || params.get('email') || '');
  const [otp, setOtp] = useState('');
  const [info, setInfo] = useState(location.state?.sent ? t('If an account exists for this email, we sent a 6-digit code.', 'لو في حساب بالإيميل ده، بعتنالك كود من 6 أرقام.') : null);
  const [cooldown, startCooldown] = useCooldown(location.state?.sent ? 60 : 0, cooldownKey('reset', email));
  const needsCode = !token;

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const mismatch = confirm !== '' && password !== confirm;

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t("Passwords don't match.", 'كلمتا المرور غير متطابقتين.'));
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/v1/auth/reset-password', { ...(token ? { token } : { email: email.trim(), otp }), password, password_confirmation: confirm });
      navigate(STAFF_LOGIN_PATH, { state: { success: t('Your password has been reset. Sign in with the new one.', 'اتغيّرت كلمة المرور. سجّل الدخول بالجديدة.') } });
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
      const res = await api.post('/api/v1/auth/forgot-password', { email: email.trim() });
      setInfo(t('If an account exists for this email, we sent a new 6-digit code.', 'لو في حساب بالإيميل ده، بعتنالك كود جديد من 6 أرقام.'));
      setOtp('');
      startCooldown(res?.retry_after ?? res?.data?.retry_after ?? 60);
    } catch (err) {
      setError(errorMessage(err));
      startCooldown(60);
    }
  }

  const canSubmit = !busy && !mismatch && (!needsCode || (otp.length === OTP_LENGTH && email.trim() !== ''));

  return (
    <StaffShell>
      <h1 id="sl-title">{t('Choose a new password', 'اختار كلمة مرور جديدة')}</h1>
      <p className="sl-form__lead">{needsCode ? t('Enter the code we emailed you, then choose a new password (8+ characters).', 'اكتب الكود اللي وصلك على الإيميل، وبعدها اختار كلمة مرور جديدة (8 حروف على الأقل).') : t('Use at least 8 characters.', 'استخدم 8 حروف على الأقل.')}</p>

      {error && <div className="sl-error" role="alert"><Icon name="alert-triangle" size={17} /> <span>{error}</span></div>}

      <form onSubmit={submit}>
        {needsCode && (
          <>
            {info && <div className="sl-success" role="status"><Icon name="mail" size={17} /> <span>{info}</span></div>}
            <label className="sl-field">
              <span>{t('Work email', 'البريد الإلكتروني')}</span>
              <input
                type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)}
                autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false}
                placeholder="name@organisation.com" required
              />
            </label>
            <label className="sl-field">
              <span>{t('Reset code', 'كود إعادة التعيين')}</span>
              <input
                dir="ltr" value={otp} onChange={(e) => setOtp(cleanOtp(e.target.value))}
                inputMode="numeric" autoComplete="one-time-code" data-allow-clipboard="true" pattern="[0-9]*" onPaste={handleOtpPaste(setOtp)}
                placeholder="••••••" required autoFocus={!!email}
                style={{ letterSpacing: '0.45em', fontWeight: 700, fontSize: '1.15rem', textAlign: 'center' }}
              />
            </label>
          </>
        )}
        <label className="sl-field">
          <span>{t('New password', 'كلمة المرور الجديدة')}</span>
          <span className="sl-pass">
            <input
              type={show ? 'text' : 'password'} dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password" minLength={8} placeholder="••••••••" required autoFocus={!needsCode}
            />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? t('Hide password', 'إخفاء كلمة المرور') : t('Show password', 'إظهار كلمة المرور')}>
              <Icon name={show ? 'eye-off' : 'eye'} size={18} />
            </button>
          </span>
        </label>

        <label className={`sl-field${mismatch ? ' has-error' : ''}`}>
          <span>{t('Confirm password', 'تأكيد كلمة المرور')}</span>
          <input
            type={show ? 'text' : 'password'} dir="ltr" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password" minLength={8} placeholder="••••••••" required aria-invalid={mismatch || undefined}
          />
          {mismatch && <small className="sl-hint-error" role="alert">{t("Passwords don't match.", 'كلمتا المرور غير متطابقتين.')}</small>}
        </label>

        <button type="submit" className="sl-submit" disabled={!canSubmit}>
          {busy ? t('Saving…', 'جارٍ الحفظ…') : t('Save new password', 'حفظ كلمة المرور')}
          {!busy && <Icon name="arrow-right" size={18} />}
        </button>
      </form>

      {needsCode && (
        <button type="button" className="sl-alt sl-alt--btn" onClick={resend} disabled={cooldown > 0 || !email.trim()}>
          {cooldown > 0 ? `${t('Resend code in', 'إعادة الإرسال بعد')} ${cooldown}s` : t('Resend code', 'إعادة إرسال الكود')}
        </button>
      )}
      <div className="sl-foot">
        <Link to={STAFF_LOGIN_PATH} className="sl-back"><Icon name="arrow-left" size={16} /> {t('Back to staff sign-in', 'الرجوع لدخول الفريق')}</Link>
      </div>
    </StaffShell>
  );
}
