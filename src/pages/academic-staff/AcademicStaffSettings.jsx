import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import SettingsShell from '../../components/settings/SettingsShell';
import { PersonProfile, useTr } from '../../components/settings/IdentityProfile';
import { NotificationsCard, PasswordCard, TwoFactorCard, AppearanceCard, LanguageCard, EmailToggleCard } from '../settings/shared';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/academic-staff/settings';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Talks to app/Http/Controllers/Api/AcademicStaffSettingsApiController.php
 * (routes/api.php '/academic-staff/settings/*'). The Profile section is the
 * shared identity card (components/settings/IdentityProfile.jsx): the doctor /
 * teaching assistant edits their OWN name (Arabic + English), phone, bio and
 * photo — a typo never needs the university or faculty to step in. Email, rank,
 * faculty/department and staff number stay admin-managed (read-only).
 *
 * Previously locked with a "Soon" badge in the Sidebar
 * (ACCOUNT_ITEM_OVERRIDES.academic_staff.settings in navConfig.js) since
 * no controller/route existed yet — both now exist, so that override was
 * removed.
 */

const BASE = '/api/v1/academic-staff/settings';

export default function AcademicStaffSettings() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const { theme: liveTheme } = useTheme();
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

  if (loading) return <p className="text-small" style={{ padding: 'var(--space-5)' }}>{t('Loading…')}</p>;
  if (loadError) return <p style={{ color: 'var(--color-danger)', padding: 'var(--space-5)' }}>{loadError}</p>;
  if (!data) return null;

  // One PATCH /preferences carries language + theme + email, so each save
  // sends the current value of the other two.
  const savePrefs = (patch) => api.patch(`${BASE}/preferences`, {
    preferred_language: locale,
    theme_preference: liveTheme,
    email_notifications: emailRef.current ?? !!data.email_notifications,
    ...patch,
  });

  const sections = [
    {
      key: 'profile', label: { en: 'Profile', ar: 'الملف الشخصي' }, icon: 'user',
      content: <StaffProfileSection profile={data.profile} />,
    },
    { key: 'appearance', label: { en: 'Appearance', ar: 'المظهر' }, icon: 'palette', content: <AppearanceCard persist={(theme) => savePrefs({ theme_preference: theme })} /> },
    { key: 'language', label: { en: 'Language', ar: 'اللغة' }, icon: 'globe', content: <LanguageCard persist={(lang) => savePrefs({ preferred_language: lang })} /> },
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
        </>
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

  return <SettingsShell title={t('Settings')} subtitle={t('Your account details and preferences.')} sections={sections} />;
}

function StaffProfileSection({ profile }) {
  const { ar, tr } = useTr();
  const pick = (p, key) => (ar ? (p[`${key}_ar`] || p[`${key}_en`]) : (p[`${key}_en`] || p[`${key}_ar`])) || '';

  return (
    <PersonProfile
      profile={profile}
      endpoint={`${BASE}/profile`}
      eyebrow={[tr('Academic Staff', 'الهيئة التدريسية'), pick(profile || {}, 'rank_name')].filter(Boolean).join(' · ')}
      subtitle={(p) => [pick(p, 'faculty_name'), pick(p, 'department_name')].filter(Boolean).join(' — ') || tr('Academic staff member', 'عضو هيئة تدريس')}
      status={profile?.status}
      avatar={{ endpoint: '/api/v1/academic-staff/me/avatar', profileEndpoint: '/api/v1/academic-staff/me' }}
      fields={[
        { key: 'phone', label: tr('Phone', 'رقم التليفون'), ltr: true, maxLength: 30, placeholder: '+20 100 000 0000' },
        { key: 'bio', label: tr('Bio', 'نبذة عنك'), multiline: true, maxLength: 1000, placeholder: tr('A short bio students and colleagues can see on your profile.', 'نبذة قصيرة يراها الطلاب والزملاء في ملفك.') },
      ]}
      managed={(p) => [
        { icon: 'mail', label: tr('Email', 'البريد الإلكتروني'), value: p.email, ltr: true },
        { icon: 'award', label: tr('Academic rank', 'الرتبة الأكاديمية'), value: pick(p, 'rank_name') },
        { icon: 'briefcase', label: tr('Faculty', 'الكلية'), value: pick(p, 'faculty_name') },
        { icon: 'layers', label: tr('Department', 'القسم'), value: pick(p, 'department_name') },
        { icon: 'user', label: tr('Staff number', 'الرقم الوظيفي'), value: p.staff_number, ltr: true },
      ]}
      managedNote={tr('Your email, rank and faculty/department placement are set by your university or faculty administration.', 'البريد الإلكتروني والرتبة والكلية والقسم تحددها إدارة الجامعة أو الكلية.')}
    />
  );
}
