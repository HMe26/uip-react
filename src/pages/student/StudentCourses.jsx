import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { StudentCourseGrade } from '../../components/courses/CourseGradebook';
import { useLanguage } from '../../context/LanguageContext';
import { EmptyState, Skeleton } from '../../components/student/stUi';
import { ExKpi } from '../../components/exam/examUi';
import CourseRequestDialog from '../../components/courses/CourseRequestDialog';
import CourseMaterials from '../../components/courses/CourseMaterials';
import { decidedByText, downloadRequestAttachment, requestStatusLabel } from '../../components/courses/CourseRequestsInbox';

/**
 * Student "Courses". GET /api/v1/courses lists the active courses of the student's faculty
 * (+ university-wide ones) with `enrolled` and `pending_request`. Enrolling / leaving is never
 * instant: the student confirms a warning dialog, adds an optional message + attachment, and the
 * request goes to the university, faculty and course staff (POST /courses/{id}/enroll|unenroll).
 * The first approval applies it. GET /courses/requests lists the student's own requests.
 */
export default function StudentCourses() {
  const { locale } = useLanguage();
  const navigate = useNavigate();
  const ar = locale === 'ar';
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [tab, setTab] = useState('mine');
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [gradesFor, setGradesFor] = useState(null);
  const [dialog, setDialog] = useState(null); // { course, type }
  const [requests, setRequests] = useState([]);

  const load = useCallback(() => Promise.all([
    api.get('/api/v1/courses', { locale }).then((j) => setCourses(j.data || [])),
    api.get('/api/v1/courses/requests', { locale }).then((j) => setRequests(j.data || [])).catch(() => {}),
  ]), [locale]);

  useEffect(() => {
    load().catch((err) => setError(errorMessage(err))).finally(() => setLoading(false));
  }, [load]);

  const mine = useMemo(() => courses.filter((c) => c.enrolled), [courses]);
  const credits = useMemo(() => mine.reduce((a, c) => a + (c.credit_hours || 0), 0), [mine]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return courses
      .filter((c) => (tab === 'mine' ? c.enrolled : !c.enrolled))
      .filter((c) => !needle || `${c.code} ${c.name_en} ${c.name_ar || ''}`.toLowerCase().includes(needle));
  }, [courses, tab, q]);

  async function withdraw(c) {
    if (!c.pending_request) return;
    if (!window.confirm(ar ? 'سحب طلبك الحالي لهذه المادة؟' : 'Withdraw your current request for this course?')) return;
    setBusyId(c.id);
    setError(null);
    setNotice(null);
    try {
      const json = await api.post(`/api/v1/courses/requests/${c.pending_request.id}/cancel`, { locale });
      setNotice(json.message);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  if (loading) return <div className="ex-page"><Skeleton h={100} count={3} /></div>;

  return (
    <div className="ex-page">
      <div className="ex-kpis">
        <ExKpi label={ar ? 'موادي' : 'My courses'} value={mine.length} sub={ar ? 'المواد المسجّل بها' : 'Courses you are enrolled in'} icon="file" tone="good" />
        <ExKpi label={ar ? 'متاحة للتسجيل' : 'Available to join'} value={courses.length - mine.length} sub={ar ? 'من كليتك' : 'From your faculty'} icon="plus" />
        <ExKpi label={ar ? 'الساعات المعتمدة' : 'Credit hours'} value={credits} sub={ar ? 'إجمالي موادك' : 'Across your courses'} icon="award" />
      </div>

      {error && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}
      {notice && <div className="ex-note ex-note--good"><Icon name="check-circle" size={16} /><div>{notice}</div></div>}

      <div className="ex-card">
        <div className="ex-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'mine'} className={`ex-tab${tab === 'mine' ? ' is-active' : ''}`} onClick={() => setTab('mine')}>{ar ? 'موادي' : 'My courses'}<small>({mine.length})</small></button>
          <button type="button" role="tab" aria-selected={tab === 'browse'} className={`ex-tab${tab === 'browse' ? ' is-active' : ''}`} onClick={() => setTab('browse')}>{ar ? 'تصفّح وسجّل' : 'Browse & enrol'}<small>({courses.length - mine.length})</small></button>
          <button type="button" role="tab" aria-selected={tab === 'saved'} className={`ex-tab${tab === 'saved' ? ' is-active' : ''}`} onClick={() => setTab('saved')}><Icon name="bookmark" size={14} /> {ar ? 'المحفوظات' : 'Saved'}</button>
          <button type="button" role="tab" aria-selected={tab === 'requests'} className={`ex-tab${tab === 'requests' ? ' is-active' : ''}`} onClick={() => setTab('requests')}>{ar ? 'طلباتي' : 'My requests'}<small>({requests.length})</small>{pendingCount > 0 && <i className="cr-dot" aria-hidden="true" />}</button>
        </div>
        {tab === 'saved' ? (
          <div style={{ padding: '4px 20px 22px' }}><CourseMaterials saved /></div>
        ) : tab === 'requests' ? (
          <div style={{ padding: '4px 20px 22px' }}>
            {requests.length === 0 ? (
              <EmptyState icon="file" title={ar ? 'لا توجد طلبات بعد' : 'No requests yet'} text={ar ? 'طلبات التسجيل والإلغاء التي ترسلها تظهر هنا مع حالتها.' : 'Enrol and leave requests you send appear here with their status.'} />
            ) : (
              <ul className="cr-req-list">
                {requests.map((r) => (
                  <li key={r.id} className="cr-req">
                    <div className="cr-req__top">
                      <span className={`ex-chip cr-type cr-type--${r.type}`}>{r.type === 'enroll' ? (ar ? 'طلب تسجيل' : 'Enrol') : (ar ? 'طلب إلغاء' : 'Leave')}</span>
                      <strong>{r.course_code} — {r.course_name}</strong>
                      <span className={`cr-status cr-status--${r.status}`}>{requestStatusLabel(r.status, ar)}</span>
                    </div>
                    <p className="cr-req__who">{new Date(r.created_at).toLocaleString(ar ? 'ar-EG' : undefined)}</p>
                    {r.message && <p className="cr-req__msg">{r.message}</p>}
                    {r.has_attachment && <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadRequestAttachment(r).catch((e) => setError(errorMessage(e)))}><Icon name="file" size={14} /> {r.attachment_name}</button>}
                    {r.status !== 'pending' && decidedByText(r, ar) && <p className="cr-req__who">{ar ? 'القرار: ' : 'Decision: '}{decidedByText(r, ar)}{r.decision_note ? ` — ${r.decision_note}` : ''}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (<>
        <div className="ex-toolbar">
          <div className="ex-search">
            <Icon name="search" size={15} />
            <input className="ex-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'ابحث بكود أو اسم المادة' : 'Search by code or course name'} aria-label={ar ? 'بحث' : 'Search'} />
          </div>
        </div>

        {shown.length === 0 ? (
          <div style={{ padding: 24 }}>
            {courses.length === 0 ? (
              <EmptyState icon="file" title={ar ? 'لا توجد مواد متاحة بعد' : 'No courses are available yet'} text={ar ? 'ستظهر هنا المواد التي تضيفها كليتك أو أساتذتك.' : 'Courses added by your faculty or doctors will appear here.'} />
            ) : tab === 'mine' ? (
              <EmptyState icon="file" title={ar ? 'لم تسجّل في أي مادة بعد' : 'You have not enrolled in any course yet'} text={ar ? 'اختر موادك من تبويب «تصفّح وسجّل».' : 'Pick your courses from the “Browse & enrol” tab.'}>
                <button type="button" className="btn btn-primary" onClick={() => setTab('browse')}><Icon name="plus" size={16} /> {ar ? 'تصفّح المواد' : 'Browse courses'}</button>
              </EmptyState>
            ) : (
              <EmptyState icon="search" title={q ? (ar ? 'لا توجد مواد مطابقة' : 'No courses match') : (ar ? 'سجّلت في كل المواد المتاحة' : 'You are enrolled in every available course')} />
            )}
          </div>
        ) : (
          <div className="cr-grid">
            {shown.map((c) => (
              <article key={c.id} className={`cr-card${c.enrolled ? ' is-on' : ''}`}>
                <div className="cr-card__top">
                  <span className="ex-chip">{c.code}</span>
                  {c.enrolled && <span className="ex-status ex-status--graded">{ar ? 'مسجّل' : 'Enrolled'}</span>}
                </div>
                <h3>{c.name}</h3>
                <p className="cr-card__meta">
                  {[c.faculty_name || (ar ? 'كل الجامعة' : 'Whole university'), c.department_name].filter(Boolean).join(' · ')}
                </p>
                <p className="cr-card__meta">
                  {[c.credit_hours != null ? `${c.credit_hours} ${ar ? 'ساعات' : 'credit hrs'}` : null, c.academic_year ? (ar ? `السنة ${c.academic_year}` : `Year ${c.academic_year}`) : null, c.semester ? (ar ? `الفصل ${c.semester}` : `Semester ${c.semester}`) : null].filter(Boolean).join(' · ')}
                </p>
                <p className="cr-card__staff"><Icon name="users" size={14} /> {(c.staff || []).length ? c.staff.map((s) => s.full_name).join('، ') : (ar ? 'لم يُعيَّن مدرّس بعد' : 'No teacher assigned yet')}</p>
                {c.enrolled && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate(`/student/courses/${c.id}/content`)}>
                    <Icon name="folder" size={14} /> {ar ? 'محتوى المادة' : 'Course content'}
                  </button>
                )}
                {c.enrolled && (
                  <>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGradesFor(gradesFor === c.id ? null : c.id)}>
                      {ar ? 'درجتي' : 'My grade'} {gradesFor === c.id ? '▴' : '▾'}
                    </button>
                    {gradesFor === c.id && <StudentCourseGrade courseId={c.id} />}
                  </>
                )}
                {c.pending_request ? (
                  <>
                    <span className="cr-pending"><Icon name="clock" size={14} /> {c.pending_request.type === 'drop' ? (ar ? 'طلب الإلغاء قيد المراجعة' : 'Leave request pending') : (ar ? 'طلب التسجيل قيد المراجعة' : 'Enrol request pending')}</span>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busyId === c.id} onClick={() => withdraw(c)}>{ar ? 'سحب الطلب' : 'Withdraw request'}</button>
                  </>
                ) : (
                  <button type="button" className={`btn ${c.enrolled ? 'btn-outline' : 'btn-primary'}`} disabled={busyId === c.id} onClick={() => setDialog({ course: c, type: c.enrolled ? 'drop' : 'enroll' })}>
                    {c.enrolled ? (ar ? 'طلب إلغاء التسجيل' : 'Request to leave') : (ar ? 'طلب التسجيل في المادة' : 'Request to enrol')}
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
        </>)}
      </div>

      {dialog && (
        <CourseRequestDialog
          course={dialog.course}
          type={dialog.type}
          onClose={() => setDialog(null)}
          onDone={(msg) => { setDialog(null); setNotice(msg); load().catch(() => {}); }}
        />
      )}
    </div>
  );
}
