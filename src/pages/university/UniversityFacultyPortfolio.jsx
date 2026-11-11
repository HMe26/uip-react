import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { CredentialsModal, PasswordInput, generatePassword } from '../../components/people/credentials';
import { Alert, Empty, Field, Mono, Pill, Skeletons, Stat, Switch, hueOf } from '../../components/university/umUi';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/university/faculty-portfolio';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/university/faculty-portfolio.php, talking to the real
 * JSON API — GET/PATCH /api/v1/faculty/{id} (FacultyApiController::show()/
 * update(), same FacultyRepository::withProfileStats() the Blade page uses),
 * POST /api/v1/faculty/{id}/departments, PATCH /api/v1/departments/{id}
 * (visibility toggle), and the login-provisioning endpoints
 * (/faculty/{id}/login, /login/reset, plus manual PATCH /login/email and
 * /login/password).
 */

export default function UniversityFacultyPortfolio() {
  const { id } = useParams();
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [faculty, setFaculty] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [deletedDepartments, setDeletedDepartments] = useState([]);
  const [busyDept, setBusyDept] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [visBusy, setVisBusy] = useState(false);

  // `silent` reloads keep the page on screen (no skeleton flash) after an action.
  const load = useCallback((silent) => {
    if (!silent) setLoading(true);
    setError(null);
    api.get(`/api/v1/faculty/${id}`)
      .then((json) => {
        setFaculty(json.data?.faculty || null);
        setDepartments(json.data?.departments || []);
        setDeletedDepartments(json.data?.deleted_departments || []);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleVisibility(next) {
    setActionError(null);
    setVisBusy(true);
    try {
      await api.patch(`/api/v1/faculty/${id}`, { is_public: next ? 1 : 0 });
      load(true);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setVisBusy(false);
    }
  }

  async function handleDetailsSave(nameEn, nameAr, description) {
    await api.patch(`/api/v1/faculty/${id}`, { name_en: nameEn, name_ar: nameAr, description });
    load(true);
  }

  async function handleArchive() {
    const confirmMsg = ar
      ? 'أرشفة الكلية؟ هتختفي من قائمة الكليات، وأقسامها وطلابها وأعضاء هيئة تدريسها هيفضلوا محفوظين وتقدر ترجعها في أي وقت.'
      : "Archive this faculty? It'll disappear from the faculties list; its departments, students and staff stay saved and you can restore it anytime.";
    if (!window.confirm(confirmMsg)) return;
    setActionError(null);
    try {
      await api.post(`/api/v1/faculty/${id}/archive`, {});
      load(true);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleUnarchive() {
    setActionError(null);
    try {
      await api.post(`/api/v1/faculty/${id}/unarchive`, {});
      load(true);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleAddDepartment(nameEn, nameAr) {
    setActionError(null);
    await api.post(`/api/v1/faculty/${id}/departments`, { name_en: nameEn, name_ar: nameAr });
    load(true);
  }

  async function handleDepartmentVisibility(dept) {
    setActionError(null);
    try {
      await api.patch(`/api/v1/departments/${dept.id}`, { is_public: dept.is_public ? 0 : 1 });
      load(true);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleDeleteDepartment(dept, dName) {
    const n = dept.students_count || 0;
    const msg = ar
      ? `حذف القسم "${dName}"؟${n ? ` هيوصل إشعار لـ ${n} طالب بالحذف.` : ''} بيانات القسم والطلبة والامتحانات بتفضل محفوظة وتقدر تسترجعه بالكامل في أي وقت.`
      : `Delete the department "${dName}"?${n ? ` ${n} student(s) will be notified.` : ''} Its data, students and exams stay saved and you can fully restore it anytime.`;
    if (!window.confirm(msg)) return;
    setActionError(null);
    setBusyDept(dept.id);
    try {
      await api.delete(`/api/v1/departments/${dept.id}`);
      load(true);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyDept(null);
    }
  }

  async function handleRestoreDepartment(dept) {
    setActionError(null);
    setBusyDept(dept.id);
    try {
      await api.post(`/api/v1/departments/${dept.id}/restore`);
      load(true);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyDept(null);
    }
  }

  const backLink = (
    <Link to="/university/faculties" className="um-back">
      <Icon name={ar ? 'arrow-right' : 'arrow-left'} size={14} /> {t('Faculties')}
    </Link>
  );

  if (loading) {
    return <div className="um-page">{backLink}<Skeletons n={1} h={130} /><Skeletons n={2} h={220} /></div>;
  }
  if (error) return <div className="um-page">{backLink}<Alert>{error}</Alert></div>;
  if (!faculty) return null;

  const name = ar ? (faculty.name_ar || faculty.name_en || '') : (faculty.name_en || faculty.name_ar || '');
  const archived = faculty.status === 'archived';
  const hue = hueOf(faculty.id);
  const statusLabel = (s) => (s === 'archived' ? (ar ? 'مؤرشف' : 'Archived') : t(s));

  return (
    <div className="um-page animate-rise-in">
      {backLink}

      <section className="um-hero" data-hue={hue}>
        <Mono name={name} src={faculty.logo_path} hue={hue} size="lg" />
        <div className="um-hero__text">
          <h1>{name}</h1>
          <p className="um-hero__desc">
            {faculty.description || (ar ? 'الملف العام للكلية — إحصاءاتها وأقسامها وظهورها العام.' : "The faculty's portfolio — its stats, departments, and public visibility.")}
          </p>
          <div className="um-hero__pills">
            {archived && <Pill tone="warning"><Icon name="archive" size={12} /> {ar ? 'مؤرشفة' : 'Archived'}</Pill>}
            <Pill tone={faculty.is_public ? 'success' : 'muted'} dot={false}>
              <Icon name={faculty.is_public ? 'eye' : 'eye-off'} size={12} /> {faculty.is_public ? t('Public') : t('Private')}
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
            ? 'الكلية دي مؤرشفة — مش هتظهر في القوائم أو الدليل العام، ومش هتقدر تضيف أقسام جديدة ليها. كل بياناتها (الأقسام/الطلاب/أعضاء هيئة التدريس) لسه محفوظة. اضغط "استرجاع" عشان ترجّعها.'
            : 'This faculty is archived — it won\'t show in lists or the public directory, and you can\'t add new departments to it. All its data (departments/students/staff) is still saved. Click "Restore" to bring it back.'}
        </Alert>
      )}

      <div className="um-stats" style={{ '--n': 4 }}>
        <Stat icon="layers" tone="primary" value={faculty.departments_count} label={t('Departments')} />
        <Stat icon="users" tone="success" value={faculty.students_count} label={ar ? 'الطلاب' : 'Students'} />
        <Stat icon="user" tone="warning" value={faculty.academic_staff_count} label={ar ? 'أعضاء هيئة التدريس' : 'Academic Staff'} />
        <Stat icon="folder" tone="muted" value={faculty.published_projects_count} label={ar ? 'مشاريع منشورة' : 'Published Projects'} />
      </div>

      <div className="um-layout">
        <div className="um-stack">
          <section className="um-panel um-panel--flush">
            <div className="um-panel__head">
              <div>
                <h2>{t('Departments')}</h2>
                <p className="um-panel__sub">{ar ? 'تحكّم في ظهور كل قسم وافتح ملفه.' : 'Control each department’s visibility and open its portfolio.'}</p>
              </div>
              <Pill tone="primary" dot={false}>{departments.length}</Pill>
            </div>
            {departments.length === 0 ? (
              <Empty icon="layers" title={t('No departments added to this faculty yet.')} />
            ) : (
              <div className="um-rows">
                {departments.map((d) => {
                  const dName = ar ? (d.name_ar || d.name_en) : (d.name_en || d.name_ar);
                  return (
                    <div key={d.id} className="um-row">
                      <Mono name={dName} hue={hueOf(d.id)} size="sm" />
                      <div className="um-row__main">
                        <h3 className="um-row__name"><Link to={`/university/departments/${d.id}/portfolio`}>{dName}</Link></h3>
                        <p className="um-row__sub">
                          <Pill tone={d.status === 'active' ? 'success' : 'muted'}>{statusLabel(d.status)}</Pill>
                        </p>
                      </div>
                      <div className="um-row__end">
                        <Switch on={!!d.is_public} onChange={() => handleDepartmentVisibility(d)} onLabel={t('Public')} offLabel={t('Private')} label={dName} />
                        <Link to={`/university/departments/${d.id}/portfolio`} className="btn btn-outline">{t('View Portfolio')}</Link>
                        <button type="button" className="btn btn-outline" disabled={busyDept === d.id} onClick={() => handleDeleteDepartment(d, dName)}>
                          <Icon name="trash" size={14} /> {ar ? 'حذف' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {deletedDepartments.length > 0 && (
            <section className="um-panel um-panel--flush">
              <div className="um-panel__head">
                <div>
                  <h2>{ar ? 'الأقسام المحذوفة' : 'Deleted departments'}</h2>
                  <p className="um-panel__sub">{ar ? 'الاسترجاع بيرجّع القسم بكل طلابه وبياناته.' : 'Restoring brings the department back with all its students and data.'}</p>
                </div>
                <Pill tone="muted" dot={false}>{deletedDepartments.length}</Pill>
              </div>
              <div className="um-rows">
                {deletedDepartments.map((d) => {
                  const dName = ar ? (d.name_ar || d.name_en) : (d.name_en || d.name_ar);
                  return (
                    <div key={d.id} className="um-row">
                      <Mono name={dName} hue={hueOf(d.id)} size="sm" />
                      <div className="um-row__main">
                        <h3 className="um-row__name">{dName}</h3>
                        <p className="um-row__sub">
                          <span>{ar ? `${d.students_count || 0} طالب` : `${d.students_count || 0} student(s)`}</span>
                        </p>
                      </div>
                      <div className="um-row__end">
                        <button type="button" className="btn btn-primary" disabled={busyDept === d.id} onClick={() => handleRestoreDepartment(d)}>
                          <Icon name="refresh" size={14} /> {ar ? 'استرجاع' : 'Restore'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="um-panel">
            <div className="um-panel__head">
              <h2>{t('Add Department')}</h2>
            </div>
            {archived && <p className="um-form__hint" style={{ marginBottom: 12 }}>{ar ? 'استرجع الكلية الأول عشان تقدر تضيف أقسام جديدة.' : 'Restore this faculty first to add new departments.'}</p>}
            <AddDepartmentForm onAdd={handleAddDepartment} disabled={archived} />
          </section>

          <section className="um-panel">
            <div className="um-panel__head"><h2>{t('Faculty Details')}</h2></div>
            <EditFacultyForm faculty={faculty} onSave={handleDetailsSave} />
          </section>
        </div>

        <aside className="um-aside">
          <section className="um-panel">
            <div className="um-panel__head"><h2>{t('Profile Visibility')}</h2></div>
            <div className="um-toggle-row">
              <div className="um-toggle-row__text">
                <strong>{t('Make profile public')}</strong>
                <span>{ar ? 'عند التفعيل، يقدر أي حد معاه الرابط يشوف مشاريع الكلية المنشورة.' : "When on, anyone with the link can view this faculty's published projects."}</span>
              </div>
              <Switch on={!!faculty.is_public} disabled={visBusy} onChange={handleVisibility} onLabel={t('Public')} offLabel={t('Private')} label={t('Make profile public')} />
            </div>
          </section>

          <FacultyLoginCard facultyId={id} hasLogin={!!faculty.user_id} loginEmail={faculty.login_email || ''} onChanged={() => load(true)} />
        </aside>
      </div>
    </div>
  );
}

function EditFacultyForm({ faculty, onSave }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [nameEn, setNameEn] = useState(faculty.name_en || '');
  const [nameAr, setNameAr] = useState(faculty.name_ar || '');
  const [description, setDescription] = useState(faculty.description || '');
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
        <Field label={t('Faculty Name (English)')}>
          <input className="form-input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} required maxLength={200} />
        </Field>
        <Field label={t('Faculty Name (Arabic)')}>
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

function AddDepartmentForm({ onAdd, disabled }) {
  const t = useTranslations(translations);
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
      await onAdd(nameEn, nameAr);
      setNameEn(''); setNameAr('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="um-form" onSubmit={handleSubmit}>
      <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, opacity: disabled ? 0.55 : 1 }}>
        <div className="um-form" style={{ gap: 14 }}>
          <div className="um-form__grid">
            <Field label={t('Department Name (English)')}>
              <input className="form-input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} required maxLength={200} />
            </Field>
            <Field label={t('Department Name (Arabic)')}>
              <input className="form-input" value={nameAr} onChange={(e) => setNameAr(e.target.value)} required maxLength={200} />
            </Field>
          </div>
          {error && <p className="um-form__error">{error}</p>}
          <div className="um-form__foot">
            <button type="submit" className="btn btn-primary" disabled={saving || disabled}>
              <Icon name="plus" size={16} /> {saving ? (ar ? 'جارٍ الإضافة…' : 'Adding…') : t('Add Department')}
            </button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}

function FacultyLoginCard({ facultyId, hasLogin, loginEmail, onChanged }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [email, setEmail] = useState('');
  const [provPassword, setProvPassword] = useState('');
  const [created, setCreated] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  // Manual email/password change (in addition to Reset Password) —
  // separate fields so editing one doesn't clear the other.
  const [newEmail, setNewEmail] = useState(loginEmail || '');
  const [newPassword, setNewPassword] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);

  useEffect(() => { setNewEmail(loginEmail || ''); }, [loginEmail]);

  async function handleProvision(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // Always send a known password so the admin can hand it over (email delivery isn't guaranteed).
      const password = provPassword.trim() || generatePassword();
      await api.post(`/api/v1/faculty/${facultyId}/login`, { email, password, locale });
      setCreated({ email, password });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!window.confirm(t('Generate a new password and email it?'))) return;
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      await api.post(`/api/v1/faculty/${facultyId}/login/reset`, {});
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateEmail(e) {
    e.preventDefault();
    setEmailSaving(true);
    setError(null);
    setOk(null);
    try {
      await api.patch(`/api/v1/faculty/${facultyId}/login/email`, { email: newEmail });
      setOk(t('Email updated'));
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setEmailSaving(false);
    }
  }

  async function handleUpdatePassword(e) {
    e.preventDefault();
    setPasswordSaving(true);
    setError(null);
    setOk(null);
    try {
      await api.patch(`/api/v1/faculty/${facultyId}/login/password`, { password: newPassword });
      setNewPassword('');
      setOk(t('Password updated'));
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <section className="um-panel">
      {created && (
        <CredentialsModal
          title={ar ? 'تم إنشاء حساب الكلية' : 'Faculty login created'}
          email={created.email}
          password={created.password}
          message={ar ? 'سلّم بيانات الدخول لمسؤول الكلية.' : 'Hand these login details to the faculty administrator.'}
          onClose={() => { setCreated(null); onChanged(); }}
        />
      )}
      <div className="um-panel__head"><h2>{t('Faculty Login')}</h2></div>
      <div className="um-form">
        {error && <p className="um-form__error">{error}</p>}
        {ok && <p className="um-form__ok"><Icon name="check" size={14} /> {ok}</p>}

        {hasLogin ? (
          <>
            <div className="um-login-state">
              <Icon name="check-circle" size={18} />
              <span>{t('Account active')}</span>
              <button type="button" className="btn btn-outline btn-sm" disabled={saving} onClick={handleReset}>
                <Icon name="mail" size={14} /> {t('Reset Password')}
              </button>
            </div>

            <form className="um-field" onSubmit={handleUpdateEmail}>
              <label>{t('Change Login Email')}</label>
              <div className="um-inline">
                <input className="form-input" type="email" required maxLength={190} placeholder={t('Faculty email')} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                <button type="submit" className="btn btn-primary" disabled={emailSaving || !newEmail || newEmail === loginEmail}>
                  <Icon name="check" size={14} /> {t('Update Email')}
                </button>
              </div>
            </form>

            <form className="um-field" onSubmit={handleUpdatePassword}>
              <label>{t('Change Login Password')}</label>
              <div className="um-inline">
                <input className="form-input" type="password" required minLength={8} maxLength={190} autoComplete="new-password" placeholder={t('New password')} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                <button type="submit" className="btn btn-primary" disabled={passwordSaving || !newPassword}>
                  <Icon name="lock" size={14} /> {t('Update Password')}
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <p className="um-form__hint">
              {ar
                ? 'أنشئ حساب دخول مستقل للكلية — هيقدر يدخل لوحة تحكم خاصة بيه (طلابه، اعتماد مشاريعه) بمعزل عن باقي الجامعة.'
                : "Create a standalone login for this faculty — it'll get its own dashboard (its students, its project approvals) separate from the rest of the university."}
            </p>
            <form className="um-form" onSubmit={handleProvision}>
              <Field label={t('Faculty email')}>
                <input className="form-input" type="email" required maxLength={190} value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <PasswordInput value={provPassword} onChange={setProvPassword} />
              <p className="um-form__hint">{ar ? 'يجب أن تحتوي على حرف كبير وصغير ورقم ورمز خاص.' : 'Must include upper and lower case letters, a number and a special character.'}</p>
              <div className="um-form__foot">
                <button type="submit" className="btn btn-primary" disabled={saving}><Icon name="plus" size={14} /> {t('Create Login')}</button>
              </div>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
