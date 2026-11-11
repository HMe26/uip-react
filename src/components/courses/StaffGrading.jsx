import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { EmptyState, Skeleton } from '../student/stUi';
import { AcPage, AcHead, AcAlerts, AcKpis, AcPanel, AcNums, AcTable } from './acKit';
import { Field, FormModal, FormSection } from '../people/formUi';
import { downloadAuthed } from '../../lib/download';

/**
 * التقييم والنتائج (الدكتور / المعيد / المشرف / الكلية / الجامعة): تحديد مكوّنات درجة المقرر (تكليفات / حضور / درجات يدوية)
 * مع أوزان الامتحانات → حساب النتيجة النهائية والتقدير حسب نظام الدرجات → تعديل تقدير طالب بسبب → نشر (أو رفع للاعتماد).
 * Backend: /api/v1/grading/courses/{id}[/components|/sheet|/calculate|/students/{sid}|/publish|/unpublish|/export].
 */

const KIND = { assignment: ['تكليف', 'Assignment'], attendance: ['حضور', 'Attendance'], manual: ['درجة يدوية', 'Manual'] };
const STATUS = { none: ['لم تُحسب', 'Not calculated', 'excused'], draft: ['مسودة', 'Draft', 'late'], submitted: ['بانتظار الاعتماد', 'Awaiting approval', 'excused'], published: ['منشورة', 'Published', 'present'] };
const TONE = { late: 'warning', absent: 'danger', excused: '', present: 'success' };
const pill = (t) => `st-pill${TONE[t] ? ` st-pill--${TONE[t]}` : ''}`;
const base = (id) => `/api/v1/grading/courses/${id}`;

export default function StaffGrading() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [setup, setSetup] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [comps, setComps] = useState([]);
  const [tab, setTab] = useState('setup');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [scores, setScores] = useState(null);   // manual component being scored
  const [ovr, setOvr] = useState(null);         // student row being overridden

  useEffect(() => {
    api.get('/api/v1/courses', { locale }).then((j) => {
      const list = (j.data || []).filter((c) => c.can_manage && c.status === 'active');
      setCourses(list);
      if (list[0]) setCourseId(String(list[0].id));
    }).catch((e) => setError(errorMessage(e))).finally(() => setLoading(false));
  }, [locale]);

  const applySetup = useCallback((d) => { setSetup(d); setComps(d.components.map((c) => ({ ...c }))); }, []);
  const load = useCallback(async () => {
    if (!courseId) return;
    const [a, b] = await Promise.all([api.get(base(courseId), { locale }), api.get(`${base(courseId)}/sheet`, { locale })]);
    applySetup(a.data); setSheet(b.data);
  }, [courseId, locale, applySetup]);
  useEffect(() => { setSetup(null); setSheet(null); load().catch((e) => setError(errorMessage(e))); }, [load]);

  async function act(fn, after) {
    setBusy(true); setError(null); setNotice(null);
    try { const j = await fn(); setNotice(j?.message); if (after) await after(j); else await load(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  const locked = sheet?.status === 'published';
  const compW = comps.reduce((s, c) => s + (parseFloat(c.weight) || 0), 0);
  const total = (setup?.exam_weight || 0) + compW;
  const setC = (i, k, v) => setComps((l) => l.map((c, j) => (j === i ? { ...c, [k]: v } : c)));

  const saveComps = () => act(() => api.put(`${base(courseId)}/components`, { locale, components: comps.map((c) => ({ id: c.id, kind: c.kind, ref_id: c.ref_id, title: c.title, weight: c.weight, max_score: c.max_score })) }), async (j) => { applySetup(j.data); });
  const addAssignment = (a) => setComps((l) => [...l, { kind: 'assignment', ref_id: a.id, title: a.title, weight: a.weight ?? 5, max_score: null }]);
  const addAttendance = () => setComps((l) => [...l, { kind: 'attendance', title: ar ? 'الحضور' : 'Attendance', weight: 5 }]);
  const addManual = () => setComps((l) => [...l, { kind: 'manual', title: '', weight: 10, max_score: 100 }]);
  const unsaved = setup && JSON.stringify(comps.map((c) => [c.id, c.kind, c.ref_id, c.title, +c.weight, c.max_score])) !== JSON.stringify(setup.components.map((c) => [c.id, c.kind, c.ref_id, c.title, +c.weight, c.max_score]));

  const st = STATUS[sheet?.status || 'none'];
  const s = sheet?.summary;

  return (
    <AcPage>
      <AcHead
        title={ar ? 'التقييم والنتائج النهائية' : 'Grading & final results'}
        text={ar ? 'اربط الامتحانات والتكليفات والحضور بدرجة المادة، احسب التقدير حسب نظام الدرجات، وانشر للطلاب.' : 'Combine exams, assignments and attendance into the course grade, apply the grading scale, and publish.'}
      />
      <AcAlerts error={error} notice={notice} />

      {loading ? <Skeleton h={100} count={2} /> : courses.length === 0 ? (
        <AcPanel><EmptyState icon="layers" title={ar ? 'لا توجد مواد تديرها' : 'No courses to manage'} /></AcPanel>
      ) : (
        <AcPanel flush>
          <div className="acx-toolbar">
            <select className="acx-input" style={{ flex: '1 1 260px' }} value={courseId} onChange={(e) => setCourseId(e.target.value)} aria-label={ar ? 'المادة' : 'Course'}>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
            {sheet && <span className={pill(st[2])}>{st[ar ? 0 : 1]}</span>}
            {sheet && sheet.course.credit_hours == null && <span className="acx-muted">{ar ? '⚠ المادة بدون ساعات معتمدة — مش هتدخل في الـ GPA' : '⚠ No credit hours — excluded from GPA'}</span>}
          </div>
          <div className="acx-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'setup'} className={tab === 'setup' ? 'is-on' : ''} onClick={() => setTab('setup')}>{ar ? 'المكوّنات والأوزان' : 'Components'}</button>
            <button type="button" role="tab" aria-selected={tab === 'results'} className={tab === 'results' ? 'is-on' : ''} onClick={() => setTab('results')}>{ar ? 'النتائج' : 'Results'}{sheet?.rows?.length ? <small>{sheet.rows.length}</small> : null}</button>
          </div>

          {!setup || !sheet ? <div className="acx-panel__body"><Skeleton h={80} count={2} /></div> : tab === 'setup' ? (
            <>
              <div className="acx-panel__body acx-stack">
                <AcKpis items={[
                  { label: ar ? 'أوزان الامتحانات' : 'Exam weights', value: `${setup.exam_weight}%`, icon: 'file' },
                  { label: ar ? 'أوزان المكوّنات' : 'Components', value: `${Math.round(compW * 100) / 100}%`, icon: 'layers' },
                  { label: ar ? 'المجموع' : 'Total', value: `${Math.round(total * 100) / 100}%`, icon: 'award', tone: total > 100 ? 'bad' : total === 100 ? 'good' : '' },
                ]} />
                <p className="acx-note">{ar ? 'أوزان الامتحانات بتتحدد من دفتر درجات المادة. المجموع مش لازم يكون 100 — النسبة = النقاط ÷ المجموع.' : 'Exam weights come from the course gradebook. The total need not be 100 — percentage = points ÷ total.'}</p>
              </div>

              <AcTable>
                <thead><tr><th>{ar ? 'النوع' : 'Type'}</th><th>{ar ? 'الاسم' : 'Title'}</th><th>{ar ? 'الوزن' : 'Weight'}</th><th>{ar ? 'الدرجة العظمى' : 'Max'}</th><th /></tr></thead>
                <tbody>
                  {comps.length === 0 && <tr><td colSpan={5}><span className="acx-muted">{ar ? 'لا مكوّنات — الدرجة من الامتحانات فقط.' : 'No components — grade comes from exams only.'}</span></td></tr>}
                  {comps.map((c, i) => (
                    <tr key={c.id || `n${i}`}>
                      <td><span className="st-pill">{KIND[c.kind][ar ? 0 : 1]}</span>{c.kind === 'assignment' && c.assignment_exists === false && <span className="acx-sub">{ar ? 'محذوف' : 'deleted'}</span>}</td>
                      <td>{c.kind === 'manual' ? <input className="acx-input" maxLength={200} value={c.title} disabled={locked} onChange={(e) => setC(i, 'title', e.target.value)} /> : c.title}</td>
                      <td><input className="acx-input" style={{ width: 90 }} type="number" min="0.5" max="100" step="0.5" value={c.weight} disabled={locked} onChange={(e) => setC(i, 'weight', e.target.value)} /></td>
                      <td>{c.kind === 'manual' ? <input className="acx-input" style={{ width: 90 }} type="number" min="1" value={c.max_score ?? ''} disabled={locked} onChange={(e) => setC(i, 'max_score', e.target.value)} /> : '—'}</td>
                      <td className="is-end">
                        <div className="acx-actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          {c.kind === 'manual' && c.id && <button type="button" className="btn btn-outline btn-sm" onClick={() => setScores(c)}><Icon name="edit" size={13} /> {ar ? 'رصد الدرجات' : 'Enter scores'}</button>}
                          {!locked && <button type="button" className="btn btn-ghost btn-sm" aria-label={ar ? 'حذف' : 'Remove'} onClick={() => setComps((l) => l.filter((_, j) => j !== i))}><Icon name="trash" size={13} /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AcTable>

              <div className="acx-panel__foot">
                {!locked ? (
                  <div className="acx-actions">
                    {!comps.some((c) => c.kind === 'attendance') && <button type="button" className="btn btn-outline btn-sm" onClick={addAttendance}><Icon name="plus" size={13} /> {ar ? 'الحضور' : 'Attendance'}</button>}
                    <button type="button" className="btn btn-outline btn-sm" onClick={addManual}><Icon name="plus" size={13} /> {ar ? 'درجة يدوية (أعمال فصلية/شفوي…)' : 'Manual (coursework/oral…)'}</button>
                    {setup.available_assignments.filter((a) => !comps.some((c) => c.kind === 'assignment' && c.ref_id === a.id)).map((a) => (
                      <button key={a.id} type="button" className="btn btn-ghost btn-sm" onClick={() => addAssignment(a)}><Icon name="plus" size={13} /> {a.title}</button>
                    ))}
                    <button type="button" className="btn btn-primary btn-sm" style={{ marginInlineStart: 'auto' }} disabled={busy || !unsaved} onClick={saveComps}><Icon name="check" size={13} /> {ar ? 'حفظ المكوّنات' : 'Save components'}</button>
                  </div>
                ) : <span className="acx-muted">{ar ? 'النتيجة منشورة — الغي النشر من تبويب النتائج للتعديل.' : 'Published — unpublish from Results to edit.'}</span>}
              </div>
            </>
          ) : (
            <>
              <div className="acx-toolbar">
                <button type="button" className="btn btn-primary btn-sm" disabled={busy || locked || unsaved} onClick={() => act(() => api.post(`${base(courseId)}/calculate`, { locale }))}><Icon name="refresh" size={13} /> {sheet.rows.length ? (ar ? 'إعادة الحساب' : 'Recalculate') : (ar ? 'احسب النتائج' : 'Calculate')}</button>
                {sheet.rows.length > 0 && sheet.status !== 'published' && sheet.status !== 'submitted' && (
                  <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => window.confirm(ar ? 'نشر النتائج للطلاب؟' : 'Publish results to students?') && act(() => api.post(`${base(courseId)}/publish`, { locale }))}>
                    <Icon name="upload" size={13} /> {sheet.can_publish_directly ? (ar ? 'نشر للطلاب' : 'Publish') : (ar ? 'رفع للاعتماد' : 'Submit for approval')}
                  </button>
                )}
                {sheet.status === 'submitted' && sheet.can_publish_directly && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => act(() => api.post(`${base(courseId)}/publish`, { locale }))}><Icon name="check" size={13} /> {ar ? 'اعتماد ونشر' : 'Approve & publish'}</button>}
                {(sheet.status === 'published' || sheet.status === 'submitted') && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => api.post(`${base(courseId)}/unpublish`, { locale }))}>{ar ? 'إلغاء النشر / سحب' : 'Unpublish / withdraw'}</button>}
                {sheet.rows.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadAuthed(`${base(courseId)}/export`, 'grades.csv').catch((e) => setError(errorMessage(e)))}><Icon name="download" size={13} /> CSV</button>}
                {unsaved && <span className="acx-muted">{ar ? 'فيه تعديلات غير محفوظة في المكوّنات.' : 'Unsaved component changes.'}</span>}
              </div>

              {sheet.rows.length === 0 ? <div className="acx-empty"><EmptyState icon="award" title={ar ? 'لم تُحسب النتائج بعد' : 'Not calculated yet'} /></div> : (
                <>
                  <div className="acx-panel__body">
                    <AcNums items={[
                      [ar ? 'المتوسط' : 'Average', `${s.average_pct}%`], [ar ? 'الأعلى' : 'Highest', `${s.highest_pct}%`], [ar ? 'الأقل' : 'Lowest', `${s.lowest_pct}%`],
                      [ar ? 'ناجح' : 'Passed', s.passed], [ar ? 'راسب' : 'Failed', s.failed], [ar ? 'محروم' : 'Deprived', s.deprived],
                      ...Object.entries(s.distribution).map(([k, v]) => [k, v]),
                    ]} />
                  </div>
                  <AcTable>
                    <thead><tr><th>{ar ? 'الطالب' : 'Student'}</th><th>{ar ? 'الرقم' : 'No.'}</th><th>{ar ? 'النقاط' : 'Points'}</th><th>%</th><th>{ar ? 'التقدير' : 'Grade'}</th><th>GPA</th><th /></tr></thead>
                    <tbody>
                      {sheet.rows.map((r) => (
                        <tr key={r.student_id}>
                          <td>{r.full_name || '—'}</td><td dir="ltr" style={{ textAlign: 'start' }}>{r.student_number || '—'}</td>
                          <td className="is-num">{r.points_earned} / {r.points_total}</td><td className="is-num">{r.percentage}</td>
                          <td><span className={pill(r.is_fail ? 'absent' : 'present')}>{r.letter}</span>{r.deprived && <span className="acx-sub">{ar ? 'محروم' : 'deprived'}</span>}{r.overridden && <span className="acx-sub" title={r.override_reason}>✎ {ar ? 'معدّل يدويًا' : 'overridden'}</span>}</td>
                          <td className="is-num">{r.grade_points?.toFixed(2)}</td>
                          <td className="is-end">{!locked && <button type="button" className="btn btn-outline btn-sm" onClick={() => setOvr(r)}>{ar ? 'تعديل' : 'Override'}</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </AcTable>
                </>
              )}
            </>
          )}
        </AcPanel>
      )}

      {scores && <ScoresDialog courseId={courseId} comp={scores} ar={ar} locale={locale} onClose={() => setScores(null)} onDone={(m) => { setScores(null); setNotice(m); }} />}
      {ovr && <OverrideDialog courseId={courseId} row={ovr} scale={sheet.scale} ar={ar} locale={locale} onClose={() => setOvr(null)} onDone={(m) => { setOvr(null); setNotice(m); load().catch(() => {}); }} />}
    </AcPage>
  );
}

function ScoresDialog({ courseId, comp, ar, locale, onClose, onDone }) {
  const [data, setData] = useState(null);
  const [vals, setVals] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.get(`${base(courseId)}/components/${comp.id}/scores`, { locale }).then((j) => { setData(j.data); setVals(Object.fromEntries(j.data.students.map((s) => [s.student_id, s.score ?? '']))); }).catch((e) => setError(errorMessage(e)));
  }, [courseId, comp.id, locale]);

  async function submit(e) {
    e.preventDefault(); setSaving(true); setError(null);
    try {
      const j = await api.put(`${base(courseId)}/components/${comp.id}/scores`, { locale, scores: Object.entries(vals).map(([student_id, score]) => ({ student_id: +student_id, score: score === '' ? null : score })) });
      onDone(j?.message || (ar ? 'تم حفظ الدرجات.' : 'Scores saved.'));
    } catch (err) { setError(errorMessage(err)); } finally { setSaving(false); }
  }

  return (
    <FormModal title={comp.title} subtitle={data ? `${ar ? 'الدرجة العظمى' : 'Max'} ${data.component.max_score}` : ''} icon="edit" onClose={onClose} onSubmit={submit} saving={saving} submitLabel={ar ? 'حفظ' : 'Save'} error={error}>
      <FormSection title={ar ? 'الطلاب' : 'Students'}>
        {!data ? <Skeleton h={40} count={3} /> : data.students.map((s) => (
          <Field key={s.student_id} label={`${s.full_name || ''} ${s.student_number ? `(${s.student_number})` : ''}`}>
            <input className="form-input" type="number" min="0" max={data.component.max_score} step="0.01" value={vals[s.student_id] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [s.student_id]: e.target.value }))} />
          </Field>
        ))}
      </FormSection>
    </FormModal>
  );
}

function OverrideDialog({ courseId, row, scale, ar, locale, onClose, onDone }) {
  const [letter, setLetter] = useState(row.letter);
  const [reason, setReason] = useState(row.override_reason || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const letters = [...scale.bands.map((b) => b.letter), scale.deprivation_letter];

  async function save(clear) {
    setSaving(true); setError(null);
    try { const j = await api.put(`${base(courseId)}/students/${row.student_id}`, clear ? { clear: true, locale } : { letter, reason, locale }); onDone(j?.message); } catch (e) { setError(errorMessage(e)); } finally { setSaving(false); }
  }

  return (
    <FormModal title={row.full_name || ''} subtitle={`${row.percentage}% — ${row.letter}`} icon="edit" onClose={onClose} onSubmit={(e) => { e.preventDefault(); save(false); }} saving={saving} submitLabel={ar ? 'حفظ التقدير' : 'Save grade'} error={error}>
      <FormSection title={ar ? 'تعديل التقدير يدويًا' : 'Manual override'} hint={ar ? 'التعديل بيتسجّل بالسبب في سجل المراجعة.' : 'The override and reason are audit-logged.'}>
        <Field label={ar ? 'التقدير' : 'Grade'}><select className="form-input" value={letter} onChange={(e) => setLetter(e.target.value)}>{letters.map((l) => <option key={l}>{l}</option>)}</select></Field>
        <Field label={ar ? 'السبب' : 'Reason'} wide><textarea className="form-input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {row.overridden && <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} disabled={saving} onClick={() => save(true)}>{ar ? 'إلغاء التعديل (رجوع للحساب)' : 'Remove override'}</button>}
      </FormSection>
    </FormModal>
  );
}
