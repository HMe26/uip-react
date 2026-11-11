import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import StoredFileDownload from '../../components/StoredFileDownload';
import FilePreviewButton from '../../components/FilePreviewButton';
import { useTranslations } from '../../context/LanguageContext';
import { useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/data-analysis/reports';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/data-analysis/reports.php, talking to the real JSON
 * API (app/Controllers/Api/DataAnalysisReportsApiController.php,
 * /api/v1/data-analysis/reports/*). No new endpoints, no new business
 * logic — same isDataAnalyst() gate (data_analyst OR admin) already
 * enforced server-side. Type labels come straight from that PHP view's
 * own $reportTypeLabels array (real EN/AR pairs, not invented).
 */

const REPORT_TYPE_LABELS = {
  analytics_platform_export: { en: 'Platform Analytics Export', ar: 'تصدير تحليلات المنصة' },
  platform_usage_summary: { en: 'Platform Usage Summary', ar: 'ملخص استخدام المنصة' },
  platform_growth_report: { en: 'Platform Growth Report', ar: 'تقرير نمو المنصة' },
};
const STATUS_BADGE = { ready: 'badge-success', generating: 'badge-warning', queued: 'badge-neutral', failed: 'badge-danger' };
const FORMATS = ['csv', 'xlsx', 'pdf', 'json', 'docx'];

export default function DataAnalysisReports() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [reports, setReports] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [allowedTypes, setAllowedTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [genType, setGenType] = useState('');
  const [generating, setGenerating] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [selected, setSelected] = useState([]);

  const typeLabel = (type) => REPORT_TYPE_LABELS[type]?.[locale] || REPORT_TYPE_LABELS[type]?.en || type;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/data-analysis/reports')
      .then((json) => {
        setReports(json.data?.reports || []);
        setSchedules(json.data?.schedules || []);
        const types = json.meta?.allowed_types || [];
        setAllowedTypes(types);
        setGenType((prev) => prev || types[0] || '');
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runAction(promise) {
    setActionError(null);
    try {
      await promise;
      setSelected([]);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleGenerate(e) {
    e.preventDefault();
    if (!genType) return;
    setGenerating(true);
    setActionError(null);
    try {
      await api.post('/api/v1/data-analysis/reports/generate', { report_type: genType });
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setGenerating(false);
    }
  }

  function toggleSelect(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Reports')}</h1>
          <p className="text-small">{t('Real CSV reports about platform usage and growth.')}</p>
        </div>
      </div>

      {actionError && <p style={{ color: 'var(--color-danger)' }}>{actionError}</p>}

      <div className="grid-2" style={{ marginBottom: 'var(--space-6)', alignItems: 'start' }}>
        <div className="card glass-panel">
          <h3 className="text-h3" style={{ marginBottom: 'var(--space-3)' }}>{t('Generate a Report')}</h3>
          <form onSubmit={handleGenerate} style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: 1, minWidth: 220, marginBottom: 0 }}>
              <label className="form-label">{t('Reports')}</label>
              <select className="form-input" value={genType} onChange={(e) => setGenType(e.target.value)}>
                {allowedTypes.map((rt) => <option key={rt} value={rt}>{typeLabel(rt)}</option>)}
              </select>
            </div>
            <button type="submit" className="btn btn-primary" disabled={generating || !genType}>
              <Icon name="file" size={16} /> {generating ? '…' : t('Generate (CSV)')}
            </button>
          </form>
        </div>

        <div className="card glass-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
            <h3 className="text-h3" style={{ margin: 0 }}>{t('Scheduled Auto-Reports')}</h3>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setScheduling(true)}>
              <Icon name="plus-circle" size={16} /> {t('Create schedule')}
            </button>
          </div>
          {schedules.length === 0 && <p className="text-caption">{t('No schedules yet.')}</p>}
          {schedules.map((s) => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <div>
                <p className="text-small" style={{ margin: 0, fontWeight: 600 }}>{typeLabel(s.report_type)}</p>
                <span className="text-caption">
                  {s.frequency === 'custom' ? t('every %d days').replace('%d', s.custom_interval_days) : s.frequency} · {s.recipient_email} · {Number(s.is_active) ? t('Active') : t('Paused')}
                </span>
                <div className="text-caption">{s.last_run_at ? `${t('Last run: ')}${s.last_run_at.slice(0, 10)}` : t('Not run yet')}</div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button type="button" className="btn btn-ghost btn-sm" title={t('Run now')} onClick={() => runAction(api.post(`/api/v1/data-analysis/reports/schedules/${s.id}/run-now`))}>
                  <Icon name="refresh" size={16} />
                </button>
                <button type="button" className="btn btn-ghost btn-sm" title={Number(s.is_active) ? t('Pause') : t('Resume')} onClick={() => runAction(api.post(`/api/v1/data-analysis/reports/schedules/${s.id}/toggle`))}>
                  <Icon name={Number(s.is_active) ? 'x-circle' : 'check-circle'} size={16} />
                </button>
                <button type="button" className="btn btn-ghost btn-sm" title={t('Delete')} onClick={() => { if (confirm(t('Delete this schedule?'))) runAction(api.del(`/api/v1/data-analysis/reports/schedules/${s.id}`)); }}>
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {loading && <p className="text-small">…</p>}
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {!loading && !error && (
        <div className="card glass-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {selected.length > 0 && (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => { if (confirm(`${selected.length} ${t('selected report(s)?')}`)) runAction(api.post('/api/v1/data-analysis/reports/delete-selected', { ids: selected })); }}>
                  <Icon name="trash" size={16} /> {t('Delete Selected')}
                </button>
              )}
              {reports.length > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (confirm(t('Delete all reports? This cannot be undone.'))) runAction(api.post('/api/v1/data-analysis/reports/delete-all')); }}>
                  <Icon name="trash" size={16} /> {t('Delete All')}
                </button>
              )}
            </div>
          </div>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr><th></th><th>{t('Reports')}</th><th>{t('Format')}</th><th>{t('Status')}</th><th>{t('Date')}</th><th></th></tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td><input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleSelect(r.id)} /></td>
                    <td>{typeLabel(r.report_type)}</td>
                    <td>{String(r.format).toUpperCase()}</td>
                    <td><span className={`badge ${STATUS_BADGE[r.status] || 'badge-neutral'}`}>{r.status}</span></td>
                    <td>{r.created_at ? r.created_at.slice(0, 10) : ''}</td>
                    <td style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      {r.status === 'ready' && r.file_path && (
                        <FilePreviewButton path={`/${r.file_path}`} format={r.format} title={typeLabel(r.report_type)} />
                      )}
                      {r.status === 'ready' && r.file_path && (
                        <StoredFileDownload path={`/${r.file_path}`} format={r.format} title={typeLabel(r.report_type)} label={t('Download')} />
                      )}
                      <button type="button" className="btn btn-ghost btn-sm" title={t('Delete')} onClick={() => { if (confirm(t('Delete this report?'))) runAction(api.del(`/api/v1/data-analysis/reports/${r.id}`)); }}>
                        <Icon name="trash" size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
                {reports.length === 0 && (
                  <tr><td colSpan={6} className="text-small" style={{ padding: 'var(--space-5)', textAlign: 'center' }}>{t('No reports yet.')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {scheduling && (
        <ScheduleModal
          allowedTypes={allowedTypes}
          typeLabel={typeLabel}
          onClose={() => setScheduling(false)}
          onDone={(err) => { setScheduling(false); if (err) setActionError(err); else load(); }}
        />
      )}
    </>
  );
}

function ScheduleModal({ allowedTypes, typeLabel, onClose, onDone }) {
  const t = useTranslations(translations);
  const [reportType, setReportType] = useState(allowedTypes[0] || '');
  const [frequency, setFrequency] = useState('weekly');
  const [customDays, setCustomDays] = useState(7);
  const [format, setFormat] = useState('csv');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/v1/data-analysis/reports/schedules', {
        report_type: reportType,
        frequency,
        format,
        recipient_email: email,
        custom_interval_days: frequency === 'custom' ? customDays : null,
      });
      onDone(null);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{t('Create schedule')}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">{t('Reports')}</label>
            <select className="form-input" value={reportType} onChange={(e) => setReportType(e.target.value)}>
              {allowedTypes.map((rt) => <option key={rt} value={rt}>{typeLabel(rt)}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('Frequency')}</label>
            <select className="form-input" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              <option value="daily">{t('Daily')}</option>
              <option value="weekly">{t('Weekly')}</option>
              <option value="monthly">{t('Monthly')}</option>
              <option value="custom">{t('Custom')}</option>
            </select>
          </div>
          {frequency === 'custom' && (
            <div className="form-group">
              <label className="form-label">{t('Every how many days')}</label>
              <input className="form-input" type="number" min={1} max={365} value={customDays} onChange={(e) => setCustomDays(Number(e.target.value))} />
            </div>
          )}
          <div className="form-group">
            <label className="form-label">{t('Format')}</label>
            <select className="form-input" value={format} onChange={(e) => setFormat(e.target.value)}>
              {FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('One or more emails, comma-separated')}</label>
            <input className="form-input" type="text" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-box__actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '…' : t('Save changes')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
