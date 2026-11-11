import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useLanguage } from '../../context/LanguageContext';
import { StaffHead } from '../../components/staff/stfUi';
import { EmptyState, Skeleton } from '../../components/student/stUi';
import {
  ExKpi, PhasePill, PHASES, examPhase, examTypeLabel, fmtDate, fmtTime, toDate,
} from '../../components/exam/examUi';

/**
 * "Pick an exam, then jump to <suffix>" hub — one component behind three sidebar routes
 * (Attempts & Grading / Targeting & Publish / Analytics). Same visual language as the
 * Exams workspace (StaffHead + KPIs + phase tabs + st-pcard cards), one GET:
 * /api/v1/exam-system/exams (already returns students/attempts/submitted/pending counts).
 *
 * `variant` only changes which numbers the cards and KPIs emphasise:
 *   attempts  → submissions + waiting-for-grading
 *   targets   → audience size + publish state
 *   analytics → completion rate
 */

const TAB_KEYS = ['all', 'draft', 'scheduled', 'live', 'completed'];

const COPY = {
  attempts: {
    eyebrow: { en: 'Grading workspace', ar: 'مساحة التصحيح' },
    title: { en: 'Attempts & Grading', ar: 'المحاولات والتصحيح' },
    subtitle: { en: 'Pick an exam to review attempts and grade submissions.', ar: 'اختر امتحانًا لمراجعة المحاولات وتصحيح التسليمات.' },
    cta: { en: 'Open attempts', ar: 'فتح المحاولات' },
    icon: 'edit',
  },
  targets: {
    eyebrow: { en: 'Publishing workspace', ar: 'مساحة النشر' },
    title: { en: 'Targeting & Publish', ar: 'الاستهداف والنشر' },
    subtitle: { en: 'Pick an exam to manage its target audience and publishing.', ar: 'اختر امتحانًا لإدارة الفئة المستهدفة ونشره.' },
    cta: { en: 'Manage targets', ar: 'إدارة الاستهداف' },
    icon: 'filter',
  },
  analytics: {
    eyebrow: { en: 'Insights workspace', ar: 'مساحة التحليلات' },
    title: { en: 'Analytics', ar: 'التحليلات' },
    subtitle: { en: 'Pick an exam to view its results and analytics.', ar: 'اختر امتحانًا لعرض نتائجه وتحليلاته.' },
    cta: { en: 'View analytics', ar: 'عرض التحليلات' },
    icon: 'bar-chart',
  },
};

export default function AcademicStaffExamPicker({ suffix }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const navigate = useNavigate();
  const copy = COPY[suffix] || COPY.attempts;
  const L = (o) => (ar ? o.ar : o.en);

  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.get('/api/v1/exam-system/exams')
      .then((json) => { if (!cancelled) setExams(json.data || []); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const now = useMemo(() => new Date(), []);
  const rows = useMemo(() => exams.map((e) => ({ ...e, _phase: examPhase(e, now) })), [exams, now]);

  const counts = useMemo(() => {
    const c = { all: rows.length, draft: 0, scheduled: 0, live: 0, completed: 0 };
    rows.forEach((e) => { c[e._phase] += 1; });
    return c;
  }, [rows]);

  const totals = useMemo(() => rows.reduce((a, e) => ({
    students: a.students + (e.students_count || 0),
    attempts: a.attempts + (e.attempts_count || 0),
    submitted: a.submitted + (e.submitted_count || 0),
    pending: a.pending + (e.pending_grading_count || 0),
  }), { students: 0, attempts: 0, submitted: 0, pending: 0 }), [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((e) => {
      if (tab !== 'all' && e._phase !== tab) return false;
      if (needle && !`${e.title} ${e.subject || ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, tab, q]);

  if (loading) return <div className="st-page"><Skeleton h={100} count={3} /></div>;

  const kpis = {
    attempts: [
      { label: ar ? 'إجمالي الامتحانات' : 'Total Exams', value: counts.all, sub: ar ? 'في كل المقررات' : 'Across all courses', icon: 'file' },
      { label: ar ? 'إجمالي المحاولات' : 'Total Attempts', value: totals.attempts, sub: ar ? 'كل المحاولات المسجلة' : 'All recorded attempts', icon: 'users' },
      { label: ar ? 'تم التسليم' : 'Submitted', value: totals.submitted, sub: ar ? 'محاولات مُسلَّمة' : 'Handed-in attempts', icon: 'check-circle', tone: 'good' },
      { label: ar ? 'بانتظار التصحيح' : 'Pending Grading', value: totals.pending, sub: ar ? 'تحتاج انتباهك' : 'Needs your attention', icon: 'clock', tone: totals.pending ? 'bad' : '' },
    ],
    targets: [
      { label: ar ? 'إجمالي الامتحانات' : 'Total Exams', value: counts.all, sub: ar ? 'في كل المقررات' : 'Across all courses', icon: 'file' },
      { label: ar ? 'مسودات' : 'Drafts', value: counts.draft, sub: ar ? 'لم تُنشر بعد' : 'Not published yet', icon: 'edit', tone: counts.draft ? 'warn' : '' },
      { label: ar ? 'مجدولة / جارية' : 'Scheduled / Live', value: counts.scheduled + counts.live, sub: ar ? 'منشورة للطلاب' : 'Visible to students', icon: 'check-circle', tone: 'good' },
      { label: ar ? 'إجمالي الطلاب المستهدفين' : 'Targeted Students', value: totals.students, sub: ar ? 'عبر كل الامتحانات' : 'Across all exams', icon: 'users' },
    ],
    analytics: [
      { label: ar ? 'إجمالي الامتحانات' : 'Total Exams', value: counts.all, sub: ar ? 'في كل المقررات' : 'Across all courses', icon: 'file' },
      { label: ar ? 'امتحانات مكتملة' : 'Completed', value: counts.completed, sub: ar ? 'نتائجها جاهزة للتحليل' : 'Ready for analysis', icon: 'check-circle', tone: 'good' },
      { label: ar ? 'إجمالي التسليمات' : 'Total Submissions', value: totals.submitted, sub: ar ? 'عبر كل الامتحانات' : 'Across all exams', icon: 'users' },
      { label: ar ? 'بانتظار التصحيح' : 'Pending Grading', value: totals.pending, sub: ar ? 'قد تغيّر النتائج' : 'May change results', icon: 'clock', tone: totals.pending ? 'warn' : '' },
    ],
  }[suffix] || [];

  return (
    <div className="ex-page">
      <StaffHead
        eyebrow={L(copy.eyebrow)}
        title={L(copy.title)}
        subtitle={L(copy.subtitle)}
        actions={<Link to="/academic-staff/exams" className="btn btn-outline">{ar ? 'كل الامتحانات' : 'All Exams'}</Link>}
      />

      {error && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}

      <div className="ex-kpis">
        {kpis.map((k) => <ExKpi key={k.label} {...k} />)}
      </div>

      <div className="st-tabs" role="tablist">
        {TAB_KEYS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`st-tab${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>
            {k === 'all' ? (ar ? 'الكل' : 'All') : (ar ? PHASES[k].ar : PHASES[k].en)}
            <span className="st-tab__count">{counts[k]}</span>
          </button>
        ))}
      </div>

      <div className="st-toolbar xc-toolbar">
        <label className="st-search">
          <Icon name="search" size={16} />
          <input className="form-input" type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={ar ? 'ابحث بالعنوان أو المقرر…' : 'Search exams by title or course…'} aria-label={ar ? 'بحث' : 'Search'} />
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="file" title={ar ? 'لا توجد امتحانات بعد.' : 'No exams yet.'}>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/academic-staff/exams/create')}>
            <Icon name="plus" size={16} /> {ar ? 'إنشاء امتحان' : 'Create Exam'}
          </button>
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState icon="search" title={ar ? 'لا توجد امتحانات مطابقة' : 'No exams match'} text={ar ? 'جرّب تغيير البحث أو التصنيف.' : 'Try a different search or filter.'}>
          <button type="button" className="btn btn-outline" onClick={() => { setQ(''); setTab('all'); }}>{ar ? 'مسح التصفية' : 'Clear filters'}</button>
        </EmptyState>
      ) : (
        <div className="st-cards st-ecards xc-grid">
          {shown.map((e) => {
            const students = e.students_count ?? 0;
            const submitted = e.submitted_count ?? 0;
            const pending = e.pending_grading_count ?? 0;
            const pct = students ? Math.min(100, Math.round((submitted / students) * 100)) : 0;
            const start = toDate(e.start_at);
            return (
              <article key={e.id} className={`st-pcard st-ecard xc-card xc-card--${e._phase}`}>
                <div className="st-pcard__top">
                  {e.subject ? <span className="st-tag">{e.subject}</span> : <span />}
                  <PhasePill phase={e._phase} ar={ar} />
                </div>
                <div>
                  <h3><Link to={`/academic-staff/exams/${e.id}/${suffix}`}>{e.title}</Link></h3>
                  <div className="xc-sub">{examTypeLabel(e.exam_type, ar)}</div>
                </div>

                {suffix === 'attempts' && pending > 0 && (
                  <Link to={`/academic-staff/exams/${e.id}/attempts`} className="st-ecard__hint st-ecard__hint--warn xc-hint">
                    <Icon name="clock" size={13} /> {ar ? `${pending} محاولة بانتظار التصحيح` : `${pending} attempt${pending > 1 ? 's' : ''} waiting for grading`}
                  </Link>
                )}

                <ul className="st-ecard__facts">
                  <li>
                    <Icon name="calendar" size={14} />
                    <span>{start ? `${fmtDate(e.start_at, ar)} · ${fmtTime(e.start_at, ar)}` : (ar ? 'التاريخ غير محدد' : 'Date not set')}</span>
                  </li>
                  <li>
                    <Icon name="users" size={14} />
                    <span>{students} {ar ? 'طالب مستهدف' : 'targeted students'}</span>
                  </li>
                </ul>

                {suffix !== 'targets' && (
                  <div className="st-ecard__attempts">
                    <div className="st-ecard__attempts-row">
                      <span className="ex-inline"><Icon name="check-circle" size={13} /> {ar ? 'التسليمات' : 'Submissions'}</span>
                      <strong>{submitted}/{students}</strong>
                    </div>
                    {students > 0 && (
                      <div className="st-ecard__bar" role="progressbar" aria-valuemin={0} aria-valuemax={students} aria-valuenow={submitted}>
                        <span style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                )}

                <div className="st-pcard__actions xc-actions">
                  <Link to={`/academic-staff/exams/${e.id}/${suffix}`} className="btn btn-primary btn-sm">
                    <Icon name={copy.icon} size={14} /> {L(copy.cta)}
                  </Link>
                  <Link to={`/academic-staff/exams/${e.id}`} className="btn btn-outline btn-sm">{ar ? 'تفاصيل الامتحان' : 'Exam details'}</Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
