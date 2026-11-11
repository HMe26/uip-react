import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/data-analysis/workspace';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/data-analysis/workspace.php, talking to the real JSON
 * API (app/Controllers/Api/DataAnalysisWorkspaceApiController.php,
 * /api/v1/data-analysis/workspace — new, thin wrapper reusing
 * App\Services\TeamWorkspaceService exactly as the server-rendered view
 * already does — see that service's docblock: no new table, composed
 * from SavedDashboardService/MessagingService/
 * DataAnalysisReportFileRepository/DataAnalysisCollaborationService/
 * AuditLogService).
 */
export default function DataAnalysisWorkspace() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/api/v1/data-analysis/workspace')
      .then((json) => setData(json.data))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-small">{t('Loading…')}</p>;
  if (error) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;

  const stats = data?.stats || { teammates: 0, shared_dashboards: 0, active_reports: 0 };
  const teammates = data?.teammates || [];
  const shared = data?.shared_dashboards || [];
  const messages = data?.recent_messages || [];
  const activity = data?.activity || [];

  const timeAgo = (iso) => {
    if (!iso) return '';
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return locale === 'ar' ? 'الآن' : 'just now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Team Workspace')}</h1>
        </div>
        <Link to="/data-analysis/messages" className="btn btn-primary btn-sm">
          <Icon name="message" size={16} /> {t('New Message')}
        </Link>
      </div>

      <div className="grid-3" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="card glass-panel">
          <p className="text-caption">{t('Teammates')}</p>
          <p className="text-h1" style={{ margin: 0, color: 'var(--uip-indigo-600)' }}>{stats.teammates}</p>
        </div>
        <div className="card glass-panel">
          <p className="text-caption">{t('Shared Dashboards')}</p>
          <p className="text-h1" style={{ margin: 0, color: 'var(--uip-teal-600)' }}>{stats.shared_dashboards}</p>
        </div>
        <div className="card glass-panel">
          <p className="text-caption">{t('Active Report Files')}</p>
          <p className="text-h1" style={{ margin: 0, color: 'var(--uip-gold-600)' }}>{stats.active_reports}</p>
        </div>
      </div>

      <div className="grid-2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <div className="card glass-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
              <h2 className="text-h3" style={{ margin: 0 }}>{t('Dashboards Shared with the Team')}</h2>
              <Link to="/data-analysis/dashboards" className="text-caption">{t('View all')}</Link>
            </div>
            {shared.length ? shared.slice(0, 6).map((d) => (
              <Link
                key={d.id}
                to={`/data-analysis/dashboards/${d.id}`}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-subtle)', textDecoration: 'none', color: 'inherit' }}
              >
                <span className="text-small">{d.name}</span>
                <span className="text-caption">{d.owner_name || ''}</span>
              </Link>
            )) : <p className="text-caption">{t('No shared dashboards yet.')}</p>}
          </div>

          <div className="card glass-panel">
            <h2 className="text-h3" style={{ marginBottom: 'var(--space-4)' }}>{t('Team Members')}</h2>
            {teammates.length ? teammates.map((mm) => (
              <div key={mm.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--glass-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name="user" size={16} />
                </div>
                <span className="text-small">{mm.full_name}</span>
              </div>
            )) : <p className="text-caption">{t("You're currently the only member of this team.")}</p>}
          </div>

          <div className="card glass-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
              <h2 className="text-h3" style={{ margin: 0 }}>{t('Recent Messages')}</h2>
              <Link to="/data-analysis/messages" className="text-caption">{t('All messages')}</Link>
            </div>
            {messages.length ? messages.map((m) => (
              <Link
                key={m.id}
                to="/data-analysis/messages"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-subtle)', textDecoration: 'none', color: 'inherit' }}
              >
                <div style={{ minWidth: 0 }}>
                  <p className="text-small" style={{ margin: 0, fontWeight: m.is_unread ? 700 : 400 }}>{m.subject}</p>
                  {m.preview && <span className="text-caption" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.preview}</span>}
                </div>
                {m.is_unread && <span className="badge badge-primary">{t('New')}</span>}
              </Link>
            )) : <p className="text-caption">{t('No messages yet.')}</p>}
          </div>
        </div>

        <aside>
          <div className="card glass-panel">
            <h2 className="text-h3" style={{ marginBottom: 'var(--space-1)' }}>{t('Activity Timeline')}</h2>
            {activity.length ? activity.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-primary)', marginTop: 6, flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <p className="text-small" style={{ margin: 0 }}>
                    <strong>{a.actor?.[locale] || a.actor?.en}</strong>{' '}
                    {String(a.action?.[locale] || a.action?.en || '').replace(/[_.]/g, ' ')}
                  </p>
                  <span className="text-caption">{timeAgo(a.time)}</span>
                </div>
              </div>
            )) : <p className="text-caption">{t('No activity yet.')}</p>}
          </div>
        </aside>
      </div>
    </>
  );
}
