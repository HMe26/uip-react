import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import TotpQrCode from '../../components/TotpQrCode';
import { ConfirmModal } from '../../components/admin/adminUi';
import { PersonProfile, useTr } from '../../components/settings/IdentityProfile';
import SettingsShell from '../../components/settings/SettingsShell';
import { AppearanceCard, LanguageCard, EmailToggleCard, NotificationsCard, EmailChangeCard } from '../settings/shared';
import { useTheme } from '../../context/ThemeContext';
import { useTranslations } from '../../context/LanguageContext';
import i18nPage from '../../i18n/admin/settings';
import i18nCommon from '../../i18n/common';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/admin/settings.php, talking to the real JSON API
 * (app/Controllers/Api/AdminSettingsApiController.php — the one portal
 * that already has a full /api/v1/admin/settings/* surface, see
 * routes/api.php lines ~760-776). Every field name, endpoint, and piece
 * of business logic below (blank password/API key = "keep existing",
 * email change goes through a confirm-link instead of applying
 * instantly, muted categories are the inverse of "enabled", etc.) comes
 * straight from that controller — nothing here is invented.
 *
 * Bearer auth means CSRFMiddleware exempts every one of these calls
 * (see api/client.js) — no _csrf_token needed, unlike the web form.
 */

function SavedBadge({ show }) {
  const t = useTranslations(translations);
  if (!show) return null;
  return (
    <span className="badge badge-success" style={{ marginInlineStart: 'var(--space-2)' }}>
      <Icon name="check-circle" size={12} /> {t('Saved')}
    </span>
  );
}

export default function AdminSettings() {
  const t = useTranslations(translations);
  const { theme: liveTheme } = useTheme();
  const emailRef = useRef(null); // latest email-notification choice (null = not touched yet)
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/v1/admin/settings')
      .then((json) => { if (!cancelled) setData(json.data); })
      .catch((err) => { if (!cancelled) setLoadError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <p className="text-small" style={{ padding: 'var(--space-5)' }}>{t('Loading settings…')}</p>;
  if (loadError) return <p className="form-error" style={{ padding: 'var(--space-5)' }}>{loadError}</p>;
  if (!data) return null;

  // Admin's API saves the theme on its own; there is no language field, so
  // Language applies live only (and is remembered on this device).
  const sections = [
    {
      key: 'profile', label: { en: 'Profile', ar: 'الملف الشخصي' }, icon: 'user',
      content: <AdminProfileSection profile={data.profile} />,
    },
    {
      key: 'appearance', label: { en: 'Appearance', ar: 'المظهر' }, icon: 'palette',
      content: <AppearanceCard persist={(theme) => api.patch('/api/v1/admin/settings/preferences', {
        theme_preference: theme,
        ...('email_notifications' in data ? { email_notifications: emailRef.current ?? !!data.email_notifications } : {}),
      })} />,
    },
    { key: 'language', label: { en: 'Language', ar: 'اللغة' }, icon: 'globe', content: <LanguageCard /> },
    {
      key: 'notifications', label: { en: 'Notification Preferences', ar: 'تفضيلات الإشعارات' }, icon: 'bell',
      content: (
        <>
          {/* Same layout as the Data Analysis portal: e-mail switch + shared preferences card.
              The switch only shows when the settings API returns email_notifications. */}
          {'email_notifications' in data && (
            <EmailToggleCard
              initial={data.email_notifications}
              persist={(on) => {
                emailRef.current = on;
                return api.patch('/api/v1/admin/settings/preferences', { theme_preference: liveTheme, email_notifications: on });
              }}
            />
          )}
          <NotificationsCard
            base="/api/v1/admin/settings"
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
      content: (<><EmailChangeCard /><SecurityCard sessionMinutes={data.session_minutes} twoFactorInitial={data.two_factor} /></>),
    },
    {
      key: 'platform', label: { en: 'Platform', ar: 'المنصة' }, icon: 'settings',
      content: (
        <>
          <PlatformCard maintenanceInitial={data.maintenance_mode} />
          <MailCard initial={data.mail_settings} />
          <AiCard initial={data.ai_settings} />
          <div className="adm-panel">
            <h2 className="text-h3">{t("Admin Team Management")}</h2>
            <p className="text-small">{t("Every admin account on the platform, and adding new ones.")}</p>
            <Link to="/admin/team" className="btn btn-outline btn-sm" style={{ marginTop: 'var(--space-3)' }}>
              <Icon name="users" size={16} /> {t('Open Team Management')}
            </Link>
          </div>
        </>
      ),
    },
  ];

  return <SettingsShell title={t("Settings")} subtitle={t("Your admin account details and platform-wide settings.")} sections={sections} />;
}

// -- Profile ----------------------------------------------------------------

function AdminProfileSection({ profile }) {
  const { tr } = useTr();
  return (
    <PersonProfile
      profile={profile}
      endpoint="/api/v1/admin/settings/profile"
      eyebrow={tr('Platform Administration', 'إدارة المنصة')}
      subtitle={tr('Administrator', 'مسؤول النظام')}
      status={profile?.status}
      avatar={{ endpoint: '/api/v1/admin/settings/avatar', profileEndpoint: '/api/v1/admin/settings' }}
      fields={[{ key: 'phone', label: tr('Phone', 'رقم التليفون'), ltr: true, maxLength: 30, placeholder: '+20 100 000 0000' }]}
      managed={(p) => [
        { icon: 'mail', label: tr('Email', 'البريد الإلكتروني'), value: p.email, ltr: true },
        { icon: 'shield', label: tr('Role', 'الدور'), value: tr('Administrator', 'مسؤول النظام') },
      ]}
      managedNote={tr('Your sign-in email and role can only be changed by another administrator.', 'بريد الدخول والدور لا يغيّرهما إلا مسؤول آخر.')}
    />
  );
}

// -- Security (session timeout, 2FA) -----------------------------------

function SecurityCard({ sessionMinutes, twoFactorInitial }) {
  const t = useTranslations(translations);
  const [twoFactor, setTwoFactor] = useState(twoFactorInitial);
  const [stage, setStage] = useState('idle'); // idle | setup | confirm
  const [setup, setSetup] = useState(null); // { secret, manual_key, otpauth_uri }
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDisable, setConfirmingDisable] = useState(false);

  async function startSetup() {
    setError(null);
    setBusy(true);
    try {
      const json = await api.post('/api/v1/admin/settings/2fa/setup', {});
      setSetup(json.data);
      setStage('setup');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const json = await api.post('/api/v1/admin/settings/2fa/confirm', { code, setup_token: setup?.setup_token });
      setRecoveryCodes(json.data?.recovery_codes || []);
      setTwoFactor({ enabled: true, confirmed_at: new Date().toISOString() });
      setStage('confirmed');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function handleDisable(e) {
    e.preventDefault();
    setConfirmingDisable(true);
  }

  async function runDisable() {
    setConfirmingDisable(false);
    setError(null);
    setBusy(true);
    try {
      await api.post('/api/v1/admin/settings/2fa/disable', { current_password: currentPassword });
      setTwoFactor({ enabled: false, confirmed_at: null });
      setCurrentPassword('');
      setStage('idle');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-panel">
      <h2 className="text-h3" style={{ marginBottom: 'var(--space-4)' }}>{t("Security")}</h2>
      <div className="form-group">
        <label className="form-label">{t("Session Timeout")}</label>
        <input className="form-input" type="text" value={`${sessionMinutes} ${t('minutes')}`} disabled />
      </div>

      {stage === 'confirmed' && recoveryCodes && (
        <div className="form-group">
          <p className="text-small" style={{ fontWeight: 600 }}>
            {t('Two-factor authentication enabled. Save these recovery codes — shown only once:')}
          </p>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 'var(--text-small)' }}>
            {recoveryCodes.join('\n')}
          </pre>
        </div>
      )}

      {twoFactor?.enabled ? (
        <>
          <div className="form-group adm-set-row">
            <label className="form-label" style={{ margin: 0 }}>{t("Two-Factor Authentication")}</label>
            <span className="badge badge-success"><Icon name="check-circle" size={12} /> {t('Enabled')}</span>
          </div>
          <form onSubmit={handleDisable} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <input
              className="form-input"
              type="password"
              placeholder={t("Current password")}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
            {error && <p className="text-caption" style={{ color: 'var(--color-danger)' }}>{error}</p>}
            <button type="submit" className="btn btn-outline btn-sm" style={{ color: 'var(--color-danger)' }} disabled={busy}>
              {t('Disable')}
            </button>
          </form>
        </>
      ) : stage === 'setup' && setup ? (
        <form onSubmit={confirmSetup} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <p className="text-small">{t("Scan this into your authenticator app, or enter the key manually:")}</p>
          {setup.otpauth_uri && (
            <div style={{ textAlign: 'center', margin: 'var(--space-2) 0' }}>
              <TotpQrCode uri={setup.otpauth_uri} />
            </div>
          )}
          <p className="text-caption" style={{ fontFamily: 'monospace', wordBreak: 'break-all', textAlign: 'center' }}>{setup.manual_key}</p>
          <input
            className="form-input text-mono"
            style={{ letterSpacing: '4px', textAlign: 'center' }}
            type="text"
            inputMode="numeric"
            placeholder={t('6-digit code')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          {error && <p className="text-caption" style={{ color: 'var(--color-danger)' }}>{error}</p>}
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            <Icon name="shield" size={16} /> {busy ? t('Verifying…') : t('Confirm')}
          </button>
        </form>
      ) : (
        <div className="form-group adm-set-row">
          <div>
            <label className="form-label" style={{ margin: 0 }}>{t("Two-Factor Authentication")}</label>
            <p className="text-caption" style={{ margin: '2px 0 0' }}>{t("Strongly recommended for admin accounts.")}</p>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={startSetup} disabled={busy}>
            <Icon name="shield" size={16} /> {t('Enable')}
          </button>
        </div>
      )}
      {confirmingDisable && (
        <ConfirmModal
          title={t('Confirm action')}
          message={t("Disable two-factor authentication?")}
          confirmLabel={t("Disable")}
          danger
          busy={busy}
          onConfirm={runDisable}
          onClose={() => setConfirmingDisable(false)}
        />
      )}
    </div>
  );
}

// -- Platform (maintenance mode) -----------------------------------------

function PlatformCard({ maintenanceInitial }) {
  const t = useTranslations(translations);
  const [maintenance, setMaintenance] = useState(maintenanceInitial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const json = await api.post('/api/v1/admin/settings/maintenance/toggle', {});
      setMaintenance(json.data?.maintenance_mode ?? !maintenance);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-panel">
      <h2 className="text-h3" style={{ marginBottom: 'var(--space-4)' }}>{t("Platform")}</h2>
      <div className="form-group adm-set-row">
        <div>
          <label className="form-label" style={{ margin: 0 }}>{t("Maintenance Mode")}</label>
          <p className="text-caption" style={{ margin: '2px 0 0' }}>{t("Temporarily blocks non-admin users from signing in.")}</p>
        </div>
        <button type="button" className={`btn ${maintenance ? 'btn-danger' : 'btn-outline'} btn-sm`} onClick={toggle} disabled={busy}>
          {maintenance ? t("Turn Off") : t("Turn On")}
        </button>
      </div>
      {maintenance && <span className="badge badge-danger" style={{ marginTop: 'var(--space-2)' }}>{t("Currently ON")}</span>}
      {error && <p className="text-caption" style={{ color: 'var(--color-danger)' }}>{error}</p>}
    </div>
  );
}

// -- Mail (SMTP) ----------------------------------------------------------

function MailCard({ initial }) {
  const t = useTranslations(translations);
  const [driver, setDriver] = useState(initial.driver || 'smtp');
  const [brevoKey, setBrevoKey] = useState('');
  const [hasBrevoKey, setHasBrevoKey] = useState(!!initial.has_brevo_key);
  const [host, setHost] = useState(initial.host || '');
  const [port, setPort] = useState(initial.port ?? 587);
  const [username, setUsername] = useState(initial.username || '');
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(initial.has_password);
  const [encryption, setEncryption] = useState(initial.encryption ?? 'tls');
  const [fromName, setFromName] = useState(initial.from_name || '');
  const [fromAddress, setFromAddress] = useState(initial.from_address || '');
  const [replyTo, setReplyTo] = useState(initial.reply_to || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [testSending, setTestSending] = useState(false);
  const [testMessage, setTestMessage] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const json = await api.patch('/api/v1/admin/settings/mail', {
        mail_driver: driver,
        mail_brevo_api_key: brevoKey,
        mail_host: host,
        mail_port: port,
        mail_username: username,
        mail_password: password,
        mail_encryption: encryption,
        mail_from_name: fromName,
        mail_from_address: fromAddress,
        mail_reply_to: replyTo,
      });
      setHasPassword(json.data?.has_password ?? hasPassword);
      setHasBrevoKey(json.data?.has_brevo_key ?? hasBrevoKey);
      setPassword('');
      setBrevoKey('');
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function sendTest(e) {
    e.preventDefault();
    setTestSending(true);
    setTestMessage(null);
    try {
      const json = await api.post('/api/v1/admin/settings/mail/test', {});
      setTestMessage(json.message);
    } catch (err) {
      setTestMessage(errorMessage(err));
    } finally {
      setTestSending(false);
    }
  }

  return (
    <div className="adm-panel">
      <h2 className="text-h3" style={{ marginBottom: 'var(--space-2)' }}>
        {t('Mail Settings')} <SavedBadge show={saved} />
      </h2>
      <p className="text-caption" style={{ margin: '0 0 var(--space-4)' }}>
        {t('Used to send welcome, email-verification, password-reset, and scheduled-report emails.')}
      </p>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">{t("Mail Provider")}</label>
          <select className="form-select" value={driver} onChange={(e) => { setDriver(e.target.value); setSaved(false); }}>
            <option value="smtp">{t("SMTP (Google Gmail or any SMTP server)")}</option>
            <option value="brevo">{t("Brevo API (works even if the server blocks SMTP)")}</option>
          </select>
        </div>
        {driver === 'smtp' ? (
          <>
        <div className="grid-2" style={{ gap: 'var(--space-3)' }}>
          <div className="form-group">
            <label className="form-label">{t('SMTP Host')}</label>
            <input className="form-input" type="text" value={host} onChange={(e) => { setHost(e.target.value); setSaved(false); }} placeholder="smtp.gmail.com" />
          </div>
          <div className="form-group">
            <label className="form-label">{t('SMTP Port')}</label>
            <input className="form-input" type="number" value={port} onChange={(e) => { setPort(e.target.value); setSaved(false); }} placeholder="587" />
          </div>
        </div>
        <div className="grid-2" style={{ gap: 'var(--space-3)' }}>
          <div className="form-group">
            <label className="form-label">{t("Username")}</label>
            <input className="form-input" type="text" value={username} onChange={(e) => { setUsername(e.target.value); setSaved(false); }} placeholder="you@example.com" />
          </div>
          <div className="form-group">
            <label className="form-label">{t("Password")}</label>
            <input
              className="form-input"
              type="password"
              data-allow-clipboard
              value={password}
              onChange={(e) => { setPassword(e.target.value); setSaved(false); }}
              placeholder={hasPassword ? t("•••••••• (leave blank to keep)") : t("Not set yet")}
            />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">{t("Encryption")}</label>
          <select className="form-select" value={encryption} onChange={(e) => { setEncryption(e.target.value); setSaved(false); }}>
            <option value="tls">TLS (STARTTLS — 587)</option>
            <option value="ssl">SSL (465)</option>
            <option value="">{t("None")}</option>
          </select>
        </div>
            <p className="text-caption" style={{ margin: '0 0 var(--space-3)' }}>
              {t('For Gmail use smtp.gmail.com, port 587, and an App Password (not your account password). If sending times out, your hosting provider is probably blocking SMTP — switch to Brevo API.')}
            </p>
          </>
        ) : (
          <>
            <div className="form-group">
              <label className="form-label">{t("Brevo API Key")}</label>
              <input
                className="form-input"
                type="password"
                autoComplete="off"
                data-allow-clipboard
                value={brevoKey}
                onChange={(e) => { setBrevoKey(e.target.value); setSaved(false); }}
                placeholder={hasBrevoKey ? t("•••••••• (leave blank to keep)") : "xkeysib-..."}
              />
            </div>
            <p className="text-caption" style={{ margin: '0 0 var(--space-3)' }}>
              {t('Create the key in Brevo → SMTP & API → API Keys (not the SMTP key), and verify the From Address as a Sender in Brevo.')}
            </p>
          </>
        )}
        <div className="grid-2" style={{ gap: 'var(--space-3)' }}>
          <div className="form-group">
            <label className="form-label">{t("From Name")}</label>
            <input className="form-input" type="text" value={fromName} onChange={(e) => { setFromName(e.target.value); setSaved(false); }} placeholder={t('Unified Integrated Platform Ecosystem')} />
          </div>
          <div className="form-group">
            <label className="form-label">{t("From Address")}</label>
            <input className="form-input" type="email" value={fromAddress} onChange={(e) => { setFromAddress(e.target.value); setSaved(false); }} placeholder="no-reply@uip.local" />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">{t("Reply-To")}</label>
          <input className="form-input" type="email" value={replyTo} onChange={(e) => { setReplyTo(e.target.value); setSaved(false); }} placeholder="support@uip.local" />
        </div>
        {error && <p className="text-caption" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <Icon name="check" size={18} /> {saving ? t('Saving…') : t("Save Mail Settings")}
          </button>
        </div>
      </form>
      <form onSubmit={sendTest} style={{ marginTop: 'var(--space-3)' }}>
        <button type="submit" className="btn btn-outline btn-sm" disabled={testSending}>
          <Icon name="mail" size={16} /> {testSending ? t('Sending…') : t("Send Test Email to Myself")}
        </button>
        {testMessage && <p className="text-caption" style={{ marginTop: 'var(--space-2)' }}>{testMessage}</p>}
      </form>
    </div>
  );
}

// -- AI ---------------------------------------------------------------------

function AiCard({ initial }) {
  const t = useTranslations(translations);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [personalization, setPersonalization] = useState(initial.email_personalization_enabled);
  const [baseUrl, setBaseUrl] = useState(initial.base_url || '');
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(initial.has_api_key);
  const [model, setModel] = useState(initial.model || '');
  // speech-to-text for automatic video subtitles (an OpenAI-compatible Whisper server — Ollama itself cannot transcribe audio)
  const [sttBaseUrl, setSttBaseUrl] = useState(initial.transcribe_base_url || '');
  const [sttKey, setSttKey] = useState('');
  const [hasSttKey, setHasSttKey] = useState(!!initial.has_transcribe_api_key);
  const [sttModel, setSttModel] = useState(initial.transcribe_model || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const json = await api.patch('/api/v1/admin/settings/ai', {
        ai_transcribe_base_url: sttBaseUrl,
        ai_transcribe_api_key: sttKey,
        ai_transcribe_model: sttModel,
        ai_enabled: enabled ? '1' : null,
        ai_base_url: baseUrl,
        ai_api_key: apiKey,
        ai_model: model,
        ai_email_personalization_enabled: personalization ? '1' : null,
      });
      setHasApiKey(json.data?.has_api_key ?? hasApiKey);
      setHasSttKey(json.data?.has_transcribe_api_key ?? hasSttKey);
      setApiKey('');
      setSttKey('');
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="adm-panel">
      <h2 className="text-h3" style={{ marginBottom: 'var(--space-2)' }}>
        {t('AI Settings')} <SavedBadge show={saved} />
      </h2>
      <p className="text-caption" style={{ margin: '0 0 var(--space-4)' }}>
        {t('Currently used only to personalize the opening line of outgoing emails (never any link or security instruction).')}
      </p>
      <form onSubmit={handleSubmit}>
        <div className="form-group adm-set-row">
          <label className="form-label" style={{ margin: 0 }}>{t("Enable AI Features")}</label>
          <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }} style={{ width: 20, height: 20 }} />
        </div>
        <div className="form-group adm-set-row">
          <div>
            <label className="form-label" style={{ margin: 0 }}>{t("Personalize Emails with AI")}</label>
            <p className="text-caption" style={{ margin: '2px 0 0' }}>{t("Falls back to the static text automatically when off.")}</p>
          </div>
          <input type="checkbox" checked={personalization} onChange={(e) => { setPersonalization(e.target.checked); setSaved(false); }} style={{ width: 20, height: 20 }} />
        </div>
        <div className="form-group">
          <label className="form-label">{t('Base URL')}</label>
          <input className="form-input" type="text" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setSaved(false); }} placeholder="https://api.openai.com/v1" />
        </div>
        <div className="form-group">
          <label className="form-label">{t('API Key')}</label>
          <input
            className="form-input"
            type="password"
            data-allow-clipboard
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setSaved(false); }}
            placeholder={hasApiKey ? t("•••••••• (leave blank to keep)") : t("Not set yet")}
          />
        </div>
        <div className="form-group">
          <label className="form-label">{t('Model')}</label>
          <input className="form-input" type="text" value={model} onChange={(e) => { setModel(e.target.value); setSaved(false); }} placeholder="gpt-4o-mini" />
        </div>
        <h3 className="text-h4" style={{ margin: 'var(--space-4) 0 var(--space-1)' }}>{t('Speech-to-text (automatic video subtitles)')}</h3>
        <p className="text-caption" style={{ margin: '0 0 var(--space-3)' }}>
          {t('Needed to transcribe the speech in videos. Ollama cannot transcribe audio, so point this at an OpenAI-compatible Whisper server (e.g. Speaches / faster-whisper-server) or a hosted one (Groq, OpenAI). The model above is then used to translate the text. Leave the URL empty to hide the feature.')}
        </p>
        <div className="form-group">
          <label className="form-label">{t('Speech-to-text Base URL')}</label>
          <input className="form-input" type="text" dir="ltr" value={sttBaseUrl} onChange={(e) => { setSttBaseUrl(e.target.value); setSaved(false); }} placeholder="http://localhost:8000/v1" />
        </div>
        <div className="grid-2" style={{ gap: 'var(--space-3)' }}>
          <div className="form-group">
            <label className="form-label">{t('Speech-to-text API Key (optional)')}</label>
            <input
              className="form-input"
              type="password"
              data-allow-clipboard
              value={sttKey}
              onChange={(e) => { setSttKey(e.target.value); setSaved(false); }}
              placeholder={hasSttKey ? t("•••••••• (leave blank to keep)") : t("Not set yet")}
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Speech-to-text Model')}</label>
            <input className="form-input" type="text" dir="ltr" value={sttModel} onChange={(e) => { setSttModel(e.target.value); setSaved(false); }} placeholder="Systran/faster-whisper-small" />
          </div>
        </div>
        {error && <p className="text-caption" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          <Icon name="check" size={18} /> {saving ? t('Saving…') : t("Save AI Settings")}
        </button>
      </form>
    </div>
  );
}

