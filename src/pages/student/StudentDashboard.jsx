import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { usePageMeta } from '../../context/PageMetaContext';
import { Kpi, StatusPill, Stepper, Pill, EmptyState, Skeleton, loc, timeAgo, daysUntil } from '../../components/student/stUi';

/**
 * Student Dashboard (Student design). Data: GET /api/v1/students/dashboard-stats
 * (StudentsApiController::dashboardStats()) and, best-effort,
 * GET /api/v1/exam-system/dashboard/student. Every widget reads a key the API
 * already returns — the "next action" banner and the approval progress are
 * derived from the real project status (draft → submitted → under_review →
 * published; `rejected` = changes requested), nothing is invented.
 */

// Position of a status on the real workflow.
const FLOW = ['draft', 'submitted', 'under_review', 'published'];

function pickFocusProject(projects) {
  return projects.find((p) => p.status === 'rejected')
    || projects.find((p) => p.status === 'under_review' || p.status === 'submitted')
    || projects.find((p) => p.status === 'draft')
    || projects.find((p) => p.status === 'published')
    || null;
}

function dueLabel(item, ar) {
  const days = daysUntil(item.published_at || item.created_at);
  if (days == null) return null;
  if (days < 0) return { text: ar ? 'انتهى' : 'Past', tone: 'neutral' };
  if (days === 0) return { text: ar ? 'اليوم' : 'Today', tone: 'danger' };
  return { text: ar ? `${days} يوم` : `${days} ${days === 1 ? 'day' : 'days'}`, tone: days <= 7 ? 'warning' : '' };
}

export default function StudentDashboard() {
  const { locale } = useLanguage();
  const { can } = useAuth();
  const ar = locale === 'ar';
  usePageMeta(ar ? 'لوحة الطالب' : 'Student Dashboard', ar ? 'تابع مشاريعك ومواعيدك وجاهزيتك ورحلتك الأكاديمية.' : 'Track your projects, deadlines, readiness, and academic innovation journey.');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [examOverview, setExamOverview] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/v1/students/dashboard-stats')
      .then((json) => { if (!cancelled) setData(json.data); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    api.get('/api/v1/exam-system/dashboard/student')
      .then((json) => { if (!cancelled) setExamOverview(json.data || null); })
      .catch(() => { /* best-effort — the Exams card just stays hidden */ });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="st-page"><Skeleton h={96} count={3} /></div>;
  if (error) return <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>;
  if (!data) return null;

  const projects = data.projects || [];
  const activity = data.recent_activity || [];
  const announcements = data.recent_announcements || [];
  const deadlines = data.upcoming_deadlines || [];
  const scored = data.scored_count || 0;
  const latest = data.latest_analysis;
  const focus = pickFocusProject(projects);
  const focusHref = focus ? `/student/projects/${encodeURIComponent(focus.id)}` : null;
  const showSupervisor = projects.some((p) => p.supervisor_name);
  const showUpdated = projects.some((p) => p.updated_at);

  // Next-action banner from the real status of the most urgent project.
  let action = null;
  if (focus?.status === 'rejected') {
    action = { text: ar ? `طلب المشرف تعديلات على «${loc(focus.title, locale)}».` : `Your supervisor requested changes on ${loc(focus.title, locale)}.`, cta: ar ? 'مراجعة الملاحظات' : 'Review Feedback', to: focusHref };
  } else if (focus?.status === 'draft') {
    action = { text: ar ? `أكمل مسودة «${loc(focus.title, locale)}» وقدّمها للمراجعة.` : `Finish your draft ${loc(focus.title, locale)} and submit it for review.`, cta: ar ? 'متابعة المسودة' : 'Continue Draft', to: focusHref };
  } else if (!projects.length) {
    action = { text: ar ? 'ابدأ أول مشروع تخرج لك.' : 'Start your first graduation project.', cta: ar ? 'إنشاء مشروع' : 'Create Project', to: '/student/projects/create' };
  }

  const steps = [
    { label: ar ? 'مسودة' : 'Draft' },
    { label: ar ? 'تم التقديم' : 'Submitted' },
    { label: ar ? 'قيد المراجعة' : 'Under Review' },
    { label: ar ? 'منشور' : 'Published' },
  ];
  const stepIndex = focus ? (focus.status === 'rejected' ? 2 : Math.max(0, FLOW.indexOf(focus.status))) : 0;
  const stepCurrent = focus?.status === 'published' ? steps.length : stepIndex;

  const kpiScoreMeta = scored > 0 ? (ar ? `عبر ${scored} مشروع مُحلَّل` : `across ${scored} analyzed project(s)`) : (ar ? 'لم يتم تحليل مشاريع بعد' : 'No projects analyzed yet');

  return (
    <div className="st-page">
      <div className="st-grid st-grid--4">
        <Kpi featured label={ar ? 'درجة الجاهزية' : 'AI Readiness Score'} value={scored > 0 ? data.avg_readiness : '—'} meta={kpiScoreMeta} good={scored > 0} />
        <Kpi label={ar ? 'مشاريعي' : 'My Projects'} value={data.total_projects || 0} meta={ar ? `${data.published_count || 0} منشور` : `${data.published_count || 0} Published`} />
        <Kpi label={ar ? 'درجة الابتكار' : 'Innovation Score'} value={scored > 0 ? (data.avg_innovation ?? '—') : '—'} />
        <Kpi label={ar ? 'قيد المراجعة' : 'Under Review'} value={data.pending_count || 0} />
      </div>
      <div className="st-grid st-grid--4">
        <Kpi small label={ar ? 'منشور' : 'Published'} value={data.published_count || 0} />
        <Kpi small label={ar ? 'أعضاء الفريق' : 'Team Members'} value={data.team_members_count || 0} />
        <Kpi small label={ar ? 'المستندات' : 'Documents'} value={data.documents_count || 0} />
        <Kpi small label={ar ? 'مسودات' : 'Drafts'} value={data.draft_count || 0} />
      </div>

      {action && (
        <div className="st-banner">
          <div>
            <span className="st-banner__eyebrow">{ar ? 'خطوتك التالية' : 'Your next action'}</span>
            <span className="st-banner__text">{action.text}</span>
          </div>
          <Link to={action.to} className="btn btn-primary">{action.cta}</Link>
        </div>
      )}


      <div className="st-grid st-grid--main">
        <div className="st-stack">
          <section className="st-panel st-panel--flush">
            <div className="st-panel__head">
              <h2>{ar ? 'أحدث المشاريع' : 'Recent Projects'}</h2>
              <Link to="/student/projects" className="btn btn-outline btn-sm">{ar ? 'عرض الكل' : 'View All'}</Link>
            </div>
            {projects.length === 0 ? (
              <div style={{ padding: '0 20px 20px' }}>
                <EmptyState icon="folder" title={ar ? 'لا توجد مشاريع بعد' : 'No projects yet'} text={ar ? 'ابدأ بأول مشروع لك.' : "You haven't created a project yet. Start your first one."}>
                  <Link to="/student/projects/create" className="btn btn-primary"><Icon name="plus" size={16} /> {ar ? 'إنشاء مشروع' : 'Create Project'}</Link>
                </EmptyState>
              </div>
            ) : (
              <div className="st-table-wrap">
                <table className="st-table">
                  <thead><tr>
                    <th>{ar ? 'المشروع' : 'Project'}</th>
                    <th>{ar ? 'التصنيف' : 'Category'}</th>
                    {showSupervisor && <th>{ar ? 'المشرف' : 'Supervisor'}</th>}
                    <th>{ar ? 'الحالة' : 'Status'}</th>
                    {showUpdated && <th>{ar ? 'آخر تحديث' : 'Updated'}</th>}
                    <th />
                  </tr></thead>
                  <tbody>
                    {projects.slice(0, 5).map((p) => (
                      <tr key={p.id}>
                        <td><Link className="st-link" to={`/student/projects/${encodeURIComponent(p.id)}`} style={{ color: 'inherit', fontSize: 13 }}>{loc(p.title, locale)}</Link></td>
                        <td className="st-muted">{loc(p.category, locale) || '—'}</td>
                        {showSupervisor && <td className="st-muted">{p.supervisor_name || '—'}</td>}
                        <td><StatusPill status={p.status} locale={locale} /></td>
                        {showUpdated && <td className="st-muted">{timeAgo(p.updated_at, locale)}</td>}
                        <td><Link className="st-link" to={`/student/projects/${encodeURIComponent(p.id)}`}>{ar ? 'عرض' : 'View'}</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {focus && (
            <section className="st-panel">
              <div className="st-panel__head">
                <h2>{ar ? `تقدم المشروع — ${loc(focus.title, locale)}` : `Project Progress — ${loc(focus.title, locale)}`}</h2>
                {focus.status === 'rejected' && <Pill tone="warning">{ar ? 'مطلوب تعديلات' : 'Changes requested'}</Pill>}
              </div>
              <Stepper steps={steps} current={stepCurrent} warn={focus.status === 'rejected'} />
            </section>
          )}

          <section className="st-panel">
            <div className="st-panel__head"><h2>{ar ? 'آخر النشاطات' : 'Recent Activity'}</h2></div>
            {activity.length === 0 ? (
              <p className="st-muted" style={{ fontSize: 13 }}>{ar ? 'لا يوجد نشاط بعد.' : 'No activity yet.'}</p>
            ) : (
              <ul className="st-timeline">
                {activity.map((item, i) => (
                  <li key={i}><strong>{item.title}</strong><span>{item.created_at}</span></li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="st-stack">
          <MyCoursesPanel ar={ar} locale={locale} />
          <section className="st-panel">
            <div className="st-panel__head">
              <h2>{ar ? 'الإعلانات' : 'Announcements'}</h2>
              <Link to="/student/announcements" className="st-link">{ar ? 'عرض الكل' : 'View all'}</Link>
            </div>
            {announcements.length === 0 ? (
              <p className="st-muted" style={{ fontSize: 13 }}>{ar ? 'لا توجد إعلانات بعد.' : 'No announcements yet.'}</p>
            ) : (
              <ul className="st-list">
                {announcements.map((item, i) => (
                  <li key={i}>
                    <strong style={{ fontSize: 13.5, display: 'block' }}>{item.title}</strong>
                    <span className="st-muted" style={{ fontSize: 12 }}>{item.published_at || item.created_at}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="st-panel">
            <div className="st-panel__head"><h2>{ar ? 'المواعيد القادمة' : 'Upcoming Deadlines'}</h2></div>
            {deadlines.length === 0 ? (
              <p className="st-muted" style={{ fontSize: 13 }}>{ar ? 'لا توجد مواعيد قادمة.' : 'No upcoming deadlines.'}</p>
            ) : (
              <ul className="st-list">
                {deadlines.map((item, i) => {
                  const due = dueLabel(item, ar);
                  return (
                    <li key={i} className="st-row">
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ fontSize: 13.5, display: 'block' }}>{item.title}</strong>
                        <span className="st-muted" style={{ fontSize: 12 }}>{item.published_at || item.created_at}</span>
                      </div>
                      {due && <Pill tone={due.tone}>{due.text}</Pill>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {examOverview && (
            <section className="st-panel">
              <div className="st-panel__head"><h2>{ar ? 'الامتحانات' : 'Exams'}</h2></div>
              <div className="st-grid st-grid--3" style={{ gap: 8, textAlign: 'center' }}>
                <div><div className="st-kpi__value" style={{ fontSize: 22 }}>{examOverview.upcoming_exams?.length || 0}</div><span className="st-muted" style={{ fontSize: 11.5 }}>{ar ? 'قادمة' : 'Upcoming'}</span></div>
                <div><div className="st-kpi__value" style={{ fontSize: 22 }}>{examOverview.active_exams?.length || 0}</div><span className="st-muted" style={{ fontSize: 11.5 }}>{ar ? 'جارية' : 'Active'}</span></div>
                <div><div className="st-kpi__value" style={{ fontSize: 22 }}>{examOverview.completed_exams_count || 0}</div><span className="st-muted" style={{ fontSize: 11.5 }}>{ar ? 'مكتملة' : 'Completed'}</span></div>
              </div>
              <Link to="/student/my-exams" className="btn btn-outline btn-sm" style={{ marginTop: 14 }}>{ar ? 'امتحاناتي' : 'My Exams'}</Link>
            </section>
          )}

          {can('ai.request_analysis') && (
          <section className="st-panel">
            <div className="st-panel__head"><h2>{ar ? 'تحليل الذكاء الاصطناعي' : 'AI Analysis'}</h2></div>
            <p className="st-muted" style={{ fontSize: 13 }}>
              {latest
                ? (ar ? `آخر تحليل: «${latest.project_title}» — ${latest.computed_at}.` : `Latest analysis: "${latest.project_title}" — ${latest.computed_at}.`)
                : (ar ? 'شغّل التحليل من صفحة أي مشروع لتحصل على درجة الجاهزية واقتراحات التحسين.' : "Run the analysis from any project's page to get a readiness score and improvement suggestions.")}
            </p>
            <Link to="/student/ai-analysis" className="btn btn-outline btn-sm" style={{ marginTop: 14 }}>{ar ? 'فتح التحليل' : 'Open AI Analysis'}</Link>
          </section>
          )}
        </aside>
      </div>
    </div>
  );
}


/** "My courses" panel: the student's enrolled courses + a one-click path to pick more. */
function MyCoursesPanel({ ar, locale }) {
  const [courses, setCourses] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get('/api/v1/courses', { locale })
      .then((j) => { if (alive) setCourses(j.data || []); })
      .catch(() => { if (alive) setCourses([]); });
    return () => { alive = false; };
  }, [locale]);

  if (courses === null) return null;
  const mine = courses.filter((c) => c.enrolled);
  const open = courses.length - mine.length;

  return (
    <section className="st-panel">
      <div className="st-panel__head">
        <h2>{ar ? 'موادي' : 'My Courses'}</h2>
        <Link to="/student/courses" className="st-link">{ar ? 'اختيار المواد' : 'Manage'}</Link>
      </div>
      {mine.length === 0 ? (
        <>
          <p className="st-muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
            {courses.length === 0
              ? (ar ? 'لا توجد مواد متاحة بعد. ستظهر هنا مواد كليتك.' : 'No courses are available yet. Your faculty’s courses will appear here.')
              : (ar ? 'لم تسجّل في أي مادة بعد.' : 'You have not enrolled in any course yet.')}
          </p>
          {courses.length > 0 && <Link to="/student/courses" className="btn btn-primary btn-sm">{ar ? `اختر موادك (${open} متاحة)` : `Pick your courses (${open} available)`}</Link>}
        </>
      ) : (
        <>
          <ul className="st-timeline">
            {mine.slice(0, 5).map((c) => (
              <li key={c.id}><strong>{c.name}</strong><span>{c.code}{c.staff?.length ? ` · ${c.staff[0].full_name}` : ''}</span></li>
            ))}
          </ul>
          {(mine.length > 5 || open > 0) && (
            <p className="st-muted" style={{ fontSize: 12.5, margin: '10px 0 0' }}>
              {mine.length > 5 ? (ar ? `+${mine.length - 5} مواد أخرى · ` : `+${mine.length - 5} more · `) : ''}
              {open > 0 ? (ar ? `${open} مادة متاحة للتسجيل` : `${open} more available to join`) : ''}
            </p>
          )}
        </>
      )}
    </section>
  );
}
