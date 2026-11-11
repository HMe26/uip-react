import { useState } from 'react';
import Icon from './Icon';

/**
 * Shared pieces for the official project grade (kit-agnostic: only global .btn/.form-input classes).
 *  - MemberAdjustments: درجة المشروع + تعديل فردي (نقاط مئوية) لكل عضو بحساب، بسبب مكتوب لو الدرجة مختلفة.
 *  - LockBar: الدرجة النهائية مقفولة؛ إعادة الفتح بسبب مكتوب (مسجّلة ويوصل إشعار للفريق).
 *  - GradeRevisions: سجل الاعتماد/إعادة الفتح.
 */

export const letterOf = (pct) => (pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 70 ? 'C' : pct >= 60 ? 'D' : 'F');

/** value: { [user_id]: { adjustment, comments } } — onChange(nextValue). projectPct: live % of the rubric (or null). */
export function MemberAdjustments({ candidates = [], value, onChange, projectPct, ar, disabled }) {
  if (!candidates.length) return null;
  const set = (uid, patch) => onChange({ ...value, [uid]: { adjustment: '', comments: '', ...(value[uid] || {}), ...patch } });
  return (
    <div style={{ marginTop: 16 }}>
      <strong>{ar ? 'الدرجة الفردية لكل عضو' : 'Individual grade per member'}</strong>
      <p className="st-muted" style={{ fontSize: 12.5, margin: '4px 0 8px' }}>
        {ar ? 'درجة المشروع تتطبق على الكل، وتقدر تضيف أو تخصم نقاط مئوية لعضو معيّن (مثلًا حسب المساهمة). لازم تكتب السبب لأي تعديل.'
            : 'The project grade applies to everyone; add or subtract percentage points for a member (e.g. by contribution). A reason is required for any change.'}
      </p>
      {candidates.map((m) => {
        const v = value[m.user_id] || { adjustment: '', comments: '' };
        const adj = v.adjustment === '' || v.adjustment == null ? 0 : Number(v.adjustment);
        const pct = projectPct == null || Number.isNaN(adj) ? null : Math.max(0, Math.min(100, projectPct + adj));
        return (
          <div key={m.user_id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 110px 2fr 90px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <span>{m.full_name}</span>
            <input className="form-input" type="number" step="0.5" min="-100" max="100" disabled={disabled} placeholder={ar ? 'تعديل ±' : 'Adjust ±'} value={v.adjustment} onChange={(e) => set(m.user_id, { adjustment: e.target.value })} />
            <input className="form-input" disabled={disabled} placeholder={ar ? 'سبب التعديل' : 'Reason'} value={v.comments || ''} onChange={(e) => set(m.user_id, { comments: e.target.value })} />
            <strong style={{ textAlign: 'end' }}>{pct == null ? '—' : `${pct.toFixed(1)}% ${letterOf(pct)}`}</strong>
          </div>
        );
      })}
    </div>
  );
}

/** Builds the `members` payload (only rows the grader touched or that already carry an adjustment). */
export function membersPayload(value) {
  return Object.entries(value).map(([user_id, v]) => ({ user_id: Number(user_id), adjustment: v.adjustment === '' ? 0 : Number(v.adjustment), comments: v.comments || '' }));
}

/** From saved `members` rows to the editable map. */
export function membersToValue(members = []) {
  const out = {};
  members.forEach((m) => { out[m.user_id] = { adjustment: Number(m.adjustment) === 0 ? '' : String(Number(m.adjustment)), comments: m.comments || '' }; });
  return out;
}

export function LockBar({ ar, busy, onReopen, note }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 12, margin: '8px 0 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <span><Icon name="lock" size={14} /> <strong>{ar ? 'الدرجة النهائية مقفولة.' : 'The final grade is locked.'}</strong>{' '}
          <span className="st-muted">{note || (ar ? 'التعديل بعد الاعتماد بإعادة فتح بسبب مكتوب، ويُسجَّل ويصل للفريق.' : 'Changing it requires reopening with a written reason; this is logged and the team is notified.')}</span></span>
        {!open && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setOpen(true)}><Icon name="refresh" size={14} /> {ar ? 'إعادة فتح الدرجة' : 'Reopen grade'}</button>}
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          <textarea className="form-input" rows={2} placeholder={ar ? 'سبب إعادة الفتح (إلزامي)' : 'Reason for reopening (required)'} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !reason.trim()} onClick={async () => { const ok = await onReopen(reason.trim()); if (ok !== false) { setOpen(false); setReason(''); } }}>{ar ? 'تأكيد إعادة الفتح' : 'Confirm reopen'}</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { setOpen(false); setReason(''); }}>{ar ? 'إلغاء' : 'Cancel'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function GradeRevisions({ revisions = [], ar }) {
  if (!revisions.length) return null;
  const ROLE = { supervisor: ['Supervisor', 'الدكتور المشرف'], faculty: ['Faculty', 'الكلية'], university: ['University', 'الجامعة'] };
  return (
    <div style={{ marginTop: 14 }}>
      <strong>{ar ? 'سجل التقييم' : 'Grade history'}</strong>
      {revisions.map((r, i) => (
        <div key={i} style={{ fontSize: 13, marginTop: 6 }}>
          {r.action === 'reopened' ? (ar ? 'أُعيد فتحها' : 'Reopened') : (ar ? `اعتماد #${r.revision}` : `Finalized #${r.revision}`)}
          {` · ${(ROLE[r.actor_role] || [r.actor_role, r.actor_role])[ar ? 1 : 0]}${r.actor_name ? ` (${r.actor_name})` : ''}`}
          {r.action === 'finalized' && r.total_score != null ? ` · ${r.total_score}/${r.max_score}${r.letter_grade ? ` ${r.letter_grade}` : ''}` : ''}
          {r.created_at ? ` · ${new Date(r.created_at).toLocaleDateString(ar ? 'ar-EG' : 'en-US')}` : ''}
          {r.reason && <span className="st-muted"> — {r.reason}</span>}
        </div>
      ))}
    </div>
  );
}
