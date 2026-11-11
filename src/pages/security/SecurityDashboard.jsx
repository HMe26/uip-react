import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { PageHead, SecKpi, SevBadge, FilterSelect, EmptyState, ErrorNote, useGreeting, fmtDateTime, tl } from '../../components/security/ui';
import { ActivityChart, SeverityDonut } from '../../components/security/charts';
import i18nCommon from '../../i18n/common';
import i18nSecurity from '../../i18n/security/common';
import i18nPage from '../../i18n/security/dashboard';
import i18nDesign from '../../i18n/security/design';
import { parseServerDate } from '../../utils/serverDate';

const translations = { ...i18nCommon, ...i18nSecurity, ...i18nPage, ...i18nDesign };

/**
 * Security Dashboard — /api/v1/security/dashboard
 * (SecurityDashboardApiController → SecurityDashboardService).
 * The API returns overview counters, recent incidents/events, severity
 * breakdown, top risks and notifications. It has no time series, so the
 * activity chart is bucketed client-side from the incident + event timestamps
 * it does return. If the API later adds `activity` ([{date, incidents,
 * events}]) the chart uses it as-is.
 */

const SEV_ORDER = ['critical', 'high', 'medium', 'low'];
const SEV_COLOR = { critical: 'var(--sev-critical)', high: 'var(--sev-high)', medium: 'var(--sev-medium)', low: 'var(--sev-low)' };
const REFRESH_MS = 30000;

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (v) => { const d = parseServerDate(String(v || '')); return Number.isNaN(d.getTime()) ? null : d; };

function timeAgo(v, locale) {
  const d = parse(v); if (!d) return '';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  const ar = locale === 'ar';
  if (s < 60) return ar ? 'الآن' : 'just now';
  if (s < 3600) return ar ? `منذ ${Math.floor(s / 60)} د` : `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return ar ? `منذ ${Math.floor(s / 3600)} س` : `${Math.floor(s / 3600)} hr ago`;
  return ar ? `منذ ${Math.floor(s / 86400)} يوم` : `${Math.floor(s / 86400)} d ago`;
}

function buildActivity(data, days, locale) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const buckets = Array.from({ length: days }, (_, i) => { const d = new Date(today); d.setDate(today.getDate() - (days - 1 - i)); return d; });
  const idx = Object.fromEntries(buckets.map((d, i) => [dayKey(d), i]));
  const inc = new Array(days).fill(0); const ev = new Array(days).fill(0);
  if (Array.isArray(data.activity) && data.activity.length) {
    data.activity.slice(-days).forEach((a, i) => { inc[i] = Number(a.incidents) || 0; ev[i] = Number(a.events) || 0; });
  } else {
    (data.recent_incidents || []).forEach((r) => { const d = parse(r.detected_at || r.created_at); if (d && dayKey(d) in idx) inc[idx[dayKey(d)]] += 1; });
    (data.recent_events || []).forEach((r) => { const d = parse(r.time || r.timestamp || r.created_at); if (d && dayKey(d) in idx) ev[idx[dayKey(d)]] += 1; });
  }
  const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', days <= 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' });
  return { labels: buckets.map((d) => fmt.format(d)), inc, ev };
}

function riskMeta(score, t) {
  const n = Number(score) || 0;
  if (n >= 7) return { tone: 'danger', text: t('High risk') };
  if (n >= 4) return { tone: 'caution', text: t('Moderate risk') };
  return { tone: 'good', text: t('Low risk') };
}

export default function SecurityDashboard() {
  const t = useTranslations(translations);
  const label = tl(t);
  const { locale } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const greeting = useGreeting();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  // Auto-refresh is ON by default and remembered across reloads (it used to
  // reset to PAUSED on every refresh, which read like the platform was down).
  const [auto, setAuto] = useState(() => {
    try { return localStorage.getItem('sec-dash-auto') !== '0'; } catch { return true; }
  });
  const [days, setDays] = useState('7');
  useEffect(() => {
    try { localStorage.setItem('sec-dash-auto', auto ? '1' : '0'); } catch { /* storage unavailable */ }
  }, [auto]);

  const load = useCallback((silent) => {
    if (!silent) setLoading(true);
    return api.get('/api/v1/security/dashboard', { days: Number(days) })
      .then((json) => { setData(json.data || {}); setError(null); })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => { load(data ? true : false); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!auto) return undefined;
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [auto, load]);

  const first = (user?.full_name || user?.name || '').split(' ')[0];
  const activity = useMemo(() => (data ? buildActivity(data, Number(days), locale) : null), [data, days, locale]);

  const head = (
    <PageHead
      eyebrow={`${greeting}${first ? `, ${first}` : ''}`}
      title={t('Security Dashboard')}
      subtitle={t('A live view of your university security posture.')}
      actions={(
        <>
          <FilterSelect value={days} onChange={setDays} options={[{ value: '7', label: t('Last 7 days') }, { value: '14', label: t('Last 14 days') }, { value: '30', label: t('Last 30 days') }]} />
          <button type="button" className={`btn btn-outline${auto ? ' is-on' : ''}`} aria-pressed={auto} onClick={() => { setAuto((a) => !a); if (!auto) load(true); }}>
            <Icon name="refresh" size={15} /> {t('Auto-refresh')}
          </button>
        </>
      )}
    />
  );

  if (loading && !data) return <div className="sec-page">{head}<div className="sec-kpis">{Array.from({ length: 7 }).map((_, i) => <div key={i} className="sec-kpi"><span className="sec-skel" style={{ width: '60%' }} /><span className="sec-skel" style={{ height: 26, width: '40%' }} /></div>)}</div></div>;
  if (error && !data) return <div className="sec-page">{head}<ErrorNote>{error}</ErrorNote><div><button type="button" className="btn btn-outline" onClick={() => load(false)}>{t('Retry')}</button></div></div>;
  if (!data) return null;

  const o = data.overview || {};
  const incidents = (data.recent_incidents || []).slice(0, 5);
  const alerts = (data.alerts || data.notifications || []).slice(0, 4);
  const sev = data.severity_breakdown || {};
  const segments = SEV_ORDER.map((k) => ({ key: k, label: label(k), value: Number(sev[k]) || 0, color: SEV_COLOR[k] }));
  const risk = riskMeta(o.average_risk_score, t);
  const critical = Number(o.critical_incidents) || 0;
  const vulnCritical = Number(o.critical_vulnerabilities) || 0;

  return (
    <div className="sec-page">
      {head}
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="sec-kpis">
        <SecKpi label={t('Open Incidents')} value={o.open_incidents ?? 0} meta={critical ? `${critical} ${label('critical').toLowerCase()}` : Number(o.open_incidents) ? null : t('All clear')} tone={critical ? 'danger' : 'good'} onClick={() => navigate('/security/incidents?status=open')} />
        <SecKpi label={t('Critical Incidents')} value={critical} meta={critical ? t('Needs attention') : t('All clear')} tone={critical ? 'danger' : 'good'} onClick={() => navigate('/security/incidents?severity=critical')} />
        <SecKpi label={t('Open Vulnerabilities')} value={o.open_vulnerabilities ?? 0} meta={vulnCritical ? `${vulnCritical} ${label('critical').toLowerCase()}` : null} tone="warn" onClick={() => navigate('/security/vulnerabilities')} />
        <SecKpi label={t('Active Sessions')} value={(o.active_sessions ?? 0).toLocaleString()} meta={null} onClick={() => navigate('/security/sessions')} />
        <SecKpi label={t('Active Users')} value={(o.active_users ?? 0).toLocaleString()} meta={t('Live now')} tone="good" onClick={() => navigate('/security/sessions')} />
        <SecKpi label={t('Blocked IPs')} value={o.blocked_ips ?? 0} onClick={() => navigate('/security/logs')} />
        <SecKpi label={t('Avg Risk Score')} value={`${Number(o.average_risk_score ?? 0).toFixed(1)}/10`} meta={risk.text} tone={risk.tone} />
      </div>

      <div className="sec-row sec-row--main">
        <section className="sec-card">
          <div className="sec-card__head">
            <div><h2>{t('Security activity')}</h2><p>{t('Incidents and events across the selected period')}</p></div>
            <span className={`live-chip${auto ? ' is-live' : ''}`}>{auto ? t('LIVE') : t('PAUSED')}</span>
          </div>
          <div className="sec-card__body">
            <ActivityChart
              labels={activity.labels}
              series={[{ name: t('Events'), values: activity.ev, color: 'var(--color-primary)' }, { name: t('Incidents'), values: activity.inc, color: 'var(--chart-line-2)' }]}
              emptyText={t('No activity in this period.')}
            />
          </div>
        </section>

        <section className="sec-card">
          <div className="sec-card__head"><div><h2>{t('Incidents by severity')}</h2><p>{t('Current open incident mix')}</p></div></div>
          <div className="sec-card__body"><SeverityDonut segments={segments} centerLabel={t('open')} emptyText={t('No incidents recorded.')} /></div>
        </section>
      </div>

      <div className="sec-row sec-row--bottom">
        <section className="sec-card sec-card--flush">
          <div className="sec-card__head" style={{ paddingBottom: 14 }}>
            <div><h2>{t('Recent incidents')}</h2><p>{t('Latest activity requiring your attention')}</p></div>
            <Link to="/security/incidents" className="sec-link">{t('View all')}</Link>
          </div>
          {incidents.length === 0 ? <EmptyState icon="shield">{t('No incidents recorded.')}</EmptyState> : (
            <div className="sec-table-wrap">
              <table className="sec-table">
                <thead><tr><th>{t('Incident')}</th><th>{t('Severity')}</th><th>{t('Status')}</th><th>{t('Assigned')}</th><th>{t('Time')}</th></tr></thead>
                <tbody>
                  {incidents.map((r) => (
                    <tr key={r.id}>
                      <td><Link to={`/security/incidents/${r.id}`}><strong>{r.title}</strong><span className="sub mono">{r.reference_code}</span></Link></td>
                      <td><SevBadge level={r.severity} text={label(r.severity)} /></td>
                      <td className="muted">{label(r.status)}</td>
                      <td>{r.assignee_name || <span className="muted">{t('Unassigned')}</span>}</td>
                      <td className="muted">{fmtDateTime(r.detected_at || r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="sec-card">
          <div className="sec-card__head">
            <div><h2>{t('Security alerts')}</h2><p>{t('Prioritized detections')}</p></div>
            <Link to="/security/alerts" className="icon-btn" aria-label={t('Alerts')}><Icon name="bell" size={16} /></Link>
          </div>
          <div className="sec-card__body">
            {alerts.length === 0 ? <EmptyState icon="bell">{t('No alerts right now.')}</EmptyState> : (
              <div className="sec-stack">
                {alerts.map((a, i) => {
                  const level = a.severity || 'info';
                  return (
                    <Link key={a.id ?? i} to="/security/alerts" className="sec-alert-card">
                      <span className="sec-alert-card__top">
                        <span className="sec-alert-card__dot" style={{ background: SEV_COLOR[level] || 'var(--color-primary)' }} />
                        <SevBadge level={level} text={label(level)} />
                        <span>{timeAgo(a.created_at, locale)}</span>
                      </span>
                      <strong>{a.title || a.message}</strong>
                      {a.title && a.message && <p>{a.message}</p>}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
