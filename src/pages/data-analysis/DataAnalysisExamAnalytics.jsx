import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BackLink } from '../../lib/backStack';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { AreaChart, GroupedBars, HBarChart, KpiCard, Panel, Segmented, fmt } from '../../components/insight/charts';
import { useLanguage, useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/data-analysis/exams';

const translations = { ...i18nCommon, ...i18nPage };
const BASE = '/api/v1/data-analysis/exams';
const EMPTY_FILTERS = { university_id: '', faculty_id: '', course_id: '', exam_type: '', from: '', to: '' };
const pct = (v) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(1)}%`);
const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v !== null));
const GAP = { marginTop: 'var(--space-5)' };

/**
 * Exam & Grades Analytics — links the Data Analysis portal to the exam
 * system. Read-only; every number is computed server-side by
 * DataAnalysisExamsService (/api/v1/data-analysis/exams/*).
 * Routes: /data-analysis/exam-analytics (overview + students tabs) and
 * /data-analysis/exam-analytics/:id (single exam drill-down).
 */
export default function DataAnalysisExamAnalytics() {
  const { id } = useParams();
  return id ? <ExamDetail id={id} /> : <Main />;
}

function Header({ t, back }) {
  return (
    <div className="page-header animate-rise-in">
      <div className="page-header__title">
        {back && <BackLink to="/data-analysis/exam-analytics" className="text-small"><Icon name="arrow-left" size={14} /> {t('Back to exam analytics')}</BackLink>}
        <h1 className="text-h1">{t('Exam Analytics')}</h1>
        <p className="text-small">{t('Analyze exams, grades and student performance across the whole platform.')}</p>
      </div>
    </div>
  );
}

function useLoad(path, params) {
  const [state, setState] = useState({ data: null, meta: null, loading: true, error: null });
  const key = JSON.stringify(params);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get(path, params)
      .then((j) => { if (live) setState({ data: j.data, meta: j.meta, loading: false, error: null }); })
      .catch((e) => { if (live) setState({ data: null, meta: null, loading: false, error: errorMessage(e) }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key]);
  return state;
}

function Main() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const nm = useCallback((o) => (o ? (o[locale] || o.en || '') : ''), [locale]);
  const [tab, setTab] = useState('overview');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [options, setOptions] = useState({ universities: [], faculties: [], courses: [], exam_types: [] });

  useEffect(() => {
    api.get(`${BASE}/filters`).then((j) => setOptions((o) => j.data || o)).catch(() => {});
  }, []);

  const set = (k, v) => setFilters((f) => {
    const next = { ...f, [k]: v };
    if (k === 'university_id') { next.faculty_id = ''; next.course_id = ''; }
    if (k === 'faculty_id') next.course_id = '';
    return next;
  });

  const faculties = options.faculties.filter((x) => !filters.university_id || x.university_id === Number(filters.university_id));
  const courses = options.courses.filter((x) => (!filters.university_id || x.university_id === Number(filters.university_id))
    && (!filters.faculty_id || x.faculty_id === Number(filters.faculty_id)));
  const sel = { width: 'auto' };

  return (
    <>
      <Header t={t} />
      <div className="card glass-panel" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', marginBottom: 'var(--space-5)', alignItems: 'center' }}>
        <select className="form-input" style={sel} value={filters.university_id} onChange={(e) => set('university_id', e.target.value)}>
          <option value="">{t('All universities')}</option>
          {options.universities.map((u) => <option key={u.id} value={u.id}>{nm(u.name)}</option>)}
        </select>
        <select className="form-input" style={sel} value={filters.faculty_id} onChange={(e) => set('faculty_id', e.target.value)}>
          <option value="">{t('All faculties')}</option>
          {faculties.map((u) => <option key={u.id} value={u.id}>{nm(u.name)}</option>)}
        </select>
        <select className="form-input" style={sel} value={filters.course_id} onChange={(e) => set('course_id', e.target.value)}>
          <option value="">{t('All courses')}</option>
          {courses.map((u) => <option key={u.id} value={u.id}>{u.code} — {nm(u.name)}</option>)}
        </select>
        <select className="form-input" style={sel} value={filters.exam_type} onChange={(e) => set('exam_type', e.target.value)}>
          <option value="">{t('All exam types')}</option>
          {options.exam_types.map((x) => <option key={x} value={x}>{t(x)}</option>)}
        </select>
        <label className="text-small">{t('From')} <input className="form-input" style={sel} type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} /></label>
        <label className="text-small">{t('To')} <input className="form-input" style={sel} type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} /></label>
        <button type="button" className="btn btn-sm btn-outline" onClick={() => setFilters(EMPTY_FILTERS)}>{t('Reset')}</button>
      </div>

      <div style={{ marginBottom: 'var(--space-5)' }}>
        <Segmented value={tab} onChange={setTab} options={[{ value: 'overview', label: t('Overview') }, { value: 'students', label: t('Students') }]} />
      </div>

      {tab === 'overview' ? <Overview t={t} nm={nm} filters={filters} /> : <StudentsTab t={t} filters={filters} />}
    </>
  );
}

function BreakdownTable({ t, rows, labelOf }) {
  if (!rows?.length) return <p className="text-small">{t('No graded exam data for these filters yet.')}</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table">
        <thead><tr><th></th><th>{t('Graded')}</th><th>{t('Avg')}</th><th>{t('Pass')}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}><td>{labelOf(r)}</td><td>{fmt(r.attempts)}</td><td>{pct(r.average_pct)}</td><td>{pct(r.pass_rate)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Overview({ t, nm, filters }) {
  const params = useMemo(() => clean(filters), [filters]);
  const { data, loading, error } = useLoad(`${BASE}/overview`, params);
  const navigate = useNavigate();

  if (loading) return <p className="text-small">{t('Loading…')}</p>;
  if (error) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;
  const k = data.kpis;
  const names = data.names || {};
  const unknown = t('Unknown');
  const courseLabel = (r) => { const c = names.courses?.[r.course_id]; return c ? `${c.code} — ${nm(c)}` : unknown; };
  const empty = t('No graded exam data for these filters yet.');

  return (
    <>
      <div className="insight-grid insight-grid--kpi">
        <KpiCard label={t('Exams')} value={fmt(k.exams)} tone="primary" />
        <KpiCard label={t('Attempts')} value={fmt(k.attempts)} tone="info" note={`${fmt(k.graded)} ${t('Graded')}`} />
        <KpiCard label={t('Average score')} value={pct(k.average_pct)} tone="success" progress={k.average_pct} note={`${t('Median score')}: ${pct(k.median_pct)}`} />
        <KpiCard label={t('Pass rate')} value={pct(k.pass_rate)} tone={k.pass_rate !== null && k.pass_rate < 60 ? 'danger' : 'success'} progress={k.pass_rate} />
      </div>
      <div className="insight-grid insight-grid--kpi" style={{ marginTop: 'var(--space-4)' }}>
        <KpiCard label={t('Students')} value={fmt(k.students)} tone="primary" />
        <KpiCard label={t('Pending grading')} value={fmt(k.pending_grading)} tone="warning" />
        <KpiCard label={t('Highest')} value={pct(k.highest_pct)} note={`${t('Lowest')}: ${pct(k.lowest_pct)}`} tone="info" />
        <KpiCard label={t('Flagged attempts')} value={fmt(k.flagged_attempts)} tone="danger" note={`${t('Late submissions')}: ${fmt(k.late_attempts)}`} />
      </div>

      <div className="insight-grid insight-grid--halves" style={GAP}>
        <Panel title={t('Score distribution')} subtitle={t('Number of graded attempts per score band.')}>
          <HBarChart items={data.distribution.map((b) => ({ label: b.key === 'lt50' ? t('lt50') : b.key, value: b.count }))} emptyText={empty} />
        </Panel>
        <Panel title={t('Average score by month')}>
          <AreaChart data={data.trend.map((m) => ({ label: m.month, value: m.average_pct }))} dots yMin={0} format={(v) => pct(v)} emptyText={empty} />
        </Panel>
      </div>

      <div className="insight-grid insight-grid--halves" style={GAP}>
        <Panel title={t('By exam type')} subtitle={t('Average score and pass rate.')}>
          <GroupedBars
            items={data.by_exam_type.map((r) => ({ label: t(r.label), avg: r.average_pct || 0, pass: r.pass_rate || 0 }))}
            series={[{ key: 'avg', label: t('Avg'), color: 'var(--color-primary)' }, { key: 'pass', label: t('Pass'), color: 'var(--color-success)' }]}
            emptyText={empty}
          />
        </Panel>
        <Panel title={t('By faculty')} subtitle={t('Average score and pass rate.')}>
          <BreakdownTable t={t} rows={data.by_faculty} labelOf={(r) => nm(names.faculties?.[r.faculty_id]) || unknown} />
        </Panel>
      </div>

      <div className="insight-grid insight-grid--halves" style={GAP}>
        <Panel title={t('By course')} subtitle={t('Average score and pass rate.')}>
          <BreakdownTable t={t} rows={data.by_course} labelOf={courseLabel} />
        </Panel>
        <Panel title={t('By university')} subtitle={t('Average score and pass rate.')}>
          <BreakdownTable t={t} rows={data.by_university} labelOf={(r) => nm(names.universities?.[r.university_id]) || unknown} />
        </Panel>
      </div>

      <div style={GAP}>
        <Panel title={t('Exam results')} subtitle={t('Click an exam to see question-level analysis.')}>
          {data.exams.length === 0 ? <p className="text-small">{empty}</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead><tr><th>{t('Exam')}</th><th>{t('Type')}</th><th>{t('Course')}</th><th>{t('Graded')}</th><th>{t('Avg')}</th><th>{t('Highest')}</th><th>{t('Lowest')}</th><th>{t('Pass')}</th><th>{t('Last submission')}</th></tr></thead>
                <tbody>
                  {data.exams.map((e) => (
                    <tr key={e.exam_id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/data-analysis/exam-analytics/${e.exam_id}`)}>
                      <td><Link to={`/data-analysis/exam-analytics/${e.exam_id}`} onClick={(ev) => ev.stopPropagation()}>{e.title}</Link></td>
                      <td>{e.exam_type ? t(e.exam_type) : '—'}</td>
                      <td>{e.course_id ? courseLabel(e) : '—'}</td>
                      <td>{fmt(e.graded)}</td><td>{pct(e.average_pct)}</td><td>{pct(e.highest_pct)}</td><td>{pct(e.lowest_pct)}</td><td>{pct(e.pass_rate)}</td>
                      <td>{e.last_submitted_at ? String(e.last_submitted_at).slice(0, 10) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

const LEVEL_BADGE = { at_risk: 'badge-danger', excellent: 'badge-success', average: 'badge-neutral' };

function StudentsTab({ t, filters }) {
  const [q, setQ] = useState('');
  const [risk, setRisk] = useState('');
  const [sort, setSort] = useState('avg_asc');
  const [page, setPage] = useState(1);
  const [debounced, setDebounced] = useState('');

  useEffect(() => { const h = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(h); }, [q]);
  useEffect(() => { setPage(1); }, [debounced, risk, sort, filters]);

  const params = useMemo(() => clean({ ...filters, q: debounced, risk, sort, page, per_page: 25 }), [filters, debounced, risk, sort, page]);
  const { data, meta, loading, error } = useLoad(`${BASE}/students`, params);
  const pages = Math.max(1, Math.ceil((meta?.total || 0) / 25));
  const levelLabel = (l) => t(l === 'at_risk' ? 'At risk' : l === 'excellent' ? 'Excellent' : 'Average');

  return (
    <>
      {data && (
        <div className="insight-grid insight-grid--kpi" style={{ marginBottom: 'var(--space-4)' }}>
          <KpiCard label={t('Total students')} value={fmt(data.summary.total)} tone="primary" />
          <KpiCard label={t('At risk')} value={fmt(data.summary.at_risk)} tone="danger" />
          <KpiCard label={t('Excellent')} value={fmt(data.summary.excellent)} tone="success" />
        </div>
      )}
      <div className="card glass-panel" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        <input className="form-input" style={{ flex: '1 1 240px' }} placeholder={t('Search by name, number or email')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="form-input" style={{ width: 'auto' }} value={risk} onChange={(e) => setRisk(e.target.value)}>
          <option value="">{t('All levels')}</option>
          <option value="at_risk">{t('At risk')}</option>
          <option value="average">{t('Average')}</option>
          <option value="excellent">{t('Excellent')}</option>
        </select>
        <select className="form-input" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="avg_asc">{t('Sort: lowest average')}</option>
          <option value="avg_desc">{t('Sort: highest average')}</option>
          <option value="exams_desc">{t('Sort: most exams')}</option>
          <option value="name">{t('Sort: name')}</option>
        </select>
      </div>

      {loading && <p className="text-small">{t('Loading…')}</p>}
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {!loading && !error && data && (
        <Panel subtitle={t('Student averages use the best attempt per exam. At risk = average below 50% or pass rate below 50%.')}>
          {data.items.length === 0 ? <p className="text-small">{t('No students match.')}</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead><tr><th>{t('Student')}</th><th>{t('Number')}</th><th>{t('Exams taken')}</th><th>{t('Avg')}</th><th>{t('Best')}</th><th>{t('Lowest')}</th><th>{t('Pass')}</th><th>{t('Trend')}</th><th>{t('Violations')}</th><th>{t('Level')}</th></tr></thead>
                <tbody>
                  {data.items.map((s) => (
                    <tr key={s.student_id}>
                      <td>{s.student}<div className="text-caption">{s.email}</div></td>
                      <td>{s.student_number || '—'}</td>
                      <td>{s.exams_taken}</td><td>{pct(s.average_pct)}</td><td>{pct(s.best_pct)}</td><td>{pct(s.lowest_pct)}</td><td>{pct(s.pass_rate)}</td>
                      <td>{s.trend === null ? '—' : <span style={{ color: s.trend >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>{s.trend >= 0 ? '▲' : '▼'} {Math.abs(s.trend).toFixed(1)}</span>}</td>
                      <td>{s.flagged}</td>
                      <td><span className={`badge ${LEVEL_BADGE[s.level]}`}>{levelLabel(s.level)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', marginTop: 'var(--space-4)' }}>
            <button type="button" className="btn btn-sm btn-outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t('Previous')}</button>
            <span className="text-small">{t('Page')} {page} / {pages}</span>
            <button type="button" className="btn btn-sm btn-outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('Next')}</button>
          </div>
        </Panel>
      )}
    </>
  );
}

function ExamDetail({ id }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const nm = (o) => (o ? (o[locale] || o.en || '') : '');
  const { data, loading, error } = useLoad(`${BASE}/exam/${id}`, {});

  if (loading) return (<><Header t={t} back /><p className="text-small">{t('Loading…')}</p></>);
  if (error) return (<><Header t={t} back /><p style={{ color: 'var(--color-danger)' }}>{error}</p></>);

  const { exam, stats, distribution, questions, attempts } = data;
  const empty = t('No graded exam data for these filters yet.');
  return (
    <>
      <Header t={t} back />
      <h2 className="text-h2" style={{ marginBottom: 'var(--space-1)' }}>{exam.title}</h2>
      <p className="text-small" style={{ marginBottom: 'var(--space-4)' }}>
        {[exam.exam_type && t(exam.exam_type), exam.course && `${exam.course.code} — ${nm(exam.course.name)}`, nm(exam.faculty), nm(exam.university)].filter(Boolean).join(' · ')}
      </p>

      <div className="insight-grid insight-grid--kpi">
        <KpiCard label={t('Attempts')} value={fmt(stats.attempts)} tone="primary" note={`${fmt(stats.students)} ${t('Students')}`} />
        <KpiCard label={t('Average score')} value={pct(stats.average_pct)} tone="success" progress={stats.average_pct} note={`${t('Median score')}: ${pct(stats.median_pct)}`} />
        <KpiCard label={t('Pass rate')} value={pct(stats.pass_rate)} tone="info" progress={stats.pass_rate} note={exam.passing_score !== null ? `${t('Passing score')}: ${exam.passing_score}%` : undefined} />
        <KpiCard label={t('Highest')} value={pct(stats.highest_pct)} tone="warning" note={`${t('Lowest')}: ${pct(stats.lowest_pct)}`} />
      </div>
      <div className="insight-grid insight-grid--kpi" style={{ marginTop: 'var(--space-4)' }}>
        <KpiCard label={t('Std deviation')} value={stats.std_dev === null ? '—' : stats.std_dev} tone="info" />
        <KpiCard label={t('Avg duration (min)')} value={stats.avg_duration_min === null ? '—' : stats.avg_duration_min} tone="primary" />
        <KpiCard label={t('Flagged attempts')} value={fmt(stats.flagged_attempts)} tone="danger" />
        <KpiCard label={t('Late submissions')} value={fmt(stats.late_attempts)} tone="warning" />
      </div>

      <div style={GAP}>
        <Panel title={t('Score distribution')} subtitle={t('Number of graded attempts per score band.')}>
          <HBarChart items={distribution.map((b) => ({ label: b.key === 'lt50' ? t('lt50') : b.key, value: b.count }))} emptyText={empty} />
        </Panel>
      </div>

      <div style={GAP}>
        <Panel title={t('Question analysis')} subtitle={t('Hardest questions first (by average score).')}>
          {questions.length === 0 ? <p className="text-small">{empty}</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead><tr><th>{t('Question')}</th><th>{t('Type')}</th><th>{t('Difficulty')}</th><th>{t('Answered')}</th><th>{t('Correct %')}</th><th>{t('Avg score %')}</th></tr></thead>
                <tbody>
                  {questions.map((q) => (
                    <tr key={q.question_id}>
                      <td style={{ maxWidth: 420 }}>{q.prompt}</td><td>{q.type ? t(q.type) : '—'}</td><td>{q.difficulty ? t(q.difficulty) : '—'}</td>
                      <td>{q.answered}</td><td>{pct(q.correct_pct)}</td><td>{pct(q.average_score_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div style={GAP}>
        <Panel title={t('Student attempts')}>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead><tr><th>{t('Student')}</th><th>{t('Number')}</th><th>{t('Attempt')}</th><th>{t('Status')}</th><th>{t('Score')}</th><th>%</th><th>{t('Result')}</th><th>{t('Violations')}</th></tr></thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.attempt_id}>
                    <td>{a.student}</td><td>{a.student_number || '—'}</td><td>#{a.attempt_number}{a.late ? ` · ${t('Late')}` : ''}</td>
                    <td>{t(a.status)}</td><td>{a.score ?? '—'}</td><td>{pct(a.percentage)}</td>
                    <td>{a.passed === null ? '—' : <span className={`badge ${a.passed ? 'badge-success' : 'badge-danger'}`}>{a.passed ? t('Passed') : t('Failed')}</span>}</td>
                    <td>{a.violations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
