import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BackLink } from '../../lib/backStack';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useLanguage } from '../../context/LanguageContext';
import { StaffHead, PersonAvatar } from '../../components/staff/stfUi';
import { StModal, Skeleton } from '../../components/student/stUi';
import ExamQuestionCard from '../../components/exam/ExamQuestionCard';
import { TotalPointsEditor } from '../../components/exam/MarksEditors';
import { ExamPoolModal } from './AcademicStaffExamBuilder';
import { QuestionModal } from './AcademicStaffQuestionBankDetail';
import { QUESTION_IMAGE_ACCEPT, validateQuestionImage, uploadQuestionImage } from '../../components/exam/QuestionImagePicker';
import {
  EXAM_TYPES, Segmented, ToggleRow, Note, combineDateTime, dateInput, fmtDate, fmtNum, fmtTime,
  questionTypeLabel, timeInput, examTypeLabel,
} from '../../components/exam/examUi';

/**
 * Create / edit exam wizard (design: Basic Information → Questions → Exam Settings →
 * Assign Students → Review & Publish). Routes: /academic-staff/exams/create and
 * /academic-staff/exams/:id/edit?step=N.
 *
 * Persistence is incremental, so a draft is never lost: step 1 creates the exam
 * (POST exams), questions/pools are attached immediately (their own endpoints),
 * step 3 saves the settings (PATCH exams/{id}), step 4 saves the audience
 * (PUT exams/{id}/targets — rows that target a faculty/department/group are kept,
 * only the individual-student rows are replaced by the selection) and step 5
 * publishes (POST exams/{id}/publish).
 */

const STEPS = [
  { en: 'Basic Information', ar: 'المعلومات الأساسية' },
  { en: 'Questions', ar: 'الأسئلة' },
  { en: 'Exam Settings', ar: 'إعدادات الامتحان' },
  { en: 'Assign Students', ar: 'تعيين الطلاب' },
  { en: 'Review & Publish', ar: 'المراجعة والنشر' },
];

const RELEASE = [
  { key: 'after_close', en: 'After exam closes', ar: 'بعد إغلاق الامتحان' },
  { key: 'manual', en: 'When I publish', ar: 'عندما أنشرها أنا' },
];

const emptyForm = () => ({
  title: '', subject: '', course_id: '', exam_type: 'midterm', description: '', date: '', time: '09:00', duration: 60, instructions: '',
  max_attempts: 1, passing_score: '', end_date: '', end_time: '',
  auto_submit: true, allow_back: false, shuffle_q: true, shuffle_a: true,
  show_result: true, release: 'after_close', show_review: false, score_only: false,
  secure: true, max_violations: 3,
  late_grace: 0, late_penalty: 0,
  single_session: true, proctoring: 'off', identity_check: false, snapshot_interval: 60,
  use_password: false, access_password: '',
});

const formFromExam = (e) => ({
  title: e.title || '', subject: e.subject || '', course_id: e.course_id ? String(e.course_id) : '', exam_type: e.exam_type || 'midterm', description: e.description || '',
  date: dateInput(e.start_at), time: timeInput(e.start_at) || '09:00', duration: e.duration_minutes || 60, instructions: e.instructions || '',
  max_attempts: e.max_attempts || 1, passing_score: e.passing_score ?? '', end_date: dateInput(e.end_at), end_time: timeInput(e.end_at),
  auto_submit: !!e.auto_submit_on_timeout, allow_back: !!e.allow_back_navigation, shuffle_q: !!e.randomize_questions, shuffle_a: !!e.randomize_options,
  show_result: e.result_visibility === 'immediate', release: e.result_visibility === 'manual' ? 'manual' : 'after_close',
  show_review: !!e.show_answer_review, score_only: !!e.show_score_only,
  secure: e.secure_mode_enabled !== false, max_violations: e.max_violations ?? 3,
  late_grace: e.late_grace_minutes ?? 0, late_penalty: e.late_penalty_percent != null ? Number(e.late_penalty_percent) : 0,
  single_session: e.single_session_enabled !== false,
  proctoring: e.identity_check_required ? 'required' : (e.proctoring_mode || 'off'),
  identity_check: !!e.identity_check_required,
  snapshot_interval: e.snapshot_interval_seconds ?? 60,
  use_password: !!e.has_access_password, access_password: '',
});

const toRow = (r) => (r.student_id
  ? { student_id: Number(r.student_id) }
  : {
    faculty_id: r.faculty_id ? Number(r.faculty_id) : null,
    department_id: r.department_id ? Number(r.department_id) : null,
    academic_year: r.academic_year ? Number(r.academic_year) : null,
    group_id: r.group_id ? Number(r.group_id) : null,
  });

/* ---- Question picker modal -------------------------------------------------------------- */
function QuestionPicker({ examId, banks, attachedIds, ar, onClose, onAdded }) {
  const [bankId, setBankId] = useState('');
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState(new Set());
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!bankId) { setQuestions([]); return; }
    setLoading(true);
    api.get(`/api/v1/exam-system/question-banks/${bankId}`)
      .then((j) => setQuestions(j.data?.questions || []))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [bankId]);

  const needle = search.trim().toLowerCase();
  const visible = needle ? questions.filter((q) => String(q.prompt || '').toLowerCase().includes(needle)) : questions;
  const selectable = visible.filter((q) => !attachedIds.has(q.id));
  const allVisiblePicked = selectable.length > 0 && selectable.every((q) => picked.has(q.id));
  const toggleAllVisible = () => setPicked((s) => {
    const n = new Set(s);
    if (allVisiblePicked) selectable.forEach((q) => n.delete(q.id)); else selectable.forEach((q) => n.add(q.id));
    return n;
  });
  const DIFF = { easy: ar ? 'سهل' : 'Easy', medium: ar ? 'متوسط' : 'Medium', hard: ar ? 'صعب' : 'Hard' };

  const toggle = (qid) => setPicked((s) => { const n = new Set(s); if (n.has(qid)) n.delete(qid); else n.add(qid); return n; });

  async function add() {
    setSaving(true);
    setError(null);
    let last = null;
    try {
      for (const qid of picked) {
        // sequential on purpose: each call renumbers sort_order and returns the full exam
        // eslint-disable-next-line no-await-in-loop
        const json = await api.post(`/api/v1/exam-system/exams/${examId}/questions`, { question_id: qid, marks_override: null });
        last = json.data;
      }
      onAdded(last);
    } catch (err) {
      setError(errorMessage(err));
      if (last) onAdded(last, true);
      setSaving(false);
    }
  }

  return (
    <StModal
      wide
      title={ar ? 'إضافة أسئلة من بنك الأسئلة' : 'Add questions from a question bank'}
      onClose={onClose}
      actions={(
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>{ar ? 'إلغاء' : 'Cancel'}</button>
          <button type="button" className="btn btn-primary" disabled={saving || picked.size === 0} onClick={add}>
            {saving ? '…' : (ar ? `إضافة (${picked.size})` : `Add selected (${picked.size})`)}
          </button>
        </>
      )}
    >
      <div className="ex-field" style={{ marginTop: 8 }}>
        <label htmlFor="ex-bank">{ar ? 'بنك الأسئلة' : 'Question bank'}</label>
        <select id="ex-bank" className="ex-select" value={bankId} onChange={(e) => { setBankId(e.target.value); setPicked(new Set()); setSearch(''); }}>
          <option value="">{ar ? 'اختر بنك أسئلة…' : 'Select a question bank…'}</option>
          {banks.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select>
        {banks.length === 0 && <small>{ar ? 'لا توجد بنوك أسئلة بعد.' : 'You have no question banks yet.'} <Link to="/academic-staff/question-banks" style={{ color: 'var(--color-primary)' }}>{ar ? 'أنشئ بنكًا' : 'Create one'}</Link></small>}
      </div>
      {error && <div className="st-alert st-alert--danger" style={{ marginTop: 10 }}><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}
      {loading && <p style={{ fontSize: 13 }}>{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>}
      {bankId && !loading && (
        <>
          <div className="ex-pick__bar">
            <div className="ex-pick__search">
              <Icon name="search" size={15} />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={ar ? 'ابحث في الأسئلة…' : 'Search questions…'}
                aria-label={ar ? 'ابحث في الأسئلة' : 'Search questions'}
              />
            </div>
            <button type="button" className="btn btn-outline btn-sm" disabled={selectable.length === 0} onClick={toggleAllVisible}>
              {allVisiblePicked ? (ar ? 'إلغاء تحديد الكل' : 'Clear selection') : (ar ? `تحديد الكل (${selectable.length})` : `Select all (${selectable.length})`)}
            </button>
          </div>
          <p className="ex-pick__count">
            {ar ? `${questions.length} سؤال في البنك` : `${questions.length} question(s) in this bank`}
            {needle ? (ar ? ` · ${visible.length} نتيجة` : ` · ${visible.length} match(es)`) : ''}
            {picked.size > 0 ? (ar ? ` · ${picked.size} محدد` : ` · ${picked.size} selected`) : ''}
          </p>

          <div className="ex-pick" role="group" aria-label={ar ? 'أسئلة البنك' : 'Bank questions'}>
            {visible.length === 0 && (
              <div className="ex-ghost" style={{ textAlign: 'center', padding: 22 }}>
                {questions.length === 0 ? (ar ? 'هذا البنك لا يحتوي أسئلة.' : 'This bank has no questions.') : (ar ? 'لا توجد أسئلة مطابقة للبحث.' : 'No questions match your search.')}
              </div>
            )}
            {visible.map((q, i) => {
              const already = attachedIds.has(q.id);
              const on = already || picked.has(q.id);
              return (
                <label key={q.id} className={`ex-pick__row${on ? ' is-on' : ''}${already ? ' is-disabled' : ''}`}>
                  <input type="checkbox" className="ex-check-input" disabled={already} checked={on} onChange={() => toggle(q.id)} />
                  <span className="ex-pick__main">
                    <span className="ex-pick__prompt" dir="auto"><b>{i + 1}.</b> {q.image_url && <Icon name="image" size={13} style={{ verticalAlign: '-2px' }} />} {q.prompt}</span>
                    <span className="ex-pick__meta">
                      <em>{questionTypeLabel(q.type, ar)}</em>
                      <em>{fmtNum(q.marks, 2)} {ar ? 'درجة' : 'pts'}</em>
                      {q.difficulty && DIFF[q.difficulty] && <em>{DIFF[q.difficulty]}</em>}
                      {already && <em className="is-added"><Icon name="check" size={11} /> {ar ? 'مضاف بالفعل' : 'Already added'}</em>}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </>
      )}
    </StModal>
  );
}

/* ---- Wizard ------------------------------------------------------------------------------ */
export default function AcademicStaffExamWizard() {
  const { id: paramId } = useParams();
  const navigate = useNavigate();
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [params, setParams] = useSearchParams();

  const [examId, setExamId] = useState(paramId || null);
  const [exam, setExam] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [step, setStep] = useState(() => Math.min(5, Math.max(1, Number(params.get('step')) || 1)));
  const [furthest, setFurthest] = useState(() => (paramId ? 5 : 1));
  const [loading, setLoading] = useState(!!paramId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const loadedFor = useRef(paramId || null);
  // Browser/phone Back changes ?step= — follow it.
  useEffect(() => { setStep(Math.min(5, Math.max(1, Number(params.get('step')) || 1))); }, [params]);

  const [subjects, setSubjects] = useState([]);
  const [courses, setCourses] = useState([]);
  const [courseBusy, setCourseBusy] = useState(false);
  const [banks, setBanks] = useState([]);
  const [picker, setPicker] = useState(false);
  const [poolModal, setPoolModal] = useState(null); // null | 'new' | config
  // In-page question editing / creation / bulk removal (no round trip to the question bank)
  const [questionModal, setQuestionModal] = useState(null); // null | question object (edit) | { bankId } (new)
  const [newBankPicker, setNewBankPicker] = useState(false);
  const [newBankId, setNewBankId] = useState('');
  const [qSelected, setQSelected] = useState(() => new Set()); // exam_question_id
  const [bulkBusy, setBulkBusy] = useState(false);
  const [imageBusyId, setImageBusyId] = useState(null);
  const imageInput = useRef(null);
  const imageTarget = useRef(null);
  // drop selected ids whose question left the exam (single remove, reload, ...)
  useEffect(() => {
    const ids = new Set((exam?.questions || []).map((x) => x.exam_question_id));
    setQSelected((s) => (s.size === 0 || [...s].every((id) => ids.has(id)) ? s : new Set([...s].filter((id) => ids.has(id)))));
  }, [exam]);

  // audience
  const [rows, setRows] = useState([]); // raw target rows currently saved
  const [selected, setSelected] = useState(new Set());
  const [known, setKnown] = useState({}); // student id -> student object
  const [matching, setMatching] = useState(0);
  const [studentQ, setStudentQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const targetsLoaded = useRef(false);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  /* -- loading ---------------------------------------------------------------------------- */
  const loadExam = useCallback((id) => api.get(`/api/v1/exam-system/exams/${id}`).then((j) => { setExam(j.data); return j.data; }), []);

  useEffect(() => {
    if (!paramId || loadedFor.current === `done:${paramId}`) return;
    loadedFor.current = `done:${paramId}`;
    setLoading(true);
    loadExam(paramId)
      .then((e) => { setForm(formFromExam(e)); setExamId(String(e.id)); })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [paramId, loadExam]);

  useEffect(() => {
    api.get('/api/v1/courses', { locale }).then((j) => setCourses(j.data || [])).catch(() => {});
  }, [locale]);

  useEffect(() => {
    api.get('/api/v1/exam-system/question-banks').then((j) => {
      const list = j.data || [];
      setBanks(list);
      setSubjects((prev) => [...new Set([...prev, ...list.map((b) => b.subject).filter(Boolean)])]);
    }).catch(() => {});
    api.get('/api/v1/exam-system/exams').then((j) => {
      setSubjects((prev) => [...new Set([...prev, ...(j.data || []).map((e) => e.subject).filter(Boolean)])].sort());
    }).catch(() => {});
  }, []);

  const goStep = useCallback((n) => {
    setStep(n);
    setFurthest((f) => Math.max(f, n));
    setParams({ step: String(n) });
    window.scrollTo?.({ top: 0 });
  }, [setParams]);

  // audience: load once, when step 4 (or 5) is first needed
  useEffect(() => {
    if (!examId || step < 4 || targetsLoaded.current) return;
    targetsLoaded.current = true;
    Promise.all([
      api.get(`/api/v1/exam-system/exams/${examId}/targets`),
      api.get(`/api/v1/exam-system/exams/${examId}/targets/students`).catch(() => ({ data: [] })),
    ]).then(([t, s]) => {
      const list = t.data?.targets || [];
      setRows(list);
      setSelected(new Set(list.filter((r) => r.student_id).map((r) => Number(r.student_id))));
      setMatching(t.data?.matching_count ?? 0);
      setKnown((k) => ({ ...k, ...Object.fromEntries((s.data || []).map((x) => [x.id, x])) }));
    }).catch((err) => setError(errorMessage(err)));
  }, [examId, step]);

  // student search (empty query = browse the first page of my university)
  useEffect(() => {
    if (step !== 4 || !examId) return undefined;
    const q = studentQ.trim();
    if (q.length === 1) { setResults([]); return undefined; }
    setSearching(true);
    const h = setTimeout(() => {
      api.get('/api/v1/exam-system/targeting/students', { q })
        .then((j) => {
          const list = j.data || [];
          setResults(list);
          setKnown((k) => ({ ...k, ...Object.fromEntries(list.map((x) => [x.id, x])) }));
        })
        .catch((err) => setError(errorMessage(err)))
        .finally(() => setSearching(false));
    }, q ? 300 : 0);
    return () => clearTimeout(h);
  }, [studentQ, step, examId]);

  /* -- derived ---------------------------------------------------------------------------- */
  const attachedIds = useMemo(() => new Set((exam?.questions || []).map((q) => q.question_id)), [exam]);
  const poolRows = exam?.question_pools || [];
  const questionCount = (exam?.questions || []).length + poolRows.reduce((a, p) => a + (p.questions_to_select || 0), 0);
  const breakdown = useMemo(() => {
    const c = {};
    (exam?.questions || []).forEach((q) => { c[q.type] = (c[q.type] || 0) + 1; });
    const parts = Object.entries(c).map(([t, n]) => `${n} ${questionTypeLabel(t, ar, true)}`);
    if (poolRows.length) parts.push(`${poolRows.reduce((a, p) => a + (p.questions_to_select || 0), 0)} ${ar ? 'عشوائي' : 'random'}`);
    return parts.join(' · ') || '—';
  }, [exam, poolRows, ar]);

  const preservedRows = useMemo(() => rows.filter((r) => !r.student_id), [rows]);
  const visibleStudents = useMemo(() => {
    const byId = new Map();
    results.forEach((s) => byId.set(s.id, s));
    if (!studentQ.trim()) selected.forEach((sid) => { if (known[sid] && !byId.has(sid)) byId.set(sid, known[sid]); });
    return [...byId.values()];
  }, [results, selected, known, studentQ]);

  const visibleSelectedAll = visibleStudents.length > 0 && visibleStudents.every((s) => selected.has(s.id));
  async function addCourseStudents() {
    if (!form.course_id) return;
    setCourseBusy(true);
    setError(null);
    try {
      const j = await api.get(`/api/v1/courses/${form.course_id}/students`, { locale });
      const list = j.data || [];
      setSelected((cur) => { const n = new Set(cur); list.forEach((x) => n.add(Number(x.id))); return n; });
      setKnown((k) => ({ ...k, ...Object.fromEntries(list.map((x) => [x.id, x])) }));
      setFlash(ar ? `تمت إضافة ${list.length} طالب من المادة. اضغط «التالي» للحفظ.` : `Added ${list.length} students from the course. Press Next to save.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCourseBusy(false);
    }
  }

  const toggleStudent = (sid) => setSelected((cur) => { const n = new Set(cur); if (n.has(sid)) n.delete(sid); else n.add(sid); return n; });
  const toggleAllVisible = () => setSelected((cur) => {
    const n = new Set(cur);
    if (visibleSelectedAll) visibleStudents.forEach((s) => n.delete(s.id)); else visibleStudents.forEach((s) => n.add(s.id));
    return n;
  });

  /* -- saving ----------------------------------------------------------------------------- */
  function payload() {
    const visibility = form.show_result ? 'immediate' : form.release;
    return {
      title: form.title.trim(),
      subject: form.subject.trim() || null,
      course_id: form.course_id ? Number(form.course_id) : null,
      exam_type: form.exam_type,
      description: form.description.trim() || null,
      duration_minutes: Number(form.duration) || 60,
      start_at: combineDateTime(form.date, form.time),
      end_at: combineDateTime(form.end_date, form.end_time || '23:59'),
      instructions: form.instructions.trim() || null,
      max_attempts: Math.max(1, Number(form.max_attempts) || 1),
      passing_score: form.passing_score === '' ? null : Number(form.passing_score),
      randomize_questions: form.shuffle_q,
      randomize_options: form.shuffle_a,
      auto_submit_on_timeout: form.auto_submit,
      allow_back_navigation: form.allow_back,
      result_visibility: visibility,
      show_answer_review: form.score_only ? false : form.show_review,
      show_score_only: form.score_only,
      secure_mode_enabled: form.secure,
      max_violations: form.secure ? (Number(form.max_violations) || 3) : null,
      // Late-submission policy: grace period after time ends + % deducted from the score (penalty needs a grace period).
      late_grace_minutes: Math.min(120, Math.max(0, Number(form.late_grace) || 0)),
      late_penalty_percent: (Number(form.late_grace) || 0) > 0 ? Math.min(100, Math.max(0, Number(form.late_penalty) || 0)) : 0,
      // One active session per attempt + camera monitoring / identity check (identity forces camera = required).
      single_session_enabled: form.single_session,
      identity_check_required: form.identity_check,
      proctoring_mode: form.identity_check ? 'required' : form.proctoring,
      snapshot_interval_seconds: Math.min(600, Math.max(15, Number(form.snapshot_interval) || 60)),
      // Optional exam password: a typed value sets/changes it; switching it off removes an existing one; otherwise untouched.
      ...(form.use_password
        ? (form.access_password.trim() ? { access_password: form.access_password.trim() } : {})
        : (exam?.has_access_password ? { remove_access_password: true } : {})),
    };
  }

  async function saveDetails() {
    if (!form.title.trim()) throw new Error(ar ? 'عنوان الامتحان مطلوب.' : 'Exam title is required.');
    if (!(Number(form.duration) >= 1)) throw new Error(ar ? 'المدة يجب أن تكون دقيقة على الأقل.' : 'Duration must be at least 1 minute.');
    if (form.use_password && !form.access_password.trim() && !exam?.has_access_password) throw new Error(ar ? 'اكتب باسورد الامتحان أو أوقف خيار الباسورد.' : 'Enter an exam password or turn the password option off.');
    if (form.use_password && form.access_password.trim() && form.access_password.trim().length < 4) throw new Error(ar ? 'باسورد الامتحان يجب ألا يقل عن 4 أحرف.' : 'The exam password must be at least 4 characters.');
    const body = payload();
    if (body.start_at && body.end_at && body.end_at < body.start_at) throw new Error(ar ? 'موعد الإغلاق يجب أن يكون بعد موعد البدء.' : 'The closing time must be after the start time.');
    if (!examId) {
      const json = await api.post('/api/v1/exam-system/exams', body);
      const newId = String(json.data.id);
      loadedFor.current = `done:${newId}`;
      setExamId(newId);
      setExam(await loadExam(newId));
      set({ access_password: '' });
      return newId;
    }
    await api.patch(`/api/v1/exam-system/exams/${examId}`, body);
    await loadExam(examId);
    set({ access_password: '' });
    return examId;
  }

  async function saveTargets(id = examId) {
    const next = [...preservedRows.map(toRow), ...[...selected].map((sid) => ({ student_id: sid }))];
    const json = await api.put(`/api/v1/exam-system/exams/${id}/targets`, { targets: next });
    setRows(json.data?.targets || []);
    setMatching(json.data?.matching_count ?? 0);
  }

  async function run(fn) {
    setSaving(true);
    setError(null);
    setFlash(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(err?.message && !err?.response ? err.message : errorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  const needsDetailsSave = step === 1 || step === 3;

  async function next() {
    const ok = await run(async () => {
      if (needsDetailsSave) await saveDetails();
      if (step === 4) await saveTargets();
      if (step === 1 || step === 4) await loadExam(examId || (await Promise.resolve(null)));
    }).catch(() => false);
    if (ok) goStep(step + 1);
  }

  async function saveDraft() {
    const ok = await run(async () => {
      const id = await saveDetails();
      if (step === 4 && targetsLoaded.current) await saveTargets(id);
    });
    if (ok) navigate('/academic-staff/exams', { replace: true });
  }

  async function publish() {
    const ok = await run(async () => {
      await saveDetails();
      if (['draft', 'scheduled'].includes(exam?.status)) await api.post(`/api/v1/exam-system/exams/${examId}/publish`);
    });
    if (ok) navigate(`/academic-staff/exams/${examId}`, { replace: true });
  }

  async function moveQuestion(index, delta) {
    const list = [...(exam.questions || [])];
    const to = index + delta;
    if (to < 0 || to >= list.length) return;
    const [m] = list.splice(index, 1);
    list.splice(to, 0, m);
    setExam((e) => ({ ...e, questions: list }));
    try {
      const json = await api.patch(`/api/v1/exam-system/exams/${examId}/questions/reorder`, { order: list.map((q) => q.exam_question_id) });
      setExam(json.data);
    } catch (err) {
      setError(errorMessage(err));
      loadExam(examId);
    }
  }

  // Total points: the server spreads the new total evenly over the questions.
  async function applyTotal(total) {
    setError(null);
    try {
      const json = await api.put(`/api/v1/exam-system/exams/${examId}/marks`, { total_marks: total });
      setExam(json.data);
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    }
  }

  // One question's points; the exam total follows automatically.
  async function setQuestionMarks(eqId, marks) {
    setError(null);
    try {
      const json = await api.patch(`/api/v1/exam-system/exams/${examId}/questions/${eqId}`, { marks });
      setExam(json.data);
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    }
  }

  async function removeQuestion(eqId) {
    if (!window.confirm(ar ? 'إزالة هذا السؤال من الامتحان؟' : 'Remove this question from the exam?')) return;
    try {
      const json = await api.del(`/api/v1/exam-system/exams/${examId}/questions/${eqId}`);
      setExam(json.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // ---- in-page question tools -------------------------------------------------------------
  // Edit: load the full question (options, answers, AI fields) from its bank, then reuse the
  // bank's own editor. NOTE: it is the shared bank question, so other exams using it see the change.
  async function editQuestion(q) {
    setError(null);
    try {
      let bankId = q.question_bank_id;
      if (!bankId) throw new Error(ar ? 'تعذّر تحديد بنك السؤال.' : 'Could not find this question’s bank.');
      const json = await api.get(`/api/v1/exam-system/question-banks/${bankId}`);
      const full = (json.data?.questions || []).find((x) => x.id === q.question_id);
      if (!full) throw new Error(ar ? 'السؤال غير موجود في البنك (ربما حُذف).' : 'The question no longer exists in its bank.');
      setQuestionModal({ ...full, bankId });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function startNewQuestion() {
    if (banks.length === 1) { setQuestionModal({ bankId: banks[0].id }); return; }
    setNewBankId('');
    setNewBankPicker(true);
  }

  async function handleQuestionSaved(opts) {
    // a brand-new question is attached to this exam right away
    if (opts?.id && !questionModal?.id) {
      try {
        await api.post(`/api/v1/exam-system/exams/${examId}/questions`, { question_id: opts.id, marks_override: null });
      } catch (err) {
        setError(errorMessage(err));
      }
    }
    if (!opts?.keepOpen) setQuestionModal(null);
    if (opts?.warning) setError(opts.warning);
    await loadExam(examId);
  }

  function pickImageFor(q) {
    imageTarget.current = q;
    imageInput.current?.click();
  }

  async function handleImageChosen(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    const q = imageTarget.current;
    if (!file || !q) return;
    const msg = validateQuestionImage(file, ar);
    if (msg) { setError(msg); return; }
    setError(null);
    setImageBusyId(q.exam_question_id);
    try {
      await uploadQuestionImage(q.question_id, file);
      await loadExam(examId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setImageBusyId(null);
    }
  }

  const toggleQSelected = (eqId) => setQSelected((s) => { const n = new Set(s); if (n.has(eqId)) n.delete(eqId); else n.add(eqId); return n; });

  async function bulkRemove(ids, all) {
    if (ids.length === 0) return;
    const msg = all
      ? (ar ? `حذف كل الأسئلة (${ids.length}) من الامتحان؟ الأسئلة نفسها تبقى في بنك الأسئلة.` : `Remove ALL ${ids.length} questions from this exam? The questions themselves stay in the question bank.`)
      : (ar ? `إزالة ${ids.length} سؤال محدد من الامتحان؟ الأسئلة تبقى في بنك الأسئلة.` : `Remove ${ids.length} qSelected question(s) from this exam? They stay in the question bank.`);
    if (!window.confirm(msg)) return;
    setBulkBusy(true);
    setError(null);
    try {
      const json = await api.post(`/api/v1/exam-system/exams/${examId}/questions/bulk-remove`, { exam_question_ids: ids });
      setExam(json.data);
      setQSelected(new Set());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBulkBusy(false);
    }
  }

  async function removePool(cfgId) {
    if (!window.confirm(ar ? 'إزالة هذه المجموعة العشوائية؟' : 'Remove this random section?')) return;
    try {
      const json = await api.del(`/api/v1/exam-system/exams/${examId}/pools/${cfgId}`);
      setExam(json.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  /* -- render ----------------------------------------------------------------------------- */
  if (loading) return <div className="st-page"><Skeleton h={120} count={3} /></div>;

  const isNew = !paramId && !examId;
  const published = exam && !['draft', 'scheduled'].includes(exam.status) ? true : false;
  const canPublish = questionCount > 0 && matching > 0;
  const stepMeta = STEPS[step - 1];
  const needQuestions = questionCount === 0;

  return (
    <div className="ex-page">
      <div>
        <BackLink to="/academic-staff/exams" className="ex-back"><Icon name="chevron-left" size={14} /> {ar ? 'العودة إلى الامتحانات' : 'Back to Exams'}</BackLink>
        <StaffHead
          eyebrow={ar ? 'منشئ الامتحان / تقييم جديد' : 'Exam builder / New assessment'}
          title={isNew || exam?.status === 'draft' ? (ar ? 'إنشاء امتحان' : 'Create exam') : (ar ? 'تعديل الامتحان' : 'Edit exam')}
          subtitle={ar ? 'ابنِ تقييمًا مركّزًا لطلابك.' : 'Build a focused assessment for your students.'}
          actions={examId ? <span className="ex-status ex-status--draft">{exam?.status === 'draft' || !exam ? (ar ? 'مسودة · حُفظت تلقائيًا' : 'Draft · autosaved') : (ar ? 'منشور' : 'Published')}</span> : null}
        />
      </div>

      <div className="ex-card">
        <div className="ex-stepper" role="list">
          {STEPS.map((s, i) => {
            const n = i + 1;
            const done = n < step || (n <= furthest && n !== step && examId);
            const clickable = examId && n <= furthest && n !== step;
            return (
              <button
                key={s.en}
                type="button"
                role="listitem"
                className={`ex-step${n === step ? ' is-active' : ''}${done ? ' is-done' : ''}`}
                aria-current={n === step ? 'step' : undefined}
                onClick={() => clickable && goStep(n)}
                disabled={!clickable && n !== step}
              >
                <span className="ex-step__dot">{done ? <Icon name="check" size={14} /> : n}</span>
                <span>{ar ? s.ar : s.en}</span>
              </button>
            );
          })}
        </div>
      </div>

      {error && <div className="st-alert st-alert--danger" role="alert"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}

      <div className="ex-card ex-card__pad">
        <div className="ex-stephead">
          <small>{ar ? `الخطوة ${step} من 5` : `Step ${step} of 5`}</small>
          <h2>{ar ? stepMeta.ar : stepMeta.en}</h2>
          <p>{[
            ar ? 'عيّن المعلومات الأساسية لهذا التقييم.' : 'Set the core information for this assessment.',
            ar ? 'أنشئ ونظّم أسئلة هذا الامتحان.' : 'Create and organize the questions for this exam.',
            ar ? 'اضبط كيف سيؤدي الطلاب الامتحان.' : 'Configure how students will take this exam.',
            ar ? 'اختر الطلاب الذين سيتلقون هذا الامتحان.' : 'Choose which students should receive this exam.',
            ar ? 'راجع التفاصيل قبل النشر.' : 'Check the details before publishing.',
          ][step - 1]}</p>
        </div>

        {/* ---- 1. Basic information ---- */}
        {step === 1 && (
          <div className="ex-form">
            <div className="ex-field is-wide">
              <label htmlFor="ex-title">{ar ? 'عنوان الامتحان' : 'Exam title'}</label>
              <input id="ex-title" className="ex-input" maxLength={200} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder={ar ? 'مثال: امتحان منتصف الفصل في الذكاء الاصطناعي' : 'e.g. Artificial Intelligence Midterm'} />
            </div>
            <div className="ex-field">
              <label htmlFor="ex-course">{ar ? 'المقرر / المادة' : 'Course / subject'}</label>
              <select
                id="ex-course"
                className="ex-select"
                style={{ width: '100%' }}
                value={form.course_id}
                onChange={(e) => {
                  const c = courses.find((x) => String(x.id) === e.target.value);
                  set({ course_id: e.target.value, ...(c ? { subject: c.name_en } : {}) });
                }}
              >
                <option value="">{courses.length ? (ar ? '— اختر المادة —' : '— Select a course —') : (ar ? '— لا توجد مواد (اكتب الاسم) —' : '— No courses yet (type a name) —')}</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {ar ? (c.name_ar || c.name_en) : c.name_en}</option>)}
              </select>
              {!form.course_id && (
                <>
                  <input id="ex-subject" className="ex-input" style={{ marginTop: 8 }} list="ex-subjects" maxLength={150} value={form.subject} onChange={(e) => set({ subject: e.target.value })} placeholder={ar ? 'أو اكتب اسم المادة يدويًا' : 'Or type the course name'} />
                  <datalist id="ex-subjects">{subjects.map((x) => <option key={x} value={x} />)}</datalist>
                </>
              )}
              {form.course_id && <small>{ar ? 'سيتمكن الطلاب المسجّلون في هذه المادة من إضافتهم بضغطة واحدة في خطوة «الطلاب».' : 'Students enrolled in this course can be added with one click in the “Students” step.'}</small>}
            </div>
            <div className="ex-field">
              <span className="ex-label">{ar ? 'نوع الامتحان' : 'Exam type'}</span>
              <Segmented options={EXAM_TYPES} value={form.exam_type} onChange={(v) => set({ exam_type: v })} ar={ar} label={ar ? 'نوع الامتحان' : 'Exam type'} />
            </div>
            <div className="ex-field is-wide">
              <label htmlFor="ex-desc">{ar ? 'الوصف' : 'Description'}</label>
              <textarea id="ex-desc" className="ex-textarea" maxLength={5000} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder={ar ? 'أضف وصفًا قصيرًا للتقييم' : 'Add a short description of the assessment'} />
            </div>
            <div className="ex-field">
              <label htmlFor="ex-date">{ar ? 'التاريخ' : 'Date'}</label>
              <input id="ex-date" className="ex-input" type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
              <small>{ar ? 'اتركه فارغًا ليكون متاحًا فور النشر.' : 'Leave empty to open as soon as it is published.'}</small>
            </div>
            <div className="ex-field">
              <label htmlFor="ex-time">{ar ? 'وقت البدء' : 'Start time'}</label>
              <input id="ex-time" className="ex-input" type="time" value={form.time} onChange={(e) => set({ time: e.target.value })} disabled={!form.date} />
            </div>
            <div className="ex-field">
              <label htmlFor="ex-dur">{ar ? 'المدة (بالدقائق)' : 'Duration (minutes)'}</label>
              <input id="ex-dur" className="ex-input" type="number" min="1" max="1440" value={form.duration} onChange={(e) => set({ duration: e.target.value })} />
            </div>
            <div className="ex-field">
              <label htmlFor="ex-total">{ar ? 'إجمالي الدرجات' : 'Total points'}</label>
              <TotalPointsEditor id="ex-total" total={exam?.total_marks ?? 0} canEdit={Boolean(examId) && (exam?.questions || []).length > 0} ar={ar} onApply={applyTotal} />
              <small>{ar ? 'يُحسب تلقائيًا من درجات الأسئلة. عدّله ليوزَّع بالتساوي على الأسئلة، ثم اضبط درجة كل سؤال من خطوة الأسئلة.' : 'Calculated from the question points. Edit it to spread the total evenly over the questions, then fine-tune each question in the Questions step.'}</small>
            </div>
            <div className="ex-field is-wide">
              <label htmlFor="ex-ins">{ar ? 'التعليمات (اختياري)' : 'Instructions (optional)'}</label>
              <textarea id="ex-ins" className="ex-textarea" maxLength={5000} value={form.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder={ar ? 'أضف تعليمات يقرؤها الطلاب قبل البدء' : 'Add instructions students should read before beginning'} />
            </div>
          </div>
        )}

        {/* ---- 2. Questions ---- */}
        {step === 2 && (
          <>
            <div className="ex-card__head">
              <div>
                <h3 className="ex-card__title" style={{ fontSize: 14 }}>{ar ? 'بنك الأسئلة' : 'Question bank'}</h3>
                <p className="ex-card__sub">{ar ? 'رتّب الأسئلة بالأسهم، وعدّل درجة أي سؤال بـ − / +، أو غيّر الإجمالي ليتوزع على الأسئلة تلقائيًا.' : 'Reorder with the arrows, adjust any question with − / +, or change the total to spread it across the questions automatically.'}</p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setPicker(true)}><Icon name="plus" size={14} /> {ar ? 'إضافة سؤال' : 'Add Question'}</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={startNewQuestion} disabled={banks.length === 0}><Icon name="edit" size={14} /> {ar ? 'سؤال جديد' : 'New question'}</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setPoolModal('new')}><Icon name="plus" size={14} /> {ar ? 'إضافة قسم عشوائي' : 'Add Section'}</button>
                <Link to="/academic-staff/question-banks" className="btn btn-outline btn-sm"><Icon name="sparkles" size={14} /> {ar ? 'إدارة بنوك الأسئلة' : 'Manage question banks'}</Link>
              </div>
            </div>

            <div className="ex-strip" style={{ marginBottom: 16 }}>
              <div><small>{ar ? 'الأسئلة' : 'Questions'}</small><b>{questionCount}</b></div>
              <div><small>{ar ? 'إجمالي الدرجات' : 'Total points'}</small><TotalPointsEditor compact total={exam?.total_marks ?? 0} canEdit={(exam?.questions || []).length > 0} ar={ar} onApply={applyTotal} /></div>
              <div><small>{ar ? 'التوزيع' : 'Breakdown'}</small><b className="is-sm">{breakdown}</b></div>
            </div>

            {poolRows.length > 0 && (
              <div className="ex-qlist" style={{ marginBottom: 12 }}>
                {poolRows.map((p) => (
                  <div key={p.id} className="ex-q">
                    <div className="ex-q__top">
                      <span className="ex-q__no">{ar ? 'قسم عشوائي' : 'Random section'}</span><span>·</span>
                      <span>{fmtNum(p.subtotal_marks)} {ar ? 'درجة' : 'points'}</span>
                      <span className="ex-q__tools">
                        <button type="button" className="ex-icon-btn" onClick={() => setPoolModal(p)} aria-label={ar ? 'تعديل' : 'Edit'}><Icon name="edit" size={15} /></button>
                        <button type="button" className="ex-icon-btn ex-icon-btn--danger" onClick={() => removePool(p.id)} aria-label={ar ? 'إزالة' : 'Remove'}><Icon name="trash" size={15} /></button>
                      </span>
                    </div>
                    <p className="ex-q__prompt">{p.pool_name || '—'}</p>
                    <div className="ex-ghost">{ar ? `يسحب ${p.questions_to_select} سؤالًا عشوائيًا من ${p.pool_question_count ?? '—'} لكل طالب` : `Draws ${p.questions_to_select} random questions out of ${p.pool_question_count ?? '—'} for each student`}</div>
                  </div>
                ))}
              </div>
            )}

            {(exam?.questions || []).length === 0 && poolRows.length === 0 ? (
              <div className="ex-ghost" style={{ textAlign: 'center', padding: 28 }}>{ar ? 'لم تُضف أسئلة بعد. ابدأ بإضافة سؤال من بنك الأسئلة.' : 'No questions yet. Start by adding questions from a question bank.'}</div>
            ) : (
              <>
              {(exam.questions || []).length > 0 && (
                <div className="ex-pick__bar" style={{ marginBottom: 10 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      className="ex-check-input"
                      checked={qSelected.size > 0 && qSelected.size === (exam.questions || []).length}
                      ref={(el) => { if (el) el.indeterminate = qSelected.size > 0 && qSelected.size < (exam.questions || []).length; }}
                      onChange={() => setQSelected(qSelected.size === (exam.questions || []).length ? new Set() : new Set((exam.questions || []).map((x) => x.exam_question_id)))}
                    />
                    {qSelected.size > 0
                      ? (ar ? `${qSelected.size} محدد` : `${qSelected.size} selected`)
                      : (ar ? 'تحديد الكل' : 'Select all')}
                  </label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {qSelected.size > 0 && (
                      <button type="button" className="btn btn-danger btn-sm" disabled={bulkBusy} onClick={() => bulkRemove([...qSelected], qSelected.size === (exam.questions || []).length)}>
                        <Icon name="trash" size={14} /> {ar ? `حذف المحدد (${qSelected.size})` : `Delete selected (${qSelected.size})`}
                      </button>
                    )}
                    <button type="button" className="btn btn-outline btn-sm" disabled={bulkBusy} onClick={() => bulkRemove((exam.questions || []).map((x) => x.exam_question_id), true)}>
                      <Icon name="trash" size={14} /> {ar ? 'حذف كل الأسئلة' : 'Delete all questions'}
                    </button>
                  </div>
                </div>
              )}
              <div className="ex-qlist">
                {(exam.questions || []).map((q, i, all) => (
                  <ExamQuestionCard
                    key={q.exam_question_id}
                    q={q}
                    index={i}
                    ar={ar}
                    tools={{ selected: qSelected.has(q.exam_question_id), onSelect: () => toggleQSelected(q.exam_question_id), onEdit: () => editQuestion(q), onImage: () => pickImageFor(q), imageBusy: imageBusyId === q.exam_question_id, onMarks: (m) => setQuestionMarks(q.exam_question_id, m), canUp: i > 0, canDown: i < all.length - 1, onUp: () => moveQuestion(i, -1), onDown: () => moveQuestion(i, 1), onRemove: () => removeQuestion(q.exam_question_id) }}
                  />
                ))}
              </div>
              </>
            )}
          </>
        )}

        {/* ---- 3. Settings ---- */}
        {step === 3 && (
          <>
            <div className="ex-group">
              <h3>{ar ? 'التوقيت والمحاولات' : 'Timing & attempts'}</h3>
              <div className="ex-form" style={{ marginBottom: 6 }}>
                <div className="ex-field">
                  <label htmlFor="ex-dur2">{ar ? 'المدة (بالدقائق)' : 'Duration (minutes)'}</label>
                  <input id="ex-dur2" className="ex-input" type="number" min="1" max="1440" value={form.duration} onChange={(e) => set({ duration: e.target.value })} />
                </div>
                <div className="ex-field">
                  <label htmlFor="ex-att">{ar ? 'عدد المحاولات' : 'Number of attempts'}</label>
                  <input id="ex-att" className="ex-input" type="number" min="1" max="10" value={form.max_attempts} onChange={(e) => set({ max_attempts: e.target.value })} />
                </div>
                <div className="ex-field">
                  <label htmlFor="ex-pass">{ar ? 'درجة النجاح' : 'Passing score'}</label>
                  <input id="ex-pass" className="ex-input" type="number" min="0" step="0.5" value={form.passing_score} onChange={(e) => set({ passing_score: e.target.value })} placeholder={ar ? '50% من الدرجات إن تُرك فارغًا' : '50% of total if left empty'} />
                </div>
                <div className="ex-field">
                  <label htmlFor="ex-end">{ar ? 'متاح حتى (اختياري)' : 'Available until (optional)'}</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input id="ex-end" className="ex-input" type="date" value={form.end_date} onChange={(e) => set({ end_date: e.target.value })} aria-label={ar ? 'تاريخ الإغلاق' : 'Closing date'} />
                    <input className="ex-input" type="time" value={form.end_time} onChange={(e) => set({ end_time: e.target.value })} disabled={!form.end_date} aria-label={ar ? 'وقت الإغلاق' : 'Closing time'} />
                  </div>
                </div>
              </div>
              <ToggleRow label={ar ? 'تسليم تلقائي عند انتهاء الوقت' : 'Auto submit when time ends'} checked={form.auto_submit} onChange={(v) => set({ auto_submit: v })} />
            </div>

            <div className="ex-group">
              <h3>{ar ? 'التسليم المتأخر' : 'Late submission'}</h3>
              <div className="ex-form" style={{ marginBottom: 6 }}>
                <div className="ex-field">
                  <label htmlFor="ex-grace">{ar ? 'فترة السماح بعد انتهاء الوقت (بالدقائق)' : 'Grace period after time ends (minutes)'}</label>
                  <input id="ex-grace" className="ex-input" type="number" min="0" max="120" value={form.late_grace} onChange={(e) => set({ late_grace: e.target.value })} />
                  <small>{ar ? '0 = يُغلق الامتحان فور انتهاء الوقت. خلال فترة السماح يستطيع الطالب التسليم.' : '0 = the exam closes the moment time ends. During the grace period the student can still submit.'}</small>
                </div>
                {Number(form.late_grace) > 0 && (
                  <div className="ex-field">
                    <label htmlFor="ex-penalty">{ar ? 'نسبة الخصم من الدرجة عند التسليم المتأخر (%)' : 'Score deduction for late submission (%)'}</label>
                    <input id="ex-penalty" className="ex-input" type="number" min="0" max="100" step="0.5" value={form.late_penalty} onChange={(e) => set({ late_penalty: e.target.value })} />
                    <small>{ar ? '0 = بدون خصم. تُطبَّق النسبة فقط على من يسلّم بعد انتهاء الوقت.' : '0 = no deduction. Applies only to students who submit after time ended.'}</small>
                  </div>
                )}
              </div>
            </div>

            <div className="ex-group">
              <h3>{ar ? 'التنقل' : 'Navigation'}</h3>
              <ToggleRow label={ar ? 'السماح بالرجوع للأسئلة السابقة' : 'Allow back navigation'} hint={ar ? 'عند الإيقاف يتقدّم الطالب للأمام فقط.' : 'When off, students can only move forward.'} checked={form.allow_back} onChange={(v) => set({ allow_back: v })} />
              <ToggleRow label={ar ? 'خلط الأسئلة' : 'Shuffle questions'} checked={form.shuffle_q} onChange={(v) => set({ shuffle_q: v })} />
              <ToggleRow label={ar ? 'خلط الإجابات' : 'Shuffle answers'} checked={form.shuffle_a} onChange={(v) => set({ shuffle_a: v })} />
            </div>

            <div className="ex-group">
              <h3>{ar ? 'ظهور النتيجة' : 'Result visibility'}</h3>
              <ToggleRow label={ar ? 'إظهار النتيجة بعد التسليم' : 'Show result after submission'} checked={form.show_result} onChange={(v) => set({ show_result: v })} />
              {!form.show_result && (
                <div className="ex-field" style={{ padding: '4px 0 10px' }}>
                  <span className="ex-label">{ar ? 'متى تظهر النتيجة؟' : 'When should results appear?'}</span>
                  <Segmented options={RELEASE} value={form.release} onChange={(v) => set({ release: v })} ar={ar} label={ar ? 'موعد الظهور' : 'Release'} />
                </div>
              )}
              <ToggleRow label={ar ? 'إظهار مراجعة الإجابات بعد الامتحان' : 'Show answer review after exam'} hint={ar ? 'الأسئلة وإجابات الطالب والإجابة الصحيحة.' : 'Questions, the student\'s answers and the correct answers.'} checked={form.show_review && !form.score_only} disabled={form.score_only} onChange={(v) => set({ show_review: v })} />
              <ToggleRow label={ar ? 'إظهار الدرجة فقط' : 'Show score only'} hint={ar ? 'يخفي المراجعة تمامًا.' : 'Hides the review entirely.'} checked={form.score_only} onChange={(v) => set({ score_only: v })} />
            </div>

            <div className="ex-group">
              <h3>{ar ? 'النزاهة' : 'Integrity'}</h3>
              <ToggleRow label={ar ? 'وضع الامتحان الآمن' : 'Secure exam mode'} hint={ar ? 'ملء الشاشة وتسجيل تبديل التبويبات والنسخ واللصق.' : 'Fullscreen, tab-switch and copy/paste monitoring.'} checked={form.secure} onChange={(v) => set({ secure: v })} />
              {form.secure && (
                <div className="ex-field" style={{ maxWidth: 240, padding: '4px 0 10px' }}>
                  <label htmlFor="ex-viol">{ar ? 'الحد الأقصى للمخالفات' : 'Maximum violations'}</label>
                  <input id="ex-viol" className="ex-input" type="number" min="1" max="50" value={form.max_violations} onChange={(e) => set({ max_violations: e.target.value })} />
                  <small>{ar ? 'يُسلَّم الامتحان تلقائيًا عند تجاوزه.' : 'The attempt is auto-submitted when exceeded.'}</small>
                </div>
              )}
              <ToggleRow
                label={ar ? 'باسورد للامتحان (اختياري)' : 'Exam password (optional)'}
                hint={ar ? 'لن يتمكن الطالب من بدء الامتحان بدون الباسورد الذي تعطيه له. اتركه متوقفًا لامتحان بدون باسورد.' : 'Students cannot start the exam without the password you give them. Leave it off for an open exam.'}
                checked={form.use_password}
                onChange={(v) => set({ use_password: v, ...(v ? {} : { access_password: '' }) })}
              />
              {form.use_password && (
                <div className="ex-field" style={{ maxWidth: 320, padding: '4px 0 10px' }}>
                  <label htmlFor="ex-pwd">{ar ? 'باسورد الامتحان' : 'Exam password'}</label>
                  <input
                    id="ex-pwd" className="ex-input" type="text" autoComplete="off" maxLength={64} dir="ltr"
                    value={form.access_password}
                    placeholder={exam?.has_access_password ? (ar ? 'اتركه فارغًا للإبقاء على الباسورد الحالي' : 'Leave empty to keep the current password') : (ar ? '4 أحرف على الأقل' : 'At least 4 characters')}
                    onChange={(e) => set({ access_password: e.target.value })}
                  />
                  <small>{ar ? 'يُخزَّن مشفّرًا ولا يمكن عرضه لاحقًا، لكن يمكنك تغييره في أي وقت. شاركه مع الطلاب خارج المنصة.' : 'Stored hashed and cannot be shown again, but you can change it any time. Share it with students outside the platform.'}</small>
                </div>
              )}
              <ToggleRow label={ar ? 'جلسة واحدة للطالب' : 'One session per student'} hint={ar ? 'يمنع فتح نفس المحاولة من جهازين في نفس الوقت، ويسجّل الـ IP والجهاز. الاستحواذ على جلسة جهاز شغال يُحتسب مخالفة.' : 'Blocks opening the same attempt on two devices at once and logs IP + device. Taking over a live session counts as a violation.'} checked={form.single_session} onChange={(v) => set({ single_session: v })} />
              <div className="ex-field" style={{ maxWidth: 320, padding: '4px 0 10px' }}>
                <label htmlFor="ex-proctor">{ar ? 'مراقبة الكاميرا' : 'Camera monitoring'}</label>
                <select id="ex-proctor" className="ex-input" value={form.identity_check ? 'required' : form.proctoring} disabled={form.identity_check} onChange={(e) => set({ proctoring: e.target.value })}>
                  <option value="off">{ar ? 'متوقفة' : 'Off'}</option>
                  <option value="optional">{ar ? 'اختيارية (لقطات إن سمح الطالب)' : 'Optional (snapshots if the student allows)'}</option>
                  <option value="required">{ar ? 'إلزامية (لقطة عند البدء + لقطات دورية)' : 'Required (start photo + periodic snapshots)'}</option>
                </select>
                <small>{ar ? 'الإلزامية: رفض الكاميرا أو إيقافها أثناء الامتحان يُحتسب مخالفة. اللقطات يراها صاحب الامتحان فقط، والعلامات التلقائية مجرد مؤشرات للمراجعة.' : 'When required, refusing or stopping the camera during the exam counts as a violation. Only you can see the snapshots, and automatic flags are just review hints.'}</small>
              </div>
              <ToggleRow label={ar ? 'التحقق من الهوية قبل البدء' : 'Identity check before starting'} hint={ar ? 'سيلفي (+ صورة الكارنيه اختياريًا) تراجعها أنت وتقبلها أو ترفضها. تجعل الكاميرا إلزامية.' : 'A selfie (+ optional ID photo) that you review and approve or reject. Makes the camera required.'} checked={form.identity_check} onChange={(v) => set({ identity_check: v })} />
              {(form.identity_check || form.proctoring !== 'off') && (
                <div className="ex-field" style={{ maxWidth: 240, padding: '4px 0 10px' }}>
                  <label htmlFor="ex-snap">{ar ? 'الفاصل بين اللقطات (ثانية)' : 'Snapshot interval (seconds)'}</label>
                  <input id="ex-snap" className="ex-input" type="number" min="15" max="600" value={form.snapshot_interval} onChange={(e) => set({ snapshot_interval: e.target.value })} />
                </div>
              )}
            </div>

            <Note icon="info">{ar ? 'للاستهداف حسب الكلية أو القسم أو المجموعة استخدم الاستهداف المتقدم من صفحة الامتحان.' : 'Need to target by faculty, department or group? Use Advanced targeting from the exam page.'}</Note>
          </>
        )}

        {/* ---- 4. Assign students ---- */}
        {step === 4 && (
          <>
            <div className="ex-card__head" style={{ marginBottom: 12 }}>
              <div>
                <h3 className="ex-card__title" style={{ fontSize: 14 }}>{ar ? 'اختر الطلاب' : 'Select students'}</h3>
                <p className="ex-card__sub">{selected.size} {ar ? 'طالب مُحدَّد' : 'students selected'}{preservedRows.length > 0 ? (ar ? ` · + ${preservedRows.length} قاعدة استهداف أخرى (${matching} طالب مؤهل إجمالًا)` : ` · + ${preservedRows.length} other targeting rule(s) (${matching} eligible overall)`) : ''}</p>
              </div>
              {form.course_id && (
                <button type="button" className="btn btn-outline btn-sm" disabled={courseBusy} onClick={addCourseStudents}>
                  <Icon name="users" size={14} /> {courseBusy ? '…' : (ar ? 'إضافة طلاب المادة' : 'Add course students')}
                </button>
              )}
              <div className="ex-search" style={{ flex: '0 1 280px' }}>
                <Icon name="search" size={15} />
                <input className="ex-input" type="search" value={studentQ} onChange={(e) => setStudentQ(e.target.value)} placeholder={ar ? 'ابحث بالاسم أو الرقم الجامعي' : 'Search students'} aria-label={ar ? 'بحث عن طالب' : 'Search students'} />
              </div>
            </div>
            <div className="ex-card" style={{ boxShadow: 'none' }}>
              <div className="ex-table-wrap">
                <table className="ex-table">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}><input type="checkbox" className="ex-check-input" checked={visibleSelectedAll} onChange={toggleAllVisible} aria-label={ar ? 'تحديد الكل' : 'Select all'} /></th>
                      <th>{ar ? 'الطالب' : 'Student'}</th>
                      <th>{ar ? 'الرقم الجامعي' : 'Student ID'}</th>
                      <th>{ar ? 'القسم / الكلية' : 'Department / faculty'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStudents.map((s) => (
                      <tr key={s.id}>
                        <td><input type="checkbox" className="ex-check-input" checked={selected.has(s.id)} onChange={() => toggleStudent(s.id)} aria-label={s.full_name} /></td>
                        <td><div className="ex-student-cell"><PersonAvatar name={s.full_name} /><div style={{ minWidth: 0 }}><strong>{s.full_name}</strong>{s.email && <small>{s.email}</small>}</div></div></td>
                        <td className="is-muted">{s.student_number || '—'}</td>
                        <td className="is-muted">{s.department || s.faculty || '—'}</td>
                      </tr>
                    ))}
                    {visibleStudents.length === 0 && (
                      <tr><td colSpan={4} className="is-muted" style={{ textAlign: 'center', padding: 28 }}>{searching ? (ar ? 'جارٍ البحث…' : 'Searching…') : (ar ? 'لا يوجد طلاب مطابقون.' : 'No matching students.')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="ex-card__sub" style={{ marginTop: 10 }}>{ar ? 'تُعرض أول 50 نتيجة — استخدم البحث للوصول لطالب بعينه.' : 'The first 50 results are shown — use search to find a specific student.'}</p>
          </>
        )}

        {/* ---- 5. Review & publish ---- */}
        {step === 5 && (
          <div className="ex-review">
            <div className="ex-review__box">
              <span className="ex-chip">{form.subject || (ar ? 'بدون مقرر' : 'No course')}</span>
              <h4 style={{ fontSize: 18, margin: '10px 0 4px' }}>{form.title || '—'}</h4>
              <p className="ex-card__sub" style={{ marginBottom: 18 }}>{[form.date ? fmtDate(`${form.date}T00:00`, ar) : (ar ? 'يفتح فور النشر' : 'Opens when published'), form.date ? fmtTime(`${form.date}T${form.time}`, ar) : null, `${form.duration} ${ar ? 'دقيقة' : 'min'}`, examTypeLabel(form.exam_type, ar)].filter(Boolean).join(' · ')}</p>
              <h4>{ar ? 'إعدادات الامتحان' : 'Exam configuration'}</h4>
              <dl className="ex-dl">
                <div><dt>{ar ? 'الأسئلة' : 'Questions'}</dt><dd>{questionCount} · {fmtNum(exam?.total_marks ?? 0, 2)} {ar ? 'درجة' : 'points'}</dd></div>
                <div><dt>{ar ? 'المحاولات' : 'Attempts'}</dt><dd>{form.max_attempts} {ar ? (Number(form.max_attempts) === 1 ? 'محاولة آمنة' : 'محاولات') : (Number(form.max_attempts) === 1 ? 'secure attempt' : 'attempts')}</dd></div>
                <div><dt>{ar ? 'الطلاب' : 'Students'}</dt><dd>{matching} {ar ? 'مؤهل' : 'eligible'}</dd></div>
                <div><dt>{ar ? 'النتائج' : 'Results'}</dt><dd>{form.show_result ? (ar ? 'بعد التسليم' : 'After submission') : (form.release === 'manual' ? (ar ? 'عند نشرها' : 'When published') : (ar ? 'بعد الإغلاق' : 'After close'))}{form.score_only ? (ar ? ' · الدرجة فقط' : ' · score only') : ''}</dd></div>
                <div><dt>{ar ? 'التنقل' : 'Navigation'}</dt><dd>{form.allow_back ? (ar ? 'حر' : 'Free') : (ar ? 'للأمام فقط' : 'Forward only')}</dd></div>
                <div><dt>{ar ? 'التسليم التلقائي' : 'Auto submit'}</dt><dd>{form.auto_submit ? (ar ? 'مفعّل' : 'On') : (ar ? 'متوقف' : 'Off')}</dd></div>
              </dl>
            </div>
            <div className="ex-review__box">
              <h4>{ar ? 'قائمة التحقق قبل النشر' : 'Publishing checklist'}</h4>
              <ul className="ex-check">
                <li><Icon name="check-circle" size={16} />{ar ? 'المعلومات الأساسية مكتملة' : 'Basic information complete'}</li>
                <li className={questionCount > 0 ? '' : 'is-bad'}><Icon name={questionCount > 0 ? 'check-circle' : 'alert-triangle'} size={16} />{questionCount > 0 ? (ar ? 'الأسئلة جاهزة' : 'Questions are ready') : (ar ? 'أضف سؤالًا واحدًا على الأقل' : 'Add at least one question')}</li>
                <li className={matching > 0 ? '' : 'is-bad'}><Icon name={matching > 0 ? 'check-circle' : 'alert-triangle'} size={16} />{matching > 0 ? (ar ? `${matching} طالب مُعيَّن` : `${matching} students assigned`) : (ar ? 'عيّن طالبًا واحدًا على الأقل' : 'Assign at least one student')}</li>
              </ul>
              {published && <Note tone="warn" icon="alert-triangle">{ar ? 'هذا الامتحان منشور بالفعل. حفظ التعديلات يطبّقها فورًا.' : 'This exam is already published. Saving applies your changes immediately.'}</Note>}
            </div>
          </div>
        )}

        {step === 2 && needQuestions && furthest > 2 && null}

        {/* ---- footer ---- */}
        <div className="ex-footer">
          <div>
            {step > 1 && <button type="button" className="btn btn-outline" onClick={() => goStep(step - 1)} disabled={saving}><Icon name="arrow-left" size={14} className="icon-flip" /> {ar ? 'السابق' : 'Back'}</button>}
          </div>
          <div className="ex-footer__right">
            {flash && <span className="ex-flash">{flash}</span>}
            <button type="button" className="btn btn-outline" onClick={saveDraft} disabled={saving || (!examId && !form.title.trim())}>{ar ? 'حفظ كمسودة' : 'Save as Draft'}</button>
            {step < 5 ? (
              <button type="button" className="btn btn-primary" onClick={next} disabled={saving || (step === 1 && !form.title.trim())}>
                {saving ? '…' : (ar ? 'التالي' : 'Next')} <Icon name="arrow-right" size={14} className="icon-flip" />
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={publish} disabled={saving || (!published && !canPublish)}>
                {saving ? '…' : published ? (ar ? 'حفظ التعديلات' : 'Save changes') : (ar ? 'نشر الامتحان' : 'Publish Exam')}
              </button>
            )}
          </div>
        </div>
      </div>

      {picker && examId && (
        <QuestionPicker
          examId={examId}
          banks={banks}
          attachedIds={attachedIds}
          ar={ar}
          onClose={() => setPicker(false)}
          onAdded={(data, partial) => { if (data) setExam(data); if (!partial) setPicker(false); }}
        />
      )}
      <input ref={imageInput} type="file" accept={QUESTION_IMAGE_ACCEPT} onChange={handleImageChosen} style={{ display: 'none' }} />
      {newBankPicker && (
        <StModal
          title={ar ? 'سؤال جديد — اختر البنك' : 'New question — choose a bank'}
          onClose={() => setNewBankPicker(false)}
          actions={(
            <>
              <button type="button" className="btn btn-outline" onClick={() => setNewBankPicker(false)}>{ar ? 'إلغاء' : 'Cancel'}</button>
              <button type="button" className="btn btn-primary" disabled={!newBankId} onClick={() => { setNewBankPicker(false); setQuestionModal({ bankId: Number(newBankId) }); }}>{ar ? 'متابعة' : 'Continue'}</button>
            </>
          )}
        >
          <div className="ex-field" style={{ marginTop: 8 }}>
            <label htmlFor="ex-newq-bank">{ar ? 'السؤال هيتحفظ في بنك الأسئلة ده، وهيتضاف للامتحان تلقائيًا.' : 'The question is saved in this bank and added to the exam automatically.'}</label>
            <select id="ex-newq-bank" className="ex-select" value={newBankId} onChange={(e) => setNewBankId(e.target.value)}>
              <option value="">{ar ? 'اختر بنك أسئلة…' : 'Select a question bank…'}</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
          </div>
        </StModal>
      )}
      {questionModal && examId && (
        <QuestionModal question={questionModal} onClose={() => setQuestionModal(null)} onSaved={handleQuestionSaved} />
      )}
      {poolModal && examId && (
        <ExamPoolModal
          examId={examId}
          config={poolModal === 'new' ? null : poolModal}
          banks={banks}
          onClose={() => setPoolModal(null)}
          onSaved={() => { setPoolModal(null); loadExam(examId); }}
        />
      )}
    </div>
  );
}
