import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import QuestionQualityPanel from '../../components/exam/QuestionQualityPanel';
import { useLanguage } from '../../context/LanguageContext';
import { PersonAvatar, StaffHead } from '../../components/staff/stfUi';
import { EmptyState, Skeleton } from '../../components/student/stUi';
import {
  AttemptPill, ExKpi, Note, Segmented, fmtDateTime, fmtNum, questionTypeLabel, ringStyle,
} from '../../components/exam/examUi';

/**
 * Exam analytics — GET /api/v1/exam-system/exams/{id}/analytics (ExamAnalyticsService::examAnalytics).
 * One payload drives the whole page: exam-level numbers, score_distribution (10 bins),
 * student_results (one row per attempt) and the per-question breakdown. The charts are plain
 * CSS/SVG (no chart library) so they follow the portal theme in light and dark.
 *
 * Reading order for a doctor who does not want to read everything:
 *   1. "Quick summary" sentences   2. KPI cards   3. charts (score histogram, pass/fail,
 *   submission status, question difficulty)   4. filterable student table   5. item analysis.
 */

const PENDING = ['submitted', 'auto_submitted', 'grading'];
const PAGE = 20;

const secs = (s, ar) => {
  if (s === null || s === undefined) return '—';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return ar ? `${m} د ${r} ث` : `${m}m ${r}s`;
};
const band = (v) => (v === null || v === undefined ? 'none' : v < 40 ? 'bad' : v < 70 ? 'warn' : 'good');
const inBin = (p, bin) => p !== null && p >= bin.from && (bin.to === 100 ? p <= 100 : p < bin.to);

/** Donut with a centre label and a legend; slices = [{label, value, color}]. */
function Donut({ slices, centre, sub }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  return (
    <div className="xa-donut-wrap">
      <div className="xa-donut" style={ringStyle(slices)} role="img" aria-label={slices.map((s) => `${s.label}: ${s.value}`).join(', ')}>
        <div className="xa-donut__hole">
          <strong>{centre}</strong>
          {sub && <small>{sub}</small>}
        </div>
      </div>
      <ul className="xa-legend">
        {slices.map((s) => (
          <li key={s.label}>
            <i style={{ background: s.color }} />
            <span>{s.label}</span>
            <b>{s.value}{total > 0 && <em> · {Math.round((s.value / total) * 100)}%</em>}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Histogram({ bins, passing, avg, active, onPick, ar }) {
  const max = Math.max(1, ...bins.map((b) => b.count));
  const ticks = [0, 25, 50, 75, 100];
  return (
    <div className="xa-hist" dir="ltr">
      <div className="xa-hist__plot">
        {ticks.slice(1).map((t) => <span key={t} className="xa-hist__grid" style={{ bottom: `${t}%` }} />)}
        {bins.map((b) => {
          const h = (b.count / max) * 100;
          const failing = passing !== null && b.to <= passing;
          const isActive = active && active.from === b.from;
          return (
            <button
              key={b.from}
              type="button"
              className={`xa-hist__col${isActive ? ' is-active' : ''}`}
              onClick={() => onPick(isActive ? null : b)}
              title={`${b.from}–${b.to}%: ${b.count} ${ar ? 'طالب' : 'students'}`}
              aria-pressed={!!isActive}
              aria-label={`${b.from}-${b.to}%: ${b.count}`}
            >
              <span className="xa-hist__count">{b.count || ''}</span>
              <span className={`xa-hist__bar${passing === null ? '' : failing ? ' is-fail' : ' is-pass'}`} style={{ height: `${Math.max(h, b.count ? 4 : 0)}%` }} />
            </button>
          );
        })}
        {passing !== null && (
          <span className="xa-hist__line xa-hist__line--pass" style={{ left: `${passing}%` }}>
            <em>{ar ? 'النجاح' : 'Pass'} {fmtNum(passing)}%</em>
          </span>
        )}
        {avg !== null && (
          <span className="xa-hist__line xa-hist__line--avg" style={{ left: `${avg}%` }}>
            <em>{ar ? 'المتوسط' : 'Avg'} {fmtNum(avg)}%</em>
          </span>
        )}
      </div>
      <div className="xa-hist__axis">
        {bins.map((b) => <span key={b.from}>{b.from}</span>)}
        <span>100</span>
      </div>
    </div>
  );
}

export default function AcademicStaffExamAnalytics() {
  const { id } = useParams();
  const { locale } = useLanguage();
  const ar = locale === 'ar';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // filters
  const [bin, setBin] = useState(null);
  const [sFilter, setSFilter] = useState('all');
  const [sq, setSq] = useState('');
  const [sSort, setSSort] = useState('score_desc');
  const [shown, setShown] = useState(PAGE);
  const [qType, setQType] = useState('all');
  const [qSort, setQSort] = useState('hardest');
  const [qWeak, setQWeak] = useState(false);

  const load = useCallback(() => api.get(`/api/v1/exam-system/exams/${id}/analytics`).then((json) => setData(json.data)), [id]);

  useEffect(() => {
    setLoading(true);
    load().catch((err) => setError(errorMessage(err))).finally(() => setLoading(false));
  }, [load]);

  useEffect(() => { setShown(PAGE); }, [bin, sFilter, sq, sSort]);

  const results = useMemo(() => data?.student_results || [], [data]);
  const questions = useMemo(() => data?.questions?.items || [], [data]);
  const bins = useMemo(() => data?.score_distribution || [], [data]);
  const passing = data?.passing_score ?? null;

  const counts = useMemo(() => ({
    all: results.length,
    passed: results.filter((r) => r.passed === true).length,
    failed: results.filter((r) => r.passed === false).length,
    pending: results.filter((r) => PENDING.includes(r.status)).length,
    progress: results.filter((r) => r.status === 'in_progress').length,
  }), [results]);

  const rows = useMemo(() => {
    const needle = sq.trim().toLowerCase();
    const list = results.filter((r) => {
      if (sFilter === 'passed' && r.passed !== true) return false;
      if (sFilter === 'failed' && r.passed !== false) return false;
      if (sFilter === 'pending' && !PENDING.includes(r.status)) return false;
      if (sFilter === 'progress' && r.status !== 'in_progress') return false;
      if (bin && !(r.status === 'graded' && inBin(r.percentage, bin))) return false;
      if (needle && !`${r.full_name} ${r.student_number || ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const v = (x) => (x === null || x === undefined ? -1 : x);
    const by = {
      score_desc: (a, b) => v(b.percentage) - v(a.percentage),
      score_asc: (a, b) => (a.percentage === null) - (b.percentage === null) || v(a.percentage) - v(b.percentage),
      name: (a, b) => String(a.full_name).localeCompare(String(b.full_name), locale),
      time: (a, b) => v(a.time_seconds) - v(b.time_seconds),
    };
    return [...list].sort(by[sSort]);
  }, [results, sFilter, sq, sSort, bin, locale]);

  const qTypes = useMemo(() => [...new Set(questions.map((q) => q.type))], [questions]);
  const qRows = useMemo(() => {
    const list = questions
      .map((q, i) => ({ ...q, _no: i + 1 }))
      .filter((q) => (qType === 'all' || q.type === qType) && (!qWeak || (q.average_score_pct !== null && q.average_score_pct < 50)));
    const lo = (x) => (x === null || x === undefined ? 999 : x); // unscored questions go last
    const hi = (x) => (x === null || x === undefined ? -1 : x);
    if (qSort === 'hardest') list.sort((a, b) => lo(a.average_score_pct) - lo(b.average_score_pct));
    else if (qSort === 'easiest') list.sort((a, b) => hi(b.average_score_pct) - hi(a.average_score_pct));
    return list;
  }, [questions, qType, qSort, qWeak]);

  if (loading) return <div className="st-page"><Skeleton h={110} count={4} /></div>;
  if (error) return <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>;
  if (!data) return null;

  const gradedCount = data.graded_count ?? 0;
  const hasGraded = gradedCount > 0;
  const notStarted = data.not_submitted_count ?? 0;
  const hardest = questions.find((q) => q.exam_question_id === data.questions?.most_difficult_question);
  const easiest = questions.find((q) => q.exam_question_id === data.questions?.easiest_question);
  const weakCount = questions.filter((q) => q.average_score_pct !== null && q.average_score_pct < 50).length;
  const trim = (s, n = 70) => (s && s.length > n ? `${s.slice(0, n)}…` : s);

  const insights = [];
  if (!hasGraded) {
    insights.push({ tone: '', icon: 'info', text: ar ? 'لا توجد محاولات مُصحَّحة بعد — الرسومات هتمتلئ أول ما تبدأ التصحيح.' : 'No graded attempts yet — the charts will fill in as soon as grading starts.' });
  } else {
    insights.push({
      tone: data.pass_rate !== null && data.pass_rate < 50 ? 'bad' : 'good',
      icon: 'bar-chart',
      text: ar
        ? `متوسط الدرجات ${fmtNum(data.average_score)}%${data.pass_rate !== null ? `، ونجح ${fmtNum(data.pass_rate)}% من الطلاب المُصحَّحين` : ''}.`
        : `Average score is ${fmtNum(data.average_score)}%${data.pass_rate !== null ? `, and ${fmtNum(data.pass_rate)}% of graded students passed` : ''}.`,
    });
  }
  if (counts.pending > 0) {
    insights.push({ tone: 'warn', icon: 'clock', text: ar ? `${counts.pending} محاولة لسه بانتظار التصحيح — الأرقام ممكن تتغير بعد تصحيحها.` : `${counts.pending} attempt(s) still waiting for grading — these numbers may change once they are graded.` });
  }
  if (notStarted > 0) {
    insights.push({ tone: 'warn', icon: 'users', text: ar ? `${notStarted} طالب مستهدف لم يدخلوا الامتحان.` : `${notStarted} targeted student(s) have not taken the exam.` });
  }
  if (hardest && hardest.average_score_pct !== null) {
    insights.push({ tone: weakCount ? 'bad' : '', icon: 'alert-triangle', text: ar ? `أصعب سؤال: «${trim(hardest.prompt)}» (متوسط ${fmtNum(hardest.average_score_pct)}%)${weakCount > 1 ? ` — و${weakCount - 1} أسئلة أخرى أقل من 50%.` : '.'}` : `Hardest question: “${trim(hardest.prompt)}” (${fmtNum(hardest.average_score_pct)}% average)${weakCount > 1 ? ` — plus ${weakCount - 1} more below 50%.` : '.'}` });
  }

  const passSlices = [
    { label: ar ? 'ناجح' : 'Passed', value: counts.passed, color: 'var(--color-success)' },
    { label: ar ? 'راسب' : 'Failed', value: counts.failed, color: 'var(--color-danger)' },
  ];
  const statusSlices = [
    { label: ar ? 'مصحّح' : 'Graded', value: gradedCount, color: 'var(--color-success)' },
    { label: ar ? 'بانتظار التصحيح' : 'Awaiting grading', value: counts.pending, color: 'var(--color-warning)' },
    { label: ar ? 'جارٍ' : 'In progress', value: counts.progress, color: 'var(--color-primary)' },
    { label: ar ? 'لم يبدأ' : 'Not started', value: notStarted, color: 'var(--border-strong)' },
  ];

  const SF = [
    { key: 'all', en: `All (${counts.all})`, ar: `الكل (${counts.all})` },
    { key: 'passed', en: `Passed (${counts.passed})`, ar: `ناجح (${counts.passed})` },
    { key: 'failed', en: `Failed (${counts.failed})`, ar: `راسب (${counts.failed})` },
    { key: 'pending', en: `Pending (${counts.pending})`, ar: `بانتظار (${counts.pending})` },
  ];
  const filtersActive = bin || sq || sFilter !== 'all';

  return (
    <div className="ex-page">
      <StaffHead
        crumbs={[
          { label: ar ? 'الامتحانات' : 'Exams', to: '/academic-staff/exams' },
          { label: data.exam_title || `#${id}`, to: `/academic-staff/exams/${id}` },
          { label: ar ? 'التحليلات' : 'Analytics' },
        ]}
        eyebrow={ar ? 'مساحة التحليلات' : 'Insights workspace'}
        title={ar ? 'تحليلات الامتحان' : 'Exam Analytics'}
        subtitle={data.exam_title}
        actions={(
          <>
            <Link to={`/academic-staff/exams/${id}/attempts`} className="btn btn-outline"><Icon name="edit" size={16} /> {ar ? 'المحاولات والتصحيح' : 'Attempts & Grading'}</Link>
            <Link to={`/academic-staff/exams/${id}/targets`} className="btn btn-outline"><Icon name="filter" size={16} /> {ar ? 'الاستهداف والنشر' : 'Targeting & Publish'}</Link>
          </>
        )}
      />

      <section className="ex-card ex-card__pad xa-summary">
        <div className="ex-card__head">
          <div>
            <h2 className="ex-card__title">{ar ? 'ملخص سريع' : 'Quick summary'}</h2>
            <p className="ex-card__sub">{ar ? 'أهم ما تحتاج معرفته دون قراءة التفاصيل.' : 'What matters most, without reading the details.'}</p>
          </div>
        </div>
        <div className="xa-insights">
          {insights.map((i, k) => <Note key={k} tone={i.tone} icon={i.icon}>{i.text}</Note>)}
        </div>
      </section>

      <div className="ex-kpis">
        <ExKpi label={ar ? 'متوسط الدرجات' : 'Average Score'} value={data.average_score === null ? '—' : `${fmtNum(data.average_score)}%`} sub={`${ar ? 'الوسيط' : 'Median'} ${data.median_score === null ? '—' : `${fmtNum(data.median_score)}%`}`} icon="bar-chart" />
        <ExKpi label={ar ? 'نسبة النجاح' : 'Pass Rate'} value={data.pass_rate === null ? '—' : `${fmtNum(data.pass_rate)}%`} sub={passing === null ? (ar ? 'لم تُحدَّد درجة نجاح' : 'No pass mark set') : `${ar ? 'درجة النجاح' : 'Pass mark'} ${fmtNum(passing)}%`} icon="award" tone="good" />
        <ExKpi label={ar ? 'نسبة التسليم' : 'Submission Rate'} value={data.submission_rate === null ? '—' : `${fmtNum(data.submission_rate)}%`} sub={`${data.submitted_count}/${data.total_students ?? '—'} ${ar ? 'سلّموا' : 'submitted'}`} icon="users" />
        <ExKpi label={ar ? 'متوسط الوقت' : 'Average Time'} value={secs(data.average_time_seconds, ar)} sub={`${ar ? 'الأعلى' : 'High'} ${data.highest_score === null ? '—' : `${fmtNum(data.highest_score)}%`} · ${ar ? 'الأدنى' : 'Low'} ${data.lowest_score === null ? '—' : `${fmtNum(data.lowest_score)}%`}`} icon="clock" tone="warn" />
      </div>

      <div className="xa-grid">
        <section className="ex-card ex-card__pad xa-span">
          <div className="ex-card__head">
            <div>
              <h2 className="ex-card__title">{ar ? 'توزيع الدرجات' : 'Score distribution'}</h2>
              <p className="ex-card__sub">{ar ? 'اضغط على عمود لعرض طلاب هذه الشريحة في الجدول بالأسفل.' : 'Click a bar to list the students in that range in the table below.'}</p>
            </div>
            {bin && <button type="button" className="btn btn-outline btn-sm" onClick={() => setBin(null)}>{bin.from}–{bin.to}% <Icon name="x" size={13} /></button>}
          </div>
          {hasGraded
            ? <Histogram bins={bins} passing={passing} avg={data.average_score} active={bin} onPick={(b) => { setBin(b); }} ar={ar} />
            : <EmptyState icon="bar-chart" title={ar ? 'لا توجد درجات بعد' : 'No scores yet'} text={ar ? 'سيظهر التوزيع بعد تصحيح أول محاولة.' : 'The distribution appears after the first attempt is graded.'} />}
        </section>

        <section className="ex-card ex-card__pad">
          <div className="ex-card__head"><h2 className="ex-card__title">{ar ? 'ناجح / راسب' : 'Pass vs fail'}</h2></div>
          {passing === null
            ? <p className="is-muted" style={{ fontSize: 13 }}>{ar ? 'لم تُحدَّد درجة نجاح لهذا الامتحان.' : 'No pass mark was set for this exam.'}</p>
            : counts.passed + counts.failed === 0
              ? <p className="is-muted" style={{ fontSize: 13 }}>{ar ? 'لا توجد محاولات مُصحَّحة.' : 'No graded attempts.'}</p>
              : <Donut slices={passSlices} centre={`${fmtNum(data.pass_rate)}%`} sub={ar ? 'نجاح' : 'passed'} />}
        </section>

        <section className="ex-card ex-card__pad">
          <div className="ex-card__head"><h2 className="ex-card__title">{ar ? 'حالة التسليم' : 'Submission status'}</h2></div>
          <Donut slices={statusSlices} centre={`${data.total_students ?? results.length}`} sub={ar ? 'طالب' : 'students'} />
        </section>
      </div>

      <section className="ex-card ex-card__pad">
        <div className="ex-card__head">
          <div>
            <h2 className="ex-card__title">{ar ? 'صعوبة الأسئلة' : 'Question difficulty'}</h2>
            <p className="ex-card__sub">{ar ? 'متوسط الدرجة المحصَّلة في كل سؤال — الأقصر أصعب.' : 'Average share of marks earned per question — shorter bars are harder.'}</p>
          </div>
          <div className="xa-controls">
            {qTypes.length > 1 && (
              <select className="form-input" value={qType} onChange={(e) => setQType(e.target.value)} aria-label={ar ? 'نوع السؤال' : 'Question type'}>
                <option value="all">{ar ? 'كل الأنواع' : 'All types'}</option>
                {qTypes.map((t) => <option key={t} value={t}>{questionTypeLabel(t, ar)}</option>)}
              </select>
            )}
            <Segmented
              ar={ar}
              label={ar ? 'الترتيب' : 'Sort'}
              value={qSort}
              onChange={setQSort}
              options={[{ key: 'hardest', en: 'Hardest', ar: 'الأصعب' }, { key: 'easiest', en: 'Easiest', ar: 'الأسهل' }, { key: 'order', en: 'Exam order', ar: 'ترتيب الامتحان' }]}
            />
            <label className="text-small xa-check">
              <input type="checkbox" className="ex-check-input" checked={qWeak} onChange={(e) => setQWeak(e.target.checked)} />
              {ar ? 'أقل من 50% فقط' : 'Below 50% only'}
            </label>
          </div>
        </div>

        {questions.length === 0 ? (
          <EmptyState icon="file" title={ar ? 'لا توجد أسئلة مُجاب عنها بعد' : 'No answered questions yet'} />
        ) : qRows.length === 0 ? (
          <p className="is-muted" style={{ fontSize: 13 }}>{ar ? 'لا توجد أسئلة مطابقة للفلتر.' : 'No questions match the filter.'}</p>
        ) : (
          <ul className="xa-qlist">
            {qRows.map((q) => {
              const v = q.average_score_pct;
              const b = band(v);
              return (
                <li key={q.exam_question_id} className="xa-q">
                  <span className="xa-q__no">{q._no}</span>
                  <div className="xa-q__main">
                    <div className="xa-q__prompt" title={q.prompt}>{q.prompt}</div>
                    <div className="xa-q__meta">
                      <span className="exd-chip">{questionTypeLabel(q.type, ar, true)}</span>
                      <span>{q.answered_count} {ar ? 'إجابة' : 'answers'}</span>
                      {q.correct_pct !== null && <span>{ar ? 'صحيح' : 'Correct'} {fmtNum(q.correct_pct)}%</span>}
                      {data.questions.most_difficult_question === q.exam_question_id && <span className="ex-status ex-status--failed">{ar ? 'الأصعب' : 'Hardest'}</span>}
                      {data.questions.easiest_question === q.exam_question_id && <span className="ex-status ex-status--graded">{ar ? 'الأسهل' : 'Easiest'}</span>}
                    </div>
                  </div>
                  <div className="xa-q__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v ?? 0}>
                    <span className={`is-${b}`} style={{ width: `${v ?? 0}%` }} />
                  </div>
                  <strong className={`xa-q__val is-${b}`}>{v === null ? '—' : `${fmtNum(v)}%`}</strong>
                </li>
              );
            })}
          </ul>
        )}
        {easiest && qRows.length > 0 && <p className="ex-card__sub" style={{ marginTop: 12 }}><span className="xa-dot is-good" /> ≥70% {ar ? 'جيد' : 'good'} · <span className="xa-dot is-warn" /> 40–70% {ar ? 'متوسط' : 'medium'} · <span className="xa-dot is-bad" /> &lt;40% {ar ? 'صعب' : 'hard'}</p>}
      </section>

      <section className="ex-card">
        <div className="ex-card__head" style={{ padding: '20px 24px 0' }}>
          <div>
            <h2 className="ex-card__title">{ar ? 'نتائج الطلاب' : 'Student results'}</h2>
            <p className="ex-card__sub">{rows.length} {ar ? 'من' : 'of'} {results.length} {ar ? 'محاولة' : 'attempts'}</p>
          </div>
        </div>
        <div className="ex-toolbar">
          <div className="ex-search">
            <Icon name="search" size={15} />
            <input className="ex-input" type="search" value={sq} onChange={(e) => setSq(e.target.value)} placeholder={ar ? 'ابحث بالاسم أو الرقم الجامعي…' : 'Search by name or student number…'} aria-label={ar ? 'بحث' : 'Search'} />
          </div>
          <Segmented ar={ar} label={ar ? 'الحالة' : 'Status'} value={sFilter} onChange={setSFilter} options={SF} />
          <select className="ex-select" value={sSort} onChange={(e) => setSSort(e.target.value)} aria-label={ar ? 'الترتيب' : 'Sort'}>
            <option value="score_desc">{ar ? 'الدرجة: الأعلى أولًا' : 'Score: high → low'}</option>
            <option value="score_asc">{ar ? 'الدرجة: الأقل أولًا' : 'Score: low → high'}</option>
            <option value="name">{ar ? 'الاسم' : 'Name'}</option>
            <option value="time">{ar ? 'الوقت المستغرق' : 'Time taken'}</option>
          </select>
          {filtersActive && <button type="button" className="btn btn-outline btn-sm" onClick={() => { setBin(null); setSq(''); setSFilter('all'); }}>{ar ? 'مسح التصفية' : 'Clear filters'}</button>}
        </div>

        {rows.length === 0 ? (
          <div style={{ padding: 24 }}>
            <EmptyState icon="search" title={ar ? 'لا توجد نتائج مطابقة' : 'No matching results'} text={ar ? 'جرّب تغيير الفلاتر.' : 'Try changing the filters.'} />
          </div>
        ) : (
          <>
            <div className="ex-table-wrap">
              <table className="ex-table">
                <thead>
                  <tr>
                    <th>{ar ? 'الطالب' : 'Student'}</th>
                    <th>{ar ? 'المحاولة' : 'Attempt'}</th>
                    <th>{ar ? 'الدرجة' : 'Score'}</th>
                    <th>{ar ? 'الحالة' : 'Status'}</th>
                    <th>{ar ? 'الوقت' : 'Time'}</th>
                    <th>{ar ? 'وقت التسليم' : 'Submitted'}</th>
                    <th className="is-end" />
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, shown).map((r) => {
                    const b = r.passed === null ? band(r.percentage) : r.passed ? 'good' : 'bad';
                    return (
                      <tr key={r.attempt_id}>
                        <td>
                          <div className="ex-student-cell">
                            <PersonAvatar name={r.full_name} />
                            <div style={{ minWidth: 0 }}><strong>{r.full_name}</strong><small>{r.student_number}</small></div>
                          </div>
                        </td>
                        <td className="is-muted">#{r.attempt_number}{r.is_late && <span className="ex-pill" style={{ marginInlineStart: 6 }}>{ar ? 'متأخر' : 'Late'}</span>}</td>
                        <td>
                          {r.percentage === null ? <span className="is-muted">—</span> : (
                            <div className="xr-pct">
                              <strong>{fmtNum(r.percentage)}%</strong>
                              <div className="xa-mini"><span className={`is-${b}`} style={{ width: `${Math.min(100, r.percentage)}%` }} /></div>
                            </div>
                          )}
                        </td>
                        <td>
                          <AttemptPill status={r.status} ar={ar} />
                          {r.passed !== null && <span className={`xa-pf is-${r.passed ? 'good' : 'bad'}`}>{r.passed ? (ar ? 'ناجح' : 'Pass') : (ar ? 'راسب' : 'Fail')}</span>}
                        </td>
                        <td className="is-muted" style={{ whiteSpace: 'nowrap' }}>{secs(r.time_seconds, ar)}</td>
                        <td className="is-muted" style={{ whiteSpace: 'nowrap' }}>{r.submitted_at ? fmtDateTime(r.submitted_at, ar) : '—'}</td>
                        <td className="is-end"><Link to={`/academic-staff/exams/${id}/attempts/${r.attempt_id}`} className="ex-link">{ar ? 'فتح' : 'Open'}</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > shown && (
              <div style={{ padding: 16, textAlign: 'center' }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setShown((n) => n + PAGE)}>{ar ? `عرض المزيد (${rows.length - shown})` : `Show more (${rows.length - shown})`}</button>
              </div>
            )}
          </>
        )}
      </section>

      <QuestionQualityPanel mode="exam" id={id} />
    </div>
  );
}
