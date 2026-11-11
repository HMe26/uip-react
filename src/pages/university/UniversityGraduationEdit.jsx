import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/university/graduation-edit';

const translations = { ...i18nCommon, ...i18nPage };

const FIELDS = [
  ['graduation_date', 'Graduation date', 'date'],
  ['final_gpa', 'Final GPA', 'number'],
  ['degree_title_ar', 'Degree title (Arabic)', 'text'],
  ['degree_title_en', 'Degree title (English)', 'text'],
  ['faculty_name_ar', 'Faculty name (Arabic)', 'text'],
  ['faculty_name_en', 'Faculty name (English)', 'text'],
  ['department_name_ar', 'Department name (Arabic)', 'text'],
  ['department_name_en', 'Department name (English)', 'text'],
];

/**
 * Mirrors app/Views/university/graduation-edit.php — a direct edit of an
 * already-issued certificate's snapshot fields. Data comes from
 * GET /api/v1/graduation/{studentId} -> transcript.graduation (App\
 * Controllers\Api\GraduationApiController::show(), same
 * GraduationService::editCertificate() write path via PATCH .../{studentId}).
 */
export default function UniversityGraduationEdit() {
  const { id } = useParams();
  const t = useTranslations(translations);
  const { locale } = useLanguage();

  const [student, setStudent] = useState(null);
  const [record, setRecord] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get(`/api/v1/graduation/${id}`)
      .then((json) => {
        const transcript = json.data?.transcript || {};
        setStudent(transcript.student || null);
        const g = transcript.graduation || null;
        setRecord(g);
        setForm({
          graduation_date: g?.graduation_date || '',
          final_gpa: g?.final_gpa ?? '',
          degree_title_ar: g?.degree_title_ar || '',
          degree_title_en: g?.degree_title_en || '',
          faculty_name_ar: g?.faculty_name_ar || '',
          faculty_name_en: g?.faculty_name_en || '',
          department_name_ar: g?.department_name_ar || '',
          department_name_en: g?.department_name_en || '',
          notes: g?.notes || '',
        });
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!window.confirm(locale === 'ar' ? 'حفظ التعديلات على الشهادة؟ سيتم إخطار الطالب.' : 'Save changes to this certificate? The student will be notified.')) return;

    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await api.patch(`/api/v1/graduation/${id}`, form);
      setSaved(true);
      load();
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-small">{t('Loading…')}</p>;
  if (error) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{(locale === 'ar' ? student?.name_ar : student?.name_en) || student?.full_name || '—'}</h1>
          <p className="text-small">
            {t('Certificate #: ')}{record?.certificate_number || ''}
            &nbsp;·&nbsp;
            {t('Student #: ')}{student?.student_number || '—'}
          </p>
        </div>
      </div>

      {!record ? (
        <div className="card glass-panel">
          <p className="text-small text-muted">{t('No approved certificate for this student.')}</p>
        </div>
      ) : (
        <div className="card glass-panel">
          <p className="text-small text-muted" style={{ marginBottom: 'var(--space-4)' }}>
            {t('Direct edit of an already-issued certificate. The certificate number and status never change here. Every edit is logged, and the student is notified.')}
          </p>

          {saveError && <p style={{ color: 'var(--color-danger)' }}>{saveError}</p>}
          {saved && <p style={{ color: 'var(--color-success)' }}>{locale === 'ar' ? 'تم الحفظ.' : 'Saved.'}</p>}

          <form onSubmit={handleSubmit}>
            {FIELDS.map(([key, label, type]) => (
              <div className="form-group" key={key}>
                <label className="form-label">{t(label)}</label>
                <input
                  className="form-input"
                  type={type}
                  step={type === 'number' ? '0.01' : undefined}
                  min={type === 'number' ? '0' : undefined}
                  max={type === 'number' ? '4' : undefined}
                  value={form[key] ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}

            <div className="form-group">
              <label className="form-label">{t('Internal notes')}</label>
              <textarea className="form-input" rows={3} value={form.notes ?? ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <Icon name="check" size={14} /> {t('Save Changes')}
              </button>
              <Link to={`/university/graduation/${id}/certificate`} target="_blank" className="btn btn-outline">
                <Icon name="award" size={14} /> {t('Preview Certificate')}
              </Link>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
