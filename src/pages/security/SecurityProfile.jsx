import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { avatarSrc } from '../../components/insight/AvatarUploader';
import { initials } from '../../components/Sidebar';
import { useAuth } from '../../context/AuthContext';
import { useTranslations } from '../../context/LanguageContext';
import { PageHead, DetailGrid, ErrorNote } from '../../components/security/ui';
import i18nCommon from '../../i18n/common';
import i18nDesign from '../../i18n/security/design';

const translations = {
  ...i18nCommon, ...i18nDesign,
  'Profile': 'الملف الشخصي', 'Your identity on the platform. Edit your name and email in Settings.': 'هويتك على المنصة. عدّل الاسم والبريد من الإعدادات.',
  'Full Name': 'الاسم الكامل', 'Email': 'البريد الإلكتروني', 'Role': 'الدور', 'Edit in Settings': 'تعديل من الإعدادات',
  'Security Admin': 'مسؤول الأمان', 'Security Officer': 'ضابط الأمان',
};

/**
 * /security/profile — the topbar account menu links every role to
 * /{prefix}/profile, and this one had no route (404). Read-only identity view
 * fed by the same GET /api/v1/security/settings the Settings page uses
 * (`data.profile`); name/email edits stay in Settings. No avatar upload here:
 * the security API has no avatar endpoint.
 */
export default function SecurityProfile() {
  const t = useTranslations(translations);
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/v1/security/settings')
      .then((json) => { if (!cancelled) setProfile(json.data?.profile || null); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const person = profile || user || {};
  const role = user?.role === 'security_officer' ? t('Security Officer') : t('Security Admin');
  const photo = avatarSrc(profile?.avatar_path);

  return (
    <div className="sec-page">
      <PageHead eyebrow={t('Account / Preferences')} title={t('Profile')} subtitle={t('Your identity on the platform. Edit your name and email in Settings.')}
        actions={<Link to="/security/settings" className="btn btn-outline"><Icon name="settings" size={15} /> {t('Edit in Settings')}</Link>} />
      <ErrorNote>{error}</ErrorNote>
      <section className="sec-card" style={{ maxWidth: 640 }}>
        <div className="sec-card__body">
          {loading ? <span className="sec-skel" style={{ width: '50%', height: 18 }} /> : (
            <>
              <div className="sec-profile__head">
                <span className="sec-profile__avatar">{photo ? <img src={photo} alt="" /> : initials(person)}</span>
                <div><strong>{person.full_name || person.name || '—'}</strong><span className="pill pill--info" style={{ marginTop: 6 }}>{role}</span></div>
              </div>
              <DetailGrid items={[[t('Full Name'), person.full_name || person.name], [t('Email'), person.email], [t('Role'), role]]} />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
