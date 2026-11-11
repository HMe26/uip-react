import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { roleHome } from '../config/roleHome';
import { STAFF_LOGIN_PATH } from '../config/staffPortal';
import AuthLayout from '../layouts/AuthLayout';
import StaffShell from '../components/staff/StaffShell';
import Icon from '../components/Icon';
import { AuthField, PasswordField } from '../components/auth/AuthField';

/**
 * "This account is open somewhere else and it isn't me."
 * Reached from the sign-in page when the server refuses a login because the account already
 * has a live session (409 account_in_use). The sign-in hands over a short-lived `takeoverToken`
 * (proof the password was right). Flow:
 *   1. send a strong 8-digit one-time code to the account's email,
 *   2. code + a new password => the server changes the password, ends EVERY other session
 *      (the intruder is signed out at once) and signs the owner in right here.
 * Backend: SessionTakeoverController (/api/v1/auth/session-takeover/send|verify).
 */
export default function AccountRecovery({ portal }) {
  const isStaff = portal === 'staff';
  const { locale } = useLanguage();
  const tr = (en, ar) => (locale === 'ar' ? ar : en);
  const { adoptSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const takeoverToken = location.state?.takeoverToken ?? null;
  const backPath = isStaff ? STAFF_LOGIN_PATH : '/auth/login';

  const [step, setStep] = useState('send'); // 'send' | 'verify'
  const [maskedEmail, setMaskedEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  useEffect(() => {
    if (!takeoverToken) navigate(backPath, { replace: true });
  }, [takeoverToken, navigate, backPath]);
  if (!takeoverToken) return null;

  async function sendCode() {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const json = await api.post('/api/v1/auth/session-takeover/send', { takeover_token: takeoverToken });
      setMaskedEmail(json.data?.email || '');
      setCooldown(Number(json.data?.resend_after) || 60);
      setStep('verify');
      setInfo(tr('We sent an 8-digit code to your email.', 'بعتنا رمز من 8 أرقام على إيميلك.'));
    } catch (err) {
      const wait = err?.payload?.errors?.retry_after;
      if (wait) setCooldown(Number(wait));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(tr("Passwords don't match.", 'كلمتا المرور غير متطابقتين.'));
      return;
    }
    setBusy(true);
    try {
      const json = await api.post('/api/v1/auth/session-takeover/verify', {
        takeover_token: takeoverToken, otp, password, password_confirmation: confirm,
      });
      const { role } = adoptSession(json.data);
      navigate(roleHome(role), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const mismatch = confirm !== '' && password !== confirm;
  const title = step === 'send' ? tr('Recover your account', 'استرجاع حسابك') : tr('Enter the code', 'اكتب الرمز');
  const lead = step === 'send'
    ? tr(
      "Your account is open on another device. If that isn't you, we'll email you a one-time code. After you enter it and choose a new password, the other session is signed out immediately and you stay signed in here.",
      'حسابك مفتوح على جهاز تاني. لو ده مش إنت، هنبعتلك رمز لمرة واحدة على الإيميل. بعد ما تكتبه وتختار كلمة سر جديدة، الجلسة التانية بتتقفل فورًا وإنت بتفضل مسجّل دخول هنا.'
    )
    : `${tr('Code sent to', 'الرمز اتبعت إلى')} ${maskedEmail}`;

  /* ---------- staff look ---------- */
  if (isStaff) {
    return (
      <StaffShell>
        <h1 id="sl-title">{title}</h1>
        <p className="sl-form__lead">{lead}</p>
        {info && step === 'verify' && <div className="sl-success" role="status"><Icon name="check-circle" size={17} /> <span>{info}</span></div>}
        {error && <div className="sl-error" role="alert"><Icon name="alert-triangle" size={17} /> <span>{error}</span></div>}

        {step === 'send' ? (
          <button type="button" className="sl-submit" disabled={busy} onClick={sendCode}>
            {busy ? tr('Sending…', 'جارٍ الإرسال…') : tr('Email me a code', 'ابعتلي الرمز على الإيميل')}
            {!busy && <Icon name="mail" size={18} />}
          </button>
        ) : (
          <form onSubmit={verify}>
            <label className="sl-field">
              <span>{tr('8-digit code', 'الرمز (8 أرقام)')}</span>
              <input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="00000000"
                value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} required autoFocus />
            </label>
            <label className="sl-field">
              <span>{tr('New password', 'كلمة المرور الجديدة')}</span>
              <span className="sl-pass">
                <input type={show ? 'text' : 'password'} dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password" minLength={8} placeholder="••••••••" required />
                <button type="button" onClick={() => setShow((v) => !v)} aria-label={tr('Show password', 'إظهار كلمة المرور')}>
                  <Icon name={show ? 'eye-off' : 'eye'} size={18} />
                </button>
              </span>
            </label>
            <label className="sl-field">
              <span>{tr('Confirm password', 'تأكيد كلمة المرور')}</span>
              <input type={show ? 'text' : 'password'} dir="ltr" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password" placeholder="••••••••" required aria-invalid={mismatch || undefined} />
            </label>
            <button type="submit" className="sl-submit" disabled={busy || otp.length !== 8}>
              {busy ? tr('Verifying…', 'جارٍ التحقق…') : tr('Change password and sign in', 'غيّر كلمة المرور وادخل')}
              {!busy && <Icon name="shield" size={18} />}
            </button>
            <button type="button" className="sl-alt" style={{ marginTop: 10, background: 'none', border: 0, cursor: 'pointer' }}
              disabled={busy || cooldown > 0} onClick={sendCode}>
              {cooldown > 0 ? `${tr('Resend in', 'إعادة الإرسال بعد')} ${cooldown}s` : tr('Resend the code', 'أعد إرسال الرمز')}
            </button>
          </form>
        )}

        <div className="sl-foot">
          <Link to={backPath} className="sl-back"><Icon name="arrow-left" size={16} /> {tr('Back to staff sign-in', 'الرجوع لدخول الفريق')}</Link>
        </div>
      </StaffShell>
    );
  }

  /* ---------- public look ---------- */
  return (
    <AuthLayout title={title} subtitle={lead} error={error} success={step === 'verify' ? info : null}>
      {step === 'send' ? (
        <button type="button" className={`auth-btn ${busy ? 'is-loading' : ''}`} disabled={busy} onClick={sendCode}>
          {!busy && <Icon name="mail" size={18} />}
          <span>{busy ? tr('Sending…', 'جارٍ الإرسال…') : tr('Email me a code', 'ابعتلي الرمز على الإيميل')}</span>
        </button>
      ) : (
        <form onSubmit={verify}>
          <AuthField
            id="otp" label={tr('8-digit code', 'الرمز (8 أرقام)')} icon="key" ltr inputMode="numeric"
            autoComplete="one-time-code" maxLength={8} placeholder="00000000"
            value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} required autoFocus
          />
          <PasswordField
            id="password" label={tr('New password', 'كلمة السر الجديدة')} value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password"
            minLength={8} showStrength showCapsWarning required
          />
          <PasswordField
            id="password_confirmation" label={tr('Confirm password', 'تأكيد كلمة السر')} value={confirm}
            onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" autoComplete="new-password"
            error={mismatch ? tr("Passwords don't match.", 'كلمتا السر غير متطابقتين.') : undefined} required
          />
          <button type="submit" className={`auth-btn ${busy ? 'is-loading' : ''}`} disabled={busy || otp.length !== 8 || mismatch}>
            {!busy && <Icon name="shield" size={18} />}
            <span>{busy ? tr('Verifying…', 'جارٍ التحقق…') : tr('Change password and sign in', 'غيّر كلمة السر وادخل')}</span>
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
        <Link to={backPath} className="auth-link">{tr('Back to sign in', 'الرجوع لتسجيل الدخول')}</Link>
      </div>
    </AuthLayout>
  );
}
