import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import AvatarUploader from '../../components/insight/AvatarUploader';
import Breadcrumb from '../../components/Breadcrumb';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/data-analysis/profile';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/data-analysis/profile.php (the topbar account
 * dropdown already links every role to /{prefix}/profile — this was a
 * dead link for data_analyst, since no React route/component existed
 * for it at all; same gap AdminProfile.jsx's own docblock describes
 * for /admin/profile before it was added).
 *
 * Read data comes from the same GET /api/v1/data-analysis/settings the
 * Settings page already uses (`data.profile` = User::toArray() —
 * full_name, email, avatar_path — the exact fields profile.php reads
 * from $realUser). Name/email edits intentionally stay on Settings, not
 * here, matching DataAnalysisProfileController's own docblock ("Name/
 * email edits live on Settings... this page is the identity view").
 *
 * The avatar upload posts to the new POST /api/v1/data-analysis/
 * settings/avatar (DataAnalysisSettingsApiController::uploadAvatar) —
 * added alongside this page, same Bearer-JSON pattern as Admin's own
 * /settings/avatar. (The old DataAnalysisProfileController::
 * uploadAvatar web route still exists for the PHP views, but it's a
 * plain non-/api/* path that replies with an HTML redirect rather than
 * JSON, so it was never a fit for this client.)
 */
export default function DataAnalysisProfile() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  function load() {
    setLoading(true);
    return api.get('/api/v1/data-analysis/settings')
      .then((json) => setProfile(json.data?.profile || null))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  return (
    <>
      <Breadcrumb locale={locale} items={[
        { en: 'Analytics Dashboard', ar: 'لوحة التحليلات', url: '/data-analysis/dashboard' },
        { en: 'Profile', ar: 'الملف الشخصي' },
      ]} />

      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Profile')}</h1>
        </div>
      </div>

      {loading && <p className="text-small">{t('Loading…')}</p>}
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {!loading && !error && profile && (
        <div className="card glass-panel" style={{ padding: 'var(--space-6)', maxWidth: 480, textAlign: 'center', marginInline: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--space-4)' }}>
            <AvatarUploader name={profile.full_name} avatarPath={profile.avatar_path} onUploaded={() => load()} />
          </div>

          <h2 className="text-h3">{profile.full_name}</h2>
          <p className="text-small">{profile.email}</p>
          <span className="badge badge-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="chart" size={14} /> {t('Data Analyst')}
          </span>

          <div style={{ marginTop: 'var(--space-3)' }}>
            <Link to="/data-analysis/settings" className="btn btn-outline btn-sm">
              <Icon name="settings" size={16} /> {t('Edit name/email in Settings')}
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
