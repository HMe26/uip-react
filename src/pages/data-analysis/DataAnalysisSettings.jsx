import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { PersonProfile, useTr } from '../../components/settings/IdentityProfile';
import SettingsShell from '../../components/settings/SettingsShell';
import { NotificationsCard, PasswordCard, TwoFactorCard, AppearanceCard, LanguageCard, EmailToggleCard } from '../settings/shared';
import { useTheme } from '../../context/ThemeContext';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/data-analysis/settings';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/data-analysis/settings.php, talking to the real JSON
 * API (app/Controllers/Api/DataAnalysisSettingsApiController.php —
 * already fully written, previously just not registered in routes/api.php;
 * that registration is the only backend change this page required, see
 * routes/api.php's '/data-analysis/settings' group). Every field/endpoint
 * below comes straight from that controller: full_name + contact_email
 * (with email-change confirmation flow) are editable here, unlike Student
 * whose profile card is read-only.
 */

const BASE = '/api/v1/data-analysis/settings';

export default function DataAnalysisSettings() {
  const t = useTranslations(translations);
  const { theme: liveTheme } = useTheme();
  const emailRef = useRef(null); // latest email-notification choice (null = not touched yet)
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

  if (loading) return <p className="text-small" style={{ padding: 'var(--space-5)' }}>{t('Settings')}…</p>;
  if (loadError) return <p style={{ color: 'var(--color-danger)', padding: 'var(--space-5)' }}>{loadError}</p>;
  if (!data) return null;

  // Theme + email preference are saved together by this portal's API, so each
  // save sends the current value of the other one (live theme / last email choice).
  const savePrefs = (patch) => api.patch(`${BASE}/preferences`, {
    theme_preference: liveTheme,
    email_notifications: emailRef.current ?? !!data.email_notifications,
    ...patch,
  });

  const sections = [
    {
      key: 'profile', label: t('Profile'), icon: 'user',
      content: <DataAnalysisProfileSection profile={data.profile} />,
    },
    { key: 'appearance', label: t('Appearance'), icon: 'palette', content: <AppearanceCard persist={(theme) => savePrefs({ theme_preference: theme })} /> },
    { key: 'language', label: t('Language'), icon: 'globe', content: <LanguageCard /> },
    {
      key: 'notifications', label: t('Notification Preferences'), icon: 'bell',
      content: (
        <>
          <EmailToggleCard
            initial={data.email_notifications}
            description={t('Get emailed when scheduled reports and exports finish.')}
            persist={(on) => { emailRef.current = on; return savePrefs({ email_notifications: on }); }}
          />
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
      key: 'security', label: t('Security'), icon: 'lock',
      content: (
        <>
          <PasswordCard base={BASE} />
          <TwoFactorCard base={BASE} twoFactorInitial={data.two_factor} />
        </>
      ),
    },
  ];

  return <SettingsShell title={t('Settings')} subtitle={t('Account, appearance, and sign-in security.')} sections={sections} />;
}

function DataAnalysisProfileSection({ profile }) {
  const { tr } = useTr();
  return (
    <PersonProfile
      profile={profile}
      endpoint={`${BASE}/profile`}
      eyebrow={tr('Data Analysis Portal', 'بوابة تحليل البيانات')}
      subtitle={tr('Data Analyst', 'محلل بيانات')}
      status={profile?.status}
      avatar={{ endpoint: `${BASE}/avatar`, profileEndpoint: BASE }}
      fields={[{ key: 'phone', label: tr('Phone', 'رقم التليفون'), ltr: true, maxLength: 30, placeholder: '+20 100 000 0000' }]}
      managed={(p) => [
        { icon: 'mail', label: tr('Email', 'البريد الإلكتروني'), value: p.email, ltr: true },
        { icon: 'chart', label: tr('Role', 'الدور'), value: tr('Data Analyst', 'محلل بيانات') },
      ]}
      managedNote={tr('Your sign-in email and role are managed by the platform administrators.', 'بريد الدخول والدور يُديرهما مسؤولو المنصة.')}
    />
  );
}
