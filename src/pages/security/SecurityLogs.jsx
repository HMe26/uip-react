import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { downloadFile } from '../../components/security/download';
import Icon from '../../components/Icon';
import ExportMenu from '../../components/ExportMenu';
import { downloadExport } from '../../lib/exportDownload';
import { PageHead, SevBadge, StatusPill, FilterSelect, SearchBox, Modal, DetailGrid, EmptyState, ErrorNote, TableSkeleton, Pagination, fmtDateTime, titleCase } from '../../components/security/ui';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nSecurity from '../../i18n/security/common';
import i18nPage from '../../i18n/security/logs';
import i18nDesign from '../../i18n/security/design';

const translations = { ...i18nCommon, ...i18nSecurity, ...i18nPage, ...i18nDesign };

/**
 * Mirrors app/Views/security/logs.php, talking to the real JSON API
 * (app/Controllers/Api/SecurityLogsApiController.php,
 * /api/v1/security/logs/* — unified audit-trail + security-event stream
 * with pagination, advanced filters, table/timeline view, CSV/JSON
 * export, and blocked-IP unblock; reuses SecurityAuditLogService +
 * BlockedIpRepository exactly as the server-rendered view does).
 *
 * Deliberate omission vs. the PHP view: a standalone "Print" page isn't
 * built as a separate route (see security/logs-print.php) — a browser
 * Print (Ctrl/Cmd+P) on this same filtered table covers the same data.
 */

const ROLES = ['student', 'university', 'admin', 'security_admin', 'security_officer', 'data_analyst'];
const SEVERITIES = ['info', 'warning', 'critical'];
const STATUSES = ['success', 'failed', 'warning'];
const DEVICES = ['Desktop', 'Mobile', 'Tablet'];
const EVENT_TYPES = [
  { key: 'login', en: 'Login', ar: 'تسجيل دخول' },
  { key: 'login_failed', en: 'Failed Login', ar: 'فشل تسجيل الدخول' },
  { key: 'logout', en: 'Logout', ar: 'تسجيل خروج' },
  { key: 'account_lockout', en: 'Account Lockout', ar: 'قفل الحساب' },
  { key: 'password_change', en: 'Password Change', ar: 'تغيير كلمة المرور' },
  { key: 'permission_change', en: 'Permission Change', ar: 'تغيير الصلاحيات' },
  { key: 'file_upload', en: 'File Upload', ar: 'رفع ملف' },
  { key: 'file_download', en: 'File Download', ar: 'تنزيل ملف' },
  { key: 'report_export', en: 'Report Export', ar: 'تصدير تقرير' },
  { key: 'project_update', en: 'Project Update', ar: 'تحديث مشروع' },
  { key: 'ai_analysis', en: 'AI Analysis', ar: 'تحليل ذكاء اصطناعي' },
  { key: 'security_policy_change', en: 'Security Policy Change', ar: 'تغيير سياسة أمنية' },
  { key: 'other', en: 'Other', ar: 'أخرى' },
];

const SOURCE_LABEL = { audit: { en: 'Audit', ar: 'تدقيق' }, security: { en: 'Security', ar: 'أمان' } };

const FIELD_KEYS = ['q', 'user', 'role', 'university', 'ip', 'device', 'browser', 'os', 'event_type', 'module', 'severity', 'status', 'source', 'date_from', 'date_to'];

export default function SecurityLogs() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = Object.fromEntries(FIELD_KEYS.map((k) => [k, searchParams.get(k) || (k === 'source' ? 'all' : '')]));
  const page = parseInt(searchParams.get('page') || '1', 10);
  const viewMode = searchParams.get('view') === 'timeline' ? 'timeline' : 'table';

  const [formState, setFormState] = useState(filters);
  const [rows, setRows] = useState([]);
  const [timelineGroups, setTimelineGroups] = useState({});
  const [blockedIps, setBlockedIps] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyIp, setBusyIp] = useState(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [detail, setDetail] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = { ...filters, page, view: viewMode };
    Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
    api.get('/api/v1/security/logs', params)
      .then((json) => {
        setRows(json.data || []);
        setTotalPages(json.meta?.totalPages || 1);
        setTotal(json.meta?.total ?? (json.data || []).length);
        setBlockedIps(json.meta?.blockedIps || []);
        const groups = {};
        (json.meta?.timelineGroups || []).forEach((g) => { groups[g.day || g[0]] = g.rows || g[1]; });
        // API may return either an object keyed by day or an array of [day, rows] pairs — handle both.
        if (json.meta?.timelineGroups && !Array.isArray(json.meta.timelineGroups)) {
          setTimelineGroups(json.meta.timelineGroups);
        } else {
          setTimelineGroups(groups);
        }
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters), page, viewMode]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setFormState(filters); }, [JSON.stringify(filters)]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasFilters = FIELD_KEYS.some((k) => filters[k] && !(k === 'source' && filters[k] === 'all'));

  const applyFilters = (e) => {
    e.preventDefault();
    const next = new URLSearchParams();
    FIELD_KEYS.forEach((k) => { if (formState[k] && !(k === 'source' && formState[k] === 'all')) next.set(k, formState[k]); });
    if (viewMode === 'timeline') next.set('view', 'timeline');
    setSearchParams(next);
  };

  const clearFilters = () => setSearchParams(new URLSearchParams());

  const switchView = (mode) => {
    const next = new URLSearchParams(searchParams);
    next.delete('page');
    if (mode === 'timeline') next.set('view', 'timeline'); else next.delete('view');
    setSearchParams(next);
  };

  const goPage = (p) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(p));
    setSearchParams(next);
  };

  const exportUrl = (format) => {
    const params = new URLSearchParams();
    FIELD_KEYS.forEach((k) => { if (filters[k] && !(k === 'source' && filters[k] === 'all')) params.set(k, filters[k]); });
    params.set('format', format);
    return `/api/v1/security/logs/export?${params.toString()}`;
  };

  // The API serves csv and json natively; Excel / PDF are built from its CSV.
  const handleExport = (format) => {
    setError(null);
    const job = format === 'json'
      ? downloadFile(exportUrl('json'), { filename: 'security-audit-logs.json' })
      : downloadExport(exportUrl('csv'), { format, filename: 'security-audit-logs', title: t('Audit & Security Logs') });
    return job.catch((err) => setError(errorMessage(err)));
  };

  const handleUnblock = (id) => {
    setBusyIp(id);
    api.post(`/api/v1/security/logs/blocked-ips/${id}/unblock`)
      .then((json) => setBlockedIps(json.data || []))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setBusyIp(null));
  };

  const set = (k) => (v) => setFormState((f) => ({ ...f, [k]: v }));
  const inp = (k) => (e) => set(k)(e.target.value);
  const sevText = (v) => (v ? (t(v) !== v ? t(v) : titleCase(v)) : '—');
  const stText = (v) => (v ? titleCase(v) : '—');
  const opts = (arr) => arr.map((v) => ({ value: v, label: titleCase(v) }));
  const rowTitle = (r) => r.action || r.event || '';

  return (
    <div className="sec-page">
      <PageHead
        eyebrow={t('Workspace / Audit')} title={t('Audit & Security Logs')}
        subtitle={t('The unified audit trail, security event stream, and blocked IP addresses — searchable, filterable, and exportable.')}
        actions={(<>
          <ExportMenu iconSize={15} onExport={handleExport} />
        </>)}
      />

      <form onSubmit={applyFilters} className="sec-card">
        <div className="sec-toolbar" style={{ border: 'none', boxShadow: 'none' }}>
          <SearchBox value={formState.q} onChange={set('q')} placeholder={t('Search by user, email, action, or IP...')} />
          <button type="button" className={`btn btn-outline${advancedOpen ? ' is-on' : ''}`} aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((o) => !o)}><Icon name="filter" size={15} /> {t('Advanced filters')}</button>
          <button className="btn btn-primary" type="submit"><Icon name="search" size={15} /> {t('Search')}</button>
          {hasFilters && <button type="button" className="btn btn-outline" onClick={clearFilters}>{t('Clear filters')}</button>}
          <div className="segmented" role="tablist" aria-label={locale === 'ar' ? 'العرض' : 'View'}>
            <button type="button" role="tab" aria-selected={viewMode === 'table'} className={viewMode === 'table' ? 'is-active' : ''} onClick={() => switchView('table')}>{t('Table')}</button>
            <button type="button" role="tab" aria-selected={viewMode === 'timeline'} className={viewMode === 'timeline' ? 'is-active' : ''} onClick={() => switchView('timeline')}>{t('Timeline')}</button>
          </div>
        </div>
        {advancedOpen && (
          <div className="sec-card__body" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <div className="sec-filter-grid">
              <div className="sec-field"><label>{t('Username / Email')}</label><input className="sec-input" value={formState.user} onChange={inp('user')} /></div>
              <div className="sec-field"><label>{t('Role')}</label><FilterSelect value={formState.role} onChange={set('role')} allLabel={t('All')} options={opts(ROLES)} /></div>
              <div className="sec-field"><label>{t('University')}</label><input className="sec-input" value={formState.university} onChange={inp('university')} /></div>
              <div className="sec-field"><label>{t('IP Address')}</label><input className="sec-input mono" dir="ltr" value={formState.ip} onChange={inp('ip')} /></div>
              <div className="sec-field"><label>{t('Device')}</label><FilterSelect value={formState.device} onChange={set('device')} allLabel={t('All')} options={DEVICES.map((d) => ({ value: d, label: d }))} /></div>
              <div className="sec-field"><label>{t('Browser')}</label><input className="sec-input" placeholder="Chrome, Safari..." value={formState.browser} onChange={inp('browser')} /></div>
              <div className="sec-field"><label>{t('Operating System')}</label><input className="sec-input" placeholder="Windows, macOS..." value={formState.os} onChange={inp('os')} /></div>
              <div className="sec-field"><label>{t('Event Type')}</label><FilterSelect value={formState.event_type} onChange={set('event_type')} allLabel={t('All')} options={EVENT_TYPES.map((ev) => ({ value: ev.key, label: locale === 'ar' ? ev.ar : ev.en }))} /></div>
              <div className="sec-field"><label>{t('Module')}</label><input className="sec-input" value={formState.module} onChange={inp('module')} /></div>
              <div className="sec-field"><label>{t('Severity')}</label><FilterSelect value={formState.severity} onChange={set('severity')} allLabel={t('All')} options={SEVERITIES.map((v) => ({ value: v, label: sevText(v) }))} /></div>
              <div className="sec-field"><label>{t('Status')}</label><FilterSelect value={formState.status} onChange={set('status')} allLabel={t('All')} options={opts(STATUSES)} /></div>
              <div className="sec-field"><label>{t('Source')}</label><FilterSelect value={formState.source || 'all'} onChange={set('source')} options={[{ value: 'all', label: t('All') }, { value: 'audit', label: t('Audit trail') }, { value: 'security', label: t('Security events') }]} /></div>
              <div className="sec-field"><label>{t('Date From')}</label><input className="sec-input" type="date" value={formState.date_from} onChange={inp('date_from')} /></div>
              <div className="sec-field"><label>{t('Date To')}</label><input className="sec-input" type="date" value={formState.date_to} onChange={inp('date_to')} /></div>
            </div>
            <button className="btn btn-primary" type="submit"><Icon name="filter" size={15} /> {t('Apply filters')}</button>
          </div>
        )}
      </form>

      <ErrorNote>{error}</ErrorNote>

      {viewMode === 'timeline' ? (
        <section className="sec-card"><div className="sec-card__body">
          {loading && !rows.length ? <span className="sec-skel" style={{ width: '40%' }} /> : rows.length === 0 ? <EmptyState icon="note">{t('No log entries match these filters.')}</EmptyState> : Object.entries(timelineGroups).map(([day, dayRows]) => (
            <div key={day} style={{ marginBottom: 24 }}>
              <h2 className="sec-section-title">{day}</h2>
              <ol className="sec-timeline">
                {(dayRows || []).map((r, i) => (
                  <li key={i}>
                    <span className="sec-timeline__dot" />
                    <div className="sec-timeline__row">
                      <div><SevBadge level={r.severity} text={sevText(r.severity)} /> <strong style={{ marginInlineStart: 8 }}>{r.actor || r.user || '—'}</strong> <span className="muted">— {rowTitle(r)}</span></div>
                      <span className="muted mono" dir="ltr">{r.time ? String(r.time).slice(11, 19) : '—'} · {r.ip || '—'}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div></section>
      ) : (
        <section className="sec-card sec-card--flush">
          <div className="sec-count"><strong>{total} {total === 1 ? (locale === 'ar' ? 'نتيجة' : 'result') : (locale === 'ar' ? 'نتيجة' : 'results')}</strong></div>
          <div className="sec-table-wrap">
            <table className="sec-table">
              <thead><tr><th>{t('Time')}</th><th>{t('Source')}</th><th>{t('User')}</th><th>{t('Role')}</th><th>{t('Event / Action')}</th><th>{t('Module')}</th><th>IP</th><th>{t('Device')}</th><th>{t('Severity')}</th><th>{t('Status')}</th></tr></thead>
              {loading && !rows.length ? <TableSkeleton cols={10} /> : (
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="is-row-link" tabIndex={0} onClick={() => setDetail(r)} onKeyDown={(e) => { if (e.key === 'Enter') setDetail(r); }}>
                      <td className="muted mono">{r.time ? String(r.time).replace('T', ' ').slice(0, 19) : '—'}</td>
                      <td><span className="pill pill--neutral">{r.source ? (SOURCE_LABEL[r.source]?.[locale] || r.source) : '—'}</span></td>
                      <td><strong>{r.actor || r.user || '—'}</strong>{r.email && r.email !== '—' && <span className="sub">{r.email}</span>}</td>
                      <td className="muted">{r.role_label || r.role || '—'}</td>
                      <td className="wrap">{rowTitle(r)}</td>
                      <td className="muted">{r.module || '—'}</td>
                      <td className="muted mono" dir="ltr">{r.ip || '—'}</td>
                      <td className="muted">{[r.device || '—', r.browser && r.browser !== '—' ? r.browser : null].filter(Boolean).join(' · ')}</td>
                      <td><SevBadge level={r.severity} text={sevText(r.severity)} /></td>
                      <td><StatusPill status={r.status} text={stText(r.status)} /></td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>
          {!loading && rows.length === 0 && <EmptyState icon="note">{t('No log entries match these filters.')}</EmptyState>}
        </section>
      )}
      {viewMode === 'table' && <Pagination page={page} totalPages={totalPages} onPage={goPage} />}

      <section className="sec-card sec-card--flush">
        <div className="sec-card__head" style={{ paddingBottom: 14 }}><div><h2>{t('Blocked IP Addresses')}</h2></div></div>
        <div className="sec-table-wrap">
          <table className="sec-table">
            <thead><tr><th>{t('IP Address')}</th><th>{t('Reason')}</th><th>{t('Blocked By')}</th><th>{t('Date')}</th><th className="col-actions">{t('Action')}</th></tr></thead>
            <tbody>
              {blockedIps.length === 0 ? (
                <tr><td colSpan={5}><EmptyState icon="lock">{t('No blocked IPs.')}</EmptyState></td></tr>
              ) : blockedIps.map((b) => (
                <tr key={b.id}>
                  <td className="mono" dir="ltr">{b.ip_address}</td>
                  <td>{b.reason || '—'}</td>
                  <td className="muted">{b.blocked_by_name || '—'}</td>
                  <td className="muted">{fmtDateTime(b.created_at)}</td>
                  <td className="col-actions"><button type="button" className="btn-tint" disabled={busyIp === b.id} onClick={() => handleUnblock(b.id)}>{t('Unblock')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={t('Event details')} wide footer={<button type="button" className="btn btn-outline" onClick={() => setDetail(null)}>{t('Close')}</button>}>
        {detail && (
          <DetailGrid items={[
            [t('Time'), detail.time ? String(detail.time).replace('T', ' ').slice(0, 19) : null],
            [t('Event / Action'), rowTitle(detail)],
            [t('User'), detail.actor || detail.user],
            [t('Role'), detail.role_label || detail.role],
            [t('IP Address'), detail.ip],
            [t('Device'), [detail.device, detail.browser, detail.os].filter((x) => x && x !== '—').join(' · ')],
            [t('Module'), detail.module],
            [t('Severity'), <SevBadge key="s" level={detail.severity} text={sevText(detail.severity)} />],
            [t('Status'), <StatusPill key="st" status={detail.status} text={stText(detail.status)} />],
          ]} />
        )}
      </Modal>
    </div>
  );
}
