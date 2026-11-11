import { useEffect, useState, useCallback } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { usePageMeta } from '../../context/PageMetaContext';
import { Kpi, Pill, StModal, EmptyState, Skeleton } from '../../components/student/stUi';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/student/patents';

const translations = { ...i18nCommon, ...i18nPage };

const STATUS_BADGE = {
  draft: { cls: 'badge-neutral', en: 'Draft', ar: 'مسودة' },
  submitted: { cls: 'badge-primary', en: 'Submitted', ar: 'مُقدَّمة' },
  under_review: { cls: 'badge-primary', en: 'Under Review', ar: 'قيد المراجعة' },
  granted: { cls: 'badge-success', en: 'Granted', ar: 'ممنوحة' },
  rejected: { cls: 'badge-danger', en: 'Rejected', ar: 'مرفوضة' },
};

/**
 * Mirrors app/Views/student/patents.php, talking to /api/v1/patents
 * (App\Controllers\Api\PatentsApiController, reusing PatentService::
 * listForStudent()/linkableProjects()/submit() exactly as
 * Student\StudentPatentController does).
 */
export default function StudentPatents() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  usePageMeta(ar ? 'بوابة براءات الاختراع' : 'Patent Portal', ar ? 'تابع المعلومات المتعلقة ببراءات الاختراع وحماية الابتكار لمشاريعك المؤهلة.' : 'Track patent-related information and innovation protection for eligible projects.');
  const [modalOpen, setModalOpen] = useState(false);
  const [flash, setFlash] = useState(null);

  const [patents, setPatents] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('');
  const [appNumber, setAppNumber] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/api/v1/patents')
      .then((json) => {
        setPatents(json.data.patents || []);
        setProjects(json.data.projects || []);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await api.post('/api/v1/patents', {
        title: title.trim(),
        project_id: projectId || null,
        application_number: appNumber || null,
      });
      setTitle(''); setProjectId(''); setAppNumber('');
      setModalOpen(false);
      setFlash(ar ? 'تم تقديم طلب البراءة للمراجعة.' : 'Patent request submitted for review.');
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Skeleton h={90} count={3} />;
  if (error) return <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>;

  const underReview = patents.filter((p) => p.status === 'submitted' || p.status === 'under_review').length;
  const granted = patents.filter((p) => p.status === 'granted').length;

  return (
    <div className="st-page">
      <div className="st-grid st-grid--4">
        <Kpi small label={ar ? 'مشاريع مؤهلة' : 'Eligible Projects'} value={projects.length} />
        <Kpi small label={ar ? 'طلبات البراءات' : 'Patent Requests'} value={patents.length} />
        <Kpi small label={ar ? 'قيد المراجعة' : 'Under Review'} value={underReview} />
        <Kpi small label={ar ? 'ممنوحة' : 'Granted'} value={granted} />
      </div>

      <div className="st-page__actions">
        <button type="button" className="btn btn-primary" onClick={() => { setActionError(null); setModalOpen(true); }}>
          {ar ? 'بدء طلب براءة' : 'Start Patent Request'}
        </button>
      </div>

      {flash && (
        <div className="st-alert st-alert--success">
          <Icon name="check-circle" size={16} /><span style={{ flex: 1 }}>{flash}</span>
          <button type="button" className="st-link" onClick={() => setFlash(null)} aria-label={locale === 'ar' ? 'إغلاق' : 'Dismiss'}><Icon name="x" size={14} /></button>
        </div>
      )}

      <section>
        <h2 style={{ fontSize: 15, marginBottom: 10 }}>{ar ? 'طلبات البراءات' : 'Patent Requests'}</h2>
        {patents.length === 0 ? (
          <EmptyState icon="shield" title={t('No patent filings yet')} text={ar ? 'ابدأ طلب البراءة الأول لحماية ابتكارك.' : 'Start your first patent request to protect your innovation.'} />
        ) : (
          <div className="st-panel st-panel--flush st-table-wrap">
            <table className="st-table">
              <thead><tr>
                <th>{ar ? 'عنوان الاختراع' : 'Invention'}</th>
                <th>{ar ? 'المشروع' : 'Project'}</th>
                <th>{ar ? 'رقم الطلب' : 'Application #'}</th>
                <th>{ar ? 'الحالة' : 'Status'}</th>
              </tr></thead>
              <tbody>
                {patents.map((p) => {
                  const badge = STATUS_BADGE[p.status] || STATUS_BADGE.draft;
                  const tone = p.status === 'granted' ? 'success' : p.status === 'rejected' ? 'danger' : p.status === 'draft' ? 'neutral' : '';
                  const projectTitle = p[`project_title_${locale}`] || p.project_title_en || null;
                  return (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.title}</td>
                      <td className="st-muted">{projectTitle || '—'}</td>
                      <td className="st-muted">{p.application_number || '—'}</td>
                      <td><Pill tone={tone}>{badge[locale] || badge.en}</Pill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalOpen && (
        <StModal
          wide
          title={ar ? 'بدء طلب براءة' : 'Start Patent Request'}
          onClose={() => setModalOpen(false)}
          actions={(
            <>
              <button type="button" className="btn btn-outline" onClick={() => setModalOpen(false)}>{ar ? 'إلغاء' : 'Cancel'}</button>
              <button type="submit" form="patent-form" className="btn btn-primary" disabled={submitting || !title.trim()}>{ar ? 'إرسال' : 'Submit'}</button>
            </>
          )}
        >
          <form id="patent-form" className="st-form" onSubmit={onSubmit} style={{ marginTop: 12 }}>
            {actionError && <p className="st-form__error">{actionError}</p>}
            <div className="st-field">
              <label className="st-label">{t('Invention title')}</label>
              <input className="form-input" type="text" required value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="st-field">
              <label className="st-label">{t('Linked project (optional)')}</label>
              <select className="form-select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">{t('None')}</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
            <div className="st-field">
              <label className="st-label">{t('Application number (optional)')}</label>
              <input className="form-input" type="text" value={appNumber} onChange={(e) => setAppNumber(e.target.value)} />
            </div>
          </form>
        </StModal>
      )}
    </div>
  );
}
