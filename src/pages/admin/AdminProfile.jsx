import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { announceAvatar } from '../../components/insight/AvatarUploader';
import Icon from '../../components/Icon';
import { Avatar } from '../../components/admin/adminUi';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/profile';
import { ErrorState, Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/admin/profile.php exactly (the topbar account dropdown
 * already linked every role to /{role}/profile — this was a dead link for
 * admin, since no React route/component existed for it at all; it silently
 * fell through to the app's generic "*" -> /dashboard redirect).
 *
 * Read data comes from the same GET /api/v1/admin/settings the Settings
 * page already uses (`data.profile` = User::toArray() — full_name, email,
 * avatar_path — the exact fields profile.php reads from $realUser). Name/
 * email edits intentionally stay on Settings, not here, matching
 * AdminProfileController's own docblock ("Name/email edits live on
 * Settings... this page is the identity view").
 *
 * The avatar upload posts to POST /api/v1/admin/settings/avatar
 * (AdminSettingsApiController::uploadAvatar) — a real JSON endpoint, same
 * pattern as other portals' /me/avatar. (The old
 * AdminProfileController::uploadAvatar web route still exists for the PHP
 * views, but it's a plain non-/api/* path that only a same-origin deploy
 * or an explicit dev-proxy rule can reach from this SPA, and it replies
 * with an HTML redirect rather than JSON — so it was never a fit for this
 * Bearer-token client.) This page still re-fetches /api/v1/admin/settings
 * afterward rather than reading the upload response directly, since that
 * response is already what the rest of this page renders from.
 */

export default function AdminProfile() {
  const t = useTranslations(translations);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  function load() {
    setLoading(true);
    return api.get('/api/v1/admin/settings')
      .then((json) => setProfile(json.data?.profile || null))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      const json = await api.postForm('/api/v1/admin/settings/avatar', formData);
      await load();
      // The upload response may omit the path; re-read it so the Topbar updates.
      let path = json?.data?.avatar_path || null;
      if (!path) {
        const fresh = await api.get('/api/v1/admin/settings').catch(() => null);
        path = fresh?.data?.profile?.avatar_path || null;
      }
      announceAvatar(path);
    } catch (err) {
      setUploadError(errorMessage(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Profile')}</h1>
        </div>
      </div>

      {loading && <Skeleton rows={6} cols={4} />}
      {error && <ErrorState error={error} />}

      {!loading && !error && profile && (
        <>
          <div className="adm-profile">
            {profile.avatar_path ? (
              <img src={`/${profile.avatar_path}`} alt={t('Your profile photo')} className="adm-avatar adm-avatar--lg" style={{ objectFit: 'cover' }} />
            ) : (
              <Avatar name={profile.full_name} src={profile.avatar_path} large />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2>{profile.full_name}</h2>
              <p>{profile.email}</p>
              <div className="adm-profile__badges"><span className="badge badge-primary">{t('Administrator')}</span></div>
            </div>
            <label className="btn btn-outline btn-sm" style={{ cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.7 : 1 }}>
              <Icon name="upload" size={16} /> {uploading ? t('Uploading…') : t('Change Photo')}
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp"
                style={{ display: 'none' }}
                disabled={uploading}
                onChange={handleFileChange}
              />
            </label>
          </div>
          {uploadError && <p className="form-error">{uploadError}</p>}

          <div className="adm-panel" style={{ maxWidth: 720 }}>
            <div className="adm-panel__head">
              <div><h3>{t('Account details')}</h3><p>{t('Name and email are edited in Settings.')}</p></div>
              <Link to="/admin/settings" className="btn btn-outline btn-sm"><Icon name="settings" size={16} /> {t('Edit name/email in Settings')}</Link>
            </div>
            <div className="adm-facts">
              <div className="adm-fact"><small>{t('Full name')}</small><strong>{profile.full_name || '—'}</strong></div>
              <div className="adm-fact"><small>{t('Email')}</small><strong>{profile.email || '—'}</strong></div>
              <div className="adm-fact"><small>{t('Role')}</small><strong>{t('Administrator')}</strong></div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
