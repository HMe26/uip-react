import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import BrandWordmark from './BrandWordmark';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { roleHome } from '../config/roleHome';
import Icon from './Icon';
import useAppDownload from '../hooks/useAppDownload';
import AppDownloadLink from './AppDownloadLink';
import '../styles/css/uip-nav.css';

/**
 * Public top bar (Landing, Explore, Privacy, Verify Certificate, error pages). Rendered inside a `.lp2` wrapper (palette tokens).
 * Three zones that can never collide: brand | links | actions. Links are kept to four: a "Platform" menu that lists every part of
 * the platform with a one-line description, Explore projects, Verify a certificate. Below 1024px everything moves into one sheet.
 * `anchors` = we are on the landing page, so the platform items scroll to their section; elsewhere they go to "/#section".
 */
export default function LandingNav({ anchors = false }) {
  const { locale, toggleLocale } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { pathname } = useLocation();
  const { status, user } = useAuth();
  const [sheet, setSheet] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  const app = useAppDownload();
  const isAr = locale === 'ar';
  const t = (en, ar) => (isAr ? ar : en);

  const parts = [
    ['talk', 'chat', t('Chat and calls', 'الشات والمكالمات'), t('Direct and group chat, voice and video', 'محادثات فردية وجماعية وصوت وفيديو')],
    ['meetings', 'meeting-type', t('Video meetings', 'اجتماعات الفيديو'), t('Links, waiting room and attendance reports', 'روابط وغرفة انتظار وتقارير حضور')],
    ['pc', 'hard-drive', t('My PC', 'My PC'), t('Files, code editor and Office tools in the browser', 'ملفات ومحرر أكواد وأدوات Office في المتصفح')],
    ['ai', 'ai-spark', t('AI tutor', 'المعلم الذكي'), t('Explains errors and reviews your code', 'يشرح الأخطاء ويراجع كودك')],
    ['community', 'users', t('Community', 'المجتمع'), t('Posts, stories, profiles and your network', 'منشورات وستوريز وبروفايلات وشبكتك')],
    ['exams', 'layers', t('Exams and courses', 'الامتحانات والمواد'), t('Question banks, secure mode and grading', 'بنوك أسئلة ووضع آمن وتصحيح')],
    ['projects', 'folder', t('Projects', 'المشاريع'), t('Publish your work and get discovered', 'انشر شغلك واتكتشف')],
  ];
  const href = (id) => (anchors ? `#${id}` : `/#${id}`);

  useEffect(() => { setSheet(false); setMenu(false); }, [pathname]);
  useEffect(() => {
    if (!menu) return undefined;
    const onDoc = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [menu]);
  useEffect(() => {
    if (!sheet) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setSheet(false); };
    const mq = window.matchMedia('(min-width: 1024px)');
    const onMq = () => { if (mq.matches) setSheet(false); };
    document.addEventListener('keydown', onKey);
    mq.addEventListener('change', onMq);
    return () => { document.removeEventListener('keydown', onKey); mq.removeEventListener('change', onMq); };
  }, [sheet]);

  const current = (p) => (pathname.startsWith(p) ? 'page' : undefined);
  const authed = status === 'authenticated';

  return (
    <nav className="unav" aria-label={t('Main', 'الرئيسية')}>
      <div className="unav__bar">
        <Link to="/" className="unav__brand" aria-label="UIPE">
          <BrandWordmark className="unav__word" width={100} height={39} />
        </Link>

        <div className="unav__links">
          <div className="unav__menu" ref={menuRef}>
            <button type="button" className={`unav__link unav__trigger${menu ? ' is-open' : ''}`} aria-expanded={menu} aria-haspopup="true" onClick={() => setMenu((o) => !o)}>
              {t('Platform', 'المنصة')} <Icon name="chevron-down" size={14} />
            </button>
            {menu && (
              <div className="unav__panel" role="menu">
                {parts.map(([id, ic, title, desc]) => (
                  <a key={id} href={href(id)} role="menuitem" className="unav__item" onClick={() => setMenu(false)}>
                    <span className="unav__ico"><Icon name={ic} size={18} /></span>
                    <span><strong>{title}</strong><small>{desc}</small></span>
                  </a>
                ))}
              </div>
            )}
          </div>
          <Link to="/projects" className="unav__link" aria-current={current('/projects')}>{t('Explore projects', 'استكشف المشاريع')}</Link>
          <Link to="/verify-certificate" className="unav__link" aria-current={current('/verify-certificate')}>{t('Verify a certificate', 'التحقق من شهادة')}</Link>
        </div>

        <div className="unav__actions">
          {app && <span className="unav__app"><AppDownloadLink app={app} withIcon={false} logo iconSize={14} className="app-dl--nav" labels={{ download: t('Get the app', 'حمّل التطبيق') }} /></span>}
          <button type="button" className="unav__icon" onClick={toggleLocale} aria-label={t('العربية', 'English')} title={t('العربية', 'English')}><Icon name="globe" size={17} /></button>
          <button type="button" className="unav__icon" onClick={toggleTheme} aria-label={t('Toggle theme', 'تبديل المظهر')} title={t('Toggle theme', 'تبديل المظهر')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} /></button>
          {authed ? (
            <Link to={roleHome(user?.role)} className="btn btn-primary btn-sm unav__cta">{t('Dashboard', 'لوحة التحكم')}</Link>
          ) : (
            <>
              <Link to="/auth/login" className="unav__login">{t('Log in', 'تسجيل الدخول')}</Link>
              <Link to="/auth/register" className="btn btn-primary btn-sm unav__cta">{t('Get started', 'ابدأ مجانًا')}</Link>
            </>
          )}
          <button type="button" className="unav__icon unav__burger" aria-expanded={sheet} aria-controls="unav-sheet" aria-label={t('Menu', 'القائمة')} onClick={() => setSheet((o) => !o)}>
            <Icon name={sheet ? 'x' : 'menu'} size={19} />
          </button>
        </div>
      </div>

      {sheet && (
        <div className="unav__sheet" id="unav-sheet">
          <p className="unav__sheet-h">{t('The platform', 'المنصة')}</p>
          <div className="unav__sheet-grid">
            {parts.map(([id, ic, title]) => (
              <a key={id} href={href(id)} onClick={() => setSheet(false)}><span className="unav__ico"><Icon name={ic} size={17} /></span>{title}</a>
            ))}
          </div>
          <div className="unav__sheet-links">
            <Link to="/projects">{t('Explore projects', 'استكشف المشاريع')}</Link>
            <Link to="/verify-certificate">{t('Verify a certificate', 'التحقق من شهادة')}</Link>
            {app && <AppDownloadLink app={app} withIcon={false} logo iconSize={14} className="app-dl--nav" labels={{ download: t('Get the app', 'حمّل التطبيق') }} />}
          </div>
          {!authed && (
            <div className="unav__sheet-cta">
              <Link to="/auth/login" className="btn btn-outline">{t('Log in', 'تسجيل الدخول')}</Link>
              <Link to="/auth/register" className="btn btn-primary">{t('Get started', 'ابدأ مجانًا')}</Link>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
