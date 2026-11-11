import { Link, useLocation } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import Icon from '../../components/Icon';
import ErrorRing from '../../components/ErrorRing';
import SiteFooter from '../../components/SiteFooter';
import LandingNav from '../../components/LandingNav';
import AmbientBackdrop from '../../components/AmbientBackdrop';

/**
 * Shared shell for the full-page 404/403/500 states, in the Landing design
 * language (.lp2-err*, see styles/css/landing.css). The ErrorRing gauge stays
 * as the signature element (twin of the Readiness Ring on the Landing);
 * the "Request" line is the real path + status code so someone reporting the
 * problem has something concrete to paste. `extra` is an optional slot below
 * the actions (e.g. quick links on the 404).
 */
export default function ErrorPage({ code, statusKey, title, desc, primaryAction, showPath = true, extra = null }) {
  const { locale } = useLanguage();
  const isAr = locale === 'ar';
  const location = useLocation();

  return (
    <div className="lp2 lp2-page">
      <AmbientBackdrop />
      <LandingNav />

      <main className="lp2-err" data-code-color={code}>
        <div className="lp2-shell lp2-err__inner">
          <div className="lp2-err__ring animate-rise-in">
            <ErrorRing code={code} size={132} />
          </div>

          <p className="lp2-err__status animate-rise-in" style={{ animationDelay: '.05s' }}>
            <span className="lp2-err__dot" /> {isAr ? 'الحالة' : 'Status'} · {code} · {statusKey}
          </p>
          <h1 className="lp2-err__title animate-rise-in" style={{ animationDelay: '.08s' }}>{title}</h1>
          <p className="lp2-err__desc animate-rise-in" style={{ animationDelay: '.11s' }}>{desc}</p>

          <div className="lp2-err__actions animate-rise-in" style={{ animationDelay: '.14s' }}>
            {primaryAction}
            <Link to="/" className="btn btn-outline">
              <Icon name="home" size={16} />
              {isAr ? 'الصفحة الرئيسية' : 'Go home'}
            </Link>
          </div>

          {showPath && (
            <p className="lp2-err__log animate-rise-in" style={{ animationDelay: '.17s' }} dir="ltr">
              <span>{isAr ? 'الطلب' : 'Request'}</span>
              <code>GET {location.pathname}</code>
              <strong>→ {code}</strong>
            </p>
          )}

          {extra}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
