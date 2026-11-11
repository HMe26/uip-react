import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import PortfolioLayout from '../../components/university/PortfolioLayout';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/university/portfolio';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/university/portfolio.php. Data comes from
 * GET /api/v1/universities/me (App\Controllers\Api\UniversitiesApiController
 * ::me() — now merges UniversityRepository::withProfileStats() in and
 * returns share_url, same shape University\UniversityPortfolioController
 * ::index() passes its view). Visibility toggles via the small addition
 * PATCH /api/v1/universities/me/visibility (mirrors
 * UniversityPortfolioController::update()'s is_public-only write).
 */
export default function UniversityPortfolio() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();

  const [uni, setUni] = useState(null);
  const [shareUrl, setShareUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/universities/me')
      .then((json) => {
        setUni(json.data?.university || null);
        setShareUrl(json.data?.share_url || '');
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleVisibility(nextValue) {
    setSaving(true);
    setError(null);
    try {
      await api.patch('/api/v1/universities/me/visibility', { is_public: nextValue ? 1 : 0 });
      setUni((u) => ({ ...u, is_public: nextValue ? 1 : 0 }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function copyLink() {
    navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) return <p className="text-small">{t('Loading…')}</p>;
  if (error && !uni) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;
  if (!uni) return null;

  const name = locale === 'ar' ? (uni.official_name_ar || uni.official_name_en) : (uni.official_name_en || uni.official_name_ar);
  const verified = uni.verification_status === 'verified';
  const isPublic = !!uni.is_public;
  const location = [uni.city, uni.country].filter(Boolean).join(', ');

  const ar = locale === 'ar';
  return (
    <PortfolioLayout
      t={t} name={name} logo={uni.logo_path} place={location} verified={verified}
      isPublic={isPublic} saving={saving} error={error} onToggle={toggleVisibility}
      stats={[
        { icon: 'users', tone: 'primary', value: uni.students_count ?? 0, label: ar ? 'الطلاب' : 'Students' },
        { icon: 'folder', tone: 'success', value: uni.published_projects_count ?? 0, label: ar ? 'مشاريع منشورة' : 'Published Projects' },
      ]}
      shareUrl={shareUrl} copied={copied} onCopy={copyLink}
      subtitle={ar
        ? 'ملف الجامعة العام اللي يعرض مشاريع طلابك المعتمدة من غير تسجيل دخول.'
        : "Your university's public page — showcasing your students' approved projects without logging in."}
      tip={t("Completing verification adds a trust badge to your public profile, which builds confidence in your students' projects.")}
    />
  );
}
