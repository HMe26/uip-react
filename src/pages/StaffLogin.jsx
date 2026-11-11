import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, ApiError } from '../context/AuthContext';
import { errorMessage } from '../api/client';
import { roleHome } from '../config/roleHome';
import { STAFF_LOGIN_PATH } from '../config/staffPortal';
import { clearGateToken } from '../config/staffGate';
import Icon from '../components/Icon';
import DeviceLimitList from '../components/DeviceLimitList';
import StaffShell, { useStaffText } from '../components/staff/StaffShell';

export default function StaffLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const t = useStaffText();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [takeoverToken, setTakeoverToken] = useState(null);
  const [blockedDevices, setBlockedDevices] = useState([]);
  // Set by the reset-password page after a successful reset.
  const [notice] = useState(location.state?.success ?? null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setTakeoverToken(null);
    setBlockedDevices([]);
    setBusy(true);
    try {
      const result = await login(email, password, 'staff');
      if (result.requiresTwoFactor) {
        navigate(`${STAFF_LOGIN_PATH}/two-factor`, { state: { challengeToken: result.challengeToken } });
        return;
      }
      navigate(roleHome(result.role), { replace: true });
    } catch (err) {
      // The server wants the access code again (ticket expired or missing): show the gate.
      if (err instanceof ApiError && err.payload?.errors?.code === 'staff_gate_required') { clearGateToken(); return; }
      if (err instanceof ApiError && err.payload?.data?.code === 'account_in_use') { setTakeoverToken(err.payload.data.takeover_token || null); setBlockedDevices(err.payload.data.devices || []); }
      setError(err instanceof ApiError ? errorMessage(err) : t('Something went wrong. Try again.', 'حصل خطأ. جرّب تاني.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <StaffShell>
      <h1 id="sl-title">{t('Staff access', 'دخول فريق المنصة')}</h1>
      <p className="sl-form__lead">
        {t('For platform administrators, data analysts and security teams.', 'لمديري المنصة ومحللي البيانات وفريق الأمن.')}
      </p>

      {notice && <div className="sl-success" role="status"><Icon name="check-circle" size={17} /> <span>{notice}</span></div>}
      {error && <div className="sl-error" role="alert"><Icon name="alert-triangle" size={17} /> <span>{error}</span></div>}

      <form onSubmit={submit}>
        <label className="sl-field">
          <span>{t('Work email', 'البريد الإلكتروني')}</span>
          <input
            type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)}
            autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false}
            placeholder="name@organisation.com" required autoFocus
          />
        </label>

        <label className="sl-field">
          <span className="sl-field__row">
            {t('Password', 'كلمة المرور')}
            <Link to={`${STAFF_LOGIN_PATH}/forgot-password`}>{t('Forgot password?', 'نسيت كلمة المرور؟')}</Link>
          </span>
          <span className="sl-pass">
            <input
              type={show ? 'text' : 'password'} dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password" placeholder="••••••••" required
            />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? t('Hide password', 'إخفاء كلمة المرور') : t('Show password', 'إظهار كلمة المرور')}>
              <Icon name={show ? 'eye-off' : 'eye'} size={18} />
            </button>
          </span>
        </label>

        <button type="submit" className="sl-submit" disabled={busy}>
          {busy ? t('Signing in…', 'جارٍ تسجيل الدخول…') : t('Sign in', 'تسجيل الدخول')}
          {!busy && <Icon name="arrow-right" size={18} />}
        </button>
      </form>

      {takeoverToken && blockedDevices.length > 0 && (
        <DeviceLimitList devices={blockedDevices} takeoverToken={takeoverToken} locale={(() => { try { return localStorage.getItem('uip_locale') === 'ar' ? 'ar' : 'en'; } catch { return 'en'; } })()} />
      )}

      {takeoverToken && (
        <div className="sl-foot" style={{ marginTop: 12 }}>
          <Link to={`${STAFF_LOGIN_PATH}/recover-account`} state={{ takeoverToken }} className="sl-alt">
            {t("This isn't me — recover my account", 'مش أنا — استرجع حسابي')}
            <Icon name="arrow-right" size={16} />
          </Link>
        </div>
      )}

      <div className="sl-foot">
        <p>{t('Students, universities and teaching staff sign in from the main page.', 'الطلاب والجامعات وأعضاء هيئة التدريس بيدخلوا من الصفحة الرئيسية.')}</p>
        <Link to="/auth/login" className="sl-alt">
          {t('Go to the main sign-in', 'الذهاب لصفحة الدخول الرئيسية')}
          <Icon name="arrow-right" size={16} />
        </Link>
      </div>
    </StaffShell>
  );
}
