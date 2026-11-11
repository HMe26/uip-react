import { useState } from 'react';
import Icon from '../Icon';
import { StModal } from './stUi';
import { parseServerDate } from '../../utils/serverDate';

/**
 * Small building blocks shared by StudentContacts / StudentGroupChat /
 * StudentGroupHub. Styles: styles/css/student-groups.css (sg-*), built on the
 * same tokens as the rest of the Student portal (ex-* / st-*).
 */

export function initialsOf(name) {
  const parts = String(name || '').replace(/^(Dr\.?|د\.?)\s*/i, '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

const TONES = 6;
function toneOf(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % TONES;
}

/** Round initials avatar with a stable colour per name (photo when `src` is given). */
export function Avatar({ name, size = 'md', tone, src }) {
  return (
    <span className={`sg-avatar sg-avatar--${size} sg-tone-${tone ?? toneOf(name)}`} aria-hidden="true">
      {src ? <img src={src} alt="" className="sg-avatar__img" /> : initialsOf(name)}
    </span>
  );
}

export function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1048576) return `${(v / 1024).toFixed(v < 10240 ? 1 : 0)} KB`;
  return `${(v / 1048576).toFixed(1)} MB`;
}

/** "now / 5 m ago / 3 h ago / 2 d ago" — minute granularity (stUi.timeAgo is per day). */
export function relTime(value, locale) {
  if (!value) return '';
  const d = parseServerDate(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  const ar = locale === 'ar';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return ar ? 'الآن' : 'just now';
  if (s < 3600) { const n = Math.floor(s / 60); return ar ? `منذ ${n} د` : `${n}m ago`; }
  if (s < 86400) { const n = Math.floor(s / 3600); return ar ? `منذ ${n} س` : `${n}h ago`; }
  if (s < 2592000) { const n = Math.floor(s / 86400); return ar ? `منذ ${n} يوم` : `${n}d ago`; }
  return d.toLocaleDateString(ar ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function clockTime(value, locale) {
  const d = parseServerDate(String(value || ''));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(locale === 'ar' ? 'ar-EG' : 'en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "Today" / "Yesterday" / "Mon, Oct 5" label used for chat day separators. */
export function dayLabel(value, locale) {
  const d = parseServerDate(String(value || ''));
  if (Number.isNaN(d.getTime())) return '';
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const days = Math.round((start.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  const ar = locale === 'ar';
  if (days <= 0) return ar ? 'اليوم' : 'Today';
  if (days === 1) return ar ? 'أمس' : 'Yesterday';
  return d.toLocaleDateString(ar ? 'ar-EG' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export const dayKeyOf = (value) => {
  const d = parseServerDate(String(value || ''));
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** Page-level skeleton while data loads. */
export function SgSkeleton({ rows = 3, h = 96 }) {
  return (
    <div className="ex-page">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="st-skel" style={{ height: h }} />)}
    </div>
  );
}

/**
 * Replaces the old window.prompt(): a proper modal that asks for an optional
 * reason, then calls onConfirm(reason).
 */
export function DeleteModal({ ar, title, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try { await onConfirm(reason.trim()); } finally { setBusy(false); }
  };
  return (
    <StModal
      title={title || (ar ? 'تأكيد الحذف' : 'Confirm delete')}
      onClose={onClose}
      actions={(
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>{ar ? 'إلغاء' : 'Cancel'}</button>
          <button type="button" className="btn sg-btn-danger" disabled={busy} onClick={confirm}>
            <Icon name="trash" size={14} /> {busy ? (ar ? 'جارٍ الحذف…' : 'Deleting…') : (ar ? 'حذف' : 'Delete')}
          </button>
        </>
      )}
    >
      <p style={{ margin: '0 0 12px' }}>{ar ? 'هل أنت متأكد؟ لا يمكن التراجع عن هذا الإجراء.' : 'Are you sure? This cannot be undone.'}</p>
      <label className="ex-label" htmlFor="sg-del-reason">{ar ? 'السبب (اختياري)' : 'Reason (optional)'}</label>
      <textarea id="sg-del-reason" className="ex-textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
    </StModal>
  );
}

/**
 * Replaces the old window.prompt() in Contacts: a proper modal with a message
 * box. onSend(body) should throw / reject on failure (the error is shown inline).
 */
export function MessageModal({ ar, name, onClose, onSend }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async () => {
    if (!body.trim()) return;
    setBusy(true); setErr('');
    try { await onSend(body.trim()); } catch (e) { setErr(e?.message || String(e)); setBusy(false); }
  };
  return (
    <StModal
      title={ar ? `رسالة إلى ${name}` : `Message ${name}`}
      onClose={onClose}
      actions={(
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>{ar ? 'إلغاء' : 'Cancel'}</button>
          <button type="button" className="btn btn-primary" disabled={busy || !body.trim()} onClick={send}>
            <Icon name="send" size={14} /> {busy ? (ar ? 'جارٍ الإرسال…' : 'Sending…') : (ar ? 'إرسال' : 'Send')}
          </button>
        </>
      )}
    >
      <label className="ex-label" htmlFor="sg-msg-body">{ar ? 'نص الرسالة' : 'Your message'}</label>
      <textarea id="sg-msg-body" className="ex-textarea" rows={4} autoFocus value={body} onChange={(e) => setBody(e.target.value)} />
      {err && <p className="sg-inline-error">{err}</p>}
    </StModal>
  );
}
