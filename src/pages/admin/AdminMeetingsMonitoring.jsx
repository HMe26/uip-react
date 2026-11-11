import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/meetings-monitoring';
import { ErrorState, Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Round 10 (Admin & Docs) — بند 39 (Admin Monitoring). Talks to
 * GET /api/v1/admin/meetings/monitoring (MeetingsAnalyticsApiController::
 * platformMonitoring() -> MeetingAnalyticsService::platformMonitoring(),
 * uip.admin-gated). Same "StatCard grid" shape as AdminMessagingAnalytics.jsx
 * (the closest existing analogue: a real-time collaboration feature with
 * its own admin-facing usage dashboard), plus a Security Events table —
 * this endpoint deliberately returns counters/aggregates only, never
 * meeting content itself (see that controller's own docblock: "Admins
 * should NOT automatically have access to private meeting content unless
 * the existing UIPE policies explicitly allow it").
 */

const SECURITY_ACTION_LABELS = {
  'meetings.locked': 'Meeting Locked',
  'meetings.participant_removed': 'Participant Removed',
  'meetings.join_failed_wrong_password': 'Wrong Password Attempt',
  'meetings.connection_failure': 'Connection Failure',
};

function StatCard({ label, value, icon }) {
  return (
    <div className="adm-kpi">
      <div className="adm-kpi__top">{label} <Icon name={icon} size={16} /></div>
      <div className="adm-kpi__value">{value}</div>
    </div>
  );
}

export default function AdminMeetingsMonitoring() {
  const t = useTranslations(translations);
  const navigate = useNavigate();
  const [m, setM] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/api/v1/admin/meetings/monitoring')
      .then((json) => setM(json.data || {}))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Skeleton rows={6} cols={4} />;
  if (error) return <ErrorState error={error} />;

  const duration = m.duration_stats || {};
  const failedConnections = m.failed_connections || {};
  const recordings = m.recordings || {};
  const recordingsByStatus = recordings.by_status || {};
  const securityEvents = m.security_events || [];
  const storageMb = Math.round(((recordings.storage_bytes || 0) / 1048576) * 10) / 10;

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Meetings Monitoring')}</h1>
          <p className="text-small">{t('Platform-wide meeting usage and health, across every portal.')}</p>
        </div>
      </div>

      <div className="adm-kpis">
        <StatCard label={t('Active Meetings')} value={m.active_meetings ?? 0} icon="monitor" />
        <StatCard label={t('Active Participants')} value={m.active_participants ?? 0} icon="users" />
        <StatCard label={t('Total Meetings')} value={m.total_meetings ?? 0} icon="calendar" />
        <StatCard label={t('Meetings Today')} value={m.meetings_today ?? 0} icon="trend" />
      </div>

      <div className="adm-kpis">
        <StatCard label={t('Meetings (7 days)')} value={m.meetings_this_week ?? 0} icon="bar-chart" />
        <StatCard label={t('Avg. Duration')} value={duration.average_minutes != null ? `${duration.average_minutes} ${t('min')}` : '—'} icon="clock" />
        <StatCard label={t('Failed Connections Today')} value={failedConnections.today ?? 0} icon="alert" />
        <StatCard label={t('Recordings Storage')} value={`${storageMb} MB`} icon="archive" />
      </div>

      <div className="adm-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <div className="adm-panel">
          <div className="adm-panel__head"><h3>{t('Duration Stats')}</h3></div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <li className="text-small" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{t('Average')}</span>
              <span>{duration.average_minutes != null ? `${duration.average_minutes} ${t('min')}` : '—'}</span>
            </li>
            <li className="text-small" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{t('Longest')}</span>
              <span>{duration.max_minutes != null ? `${duration.max_minutes} ${t('min')}` : '—'}</span>
            </li>
            <li className="text-small" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{t('Completed Meetings Sampled')}</span>
              <span>{duration.sample_size ?? 0}</span>
            </li>
          </ul>
        </div>

        <div className="adm-panel">
          <div className="adm-panel__head"><h3>{t('Recordings by Status')}</h3></div>
          {Object.keys(recordingsByStatus).length === 0 ? (
            <p className="adm-empty">{t('No recordings yet.')}</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {Object.entries(recordingsByStatus).map(([status, count]) => (
                <li key={status} className="text-small" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ textTransform: 'capitalize' }}>{t(status)}</span>
                  <span className="text-mono">{count}</span>
                </li>
              ))}
              <li className="text-small" style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-2)' }}>
                <span>{t('Total Recordings')}</span>
                <span className="text-mono">{recordings.total ?? 0}</span>
              </li>
            </ul>
          )}
        </div>
      </div>

      <div className="adm-panel__head" style={{ marginBottom: 10 }}><h3>{t('Recent Security Events')}</h3></div>
      {securityEvents.length === 0 ? (
        <div className="adm-panel" style={{ textAlign: 'center' }}>
          <p className="adm-empty">{t('No security events recorded.')}</p>
        </div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>{t('Event')}</th>
                <th>{t('Meeting ID')}</th>
                <th>{t('User ID')}</th>
                <th>{t('When')}</th>
              </tr>
            </thead>
            <tbody>
              {securityEvents.map((ev) => (
                <tr key={ev.id} className="mtc-row-click" tabIndex={0} onClick={() => navigate(`/admin/meetings-control/events/${ev.id}`)} onKeyDown={(k) => { if (k.key === 'Enter') navigate(`/admin/meetings-control/events/${ev.id}`); }}>
                  <td><span className="badge badge-warning">{t(SECURITY_ACTION_LABELS[ev.action] || ev.action)}</span></td>
                  <td><span className="text-mono">#{ev.meeting_id ?? '—'}</span></td>
                  <td><span className="text-mono">{ev.user_id ?? '—'}</span></td>
                  <td><span className="adm-muted">{ev.created_at}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
