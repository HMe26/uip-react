import { useState } from 'react';
import Icon from '../../Icon';
import { DRIVE_STATUS, useL } from './shared';

/**
 * Per-user limits editor, used for one user (detail page) and for bulk edits.
 * Blank quota / file size = follow the defaults. quota 0 = unlimited. onSubmit(payload) → Promise.
 * In bulk mode only the fields the admin ticks ("apply") are sent.
 */
export default function LimitsForm({ initial = {}, bulk, busy, onSubmit, onCancel }) {
  const { ar, L } = useL();
  const [quota, setQuota] = useState(initial.quota_mb_override ?? '');
  const [maxFile, setMaxFile] = useState(initial.max_file_mb_override ?? '');
  const [status, setStatus] = useState(initial.status || 'active');
  const [reason, setReason] = useState(initial.reason || '');
  const [note, setNote] = useState(initial.note || '');
  const [sharingBlocked, setSharingBlocked] = useState(!!initial.sharing_blocked);
  const [uploadsBlocked, setUploadsBlocked] = useState(!!initial.uploads_blocked);
  const [apply, setApply] = useState({});
  const on = (k) => !bulk || apply[k];
  const Tick = ({ k }) => (bulk ? <input type="checkbox" checked={!!apply[k]} onChange={(e) => setApply((a) => ({ ...a, [k]: e.target.checked }))} aria-label={L('Apply this field', 'طبّق الحقل ده')} /> : null);

  function submit(e) {
    e.preventDefault();
    const p = {};
    if (on('quota')) p.quota_mb = quota === '' ? null : Number(quota);
    if (on('max_file')) p.max_file_mb = maxFile === '' ? null : Number(maxFile);
    if (on('status')) { p.status = status; p.reason = reason; }
    if (on('note')) p.note = note;
    if (on('sharing')) p.sharing_blocked = sharingBlocked;
    if (on('uploads')) p.uploads_blocked = uploadsBlocked;
    onSubmit(p);
  }

  return (
    <form className="mtc-form dvc-limits" onSubmit={submit}>
      <label className="mtc-field"><span><Tick k="quota" /> {L('Storage quota (MB)', 'حصة التخزين (ميجا)')}</span>
        <input className="form-input" type="number" min={0} value={quota} disabled={!on('quota')} placeholder={L('Default', 'الافتراضي')} onChange={(e) => setQuota(e.target.value)} />
        <small className="mtc-muted">{L('Blank = default · 0 = unlimited', 'فاضي = الافتراضي · 0 = بلا حد')}</small></label>
      <label className="mtc-field"><span><Tick k="max_file" /> {L('Max file size (MB)', 'أقصى حجم للملف (ميجا)')}</span>
        <input className="form-input" type="number" min={1} value={maxFile} disabled={!on('max_file')} placeholder={L('Default', 'الافتراضي')} onChange={(e) => setMaxFile(e.target.value)} /></label>
      <label className="mtc-field"><span><Tick k="status" /> {L('Account state in My PC', 'حالة الحساب في جهازي')}</span>
        <select className="form-select" value={status} disabled={!on('status')} onChange={(e) => setStatus(e.target.value)}>
          {Object.entries(DRIVE_STATUS).map(([k, v]) => <option key={k} value={k}>{ar ? v[1] : v[0]}</option>)}
        </select>
        <small className="mtc-muted">{status === 'readonly' ? L('Can view and download, nothing else.', 'يشوف وينزّل بس.') : status === 'blocked' ? L('My PC is closed for this user.', 'جهازي مقفول للمستخدم ده.') : L('Normal access.', 'استخدام عادي.')}</small></label>
      <label className="mtc-field"><span>{L('Reason (shown to the user)', 'السبب (بيظهر للمستخدم)')}</span>
        <input className="form-input" maxLength={300} value={reason} disabled={!on('status') || status === 'active'} onChange={(e) => setReason(e.target.value)} /></label>
      <label className="mtc-field mtc-field--wide"><span><Tick k="note" /> {L('Internal note (admins only)', 'ملاحظة داخلية (للأدمن فقط)')}</span>
        <input className="form-input" maxLength={500} value={note} disabled={!on('note')} onChange={(e) => setNote(e.target.value)} /></label>
      <label className={`mtc-check${sharingBlocked ? ' is-on' : ''}`}><Tick k="sharing" /> <input type="checkbox" checked={sharingBlocked} disabled={!on('sharing')} onChange={(e) => setSharingBlocked(e.target.checked)} /> {L('Block sharing links', 'منع روابط المشاركة')}</label>
      <label className={`mtc-check${uploadsBlocked ? ' is-on' : ''}`}><Tick k="uploads" /> <input type="checkbox" checked={uploadsBlocked} disabled={!on('uploads')} onChange={(e) => setUploadsBlocked(e.target.checked)} /> {L('Block uploads', 'منع الرفع')}</label>
      <div className="mtc-actions mtc-field--wide">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || (bulk && !Object.values(apply).some(Boolean))}><Icon name="save" size={14} /> {busy ? '…' : L('Save limits', 'حفظ الحدود')}</button>
        {onCancel && <button type="button" className="btn btn-outline btn-sm" onClick={onCancel}>{L('Cancel', 'إلغاء')}</button>}
      </div>
    </form>
  );
}
