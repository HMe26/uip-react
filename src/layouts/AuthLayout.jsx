import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import AuthClock from '../components/AuthClock';
import AuthIllustration from '../components/auth/AuthIllustration';
import LanguageMenu from '../components/auth/LanguageMenu';
import useInspectGuard from '../hooks/useInspectGuard';
import { useTheme } from '../context/ThemeContext';
import { useTranslations } from '../context/LanguageContext';
import i18nCommon from '../i18n/common';
import i18nPage from '../i18n/layouts/auth-layout';

const translations = { ...i18nCommon, ...i18nPage };

const FEATURES = [
  { icon: 'chat', tone: 'blue', title: 'Chat, meetings and community', text: 'Messages, calls, video meetings, posts and stories with your classmates and instructors.' },
  { icon: 'sparkles', tone: 'violet', title: 'Study, exams and AI help', text: 'Courses, exams, your files and an AI tutor beside you, plus projects to publish.' },
  { icon: 'shield', tone: 'green', title: 'Private and secure', text: 'You control who sees your profile. Two-step sign-in and activity logs protect every account.' },
];

/**
 * Shared shell for every unauthenticated screen (login, register,
 * forgot/reset password, two-factor, verify/confirm-email).
 *
 * Layout (see styles/css/pages/auth.css):
 *   ≥1200px  hero text | illustration | form card
 *   900-1199 hero text | form card            (illustration hidden)
 *   <900px   hero headline → form card → feature list   (form first, no
 *            long marketing block in front of the fields)
 *
 * API is unchanged: `title` / `subtitle` come already translated from the
 * calling page; `error` / `success` render the shared `.auth-alert`.
 */
export default function AuthLayout({ title, subtitle, error, success, wide = false, children }) {
  const t = useTranslations(translations);
  const { theme, toggleTheme } = useTheme();
  useInspectGuard();

  return (
    <div className="auth-shell">
      <div className="auth-bg" aria-hidden="true">
        <span className="auth-bg__orb auth-bg__orb--1" />
        <span className="auth-bg__orb auth-bg__orb--2" />
        <span className="auth-bg__grid" />
      </div>

      <a className="auth-skip" href="#auth-card">{t('Skip to form')}</a>

      <header className="auth-topbar">
        <Link to="/" className="auth-brand" aria-label={t('UIPE — Unified Integrated Platform Ecosystem')}>
          <img className="auth-brand__word" src="/images/logo/uipe-wordmark-sm.png" srcSet="/images/logo/uipe-wordmark-sm.png 1x, /images/logo/uipe-wordmark.png 2x" alt="UIPE" width="112" height="44" />
          <span className="auth-brand__text" dir="ltr">
            <small>{t('UNIFIED INTEGRATED PLATFORM ECOSYSTEM')}</small>
            <em>{t('One Platform. Endless Connections.')}</em>
          </span>
        </Link>

        <AuthClock />

        <div className="auth-topbar__actions">
          <LanguageMenu />
          <button
            type="button"
            className="auth-chip auth-chip--icon"
            onClick={toggleTheme}
            aria-label={t('Toggle dark / light mode')}
            title={t('Toggle dark / light mode')}
          >
            <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={17} />
          </button>
        </div>
      </header>

      <div className={`auth-main ${wide ? 'auth-main--wide' : ''}`}>
        <section className="auth-hero">
          <span className="auth-pill">
            {t('Learn')}<i /> {t('Connect')}<i /> {t('Grow')}
          </span>
          <h2 className="auth-hero__title">
            {t('Your whole university,')} <span className="auth-grad-text">{t('in one place')}</span>
          </h2>
          <p className="auth-hero__sub">
            {t('One account for chat, video meetings, courses, exams, your files, a social community and project publishing — for students, instructors and universities.')}
          </p>
        </section>

        <div className="auth-art-wrap"><AuthIllustration /></div>

        <main className="auth-card" id="auth-card" tabIndex={-1}>
          {title && <h1 className="auth-title">{title}</h1>}
          {subtitle && <p className="auth-subtitle">{subtitle}</p>}

          {error && (
            <div className="auth-alert auth-alert--error" role="alert">
              <Icon name="alert-triangle" size={18} />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="auth-alert auth-alert--success" role="status">
              <Icon name="check-circle" size={18} />
              <span>{success}</span>
            </div>
          )}

          {children}
        </main>

        <ul className="auth-features">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <span className={`auth-feature__icon auth-feature__icon--${f.tone}`}><Icon name={f.icon} size={20} /></span>
              <div>
                <strong>{t(f.title)}</strong>
                <span>{t(f.text)}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <footer className="auth-footer">
        <Icon name="lock" size={14} />
        <span>{t('Your data is encrypted and protected under industry-standard security practices.')}</span>
        <Link to="/privacy-policy">{t('Privacy policy')}</Link>
      </footer>
    </div>
  );
}
