import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import ExportMenu from '../../components/ExportMenu';
import { downloadExport } from '../../lib/exportDownload';
import { Pager } from '../../components/admin/adminUi';
import { useTranslations } from '../../context/LanguageContext';
import { L } from '../../i18n/localize';
import i18nPage from '../../i18n/admin/system-activity';

/**
 * System Activity — one page, two real logs on the existing APIs:
 *   • Security events: /api/v1/admin/security-logs (+ /export)
 *   • Admin actions:   /api/v1/admin/audit-logs    (+ /export)
 * Serves /admin/activity, /admin/security-logs and /admin/audit-logs (each opens its tab).
 * Layout: hero → segmented tabs → KPI tiles → toolbar → table (cards on phones) → pager.
 */

const SEV_ICON = { critical: 'alert-triangle', warning: 'alert', info: 'info' };
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '—');
const label = (v, t) => (v == null ? '' : typeof v === 'object' ? L(t, v.en, v.ar) : String(v));
const initials = (s) => String(s || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const deviceIcon = (d) => (/mobile|phone/i.test(d || '') ? 'smartphone' : /tablet/i.test(d || '') ? 'tablet' : 'monitor');

/** Who did it: a numeric id (no name stored) shows as "User #22", an e-mail shows its name part with the domain underneath. */
function UserCell({ value, t }) {
  const v = String(value);
  if (/^\d+$/.test(v)) {
    return <span className="sa-user sa-user--id"><i aria-hidden="true"><Icon name="user" size={15} /></i><span><strong>{t('User')} #{v}</strong></span></span>;
  }
  if (v.includes('@')) {
    const [name, domain] = v.split('@');
    return <span className="sa-user" title={v}><i>{initials(v)}</i><span><strong>{name}</strong><small>@{domain}</small></span></span>;
  }
  return <span className="sa-user" title={v}><i>{initials(v)}</i><span><strong>{v}</strong></span></span>;
}

function When({ value }) {
  if (!value) return <>—</>;
  const [d, tm] = String(value).slice(0, 19).replace('T', ' ').split(' ');
  return <span className="sa-when"><strong>{d}</strong><small>{tm}</small></span>;
}

async function downloadCsv(path, params, filename, format = 'csv', title) {
  await downloadExport(path, {
    params: Object.fromEntries(Object.entries(params).filter(([, v]) => v)),
    format, title, filename: `${filename}-${new Date().toISOString().slice(0, 10)}`,
  });
}

export default function AdminSystemActivity({ initialTab = 'security' }) {
  const t = useTranslations(i18nPage);
  const [tab, setTab] = useState(initialTab);
  useEffect(() => { setTab(initialTab); }, [initialTab]);
  return (
    <div className="sa-page">
      <header className="sa-hero">
        <span className="sa-hero__icon" aria-hidden="true"><Icon name="pulse" size={26} /></span>
        <div className="sa-hero__text">
          <h1>{t('System Activity')}</h1>
          <p>{t('Monitor security events and administrative actions across the platform.')}</p>
        </div>
      </header>
      <div className="sa-tabs" role="tablist">
        {[['security', 'shield', 'Security events'], ['audit', 'history', 'Admin actions']].map(([k, icon, name]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`sa-tab${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>
            <Icon name={icon} size={16} /> {t(name)}
          </button>
        ))}
      </div>
      {tab === 'security' ? <SecurityTab /> : <AuditTab />}
    </div>
  );
}

function Kpi({ icon, title, value, note, tone }) {
  return (
    <div className={`sa-kpi${tone ? ` sa-kpi--${tone}` : ''}`}>
      <span className="sa-kpi__icon" aria-hidden="true"><Icon name={icon} size={18} /></span>
      <div className="sa-kpi__body">
        <span className="sa-kpi__title">{title}</span>
        <strong className="sa-kpi__value">{value}</strong>
        {note && <span className="sa-kpi__note">{note}</span>}
      </div>
    </div>
  );
}

function Toolbar({ t, q, onQ, placeholder, onRefresh, loading, children, exportNode }) {
  return (
    <div className="sa-toolbar">
      <label className="sa-search">
        <Icon name="search" size={16} />
        <input type="search" placeholder={placeholder} value={q} onChange={(e) => onQ(e.target.value)} aria-label={placeholder} />
      </label>
      {children}
      <span className="sa-toolbar__gap" />
      <button type="button" className="btn btn-outline btn-sm sa-refresh" onClick={onRefresh} disabled={loading} aria-label={t('Refresh')}>
        <Icon name="refresh" size={14} /> <span>{t('Refresh')}</span>
      </button>
      {exportNode}
    </div>
  );
}

function State({ t, loading, error, empty, emptyText, onRetry, cols }) {
  if (loading) {
    return (
      <div className="sa-skel" aria-busy="true" aria-label={t('Loading…')}>
        {Array.from({ length: 7 }).map((_, i) => <div key={i} className="sa-skel__row">{Array.from({ length: Math.min(cols, 4) }).map((__, j) => <i key={j} />)}</div>)}
      </div>
    );
  }
  if (error) {
    return (
      <div className="sa-state sa-state--error" role="alert">
        <Icon name="alert-triangle" size={28} /><strong>{t('Could not load the log')}</strong><p>{error}</p>
        <button type="button" className="btn btn-primary btn-sm" onClick={onRetry}>{t('Try again')}</button>
      </div>
    );
  }
  if (empty) return <div className="sa-state"><Icon name="inbox" size={28} /><strong>{emptyText}</strong><p>{t('Try a different search or filter.')}</p></div>;
  return null;
}

function SecurityTab() {
  const t = useTranslations(i18nPage);
  const PER_PAGE = 25;
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [meta, setMeta] = useState({});
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [severity, setSeverity] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/admin/security-logs', { page, q: q || undefined, severity: severity || undefined })
      .then((json) => { setRows(json.data || []); setTotal(json.meta?.total ?? 0); setMeta(json.meta || {}); })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [page, q, severity]);
  useEffect(() => { load(); }, [load]);

  async function exportCsv(format) {
    setExporting(true);
    try { await downloadCsv('/api/v1/admin/security-logs/export', { q, severity }, 'security-log', format, t('Security Logs')); }
    catch { setError(t('Export failed. Please try again.')); }
    finally { setExporting(false); }
  }

  const crit = meta.criticalCount ?? 0;
  const chips = [['', 'All'], ['critical', 'Critical'], ['warning', 'Warning'], ['info', 'Info']];

  return (
    <>
      <div className="sa-kpis">
        <Kpi icon="pulse" title={t('Events')} value={total.toLocaleString()} />
        <Kpi icon="alert-triangle" tone={crit > 0 ? 'critical' : 'ok'} title={t('Critical')} value={crit.toLocaleString()} note={crit > 0 ? t('Needs review') : t('None')} />
        <Kpi icon="alert" tone={(meta.warningCount ?? 0) > 0 ? 'warning' : undefined} title={t('Warnings')} value={(meta.warningCount ?? 0).toLocaleString()} />
        <Kpi icon="globe" title={t('Distinct IPs')} value={(meta.distinctIps ?? 0).toLocaleString()} />
      </div>

      <section className="sa-card">
        <Toolbar t={t} q={q} onQ={(v) => { setPage(1); setQ(v); }} placeholder={t('Search event, user, IP…')} onRefresh={load} loading={loading}
          exportNode={<ExportMenu className="btn btn-outline btn-sm" iconSize={14} busy={exporting} onExport={exportCsv} />}>
          <div className="sa-chips" role="group" aria-label={t('Severity')}>
            {chips.map(([v, name]) => (
              <button key={v || 'all'} type="button" className={`sa-chip${severity === v ? ' is-active' : ''}${v ? ` sa-chip--${v}` : ''}`} aria-pressed={severity === v} onClick={() => { setPage(1); setSeverity(v); }}>{t(name)}</button>
            ))}
          </div>
        </Toolbar>

        <State t={t} loading={loading} error={error} empty={!loading && !error && rows.length === 0} emptyText={t('No events match this search.')} onRetry={load} cols={6} />
        {!loading && !error && rows.length > 0 && (
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead><tr><th>{t('Time')}</th><th>{t('Event')}</th><th>{t('User')}</th><th>{t('IP')}</th><th>{t('Device')}</th><th>{t('Severity')}</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const sev = ['critical', 'warning'].includes(r.severity) ? r.severity : 'info';
                  const dev = [r.device, r.browser, r.os].filter((v) => v && v !== '—');
                  return (
                    <tr key={i} data-sev={sev}>
                      <td data-label={t('Time')} className="sa-col-time"><When value={r.time} /></td>
                      <td data-label={t('Event')} className="sa-event">{r.event}</td>
                      <td data-label={t('User')} className="sa-col-user">{r.user ? <UserCell value={r.user} t={t} /> : <span className="sa-muted">—</span>}</td>
                      <td data-label={t('IP')} className="sa-col-ip">{r.ip ? <code className="sa-ip">{r.ip}</code> : <span className="sa-muted">—</span>}</td>
                      <td data-label={t('Device')} className="sa-col-device">{dev.length ? <span className="sa-device"><Icon name={deviceIcon(r.device)} size={15} />{dev.join(' · ')}</span> : <span className="sa-muted">—</span>}</td>
                      <td data-label={t('Severity')} className="sa-col-sev"><span className={`sa-sev sa-sev--${sev}`}><Icon name={SEV_ICON[sev]} size={13} />{t(cap(sev))}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && <div className="sa-pager"><Pager page={page} setPage={setPage} total={total} perPage={PER_PAGE} /></div>}
      </section>
    </>
  );
}

function AuditTab() {
  const t = useTranslations(i18nPage);
  const PER_PAGE = 25;
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/admin/audit-logs', { page, per_page: PER_PAGE, q: q || undefined })
      .then((json) => { setRows(json.data || []); setTotal(json.meta?.total ?? 0); })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [page, q]);
  useEffect(() => { load(); }, [load]);

  async function exportCsv(format) {
    setExporting(true);
    try { await downloadCsv('/api/v1/admin/audit-logs/export', { q }, 'audit-log', format, t('Audit Logs')); }
    catch { setError(t('Export failed. Please try again.')); }
    finally { setExporting(false); }
  }

  return (
    <>
      <div className="sa-kpis">
        <Kpi icon="history" title={t('Recorded actions')} value={total.toLocaleString()} note={q ? t('matching search') : t('all time')} />
      </div>
      <section className="sa-card">
        <Toolbar t={t} q={q} onQ={(v) => { setPage(1); setQ(v); }} placeholder={t('Search actor, email, action, target…')} onRefresh={load} loading={loading}
          exportNode={<ExportMenu className="btn btn-outline btn-sm" iconSize={14} busy={exporting} onExport={exportCsv} />} />
        <State t={t} loading={loading} error={error} empty={!loading && !error && rows.length === 0} emptyText={t('No log entries match this search.')} onRetry={load} cols={4} />
        {!loading && !error && rows.length > 0 && (
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead><tr><th>{t('Time')}</th><th>{t('Actor')}</th><th>{t('Action')}</th><th>{t('Target')}</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const actor = label(r.actor, t);
                  return (
                    <tr key={i}>
                      <td data-label={t('Time')}><When value={r.time} /></td>
                      <td data-label={t('Actor')}>
                        <span className="sa-user"><i>{initials(actor || r.email)}</i><span><strong>{actor || '—'}</strong>{r.email && <small>{r.email}</small>}</span></span>
                      </td>
                      <td data-label={t('Action')}><span className="sa-action">{label(r.action, t)}</span></td>
                      <td data-label={t('Target')}>{r.target ? <span className="sa-target">{r.target}</span> : <span className="sa-muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && <div className="sa-pager"><Pager page={page} setPage={setPage} total={total} perPage={PER_PAGE} /></div>}
      </section>
    </>
  );
}
