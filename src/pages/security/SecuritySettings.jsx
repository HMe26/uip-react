import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { Modal } from '../../components/security/ui';
import SettingsShell from '../../components/settings/SettingsShell';
import { PersonProfile, useTr } from '../../components/settings/IdentityProfile';
import { useAuth } from '../../context/AuthContext';
import { NotificationsCard, PasswordCard, TwoFactorCard, AppearanceCard, LanguageCard, EmailToggleCard } from '../settings/shared';
import { useTheme } from '../../context/ThemeContext';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nSecurity from '../../i18n/security/common';
import i18nPage from '../../i18n/security/settings';
import i18nDesign from '../../i18n/security/design';

const translations = { ...i18nCommon, ...i18nSecurity, ...i18nPage, ...i18nDesign };

/**
 * Profile section = shared identity card (components/settings/IdentityProfile.jsx):
 * the person edits their own name/phone/photo; email + role are admin-managed.
 *
 * Mirrors app/Views/security/settings.php, talking to the real JSON API
 * (app/Controllers/Api/SecuritySettingsApiController.php,
 * /api/v1/security/settings/* — profile, preferences, notifications,
 * password, 2FA setup/confirm/disable, trusted devices; reuses the exact
 * same services SecuritySettingsController (web) already uses). Same
 * shared-card convention as DataAnalysisSettings.jsx: Profile/
 * Preferences/Notifications on the left, Two-Factor (inline setup +
 * recovery codes, via settings/shared.jsx's TwoFactorCard) + Trusted
 * Devices + a link over to Policies on the right — the PHP view's own
 * dedicated /security/settings/2fa page is intentionally not
 * reproduced as a separate route, same simplification already made for
 * Data Analysis's TwoFactorCard.
 */

const BASE = '/api/v1/security/settings';

export default function SecuritySettings() {
  const t = useTranslations(translations);
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

  if (loading) return <p className="text-small" style={{ padding: 'var(--space-5)' }}>{t('Settings')}…</p>;
  if (loadError) return <p style={{ color: 'var(--color-danger)', padding: 'var(--space-5)' }}>{loadError}</p>;
  if (!data) return null;

  // PATCH /preferences carries theme + email together (no language field on
  // this portal's API, so Language applies live only).
  const savePrefs = (patch) => api.patch(`${BASE}/preferences`, {
    theme_preference: liveTheme,
    email_notifications: emailRef.current ?? !!data.email_notifications,
    ...patch,
  });

  const sections = [
    { key: 'profile', label: { en: 'Profile', ar: 'الملف الشخصي' }, icon: 'user', content: <SecurityProfileSection profile={data.profile} /> },
    { key: 'appearance', label: { en: 'Appearance', ar: 'المظهر' }, icon: 'palette', content: <AppearanceCard persist={(theme) => savePrefs({ theme_preference: theme })} /> },
    { key: 'language', label: { en: 'Language', ar: 'اللغة' }, icon: 'globe', content: <LanguageCard /> },
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
          <TwoFactorCard base={BASE} twoFactorInitial={data.two_factor} />
          <PasswordCard base={BASE} />
          <TrustedDevicesCard t={t} base={BASE} initialDevices={data.trusted_devices} />

          <div className="card glass-panel">
            <h2 className="text-h3" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              <Icon name="key" size={18} /> {t('Security Policies')}
            </h2>
            <p className="text-small">{t('Platform-wide password rules and session timeout are managed on the Policies page.')}</p>
            <Link to="/security/policies" className="btn btn-outline btn-sm" style={{ marginTop: 'var(--space-3)' }}>
              <Icon name="file" size={16} /> {t('Go to Policies')}
            </Link>
          </div>
        </>
      ),
    },
  ];

  return <SettingsShell title={t('Settings')} subtitle={t('Account, appearance, and sign-in security.')} sections={sections} />;
}

function SecurityProfileSection({ profile }) {
  const { tr } = useTr();
  const { user } = useAuth();
  const roleLabel = user?.role === 'security_admin' ? tr('Security Admin', 'مسؤول الأمان') : tr('Security Officer', 'ضابط الأمان');
  return (
    <PersonProfile
      profile={profile}
      endpoint={`${BASE}/profile`}
      eyebrow={tr('Security Portal', 'بوابة الأمان')}
      subtitle={roleLabel}
      status={profile?.status}
      avatar={{ endpoint: `${BASE}/avatar`, profileEndpoint: BASE }}
      fields={[{ key: 'phone', label: tr('Phone', 'رقم التليفون'), ltr: true, maxLength: 30, placeholder: '+20 100 000 0000' }]}
      managed={(p) => [
        { icon: 'mail', label: tr('Email', 'البريد الإلكتروني'), value: p.email, ltr: true },
        { icon: 'shield', label: tr('Role', 'الدور'), value: roleLabel },
      ]}
      managedNote={tr('Your sign-in email and role are managed by the platform administrators.', 'بريد الدخول والدور يُديرهما مسؤولو المنصة.')}
    />
  );
}

function TrustedDevicesCard({ t, base, initialDevices }) {
  const [devices, setDevices] = useState(initialDevices || []);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [target, setTarget] = useState(null);

  function handleRevoke(id) {
    setTarget(null);
    setBusyId(id);
    setError(null);
    api.post(`${base}/2fa/trusted-devices/${id}/revoke`)
      .then(() => setDevices((prev) => prev.filter((d) => d.id !== id)))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setBusyId(null));
  }

  return (
    <div className="card glass-panel">
      <h2 className="text-h3" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <Icon name="smartphone" size={18} /> {t('Trusted Devices')}
      </h2>
      <p className="text-small" style={{ color: 'var(--text-secondary)' }}>
        {t('Devices you chose to "remember" after a 2FA code — the code is skipped on these for 30 days.')}
      </p>
      {error && <p className="text-caption" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {devices.length === 0 ? (
        <p className="text-caption" style={{ marginTop: 'var(--space-3)', color: 'var(--text-secondary)' }}>{t('No trusted devices right now.')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
          {devices.map((device) => (
            <div key={device.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-3)' }}>
              <div>
                <p className="text-small" style={{ margin: 0, fontWeight: 600 }}>{device.device_label || t('Unknown device')}</p>
                <p className="text-caption" style={{ margin: '2px 0 0', color: 'var(--text-secondary)' }}>
                  {t('Last used')}: {device.last_used_at || ''}{device.ip_address ? ` · ${device.ip_address}` : ''}
                </p>
              </div>
              <button type="button" className="btn btn-outline btn-sm" style={{ color: 'var(--color-danger)' }} disabled={busyId === device.id} onClick={() => setTarget(device)}>
                <Icon name="trash" size={14} /> {t('Forget')}
              </button>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!target} tone="danger" onClose={() => setTarget(null)} title={t('Forget this device?')}
        footer={(<><button type="button" className="btn btn-outline" onClick={() => setTarget(null)}>{t('Cancel')}</button><button type="button" className="btn btn-danger" onClick={() => handleRevoke(target.id)}>{t('Forget')}</button></>)}>
        {target && <strong>{target.device_label || t('Unknown device')}</strong>}
      </Modal>
    </div>
  );
}
