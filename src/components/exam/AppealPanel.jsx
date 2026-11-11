import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';

const STATUS_AR = { pending: 'قيد المراجعة', accepted: 'مقبول', rejected: 'مرفوض', withdrawn: 'مسحوب' };
const STATUS_EN = { pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected', withdrawn: 'Withdrawn' };
const STATUS_CLS = { pending: 'idle', accepted: 'graded', rejected: 'failed', withdrawn: 'idle' };

/**
 * تظلم الطالب على نتيجته — GET/POST /api/v1/exam-system/attempts/{id}/appeals، POST .../{appealId}/withdraw.
 * `questions` = أسئلة صفحة النتيجة (بتتبعت بس لو مراجعة الإجابات مسموحة) عشان التظلم على سؤال بعينه.
 */
export default function AppealPanel({ attemptId, questions }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [info, setInfo] = useState(null);
  const [scope, setScope] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.get(`/api/v1/exam-system/attempts/${attemptId}/appeals`).then((json) => setInfo(json.data)).catch(() => setInfo(null));
  }, [attemptId]);
  useEffect(() => { load(); }, [load]);

  if (!info || !info.enabled) return null;

  const submit = () => {
    setBusy(true); setError(null);
    api.post(`/api/v1/exam-system/attempts/${attemptId}/appeals`, { reason, exam_question_id: scope || null })
      .then(() => { setReason(''); setScope(''); load(); })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };
  const withdraw = (appealId) => {
    setBusy(true); setError(null);
    api.post(`/api/v1/exam-system/attempts/${attemptId}/appeals/${appealId}/withdraw`)
      .then(() => load())
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };
  const qLabel = (qid) => {
    const i = (questions || []).findIndex((q) => q.exam_question_id === qid);
    return i >= 0 ? `Q${i + 1}` : (ar ? 'سؤال' : 'Question');
  };

  return (
    <div className="ex-card ex-card__pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ margin: 0 }}>{ar ? 'تظلم على الدرجة' : 'Grade appeal'}</h3>

      {info.appeals.map((a) => (
        <div key={a.id} className="ex-ghost" style={{ borderStyle: 'solid' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <strong>{a.exam_question_id ? qLabel(a.exam_question_id) : (ar ? 'الدرجة الكلية' : 'Overall score')}</strong>
            <span className={`ex-status ex-status--${STATUS_CLS[a.status]}`}>{(ar ? STATUS_AR : STATUS_EN)[a.status]}</span>
          </div>
          <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{a.reason}</p>
          {a.response && <p className="ex-card__sub" style={{ marginTop: 6 }}><strong>{ar ? 'رد الأستاذ: ' : 'Instructor reply: '}</strong>{a.response}</p>}
          {a.status === 'pending' && (
            <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 8 }} disabled={busy} onClick={() => withdraw(a.id)}>{ar ? 'سحب التظلم' : 'Withdraw'}</button>
          )}
        </div>
      ))}

      {info.can_appeal ? (
        <>
          <p className="ex-card__sub" style={{ margin: 0 }}>
            {ar ? 'لو شايف إن في خطأ في تصحيح إجابتك، اكتب سبب التظلم وسيصل لأستاذك.' : 'If you think an answer was graded incorrectly, explain why and your instructor will review it.'}
            {info.window_ends_at && ` ${ar ? 'متاح حتى' : 'Open until'} ${new Date(info.window_ends_at).toLocaleDateString(locale)}.`}
          </p>
          {info.question_level_allowed && (questions || []).length > 0 && (
            <select className="form-input" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="">{ar ? 'الدرجة الكلية' : 'Overall score'}</option>
              {questions.map((q, i) => <option key={q.exam_question_id} value={q.exam_question_id}>Q{i + 1}</option>)}
            </select>
          )}
          <textarea className="form-input" rows={3} maxLength={2000} style={{ height: 'auto' }} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={ar ? 'سبب التظلم (10 أحرف على الأقل)' : 'Reason for your appeal (at least 10 characters)'} />
          {error && <p className="form-error" style={{ margin: 0 }}>{error}</p>}
          <div><button type="button" className="btn btn-primary btn-sm" disabled={busy || reason.trim().length < 10} onClick={submit}>
            <Icon name="plus" size={14} /> {ar ? 'إرسال التظلم' : 'Submit appeal'}
          </button></div>
        </>
      ) : (
        info.blocked_reason && info.appeals.length === 0 && <p className="ex-card__sub" style={{ margin: 0 }}>{ar ? 'التظلم غير متاح حاليًا.' : info.blocked_reason}</p>
      )}
    </div>
  );
}
