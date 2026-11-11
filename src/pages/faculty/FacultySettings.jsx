import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import SettingsShell from '../../components/settings/SettingsShell';
import { IdentityHero, PhotoBlock } from '../../components/settings/IdentityProfile';
import { SavedBadge, NotificationsCard, PasswordCard, TwoFactorCard, AppearanceCard, LanguageCard } from '../settings/shared';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/faculty/settings';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/faculty/settings.php, talking to the real JSON API
 * (App\Controllers\Api\FacultySettingsApiController — routes/api.php
 * '/faculty/settings/*', registered ahead of the generic GET '/faculty/{id}'
 * so the path isn't swallowed as an {id} param). Covers exactly what that
 * controller exposes: faculty profile (name/description/mission/vision/
 * website/contact/location), logo upload, notification preferences,
 * password change, and 2FA — no Team Management card, since a Faculty
 * login is a single-account tenant (unlike University).
 */

const BASE = '/api/v1/faculty/settings';

export default function FacultySettings() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get(BASE)
      .then((json) => { if (!cancelled) setData(json.data); })
      .catch((err) => { if (!cancelled) setLoadError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <p className="text-small" style={{ padding: 'var(--space-5)' }}>{t('Loading…') || 'Loading…'}</p>;
  if (loadError) return <p style={{ color: 'var(--color-danger)', padding: 'var(--space-5)' }}>{loadError}</p>;
  if (!data) return null;

  if (!data.faculty) {
    return (
      <>
        <div className="page-header animate-rise-in">
          <div className="page-header__title">
            <h1 className="text-h1">{t('Settings')}</h1>
          </div>
        </div>
        <div className="card glass-panel">
          <p className="text-small">{t('This login is not linked to a faculty yet.')}</p>
        </div>
      </>
    );
  }

  // The Faculty API has no /preferences endpoint, so Appearance and Language
  // apply live (and are remembered on this device) without a server save.
  const sections = [
    {
      key: 'profile', label: { en: 'Profile', ar: 'الملف الشخصي' }, icon: 'user',
      content: (
        <div className="sp">
          <IdentityHero
            eyebrow={locale === 'ar' ? 'حساب الكلية' : 'Faculty account'}
            name={locale === 'ar' ? (data.faculty?.name_ar || data.faculty?.name_en) : (data.faculty?.name_en || data.faculty?.name_ar)}
            subtitle={[data.faculty?.location, data.faculty?.contact_email].filter(Boolean).join(' — ')}
            logoPath={data.faculty?.logo_path}
          />
          <PhotoBlock
            name={data.faculty?.name_en || data.faculty?.name_ar}
            endpoint="/api/v1/faculty/me/avatar"
            profileEndpoint="/api/v1/faculty/me"
            note={locale === 'ar' ? 'صورة حسابك الشخصي (ليست شعار الكلية).' : 'Your personal account photo (not the faculty logo).'}
          />
          <ProfileCard faculty={data.faculty} />
          <LogoCard logoPath={data.faculty?.logo_path} />
        </div>
      ),
    },
    { key: 'appearance', label: { en: 'Appearance', ar: 'المظهر' }, icon: 'palette', content: <AppearanceCard /> },
    { key: 'language', label: { en: 'Language', ar: 'اللغة' }, icon: 'globe', content: <LanguageCard /> },
    {
      key: 'notifications', label: { en: 'Notification Preferences', ar: 'تفضيلات الإشعارات' }, icon: 'bell',
      content: (
        <NotificationsCard
          base={BASE}
          path="/notifications"
          categories={data.notification_categories}
          mutedInitial={data.muted_categories}
          digestInitial={data.digest_frequency}
          quietHoursInitial={data.quiet_hours}
        />
      ),
    },
    {
      key: 'security', label: { en: 'Security', ar: 'الأمان' }, icon: 'lock',
      content: (
        <>
          <PasswordCard base={BASE} />
          <TwoFactorCard base={BASE} twoFactorInitial={data.two_factor} />
        </>
      ),
    },
  ];

  return (
    <SettingsShell
      title={t('Settings')}
      subtitle={locale === 'ar' ? 'ملف كليتك وإعدادات حسابك.' : "Your faculty's profile and account settings."}
      sections={sections}
    />
  );
}

// -- Faculty Profile (name_ar/en, description, mission, vision, website, contact, location)

function ProfileCard({ faculty }) {
  const t = useTranslations(translations);
  const [nameAr, setNameAr] = useState(faculty?.name_ar || '');
  const [nameEn, setNameEn] = useState(faculty?.name_en || '');
  const [description, setDescription] = useState(faculty?.description || '');
  const [mission, setMission] = useState(faculty?.mission || '');
  const [vision, setVision] = useState(faculty?.vision || '');
  const [website, setWebsite] = useState(faculty?.website || '');
  const [contactEmail, setContactEmail] = useState(faculty?.contact_email || '');
  const [contactPhone, setContactPhone] = useState(faculty?.contact_phone || '');
  const [location, setLocation] = useState(faculty?.location || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.patch(`${BASE}/profile`, {
        name_ar: nameAr,
        name_en: nameEn,
        description,
        mission,
        vision,
        website,
        contact_email: contactEmail,
        contact_phone: contactPhone,
        location,
      });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sp-block">
      <h3 style={{ marginBottom: 'var(--space-4)' }}>
        {t('Faculty Profile')} <SavedBadge show={saved} />
      </h3>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">{t('Name (Arabic)')}</label>
            <input className="form-input" value={nameAr} onChange={(e) => { setNameAr(e.target.value); setSaved(false); }} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Name (English)')}</label>
            <input className="form-input" value={nameEn} onChange={(e) => { setNameEn(e.target.value); setSaved(false); }} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">{t('Description')}</label>
          <textarea className="form-input" rows={2} value={description} onChange={(e) => { setDescription(e.target.value); setSaved(false); }} />
        </div>
        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">{t('Mission')}</label>
            <textarea className="form-input" rows={2} value={mission} onChange={(e) => { setMission(e.target.value); setSaved(false); }} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Vision')}</label>
            <textarea className="form-input" rows={2} value={vision} onChange={(e) => { setVision(e.target.value); setSaved(false); }} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">{t('Website')}</label>
          <input className="form-input" type="url" value={website} onChange={(e) => { setWebsite(e.target.value); setSaved(false); }} placeholder="https://" />
        </div>
        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">{t('Contact Email')}</label>
            <input className="form-input" type="email" value={contactEmail} onChange={(e) => { setContactEmail(e.target.value); setSaved(false); }} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Contact Phone')}</label>
            <input className="form-input" value={contactPhone} onChange={(e) => { setContactPhone(e.target.value); setSaved(false); }} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">{t('Location')}</label>
          <input className="form-input" value={location} onChange={(e) => { setLocation(e.target.value); setSaved(false); }} />
        </div>
        {error && <p className="text-caption" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={saving} style={{ alignSelf: 'flex-start' }}>
          <Icon name="check" size={18} /> {saving ? t('Saving…') : t('Save Changes')}
        </button>
      </form>
    </div>
  );
}

// -- Logo upload (multipart) -------------------------------------------------

function LogoCard({ logoPath }) {
  const t = useTranslations(translations);
  const [file, setFile] = useState(null);
  const [currentPath, setCurrentPath] = useState(logoPath || null);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    setSaved(false);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const json = await api.postForm(`${BASE}/logo`, formData);
      setCurrentPath(json.data?.logo_path || currentPath);
      setFile(null);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="sp-block">
      <h3 style={{ marginBottom: 'var(--space-2)' }}>
        <Icon name="upload" size={18} /> {t('Faculty logo')} <SavedBadge show={saved} />
      </h3>
      <p className="text-caption" style={{ marginBottom: 'var(--space-3)' }}>
        {currentPath ? `${t('Current logo')}: ${currentPath}` : t('No logo uploaded yet.')}
      </p>
      <form onSubmit={handleUpload} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <input type="file" accept="image/*" onChange={(e) => { setFile(e.target.files?.[0] || null); setSaved(false); }} />
        <button type="submit" className="btn btn-primary btn-sm" disabled={!file || uploading}>
          {uploading ? t('Uploading…') : t('Change Logo')}
        </button>
      </form>
      {error && <p className="text-caption" style={{ color: 'var(--color-danger)', marginTop: 'var(--space-2)' }}>{error}</p>}
    </div>
  );
}
