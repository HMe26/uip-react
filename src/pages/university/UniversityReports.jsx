import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { KpiCard, Panel, fmt } from '../../components/insight/charts';
import StoredFileDownload from '../../components/StoredFileDownload';
import FilePreviewButton from '../../components/FilePreviewButton';
import { useLanguage, useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/university/reports';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/university/reports.php, talking to the real JSON API
 * (app/Controllers/Api/ReportsApiController.php — cross-portal
 * /api/v1/reports/* surface, already built). University role gets its own
 * report history + schedules (ReportRepository::forUser /
 * ReportSchedulerService::forCreator), scoped server-side — never a
 * client-supplied university id. Only the two ReportService::UNIVERSITY_TYPES
 * types are offered here, exactly as the PHP view hardcodes.
 */

const REPORT_TYPES = {
  university_student_roster: { en: 'Student Roster Export', ar: 'تصدير كشف الطلاب', icon: 'award' },
  university_project_log: { en: 'Project Log Export', ar: 'تصدير سجل المشاريع', icon: 'file' },
};

const FORMATS = {
  csv: { en: 'CSV', ar: 'CSV' },
  xlsx: { en: 'Excel (.xlsx)', ar: 'إكسل (.xlsx)' },
  pdf: { en: 'PDF', ar: 'PDF' },
  json: { en: 'JSON', ar: 'JSON' },
};

const FREQUENCIES = {
  daily: { en: 'Daily', ar: 'يوميًا' },
  weekly: { en: 'Weekly', ar: 'أسبوعيًا' },
  monthly: { en: 'Monthly', ar: 'شهريًا' },
};

const STATUS_BADGE = { ready: 'badge-success', generating: 'badge-warning', queued: 'badge-neutral', failed: 'badge-danger' };

export default function UniversityReports() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();

  const [reports, setReports] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const [genType, setGenType] = useState(Object.keys(REPORT_TYPES)[0]);
  const [genFormat, setGenFormat] = useState('csv');
  const [generating, setGenerating] = useState(false);

  const [schType, setSchType] = useState(Object.keys(REPORT_TYPES)[0]);
  const [schFrequency, setSchFrequency] = useState('weekly');
  const [schEmail, setSchEmail] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/reports')
      .then((json) => {
        setReports(json.data?.reports || []);
        setSchedules(json.data?.schedules || []);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleGenerate(e) {
    e.preventDefault();
    setGenerating(true);
    setActionError(null);
    try {
      await api.post('/api/v1/reports/generate', { report_type: genType, format: genFormat });
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm(t('Permanently delete this report? The generated file will be deleted too.'))) return;
    try {
      await api.del(`/api/v1/reports/${id}`);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleScheduleCreate(e) {
    e.preventDefault();
    setScheduling(true);
    setActionError(null);
    try {
      await api.post('/api/v1/reports/schedules', {
        report_type: schType, frequency: schFrequency, recipient_email: schEmail, format: 'csv',
      });
      setSchEmail('');
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setScheduling(false);
    }
  }

  async function runScheduleAction(promise) {
    setActionError(null);
    try {
      await promise;
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  const ar = locale === 'ar';
  const readyCount = reports.filter((r) => r.status === 'ready').length;
  const pendingCount = reports.filter((r) => r.status === 'generating' || r.status === 'queued').length;
  const failedCount = reports.filter((r) => r.status === 'failed').length;
  const activeSchedules = schedules.filter((x) => Number(x.is_active)).length;

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1>{t('Reports')}</h1>
          <p>{t("Real reports (CSV / Excel / PDF / JSON) about your university's students and projects, with preview, print, and secure delete.")}</p>
        </div>
      </div>

      {actionError && <p style={{ color: 'var(--color-danger)' }}>{actionError}</p>}
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

      <div className="insight-grid insight-grid--kpi">
        <KpiCard label={ar ? 'إجمالي التقارير' : 'Total Reports'} value={fmt(reports.length)} tone="primary" />
        <KpiCard label={ar ? 'جاهزة للتنزيل' : 'Ready to Download'} value={fmt(readyCount)} tone="success" progress={reports.length ? Math.round((readyCount / reports.length) * 100) : null} />
        <KpiCard
          label={ar ? 'قيد الإنشاء' : 'In Progress'} value={fmt(pendingCount)} tone={failedCount > 0 ? 'danger' : 'info'}
          note={failedCount > 0 ? (ar ? `${fmt(failedCount)} فشل` : `${fmt(failedCount)} failed`) : undefined}
        />
        <KpiCard label={ar ? 'جداول نشطة' : 'Active Schedules'} value={fmt(activeSchedules)} tone="warning" note={ar ? `من ${fmt(schedules.length)}` : `of ${fmt(schedules.length)}`} />
      </div>

      <div className="insight-grid insight-grid--main" style={{ alignItems: 'start' }}>
        <Panel title={ar ? 'سجل التقارير' : 'Report History'} subtitle={ar ? 'كل التقارير التي أنشأتها' : 'Every report you have generated'}>
          <div>
            {loading ? (
              <p className="text-small">{t('Loading…')}</p>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{ar ? 'التقرير' : 'Report'}</th>
                      <th>{ar ? 'الصيغة' : 'Format'}</th>
                      <th>{ar ? 'تاريخ الإنشاء' : 'Generated'}</th>
                      <th>{ar ? 'الحالة' : 'Status'}</th>
                      <th>{ar ? 'الإجراء' : 'Action'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((r) => {
                      const label = REPORT_TYPES[r.report_type] || { en: r.report_type, ar: r.report_type };
                      const isReady = r.status === 'ready' && r.file_path;
                      return (
                        <tr key={r.id}>
                          <td>
                            <strong>{label[locale] || label.en}</strong><br />
                            <span className="text-caption num">#{r.id}</span>
                          </td>
                          <td><span className="badge badge-neutral">{String(r.format).toUpperCase()}</span></td>
                          <td className="num">{r.created_at ? r.created_at.slice(0, 16).replace('T', ' ') : ''}</td>
                          <td><span className={`badge ${STATUS_BADGE[r.status] || 'badge-neutral'}`}>{t(r.status)}</span></td>
                          <td>
                            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                              {isReady && <FilePreviewButton path={`/${r.file_path}`} format={r.format} title={label[locale] || label.en} iconSize={14} label />}
                              {isReady ? (
                                <StoredFileDownload path={`/${r.file_path}`} format={r.format} title={label[locale] || label.en} iconOnly={false} iconSize={14} label={t('Download')} />
                              ) : <span className="text-caption">—</span>}
                              <button type="button" className="btn btn-ghost btn-sm" title={t('Delete')} style={{ color: 'var(--color-danger)' }} onClick={() => handleDelete(r.id)}>
                                <Icon name="trash" size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {reports.length === 0 && (
                      <tr><td colSpan={5} className="chart-empty" style={{ padding: 28, textAlign: 'center' }}>{t('No reports yet.')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Panel>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
          <Panel title={t('Generate a Report')} subtitle={ar ? 'اختر النوع والصيغة' : 'Pick a report type and format'}>
            <form onSubmit={handleGenerate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Object.entries(REPORT_TYPES).map(([key, val]) => (
                <label
                  key={key}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: 'pointer',
                    border: `1px solid ${genType === key ? 'var(--color-primary)' : 'var(--border-subtle)'}`,
                    background: genType === key ? 'var(--insight-tint)' : 'transparent',
                    borderRadius: 14,
                  }}
                >
                  <input type="radio" name="report_type" value={key} checked={genType === key} onChange={() => setGenType(key)} />
                  <Icon name={val.icon} size={18} />
                  <span className="text-small" style={{ fontWeight: 600 }}>{val[locale] || val.en}</span>
                </label>
              ))}

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">{t('Export format')}</label>
                <select className="form-input" value={genFormat} onChange={(e) => setGenFormat(e.target.value)}>
                  {Object.entries(FORMATS).map(([key, val]) => (
                    <option key={key} value={key}>{val[locale] || val.en}</option>
                  ))}
                </select>
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={generating}>
                <Icon name="plus" size={18} /> {generating ? t('Loading…') : t('Generate report')}
              </button>
            </form>
          </Panel>

          <Panel title={t('Scheduled Auto-Reports')} subtitle={ar ? 'يوصلك التقرير على بريدك تلقائياً كل فترة.' : "We'll email you the report automatically on a cadence."}>
            {schedules.length === 0 ? (
              <p className="chart-empty" style={{ marginBottom: 20 }}>{t('No schedules yet.')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 20 }}>
                {schedules.map((s, idx) => {
                  const sLabel = REPORT_TYPES[s.report_type] || { en: s.report_type, ar: s.report_type };
                  const fLabel = FREQUENCIES[s.frequency] || { en: s.frequency, ar: s.frequency };
                  const isEditing = editingId === s.id;
                  return (
                    <div key={s.id} style={{ padding: '14px 0', borderBottom: idx < schedules.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className={`badge ${Number(s.is_active) ? 'badge-success' : 'badge-neutral'}`}>{Number(s.is_active) ? t('Active') : t('Paused')}</span>
                        <strong style={{ fontSize: 15 }}>{sLabel[locale] || sLabel.en}</strong>
                      </div>
                      <p className="text-caption" style={{ margin: '6px 0 2px' }}>{fLabel[locale] || fLabel.en} · {s.recipient_email}</p>
                      <p className="text-caption" style={{ margin: '0 0 8px' }}>
                        {s.last_run_at ? `${t('Last run: ')}${s.last_run_at.slice(0, 16).replace('T', ' ')}` : t('Not run yet')}
                      </p>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => runScheduleAction(api.post(`/api/v1/reports/schedules/${s.id}/run-now`))}>
                          <Icon name="refresh" size={14} /> {t('Run now')}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingId(isEditing ? null : s.id)}>
                          <Icon name="edit" size={14} /> {t('Edit')}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => runScheduleAction(api.post(`/api/v1/reports/schedules/${s.id}/toggle`))}>
                          {Number(s.is_active) ? t('Pause') : t('Resume')}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} onClick={() => { if (confirm(t('Delete this schedule?'))) runScheduleAction(api.del(`/api/v1/reports/schedules/${s.id}`)); }}>
                          <Icon name="trash" size={14} />
                        </button>
                      </div>

                      {isEditing && (
                        <ScheduleEditForm
                          schedule={s}
                          onCancel={() => setEditingId(null)}
                          onSaved={() => { setEditingId(null); load(); }}
                          onError={(msg) => setActionError(msg)}
                          t={t}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <form onSubmit={handleScheduleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <select className="form-input" value={schType} onChange={(e) => setSchType(e.target.value)} required>
                {Object.entries(REPORT_TYPES).map(([key, val]) => <option key={key} value={key}>{val[locale] || val.en}</option>)}
              </select>
              <select className="form-input" value={schFrequency} onChange={(e) => setSchFrequency(e.target.value)} required>
                {Object.entries(FREQUENCIES).map(([key, val]) => <option key={key} value={key}>{val[locale] || val.en}</option>)}
              </select>
              <input className="form-input" type="email" value={schEmail} onChange={(e) => setSchEmail(e.target.value)} placeholder={t('Recipient email')} required />
              <button type="submit" className="btn btn-outline btn-sm" disabled={scheduling}>
                <Icon name="plus" size={16} /> {t('Create schedule')}
              </button>
            </form>
          </Panel>
        </aside>
      </div>
    </>
  );
}

function ScheduleEditForm({ schedule, onCancel, onSaved, onError, t }) {
  const [frequency, setFrequency] = useState(schedule.frequency);
  const [email, setEmail] = useState(schedule.recipient_email);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/api/v1/reports/schedules/${schedule.id}`, { frequency, recipient_email: email, format: schedule.format || 'csv' });
      onSaved();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <select className="form-input" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
        {Object.entries(FREQUENCIES).map(([key, val]) => <option key={key} value={key}>{val.en}</option>)}
      </select>
      <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{t('Save')}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>{t('Cancel')}</button>
      </div>
    </form>
  );
}
