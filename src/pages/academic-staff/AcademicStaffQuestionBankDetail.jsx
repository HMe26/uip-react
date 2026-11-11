import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import QuestionQualityPanel from '../../components/exam/QuestionQualityPanel';
import QuestionBankCard from '../../components/exam/QuestionBankCard';
import QuestionImagePicker, { uploadQuestionImage, removeQuestionImage } from '../../components/exam/QuestionImagePicker';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { ACCEPTED_EXAM_FILES, chunkText, extractDocumentText } from '../../utils/extractDocumentText';
import i18nCommon from '../../i18n/common';
import i18nExam from '../../i18n/academic-staff/exam-system';

const translations = { ...i18nCommon, ...i18nExam };

/**
 * Round 1 (Foundation) — GET /api/v1/exam-system/question-banks/{id}
 * (bank + its questions, ExamSystemApiController::showBank), POST
 * .../question-banks/{bankId}/questions, PATCH/DELETE .../questions/{id}.
 *
 * Round 6 (AI Grading) addition — short_answer/essay question types, their
 * AI-gradable fields (model_answer, expected_concepts, keywords,
 * grading_instructions, ai_grading_enabled — all rejected by the backend
 * unless the type is short_answer/essay, see ExamSystemService::
 * validateForType), and the rubric editor: GET/PUT/DELETE
 * /questions/{questionId}/rubric (ExamSystemApiController::showRubric/
 * saveRubric/destroyRubric -> ExamSystemService::getRubric/saveRubric/
 * deleteRubric). A rubric is one row per question (unique on question_id)
 * with N criteria whose max_points MUST sum to exactly the question's
 * marks (enforced server-side in saveRubric) — the editor blocks Save
 * itself with the same check so the instructor sees the mismatch before
 * the round-trip, not just from a 422.
 *
 * Round 7 (Question Pools) addition — a pool is a named subset of this
 * bank's questions (GET/POST .../question-banks/{bankId}/pools, PATCH/
 * DELETE .../pools/{id}) whose membership is a separate full-replace step
 * (PUT .../pools/{id}/questions, {question_ids:[...]}) since it needs the
 * pool's id first. Attaching a pool to an exam (questions_to_select,
 * marks_per_question, optional difficulty distribution) lives on the exam
 * builder page instead, not here — this page only owns the pool and its
 * membership within the bank.
 */

const CARD = { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' };
const TYPE_LABELS = { mcq: 'Multiple Choice', true_false: 'True / False', short_answer: 'Short Answer', essay: 'Essay' };
const DIFFICULTY_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const AI_GRADABLE_TYPES = ['short_answer', 'essay'];

function csvToList(str) {
  return str.split(',').map((s) => s.trim()).filter(Boolean);
}
function listToCsv(list) {
  return (list || []).join(', ');
}

function emptyOption() {
  return { option_text: '', is_correct: false };
}

// -----------------------------------------------------------------------
// Smart parsing — the instructor pastes or types a question in whatever
// shape they already have it in (their own notes, a Word doc, ChatGPT
// output, ...) and this fills in type/prompt/options/correct-answer
// automatically. It only ever *pre-fills* the real form fields below —
// nothing is locked, everything stays fully editable, and if nothing is
// recognized it just falls back to a plain prompt (same as typing
// directly into the form used to work).
//
// Recognized option markers: "A)", "A.", "A-", "1)", "1.", "-", "*", or
// the Arabic ordinals "أ) ب) ج) د) ه)". A correct option can be marked
// inline with a trailing "*", "✓"/"✔", "(correct)" or "(صح)"/"(صحيح)", or
// via a separate line "Answer: B" / "الإجابة: ب" / "الإجابة: 2" after the
// options (by letter, number, or matching the option's own text). If
// exactly two options are found and they read as True/False (or
// صح/خطأ), the question is treated as true_false instead of mcq. If no
// option block is found at all, short prompts become short_answer and
// longer ones become essay — with any trailing "Answer:" line pulled out
// as the short-answer's correct answer.
// -----------------------------------------------------------------------
const OPTION_LINE_RE = /^(?:[-•*]|\(?[A-Za-z1-9أبجدهوز]\)?[.)\-:])\s+(.+)$/;
const CORRECT_MARK_RE = /\s*(?:\*+|✓|✔|\(\s*(?:correct|صح|صحيح|الإجابة الصحيحة)\s*\))\s*$/i;
const ANSWER_LINE_RE = /^(?:answer|ans|correct answer|الإجابة|الاجابة|الجواب)\s*[:\-]\s*(.+)$/i;
const ARABIC_LETTER_INDEX = { 'أ': 0, 'ا': 0, 'ب': 1, 'ج': 2, 'د': 3, 'ه': 4 };
const LATIN_LETTER_INDEX = { a: 0, b: 1, c: 2, d: 3, e: 4 };

function stripCorrectMark(text) {
  const isCorrect = CORRECT_MARK_RE.test(text);
  return { text: text.replace(CORRECT_MARK_RE, '').trim(), isCorrect };
}

function normalizeBoolText(s) {
  const v = (s || '').trim().toLowerCase();
  if (['true', 't', 'yes', 'صح', 'صحيح', 'نعم'].includes(v)) return 'true';
  if (['false', 'f', 'no', 'خطأ', 'خطا', 'لا'].includes(v)) return 'false';
  return null;
}

function resolveAnswerRef(ref, options) {
  const clean = (ref || '').replace(/[.)]/g, '').trim();
  if (LATIN_LETTER_INDEX[clean.toLowerCase()] !== undefined) return LATIN_LETTER_INDEX[clean.toLowerCase()];
  if (ARABIC_LETTER_INDEX[clean] !== undefined) return ARABIC_LETTER_INDEX[clean];
  if (/^\d+$/.test(clean)) return parseInt(clean, 10) - 1;
  const lower = clean.toLowerCase();
  const idx = options.findIndex((o) => o.option_text.toLowerCase().trim() === lower);
  if (idx >= 0) return idx;
  return options.findIndex((o) => o.option_text.toLowerCase().includes(lower) && lower.length > 1);
}

/** @returns {{type: 'mcq'|'true_false'|'short_answer'|'essay'|null, prompt: string, options: {option_text:string,is_correct:boolean}[], correctAnswer: string|null}} */
function parseQuestionText(raw) {
  const lines = String(raw || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { type: null, prompt: '', options: [], correctAnswer: null };

  let optionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (OPTION_LINE_RE.test(lines[i]) && lines.slice(i + 1).some((l) => OPTION_LINE_RE.test(l))) {
      optionStart = i;
      break;
    }
  }

  let promptLines = [];
  let optionLines = [];
  let answerLineText = null;

  if (optionStart >= 0) {
    promptLines = lines.slice(0, optionStart);
    for (const line of lines.slice(optionStart)) {
      if (OPTION_LINE_RE.test(line)) { optionLines.push(line); continue; }
      const m = line.match(ANSWER_LINE_RE);
      if (m) answerLineText = m[1].trim();
    }
  } else {
    for (const line of lines) {
      const m = line.match(ANSWER_LINE_RE);
      if (m) { answerLineText = m[1].trim(); continue; }
      promptLines.push(line);
    }
  }

  const prompt = promptLines.join('\n').trim();

  if (optionLines.length >= 2) {
    const options = optionLines.map((line) => {
      const m = line.match(OPTION_LINE_RE);
      const { text, isCorrect } = stripCorrectMark(m ? m[1] : line);
      return { option_text: text, is_correct: isCorrect };
    });
    if (!options.some((o) => o.is_correct) && answerLineText) {
      const idx = resolveAnswerRef(answerLineText, options);
      if (idx >= 0 && idx < options.length) options[idx].is_correct = true;
    }

    if (options.length === 2) {
      const norms = options.map((o) => normalizeBoolText(o.option_text));
      if (norms[0] && norms[1] && norms[0] !== norms[1]) {
        const correctOpt = options.find((o) => o.is_correct);
        return { type: 'true_false', prompt, options: [], correctAnswer: (correctOpt && normalizeBoolText(correctOpt.option_text)) || null };
      }
    }
    return { type: 'mcq', prompt, options, correctAnswer: null };
  }

  if (!prompt) return { type: null, prompt: '', options: [], correctAnswer: null };
  const type = prompt.length <= 180 && !prompt.includes('\n') ? 'short_answer' : 'essay';
  return { type, prompt, options: [], correctAnswer: answerLineText };
}

export function QuestionModal({ question, onClose, onSaved }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const isNew = !question?.id;
  // manual = opened from the "Add manually" menu with the type already chosen — no paste/auto-fill box.
  const manual = isNew && !!question?.manual;
  const [imageFile, setImageFile] = useState(null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [justParsed, setJustParsed] = useState(false);
  const [addedCount, setAddedCount] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [type, setType] = useState(question?.type || 'mcq');
  const [prompt, setPrompt] = useState(question?.prompt || '');
  const [marks, setMarks] = useState(question?.marks ?? 1);
  const [difficulty, setDifficulty] = useState(question?.difficulty || 'medium');
  const [topic, setTopic] = useState(question?.topic || '');
  const [explanation, setExplanation] = useState(question?.explanation || '');
  const [options, setOptions] = useState(
    question?.options?.length ? question.options.map((o) => ({ option_text: o.option_text, is_correct: !!o.is_correct })) : [emptyOption(), emptyOption()]
  );
  const [correctAnswer, setCorrectAnswer] = useState(
    question?.type === 'true_false' ? (question.options?.find((o) => o.is_correct)?.option_text === 'True' ? 'true' : 'false') : 'true'
  );
  // short_answer objective fallback (used when ai_grading_enabled is off)
  const [shortAnswerCorrect, setShortAnswerCorrect] = useState(question?.correct_answer || '');
  const [acceptedAnswers, setAcceptedAnswers] = useState(listToCsv(question?.accepted_answers));
  const [caseSensitive, setCaseSensitive] = useState(!!question?.case_sensitive);
  // AI-gradable fields (short_answer/essay)
  const [aiGradingEnabled, setAiGradingEnabled] = useState(!!question?.ai_grading_enabled);
  const [modelAnswer, setModelAnswer] = useState(question?.model_answer || '');
  const [gradingInstructions, setGradingInstructions] = useState(question?.grading_instructions || '');
  const [expectedConcepts, setExpectedConcepts] = useState(listToCsv(question?.expected_concepts));
  const [keywords, setKeywords] = useState(listToCsv(question?.keywords));
  const [saving, setSaving] = useState(false);
  const [generatingAnswer, setGeneratingAnswer] = useState(false);
  const [error, setError] = useState(null);

  const isAiGradable = AI_GRADABLE_TYPES.includes(type);

  function applyParsed(parsed) {
    if (parsed.type) setType(parsed.type);
    setPrompt(parsed.prompt || '');
    if (parsed.type === 'mcq') {
      setOptions(parsed.options.length >= 2 ? parsed.options : [emptyOption(), emptyOption()]);
    } else if (parsed.type === 'true_false') {
      setCorrectAnswer(parsed.correctAnswer || 'true');
    } else if (parsed.type === 'short_answer') {
      setShortAnswerCorrect(parsed.correctAnswer || '');
    }
    setJustParsed(!!parsed.type);
  }

  function handlePasteBoxPaste(e) {
    const text = e.clipboardData?.getData('text');
    if (!text) return;
    // let the paste land in the textarea itself, then parse the full value
    setTimeout(() => applyParsed(parseQuestionText(text)), 0);
  }

  function handleAutoFillClick() {
    applyParsed(parseQuestionText(pasteText));
  }

  function resetForNext() {
    setPasteText('');
    setJustParsed(false);
    setImageFile(null);
    setImageRemoved(false);
    setPrompt('');
    setMarks(1);
    setDifficulty('medium');
    setTopic('');
    setExplanation('');
    setOptions([emptyOption(), emptyOption()]);
    setCorrectAnswer('true');
    setShortAnswerCorrect('');
    setAcceptedAnswers('');
    setCaseSensitive(false);
    setAiGradingEnabled(false);
    setModelAnswer('');
    setGradingInstructions('');
    setExpectedConcepts('');
    setKeywords('');
    setShowAdvanced(false);
  }

  function updateOption(idx, patch) {
    setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  }
  function setCorrectOption(idx) {
    setOptions((prev) => prev.map((o, i) => ({ ...o, is_correct: i === idx })));
  }
  function addOption() {
    setOptions((prev) => [...prev, emptyOption()]);
  }
  function removeOption(idx) {
    setOptions((prev) => prev.filter((_, i) => i !== idx));
  }

  async function generateModelAnswerWithAi() {
    if (!prompt.trim()) {
      setError(t('Write the question first.'));
      return;
    }
    setGeneratingAnswer(true);
    setError(null);
    try {
      const json = await api.post('/api/v1/exam-system/questions/generate-model-answer', {
        prompt: prompt.trim(), marks: Number(marks) || 1, type,
      });
      const answer = json?.data?.model_answer;
      if (answer) setModelAnswer(answer.slice(0, 5000));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setGeneratingAnswer(false);
    }
  }

  function buildPayload() {
    if (type === 'mcq') {
      const filled = options.filter((o) => o.option_text.trim());
      if (filled.length < 2) return { error: t('MCQ needs at least two options.') };
      if (filled.filter((o) => o.is_correct).length !== 1) return { error: t('Mark exactly one option as correct.') };
    }
    const payload = {
      type,
      prompt: prompt.trim(),
      marks: Number(marks) || 1,
      difficulty,
      topic: topic.trim() || null,
      explanation: explanation.trim() || null,
    };
    if (type === 'mcq') {
      payload.options = options.filter((o) => o.option_text.trim()).map((o) => ({ option_text: o.option_text.trim(), is_correct: !!o.is_correct }));
    } else if (type === 'true_false') {
      payload.correct_answer = correctAnswer;
    } else if (type === 'short_answer') {
      payload.correct_answer = shortAnswerCorrect.trim() || null;
      payload.accepted_answers = acceptedAnswers.trim() ? csvToList(acceptedAnswers) : null;
      payload.case_sensitive = caseSensitive;
    }
    if (isAiGradable) {
      payload.ai_grading_enabled = aiGradingEnabled;
      payload.model_answer = modelAnswer.trim() || null;
      payload.grading_instructions = gradingInstructions.trim() || null;
      payload.expected_concepts = expectedConcepts.trim() ? csvToList(expectedConcepts) : null;
      payload.keywords = keywords.trim() ? csvToList(keywords) : null;
    }
    return { payload };
  }

  async function handleSubmit(e, keepOpen) {
    e.preventDefault();
    setError(null);
    const { payload, error: validationError } = buildPayload();
    if (validationError) { setError(validationError); return; }

    setSaving(true);
    try {
      let savedId = question.id;
      if (isNew) {
        const json = await api.post(`/api/v1/exam-system/question-banks/${question.bankId}/questions`, payload);
        savedId = json.data?.id;
      } else {
        // type can't be changed on update — omit it so the backend keeps the original.
        const { type: _omit, ...updatePayload } = payload;
        await api.patch(`/api/v1/exam-system/questions/${question.id}`, updatePayload);
      }
      // The question itself is saved at this point; the image is a second request.
      let warning = null;
      try {
        if (imageFile && savedId) await uploadQuestionImage(savedId, imageFile);
        else if (imageRemoved && !isNew && savedId) await removeQuestionImage(savedId);
      } catch (imgErr) {
        warning = (ar ? 'تم حفظ السؤال لكن فشل رفع الصورة: ' : 'Question saved, but the image failed: ') + errorMessage(imgErr) + (ar ? ' — افتح السؤال للتعديل وحاول مرة أخرى.' : ' — edit the question to retry.');
      }
      if (isNew && keepOpen) {
        setAddedCount((c) => c + 1);
        resetForNext();
        onSaved({ keepOpen: true, warning, id: savedId });
      } else {
        onSaved({ warning, id: savedId });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" style={{ maxWidth: 640, maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)' }}>
          <h2 className="modal-box__title text-h3" style={{ margin: 0 }}>{isNew ? (manual ? `${t('Add Question to Bank')} — ${t(TYPE_LABELS[type] || type)}` : t('Add Question to Bank')) : t('Edit Question')}</h2>
          {isNew && addedCount > 0 && (
            <span className="badge badge-success">{addedCount} {t('added this session')}</span>
          )}
        </div>

        {isNew && !manual && (
          <div className="card" style={{ background: 'var(--glass-bg)', padding: 'var(--space-3)', margin: 'var(--space-3) 0', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="sparkles" size={14} /> {t('Type or paste your question here')}
            </label>
            <textarea
              className="form-input"
              rows={5}
              placeholder={t('Paste a question as-is — options, the correct answer marked with * or on an "Answer:" line, or just plain True/False. The form below fills itself in.')}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              onPaste={handlePasteBoxPaste}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <p className="text-caption" style={{ margin: 0 }}>
                {t('e.g. "A) ... B) ... C) *correct one" or "Answer: B" on its own line.')}
              </p>
              <button type="button" className="btn btn-outline btn-sm" onClick={handleAutoFillClick} disabled={!pasteText.trim()}>
                <Icon name="sparkles" size={14} /> {t('Auto-fill form')}
              </button>
            </div>
            {justParsed && (
              <p className="text-caption" style={{ margin: 0, color: 'var(--color-success)' }}>
                <Icon name="check" size={12} /> {t('Detected — review the fields below and adjust anything before saving.')}
              </p>
            )}
          </div>
        )}

        <form onSubmit={(e) => handleSubmit(e, false)} style={CARD}>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">{t('Question Type')}</label>
              <select className="form-input" value={type} onChange={(e) => setType(e.target.value)} disabled={!isNew}>
                <option value="mcq">{t('Multiple Choice')}</option>
                <option value="true_false">{t('True / False')}</option>
                <option value="short_answer">{t('Short Answer')}</option>
                <option value="essay">{t('Essay')}</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{t('Marks')}</label>
              <input className="form-input" type="number" min="0.25" step="0.25" value={marks} onChange={(e) => setMarks(e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">{t('Question text')}</label>
            <textarea className="form-input" required rows={3} maxLength={5000} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </div>

          <QuestionImagePicker
            existingUrl={question?.image_url || null}
            file={imageFile}
            onFile={(f) => { setImageFile(f); if (f) setImageRemoved(false); }}
            removed={imageRemoved}
            onRemoveExisting={setImageRemoved}
            ar={ar}
          />

          {type === 'mcq' && (
            <div className="form-group">
              <label className="form-label">{t('Options')}</label>
              <p className="text-caption" style={{ margin: '0 0 var(--space-2)' }}>{t('Pick the circle next to the correct option.')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {options.map((o, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <input
                      type="radio"
                      name="mcq-correct-option"
                      checked={!!o.is_correct}
                      onChange={() => setCorrectOption(idx)}
                      title={t('Correct')}
                    />
                    <input
                      className="form-input"
                      placeholder={t('Option text')}
                      value={o.option_text}
                      onChange={(e) => updateOption(idx, { option_text: e.target.value })}
                      style={{ flex: 1 }}
                    />
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => removeOption(idx)} disabled={options.length <= 2}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 'var(--space-2)' }} onClick={addOption}>
                <Icon name="plus" size={14} /> {t('Add Option')}
              </button>
            </div>
          )}

          {type === 'true_false' && (
            <div className="form-group">
              <label className="form-label">{t('Correct answer')}</label>
              <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
                <label className="text-small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" name="tf" checked={correctAnswer === 'true'} onChange={() => setCorrectAnswer('true')} /> {t('True')}
                </label>
                <label className="text-small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" name="tf" checked={correctAnswer === 'false'} onChange={() => setCorrectAnswer('false')} /> {t('False')}
                </label>
              </div>
            </div>
          )}

          {type === 'short_answer' && !aiGradingEnabled && (
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">{t('Correct answer (exact match)')}</label>
                <input className="form-input" value={shortAnswerCorrect} onChange={(e) => setShortAnswerCorrect(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('Other accepted answers (comma-separated)')}</label>
                <input className="form-input" value={acceptedAnswers} onChange={(e) => setAcceptedAnswers(e.target.value)} />
              </div>
            </div>
          )}

          <button
            type="button"
            className="text-caption"
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', cursor: 'pointer', textAlign: 'start', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <Icon name={showAdvanced ? 'chevron-up' : 'chevron-down'} size={12} /> {t('Advanced settings')}
          </button>

          {showAdvanced && (
            <div className="card" style={{ background: 'var(--glass-bg)', padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">{t('Difficulty')}</label>
                  <select className="form-input" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                    <option value="easy">{t('Easy')}</option>
                    <option value="medium">{t('Medium')}</option>
                    <option value="hard">{t('Hard')}</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">{t('Topic (optional)')}</label>
                  <input className="form-input" maxLength={150} value={topic} onChange={(e) => setTopic(e.target.value)} />
                </div>
              </div>

              {type === 'short_answer' && (
                <label className="text-small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> {t('Case-sensitive matching')}
                </label>
              )}

              {isAiGradable && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <label className="text-small" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                    <input type="checkbox" checked={aiGradingEnabled} onChange={(e) => setAiGradingEnabled(e.target.checked)} />
                    <Icon name="sparkles" size={14} /> {t('Enable AI grading for this question')}
                  </label>
                  {type === 'short_answer' && (
                    <p className="text-caption" style={{ margin: 0 }}>
                      {t('When AI grading is off, short-answer questions are matched exactly against the correct answer(s) above instead.')}
                    </p>
                  )}
                  {aiGradingEnabled && (
                    <>
                      <div className="form-group">
                        <label className="form-label">{t('Model Answer (optional)')}</label>
                        <textarea className="form-input" rows={3} maxLength={5000} value={modelAnswer} onChange={(e) => setModelAnswer(e.target.value)} placeholder={t('Leave empty and the AI will write the model answer itself.')} />
                        <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 6, alignSelf: 'flex-start' }} disabled={generatingAnswer} onClick={generateModelAnswerWithAi}>
                          <Icon name="sparkles" size={14} /> {generatingAnswer ? t('Generating...') : t('Write the model answer with AI')}
                        </button>
                      </div>
                      <div className="form-group">
                        <label className="form-label">{t('Grading Instructions (optional)')}</label>
                        <textarea className="form-input" rows={2} maxLength={2000} value={gradingInstructions} onChange={(e) => setGradingInstructions(e.target.value)} />
                      </div>
                      <div className="grid-2">
                        <div className="form-group">
                          <label className="form-label">{t('Expected Concepts (comma-separated)')}</label>
                          <input className="form-input" value={expectedConcepts} onChange={(e) => setExpectedConcepts(e.target.value)} />
                        </div>
                        <div className="form-group">
                          <label className="form-label">{t('Keywords (comma-separated)')}</label>
                          <input className="form-input" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">{t('Explanation (shown after grading, optional)')}</label>
                <textarea className="form-input" rows={2} maxLength={5000} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
              </div>
            </div>
          )}

          {error && <p className="form-error">{error}</p>}

          <div className="modal-box__actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
            {isNew && (
              <button type="button" className="btn btn-outline" disabled={saving} onClick={(e) => handleSubmit(e, true)}>
                {saving ? '…' : t('Save & Add Another')}
              </button>
            )}
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '…' : t('Save Question')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Bulk paste — several questions in one go, each block separated by a
 * line containing only "---". Every block is run through the same
 * parseQuestionText() used by the quick-add box above; the results are
 * shown as a review list (type + prompt only, since that covers mcq/
 * true_false/short_answer/essay without needing per-type sub-forms here)
 * so the instructor can drop anything mis-detected before it's created.
 * "Add All" then posts the remaining ones one by one — no batch endpoint
 * exists server-side, so this is sequential POSTs against the same
 * question-banks/{bankId}/questions route the single-question flow uses.
 */
/**
 * Round 9 refresh — the whole "Add Question" experience lives on the page
 * itself now, full-width, instead of a small centered modal. The instructor
 * writes or pastes every question they have in one big box (one question,
 * or many separated by a line containing only ---), reviews the detected
 * list — each one fully editable right there, options and all — and adds
 * them all in one go. No popup, no per-question dialog round-trip.
 */
function AddQuestionsPanel({ bankId, onClose, onSaved }) {
  const t = useTranslations(translations);
  const [text, setText] = useState('');
  const [items, setItems] = useState(null); // null = not parsed yet
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null); // { done, ok, fail }
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const fileInput = useRef(null);
  const [fileName, setFileName] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState(null);
  const [aiProgress, setAiProgress] = useState('');
  const [editInstruction, setEditInstruction] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState(null);
  const [editNotice, setEditNotice] = useState('');
  const [cardEditKey, setCardEditKey] = useState(null);
  const [cardInstruction, setCardInstruction] = useState('');

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setFileError(null);
    setFileLoading(true);
    try {
      const extracted = await extractDocumentText(file);
      setText(extracted);
      setFileName(file.name);
    } catch (err) {
      setFileError(err.message || String(err));
    } finally {
      setFileLoading(false);
    }
  }

  const toAiShape = (it) => ({
    type: it.type,
    prompt: it.prompt.trim(),
    options: it.type === 'mcq' ? it.options.filter((o) => o.option_text.trim()).map((o) => ({ option_text: o.option_text.trim(), is_correct: !!o.is_correct })) : [],
    correct_answer: it.type === 'true_false' ? (it.correctAnswer === 'false' ? 'false' : 'true') : (it.type === 'short_answer' && it.correctAnswer ? it.correctAnswer : null),
  });

  const fromAiShape = (q, it) => ({
    ...it,
    type: q.type,
    prompt: q.prompt,
    options: q.type === 'mcq' && q.options && q.options.length >= 2
      ? q.options.map((o) => ({ option_text: o.option_text, is_correct: !!o.is_correct }))
      : [emptyOption(), emptyOption()],
    correctAnswer: q.correct_answer || (q.type === 'true_false' ? 'true' : ''),
    recognized: true,
  });

  // Sends the given review-list items to the AI with the instructor's instruction and
  // replaces them in place (same order). Nothing is saved until "Add All".
  async function reviseItems(keys, instruction) {
    const targets = (items || []).filter((it) => keys.includes(it.key) && it.prompt.trim());
    if (!instruction.trim() || targets.length === 0) return false;
    setEditBusy(true);
    setEditError(null);
    setEditNotice('');
    try {
      const revisedByKey = {};
      for (let i = 0; i < targets.length; i += 20) {
        const batch = targets.slice(i, i + 20);
        // eslint-disable-next-line no-await-in-loop
        const json = await api.post(`/api/v1/exam-system/question-banks/${bankId}/questions/ai-edit`, {
          instruction: instruction.trim(),
          questions: batch.map(toAiShape),
        });
        (json.data?.questions || []).forEach((q, idx) => { revisedByKey[batch[idx].key] = q; });
      }
      setItems((prev) => prev.map((it) => (revisedByKey[it.key] ? fromAiShape(revisedByKey[it.key], it) : it)));
      setEditNotice(ar ? `عدّل الـ AI ${targets.length} سؤال. راجع التعديلات قبل الإضافة.` : `AI edited ${targets.length} question(s). Review the changes before adding.`);
      return true;
    } catch (err) {
      setEditError(errorMessage(err));
      return false;
    } finally {
      setEditBusy(false);
    }
  }

  async function applyBulkEdit(instruction) {
    const ins = instruction ?? editInstruction;
    const ok = await reviseItems((items || []).filter((it) => it.include).map((it) => it.key), ins);
    if (ok) setEditInstruction('');
  }

  async function applyCardEdit(key) {
    const ok = await reviseItems([key], cardInstruction);
    if (ok) { setCardEditKey(null); setCardInstruction(''); }
  }

  function blockToItem(block, key) {
    const p = parseQuestionText(block);
    const type = p.type || 'mcq';
    return {
      key,
      type,
      prompt: p.prompt,
      options: type === 'mcq' && p.options.length >= 2 ? p.options : [emptyOption(), emptyOption()],
      correctAnswer: p.correctAnswer || (type === 'true_false' ? 'true' : ''),
      marks: 1,
      difficulty: 'medium',
      imageFile: null,
      include: !!p.prompt,
      // true once we know the fast local parser actually recognized a
      // shape here (options/answer found) rather than just falling back
      // to a blank mcq shell — used to decide whether to offer the AI
      // fallback below.
      recognized: type !== 'mcq' || p.options.length >= 2,
    };
  }

  // Fast, free, zero-latency first pass (src/utils/questionParsing.js,
  // same regex logic as this file's own local copy above). Blocks are
  // separated by a line containing only "---".
  function parseAll() {
    const blocks = text.split(/\n\s*-{3,}\s*\n/).map((b) => b.trim()).filter(Boolean);
    setItems(blocks.map((block, i) => blockToItem(block, i)));
    setResults(null);
    setAiError(null);
  }

  // Fallback for text the regex parser above can't make sense of — free-
  // form notes, a paragraph per question with no markers, mixed formats
  // in one paste. Sends the whole original paste to the same AI
  // integration used elsewhere on the site (Admin -> AI Controls) and
  // replaces the review list with its segmentation/classification —
  // still fully editable, nothing is saved until "Add All".
  async function parseAllWithAi() {
    if (!text.trim()) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const chunks = chunkText(text.trim());
      const aiQuestions = [];
      for (let i = 0; i < chunks.length; i += 1) {
        setAiProgress(chunks.length > 1 ? `${i + 1}/${chunks.length}` : '');
        // eslint-disable-next-line no-await-in-loop
        const json = await api.post(`/api/v1/exam-system/question-banks/${bankId}/questions/parse-ai`, { text: chunks[i] });
        aiQuestions.push(...((json.data && json.data.questions) || []));
      }
      const parsed = aiQuestions.map((q, i) => ({
        key: i,
        type: q.type,
        prompt: q.prompt,
        options: q.type === 'mcq' && q.options && q.options.length >= 2
          ? q.options.map((o) => ({ option_text: o.option_text, is_correct: !!o.is_correct }))
          : [emptyOption(), emptyOption()],
        correctAnswer: q.correct_answer || (q.type === 'true_false' ? 'true' : ''),
        marks: 1,
        difficulty: 'medium',
        include: !!q.prompt,
        recognized: true,
      }));
      setItems(parsed);
      setResults(null);
    } catch (err) {
      setAiError(errorMessage(err));
    } finally {
      setAiLoading(false);
      setAiProgress('');
    }
  }

  function updateItem(key, patch) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }
  function toggleInclude(key) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, include: !it.include } : it)));
  }
  function updateOption(key, idx, patch) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, options: it.options.map((o, i) => (i === idx ? { ...o, ...patch } : o)) } : it)));
  }
  function setCorrectOption(key, idx) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, options: it.options.map((o, i) => ({ ...o, is_correct: i === idx })) } : it)));
  }
  function addOption(key) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, options: [...it.options, emptyOption()] } : it)));
  }
  function removeOption(key, idx) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, options: it.options.filter((_, i) => i !== idx) } : it)));
  }
  function removeItem(key) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }
  function addBlankItem() {
    setItems((prev) => [
      ...(prev || []),
      { key: (prev && prev.length ? Math.max(...prev.map((it) => it.key)) : -1) + 1, type: 'mcq', prompt: '', options: [emptyOption(), emptyOption()], correctAnswer: 'true', marks: 1, difficulty: 'medium', imageFile: null, include: true },
    ]);
  }

  function itemIssue(item) {
    if (!item.prompt.trim()) return t('Type or paste your question here');
    if (item.type === 'mcq') {
      const filled = item.options.filter((o) => o.option_text.trim());
      if (filled.length < 2) return t('MCQ needs at least two options.');
      if (filled.filter((o) => o.is_correct).length !== 1) return t('Mark exactly one option as correct.');
    }
    return null;
  }

  function toPayload(item) {
    const payload = { type: item.type, prompt: item.prompt.trim(), marks: Number(item.marks) || 1, difficulty: item.difficulty };
    if (item.type === 'mcq') {
      payload.options = item.options.filter((o) => o.option_text.trim()).map((o) => ({ option_text: o.option_text.trim(), is_correct: !!o.is_correct }));
    } else if (item.type === 'true_false') {
      payload.correct_answer = item.correctAnswer === 'false' ? 'false' : 'true';
    } else if (item.type === 'short_answer' && item.correctAnswer) {
      payload.correct_answer = item.correctAnswer;
    }
    return payload;
  }

  async function handleAddAll() {
    const toAdd = items.filter((it) => it.include && !itemIssue(it));
    if (toAdd.length === 0) return;
    setSubmitting(true);
    let ok = 0, fail = 0, imgFail = 0;
    for (const item of toAdd) {
      try {
        const json = await api.post(`/api/v1/exam-system/question-banks/${bankId}/questions`, toPayload(item));
        if (item.imageFile && json.data?.id) {
          try { await uploadQuestionImage(json.data.id, item.imageFile); } catch { imgFail++; }
        }
        ok++;
      } catch (err) {
        fail++;
      }
      setResults({ done: ok + fail, total: toAdd.length, ok, fail });
    }
    setSubmitting(false);
    onSaved({ warning: imgFail ? (ar ? `تمت إضافة الأسئلة لكن فشل رفع ${imgFail} صورة — افتح السؤال للتعديل وأعد رفعها.` : `Questions added, but ${imgFail} image(s) failed to upload — edit those questions to retry.`) : null });
  }

  const includedCount = items ? items.filter((it) => it.include).length : 0;
  const readyCount = items ? items.filter((it) => it.include && !itemIssue(it)).length : 0;
  const unrecognizedCount = items ? items.filter((it) => !it.recognized).length : 0;

  return (
    <div className="card glass-panel" style={{ ...CARD, padding: 'var(--space-6)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <div>
          <h1 className="text-h2" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="sparkles" size={22} /> {t('Add Questions')}
          </h1>
          <p className="text-small" style={{ margin: 'var(--space-1) 0 0' }}>
            {ar ? 'ارفع ملف PDF أو Word فيه الأسئلة، أو الصق الأسئلة هنا. الـ AI يستخرجها وتقدر تراجعها وتعدّلها قبل الإضافة.' : 'Upload a PDF or Word file with your questions, or paste them here. AI extracts them and you can review and edit before adding.'}
          </p>
        </div>
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={submitting}>{t('Close')}</button>
      </div>

      {items === null ? (
        <>
          <div className="card glass-panel" style={{ padding: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Icon name="file" size={20} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <strong className="text-small">{ar ? 'استيراد من ملف' : 'Import from a file'}</strong>
              <p className="text-caption" style={{ margin: 0 }}>
                {fileName
                  ? `${fileName} — ${ar ? 'تم استخراج النص. اضغط «استخراج بالـ AI» أو عدّل النص أدناه.' : 'text extracted. Click "Extract with AI" or edit the text below.'}`
                  : (ar ? 'PDF أو Word (.docx) أو نص — بحد أقصى 15 ميجا. الملفات الممسوحة ضوئيًا (صور) غير مدعومة.' : 'PDF, Word (.docx) or text — up to 15 MB. Scanned (image-only) PDFs are not supported.')}
              </p>
              {fileError && <p className="text-caption" style={{ margin: '4px 0 0', color: 'var(--color-danger)' }}>{fileError}</p>}
            </div>
            <input ref={fileInput} type="file" accept={ACCEPTED_EXAM_FILES} onChange={handleFile} hidden />
            <button type="button" className="btn btn-outline" disabled={fileLoading} onClick={() => fileInput.current && fileInput.current.click()}>
              <Icon name="file" size={14} /> {fileLoading ? (ar ? 'جارٍ القراءة…' : 'Reading…') : (ar ? 'اختيار ملف' : 'Choose file')}
            </button>
          </div>
          <textarea
            className="form-input"
            rows={18}
            style={{ fontSize: 'var(--text-base, 1rem)', lineHeight: 1.7 }}
            placeholder={t('Question 1 text...\nA) option\nB) option *\n\n---\n\nQuestion 2 text...\nTrue\nFalse\nAnswer: True')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          {aiError && <p className="text-small" style={{ color: 'var(--color-danger)' }}>{aiError}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 'var(--space-3)' }}>
            <button
              type="button"
              className={fileName ? 'btn btn-primary' : 'btn btn-outline btn-sm'}
              disabled={!text.trim() || aiLoading}
              onClick={parseAllWithAi}
              title={t('For free-form notes or mixed formats the quick parser might miss')}
            >
              <Icon name="sparkles" size={14} /> {aiLoading ? `${t('Parsing with AI…')} ${aiProgress}` : (fileName ? (ar ? 'استخراج بالـ AI' : 'Extract with AI') : t('Parse with AI instead'))}
            </button>
            <button type="button" className={fileName ? 'btn btn-outline' : 'btn btn-primary'} disabled={!text.trim()} onClick={parseAll} style={{ fontSize: '1.05rem', padding: 'var(--space-3) var(--space-6)' }}>
              <Icon name="sparkles" size={16} /> {t('Parse Questions')}
            </button>
          </div>
        </>
      ) : (
        <>
          {items.length === 0 ? (
            <p className="text-small text-muted">{t('Nothing recognized — go back and check your separators (---).')}</p>
          ) : (
            <p className="text-small" style={{ margin: 0 }}>
              {t('Review before adding')} — {includedCount}/{items.length} {t('selected')}
            </p>
          )}

          {(items.length === 0 || unrecognizedCount > 0) && (
            <div className="card glass-panel" style={{ padding: 'var(--space-3) var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <Icon name="sparkles" size={16} />
              <span className="text-small" style={{ flex: 1, minWidth: 200 }}>
                {items.length === 0
                  ? t("Couldn't recognize any questions in this format. Try AI parsing instead.")
                  : t('{{count}} question(s) weren\'t fully recognized — try AI parsing to fill them in.').replace('{{count}}', unrecognizedCount)}
              </span>
              <button type="button" className="btn btn-outline btn-sm" onClick={parseAllWithAi} disabled={aiLoading}>
                <Icon name="sparkles" size={14} /> {aiLoading ? t('Parsing with AI…') : t('Parse with AI')}
              </button>
            </div>
          )}
          {aiError && <p className="text-small" style={{ color: 'var(--color-danger)', margin: 0 }}>{aiError}</p>}

          {items.length > 0 && (
            <div className="card glass-panel" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <strong className="text-small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="sparkles" size={16} /> {ar ? 'عدّل بالـ AI' : 'Edit with AI'}
              </strong>
              <p className="text-caption" style={{ margin: 0 }}>
                {ar ? `اكتب تعليمات التعديل وهتتطبق على الأسئلة المحددة (${includedCount}). تقدر تعدّل أي سؤال بنفسك بعدها.` : `Write an instruction and it is applied to the selected questions (${includedCount}). You can still edit any question by hand afterwards.`}
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {[
                  [ar ? 'صحّح الإملاء والصياغة' : 'Fix spelling & grammar', 'Fix spelling, grammar and wording without changing the meaning.'],
                  [ar ? 'اقترح الإجابة الصحيحة' : 'Suggest correct answers', 'Suggest the correct answer for each question where it is missing.'],
                  [ar ? 'اجعلها أصعب' : 'Make harder', 'Make each question harder and more analytical, keeping the topic.'],
                  [ar ? 'ترجم للإنجليزية' : 'Translate to English', 'Translate every question and option to English.'],
                  [ar ? 'ترجم للعربية' : 'Translate to Arabic', 'Translate every question and option to Arabic.'],
                ].map(([label, ins]) => (
                  <button key={label} type="button" className="btn btn-outline btn-sm" disabled={editBusy || includedCount === 0} onClick={() => applyBulkEdit(ins)}>{label}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <input
                  className="form-input"
                  style={{ flex: 1 }}
                  maxLength={500}
                  value={editInstruction}
                  onChange={(e) => setEditInstruction(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyBulkEdit(); } }}
                  placeholder={ar ? 'مثال: خلّي كل الأسئلة عن الفصل الثالث، أو أضف خيارًا رابعًا لكل سؤال' : 'e.g. add a fourth option to every question, or rewrite them for first-year students'}
                />
                <button type="button" className="btn btn-primary" disabled={editBusy || !editInstruction.trim() || includedCount === 0} onClick={() => applyBulkEdit()}>
                  <Icon name="sparkles" size={14} /> {editBusy ? (ar ? 'جارٍ التعديل…' : 'Editing…') : (ar ? 'تطبيق' : 'Apply')}
                </button>
              </div>
              {editError && <p className="text-small" style={{ margin: 0, color: 'var(--color-danger)' }}>{editError}</p>}
              {editNotice && !editError && <p className="text-small" style={{ margin: 0, color: 'var(--color-success)' }}>{editNotice}</p>}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {items.map((it, itemIdx) => {
              const issue = itemIssue(it);
              return (
                <div key={it.key} className="card glass-panel" style={{ padding: 'var(--space-4)', opacity: it.include ? 1 : 0.55, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <input type="checkbox" checked={it.include} onChange={() => toggleInclude(it.key)} />
                    <span className="text-caption" style={{ fontWeight: 700 }}>#{itemIdx + 1}</span>
                    <select className="form-input" style={{ width: 170 }} value={it.type} onChange={(e) => updateItem(it.key, { type: e.target.value })}>
                      <option value="mcq">{t('Multiple Choice')}</option>
                      <option value="true_false">{t('True / False')}</option>
                      <option value="short_answer">{t('Short Answer')}</option>
                      <option value="essay">{t('Essay')}</option>
                    </select>
                    <label className="text-caption" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {t('Marks')}
                      <input type="number" min={0} step="0.5" className="form-input" style={{ width: 72 }} value={it.marks} onChange={(e) => updateItem(it.key, { marks: e.target.value })} />
                    </label>
                    <select className="form-input" style={{ width: 130 }} value={it.difficulty} onChange={(e) => updateItem(it.key, { difficulty: e.target.value })}>
                      <option value="easy">{t('Easy')}</option>
                      <option value="medium">{t('Medium')}</option>
                      <option value="hard">{t('Hard')}</option>
                    </select>
                    <div style={{ flex: 1 }} />
                    {issue && (
                      <span className="badge badge-warning" title={issue} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Icon name="alert-triangle" size={12} /> {issue}
                      </span>
                    )}
                    <button type="button" className="btn btn-outline btn-sm" disabled={editBusy || !it.prompt.trim()} onClick={() => { setCardEditKey(cardEditKey === it.key ? null : it.key); setCardInstruction(''); }} title={ar ? 'عدّل هذا السؤال بالـ AI' : 'Edit this question with AI'}>
                      <Icon name="sparkles" size={14} />
                    </button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => removeItem(it.key)} title={t('Delete')}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>

                  {cardEditKey === it.key && (
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <input
                        className="form-input"
                        style={{ flex: 1 }}
                        autoFocus
                        maxLength={500}
                        value={cardInstruction}
                        onChange={(e) => setCardInstruction(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyCardEdit(it.key); } }}
                        placeholder={ar ? 'قل للـ AI إيه يعدّل في السؤال ده…' : 'Tell the AI what to change in this question…'}
                      />
                      <button type="button" className="btn btn-primary btn-sm" disabled={editBusy || !cardInstruction.trim()} onClick={() => applyCardEdit(it.key)}>
                        {editBusy ? '…' : (ar ? 'تطبيق' : 'Apply')}
                      </button>
                    </div>
                  )}

                  <textarea
                    className="form-input"
                    rows={2}
                    placeholder={t('Type or paste your question here')}
                    value={it.prompt}
                    onChange={(e) => updateItem(it.key, { prompt: e.target.value })}
                  />

                  <QuestionImagePicker compact file={it.imageFile || null} onFile={(f) => updateItem(it.key, { imageFile: f })} removed={false} onRemoveExisting={() => {}} ar={ar} />

                  {it.type === 'mcq' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      <p className="text-caption" style={{ margin: 0 }}>{t('Pick the circle next to the correct option.')}</p>
                      {it.options.map((opt, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-3)',
                            padding: 'var(--space-2) var(--space-3)',
                            borderRadius: 'var(--radius-md)',
                            border: `1px solid ${opt.is_correct ? 'var(--color-success)' : 'var(--glass-border)'}`,
                            background: opt.is_correct ? 'rgba(25, 200, 182, 0.08)' : 'transparent',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setCorrectOption(it.key, idx)}
                            title={t('Correct Answer')}
                            style={{
                              width: 30, height: 30, minWidth: 30, borderRadius: '50%', flexShrink: 0,
                              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                              border: `2px solid ${opt.is_correct ? 'var(--color-success)' : 'var(--glass-border)'}`,
                              background: opt.is_correct ? 'var(--color-success)' : 'transparent',
                            }}
                          >
                            {opt.is_correct && <Icon name="check" size={16} style={{ color: '#fff' }} />}
                          </button>
                          <span className="text-small" style={{ fontWeight: 700, minWidth: 18, textAlign: 'center', flexShrink: 0 }}>
                            {String.fromCharCode(65 + idx)}
                          </span>
                          <input
                            type="text"
                            className="form-input"
                            style={{ flex: 1, minWidth: 0 }}
                            placeholder={t('Options')}
                            value={opt.option_text}
                            onChange={(e) => updateOption(it.key, idx, { option_text: e.target.value })}
                          />
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => removeOption(it.key, idx)}
                            disabled={it.options.length <= 2}
                            title={t('Delete')}
                            style={{ flexShrink: 0 }}
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </div>
                      ))}
                      <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => addOption(it.key)}>
                        <Icon name="plus" size={14} /> {t('Add Option')}
                      </button>
                    </div>
                  )}

                  {it.type === 'true_false' && (
                    <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
                      <label className="text-small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="radio" name={`tf-${it.key}`} checked={it.correctAnswer === 'true'} onChange={() => updateItem(it.key, { correctAnswer: 'true' })} /> {t('True')}
                      </label>
                      <label className="text-small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="radio" name={`tf-${it.key}`} checked={it.correctAnswer === 'false'} onChange={() => updateItem(it.key, { correctAnswer: 'false' })} /> {t('False')}
                      </label>
                    </div>
                  )}

                  {it.type === 'short_answer' && (
                    <input
                      type="text"
                      className="form-input"
                      placeholder={t('Correct Answer')}
                      value={it.correctAnswer}
                      onChange={(e) => updateItem(it.key, { correctAnswer: e.target.value })}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={addBlankItem}>
            <Icon name="plus" size={14} /> {t('Add Question')}
          </button>

          {results && (
            <p className="text-small" style={{ margin: 0 }}>
              {results.done}/{results.total} — {results.ok} {t('added')}
              {results.fail > 0 && <>, {results.fail} {t('failed')}</>}
            </p>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
            <button type="button" className="btn btn-outline" onClick={() => { setItems(null); setAiError(null); }} disabled={submitting}>{t('Back')}</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={submitting || readyCount === 0}
              onClick={handleAddAll}
              style={{ fontSize: '1.05rem', padding: 'var(--space-3) var(--space-6)' }}
            >
              {submitting ? t('Adding…') : `${t('Add All')} (${readyCount})`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function emptyCriterion() {
  return { label: '', max_points: '' };
}

/**
 * Round 6 — rubric editor for one short_answer/essay question.
 * GET/PUT/DELETE /questions/{questionId}/rubric. The backend rejects a
 * save unless criteria.max_points sum to exactly the question's marks
 * (ExamSystemService::saveRubric), so this mirrors that check client-side
 * before the round-trip and disables Save until it passes.
 */
function RubricModal({ question, onClose }) {
  const t = useTranslations(translations);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [hasRubric, setHasRubric] = useState(false);
  const [criteria, setCriteria] = useState([emptyCriterion(), emptyCriterion()]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/api/v1/exam-system/questions/${question.id}/rubric`)
      .then((json) => {
        if (cancelled) return;
        const rubric = json.data;
        if (rubric?.criteria?.length) {
          setHasRubric(true);
          setCriteria(rubric.criteria.map((c) => ({ id: c.id, label: c.label, max_points: String(c.max_points) })));
        }
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [question.id]);

  const total = criteria.reduce((sum, c) => sum + (Number(c.max_points) || 0), 0);
  const totalMatches = Math.abs(total - Number(question.marks)) < 0.01;

  function updateCriterion(idx, patch) {
    setCriteria((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }
  function addCriterion() {
    setCriteria((prev) => [...prev, emptyCriterion()]);
  }
  function removeCriterion(idx) {
    setCriteria((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSave() {
    const filled = criteria.filter((c) => c.label.trim() && c.max_points !== '');
    if (filled.length === 0) {
      setError(t('A rubric needs at least one criterion.'));
      return;
    }
    if (!totalMatches) {
      setError(t('Criteria points must add up to the question\'s marks.'));
      return;
    }
    setSaving(true);
    setError(null);
    api.put(`/api/v1/exam-system/questions/${question.id}/rubric`, {
      criteria: filled.map((c) => ({ label: c.label.trim(), max_points: Number(c.max_points) })),
    })
      .then(() => { setHasRubric(true); onClose(); })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setSaving(false));
  }

  function handleDelete() {
    if (!window.confirm(t('Remove this rubric?'))) return;
    setDeleting(true);
    setError(null);
    api.del(`/api/v1/exam-system/questions/${question.id}/rubric`)
      .then(() => onClose())
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setDeleting(false));
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" style={{ maxWidth: 560, maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{t('Rubric')}</h2>
        <p className="text-caption" style={{ margin: '0 0 var(--space-3)' }}>{question.prompt}</p>

        {loading ? (
          <p className="text-small">{t('Loading…')}</p>
        ) : (
          <div style={CARD}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {criteria.map((c, idx) => (
                <div key={c.id ?? idx} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                  <input
                    className="form-input"
                    style={{ flex: 1 }}
                    placeholder={t('Criterion (e.g. Correct use of terminology)')}
                    value={c.label}
                    onChange={(e) => updateCriterion(idx, { label: e.target.value })}
                  />
                  <input
                    className="form-input"
                    type="number"
                    min={0}
                    step="0.5"
                    style={{ width: 90 }}
                    placeholder={t('Points')}
                    value={c.max_points}
                    onChange={(e) => updateCriterion(idx, { max_points: e.target.value })}
                  />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeCriterion(idx)}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
            </div>

            <button type="button" className="btn btn-outline btn-sm" onClick={addCriterion} style={{ alignSelf: 'flex-start' }}>
              <Icon name="plus" size={14} /> {t('Add Criterion')}
            </button>

            <p className={`text-small ${totalMatches ? '' : 'form-error'}`} style={{ margin: 0 }}>
              {t('Total')}: {total} / {question.marks} {t('Marks')}
            </p>

            {error && <p className="form-error">{error}</p>}

            <div className="modal-box__actions" style={{ justifyContent: hasRubric ? 'space-between' : 'flex-end' }}>
              {hasRubric && (
                <button type="button" className="btn btn-danger" disabled={deleting} onClick={handleDelete}>
                  {deleting ? '…' : t('Delete Rubric')}
                </button>
              )}
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
                <button type="button" className="btn btn-primary" disabled={saving || !totalMatches} onClick={handleSave}>
                  {saving ? '…' : t('Save Rubric')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Round 7 (Phase 6) — create/rename a pool. Membership itself (which
 * questions belong to it) is a separate step (PoolQuestionsModal below)
 * since it needs the pool's id first and is a bigger, scrollable UI.
 */
function PoolModal({ pool, bankId, onClose, onSaved }) {
  const t = useTranslations(translations);
  const isNew = !pool?.id;
  const [name, setName] = useState(pool?.name || '');
  const [description, setDescription] = useState(pool?.description || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = { name: name.trim(), description: description.trim() || null };
    try {
      if (isNew) {
        await api.post(`/api/v1/exam-system/question-banks/${bankId}/pools`, payload);
      } else {
        await api.patch(`/api/v1/exam-system/pools/${pool.id}`, payload);
      }
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{isNew ? t('New Question Pool') : t('Edit Question Pool')}</h2>
        <form onSubmit={handleSubmit} style={CARD}>
          <div className="form-group">
            <label className="form-label">{t('Pool Name')}</label>
            <input className="form-input" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Description')}</label>
            <textarea className="form-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          {error && <p className="form-error">{error}</p>}

          <div className="modal-box__actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '…' : t('Save Pool')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Round 7 (Phase 6) — manage which of the bank's questions belong to this
 * pool. GET /pools/{id} for current membership (question_ids), then a full
 * replace via PUT /pools/{id}/questions ({question_ids: [...]}) on save —
 * matches ExamSystemService::syncPoolQuestions (server re-validates every
 * id still belongs to the pool's own bank).
 */
function PoolQuestionsModal({ pool, bankQuestions, onClose, onSaved }) {
  const t = useTranslations(translations);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/api/v1/exam-system/pools/${pool.id}`)
      .then((json) => { if (!cancelled) setSelected(new Set(json.data?.question_ids || [])); })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [pool.id]);

  function toggle(questionId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) next.delete(questionId); else next.add(questionId);
      return next;
    });
  }

  function handleSave() {
    setSaving(true);
    setError(null);
    api.put(`/api/v1/exam-system/pools/${pool.id}/questions`, { question_ids: Array.from(selected) })
      .then(() => onSaved())
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setSaving(false));
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" style={{ maxWidth: 640, maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{t('Pool Questions')}</h2>
        <p className="text-caption" style={{ margin: '0 0 var(--space-3)' }}>{pool.name}</p>

        {loading ? (
          <p className="text-small">{t('Loading…')}</p>
        ) : bankQuestions.length === 0 ? (
          <p className="text-small">{t('This bank has no questions yet.')}</p>
        ) : (
          <div style={CARD}>
            <p className="text-caption" style={{ margin: 0 }}>{t('Selected')}: {selected.size}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', maxHeight: 360, overflowY: 'auto' }}>
              {bankQuestions.map((q) => (
                <label
                  key={q.id}
                  className="text-small"
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2)', borderBottom: '1px solid var(--border-subtle)' }}
                >
                  <input type="checkbox" checked={selected.has(q.id)} onChange={() => toggle(q.id)} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.prompt}</span>
                  <span className="text-caption">{t(TYPE_LABELS[q.type] || q.type)} · {t(DIFFICULTY_LABELS[q.difficulty] || q.difficulty)}</span>
                </label>
              ))}
            </div>

            {error && <p className="form-error">{error}</p>}

            <div className="modal-box__actions">
              <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
                {saving ? '…' : t('Save Questions')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AcademicStaffQuestionBankDetail() {
  const { id } = useParams();
  const t = useTranslations(translations);
  const { locale: pageLocale } = useLanguage();
  const isAr = pageLocale === 'ar';
  const [bank, setBank] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [editing, setEditing] = useState(null); // existing question object | null (edit only)
  const [editingRubric, setEditingRubric] = useState(null); // question object | null
  const [adding, setAdding] = useState(false); // full-page "Add Questions" panel
  const [manualMenu, setManualMenu] = useState(false); // "Add manually" type menu
  const [qSearch, setQSearch] = useState('');
  const [qType, setQType] = useState('all');
  const [qDiff, setQDiff] = useState('all');

  // Round 7 — Question Pools
  const [pools, setPools] = useState([]);
  const [poolsLoading, setPoolsLoading] = useState(true);
  const [editingPool, setEditingPool] = useState(null); // pool object | {} for new | null
  const [managingPool, setManagingPool] = useState(null); // pool object | null

  const load = useCallback(() => {
    return api.get(`/api/v1/exam-system/question-banks/${id}`).then((json) => setBank(json.data));
  }, [id]);

  const loadPools = useCallback(() => {
    return api.get(`/api/v1/exam-system/question-banks/${id}/pools`).then((json) => setPools(json.data || []));
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load().catch((err) => setError(errorMessage(err))).finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    setPoolsLoading(true);
    loadPools().catch((err) => setActionError(errorMessage(err))).finally(() => setPoolsLoading(false));
  }, [loadPools]);

  function handleSaved(opts) {
    // "Save & Add Another" keeps the modal open — only close it on a normal save.
    if (!opts?.keepOpen) setEditing(null);
    setActionError(opts?.warning || null);
    load();
  }

  function handlePoolSaved() {
    setEditingPool(null);
    loadPools();
  }

  function handlePoolQuestionsSaved() {
    setManagingPool(null);
    loadPools();
  }

  async function handleDeletePool(pool) {
    if (!window.confirm(t('Delete this question pool? It will also be removed from any exams using it.'))) return;
    setActionError(null);
    try {
      await api.del(`/api/v1/exam-system/pools/${pool.id}`);
      loadPools();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleDelete(question) {
    if (!window.confirm(t('Delete this question?'))) return;
    setActionError(null);
    try {
      await api.del(`/api/v1/exam-system/questions/${question.id}`);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  if (loading) return <p className="text-small" style={{ padding: 'var(--space-5)' }}>{t('Loading…')}</p>;
  if (error) return <p className="form-error" style={{ padding: 'var(--space-5)' }}>{error}</p>;
  if (!bank) return null;

  const questions = bank.questions || [];
  const needle = qSearch.trim().toLowerCase();
  const filteredQuestions = questions.filter((q) => (
    (qType === 'all' || q.type === qType)
    && (qDiff === 'all' || q.difficulty === qDiff)
    && (!needle || String(q.prompt || '').toLowerCase().includes(needle)
      || (q.options || []).some((o) => String(o.option_text || '').toLowerCase().includes(needle)))
  ));
  const totalMarks = questions.reduce((sum, q) => sum + (Number(q.marks) || 0), 0);

  const MANUAL_TYPES = [
    { value: 'mcq', ar: 'اختيار من متعدد', icon: 'check-circle' },
    { value: 'true_false', ar: 'صح / خطأ', icon: 'check' },
    { value: 'short_answer', ar: 'إجابة قصيرة', icon: 'edit' },
    { value: 'essay', ar: 'مقالي', icon: 'file' },
  ];
  const manualMenuEl = (
    <div className={`dropdown${manualMenu ? ' is-open' : ''}`} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setManualMenu(false); }}>
      <button type="button" className="btn btn-outline" aria-haspopup="menu" aria-expanded={manualMenu} onClick={() => setManualMenu((v) => !v)}>
        <Icon name="edit" size={16} /> {isAr ? 'إضافة سؤال يدوي' : 'Add manually'} <Icon name="chevron-down" size={14} />
      </button>
      <div className="dropdown__menu" role="menu">
        {MANUAL_TYPES.map((mt) => (
          <button
            key={mt.value}
            type="button"
            role="menuitem"
            className="dropdown__item"
            onClick={() => { setManualMenu(false); setEditing({ bankId: bank.id, type: mt.value, manual: true }); }}
          >
            <Icon name={mt.icon} size={14} /> {isAr ? mt.ar : t(TYPE_LABELS[mt.value])}
          </button>
        ))}
      </div>
    </div>
  );

  if (adding) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        <div>
          <button type="button" className="text-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit' }} onClick={() => setAdding(false)}>
            <Icon name="chevron-left" size={14} /> {bank.title}
          </button>
        </div>
        <AddQuestionsPanel
          bankId={bank.id}
          onClose={() => setAdding(false)}
          onSaved={(opts) => { setAdding(false); setActionError(opts?.warning || null); load(); }}
        />
      </div>
    );
  }

  return (
    <div className="qb-page" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div>
        <Link to="/academic-staff/question-banks" className="text-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon name="chevron-left" size={14} /> {t('Back to Question Banks')}
        </Link>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div>
          <h1 className="text-h2" style={{ margin: 0 }}>{bank.title}</h1>
          {bank.subject && <p className="text-small" style={{ margin: 'var(--space-1) 0 0' }}>{bank.subject}</p>}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {manualMenuEl}
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> {t('Add Question')}
          </button>
        </div>
      </div>

      {actionError && <p className="form-error">{actionError}</p>}

      {questions.length === 0 ? (
        <div className="card glass-panel empty-state">
          <Icon name="edit" size={32} className="empty-state__icon" />
          <p className="text-small">{t('No questions in this bank yet.')}</p>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> {t('Add Question')}
          </button>
        </div>
      ) : (
        <>
          <div className="qb-toolbar">
            <label className="qb-search">
              <Icon name="search" size={16} />
              <input
                type="search"
                className="form-input"
                value={qSearch}
                onChange={(e) => setQSearch(e.target.value)}
                placeholder={isAr ? 'ابحث في نص السؤال أو الاختيارات…' : 'Search question text or options…'}
              />
            </label>
            <select className="form-input qb-select" value={qType} onChange={(e) => setQType(e.target.value)} aria-label={isAr ? 'نوع السؤال' : 'Question type'}>
              <option value="all">{isAr ? 'كل الأنواع' : 'All types'}</option>
              {MANUAL_TYPES.map((mt) => <option key={mt.value} value={mt.value}>{isAr ? mt.ar : t(TYPE_LABELS[mt.value])}</option>)}
            </select>
            <select className="form-input qb-select" value={qDiff} onChange={(e) => setQDiff(e.target.value)} aria-label={isAr ? 'الصعوبة' : 'Difficulty'}>
              <option value="all">{isAr ? 'كل المستويات' : 'All levels'}</option>
              <option value="easy">{isAr ? 'سهل' : 'Easy'}</option>
              <option value="medium">{isAr ? 'متوسط' : 'Medium'}</option>
              <option value="hard">{isAr ? 'صعب' : 'Hard'}</option>
            </select>
          </div>
          <p className="qb-summary">
            {isAr
              ? <>عرض <b>{filteredQuestions.length}</b> من <b>{questions.length}</b> سؤال · إجمالي الدرجات <b>{totalMarks}</b></>
              : <>Showing <b>{filteredQuestions.length}</b> of <b>{questions.length}</b> questions · total marks <b>{totalMarks}</b></>}
          </p>

          {filteredQuestions.length === 0 ? (
            <div className="card glass-panel empty-state">
              <p className="text-small">{isAr ? 'مفيش أسئلة مطابقة للبحث أو الفلتر.' : 'No questions match your search or filters.'}</p>
              <button type="button" className="btn btn-outline" onClick={() => { setQSearch(''); setQType('all'); setQDiff('all'); }}>
                {isAr ? 'مسح الفلاتر' : 'Clear filters'}
              </button>
            </div>
          ) : (
            <div className="qb-list">
              {filteredQuestions.map((q) => (
                <QuestionBankCard
                  key={q.id}
                  q={q}
                  index={questions.indexOf(q)}
                  ar={isAr}
                  canRubric={AI_GRADABLE_TYPES.includes(q.type)}
                  onRubric={() => setEditingRubric(q)}
                  onEdit={() => setEditing({ ...q, bankId: bank.id })}
                  onDelete={() => handleDelete(q)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Round 7 — Question Pools */}
      <div className="card glass-panel" style={CARD}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <div>
            <h2 className="text-h3" style={{ margin: 0 }}>{t('Question Pools')}</h2>
            <p className="text-caption" style={{ margin: 'var(--space-1) 0 0' }}>
              {t('A pool draws a random sample of questions per student when attached to an exam.')}
            </p>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditingPool({})}>
            <Icon name="plus" size={14} /> {t('New Pool')}
          </button>
        </div>

        {poolsLoading ? (
          <p className="text-small">{t('Loading…')}</p>
        ) : pools.length === 0 ? (
          <p className="text-small">{t('No question pools yet.')}</p>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('Pool Name')}</th>
                  <th>{t('Description')}</th>
                  <th>{t('Question Count')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pools.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td style={{ maxWidth: 320 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.description || <span className="text-caption">—</span>}
                      </span>
                    </td>
                    <td>{p.questions_count || 0}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setManagingPool(p)}>
                          <Icon name="layers" size={14} /> {t('Manage Questions')}
                        </button>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditingPool(p)}>
                          <Icon name="edit" size={14} />
                        </button>
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDeletePool(p)}>
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {questions.length > 0 && <QuestionQualityPanel mode="bank" id={bank.id} />}

      {editing && <QuestionModal question={editing} onClose={() => setEditing(null)} onSaved={handleSaved} />}
      {editingRubric && <RubricModal question={editingRubric} onClose={() => setEditingRubric(null)} />}
      {editingPool && <PoolModal pool={editingPool} bankId={bank.id} onClose={() => setEditingPool(null)} onSaved={handlePoolSaved} />}
      {managingPool && (
        <PoolQuestionsModal
          pool={managingPool}
          bankQuestions={questions}
          onClose={() => setManagingPool(null)}
          onSaved={handlePoolQuestionsSaved}
        />
      )}
    </div>
  );
}
