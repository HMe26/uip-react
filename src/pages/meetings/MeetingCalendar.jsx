import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { calendarApi } from '../../lib/meetingSignaling';
import { useAuth } from '../../context/AuthContext';
import Icon from '../../components/Icon';
import { useTranslations } from '../../context/LanguageContext';
import { portalPrefix } from '../../config/navConfig';
import i18nCommon from '../../i18n/common';
import i18nMeetings from '../../i18n/shared/meetings';

const translations = { ...i18nCommon, ...i18nMeetings };

/**
 * Round 8 (Invitations & Calendar) — بند 14 ("Calendar view: Day, Week,
 * Month"). Talks to the one range-based endpoint
 * (GET /api/v1/meetings/calendar?start=&end=,
 * MeetingsInvitationsApiController::calendar() ->
 * MeetingRepository::calendarForUser()) — the view granularity
 * (day/week/month) is purely a frontend concept: switching it just
 * recomputes `[start, end]` for the same API call and re-fetches. A
 * meeting is placed on whichever day its `scheduled_start_at` falls on,
 * or `started_at` for an instant meeting with no schedule (matches the
 * backend's own OR-filter — see calendarForUser()'s docblock).
 *
 * Kept as its own page/route (`/${role}/meetings/calendar`) rather than a
 * tab bolted onto MyMeetings.jsx, since it needs the entire viewport for
 * a month grid — MyMeetings.jsx links here instead.
 */

const VIEWS = ['day', 'week', 'month'];

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfWeek(d) {
  // الأسبوع بيبدأ السبت (زي باقي التقاويم في المنصة دي) — 6 = Saturday.
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = (day - 6 + 7) % 7;
  return addDays(x, -diff);
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function meetingDate(m) {
  const raw = m.scheduled_start_at || m.started_at;
  return raw ? new Date(raw) : null;
}

const STATUS_META = {
  scheduled: { cls: 'badge-primary', key: 'Scheduled' },
  lobby: { cls: 'badge-warning', key: 'In Lobby' },
  live: { cls: 'badge-success', key: 'Live' },
  ended: { cls: 'badge-neutral', key: 'Ended' },
  cancelled: { cls: 'badge-neutral', key: 'Cancelled' },
};

function MeetingChip({ meeting, prefix }) {
  const meta = STATUS_META[meeting.status] || STATUS_META.scheduled;
  const d = meetingDate(meeting);
  return (
    <Link
      to={`/${prefix}/meetings/${meeting.uuid}`}
      className="text-caption"
      style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px',
        borderRadius: 6, background: 'var(--surface-2, rgba(255,255,255,0.06))',
        textDecoration: 'none', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
      }}
      title={meeting.title}
    >
      <span className={`badge ${meta.cls}`} style={{ width: 6, height: 6, padding: 0, borderRadius: '50%' }} />
      {d && <span>{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{meeting.title}</span>
    </Link>
  );
}

export default function MeetingCalendar() {
  const t = useTranslations(translations);
  const { user } = useAuth();
  const navigate = useNavigate();
  const prefix = portalPrefix(user?.role);

  const [view, setView] = useState('month');
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const range = useMemo(() => {
    if (view === 'day') {
      return { start: startOfDay(anchor), end: addDays(startOfDay(anchor), 1) };
    }
    if (view === 'week') {
      const start = startOfWeek(anchor);
      return { start, end: addDays(start, 7) };
    }
    return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
  }, [view, anchor]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return calendarApi.forRange(isoDate(range.start), isoDate(range.end))
      .then((json) => setMeetings(json.data || []))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);

  function step(delta) {
    if (view === 'day') setAnchor((a) => addDays(a, delta));
    else if (view === 'week') setAnchor((a) => addDays(a, delta * 7));
    else setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + delta, 1));
  }

  const meetingsByDay = useMemo(() => {
    const map = new Map();
    for (const m of meetings) {
      const d = meetingDate(m);
      if (!d) continue;
      const key = isoDate(startOfDay(d));
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(m);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(meetingDate(a)) - new Date(meetingDate(b)));
    }
    return map;
  }, [meetings]);

  const headerLabel = useMemo(() => {
    if (view === 'day') return anchor.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    if (view === 'week') {
      const start = startOfWeek(anchor);
      const end = addDays(start, 6);
      return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }, [view, anchor]);

  // -- Month grid: 6 weeks x 7 days, starting from the Saturday on/before the 1st.
  const monthCells = useMemo(() => {
    if (view !== 'month') return [];
    const gridStart = startOfWeek(startOfMonth(anchor));
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [view, anchor]);

  const weekDays = useMemo(() => {
    if (view !== 'week') return [];
    const start = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [view, anchor]);

  const dayMeetings = useMemo(() => {
    if (view !== 'day') return [];
    return meetingsByDay.get(isoDate(startOfDay(anchor))) || [];
  }, [view, anchor, meetingsByDay]);

  const today = startOfDay(new Date());

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div>
        <Link to={`/${prefix}/meetings`} className="text-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon name="chevron-left" size={14} /> {t('Back to My Meetings')}
        </Link>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div>
          <h1 className="text-h2" style={{ margin: 0 }}>{t('Meeting Calendar')}</h1>
          <p className="text-small" style={{ margin: 'var(--space-1) 0 0', color: 'var(--text-secondary)' }}>{headerLabel}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <div className="tabs" style={{ margin: 0 }}>
            {VIEWS.map((v) => (
              <button key={v} type="button" className={`tab-link${view === v ? ' is-active' : ''}`} onClick={() => setView(v)}>
                {t(v === 'day' ? 'Day' : v === 'week' ? 'Week' : 'Month')}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => step(-1)}>
            <Icon name="chevron-left" size={14} />
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setAnchor(startOfDay(new Date()))}>
            {t('Today')}
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => step(1)}>
            <Icon name="chevron-right" size={14} />
          </button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}
      {loading && <p className="text-small" style={{ color: 'var(--text-secondary)' }}>{t('Loading…')}</p>}

      {!loading && !error && view === 'month' && (
        <div className="card glass-panel" style={{ padding: 'var(--space-3)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {monthCells.slice(0, 7).map((d) => (
              <div key={`h-${d.toISOString()}`} className="text-caption" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '4px 0' }}>
                {d.toLocaleDateString(undefined, { weekday: 'short' })}
              </div>
            ))}
            {monthCells.map((d) => {
              const key = isoDate(d);
              const dayMeetingsList = meetingsByDay.get(key) || [];
              const inMonth = d.getMonth() === anchor.getMonth();
              const isToday = sameDay(d, today);
              const visible = dayMeetingsList.slice(0, 3);
              const extra = dayMeetingsList.length - visible.length;
              return (
                <div
                  key={key}
                  style={{
                    minHeight: 96, borderRadius: 8, padding: 6,
                    background: isToday ? 'var(--surface-2, rgba(255,255,255,0.08))' : 'transparent',
                    border: '1px solid var(--border-subtle, rgba(255,255,255,0.06))',
                    opacity: inMonth ? 1 : 0.4,
                    display: 'flex', flexDirection: 'column', gap: 3,
                  }}
                >
                  <span className="text-caption" style={{ fontWeight: isToday ? 700 : 400 }}>{d.getDate()}</span>
                  {visible.map((m) => <MeetingChip key={m.uuid} meeting={m} prefix={prefix} />)}
                  {extra > 0 && (
                    <span className="text-caption" style={{ color: 'var(--text-secondary)' }}>+{extra} {t('more')}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && !error && view === 'week' && (
        <div className="card glass-panel" style={{ padding: 'var(--space-3)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {weekDays.map((d) => {
              const key = isoDate(d);
              const dayMeetingsList = meetingsByDay.get(key) || [];
              const isToday = sameDay(d, today);
              return (
                <div
                  key={key}
                  style={{
                    minHeight: 200, borderRadius: 8, padding: 6,
                    background: isToday ? 'var(--surface-2, rgba(255,255,255,0.08))' : 'transparent',
                    border: '1px solid var(--border-subtle, rgba(255,255,255,0.06))',
                    display: 'flex', flexDirection: 'column', gap: 4,
                  }}
                >
                  <span className="text-caption" style={{ fontWeight: isToday ? 700 : 400 }}>
                    {d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
                  </span>
                  {dayMeetingsList.map((m) => <MeetingChip key={m.uuid} meeting={m} prefix={prefix} />)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && !error && view === 'day' && (
        <div className="card glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {dayMeetings.length === 0 ? (
            <p className="text-small" style={{ color: 'var(--text-secondary)' }}>{t('No meetings in this range.')}</p>
          ) : (
            dayMeetings.map((m) => {
              const meta = STATUS_META[m.status] || STATUS_META.scheduled;
              const d = meetingDate(m);
              return (
                <div
                  key={m.uuid}
                  className="text-small"
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)',
                    padding: 'var(--space-3)', borderRadius: 8, border: '1px solid var(--border-subtle, rgba(255,255,255,0.06))', cursor: 'pointer',
                  }}
                  onClick={() => navigate(`/${prefix}/meetings/${m.uuid}`)}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{m.title}</div>
                    {d && <div className="text-caption">{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>}
                  </div>
                  <span className={`badge ${meta.cls}`}>{t(meta.key)}</span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
