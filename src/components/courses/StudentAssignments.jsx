import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { EmptyState, Skeleton } from '../student/stUi';
import { AcPage, AcHead, AcAlerts, AcKpis, AcPanel, AcNums, AcTable } from './acKit';
import { Field, FormModal, FormSection } from '../people/formUi';
import { downloadAuthed } from '../../lib/download';

/**
 * تكليفاتي (الطالب): كل تكليفات مواده، التسليم (نص و/أو ملف)، إعادة التسليم قبل التصحيح، والدرجة والتعليق.
 * Backend: GET /api/v1/assignments/my · POST /api/v1/assignments/courses/{id}/{aid}/submit.
 */

export const STATE = {
  open: { ar: 'مطلوب', en: 'To do', cls: 'late' },
  late_open: { ar: 'متأخر — لسه مفتوح', en: 'Overdue — still open', cls: 'absent' },
  missed: { ar: 'فاتك الموعد', en: 'Missed', cls: 'absent' },
  submitted: { ar: 'تم التسليم', en: 'Submitted', cls: 'excused' },
  returned: { ar: 'مطلوب تعديل', en: 'Needs changes', cls: 'late' },
  graded: { ar: 'تم التصحيح', en: 'Graded', cls: 'present' },
};

export const fmtDate = (s) => (s ? String(s).slice(0, 16).replace('T', ' ') : '—');
export const fmtSize = (b) => (b == null ? '' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function dueText(a, ar) {
  if (!a.due_at) return ar ? 'بدون موعد' : 'No deadline';
  const ms = new Date(String(a.due_at).replace(' ', 'T')).getTime() - Date.now();
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const span = d ? (ar ? `${d} يوم` : `${d}d`) : (ar ? `${h} ساعة` : `${h}h`);
  return ms >= 0 ? (ar ? `باقي ${span}` : `${span} left`) : (ar ? `متأخر ${span}` : `${span} overdue`);
}

export default function StudentAssignments() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [tab, setTab] = useState('todo');
  const [dialog, setDialog] = useState(null);

  const load = useCallback(() => api.get('/api/v1/assignments/my', { locale }).then((j) => setRows(j.data || [])), [locale]);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))).finally(() => setLoading(false)); }, [load]);

  const groups = useMemo(() => ({
    todo: rows.filter((a) => ['open', 'late_open', 'returned'].includes(a.state)),
    done: rows.filter((a) => ['submitted', 'graded'].includes(a.state)),
    missed: rows.filter((a) => a.state === 'missed'),
  }), [rows]);
  const shown = groups[tab] || [];
  const graded = rows.filter((a) => a.state === 'graded');

  const TONE = { late: 'warning', absent: 'danger', excused: '', present: 'success' };

  return (
    <AcPage>
      <AcHead
        title={ar ? 'التكليفات' : 'Assignments'}
        text={ar ? 'تكليفات موادك: سلّم قبل الموعد وتابع درجاتك وتعليقات الدكتور.' : 'Your course assignments: submit before the deadline and track grades and feedback.'}
      />
      <AcAlerts error={error} notice={notice} />

      <AcKpis items={[
        { label: ar ? 'مطلوب منك' : 'To do', value: groups.todo.length, icon: 'clock', tone: groups.todo.length ? 'bad' : 'good' },
        { label: ar ? 'تم تسليمها' : 'Submitted', value: groups.done.length, icon: 'check-circle', tone: 'good' },
        { label: ar ? 'فاتها الموعد' : 'Missed', value: groups.missed.length, icon: 'alert-triangle', tone: groups.missed.length ? 'bad' : '' },
        { label: ar ? 'تم تصحيحها' : 'Graded', value: graded.length, icon: 'award' },
      ]} />

      <section className="acx-panel">
        <div className="acx-tabs" role="tablist">
          {[['todo', ar ? 'المطلوبة' : 'To do'], ['done', ar ? 'المسلّمة' : 'Submitted'], ['missed', ar ? 'الفائتة' : 'Missed']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>{l}<small>{groups[k].length}</small></button>
          ))}
        </div>
        {loading ? <div className="acx-panel__body"><Skeleton h={80} count={3} /></div> : shown.length === 0 ? (
          <div className="acx-empty"><EmptyState icon="check-circle" title={ar ? 'لا توجد تكليفات هنا' : 'Nothing here'} /></div>
        ) : (
          <div>
            {shown.map((a) => {
              const st = STATE[a.state] || STATE.open;
              const canSubmit = a.state !== 'graded' && a.state !== 'missed';
              return (
                <article key={a.id} className="acx-item">
                  <div className="acx-item__head">
                    <div style={{ minWidth: 0 }}>
                      <span className="acx-code" dir="ltr">{a.course?.code}</span>
                      <div className="acx-item__title">{a.title}</div>
                      <div className="acx-muted">{a.course?.name}</div>
                    </div>
                    <span className={`st-pill${TONE[st.cls] ? ` st-pill--${TONE[st.cls]}` : ''}`}>{ar ? st.ar : st.en}</span>
                  </div>
                  {a.body && <p className="acx-item__body">{a.body}</p>}
                  <AcNums inline items={[
                    [ar ? 'الموعد' : 'Due', `${fmtDate(a.due_at)} · ${dueText(a, ar)}`],
                    [ar ? 'الدرجة العظمى' : 'Max', a.max_score],
                    ...(a.weight != null ? [[ar ? 'الوزن' : 'Weight', `${a.weight}%`]] : []),
                  ]} />
                  {a.submission?.status === 'graded' && (
                    <div className="st-alert st-alert--success"><Icon name="award" size={15} /><span><b>{a.submission.score} / {a.max_score}</b>{a.submission.feedback ? ` — ${a.submission.feedback}` : ''}</span></div>
                  )}
                  {a.submission?.status === 'returned' && (
                    <div className="st-alert st-alert--warning"><Icon name="alert-triangle" size={15} /><span>{ar ? 'الدكتور طلب تعديل: ' : 'Changes requested: '}{a.submission.feedback || ''}</span></div>
                  )}
                  {a.submission && <div className="acx-muted">{ar ? 'آخر تسليم' : 'Last submitted'}: {fmtDate(a.submission.submitted_at)}{a.submission.is_late ? (ar ? ' (متأخر)' : ' (late)') : ''}{a.submission.file_name ? ` · ${a.submission.file_name}` : ''}</div>}
                  {(a.has_file || a.submission?.has_file || canSubmit) && (
                    <div className="acx-actions">
                      {canSubmit && <button type="button" className="btn btn-primary btn-sm" onClick={() => { setNotice(null); setDialog(a); }}><Icon name="upload" size={13} /> {a.submission ? (ar ? 'إعادة التسليم' : 'Resubmit') : (ar ? 'تسليم' : 'Submit')}</button>}
                      {a.has_file && <button type="button" className="btn btn-outline btn-sm" onClick={() => downloadAuthed(`/api/v1/assignments/courses/${a.course_id}/${a.id}/file`, a.file_name).catch((e) => setError(errorMessage(e)))}><Icon name="download" size={13} /> {ar ? 'مرفق التكليف' : 'Attachment'}</button>}
                      {a.submission?.has_file && <button type="button" className="btn btn-outline btn-sm" onClick={() => downloadAuthed(`/api/v1/assignments/courses/${a.course_id}/${a.id}/submissions/${a.submission.student_id}/file`, a.submission.file_name).catch((e) => setError(errorMessage(e)))}><Icon name="paperclip" size={13} /> {ar ? 'ملف تسليمي' : 'My file'}</button>}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {dialog && <SubmitDialog a={dialog} ar={ar} locale={locale} onClose={() => setDialog(null)} onDone={(m) => { setDialog(null); setNotice(m); load().catch(() => {}); }} />}
    </AcPage>
  );
}

function SubmitDialog({ a, ar, locale, onClose, onDone }) {
  const [body, setBody] = useState(a.submission?.body || '');
  const [file, setFile] = useState(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const hasExisting = a.submission?.has_file && !removeFile;

  async function submit(e) {
    e.preventDefault();
    if (saving) return;
    if (!body.trim() && !file && !hasExisting) { setError(ar ? 'اكتب إجابتك أو ارفع ملفًا.' : 'Write your answer or upload a file.'); return; }
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('locale', locale);
      fd.append('body', body.trim());
      if (file) fd.append('file', file);
      else if (removeFile) fd.append('remove_file', '1');
      const j = await api.postForm(`/api/v1/assignments/courses/${a.course_id}/${a.id}/submit`, fd);
      onDone(j?.message);
    } catch (err) { setError(errorMessage(err)); } finally { setSaving(false); }
  }

  return (
    <FormModal title={ar ? 'تسليم التكليف' : 'Submit assignment'} subtitle={a.title} icon="upload" onClose={onClose} onSubmit={submit} saving={saving} submitLabel={ar ? 'تسليم' : 'Submit'} error={error}>
      <FormSection title={ar ? 'إجابتك' : 'Your answer'} hint={a.is_past_due ? (ar ? 'الموعد فات — هيتسجّل التسليم كمتأخر.' : 'Deadline passed — this will be marked late.') : undefined}>
        <Field label={ar ? 'نص الإجابة (اختياري لو هترفع ملف)' : 'Answer text (optional if you upload a file)'} wide>
          <textarea className="form-input" rows={6} value={body} maxLength={20000} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <Field label={ar ? 'ملف' : 'File'} wide hint={ar ? 'pdf, docx, pptx, zip, صور، وملفات كود (py, java, cpp, js, ipynb…) — حتى 20 ميجا' : 'pdf, docx, pptx, zip, images and code files (py, java, cpp, js, ipynb…) — up to 20 MB'}>
          {hasExisting && !file && (
            <div className="cm-current"><Icon name="paperclip" size={14} /> <bdi>{a.submission.file_name}</bdi>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoveFile(true)}><Icon name="trash" size={13} /> {ar ? 'إزالة' : 'Remove'}</button></div>
          )}
          {removeFile && !file && <div className="cm-current"><span>{ar ? 'سيتم حذف الملف الحالي.' : 'The current file will be removed.'}</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoveFile(false)}>{ar ? 'تراجع' : 'Undo'}</button></div>}
          <input className="form-input" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          {file && <small className="pf-hint">{file.name} · {fmtSize(file.size)}</small>}
        </Field>
      </FormSection>
    </FormModal>
  );
}
