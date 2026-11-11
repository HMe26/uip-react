import { useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';

/**
 * Live clock/date for the auth-layout topbar — 1:1 port of
 * public/assets/js/auth-clock.js. Ticks every second; locale-aware via
 * Intl so day/month names and AM-PM markers follow the current language,
 * while numerals stay Latin in both languages ('-u-nu-latn') — Arabic UIs
 * read a clock more easily in Latin digits than Eastern Arabic-Indic ones.
 */
export default function AuthClock() {
  const { locale } = useLanguage();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const localeTag = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US-u-nu-latn';
  const time = new Intl.DateTimeFormat(localeTag, {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  }).format(now);
  const date = new Intl.DateTimeFormat(localeTag, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(now);

  return (
    <div className="auth-clock" id="authClock" aria-live="off">
      <span className="auth-clock__time">{time}</span>
      <span className="auth-clock__date">{date}</span>
    </div>
  );
}
