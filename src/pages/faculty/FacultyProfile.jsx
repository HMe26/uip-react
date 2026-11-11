import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { announceAvatar } from '../../components/insight/AvatarUploader';
import Icon from '../../components/Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/faculty/profile';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/faculty/profile.php — a minimal personal identity
 * card (name/email/avatar of the signed-in PERSON, not the faculty
 * itself) that the topbar's account dropdown links every role to.
 * Faculty-facing fields (name_ar/name_en/description/logo/etc.) stay on
 * Settings as the form of record — this page just links there, same
 * split the legacy view has and UniversityProfile.jsx already mirrors
 * for the university role. Data/avatar upload come from GET/POST
 * /api/v1/faculty/me{,/avatar} (App\Controllers\Api\
 * FacultyApiController::me()/uploadAvatar()).
 */
export default function FacultyProfile() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/faculty/me')
      .then((json) => setUser(json.data?.user || null))
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
      const json = await api.postForm('/api/v1/faculty/me/avatar', formData);
      setUser((u) => ({ ...u, avatar_path: json.data?.avatar_path || u?.avatar_path }));
      announceAvatar(json.data?.avatar_path);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  if (loading) return <p className="text-small">{t('Loading…')}</p>;

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{locale === 'ar' ? 'الملف الشخصي' : 'Profile'}</h1>
        </div>
      </div>

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

      <div className="card glass-panel" style={{ padding: 'var(--space-6)', maxWidth: 480, textAlign: 'center', marginInline: 'auto' }}>
        {user?.avatar_path ? (
          <img
            src={user.avatar_path}
            alt={t('Your profile photo')}
            style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', margin: '0 auto var(--space-4)', display: 'block' }}
          />
        ) : (
          <span style={{
            width: 96, height: 96, borderRadius: '50%', background: 'var(--color-primary)', color: 'var(--color-on-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 'var(--text-h1)',
            margin: '0 auto var(--space-4)',
          }}>
            {(user?.full_name || '?').slice(0, 1)}
          </span>
        )}
        <h2 className="text-h3">{user?.full_name || ''}</h2>
        <p className="text-small">{user?.email || ''}</p>
        <span className="badge badge-neutral">{t('Faculty Account')}</span>

        <div style={{ marginTop: 'var(--space-4)' }}>
          <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
            <Icon name="upload" size={16} /> {uploading ? (locale === 'ar' ? 'جارٍ الرفع…' : 'Uploading…') : t('Change Photo')}
            <input type="file" accept=".jpg,.jpeg,.png,.webp" style={{ display: 'none' }} disabled={uploading} onChange={handleAvatarChange} />
          </label>
        </div>

        <Link to="/faculty/settings" className="btn btn-outline btn-sm" style={{ marginTop: 'var(--space-3)', display: 'inline-flex' }}>
          <Icon name="settings" size={16} /> {t('Edit faculty profile in Settings')}
        </Link>
      </div>
    </>
  );
}
