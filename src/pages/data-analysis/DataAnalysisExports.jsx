import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import StoredFileDownload from '../../components/StoredFileDownload';
import { Drawer } from '../../components/insight/charts';
import { useLanguage, useTranslations } from '../../context/LanguageContext';
import { getPreferredExportLang, setPreferredExportLang } from '../../lib/exportLang';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/data-analysis/exports';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/data-analysis/exports.php, talking to the real JSON
 * API (app/Controllers/Api/DataAnalysisExportsApiController.php,
 * /api/v1/data-analysis/exports/*). Type labels are the controller's own
 * TYPE_LABELS constant (real strings, not invented).
 */

const TYPE_LABELS = {
  platform_kpis: 'Platform KPIs',
  user_growth: 'User Growth (12 months)',
  category_distribution: 'Category Distribution',
  university_leaderboard: 'University Leaderboard',
  full_platform_export: 'Everything (Projects + Universities)',
  // Exam system (labels mirror DataAnalysisExamsService::EXPORT_LABELS)
  exam_overview: 'Exam Overview (KPIs)',
  exam_scores_detail: 'Exam Scores (every graded attempt)',
  student_exam_performance: 'Student Exam Performance',
  exam_summary: 'Exams Summary (per exam)',
  doctor_exam_performance: 'Doctors Exam Performance',
};
// Exam exports accept the same filters as the Exam Analytics page.
const EXAM_EXPORT_TYPES = ['exam_overview', 'exam_scores_detail', 'student_exam_performance', 'exam_summary', 'doctor_exam_performance'];
const EMPTY_EXAM_FILTERS = { university_id: '', faculty_id: '', course_id: '', exam_type: '', from: '', to: '' };
const labelFor = (t, type) => (TYPE_LABELS[type] ? t(TYPE_LABELS[type]) : type);
const STATUS_BADGE = { completed: 'badge-success', pending: 'badge-warning', failed: 'badge-danger' };

export default function DataAnalysisExports() {
  const t = useTranslations(translations);
  const [exportsRows, setExportsRows] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [allowedTypes, setAllowedTypes] = useState([]);
  const [allowedFormats, setAllowedFormats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [scheduling, setScheduling] = useState(false);
  const [selected, setSelected] = useState([]);
  const { locale } = useLanguage();
  const platformLang = locale === 'ar' ? 'ar' : 'en';
  const [fileLang, setFileLangState] = useState(() => getPreferredExportLang(platformLang));
  const setFileLang = (l) => { setFileLangState(l); setPreferredExportLang(platformLang, l); };
  const [newForm, setNewForm] = useState({ types: [], format: 'csv', email: '' });
  const [examFilters, setExamFilters] = useState(EMPTY_EXAM_FILTERS);
  const [examOptions, setExamOptions] = useState(null);
  const [creating, setCreating] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [previewRow, setPreviewRow] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/data-analysis/exports')
      .then((json) => {
        setExportsRows(json.data?.exports || []);
        setSchedules(json.data?.schedules || []);
        setAllowedTypes(json.meta?.allowed_types || []);
        setAllowedFormats(json.meta?.allowed_formats || []);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const hasExamType = newForm.types.some((x) => EXAM_EXPORT_TYPES.includes(x));

  // Dropdown options for the exam filters (same endpoint Exam Analytics uses), loaded once on demand.
  useEffect(() => {
    if (!hasExamType || examOptions) return;
    api.get('/api/v1/data-analysis/exams/filters')
      .then((j) => setExamOptions(j.data || j))
      .catch(() => setExamOptions({ universities: [], faculties: [], courses: [], exam_types: [] }));
  }, [hasExamType, examOptions]);

  const setExamFilter = (key, value) => setExamFilters((f) => {
    const next = { ...f, [key]: value };
    if (key === 'university_id') { next.faculty_id = ''; next.course_id = ''; }
    if (key === 'faculty_id') next.course_id = '';
    return next;
  });

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

  function toggleType(type) {
    setNewForm((f) => ({ ...f, types: f.types.includes(type) ? f.types.filter((x) => x !== type) : [...f.types, type] }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (newForm.types.length === 0) return;
    setCreating(true);
    setActionError(null);
    try {
      const filters = Object.fromEntries(Object.entries(examFilters).filter(([, v]) => v !== ''));
      await api.post('/api/v1/data-analysis/exports', {
        export_type: newForm.types,
        format: newForm.format,
        lang: fileLang,
        recipient_email: newForm.email || null,
        ...(hasExamType && Object.keys(filters).length ? { filters } : {}),
      });
      setNewForm({ types: [], format: 'csv', email: '' });
      setExamFilters(EMPTY_EXAM_FILTERS);
      setDrawerOpen(false);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  function toggleSelect(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1>{t('Exports')}</h1>
          <p className="text-small">{t('Real CSV, Excel, and PDF exports of platform metrics, ready to download immediately.')}</p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="btn btn-primary" onClick={() => setDrawerOpen(true)}>
            <Icon name="plus" size={16} /> {t('New / Batch Export')}
          </button>
        </div>
      </div>

      {actionError && <p style={{ color: 'var(--color-danger)' }}>{actionError}</p>}

      <div style={{ marginBottom: 'var(--space-6)' }}>
        <div className="card glass-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
            <h3 className="text-h3" style={{ margin: 0 }}>{t('Scheduled Exports')}</h3>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setScheduling(true)}>
              <Icon name="plus-circle" size={16} /> {t('Create schedule')}
            </button>
          </div>
          {schedules.length === 0 && <p className="text-caption">{t('No schedules yet.')}</p>}
          {schedules.map((s) => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <div>
                <p className="text-small" style={{ margin: 0, fontWeight: 600 }}>{labelFor(t, s.export_type)}</p>
                <span className="text-caption">
                  {s.frequency === 'custom' ? t('every %d days').replace('%d', s.custom_interval_days) : s.frequency} · {s.recipient_email} · {Number(s.is_active) ? t('Active') : t('Paused')}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button type="button" className="btn btn-ghost btn-sm" title={t('Run now')} onClick={() => runAction(api.post(`/api/v1/data-analysis/exports/schedules/${s.id}/run-now`))}>
                  <Icon name="refresh" size={16} />
                </button>
                <button type="button" className="btn btn-ghost btn-sm" title={Number(s.is_active) ? t('Pause') : t('Resume')} onClick={() => runAction(api.post(`/api/v1/data-analysis/exports/schedules/${s.id}/toggle`))}>
                  <Icon name={Number(s.is_active) ? 'x-circle' : 'check-circle'} size={16} />
                </button>
                <button type="button" className="btn btn-ghost btn-sm" title={t('Delete')} onClick={() => { if (confirm(t('Delete this schedule?'))) runAction(api.del(`/api/v1/data-analysis/exports/schedules/${s.id}`)); }}>
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
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
            {selected.length > 0 && (
              <button type="button" className="btn btn-outline btn-sm" onClick={() => { if (confirm(`${selected.length} ${t('selected export(s)?')}`)) runAction(api.post('/api/v1/data-analysis/exports/delete-selected', { ids: selected })); }}>
                <Icon name="trash" size={16} /> {t('Delete Selected')}
              </button>
            )}
            {exportsRows.length > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (confirm(t('Delete all exports? This cannot be undone.'))) runAction(api.post('/api/v1/data-analysis/exports/delete-all')); }}>
                <Icon name="trash" size={16} /> {t('Delete All')}
              </button>
            )}
          </div>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr><th></th><th>{t('Data (select more than one for a batch export)')}</th><th>{t('Format')}</th><th>{t('Status')}</th><th>{t('Date')}</th><th></th></tr>
              </thead>
              <tbody>
                {exportsRows.map((r) => (
                  <tr key={r.id}>
                    <td><input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleSelect(r.id)} /></td>
                    <td>
                      {labelFor(t, r.export_type)}
                      {r.batch_id && <span className="badge badge-neutral" style={{ marginInlineStart: 'var(--space-2)' }}>{t('batch')}</span>}
                      {r.email_to && <span className="badge badge-neutral" style={{ marginInlineStart: 'var(--space-2)' }}>{t('emailed')}</span>}
                    </td>
                    <td>{String(r.format).toUpperCase()}</td>
                    <td><span className={`badge ${STATUS_BADGE[r.status] || 'badge-neutral'}`}>{r.status}</span></td>
                    <td>{r.created_at ? r.created_at.slice(0, 10) : ''}</td>
                    <td><div className="row-actions">
                      {r.status === 'completed' && r.file_path && (
                        <button type="button" className="btn btn-ghost btn-sm" title={t('Preview')} aria-label={t('Preview')} onClick={() => setPreviewRow(r)}>
                          <Icon name="eye" size={16} />
                        </button>
                      )}
                      {r.status === 'completed' && r.file_path && (
                        <StoredFileDownload path={`/${r.file_path}`} format={r.format} label={t('Download')} />
                      )}
                      <button type="button" className="btn btn-ghost btn-sm" title={t('Delete')} onClick={() => { if (confirm(t('Delete this export?'))) runAction(api.del(`/api/v1/data-analysis/exports/${r.id}`)); }}>
                        <Icon name="trash" size={16} />
                      </button>
                    </div></td>
                  </tr>
                ))}
                {exportsRows.length === 0 && (
                  <tr><td colSpan={6} className="text-small" style={{ padding: 'var(--space-5)', textAlign: 'center' }}>{t('No exports yet.')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Drawer open={drawerOpen} title={t('New / Batch Export')} subtitle={t('Your export will be generated in the background.')} onClose={() => setDrawerOpen(false)}>
        <form onSubmit={handleCreate} className="exp-form">
            <fieldset className="exp-field">
              <legend className="exp-field__label">{t('Data (select more than one for a batch export)')}</legend>
              <div className="exp-choices">
                {allowedTypes.map((type) => {
                  const on = newForm.types.includes(type);
                  return (
                    <label key={type} className={`exp-choice${on ? ' is-on' : ''}`}>
                      <input type="checkbox" className="exp-choice__input" checked={on} onChange={() => toggleType(type)} />
                      <span className="exp-choice__text">{labelFor(t, type)}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {hasExamType && examOptions && (() => {
              const faculties = (examOptions.faculties || []).filter((x) => !examFilters.university_id || x.university_id === Number(examFilters.university_id));
              const courses = (examOptions.courses || []).filter((x) => (!examFilters.university_id || x.university_id === Number(examFilters.university_id))
                && (!examFilters.faculty_id || x.faculty_id === Number(examFilters.faculty_id)));
              return (
                <fieldset className="exp-field">
                  <legend className="exp-field__label">{t('Exam filters (optional)')}</legend>
                  <select className="form-input" value={examFilters.university_id} onChange={(e) => setExamFilter('university_id', e.target.value)}>
                    <option value="">{t('All universities')}</option>
                    {(examOptions.universities || []).map((x) => <option key={x.id} value={x.id}>{x.name?.en || x.name?.ar}</option>)}
                  </select>
                  <select className="form-input" value={examFilters.faculty_id} onChange={(e) => setExamFilter('faculty_id', e.target.value)}>
                    <option value="">{t('All faculties')}</option>
                    {faculties.map((x) => <option key={x.id} value={x.id}>{x.name?.en || x.name?.ar}</option>)}
                  </select>
                  <select className="form-input" value={examFilters.course_id} onChange={(e) => setExamFilter('course_id', e.target.value)}>
                    <option value="">{t('All courses')}</option>
                    {courses.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name?.en || x.name?.ar}</option>)}
                  </select>
                  <select className="form-input" value={examFilters.exam_type} onChange={(e) => setExamFilter('exam_type', e.target.value)}>
                    <option value="">{t('All exam types')}</option>
                    {(examOptions.exam_types || []).map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <label className="text-small" style={{ flex: 1 }}>{t('From')}
                      <input className="form-input" type="date" value={examFilters.from} onChange={(e) => setExamFilter('from', e.target.value)} />
                    </label>
                    <label className="text-small" style={{ flex: 1 }}>{t('To')}
                      <input className="form-input" type="date" value={examFilters.to} onChange={(e) => setExamFilter('to', e.target.value)} />
                    </label>
                  </div>
                </fieldset>
              );
            })()}
            <fieldset className="exp-field">
              <legend className="exp-field__label">{t('Format')}</legend>
              <div className="exp-segment" role="radiogroup">
                {allowedFormats.map((f) => (
                  <label key={f} className={`exp-segment__item${newForm.format === f ? ' is-on' : ''}`}>
                    <input type="radio" name="export-format" className="exp-segment__input" value={f} checked={newForm.format === f} onChange={() => setNewForm((x) => ({ ...x, format: f }))} />
                    {f.toUpperCase()}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="exp-field">
              <legend className="exp-field__label">{t('File language')}</legend>
              <div className="exp-segment" role="radiogroup">
                {[['ar', 'العربية'], ['en', 'English']].map(([code, name]) => (
                  <label key={code} className={`exp-segment__item${fileLang === code ? ' is-on' : ''}`}>
                    <input type="radio" name="export-lang" className="exp-segment__input" value={code} checked={fileLang === code} onChange={() => setFileLang(code)} />
                    {name}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="exp-field">
              <label className="exp-field__label" htmlFor="export-email">{t('Email delivery (optional)')}</label>
              <input id="export-email" className="form-input" type="text" value={newForm.email} onChange={(e) => setNewForm((f) => ({ ...f, email: e.target.value }))} placeholder={t('One or more emails, comma-separated')} />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={creating || newForm.types.length === 0}>
              <Icon name="download" size={16} /> {creating ? '…' : t('Export Now')}
            </button>
          </form>
      </Drawer>

      {previewRow && <PreviewModal row={previewRow} onClose={() => setPreviewRow(null)} />}

      {scheduling && (
        <ScheduleModal
          allowedTypes={allowedTypes}
          allowedFormats={allowedFormats}
          onClose={() => setScheduling(false)}
          onDone={(err) => { setScheduling(false); if (err) setActionError(err); else load(); }}
        />
      )}
    </>
  );
}

function PreviewModal({ row, onClose }) {
  const t = useTranslations(translations);
  const isPdf = String(row.format).toLowerCase() === 'pdf';
  const fileUrl = `/${row.file_path}`;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!isPdf);
  // The PDF is fetched through the authenticated client and shown from a blob: URL.
  // Pointing the iframe straight at /uploads/... is refused by the browser now that
  // the site (Vercel) and the API send X-Frame-Options: DENY / frame-ancestors 'none'.
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfError, setPdfError] = useState(null);
  // Mobile browsers (Android Chrome, iOS Safari) cannot render a PDF inside an <iframe> - they show a
  // broken-page icon. There we skip the iframe and offer Open / Download instead.
  const inlinePdf = typeof navigator === 'undefined'
    || (navigator.pdfViewerEnabled !== false && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

  useEffect(() => {
    if (!isPdf) return undefined;
    let cancelled = false;
    let objectUrl = null;
    (async () => {
      try {
        const res = await api.blob(fileUrl);
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        setPdfUrl(objectUrl);
      } catch (err) {
        if (!cancelled) setPdfError(errorMessage(err));
      }
    })();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [isPdf, fileUrl]);

  useEffect(() => {
    if (isPdf) return undefined;
    let cancelled = false;
    api.get(`/api/v1/data-analysis/exports/${row.id}/preview`)
      .then((res) => { if (!cancelled) { setData(res.data); setLoading(false); } })
      .catch((err) => { if (!cancelled) { setError(errorMessage(err)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [row.id, isPdf]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box card glass-panel"
        style={{ width: 'min(1100px, 95vw)', maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('Preview')}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
          <h2 className="modal-box__title text-h3" style={{ margin: 0 }}>
            {labelFor(t, row.export_type)}
            <span className="badge badge-neutral" style={{ marginInlineStart: 'var(--space-2)' }}>{String(row.format).toUpperCase()}</span>
          </h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label={t('Close')} title={t('Close')}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {isPdf && !pdfUrl && !pdfError && <p className="text-small">…</p>}
          {isPdf && pdfError && <p className="form-error">{pdfError}</p>}
          {isPdf && pdfUrl && !inlinePdf && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-6) var(--space-3)', textAlign: 'center' }}>
              <Icon name="file" size={40} />
              <p className="text-small" style={{ margin: 0 }}>{t('PDF preview is not available on this device. Open or download the file instead.')}</p>
            </div>
          )}
          {isPdf && pdfUrl && inlinePdf && (
            <iframe
              title={t('Preview')}
              src={`${pdfUrl}#view=FitH`}
              style={{ width: '100%', height: '70vh', border: '1px solid var(--border-subtle, #e5e7eb)', borderRadius: 8, background: '#fff' }}
            />
          )}

          {!isPdf && loading && <p className="text-small">…</p>}
          {!isPdf && error && <p className="form-error">{error}</p>}
          {!isPdf && data && (
            <>
              <p className="text-small" style={{ marginBottom: 'var(--space-2)' }}>
                {data.truncated
                  ? `${t('Showing the first')} ${data.rows.length} ${t('of')} ${data.total} ${t('rows')}`
                  : `${data.total} ${t('rows')}`}
              </p>
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>{data.header.map((h, i) => <th key={i}>{String(h)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {data.rows.map((cells, ri) => (
                      <tr key={ri}>{data.header.map((_, ci) => <td key={ci}>{String(cells[ci] ?? '')}</td>)}</tr>
                    ))}
                    {data.rows.length === 0 && (
                      <tr><td colSpan={Math.max(data.header.length, 1)} className="text-small" style={{ textAlign: 'center', padding: 'var(--space-4)' }}>—</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="modal-box__actions" style={{ marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
          {isPdf && <a className="btn btn-outline" href={pdfUrl || fileUrl} target="_blank" rel="noreferrer">{t('Open in new tab')}</a>}
          <button type="button" className="btn btn-outline" onClick={onClose}>{t('Close')}</button>
          <StoredFileDownload path={fileUrl} format={row.format} className="btn btn-primary" iconOnly={false} label={t('Download')} />
        </div>
      </div>
    </div>
  );
}

function ScheduleModal({ allowedTypes, allowedFormats, onClose, onDone }) {
  const t = useTranslations(translations);
  const [exportType, setExportType] = useState(allowedTypes[0] || '');
  const [frequency, setFrequency] = useState('weekly');
  const [customDays, setCustomDays] = useState(7);
  const [format, setFormat] = useState(allowedFormats[0] || 'csv');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/v1/data-analysis/exports/schedules', {
        export_type: exportType,
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
            <label className="form-label">{t('Data (select more than one for a batch export)')}</label>
            <select className="form-input" value={exportType} onChange={(e) => setExportType(e.target.value)}>
              {allowedTypes.map((tp) => <option key={tp} value={tp}>{labelFor(t, tp)}</option>)}
            </select>
            {EXAM_EXPORT_TYPES.includes(exportType) && (
              <p className="text-caption" style={{ margin: 'var(--space-1) 0 0' }}>{t('Scheduled exam exports include all exam data (no filters).')}</p>
            )}
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
              {allowedFormats.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('One or more emails, comma-separated')}</label>
            <input className="form-input" value={email} onChange={(e) => setEmail(e.target.value)} required />
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
