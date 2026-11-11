import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from '../Icon';
import { networkApi } from '../../api/networkApi';
import { errorMessage } from '../../api/client';
import { useTt } from '../posts/shared';
import { useDialogs } from '../posts/Dialogs';

/** Optional note shown to the person with a connection request. */
function ConnectNote({ person, onSend, onCancel, busy, tt }) {
  const [text, setText] = useState('');
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCancel]);
  return (
    <div className="nw-note" role="dialog" aria-label={tt('Add a note', 'أضف رسالة')} onClick={(e) => e.stopPropagation()}>
      <strong>{tt(`Connect with ${person.full_name}`, `طلب اتصال إلى ${person.full_name}`)}</strong>
      <textarea rows={3} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} autoFocus
        placeholder={tt('Add a short note (optional) — say why you want to connect.', 'أضف رسالة قصيرة (اختياري) — اذكر سبب رغبتك في الاتصال.')} />
      <div className="nw-note__row">
        <small>{text.length}/300</small>
        <span>
          <button type="button" className="pp-btn" onClick={onCancel}>{tt('Cancel', 'إلغاء')}</button>
          <button type="button" className="pp-btn is-primary" disabled={busy} onClick={() => onSend(text.trim())}>{tt('Send request', 'إرسال الطلب')}</button>
        </span>
      </div>
    </div>
  );
}

/**
 * The action buttons for one person, driven by their relation to me (connection / follow state).
 * `mode` picks the context: default | received | sent | followreq | followers | following | connections.
 * onPatch(id, patch): merge fresh relation fields into the list item; onRemove(id, why): drop it from the current list.
 */
export default function PersonActions({ p, mode = 'default', onPatch, onRemove, onOpenProfile, compact = false }) {
  const { tt } = useTt();
  const nav = useNavigate();
  const loc = useLocation();
  const portal = loc.pathname.split('/')[1] || 'student';
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState(false);
  const [menu, setMenu] = useState(false);
  const box = useRef(null);
  const dialogs = useDialogs();

  useEffect(() => {
    if (!menu) return undefined;
    const h = (e) => { if (box.current && !box.current.contains(e.target)) setMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menu]);

  if (!p || p.is_me) return null;

  const run = async (key, fn, after) => {
    setBusy(key); setErr(''); setMenu(false);
    try { const r = await fn(); after?.(r); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(''); }
  };
  const patch = (r) => onPatch?.(p.id, r);
  const connect = (message) => run('connect', () => networkApi.connect(p.id, message), (r) => { patch(r); setNote(false); });
  const accept = () => run('accept', () => networkApi.accept(p.connection_id), (r) => { patch(r); if (mode === 'received') onRemove?.(p.id, 'accepted'); });
  const decline = () => run('decline', () => networkApi.decline(p.connection_id), (r) => { patch(r); if (mode === 'received') onRemove?.(p.id, 'declined'); });
  const withdraw = () => run('withdraw', () => networkApi.withdraw(p.connection_id), (r) => { patch(r); if (mode === 'sent') onRemove?.(p.id, 'withdrawn'); });
  const removeConn = async () => {
    setMenu(false);
    if (!(await dialogs.confirm({ title: tt('Remove connection?', 'إزالة الاتصال؟'), message: tt(`${p.full_name} will no longer be one of your connections. You can send a new request later.`, `لن يعود ${p.full_name} ضمن اتصالاتك. يمكنك إرسال طلب جديد لاحقًا.`), confirmLabel: tt('Remove', 'إزالة'), icon: 'user-minus' }))) return;
    run('remove', () => networkApi.removeConnection(p.id), (r) => { patch(r); if (mode === 'connections') onRemove?.(p.id, 'removed'); });
  };
  const toggleFollow = () => run('follow', () => (p.is_following || p.follow_requested ? networkApi.unfollow(p.id) : networkApi.follow(p.id)),
    (r) => { patch({ is_following: r.is_following, follow_requested: r.follow_requested }); if (mode === 'following' && !r.is_following) onRemove?.(p.id, 'unfollowed'); });
  const acceptFollow = () => run('accept', () => networkApi.acceptFollow(p.id), (r) => { patch(r); onRemove?.(p.id, 'accepted'); });
  const declineFollow = () => run('decline', () => networkApi.declineFollow(p.id), () => onRemove?.(p.id, 'declined'));
  const removeFollower = async () => {
    setMenu(false);
    if (!(await dialogs.confirm({ title: tt('Remove follower?', 'إزالة المتابِع؟'), message: tt(`${p.full_name} will stop following you and won’t see your posts that are for followers.`, `سيتوقف ${p.full_name} عن متابعتك ولن يرى منشوراتك الخاصة بالمتابعين.`), confirmLabel: tt('Remove', 'إزالة'), icon: 'user-x' }))) return;
    run('remove', () => networkApi.removeFollower(p.id), (r) => { patch(r); if (mode === 'followers') onRemove?.(p.id, 'removed'); });
  };
  const message = () => run('msg', () => networkApi.openChat(p.id), (id) => { if (id) nav(`/${portal}/messages/${id}`); });

  const Btn = ({ k, cls = '', icon, children, onClick, disabled, title }) => (
    <button type="button" className={`pp-btn nw-btn ${cls}`} disabled={disabled || !!busy} onClick={onClick} title={title} aria-busy={busy === k}>
      {icon && <Icon name={icon} size={15} />}{!compact || !icon ? <span>{children}</span> : <span className="nw-sr">{children}</span>}
    </button>
  );

  // Incoming requests: only accept / decline.
  if (mode === 'received' || (mode === 'default' && p.connection === 'pending_received')) {
    return (
      <div className="nw-actions">
        <Btn k="accept" cls="is-primary" icon="check" onClick={accept}>{tt('Accept', 'قبول')}</Btn>
        <Btn k="decline" icon="x" onClick={decline}>{tt('Ignore', 'تجاهل')}</Btn>
        {err && <small className="nw-err">{err}</small>}
      </div>
    );
  }
  if (mode === 'followreq') {
    return (
      <div className="nw-actions">
        <Btn k="accept" cls="is-primary" icon="check" onClick={acceptFollow}>{tt('Accept', 'قبول')}</Btn>
        <Btn k="decline" icon="x" onClick={declineFollow}>{tt('Decline', 'رفض')}</Btn>
        {err && <small className="nw-err">{err}</small>}
      </div>
    );
  }
  if (mode === 'sent') {
    return (
      <div className="nw-actions">
        <Btn k="withdraw" icon="x" onClick={withdraw}>{tt('Withdraw', 'سحب الطلب')}</Btn>
        {err && <small className="nw-err">{err}</small>}
      </div>
    );
  }

  const connected = p.connection === 'connected';
  const followLabel = p.is_following ? tt('Following', 'تتابعه') : p.follow_requested ? tt('Requested', 'تم الطلب') : p.follows_me ? tt('Follow back', 'رد المتابعة') : tt('Follow', 'متابعة');

  return (
    <div className="nw-actions" ref={box}>
      {connected && <Btn k="msg" cls="is-primary" icon="message-square" onClick={message} disabled={!p.can_message} title={p.can_message ? undefined : tt('This person is not receiving messages', 'هذا الشخص لا يستقبل رسائل')}>{tt('Message', 'مراسلة')}</Btn>}
      {p.connection === 'none' && <Btn k="connect" cls="is-primary" icon="user-plus" onClick={() => setNote(true)}>{tt('Connect', 'اتصال')}</Btn>}
      {p.connection === 'pending_sent' && <Btn k="withdraw" icon="clock" onClick={withdraw} title={tt('Withdraw request', 'سحب الطلب')}>{tt('Pending', 'قيد الانتظار')}</Btn>}
      <Btn k="follow" cls={p.is_following ? 'is-on' : ''} icon={p.is_following ? 'check' : 'plus'} onClick={toggleFollow}>{followLabel}</Btn>
      {!connected && p.can_message && <button type="button" className="pp-btn nw-icon" disabled={!!busy} onClick={message} title={tt('Message', 'مراسلة')} aria-label={tt('Message', 'مراسلة')}><Icon name="message-square" size={16} /></button>}
      <span className="nw-more">
        <button type="button" className="pp-btn nw-icon" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label={tt('More', 'المزيد')}><Icon name="more-horizontal" size={16} /></button>
        {menu && (
          <div className="nw-menu" role="menu">
            {onOpenProfile && <button type="button" role="menuitem" onClick={() => { setMenu(false); onOpenProfile(p); }}><Icon name="user" size={14} /> {tt('View profile', 'عرض الملف')}</button>}
            {connected && <button type="button" role="menuitem" onClick={removeConn}><Icon name="user-minus" size={14} /> {tt('Remove connection', 'إزالة الاتصال')}</button>}
            {p.follows_me && <button type="button" role="menuitem" onClick={removeFollower}><Icon name="user-x" size={14} /> {tt('Remove follower', 'إزالة المتابِع')}</button>}
          </div>
        )}
      </span>
      {note && <ConnectNote person={p} busy={busy === 'connect'} tt={tt} onCancel={() => setNote(false)} onSend={connect} />}
      {err && <small className="nw-err">{err}</small>}
      {dialogs.dialogs}
    </div>
  );
}
