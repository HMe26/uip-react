import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useLanguage } from '../../context/LanguageContext';
import { usePageMeta } from '../../context/PageMetaContext';
import { EmptyState, Skeleton } from '../../components/student/stUi';
import {
  AttemptPill, ExKpi, PhasePill, PHASES, examPhase, fmtDate, fmtNum, fmtTime, toDate,
} from '../../components/exam/examUi';

/**
 * Student "My Exams" (GET /api/v1/exam-system/my-exams). Each exam now carries
 * attempts_used + last_attempt, so the status and the action are derived with a
 * single request. Student phases: upcoming (window not open) / available (open,
 * attempts left or one in progress) / completed (finished, missed or out of attempts).
 */

const TABS = ['all', 'available', 'upcoming', 'completed'];
const TAB_LABEL = {
  all: { en: 'All', ar: 'الكل' },
  available: { en: 'Available', ar: 'متاح الآن' },
  upcoming: { en: 'Upcoming', ar: 'قادم' },
  completed: { en: 'Completed', ar: 'مكتمل' },
};

export function studentState(e, now = new Date()) {
  const last = e.last_attempt;
  const phase = examPhase(e, now);
  const used = e.attempts_used || 0;
  const maxAttempts = e.max_attempts_effective ?? e.max_attempts;
  const outOfAttempts = maxAttempts != null && used >= maxAttempts;
  if (last?.status === 'in_progress') return 'available';
  // Instructor-granted retake: open for this student even if the exam window passed.
  if (e.retake_allowed) return 'available';
  if (phase === 'scheduled') return 'upcoming';
  if (phase === 'completed' || outOfAttempts) return 'completed';
  return 'available';
}


/** Newest first: created_at when the API sends it, otherwise the (auto-increment) id. */
function newestFirst(a, b) {
  const ta = toDate(a.created_at)?.getTime() ?? 0;
  const tb = toDate(b.created_at)?.getTime() ?? 0;
  if (ta !== tb) return tb - ta;
  return Number(b.id) - Number(a.id);
}

/** "in 2d 3h" / "بعد ٢ يوم" style countdown for upcoming exams. */
function opensIn(startAt, ar, now) {
  const d = toDate(startAt);
  if (!d || d <= now) return null;
  const mins = Math.round((d - now) / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days > 0) return ar ? `يفتح بعد ${days} يوم${hours ? ` و${hours} س` : ''}` : `Opens in ${days}d${hours ? ` ${hours}h` : ''}`;
  if (hours > 0) return ar ? `يفتح بعد ${hours} س` : `Opens in ${hours}h`;
  return ar ? `يفتح بعد ${Math.max(mins, 1)} د` : `Opens in ${Math.max(mins, 1)} min`;
}

/**
 * What the student can see about their grade for one exam.
 * kind: 'score' (grade visible) | 'progress' | 'grading' (being marked) | 'hidden' (marked, not released yet).
 * Falls back to "a percentage exists" when an older API does not send `result_visible`.
 */
function gradeInfo(e) {
  const last = e.last_attempt;
  if (!last) return null;
  const visible = e.result_visible ?? (last.percentage != null);
  if (last.status === 'in_progress') return { kind: 'progress' };
  if (visible && last.percentage != null) {
    const total = Number(e.total_marks) || 0;
    const score = last.score != null ? Number(last.score) : (last.percentage / 100) * total;
    const passed = e.passing_score == null ? null : score >= Number(e.passing_score);
    return { kind: 'score', score, total, pct: last.percentage, passed };
  }
  if (['submitted', 'auto_submitted', 'grading'].includes(last.status)) return { kind: 'grading' };
  if (last.status === 'graded') return { kind: 'hidden' };
  return null;
}

function hiddenReason(e, ar) {
  if (e.result_visibility === 'manual') return ar ? 'لما أستاذك ينشر النتائج' : 'When your instructor publishes results';
  if (e.result_visibility === 'after_close' && e.end_at) return ar ? `بعد إغلاق الامتحان ${fmtDate(e.end_at, ar)}` : `After the exam closes on ${fmtDate(e.end_at, ar)}`;
  return ar ? 'لم تُنشر بعد' : 'Not released yet';
}

/** "My grades": one row per exam you took, so the result is never hidden inside a card. */
function GradesSection({ rows, ar }) {
  const items = rows.map((e) => ({ e, g: gradeInfo(e) })).filter((x) => x.g);
  if (items.length === 0) return null;
  return (
    <section className="ex-card st-grades" aria-labelledby="st-grades-title">
      <div className="st-grades__head">
        <h2 id="st-grades-title"><Icon name="award" size={17} /> {ar ? 'درجاتي' : 'My grades'}</h2>
        <span className="ex-card__sub">{ar ? 'آخر محاولة في كل امتحان' : 'Latest attempt in each exam'}</span>
      </div>
      <ul className="st-grades__list">
        {items.map(({ e, g }) => (
          <li key={e.id} className={`st-grades__row is-${g.kind}${g.kind === 'score' && g.passed != null ? (g.passed ? ' is-pass' : ' is-fail') : ''}`}>
            <div className="st-grades__title">
              <Link to={`/student/my-exams/${e.id}`} dir="auto">{e.title}</Link>
              {e.subject && <small>{e.subject}</small>}
            </div>

            {g.kind === 'score' ? (
              <>
                <div className="st-grades__score" dir="ltr"><strong>{fmtNum(g.score)}</strong><span> / {fmtNum(g.total)}</span></div>
                <div className="st-grades__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(g.pct)} aria-label={ar ? 'النسبة' : 'Percentage'}>
                  <span style={{ width: `${Math.max(0, Math.min(100, g.pct))}%` }} />
                </div>
                <div className="st-grades__pct" dir="ltr">{fmtNum(g.pct)}%</div>
                <div className="st-grades__state">
                  {g.passed == null
                    ? <span className="ex-status ex-status--graded">{ar ? 'تم التصحيح' : 'Graded'}</span>
                    : <span className={`ex-status ex-status--${g.passed ? 'graded' : 'failed'}`}>{g.passed ? (ar ? 'ناجح' : 'Passed') : (ar ? 'راسب' : 'Failed')}</span>}
                </div>
              </>
            ) : (
              <div className="st-grades__wait">
                <Icon name={g.kind === 'hidden' ? 'lock' : 'clock'} size={14} />
                <span>
                  {g.kind === 'progress' && (ar ? 'محاولة جارية' : 'Attempt in progress')}
                  {g.kind === 'grading' && (ar ? 'قيد التصحيح — هتظهر درجتك هنا' : 'Being graded — your score will appear here')}
                  {g.kind === 'hidden' && <>{ar ? 'الدرجة مش متاحة لسه: ' : 'Score not available yet: '}{hiddenReason(e, ar)}</>}
                </span>
              </div>
            )}

            <Link to={g.kind === 'progress' ? `/student/exam-attempt/${e.last_attempt.id}` : `/student/exam-attempt/${e.last_attempt.id}/result`} className="st-grades__link">
              {g.kind === 'progress' ? (ar ? 'متابعة' : 'Resume') : (ar ? 'التفاصيل' : 'Details')}
              <Icon name="chevron-right" size={14} className="icon-flip" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExamCard({ exam: e, ar, now, action }) {
  const act = action(e);
  const start = toDate(e.start_at);
  const end = toDate(e.end_at);
  const used = e.attempts_used || 0;
  const maxA = e.max_attempts_effective ?? e.max_attempts;
  const pct = maxA ? Math.min(100, Math.round((used / maxA) * 100)) : 0;
  const last = e.last_attempt;
  const g = gradeInfo(e);
  const hasScore = g?.kind === 'score';
  const passed = hasScore && (g.passed ?? true);
  const countdown = e._s === 'upcoming' ? opensIn(e.start_at, ar, now) : null;
  const inProgress = last?.status === 'in_progress';
  const href = `/student/my-exams/${e.id}`;

  const status = last && e._s === 'completed' && !inProgress
    ? <AttemptPill status={last.status} ar={ar} />
    : e._s === 'upcoming' ? <PhasePill phase="scheduled" ar={ar} />
      : e._s === 'available' ? <PhasePill phase="live" ar={ar} />
        : <span className="ex-status ex-status--idle">{ar ? PHASES.completed.ar : PHASES.completed.en}</span>;

  return (
    <article className={`st-pcard st-ecard st-ecard--${e._s}${inProgress ? ' is-progress' : ''}`}>
      <div className="st-pcard__top">
        {e.subject ? <span className="st-tag">{e.subject}</span> : <span />}
        {status}
      </div>

      <h3><Link to={href}>{e.title}</Link></h3>

      {countdown && <p className="st-ecard__hint st-ecard__hint--warn"><Icon name="clock" size={13} /> {countdown}</p>}
      {inProgress && <p className="st-ecard__hint st-ecard__hint--live"><Icon name="play" size={13} /> {ar ? 'عندك محاولة جارية' : 'You have an attempt in progress'}</p>}

      <ul className="st-ecard__facts">
        <li>
          <Icon name="calendar" size={14} />
          <span>{start ? `${fmtDate(e.start_at, ar)} · ${fmtTime(e.start_at, ar)}` : (ar ? 'يفتح فورًا' : 'Opens immediately')}</span>
        </li>
        <li>
          <Icon name="clock" size={14} />
          <span>{e.duration_minutes} {ar ? 'دقيقة' : 'min'}{e.question_count ? ` · ${e.question_count} ${ar ? 'سؤال' : 'questions'}` : ''}</span>
        </li>
        {end && e._s !== 'completed' && (
          <li>
            <Icon name="lock" size={14} />
            <span>{ar ? 'يغلق' : 'Closes'} {fmtDate(e.end_at, ar)} · {fmtTime(e.end_at, ar)}</span>
          </li>
        )}
      </ul>

      <div className="st-ecard__attempts">
        <div className="st-ecard__attempts-row">
          <span>{ar ? 'المحاولات' : 'Attempts'}</span>
          <strong>{used}/{maxA ?? '∞'}</strong>
        </div>
        {maxA ? (
          <div className="st-ecard__bar" role="progressbar" aria-valuemin={0} aria-valuemax={maxA} aria-valuenow={used}>
            <span className={pct >= 100 ? 'is-full' : ''} style={{ width: `${pct}%` }} />
          </div>
        ) : null}
      </div>

      {hasScore && (
        <div className={`st-ecard__score ${passed ? 'is-pass' : 'is-fail'}`}>
          <Icon name="award" size={14} />
          <span>{ar ? 'آخر نتيجة' : 'Last score'}</span>
          <strong>{fmtNum(last.percentage)}%</strong>
        </div>
      )}

      <div className="st-pcard__actions">
        <Link to={href} className="btn btn-outline btn-sm">{ar ? 'عرض' : 'View'}</Link>
        <Link to={act.to} className="btn btn-primary btn-sm">{act.label}</Link>
      </div>
    </article>
  );
}

export default function StudentMyExams() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  usePageMeta(ar ? 'الامتحانات' : 'Exams', ar ? 'امتحانات نشرها أساتذتك لك.' : 'Exams your instructors have published for you.');

  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.get('/api/v1/exam-system/my-exams')
      .then((json) => { if (!cancelled) setExams(json.data || []); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const now = useMemo(() => new Date(), []);
  const rows = useMemo(() => exams.map((e) => ({ ...e, _s: studentState(e, now) })).sort(newestFirst), [exams, now]);
  const counts = useMemo(() => {
    const c = { all: rows.length, available: 0, upcoming: 0, completed: 0 };
    rows.forEach((e) => { c[e._s] += 1; });
    return c;
  }, [rows]);
  const avg = useMemo(() => {
    const done = rows.map(gradeInfo).filter((g) => g?.kind === 'score');
    return done.length ? done.reduce((a, g) => a + g.pct, 0) / done.length : null;
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((e) => (tab === 'all' || e._s === tab)
      && (!needle || `${e.title} ${e.subject || ''}`.toLowerCase().includes(needle)));
  }, [rows, tab, q]);

  if (loading) return <div className="st-page"><Skeleton h={100} count={3} /></div>;
  if (error) return <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>;

  const action = (e) => {
    const last = e.last_attempt;
    if (last?.status === 'in_progress') return { to: `/student/exam-attempt/${last.id}`, label: ar ? 'متابعة' : 'Resume' };
    if (e._s === 'available') return { to: `/student/my-exams/${e.id}`, label: ar ? 'ابدأ' : 'Start' };
    if (last) return { to: `/student/my-exams/${e.id}`, label: ar ? 'النتيجة' : 'Result' };
    return { to: `/student/my-exams/${e.id}`, label: ar ? 'عرض' : 'View' };
  };

  return (
    <div className="ex-page">
      <div className="ex-kpis">
        <ExKpi label={ar ? 'إجمالي الامتحانات' : 'Total Exams'} value={counts.all} sub={ar ? 'المخصصة لك' : 'Assigned to you'} icon="file" />
        <ExKpi label={ar ? 'متاحة الآن' : 'Available Now'} value={counts.available} sub={ar ? 'جاهزة للبدء' : 'Ready to take'} icon="check-circle" tone="good" />
        <ExKpi label={ar ? 'القادمة' : 'Upcoming'} value={counts.upcoming} sub={ar ? 'لم تفتح بعد' : 'Not open yet'} icon="calendar" tone="warn" />
        <ExKpi label={ar ? 'متوسط درجاتك' : 'Your Average'} value={avg == null ? '—' : `${fmtNum(avg)}%`} sub={ar ? 'النتائج المنشورة' : 'Published results'} icon="award" />
      </div>

      <GradesSection rows={rows} ar={ar} />

      <div className="st-tabs" role="tablist">
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`st-tab${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>
            {ar ? TAB_LABEL[k].ar : TAB_LABEL[k].en}
            <span className="st-tab__count">{counts[k]}</span>
          </button>
        ))}
      </div>

      <div className="st-toolbar">
        <label className="st-search">
          <Icon name="search" size={16} />
          <input className="form-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'ابحث بعنوان الامتحان أو المقرر…' : 'Search exams by title or course…'} aria-label={ar ? 'بحث' : 'Search'} />
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="file" title={ar ? 'لا توجد امتحانات متاحة حاليًا.' : 'No exams available right now.'} text={ar ? 'هتظهر هنا أول ما أستاذك ينشر امتحانًا لك.' : 'Exams will appear here as soon as your instructor publishes one.'} />
      ) : shown.length === 0 ? (
        <EmptyState icon="search" title={ar ? 'لا توجد امتحانات مطابقة' : 'No exams match'} text={ar ? 'جرّب تابًا آخر أو غيّر البحث.' : 'Try another tab or change your search.'} />
      ) : (
        <div className="st-cards st-ecards">
          {shown.map((e) => <ExamCard key={e.id} exam={e} ar={ar} now={now} action={action} />)}
        </div>
      )}
    </div>
  );
}
