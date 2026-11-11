import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import QuestionImage from '../../components/exam/QuestionImage';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nExam from '../../i18n/academic-staff/exam-system';
import '../../styles/css/exam-grading.css';

const translations = { ...i18nCommon, ...i18nExam };

/**
 * Round 4 (Grading Core) — GET /api/v1/exam-system/exams/{id}/attempts/{attemptId}
 * (full attempt detail: questions, student answers, current grades) plus:
 *   - POST .../auto-grade — re-run automatic grading for objective questions
 *     only (mcq/true_false/multi_select); does nothing to short_answer/essay.
 *   - PUT .../grades/{examQuestionId} — manual grade / override, body
 *     { marks_awarded, feedback }. Works for every question type: it's how
 *     short_answer/essay get their first grade, and how an instructor
 *     overrides an objective auto-grade.
 *   - GET .../grades/{examQuestionId}/history — full change history for one
 *     question, shown inline (expand/collapse) rather than a modal, since
 *     this codebase has no modal component (see AcademicStaffExamTargets /
 *     AcademicStaffExamBuilder — everything here is inline cards).
 *
 * Round 6 (AI Grading) addition — attemptDetailForInstructor() nests the
 * current grade under question.grade (marks_awarded/is_correct/feedback/
 * source/graded_at), not flat on the question, and adds per-question
 * model_answer/grading_instructions/ai_grading_enabled/rubric/ai_grading
 * (the last two null for non-AI-gradable types). This page:
 *   - POST .../grades/{examQuestionId}/accept-ai — confirm the AI's score
 *     as-is (only meaningful while grade.source === 'ai').
 *   - POST .../grades/{examQuestionId}/ai-regrade — re-queue AI grading for
 *     one question (e.g. after editing the model answer/rubric elsewhere).
 *   Both just trigger a reload of the attempt; ai-regrade's job runs on the
 *   queue, so its result shows up as 'processing' until the worker finishes
 *   and the instructor reloads again.
 *
 * Round 5 addition — GET .../exams/{id}/attempts/{attemptId}/security-events
 * (ExamSecurityApiController::timeline -> ExamSecurityService::
 * timelineForAttempt()): shown as a collapsible card, only when the exam
 * has secure_mode_enabled, with the attempt's violations_count/
 * max_violations present directly on the attempt-detail payload used above.
 */

const TYPE_LABELS = { mcq: 'Multiple Choice', multi_select: 'Multi-select', true_false: 'True / False', short_answer: 'Short Answer', essay: 'Essay' };
const OBJECTIVE_TYPES = ['mcq', 'multi_select', 'true_false'];
const AI_GRADABLE_TYPES = ['short_answer', 'essay'];
const AI_STATUS_META = {
  queued: { cls: 'badge-neutral', key: 'Queued' },
  processing: { cls: 'badge-warning', key: 'Processing' },
  completed: { cls: 'badge-success', key: 'Completed' },
  failed: { cls: 'badge-danger', key: 'Failed' },
};
const SECURITY_EVENT_LABELS = {
  exam_started: 'Exam Started',
  exam_submitted: 'Exam Submitted',
  auto_submitted: 'Auto-submitted',
  fullscreen_entered: 'Entered Fullscreen',
  fullscreen_exited: 'Exited Fullscreen',
  tab_switch: 'Tab Switch',
  window_blur: 'Window Lost Focus',
  window_focus: 'Window Focus Regained',
  copy_attempt: 'Copy Attempt',
  paste_attempt: 'Paste Attempt',
  cut_attempt: 'Cut Attempt',
  devtools_attempt: 'Developer Tools Shortcut Blocked',
  devtools_opened: 'Developer Tools Opened',
  question_changed: 'Question Changed',
  answer_saved: 'Answer Saved',
  time_expired: 'Time Expired',
};

const fmt = (n) => (n == null ? '—' : Number(n));
const sameText = (a, b) => (a || '').trim() === (b || '').trim();
const isSubjective = (q) => AI_GRADABLE_TYPES.includes(q.type);
const hasAnswerText = (q) => !!(q.student_answer?.answer_text && String(q.student_answer.answer_text).trim() !== '');

/** Renders plain text, turning ``` / ~~~ fences into LTR code blocks (prompts and answers often hold code). */
function RichText({ text, className = 'eg-text' }) {
  const parts = String(text ?? '').split(/(?:```|~~~)[a-zA-Z0-9]*\n?([\s\S]*?)(?:```|~~~)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) return <pre key={i} className="eg-code" dir="ltr"><code>{part.replace(/\n$/, '')}</code></pre>;
        if (!part.trim()) return null;
        return <p key={i} className={className} dir="auto">{part.trim()}</p>;
      })}
    </>
  );
}

const serverDraft = (q) => ({ marks: q.grade?.marks_awarded ?? '', feedback: q.grade?.feedback || '' });
const isDirty = (q, d) => !!d && (String(d.marks) !== String(serverDraft(q).marks) || (d.feedback || '') !== serverDraft(q).feedback);
const validMarks = (q, v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) || n < 0 || n > q.max_marks ? null : n;
};

function QuestionGrader({ examId, attemptId, question, draft, rowError, onDraftChange, t, onChanged }) {
  const grade = question.grade;
  const marks = draft.marks;
  const feedback = draft.feedback;
  const dirty = isDirty(question, draft);
  const [saveError, setSaveError] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const isObjective = OBJECTIVE_TYPES.includes(question.type);
  const isAiGradable = AI_GRADABLE_TYPES.includes(question.type);
  const ai = question.ai_grading;
  const aiDone = ai?.status === 'completed';
  // "Before" = what the AI gave; "after" = the current final grade. Only
  // meaningful once the instructor has touched it (source === 'instructor').
  const instructorFinal = grade?.source === 'instructor';
  const marksChanged = aiDone && instructorFinal && Number(ai.marks_awarded) !== Number(grade.marks_awarded);
  const feedbackChanged = aiDone && instructorFinal && !sameText(ai.feedback, grade.feedback);
  const wasModified = marksChanged || feedbackChanged;
  const delta = marksChanged ? Number(grade.marks_awarded) - Number(ai.marks_awarded) : 0;

  const run = (url, setBusy) => {
    setBusy(true);
    setSaveError(null);
    return api.post(url)
      .then(() => { setHistory(null); onChanged(); })
      .catch((err) => setSaveError(errorMessage(err)))
      .finally(() => setBusy(false));
  };
  const base = `/api/v1/exam-system/exams/${examId}/attempts/${attemptId}/grades/${question.exam_question_id}`;

  const toggleHistory = () => {
    if (historyOpen) { setHistoryOpen(false); return; }
    setHistoryOpen(true);
    if (history) return;
    setHistoryLoading(true);
    api.get(`${base}/history`)
      .then((json) => setHistory(json.data || []))
      .catch((err) => setSaveError(errorMessage(err)))
      .finally(() => setHistoryLoading(false));
  };

  const sourceLabel = (src) => t(src === 'ai' ? 'AI' : src === 'instructor' ? 'Instructor' : 'Auto');

  return (
    <div className={`card glass-panel eg-q${dirty ? ' eg-q--dirty' : ''}`}>
      <div className="eg-q__head">
        <p className="eg-label">{t(TYPE_LABELS[question.type] || question.type)} · {question.max_marks} {t('Marks')}</p>
        <div className="eg-q__badges">
          {isObjective && grade?.is_correct === true && <span className="badge badge-success">{t('Correct')}</span>}
          {isObjective && grade?.is_correct === false && <span className="badge badge-danger">{t('Incorrect')}</span>}
          {grade?.source === 'ai' && <span className="badge badge-warning"><Icon name="sparkles" size={12} /> {t('AI Suggested')}</span>}
          {wasModified && <span className="badge badge-neutral">{t('Modified by instructor')}</span>}
          {instructorFinal && !wasModified && aiDone && <span className="badge badge-success">{t('AI grade accepted')}</span>}
        </div>
      </div>

      <div className="eg-block eg-block--prompt">
        <p className="eg-label">{t('Question')}</p>
        <RichText text={question.prompt} className="eg-text eg-text--strong" />
        <QuestionImage url={question.image_url} maxHeight={240} />
      </div>

      {(question.options || []).length > 0 && (
        <div className="eg-opts">
          {question.options.map((opt) => {
            const sa = question.student_answer;
            const selected = question.type === 'true_false'
              ? String(sa?.answer_text ?? '').trim().toLowerCase() === String(opt.id).toLowerCase()
              : (sa?.selected_option_ids || []).includes(opt.id);
            const cls = selected ? (opt.is_correct ? 'eg-opt eg-opt--right' : 'eg-opt eg-opt--wrong') : (opt.is_correct ? 'eg-opt eg-opt--key' : 'eg-opt');
            return (
              <div key={opt.id} className={cls} dir="auto">
                <span>{question.type === 'true_false' ? t(opt.option_text) : opt.option_text}</span>
                <span className="eg-opt__tags">
                  {selected && <span className="badge badge-neutral">{t("Student's choice")}</span>}
                  {opt.is_correct && <span className="badge badge-success">{t('Correct answer')}</span>}
                </span>
              </div>
            );
          })}
          {!question.student_answer && <p className="eg-muted">{t('Student did not answer this question')}</p>}
        </div>
      )}

      {isSubjective(question) && (
        hasAnswerText(question) ? (
          <div className="eg-block eg-block--answer">
            <p className="eg-label eg-label--answer">{t('Student Answer')}</p>
            <RichText text={question.student_answer.answer_text} />
          </div>
        ) : (
          <div className="eg-block eg-block--empty">
            <p className="eg-label">{t('Student Answer')}</p>
            <p className="eg-muted">{t('Student did not answer this question')} — {t('AI grading skips unanswered questions')}</p>
          </div>
        )
      )}

      {question.model_answer && (
        <div className="eg-block eg-block--model">
          <p className="eg-label">{t('Model Answer')}</p>
          <RichText text={question.model_answer} />
        </div>
      )}

      {question.rubric?.criteria?.length > 0 && (
        <div className="eg-block">
          <p className="eg-label">{t('Rubric')}</p>
          {question.rubric.criteria.map((c) => (
            <p key={c.id} className="eg-text" dir="auto" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span>{c.label}</span><span className="eg-muted">{c.max_points} {t('pts')}</span>
            </p>
          ))}
        </div>
      )}

      {isAiGradable && (
        <div className="eg-block eg-ai">
          <div className="eg-ai__head">
            <span className="eg-ai__title"><Icon name="sparkles" size={15} /> {t('AI Grading')}</span>
            {ai?.status && (
              <span className={`badge ${(AI_STATUS_META[ai.status] || AI_STATUS_META.queued).cls}`}>
                {t((AI_STATUS_META[ai.status] || AI_STATUS_META.queued).key)}
              </span>
            )}
          </div>

          {!ai && <p className="eg-muted">{t('No AI grade yet for this question.')}</p>}
          {ai?.status === 'failed' && <p className="form-error" style={{ margin: 0 }}>{ai.error_message || t('AI grading failed.')}</p>}

          {aiDone && (
            <>
              <div className="eg-compare">
                <div className="eg-compare__col">
                  <p className="eg-label">{t('Before (AI)')}</p>
                  <span className="eg-score">{fmt(ai.marks_awarded)} / {question.max_marks}</span>
                  {ai.confidence != null && <p className="eg-muted">{t('Confidence')}: {Math.round(ai.confidence * 100)}%</p>}
                </div>
                <div className="eg-compare__col eg-compare__col--after">
                  <p className="eg-label">{t('After (current grade)')}</p>
                  <span className="eg-score">{fmt(grade?.marks_awarded)} / {question.max_marks}</span>
                  {marksChanged
                    ? <span className={`eg-delta ${delta > 0 ? 'eg-delta--up' : 'eg-delta--down'}`}>{delta > 0 ? '+' : ''}{delta} {t('vs AI')}</span>
                    : <p className="eg-muted">{t('Same as AI')}</p>}
                </div>
              </div>

              {ai.feedback && (
                <div>
                  <p className="eg-label">{t('AI feedback')}</p>
                  <p className="eg-text" dir="auto">{ai.feedback}</p>
                </div>
              )}
              {feedbackChanged && (
                <div>
                  <p className="eg-label">{t('Feedback after instructor edit')}</p>
                  <p className="eg-text" dir="auto">{grade.feedback || '—'}</p>
                </div>
              )}
              {ai.reasoning_summary && (
                <div>
                  <p className="eg-label">{t('Why this grade')}</p>
                  <p className="eg-text" dir="auto">{ai.reasoning_summary}</p>
                </div>
              )}
              {ai.strengths?.length > 0 && (
                <div>
                  <p className="eg-label">{t('Strengths')}</p>
                  <div className="eg-chips">{ai.strengths.map((x, i) => <span key={i} className="eg-chip eg-chip--good" dir="auto">{x}</span>)}</div>
                </div>
              )}
              {ai.missing_concepts?.length > 0 && (
                <div>
                  <p className="eg-label">{t('Missing')}</p>
                  <div className="eg-chips">{ai.missing_concepts.map((x, i) => <span key={i} className="eg-chip eg-chip--bad" dir="auto">{x}</span>)}</div>
                </div>
              )}
            </>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {grade?.source === 'ai' && grade?.marks_awarded != null && (
              <button type="button" className="btn btn-primary btn-sm" disabled={aiBusy} onClick={() => run(`${base}/accept-ai`, setAiBusy)}>
                {aiBusy ? t('Saving…') : t('Accept AI Grade')}
              </button>
            )}
            <button type="button" className="btn btn-outline btn-sm" disabled={aiBusy} onClick={() => run(`${base}/ai-regrade`, setAiBusy)}>
              <Icon name="refresh" size={14} /> {aiBusy ? t('Grading with AI…') : t('Re-grade with AI')}
            </button>
          </div>
        </div>
      )}

      <div className="eg-form">
        <div className="form-group">
          <label className="form-label">{t('Marks Awarded')} ({t('out of')} {question.max_marks})</label>
          <input
            type="number"
            className="form-input"
            min={0}
            max={question.max_marks}
            step="0.5"
            value={marks}
            onChange={(e) => onDraftChange({ marks: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">{t('Feedback')}</label>
          <textarea
            className="form-input"
            dir="auto"
            value={feedback}
            onChange={(e) => onDraftChange({ feedback: e.target.value })}
            placeholder={t('Optional feedback for the student')}
          />
        </div>
      </div>

      {(saveError || rowError) && <p className="form-error" style={{ margin: 0 }}>{saveError || rowError}</p>}

      <div className="eg-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={toggleHistory}>
          {historyOpen ? t('Hide History') : t('View History')}
        </button>
        <div className="eg-state">
          {dirty
            ? <span className="badge badge-warning">{t('Unsaved')}</span>
            : grade?.marks_awarded != null ? <span className="eg-muted">{t('Saved')}</span> : <span className="eg-muted">{t('Not graded yet')}</span>}
        </div>
      </div>

      {historyOpen && (
        <div className="eg-history">
          {historyLoading ? (
            <p className="eg-muted">{t('Loading…')}</p>
          ) : !history || history.length === 0 ? (
            <p className="eg-muted">{t('No grade changes recorded yet.')}</p>
          ) : history.map((h, idx) => (
            <div key={h.id || idx} className="eg-history__item">
              <p className="eg-text" style={{ fontSize: 14 }}>
                {fmt(h.previous_score)} → <strong>{fmt(h.new_score)}</strong>
                {` · ${sourceLabel(h.source)}`}
                {h.changed_at && <span className="eg-muted">{` · ${new Date(h.changed_at).toLocaleString()}`}</span>}
              </p>
              {h.reason && <p className="eg-muted">{h.reason}</p>}
              {!sameText(h.previous_feedback, h.new_feedback) && (
                <>
                  {h.previous_feedback && <p className="eg-muted" dir="auto">{t('Before')}: {h.previous_feedback}</p>}
                  {h.new_feedback && <p className="eg-text" style={{ fontSize: 14 }} dir="auto">{t('After')}: {h.new_feedback}</p>}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryPanel({ attempt, t, autoResult }) {
  const qs = attempt.questions || [];
  // Computed from the question rows themselves (attempt.score / exam.total_marks can be empty while grading).
  const total = qs.length ? qs.reduce((sum, q) => sum + Number(q.max_marks || 0), 0) : (attempt.exam?.total_marks ?? null);
  const unanswered = qs.filter((q) => isSubjective(q) && !hasAnswerText(q) && q.grade?.marks_awarded == null).length;
  const pending = qs.filter((q) => q.grade?.marks_awarded == null).length;
  const gradedSum = qs.reduce((sum, q) => sum + (q.grade?.marks_awarded != null ? Number(q.grade.marks_awarded) : 0), 0);
  const aiGraded = qs.filter((q) => q.ai_grading?.status === 'completed').length;
  const modified = qs.filter((q) => q.ai_grading?.status === 'completed' && q.grade?.source === 'instructor'
    && (Number(q.ai_grading.marks_awarded) !== Number(q.grade.marks_awarded) || !sameText(q.ai_grading.feedback, q.grade.feedback))).length;

  return (
    <div className="card glass-panel eg-summary">
      <div className="eg-stats">
        <div className="eg-stat"><span className="eg-label">{t('Total Score')}</span>
          <strong>{pending === 0 && attempt.score != null ? attempt.score : gradedSum}{total != null ? ` / ${total}` : ''}</strong>
          {pending > 0 && <span className="eg-muted">{t('Provisional')} — {pending} {t('questions not graded yet')}</span>}</div>
        <div className="eg-stat"><span className="eg-label">{t('Graded by AI')}</span><strong>{aiGraded}</strong></div>
        <div className="eg-stat"><span className="eg-label">{t('Modified by instructor')}</span><strong>{modified}</strong></div>
        <div className="eg-stat"><span className="eg-label">{t('Pending')}</span><strong>{pending}</strong></div>
      </div>
      {unanswered > 0 && (
        <div className="eg-notice eg-notice--warn">
          {unanswered} {t('written questions have no student answer. Press Re-run Auto-grade to give them zero, or grade manually.')}
        </div>
      )}
      {autoResult && (
        <div className={`eg-notice ${autoResult.ai_failed > 0 ? 'eg-notice--warn' : 'eg-notice--ok'}`}>
          <strong>{t('Last auto-grade result')}</strong>
          <ul>
            <li>{t('Objective questions graded')}: {autoResult.objective}</li>
            <li>{t('Graded by AI')}: {autoResult.ai_graded}</li>
            {autoResult.zeroed_empty > 0 && <li>{t('Given zero (no answer)')}: {autoResult.zeroed_empty}</li>}
            {autoResult.ai_failed > 0 && <li>{t('AI grading failed')}: {autoResult.ai_failed}{autoResult.errors?.length ? ` — ${autoResult.errors.join(' | ')}` : ''}</li>}
            {autoResult.ai_skipped_disabled > 0 && <li>{t('Skipped (AI grading disabled for the question)')}: {autoResult.ai_skipped_disabled}</li>}
            {autoResult.ai_skipped_empty > 0 && <li>{t('Skipped (no answer)')}: {autoResult.ai_skipped_empty}</li>}
            {autoResult.ai_skipped_instructor > 0 && <li>{t('Skipped (already graded by instructor)')}: {autoResult.ai_skipped_instructor}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function AcademicStaffExamGrading() {
  const { id, attemptId } = useParams();
  const t = useTranslations(translations);
  const [attempt, setAttempt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [autoGrading, setAutoGrading] = useState(false);
  const [autoResult, setAutoResult] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  const [savingAll, setSavingAll] = useState(false);
  const [bulkMsg, setBulkMsg] = useState(null);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [securityEvents, setSecurityEvents] = useState(null);
  const [securityLoading, setSecurityLoading] = useState(false);

  const load = useCallback(() => {
    return api.get(`/api/v1/exam-system/exams/${id}/attempts/${attemptId}`)
      .then((json) => setAttempt(json.data));
  }, [id, attemptId]);

  useEffect(() => {
    setLoading(true);
    load().catch((err) => setError(errorMessage(err))).finally(() => setLoading(false));
  }, [load]);

  const toggleSecurity = () => {
    if (securityOpen) { setSecurityOpen(false); return; }
    setSecurityOpen(true);
    if (securityEvents) return;
    setSecurityLoading(true);
    api.get(`/api/v1/exam-system/exams/${id}/attempts/${attemptId}/security-events`)
      .then((json) => setSecurityEvents(json.data || []))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setSecurityLoading(false));
  };

  const handleAutoGrade = () => {
    setAutoGrading(true);
    api.post(`/api/v1/exam-system/exams/${id}/attempts/${attemptId}/auto-grade`)
      .then((json) => { setAutoResult(json.data || null); return load(); })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setAutoGrading(false));
  };

  const questions = attempt?.questions || [];
  const dirtyIds = questions.filter((q) => isDirty(q, overrides[q.exam_question_id])).map((q) => q.exam_question_id);
  const draftFor = (q) => overrides[q.exam_question_id] || serverDraft(q);

  useEffect(() => {
    if (dirtyIds.length === 0) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyIds.length]);

  const setDraft = (q, patch) => {
    setOverrides((prev) => {
      const next = { ...prev, [q.exam_question_id]: { ...(prev[q.exam_question_id] || serverDraft(q)), ...patch } };
      if (!isDirty(q, next[q.exam_question_id])) delete next[q.exam_question_id];
      return next;
    });
    setRowErrors((prev) => { const n = { ...prev }; delete n[q.exam_question_id]; return n; });
  };

  const giveZeroToUnanswered = () => {
    questions.filter((q) => isSubjective(q) && !hasAnswerText(q) && q.grade?.marks_awarded == null)
      .forEach((q) => setDraft(q, { marks: 0 }));
  };

  const saveAll = async () => {
    setSavingAll(true); setBulkMsg(null);
    const failed = {}; const done = [];
    for (const q of questions) {
      const d = overrides[q.exam_question_id];
      if (!isDirty(q, d)) continue;
      const m = validMarks(q, d.marks);
      if (m == null) { failed[q.exam_question_id] = t("Marks must be between 0 and the question's max marks."); continue; }
      try {
        await api.put(`/api/v1/exam-system/exams/${id}/attempts/${attemptId}/grades/${q.exam_question_id}`, { marks_awarded: m, feedback: d.feedback || null });
        done.push(q.exam_question_id);
      } catch (err) { failed[q.exam_question_id] = errorMessage(err); }
    }
    setOverrides((prev) => { const n = { ...prev }; done.forEach((k) => delete n[k]); return n; });
    setRowErrors(failed);
    try { await load(); } catch (err) { setError(errorMessage(err)); }
    setBulkMsg({ ok: done.length, failed: Object.keys(failed).length });
    setSavingAll(false);
  };

  const acceptAllAi = async () => {
    const targets = questions.filter((q) => q.grade?.source === 'ai' && q.grade?.marks_awarded != null && !isDirty(q, overrides[q.exam_question_id]));
    setSavingAll(true); setBulkMsg(null);
    let ok = 0; const failed = {};
    for (const q of targets) {
      try { await api.post(`/api/v1/exam-system/exams/${id}/attempts/${attemptId}/grades/${q.exam_question_id}/accept-ai`); ok++; }
      catch (err) { failed[q.exam_question_id] = errorMessage(err); }
    }
    setRowErrors(failed);
    try { await load(); } catch (err) { setError(errorMessage(err)); }
    setBulkMsg({ ok, failed: Object.keys(failed).length });
    setSavingAll(false);
  };
  const aiPendingCount = questions.filter((q) => q.grade?.source === 'ai' && q.grade?.marks_awarded != null).length;
  const unansweredCount = questions.filter((q) => isSubjective(q) && !hasAnswerText(q) && q.grade?.marks_awarded == null).length;

  if (loading) return <p className="text-small" style={{ padding: 'var(--space-5)' }}>{t('Loading…')}</p>;
  if (error) return <p className="form-error" style={{ padding: 'var(--space-5)' }}>{error}</p>;
  if (!attempt) return null;

  const secureModeEnabled = attempt.exam?.secure_mode_enabled;

  return (
    <div className="eg-page">
      <div>
        <Link to={`/academic-staff/exams/${id}/attempts`} className="text-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon name="chevron-left" size={14} /> {t('Back to Attempts')}
        </Link>
      </div>

      <div className="eg-header">
        <div>
          <h1 className="text-h2">{attempt.student?.name || t('Student')}</h1>
          <p className="eg-muted">{attempt.exam?.title}</p>
        </div>
        <button type="button" className="btn btn-outline btn-sm" disabled={autoGrading} onClick={handleAutoGrade}>
          <Icon name="refresh" size={14} /> {autoGrading ? t('Grading with AI…') : t('Re-run Auto-grade')}
        </button>
      </div>

      <SummaryPanel attempt={attempt} t={t} autoResult={autoResult} />

      {secureModeEnabled && (
        <div className="card glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Icon name="shield" size={16} />
              <span className="text-small" style={{ fontWeight: 600 }}>{t('Security Events')}</span>
              <span className="badge badge-warning">
                {t('Violations')}: {attempt.violations_count ?? 0}{attempt.exam.max_violations != null ? ` / ${attempt.exam.max_violations}` : ''}
              </span>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={toggleSecurity}>
              {securityOpen ? t('Hide Timeline') : t('View Timeline')}
            </button>
          </div>

          {securityOpen && (
            securityLoading ? (
              <p className="text-caption" style={{ margin: 0 }}>{t('Loading…')}</p>
            ) : !securityEvents || securityEvents.length === 0 ? (
              <p className="text-caption" style={{ margin: 0 }}>{t('No security events recorded.')}</p>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('Event')}</th>
                      <th>{t('Violation')}</th>
                      <th>{t('Time')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {securityEvents.map((ev) => (
                      <tr key={ev.id}>
                        <td>{t(SECURITY_EVENT_LABELS[ev.event_type] || ev.event_type)}</td>
                        <td>{ev.is_violation ? <span className="badge badge-danger">{t('Yes')}</span> : <span className="badge badge-neutral">{t('No')}</span>}</td>
                        <td className="text-caption">{ev.occurred_at ? new Date(ev.occurred_at).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}

      {(aiPendingCount > 0 || unansweredCount > 0) && (
        <div className="eg-toolbar">
          {aiPendingCount > 0 && (
            <button type="button" className="btn btn-outline btn-sm" disabled={savingAll} onClick={acceptAllAi}>
              <Icon name="sparkles" size={14} /> {t('Accept all AI grades')} ({aiPendingCount})
            </button>
          )}
          {unansweredCount > 0 && (
            <button type="button" className="btn btn-outline btn-sm" disabled={savingAll} onClick={giveZeroToUnanswered}>
              {t('Give zero to unanswered')} ({unansweredCount})
            </button>
          )}
        </div>
      )}

      {questions.map((q, idx) => (
        <div key={q.exam_question_id}>
          <p className="eg-label" style={{ marginBottom: 'var(--space-1)' }}>{t('Question')} {idx + 1}</p>
          <QuestionGrader examId={id} attemptId={attemptId} question={q} t={t} onChanged={load}
            draft={draftFor(q)} rowError={rowErrors[q.exam_question_id]} onDraftChange={(patch) => setDraft(q, patch)} />
        </div>
      ))}

      <div className="eg-savebar">
        <div className="eg-savebar__msg">
          {dirtyIds.length > 0
            ? <strong>{dirtyIds.length} {t('unsaved changes')}</strong>
            : <span className="eg-muted">{t('All changes saved')}</span>}
          {bulkMsg && <span className={bulkMsg.failed ? 'form-error' : 'eg-muted'} style={{ margin: 0 }}>
            {t('Saved')}: {bulkMsg.ok}{bulkMsg.failed ? ` · ${t('Failed')}: ${bulkMsg.failed}` : ''}
          </span>}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {dirtyIds.length > 0 && <button type="button" className="btn btn-ghost btn-sm" disabled={savingAll} onClick={() => { setOverrides({}); setRowErrors({}); }}>{t('Discard changes')}</button>}
          <button type="button" className="btn btn-primary" disabled={savingAll || dirtyIds.length === 0} onClick={saveAll}>
            {savingAll ? t('Saving…') : t('Save All Grades')}
          </button>
        </div>
      </div>
    </div>
  );
}
