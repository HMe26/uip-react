import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BackLink } from '../../lib/backStack';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { ConfirmModal } from '../../components/admin/adminUi';

import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/messaging-settings';
import { Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/admin/messaging-settings.php, talking to the real
 * JSON API (AdminMessagingOversightApiController::settings()/
 * updateUploadSettings()/updateRetentionSettings()/updatePortalToggle()
 * — reuses the exact same MessagingPolicyService calls the Blade view
 * already made).
 */

const PORTAL_LABELS = {
  student: 'Student Portal',
  university: 'University Portal',
  security: 'Security Portal',
  data_analyst: 'Data Analysis Portal',
  faculty: 'Faculty Portal',
};

export default function AdminMessagingSettings() {
  const t = useTranslations(translations);
  const [uploadPolicy, setUploadPolicy] = useState({ max_kb: 10240, restrict_extensions: false, allowed_extensions: '' });
  const [retentionPolicy, setRetentionPolicy] = useState({ retention_days: 0, auto_cleanup_enabled: false });
  const [toggles, setToggles] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [savingUpload, setSavingUpload] = useState(false);
  const [savingRetention, setSavingRetention] = useState(false);
  const [togglingKey, setTogglingKey] = useState(null);
  const [confirmDisable, setConfirmDisable] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/admin/messaging/settings')
      .then((json) => {
        const d = json.data || {};
        setUploadPolicy({ max_kb: 10240, restrict_extensions: false, allowed_extensions: '', ...(d.upload_policy || {}) });
        setRetentionPolicy({ retention_days: 0, auto_cleanup_enabled: false, ...(d.retention_policy || {}) });
        setToggles(d.portal_toggles || {});
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveUpload(e) {
    e.preventDefault();
    setSavingUpload(true);
    setActionError(null);
    try {
      const res = await api.patch('/api/v1/admin/messaging/settings/upload', {
        max_kb: Number(uploadPolicy.max_kb),
        restrict_extensions: uploadPolicy.restrict_extensions,
        allowed_extensions: uploadPolicy.allowed_extensions,
      });
      setUploadPolicy((p) => ({ ...p, ...(res.data || {}) }));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSavingUpload(false);
    }
  }

  async function saveRetention(e) {
    e.preventDefault();
    setSavingRetention(true);
    setActionError(null);
    try {
      const res = await api.patch('/api/v1/admin/messaging/settings/retention', {
        retention_days: Number(retentionPolicy.retention_days),
        auto_cleanup_enabled: retentionPolicy.auto_cleanup_enabled,
      });
      setRetentionPolicy((p) => ({ ...p, ...(res.data || {}) }));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSavingRetention(false);
    }
  }

  async function togglePortal(key, currentlyEnabled) {
    setTogglingKey(key);
    setActionError(null);
    try {
      await api.post(`/api/v1/admin/messaging/settings/portal/${key}`, { enabled: currentlyEnabled ? 0 : 1 });
      setToggles((t) => ({ ...t, [key]: !currentlyEnabled }));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setTogglingKey(null);
    }
  }

  if (loading) return <Skeleton rows={6} cols={4} />;

  return (
    <>
      <BackLink to="/admin/messaging/oversight" className="adm-link-back"><Icon name="chevron-left" size={14} /> {t('Messaging Oversight')}</BackLink>

      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Messaging Settings')}</h1>
          <p className="text-small">{t('Upload limits, retention policy, and per-portal enable/disable.')}</p>
        </div>
      </div>

      <Link to="/admin/messaging/media" className="btn btn-outline" style={{ marginBottom: 16 }}>
        <Icon name="image" size={16} /> Chat Media (GIFs &amp; Stickers) / وسائط الشات
      </Link>

      {error && <p className="form-error">{error}</p>}
      {actionError && <p className="form-error">{actionError}</p>}

      {/* Upload limits */}
      <div className="adm-panel" style={{ marginBottom: 16 }}>
        <h2 className="text-h3" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
          <Icon name="upload" size={18} /> {t('Message Attachment Upload Limits')}
        </h2>
        <p className="text-caption" style={{ marginBottom: 'var(--space-4)' }}>
          {t('This overrides the platform-wide Security Policies default specifically for message attachments. Leave it as-is to keep using the general upload policy.')}
        </p>
        <form onSubmit={saveUpload}>
          <div className="grid-2" style={{ gap: 'var(--space-4)' }}>
            <div className="form-group">
              <label className="text-small" style={{ fontWeight: 600 }}>{t('Maximum attachment size (KB)')}</label>
              <input
                type="number" min="1" max="512000" className="form-input"
                value={uploadPolicy.max_kb}
                onChange={(e) => setUploadPolicy((p) => ({ ...p, max_kb: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="text-small" style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <input
                  type="checkbox"
                  checked={!!uploadPolicy.restrict_extensions}
                  onChange={(e) => setUploadPolicy((p) => ({ ...p, restrict_extensions: e.target.checked }))}
                />
                {t('Restrict allowed file types')}
              </label>
              <input
                type="text" className="form-input" placeholder="pdf, docx, jpg, mp4, zip..."
                value={uploadPolicy.allowed_extensions}
                onChange={(e) => setUploadPolicy((p) => ({ ...p, allowed_extensions: e.target.value }))}
              />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" style={{ marginTop: 'var(--space-4)' }} disabled={savingUpload}>
            <Icon name="check" size={16} /> {savingUpload ? t('Saving…') : t('Save')}
          </button>
        </form>
      </div>

      {/* Retention */}
      <div className="adm-panel" style={{ marginBottom: 16 }}>
        <h2 className="text-h3" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
          <Icon name="archive" size={18} /> {t('Message Retention & Automatic Cleanup')}
        </h2>
        <p className="text-caption" style={{ marginBottom: 'var(--space-4)' }}>
          {t('When enabled, messages older than the period below are permanently deleted platform-wide, automatically (runs via a scheduled cron job).')}
        </p>
        <form onSubmit={saveRetention}>
          <div className="grid-2" style={{ gap: 'var(--space-4)' }}>
            <div className="form-group">
              <label className="text-small" style={{ fontWeight: 600 }}>{t('Retention period in days (0 = forever)')}</label>
              <input
                type="number" min="0" max="3650" className="form-input"
                value={retentionPolicy.retention_days}
                onChange={(e) => setRetentionPolicy((p) => ({ ...p, retention_days: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="text-small" style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-5)' }}>
                <input
                  type="checkbox"
                  checked={!!retentionPolicy.auto_cleanup_enabled}
                  onChange={(e) => setRetentionPolicy((p) => ({ ...p, auto_cleanup_enabled: e.target.checked }))}
                />
                {t('Enable automatic cleanup')}
              </label>
            </div>
          </div>
          <button type="submit" className="btn btn-primary" style={{ marginTop: 'var(--space-4)' }} disabled={savingRetention}>
            <Icon name="check" size={16} /> {savingRetention ? t('Saving…') : t('Save')}
          </button>
        </form>
      </div>

      {/* Per-portal toggles */}
      <div className="adm-panel">
        <h2 className="text-h3" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
          <Icon name="grid" size={18} /> {t('Enable / Disable Messaging Per Portal')}
        </h2>
        <p className="text-caption" style={{ marginBottom: 'var(--space-4)' }}>
          {t('Disabling a portal immediately blocks all messaging interaction (read and send) for its users. The Admin portal itself cannot be disabled.')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {Object.entries(PORTAL_LABELS).map(([key, label]) => {
            const enabled = toggles[key] ?? true;
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--st-radius-sm)', background: 'var(--bg-muted)' }}>
                <span className="text-small" style={{ fontWeight: 600 }}>{t(label)}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <span className={`badge ${enabled ? 'badge-success' : 'badge-danger'}`}>{enabled ? t('Enabled') : t('Disabled')}</span>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={togglingKey === key}
                    onClick={() => (enabled ? setConfirmDisable({ key, label }) : togglePortal(key, enabled))}
                  >
                    {enabled ? t('Disable') : t('Enable')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {confirmDisable && (
        <ConfirmModal
          title={t('Confirm action')}
          message={t('Disable messaging for the {label}? Its users will immediately lose read and send access.').replace('{label}', confirmDisable.label)}
          confirmLabel={t('Disable')}
          danger
          busy={togglingKey === confirmDisable.key}
          onConfirm={async () => { await togglePortal(confirmDisable.key, true); setConfirmDisable(null); }}
          onClose={() => setConfirmDisable(null)}
        />
      )}
    </>
  );
}
