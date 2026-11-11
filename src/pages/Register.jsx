import { validateNames } from '../utils/bilingualName';
import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import AuthLayout from '../layouts/AuthLayout';
import Icon from '../components/Icon';
import { AuthField, PasswordField } from '../components/auth/AuthField';
import AcademicFields from '../components/auth/AcademicFields';
import GoogleAuthSection from '../components/auth/GoogleAuthSection';
import { useLanguage, useTranslations } from '../context/LanguageContext';
import i18nCommon from '../i18n/common';
import i18nPage from '../i18n/auth/pages';

const translations = { ...i18nCommon, ...i18nPage };

// Public sign-up is for students only (same as RegisterController::SELF_REGISTER_ROLES).
// University accounts are created by a platform admin (Admin → Users) and can only sign in.


/**
 * Mirrors app/Views/auth/register.php + RegisterController::submit().
 *
 * The student-only university/faculty/department cascade is wired
 * to the two read-only endpoints RegisterController now exposes for it
 * (routes/api.php):
 *   GET /api/v1/auth/universities                -> RegisterController::universities()
 *   GET /api/v1/auth/university-hierarchy/{id}    -> RegisterController::universityHierarchy()
 * Faculty/department stay optional exactly like the PHP form and
 * RegisterController::submit() (only sent to the backend when a
 * university was actually picked), and the department list is
 * filtered client-side by faculty_id/department_id the same way the
 * inline <script> in register.php does it — the hierarchy endpoint
 * returns the whole tree for the university in one call, not scoped
 * lookups per level.
 */
export default function Register() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const navigate = useNavigate();
  const L = (en, ar) => (locale === 'ar' ? ar : en);
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [email, setEmail] = useState('');
  const role = 'student';
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Email belonged to a deleted account (409 deleted_account_found): offer restore, or continue as a new account.
  const [deletedInfo, setDeletedInfo] = useState(null);
  // 1 = account details, 2 = academic details (optional). Both stay mounted so nothing is lost when going back.
  const [step, setStep] = useState(1);
  // Admin → Platform Policy can close public sign-up: show it up front instead of failing on submit.
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get('/api/v1/platform/status')
      .then((json) => { if (alive && json?.data?.registration_enabled === false) { setClosed(true); setError(t('New registrations are currently closed. Please contact the platform administrators.')); } })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // University/faculty/department picked in <AcademicFields/> (only the chosen ids are set).
  const [academic, setAcademic] = useState({});
  const isStudent = role === 'student';

  const mismatch = passwordConfirmation !== '' && password !== passwordConfirmation;

  async function handleSubmit(e, continueAsNew = false) {
    e?.preventDefault?.();
    setError(null);
    if (!continueAsNew) setDeletedInfo(null);

    if (password !== passwordConfirmation) {
      setStep(1);
      setError(t("Passwords don't match."));
      return;
    }

    // Arabic + English name are both required (and must be in the right script).
    const nameCheck = validateNames(nameAr, nameEn, locale);
    if (!nameCheck.ok) {
      setStep(1);
      setError(Object.values(nameCheck.errors)[0]);
      return;
    }

    // Step 1 -> 2 (native `required`/`minLength` checks already ran on submit).
    if (step === 1 && !continueAsNew) {
      setStep(2);
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name_ar: nameAr.trim(),
        name_en: nameEn.trim(),
        email,
        role,
        password,
        password_confirmation: passwordConfirmation,
      };
      // Same optionality as RegisterController::submit(): only sent once a university was actually chosen.
      if (isStudent) Object.assign(payload, academic);
      if (continueAsNew) payload.continue_as_new = true;
      const res = await api.post('/api/v1/auth/register', payload);
      const mailed = res?.data?.email_sent !== false;
      // Confirmation is by a 6-digit code now: go straight to the code screen.
      navigate('/auth/verify-email', { state: { email: res?.data?.email || email, sent: mailed } });
    } catch (err) {
      if (err?.payload?.errors?.code === 'deleted_account_found') {
        setDeletedInfo(err.payload.data || { email });
        setError(null);
      } else {
        // Account-detail problems (email taken, weak password…) live on step 1.
        const keys = Object.keys(err?.payload?.errors || {});
        if (keys.some((k) => ['name_ar', 'name_en', 'email', 'password'].includes(k))) setStep(1);
        setError(errorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title={t('Create your account')}
      subtitle={step === 1 ? L('Join UIPE as a student', 'انضم لـ UIPE كطالب') : L('Almost done — tell us where you study (optional)', 'خلاص تقريباً — قولنا بتدرس فين (اختياري)')}
      error={error}
      wide
    >
      <div className="auth-steps" aria-label={L(`Step ${step} of 2`, `الخطوة ${step} من 2`)}>
        <div className="auth-steps__bar" aria-hidden="true">
          <i className="is-on" /><i className={step === 2 ? 'is-on' : ''} />
        </div>
        <span className="auth-steps__label">{step}/2</span>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="auth-step" hidden={step !== 1}>
          <GoogleAuthSection onError={setError} placement="before" />

          <div className="auth-row">
            <AuthField
              id="name_ar"
              type="text"
              label={L('Full name (Arabic)', 'الاسم بالكامل (بالعربي)')}
              icon="user"
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              placeholder="هيثم محمد كامل"
              autoComplete="off"
              lang="ar"
              required
              autoFocus
            />
            <AuthField
              id="name_en"
              type="text"
              label={L('Full name (English)', 'الاسم بالكامل (بالإنجليزي)')}
              icon="user"
              ltr
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              placeholder="Haitham Mohamed Kamel"
              autoComplete="off"
              lang="en"
              required
            />
          </div>

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
          />

          <div className="auth-row">
            <PasswordField
              id="password"
              label={t('Password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={8}
              hint={t('At least 8 characters')}
              showStrength
              showCapsWarning
              required
            />
            <PasswordField
              id="password_confirmation"
              label={t('Confirm password')}
              value={passwordConfirmation}
              onChange={(e) => setPasswordConfirmation(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={8}
              error={mismatch ? t("Passwords don't match.") : undefined}
              required
            />
          </div>

          <button type="submit" className="auth-btn" disabled={mismatch || closed}>
            <span>{L('Next', 'التالي')}</span>
            <span className="auth-dir-icon"><Icon name="arrow-right" size={18} /></span>
          </button>
        </div>

        <div className="auth-step" hidden={step !== 2}>
          {isStudent && <AcademicFields onChange={setAcademic} compact />}

          {deletedInfo && (
            <div className="auth-notice" role="status" style={{ margin: '12px 0', padding: 12, border: '1px solid var(--color-border, #ccc)', borderRadius: 8 }}>
              <strong>{L('This email belonged to a deleted account.', 'الإيميل ده كان عليه حساب اتحذف.')}</strong>
              <p style={{ margin: '6px 0' }}>
                {deletedInfo.can_self_restore
                  ? L('You can restore it with all its data (we will email you a code), or continue and create a brand-new account.', 'تقدر تسترجعه بكل بياناته (هنبعتلك رمز على الإيميل)، أو تكمّل وتعمل حساب جديد خالص.')
                  : L('It can only be restored by support. You can continue and create a new account.', 'استرجاعه بيتم عن طريق الدعم بس. تقدر تكمّل وتعمل حساب جديد.')}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {deletedInfo.can_self_restore && (
                  <button type="button" className="btn btn-primary" onClick={() => navigate('/auth/restore-account', { state: { email: deletedInfo.email || email } })}>
                    {L('Restore my account', 'استرجع حسابي')}
                  </button>
                )}
                <button type="button" className="btn btn-outline" disabled={submitting} onClick={() => handleSubmit(null, true)}>
                  {L('Create a new account', 'اعمل حساب جديد')}
                </button>
              </div>
            </div>
          )}

          <div className="auth-actions">
            <button type="button" className="auth-btn auth-btn--ghost" onClick={() => setStep(1)} aria-label={L('Back', 'رجوع')}>
              <span className="auth-back-icon"><Icon name="arrow-right" size={18} /></span>
            </button>
            <button type="submit" className={`auth-btn ${submitting ? 'is-loading' : ''}`} disabled={submitting || mismatch || closed}>
              <span>{submitting ? t('Creating account…') : t('Create account')}</span>
            </button>
          </div>
        </div>
      </form>

      <div className="auth-footer-link">
        {t('Already have an account?')} <Link to="/auth/login" className="auth-link">{t('Sign in')}</Link>
      </div>
    </AuthLayout>
  );
}
