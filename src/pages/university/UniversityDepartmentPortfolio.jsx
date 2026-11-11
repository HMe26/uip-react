import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { Alert, Field, Mono, Pill, Skeletons, Stat, Switch, hueOf } from '../../components/university/umUi';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/university/department-portfolio';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Twin of UniversityFacultyPortfolio.jsx, one level deeper — talks to the
 * new GET/PATCH /api/v1/departments/{id}, POST /api/v1/departments/{id}/
 * archive|unarchive
 * (FacultyApiController::showDepartment()/updateDepartment()/
 * archiveDepartment()/unarchiveDepartment()). Departments have no login of their own (no user_id
 * column on the Department model), so there's no login card here unlike
 * the faculty page.
 */
export default function UniversityDepartmentPortfolio() {
  const { id } = useParams();
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [department, setDepartment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [visBusy, setVisBusy] = useState(false);

  // `silent` reloads keep the page on screen (no skeleton flash) after an action.
  const load = useCallback((silent) => {
    if (!silent) setLoading(true);
    setError(null);
    api.get(`/api/v1/departments/${id}`)
      .then((json) => {
        setDepartment(json.data?.department || null);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleVisibility(next) {
    setActionError(null);
    setVisBusy(true);
    try {
      await api.patch(`/api/v1/departments/${id}`, { is_public: next ? 1 : 0 });
      load(true);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setVisBusy(false);
    }
  }

  async function handleDetailsSave(nameEn, nameAr, description) {
    await api.patch(`/api/v1/departments/${id}`, { name_en: nameEn, name_ar: nameAr, description });
    load(true);
  }

  async function handleArchive() {
    const confirmMsg = ar
      ? 'أرشفة القسم؟ هيختفي من قائمة الأقسام، وطلابه وأعضاء هيئة تدريسه هيفضلوا محفوظين وتقدر ترجعه في أي وقت.'
      : "Archive this department? It'll disappear from the department list; its students and staff stay saved and you can restore it anytime.";
    if (!window.confirm(confirmMsg)) return;
    setActionError(null);
    try {
      await api.post(`/api/v1/departments/${id}/archive`, {});
      load(true);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleUnarchive() {
    setActionError(null);
    try {
      await api.post(`/api/v1/departments/${id}/unarchive`, {});
      load(true);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  if (loading) {
    return <div className="um-page"><Skeletons n={1} h={130} /><Skeletons n={2} h={220} /></div>;
  }
  if (error) return <div className="um-page"><Alert>{error}</Alert></div>;
  if (!department) return null;

  const name = ar ? (department.name_ar || department.name_en || '') : (department.name_en || department.name_ar || '');
  const facultyName = ar ? (department.faculty_name_ar || department.faculty_name_en || '') : (department.faculty_name_en || department.faculty_name_ar || '');
  const archived = department.status === 'archived';
  const hue = hueOf(department.id);

  return (
    <div className="um-page animate-rise-in">
      <Link to={`/university/faculties/${department.faculty_id}/portfolio`} className="um-back">
        <Icon name={ar ? 'arrow-right' : 'arrow-left'} size={14} /> {facultyName || t('Back to Faculty Portfolio')}
      </Link>

      <section className="um-hero" data-hue={hue}>
        <Mono name={name} hue={hue} size="lg" />
        <div className="um-hero__text">
          <h1>{name}</h1>
          <p className="um-hero__desc">
            {department.description || (ar ? 'الملف العام للقسم — إحصاءاته وظهوره العام.' : "The department's portfolio — its stats and public visibility.")}
          </p>
          <div className="um-hero__pills">
            {archived && <Pill tone="warning"><Icon name="archive" size={12} /> {ar ? 'مؤرشف' : 'Archived'}</Pill>}
            <Pill tone={department.is_public ? 'success' : 'muted'} dot={false}>
              <Icon name={department.is_public ? 'eye' : 'eye-off'} size={12} /> {department.is_public ? t('Public') : t('Private')}
            </Pill>
          </div>
        </div>
        <div className="um-hero__act">
          {archived ? (
            <button type="button" className="btn btn-outline" onClick={handleUnarchive}><Icon name="refresh" size={14} /> {ar ? 'استرجاع' : 'Restore'}</button>
          ) : (
            <button type="button" className="btn btn-outline" onClick={handleArchive}><Icon name="archive" size={14} /> {ar ? 'أرشفة' : 'Archive'}</button>
          )}
        </div>
      </section>

      {actionError && <Alert>{actionError}</Alert>}

      {archived && (
        <Alert tone="warn">
          {ar
            ? 'القسم ده مؤرشف — مش هيظهر في القوائم أو الدليل العام، وكل بياناته (الطلاب/أعضاء هيئة التدريس) لسه محفوظة. اضغط "استرجاع" عشان ترجّعه.'
            : 'This department is archived — it won\'t show in lists or the public directory. All its data (students/staff) is still saved. Click "Restore" to bring it back.'}
        </Alert>
      )}

      <div className="um-stats" style={{ '--n': 3 }}>
        <Stat icon="users" tone="success" value={department.students_count} label={ar ? 'الطلاب' : 'Students'} />
        <Stat icon="user" tone="warning" value={department.academic_staff_count} label={ar ? 'أعضاء هيئة التدريس' : 'Academic Staff'} />
        <Stat icon="folder" tone="muted" value={department.published_projects_count} label={ar ? 'مشاريع منشورة' : 'Published Projects'} />
      </div>

      <div className="um-layout">
        <div className="um-stack">
          <section className="um-panel">
            <div className="um-panel__head"><h2>{t('Department Details')}</h2></div>
            <EditDepartmentForm department={department} onSave={handleDetailsSave} />
          </section>
        </div>

        <aside className="um-aside">
          <section className="um-panel">
            <div className="um-panel__head"><h2>{t('Profile Visibility')}</h2></div>
            <div className="um-toggle-row">
              <div className="um-toggle-row__text">
                <strong>{t('Make profile public')}</strong>
                <span>{ar ? 'عند التفعيل، يقدر أي حد معاه الرابط يشوف القسم ومشاريعه المنشورة.' : "When on, anyone with the link can view this department and its published projects."}</span>
              </div>
              <Switch on={!!department.is_public} disabled={visBusy} onChange={handleVisibility} onLabel={t('Public')} offLabel={t('Private')} label={t('Make profile public')} />
            </div>
          </section>

          {facultyName && (
            <section className="um-panel">
              <div className="um-panel__head"><h2>{t('Faculty')}</h2></div>
              <Link to={`/university/faculties/${department.faculty_id}/portfolio`} className="um-row" style={{ padding: 0, border: 0, textDecoration: 'none', color: 'inherit' }}>
                <Mono name={facultyName} hue={hueOf(department.faculty_id)} size="sm" />
                <div className="um-row__main"><h3 className="um-row__name">{facultyName}</h3></div>
                <Icon name={ar ? 'chevron-left' : 'chevron-right'} size={16} />
              </Link>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function EditDepartmentForm({ department, onSave }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [nameEn, setNameEn] = useState(department.name_en || '');
  const [nameAr, setNameAr] = useState(department.name_ar || '');
  const [description, setDescription] = useState(department.description || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setOk(false);
    try {
      await onSave(nameEn, nameAr, description);
      setOk(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="um-form" onSubmit={handleSubmit}>
      <div className="um-form__grid">
        <Field label={t('Department Name (English)')}>
          <input className="form-input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} required maxLength={200} />
        </Field>
        <Field label={t('Department Name (Arabic)')}>
          <input className="form-input" value={nameAr} onChange={(e) => setNameAr(e.target.value)} required maxLength={200} />
        </Field>
        <div className="is-wide">
          <Field label={t('Short Description')}>
            <textarea className="form-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
      </div>
      {error && <p className="um-form__error">{error}</p>}
      <div className="um-form__foot">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          <Icon name="check" size={16} /> {saving ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : t('Save')}
        </button>
        {ok && <span className="um-form__ok"><Icon name="check" size={14} /> {ar ? 'تم الحفظ' : 'Saved'}</span>}
      </div>
    </form>
  );
}

