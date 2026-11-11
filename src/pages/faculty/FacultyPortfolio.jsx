import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import PortfolioLayout from '../../components/university/PortfolioLayout';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/faculty/portfolio';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Faculty-portal twin of UniversityPortfolio.jsx — the faculty's own
 * public portfolio page. No legacy app/Views/faculty/portfolio.php
 * existed (the faculty portal never had one), so this is built fresh
 * from the same GET/PATCH /api/v1/faculty/me{,/visibility} shape
 * FacultyApiController::me()/updateOwnVisibility() now return, mirroring
 * UniversitiesApiController::me()/updateVisibility() exactly. share_url
 * points at the already-working public page (PublicFacultyController::
 * show(), routes/web.php '/universities/{universitySlug}/faculties/{facultySlug}').
 */
export default function FacultyPortfolio() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();

  const [faculty, setFaculty] = useState(null);
  const [shareUrl, setShareUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/faculty/me')
      .then((json) => {
        setFaculty(json.data?.faculty || null);
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
      await api.patch('/api/v1/faculty/me/visibility', { is_public: nextValue ? 1 : 0 });
      setFaculty((f) => ({ ...f, is_public: nextValue ? 1 : 0 }));
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
  if (error && !faculty) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;
  if (!faculty) return null;

  const name = locale === 'ar' ? (faculty.name_ar || faculty.name_en) : (faculty.name_en || faculty.name_ar);
  const isPublic = !!faculty.is_public;

  const ar = locale === 'ar';
  return (
    <PortfolioLayout
      t={t} name={name} logo={faculty.logo_path} place={faculty.location}
      isPublic={isPublic} saving={saving} error={error} onToggle={toggleVisibility}
      stats={[
        { icon: 'users', tone: 'primary', value: faculty.students_count ?? 0, label: t('Students') },
        { icon: 'folder', tone: 'success', value: faculty.published_projects_count ?? 0, label: t('Published Projects') },
      ]}
      shareUrl={shareUrl} copied={copied} onCopy={copyLink}
      subtitle={ar
        ? 'ملف الكلية العام اللي يعرض مشاريع طلابك المعتمدة من غير تسجيل دخول.'
        : "Your faculty's public page — showcasing your students' approved projects without logging in."}
      tip={t('Completing your faculty profile in Settings helps students and staff recognize your page.')}
    />
  );
}
