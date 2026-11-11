import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { CourseGradebook } from './CourseGradebook';
import CourseMaterials from './CourseMaterials';
import { useLanguage } from '../../context/LanguageContext';
import { EmptyState, Skeleton } from '../student/stUi';
import { PersonAvatar } from '../staff/stfUi';
import { AcPage, AcHead, AcAlerts, AcKpis, AcPanel, AcTable } from './acKit';
import { Field, FieldGrid, FormModal, FormSection } from '../people/formUi';

/**
 * Courses (المواد) management — one component for three portals:
 *   role="university"      → all courses of the university, can pick the faculty
 *   role="faculty"         → courses of the faculty, assigns teachers
 *   role="academic_staff"  → courses of the doctor's faculty; creates courses and manages the
 *                            ones they teach (see who is enrolled, add / remove students)
 * API: /api/v1/courses (see CourseApiController). Students pick their courses themselves from
 * pages/student/StudentCourses.jsx.
 */

const YEARS = [1, 2, 3, 4, 5, 6, 7, 8];

export default function CoursesManager({ role }) {
  const { locale } = useLanguage();
  const navigate = useNavigate();
  const ar = locale === 'ar';
  const isUni = role === 'university';
  const isStaff = role === 'academic_staff';
  const canAssign = !isStaff; // teachers are assigned by the faculty / university

  const [courses, setCourses] = useState([]);
  const [meta, setMeta] = useState({ faculties: [], departments: [] });
  const faculties = meta.faculties;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [facultyFilter, setFacultyFilter] = useState('');
  const [mine, setMine] = useState(false);

  const [editing, setEditing] = useState(null); // null | 'new' | course
  const [managing, setManaging] = useState(null); // course
  const [manageTab, setManageTab] = useState('students');
  const base = role === 'academic_staff' ? '/academic-staff' : `/${role}`;
  const openManage = (c, tab = 'students') => {
    if (tab === 'content') { navigate(`${base}/courses/${c.id}/content`); return; }
    setManageTab(tab); setManaging(c);
  };
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    const params = { status, locale };
    if (q.trim()) params.q = q.trim();
    if (isUni && facultyFilter) params.faculty_id = facultyFilter;
    if (isStaff && mine) params.mine = 1;
    return api.get('/api/v1/courses', params).then((j) => setCourses(j.data || []));
  }, [q, status, facultyFilter, mine, isUni, isStaff, locale]);

  useEffect(() => {
    setLoading(true);
    const h = setTimeout(() => {
      load().catch((err) => setError(errorMessage(err))).finally(() => setLoading(false));
    }, q ? 250 : 0);
    return () => clearTimeout(h);
  }, [load, q]);

  useEffect(() => {
    api.get('/api/v1/courses/meta').then((j) => setMeta({ faculties: j.data?.faculties || [], departments: j.data?.departments || [] })).catch(() => {});
  }, []);

  const kpis = useMemo(() => ({
    total: courses.length,
    students: courses.reduce((a, c) => a + (c.students_count || 0), 0),
    noTeacher: courses.filter((c) => (c.staff || []).length === 0).length,
  }), [courses]);

  async function toggleArchive(c) {
    const archiving = c.status === 'active';
    if (archiving && !window.confirm(ar ? 'أرشفة هذه المادة؟ لن تظهر للطلاب بعد الآن.' : 'Archive this course? Students will no longer see it.')) return;
    setBusyId(c.id);
    setError(null);
    try {
      const json = await api.post(`/api/v1/courses/${c.id}/${archiving ? 'archive' : 'restore'}`, { locale });
      setNotice(json.message);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }


  const courseName = (c) => (ar ? (c.name_ar || c.name_en) : c.name_en);
  const facultyName = (f) => (ar ? (f.name_ar || f.name_en) : f.name_en);
  const myCount = courses.filter((c) => c.can_manage).length;

  const kpiItems = [
    { label: status === 'active' ? (ar ? 'مواد نشطة' : 'Active courses') : (ar ? 'مواد مؤرشفة' : 'Archived courses'), value: kpis.total, icon: 'file' },
    ...(isStaff ? [{ label: ar ? 'موادي' : 'My courses', value: myCount, icon: 'check-circle', tone: 'good' }] : []),
    { label: ar ? 'تسجيلات الطلاب' : 'Student enrolments', value: kpis.students, icon: 'users' },
    { label: ar ? 'بلا مدرّس' : 'No teacher yet', value: kpis.noTeacher, icon: 'alert-triangle', tone: kpis.noTeacher ? 'warn' : 'good' },
  ];

  return (
    <AcPage>
      <AcHead
        title={ar ? 'المواد' : 'Courses'}
        text={isStaff
          ? (ar ? 'أضف موادك وشاهد الطلاب المسجّلين في كل مادة.' : 'Add your courses and see exactly which students are enrolled in each.')
          : (ar ? 'أضف المواد وعيّن مدرّسيها ليسجّل الطلاب فيها من لوحاتهم.' : 'Add courses and assign their teachers — students enrol from their own dashboard.')}
      >
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing('new')}><Icon name="plus" size={14} /> {ar ? 'إضافة مادة' : 'Add course'}</button>
      </AcHead>

      <AcKpis items={kpiItems} />
      <AcAlerts error={error} notice={notice} />

      <AcPanel flush>
        <div className="acx-tabs" role="tablist">
          {[['active', ar ? 'النشطة' : 'Active'], ['archived', ar ? 'المؤرشفة' : 'Archived']].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={status === k} className={status === k ? 'is-on' : ''} onClick={() => setStatus(k)}>{label}</button>
          ))}
        </div>
        <div className="acx-toolbar">
          <input className="acx-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'ابحث بالكود أو اسم المادة…' : 'Search by code or course name…'} aria-label={ar ? 'بحث' : 'Search'} />
          {isUni && (
            <select className="acx-input" style={{ width: 'auto', flex: '0 1 220px' }} value={facultyFilter} onChange={(e) => setFacultyFilter(e.target.value)} aria-label={ar ? 'الكلية' : 'Faculty'}>
              <option value="">{ar ? 'كل الكليات' : 'All faculties'}</option>
              {faculties.map((f) => <option key={f.id} value={f.id}>{facultyName(f)}</option>)}
            </select>
          )}
          {isStaff && <label className="acx-check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />{ar ? 'موادي فقط' : 'My courses only'}</label>}
          <span className="acx-muted">{ar ? `${courses.length} مادة` : `${courses.length} ${courses.length === 1 ? 'course' : 'courses'}`}</span>
        </div>

        {loading ? (
          <div className="acx-panel__body"><Skeleton h={120} count={3} /></div>
        ) : courses.length === 0 ? (
          <div className="acx-empty">
            <EmptyState icon="file" title={q ? (ar ? 'لا توجد مواد مطابقة' : 'No courses match') : (ar ? 'لا توجد مواد بعد' : 'No courses yet')} text={q ? (ar ? 'جرّب كلمات بحث مختلفة.' : 'Try a different search.') : (ar ? 'أضف أول مادة ليتمكن الطلاب من التسجيل فيها.' : 'Add the first course so students can enrol.')}>
              {!q && status === 'active' && <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing('new')}><Icon name="plus" size={14} /> {ar ? 'إضافة مادة' : 'Add course'}</button>}
            </EmptyState>
          </div>
        ) : (
          <div className="acx-panel__body">
            <div className="acx-courses acx-courses--wide">
              {courses.map((c) => {
                const facts = [
                  c.credit_hours != null ? `${c.credit_hours} ${ar ? 'ساعات' : 'cr.'}` : null,
                  c.academic_year ? (ar ? `السنة ${c.academic_year}` : `Year ${c.academic_year}`) : null,
                  c.semester ? (ar ? `الفصل ${c.semester}` : `Sem ${c.semester}`) : null,
                ].filter(Boolean);
                const teachers = c.staff || [];
                const archived = c.status !== 'active';
                return (
                  <article key={c.id} className={`acx-course${archived ? ' is-archived' : ''}`}>
                    <div className="acx-item__head">
                      <div style={{ minWidth: 0 }}>
                        <span className="acx-code" dir="ltr">{c.code}</span>
                        <div className="acx-course__name">{courseName(c)}</div>
                      </div>
                      {archived
                        ? <span className="st-pill st-pill--warning">{ar ? 'مؤرشفة' : 'Archived'}</span>
                        : isStaff && (c.can_manage ? <span className="st-pill st-pill--success">{ar ? 'موادي' : 'Mine'}</span> : <span className="st-pill st-pill--neutral">{ar ? 'عرض فقط' : 'View only'}</span>)}
                    </div>
                    {facts.length > 0 && <div className="acx-pills">{facts.map((f) => <span key={f} className="st-pill st-pill--neutral">{f}</span>)}</div>}
                    <ul className="acx-facts">
                      <li><Icon name="building" size={14} /><span>{c.faculty_name || (ar ? 'كل الجامعة' : 'Whole university')}{c.department_name ? ` · ${c.department_name}` : ''}</span></li>
                      <li><Icon name="users" size={14} /><span>{c.students_count} {ar ? 'طالب مسجّل' : 'enrolled students'}</span></li>
                      <li className={teachers.length ? '' : 'is-warn'}>
                        <Icon name="user" size={14} />
                        <span>{teachers.length === 0 ? (ar ? 'لم يُعيَّن مدرّس بعد' : 'No teacher assigned') : teachers.map((t) => t.full_name).join(ar ? '، ' : ', ')}</span>
                      </li>
                    </ul>
                    <div className="acx-actions">
                      {c.can_manage ? (
                        <>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => openManage(c, 'content')}><Icon name="folder" size={13} /> {ar ? 'المحتوى' : 'Content'}</button>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => openManage(c, 'students')}><Icon name="users" size={13} /> {canAssign ? (ar ? 'الطلاب والمدرّسون' : 'Students & teachers') : (ar ? 'الطلاب' : 'Students')}</button>
                          <span style={{ marginInlineStart: 'auto', display: 'inline-flex', gap: 2 }}>
                            <button type="button" className="btn btn-ghost btn-sm" title={ar ? 'تعديل' : 'Edit'} aria-label={ar ? 'تعديل' : 'Edit'} onClick={() => setEditing(c)}><Icon name="edit" size={14} /></button>
                            <button type="button" className="btn btn-ghost btn-sm" disabled={busyId === c.id} title={archived ? (ar ? 'استعادة' : 'Restore') : (ar ? 'أرشفة' : 'Archive')} aria-label={archived ? (ar ? 'استعادة' : 'Restore') : (ar ? 'أرشفة' : 'Archive')} onClick={() => toggleArchive(c)}>
                              <Icon name={archived ? 'refresh' : 'archive'} size={14} />
                            </button>
                          </span>
                        </>
                      ) : <span className="acx-muted"><Icon name="lock" size={13} /> {ar ? 'ليس لديك صلاحية إدارة هذه المادة' : 'You cannot manage this course'}</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </AcPanel>

      {editing && (
        <CourseFormModal
          role={role}
          course={editing === 'new' ? null : editing}
          meta={meta}
          onClose={() => setEditing(null)}
          onDone={(msg) => { setEditing(null); setNotice(msg); load(); }}
        />
      )}
      {managing && (
        <CourseManageModal
          course={managing}
          initialTab={manageTab}
          canAssign={canAssign}
          onClose={() => { setManaging(null); load(); }}
        />
      )}
    </AcPage>
  );
}

/* ------------------------------------------------------------------------------------- */

function CourseFormModal({ role, course, meta, onClose, onDone }) {
  const faculties = meta.faculties;
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const isUni = role === 'university';
  const editing = !!course;

  const [f, setF] = useState({
    code: course?.code || '', name_en: course?.name_en || '', name_ar: course?.name_ar || '', description: course?.description || '',
    credit_hours: course?.credit_hours ?? '', academic_year: course?.academic_year ?? '', semester: course?.semester ?? '',
    faculty_id: course?.faculty_id ?? '', department_id: course?.department_id ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setF((p) => ({ ...p, ...patch }));

  // departments: university → of the chosen faculty; faculty / doctor → their own faculty (server already scoped)
  const departments = isUni ? meta.departments.filter((d) => String(d.faculty_id) === String(f.faculty_id)) : meta.departments;

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const body = {
      code: f.code.trim(), name_en: f.name_en.trim(), name_ar: f.name_ar.trim() || null, description: f.description.trim() || null,
      credit_hours: num(f.credit_hours), academic_year: num(f.academic_year), semester: num(f.semester),
      department_id: num(f.department_id), locale,
    };
    if (isUni) body.faculty_id = num(f.faculty_id);
    try {
      const json = editing ? await api.patch(`/api/v1/courses/${course.id}`, body) : await api.post('/api/v1/courses', body);
      onDone(json.message);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <FormModal
      title={editing ? (ar ? 'تعديل المادة' : 'Edit course') : (ar ? 'إضافة مادة' : 'Add a course')}
      subtitle={ar ? 'سيتمكن طلاب الكلية من التسجيل في هذه المادة من لوحاتهم.' : 'Students of the faculty will be able to enrol in it from their dashboard.'}
      icon="file"
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      submitLabel={editing ? (ar ? 'حفظ' : 'Save') : (ar ? 'إضافة المادة' : 'Add course')}
      error={error}
    >
      <FormSection title={ar ? 'بيانات المادة' : 'Course details'}>
        <FieldGrid>
          <Field label={ar ? 'كود المادة' : 'Course code'} required hint={ar ? 'مثل CS101' : 'e.g. CS101'}>
            <input className="form-input" value={f.code} onChange={(e) => set({ code: e.target.value })} required maxLength={40} autoFocus />
          </Field>
          <Field label={ar ? 'الساعات المعتمدة' : 'Credit hours'}>
            <input className="form-input" type="number" min="0" max="30" value={f.credit_hours} onChange={(e) => set({ credit_hours: e.target.value })} />
          </Field>
          <Field label={ar ? 'الاسم (إنجليزي)' : 'Name (English)'} required>
            <input className="form-input" value={f.name_en} onChange={(e) => set({ name_en: e.target.value })} required maxLength={200} />
          </Field>
          <Field label={ar ? 'الاسم (عربي)' : 'Name (Arabic)'}>
            <input className="form-input" value={f.name_ar} onChange={(e) => set({ name_ar: e.target.value })} maxLength={200} dir="rtl" />
          </Field>
          <Field label={ar ? 'الوصف' : 'Description'} wide>
            <textarea className="form-input" rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} maxLength={2000} />
          </Field>
        </FieldGrid>
      </FormSection>

      <FormSection title={ar ? 'التسكين' : 'Placement'} hint={isUni ? (ar ? 'اتركها بلا كلية لتكون المادة متاحة لكل الجامعة.' : 'Leave the faculty empty to open the course to the whole university.') : (ar ? 'تُضاف المادة إلى كليتك.' : 'The course is added to your faculty.')}>
        <FieldGrid>
          {isUni && (
            <Field label={ar ? 'الكلية' : 'Faculty'}>
              <select className="form-input" value={f.faculty_id} onChange={(e) => set({ faculty_id: e.target.value, department_id: '' })}>
                <option value="">{ar ? '— كل الجامعة —' : '— Whole university —'}</option>
                {faculties.map((x) => <option key={x.id} value={x.id}>{ar ? (x.name_ar || x.name_en) : x.name_en}</option>)}
              </select>
            </Field>
          )}
          <Field label={ar ? 'القسم' : 'Department'}>
            <select className="form-input" value={f.department_id} onChange={(e) => set({ department_id: e.target.value })} disabled={isUni && !f.faculty_id}>
              <option value="">{ar ? '— بدون قسم —' : '— No department —'}</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{ar ? (d.name_ar || d.name_en) : d.name_en}</option>)}
            </select>
          </Field>
          <Field label={ar ? 'السنة الدراسية' : 'Academic year'}>
            <select className="form-input" value={f.academic_year} onChange={(e) => set({ academic_year: e.target.value })}>
              <option value="">{ar ? '— أي سنة —' : '— Any year —'}</option>
              {YEARS.map((y) => <option key={y} value={y}>{ar ? `السنة ${y}` : `Year ${y}`}</option>)}
            </select>
          </Field>
          <Field label={ar ? 'الفصل' : 'Semester'}>
            <select className="form-input" value={f.semester} onChange={(e) => set({ semester: e.target.value })}>
              <option value="">{ar ? '— أي فصل —' : '— Any —'}</option>
              <option value="1">{ar ? 'الفصل الأول' : 'Semester 1'}</option>
              <option value="2">{ar ? 'الفصل الثاني' : 'Semester 2'}</option>
            </select>
          </Field>
        </FieldGrid>
      </FormSection>
    </FormModal>
  );
}

/* ------------------------------------------------------------------------------------- */

function CourseManageModal({ course, canAssign, initialTab = 'students', onClose }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [tab, setTab] = useState(initialTab);
  const [roster, setRoster] = useState([]);
  const [staff, setStaff] = useState(course.staff || []);
  const [allStaff, setAllStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [adding, setAdding] = useState(false);

  const loadRoster = useCallback(() => api.get(`/api/v1/courses/${course.id}/students`, { locale }).then((j) => setRoster(j.data || [])), [course.id, locale]);

  useEffect(() => {
    loadRoster().catch((err) => setError(errorMessage(err))).finally(() => setLoading(false));
  }, [loadRoster]);

  useEffect(() => {
    if (!canAssign || tab !== 'teachers' || allStaff.length) return;
    api.get('/api/v1/academic-staff', { per_page: 200 }).then((j) => setAllStaff(j.data || [])).catch(() => {});
  }, [canAssign, tab, allStaff.length]);

  async function removeStudent(s) {
    if (!window.confirm(ar ? `إزالة ${s.full_name} من المادة؟` : `Remove ${s.full_name} from this course?`)) return;
    setError(null);
    try {
      await api.delete(`/api/v1/courses/${course.id}/students/${s.id}`);
      setRoster((r) => r.filter((x) => x.id !== s.id));
    } catch (err) { setError(errorMessage(err)); }
  }

  async function assign(id) {
    setError(null);
    try {
      await api.post(`/api/v1/courses/${course.id}/staff`, { academic_staff_id: Number(id), locale });
      const picked = allStaff.find((x) => String(x.id) === String(id));
      if (picked) setStaff((s) => (s.some((x) => x.id === picked.id) ? s : [...s, { id: picked.id, full_name: picked.full_name }]));
    } catch (err) { setError(errorMessage(err)); }
  }

  async function unassign(id) {
    setError(null);
    try {
      await api.delete(`/api/v1/courses/${course.id}/staff/${id}`);
      setStaff((s) => s.filter((x) => x.id !== id));
    } catch (err) { setError(errorMessage(err)); }
  }

  const availableStaff = allStaff.filter((a) => !staff.some((s) => s.id === a.id) && (!course.faculty_id || !a.faculty_id || Number(a.faculty_id) === Number(course.faculty_id)));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="pf-modal" onClick={(e) => e.stopPropagation()}>
        <header className="pf-head">
          <span className="pf-head__icon"><Icon name="users" size={20} /></span>
          <div className="pf-head__text">
            <h2>{course.code} — {ar ? (course.name_ar || course.name_en) : course.name_en}</h2>
            <p>{roster.length} {ar ? 'طالب مسجّل' : 'enrolled students'}</p>
          </div>
          <button type="button" className="pf-x" onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}><Icon name="x" size={18} /></button>
        </header>

        <div className="acx-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'students'} className={tab === 'students' ? 'is-on' : ''} onClick={() => setTab('students')}>{ar ? 'الطلاب' : 'Students'}<small>{roster.length}</small></button>
          <button type="button" role="tab" aria-selected={tab === 'content'} className={tab === 'content' ? 'is-on' : ''} onClick={() => setTab('content')}>{ar ? 'المحتوى' : 'Content'}</button>
          <button type="button" role="tab" aria-selected={tab === 'grades'} className={tab === 'grades' ? 'is-on' : ''} onClick={() => setTab('grades')}>{ar ? 'الدرجات' : 'Grades'}</button>
          {canAssign && <button type="button" role="tab" aria-selected={tab === 'teachers'} className={tab === 'teachers' ? 'is-on' : ''} onClick={() => setTab('teachers')}>{ar ? 'المدرّسون' : 'Teachers'}<small>{staff.length}</small></button>}
        </div>

        <div className="pf-body" style={{ paddingTop: 16 }}>
          {error && <div className="pf-error" role="alert"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}
          {flash && <p className="text-small" style={{ color: 'var(--color-success)' }}>{flash}</p>}

          {tab === 'students' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <p className="text-small" style={{ margin: 0 }}>{ar ? 'الطلاب الذين سجّلوا في هذه المادة أو أضفتهم يدويًا.' : 'Students who enrolled in this course or were added by hand.'}</p>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> {ar ? 'إضافة طلاب' : 'Add students'}</button>
              </div>
              {loading ? <Skeleton h={44} count={3} /> : roster.length === 0 ? (
                <EmptyState icon="users" title={ar ? 'لا يوجد طلاب مسجّلون بعد' : 'No students enrolled yet'} text={ar ? 'سيظهر هنا كل طالب يختار هذه المادة من لوحته.' : 'Every student who picks this course from their dashboard will appear here.'} />
              ) : (
                <AcTable>
                    <thead><tr><th>{ar ? 'الطالب' : 'Student'}</th><th>{ar ? 'الرقم الجامعي' : 'Student ID'}</th><th>{ar ? 'القسم' : 'Department'}</th><th>{ar ? 'المصدر' : 'Source'}</th><th /></tr></thead>
                    <tbody>
                      {roster.map((s) => (
                        <tr key={s.id}>
                          <td><div className="ex-student-cell"><PersonAvatar name={s.full_name} /><div style={{ minWidth: 0 }}><strong>{s.full_name}</strong><small>{s.email}</small></div></div></td>
                          <td className="is-muted">{s.student_number || '—'}</td>
                          <td className="is-muted">{s.department || s.faculty || '—'}</td>
                          <td className="is-muted">{s.source === 'staff' ? (ar ? 'أُضيف يدويًا' : 'Added by staff') : (ar ? 'سجّل بنفسه' : 'Self-enrolled')}</td>
                          <td className="is-end"><button type="button" className="ex-icon-btn ex-icon-btn--danger" title={ar ? 'إزالة' : 'Remove'} aria-label={ar ? 'إزالة' : 'Remove'} onClick={() => removeStudent(s)}><Icon name="trash" size={15} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                </AcTable>
              )}
            </>
          )}

          {tab === 'content' && <CourseMaterials courseId={course.id} canManage />}

          {tab === 'grades' && <CourseGradebook courseId={course.id} />}

          {tab === 'teachers' && (
            <>
              {staff.length === 0 ? (
                <p className="text-small">{ar ? 'لم يُعيَّن مدرّس لهذه المادة بعد.' : 'No teacher is assigned to this course yet.'}</p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                  {staff.map((s) => (
                    <span key={s.id} className="ex-status ex-status--submitted" style={{ gap: 8, padding: '5px 8px 5px 12px' }}>
                      {s.full_name}
                      <button type="button" onClick={() => unassign(s.id)} aria-label={ar ? 'إزالة' : 'Remove'} style={{ background: 'none', border: 0, cursor: 'pointer', color: 'inherit', display: 'grid' }}><Icon name="x" size={13} /></button>
                    </span>
                  ))}
                </div>
              )}
              <Field label={ar ? 'تعيين مدرّس' : 'Assign a teacher'}>
                <select className="form-input" value="" onChange={(e) => e.target.value && assign(e.target.value)}>
                  <option value="">{availableStaff.length ? (ar ? '— اختر دكتورًا / معيدًا —' : '— Select a doctor / TA —') : (ar ? 'لا يوجد أعضاء متاحون' : 'No staff available')}</option>
                  {availableStaff.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                </select>
              </Field>
            </>
          )}
        </div>
      </div>

      {adding && (
        <AddStudentsModal
          course={course}
          onClose={() => setAdding(false)}
          onDone={(msg) => { setAdding(false); setFlash(msg); loadRoster(); }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------- */

function AddStudentsModal({ course, onClose, onDone }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    const h = setTimeout(() => {
      api.get(`/api/v1/courses/${course.id}/students/candidates`, q.trim() ? { q: q.trim() } : {})
        .then((j) => setRows(j.data || []))
        .catch((err) => setError(errorMessage(err)))
        .finally(() => setLoading(false));
    }, q ? 300 : 0);
    return () => clearTimeout(h);
  }, [q, course.id]);

  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const json = await api.post(`/api/v1/courses/${course.id}/students`, { student_ids: [...picked], locale });
      onDone(json.message);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <FormModal
      title={ar ? 'إضافة طلاب إلى المادة' : 'Add students to the course'}
      subtitle={ar ? 'الطلاب غير المسجّلين في هذه المادة.' : 'Students who are not enrolled in this course yet.'}
      icon="users"
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      submitDisabled={picked.size === 0}
      submitLabel={ar ? `إضافة (${picked.size})` : `Add (${picked.size})`}
      error={error}
    >
      <div style={{ marginBottom: 12 }}>
        <input className="acx-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'ابحث بالاسم أو الرقم الجامعي' : 'Search by name or student ID'} autoFocus />
      </div>
      {loading ? <Skeleton h={40} count={3} /> : rows.length === 0 ? (
        <p className="text-small" style={{ textAlign: 'center', padding: 20 }}>{ar ? 'لا يوجد طلاب متاحون للإضافة.' : 'No students available to add.'}</p>
      ) : (
        <AcTable>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} onClick={() => toggle(s.id)} style={{ cursor: 'pointer' }}>
                  <td style={{ width: 40 }}><input type="checkbox" className="ex-check-input" checked={picked.has(s.id)} onChange={() => toggle(s.id)} aria-label={s.full_name} /></td>
                  <td><div className="ex-student-cell"><PersonAvatar name={s.full_name} /><div style={{ minWidth: 0 }}><strong>{s.full_name}</strong><small>{s.email}</small></div></div></td>
                  <td className="is-muted">{s.student_number || '—'}</td>
                  <td className="is-muted">{s.department || s.faculty || '—'}</td>
                </tr>
              ))}
            </tbody>
        </AcTable>
      )}
    </FormModal>
  );
}
