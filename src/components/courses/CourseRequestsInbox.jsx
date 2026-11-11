import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';

/** Download a request's attachment through the authenticated API. */
export async function downloadRequestAttachment(req) {
  const res = await api.blob(`/api/v1/courses/requests/${req.id}/attachment`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = req.attachment_name || 'attachment';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function requestStatusLabel(status, ar) {
  return {
    pending: ar ? 'قيد المراجعة' : 'Pending',
    approved: ar ? 'تمت الموافقة' : 'Approved',
    rejected: ar ? 'مرفوض' : 'Rejected',
    cancelled: ar ? 'تم السحب' : 'Withdrawn',
  }[status] || status;
}

const ROLE_AR = { university: 'الجامعة', faculty: 'الكلية', academic_staff: 'مدرّس المادة' };
const ROLE_EN = { university: 'the university', faculty: 'the faculty', academic_staff: 'the course staff' };

export function decidedByText(r, ar) {
  if (!r.decided_by_role) return null;
  const who = (ar ? ROLE_AR : ROLE_EN)[r.decided_by_role] || '';
  return r.decided_by_name ? `${r.decided_by_name} (${who})` : who;
}

/**
 * Incoming enrol / drop requests for the university, faculty and doctor/TA portals.
 * The first party to approve applies the change; a rejection only closes the request once
 * every party has rejected it.
 */
export default function CourseRequestsInbox() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [acting, setActing] = useState(null); // { req, action }
  const [note, setNote] = useState('');

  const load = useCallback(() => api.get('/api/v1/courses/requests', { locale }).then((j) => setRows(j.data || [])), [locale]);
  useEffect(() => { load().catch((e) => { setError(errorMessage(e)); setRows([]); }); }, [load]);

  const pending = (rows || []).filter((r) => r.status === 'pending');
  const history = (rows || []).filter((r) => r.status !== 'pending');
  const shown = tab === 'pending' ? pending : history;

  async function confirm() {
    const { req, action } = acting;
    setBusyId(req.id);
    setError(null);
    try {
      const json = await api.post(`/api/v1/courses/requests/${req.id}/${action}`, { locale, note: note.trim() || undefined });
      setNotice(json.message);
      setActing(null);
      setNote('');
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function openFile(r) {
    try { await downloadRequestAttachment(r); } catch (e) { setError(errorMessage(e)); }
  }

  if (rows === null) return null;

  return (
    <div className="ex-card cr-inbox" style={{ marginBottom: 16 }}>
      <div className="cr-inbox__head">
        <h3><Icon name="inbox" size={17} /> {ar ? 'طلبات تسجيل / إلغاء تسجيل الطلاب' : 'Student enrol / drop requests'}</h3>
        {pending.length > 0 && <span className="ex-status ex-status--graded">{pending.length} {ar ? 'بانتظار قرارك' : 'awaiting you'}</span>}
      </div>
      {error && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}
      {notice && <div className="st-alert st-alert--success"><Icon name="check-circle" size={16} /><span>{notice}</span></div>}

      <div className="ex-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'pending'} className={`ex-tab${tab === 'pending' ? ' is-active' : ''}`} onClick={() => setTab('pending')}>{ar ? 'قيد المراجعة' : 'Pending'}<small>({pending.length})</small></button>
        <button type="button" role="tab" aria-selected={tab === 'history'} className={`ex-tab${tab === 'history' ? ' is-active' : ''}`} onClick={() => setTab('history')}>{ar ? 'السجل' : 'History'}<small>({history.length})</small></button>
      </div>

      {shown.length === 0 ? (
        <p className="cr-inbox__empty">{tab === 'pending' ? (ar ? 'لا توجد طلبات بانتظارك.' : 'No requests are waiting for you.') : (ar ? 'لا يوجد سجل بعد.' : 'No history yet.')}</p>
      ) : (
        <ul className="cr-req-list">
          {shown.map((r) => (
            <li key={r.id} className="cr-req">
              <div className="cr-req__top">
                <span className={`ex-chip cr-type cr-type--${r.type}`}>{r.type === 'enroll' ? (ar ? 'طلب تسجيل' : 'Enrol') : (ar ? 'طلب إلغاء' : 'Leave')}</span>
                <strong>{r.course_code} — {r.course_name}</strong>
                <span className={`cr-status cr-status--${r.status}`}>{requestStatusLabel(r.status, ar)}</span>
              </div>
              <p className="cr-req__who">{r.student_name}{r.student_number ? ` · ${r.student_number}` : ''} · {new Date(r.created_at).toLocaleString(ar ? 'ar-EG' : undefined)}</p>
              {r.message && <p className="cr-req__msg">{r.message}</p>}
              {r.has_attachment && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => openFile(r)}><Icon name="file" size={14} /> {r.attachment_name || (ar ? 'المرفق' : 'Attachment')}</button>
              )}
              {r.status !== 'pending' && decidedByText(r, ar) && (
                <p className="cr-req__who">{ar ? 'القرار: ' : 'Decision: '}{decidedByText(r, ar)}{r.decision_note ? ` — ${r.decision_note}` : ''}</p>
              )}
              {r.status === 'pending' && (
                <div className="cr-req__actions">
                  {r.my_decision === 'rejected' && <small>{ar ? 'سبق أن رفضت هذا الطلب — ما زال مفتوحًا لجهات أخرى.' : 'You rejected this — it is still open for other parties.'}</small>}
                  <button type="button" className="btn btn-primary btn-sm" disabled={busyId === r.id} onClick={() => { setNote(''); setActing({ req: r, action: 'approve' }); }}>{ar ? 'موافقة' : 'Approve'}</button>
                  {r.my_decision !== 'rejected' && <button type="button" className="btn btn-outline btn-sm" disabled={busyId === r.id} onClick={() => { setNote(''); setActing({ req: r, action: 'reject' }); }}>{ar ? 'رفض' : 'Reject'}</button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {acting && (
        <div className="modal-overlay" onClick={() => setActing(null)}>
          <div className="pf-modal" onClick={(e) => e.stopPropagation()}>
            <header className="pf-head">
              <div className="pf-head__text">
                <h2>{acting.action === 'approve' ? (ar ? 'تأكيد الموافقة' : 'Confirm approval') : (ar ? 'تأكيد الرفض' : 'Confirm rejection')}</h2>
                <p>{acting.req.student_name} — {acting.req.course_code}</p>
              </div>
            </header>
            <div className="pf-body">
              <div className={`cr-warn${acting.action === 'approve' ? '' : ' cr-warn--danger'}`}>
                <Icon name="alert-triangle" size={18} />
                <div>
                  {acting.action === 'approve'
                    ? (acting.req.type === 'enroll'
                      ? (ar ? 'سيتم تسجيل الطالب في المادة فورًا، ولن تحتاج بقية الجهات للموافقة.' : 'The student is enrolled immediately; the other parties no longer need to approve.')
                      : (ar ? 'سيتم إلغاء تسجيل الطالب من المادة فورًا، ولن تحتاج بقية الجهات للموافقة.' : 'The student is removed from the course immediately; the other parties no longer need to approve.'))
                    : (ar ? 'سيُسجَّل رفضك. يبقى الطلب مفتوحًا لبقية الجهات، ويُغلق فقط إذا رفضه الجميع.' : 'Your rejection is recorded. The request stays open for the other parties and closes only if all reject.')}
                </div>
              </div>
              <textarea className="ex-input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={ar ? 'ملاحظة للطالب (اختياري)' : 'Note to the student (optional)'} />
            </div>
            <footer className="pf-foot">
              <button type="button" className="btn btn-outline" onClick={() => setActing(null)}>{ar ? 'رجوع' : 'Back'}</button>
              <button type="button" className="btn btn-primary" disabled={busyId === acting.req.id} onClick={confirm}>
                {acting.action === 'approve' ? (ar ? 'تأكيد الموافقة' : 'Approve') : (ar ? 'تأكيد الرفض' : 'Reject')}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
