import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nExam from '../../i18n/academic-staff/exam-system';

const translations = { ...i18nCommon, ...i18nExam };

/**
 * Round 1 (Foundation) — GET/PATCH /api/v1/exam-system/exams/{id}
 * (ExamSystemApiController::showExam/updateExam -> ExamSystemService::
 * examDetail(), manual questions only — question_pools is Round 7, shown
 * read-only below if any already exist so this page doesn't hide state
 * created elsewhere). Question attach/detach/reorder: POST .../questions,
 * DELETE .../questions/{examQuestionId}, PATCH .../questions/reorder.
 *
 * Deliberately NOT here yet (later rounds, per the agreed frontend
 * roadmap): security mode toggle beyond what's already stored (Round 5),
 * AI grading config (Round 6). Targeting/publish (Round 2) and attempts/
 * grading (Round 4) are linked out to their own pages above.
 * secure_mode_enabled/max_violations fields already exist on the exam
 * record but their real UI lands with Round 5 — this page doesn't expose
 * them to avoid presenting half a feature.
 *
 * Round 7 (Question Pools + Randomization) — randomize_questions/
 * randomize_options were already plain columns on Exam since Round 1, so
 * the checkboxes below just needed wiring, nothing new to add for them.
 * What Round 7 actually adds here is the pool-attachment UI: POST/PATCH/
 * DELETE /exams/{id}/pools(/{configId}) (ExamSystemApiController::
 * attachExamPool/updateExamPool/detachExamPool -> ExamSystemService::
 * attachPoolToExam/updatePoolOnExam/detachPoolFromExam). exam.total_marks
 * already folds in pool subtotals server-side (examDetail()), so this page
 * doesn't need to compute that itself — same as it already didn't for
 * manual questions.
 */

const CARD = { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' };
const TYPE_LABELS = { mcq: 'Multiple Choice', true_false: 'True / False', short_answer: 'Short Answer', essay: 'Essay' };
const STATUS_META = {
  draft: { cls: 'badge-neutral', key: 'Draft' },
  scheduled: { cls: 'badge-primary', key: 'Scheduled' },
  published: { cls: 'badge-success', key: 'Published' },
};

function toLocalInput(iso) {
  if (!iso) return '';
  // API values are UTC — show them in the browser's local time.
  let s = String(iso).trim().replace(' ', 'T');
  if (/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += 'Z';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Local "YYYY-MM-DDTHH:mm" from the form → UTC instant for the API.
function toUtcIso(local) {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// YYYY-MM-DDTHH:mm in the browser's LOCAL time (matches what a
// datetime-local input holds) — used by the quick-pick buttons below so
// "Now" / "+1 hour" etc. land on the same value the user would get typing
// it in by hand, not a UTC-shifted one.
function toLocalValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Friendlier replacement for a bare <input type="datetime-local">: same
 * underlying value/format (so handleSaveDetails / the API payload don't
 * change at all), but split into separate date + time inputs — the
 * combined native widget is what people mean by "too complicated" here,
 * since date and time end up as one fiddly segmented control — plus a row
 * of one-click presets for the common cases (start now, end of day, a
 * week from now, no date at all) so most exams never need manual typing.
 */
function SmartDateTimeField({ label, value, onChange, presets }) {
  const [datePart, timePart] = value ? value.split('T') : ['', ''];

  function setDatePart(d) {
    onChange(d ? `${d}T${timePart || '09:00'}` : '');
  }

  function setTimePart(tm) {
    if (!datePart) return; // no date chosen yet — nothing to attach a time to
    onChange(`${datePart}T${tm || '00:00'}`);
  }

  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <input
          className="form-input"
          type="date"
          style={{ flex: '1 1 140px' }}
          value={datePart}
          onChange={(e) => setDatePart(e.target.value)}
        />
        <input
          className="form-input"
          type="time"
          style={{ flex: '1 1 100px' }}
          value={timePart}
          disabled={!datePart}
          onChange={(e) => setTimePart(e.target.value)}
        />
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => onChange(p.value())}
          >
            {p.label}
          </button>
        ))}
        {value && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onChange('')}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
}


/**
 * Round 7 — attach a new pool config, or edit an existing one's numbers.
 * The pool itself (question_pool_id) can only be chosen once, at creation
 * — updatePoolOnExam's validator marks it `prohibited` on edit, matching
 * ExamQuestionPool's own unique(exam_id, question_pool_id) constraint — so
 * editing only ever touches questions_to_select/marks_per_question/
 * difficulty_distribution.
 *
 * Difficulty distribution is the only randomization axis exposed here
 * (topic_distribution stays API-only) — topics are free-text per question
 * with no fixed set, so a UI for it would mean the instructor typing exact
 * topic strings back at the system; difficulty already covers the common
 * "make sure the sample isn't all easy questions" case the backend docblock
 * flags as the actual design intent (Phase 6: "Do not overcomplicate the
 * UI unless necessary").
 */
export function ExamPoolModal({ examId, config, banks, onClose, onSaved }) {
  const t = useTranslations(translations);
  const isNew = !config;
  const [bankId, setBankId] = useState('');
  const [pools, setPools] = useState([]);
  const [poolsLoading, setPoolsLoading] = useState(false);
  const [poolId, setPoolId] = useState('');
  const [poolDetail, setPoolDetail] = useState(null);
  const [questionsToSelect, setQuestionsToSelect] = useState(config?.questions_to_select || 5);
  const [marksPerQuestion, setMarksPerQuestion] = useState(config?.marks_per_question || 1);
  const [useDistribution, setUseDistribution] = useState(!!config?.difficulty_distribution);
  const [dist, setDist] = useState({
    easy: config?.difficulty_distribution?.easy ?? '',
    medium: config?.difficulty_distribution?.medium ?? '',
    hard: config?.difficulty_distribution?.hard ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Editing: resolve the existing pool's bank + full question list (for
  // the difficulty-availability hints) up front — bank/pool are read-only.
  useEffect(() => {
    if (isNew || !config) return;
    api.get(`/api/v1/exam-system/pools/${config.question_pool_id}`)
      .then((json) => setPoolDetail(json.data))
      .catch(() => {});
  }, [isNew, config]);

  // New: load the selected bank's pools.
  useEffect(() => {
    if (!isNew || !bankId) { setPools([]); return; }
    setPoolsLoading(true);
    api.get(`/api/v1/exam-system/question-banks/${bankId}/pools`)
      .then((json) => setPools(json.data || []))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setPoolsLoading(false));
  }, [isNew, bankId]);

  // New: load the selected pool's full detail for difficulty counts.
  useEffect(() => {
    if (!isNew || !poolId) { setPoolDetail(null); return; }
    api.get(`/api/v1/exam-system/pools/${poolId}`).then((json) => setPoolDetail(json.data)).catch(() => {});
  }, [isNew, poolId]);

  const difficultyCounts = useMemo(() => {
    const counts = { easy: 0, medium: 0, hard: 0 };
    (poolDetail?.questions || []).forEach((q) => { if (counts[q.difficulty] !== undefined) counts[q.difficulty] += 1; });
    return counts;
  }, [poolDetail]);

  const distTotal = (Number(dist.easy) || 0) + (Number(dist.medium) || 0) + (Number(dist.hard) || 0);
  const distMatches = !useDistribution || distTotal === (Number(questionsToSelect) || 0);
  const availableCount = isNew
    ? (pools.find((p) => String(p.id) === String(poolId))?.questions_count ?? 0)
    : (config.pool_question_count ?? 0);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (isNew && !poolId) {
      setError(t('Select a question pool.'));
      return;
    }
    if (useDistribution && !distMatches) {
      setError(t('Difficulty counts must add up to the number of questions to select.'));
      return;
    }
    setSaving(true);
    const payload = {
      questions_to_select: Number(questionsToSelect) || 1,
      marks_per_question: Number(marksPerQuestion) || 0,
      difficulty_distribution: useDistribution
        ? { easy: Number(dist.easy) || 0, medium: Number(dist.medium) || 0, hard: Number(dist.hard) || 0 }
        : null,
    };
    try {
      if (isNew) {
        await api.post(`/api/v1/exam-system/exams/${examId}/pools`, { ...payload, question_pool_id: Number(poolId) });
      } else {
        await api.patch(`/api/v1/exam-system/exams/${examId}/pools/${config.id}`, payload);
      }
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" style={{ maxWidth: 560, maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{isNew ? t('Attach Question Pool') : t('Edit Pool Configuration')}</h2>
        <form onSubmit={handleSubmit} style={CARD}>
          {isNew ? (
            <>
              <div className="form-group">
                <label className="form-label">{t('Question Bank')}</label>
                <select className="form-input" value={bankId} onChange={(e) => { setBankId(e.target.value); setPoolId(''); }}>
                  <option value="">{t('Select a question bank…')}</option>
                  {banks.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
                </select>
              </div>
              {bankId && (
                <div className="form-group">
                  <label className="form-label">{t('Question Pool')}</label>
                  {poolsLoading ? (
                    <p className="text-small">{t('Loading…')}</p>
                  ) : pools.length === 0 ? (
                    <p className="text-small">{t('This bank has no question pools yet.')}</p>
                  ) : (
                    <select className="form-input" value={poolId} onChange={(e) => setPoolId(e.target.value)}>
                      <option value="">{t('Select a pool…')}</option>
                      {pools.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} ({p.questions_count} {t('questions')})</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-small" style={{ margin: 0 }}>
              <strong>{config.pool_name}</strong> — {availableCount} {t('questions')} {t('available')}
            </p>
          )}

          <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="form-group">
              <label className="form-label">{t('Questions to Select')}</label>
              <input className="form-input" type="number" min="1" required value={questionsToSelect} onChange={(e) => setQuestionsToSelect(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('Marks per Question')}</label>
              <input className="form-input" type="number" min="0.25" step="0.25" required value={marksPerQuestion} onChange={(e) => setMarksPerQuestion(e.target.value)} />
            </div>
          </div>

          {availableCount > 0 && Number(questionsToSelect) > availableCount && (
            <p className="form-error" style={{ margin: 0 }}>
              {t('This pool only has')} {availableCount} {t('question(s), but you are asking for')} {questionsToSelect}.
            </p>
          )}

          <label className="text-small" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <input type="checkbox" checked={useDistribution} onChange={(e) => setUseDistribution(e.target.checked)} />
            {t('Control how many questions come from each difficulty level')}
          </label>

          {useDistribution && (
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">{t('Easy')}{difficultyCounts.easy ? ` (${difficultyCounts.easy} ${t('available')})` : ''}</label>
                <input className="form-input" type="number" min="0" value={dist.easy} onChange={(e) => setDist((d) => ({ ...d, easy: e.target.value }))} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">{t('Medium')}{difficultyCounts.medium ? ` (${difficultyCounts.medium} ${t('available')})` : ''}</label>
                <input className="form-input" type="number" min="0" value={dist.medium} onChange={(e) => setDist((d) => ({ ...d, medium: e.target.value }))} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">{t('Hard')}{difficultyCounts.hard ? ` (${difficultyCounts.hard} ${t('available')})` : ''}</label>
                <input className="form-input" type="number" min="0" value={dist.hard} onChange={(e) => setDist((d) => ({ ...d, hard: e.target.value }))} />
              </div>
            </div>
          )}

          {useDistribution && (
            <p className={`text-small ${distMatches ? '' : 'form-error'}`} style={{ margin: 0 }}>
              {t('Total')}: {distTotal} / {questionsToSelect || 0}
            </p>
          )}

          {error && <p className="form-error">{error}</p>}

          <div className="modal-box__actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving || (useDistribution && !distMatches)}>
              {saving ? '…' : t('Save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AcademicStaffExamBuilder() {
  const { id } = useParams();
  const t = useTranslations(translations);

  const [exam, setExam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);

  // Metadata form state
  const [form, setForm] = useState(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsSaved, setDetailsSaved] = useState(false);

  // Add-from-bank state
  const [banks, setBanks] = useState([]);
  const [selectedBankId, setSelectedBankId] = useState('');
  const [bankQuestions, setBankQuestions] = useState([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [overrides, setOverrides] = useState({}); // question_id -> marks override string

  // Round 7 — pool config attach/edit
  const [editingPoolConfig, setEditingPoolConfig] = useState(null); // null closed | 'new' | config object

  const load = useCallback(() => {
    return api.get(`/api/v1/exam-system/exams/${id}`).then((json) => {
      setExam(json.data);
      setForm({
        title: json.data.title || '',
        description: json.data.description || '',
        subject: json.data.subject || '',
        academic_year: json.data.academic_year || '',
        semester: json.data.semester || '',
        duration_minutes: json.data.duration_minutes || 60,
        start_at: toLocalInput(json.data.start_at),
        end_at: toLocalInput(json.data.end_at),
        max_attempts: json.data.max_attempts || 1,
        passing_score: json.data.passing_score ?? '',
        instructions: json.data.instructions || '',
        result_visibility: json.data.result_visibility || 'after_close',
        randomize_questions: !!json.data.randomize_questions,
        randomize_options: !!json.data.randomize_options,
      });
    });
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load().catch((err) => setError(errorMessage(err))).finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    api.get('/api/v1/exam-system/question-banks').then((json) => setBanks(json.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedBankId) {
      setBankQuestions([]);
      return;
    }
    setBankLoading(true);
    api.get(`/api/v1/exam-system/question-banks/${selectedBankId}`)
      .then((json) => setBankQuestions(json.data?.questions || []))
      .catch((err) => setActionError(errorMessage(err)))
      .finally(() => setBankLoading(false));
  }, [selectedBankId]);

  const attachedQuestionIds = useMemo(
    () => new Set((exam?.questions || []).map((q) => q.question_id)),
    [exam]
  );

  async function handleSaveDetails(e) {
    e.preventDefault();
    setSavingDetails(true);
    setActionError(null);
    setDetailsSaved(false);
    try {
      const payload = {
        ...form,
        duration_minutes: Number(form.duration_minutes) || 1,
        max_attempts: Number(form.max_attempts) || 1,
        passing_score: form.passing_score === '' ? null : Number(form.passing_score),
        start_at: toUtcIso(form.start_at),
        end_at: toUtcIso(form.end_at),
      };
      const json = await api.patch(`/api/v1/exam-system/exams/${id}`, payload);
      setExam((prev) => ({ ...prev, ...json.data }));
      setDetailsSaved(true);
      setTimeout(() => setDetailsSaved(false), 2000);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSavingDetails(false);
    }
  }

  async function handleAddQuestion(questionId) {
    setActionError(null);
    const overrideRaw = overrides[questionId];
    const marksOverride = overrideRaw ? Number(overrideRaw) : null;
    try {
      const json = await api.post(`/api/v1/exam-system/exams/${id}/questions`, {
        question_id: questionId,
        marks_override: marksOverride,
      });
      setExam(json.data);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleRemoveQuestion(examQuestionId) {
    if (!window.confirm(t('Remove this question from the exam?'))) return;
    setActionError(null);
    try {
      const json = await api.del(`/api/v1/exam-system/exams/${id}/questions/${examQuestionId}`);
      setExam(json.data);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleReorder(fromIdx, toIdx) {
    const list = [...(exam.questions || [])];
    if (toIdx < 0 || toIdx >= list.length) return;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    setExam((prev) => ({ ...prev, questions: list }));
    setActionError(null);
    try {
      const json = await api.patch(`/api/v1/exam-system/exams/${id}/questions/reorder`, {
        order: list.map((q) => q.exam_question_id),
      });
      setExam(json.data);
    } catch (err) {
      setActionError(errorMessage(err));
      load();
    }
  }

  async function handleDetachPool(configId) {
    if (!window.confirm(t('Remove this question pool from the exam?'))) return;
    setActionError(null);
    try {
      const json = await api.del(`/api/v1/exam-system/exams/${id}/pools/${configId}`);
      setExam(json.data);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  function handlePoolConfigSaved() {
    setEditingPoolConfig(null);
    load();
  }

  if (loading) return <p className="text-small" style={{ padding: 'var(--space-5)' }}>{t('Loading…')}</p>;
  if (error) return <p className="form-error" style={{ padding: 'var(--space-5)' }}>{error}</p>;
  if (!exam || !form) return null;

  const questions = exam.questions || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div>
        <Link to="/academic-staff/exams" className="text-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon name="chevron-left" size={14} /> {t('Back to Exams')}
        </Link>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <h1 className="text-h2" style={{ margin: 0 }}>{exam.title}</h1>
          <span className={`badge ${(STATUS_META[exam.status] || STATUS_META.draft).cls}`}>
            {t((STATUS_META[exam.status] || STATUS_META.draft).key)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Link to={`/academic-staff/exams/${id}/attempts`} className="btn btn-outline btn-sm">
            {t('View Attempts & Grading')}
          </Link>
          <Link to={`/academic-staff/exams/${id}/targets`} className="btn btn-outline btn-sm">
            {t('Manage Targeting & Publish')}
          </Link>
          <Link to={`/academic-staff/exams/${id}/analytics`} className="btn btn-outline btn-sm">
            {t('Analytics')}
          </Link>
        </div>
      </div>

      {actionError && <p className="form-error">{actionError}</p>}

      {/* Exam details */}
      <div className="card glass-panel" style={CARD}>
        <h2 className="text-h3" style={{ margin: 0 }}>{t('Exam Details')}</h2>
        <form onSubmit={handleSaveDetails} style={CARD}>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">{t('Title')}</label>
              <input className="form-input" required maxLength={200} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('Subject')}</label>
              <input className="form-input" maxLength={150} value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">{t('Description')}</label>
            <textarea className="form-input" rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">{t('Duration (minutes)')}</label>
              <input className="form-input" type="number" min="1" required value={form.duration_minutes} onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('Max Attempts')}</label>
              <input className="form-input" type="number" min="1" max="10" value={form.max_attempts} onChange={(e) => setForm((f) => ({ ...f, max_attempts: e.target.value }))} />
            </div>
          </div>

          <div className="grid-2">
            <SmartDateTimeField
              label={t('Start Date (optional)')}
              value={form.start_at}
              onChange={(v) => setForm((f) => ({ ...f, start_at: v }))}
              presets={[
                { label: t('Now'), value: () => toLocalValue(new Date()) },
                { label: t('Tomorrow 9 AM'), value: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return toLocalValue(d); } },
                { label: t('In a week'), value: () => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0); return toLocalValue(d); } },
              ]}
            />
            <SmartDateTimeField
              label={t('End Date (optional)')}
              value={form.end_at}
              onChange={(v) => setForm((f) => ({ ...f, end_at: v }))}
              presets={[
                {
                  label: t('1 hour after start'),
                  value: () => {
                    const base = form.start_at ? new Date(form.start_at) : new Date();
                    base.setHours(base.getHours() + 1);
                    return toLocalValue(base);
                  },
                },
                {
                  label: t('End of that day'),
                  value: () => {
                    const base = form.start_at ? new Date(form.start_at) : new Date();
                    const eod = startOfDay(base);
                    eod.setHours(23, 59, 0, 0);
                    return toLocalValue(eod);
                  },
                },
              ]}
            />
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">{t('Passing Score (optional)')}</label>
              <input className="form-input" type="number" min="0" step="0.5" value={form.passing_score} onChange={(e) => setForm((f) => ({ ...f, passing_score: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('Result Visibility')}</label>
              <select className="form-input" value={form.result_visibility} onChange={(e) => setForm((f) => ({ ...f, result_visibility: e.target.value }))}>
                <option value="immediate">{t('Immediately after submission')}</option>
                <option value="after_close">{t('After the exam closes')}</option>
                <option value="manual">{t('Manual (I publish results myself)')}</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">{t('Instructions (shown to students before starting)')}</label>
            <textarea className="form-input" rows={3} value={form.instructions} onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <label className="text-small" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <input type="checkbox" checked={form.randomize_questions} onChange={(e) => setForm((f) => ({ ...f, randomize_questions: e.target.checked }))} />
              {t('Randomize question order per student')}
            </label>
            <label className="text-small" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <input type="checkbox" checked={form.randomize_options} onChange={(e) => setForm((f) => ({ ...f, randomize_options: e.target.checked }))} />
              {t('Randomize option order per student')}
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <button type="submit" className="btn btn-primary" disabled={savingDetails}>{savingDetails ? '…' : t('Save Details')}</button>
            {detailsSaved && <span className="text-caption" style={{ color: 'var(--color-success)' }}>{t('Exam updated.')}</span>}
          </div>
        </form>
      </div>

      {/* Attached questions */}
      <div className="card glass-panel" style={CARD}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="text-h3" style={{ margin: 0 }}>{t('Exam Questions')}</h2>
          <span className="text-caption">{t('Total Marks')}: {exam.total_marks}</span>
        </div>

        {questions.length === 0 ? (
          <p className="text-small">{t('No questions attached to this exam yet.')} {t('Add questions from your question banks below.')}</p>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th></th>
                  <th>{t('Prompt')}</th>
                  <th>{t('Type')}</th>
                  <th>{t('Marks')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {questions.map((q, idx) => (
                  <tr key={q.exam_question_id}>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <button type="button" className="btn btn-outline btn-sm" disabled={idx === 0} onClick={() => handleReorder(idx, idx - 1)} title={t('Move Up')}>
                          <Icon name="chevron-right" size={12} style={{ transform: 'rotate(-90deg)' }} />
                        </button>
                        <button type="button" className="btn btn-outline btn-sm" disabled={idx === questions.length - 1} onClick={() => handleReorder(idx, idx + 1)} title={t('Move Down')}>
                          <Icon name="chevron-right" size={12} style={{ transform: 'rotate(90deg)' }} />
                        </button>
                      </div>
                    </td>
                    <td style={{ maxWidth: 360 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.image_url && <Icon name="image" size={13} style={{ marginInlineEnd: 6, verticalAlign: '-2px' }} />}{q.prompt}</span>
                    </td>
                    <td>{t(TYPE_LABELS[q.type] || q.type)}</td>
                    <td>
                      {q.marks}
                      {q.marks_override !== null && <span className="text-caption"> ({t('default')}: {q.default_marks})</span>}
                    </td>
                    <td>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => handleRemoveQuestion(q.exam_question_id)}>
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <hr style={{ border: 'none', borderTop: '1px solid var(--border-subtle)' }} />

        {/* Round 7 — Question Pools attached to this exam */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <h3 className="text-h3" style={{ margin: 0 }}>{t('Question Pools')}</h3>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditingPoolConfig('new')}>
            <Icon name="plus" size={14} /> {t('Attach Pool')}
          </button>
        </div>

        {(!exam.question_pools || exam.question_pools.length === 0) ? (
          <p className="text-small">{t('No question pools attached to this exam yet.')}</p>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('Pool Name')}</th>
                  <th>{t('Questions to Select')}</th>
                  <th>{t('Marks per Question')}</th>
                  <th>{t('Total')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {exam.question_pools.map((cfg) => (
                  <tr key={cfg.id}>
                    <td style={{ fontWeight: 600 }}>
                      {cfg.pool_name}
                      {cfg.difficulty_distribution && (
                        <div className="text-caption">
                          {t('Easy')}: {cfg.difficulty_distribution.easy || 0} · {t('Medium')}: {cfg.difficulty_distribution.medium || 0} · {t('Hard')}: {cfg.difficulty_distribution.hard || 0}
                        </div>
                      )}
                    </td>
                    <td>{cfg.questions_to_select}</td>
                    <td>{cfg.marks_per_question}</td>
                    <td>{cfg.subtotal_marks}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditingPoolConfig(cfg)}>
                          <Icon name="edit" size={14} />
                        </button>
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDetachPool(cfg.id)}>
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

        <hr style={{ border: 'none', borderTop: '1px solid var(--border-subtle)' }} />

        <h3 className="text-h3" style={{ margin: 0 }}>{t('Add Manual Question')}</h3>
        <div className="form-group">
          <label className="form-label">{t('Add From Bank')}</label>
          <select className="form-input" value={selectedBankId} onChange={(e) => setSelectedBankId(e.target.value)}>
            <option value="">{t('Select a question bank…')}</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>{b.title}</option>
            ))}
          </select>
        </div>

        {selectedBankId && bankLoading && <p className="text-small">{t('Loading…')}</p>}

        {selectedBankId && !bankLoading && (
          bankQuestions.length === 0 ? (
            <p className="text-small">{t('This bank has no questions yet.')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {bankQuestions.map((q) => {
                const already = attachedQuestionIds.has(q.id);
                return (
                  <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <span className="text-small" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.prompt}</span>
                    <span className="text-caption">{t(TYPE_LABELS[q.type] || q.type)} · {q.marks} {t('Marks')}</span>
                    {already ? (
                      <span className="badge badge-neutral">{t('Already added')}</span>
                    ) : (
                      <>
                        <input
                          className="form-input"
                          type="number"
                          min="0.25"
                          step="0.25"
                          placeholder={t('Marks override (optional)')}
                          style={{ width: 140 }}
                          value={overrides[q.id] || ''}
                          onChange={(e) => setOverrides((prev) => ({ ...prev, [q.id]: e.target.value }))}
                        />
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => handleAddQuestion(q.id)}>
                          <Icon name="plus" size={14} /> {t('Add')}
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {editingPoolConfig && (
        <ExamPoolModal
          examId={id}
          config={editingPoolConfig === 'new' ? null : editingPoolConfig}
          banks={banks}
          onClose={() => setEditingPoolConfig(null)}
          onSaved={handlePoolConfigSaved}
        />
      )}
    </div>
  );
}
