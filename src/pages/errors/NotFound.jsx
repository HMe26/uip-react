import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import Icon from '../../components/Icon';
import ErrorPage from './ErrorPage';

/**
 * 404 — the app's catch-all route now renders this instead of silently
 * `<Navigate to="/">`. A silent redirect on an unmatched route is exactly
 * what made the earlier /u/{uuid} share-link bug invisible: a broken link
 * quietly became the dashboard with no signal anything had gone wrong.
 */
export default function NotFound() {
  const { locale } = useLanguage();
  const isAr = locale === 'ar';
  const t = (en, ar) => (isAr ? ar : en);

  return (
    <ErrorPage
      code={404}
      statusKey="NOT_FOUND"
      title={t('This page went missing.', 'الصفحة دي مش موجودة.')}
      desc={t(
        "There's nothing at this address. The link may be mistyped, out of date, or the page may have moved.",
        'مفيش حاجة على الرابط ده. ممكن يكون اتكتب غلط، قديم، أو الصفحة اتنقلت.'
      )}
      extra={(
        <div className="lp2-err__links">
          {[
            ['/projects', 'search', t('Explore Projects', 'استكشف المشاريع'), t('Browse published student work', 'تصفح المشاريع المنشورة')],
            ['/verify-certificate', 'shield', t('Verify a Certificate', 'التحقق من شهادة'), t('Check a graduation certificate', 'تحقق من شهادة تخرج')],
            ['/privacy-policy', 'lock', t('Privacy Policy', 'سياسة الخصوصية'), t('How we handle your data', 'إزاي بنتعامل مع بياناتك')],
          ].map(([to, icon, title, sub]) => (
            <Link to={to} className="lp2-card lp2-err__link" key={to}>
              <span className="lp2-icon"><Icon name={icon} size={18} /></span>
              <span><strong>{title}</strong><small>{sub}</small></span>
            </Link>
          ))}
        </div>
      )}
      primaryAction={
        <Link to="/projects" className="btn btn-primary">
          <Icon name="search" size={16} />
          {t('Browse projects', 'تصفّح المشاريع')}
        </Link>
      }
    />
  );
}
