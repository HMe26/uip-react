import { useState } from 'react';
import { api, errorMessage } from '../../api/client';

/**
 * نسخ امتحان (أو استخدام قالب). POST /api/v1/exam-system/exams/{id}/duplicate
 * النسخة بتتعمل draft: بتاخد الإعدادات والأسئلة والـ pools، والمواعيد بتتحدد هنا (اختياري)،
 * والطلاب المستهدفين بيتنسخوا بس لو المدرس اختار كده.
 */
const S = {
  en: {
    titleExam: 'Duplicate exam', titleTemplate: 'Create exam from template',
    intro: 'A new draft copy is created with the same settings, questions and question pools. Attempts, results and appeals are never copied.',
    name: 'New exam title', start: 'Start (optional)', end: 'End (optional)', year: 'Academic year', semester: 'Semester',
    targets: 'Also copy the target students/groups', targetsHint: 'Leave off if the new term has a different cohort.',
    cancel: 'Cancel', create: 'Create copy', creating: 'Creating…', badRange: 'End must be after start.',
  },
  ar: {
    titleExam: 'نسخ الامتحان', titleTemplate: 'إنشاء امتحان من قالب',
    intro: 'هيتعمل امتحان جديد (مسودة) بنفس الإعدادات والأسئلة وإعدادات بنوك الأسئلة. المحاولات والنتائج والتظلمات مبتتنسخش.',
    name: 'عنوان الامتحان الجديد', start: 'البداية (اختياري)', end: 'النهاية (اختياري)', year: 'السنة الدراسية', semester: 'الفصل',
    targets: 'انسخ الطلاب/المجموعات المستهدفة كمان', targetsHint: 'سيبها مقفولة لو دفعة الترم الجديد مختلفة.',
    cancel: 'إلغاء', create: 'إنشاء نسخة', creating: 'جاري الإنشاء…', badRange: 'النهاية لازم تبقى بعد البداية.',
  },
};

const iso = (v) => (v ? new Date(v).toISOString() : undefined);

export default function ExamDuplicateModal({ exam, ar, onClose, onDone }) {
  const t = ar ? S.ar : S.en;
  const [title, setTitle] = useState(`${ar ? 'نسخة من ' : 'Copy of '}${exam.title}`.slice(0, 200));
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [year, setYear] = useState(exam.academic_year || '');
  const [semester, setSemester] = useState(exam.semester || '');
  const [copyTargets, setCopyTargets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (startAt && endAt && new Date(endAt) < new Date(startAt)) { setError(t.badRange); return; }
    setBusy(true);
    setError(null);
    try {
      const json = await api.post(`/api/v1/exam-system/exams/${exam.id}/duplicate`, {
        title: title.trim() || undefined,
        start_at: iso(startAt),
        end_at: iso(endAt),
        academic_year: year || undefined,
        semester: semester || undefined,
        copy_targets: copyTargets,
      });
      onDone(json.data);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="ex-modal-scrim" role="dialog" aria-modal="true" onClick={busy ? undefined : onClose}>
      <form className="ex-modal" style={{ maxWidth: 560, alignItems: 'stretch', textAlign: 'start' }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 style={{ margin: 0 }}>{exam.is_template ? t.titleTemplate : t.titleExam}</h2>
        <p className="text-small" style={{ margin: 0 }}>{t.intro}</p>
        {error && <p className="form-error" style={{ margin: 0 }}>{error}</p>}
        <div className="ex-field">
          <label className="ex-label" htmlFor="dup-title">{t.name}</label>
          <input id="dup-title" className="form-input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="ex-field">
            <label className="ex-label" htmlFor="dup-start">{t.start}</label>
            <input id="dup-start" type="datetime-local" className="form-input" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </div>
          <div className="ex-field">
            <label className="ex-label" htmlFor="dup-end">{t.end}</label>
            <input id="dup-end" type="datetime-local" className="form-input" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
          </div>
          <div className="ex-field">
            <label className="ex-label" htmlFor="dup-year">{t.year}</label>
            <input id="dup-year" className="form-input" value={year} maxLength={20} onChange={(e) => setYear(e.target.value)} />
          </div>
          <div className="ex-field">
            <label className="ex-label" htmlFor="dup-sem">{t.semester}</label>
            <input id="dup-sem" className="form-input" value={semester} maxLength={20} onChange={(e) => setSemester(e.target.value)} />
          </div>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input type="checkbox" className="ex-check-input" checked={copyTargets} onChange={(e) => setCopyTargets(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            <strong style={{ fontSize: 13 }}>{t.targets}</strong>
            <span className="text-small" style={{ display: 'block' }}>{t.targetsHint}</span>
          </span>
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>{t.cancel}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t.creating : t.create}</button>
        </div>
      </form>
    </div>
  );
}
