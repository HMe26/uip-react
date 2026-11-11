import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import StoredFileDownload from '../../components/StoredFileDownload';
import FilePreviewButton from '../../components/FilePreviewButton';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/reports';
import i18nKit from '../../i18n/admin/page-kit';
import AdminPage, { ErrorState, Skeleton } from '../../components/admin/AdminPage';
import { ConfirmModal, Pager } from '../../components/admin/adminUi';

const translations = { ...i18nKit, ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/admin/reports.php, talking to the real JSON API
 * (app/Controllers/Api/AdminReportsApiController.php,
 * /api/v1/admin/reports/*). Report history + generation (writes a real
 * file under public/uploads/reports, downloadable straight from
 * `file_path`) + recurring schedules (create/toggle/delete/run-now).
 * report_type options come from the real ReportService::TYPES list
 * (sent back in meta), matching exactly what admin is scoped to
 * generate — no invented types. Admin scheduling matches the original
 * web controller's scope: daily/weekly/monthly only, csv format
 * (the same limits AdminReportController::scheduleCreate() has).
 */

const PER_PAGE = 10;
const STATUS_BADGE = { ready: 'badge-success', generating: 'badge-warning', queued: 'badge-neutral', failed: 'badge-danger' };

function typeLabel(type) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtDate(v) {
  return v ? String(v).slice(0, 10) : '—';
}

export default function AdminReports() {
  const t = useTranslations(translations);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [schedules, setSchedules] = useState([]);
  const [reportTypes, setReportTypes] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [creating, setCreating] = useState(null); // null | report type to preselect ('' = first)
  const [scheduling, setScheduling] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/admin/reports', { page })
      .then((json) => {
        setRows(json.data || []);
        setTotal(json.meta?.total ?? 0);
        setSchedules(json.meta?.schedules || []);
        setReportTypes(json.meta?.reportTypes || []);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => { load(); }, [load]);

  async function runAction(promise) {
    setActionError(null);
    try {
      await promise;
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function confirmDelete() {
    setBusy(true);
    await runAction(api.del(`/api/v1/admin/reports/schedules/${deleting.id}`));
    setBusy(false);
    setDeleting(null);
  }

  return (
    <AdminPage
      icon="file"
      title={t('Reports')}
      subtitle={t('CSV reports generated on demand from live platform data — searchable and filterable.')}
      actions={(
        <button type="button" className="btn btn-primary" disabled={reportTypes.length === 0} onClick={() => setCreating('')}>
          <Icon name="plus-circle" size={16} /> {t('Create Report')}
        </button>
      )}
    >
      {actionError && <p className="form-error">{actionError}</p>}

      {reportTypes.length > 0 && (
        <div className="adm-report-types">
          {reportTypes.map((type) => (
            <button key={type} type="button" className="adm-report-type" onClick={() => setCreating(type)}>
              <span className="adm-report-type__icon"><Icon name="file" size={18} /></span>
              <strong>{t(typeLabel(type))}</strong>
              <small>CSV · {t('Generate (CSV)')}</small>
            </button>
          ))}
        </div>
      )}

      <div className="adm-panel">
        <div className="adm-panel__head">
          <div>
            <h3>{t('Scheduled Reports')}</h3>
            <p>{t('Executed by cron/run_scheduled_reports.php on the server when due.')}</p>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setScheduling(true)} disabled={reportTypes.length === 0}>
            <Icon name="plus-circle" size={16} /> {t('New Schedule')}
          </button>
        </div>
        {schedules.length === 0 ? (
          <p className="adm-empty">{t('No schedules yet.')}</p>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr><th>{t('Report Type')}</th><th>{t('Frequency')}</th><th>{t('Recipient email')}</th><th>{t('Last ran:')}</th><th>{t('Next:')}</th><th>{t('Status')}</th><th /></tr>
              </thead>
              <tbody>
                {schedules.map((s) => {
                  const active = Number(s.is_active) === 1;
                  return (
                    <tr key={s.id}>
                      <td><strong>{t(typeLabel(s.report_type))}</strong></td>
                      <td style={{ textTransform: 'capitalize' }}>{t(String(s.frequency || '').replace(/^./, (c) => c.toUpperCase()))}</td>
                      <td>{s.recipient_email}</td>
                      <td>{fmtDate(s.last_run_at)}</td>
                      <td>{fmtDate(s.next_run_at)}</td>
                      <td><span className={`badge ${active ? 'badge-success' : 'badge-neutral'}`}>{active ? t('Active') : t('Paused')}</span></td>
                      <td className="adm-actions">
                        <button type="button" className="btn btn-ghost btn-sm" title={t('Run Now')} onClick={() => runAction(api.post(`/api/v1/admin/reports/schedules/${s.id}/run-now`))}>
                          <Icon name="refresh" size={16} />
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" title={active ? t('Pause') : t('Resume')} onClick={() => runAction(api.post(`/api/v1/admin/reports/schedules/${s.id}/toggle`))}>
                          <Icon name={active ? 'x-circle' : 'check-circle'} size={16} />
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm adm-btn-danger" title={t('Delete')} onClick={() => setDeleting(s)}>
                          <Icon name="trash" size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <h2 className="ap-section-title">{t('Report history')}</h2>
      {loading && <Skeleton rows={6} cols={4} />}
      {error && <ErrorState error={error} onRetry={load} />}

      {!loading && !error && (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr><th>{t('Type')}</th><th>{t('Format')}</th><th>{t('Generated By')}</th><th>{t('Status')}</th><th>{t('Date')}</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><span className="tbl-main"><span className="tbl-main__icon" aria-hidden="true"><Icon name="file" size={17} /></span><strong>{t(typeLabel(r.report_type))}</strong></span></td>
                  <td><span className="tbl-fmt" data-fmt={String(r.format || '').toLowerCase()}>{String(r.format).toUpperCase()}</span></td>
                  <td>{r.generated_by_name ? <span className="tbl-who"><i>{String(r.generated_by_name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</i>{r.generated_by_name}</span> : '—'}</td>
                  <td><span className={`badge ${STATUS_BADGE[r.status] || 'badge-neutral'}`}>{t(String(r.status || '').replace(/^./, (c) => c.toUpperCase()))}</span></td>
                  <td className="tbl-date">{fmtDate(r.created_at)}</td>
                  <td className="adm-actions">
                    {r.status === 'ready' && r.file_path && (
                      <FilePreviewButton path={`/${r.file_path}`} format={r.format} title={t(typeLabel(r.report_type))} />
                    )}
                    {r.status === 'ready' && r.file_path && (
                      <StoredFileDownload path={`/${r.file_path}`} format={r.format} title={t(typeLabel(r.report_type))} label={t('Download')} />
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="adm-empty" style={{ textAlign: 'center', padding: 24 }}>{t('No reports yet.')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !error && <Pager page={page} setPage={setPage} total={total} perPage={PER_PAGE} />}

      {creating !== null && (
        <CreateReportModal
          reportTypes={reportTypes}
          initialType={creating}
          onClose={() => setCreating(null)}
          onDone={(err) => { setCreating(null); if (err) setActionError(err); else { setPage(1); load(); } }}
        />
      )}
      {scheduling && (
        <ScheduleModal
          reportTypes={reportTypes}
          onClose={() => setScheduling(false)}
          onDone={(err) => { setScheduling(false); if (err) setActionError(err); else load(); }}
        />
      )}
      {deleting && (
        <ConfirmModal
          title={t('Confirm action')}
          message={`${t('Delete this schedule?')} (${t(typeLabel(deleting.report_type))} · ${t(String(deleting.frequency || '').replace(/^./, (c) => c.toUpperCase()))})`}
          confirmLabel={t('Delete')}
          danger
          busy={busy}
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </AdminPage>
  );
}

/** Same endpoint as before: POST /api/v1/admin/reports/generate (CSV only). */
function CreateReportModal({ reportTypes, initialType, onClose, onDone }) {
  const t = useTranslations(translations);
  const [type, setType] = useState(initialType || reportTypes[0] || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!type) return;
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/v1/admin/reports/generate', { report_type: type, format: 'csv' });
      onDone(null);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{t('Create Report')}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">{t('Report Type')}</label>
            <select className="form-input" value={type} onChange={(e) => setType(e.target.value)}>
              {reportTypes.map((x) => <option key={x} value={x}>{t(typeLabel(x))}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('Format')}</label>
            <select className="form-input" value="csv" disabled><option value="csv">CSV</option></select>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-box__actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving || !type}>{saving ? t('Generating…') : t('Generate Report')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ScheduleModal({ reportTypes, onClose, onDone }) {
  const t = useTranslations(translations);
  const [reportType, setReportType] = useState(reportTypes[0] || '');
  const [frequency, setFrequency] = useState('weekly');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/v1/admin/reports/schedules', { report_type: reportType, frequency, recipient_email: email });
      onDone(null);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{t('New Schedule')}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">{t('Report type')}</label>
            <select className="form-input" value={reportType} onChange={(e) => setReportType(e.target.value)}>
              {reportTypes.map((rt) => <option key={rt} value={rt}>{t(typeLabel(rt))}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('Frequency')}</label>
            <select className="form-input" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              <option value="daily">{t('Daily')}</option>
              <option value="weekly">{t('Weekly')}</option>
              <option value="monthly">{t('Monthly')}</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('Recipient email')}</label>
            <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-box__actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? t('Creating…') : t('Create Schedule')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
