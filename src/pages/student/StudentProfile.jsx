import { personName, validateNames } from '../../utils/bilingualName';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { announceAvatar } from '../../components/insight/AvatarUploader';
import ImageCropModal from '../../components/ImageCropModal';
import Icon from '../../components/Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/student/profile';
import { usePageMeta } from '../../context/PageMetaContext';
import { SgSkeleton } from '../../components/student/groupUi';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Student Portal's own Profile page — was missing entirely (Topbar's
 * `/${role}/profile` link had nowhere to go for `student`, so it fell
 * through to the catch-all route and bounced back to the dashboard).
 * Mirrors the other roles' Profile pages (Faculty) and
 * the old app/Views/student/profile.php this portal never got an SPA
 * equivalent of (see src/i18n/student/profile.js, auto-extracted from
 * that view).
 *
 * Talks to the real JSON API (App\Http\Controllers\Api\StudentsApiController):
 *   GET   /api/v1/students/me              -> { profile, join_request }
 *   PATCH /api/v1/students/me              full_name / bio
 *   POST  /api/v1/students/me/avatar       multipart avatar upload
 *   POST  /api/v1/students/me/join-request university_id (+ optional
 *                                          faculty_id/department_id)
 * University/faculty/department pickers reuse the same public
 * endpoints Register.jsx's cascade uses (GET /api/v1/auth/universities,
 * GET /api/v1/auth/university-hierarchy/{id}) — same pool, same shape.
 */
export default function StudentProfile() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  usePageMeta(t('Profile'), t('Your profile, academic info, and university link.'));

  const [profile, setProfile] = useState(null);
  const [joinRequest, setJoinRequest] = useState(null);
  const [form, setForm] = useState({ name_ar: '', name_en: '', bio: '' });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveOk, setSaveOk] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // University join-request panel state (only relevant while unlinked).
  const [universities, setUniversities] = useState([]);
  const [universityId, setUniversityId] = useState('');
  const [faculties, setFaculties] = useState([]);
  const [facultyId, setFacultyId] = useState('');
  const [allDepartments, setAllDepartments] = useState([]);
  const [departmentId, setDepartmentId] = useState('');
  const [hierarchyLoading, setHierarchyLoading] = useState(false);
  const [sendingRequest, setSendingRequest] = useState(false);
  const [requestError, setRequestError] = useState(null);
  const [requestOk, setRequestOk] = useState(false);

  const avatarInputRef = useRef(null);
  const [cropFile, setCropFile] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/students/me', { locale })
      .then((json) => {
        const p = json.data?.profile || {};
        setProfile(p);
        setJoinRequest(json.data?.join_request || null);
        setForm({ name_ar: p.name_ar || p.full_name || '', name_en: p.name_en || p.full_name || '', bio: p.bio || '' });
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [locale]);

  useEffect(() => { load(); }, [load]);

  // Only fetch the university picker's data once the account actually
  // needs it (unlinked, no pending request) — same lazy pattern as
  // Register.jsx.
  useEffect(() => {
    if (profile?.university_id || joinRequest?.status === 'pending' || universities.length) return;
    let cancelled = false;
    api.get('/api/v1/auth/universities', { locale })
      .then((json) => { if (!cancelled) setUniversities(json.data || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [profile, joinRequest, universities.length, locale]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const nameCheck = validateNames(form.name_ar, form.name_en, locale);
    if (!nameCheck.ok) { setSaveError(Object.values(nameCheck.errors)[0]); return; }
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      await api.patch('/api/v1/students/me', { name_ar: form.name_ar, name_en: form.name_en, bio: form.bio });
      setSaveOk(true);
      load();
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (avatarInputRef.current) avatarInputRef.current.value = '';
    if (file) setCropFile(file); // crop/preview first, upload on "Apply"
  }

  async function uploadAvatarFile(file) {
    setCropFile(null);
    setUploadingAvatar(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      const json = await api.postForm('/api/v1/students/me/avatar', formData);
      setProfile((p) => ({ ...p, avatar_path: json.data?.avatar_path || p?.avatar_path }));
      announceAvatar(json.data?.avatar_path);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  }

  function resetDownstream() {
    setFaculties([]);
    setFacultyId('');
    setAllDepartments([]);
    setDepartmentId('');
  }

  async function handleUniversityChange(e) {
    const id = e.target.value;
    setUniversityId(id);
    resetDownstream();
    if (!id) return;

    setHierarchyLoading(true);
    try {
      const json = await api.get(`/api/v1/auth/university-hierarchy/${id}`, { locale });
      setFaculties(json.data?.faculties || []);
      setAllDepartments(json.data?.departments || []);
    } catch {
      setFaculties([]);
      setAllDepartments([]);
    } finally {
      setHierarchyLoading(false);
    }
  }

  function handleFacultyChange(e) {
    const id = e.target.value;
    setFacultyId(id);
    setDepartmentId('');
  }

  function handleDepartmentChange(e) {
    const id = e.target.value;
    setDepartmentId(id);
  }

  const departmentsForFaculty = facultyId
    ? allDepartments.filter((d) => String(d.faculty_id) === String(facultyId))
    : [];

  async function handleSendRequest(e) {
    e.preventDefault();
    if (!universityId) return;
    setSendingRequest(true);
    setRequestError(null);
    setRequestOk(false);
    try {
      await api.post('/api/v1/students/me/join-request', {
        university_id: universityId,
        ...(facultyId ? { faculty_id: facultyId } : {}),
        ...(departmentId ? { department_id: departmentId } : {}),
      });
      setRequestOk(true);
      setUniversityId('');
      resetDownstream();
      load();
    } catch (err) {
      setRequestError(errorMessage(err));
    } finally {
      setSendingRequest(false);
    }
  }

  if (loading) return <SgSkeleton rows={3} h={130} />;
  if (error) return <div className="ex-page"><div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div></div>;
  if (!profile) return null;

  const isLinked = !!profile.university_id;
  const isPending = joinRequest?.status === 'pending';
  const isRejected = joinRequest?.status === 'rejected';
  const notSet = t('Not assigned yet');
  const info = [
    [t('Student Number'), profile.student_number],
    [t('Year'), profile.academic_year],
    [t('Faculty'), profile.faculty_name],
    [t('Department'), profile.department_name],
    [t('Account Status'), profile.account_status],
  ];

  return (
    <div className="ex-page">
      <div className="sg-prof">
        <div className="sg-prof__main">
          <div className="ex-card">
            <div className="sg-hero__band" />
            <div className="sg-hero__body">
              <div className="sg-hero__photo">
                {profile.avatar_path
                  ? <img src={`/${profile.avatar_path}`} alt={t('Your profile photo')} />
                  : (personName(profile, locale, '?') || '?').trim().slice(0, 1).toUpperCase()}
              </div>
              <div className="sg-hero__info">
                <h2 className="sg-hero__name">{personName(profile, locale)}</h2>
                <span className="sg-hero__mail"><bdi>{profile.email}</bdi></span>
                <div className="sg-hero__tags">
                  <span className={`st-pill${isLinked ? ' st-pill--success' : ''}`}>
                    <Icon name={isLinked ? 'check-circle' : 'building'} size={12} />
                    {isLinked ? (profile.university_name || t('Linked')) : isPending ? t('Pending') : t('No university linked')}
                  </span>
                  {profile.student_number && <span className="st-pill">{profile.student_number}</span>}
                </div>
              </div>
              <label className={`btn btn-outline btn-sm sg-upload${uploadingAvatar ? ' is-busy' : ''}`}>
                <Icon name="upload" size={14} /> {uploadingAvatar ? t('Uploading…') : t('Change Photo')}
                <input ref={avatarInputRef} type="file" accept=".jpg,.jpeg,.png,.webp" style={{ display: 'none' }} disabled={uploadingAvatar} onChange={handleAvatarChange} />
              </label>
              {cropFile && (
                <ImageCropModal file={cropFile} aspect={1} outWidth={800} round title={t('Change Photo')} onCancel={() => setCropFile(null)} onConfirm={uploadAvatarFile} />
              )}
            </div>
          </div>

          <form className="ex-card" onSubmit={handleSubmit}>
            <div className="ex-card__head">
              <div>
                <h2 className="ex-card__title">{ar ? 'البيانات الشخصية' : 'Personal details'}</h2>
                <p className="ex-card__sub">{ar ? 'الاسم والنبذة اللي بتظهر في بروفايلك.' : 'The name and bio shown on your profile.'}</p>
              </div>
            </div>
            <div className="sg-fields">
              <div className="sg-field">
                <label className="ex-label" htmlFor="sp-name-ar">{ar ? 'الاسم بالعربي' : 'Name (Arabic)'}</label>
                <input id="sp-name-ar" className="ex-input" type="text" dir="rtl" lang="ar" required maxLength={150} value={form.name_ar} onChange={(e) => set('name_ar', e.target.value)} />
              </div>
              <div className="sg-field">
                <label className="ex-label" htmlFor="sp-name-en">{ar ? 'الاسم بالإنجليزي' : 'Name (English)'}</label>
                <input id="sp-name-en" className="ex-input" type="text" dir="ltr" lang="en" required maxLength={150} value={form.name_en} onChange={(e) => set('name_en', e.target.value)} />
              </div>
              <div className="sg-field">
                <label className="ex-label" htmlFor="sp-mail">{t('University Email')}</label>
                <input id="sp-mail" className="ex-input" type="email" value={profile.email || ''} disabled />
              </div>
              <div className="sg-field sg-field--full">
                <label className="ex-label" htmlFor="sp-bio">{t('Bio')}</label>
                <textarea id="sp-bio" className="ex-textarea" rows={4} value={form.bio} onChange={(e) => set('bio', e.target.value)} />
              </div>
            </div>
            {saveError && <div className="st-alert st-alert--danger" style={{ margin: '0 20px 16px' }}><Icon name="alert-triangle" size={16} /><span>{saveError}</span></div>}
            <div className="sg-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}><Icon name="check" size={16} /> {saving ? t('Saving…') : t('Save Changes')}</button>
              {saveOk && <span className="sg-ok">{t('Profile updated.')}</span>}
            </div>
          </form>

          <div className="ex-card">
            <div className="ex-card__head"><h2 className="ex-card__title">{t('Academic Info')}</h2></div>
            <dl className="sg-info">
              {info.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd className={value ? '' : 'is-empty'}>{value || notSet}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <aside className="sg-prof__side">
          <div className="ex-card">
            <div className="ex-card__head"><h2 className="ex-card__title">{t('University Link')}</h2></div>

            {isLinked && (
              <div className="sg-link" style={{ marginBottom: 18 }}>
                <span className="sg-link__icon"><Icon name="building" size={18} /></span>
                <div><strong>{profile.university_name || profile.university_id}</strong><span>{t('Linked')}</span></div>
              </div>
            )}

            {!isLinked && isPending && (
              <div className="sg-link" style={{ marginBottom: 18 }}>
                <span className="sg-link__icon"><Icon name="clock" size={18} /></span>
                <div><strong>{joinRequest.university}</strong><span>{t('is awaiting the university\'s review.')}</span></div>
              </div>
            )}

            {!isLinked && !isPending && (
              <>
                {isRejected ? (
                  <div className="st-alert st-alert--danger" style={{ margin: '16px 18px 0' }}>
                    <Icon name="alert-triangle" size={16} />
                    <span>{t('Your join request to')} <strong>{joinRequest.university}</strong> {t('was rejected. You can choose a different university and try again.')}</span>
                  </div>
                ) : (
                  <p className="sg-prof__msg">{t('Your account isn\'t linked to a university yet. Choose one so you can submit projects for approval.')}</p>
                )}

                <form className="sg-prof__form" onSubmit={handleSendRequest}>
                  <div className="sg-field">
                    <label className="ex-label" htmlFor="sp-uni">{t('University')}</label>
                    <select id="sp-uni" className="ex-select" value={universityId} onChange={handleUniversityChange}>
                      <option value="">{t('— Select —')}</option>
                      {universities.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                  <div className="sg-field">
                    <label className="ex-label" htmlFor="sp-fac">{t('Faculty (optional)')}</label>
                    <select id="sp-fac" className="ex-select" value={facultyId} onChange={handleFacultyChange} disabled={!universityId || hierarchyLoading}>
                      <option value="">{universityId ? t('— Select —') : t('— Select university first —')}</option>
                      {faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </div>
                  <div className="sg-field">
                    <label className="ex-label" htmlFor="sp-dep">{t('Department')}</label>
                    <select id="sp-dep" className="ex-select" value={departmentId} onChange={handleDepartmentChange} disabled={!facultyId}>
                      <option value="">{facultyId ? t('— Select —') : t('— Select faculty first —')}</option>
                      {departmentsForFaculty.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>

                  {requestError && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{requestError}</span></div>}
                  {requestOk && <div className="st-alert st-alert--success"><Icon name="check-circle" size={16} /><span>{t('Your join request has been sent.')}</span></div>}

                  <button type="submit" className="btn btn-primary" disabled={sendingRequest || !universityId}>
                    <Icon name="send" size={16} /> {sendingRequest ? t('Sending…') : (isRejected ? t('Send a new request') : t('Send Join Request'))}
                  </button>
                </form>
              </>
            )}
            {(isLinked || isPending) && <div style={{ height: 2 }} />}
          </div>
        </aside>
      </div>
    </div>
  );
}
