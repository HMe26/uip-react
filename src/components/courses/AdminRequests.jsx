import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { EmptyState, Skeleton } from '../student/stUi';
import { AcPage, AcHead, AcAlerts, AcPanel, AcField } from './acKit';
import { downloadAuthed } from '../../lib/download';

/**
 * الطلبات الإدارية (شهادة قيد / بيان درجات / إفادة): الطالب بيقدّم ← الكلية توافق وتحوّل ← الجامعة تعتمد،
 * وبعد الاعتماد الطالب بيحمّل المستند PDF. نفس الصفحة للأدوار التلاتة (role = student | faculty | university).
 * Backend: /api/v1/admin-requests (GET, POST, /{id}/cancel|approve|reject, GET /{id}/document).
 */

const TYPES = {
  enrollment_certificate: ['شهادة قيد', 'Enrollment certificate'],
  transcript: ['بيان درجات', 'Grade statement'],
  statement: ['إفادة', 'Statement letter'],
};
const STATUS = {
  pending: ['قيد المراجعة', 'Pending', ''],
  approved: ['معتمد', 'Approved', 'success'],
  rejected: ['مرفوض', 'Rejected', 'warning'],
  cancelled: ['ملغي', 'Cancelled', 'neutral'],
};
const ACTION = { submitted: ['تم التقديم', 'Submitted'], forwarded: ['حوّلتها الكلية للجامعة', 'Forwarded to university'], approved: ['اعتماد', 'Approved'], rejected: ['رفض', 'Rejected'], cancelled: ['إلغاء', 'Cancelled'] };
const ROLE = { student: ['الطالب', 'Student'], faculty: ['الكلية', 'Faculty'], university: ['الجامعة', 'University'] };
const fmt = (s) => (s ? String(s).slice(0, 16).replace('T', ' ') : '');

export default function AdminRequests({ role = 'student' }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const student = role === 'student';
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [form, setForm] = useState({ type: 'enrollment_certificate', purpose: '', message: '' });
  const [open, setOpen] = useState(null);
  const [notes, setNotes] = useState({});

  const load = useCallback(
    () => api.get('/api/v1/admin-requests', { locale, ...(status ? { status } : {}) }).then((j) => setRows(j.data || [])),
    [locale, status],
  );
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  const run = async (fn) => {
    setBusy(true); setError(null); setNotice(null);
    try { const j = await fn(); setNotice(j?.message || null); await load(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  const submit = (e) => {
    e.preventDefault();
    run(() => api.post('/api/v1/admin-requests', { ...form, locale })).then(() => setForm((f) => ({ ...f, purpose: '', message: '' })));
  };
  const act = (id, what) => {
    const note = (notes[id] || '').trim();
    if (what === 'reject' && !note) { setError(ar ? 'اكتب سبب الرفض.' : 'Please give a reason for the rejection.'); return; }
    run(() => api.post(`/api/v1/admin-requests/${id}/${what}`, { note, locale }));
  };
  const download = (r) => downloadAuthed(`/api/v1/admin-requests/${r.id}/document`, `${r.ref_no}.pdf`, { locale }).catch((e) => setError(errorMessage(e)));

  return (
    <AcPage>
      <AcHead
        title={ar ? 'الطلبات الإدارية' : 'Administrative requests'}
        text={student
          ? (ar ? 'اطلب شهادة قيد أو بيان درجات أو إفادة. الطلب بيعدّي على الكلية ثم الجامعة، وبعد الاعتماد تحمّل المستند.' : 'Request an enrollment certificate, grade statement or letter. It goes to your faculty, then the university; download the document once approved.')
          : (ar ? 'طلبات الطلاب. الكلية بتوافق وتحوّل للجامعة، والجامعة بتعتمد.' : 'Student requests. The faculty approves and forwards; the university gives final approval.')}
      />
      <AcAlerts error={error} notice={notice} />

      {student && (
        <AcPanel title={ar ? 'طلب جديد' : 'New request'} flush>
          <form className="acx-form" style={{ borderTop: 0 }} onSubmit={submit}>
            <div className="acx-form__grid">
              <AcField label={ar ? 'نوع المستند' : 'Document type'}>
                <select className="acx-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{ar ? v[0] : v[1]}</option>)}
                </select>
              </AcField>
              <AcField label={form.type === 'statement' ? (ar ? 'الجهة / الغرض (مطلوب)' : 'Addressed to / purpose (required)') : (ar ? 'الجهة الموجّه لها (اختياري)' : 'Addressed to (optional)')}>
                <input className="acx-input" value={form.purpose} maxLength={200} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
              </AcField>
            </div>
            <AcField label={ar ? 'ملاحظات (اختياري)' : 'Notes (optional)'}><textarea className="acx-input" rows={2} maxLength={2000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></AcField>
            <div className="acx-form__actions"><button type="submit" className="btn btn-primary btn-sm" disabled={busy || (form.type === 'statement' && !form.purpose.trim())}>{ar ? 'إرسال الطلب' : 'Submit request'}</button></div>
          </form>
        </AcPanel>
      )}

      <AcPanel title={student ? (ar ? 'طلباتي' : 'My requests') : (ar ? 'الطلبات' : 'Requests')} flush
        tools={(
          <select className="acx-input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{ar ? 'كل الحالات' : 'All statuses'}</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v[0] : v[1]}</option>)}
          </select>
        )}>
        {!rows && !error ? <div className="acx-panel__body"><Skeleton h={60} count={3} /></div> : rows && rows.length === 0 ? <div className="acx-empty"><EmptyState icon="file" title={ar ? 'لا توجد طلبات' : 'No requests'} /></div> : rows && (
          <div>
            {rows.map((r) => {
              const st = STATUS[r.status] || STATUS.pending;
              const where = r.status === 'pending' ? (r.stage === 'faculty' ? (ar ? 'عند الكلية' : 'With faculty') : (ar ? 'عند الجامعة' : 'With university')) : null;
              return (
                <article key={r.id} className="acx-item">
                  <div className="acx-item__head">
                    <div style={{ minWidth: 0 }}>
                      <span className="acx-code" dir="ltr">{r.ref_no}</span>
                      <div className="acx-item__title">{ar ? TYPES[r.type]?.[0] : TYPES[r.type]?.[1]}</div>
                      {!student && <div className="acx-muted">{r.student.name} ({r.student.number})</div>}
                      <div className="acx-muted">{fmt(r.created_at)}</div>
                    </div>
                    <div className="acx-actions">
                      <span className={`st-pill${st[2] ? ` st-pill--${st[2]}` : ''}`}>{ar ? st[0] : st[1]}</span>
                      {where && <span className="acx-muted">{where}</span>}
                    </div>
                  </div>
                  {r.purpose && <div className="acx-muted">{ar ? 'الجهة/الغرض: ' : 'For: '}{r.purpose}</div>}
                  {r.message && <p className="acx-item__body">{r.message}</p>}
                  {r.decision_note && r.status !== 'pending' && <div className="st-alert"><Icon name="info" size={15} /><span>{ar ? 'ملاحظة: ' : 'Note: '}{r.decision_note}</span></div>}

                  <div className="acx-actions">
                    {r.document_ready && <button type="button" className="btn btn-primary btn-sm" onClick={() => download(r)}><Icon name="download" size={14} /> {ar ? 'تحميل PDF' : 'Download PDF'}</button>}
                    {r.can_cancel && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => run(() => api.post(`/api/v1/admin-requests/${r.id}/cancel`, { locale }))}>{ar ? 'إلغاء' : 'Cancel'}</button>}
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(open === r.id ? null : r.id)}>{ar ? 'السجل' : 'History'}</button>
                  </div>

                  {r.can_act && (
                    <div className="acx-actions">
                      <input className="acx-input" style={{ flex: '1 1 220px', width: 'auto' }} value={notes[r.id] || ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} placeholder={ar ? 'ملاحظة (إلزامية عند الرفض)' : 'Note (required when rejecting)'} />
                      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(r.id, 'approve')}>
                        {role === 'faculty' ? (ar ? 'موافقة وتحويل للجامعة' : 'Approve & forward') : (ar ? 'اعتماد' : 'Approve')}
                      </button>
                      <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => act(r.id, 'reject')}>{ar ? 'رفض' : 'Reject'}</button>
                    </div>
                  )}

                  {open === r.id && (
                    <ul className="acx-muted" style={{ margin: 0, paddingInlineStart: 18 }}>
                      {r.events.map((e, i) => (
                        <li key={i}>{fmt(e.at)} — {ar ? ACTION[e.action]?.[0] : ACTION[e.action]?.[1]} ({ar ? ROLE[e.role]?.[0] : ROLE[e.role]?.[1]}{e.by ? `: ${e.by}` : ''}){e.note ? ` — ${e.note}` : ''}</li>
                      ))}
                    </ul>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </AcPanel>
    </AcPage>
  );
}
