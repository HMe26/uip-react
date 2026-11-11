import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { PersonProfile, useTr } from '../../components/settings/IdentityProfile';
import DeleteAccountCard from '../../components/settings/DeleteAccountCard';
import SettingsShell from '../../components/settings/SettingsShell';
import SharedLinksCard from '../../components/settings/SharedLinksCard';
import { ROW_BETWEEN, SavedBadge, NotificationsCard, PasswordCard, TwoFactorCard, AppearanceCard, LanguageCard, EmailToggleCard } from '../settings/shared';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/student/settings';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/student/settings.php, talking to the real JSON API
 * (app/Controllers/Api/StudentSettingsApiController.php — routes/api.php
 * '/student/settings/*'). Every field/endpoint below comes straight from
 * that controller. The Profile section is the shared identity card
 * (components/settings/IdentityProfile.jsx): the student edits their own name
 * (Arabic + English), phone and bio through PATCH /api/v1/students/me; email,
 * student number and faculty/department stay university-managed.
 */

const BASE = '/api/v1/student/settings';

export default function StudentSettings() {
  const t = useTranslations(translations);
  const { theme: liveTheme } = useTheme();
  const { locale: liveLocale } = useLanguage();
  const emailRef = useRef(null); // latest email-notification choice (null = untouched)
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

  if (loading) return <p className="text-small" style={{ padding: 'var(--space-5)' }}>{t('Loading settings…')}</p>;
  if (loadError) return <p style={{ color: 'var(--color-danger)', padding: 'var(--space-5)' }}>{loadError}</p>;
  if (!data) return null;

  // One PATCH /preferences carries language + theme + email, so each save
  // sends the current value of the other two.
  const savePrefs = (patch) => api.patch(`${BASE}/preferences`, {
    preferred_language: liveLocale,
    theme_preference: liveTheme,
    email_notifications: emailRef.current ?? !!data.email_notifications,
    ...patch,
  });

  const sections = [
    {
      key: 'profile', label: { en: 'Profile', ar: 'الملف الشخصي' }, icon: 'user',
      content: <StudentProfileSection profile={data.profile} />,
    },
    { key: 'appearance', label: { en: 'Appearance', ar: 'المظهر' }, icon: 'palette', content: <AppearanceCard persist={(theme) => savePrefs({ theme_preference: theme })} /> },
    { key: 'language', label: { en: 'Language', ar: 'اللغة' }, icon: 'globe', content: <LanguageCard persist={(lang) => savePrefs({ preferred_language: lang })} /> },
    { key: 'shared-links', label: { en: 'Shared links', ar: 'الروابط المشاركة' }, icon: 'link', content: <SharedLinksCard /> },
    {
      key: 'notifications', label: { en: 'Notification Preferences', ar: 'تفضيلات الإشعارات' }, icon: 'bell',
      content: (
        <>
          <EmailToggleCard initial={data.email_notifications} persist={(on) => { emailRef.current = on; return savePrefs({ email_notifications: on }); }} />
          <NotificationsCard
            base={BASE}
            categories={data.notification_categories}
            mutedInitial={data.muted_categories}
            digestInitial={data.digest_frequency}
            quietHoursInitial={data.quiet_hours}
          />
          <MessagingPrivacyCard readReceiptsInitial={data.read_receipts_enabled} />
        </>
      ),
    },
    {
      key: 'security', label: { en: 'Security', ar: 'الأمان' }, icon: 'lock',
      content: (
        <>
          <PasswordCard base={BASE} />
          <TwoFactorCard base={BASE} twoFactorInitial={data.two_factor} />
          <DeleteAccountCard base={BASE} passwordRequired={data.account_deletion?.password_required !== false} />
        </>
      ),
    },
  ];

  return (
    <SettingsShell
      title={t('Settings')}
      subtitle={liveLocale === 'ar' ? 'تفاصيل حسابك وتفضيلاتك.' : 'Your account details and preferences.'}
      sections={sections}
    />
  );
}

function StudentProfileSection({ profile }) {
  const { ar, tr } = useTr();
  const pick = (p, key) => (ar ? (p[`${key}_ar`] || p[`${key}_en`]) : (p[`${key}_en`] || p[`${key}_ar`])) || p[key];

  return (
    <PersonProfile
      profile={profile}
      endpoint="/api/v1/students/me"
      eyebrow={tr('Student', 'طالب')}
      subtitle={(p) => [pick(p, 'faculty_name'), pick(p, 'department_name')].filter(Boolean).join(' — ') || tr('Student', 'طالب')}
      status={profile?.account_status}
      avatar={{ endpoint: '/api/v1/students/me/avatar', profileEndpoint: '/api/v1/students/me' }}
      fields={[
        { key: 'phone', label: tr('Phone', 'رقم التليفون'), ltr: true, maxLength: 30, placeholder: '+20 100 000 0000' },
        { key: 'bio', label: tr('Bio', 'نبذة عنك'), multiline: true, maxLength: 1000, placeholder: tr('A short bio people can see on your profile.', 'نبذة قصيرة يراها الآخرون في ملفك.') },
      ]}
      managed={(p) => [
        { icon: 'mail', label: tr('Email', 'البريد الإلكتروني'), value: p.email, ltr: true },
        { icon: 'award', label: tr('Student number', 'الرقم الجامعي'), value: p.student_number, ltr: true },
        { icon: 'building', label: tr('University', 'الجامعة'), value: pick(p, 'university_name') },
        { icon: 'briefcase', label: tr('Faculty', 'الكلية'), value: pick(p, 'faculty_name') },
        { icon: 'layers', label: tr('Department', 'القسم'), value: pick(p, 'department_name') },
        { icon: 'calendar', label: tr('Academic year', 'السنة الدراسية'), value: p.academic_year != null ? String(p.academic_year) : '' },
      ]}
      managedNote={tr('Your email, student number and academic placement are set by your university.', 'البريد الإلكتروني والرقم الجامعي وبيانات الكلية والقسم تحددها جامعتك.')}
    />
  );
}

function MessagingPrivacyCard({ readReceiptsInitial }) {
  const t = useTranslations(translations);
  const [readReceipts, setReadReceipts] = useState(!!readReceiptsInitial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.patch(`${BASE}/messaging-privacy`, { read_receipts_enabled: readReceipts });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card glass-panel">
      <h2 className="text-h3" style={{ marginBottom: 'var(--space-2)' }}>
        <Icon name="message" size={18} /> {t('Messaging Privacy')} <SavedBadge show={saved} />
      </h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group" style={ROW_BETWEEN}>
          <div>
            <label className="form-label" style={{ margin: 0 }}>{t('Read Receipts')}</label>
            <p className="text-caption" style={{ margin: '2px 0 0' }}>{t("Let others see when you've read their messages.")}</p>
          </div>
          <span className="switch">
            <input type="checkbox" checked={readReceipts} onChange={(e) => { setReadReceipts(e.target.checked); setSaved(false); }} aria-label={t('Read Receipts')} />
            <span className="switch__track" aria-hidden="true" />
          </span>
        </div>
        {error && <p className="text-caption" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          <Icon name="check" size={16} /> {saving ? t('Saving…') : t('Save')}
        </button>
      </form>
    </div>
  );
}
