import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { announceAvatar } from '../../components/insight/AvatarUploader';
import Icon from '../../components/Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/academic-staff/profile';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Personal identity card for the signed-in academic staff member — the
 * target of the Topbar account dropdown's generic `/${role}/profile`
 * link (it 404'd for academic_staff before this page existed). Same
 * split as FacultyProfile/UniversityProfile: this page is read-mostly
 * (name/email/rank/faculty/department are set by the university/faculty
 * admin), photo upload lives here, and the one self-editable field
 * (bio) stays on Settings as the form of record.
 *
 * Data: GET /api/v1/academic-staff/me → data.profile
 * Avatar: POST /api/v1/academic-staff/me/avatar
 * (AcademicStaffApiController::me()/uploadAvatar()).
 */
export default function AcademicStaffProfile() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const isAr = locale === 'ar';

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/academic-staff/me')
      .then((json) => setProfile(json.data?.profile || null))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      const json = await api.postForm('/api/v1/academic-staff/me/avatar', formData);
      setProfile((p) => ({ ...p, avatar_path: json.data?.avatar_path || p?.avatar_path }));
      announceAvatar(json.data?.avatar_path);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  if (loading) return <p className="text-small">{t('Loading…')}</p>;

  const pick = (ar, en) => (isAr ? (ar || en) : (en || ar)) || '';
  const details = profile ? [
    [t('Rank'), pick(profile.rank_name_ar, profile.rank_name_en)],
    [t('Faculty'), pick(profile.faculty_name_ar, profile.faculty_name_en)],
    [t('Department'), pick(profile.department_name_ar, profile.department_name_en)],
    [t('Staff Number'), profile.staff_number],
    [t('Phone'), profile.phone],
  ].filter(([, v]) => v) : [];

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Profile')}</h1>
        </div>
      </div>

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

      <div className="card glass-panel" style={{ padding: 'var(--space-6)', maxWidth: 480, textAlign: 'center', marginInline: 'auto' }}>
        {profile?.avatar_path ? (
          <img
            src={profile.avatar_path}
            alt={t('Your profile photo')}
            style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', margin: '0 auto var(--space-4)', display: 'block' }}
          />
        ) : (
          <span style={{
            width: 96, height: 96, borderRadius: '50%', background: 'var(--color-primary)', color: 'var(--color-on-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 'var(--text-h1)',
            margin: '0 auto var(--space-4)',
          }}>
            {(profile?.full_name || '?').slice(0, 1)}
          </span>
        )}
        <h2 className="text-h3">{profile?.full_name || ''}</h2>
        <p className="text-small">{profile?.email || ''}</p>
        <span className="badge badge-neutral">{t('Academic Staff Account')}</span>

        {details.length > 0 && (
          <dl style={{ marginTop: 'var(--space-4)', textAlign: 'start', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--space-2) var(--space-4)' }}>
            {details.map(([label, value]) => (
              <div key={label} style={{ display: 'contents' }}>
                <dt className="text-small" style={{ opacity: 0.7 }}>{label}</dt>
                <dd style={{ margin: 0 }}>{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {profile?.bio && (
          <p className="text-small" style={{ marginTop: 'var(--space-4)', textAlign: 'start', whiteSpace: 'pre-wrap' }}>{profile.bio}</p>
        )}

        <div style={{ marginTop: 'var(--space-4)' }}>
          <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
            <Icon name="upload" size={16} /> {uploading ? (isAr ? 'جارٍ الرفع…' : 'Uploading…') : t('Change Photo')}
            <input type="file" accept=".jpg,.jpeg,.png,.webp" style={{ display: 'none' }} disabled={uploading} onChange={handleAvatarChange} />
          </label>
        </div>

        <Link to="/academic-staff/settings" className="btn btn-outline btn-sm" style={{ marginTop: 'var(--space-3)', display: 'inline-flex' }}>
          <Icon name="settings" size={16} /> {t('Edit bio in Settings')}
        </Link>
      </div>
    </>
  );
}
