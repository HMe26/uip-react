import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useLanguage } from '../../context/LanguageContext';
import { PersonAvatar, StaffHead } from '../../components/staff/stfUi';
import { EmptyState, Skeleton } from '../../components/student/stUi';
import { ExKpi, Segmented, fmtDate, fmtNum } from '../../components/exam/examUi';
import { SaveExportButtons } from './resultsShared';

/**
 * Sidebar → Students' Results. Every student who attempted any of the instructor's exams, with the
 * average across exams and an expandable per-exam breakdown (best attempt per exam).
 * Data: GET /api/v1/exam-system/results/students?q=&exam_id= (search + exam filter run on the server);
 * the performance bands, status filter and sorting run on the loaded list. Export: .../students/export.
 */

const STATUS = {
  passed: { cls: 'graded', en: 'Passed', ar: 'ناجح' },
  failed: { cls: 'failed', en: 'Failed', ar: 'راسب' },
  graded: { cls: 'graded', en: 'Graded', ar: 'مصحّح' },
  pending: { cls: 'scheduled', en: 'Pending grading', ar: 'بانتظار التصحيح' },
};

const BANDS = [
  { key: 'top', en: 'Excelling (85%+)', ar: 'متفوق (85%+)', color: 'var(--color-success)', test: (v) => v >= 85 },
  { key: 'good', en: 'On track (60–84%)', ar: 'مستواه جيد (60–84%)', color: 'var(--color-primary)', test: (v) => v >= 60 && v < 85 },
  { key: 'mid', en: 'Borderline (50–59%)', ar: 'على الحد (50–59%)', color: 'var(--color-warning)', test: (v) => v >= 50 && v < 60 },
  { key: 'risk', en: 'At risk (<50%)', ar: 'يحتاج دعم (<50%)', color: 'var(--color-danger)', test: (v) => v < 50 },
];
const bandOf = (v) => (v === null || v === undefined ? null : BANDS.find((b) => b.test(Number(v))));
const tone = (v) => (v === null || v === undefined ? '' : v >= 70 ? 'good' : v >= 50 ? 'warn' : 'bad');

const EXPORT_AR = { 'Export failed': 'فشل التصدير', 'Export saved.': 'تم حفظ التصدير.', 'Open Exports': 'فتح التصدير' };

function Pct({ value }) {
  if (value === null || value === undefined) return <span className="is-muted">—</span>;
  const t = tone(value);
  return (
    <div className="xr-pct">
      <strong>{fmtNum(value)}%</strong>
      <div className={`stf-bar${t === 'good' ? ' stf-bar--good' : t === 'warn' ? ' stf-bar--warn' : ''}`}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
    </div>
  );
}

export default function AcademicStaffStudentResults() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const tx = (k) => (ar ? (EXPORT_AR[k] || k) : k);

  const [students, setStudents] = useState([]);
  const [exams, setExams] = useState([]);
  // ?q= comes from the topbar search results page.
  const initialQ = new URLSearchParams(window.location.search).get('q') || '';
  const [q, setQ] = useState(initialQ);
  const [query, setQuery] = useState(initialQ);
  const [examId, setExamId] = useState('');
  const [band, setBand] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('name');
  const [open, setOpen] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/api/v1/exam-system/exams').then((json) => setExams(json.data || [])).catch(() => {});
  }, []);

  // Debounce the search box so we don't hit the API on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (examId) params.set('exam_id', examId);
    api.get(`/api/v1/exam-system/results/students?${params.toString()}`)
      .then((json) => { if (!cancelled) { setStudents(json.data || []); setError(null); } })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query, examId]);

  const hasPending = (s) => s.exams.some((x) => x.status === 'pending');

  const stats = useMemo(() => {
    const avgs = students.map((s) => s.avg_percentage).filter((v) => v !== null && v !== undefined);
    const bandCounts = Object.fromEntries(BANDS.map((b) => [b.key, 0]));
    avgs.forEach((v) => { const b = bandOf(v); if (b) bandCounts[b.key] += 1; });
    return {
      avg: avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null,
      graded: avgs.length,
      bandCounts,
      pending: students.filter(hasPending).length,
    };
  }, [students]);

  const shown = useMemo(() => {
    const list = students.filter((s) => {
      if (band && bandOf(s.avg_percentage)?.key !== band) return false;
      if (status === 'pending' && !hasPending(s)) return false;
      if (status === 'failed' && !s.exams.some((x) => x.status === 'failed')) return false;
      if (status === 'passed' && !(s.exams.length && s.exams.every((x) => x.status === 'passed' || x.status === 'graded'))) return false;
      return true;
    });
    const v = (x) => (x === null || x === undefined ? -1 : x);
    const by = {
      name: (a, b) => String(a.full_name).localeCompare(String(b.full_name), locale),
      high: (a, b) => v(b.avg_percentage) - v(a.avg_percentage),
      low: (a, b) => (a.avg_percentage === null) - (b.avg_percentage === null) || v(a.avg_percentage) - v(b.avg_percentage),
      taken: (a, b) => b.exams_taken - a.exams_taken,
    };
    return [...list].sort(by[sort]);
  }, [students, band, status, sort, locale]);

  const exportPayload = { export_type: 'students_results', q: query || undefined, exam_id: examId ? Number(examId) : undefined };
  const filtered = band || status !== 'all';
  const gradedTotal = stats.graded;

  return (
    <div className="ex-page">
      <StaffHead
        eyebrow={ar ? 'مساحة التقييم' : 'Assessment workspace'}
        title={ar ? 'نتائج الطلاب' : "Students' Results"}
        subtitle={ar ? 'نتائج كل طالب عبر امتحاناتك.' : 'Each student’s results across your exams.'}
        actions={<Link to="/academic-staff/results" className="btn btn-outline"><Icon name="award" size={16} /> {ar ? 'نتائج الامتحانات' : 'Exam Results'}</Link>}
      />

      {error && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}

      <div className="ex-kpis">
        <ExKpi label={ar ? 'عدد الطلاب' : 'Students'} value={students.length} sub={examId ? (ar ? 'في الامتحان المختار' : 'In the selected exam') : (ar ? 'عبر كل الامتحانات' : 'Across all exams')} icon="users" />
        <ExKpi label={ar ? 'متوسط الدرجات' : 'Average Score'} value={stats.avg === null ? '—' : `${fmtNum(stats.avg)}%`} sub={ar ? 'متوسط متوسطات الطلاب' : 'Mean of student averages'} icon="bar-chart" />
        <ExKpi label={ar ? 'يحتاجون دعمًا' : 'At risk'} value={stats.bandCounts.risk} sub={ar ? 'متوسطهم أقل من 50%' : 'Average below 50%'} icon="alert-triangle" tone={stats.bandCounts.risk ? 'bad' : ''} />
        <ExKpi label={ar ? 'بانتظار التصحيح' : 'Pending Grading'} value={stats.pending} sub={ar ? 'طلاب لديهم تصحيح معلّق' : 'Students with ungraded work'} icon="clock" tone={stats.pending ? 'warn' : ''} />
      </div>

      {gradedTotal > 0 && (
        <section className="ex-card ex-card__pad">
          <div className="ex-card__head">
            <div>
              <h2 className="ex-card__title">{ar ? 'مستوى الطلاب' : 'Performance bands'}</h2>
              <p className="ex-card__sub">{ar ? 'اضغط على شريحة لعرض طلابها فقط.' : 'Click a band to list only its students.'}</p>
            </div>
            {band && <button type="button" className="btn btn-outline btn-sm" onClick={() => setBand('')}>{ar ? 'مسح' : 'Clear'} <Icon name="x" size={13} /></button>}
          </div>
          <div className="xs-stack" role="img" aria-label={BANDS.map((b) => `${ar ? b.ar : b.en}: ${stats.bandCounts[b.key]}`).join(', ')}>
            {BANDS.filter((b) => stats.bandCounts[b.key] > 0).map((b) => (
              <button key={b.key} type="button" className={`xs-stack__seg${band === b.key ? ' is-active' : ''}${band && band !== b.key ? ' is-dim' : ''}`} style={{ flexGrow: stats.bandCounts[b.key], background: b.color }} onClick={() => setBand(band === b.key ? '' : b.key)} title={`${ar ? b.ar : b.en}: ${stats.bandCounts[b.key]}`}>
                {stats.bandCounts[b.key]}
              </button>
            ))}
          </div>
          <ul className="xs-legend">
            {BANDS.map((b) => (
              <li key={b.key}>
                <button type="button" className={band === b.key ? 'is-active' : ''} onClick={() => setBand(band === b.key ? '' : b.key)}>
                  <i style={{ background: b.color }} />{ar ? b.ar : b.en}<b>{stats.bandCounts[b.key]}</b>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="st-toolbar xc-toolbar">
        <label className="st-search">
          <Icon name="search" size={16} />
          <input className="form-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'ابحث بالاسم أو الرقم الجامعي أو البريد…' : 'Search by name, number or email…'} aria-label={ar ? 'بحث' : 'Search'} />
        </label>
        <select className="form-input" value={examId} onChange={(e) => { setExamId(e.target.value); setOpen(null); }} aria-label={ar ? 'الامتحان' : 'Exam'}>
          <option value="">{ar ? 'كل الامتحانات' : 'All exams'}</option>
          {exams.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
        <select className="form-input" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={ar ? 'الترتيب' : 'Sort'}>
          <option value="name">{ar ? 'الاسم' : 'Name'}</option>
          <option value="high">{ar ? 'المتوسط: الأعلى أولًا' : 'Average: high → low'}</option>
          <option value="low">{ar ? 'المتوسط: الأقل أولًا' : 'Average: low → high'}</option>
          <option value="taken">{ar ? 'الأكثر امتحانات' : 'Most exams taken'}</option>
        </select>
        <Segmented ar={ar} label={ar ? 'الحالة' : 'Status'} value={status} onChange={setStatus}
          options={[{ key: 'all', en: 'All', ar: 'الكل' }, { key: 'passed', en: 'Passed all', ar: 'نجح في الكل' }, { key: 'failed', en: 'Has failed', ar: 'راسب في مادة' }, { key: 'pending', en: 'Pending', ar: 'بانتظار' }]} />
      </div>

      <div className="xs-exportbar">
        <span className="ex-card__sub" style={{ margin: 0 }}>{shown.length} {ar ? 'من' : 'of'} {students.length} {ar ? 'طالب' : 'students'}</span>
        <SaveExportButtons t={tx} disabled={students.length === 0} payload={exportPayload} />
      </div>

      {loading ? (
        <Skeleton h={64} count={4} />
      ) : students.length === 0 ? (
        <EmptyState icon="users" title={ar ? 'لا توجد نتائج طلاب بعد.' : 'No student results yet.'} />
      ) : shown.length === 0 ? (
        <EmptyState icon="search" title={ar ? 'لا توجد نتائج مطابقة' : 'No matching students'} text={ar ? 'جرّب تغيير التصفية.' : 'Try changing the filters.'}>
          {filtered && <button type="button" className="btn btn-outline" onClick={() => { setBand(''); setStatus('all'); }}>{ar ? 'مسح التصفية' : 'Clear filters'}</button>}
        </EmptyState>
      ) : (
        <div className="ex-card">
          <div className="ex-table-wrap">
            <table className="ex-table">
              <thead>
                <tr>
                  <th>{ar ? 'الطالب' : 'Student'}</th>
                  <th>{ar ? 'الرقم الجامعي' : 'Student Number'}</th>
                  <th>{ar ? 'الامتحانات' : 'Exams taken'}</th>
                  <th>{ar ? 'المتوسط' : 'Average'}</th>
                  <th>{ar ? 'المستوى' : 'Level'}</th>
                  <th className="is-end" />
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => {
                  const b = bandOf(s.avg_percentage);
                  const isOpen = open === s.student_id;
                  return (
                    <Fragment key={s.student_id}>
                      <tr>
                        <td style={{ minWidth: 220 }}>
                          <div className="ex-student-cell">
                            <PersonAvatar name={s.full_name} />
                            <div style={{ minWidth: 0 }}><strong>{s.full_name}</strong><small>{s.email}</small></div>
                          </div>
                        </td>
                        <td className="is-muted">{s.student_number}</td>
                        <td><span className="ex-inline"><Icon name="file" size={14} />{s.exams_taken}</span></td>
                        <td><Pct value={s.avg_percentage} /></td>
                        <td>{b ? <span className="xs-level"><i style={{ background: b.color }} />{ar ? b.ar.replace(/\s*\(.*\)/, '') : b.en.replace(/\s*\(.*\)/, '')}</span> : <span className="is-muted">—</span>}</td>
                        <td className="is-end" style={{ whiteSpace: 'nowrap' }}>
                          <button type="button" className="ex-link" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : s.student_id)} aria-expanded={isOpen}>
                            {isOpen ? (ar ? 'إخفاء' : 'Hide') : (ar ? 'التفاصيل' : 'Details')}
                          </button>
                          <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} />
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="xs-detail">
                          <td colSpan={6}>
                            <table className="ex-table xs-inner">
                              <thead>
                                <tr>
                                  <th>{ar ? 'الامتحان' : 'Exam'}</th>
                                  <th>{ar ? 'المحاولات' : 'Attempts'}</th>
                                  <th>{ar ? 'أفضل درجة' : 'Best Score'}</th>
                                  <th>%</th>
                                  <th>{ar ? 'الحالة' : 'Status'}</th>
                                  <th>{ar ? 'آخر تسليم' : 'Last submitted'}</th>
                                  <th className="is-end" />
                                </tr>
                              </thead>
                              <tbody>
                                {s.exams.map((x) => {
                                  const m = STATUS[x.status] || STATUS.pending;
                                  return (
                                    <tr key={x.exam_id}>
                                      <td><Link to={`/academic-staff/exams/${x.exam_id}`} className="is-title">{x.exam_title}</Link></td>
                                      <td className="is-muted">{x.attempts}</td>
                                      <td>{x.best_score ?? '—'} / {x.total_marks}</td>
                                      <td><Pct value={x.best_percentage} /></td>
                                      <td><span className={`ex-status ex-status--${m.cls}`}>{ar ? m.ar : m.en}</span></td>
                                      <td className="is-muted" style={{ whiteSpace: 'nowrap' }}>{x.last_submitted_at ? fmtDate(x.last_submitted_at, ar) : '—'}</td>
                                      <td className="is-end" style={{ whiteSpace: 'nowrap' }}>
                                        <Link to={`/academic-staff/exams/${x.exam_id}/attempts`} className="ex-link">{ar ? 'التصحيح' : 'Grading'}</Link>
                                        <Link to={`/academic-staff/exams/${x.exam_id}/analytics`} className="ex-icon-btn" style={{ marginInlineStart: 8 }} title={ar ? 'التحليلات' : 'Analytics'} aria-label={ar ? 'التحليلات' : 'Analytics'}><Icon name="bar-chart" size={15} /></Link>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
