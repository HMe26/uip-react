import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { CredentialsModal, PasswordInput, generatePassword } from '../../components/people/credentials';
import { StModal } from '../../components/student/stUi';
import { Alert, Empty, Field, Mono, Pill, SearchField, Skeletons, Stat, hueOf } from '../../components/university/umUi';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/university/faculties';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/university/faculties.php, talking to the real JSON
 * API (FacultyApiController::index()/store() — same
 * FacultyRepository::forUniversityWithCounts() the Blade page uses).
 * List + create only; per-faculty stats/departments/login management live
 * on UniversityFacultyPortfolio.jsx.
 */

export default function UniversityFaculties() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [addingFaculty, setAddingFaculty] = useState(false);
  const [addingDeptFor, setAddingDeptFor] = useState(null);
  const [created, setCreated] = useState(null);
  const [q, setQ] = useState('');

  const load = useCallback((archived, silent) => {
    if (!silent) setLoading(true);
    setError(null);
    api.get('/api/v1/faculty', { per_page: 100, status: archived ? 'archived' : undefined })
      .then((json) => setRows(json.data || []))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(showArchived); }, [load, showArchived]);

  const nameOf = (f) => (ar ? (f.name_ar || f.name_en) : (f.name_en || f.name_ar)) || '';

  async function handleArchive(f) {
    const confirmMsg = t('Archive {name}? It will disappear from the list; its departments, students and staff stay saved and you can restore it anytime from the "Archived" tab.').replace('{name}', nameOf(f));
    if (!window.confirm(confirmMsg)) return;
    setActionError(null);
    setBusyId(f.id);
    try {
      await api.post(`/api/v1/faculty/${f.id}/archive`, {});
      load(showArchived, true);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(f) {
    setActionError(null);
    setBusyId(f.id);
    try {
      await api.post(`/api/v1/faculty/${f.id}/unarchive`, {});
      load(showArchived, true);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const departmentsTotal = rows.reduce((sum, f) => sum + (f.departments_count || 0), 0);
  const publicTotal = rows.filter((f) => f.is_public).length;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((f) => `${f.name_en || ''} ${f.name_ar || ''}`.toLowerCase().includes(needle));
  }, [rows, q]);

  return (
    <div className="um-page animate-rise-in">
      <header className="um-head">
        <div className="um-head__text">
          <h1>{t('Faculties')}</h1>
          <p>{t("Your university's faculties — open one to see its stats and departments, and manage its portfolio visibility.")}</p>
        </div>
        <div className="um-head__act">
          <button type="button" className="btn btn-primary" onClick={() => setAddingFaculty(true)}>
            <Icon name="plus" size={16} /> {t('Add Faculty')}
          </button>
        </div>
      </header>

      <div className="um-stats" style={{ '--n': 3 }}>
        <Stat icon="building" tone="primary" value={rows.length} label={t('Faculties')} />
        <Stat icon="layers" tone="success" value={departmentsTotal} label={t('Departments')} />
        <Stat icon="eye" tone="warning" value={publicTotal} label={t('Public')} />
      </div>

      <div className="um-bar">
        <div className="um-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={!showArchived} className={`um-tab${!showArchived ? ' is-active' : ''}`} onClick={() => setShowArchived(false)}>
            {t('Active Tab')}
          </button>
          <button type="button" role="tab" aria-selected={showArchived} className={`um-tab${showArchived ? ' is-active' : ''}`} onClick={() => setShowArchived(true)}>
            <Icon name="archive" size={14} /> {t('Archived Tab')}
          </button>
        </div>
        <SearchField value={q} onChange={setQ} placeholder={ar ? 'ابحث عن كلية…' : 'Search faculties…'} />
        <span className="um-count">{ar ? `${shown.length} كلية` : `${shown.length} ${shown.length === 1 ? 'faculty' : 'faculties'}`}</span>
      </div>

      {actionError && <Alert>{actionError}</Alert>}

      {loading ? <Skeletons n={3} h={170} /> : error ? <Alert>{error}</Alert> : shown.length === 0 ? (
        <Empty icon={showArchived ? 'archive' : 'building'} title={q ? (ar ? 'لا توجد نتائج مطابقة.' : 'No matching faculties.') : showArchived ? t('No archived faculties.') : t('No faculties added yet.')}>
          {!showArchived && !q && (
            <button type="button" className="btn btn-primary" onClick={() => setAddingFaculty(true)}><Icon name="plus" size={16} /> {t('Add Faculty')}</button>
          )}
        </Empty>
      ) : (
        <div className="um-cards">
          {shown.map((f) => {
            const archived = f.status === 'archived';
            return (
              <article key={f.id} className={`um-fcard${archived ? ' is-archived' : ''}`} data-hue={hueOf(f.id)}>
                <div className="um-fcard__top">
                  <Mono name={nameOf(f)} src={f.logo_path} hue={hueOf(f.id)} />
                  <div className="um-fcard__text">
                    <h3 className="um-fcard__name"><Link to={`/university/faculties/${f.id}/portfolio`}>{nameOf(f)}</Link></h3>
                    <p className="um-fcard__meta"><Icon name="layers" size={14} /> {f.departments_count ?? 0} {t('Departments')}</p>
                  </div>
                </div>
                <div className="um-fcard__pills">
                  <Pill tone={archived ? 'muted' : 'success'}>{archived ? t('Archived') : t('Active')}</Pill>
                  <Pill tone={f.is_public ? 'primary' : 'muted'} dot={false}>
                    <Icon name={f.is_public ? 'eye' : 'eye-off'} size={12} /> {f.is_public ? t('Public') : t('Private')}
                  </Pill>
                </div>
                <div className="um-fcard__acts">
                  <Link to={`/university/faculties/${f.id}/portfolio`} className="btn btn-outline">{ar ? 'إدارة الكلية' : 'Manage'}</Link>
                  {!showArchived && (
                    <button type="button" className="btn btn-ghost" onClick={() => setAddingDeptFor(f)}>
                      <Icon name="plus" size={14} /> {ar ? 'قسم' : 'Department'}
                    </button>
                  )}
                  <span className="um-spacer" />
                  {showArchived ? (
                    <button type="button" className="btn btn-ghost" disabled={busyId === f.id} onClick={() => handleRestore(f)}>
                      <Icon name="refresh" size={14} /> {t('Restore')}
                    </button>
                  ) : (
                    <button type="button" className="btn btn-ghost" disabled={busyId === f.id} onClick={() => handleArchive(f)} title={t('Archive')} aria-label={t('Archive')}>
                      <Icon name="archive" size={14} />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {addingFaculty && (
        <AddFacultyModal
          onClose={() => setAddingFaculty(false)}
          onDone={(cred) => { setAddingFaculty(false); if (cred) setCreated(cred); load(showArchived, true); }}
        />
      )}

      {addingDeptFor && (
        <AddDepartmentModal
          faculty={addingDeptFor}
          onClose={() => setAddingDeptFor(null)}
          onDone={() => { setAddingDeptFor(null); load(showArchived, true); }}
        />
      )}

      {created && (
        <CredentialsModal
          title={ar ? 'تم إنشاء الكلية وحساب الدخول' : 'Faculty and login created'}
          email={created.email}
          password={created.password}
          message={ar ? 'سلّم بيانات الدخول لمسؤول الكلية.' : 'Hand these login details to the faculty administrator.'}
          onClose={() => setCreated(null)}
        />
      )}
    </div>
  );
}

function AddFacultyModal({ onClose, onDone }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // With a login email, always send a known password so it can be handed over.
      const finalPassword = email.trim() ? (password || generatePassword()) : undefined;
      await api.post('/api/v1/faculty', {
        name_en: nameEn,
        name_ar: nameAr,
        description,
        email: email.trim() || undefined,
        password: finalPassword,
        locale,
      });
      onDone(finalPassword ? { email: email.trim(), password: finalPassword } : null);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <StModal
      wide
      title={t('Add Faculty')}
      onClose={onClose}
      actions={(
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>{ar ? 'إلغاء' : 'Cancel'}</button>
          <button type="submit" form="um-add-faculty" className="btn btn-primary" disabled={saving}>
            <Icon name="plus" size={16} /> {saving ? (ar ? 'جارٍ الإضافة…' : 'Adding…') : t('Add Faculty')}
          </button>
        </>
      )}
    >
      <form id="um-add-faculty" className="um-form" onSubmit={handleSubmit}>
        <div className="um-form__grid">
          <Field label={t('Faculty Name (English)')}>
            <input className="form-input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} required maxLength={200} />
          </Field>
          <Field label={t('Faculty Name (Arabic)')}>
            <input className="form-input" value={nameAr} onChange={(e) => setNameAr(e.target.value)} required maxLength={200} />
          </Field>
          <div className="is-wide">
            <Field label={t('Short Description')}>
              <textarea className="form-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="um-form__sep" />
        <p className="um-form__hint">
          <strong>{t('Faculty Login')}</strong> — {ar
            ? 'اختياري. لو حددت الإيميل، هيتعمل حساب دخول للكلية. سيب الباسورد فاضي عشان يتولّد باسورد مؤقت.'
            : 'Optional. Add an email to create a login account for this faculty. Leave the password empty to auto-generate one.'}
        </p>
        <div className="um-form__grid">
          <Field label={t('Email')}>
            <input type="email" className="form-input" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={190} />
          </Field>
          <PasswordInput value={password} onChange={setPassword} label={t('Password')} />
        </div>
        {error && <p className="um-form__error">{error}</p>}
      </form>
    </StModal>
  );
}

function AddDepartmentModal({ faculty, onClose, onDone }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/v1/faculty/${faculty.id}/departments`, { name_en: nameEn, name_ar: nameAr });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  const facultyName = ar ? (faculty.name_ar || faculty.name_en) : (faculty.name_en || faculty.name_ar);
  return (
    <StModal
      title={ar ? `إضافة قسم — ${facultyName}` : `Add department — ${facultyName}`}
      onClose={onClose}
      actions={(
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>{ar ? 'إلغاء' : 'Cancel'}</button>
          <button type="submit" form="um-add-dept" className="btn btn-primary" disabled={saving}>{saving ? '…' : (ar ? 'إضافة' : 'Add')}</button>
        </>
      )}
    >
      <form id="um-add-dept" className="um-form" onSubmit={handleSubmit}>
        <Field label={ar ? 'اسم القسم (إنجليزي)' : 'Department name (English)'}>
          <input className="form-input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} required maxLength={200} />
        </Field>
        <Field label={ar ? 'اسم القسم (عربي)' : 'Department name (Arabic)'}>
          <input className="form-input" value={nameAr} onChange={(e) => setNameAr(e.target.value)} required maxLength={200} />
        </Field>
        {error && <p className="um-form__error">{error}</p>}
      </form>
    </StModal>
  );
}
