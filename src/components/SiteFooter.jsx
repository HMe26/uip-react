import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import BrandWordmark from './BrandWordmark';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import Icon from './Icon';
import VisitorCounter from './VisitorCounter';
import useAppDownload from '../hooks/useAppDownload';
import AppDownloadLink from './AppDownloadLink';

// Short, generic initials badges — not pixel-accurate brand logos — mirrors
// the $socialInitials map in components/site-footer.php.
const SOCIAL_INITIALS = {
  linkedin: 'in',
  twitter: 'X',
  facebook: 'f',
  instagram: 'IG',
  youtube: 'YT',
};

/**
 * Port of components/site-footer.php — same brand/ecosystem block, same
 * Platform + Legal & Support columns, same social icons and bottom bar.
 * support_email / social_links come from config('app.*') server-side, so
 * this fetches them from GET /api/v1/public/site-info instead of inventing
 * placeholder values (same "never show a fake contact" rule as the PHP
 * component: the Legal & Support "Contact support" line and the social
 * icons only render once that data is actually configured).
 */
export default function SiteFooter() {
  const { locale } = useLanguage();
  const isAr = locale === 'ar';
  const t = (en, ar) => (isAr ? ar : en);

  const app = useAppDownload();
  const [siteInfo, setSiteInfo] = useState({ support_email: '', social_links: {} });

  useEffect(() => {
    let alive = true;
    api.get('/api/v1/public/site-info')
      .then((json) => { if (alive) setSiteInfo(json.data || {}); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const ecosystem = [
    t('Chat and calls', 'الشات والمكالمات'), t('Video meetings', 'اجتماعات الفيديو'), t('Courses and exams', 'المواد والامتحانات'),
    t('My PC', 'My PC'), t('Community', 'المجتمع'), t('Projects', 'المشاريع'),
  ];

  const supportEmail = siteInfo.support_email || '';
  const socialLinks = siteInfo.social_links || {};

  return (
    <footer className="uip-footer">
      <div className="uip-footer__shell">
        <div className="uip-footer__grid">
          <div className="uip-footer__brand">
            <Link to="/" className="uip-footer__logo">
              <BrandWordmark className="uip-footer__word" width={124} height={48} />
            </Link>
            <p className="uip-footer__tagline">
              <strong style={{ display: 'block', marginBottom: 6 }}>One Platform. Endless Connections.</strong>
              {t(
                'UIPE is one campus platform for students, instructors and universities: chat and video meetings, courses and exams, your files and code, a social community, and projects to publish, with an AI tutor beside you.',
                'UIPE منصة جامعية واحدة للطلاب والدكاترة والجامعات: شات واجتماعات فيديو، ومواد وامتحانات، وملفاتك وأكوادك، ومجتمع اجتماعي، ومشاريع تنشرها، ومعاك معلم ذكي جنبك.'
              )}
            </p>
            <ul className="uip-footer__ecosystem" aria-label={t('What UIPE offers', 'ماذا تقدم UIPE')}>
              {ecosystem.map((tag) => <li key={tag}>{tag}</li>)}
            </ul>

            {Object.keys(socialLinks).length > 0 && (
              <div className="uip-footer__social" aria-label={t('UIPE on social media', 'UIPE على مواقع التواصل')}>
                {Object.entries(socialLinks).map(([platform, href]) => (
                  SOCIAL_INITIALS[platform] ? (
                    <a key={platform} href={href} target="_blank" rel="noopener noreferrer" aria-label={platform.charAt(0).toUpperCase() + platform.slice(1)}>
                      {SOCIAL_INITIALS[platform]}
                    </a>
                  ) : null
                ))}
              </div>
            )}
          </div>

          <nav className="uip-footer__col" aria-label={t('Platform', 'المنصة')}>
            <h3>{t('Platform', 'المنصة')}</h3>
            <ul>
              <li><Link to="/">{t('Home', 'الرئيسية')}</Link></li>
              <li><Link to="/projects">{t('Explore Projects', 'استكشف المشاريع')}</Link></li>
              <li><Link to="/verify-certificate">{t('Verify a Certificate', 'التحقق من شهادة')}</Link></li>
              <li><Link to="/auth/login">{t('Log in', 'تسجيل الدخول')}</Link></li>
              <li><Link to="/auth/register">{t('Create a free account', 'إنشاء حساب مجاني')}</Link></li>
              {app && <li><AppDownloadLink app={app} iconSize={14} /></li>}
            </ul>
          </nav>

          <nav className="uip-footer__col" aria-label={t('Legal & Support', 'قانوني ودعم')}>
            <h3>{t('Legal & Support', 'قانوني ودعم')}</h3>
            <ul>
              <li><Link to="/privacy-policy">{t('Privacy Policy', 'سياسة الخصوصية')}</Link></li>
              {supportEmail !== '' && (
                <li>
                  <a href={`mailto:${supportEmail}`}>
                    <Icon name="mail" size={14} /> {t('Contact support', 'تواصل مع الدعم')}
                  </a>
                </li>
              )}
            </ul>
          </nav>
        </div>

        <VisitorCounter />

        <div className="uip-footer__bottom">
          <span>&copy; {new Date().getFullYear()} {t('Unified Integrated Platform Ecosystem (UIPE). All rights reserved.', 'Unified Integrated Platform Ecosystem (UIPE). جميع الحقوق محفوظة.')}</span>
          <div className="uip-footer__bottom-links">
            <Link to="/privacy-policy">{t('Privacy Policy', 'سياسة الخصوصية')}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
