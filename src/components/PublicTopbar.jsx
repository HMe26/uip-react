import { Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import BrandWordmark from './BrandWordmark';
import { useTheme } from '../context/ThemeContext';
import Icon from './Icon';

/**
 * Port of app/Views/layouts/public-layout.php's public_layout_open() chrome —
 * the brand mark (→ home), "Back to site" pill, language toggle, and
 * dark/light toggle every PHP-rendered public page (/projects,
 * /projects/{slug}, /privacy-policy, /verify-certificate, university/
 * faculty/department directories, portfolio share pages…) renders above its
 * own per-page heading. Distinct from that per-page heading — e.g.
 * ProjectsShowcase's own "Explore Student Projects" + description block,
 * which stays where it is; this is the site-wide row above it.
 *
 * Landing is the one public page that doesn't use this: it has its own
 * `.lp-nav` (marketing nav with in-page anchor links + auth CTAs) matching
 * landing.php, which never calls public_layout_open() either.
 */
export default function PublicTopbar() {
  const { locale, toggleLocale } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const isAr = locale === 'ar';
  const t = (en, ar) => (isAr ? ar : en);

  return (
    <div className="public-topbar">
      <Link to="/" className="public-brand">
        <BrandWordmark className="public-brand__word" width={96} height={37} alt="UIPE" />
      </Link>
      <div className="public-topbar__actions">
        <Link className="public-pill-btn" to="/">
          <Icon name={isAr ? 'arrow-right' : 'arrow-left'} size={16} />
          {t('Back to site', 'رجوع للموقع')}
        </Link>
        <button
          type="button" className="public-icon-btn" onClick={toggleLocale}
          aria-label={t('العربية', 'English')} title={t('العربية', 'English')}
        >
          <Icon name="globe" size={18} />
        </button>
        <button
          type="button" className="public-icon-btn" onClick={toggleTheme}
          aria-label={t('Toggle dark mode', 'تبديل الوضع الليلي')} aria-pressed={theme === 'dark'}
          title={t('Toggle dark mode', 'تبديل الوضع الليلي')}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
        </button>
      </div>
    </div>
  );
}
