import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations } from '../../context/LanguageContext';
import i18nPage from '../../i18n/admin/ai-assistant-settings';
import { ErrorState, Skeleton } from '../../components/admin/AdminPage';

/**
 * Admin AI Controls (spec section 11) — Platform Admin only.
 * Talks to the real JSON API (app/Controllers/Admin/AiAssistantSettingsController.php,
 * routes/api.php '/admin/ai-assistant-settings' group). This section had a
 * controller + service + routes but no PHP view and no React page at all —
 * built here for the first time, straight from AiAssistantService::adminSettings()
 * / updateAdminSettings() / AiAssistantRepository::usageSummary(). Every field
 * name, default, and validation range below (temperature 0-2, max_tokens
 * 64-8000, rate_limit_per_min >= 1, retention_days 0 = keep forever) comes
 * straight from that service — nothing here is invented. This is deliberately
 * separate from AdminSettings.jsx's ai_enabled/ai_base_url/ai_api_key/ai_model
 * fields (the base AI connection), which that controller does not duplicate.
 */

const CARD = { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' };

// The portals the AI Assistant can be reached from (config/roles.php
// 'available' list) — used only to let the admin pick which portal a
// custom system-prompt override applies to.
const PORTALS = [
  'student', 'university', 'admin',
  'security_admin', 'security_officer', 'data_analyst',
  'supervisor', 'academic_staff', 'faculty',
];

export default function AdminAiAssistantSettings() {
  const t = useTranslations(i18nPage);
  const [settings, setSettings] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function loadSettings() {
    return api.get('/api/v1/admin/ai-assistant-settings').then((json) => setSettings(json.data));
  }
  function loadAnalytics(d) {
    return api.get('/api/v1/admin/ai-assistant-settings/analytics', { days: d })
      .then((json) => setAnalytics(json.data));
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([loadSettings(), loadAnalytics(days)])
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loading) return;
    loadAnalytics(days).catch((err) => setError(errorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  function set(field, value) {
    setSettings((s) => ({ ...s, [field]: value }));
  }

  function setPortalPrompt(portal, value) {
    setSettings((s) => ({ ...s, portal_prompts: { ...(s.portal_prompts || {}), [portal]: value } }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // Backend route is registered as PUT '/' (routes/api.php, the
      // /admin/ai-assistant-settings group) — api/client.js's put() was
      // added for this page since no other admin page needed it yet.
      const json = await api.put('/api/v1/admin/ai-assistant-settings', settings);
      setSettings(json.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Skeleton rows={6} cols={4} />;
  if (error && !settings) return <ErrorState error={error} />;
  if (!settings) return null;

  const totals = analytics?.totals || {};
  const byPortal = analytics?.by_portal || [];

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('AI Assistant Settings')}</h1>
          <p className="text-small">{t('Behavior, limits, and usage analytics for the AI Assistant chat, platform-wide.')}</p>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      <form onSubmit={handleSave} className="adm-panel" style={CARD}>
        <h2 className="text-h3" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Icon name="sparkles" size={18} /> {t('Behavior & Limits')}
        </h2>

        <div className="grid-2" style={{ gap: 'var(--space-4)' }}>
          <div className="form-group">
            <label className="text-small" style={{ fontWeight: 600 }}>{t('Temperature (0–2)')}</label>
            <input
              type="number" min="0" max="2" step="0.1" className="form-input"
              value={settings.temperature}
              onChange={(e) => set('temperature', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="text-small" style={{ fontWeight: 600 }}>{t('Max tokens (64–8000)')}</label>
            <input
              type="number" min="64" max="8000" className="form-input"
              value={settings.max_tokens}
              onChange={(e) => set('max_tokens', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="text-small" style={{ fontWeight: 600 }}>{t('Rate limit (requests / minute)')}</label>
            <input
              type="number" min="1" className="form-input"
              value={settings.rate_limit_per_min}
              onChange={(e) => set('rate_limit_per_min', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="text-small" style={{ fontWeight: 600 }}>{t('Conversation retention (days, 0 = keep forever)')}</label>
            <input
              type="number" min="0" className="form-input"
              value={settings.retention_days}
              onChange={(e) => set('retention_days', e.target.value)}
            />
          </div>
        </div>

        <div className="form-group">
          <label className="text-small" style={{ fontWeight: 600 }}>{t('Allowed attachment file extensions (comma-separated)')}</label>
          <input
            type="text" className="form-input" placeholder={t('pdf, docx, png, jpg')}
            value={(settings.allowed_extensions || []).join(', ')}
            onChange={(e) => set('allowed_extensions', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
          />
        </div>

        <div className="form-group">
          <label className="text-small" style={{ fontWeight: 600 }}>{t('Global system prompt')}</label>
          <textarea
            className="form-input" rows={4}
            value={settings.system_prompt}
            onChange={(e) => set('system_prompt', e.target.value)}
          />
        </div>

        <label className="text-small" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={!!settings.logging_enabled}
            onChange={(e) => set('logging_enabled', e.target.checked)}
          />
          {t('Log usage (calls, tokens, errors) for analytics below')}
        </label>

        <div>
          <h3 className="text-h4" style={{ marginBottom: 'var(--space-2)' }}>{t('Per-portal instructions (optional)')}</h3>
          <p className="text-caption" style={{ marginBottom: 'var(--space-3)' }}>
            {t("Extra instructions appended to the assistant's prompt only when a user is chatting from that portal.")}
          </p>
          <div className="grid-2" style={{ gap: 'var(--space-3)' }}>
            {PORTALS.map((portal) => (
              <div className="form-group" key={portal}>
                <label className="text-small" style={{ fontWeight: 600 }}>{t(portal)}</label>
                <textarea
                  className="form-input" rows={2}
                  value={settings.portal_prompts?.[portal] || ''}
                  onChange={(e) => setPortalPrompt(portal, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <Icon name="check" size={16} /> {saving ? t('Saving…') : t('Save Settings')}
          </button>
          {saved && (
            <span className="badge badge-success">
              <Icon name="check-circle" size={12} /> {t('Saved')}
            </span>
          )}
        </div>
      </form>

      <div className="adm-panel" style={{ ...CARD, marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <h2 className="text-h3" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Icon name="chart" size={18} /> {t('Usage Analytics')}
          </h2>
          <select className="form-input" style={{ width: 'auto' }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>{t('Last 7 days')}</option>
            <option value={30}>{t('Last 30 days')}</option>
            <option value={90}>{t('Last 90 days')}</option>
            <option value={365}>{t('Last 365 days')}</option>
          </select>
        </div>

        <div className="adm-kpis" style={{ marginBottom: 0 }}>
          <Stat label={t('Total calls')} value={totals.total_calls} />
          <Stat label={t('Active users')} value={totals.active_users} />
          <Stat label={t('Prompt tokens')} value={totals.prompt_tokens} />
          <Stat label={t('Completion tokens')} value={totals.completion_tokens} />
          <Stat label={t('Errors')} value={totals.error_count} />
        </div>

        <div>
          <h3 className="text-h4" style={{ marginBottom: 'var(--space-2)' }}>{t('By portal')}</h3>
          {byPortal.length === 0 ? (
            <p className="text-small">{t('No usage recorded for this period.')}</p>
          ) : (
            <div className="adm-table-wrap"><table className="adm-table">
              <thead>
                <tr><th>{t('Portal')}</th><th>{t('Calls')}</th><th>{t('Tokens')}</th></tr>
              </thead>
              <tbody>
                {byPortal.map((row) => (
                  <tr key={row.portal}>
                    <td>{t(row.portal)}</td>
                    <td>{row.calls}</td>
                    <td>{row.tokens}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div className="adm-kpi">
      <div className="adm-kpi__top">{label}</div>
      <div className="adm-kpi__value">{Number(value ?? 0).toLocaleString()}</div>
    </div>
  );
}
