import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import StoredFileDownload from '../../components/StoredFileDownload';
import FilePreviewButton from '../../components/FilePreviewButton';
import { PageHead, StatusPill, FilterSelect, Modal, EmptyState, ErrorNote, TableSkeleton, fmtDateTime } from '../../components/security/ui';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nSecurity from '../../i18n/security/common';
import i18nPage from '../../i18n/security/reports';
import i18nDesign from '../../i18n/security/design';

const translations = {
  ...i18nCommon, ...i18nSecurity, ...i18nPage, ...i18nDesign,
  'Generate a security report': 'إنشاء تقرير أمني', 'Recent reports': 'أحدث التقارير', 'Delete report': 'حذف التقرير', 'Delete': 'حذف', 'Deleting…': 'جارٍ الحذف…',
  'Workspace / Reports': 'مساحة العمل / التقارير', 'Choose a report type and an export format.': 'اختر نوع التقرير وصيغة التصدير.', 'Generating…': 'جارٍ الإنشاء…',
};

/**
 * Mirrors app/Views/security/reports.php, talking to the real JSON API
 * (app/Controllers/Api/SecurityReportsApiController.php,
 * /api/v1/security/reports/* — list (scoped to the caller, via
 * ReportRepository::forUser), generate, delete; reuses ReportRepository/
 * ReportService exactly as the server-rendered view does).
 */

const REPORT_TYPES = [
  { key: 'security_incident_summary', icon: 'alert-triangle' },
  { key: 'vulnerability_summary', icon: 'wrench' },
];
const FORMATS = [
  { key: 'csv', en: 'CSV', ar: 'CSV' },
  { key: 'xlsx', en: 'Excel (.xlsx)', ar: 'إكسل (.xlsx)' },
  { key: 'pdf', en: 'PDF', ar: 'PDF' },
  { key: 'json', en: 'JSON', ar: 'JSON' },
  { key: 'docx', en: 'Word (.docx)', ar: 'وورد (.docx)' },
];

export default function SecurityReports() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();

  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [reportType, setReportType] = useState(REPORT_TYPES[0].key);
  const [format, setFormat] = useState('csv');
  const [generating, setGenerating] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return api.get('/api/v1/security/reports')
      .then((json) => setReports(json.data || []))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const typeLabel = (key) => t(key === 'security_incident_summary' ? 'Security Incident Summary' : key === 'vulnerability_summary' ? 'Vulnerability Summary' : key);

  const handleGenerate = (e) => {
    e.preventDefault();
    setFormError(null);
    setGenerating(true);
    api.post('/api/v1/security/reports/generate', { report_type: reportType, format })
      .then(() => load())
      .catch((err) => setFormError(errorMessage(err)))
      .finally(() => setGenerating(false));
  };

  const handleDelete = () => {
    setDeleting(true);
    api.del(`/api/v1/security/reports/${toDelete.id}`)
      .then(() => { setToDelete(null); return load(); })
      .catch((err) => { setError(errorMessage(err)); setToDelete(null); })
      .finally(() => setDeleting(false));
  };

  return (
    <div className="sec-page">
      <PageHead eyebrow={t('Workspace / Reports')} title={t('Security Reports')} subtitle={t('Real reports (CSV / Excel / PDF / JSON / Word) about security incidents and vulnerabilities.')} />
      <ErrorNote>{error}</ErrorNote>

      <section className="sec-card">
        <div className="sec-card__head"><div><h2>{t('Generate a security report')}</h2><p>{t('Choose a report type and an export format.')}</p></div></div>
        <form className="sec-card__body" onSubmit={handleGenerate}>
          <ErrorNote>{formError}</ErrorNote>
          <div className="sec-report-form" style={{ marginTop: formError ? 12 : 0 }}>
            <div role="radiogroup" aria-label={t('Report')} className="sec-report-types">
              {REPORT_TYPES.map((rt) => (
                <label key={rt.key} className={`sec-report-type${reportType === rt.key ? ' is-selected' : ''}`}>
                  <input type="radio" name="report_type" checked={reportType === rt.key} onChange={() => setReportType(rt.key)} />
                  <span className="sec-report-type__icon"><Icon name={rt.icon} size={18} /></span>
                  <span>{typeLabel(rt.key)}</span>
                </label>
              ))}
            </div>
            <FilterSelect label={t('Export format')} value={format} onChange={setFormat} options={FORMATS.map((f) => ({ value: f.key, label: locale === 'ar' ? f.ar : f.en }))} />
            <button type="submit" className="btn btn-primary" disabled={generating}><Icon name="file" size={16} /> {generating ? t('Generating…') : t('Generate report')}</button>
          </div>
        </form>
      </section>

      <section className="sec-card sec-card--flush">
        <div className="sec-card__head" style={{ paddingBottom: 14 }}><div><h2>{t('Recent reports')}</h2></div></div>
        <div className="sec-table-wrap">
          <table className="sec-table">
            <thead><tr><th>{t('Report')}</th><th>{t('Format')}</th><th>{t('Generated')}</th><th>{t('Status')}</th><th className="col-actions">{t('Action')}</th></tr></thead>
            {loading && !reports.length ? <TableSkeleton cols={5} rows={3} /> : (
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{typeLabel(r.report_type)}</strong><span className="sub mono">#{r.id}</span></td>
                    <td><span className="pill pill--neutral">{String(r.format).toUpperCase()}</span></td>
                    <td className="muted">{fmtDateTime(r.created_at)}</td>
                    <td><StatusPill status={r.status === 'ready' ? 'resolved' : 'neutral'} text={r.status === 'ready' ? t('ready') : r.status} /></td>
                    <td className="col-actions">
                      <div className="sec-row-actions">
                        {r.status === 'ready' && r.file_path ? <FilePreviewButton path={`/${String(r.file_path).replace(/^\//, '')}`} format={r.format} title={typeLabel(r.report_type)} className="btn-tint" iconSize={13} label /> : <span className="sec-row-actions__ph" />}
                        {r.status === 'ready' && r.file_path ? <StoredFileDownload path={`/${String(r.file_path).replace(/^\//, '')}`} format={r.format} filename={`report-${r.id}`} title={typeLabel(r.report_type)} className="btn-tint" iconOnly={false} iconSize={13} label={t('Download')} /> : <span className="sec-row-actions__ph" />}
                        <button type="button" className="icon-btn" style={{ color: 'var(--sev-critical)' }} onClick={() => setToDelete(r)} aria-label={t('Delete')}><Icon name="trash" size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {!loading && reports.length === 0 && <EmptyState icon="file">{t('No reports yet.')}</EmptyState>}
      </section>

      <Modal open={!!toDelete} tone="danger" onClose={() => setToDelete(null)} title={t('Delete report')}
        footer={(<><button type="button" className="btn btn-outline" onClick={() => setToDelete(null)}>{t('Cancel')}</button><button type="button" className="btn btn-danger" disabled={deleting} onClick={handleDelete}>{deleting ? t('Deleting…') : t('Delete')}</button></>)}>
        <div className="sec-modal__notice">{t('Permanently delete this report? The generated file will be deleted too.')}</div>
        {toDelete && <strong>{typeLabel(toDelete.report_type)} <span className="muted mono">#{toDelete.id}</span></strong>}
      </Modal>
    </div>
  );
}
