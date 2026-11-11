import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth, ApiError } from '../context/AuthContext';
import { api, errorMessage } from '../api/client';
import StaffAccessButton from '../components/StaffAccessButton'; // [ANDROID]
import DeviceLimitList from '../components/DeviceLimitList';
import GoogleAuthSection from '../components/auth/GoogleAuthSection';
import AuthLayout from '../layouts/AuthLayout';
import Icon from '../components/Icon';
import { AuthField, PasswordField } from '../components/auth/AuthField';
import { roleHome } from '../config/roleHome';
import { STAFF_LOGIN_PATH } from '../config/staffPortal';
import { useLanguage, useTranslations } from '../context/LanguageContext';
import i18nCommon from '../i18n/common';
import i18nPage from '../i18n/auth/login';

const translations = { ...i18nCommon, ...i18nPage };

// Account types offered on the public sign-in (staff roles use the hidden staff page instead).
// `register: true` = people can self-register as this type (students only); every other type — including
// universities — is created by an admin (or by its university) and can only sign in.
const ACCOUNT_TYPES = [
  { slug: 'student', icon: 'user', en: 'Student', ar: 'طالب', register: true },
  { slug: 'university', icon: 'building', en: 'University', ar: 'جامعة', register: false },
  { slug: 'faculty', icon: 'award', en: 'Faculty', ar: 'كلية', register: false },
  { slug: 'academic_staff', icon: 'users', en: 'Academic staff (Doctor)', ar: 'دكتور / عضو هيئة تدريس', register: false },
  { slug: 'supervisor', icon: 'shield', en: 'Supervisor', ar: 'مشرف', register: false },
];

export default function Login({ portal } = {}) {
  const isStaff = portal === 'staff';
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  // Password was right but the e-mail address was never confirmed: offer to send the confirmation link again.
  const [unverified, setUnverified] = useState(false);
  const [resend, setResend] = useState({ busy: false, done: false });
  // Fallback when the confirmation e-mail never arrives: activate the account with the (correct) password.
  const [canActivate, setCanActivate] = useState(false);
  const [activation, setActivation] = useState({ busy: false, message: null });
  // Register.jsx / ResetPassword.jsx redirect here with a flash message in
  // location.state (same as Session::flash + redirect on the PHP side).
  const [success] = useState(location.state?.success ?? null);
  // Public sign-in asks "who are you?" first; the server refuses the login if the account is another type.
  const [accountType, setAccountType] = useState(() => {
    const preset = new URLSearchParams(location.search).get('as');
    return ACCOUNT_TYPES.some((a) => a.slug === preset) ? preset : null;
  });
  const chosen = ACCOUNT_TYPES.find((a) => a.slug === accountType) || null;
  const [submitting, setSubmitting] = useState(false);
  // Set when the server says the account is already open elsewhere: lets the owner recover it.
  const [takeoverToken, setTakeoverToken] = useState(null);
  const [blockedDevices, setBlockedDevices] = useState([]);

  // The staff page must not be indexed or cached by search engines.
  useEffect(() => {
    if (!isStaff) return undefined;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [isStaff]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setTakeoverToken(null);
    setBlockedDevices([]);
    setUnverified(false);
    setResend({ busy: false, done: false });
    setActivation({ busy: false, message: null });
    setSubmitting(true);
    try {
      const result = await login(email, password, isStaff ? 'staff' : undefined, isStaff ? undefined : accountType);
      if (result.requiresTwoFactor) {
        navigate(isStaff ? `${STAFF_LOGIN_PATH}/two-factor` : '/auth/two-factor', { state: { challengeToken: result.challengeToken } });
        return;
      }
      navigate(roleHome(result.role), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.payload?.errors?.code === 'email_not_verified') {
        setUnverified(true);
        setCanActivate(err.payload?.data?.activation_fallback !== false);
      }
      if (err instanceof ApiError && err.payload?.data?.code === 'account_in_use') { setTakeoverToken(err.payload.data.takeover_token || null); setBlockedDevices(err.payload.data.devices || []); }
      setError(err instanceof ApiError ? errorMessage(err) : t('Something went wrong. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function resendVerification() {
    setResend({ busy: true, done: false });
    try { await api.post('/api/v1/auth/resend-verification', { email }); } catch { /* the reply is always generic */ }
    setResend({ busy: false, done: true });
  }

  async function activateNow() {
    if (!email || !password) {
      setError(t('Enter your email and password first, then tap activate.'));
      return;
    }
    setError(null);
    setActivation({ busy: true, message: null });
    try {
      const res = await api.post('/api/v1/auth/activate-without-email', { email, password });
      if (res?.data?.activated) {
        setUnverified(false);
        setError(null);
        setActivation({ busy: false, message: res?.message || t('Your account is activated. You can sign in now.') });
      } else {
        setActivation({ busy: false, message: res?.message || t('We sent the confirmation email. Check your inbox and spam.') });
      }
    } catch (err) {
      setActivation({ busy: false, message: null });
      setError(errorMessage(err));
    }
  }

  if (!isStaff && !chosen) {
    return (
      <AuthLayout title={t('Who are you?')} subtitle={t('Choose your account type to sign in')} success={success} error={error}>
        <div className="auth-roles">
          {ACCOUNT_TYPES.map((a) => (
            <button key={a.slug} type="button" className="auth-role" onClick={() => setAccountType(a.slug)}>
              <span className="auth-role__icon"><Icon name={a.icon} size={20} /></span>
              <span className="auth-role__label">{a[locale] || a.en}</span>
              <span className="auth-role__go"><Icon name="chevron-right" size={18} /></span>
            </button>
          ))}
        </div>
        <GoogleAuthSection onError={setError} />
        <div className="auth-footer-link">
          {t("Don't have an account?")} <Link to="/auth/register" className="auth-link">{t('Create one')}</Link>
        </div>
        <StaffAccessButton /> {/* [ANDROID] renders nothing in the browser */}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={isStaff ? t('Staff sign in') : t('Welcome back')} subtitle={isStaff ? t('Authorised platform staff only') : `${t('Signing in as')} ${chosen[locale] || chosen.en}`} error={error} success={activation.message || success}>
      {!isStaff && (
        <button type="button" className="auth-link" style={{ background: 'none', border: 0, padding: 0, marginBottom: 12, cursor: 'pointer' }}
          onClick={() => { setAccountType(null); setError(null); }}>
          {t('Not a')} {chosen[locale] || chosen.en}? {t('Change account type')}
        </button>
      )}
      <form onSubmit={handleSubmit} noValidate={false}>
        <AuthField
          id="email"
          type="email"
          label={t('Email')}
          icon="mail"
          ltr
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
        />

        <PasswordField
          id="password"
          label={t('Password')}
          labelAside={
            <Link to="/auth/forgot-password" className="auth-link" style={{ fontSize: '0.8125rem' }}>
              {t('Forgot password?')}
            </Link>
          }
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
          showCapsWarning
          required
        />

        <button type="submit" className={`auth-btn ${submitting ? 'is-loading' : ''}`} disabled={submitting}>
          <span>{submitting ? t('Signing in…') : t('Sign in')}</span>
          {!submitting && <span className="auth-dir-icon"><Icon name="arrow-right" size={18} /></span>}
        </button>
      </form>

      {unverified && (
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          <Link to="/auth/verify-email" state={{ email }} className="auth-link" style={{ display: 'inline-block', padding: '10px 0', fontWeight: 700 }}>
            {t('Enter confirmation code')}
          </Link>
          {resend.done ? (
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--a-success)' }}>{t('If your account needs confirmation, a new code is on its way. Check your inbox and spam.')}</p>
          ) : (
            <button type="button" className="auth-link" disabled={resend.busy} onClick={resendVerification}
              style={{ background: 'none', border: 0, padding: '10px 0', cursor: 'pointer', fontWeight: 700 }}>
              {resend.busy ? t('Sending…') : t('Resend confirmation code')}
            </button>
          )}
          {canActivate && (
            <div style={{ marginTop: 6 }}>
              <p style={{ margin: '0 0 6px', fontSize: '0.85rem', opacity: 0.8 }}>{t("Didn't get the email or can't open it?")}</p>
              <button type="button" className="auth-btn" disabled={activation.busy} onClick={activateNow}>
                <span>{activation.busy ? t('Activating…') : t('Activate my account now')}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Always available on the public sign-in: the confirmation e-mail may never arrive (or the address can't be opened). */}
      {!isStaff && !unverified && (
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          <button type="button" className="auth-link" disabled={activation.busy} onClick={activateNow}
            style={{ background: 'none', border: 0, padding: '8px 0', cursor: 'pointer', fontWeight: 700 }}>
            {activation.busy ? t('Activating…') : t('Account not activated? Activate it now')}
          </button>
        </div>
      )}

      {!isStaff && <GoogleAuthSection onError={setError} />}

      {takeoverToken && blockedDevices.length > 0 && <DeviceLimitList devices={blockedDevices} takeoverToken={takeoverToken} locale={locale} />}

      {takeoverToken && (
        <div className="auth-footer-link" style={{ marginTop: 14 }}>
          <Link to="/auth/recover-account" state={{ takeoverToken }} className="auth-link" style={{ fontWeight: 700 }}>
            {locale === 'ar' ? 'مش أنا — استرجع حسابي' : "This isn't me — recover my account"}
          </Link>
        </div>
      )}

      {!isStaff && chosen.register && (
        <div className="auth-footer-link">
          {t("Don't have an account?")} <Link to={`/auth/register?role=${chosen.slug}`} className="auth-link">{t('Create one')}</Link>
        </div>
      )}
    </AuthLayout>
  );
}
