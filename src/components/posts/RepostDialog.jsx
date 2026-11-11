import { useState } from 'react';
import { postsApi } from '../../api/postsApi';
import { errorMessage } from '../../api/client';
import { Alert, PAvatar, RichText, useTt } from './shared';
import { Dialog } from './Dialogs';
import { ago } from '../feed/feedUi';

/** Repost sheet (like LinkedIn / Facebook): add your own thoughts above a preview of the original, then publish to your profile. */
export default function RepostDialog({ post, onClose, onDone }) {
  const { tt, locale } = useTt();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const original = post.repost_of && !post.repost_of.unavailable ? post.repost_of : post;
  const send = async () => {
    setBusy(true); setErr('');
    try { await postsApi.repost(post.id, text.trim() || undefined); onDone?.(); onClose(); } catch (e) { setErr(errorMessage(e)); setBusy(false); }
  };
  const snippet = (original.title ? `${original.title}\n` : '') + (original.body || '');
  return (
    <Dialog title={tt('Repost to your profile', 'إعادة النشر على ملفك')} icon="refresh" busy={busy} onClose={onClose} wide
      footer={<>
        <button type="button" className="pp-btn" disabled={busy} onClick={onClose}>{tt('Cancel', 'إلغاء')}</button>
        <button type="button" className="pp-btn is-primary" disabled={busy} onClick={send}>{busy ? tt('Posting…', 'جارٍ النشر…') : tt('Repost', 'إعادة نشر')}</button>
      </>}>
      <textarea className="pp-input pp-dlg__ta" rows={3} maxLength={1000} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={tt('Say something about this post… (optional)', 'اكتب رأيك في هذا المنشور… (اختياري)')} dir="auto" />
      <div className="pp-dlg__count">{text.length}/1000</div>
      <div className="pp-quote-prev">
        <div className="pp-quote-prev__who"><PAvatar user={original.author} size={32} /><div><strong>{original.author?.full_name}</strong><small>{ago(original.published_at || original.created_at, locale)}</small></div></div>
        {snippet && <p dir="auto"><RichText text={snippet.length > 280 ? `${snippet.slice(0, 280)}…` : snippet} /></p>}
        {original.media?.length > 0 && <small className="pp-muted">{tt(`${original.media.length} attachment(s)`, `${original.media.length} مرفق`)}</small>}
      </div>
      <p className="pp-muted">{tt('Your repost is public and links back to the original author.', 'إعادة النشر عامة وتشير إلى صاحب المنشور الأصلي.')}</p>
      {err && <Alert tt={tt}>{err}</Alert>}
    </Dialog>
  );
}
