import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BackLink } from '../../lib/backStack';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useLanguage } from '../../context/LanguageContext';
import { Skeleton, EmptyState } from '../../components/student/stUi';
import { PersonAvatar } from '../../components/staff/stfUi';
import ExamQuestionCard from '../../components/exam/ExamQuestionCard';
import {
  ExKpi, PhasePill, AttemptPill, examPhase, examTypeLabel, fmtDate, fmtDateTime, fmtNum, fmtTime,
  questionTypeLabel, ringStyle,
} from '../../components/exam/examUi';

/**
 * Exam details (design: Overview / Questions / Students / Results / Settings).
 * Data: exam (GET exams/{id}), attempts (GET exams/{id}/attempts), the eligible
 * students (GET exams/{id}/targets + /targets/students) and groups (names).
 * Every number on the Overview and Results tabs is derived from those payloads,
 * nothing is hard-coded. A student with several attempts is represented by their
 * latest one.
 */

const TABS = [
  { key: 'overview', en: 'Overview', ar: 'نظرة عامة' },
  { key: 'questions', en: 'Questions', ar: 'الأسئلة' },
  { key: 'students', en: 'Students', ar: 'الطلاب' },
  { key: 'results', en: 'Results', ar: 'النتائج' },
  { key: 'settings', en: 'Settings', ar: 'الإعدادات' },
];

const FINISHED = ['submitted', 'auto_submitted', 'grading', 'graded'];
const AWAITING = ['submitted', 'auto_submitted', 'grading'];

const VISIBILITY = {
  immediate: { en: 'Students see their result right after submitting.', ar: 'يرى الطالب نتيجته فور التسليم.' },
  after_close: { en: 'Results are visible to students after the exam closes.', ar: 'تظهر النتائج للطلاب بعد إغلاق الامتحان.' },
  manual: { en: 'Results are visible to students after you publish them.', ar: 'تظهر النتائج للطلاب بعد أن تنشرها أنت.' },
};

const latestPerStudent = (attempts) => {
  const map = new Map();
  attempts.forEach((a) => {
    const prev = map.get(a.student_id);
    if (!prev || a.attempt_number > prev.attempt_number) map.set(a.student_id, a);
  });
  return [...map.values()];
};

export default function AcademicStaffExamDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((x) => x.key === params.get('tab')) ? params.get('tab') : 'overview';

  const [exam, setExam] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [students, setStudents] = useState([]);
  const [invited, setInvited] = useState(0);
  const [groups, setGroups] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);

  const load = useCallback(async () => {
    const [examJson, attemptsJson, targetsJson, studentsJson, groupsJson] = await Promise.all([
      api.get(`/api/v1/exam-system/exams/${id}`),
      api.get(`/api/v1/exam-system/exams/${id}/attempts`).catch(() => ({ data: [] })),
      api.get(`/api/v1/exam-system/exams/${id}/targets`).catch(() => ({ data: {} })),
      api.get(`/api/v1/exam-system/exams/${id}/targets/students`).catch(() => ({ data: [] })),
      api.get('/api/v1/exam-system/targeting/groups').catch(() => ({ data: [] })),
    ]);
    setExam(examJson.data);
    setAttempts(attemptsJson.data || []);
    setStudents(studentsJson.data || []);
    setInvited(targetsJson.data?.matching_count ?? (studentsJson.data || []).length);
    setGroups(Object.fromEntries((groupsJson.data || []).map((g) => [g.id, g.name])));
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load().catch((err) => setError(errorMessage(err))).finally(() => setLoading(false));
  }, [load]);

  const latest = useMemo(() => latestPerStudent(attempts), [attempts]);
  const finished = useMemo(() => latest.filter((a) => FINISHED.includes(a.status)), [latest]);
  const awaiting = useMemo(() => latest.filter((a) => AWAITING.includes(a.status)), [latest]);
  const scored = useMemo(() => latest.filter((a) => a.status === 'graded' && a.score !== null), [latest]);

  const totalMarks = Number(exam?.total_marks) || 0;
  const passMark = exam?.passing_score !== null && exam?.passing_score !== undefined ? Number(exam.passing_score) : totalMarks * 0.5;

  const stats = useMemo(() => {
    if (!scored.length) return null;
    const scores = scored.map((a) => Number(a.score));
    const avg = scores.reduce((x, y) => x + y, 0) / scores.length;
    const passed = scored.filter((a) => Number(a.score) >= passMark).length;
    return {
      avg,
      avgPct: totalMarks ? (avg / totalMarks) * 100 : null,
      high: Math.max(...scores),
      passed,
      failed: scored.length - passed,
      passRate: Math.round((passed / scored.length) * 100),
    };
  }, [scored, passMark, totalMarks]);

  const buckets = useMemo(() => {
    const labels = ['0–20%', '20–40%', '40–60%', '60–80%', '80–100%'];
    const counts = [0, 0, 0, 0, 0];
    scored.forEach((a) => {
      const pct = totalMarks ? (Number(a.score) / totalMarks) * 100 : Number(a.percentage) || 0;
      counts[Math.min(4, Math.max(0, Math.floor(pct / 20)))] += 1;
    });
    return { labels, counts, max: Math.max(1, ...counts) };
  }, [scored, totalMarks]);

  const questionCount = useMemo(() => {
    if (!exam) return 0;
    return (exam.questions || []).length + (exam.question_pools || []).reduce((a, p) => a + (p.questions_to_select || 0), 0);
  }, [exam]);

  const typeBreakdown = useMemo(() => {
    const c = {};
    (exam?.questions || []).forEach((q) => { c[q.type] = (c[q.type] || 0) + 1; });
    return Object.entries(c).map(([t, n]) => `${n} ${questionTypeLabel(t, ar, true)}`).join(' · ');
  }, [exam, ar]);

  const rosterRows = useMemo(() => {
    const byStudent = new Map(latest.map((a) => [a.student_id, a]));
    const rows = students.map((s) => ({ student: s, attempt: byStudent.get(s.id) || null }));
    // students that attempted but are no longer matched by targeting still show up
    latest.forEach((a) => {
      if (!students.some((s) => s.id === a.student_id)) {
        rows.push({ student: { id: a.student_id, full_name: a.student_name, student_number: a.student_number, email: a.student_email }, attempt: a });
      }
    });
    return rows;
  }, [students, latest]);

  const setTab = (key) => setParams(key === 'overview' ? {} : { tab: key });

  async function togglePublishResults(publish) {
    setBusy(true);
    setFlash(null);
    try {
      await api.post(`/api/v1/exam-system/exams/${id}/${publish ? 'publish-results' : 'unpublish-results'}`);
      await load();
      setFlash(publish ? (ar ? 'تم نشر النتائج للطلاب.' : 'Results published to students.') : (ar ? 'تم إخفاء النتائج.' : 'Results hidden from students.'));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(ar ? 'حذف هذا الامتحان نهائيًا؟' : 'Delete this exam permanently?')) return;
    setBusy(true);
    try {
      await api.del(`/api/v1/exam-system/exams/${id}`);
      navigate('/academic-staff/exams', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (loading) return <div className="st-page"><Skeleton h={110} count={3} /></div>;
  if (error && !exam) return <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>;
  if (!exam) return null;

  const phase = examPhase(exam);
  const metaLine = [exam.subject, exam.start_at ? fmtDate(exam.start_at, ar) : null, exam.start_at ? fmtTime(exam.start_at, ar) : null, `${exam.duration_minutes} ${ar ? 'دقيقة' : 'min'}`].filter(Boolean).join(' · ');
  const submittedPct = invited ? Math.round((finished.length / invited) * 100) : 0;

  return (
    <div className="ex-page">
      <div>
        <BackLink to="/academic-staff/exams" className="ex-back"><Icon name="chevron-left" size={14} /> {ar ? 'العودة إلى الامتحانات' : 'Back to Exams'}</BackLink>
        <div className="ex-detail-head">
          <div style={{ minWidth: 0 }}>
            <div className="ex-detail-head__eyebrow">
              <span className="ex-chip">{ar ? 'تفاصيل الامتحان' : 'Exam details'}</span>
              {exam.updated_at && <span>{ar ? 'آخر تحديث' : 'Last updated'} {fmtDate(exam.updated_at, ar)}</span>}
            </div>
            <h1>{exam.title}</h1>
            <p className="ex-detail-head__meta">{metaLine}</p>
          </div>
          <div className="ex-detail-head__actions">
            <PhasePill phase={phase} ar={ar} />
            <Link to={`/academic-staff/exams/${id}/edit`} className="btn btn-outline"><Icon name="edit" size={15} /> {ar ? 'تعديل الامتحان' : 'Edit Exam'}</Link>
            <button type="button" className="btn btn-primary" onClick={() => setTab('students')}>{ar ? 'عرض الطلاب' : 'View Students'}</button>
          </div>
        </div>
      </div>

      {error && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}

      <div className="ex-card">
        <div className="ex-tabs" role="tablist">
          {TABS.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} className={`ex-tab${tab === x.key ? ' is-active' : ''}`} onClick={() => setTab(x.key)}>
              {ar ? x.ar : x.en}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <>
          <div className="ex-kpis">
            <ExKpi label={ar ? 'المدعوون' : 'Invited'} value={invited} sub={ar ? 'طلاب مُعيَّنون' : 'Assigned students'} icon="users" />
            <ExKpi label={ar ? 'سلّموا' : 'Submitted'} value={finished.length} sub={`${submittedPct}% ${ar ? 'اكتمال' : 'completion'}`} icon="check-circle" tone="good" />
            <ExKpi label={ar ? 'قيد الانتظار' : 'Pending'} value={awaiting.length} sub={ar ? 'بانتظار التصحيح' : 'Awaiting grading'} icon="clock" tone="warn" />
            <ExKpi label={ar ? 'المتوسط' : 'Average'} value={stats && stats.avgPct !== null ? `${fmtNum(stats.avgPct)}%` : '—'} sub={ar ? 'متوسط الفصل' : 'Class average'} icon="bar-chart" />
          </div>
          <div className="ex-card ex-card__pad">
            <h2 className="ex-card__title" style={{ marginBottom: 18 }}>{ar ? 'معلومات الامتحان' : 'Exam information'}</h2>
            <dl className="ex-info-grid">
              <div><dt>{ar ? 'المقرر' : 'Course'}</dt><dd>{exam.subject || '—'}</dd></div>
              <div><dt>{ar ? 'النوع' : 'Type'}</dt><dd>{examTypeLabel(exam.exam_type, ar)}</dd></div>
              <div><dt>{ar ? 'التاريخ' : 'Date'}</dt><dd>{exam.start_at ? fmtDateTime(exam.start_at, ar) : (ar ? 'غير محدد' : 'Not set')}</dd></div>
              <div><dt>{ar ? 'المدة' : 'Duration'}</dt><dd>{exam.duration_minutes} {ar ? 'دقيقة' : 'minutes'}</dd></div>
              <div><dt>{ar ? 'الأسئلة' : 'Questions'}</dt><dd>{questionCount} {ar ? 'سؤال' : 'questions'}</dd></div>
              <div><dt>{ar ? 'إجمالي الدرجات' : 'Total points'}</dt><dd>{fmtNum(exam.total_marks)} {ar ? 'درجة' : 'points'}</dd></div>
              <div><dt>{ar ? 'درجة النجاح' : 'Passing score'}</dt><dd>{exam.passing_score !== null && exam.passing_score !== undefined ? fmtNum(exam.passing_score) : (ar ? 'غير محددة' : 'Not set')}</dd></div>
              <div><dt>{ar ? 'المحاولات' : 'Attempts'}</dt><dd>{exam.max_attempts}</dd></div>
              <div><dt>{ar ? 'يغلق في' : 'Closes'}</dt><dd>{exam.end_at ? fmtDateTime(exam.end_at, ar) : (ar ? 'بدون موعد إغلاق' : 'No closing date')}</dd></div>
            </dl>
            {exam.description && <p style={{ margin: '20px 0 0', fontSize: 13.5, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{exam.description}</p>}
          </div>
        </>
      )}

      {tab === 'questions' && (
        <div className="ex-card ex-card__pad">
          <div className="ex-card__head">
            <div>
              <h2 className="ex-card__title">{ar ? 'مجموعة الأسئلة' : 'Question set'}</h2>
              <p className="ex-card__sub">
                {questionCount} {ar ? 'سؤال' : 'questions'} · {fmtNum(exam.total_marks)} {ar ? 'درجة' : 'total points'}{typeBreakdown ? ` · ${typeBreakdown}` : ''}
              </p>
            </div>
            <Link to={`/academic-staff/exams/${id}/edit?step=2`} className="btn btn-outline btn-sm"><Icon name="edit" size={14} /> {ar ? 'تعديل الأسئلة' : 'Edit questions'}</Link>
          </div>
          {(exam.question_pools || []).length > 0 && (
            <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {exam.question_pools.map((p) => (
                <div key={p.id} className="ex-ghost">
                  <strong>{p.pool_name || (ar ? 'مجموعة عشوائية' : 'Random pool')}</strong> — {ar ? `يسحب ${p.questions_to_select} سؤالًا عشوائيًا لكل طالب` : `draws ${p.questions_to_select} random questions per student`} · {fmtNum(p.subtotal_marks)} {ar ? 'درجة' : 'points'}
                </div>
              ))}
            </div>
          )}
          {(exam.questions || []).length === 0 && (exam.question_pools || []).length === 0 ? (
            <EmptyState icon="file" title={ar ? 'لم تُضف أسئلة بعد' : 'No questions added yet'}>
              <Link to={`/academic-staff/exams/${id}/edit?step=2`} className="btn btn-primary">{ar ? 'إضافة أسئلة' : 'Add questions'}</Link>
            </EmptyState>
          ) : (
            <div className="ex-qlist">
              {(exam.questions || []).map((q, i) => <ExamQuestionCard key={q.exam_question_id} q={q} index={i} ar={ar} />)}
            </div>
          )}
        </div>
      )}

      {tab === 'students' && (
        <div className="ex-card">
          <div className="ex-card__pad" style={{ paddingBottom: 6 }}>
            <h2 className="ex-card__title">{ar ? 'الطلاب المُعيَّنون' : 'Assigned students'}</h2>
            <p className="ex-card__sub">{invited} {ar ? 'طالب مدعو لهذا الامتحان' : 'students invited to this exam'}</p>
          </div>
          {rosterRows.length === 0 ? (
            <div style={{ padding: 24 }}>
              <EmptyState icon="users" title={ar ? 'لا يوجد طلاب مُعيَّنون' : 'No students assigned yet'}>
                <Link to={`/academic-staff/exams/${id}/edit?step=4`} className="btn btn-primary">{ar ? 'تعيين طلاب' : 'Assign students'}</Link>
              </EmptyState>
            </div>
          ) : (
            <div className="ex-table-wrap">
              <table className="ex-table">
                <thead>
                  <tr>
                    <th>{ar ? 'الطالب' : 'Student'}</th>
                    <th>{ar ? 'الرقم الجامعي' : 'Student ID'}</th>
                    <th>{ar ? 'المجموعة' : 'Group'}</th>
                    <th>{ar ? 'الحالة' : 'Status'}</th>
                    <th>{ar ? 'بدأ في' : 'Started at'}</th>
                    <th>{ar ? 'سلّم في' : 'Submitted at'}</th>
                    <th className="is-end">{ar ? 'إجراء' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody>
                  {rosterRows.map(({ student: s, attempt: a }) => (
                    <tr key={s.id}>
                      <td>
                        <div className="ex-student-cell">
                          <PersonAvatar name={s.full_name} />
                          <div style={{ minWidth: 0 }}><strong>{s.full_name}</strong>{s.email && <small>{s.email}</small>}</div>
                        </div>
                      </td>
                      <td className="is-muted">{s.student_number || '—'}</td>
                      <td className="is-muted">{(s.group_id && groups[s.group_id]) || '—'}</td>
                      <td><AttemptPill status={a ? a.status : 'not_started'} ar={ar} /></td>
                      <td className="is-muted">{a?.started_at ? fmtTime(a.started_at, ar) : '—'}</td>
                      <td className="is-muted">{a?.submitted_at ? fmtTime(a.submitted_at, ar) : '—'}</td>
                      <td className="is-end">
                        {a ? <Link to={`/academic-staff/exams/${id}/attempts/${a.id}`} className="ex-link">{ar ? 'عرض المحاولة' : 'View Attempt'}</Link> : <span className="is-muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'results' && (
        <>
          <div className="ex-kpis">
            <ExKpi label={ar ? 'متوسط الدرجات' : 'Average Score'} value={stats ? <>{fmtNum(stats.avg)}<small>/{fmtNum(totalMarks)}</small></> : '—'} sub={stats && stats.avgPct !== null ? `${fmtNum(stats.avgPct)}% ${ar ? 'متوسط الفصل' : 'class average'}` : (ar ? 'لا نتائج بعد' : 'No graded results yet')} icon="bar-chart" />
            <ExKpi label={ar ? 'أعلى درجة' : 'Highest Score'} value={stats ? <>{fmtNum(stats.high)}<small>/{fmtNum(totalMarks)}</small></> : '—'} sub={ar ? 'أفضل أداء' : 'Top performance'} icon="award" tone="good" />
            <ExKpi label={ar ? 'نسبة النجاح' : 'Pass Rate'} value={stats ? `${stats.passRate}%` : '—'} sub={stats ? (ar ? `${stats.passed} من ${scored.length} طالب` : `${stats.passed} of ${scored.length} students`) : '—'} icon="check-circle" tone="good" />
            <ExKpi label={ar ? 'التسليمات' : 'Submissions'} value={<>{finished.length}<small>/{invited}</small></>} sub={ar ? `${awaiting.length} بانتظار التصحيح` : `${awaiting.length} pending grading`} icon="clock" tone="warn" />
          </div>

          <div className="ex-two">
            <div className="ex-card ex-card__pad">
              <h2 className="ex-card__title">{ar ? 'توزيع الدرجات' : 'Score distribution'}</h2>
              <p className="ex-card__sub" style={{ marginBottom: 14 }}>{ar ? 'عدد الطلاب في كل شريحة' : 'Number of students by grade range'}</p>
              {scored.length === 0 ? <div className="ex-ghost">{ar ? 'ستظهر الرسوم عند تصحيح أول محاولة.' : 'Charts appear once the first attempt is graded.'}</div> : (
                <>
                  <div className="ex-bars">
                    {buckets.counts.map((n, i) => (
                      <div key={buckets.labels[i]} className="ex-bar">{n}<i style={{ height: `${(n / buckets.max) * 100}%` }} /></div>
                    ))}
                  </div>
                  <div className="ex-bar-labels">{buckets.labels.map((l) => <span key={l}>{l}</span>)}</div>
                </>
              )}
            </div>
            <div className="ex-card ex-card__pad">
              <h2 className="ex-card__title">{ar ? 'ناجح مقابل راسب' : 'Pass vs fail'}</h2>
              <p className="ex-card__sub" style={{ marginBottom: 14 }}>{stats ? (ar ? `بناءً على ${scored.length} تسليمًا مُصحَّحًا` : `Based on ${scored.length} graded submissions`) : ''}</p>
              {!stats ? <div className="ex-ghost">{ar ? 'لا توجد بيانات بعد.' : 'No data yet.'}</div> : (
                <div className="ex-donut">
                  <div className="ex-donut__ring" style={ringStyle([{ value: stats.passed, color: 'var(--color-success)' }, { value: stats.failed, color: 'var(--color-danger)' }])}><b>{stats.passRate}%</b></div>
                  <div className="ex-legend">
                    <span style={{ '--dot': 'var(--color-success)' }}>{ar ? 'ناجح' : 'Pass'}<b>{stats.passed}</b></span>
                    <span style={{ '--dot': 'var(--color-danger)' }}>{ar ? 'راسب' : 'Fail'}<b>{stats.failed}</b></span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="ex-card">
            <div className="ex-card__pad" style={{ paddingBottom: 6 }}>
              <h2 className="ex-card__title">{ar ? 'أداء الطلاب' : 'Student performance'}</h2>
              <p className="ex-card__sub">{ar ? 'راجع المحاولات المُسلَّمة وعدّل الدرجات يدويًا.' : 'Review submitted attempts and assign manual grades.'}</p>
            </div>
            {finished.length === 0 ? (
              <div style={{ padding: 24 }}><div className="ex-ghost">{ar ? 'لا توجد تسليمات بعد.' : 'No submissions yet.'}</div></div>
            ) : (
              <div className="ex-table-wrap">
                <table className="ex-table">
                  <thead>
                    <tr>
                      <th>{ar ? 'الطالب' : 'Student'}</th>
                      <th>{ar ? 'وقت التسليم' : 'Submitted'}</th>
                      <th>{ar ? 'الدرجة' : 'Score'}</th>
                      <th>{ar ? 'النسبة' : 'Percentage'}</th>
                      <th>{ar ? 'الحالة' : 'Status'}</th>
                      <th className="is-end">{ar ? 'إجراء' : 'Action'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finished.map((a) => {
                      const graded = a.status === 'graded' && a.score !== null;
                      const passed = graded && Number(a.score) >= passMark;
                      return (
                        <tr key={a.id}>
                          <td><div className="ex-student-cell"><div><strong>{a.student_name}</strong><small>{a.student_number}</small></div></div></td>
                          <td className="is-muted">{fmtTime(a.submitted_at, ar)}</td>
                          <td>{graded ? `${fmtNum(a.score)}/${fmtNum(totalMarks)}` : '—'}</td>
                          <td className="is-muted">{graded && a.percentage !== null ? `${fmtNum(a.percentage, 0)}%` : '—'}</td>
                          <td>
                            {graded
                              ? <span className={`ex-status ex-status--${passed ? 'passed' : 'failed'}`}>{passed ? (ar ? 'ناجح' : 'Passed') : (ar ? 'راسب' : 'Failed')}</span>
                              : <AttemptPill status={a.status} ar={ar} />}
                          </td>
                          <td className="is-end"><Link to={`/academic-staff/exams/${id}/attempts/${a.id}`} className="ex-link">{ar ? 'مراجعة' : 'Review'}</Link></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'settings' && (
        <div className="ex-card ex-card__pad">
          <div className="ex-card__head">
            <div>
              <h2 className="ex-card__title">{ar ? 'إعدادات الامتحان' : 'Exam settings'}</h2>
              <p className="ex-card__sub">{(VISIBILITY[exam.result_visibility] || VISIBILITY.after_close)[ar ? 'ar' : 'en']}</p>
            </div>
            <Link to={`/academic-staff/exams/${id}/edit?step=3`} className="btn btn-outline btn-sm"><Icon name="edit" size={14} /> {ar ? 'تعديل الإعدادات' : 'Edit settings'}</Link>
          </div>
          <dl className="ex-info-grid">
            <div><dt>{ar ? 'التسليم التلقائي' : 'Auto submit when time ends'}</dt><dd>{exam.auto_submit_on_timeout ? (ar ? 'مفعّل' : 'On') : (ar ? 'متوقف' : 'Off')}</dd></div>
            <div><dt>{ar ? 'الرجوع للأسئلة السابقة' : 'Allow back navigation'}</dt><dd>{exam.allow_back_navigation ? (ar ? 'مسموح' : 'Allowed') : (ar ? 'ممنوع' : 'Not allowed')}</dd></div>
            <div><dt>{ar ? 'خلط الأسئلة' : 'Shuffle questions'}</dt><dd>{exam.randomize_questions ? (ar ? 'مفعّل' : 'On') : (ar ? 'متوقف' : 'Off')}</dd></div>
            <div><dt>{ar ? 'خلط الإجابات' : 'Shuffle answers'}</dt><dd>{exam.randomize_options ? (ar ? 'مفعّل' : 'On') : (ar ? 'متوقف' : 'Off')}</dd></div>
            <div><dt>{ar ? 'مراجعة الإجابات' : 'Answer review'}</dt><dd>{exam.show_score_only ? (ar ? 'الدرجة فقط' : 'Score only') : (exam.show_answer_review ? (ar ? 'متاحة' : 'Available') : (ar ? 'غير متاحة' : 'Hidden'))}</dd></div>
            <div><dt>{ar ? 'وضع الامتحان الآمن' : 'Secure exam mode'}</dt><dd>{exam.secure_mode_enabled ? (ar ? `مفعّل (حد المخالفات ${exam.max_violations ?? '—'})` : `On (max violations ${exam.max_violations ?? '—'})`) : (ar ? 'متوقف' : 'Off')}</dd></div>
          </dl>

          <div style={{ marginTop: 26, paddingTop: 18, borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {exam.result_visibility === 'manual' && (
              exam.results_published_at
                ? <button type="button" className="btn btn-outline" disabled={busy} onClick={() => togglePublishResults(false)}>{ar ? 'إخفاء النتائج' : 'Unpublish results'}</button>
                : <button type="button" className="btn btn-primary" disabled={busy} onClick={() => togglePublishResults(true)}>{ar ? 'نشر النتائج للطلاب' : 'Publish results to students'}</button>
            )}
            <Link to={`/academic-staff/exams/${id}/targets`} className="btn btn-outline">{ar ? 'الاستهداف المتقدم' : 'Advanced targeting'}</Link>
            <Link to={`/academic-staff/exams/${id}/analytics`} className="btn btn-outline">{ar ? 'تحليلات الأسئلة' : 'Question analytics'}</Link>
            {flash && <span className="ex-flash">{flash}</span>}
            <button type="button" className="btn btn-outline st-btn-danger" style={{ marginInlineStart: 'auto' }} disabled={busy} onClick={handleDelete}><Icon name="trash" size={14} /> {ar ? 'حذف الامتحان' : 'Delete exam'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
