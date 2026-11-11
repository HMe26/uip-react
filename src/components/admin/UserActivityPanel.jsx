import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import ExportMenu from '../ExportMenu';
import { ConfirmModal } from './adminUi';
import { EmptyState, ErrorState, Skeleton } from './AdminPage';
import { useTranslations } from '../../context/LanguageContext';
import i18nPage from '../../i18n/admin/user-activity';
import { downloadExport } from '../../lib/exportDownload';
import { parseServerDate } from '../../utils/serverDate';

const PER_PAGE = 50;

// type -> [label key, icon, tone]
const TYPES = {
  page_view: ['Page view', 'globe', 'blue'],
  click: ['Click', 'select-all', 'slate'],
  rage_click: ['Rage click', 'alert-triangle', 'amber'],
  form_submit: ['Form submit', 'file-up', 'violet'],
  api_write: ['Data saved / changed', 'check-circle', 'green'],
  api_error: ['Request failed', 'x-circle', 'red'],
  network_error: ['Network error', 'alert-triangle', 'red'],
  js_error: ['JavaScript error', 'x-circle', 'red'],
  auth: ['Sign-in / session', 'info', 'teal'],
  custom: ['Other', 'info', 'slate'],
};

const EMPTY = { q: '', types: [], severity: '', source: '', date_from: '', date_to: '', only_errors: false, session_id: '' };

function localBoundary(v, end) {
  if (!v) return undefined;
  const d = new Date(`${v}T${end ? '23:59:59' : '00:00:00'}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 19).replace('T', ' ');
}

function toParams(f) {
  return {
    q: f.q || undefined,
    type: f.types.length ? f.types.join(',') : undefined,
    severity: f.severity || undefined,
    source: f.source || undefined,
    date_from: localBoundary(f.date_from, false),
    date_to: localBoundary(f.date_to, true),
    only_errors: f.only_errors ? 1 : undefined,
    session_id: f.session_id || undefined,
  };
}

const dt = (v) => (v ? parseServerDate(v) : null);
const fmtTime = (v) => { const d = dt(v); return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''; };
const fmtDateTime = (v) => { const d = dt(v); return d && !Number.isNaN(d.getTime()) ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'; };
const dayKey = (v) => { const d = dt(v); return d && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : ''; };

function fmtDuration(s) {
  const n = Math.max(0, Math.round(s || 0));
  if (n < 60) return `${n}s`;
  const m = Math.floor(n / 60);
  if (m < 60) return `${m}m ${n % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function statusTone(code) {
  if (code == null) return '';
  if (code === 0 || code >= 500) return 'red';
  if (code >= 400) return 'amber';
  return 'green';
}

function Pill({ tone = 'slate', children, title }) {
  return <span className={`uact-pill uact-pill--${tone}`} title={title}>{children}</span>;
}

function DetailRow({ label, children }) {
  if (children === null || children === undefined || children === '') return null;
  return <div className="uact-kv"><small>{label}</small><span>{children}</span></div>;
}

function EventRow({ ev, open, onToggle, onPickSession, t }) {
  const [label, icon, tone] = TYPES[ev.type] || TYPES.custom;
  const sub = [ev.path && ev.type !== 'page_view' ? ev.path : null, ev.type === 'click' || ev.type === 'rage_click' ? null : ev.target].filter(Boolean).join(' · ');
  return (
    <li className={`uact-row uact-row--${ev.severity}${open ? ' is-open' : ''}`}>
      <button type="button" className="uact-row__main" onClick={onToggle} aria-expanded={open}>
        <span className={`uact-ico uact-ico--${tone}`} aria-hidden="true"><Icon name={icon} size={16} /></span>
        <span className="uact-row__body">
          <strong>{ev.title}</strong>
          {(sub || ev.message) && <small>{ev.severity !== 'info' && ev.message ? ev.message : sub}</small>}
        </span>
        <span className="uact-row__meta">
          {ev.status != null && <Pill tone={statusTone(ev.status)}>{ev.status === 0 ? 'ERR' : ev.status}</Pill>}
          {ev.severity !== 'info' && <Pill tone={ev.severity === 'error' ? 'red' : 'amber'}>{t(ev.severity === 'error' ? 'Error' : 'Warning')}</Pill>}
          <Pill tone="muted" title={t('Source')}>{ev.source === 'server' ? t('Server') : t('Browser')}</Pill>
        </span>
        <time className="uact-row__time" dateTime={ev.occurred_at}>{fmtTime(ev.occurred_at)}</time>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
      </button>
      {open && (
        <div className="uact-detail">
          {ev.message && ev.severity !== 'info' && <div className="uact-seen"><small>{t('What the user saw')}</small><p>{ev.message}</p></div>}
          <div className="uact-kvs">
            <DetailRow label={t('Event type')}>{t(label)}</DetailRow>
            <DetailRow label={t('Time')}>{fmtDateTime(ev.occurred_at)}</DetailRow>
            <DetailRow label={t('Page')}>{ev.path}</DetailRow>
            <DetailRow label={t('Element')}>{ev.target}</DetailRow>
            <DetailRow label={t('Request')}>{ev.method ? `${ev.method} ${ev.url || ''}` : null}</DetailRow>
            <DetailRow label={t('Endpoint')}>{ev.endpoint}</DetailRow>
            <DetailRow label={t('Status')}>{ev.status}</DetailRow>
            <DetailRow label={t('Duration')}>{ev.duration_ms != null ? `${ev.duration_ms} ms` : null}</DetailRow>
            <DetailRow label={t('IP address')}>{ev.ip}</DetailRow>
            <DetailRow label={t('Device')}>{[ev.device, ev.browser].filter(Boolean).join(' · ')}</DetailRow>
            <DetailRow label={t('Visit')}>
              {ev.session_id ? <button type="button" className="uact-link" onClick={() => onPickSession(ev.session_id)}>{ev.session_id.slice(0, 8)} — {t('Filter to this visit')}</button> : null}
            </DetailRow>
          </div>
          {ev.details && (
            <details className="uact-json">
              <summary>{t('Technical details')}</summary>
              <pre>{JSON.stringify(ev.details, null, 2)}</pre>
            </details>
          )}
          {ev.user_agent && <p className="uact-ua">{ev.user_agent}</p>}
        </div>
      )}
    </li>
  );
}

function DayChart({ days, t }) {
  const max = Math.max(1, ...days.map((d) => d.events));
  return (
    <div className="uact-chart" role="img" aria-label={t('Activity in the last 14 days')}>
      {days.map((d) => (
        <div key={d.date} className="uact-chart__col" title={`${d.date}: ${d.events} ${t('events')}${d.errors ? `, ${d.errors} ${t('errors')}` : ''}`}>
          <div className="uact-chart__bar" style={{ height: `${Math.max(d.events ? 6 : 2, Math.round((d.events / max) * 100))}%` }}>
            {d.errors > 0 && <i style={{ height: `${Math.round((d.errors / d.events) * 100)}%` }} />}
          </div>
          <small>{d.date.slice(8)}</small>
        </div>
      ))}
    </div>
  );
}

function TopList({ title, rows, render }) {
  return (
    <section className="uact-card">
      <h4>{title}</h4>
      {rows?.length ? <ul className="uact-top">{rows.map((r, i) => <li key={i}>{render(r)}</li>)}</ul> : <p className="uact-muted">—</p>}
    </section>
  );
}

export default function UserActivityPanel({ user }) {
  const t = useTranslations(i18nPage);
  const { uuid } = useParams();
  const base = `/api/v1/admin/users/${uuid || user.uuid || user.id}/activity`;

  const [view, setView] = useState('timeline');
  const [filters, setFilters] = useState(EMPTY);
  const [qInput, setQInput] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [summary, setSummary] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const [live, setLive] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [tick, setTick] = useState(0);
  const firstLoad = useRef(true);

  // debounce the search box
  useEffect(() => {
    const id = setTimeout(() => { setFilters((f) => (f.q === qInput ? f : { ...f, q: qInput })); setPage(1); }, 350);
    return () => clearTimeout(id);
  }, [qInput]);

  const params = useMemo(() => toParams(filters), [filters]);
  const paramsKey = JSON.stringify(params);

  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [list, sum, ses] = await Promise.all([
        api.get(base, { ...params, page, per_page: PER_PAGE }),
        api.get(`${base}/summary`, params),
        view === 'sessions' ? api.get(`${base}/sessions`, params) : Promise.resolve(null),
      ]);
      setRows(list.data || []);
      setTotal(list.meta?.total ?? 0);
      setEnabled(list.meta?.enabled !== false);
      setSummary(sum.data || null);
      if (ses) setSessions(ses.data || []);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
      firstLoad.current = false;
    }
  }, [base, paramsKey, page, view]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(!firstLoad.current && tick > 0); }, [load, tick]);

  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 10000);
    return () => clearInterval(id);
  }, [live]);

  const setF = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const toggleType = (k) => setF({ types: filters.types.includes(k) ? filters.types.filter((x) => x !== k) : [...filters.types, k] });
  const reset = () => { setQInput(''); setFilters(EMPTY); setPage(1); };
  const hasFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY);
  const pickSession = (sid) => { setF({ session_id: sid }); setView('timeline'); };

  const toggleOpen = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function handleExport(format) {
    setExporting(true);
    try {
      await downloadExport(`${base}/export`, { params, format, filename: `user-activity-${(user.email || user.id || '').toString().split('@')[0]}-${new Date().toISOString().slice(0, 10)}`, title: t('Activity timeline') });
    } catch {
      alert(t('Export failed. Please try again.'));
    } finally {
      setExporting(false);
    }
  }

  async function clearAll() {
    setClearing(true);
    try {
      await api.delete(base);
      setConfirmClear(false);
      reset();
      setTick((n) => n + 1);
    } catch (e) {
      alert(errorMessage(e) || t('Could not clear the history.'));
    } finally {
      setClearing(false);
    }
  }

  // group the page of events by local day
  const groups = useMemo(() => {
    const out = [];
    rows.forEach((r) => {
      const k = dayKey(r.occurred_at);
      const last = out[out.length - 1];
      if (last && last.key === k) last.items.push(r); else out.push({ key: k, at: r.occurred_at, items: [r] });
    });
    return out;
  }, [rows]);

  const dayLabel = (g) => {
    const y = new Date(); y.setDate(y.getDate() - 1);
    const d = dt(g.at);
    const full = d ? d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : g.key;
    if (g.key === dayKey(new Date())) return `${t('Today')} — ${full}`;
    if (g.key === dayKey(y)) return `${t('Yesterday')} — ${full}`;
    return full;
  };

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const bySev = summary?.by_severity || {};
  const byType = summary?.by_type || {};
  const noDataAtAll = !loading && !error && !hasFilters && (summary?.total ?? 0) === 0;

  return (
    <div className="uact">
      <div className="adm-panel uact-head">
        <div className="adm-panel__head">
          <div><h3>{t('Activity timeline')}</h3><p>{t('Everything this person did: pages opened, buttons clicked, forms sent, requests made and every error they hit.')}</p></div>
          <div className="uact-actions">
            <button type="button" className={`btn btn-outline btn-sm uact-live${live ? ' is-on' : ''}`} onClick={() => setLive((v) => !v)} aria-pressed={live}><i aria-hidden="true" />{t('Live')}</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setTick((n) => n + 1)}>{t('Refresh')}</button>
            <ExportMenu iconSize={16} busy={exporting} onExport={handleExport} />
            <button type="button" className="btn btn-outline btn-sm uact-danger" onClick={() => setConfirmClear(true)}><Icon name="trash" size={14} /> {t('Clear history')}</button>
            <Link to="/admin/audit-logs" className="btn btn-outline btn-sm">{t('Open audit log')}</Link>
          </div>
        </div>
        {!enabled && <p className="uact-warn" role="alert"><Icon name="alert-triangle" size={14} /> {t('Tracking is switched off on the server (ACTIVITY_LOG_ENABLED).')}</p>}

        <div className="uact-kpis">
          <div className="uact-kpi"><small>{t('Events')}</small><strong>{(summary?.total ?? 0).toLocaleString()}</strong></div>
          <div className="uact-kpi uact-kpi--red"><small>{t('Errors')}</small><strong>{(bySev.error ?? 0).toLocaleString()}</strong></div>
          <div className="uact-kpi uact-kpi--amber"><small>{t('Warnings')}</small><strong>{(bySev.warning ?? 0).toLocaleString()}</strong></div>
          <div className="uact-kpi"><small>{t('Visits')}</small><strong>{(summary?.sessions ?? 0).toLocaleString()}</strong></div>
          <div className="uact-kpi"><small>{t('Last seen')}</small><strong className="uact-kpi__sm">{fmtDateTime(summary?.last_at)}</strong></div>
        </div>
      </div>

      <div className="adm-panel uact-filters">
        <div className="uact-filters__row">
          <label className="uact-search">
            <Icon name="search" size={16} />
            <input type="search" className="form-input" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder={t('Search events, pages, buttons, error text…')} />
          </label>
          <select className="form-input" value={filters.severity} onChange={(e) => setF({ severity: e.target.value })} aria-label={t('Severity')}>
            <option value="">{t('All severities')}</option>
            <option value="info">{t('Info')}</option>
            <option value="warning">{t('Warning')}</option>
            <option value="error">{t('Error')}</option>
          </select>
          <select className="form-input" value={filters.source} onChange={(e) => setF({ source: e.target.value })} aria-label={t('Source')}>
            <option value="">{t('Browser + server')}</option>
            <option value="client">{t('Browser')}</option>
            <option value="server">{t('Server')}</option>
          </select>
          <label className="uact-date"><small>{t('From')}</small><input type="date" className="form-input" value={filters.date_from} max={filters.date_to || undefined} onChange={(e) => setF({ date_from: e.target.value })} /></label>
          <label className="uact-date"><small>{t('To')}</small><input type="date" className="form-input" value={filters.date_to} min={filters.date_from || undefined} onChange={(e) => setF({ date_to: e.target.value })} /></label>
        </div>
        <div className="uact-types" role="group" aria-label={t('Event type')}>
          <button type="button" className={`uact-chip${filters.only_errors ? ' is-on uact-chip--red' : ''}`} aria-pressed={filters.only_errors} onClick={() => setF({ only_errors: !filters.only_errors })}>
            <Icon name="alert-triangle" size={13} /> {t('Only problems')}
          </button>
          {Object.entries(TYPES).map(([k, [label, icon]]) => (
            <button key={k} type="button" className={`uact-chip${filters.types.includes(k) ? ' is-on' : ''}`} aria-pressed={filters.types.includes(k)} onClick={() => toggleType(k)}>
              <Icon name={icon} size={13} /> {t(label)}{byType[k] ? <b>{byType[k]}</b> : null}
            </button>
          ))}
          {hasFilters && <button type="button" className="uact-chip uact-chip--reset" onClick={reset}><Icon name="x" size={13} /> {t('Reset filters')}</button>}
        </div>
        {filters.session_id && (
          <p className="uact-session-note"><Icon name="info" size={14} /> {t('Showing a single visit.')} <code>{filters.session_id.slice(0, 8)}</code>
            <button type="button" className="uact-link" onClick={() => setF({ session_id: '' })}>{t('Show all visits')}</button></p>
        )}
      </div>

      <div className="uact-tabs" role="tablist">
        {[['timeline', 'Timeline'], ['sessions', 'Visits (sessions)'], ['insights', 'Insights']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'is-active' : ''} onClick={() => setView(k)}>{t(label)}</button>
        ))}
      </div>

      {loading && <Skeleton rows={8} cols={4} />}
      {error && <ErrorState error={error} onRetry={() => load(false)} />}

      {!loading && !error && view === 'timeline' && (
        <div className="adm-panel uact-list">
          {noDataAtAll && <EmptyState icon="clock" title={t('No activity has been recorded for this user yet. Events appear here as soon as the person uses the platform.')} />}
          {!noDataAtAll && rows.length === 0 && <EmptyState icon="filter" title={t('No activity matches these filters.')} />}
          {groups.map((g) => (
            <section key={`${g.key}-${g.items[0].id}`} className="uact-day">
              <h4>{dayLabel(g)} <span>{g.items.length}</span></h4>
              <ul>
                {g.items.map((ev) => <EventRow key={ev.id} ev={ev} t={t} open={open.has(ev.id)} onToggle={() => toggleOpen(ev.id)} onPickSession={pickSession} />)}
              </ul>
            </section>
          ))}
          {totalPages > 1 && (
            <nav className="uact-pager" aria-label="pagination">
              <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>{t('Previous')}</button>
              <span>{t('Page {n} of {total}').replace('{n}', page).replace('{total}', totalPages)} · {total.toLocaleString()} {t('events')}</span>
              <button type="button" className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>{t('Next')}</button>
            </nav>
          )}
        </div>
      )}

      {!loading && !error && view === 'sessions' && (
        <div className="adm-panel uact-list">
          {sessions.length === 0 && <EmptyState icon="clock" title={t('Nothing recorded yet.')} />}
          <ul className="uact-sessions">
            {sessions.map((s) => (
              <li key={s.session_id} className="uact-session">
                <div className="uact-session__main">
                  <strong>{fmtDateTime(s.started_at)}</strong>
                  <small>{[s.device, s.browser, s.ip].filter(Boolean).join(' · ')}</small>
                  {s.entry_page && <small>{t('Entry page')}: <code>{s.entry_page}</code></small>}
                </div>
                <div className="uact-session__stats">
                  <span><b>{s.events}</b> {t('events')}</span>
                  <span><b>{s.pages}</b> {t('pages')}</span>
                  <span><b>{fmtDuration(s.duration_s)}</b> {t('Length')}</span>
                  {s.errors > 0 && <Pill tone="red">{s.errors} {t('errors')}</Pill>}
                  {s.warnings > 0 && <Pill tone="amber">{s.warnings} {t('Warnings')}</Pill>}
                </div>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => pickSession(s.session_id)}>{t('View events')}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loading && !error && view === 'insights' && summary && (
        <div className="uact-insights">
          <section className="uact-card uact-card--wide"><h4>{t('Activity in the last 14 days')}</h4><DayChart days={summary.per_day || []} t={t} /></section>
          <TopList title={t('Most visited pages')} rows={summary.top_pages} render={(r) => <><code>{r.path}</code><b>{r.count}</b></>} />
          <TopList title={t('Most clicked elements')} rows={summary.top_clicks} render={(r) => <><span>{r.target}</span><b>{r.count}</b></>} />
          <TopList title={t('Most frequent errors')} rows={summary.top_errors} render={(r) => <><span className="uact-err">{r.message}<small>{fmtDateTime(r.last_at)}</small></span><b>{r.count}</b></>} />
          <TopList title={t('Devices & browsers')} rows={summary.devices} render={(r) => <><span>{[r.device, r.browser].filter(Boolean).join(' · ')}<small>{fmtDateTime(r.last_at)}</small></span><b>{r.count}</b></>} />
          <TopList title={t('IP addresses')} rows={summary.ips} render={(r) => <><code>{r.ip}</code><small>{fmtDateTime(r.last_at)}</small><b>{r.count}</b></>} />
        </div>
      )}

      {confirmClear && (
        <ConfirmModal danger busy={clearing} title={t("Clear this user's activity history?")}
          message={t('This permanently deletes every recorded event for this account. The action itself is written to the audit log.')}
          confirmLabel={t('Delete history')} onConfirm={clearAll} onClose={() => setConfirmClear(false)} />
      )}
    </div>
  );
}
