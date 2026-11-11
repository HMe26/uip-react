import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { PersonAvatar, whenLabel } from '../../components/staff/stfUi';
import { Pill, Skeleton } from '../../components/student/stUi';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { parseServerDate } from '../../utils/serverDate';

/**
 * Academic Staff home (Academic Staff design). Every number comes from the
 * endpoints this page always used: GET /academic-staff/me, /exam-system/exams,
 * /exam-system/question-banks and /exam-system/dashboard/instructor
 * (total_exams / active_exams / pending_grading / recent_results).
 * "Needs your attention" is derived from that real data (pending grading,
 * exams still in draft) — nothing is invented, and project/student widgets from
 * the design are not shown because this role has no API for them.
 */

const EXAM_TONE = { draft: 'neutral', scheduled: 'warning', published: 'success', active: 'success', closed: 'neutral', grading: '', graded: 'success', archived: 'neutral' };
const EXAM_LABEL = {
  draft: ['Draft', 'مسودة'], scheduled: ['Scheduled', 'مجدول'], published: ['Published', 'منشور'], active: ['Live', 'جارٍ'],
  closed: ['Closed', 'مغلق'], grading: ['Grading', 'قيد التصحيح'], graded: ['Graded', 'تم التصحيح'], archived: ['Archived', 'مؤرشف'],
};

/** Academic year / semester derived from today's date (Sep–Jan first term, Feb–Jun second, otherwise summer). */
function academicTerm(now, ar) {
  const m = now.getMonth() + 1;
  const y = now.getFullYear();
  const start = m >= 9 ? y : y - 1;
  const year = `${start}/${start + 1}`;
  let term;
  if (m >= 9 || m === 1) term = ar ? 'الفصل الدراسي الأول' : 'First Semester';
  else if (m >= 2 && m <= 6) term = ar ? 'الفصل الدراسي الثاني' : 'Second Semester';
  else term = ar ? 'الفصل الصيفي' : 'Summer Term';
  return ar ? `العام الأكاديمي ${year} · ${term}` : `Academic Year ${year} · ${term}`;
}

function greeting(now, ar) {
  const h = now.getHours();
  if (h < 12) return ar ? 'صباح الخير' : 'Good morning';
  if (h < 18) return ar ? 'مساء الخير' : 'Good afternoon';
  return ar ? 'مساء الخير' : 'Good evening';
}

/** Generic academic emblem (columns + pediment); purely decorative. */
function Crest() {
  return (
    <svg className="ac-hero__crest" viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M100 18 20 62h160L100 18Z" />
      <path d="M30 62v10h140V62" />
      {[48, 74, 100, 126, 152].map((x) => <path key={x} d={`M${x} 82v70`} />)}
      <path d="M30 152h140v12H30zM18 164h164v14H18z" />
    </svg>
  );
}

function dateParts(iso, locale) {
  const d = parseServerDate(String(iso));
  if (Number.isNaN(d.getTime())) return null;
  const tag = locale === 'ar' ? 'ar-EG' : 'en-US';
  return { m: d.toLocaleDateString(tag, { month: 'short' }), d: d.toLocaleDateString(tag, { day: 'numeric' }) };
}

function gradeClass(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return '';
  return n >= 60 ? '' : n >= 50 ? 'ac-grade--mid' : 'ac-grade--low';
}

function Empty({ icon, children }) {
  return <div className="ac-empty"><Icon name={icon} size={22} />{children}</div>;
}


export default function AcademicStaffDashboard() {
  const { locale } = useLanguage();
  const { user } = useAuth();
  const ar = locale === 'ar';
  const [staff, setStaff] = useState(null);
  const [banks, setBanks] = useState([]);
  const [exams, setExams] = useState([]);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get('/api/v1/academic-staff/me'),
      api.get('/api/v1/exam-system/question-banks'),
      api.get('/api/v1/exam-system/exams'),
      api.get('/api/v1/exam-system/dashboard/instructor'),
    ])
      .then(([meJson, banksJson, examsJson, overviewJson]) => {
        if (cancelled) return;
        setStaff(meJson.data?.staff || null);
        setBanks(banksJson.data || []);
        setExams(examsJson.data || []);
        setOverview(overviewJson.data || null);
      })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="st-page"><Skeleton h={110} count={3} /></div>;
  if (error) return <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>;

  const name = staff?.full_name || user?.full_name || user?.name || '';
  const pending = overview?.pending_grading ?? 0;
  const upcoming = exams
    .filter((e) => (e.status === 'scheduled' || e.status === 'published') && e.start_at && new Date(String(e.start_at).replace(' ', 'T')) > new Date())
    .sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)));
  const drafts = exams.filter((e) => e.status === 'draft');
  const recentResults = overview?.recent_results || [];

  // Needs your attention — built only from real data.
  const attention = [];
  if (pending > 0) {
    attention.push({
      key: 'grading', tone: 'bad',
      title: ar ? 'تصحيح الامتحانات' : 'Exam Grading',
      text: ar ? `${pending} تسليمات تنتظر المراجعة اليدوية.` : `${pending} submission${pending === 1 ? '' : 's'} waiting for manual review.`,
      cta: ar ? 'فتح النتائج' : 'Open Results', to: '/academic-staff/attempts', primary: true,
    });
  }
  drafts.slice(0, 3).forEach((e) => attention.push({
    key: `draft-${e.id}`, tone: 'warn',
    title: e.title,
    text: ar ? 'امتحان ما زال مسودة — أكمله وانشره.' : 'Still a draft — finish it and publish.',
    cta: ar ? 'فتح الامتحان' : 'Open Exam', to: `/academic-staff/exams/${e.id}`,
  }));


  const now = new Date();
  const tag = ar ? 'ar-EG' : 'en-US';
  const todayLabel = now.toLocaleDateString(tag, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const quick = [
    { to: '/academic-staff/exams', icon: 'file', title: ar ? 'الامتحانات' : 'Exams', sub: ar ? 'إنشاء وجدولة ونشر' : 'Create, schedule, publish' },
    { to: '/academic-staff/attempts', icon: 'edit', title: ar ? 'التصحيح' : 'Grading', sub: pending > 0 ? (ar ? `${pending} بانتظار المراجعة` : `${pending} awaiting review`) : (ar ? 'لا شيء معلّق' : 'Nothing pending') },
    { to: '/academic-staff/question-banks', icon: 'archive', title: ar ? 'بنوك الأسئلة' : 'Question Banks', sub: ar ? `${banks.length} بنك` : `${banks.length} bank${banks.length === 1 ? '' : 's'}` },
    { to: '/academic-staff/courses', icon: 'layers', title: ar ? 'المقررات' : 'Courses', sub: ar ? 'إدارة موادك' : 'Manage your courses' },
  ];

  return (
    <div className="ac-page">
      <section className="ac-hero">
        <Crest />
        <div className="ac-hero__top">
          <span className="ac-hero__term">{academicTerm(now, ar)}</span>
          <span className="ac-hero__date"><Icon name="calendar" size={14} />{todayLabel}</span>
        </div>
        <h1>{greeting(now, ar)}{name ? (ar ? `، ${name}` : `, ${name}`) : ''}</h1>
        <p>{pending > 0
          ? (ar ? `لديك ${pending} تسليمات تنتظر المراجعة، و${upcoming.length} امتحانات قادمة.` : `You have ${pending} submission${pending === 1 ? '' : 's'} awaiting review and ${upcoming.length} upcoming exam${upcoming.length === 1 ? '' : 's'}.`)
          : (ar ? 'إليك نظرة سريعة على امتحاناتك ومقرراتك ونتائج طلابك.' : 'A quick overview of your exams, courses and student results.')}</p>
        <div className="ac-hero__actions">
          <Link to="/academic-staff/exams" className="btn btn-light"><Icon name="plus" size={15} /> {ar ? 'إنشاء امتحان' : 'Create Exam'}</Link>
          <Link to="/academic-staff/attempts" className="btn btn-ghost">{ar ? 'تصحيح المحاولات' : 'Grade Attempts'}</Link>
        </div>
        <div className="ac-stats">
          <div className="ac-stat"><span className="ac-stat__value">{overview?.total_exams ?? exams.length}</span><span className="ac-stat__label">{ar ? 'امتحاناتي' : 'My Exams'}</span></div>
          <div className="ac-stat"><span className="ac-stat__value">{overview?.active_exams ?? 0}</span><span className="ac-stat__label">{ar ? 'امتحانات جارية' : 'Active Exams'}</span></div>
          <div className="ac-stat"><span className="ac-stat__value">{upcoming.length}</span><span className="ac-stat__label">{ar ? 'امتحانات قادمة' : 'Upcoming Exams'}</span></div>
          <div className="ac-stat"><span className="ac-stat__value ac-stat__value--gold">{pending}</span><span className="ac-stat__label">{ar ? 'بانتظار التصحيح' : 'Pending Grading'}</span></div>
        </div>
      </section>

      {staff && staff.status !== 'active' && (
        <div className="st-alert st-alert--warning"><Icon name="alert-triangle" size={16} /><span>{ar ? 'حسابك غير نشط حاليًا. تواصل مع جامعتك.' : 'Your account is not currently active. Contact your university.'}</span></div>
      )}

      <nav className="ac-quick" aria-label={ar ? 'وصول سريع' : 'Quick access'}>
        {quick.map((q) => (
          <Link key={q.to} to={q.to} className="ac-tile">
            <span className="ac-tile__icon"><Icon name={q.icon} size={20} /></span>
            <div style={{ minWidth: 0 }}><strong>{q.title}</strong><span className="ac-tile__sub">{q.sub}</span></div>
            <Icon name="arrow-right" size={16} className="ac-tile__arrow" />
          </Link>
        ))}
      </nav>

      <div className="ac-grid">
        <div className="ac-col">
          <section className="ac-panel">
            <div className="ac-panel__head"><h2>{ar ? 'يحتاج انتباهك' : 'Needs Your Attention'}</h2><Link to="/academic-staff/exams" className="st-link">{ar ? 'عرض الكل' : 'View all'}</Link></div>
            {attention.length === 0 ? (
              <Empty icon="check-circle">{ar ? 'لا شيء ينتظرك الآن. عمل رائع!' : "Nothing is waiting on you right now. You're all caught up."}</Empty>
            ) : (
              <ul className="ac-attn">
                {attention.map((a) => (
                  <li key={a.key}>
                    <div className="ac-attn__main">
                      <span className={`ac-attn__badge${a.tone === 'bad' ? ' ac-attn__badge--bad' : ''}`}><Icon name={a.tone === 'bad' ? 'edit' : 'file'} size={16} /></span>
                      <div style={{ minWidth: 0 }}><strong>{a.title}</strong><small>{a.text}</small></div>
                    </div>
                    <Link to={a.to} className={a.primary ? 'btn btn-primary btn-sm' : 'st-link'}>{a.cta}</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ac-panel">
            <div className="ac-panel__head"><h2>{ar ? 'أحدث النتائج' : 'Recent Results'}</h2><Link to="/academic-staff/results" className="st-link">{ar ? 'كل النتائج' : 'All results'}</Link></div>
            {recentResults.length === 0 ? (
              <Empty icon="award">{ar ? 'لا توجد نتائج مصححة بعد.' : 'No graded results yet.'}</Empty>
            ) : (
              <div className="ac-table-wrap">
                <table className="ac-table ac-table--stack">
                  <thead><tr><th>{ar ? 'الطالب' : 'Student'}</th><th>{ar ? 'الامتحان' : 'Exam'}</th><th>{ar ? 'الدرجة' : 'Score'}</th><th>{ar ? 'وقت التسليم' : 'Submitted'}</th></tr></thead>
                  <tbody>
                    {recentResults.map((r, i) => (
                      <tr key={i}>
                        <td className="ac-cell-student"><div className="ac-student"><PersonAvatar name={r.student_name} /><span>{r.student_name}</span></div></td>
                        <td data-label={ar ? 'الامتحان' : 'Exam'}>{r.exam_id ? <Link to={`/academic-staff/exams/${r.exam_id}/attempts`} className="st-link">{r.exam_title}</Link> : r.exam_title}</td>
                        <td data-label={ar ? 'الدرجة' : 'Score'}>{r.percentage !== null && r.percentage !== undefined
                          ? <span className={`ac-grade ${gradeClass(r.percentage)}`}>{r.percentage}%<span className="ac-grade__bar"><span style={{ width: `${Math.max(0, Math.min(100, Number(r.percentage)))}%` }} /></span></span>
                          : '—'}</td>
                        <td className="st-muted" data-label={ar ? 'وقت التسليم' : 'Submitted'}>{r.submitted_at || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="ac-col">
          <section className="ac-panel">
            <div className="ac-panel__head"><h2>{ar ? 'الامتحانات القادمة' : 'Upcoming Exams'}</h2><Link to="/academic-staff/exams" className="st-link">{ar ? 'عرض الكل' : 'View all'}</Link></div>
            {upcoming.length === 0 ? (
              <Empty icon="calendar">{ar ? 'لا توجد امتحانات قادمة.' : 'No upcoming exams.'}</Empty>
            ) : (
              <ul className="ac-sched">
                {upcoming.slice(0, 4).map((e) => {
                  const lbl = EXAM_LABEL[e.status] || EXAM_LABEL.scheduled;
                  const dp = dateParts(e.start_at, locale);
                  return (
                    <li key={e.id}>
                      {dp && <span className="ac-date"><span className="ac-date__m">{dp.m}</span><span className="ac-date__d">{dp.d}</span></span>}
                      <div className="ac-sched__main">
                        <Link to={`/academic-staff/exams/${e.id}`} className="ac-title">{e.title}</Link>
                        <small>{whenLabel(e.start_at, locale)}</small>
                      </div>
                      <Pill tone={EXAM_TONE[e.status] ?? ''}>{ar ? lbl[1] : lbl[0]}</Pill>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <MyCoursesPanel ar={ar} locale={locale} />

          <section className="ac-panel">
            <div className="ac-panel__head"><h2>{ar ? 'بنوك الأسئلة' : 'Question Banks'}</h2><Link to="/academic-staff/question-banks" className="st-link">{ar ? 'عرض الكل' : 'View all'}</Link></div>
            {banks.length === 0 ? (
              <Empty icon="archive">{ar ? 'لا توجد بنوك أسئلة بعد.' : 'No question banks yet.'}</Empty>
            ) : (
              <ul className="ac-courses">
                {banks.slice(0, 5).map((b) => (
                  <li key={b.id}>
                    <Link to={`/academic-staff/question-banks/${b.id}`} className="ac-courses__name">{b.title}</Link>
                    <span className="ac-courses__meta">{b.questions_count || 0} {ar ? 'سؤال' : 'questions'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

/** Doctor's courses with how many students picked each one. */
function MyCoursesPanel({ ar, locale }) {
  const [courses, setCourses] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get('/api/v1/courses', { locale, mine: 1 })
      .then((j) => { if (alive) setCourses(j.data || []); })
      .catch(() => { if (alive) setCourses([]); });
    return () => { alive = false; };
  }, [locale]);

  if (courses === null) return null;
  return (
    <section className="ac-panel">
      <div className="ac-panel__head"><h2>{ar ? 'موادي' : 'My Courses'}</h2><Link to="/academic-staff/courses" className="st-link">{ar ? 'إدارة المواد' : 'Manage'}</Link></div>
      {courses.length === 0 ? (
        <div className="ac-empty">
          <Icon name="layers" size={22} />
          <p style={{ margin: '0 0 12px' }}>{ar ? 'لم تضف أي مادة بعد. أضف موادك ليسجّل الطلاب فيها.' : 'You have no courses yet. Add yours so students can enrol.'}</p>
          <Link to="/academic-staff/courses" className="btn btn-primary btn-sm">{ar ? 'إضافة مادة' : 'Add a course'}</Link>
        </div>
      ) : (
        <ul className="ac-courses">
          {courses.slice(0, 6).map((c) => (
            <li key={c.id}>
              <span className="ac-code">{c.code}</span>
              <span className="ac-courses__name">{c.name}</span>
              <span className="ac-courses__meta"><Icon name="users" size={13} />{c.students_count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
