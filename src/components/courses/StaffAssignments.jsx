import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { EmptyState, Skeleton } from '../student/stUi';
import { AcPage, AcHead, AcAlerts, AcKpis, AcPanel, AcNums, AcTable } from './acKit';
import { Field, FormModal, FormSection } from '../people/formUi';
import { downloadAuthed } from '../../lib/download';
import { fmtDate, fmtSize } from './StudentAssignments';

/**
 * التكليفات (الدكتور / المعيد / الكلية / الجامعة): إنشاء تكليف بموعد ودرجة ومرفق، متابعة التسليمات، التصحيح بالدرجة والتعليق،
 * وإرجاع التسليم للطالب لتعديله. الصلاحيات كلها في الـ API (مديرو المادة بس).
 * Backend: /api/v1/assignments/courses/{id}[/{aid}[/submissions[/{sid}/grade]]].
 */

const TONE = { late: 'warning', absent: 'danger', excused: '', present: 'success', neutral: 'neutral' };
const pill = (t) => `st-pill${TONE[t] ? ` st-pill--${TONE[t]}` : ''}`;
const toInput = (s) => (s ? String(s).slice(0, 16).replace(' ', 'T') : '');

export default function StaffAssignments() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [dialog, setDialog] = useState(null);      // { assignment? }
  const [subs, setSubs] = useState(null);          // assignment id whose submissions are open

  useEffect(() => {
    api.get('/api/v1/courses', { locale }).then((j) => {
      const list = (j.data || []).filter((c) => c.can_manage && c.status === 'active');
      setCourses(list);
      if (list[0]) setCourseId(String(list[0].id));
    }).catch((e) => setError(errorMessage(e))).finally(() => setLoading(false));
  }, [locale]);

  const load = useCallback(async () => {
    if (!courseId) return;
    const j = await api.get(`/api/v1/assignments/courses/${courseId}`, { locale });
    setRows(j.data || []);
  }, [courseId, locale]);

  useEffect(() => { setRows([]); setSubs(null); load().catch((e) => setError(errorMessage(e))); }, [load]);

  async function remove(a) {
    if (!window.confirm(ar ? 'حذف التكليف وكل التسليمات؟ لا يمكن التراجع.' : 'Delete this assignment and all submissions? This cannot be undone.')) return;
    try { const j = await api.del(`/api/v1/assignments/courses/${a.course_id}/${a.id}`, { locale }); setNotice(j.message); await load(); } catch (e) { setError(errorMessage(e)); }
  }

  const toGrade = rows.reduce((n, a) => n + (a.stats?.to_grade || 0), 0);

  return (
    <AcPage>
      <AcHead
        title={ar ? 'التكليفات والتسليمات' : 'Assignments'}
        text={ar ? 'أنشئ تكليفات بموعد ودرجة، وتابع تسليمات الطلاب وصحّحها.' : 'Create assignments with a deadline and score, then review and grade submissions.'}
      >
        <button type="button" className="btn btn-primary btn-sm" disabled={!courseId} onClick={() => { setNotice(null); setDialog({}); }}><Icon name="plus" size={14} /> {ar ? 'تكليف جديد' : 'New assignment'}</button>
      </AcHead>

      <AcAlerts error={error} notice={notice} />

      {loading ? <Skeleton h={100} count={2} /> : courses.length === 0 ? (
        <AcPanel><EmptyState icon="layers" title={ar ? 'لا توجد مواد تديرها' : 'No courses to manage'} /></AcPanel>
      ) : (
        <>
          <AcKpis items={[
            { label: ar ? 'التكليفات' : 'Assignments', value: rows.length, icon: 'file' },
            { label: ar ? 'في انتظار التصحيح' : 'To grade', value: toGrade, icon: 'edit', tone: toGrade ? 'bad' : 'good' },
          ]} />
          <AcPanel flush>
            <div className="acx-toolbar">
              <select className="acx-input" value={courseId} onChange={(e) => setCourseId(e.target.value)} aria-label={ar ? 'المادة' : 'Course'}>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            {rows.length === 0 ? <div className="acx-empty"><EmptyState icon="file" title={ar ? 'لا توجد تكليفات بعد' : 'No assignments yet'} /></div> : (
              <div>
                {rows.map((a) => (
                  <article key={a.id} className="acx-item">
                    <div className="acx-item__head">
                      <div style={{ minWidth: 0 }}>
                        <div className="acx-item__title">{a.title}</div>
                        <div className="acx-muted">{ar ? 'الموعد' : 'Due'}: {fmtDate(a.due_at)} · {ar ? 'الدرجة' : 'Max'} {a.max_score}{a.weight != null ? ` · ${a.weight}%` : ''}{a.allow_late ? '' : (ar ? ' · لا تسليم متأخر' : ' · no late')}</div>
                      </div>
                      <span className={pill(a.status === 'draft' ? 'neutral' : 'present')}>{a.status === 'draft' ? (ar ? 'مسودة' : 'Draft') : (ar ? 'منشور' : 'Published')}</span>
                    </div>
                    <AcNums inline items={[
                      [ar ? 'سلّموا' : 'Submitted', `${a.stats?.submitted}/${a.stats?.enrolled}`],
                      [ar ? 'اتصحّح' : 'Graded', a.stats?.graded],
                      [ar ? 'ينتظر التصحيح' : 'To grade', a.stats?.to_grade],
                    ]} />
                    <div className="acx-actions">
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => setSubs(subs === a.id ? null : a.id)}><Icon name="users" size={13} /> {ar ? 'التسليمات' : 'Submissions'}</button>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => { setNotice(null); setDialog({ assignment: a }); }}><Icon name="edit" size={13} /> {ar ? 'تعديل' : 'Edit'}</button>
                      {a.has_file && <button type="button" className="btn btn-outline btn-sm" onClick={() => downloadAuthed(`/api/v1/assignments/courses/${a.course_id}/${a.id}/file`, a.file_name).catch((e) => setError(errorMessage(e)))}><Icon name="download" size={13} /> {a.file_name}</button>}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(a)}><Icon name="trash" size={13} /> {ar ? 'حذف' : 'Delete'}</button>
                    </div>
                    {subs === a.id && <Submissions a={a} ar={ar} locale={locale} setError={setError} onChanged={load} />}
                  </article>
                ))}
              </div>
            )}
          </AcPanel>
        </>
      )}

      {dialog && <AssignmentDialog courseId={courseId} assignment={dialog.assignment} ar={ar} locale={locale} onClose={() => setDialog(null)} onDone={(m) => { setDialog(null); setNotice(m); load().catch(() => {}); }} />}
    </AcPage>
  );
}

/* ---------------------------------------------------------------------------- dialog */

function AssignmentDialog({ courseId, assignment, ar, locale, onClose, onDone }) {
  const editing = !!assignment;
  const [title, setTitle] = useState(assignment?.title || '');
  const [body, setBody] = useState(assignment?.body || '');
  const [due, setDue] = useState(toInput(assignment?.due_at));
  const [max, setMax] = useState(assignment?.max_score ?? 100);
  const [weight, setWeight] = useState(assignment?.weight ?? '');
  const [late, setLate] = useState(assignment ? assignment.allow_late : true);
  const [draft, setDraft] = useState(assignment?.status === 'draft');
  const [file, setFile] = useState(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const hasExisting = editing && assignment.has_file && !removeFile;

  async function submit(e) {
    e.preventDefault();
    if (saving) return;
    if (!title.trim()) { setError(ar ? 'اكتب عنوان التكليف.' : 'Enter a title.'); return; }
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('locale', locale);
      fd.append('title', title.trim());
      fd.append('body', body.trim());
      fd.append('due_at', due ? new Date(due).toISOString() : '');
      fd.append('max_score', String(max === '' ? 100 : max));
      fd.append('weight', weight === '' ? '' : String(weight));
      fd.append('allow_late', late ? '1' : '0');
      fd.append('status', draft ? 'draft' : 'published');
      if (file) fd.append('file', file); else if (removeFile) fd.append('remove_file', '1');
      const path = editing ? `/api/v1/assignments/courses/${assignment.course_id}/${assignment.id}` : `/api/v1/assignments/courses/${courseId}`;
      const j = await api.postForm(path, fd);
      onDone(j?.message);
    } catch (err) { setError(errorMessage(err)); } finally { setSaving(false); }
  }

  return (
    <FormModal title={editing ? (ar ? 'تعديل التكليف' : 'Edit assignment') : (ar ? 'تكليف جديد' : 'New assignment')} subtitle={ar ? 'سيتم إشعار الطلاب المسجّلين عند النشر.' : 'Enrolled students are notified when published.'} icon="file" onClose={onClose} onSubmit={submit} saving={saving} submitLabel={editing ? (ar ? 'حفظ' : 'Save') : (ar ? 'نشر' : 'Publish')} error={error}>
      <FormSection title={ar ? 'التكليف' : 'Assignment'}>
        <Field label={ar ? 'العنوان' : 'Title'} required wide><input className="form-input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label={ar ? 'التفاصيل / المطلوب' : 'Instructions'} wide><textarea className="form-input" rows={5} value={body} maxLength={20000} onChange={(e) => setBody(e.target.value)} /></Field>
        <Field label={ar ? 'مرفق (اختياري)' : 'Attachment (optional)'} wide>
          {hasExisting && !file && <div className="cm-current"><Icon name="paperclip" size={14} /> <bdi>{assignment.file_name}</bdi> <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoveFile(true)}><Icon name="trash" size={13} /> {ar ? 'إزالة' : 'Remove'}</button></div>}
          {removeFile && !file && <div className="cm-current"><span>{ar ? 'سيتم حذف المرفق.' : 'The attachment will be removed.'}</span> <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoveFile(false)}>{ar ? 'تراجع' : 'Undo'}</button></div>}
          <input className="form-input" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          {file && <small className="pf-hint">{file.name} · {fmtSize(file.size)}</small>}
        </Field>
      </FormSection>
      <FormSection title={ar ? 'الموعد والدرجة' : 'Deadline & score'}>
        <Field label={ar ? 'آخر موعد للتسليم' : 'Deadline'}><input className="form-input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label={ar ? 'الدرجة العظمى' : 'Max score'}><input className="form-input" type="number" min="0.01" step="0.01" value={max} onChange={(e) => setMax(e.target.value)} /></Field>
        <Field label={ar ? 'الوزن من درجة المادة (%)' : 'Weight in course grade (%)'}><input className="form-input" type="number" min="0" max="100" step="0.5" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
        <label className="cr-confirm"><input type="checkbox" checked={late} onChange={(e) => setLate(e.target.checked)} /> {ar ? 'السماح بالتسليم المتأخر (يتعلّم متأخر)' : 'Allow late submissions (flagged as late)'}</label>
        <label className="cr-confirm"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> {ar ? 'حفظ كمسودة (لا يظهر للطلاب)' : 'Save as draft (hidden from students)'}</label>
      </FormSection>
    </FormModal>
  );
}

/* ---------------------------------------------------------------------------- submissions */

function Submissions({ a, ar, locale, setError, onChanged }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null); // student row being graded
  const load = useCallback(() => api.get(`/api/v1/assignments/courses/${a.course_id}/${a.id}/submissions`, { locale }).then((j) => setData(j.data)).catch((e) => setError(errorMessage(e))), [a.course_id, a.id, locale, setError]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <Skeleton h={50} count={2} />;
  const S = { submitted: ar ? 'مسلّم' : 'Submitted', graded: ar ? 'مصحّح' : 'Graded', returned: ar ? 'مُرجَع' : 'Returned' };
  const cls = { submitted: 'excused', graded: 'present', returned: 'late' };
  return (
    <div className="acx-stack" style={{ paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
      <AcNums inline items={[
        [ar ? 'لم يسلّم' : 'Missing', data.stats.missing],
        [ar ? 'متأخر' : 'Late', data.stats.late],
        [ar ? 'مصحّح' : 'Graded', data.stats.graded],
      ]} />
      <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, overflow: 'hidden' }}>
        <AcTable>
          <thead><tr><th>{ar ? 'الطالب' : 'Student'}</th><th>{ar ? 'الرقم' : 'No.'}</th><th>{ar ? 'الحالة' : 'Status'}</th><th>{ar ? 'التسليم' : 'Submitted'}</th><th>{ar ? 'الدرجة' : 'Score'}</th><th /></tr></thead>
          <tbody>
            {data.students.map((r) => {
              const s = r.submission;
              return (
                <tr key={r.student_id}>
                  <td>{r.full_name || '—'}</td><td dir="ltr" style={{ textAlign: 'start' }}>{r.student_number || '—'}</td>
                  <td>
                    <div className="acx-pills">
                      {s ? <span className={pill(cls[s.status])}>{S[s.status]}</span> : <span className={pill('absent')}>{ar ? 'لم يسلّم' : 'Missing'}</span>}
                      {s?.is_late ? <span className={pill('late')}>{ar ? 'متأخر' : 'Late'}</span> : null}
                    </div>
                  </td>
                  <td dir="ltr" style={{ textAlign: 'start' }} className="is-num">{s ? fmtDate(s.submitted_at) : '—'}</td>
                  <td className="is-num">{s?.score != null ? `${s.score} / ${a.max_score}` : '—'}</td>
                  <td className="is-end">{s && <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(r)}>{s.status === 'graded' ? (ar ? 'مراجعة' : 'Review') : (ar ? 'تصحيح' : 'Grade')}</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </AcTable>
      </div>
      {open && <GradeDialog a={a} row={open} ar={ar} locale={locale} onClose={() => setOpen(null)} onDone={() => { setOpen(null); load(); onChanged(); }} />}
    </div>
  );
}

function GradeDialog({ a, row, ar, locale, onClose, onDone }) {
  const s = row.submission;
  const [score, setScore] = useState(s.score ?? '');
  const [feedback, setFeedback] = useState(s.feedback || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save(ret) {
    setSaving(true);
    setError(null);
    try {
      await api.put(`/api/v1/assignments/courses/${a.course_id}/${a.id}/submissions/${row.student_id}/grade`, ret ? { return: true, feedback, locale } : { score, feedback, locale });
      onDone();
    } catch (e) { setError(errorMessage(e)); } finally { setSaving(false); }
  }

  return (
    <FormModal title={row.full_name || (ar ? 'تسليم' : 'Submission')} subtitle={a.title} icon="edit" onClose={onClose} onSubmit={(e) => { e.preventDefault(); save(false); }} saving={saving} submitLabel={ar ? 'حفظ الدرجة' : 'Save grade'} error={error}>
      <FormSection title={ar ? 'إجابة الطالب' : 'Student answer'} hint={`${fmtDate(s.submitted_at)}${s.is_late ? (ar ? ' — متأخر' : ' — late') : ''}${s.attempts > 1 ? (ar ? ` — المحاولة ${s.attempts}` : ` — attempt ${s.attempts}`) : ''}`}>
        {s.body ? <div className="as-sub">{s.body}</div> : <small className="is-muted">{ar ? 'لا يوجد نص.' : 'No text.'}</small>}
        {s.has_file && <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => downloadAuthed(`/api/v1/assignments/courses/${a.course_id}/${a.id}/submissions/${row.student_id}/file`, s.file_name).catch((e) => setError(errorMessage(e)))}><Icon name="download" size={13} /> {s.file_name} · {fmtSize(s.file_size)}</button>}
      </FormSection>
      <FormSection title={ar ? 'التقييم' : 'Evaluation'}>
        <Field label={`${ar ? 'الدرجة' : 'Score'} (0 – ${a.max_score})`}><input className="form-input" type="number" min="0" max={a.max_score} step="0.01" value={score} onChange={(e) => setScore(e.target.value)} /></Field>
        <Field label={ar ? 'تعليق للطالب' : 'Feedback'} wide><textarea className="form-input" rows={4} maxLength={5000} value={feedback} onChange={(e) => setFeedback(e.target.value)} /></Field>
        <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} disabled={saving} onClick={() => save(true)}><Icon name="refresh" size={13} /> {ar ? 'إرجاع للطالب لتعديله' : 'Return for changes'}</button>
      </FormSection>
    </FormModal>
  );
}
