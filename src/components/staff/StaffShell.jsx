import { useEffect, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import BrandWordmark from '../BrandWordmark';
import { useTheme } from '../../context/ThemeContext';
import Icon from '../Icon';
import '../../styles/css/pages/staff-login.css';

const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap';

const LANES = [
  {
    icon: 'settings',
    en: ['Platform administration', 'Users, roles, universities and approvals'],
    ar: ['إدارة المنصة', 'المستخدمون والأدوار والجامعات والاعتمادات'],
  },
  {
    icon: 'chart',
    en: ['Data analysis', 'Dashboards, reports and data exports'],
    ar: ['تحليل البيانات', 'اللوحات والتقارير وتصدير البيانات'],
  },
  {
    icon: 'shield',
    en: ['Cybersecurity', 'Incidents, sessions, policies and logs'],
    ar: ['الأمن السيبراني', 'الحوادث والجلسات والسياسات والسجلات'],
  },
];

/** Rings that "open" once on load — the badge's aperture. Decorative. */
function Aperture() {
  return (
    <svg className="sl-aperture" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      <g fill="none" strokeLinecap="round">
        <circle className="sl-ring sl-ring--1" cx="200" cy="200" r="64" />
        <circle className="sl-ring sl-ring--2" cx="200" cy="200" r="104" />
        <circle className="sl-ring sl-ring--3" cx="200" cy="200" r="144" />
        <circle className="sl-ring sl-ring--4" cx="200" cy="200" r="184" />
      </g>
      <circle className="sl-dot" cx="200" cy="200" r="6" />
    </svg>
  );
}

/** Live time and date, top corner. Ticks every second; Latin digits in both languages (easier to read on a clock). */
function StaffClock({ locale }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const tag = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB-u-nu-latn';
  const time = new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(now);
  const date = new Intl.DateTimeFormat(tag, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  return (
    <div className="sl-clock" aria-hidden="true">
      <span className="sl-clock__time" dir="ltr">{time}</span>
      <span className="sl-clock__date">{date}</span>
    </div>
  );
}

/** Picks the English or Arabic text for the current language. */
export function useStaffText() {
  const { locale } = useLanguage();
  return (en, ar) => (locale === 'ar' ? ar : en);
}

/**
 * The staff pass: ink side (what staff can reach) + paper side (the form, passed as children).
 * Shared by the hidden staff sign-in and its forgot / reset password pages so they look like one place.
 */
export default function StaffShell({ titleId = 'sl-title', children }) {
  const { locale, toggleLocale } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const ar = locale === 'ar';
  const t = (en, arText) => (ar ? arText : en);

  // Not for search engines; fonts are loaded only on the staff pages.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    const font = document.createElement('link');
    font.rel = 'stylesheet';
    font.href = FONT_HREF;
    document.head.append(meta, font);
    const prevTitle = document.title;
    document.title = 'UIPE';
    return () => { meta.remove(); font.remove(); document.title = prevTitle; };
  }, []);

  return (
    <div className="sl-page" dir={ar ? 'rtl' : 'ltr'} data-theme={theme === 'dark' ? 'dark' : 'light'}>
      <div className="sl-bg" aria-hidden="true">
        <span className="sl-bg__orb sl-bg__orb--1" />
        <span className="sl-bg__orb sl-bg__orb--2" />
        <span className="sl-bg__orb sl-bg__orb--3" />
        <span className="sl-bg__grid" />
        <span className="sl-bg__shape sl-bg__shape--ring" style={{ '--x': '12%', '--s': '26px', '--d': '0s', '--t': '19s' }} />
        <span className="sl-bg__shape sl-bg__shape--dot" style={{ '--x': '28%', '--s': '10px', '--d': '4s', '--t': '16s' }} />
        <span className="sl-bg__shape sl-bg__shape--square" style={{ '--x': '47%', '--s': '20px', '--d': '9s', '--t': '22s' }} />
        <span className="sl-bg__shape sl-bg__shape--plus" style={{ '--x': '66%', '--s': '18px', '--d': '2s', '--t': '18s' }} />
        <span className="sl-bg__shape sl-bg__shape--ring" style={{ '--x': '81%', '--s': '16px', '--d': '7s', '--t': '21s' }} />
        <span className="sl-bg__shape sl-bg__shape--dot" style={{ '--x': '92%', '--s': '12px', '--d': '11s', '--t': '17s' }} />
      </div>

      <StaffClock locale={locale} />
      <div className="sl-tools">
        <button
          type="button" className="sl-lang sl-lang--icon" onClick={toggleLocale}
          aria-label={ar ? 'English' : 'العربية'} title={ar ? 'English' : 'العربية'}
        >
          <Icon name="globe" size={16} />
        </button>
        <button
          type="button" className="sl-lang sl-lang--icon" onClick={toggleTheme}
          aria-label={t('Switch between light and dark mode', 'التبديل بين الوضع الفاتح والداكن')}
          title={t('Switch between light and dark mode', 'التبديل بين الوضع الفاتح والداكن')}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
        </button>
      </div>

      <main className="sl-badge" aria-labelledby={titleId}>
        <span className="sl-slot" aria-hidden="true" />

        <section className="sl-side">
          <Aperture />
          <div className="sl-side__top">
            <BrandWordmark onDark width={118} height={46} />
          </div>

          <ul className="sl-lanes">
            {LANES.map((lane) => (
              <li key={lane.en[0]}>
                <span className="sl-lanes__icon"><Icon name={lane.icon} size={18} /></span>
                <span>
                  <strong>{(ar ? lane.ar : lane.en)[0]}</strong>
                  <small>{(ar ? lane.ar : lane.en)[1]}</small>
                </span>
              </li>
            ))}
          </ul>

          <p className="sl-note">
            <Icon name="lock" size={15} />
            {t('Every staff sign-in is written to the security log.', 'كل تسجيل دخول للفريق بيتسجّل في سجل الأمان.')}
          </p>
        </section>

        <section className="sl-form"><div className="sl-form__in">{children}</div></section>
      </main>
    </div>
  );
}
