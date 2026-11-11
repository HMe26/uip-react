import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';

/**
 * Language switch for the auth pages: a single globe icon button (same look as the theme button next to it and
 * as the landing page's), one tap flips Arabic <-> English. No dropdown, so nothing can get clipped.
 */
export default function LanguageMenu() {
  const { locale, toggleLocale } = useLanguage();
  const label = locale === 'ar' ? 'English' : 'العربية';
  return (
    <button
      type="button"
      className="auth-chip auth-chip--icon"
      onClick={toggleLocale}
      aria-label={label}
      title={label}
    >
      <Icon name="globe" size={17} />
    </button>
  );
}
