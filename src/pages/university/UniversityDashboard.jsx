import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { AreaChart, DonutChart, HBarChart, KpiCard, Panel, fmt } from '../../components/insight/charts';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/university/dashboard';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/university/dashboard.php, talking to the real JSON API
 * (GET /api/v1/dashboards/overview — App\Controllers\Api\
 * DashboardsApiController::overview() → universityOverview(), the exact
 * same source-of-truth list the web controller's own dashboard.php
 * consumes: ProjectRepository::countByStatusForUniversity/
 * monthlyActivityForUniversity/facultyCategoryBreakdownForUniversity/
 * departmentBreakdownForUniversity/academicYearBreakdownForUniversity/
 * mostViewedForUniversity/recentForUniversity, ProjectAnalyticsRepository::
 * mostInteractedForUniversity, ProjectApprovalService::queueForUniversity,
 * AIAnalysisRepository::readinessForProjects). Nothing here is invented —
 * every widget below reads a key the API already returns.
 *
 * The PHP view's CSS-only mobile recomposition (kpi-scroll strip, three
 * mobile tab groups, collapsed Innovation Statistics accordion) is
 * preserved via explicit React tab state, same convention as
 * StudentDashboard.jsx.
 *
 * Round 8 (Phase 26/28) addition — a separate, best-effort pair of calls
 * to GET /api/v1/exam-system/university/dashboard (ExamAnalyticsApiController
 * ::universityDashboard -> ExamAnalyticsService::scopedDashboard(), scoped
 * to this university via UniversityRepository::findByUserId(), never from
 * client input) and GET /api/v1/exam-system/university/exams (every
 * faculty, per ExamRepository::forUniversityScope()) feed the new "Exams"
 * section below — same independent-request pattern as
 * FacultyDashboard.jsx/StudentDashboard.jsx; a failure just hides that one
 * section.
 */

const EXAM_STATUS_META = {
  draft: { cls: 'badge-neutral', en: 'Draft', ar: 'مسودة' },
  scheduled: { cls: 'badge-primary', en: 'Scheduled', ar: 'مجدول' },
  published: { cls: 'badge-success', en: 'Published', ar: 'منشور' },
  closed: { cls: 'badge-neutral', en: 'Closed', ar: 'مغلق' },
};

const STATUS_META = {
  pending: { cls: 'badge-primary', en: 'Pending', ar: 'قيد الانتظار' },
  approved: { cls: 'badge-success', en: 'Approved', ar: 'معتمد' },
  rejected: { cls: 'badge-danger', en: 'Rejected', ar: 'مرفوض' },
  changes_requested: { cls: 'badge-neutral', en: 'Changes Requested', ar: 'تعديلات مطلوبة' },
};

const PROJECT_STATUS_META = {
  submitted: { cls: 'badge-primary', en: 'Submitted', ar: 'مُقدَّم' },
  under_review: { cls: 'badge-primary', en: 'Under Review', ar: 'قيد المراجعة' },
  approved: { cls: 'badge-success', en: 'Approved', ar: 'معتمد' },
  rejected: { cls: 'badge-danger', en: 'Rejected', ar: 'مرفوض' },
  published: { cls: 'badge-success', en: 'Published', ar: 'منشور' },
  archived: { cls: 'badge-neutral', en: 'Archived', ar: 'مؤرشف' },
};

function projectTitle(row, locale) {
  const en = row.title_en || '';
  const ar = row.title_ar || '';
  return (locale === 'ar' ? (ar || en) : (en || ar)) || '';
}

export default function UniversityDashboard() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [listTab, setListTab] = useState('viewed');
  const [examStats, setExamStats] = useState(null);
  const [examList, setExamList] = useState([]);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/v1/dashboards/overview')
      .then((json) => { if (!cancelled) setData(json.data); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get('/api/v1/exam-system/university/dashboard'),
      api.get('/api/v1/exam-system/university/exams'),
    ])
      .then(([statsJson, examsJson]) => {
        if (cancelled) return;
        setExamStats(statsJson.data || null);
        setExamList(examsJson.data || []);
      })
      .catch(() => { /* best-effort — exam section just stays hidden */ });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <p className="text-small">{t('Loading…')}</p>;
  if (error) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;
  if (!data) return null;

  const university = data.university || null;
  const universityName = university
    ? (ar ? (university.official_name_ar || university.official_name_en) : (university.official_name_en || university.official_name_ar))
    : t('Your University');
  const isVerified = university ? university.verification_status === 'verified' : false;

  const totalStudents = data.total_students || 0;
  const underReview = data.under_review || 0;
  const approvalRate = Number(data.approval_rate || 0);
  const activity = (data.activity || []).map((p) => ({ label: p.label?.[locale] || p.label?.en || '', value: p.value }));
  const pendingQueue = data.pending_queue || [];
  const avgReadiness = data.avg_readiness;
  const scoredCount = data.scored_count || 0;
  const disciplineTrends = data.discipline_trends || [];
  const departments = (data.department_breakdown || []).map((r) => ({ label: r.department, value: Number(r.total) }));
  const years = (data.year_breakdown || []).map((r) => ({ label: ar ? `السنة ${r.academic_year}` : `Year ${r.academic_year}`, value: Number(r.total) }));
  const mostViewed = data.most_viewed || [];
  const mostInteracted = data.most_interacted || [];
  const recentProjects = data.recent_projects || [];

  const lastPoint = activity[activity.length - 1];
  const prevPoint = activity[activity.length - 2];
  const activityDelta = lastPoint && prevPoint && prevPoint.value > 0
    ? Math.round(((lastPoint.value - prevPoint.value) / prevPoint.value) * 100) : null;
  const totalDeptProjects = departments.reduce((s, d) => s + d.value, 0);
  const topDept = departments.slice().sort((a, b) => b.value - a.value)[0];
  const yearSegments = years.map((y, i) => ({ ...y, color: ['var(--color-primary)', 'var(--color-success)', 'var(--color-accent)', 'var(--color-info)', 'var(--color-danger)'][i % 5] }));

  // Key insights — only statements the data supports.
  const insights = [];
  if (activityDelta !== null) {
    insights.push({
      icon: activityDelta >= 0 ? 'trend' : 'arrow-down',
      title: activityDelta >= 0 ? (ar ? 'النشاط في ارتفاع' : 'Activity is rising') : (ar ? 'النشاط في تراجع' : 'Activity is slowing'),
      text: ar
        ? `المشاريع المقدمة ${activityDelta >= 0 ? 'ارتفعت' : 'انخفضت'} ${Math.abs(activityDelta)}٪ عن الشهر السابق.`
        : `Submissions ${activityDelta >= 0 ? 'rose' : 'fell'} ${Math.abs(activityDelta)}% versus the previous month.`,
    });
  }
  if (topDept && totalDeptProjects > 0) {
    insights.push({
      icon: 'award',
      title: ar ? `${topDept.label} في الصدارة` : `${topDept.label} leads`,
      text: ar ? `تمثل ${Math.round((topDept.value / totalDeptProjects) * 100)}٪ من المشاريع.` : `It holds ${Math.round((topDept.value / totalDeptProjects) * 100)}% of all projects.`,
    });
  }
  insights.push({
    icon: 'shield',
    title: approvalRate >= 70 ? (ar ? 'الاعتمادات في وضع جيد' : 'Approvals are healthy') : (ar ? 'الاعتمادات تحتاج انتباه' : 'Approvals need attention'),
    text: ar ? `معدل الاعتماد ${approvalRate}٪.` : `Approval rate is ${approvalRate}%.`,
  });
  if (pendingQueue.length) {
    insights.push({
      icon: 'clock',
      title: ar ? 'مشاريع بانتظار اعتمادك' : 'Projects awaiting you',
      text: ar ? `${fmt(pendingQueue.length)} مشروع في طابور الاعتماد.` : `${fmt(pendingQueue.length)} project(s) in your approval queue.`,
    });
  }

  const projectLink = (p) => `/projects/${encodeURIComponent(p.slug || p.uuid)}`;
  const rowStyle = (i, n) => ({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: i < n - 1 ? '1px solid var(--border-subtle)' : 'none', color: 'inherit', textDecoration: 'none' });

  const listTabs = [
    { key: 'viewed', label: t('Most Viewed') },
    { key: 'interacted', label: t('Most Interacted') },
    { key: 'recent', label: t('Recent Projects') },
  ];
  const listItems = listTab === 'viewed' ? mostViewed : listTab === 'interacted' ? mostInteracted : recentProjects;

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1>{universityName}</h1>
          <p>{ar ? 'إليك ملخص نشاط الابتكار في جامعتك اليوم.' : "Here's a snapshot of your university's innovation activity today."}</p>
        </div>
        <div className="page-header__actions">
          <Link to="/university/analytics" className="btn btn-outline btn-sm"><Icon name="chart" size={16} /> {ar ? 'التحليلات' : 'Analytics'}</Link>
          <Link to="/university/approvals" className="btn btn-primary btn-sm"><Icon name="check-circle" size={16} /> {t('Review Approvals')}</Link>
        </div>
      </div>

      <div className="insight-grid insight-grid--kpi">
        <KpiCard label={ar ? 'إجمالي الطلاب' : 'Total Students'} value={fmt(totalStudents)} tone="primary" note={ar ? 'كل الكليات' : 'all faculties'} />
        <KpiCard
          label={ar ? 'مشاريع قيد المراجعة' : 'Projects Under Review'} value={fmt(underReview)} tone={underReview > 0 ? 'warning' : 'success'}
          delta={activityDelta} note={activityDelta !== null ? (ar ? 'نشاط مقابل الشهر السابق' : 'activity vs. last month') : undefined}
        />
        <KpiCard label={ar ? 'معدل الاعتماد' : 'Approval Rate'} value={`${approvalRate}%`} tone={approvalRate >= 70 ? 'success' : 'warning'} progress={approvalRate} />
        <KpiCard label={ar ? 'حالة التوثيق' : 'Verification Status'} value={isVerified ? t('Verified') : t('Unverified')} tone={isVerified ? 'success' : 'danger'} />
        <KpiCard
          label={ar ? 'متوسط جاهزية الذكاء الاصطناعي' : 'Avg. AI Readiness'}
          value={avgReadiness !== null && avgReadiness !== undefined ? avgReadiness : '—'} tone="info"
          progress={avgReadiness !== null && avgReadiness !== undefined ? Number(avgReadiness) : null}
          note={avgReadiness !== null && avgReadiness !== undefined ? (ar ? `عبر ${scoredCount} مشروع` : `across ${scoredCount} project(s)`) : t('No projects analyzed yet')}
        />
      </div>

      <div className="insight-grid insight-grid--main">
        <Panel
          title={t('Innovation Activity')}
          subtitle={lastPoint ? (ar ? `آخر نقطة: ${lastPoint.label} — ${fmt(lastPoint.value)}` : `Latest: ${lastPoint.label} — ${fmt(lastPoint.value)}`) : t('Projects submitted per month')}
        >
          <AreaChart data={activity} emptyText={t('Not enough data yet.')} />
        </Panel>

        <Panel title={t('By Academic Year')} subtitle={ar ? 'توزيع المشاريع على السنوات' : 'Share of projects per year'}>
          <DonutChart segments={yearSegments} centerLabel={ar ? 'مشروع' : 'projects'} emptyText={t('Not enough data yet.')} />
        </Panel>
      </div>

      <div className="insight-grid insight-grid--halves">
        <Panel title={t('By Department')} subtitle={ar ? 'أعلى الأقسام من حيث عدد المشاريع' : 'Top departments by number of projects'}>
          <HBarChart items={departments.slice(0, 6)} emptyText={t('Not enough data yet.')} />
        </Panel>

        <Panel title={t('Innovation Statistics')} subtitle={t('Top faculty × field combinations by submissions.')}>
          {disciplineTrends.length ? (
            <ul className="insight-list" style={{ gap: 0 }}>
              {disciplineTrends.map((row, i) => (
                <li key={i} style={{ gridTemplateColumns: '1fr auto', padding: '12px 0', borderBottom: i < disciplineTrends.length - 1 ? '1px solid var(--border-subtle)' : 'none', alignItems: 'center' }}>
                  <div>
                    <strong>{ar ? (row.faculty_ar || row.faculty) : row.faculty}</strong>
                    <span>{ar ? (row.category_ar || t(row.category)) : row.category}</span>
                  </div>
                  <span className="badge badge-primary num">{fmt(row.total)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="chart-empty">{t('Not enough data yet.')}</p>}
        </Panel>
      </div>

      <div className="insight-grid insight-grid--bottom">
        <Panel
          title={t('Awaiting Your Approval')}
          actions={<Link to="/university/approvals" className="btn btn-outline btn-sm">{t('View all')}</Link>}
        >
          <div>
            {pendingQueue.length ? (
              <div className="table-responsive">
                <table className="data-table">
                  <thead><tr><th>{ar ? 'المشروع' : 'Project'}</th><th>{ar ? 'الطالب' : 'Student'}</th><th>{ar ? 'الكلية' : 'Faculty'}</th><th>{t('Status')}</th></tr></thead>
                  <tbody>
                    {pendingQueue.map((p) => {
                      const meta = STATUS_META[p.status] || STATUS_META.pending;
                      return (
                        <tr key={p.id}>
                          <td><strong>{p.title?.[locale] || p.title?.en}</strong></td>
                          <td>{p.student?.[locale] || p.student?.en}</td>
                          <td>{p.faculty?.[locale] || p.faculty?.en}</td>
                          <td><span className={`badge ${meta.cls}`}>{meta[locale]}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '36px 16px', textAlign: 'center' }}>
                <span style={{ width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(var(--color-success-rgb), .14)', color: 'var(--color-success)' }}>
                  <Icon name="check-circle" size={28} />
                </span>
                <strong style={{ fontSize: 16 }}>{ar ? 'كل شيء معتمد' : "You're all caught up"}</strong>
                <span className="text-caption">{t('Nothing awaiting your approval right now.')}</span>
              </div>}
          </div>
        </Panel>

        <Panel title={ar ? 'أهم الملاحظات' : 'Key insights'} className="panel--soft">
          <ul className="insight-list">
            {insights.map((it) => (
              <li key={it.title}>
                <Icon name={it.icon} size={20} />
                <div><strong>{it.title}</strong><span>{it.text}</span></div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="insight-grid">
        <Panel
          title={ar ? 'المشاريع' : 'Projects'}
          actions={(
            <div className="segmented">
              {listTabs.map((x) => (
                <button key={x.key} type="button" className={listTab === x.key ? 'is-active' : ''} onClick={() => setListTab(x.key)}>{x.label}</button>
              ))}
            </div>
          )}
        >
          {listItems.length === 0 ? (
            <p className="chart-empty">{listTab === 'viewed' ? t('No views recorded yet.') : listTab === 'interacted' ? t('No interactions recorded yet.') : t('No projects yet.')}</p>
          ) : listItems.map((p, i) => {
            const meta = PROJECT_STATUS_META[p.status] || PROJECT_STATUS_META.submitted;
            return (
              <Link key={p.id} to={projectLink(p)} style={rowStyle(i, listItems.length)}>
                <strong style={{ fontWeight: 600 }}>{projectTitle(p, locale)}</strong>
                {listTab === 'viewed' && <span className="badge badge-neutral"><Icon name="eye" size={14} /> {fmt(p.views_count)}</span>}
                {listTab === 'interacted' && <span className="badge badge-neutral"><Icon name="link" size={14} /> {fmt(p.interactions)}</span>}
                {listTab === 'recent' && <span className={`badge ${meta.cls}`}>{meta[locale]}</span>}
              </Link>
            );
          })}
        </Panel>
      </div>

      {examStats && (
        <>
          <div className="page-header" style={{ marginTop: 'var(--space-6)' }}>
            <div className="page-header__title">
              <h2 className="text-h2">{t('Exams')}</h2>
              <p>{ar ? 'نتائج الامتحانات ونشاط الطلاب في جامعتك.' : 'Exam results and student activity across your university.'}</p>
            </div>
          </div>
          <div className="insight-grid insight-grid--kpi">
            <KpiCard label={t('Total Exams')} value={fmt(examStats.total_exams ?? 0)} tone="primary" />
            <KpiCard label={t('Total Students')} value={fmt(examStats.total_students ?? 0)} tone="success" />
            <KpiCard label={t('Total Attempts')} value={fmt(examStats.total_attempts ?? 0)} tone="info" />
            <KpiCard
              label={t('Average Performance')}
              value={examStats.average_performance != null ? `${examStats.average_performance}%` : '—'} tone="warning"
              progress={examStats.average_performance != null ? Number(examStats.average_performance) : null}
            />
          </div>
          <Panel title={t('University Exams')} subtitle={ar ? 'آخر الامتحانات ونتائجها' : 'Latest exams and their results'}>
            <div>
              {examList.length === 0 ? (
                <p className="chart-empty">{t('No exams yet.')}</p>
              ) : (
                <div className="table-responsive">
                  <table className="data-table">
                    <thead><tr><th>{t('Exam')}</th><th>{t('Status')}</th><th>{t('Attempts')}</th><th>{t('Graded')}</th><th>{t('Average Score')}</th></tr></thead>
                    <tbody>
                      {examList.slice(0, 8).map((e) => {
                        const meta = EXAM_STATUS_META[e.status] || EXAM_STATUS_META.draft;
                        return (
                          <tr key={e.id}>
                            <td><strong>{e.title}</strong></td>
                            <td><span className={`badge ${meta.cls}`}>{meta[locale]}</span></td>
                            <td className="num">{fmt(e.total_attempts ?? 0)}</td>
                            <td className="num">{fmt(e.graded_count ?? 0)}</td>
                            <td style={{ minWidth: 150 }}>
                              {e.average_score != null ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <div style={{ flex: 1, height: 6, borderRadius: 99, background: 'var(--bg-canvas)', overflow: 'hidden' }}>
                                    <span style={{ display: 'block', height: '100%', width: `${Math.max(0, Math.min(100, Number(e.average_score)))}%`, borderRadius: 99, background: Number(e.average_score) >= 50 ? 'var(--color-success)' : 'var(--color-danger)' }} />
                                  </div>
                                  <span className="num" style={{ fontWeight: 700, fontSize: 13.5 }}>{e.average_score}%</span>
                                </div>
                              ) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Panel>
        </>
      )}
    </>
  );
}
