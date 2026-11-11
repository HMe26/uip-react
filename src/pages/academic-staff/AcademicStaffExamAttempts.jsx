import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import ExamIntegrityModal from '../../components/exam/ExamIntegrityModal';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nExam from '../../i18n/academic-staff/exam-system';

const translations = { ...i18nCommon, ...i18nExam };

/**
 * roundless — GET /api/v1/exam-system/exams/{id}/attempts
 * (ExamGradingApiController::indexAttempts -> ExamGradingService::
 * listAttemptsForExam()), "with grading progress" per EXAM_SYSTEM_API.md —
 * each row carries student_name/student_number (denormalized, no nested
 * student object), status, violations_count, graded_count and
 * total_questions (Round 7: pool-drawn attempts can have different
 * question counts, so this is per-attempt, not the exam's fixed count).
 *
 * Also hosts the two exam-level result actions from the same API section:
 * POST .../publish-results and POST .../unpublish-results — for
 * result_visibility=manual exams, this is how the instructor actually
 * releases scores to students (immediate/after_close exams reveal
 * automatically and don't need this, so the button always shows; the
 * backend is the source of truth for whether it's a no-op).
 *
 * Round 8 additions: a link out to the exam's analytics page (own file,
 * GET /exams/{id}/analytics) and a results export menu — GET
 * /exams/{id}/results/export?format=csv|xlsx|pdf|json
 * (ExamResultsExportApiController), a real file download behind auth so it
 * goes through fetch+Blob (same downloadExport() pattern already used by
 * AdminAiCodeReview.jsx) rather than a plain <a href>.
 */

const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf', 'json'];

const ATTEMPT_STATUS_META = {
  in_progress: { cls: 'badge-primary', key: 'In Progress' },
  submitted: { cls: 'badge-warning', key: 'Submitted' },
  auto_submitted: { cls: 'badge-warning', key: 'Auto-submitted' },
  grading: { cls: 'badge-warning', key: 'Grading' },
  graded: { cls: 'badge-success', key: 'Graded' },
  expired: { cls: 'badge-neutral', key: 'Expired' },
  cancelled: { cls: 'badge-neutral', key: 'Cancelled' },
};

const CARD = { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' };

/**
 * Instructor attempt-management dialogs (backend: ExamAttemptManagementService).
 * Every dialog works on a LIST of targets (1..n) and always calls the bulk endpoints, so the same UI serves a
 * single row and a multi-selection (e.g. a network outage hitting a whole group):
 * - CancelAttemptModal : POST .../attempts/bulk-cancel      {attempt_ids, reason, allow_retake, available_until}
 * - RetakeModal        : POST .../retake/bulk               {student_ids, extra_attempts, available_until, reason}
 * - ExtraTimeModal     : POST .../attempts/bulk-extra-time  {attempt_ids, minutes, reason}
 * - StudentPickerModal : GET  .../eligible-students?q=&without_attempts=1 then POST .../retake/bulk
 *   (give a student who missed the exam — and so has no attempt row — another chance)
 * A bulk response is {succeeded: ids[], failed: [{id, error}]}: one failing item never blocks the rest, and
 * the dialog lists exactly who failed and why. When everything fails the API answers 422 with the same
 * structure under payload.errors, which useBulkSubmit unwraps.
 */
function toIso(local) {
  return local ? new Date(local).toISOString() : null;
}

const nameOf = (a) => a.student_name || `#${a.student_id}`;

/** One row per student (a student with several attempts is listed once). */
function uniqueStudents(rows) {
  const seen = new Map();
  rows.forEach((a) => {
    if (!seen.has(a.student_id)) {
      seen.set(a.student_id, { id: a.student_id, name: nameOf(a), used: a.student_attempts_used ?? 0, extra: a.student_extra_attempts ?? 0 });
    }
  });
  return [...seen.values()];
}

/** Runs a bulk request; closes (via onDone) when everything succeeded, otherwise shows who failed and why. */
function useBulkSubmit(onDone, nameFor) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [failed, setFailed] = useState([]);
  const [okCount, setOkCount] = useState(0);

  async function run(request) {
    setSaving(true);
    setError(null);
    setFailed([]);
    try {
      const json = await request();
      const succeeded = json?.data?.succeeded || [];
      const bad = json?.data?.failed || [];
      if (bad.length === 0) {
        onDone(succeeded.length);
        return;
      }
      setOkCount(succeeded.length);
      setFailed(bad);
    } catch (err) {
      const bad = err?.payload?.errors?.failed;
      if (Array.isArray(bad) && bad.length) setFailed(bad);
      else setError(errorMessage(err));
    }
    setSaving(false);
  }

  const report = (t) => (failed.length > 0 ? (
    <div className="form-error" role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <strong>{okCount > 0 ? `${okCount} ${t('succeeded')} · ` : ''}{failed.length} {t('failed')}</strong>
      <ul style={{ margin: 0, paddingInlineStart: 18 }}>
        {failed.map((f) => <li key={f.id}>{nameFor(f.id)}: {f.error}</li>)}
      </ul>
    </div>
  ) : null);

  return { saving, error, failed, okCount, run, report };
}

function ModalShell({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" style={{ maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function TargetsLine({ names, t }) {
  const shown = names.slice(0, 5).join('، ');
  return (
    <p className="text-small" style={{ margin: 0 }}>
      <strong>{names.length > 1 ? `${names.length} ${t('students')}` : names[0]}</strong>
      {names.length > 1 && <span className="text-caption"> — {shown}{names.length > 5 ? '…' : ''}</span>}
    </p>
  );
}

function CancelAttemptModal({ examId, attempts, onClose, onDone, t }) {
  const [reason, setReason] = useState('');
  const [allowRetake, setAllowRetake] = useState(false);
  const [until, setUntil] = useState('');
  const names = attempts.map(nameOf);
  const nameFor = (id) => { const a = attempts.find((x) => x.id === id); return a ? nameOf(a) : `#${id}`; };
  const { saving, error, failed, okCount, run, report } = useBulkSubmit(onDone, nameFor);

  function submit(e) {
    e.preventDefault();
    run(() => api.post(`/api/v1/exam-system/exams/${examId}/attempts/bulk-cancel`, {
      attempt_ids: attempts.map((a) => a.id),
      reason: reason.trim() || null,
      allow_retake: allowRetake,
      available_until: allowRetake ? toIso(until) : null,
    }));
  }

  return (
    <ModalShell title={t('Cancel Attempt')} onClose={failed.length ? () => onDone(okCount) : onClose}>
      <form onSubmit={submit} style={CARD}>
        <p className="text-small" style={{ margin: 0 }}>{t('The student will be removed from the exam immediately. The attempt stays in the record as cancelled.')}</p>
        <TargetsLine names={names} t={t} />
        <div className="form-group">
          <label className="form-label">{t('Reason (shown to the student)')}</label>
          <textarea className="form-input" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={allowRetake} onChange={(e) => setAllowRetake(e.target.checked)} />
          <span className="text-small">{t('Also allow this student to retake the exam')}</span>
        </label>
        {allowRetake && (
          <div className="form-group">
            <label className="form-label">{t('Retake available until (optional)')}</label>
            <input type="datetime-local" className="form-input" value={until} onChange={(e) => setUntil(e.target.value)} />
            <p className="text-caption" style={{ margin: 'var(--space-1) 0 0' }}>{t('Leave empty to follow the exam window. Set it to let this student retake even after the exam closed.')}</p>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        {report(t)}
        <div className="modal-box__actions">
          <button type="button" className="btn btn-outline" onClick={failed.length ? () => onDone(okCount) : onClose}>{t('Close')}</button>
          {failed.length === 0 && <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '…' : t('Cancel Attempt')}</button>}
        </div>
      </form>
    </ModalShell>
  );
}

/** students: [{id, name, used?, extra?}] */
function RetakeModal({ examId, students, onClose, onDone, t }) {
  const [extra, setExtra] = useState(1);
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const nameFor = (id) => students.find((s) => s.id === id)?.name || `#${id}`;
  const { saving, error, failed, okCount, run, report } = useBulkSubmit(onDone, nameFor);

  function submit(e) {
    e.preventDefault();
    run(() => api.post(`/api/v1/exam-system/exams/${examId}/retake/bulk`, {
      student_ids: students.map((s) => s.id),
      extra_attempts: Number(extra) || 1,
      available_until: toIso(until),
      reason: reason.trim() || null,
    }));
  }

  return (
    <ModalShell title={t('Allow Retake')} onClose={failed.length ? () => onDone(okCount) : onClose}>
      <form onSubmit={submit} style={CARD}>
        <TargetsLine names={students.map((s) => s.name)} t={t} />
        {students.length === 1 && students[0].used != null && (
          <p className="text-caption" style={{ margin: 0 }}>
            {t('Attempts used')}: {students[0].used}{students[0].extra > 0 && ` (+${students[0].extra} ${t('extra')})`}
          </p>
        )}
        <div className="form-group">
          <label className="form-label">{t('Extra attempts')}</label>
          <input type="number" min={1} max={10} className="form-input" value={extra} onChange={(e) => setExtra(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">{t('Available until (optional)')}</label>
          <input type="datetime-local" className="form-input" value={until} onChange={(e) => setUntil(e.target.value)} />
          <p className="text-caption" style={{ margin: 'var(--space-1) 0 0' }}>{t('Leave empty to follow the exam window. Set it to let this student retake even after the exam closed.')}</p>
        </div>
        <div className="form-group">
          <label className="form-label">{t('Reason (optional)')}</label>
          <textarea className="form-input" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && <p className="form-error">{error}</p>}
        {report(t)}
        <div className="modal-box__actions">
          <button type="button" className="btn btn-outline" onClick={failed.length ? () => onDone(okCount) : onClose}>{t('Close')}</button>
          {failed.length === 0 && <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '…' : t('Allow Retake')}</button>}
        </div>
      </form>
    </ModalShell>
  );
}

function ExtraTimeModal({ examId, attempts, onClose, onDone, t }) {
  const [minutes, setMinutes] = useState(10);
  const [reason, setReason] = useState('');
  const names = attempts.map(nameOf);
  const nameFor = (id) => { const a = attempts.find((x) => x.id === id); return a ? nameOf(a) : `#${id}`; };
  const { saving, error, failed, okCount, run, report } = useBulkSubmit(onDone, nameFor);
  const valid = Number(minutes) >= 1 && Number(minutes) <= 240;

  function submit(e) {
    e.preventDefault();
    if (!valid) return;
    run(() => api.post(`/api/v1/exam-system/exams/${examId}/attempts/bulk-extra-time`, {
      attempt_ids: attempts.map((a) => a.id),
      minutes: Number(minutes),
      reason: reason.trim() || null,
    }));
  }

  return (
    <ModalShell title={t('Add Extra Time')} onClose={failed.length ? () => onDone(okCount) : onClose}>
      <form onSubmit={submit} style={CARD}>
        <p className="text-small" style={{ margin: 0 }}>{t('The minutes are added to the running attempt. The student keeps working without interruption.')}</p>
        <TargetsLine names={names} t={t} />
        <div className="form-group">
          <label className="form-label">{t('Extra minutes')}</label>
          <input type="number" min={1} max={240} className="form-input" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">{t('Reason (optional)')}</label>
          <textarea className="form-input" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && <p className="form-error">{error}</p>}
        {report(t)}
        <div className="modal-box__actions">
          <button type="button" className="btn btn-outline" onClick={failed.length ? () => onDone(okCount) : onClose}>{t('Close')}</button>
          {failed.length === 0 && <button type="submit" className="btn btn-primary" disabled={saving || !valid}>{saving ? '…' : t('Add Extra Time')}</button>}
        </div>
      </form>
    </ModalShell>
  );
}

/**
 * "Give a student another chance": finds eligible students (name / email / student number) — by default only
 * those with NO attempt on this exam, i.e. the ones who missed it — and grants them a retake window.
 */
function StudentPickerModal({ examId, onClose, onDone, t }) {
  const [query, setQuery] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [picked, setPicked] = useState({}); // id -> {id, name}
  const [extra, setExtra] = useState(1);
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const nameFor = (id) => picked[id]?.name || `#${id}`;
  const { saving, error, failed, okCount, run, report } = useBulkSubmit(onDone, nameFor);

  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    const timer = setTimeout(() => {
      api.get(`/api/v1/exam-system/exams/${examId}/eligible-students`, {
        q: query.trim() || undefined,
        without_attempts: onlyMissing ? 1 : undefined,
        limit: 50,
      })
        .then((json) => { if (!cancelled) setResults(json.data || []); })
        .catch((err) => { if (!cancelled) setSearchError(errorMessage(err)); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [examId, query, onlyMissing]);

  const pickedList = Object.values(picked);
  const toggle = (st) => setPicked((p) => {
    const next = { ...p };
    if (next[st.id]) delete next[st.id]; else next[st.id] = { id: st.id, name: st.name };
    return next;
  });

  function submit(e) {
    e.preventDefault();
    if (pickedList.length === 0) return;
    run(() => api.post(`/api/v1/exam-system/exams/${examId}/retake/bulk`, {
      student_ids: pickedList.map((s) => s.id),
      extra_attempts: Number(extra) || 1,
      available_until: toIso(until),
      reason: reason.trim() || null,
    }));
  }

  return (
    <ModalShell title={t('Give a student another chance')} onClose={failed.length ? () => onDone(okCount) : onClose}>
      <form onSubmit={submit} style={CARD}>
        <p className="text-small" style={{ margin: 0 }}>{t('Find a student who could not take the exam (for example an excused absence) and open it for them.')}</p>
        <div className="form-group">
          <input className="form-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search by name, email or student number')} aria-label={t('Search by name, email or student number')} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          <span className="text-small">{t('Only students who have not attempted this exam')}</span>
        </label>

        <div style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, maxHeight: 220, overflowY: 'auto' }}>
          {searching && <p className="text-caption" style={{ padding: 'var(--space-3)', margin: 0 }}>{t('Loading…')}</p>}
          {!searching && searchError && <p className="form-error" style={{ padding: 'var(--space-3)', margin: 0 }}>{searchError}</p>}
          {!searching && !searchError && results.length === 0 && <p className="text-caption" style={{ padding: 'var(--space-3)', margin: 0 }}>{t('No matching students.')}</p>}
          {!searching && results.map((st) => (
            <label key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border, #f1f5f9)' }}>
              <input type="checkbox" checked={!!picked[st.id]} onChange={() => toggle(st)} />
              <span style={{ flex: 1 }}>
                <span className="text-small" style={{ fontWeight: 600 }}>{st.name}</span>
                <span className="text-caption" style={{ display: 'block' }}>{[st.student_number, st.email].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="text-caption">
                {st.attempts_used > 0 ? `${st.attempts_used} ${t('attempt(s)')}` : t('No attempt')}
                {st.extra_attempts > 0 ? ` · +${st.extra_attempts} ${t('extra')}` : ''}
              </span>
            </label>
          ))}
        </div>
        <p className="text-caption" style={{ margin: 0 }}>{pickedList.length} {t('selected')}</p>

        <div className="form-group">
          <label className="form-label">{t('Extra attempts')}</label>
          <input type="number" min={1} max={10} className="form-input" value={extra} onChange={(e) => setExtra(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">{t('Available until (optional)')}</label>
          <input type="datetime-local" className="form-input" value={until} onChange={(e) => setUntil(e.target.value)} />
          <p className="text-caption" style={{ margin: 'var(--space-1) 0 0' }}>{t('Leave empty to follow the exam window. Set it to let this student retake even after the exam closed.')}</p>
        </div>
        <div className="form-group">
          <label className="form-label">{t('Reason (optional)')}</label>
          <textarea className="form-input" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && <p className="form-error">{error}</p>}
        {report(t)}
        <div className="modal-box__actions">
          <button type="button" className="btn btn-outline" onClick={failed.length ? () => onDone(okCount) : onClose}>{t('Close')}</button>
          {failed.length === 0 && <button type="submit" className="btn btn-primary" disabled={saving || pickedList.length === 0}>{saving ? '…' : t('Allow Retake')}</button>}
        </div>
      </form>
    </ModalShell>
  );
}

export default function AcademicStaffExamAttempts() {
  const { id } = useParams();
  const t = useTranslations(translations);
  const [exam, setExam] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cancelTargets, setCancelTargets] = useState(null);   // attempts[]
  const [retakeTargets, setRetakeTargets] = useState(null);   // students[] ({id,name,used,extra})
  const [timeTargets, setTimeTargets] = useState(null);       // attempts[]
  const [picking, setPicking] = useState(false);
  const [integrityFor, setIntegrityFor] = useState(null);        // attempt row
  const [selected, setSelected] = useState([]);               // attempt ids
  const [notice, setNotice] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    return Promise.all([
      api.get(`/api/v1/exam-system/exams/${id}`),
      api.get(`/api/v1/exam-system/exams/${id}/attempts`),
    ])
      .then(([examJson, attemptsJson]) => {
        setExam(examJson.data);
        setAttempts(attemptsJson.data || []);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handlePublishResults = () => {
    if (!window.confirm(t('Publish results for all graded attempts on this exam?'))) return;
    setBusy(true);
    setActionError(null);
    api.post(`/api/v1/exam-system/exams/${id}/publish-results`)
      .then(() => load())
      .catch((err) => setActionError(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  const handleUnpublishResults = () => {
    if (!window.confirm(t('Revoke published results for this exam?'))) return;
    setBusy(true);
    setActionError(null);
    api.post(`/api/v1/exam-system/exams/${id}/unpublish-results`)
      .then(() => load())
      .catch((err) => setActionError(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  const selectedRows = attempts.filter((a) => selected.includes(a.id));
  const toggleOne = (attemptId) => setSelected((cur) => (cur.includes(attemptId) ? cur.filter((x) => x !== attemptId) : [...cur, attemptId]));

  const handleRevoke = (a) => {
    if (!window.confirm(t('Withdraw the unused extra attempts for this student?'))) return;
    setBusy(true);
    setActionError(null);
    api.del(`/api/v1/exam-system/exams/${id}/students/${a.student_id}/retake`)
      .then(() => { setNotice(t('Retake withdrawn.')); return load(); })
      .catch((err) => setActionError(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  const afterManage = (msg) => (count) => {
    setCancelTargets(null);
    setRetakeTargets(null);
    setTimeTargets(null);
    setPicking(false);
    setSelected([]);
    setNotice(count > 1 ? `${msg} (${count})` : msg);
    load();
  };

  const [exportOpen, setExportOpen] = useState(false);
  const [savedExport, setSavedExport] = useState(false);
  async function handleExport(fmt) {
    setExportOpen(false);
    setActionError(null);
    setSavedExport(false);
    try {
      await api.post('/api/v1/exam-system/exports', { export_type: 'exam_results', exam_id: Number(id), format: fmt });
      setSavedExport(true);
    } catch (err) {
      setActionError(errorMessage(err) || t('Export failed. Please try again.'));
    }
  }

  if (loading) return <p className="text-small" style={{ padding: 'var(--space-5)' }}>{t('Loading…')}</p>;
  if (error) return <p className="form-error" style={{ padding: 'var(--space-5)' }}>{error}</p>;
  if (!exam) return null;

  // Retake buttons go on each student's latest attempt only (one per student).
  const latestByStudent = {};
  attempts.forEach((a) => {
    if (!latestByStudent[a.student_id] || a.attempt_number > latestByStudent[a.student_id]) latestByStudent[a.student_id] = a.attempt_number;
  });

  // Bulk actions only apply to the selected rows they make sense for.
  const timeableSelected = selectedRows.filter((a) => a.status === 'in_progress');
  const cancellableSelected = selectedRows.filter((a) => a.status !== 'cancelled');
  const allSelected = attempts.length > 0 && selected.length === attempts.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div>
        <Link to={`/academic-staff/exams/${id}`} className="text-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon name="chevron-left" size={14} /> {t('Back to Exam')}
        </Link>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div>
          <h1 className="text-h2" style={{ margin: 0 }}>{exam.title}</h1>
          <p className="text-caption" style={{ margin: 'var(--space-1) 0 0' }}>{t('Attempts & Grading')}</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setPicking(true)}>
            <Icon name="plus" size={14} /> {t('Give a student another chance')}
          </button>
          <Link to={`/academic-staff/exams/${id}/similarity`} className="btn btn-outline btn-sm">
            <Icon name="shield" size={14} /> {t('Answer Similarity')}
          </Link>
          <Link to={`/academic-staff/exams/${id}/appeals`} className="btn btn-outline btn-sm">
            <Icon name="filter" size={14} /> {t('Grade Appeals')}
          </Link>
          <Link to={`/academic-staff/exams/${id}/analytics`} className="btn btn-outline btn-sm">
            <Icon name="chart" size={14} /> {t('Analytics')}
          </Link>
          <Link to={`/academic-staff/exams/${id}/targets`} className="btn btn-outline btn-sm">
            <Icon name="filter" size={14} /> {t('Manage Targeting & Publish')}
          </Link>
          <div style={{ position: 'relative' }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setExportOpen((o) => !o)}>
              <Icon name="download" size={14} /> {t('Export')}
            </button>
            {exportOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-dropdown, 40)' }} onClick={() => setExportOpen(false)} />
                <div
                  className="card glass-panel"
                  style={{ position: 'absolute', top: '100%', insetInlineStart: 0, marginTop: 4, zIndex: 'var(--z-dropdown, 41)', display: 'flex', gap: 6, flexWrap: 'wrap', padding: 'var(--space-3)', minWidth: 180 }}
                >
                  {EXPORT_FORMATS.map((fmt) => (
                    <button key={fmt} type="button" className="btn btn-ghost btn-sm" onClick={() => handleExport(fmt)}>
                      {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {exam.result_visibility === 'manual' && (
            <>
              <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={handleUnpublishResults}>
                {t('Unpublish Results')}
              </button>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={handlePublishResults}>
                {t('Publish Results')}
              </button>
            </>
          )}
        </div>
      </div>

      {actionError && <p className="form-error">{actionError}</p>}
      {notice && <p className="text-small" style={{ color: 'var(--success, #16a34a)', margin: 0 }}>{notice}</p>}
      {savedExport && (
        <p className="text-small" style={{ color: 'var(--success, #16a34a)', margin: 0 }}>
          {t('Export saved.')} <Link to="/academic-staff/exports" style={{ fontWeight: 600 }}>{t('Open Exports')}</Link>
        </p>
      )}

      {attempts.length === 0 ? (
        <div className="card glass-panel empty-state">
          <Icon name="note" size={32} className="empty-state__icon" />
          <p className="text-small">{t('No attempts yet.')}</p>
        </div>
      ) : (
        <div className="card glass-panel" style={CARD}>
          {selected.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="text-small" style={{ fontWeight: 600 }}>{selected.length} {t('selected')}</span>
              <button type="button" className="btn btn-outline btn-sm" disabled={busy || timeableSelected.length === 0} onClick={() => setTimeTargets(timeableSelected)}>
                {t('Add Extra Time')} ({timeableSelected.length})
              </button>
              <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setRetakeTargets(uniqueStudents(selectedRows))}>
                {t('Allow Retake')} ({uniqueStudents(selectedRows).length})
              </button>
              <button type="button" className="btn btn-outline btn-sm" disabled={busy || cancellableSelected.length === 0} onClick={() => setCancelTargets(cancellableSelected)}>
                {t('Cancel Attempt')} ({cancellableSelected.length})
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected([])}>{t('Clear selection')}</button>
            </div>
          )}
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <input
                      type="checkbox"
                      aria-label={t('Select all')}
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? [] : attempts.map((a) => a.id))}
                    />
                  </th>
                  <th>{t('Student')}</th>
                  <th>{t('Status')}</th>
                  <th>{t('Grading Progress')}</th>
                  <th>{t('Score')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => {
                  const meta = ATTEMPT_STATUS_META[a.status] || ATTEMPT_STATUS_META.submitted;
                  const isLatest = latestByStudent[a.student_id] === a.attempt_number;
                  return (
                    <tr key={a.id}>
                      <td>
                        <input type="checkbox" aria-label={nameOf(a)} checked={selected.includes(a.id)} onChange={() => toggleOne(a.id)} />
                      </td>
                      <td>
                        <span className="text-small" style={{ fontWeight: 600 }}>{nameOf(a)}</span>
                        {a.student_number && <div className="text-caption">{a.student_number}</div>}
                      </td>
                      <td>
                        <span className={`badge ${meta.cls}`}>{t(meta.key)}</span>
                        {a.is_late && (
                          <span className="badge badge-warning" style={{ marginInlineStart: 4 }}>
                            {t('Late')}{a.late_penalty_percent > 0 ? ` −${a.late_penalty_percent}%` : ''}
                          </span>
                        )}
                        {a.identity_status && a.identity_status !== 'none' && (
                          <span className={`badge ${a.identity_status === 'approved' ? 'badge-success' : a.identity_status === 'rejected' ? 'badge-danger' : 'badge-warning'}`} style={{ marginInlineStart: 4 }}>
                            ID: {a.identity_status}
                          </span>
                        )}
                        {a.proctoring_flags_count > 0 && <span className="badge badge-warning" style={{ marginInlineStart: 4 }}>📷 {a.proctoring_flags_count}</span>}
                        {a.session_claims_count > 1 && <span className="badge badge-warning" style={{ marginInlineStart: 4 }}>⇄ {a.session_claims_count}</span>}
                        {a.status === 'cancelled' && a.cancel_reason && <div className="text-caption">{a.cancel_reason}</div>}
                        {a.extra_time_minutes > 0 && <div className="text-caption">+{a.extra_time_minutes} {t('min extra time')}</div>}
                        {isLatest && a.student_extra_attempts > 0 && (
                          <div className="text-caption">+{a.student_extra_attempts} {t('extra')}{a.student_available_until ? ` · ${t('until')} ${new Date(a.student_available_until).toLocaleString()}` : ''}</div>
                        )}
                      </td>
                      <td>{a.graded_count ?? 0} / {a.total_questions ?? 0}</td>
                      <td>
                        {a.score != null ? `${a.score} / ${exam.total_marks}` : '—'}
                        {a.score_before_penalty != null && <div className="text-caption">{t('Before penalty')}: {a.score_before_penalty}</div>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {a.status !== 'cancelled' && (
                            <Link to={`/academic-staff/exams/${id}/attempts/${a.id}`} className="btn btn-outline btn-sm">
                              {t('Grade')}
                            </Link>
                          )}
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => setIntegrityFor(a)} title={t('Integrity')}>
                            <Icon name="shield" size={14} />
                          </button>
                          {a.status === 'in_progress' && (
                            <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setTimeTargets([a])}>
                              {t('Add Extra Time')}
                            </button>
                          )}
                          {a.status !== 'cancelled' && (
                            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setCancelTargets([a])}>
                              {t('Cancel Attempt')}
                            </button>
                          )}
                          {isLatest && (
                            <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setRetakeTargets(uniqueStudents([a]))}>
                              {t('Allow Retake')}
                            </button>
                          )}
                          {isLatest && a.student_extra_attempts > 0 && (
                            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => handleRevoke(a)}>
                              {t('Withdraw Retake')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {cancelTargets && (
        <CancelAttemptModal examId={id} attempts={cancelTargets} t={t} onClose={() => setCancelTargets(null)} onDone={afterManage(t('Attempt cancelled.'))} />
      )}
      {retakeTargets && (
        <RetakeModal examId={id} students={retakeTargets} t={t} onClose={() => setRetakeTargets(null)} onDone={afterManage(t('Retake granted.'))} />
      )}
      {timeTargets && (
        <ExtraTimeModal examId={id} attempts={timeTargets} t={t} onClose={() => setTimeTargets(null)} onDone={afterManage(t('Extra time added.'))} />
      )}
      {integrityFor && (
        <ExamIntegrityModal examId={id} attempt={integrityFor} studentName={nameOf(integrityFor)} onClose={() => setIntegrityFor(null)} onChanged={load} />
      )}
      {picking && (
        <StudentPickerModal examId={id} t={t} onClose={() => setPicking(false)} onDone={afterManage(t('Retake granted.'))} />
      )}
    </div>
  );
}
