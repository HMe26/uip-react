import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useLanguage } from '../../context/LanguageContext';
import { StaffHead } from '../../components/staff/stfUi';
import { EmptyState, Skeleton } from '../../components/student/stUi';
import { ExKpi, fmtDate, fmtNum } from '../../components/exam/examUi';

/**
 * Sidebar → Results. One row per exam with the numbers an instructor looks for first
 * (attempts, still-to-grade, average, highest/lowest, pass rate) and direct links to the
 * attempts list and the analytics page. Data: GET /api/v1/exam-system/results/overview.
 */

const SORTS = [
  { key: 'latest', en: 'Latest Created', ar: 'الأحدث إنشاءً' },
  { key: 'avg', en: 'Highest Average', ar: 'الأعلى متوسطًا' },
  { key: 'pass', en: 'Highest Pass Rate', ar: 'الأعلى نجاحًا' },
  { key: 'pending', en: 'Most to Grade', ar: 'الأكثر بانتظار التصحيح' },
  { key: 'title', en: 'Title (A–Z)', ar: 'العنوان (أ–ي)' },
];

const num = (v) => (v === null || v === undefined ? null : Number(v));
const tone = (v) => (v === null ? '' : v >= 75 ? 'good' : v >= 50 ? 'warn' : 'bad');

/** Percentage with a thin progress bar underneath; "—" when there is no data yet. */
function PctCell({ value }) {
  const v = num(value);
  if (v === null) return <span className="is-muted">—</span>;
  const t = tone(v);
  return (
    <div className="xr-pct">
      <strong>{fmtNum(v)}%</strong>
      <div className={`stf-bar${t === 'good' ? ' stf-bar--good' : t === 'warn' ? ' stf-bar--warn' : ''}`}><span style={{ width: `${Math.max(0, Math.min(100, v))}%` }} /></div>
    </div>
  );
}

export default function AcademicStaffResults() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('latest');

  useEffect(() => {
    let cancelled = false;
    api.get('/api/v1/exam-system/results/overview')
      .then((json) => { if (!cancelled) setRows(json.data || []); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const withData = useMemo(() => rows.filter((r) => r.attempts_total > 0), [rows]);
  const kpi = useMemo(() => {
    const graded = rows.reduce((a, r) => a + (r.graded || 0), 0);
    const pending = rows.reduce((a, r) => a + (r.pending_grading || 0), 0);
    const avgs = rows.map((r) => num(r.avg_percentage)).filter((v) => v !== null);
    const passes = rows.map((r) => num(r.pass_rate)).filter((v) => v !== null);
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    return { graded, pending, avg: mean(avgs), pass: mean(passes) };
  }, [rows]);

  const counts = useMemo(() => ({
    all: rows.length,
    pending: rows.filter((r) => r.pending_grading > 0).length,
    published: rows.filter((r) => r.results_published_at).length,
    nodata: rows.length - withData.length,
  }), [rows, withData]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (tab === 'pending' && !(r.pending_grading > 0)) return false;
      if (tab === 'published' && !r.results_published_at) return false;
      if (tab === 'nodata' && r.attempts_total > 0) return false;
      if (needle && !`${r.title} ${r.subject || ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const n = (v) => (v === null || v === undefined ? -1 : Number(v));
    const by = {
      latest: (a, b) => b.id - a.id,
      avg: (a, b) => n(b.avg_percentage) - n(a.avg_percentage),
      pass: (a, b) => n(b.pass_rate) - n(a.pass_rate),
      pending: (a, b) => (b.pending_grading || 0) - (a.pending_grading || 0),
      title: (a, b) => String(a.title).localeCompare(String(b.title), locale),
    };
    return [...list].sort(by[sort]);
  }, [rows, tab, q, sort, locale]);

  if (loading) return <div className="st-page"><Skeleton h={100} count={3} /></div>;

  const TABS = [
    ['all', ar ? 'الكل' : 'All'],
    ['pending', ar ? 'بانتظار التصحيح' : 'Needs grading'],
    ['published', ar ? 'نتائج منشورة' : 'Published'],
    ['nodata', ar ? 'بلا محاولات' : 'No attempts'],
  ];

  return (
    <div className="ex-page">
      <StaffHead
        eyebrow={ar ? 'مساحة التقييم' : 'Assessment workspace'}
        title={ar ? 'نتائج الامتحانات' : 'Exam Results'}
        subtitle={ar ? 'ملخص النتائج لكل امتحان أنشأته.' : 'Results summary for every exam you created.'}
        actions={(
          <>
            <Link to="/academic-staff/students-results" className="btn btn-outline"><Icon name="users" size={16} /> {ar ? 'نتائج الطلاب' : 'Student Results'}</Link>
            <Link to="/academic-staff/exports" className="btn btn-outline"><Icon name="download" size={16} /> {ar ? 'التصدير' : 'Exports'}</Link>
          </>
        )}
      />

      {error && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}

      <div className="ex-kpis">
        <ExKpi label={ar ? 'متوسط الدرجات' : 'Average Score'} value={kpi.avg === null ? '—' : `${fmtNum(kpi.avg)}%`} sub={ar ? 'عبر الامتحانات المصحّحة' : 'Across graded exams'} icon="bar-chart" />
        <ExKpi label={ar ? 'متوسط نسبة النجاح' : 'Avg. Pass Rate'} value={kpi.pass === null ? '—' : `${fmtNum(kpi.pass)}%`} sub={ar ? 'للامتحانات ذات درجة نجاح' : 'Exams with a pass mark'} icon="award" tone="good" />
        <ExKpi label={ar ? 'محاولات مصحّحة' : 'Graded Attempts'} value={kpi.graded} sub={ar ? 'تم رصد درجاتها' : 'Scores recorded'} icon="check-circle" tone="good" />
        <ExKpi label={ar ? 'بانتظار التصحيح' : 'Pending Grading'} value={kpi.pending} sub={ar ? 'تحتاج انتباهك' : 'Needs your attention'} icon="clock" tone={kpi.pending ? 'bad' : ''} />
      </div>


      {withData.length > 0 && (
        <section className="ex-card ex-card__pad">
          <div className="ex-card__head">
            <div>
              <h2 className="ex-card__title">{ar ? 'المتوسط ونسبة النجاح لكل امتحان' : 'Average & pass rate by exam'}</h2>
              <p className="ex-card__sub">{ar ? 'نظرة سريعة على أداء الطلاب في كل امتحان.' : 'A quick view of how students did in each exam.'}</p>
            </div>
            <div className="xs-key"><span><i className="is-avg" />{ar ? 'المتوسط' : 'Average'}</span><span><i className="is-pass" />{ar ? 'نسبة النجاح' : 'Pass rate'}</span></div>
          </div>
          <ul className="xs-bars">
            {[...withData].filter((r) => num(r.avg_percentage) !== null).slice(0, 8).map((r) => (
              <li key={r.id}>
                <Link to={`/academic-staff/exams/${r.id}/analytics`} className="xs-bars__label" title={r.title}>{r.title}</Link>
                <div className="xs-bars__tracks">
                  <div className="xs-bars__track"><span className="is-avg" style={{ width: `${Math.min(100, num(r.avg_percentage))}%` }} /><b>{fmtNum(r.avg_percentage)}%</b></div>
                  {num(r.pass_rate) !== null && <div className="xs-bars__track"><span className="is-pass" style={{ width: `${Math.min(100, num(r.pass_rate))}%` }} /><b>{fmtNum(r.pass_rate)}%</b></div>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="st-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`st-tab${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>
            {label}<span className="st-tab__count">{counts[k]}</span>
          </button>
        ))}
      </div>

      <div className="st-toolbar xc-toolbar">
        <label className="st-search">
          <Icon name="search" size={16} />
          <input className="form-input" type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={ar ? 'ابحث بالعنوان أو المقرر…' : 'Search exams by title or course…'} aria-label={ar ? 'بحث' : 'Search'} />
        </label>
        <select className="form-input" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={ar ? 'الترتيب' : 'Sort'}>
          {SORTS.map((x) => <option key={x.key} value={x.key}>{ar ? x.ar : x.en}</option>)}
        </select>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="file" title={ar ? 'لا توجد امتحانات بعد.' : 'No exams yet.'}>
          <Link to="/academic-staff/exams/create" className="btn btn-primary"><Icon name="plus" size={16} /> {ar ? 'إنشاء امتحان' : 'Create Exam'}</Link>
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState icon="search" title={ar ? 'لا توجد نتائج مطابقة' : 'No results match'} text={ar ? 'جرّب تغيير البحث أو التصنيف.' : 'Try a different search or filter.'}>
          <button type="button" className="btn btn-outline" onClick={() => { setQ(''); setTab('all'); }}>{ar ? 'مسح التصفية' : 'Clear filters'}</button>
        </EmptyState>
      ) : (
        <div className="ex-card">
          <div className="ex-table-wrap">
            <table className="ex-table">
              <thead>
                <tr>
                  <th>{ar ? 'الامتحان' : 'Exam'}</th>
                  <th>{ar ? 'المحاولات' : 'Attempts'}</th>
                  <th>{ar ? 'المصحّحة' : 'Graded'}</th>
                  <th>{ar ? 'بانتظار التصحيح' : 'Needs grading'}</th>
                  <th>{ar ? 'المتوسط' : 'Average'}</th>
                  <th>{ar ? 'الأعلى' : 'Highest'}</th>
                  <th>{ar ? 'الأدنى' : 'Lowest'}</th>
                  <th>{ar ? 'نسبة النجاح' : 'Pass rate'}</th>
                  <th className="is-end">{ar ? 'إجراء' : 'Action'}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td style={{ minWidth: 220 }}>
                      <Link to={`/academic-staff/exams/${r.id}`} className="is-title">{r.title}</Link>
                      <div className="is-muted" style={{ fontSize: 12, marginTop: 2, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {r.subject && <span>{r.subject}</span>}
                        {r.results_published_at
                          ? <span className="ex-status ex-status--graded">{ar ? 'نُشرت' : 'Published'} · {fmtDate(r.results_published_at, ar)}</span>
                          : <span className="ex-status ex-status--idle">{ar ? 'غير منشورة' : 'Not published'}</span>}
                      </div>
                    </td>
                    <td>{r.attempts_total}</td>
                    <td>{r.graded}</td>
                    <td>{r.pending_grading > 0 ? <span className="ex-status ex-status--scheduled">{r.pending_grading}</span> : <span className="is-muted">0</span>}</td>
                    <td><PctCell value={r.avg_percentage} /></td>
                    <td className="is-muted">{num(r.highest) === null ? '—' : `${fmtNum(r.highest)}%`}</td>
                    <td className="is-muted">{num(r.lowest) === null ? '—' : `${fmtNum(r.lowest)}%`}</td>
                    <td><PctCell value={r.pass_rate} /></td>
                    <td className="is-end" style={{ whiteSpace: 'nowrap' }}>
                      <Link to={`/academic-staff/exams/${r.id}/attempts`} className="ex-link">{ar ? 'التصحيح' : 'Grading'}</Link>
                      <Link to={`/academic-staff/exams/${r.id}/analytics`} className="ex-icon-btn" style={{ marginInlineStart: 8 }} title={ar ? 'التحليلات' : 'Analytics'} aria-label={ar ? 'التحليلات' : 'Analytics'}>
                        <Icon name="bar-chart" size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
