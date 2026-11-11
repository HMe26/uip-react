import { createContext, useContext, useEffect, useState } from 'react';

const LanguageContext = createContext(null);

// Client-only equivalent of LocaleMiddleware.php (?lang=en|ar persisted to
// $_SESSION['locale']) + config/languages.php's dir per locale. A Bearer-
// token SPA has no persistent PHP session to write that into, so this
// mirrors the same choice ThemeContext already made for theme_preference:
// localStorage is the source of truth client-side, and a signed-in user's
// preferred_language field is patched to the API the same way theme is
// (see AdminSettings.jsx's AppearanceCard) for the account-level record.
const STORAGE_KEY = 'uip_locale';
const DIR = { en: 'ltr', ar: 'rtl' };

export function LanguageProvider({ children }) {
  const [locale, setLocale] = useState(() => localStorage.getItem(STORAGE_KEY) || 'en');

  useEffect(() => {
    document.documentElement.setAttribute('lang', locale);
    document.documentElement.setAttribute('dir', DIR[locale] || 'ltr');
    localStorage.setItem(STORAGE_KEY, locale);
  }, [locale]);

  const toggleLocale = () => setLocale((l) => (l === 'ar' ? 'en' : 'ar'));

  return (
    <LanguageContext.Provider value={{ locale, setLocale, toggleLocale, dir: DIR[locale] || 'ltr' }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside <LanguageProvider>');
  return ctx;
}

/**
 * Builds a `t(key)` lookup out of a { English: 'Arabic' } dictionary — the
 * exact shape scripts/extract_translations.py produces from a PHP view's
 * `$locale === 'ar' ? 'AR' : 'EN'` lines. Falls back to the English key
 * itself (which is always the real, already-shown string) whenever the
 * current locale is 'en' or a key hasn't been translated yet, so a page
 * mid-conversion never renders blank text.
 */
export function useTranslations(dict) {
  const { locale } = useLanguage();
  const t = (key) => (locale === 'ar' ? (dict[key] ?? key) : key);
  // Exposed so pages can pick the right side of bilingual API data (name_en/name_ar, {en, ar}).
  t.locale = locale;
  return t;
}
