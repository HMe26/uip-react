import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import Icon from '../../components/Icon';
import { useAuth } from '../../context/AuthContext';
import { useTranslations } from '../../context/LanguageContext';
import { portalPrefix } from '../../config/navConfig';
import i18nCommon from '../../i18n/common';
import i18nMeetings from '../../i18n/shared/meetings';

const translations = { ...i18nCommon, ...i18nMeetings };

const STATUS_META = {
  scheduled: { cls: 'badge-primary', key: 'Scheduled' },
  lobby: { cls: 'badge-warning', key: 'In Lobby' },
  live: { cls: 'badge-success', key: 'Live' },
};

/**
 * Round 1 (Foundation) — GET /api/v1/meetings (MeetingsApiController::
 * index). Self-contained, best-effort card: a failed fetch degrades to
 * hiding the widget rather than breaking the surrounding dashboard, same
 * pattern StudentDashboard.jsx already uses for its separate Exams card
 * (own request, own loading/error state, not merged into the page's main
 * dashboard-stats call). Meetings has no per-role dashboard-stats field of
 * its own yet, so this is intentionally its own request.
 *
 * Shows up to 3 upcoming/live meetings (scheduled, lobby, or live status),
 * soonest first — instant meetings with no scheduled_start_at sort last.
 */
export default function MeetingsDashboardWidget() {
  const t = useTranslations(translations);
  const { user } = useAuth();
  const prefix = portalPrefix(user?.role);
  const [meetings, setMeetings] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/v1/meetings')
      .then((json) => {
        if (cancelled) return;
        const upcoming = (json.data || [])
          .filter((m) => ['scheduled', 'lobby', 'live'].includes(m.status))
          .sort((a, b) => {
            if (!a.scheduled_start_at) return 1;
            if (!b.scheduled_start_at) return -1;
            return new Date(a.scheduled_start_at) - new Date(b.scheduled_start_at);
          })
          .slice(0, 3);
        setMeetings(upcoming);
      })
      .catch(() => setMeetings([]));
    return () => { cancelled = true; };
  }, []);

  if (meetings === null || meetings.length === 0) return null;

  return (
    <div className="card glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="text-h3" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="monitor" size={18} /> {t('Upcoming & Live Meetings')}
        </h2>
        <Link to={`/${prefix}/meetings`} className="text-caption">{t('View All Meetings')}</Link>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {meetings.map((m) => {
          const meta = STATUS_META[m.status] || STATUS_META.scheduled;
          return (
            <li key={m.uuid}>
              <Link
                to={`/${prefix}/meetings/${m.uuid}`}
                className="text-small"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)' }}
              >
                <span style={{ fontWeight: 600 }}>{m.title}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span className="text-caption">
                    {m.scheduled_start_at ? new Date(m.scheduled_start_at).toLocaleString() : t('Opens right away')}
                  </span>
                  <span className={`badge ${meta.cls}`}>{t(meta.key)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
