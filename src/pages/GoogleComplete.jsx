import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, ApiError } from '../context/AuthContext';
import { errorMessage } from '../api/client';
import AuthLayout from '../layouts/AuthLayout';
import Icon from '../components/Icon';
import { AuthField } from '../components/auth/AuthField';
import AcademicFields from '../components/auth/AcademicFields';
import { roleHome } from '../config/roleHome';
import { validateNames } from '../utils/bilingualName';
import { useLanguage } from '../context/LanguageContext';

/**
 * Step 2 of "Continue with Google" for someone who has no account yet.
 * Name, email and photo come from Google; whatever Google can't give us (usually the name in the
 * other language — every person has an Arabic AND an English name) plus their university is asked
 * here. Nothing is created until they press the button (POST /auth/google/complete).
 */
export default function GoogleComplete() {
  const { state } = useLocation();
  const reg = state?.registration;
  const { completeGoogleSignup, restoreGoogleDeleted } = useAuth();
  const { locale } = useLanguage();
  const navigate = useNavigate();
  const L = (en, ar) => (locale === 'ar' ? ar : en);

  const profile = reg?.profile || {};
  const provName = profile.provider === 'github' ? 'GitHub' : profile.provider === 'microsoft' ? 'Microsoft' : 'Google';
  const provNameAr = profile.provider === 'github' ? 'GitHub' : profile.provider === 'microsoft' ? 'مايكروسوفت' : 'جوجل';
  const deleted = reg?.deletedAccount || null;
  const missing = reg?.missing || [];
  const [nameAr, setNameAr] = useState(profile.name_ar || '');
  const [nameEn, setNameEn] = useState(profile.name_en || '');
  const [academic, setAcademic] = useState({});
  const [error, setError] = useState(null);
  const [expired, setExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [photoOk, setPhotoOk] = useState(true);

  // Opened directly (refresh / bookmark): the Google token isn't kept anywhere, so start over.
  if (!reg?.registrationToken) return <Navigate to="/auth/login" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    const check = validateNames(nameAr, nameEn, locale);
    if (!check.ok) {
      setError(Object.values(check.errors)[0]);
      return;
    }
    setSubmitting(true);
    try {
      const r = await completeGoogleSignup({
        registration_token: reg.registrationToken,
        name_ar: check.name_ar,
        name_en: check.name_en,
        preferred_language: locale === 'ar' ? 'ar' : 'en',
        ...academic,
      });
      if (r.requiresTwoFactor) {
        navigate('/auth/two-factor', { state: { challengeToken: r.challengeToken } });
        return;
      }
      navigate(roleHome(r.role), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.payload?.errors?.code === 'signup_expired') setExpired(true);
      setError(err instanceof ApiError ? errorMessage(err) : L('Something went wrong. Please try again.', 'حصل خطأ. جرّب تاني.'));
    } finally {
      setSubmitting(false);
    }
  }

  // This Google email belonged to a deleted account: Google already proved ownership, so restore it (no code needed).
  async function handleRestore() {
    setError(null);
    setSubmitting(true);
    try {
      const r = await restoreGoogleDeleted(reg.registrationToken);
      if (r.requiresTwoFactor) {
        navigate('/auth/two-factor', { state: { challengeToken: r.challengeToken } });
        return;
      }
      navigate(roleHome(r.role), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.payload?.errors?.code === 'signup_expired') setExpired(true);
      setError(err instanceof ApiError ? errorMessage(err) : L('Something went wrong. Please try again.', 'حصل خطأ. جرّب تاني.'));
    } finally {
      setSubmitting(false);
    }
  }

  const initial = (profile.name || profile.email || '?').trim().charAt(0).toUpperCase();

  return (
    <AuthLayout
      title={L('Almost there!', 'قربنا نخلّص!')}
      subtitle={L('Confirm a few details to create your student account', 'كمّل شوية بيانات عشان نعمل حساب الطالب بتاعك')}
      error={error}
    >
      <div className="auth-profile">
        {profile.picture && photoOk ? (
          <img className="auth-profile__img" src={profile.picture} alt="" referrerPolicy="no-referrer" onError={() => setPhotoOk(false)} />
        ) : (
          <span className="auth-profile__img auth-profile__img--fallback" aria-hidden="true">{initial}</span>
        )}
        <div className="auth-profile__text">
          <strong>{profile.name || profile.email}</strong>
          <span dir="ltr">{profile.email}</span>
          <small><Icon name="shield" size={13} /> {profile.provider === 'github' ? L('Verified by GitHub', 'متأكد منه GitHub') : profile.provider === 'microsoft' ? L('Verified by Microsoft', 'متأكد منه مايكروسوفت') : L('Verified by Google', 'متأكد منه جوجل')}</small>
        </div>
      </div>

      {deleted && !expired && (
        <div className="auth-notice" role="status" style={{ margin: '12px 0', padding: 12, border: '1px solid var(--color-border, #ccc)', borderRadius: 8 }}>
          <strong>{L('You had an account with this email that was deleted.', 'كان عندك حساب بنفس الإيميل ده واتحذف.')}</strong>
          <p style={{ margin: '6px 0' }}>
            {deleted.can_restore
              ? L('Restore it with all its data, or fill in the form below to create a new account instead.', 'استرجعه بكل بياناته، أو كمّل الفورم اللي تحت وأنشئ حساب جديد.')
              : L('It can only be restored by support. You can create a new account below.', 'استرجاعه بيتم عن طريق الدعم بس. تقدر تنشئ حساب جديد من تحت.')}
          </p>
          {deleted.can_restore && (
            <button type="button" className="btn btn-primary" disabled={submitting} onClick={handleRestore}>
              {L('Restore my account', 'استرجع حسابي')}
            </button>
          )}
        </div>
      )}

      {expired ? (
        <div className="auth-footer-link">
          <Link to="/auth/login" className="auth-link">{L('Start again', 'ابدأ من الأول')}</Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
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
            hint={missing.includes('name_ar') ? L(`${provName} gave us your name in English only — please add it in Arabic.`, `${provNameAr} ادّانا اسمك بالإنجليزي بس — اكتبه بالعربي.`) : undefined}
            required
            autoFocus={missing.includes('name_ar')}
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
            hint={missing.includes('name_en') ? L(`${provName} gave us your name in Arabic only — please add it in English.`, `${provNameAr} ادّانا اسمك بالعربي بس — اكتبه بالإنجليزي.`) : undefined}
            required
            autoFocus={missing.includes('name_en') && !missing.includes('name_ar')}
          />

          <AcademicFields onChange={setAcademic} />

          <button type="submit" className={`auth-btn ${submitting ? 'is-loading' : ''}`} disabled={submitting}>
            <span>{submitting ? L('Creating account…', 'جارٍ إنشاء الحساب…') : L('Create my account', 'إنشاء حسابي')}</span>
            {!submitting && <span className="auth-dir-icon"><Icon name="arrow-right" size={18} /></span>}
          </button>
        </form>
      )}

      <div className="auth-footer-link">
        <Link to="/auth/login" className="auth-link">{L('Use a different account', 'استخدم حساب تاني')}</Link>
      </div>
    </AuthLayout>
  );
}
