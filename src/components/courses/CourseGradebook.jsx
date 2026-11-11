import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import ExportMenu from '../ExportMenu';
import { exportTable } from '../../lib/exporter';

/**
 * دفتر درجات المقرر.
 *  <CourseGradebook courseId />      — للمدرس/الكلية/الجامعة: تحديد الامتحانات وأوزانها + جدول درجات الطلاب (+ تصدير CSV).
 *  <StudentCourseGrade courseId />   — للطالب: درجته هو بس.
 * GET/PUT /api/v1/courses/{id}/gradebook(/items), GET /api/v1/courses/{id}/my-grade — الحسابات في الباك (CourseGradebookService).
 */
const S = {
  en: {
    loading: 'Loading…', settings: 'Exams counted in the course grade', noItems: 'No exam is counted yet. Add exams linked to this course and give each a weight.',
    exam: 'Exam', weight: 'Weight %', policy: 'If several attempts', highest: 'Highest', latest: 'Latest', first: 'First', remove: 'Remove',
    add: 'Add exam…', total: 'Total weight', over: 'Total weight cannot exceed 100%.', under: 'Weights add up to less than 100% — the rest is not graded yet.',
    save: 'Save', saving: 'Saving…', saved: 'Saved.', link: 'Only exams linked to this course (chosen when creating the exam) can be added.',
    student: 'Student', id: 'ID', courseTotal: 'Course total', soFar: 'So far', noStudents: 'No students are enrolled in this course.',
    graded: '', pending: 'Grading…', missing: 'Absent (0)', upcoming: 'Upcoming', hidden: 'Not published yet',
    export: 'Export CSV', summary: (s) => `${s.students} students · average so far ${s.average_so_far ?? '—'}%`,
    soFarNote: '"So far" only counts exams that are graded (or missed after closing). "Course total" is out of the total weight.',
    myTitle: 'My grade in this course', total2: 'Total', outOf: 'out of', partial: 'Some results are not published or graded yet.', noneYet: 'No graded exams in this course yet.',
  },
  ar: {
    loading: 'جاري التحميل…', settings: 'الامتحانات المحسوبة في درجة المقرر', noItems: 'لا يوجد امتحان محسوب بعد. أضف امتحانات مربوطة بالمقرر وحدد وزن كل واحد.',
    exam: 'الامتحان', weight: 'الوزن %', policy: 'لو أكتر من محاولة', highest: 'الأعلى', latest: 'الأخيرة', first: 'الأولى', remove: 'إزالة',
    add: 'إضافة امتحان…', total: 'إجمالي الأوزان', over: 'إجمالي الأوزان لا يمكن أن يزيد عن 100%.', under: 'مجموع الأوزان أقل من 100% — الباقي لسه مش محسوب.',
    save: 'حفظ', saving: 'جاري الحفظ…', saved: 'تم الحفظ.', link: 'تقدر تضيف بس الامتحانات المربوطة بالمقرر ده (بتتحدد وقت إنشاء الامتحان).',
    student: 'الطالب', id: 'الرقم', courseTotal: 'درجة المقرر', soFar: 'حتى الآن', noStudents: 'لا يوجد طلاب مسجّلون في المقرر.',
    graded: '', pending: 'قيد التصحيح', missing: 'غائب (0)', upcoming: 'لم يبدأ', hidden: 'لم تُنشر بعد',
    export: 'تصدير CSV', summary: (s) => `${s.students} طالب · المتوسط حتى الآن ${s.average_so_far ?? '—'}%`,
    soFarNote: '"حتى الآن" بتحسب الامتحانات المصححة (أو اللي غاب عنها الطالب بعد قفلها) بس. "درجة المقرر" من إجمالي الأوزان.',
    myTitle: 'درجتي في المقرر', total2: 'الإجمالي', outOf: 'من', partial: 'فيه نتايج لسه مش منشورة أو مش مصححة.', noneYet: 'لا توجد امتحانات مصححة في هذا المقرر بعد.',
  },
};


function cellText(c, t) {
  if (!c) return '—';
  if (c.status === 'graded') return `${c.percentage}%`;
  return t[c.status] || '—';
}

export function CourseGradebook({ courseId }) {
  const { locale } = useLanguage();
  const t = locale === 'ar' ? S.ar : S.en;
  const [data, setData] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((d) => {
    setData(d);
    setItems(d.items.map((i) => ({ exam_id: i.exam_id, title: i.title, weight: i.weight, attempt_policy: i.attempt_policy })));
  }, []);

  useEffect(() => {
    api.get(`/api/v1/courses/${courseId}/gradebook`).then((j) => apply(j.data)).catch((e) => setError(errorMessage(e)));
  }, [courseId, apply]);

  const totalWeight = useMemo(() => items.reduce((a, i) => a + (Number(i.weight) || 0), 0), [items]);
  const dirty = data && JSON.stringify(items.map((i) => [i.exam_id, Number(i.weight), i.attempt_policy])) !== JSON.stringify(data.items.map((i) => [i.exam_id, i.weight, i.attempt_policy]));

  function setItem(idx, patch) { setItems((list) => list.map((x, k) => (k === idx ? { ...x, ...patch } : x))); setMsg(null); }

  function addExam(id) {
    const ex = data.available_exams.find((e) => String(e.id) === String(id));
    if (!ex) return;
    setItems((list) => [...list, { exam_id: ex.id, title: ex.title, weight: Math.max(0, Math.min(100 - totalWeight, 100)) || 10, attempt_policy: 'highest' }]);
    setData((d) => ({ ...d, available_exams: d.available_exams.filter((e) => e.id !== ex.id) }));
    setMsg(null);
  }

  function removeItem(idx) {
    const it = items[idx];
    setItems((list) => list.filter((_, k) => k !== idx));
    setData((d) => ({ ...d, available_exams: [{ id: it.exam_id, title: it.title }, ...d.available_exams] }));
    setMsg(null);
  }

  async function save() {
    setBusy(true); setError(null); setMsg(null);
    try {
      const j = await api.put(`/api/v1/courses/${courseId}/gradebook/items`, {
        items: items.map((i) => ({ exam_id: i.exam_id, weight: Number(i.weight), attempt_policy: i.attempt_policy })),
      });
      apply(j.data);
      setMsg(t.saved);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  function exportGrades(format) {
    const headers = [t.student, t.id, ...data.items.map((i) => `${i.title} (${i.weight}%)`), t.courseTotal, t.soFar];
    const rows = data.rows.map((r) => [r.full_name, r.student_number || '', ...data.items.map((i) => {
      const c = r.cells[i.exam_id];
      return c && c.status === 'graded' ? c.percentage : (c ? c.status : '');
    }), r.total, r.so_far_pct ?? '']);
    return exportTable({ headers, rows, format, filename: `course-${courseId}-grades`, title: `${locale === 'ar' ? 'درجات المقرر' : 'Course grades'} #${courseId}`, rtl: locale === 'ar' });
  }

  if (error && !data) return <p className="form-error">{error}</p>;
  if (!data) return <p className="text-small">{t.loading}</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && <p className="form-error" style={{ margin: 0 }}>{error}</p>}
      {msg && <p className="text-small" style={{ margin: 0, color: 'var(--color-success)' }}>{msg}</p>}

      <section>
        <h3 style={{ margin: '0 0 8px' }}>{t.settings}</h3>
        {items.length === 0 ? <p className="text-small">{t.noItems}</p> : (
          <div className="ex-table-wrap">
            <table className="ex-table">
              <thead><tr><th>{t.exam}</th><th>{t.weight}</th><th>{t.policy}</th><th /></tr></thead>
              <tbody>
                {items.map((i, idx) => (
                  <tr key={i.exam_id}>
                    <td>{i.title}</td>
                    <td><input type="number" min="0.01" max="100" step="0.5" className="form-input" style={{ width: 90 }} value={i.weight} onChange={(e) => setItem(idx, { weight: e.target.value })} /></td>
                    <td>
                      <select className="form-input" value={i.attempt_policy} onChange={(e) => setItem(idx, { attempt_policy: e.target.value })}>
                        {['highest', 'latest', 'first'].map((p) => <option key={p} value={p}>{t[p]}</option>)}
                      </select>
                    </td>
                    <td className="is-end"><button type="button" className="btn btn-ghost btn-sm" onClick={() => removeItem(idx)}>{t.remove}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
          <select className="form-input" style={{ maxWidth: 260 }} value="" onChange={(e) => e.target.value && addExam(e.target.value)} disabled={data.available_exams.length === 0}>
            <option value="">{t.add}</option>
            {data.available_exams.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
          <strong className="text-small" style={{ color: totalWeight > 100 ? 'var(--color-danger)' : undefined }}>{t.total}: {Math.round(totalWeight * 100) / 100}%</strong>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !dirty || totalWeight > 100 || items.some((i) => !(Number(i.weight) > 0))} onClick={save}>{busy ? t.saving : t.save}</button>
        </div>
        {totalWeight > 100 && <p className="form-error" style={{ margin: '6px 0 0' }}>{t.over}</p>}
        {totalWeight <= 100 && items.length > 0 && totalWeight < 100 && <p className="text-small" style={{ margin: '6px 0 0' }}>{t.under}</p>}
        <p className="text-caption" style={{ margin: '6px 0 0' }}>{t.link}</p>
      </section>

      {data.items.length > 0 && (
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <p className="text-small" style={{ margin: 0 }}><strong>{t.summary(data.summary)}</strong></p>
            <ExportMenu className="btn btn-outline btn-sm" iconSize={14} disabled={data.rows.length === 0} onExport={exportGrades} />
          </div>
          {data.rows.length === 0 ? <p className="text-small">{t.noStudents}</p> : (
            <div className="ex-table-wrap">
              <table className="ex-table">
                <thead>
                  <tr>
                    <th>{t.student}</th>
                    {data.items.map((i) => <th key={i.exam_id}>{i.title}<small style={{ display: 'block' }}>{i.weight}%</small></th>)}
                    <th>{t.courseTotal}<small style={{ display: 'block' }}>/ {data.total_weight}</small></th>
                    <th>{t.soFar}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.student_id}>
                      <td><strong>{r.full_name}</strong><small style={{ display: 'block' }}>{r.student_number || ''}</small></td>
                      {data.items.map((i) => <td key={i.exam_id} className={r.cells[i.exam_id]?.status === 'graded' ? '' : 'is-muted'}>{cellText(r.cells[i.exam_id], t)}</td>)}
                      <td><strong>{r.total}</strong></td>
                      <td>{r.so_far_pct == null ? '—' : `${r.so_far_pct}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-caption" style={{ margin: '6px 0 0' }}>{t.soFarNote}</p>
        </section>
      )}
    </div>
  );
}

export function StudentCourseGrade({ courseId }) {
  const { locale } = useLanguage();
  const t = locale === 'ar' ? S.ar : S.en;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/api/v1/courses/${courseId}/my-grade`).then((j) => setData(j.data)).catch((e) => setError(errorMessage(e)));
  }, [courseId]);

  if (error) return <p className="form-error" style={{ margin: 0 }}>{error}</p>;
  if (!data) return <p className="text-small" style={{ margin: 0 }}>{t.loading}</p>;
  if (data.items.length === 0 || data.graded_weight === 0) return <p className="text-small" style={{ margin: 0 }}>{t.noneYet}</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'start' }}>
      <strong>{t.myTitle}</strong>
      <table className="ex-table">
        <tbody>
          {data.items.map((i) => {
            const c = data.cells[i.exam_id];
            return (
              <tr key={i.exam_id}>
                <td>{i.title}<small style={{ display: 'block' }}>{i.weight}%</small></td>
                <td className="is-end">{c && c.status === 'graded' ? `${c.percentage}% → ${c.points}` : cellText(c, t)}</td>
              </tr>
            );
          })}
          <tr>
            <td><strong>{t.total2}</strong></td>
            <td className="is-end"><strong>{data.total}</strong> {t.outOf} {data.total_weight}</td>
          </tr>
        </tbody>
      </table>
      {!data.complete && <p className="text-caption" style={{ margin: 0 }}>{t.partial}</p>}
    </div>
  );
}
