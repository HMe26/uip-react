import { useEffect, useState } from 'react';
import SettingsShell from '../../components/settings/SettingsShell';
import SupervisorProfileCard from './SupervisorProfileCard';
import { NotificationsCard, PasswordCard, AppearanceCard, LanguageCard } from '../settings/shared';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { api, errorMessage } from '../../api/client';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/supervisor/settings';

const translations = { ...i18nCommon, ...i18nPage };

const BASE = '/api/v1/supervisor/settings';

// Mirrors SupervisorManagementService::PERMISSIONS exactly (same list
// UniversitySupervisors.jsx already uses for the invite/edit form).
const PERMISSIONS = [
  { key: 'view_students', en: 'View Assigned Students', ar: 'عرض الطلاب المُسندين' },
  { key: 'manage_projects', en: 'Review & Approve Projects', ar: 'مراجعة واعتماد المشاريع' },
  { key: 'manage_messages', en: 'Messages', ar: 'الرسائل' },
  { key: 'view_reports', en: 'Reports', ar: 'التقارير' },
];

/**
 * Supervisor Settings — talks to SupervisorSettingsApiController
 * (GET/PATCH /api/v1/supervisor/settings/*). The Profile section is the shared
 * identity card (components/settings/IdentityProfile.jsx): the supervisor edits
 * their own name / phone / title / department / photo; email, permissions and
 * scope are read-only and managed by the inviting university.
 */
export default function SupervisorSettings() {
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

  if (loading) return <p className="text-small" style={{ padding: 'var(--space-5)' }}>{t('Loading…')}</p>;
  if (loadError) return <p style={{ color: 'var(--color-danger)', padding: 'var(--space-5)' }}>{loadError}</p>;
  if (!data) return null;

  const supervisor = data.supervisor;
  const scopes = data.scopes || [];
  const myPermissions = supervisor && supervisor.permissions ? supervisor.permissions.split(',') : [];

  // The API returns the real names next to the raw id (same fields the University
  // portal gets: faculty_name_*, department_name_*, group_name, project_title_*).
  // The bare scope_value (an id, e.g. "9") is only the last resort.
  const byLocale = (en, ar) => (locale === 'ar' ? (ar || en) : (en || ar)) || '';
  const scopeLabel = (s) => {
    switch (s.scope_type) {
      case 'faculty': return byLocale(s.faculty_name_en, s.faculty_name_ar) || s.scope_value;
      case 'department': return byLocale(s.department_name_en, s.department_name_ar) || s.scope_value;
      case 'group': return s.group_name || s.scope_value;
      case 'project': return byLocale(s.project_title_en, s.project_title_ar);
      default: return s.scope_value;
    }
  };

  // No theme/language endpoint on this portal's API: Appearance and Language
  // apply live (and are remembered on this device).
  const sections = [
    {
      key: 'profile', label: { en: 'Profile', ar: 'الملف الشخصي' }, icon: 'user',
      content: (
        <SupervisorProfileCard
          supervisor={supervisor} profile={data.profile} scopes={scopes} permissions={PERMISSIONS} myPermissions={myPermissions}
          scopeLabel={scopeLabel} endpoint={`${BASE}/profile`} avatarEndpoint={`${BASE}/avatar`}
        />
      ),
    },
    { key: 'appearance', label: { en: 'Appearance', ar: 'المظهر' }, icon: 'palette', content: <AppearanceCard /> },
    { key: 'language', label: { en: 'Language', ar: 'اللغة' }, icon: 'globe', content: <LanguageCard /> },
    {
      key: 'notifications', label: { en: 'Notification Preferences', ar: 'تفضيلات الإشعارات' }, icon: 'bell',
      content: (
        <NotificationsCard
          base={BASE}
          categories={data.notification_categories}
          mutedInitial={data.muted_categories}
          digestInitial={data.digest_frequency}
          quietHoursInitial={data.quiet_hours}
        />
      ),
    },
    { key: 'security', label: { en: 'Security', ar: 'الأمان' }, icon: 'lock', content: <PasswordCard base={BASE} /> },
  ];

  return (
    <SettingsShell
      title={t('Settings')}
      subtitle={locale === 'ar' ? 'بياناتك وتفضيلاتك وأمان حسابك.' : 'Your details, preferences and account security.'}
      sections={sections}
    />
  );
}
