import { useState } from 'react';
import { StModal } from '../student/stUi';

/**
 * Reviewer decision dialog shared by the supervisor / faculty / university review screens.
 * Collects the written comment that is stored on the approval row (`comments`) and shown to the student in the
 * project's "Approval Status" tab. The comment is REQUIRED for "request-changes" and "reject", optional for "approve".
 *
 * props: action ('approve' | 'reject' | 'request-changes'), ar, busy, onCancel, onConfirm(comments)
 */
const COPY = {
  'request-changes': { en: 'Request Changes', ar: 'طلب تعديلات', required: true,
    hintEn: 'Describe exactly what the student must change. This text is sent to the student.',
    hintAr: 'اكتب بالتفصيل المطلوب تعديله. هذا النص سيصل للطالب.' },
  reject: { en: 'Reject', ar: 'رفض', required: true,
    hintEn: 'Explain why the project is rejected. This text is sent to the student.',
    hintAr: 'اشرح سبب الرفض. هذا النص سيصل للطالب.' },
  approve: { en: 'Approve', ar: 'اعتماد', required: false,
    hintEn: 'Optional note for the student.', hintAr: 'ملاحظة اختيارية للطالب.' },
};

export default function DecisionDialog({ action, ar, busy, onCancel, onConfirm }) {
  const [comments, setComments] = useState('');
  const c = COPY[action] || COPY.approve;
  const text = comments.trim();
  return (
    <StModal
      title={ar ? c.ar : c.en}
      onClose={onCancel}
      actions={(
        <>
          <button type="button" className="btn btn-outline" onClick={onCancel}>{ar ? 'إلغاء' : 'Cancel'}</button>
          <button type="button" className="btn btn-primary" disabled={busy || (c.required && !text)} onClick={() => onConfirm(text)}>
            {ar ? c.ar : c.en}
          </button>
        </>
      )}
    >
      <label className="form-label">
        {c.required ? (ar ? 'التعليق (مطلوب)' : 'Comment (required)') : (ar ? 'تعليق (اختياري)' : 'Comment (optional)')}
      </label>
      <p className="st-muted" style={{ fontSize: 12.5, margin: '0 0 8px' }}>{ar ? c.hintAr : c.hintEn}</p>
      <textarea className="form-input" rows={5} autoFocus maxLength={2000} value={comments} onChange={(e) => setComments(e.target.value)} />
    </StModal>
  );
}
