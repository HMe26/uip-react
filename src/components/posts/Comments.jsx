import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { postsApi } from '../../api/postsApi';
import { errorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { ago } from '../feed/feedUi';
import { Alert, Empty, PAvatar, REACTIONS, REPORT_REASONS, RichText, useTt } from './shared';
import UserAvatar from './UserAvatar';
import EmojiButton, { insertAtCaret } from './EmojiButton';
import usePostsRealtime, { isOwnEcho, markLocalWrite } from '../../lib/usePostsRealtime';
import { Dialog, useDialogs } from './Dialogs';

const MAX = 2000;
const RCOLOR = { like: '#3b5bdb', love: '#e11d48', insightful: '#d97706', celebrate: '#16a34a', support: '#0891b2', funny: '#ca8a04' };

/** Auto-growing textarea: Enter sends, Shift+Enter adds a line, Esc cancels. */
function Field({ value, onChange, onSubmit, onCancel, placeholder, autoFocus, busy, label, sendLabel, compact }) {
  const ref = useRef(null);
  useEffect(() => { const el = ref.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 180)}px`; }, [value]);
  useEffect(() => { if (autoFocus && ref.current) { ref.current.focus(); const n = ref.current.value.length; ref.current.setSelectionRange(n, n); } }, [autoFocus]);
  const near = value.length > MAX * 0.85;
  const addEmoji = (e) => { const v = insertAtCaret(ref.current, value, e, MAX); if (v != null) onChange(v); };
  return (
    <div className={`pp-field${compact ? ' is-compact' : ''}`}>
      <textarea ref={ref} rows={1} dir="auto" value={value} maxLength={MAX} placeholder={placeholder} aria-label={label || placeholder} disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSubmit(); }
          if (e.key === 'Escape' && onCancel) { e.stopPropagation(); onCancel(); }
        }} />
      <div className="pp-field__bar">
        {!busy && <EmojiButton onPick={addEmoji} className="pp-field__emo" size={17} up />}
        {near && <small className={value.length >= MAX ? 'pp-err' : 'pp-muted'}>{value.length}/{MAX}</small>}
        {onCancel && sendLabel?.cancel && label === 'edit' && <button type="button" className="pp-btn" onClick={onCancel} disabled={busy}>{sendLabel.cancel}</button>}
        <button type="button" className="pp-field__send" onClick={onSubmit} disabled={busy || !value.trim()} aria-label={sendLabel?.send}><Icon name="send" size={15} /></button>
      </div>
    </div>
  );
}

function ReportComment({ postId, comment, onClose, onSent }) {
  const { tt } = useTt();
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async () => {
    setBusy(true); setErr('');
    try { await postsApi.report(postId, reason, details.trim() || undefined, comment.id); onSent(); onClose(); } catch (e) { setErr(errorMessage(e)); setBusy(false); }
  };
  return (
    <Dialog title={tt('Report comment', 'الإبلاغ عن التعليق')} icon="flag" busy={busy} onClose={onClose}
      footer={<><button type="button" className="pp-btn" disabled={busy} onClick={onClose}>{tt('Cancel', 'إلغاء')}</button><button type="button" className="pp-btn is-primary" disabled={busy} onClick={send}>{tt('Send report', 'إرسال البلاغ')}</button></>}>
      <p className="pp-dlg__msg">{tt('Why are you reporting this comment?', 'ما سبب الإبلاغ عن هذا التعليق؟')}</p>
      <div className="pp-chips">{Object.entries(REPORT_REASONS).map(([k, [en, ar]]) => <button type="button" key={k} className={`pp-chip${reason === k ? ' is-on' : ''}`} onClick={() => setReason(k)}>{tt(en, ar)}</button>)}</div>
      <textarea className="pp-input pp-dlg__ta" rows={2} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} placeholder={tt('Details (optional)', 'تفاصيل (اختياري)')} />
      {err && <Alert tt={tt}>{err}</Alert>}
    </Dialog>
  );
}

function Comment({ c, postId, canComment, onChange, onDeleted, onReply, depth = 0, me, dialogs, notify }) {
  const { tt, locale } = useTt();
  const [replies, setReplies] = useState(null);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState(c.body);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [long, setLong] = useState(false);
  const [pick, setPick] = useState(false);
  const box = useRef(null);
  const pickRef = useRef(null);
  const pressT = useRef(0);
  const pressed = useRef(false);
  const hoverT = useRef(0);
  const sendLabel = { send: tt('Send', 'إرسال'), cancel: tt('Cancel', 'إلغاء') };

  useEffect(() => {
    if (!menu) return undefined;
    const h = (e) => { if (box.current && !box.current.contains(e.target)) setMenu(false); };
    const k = (e) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [menu]);

  const loadReplies = async (page = 1) => {
    setLoadingReplies(true);
    try {
      const r = await postsApi.replies(c.id, page);
      setReplies((p) => (page === 1 ? r.items : [...(p || []), ...r.items]));
      setMore(!!r.meta.has_more);
    } catch (e) { setErr(errorMessage(e)); } finally { setLoadingReplies(false); }
  };
  // Reactions on comments: same six as the post. Click = like / remove, hover (or long-press on touch) = pick another one.
  const react = async (type) => {
    markLocalWrite();
    const prev = c;
    const was = c.my_reaction || (c.liked_by_me ? 'like' : null);
    const bd = { ...(c.reactions || {}) };
    if (was) { bd[was] = Math.max(0, (bd[was] || 1) - 1); if (!bd[was]) delete bd[was]; }
    if (type) bd[type] = (bd[type] || 0) + 1;
    onChange({ ...c, my_reaction: type, liked_by_me: !!type, likes_count: Object.values(bd).reduce((a, b) => a + b, 0), reactions: bd }); // optimistic
    try {
      const r = await postsApi.reactComment(c.id, type);
      onChange({ ...c, my_reaction: r.my_reaction ?? null, liked_by_me: !!r.my_reaction, likes_count: r.likes_count ?? 0, reactions: r.reactions || {} });
    } catch (e) { onChange(prev); setErr(errorMessage(e)); }
  };
  const openPick = () => { clearTimeout(hoverT.current); hoverT.current = setTimeout(() => setPick(true), 250); };
  const closePick = () => { clearTimeout(hoverT.current); hoverT.current = setTimeout(() => setPick(false), 200); };
  const pressStart = (e) => { if (e.pointerType !== 'touch') return; pressed.current = false; clearTimeout(pressT.current); pressT.current = setTimeout(() => { pressed.current = true; setPick(true); }, 420); };
  const pressEnd = () => clearTimeout(pressT.current);
  useEffect(() => () => { clearTimeout(pressT.current); clearTimeout(hoverT.current); }, []);
  useEffect(() => {
    if (!pick) return undefined;
    const h = (e) => { if (pickRef.current && !pickRef.current.contains(e.target)) setPick(false); };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [pick]);
  const refreshReplies = async () => {
    try {
      const r = await postsApi.replies(c.id, 1);
      setReplies((p) => { const ids = new Set(r.items.map((x) => x.id)); return [...r.items, ...(p || []).filter((x) => !ids.has(x.id))]; });
    } catch { /* the next event / reconnect fixes it */ }
  };
  // Realtime inside an opened thread: new / edited / reacted replies appear without reloading
  const rt = useRef(0);
  usePostsRealtime(postId, (d) => {
    if (isOwnEcho(d, me?.id)) return;
    if (d.kind === 'comment_delete' && d.comment_id) { setReplies((p) => (p ? p.filter((x) => x.id !== d.comment_id) : p)); return; }
    if (d.kind === 'resync' || (d.parent_id === c.id && ['comment', 'comment_react', 'comment_edit'].includes(d.kind))) {
      clearTimeout(rt.current);
      rt.current = setTimeout(refreshReplies, 250 + Math.random() * 500);
    }
  }, depth === 0 && replies !== null);
  useEffect(() => () => clearTimeout(rt.current), []);
  const startReply = () => {
    setOpen(true);
    setText(depth > 0 || (c.author && !c.author.is_me) ? `@${c.author.full_name} ` : '');
  };
  const reply = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr(''); markLocalWrite();
    try {
      const n = await postsApi.addComment(postId, text.trim(), c.parent_id || c.id);
      setText(''); setOpen(false);
      if (depth === 0) { setReplies((p) => [...(p || []), n]); onChange({ ...c, replies_count: (c.replies_count || 0) + 1 }); }
      else onReply?.(n);
      notify?.('reply-added', n);
    } catch (er) { setErr(errorMessage(er)); } finally { setBusy(false); }
  };
  const save = async () => {
    if (!edit.trim() || busy) return;
    setBusy(true); setErr('');
    markLocalWrite();
    try { const n = await postsApi.editComment(c.id, edit.trim()); onChange({ ...c, ...n }); setEditing(false); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  const del = async () => {
    setMenu(false);
    const ok = await dialogs.confirm({
      title: tt('Delete comment?', 'حذف التعليق؟'),
      message: depth === 0 && c.replies_count > 0
        ? tt(`This comment and its ${c.replies_count} repl${c.replies_count > 1 ? 'ies' : 'y'} will be permanently deleted.`, `سيتم حذف هذا التعليق و${c.replies_count} ${c.replies_count > 1 ? 'ردود' : 'رد'} عليه نهائيًا.`)
        : tt('This comment will be permanently deleted. This can’t be undone.', 'سيتم حذف هذا التعليق نهائيًا ولا يمكن التراجع عن ذلك.'),
      confirmLabel: tt('Delete', 'حذف'),
      run: () => postsApi.deleteComment(c.id),
    });
    if (ok) { markLocalWrite(); setLeaving(true); setTimeout(() => onDeleted(c), 180); }
  };

  const body = c.body || '';
  const clamp = body.length > 420 && !long;
  const myR = c.my_reaction ? REACTIONS[c.my_reaction] : c.liked_by_me ? REACTIONS.like : null;
  const hasMenu = c.can.edit || c.can.delete || !c.author.is_me;

  return (
    <li className={`pp-cm${leaving ? ' is-leaving' : ''}${depth > 0 ? ' is-reply' : ''}`} id={`comment-${c.id}`}>
      <UserAvatar user={c.author} size={depth > 0 ? 28 : 36} />
      <div className="pp-cm__main">
        {editing ? (
          <div className="pp-cm__edit">
            <Field value={edit} onChange={setEdit} onSubmit={save} onCancel={() => { setEditing(false); setEdit(c.body); }} autoFocus busy={busy} sendLabel={{ send: tt('Save', 'حفظ'), cancel: tt('Cancel', 'إلغاء') }} compact label="edit" />
            <small className="pp-muted">{tt('Esc to cancel · Enter to save', 'Esc للإلغاء · Enter للحفظ')}</small>
          </div>
        ) : (
          <div className="pp-cm__row">
            <div className={`pp-cm__bubble${c.likes_count > 0 ? ' has-likes' : ''}`}>
              <div className="pp-cm__who">
                <strong>{c.author.full_name}</strong>
                {c.author.is_author && <em className="pp-chip is-brand">{tt('Author', 'الكاتب')}</em>}
              </div>
              <p dir="auto"><RichText text={clamp ? `${body.slice(0, 420)}…` : body} />{clamp && <button type="button" className="pp-link" onClick={() => setLong(true)}> {tt('See more', 'عرض المزيد')}</button>}</p>
              {c.likes_count > 0 && (() => {
                const top = Object.entries(c.reactions || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
                return (
                  <span className="pp-cm__likes" title={top.map(([k, n]) => `${tt(REACTIONS[k]?.en, REACTIONS[k]?.ar)} ${n}`).join(' · ')}>
                    <span className="pp-cm__emo">{(top.length ? top : [['like', 1]]).map(([k]) => <i key={k}>{REACTIONS[k]?.e}</i>)}</span>
                    {c.likes_count > 1 && <b>{c.likes_count}</b>}
                  </span>
                );
              })()}
            </div>
            {hasMenu && (
              <div className="pp-cm__menu" ref={box}>
                <button type="button" className="pp-icon pp-cm__dots" aria-label={tt('More options', 'خيارات أخرى')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><Icon name="more-horizontal" size={16} /></button>
                {menu && (
                  <div className="pp-menu__list" role="menu">
                    {c.can.edit && <button type="button" role="menuitem" onClick={() => { setMenu(false); setEdit(c.body); setEditing(true); }}><Icon name="edit" size={14} /> {tt('Edit', 'تعديل')}</button>}
                    {c.can.delete && <button type="button" role="menuitem" className="is-danger" onClick={del}><Icon name="trash" size={14} /> {tt('Delete', 'حذف')}</button>}
                    {!c.author.is_me && <button type="button" role="menuitem" onClick={() => { setMenu(false); setReport(true); }}><Icon name="flag" size={14} /> {tt('Report', 'إبلاغ')}</button>}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {!editing && (
          <div className="pp-cm__acts">
            <span className="pp-cm__react" ref={pickRef} onMouseEnter={openPick} onMouseLeave={closePick}>
              {pick && (
                <span className="pp-react__pick pp-cm__pick" role="menu">
                  {Object.entries(REACTIONS).map(([k, r]) => (
                    <button key={k} type="button" role="menuitem" title={tt(r.en, r.ar)} className={c.my_reaction === k ? 'is-on' : ''}
                      onClick={() => { setPick(false); react(c.my_reaction === k ? null : k); }}>{r.e}</button>
                  ))}
                </span>
              )}
              <button type="button" className={`pp-cm__rbtn${myR ? ' is-on' : ''}`} style={myR ? { '--rc': RCOLOR[c.my_reaction || 'like'] } : undefined} aria-pressed={!!myR}
                onPointerDown={pressStart} onPointerUp={pressEnd} onPointerLeave={pressEnd} onPointerCancel={pressEnd} onContextMenu={(e) => e.preventDefault()}
                onClick={() => { if (pressed.current) { pressed.current = false; return; } react(myR ? null : 'like'); }}>
                {myR ? <><span aria-hidden="true">{myR.e}</span> {tt(myR.en, myR.ar)}</> : tt('Like', 'إعجاب')}
              </button>
            </span>
            {canComment && <button type="button" onClick={() => (open ? setOpen(false) : startReply())}>{tt('Reply', 'رد')}</button>}
            <span className="pp-cm__time" title={c.created_at}>{ago(c.created_at, locale)}{c.edited_at ? ` · ${tt('Edited', 'معدّل')}` : ''}</span>
          </div>
        )}
        {err && <small className="pp-err" role="alert">{err}</small>}

        {open && (
          <div className="pp-cm__compose">
            <PAvatar user={me} size={28} />
            <Field value={text} onChange={setText} onSubmit={reply} onCancel={() => { setOpen(false); setText(''); }} autoFocus busy={busy} compact sendLabel={sendLabel}
              placeholder={tt(`Reply to ${c.author.full_name}…`, `الرد على ${c.author.full_name}…`)} />
          </div>
        )}

        {depth === 0 && c.replies_count > 0 && replies === null && (
          <button type="button" className="pp-cm__viewreplies" onClick={() => loadReplies(1)} disabled={loadingReplies}>
            <Icon name="corner-down-right" size={14} /> {loadingReplies ? tt('Loading…', 'جارٍ التحميل…') : tt(`View ${c.replies_count} repl${c.replies_count > 1 ? 'ies' : 'y'}`, `عرض ${c.replies_count} ${c.replies_count > 10 ? 'رد' : c.replies_count > 2 ? 'ردود' : 'رد'}`)}
          </button>
        )}
        {replies && (
          <ul className="pp-cm__list is-nested">
            {replies.map((r) => (
              <Comment key={r.id} c={r} postId={postId} canComment={canComment} depth={1} me={me} dialogs={dialogs} notify={notify}
                onReply={(n) => { setReplies((p) => [...(p || []), n]); onChange({ ...c, replies_count: (c.replies_count || 0) + 1 }); }}
                onChange={(n) => setReplies((p) => p.map((x) => (x.id === n.id ? n : x)))}
                onDeleted={(d) => { setReplies((p) => p.filter((x) => x.id !== d.id)); onChange({ ...c, replies_count: Math.max(0, (c.replies_count || 0) - 1) }); notify?.('reply-deleted', d); }} />
            ))}
            {more && <button type="button" className="pp-cm__viewreplies" disabled={loadingReplies} onClick={() => loadReplies(Math.ceil(replies.length / 10) + 1)}>{tt('Show more replies', 'عرض المزيد من الردود')}</button>}
          </ul>
        )}
      </div>
      {report && <ReportComment postId={postId} comment={c} onClose={() => setReport(false)} onSent={() => notify?.('reported', c)} />}
    </li>
  );
}

export default function Comments({ post, onCount }) {
  const { tt } = useTt();
  const { user } = useAuth();
  const dialogs = useDialogs();
  const [items, setItems] = useState(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sort, setSort] = useState('top');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const total = post.counts?.comments;

  const load = useCallback(async (page = 1) => {
    try {
      const r = await postsApi.comments(post.id, sort, page);
      setItems((p) => (page === 1 ? r.items : [...(p || []), ...r.items.filter((n) => !(p || []).some((x) => x.id === n.id))])); setMore(!!r.meta.has_more); setErr('');
    } catch (e) { setErr(errorMessage(e)); setItems((p) => p || []); }
  }, [post.id, sort]);
  useEffect(() => { setItems(null); load(1); }, [load]);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t); }, [toast]);

  // Realtime: new / edited / deleted / reacted comments from other people show up by themselves
  const refreshT = useRef(0);
  usePostsRealtime(post.id, (d) => {
    if (isOwnEcho(d, user?.id)) return;
    if (d.kind === 'comment_delete' && d.comment_id) setItems((p) => (p ? p.filter((x) => x.id !== d.comment_id) : p));
    if (!['comment', 'comment_react', 'comment_edit', 'comment_delete', 'resync'].includes(d.kind)) return;
    clearTimeout(refreshT.current);
    refreshT.current = setTimeout(async () => {
      try {
        const r = await postsApi.comments(post.id, sort, 1);
        setItems((p) => { if (!p) return r.items; const ids = new Set(r.items.map((x) => x.id)); return [...r.items, ...p.filter((x) => !ids.has(x.id))]; });
      } catch { /* the next event / reconnect fixes it */ }
    }, 250 + Math.random() * 500);
  });
  useEffect(() => () => clearTimeout(refreshT.current), []);

  const add = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr(''); markLocalWrite();
    try { const n = await postsApi.addComment(post.id, text.trim()); setText(''); setItems((p) => [n, ...(p || [])]); onCount?.(1); }
    catch (er) { setErr(errorMessage(er)); } finally { setBusy(false); }
  };
  const loadMore = async () => { setLoadingMore(true); await load(Math.ceil((items?.length || 0) / 10) + 1); setLoadingMore(false); };
  // Replies are counted in the post's total: keep it in sync with what the thread does.
  const notify = (what, c) => {
    if (what === 'reply-added') onCount?.(1);
    if (what === 'reply-deleted') onCount?.(-1);
    if (what === 'reported') setToast(tt('Thanks — your report was sent.', 'شكرًا — تم إرسال البلاغ.'));
    if (what === 'reply-added') setToast(tt('Reply posted.', 'تم نشر الرد.'));
    return c;
  };

  return (
    <section className="pp-comments" aria-label={tt('Comments', 'التعليقات')}>
      <div className="pp-comments__head">
        <h4>{tt('Comments', 'التعليقات')}{total > 0 && <span className="pp-comments__n">{total}</span>}</h4>
        <label className="pp-comments__sort">
          <span>{tt('Sort by', 'ترتيب حسب')}</span>
          <select className="pp-input pp-input--sm" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tt('Sort comments', 'ترتيب التعليقات')}>
            <option value="top">{tt('Most relevant', 'الأكثر صلة')}</option>
            <option value="new">{tt('Newest', 'الأحدث')}</option>
          </select>
        </label>
      </div>

      {post.can.comment ? (
        <div className="pp-cm__compose is-main">
          <PAvatar user={user} size={36} />
          <Field value={text} onChange={setText} onSubmit={add} busy={busy} placeholder={tt('Write a comment…', 'اكتب تعليقًا…')} sendLabel={{ send: tt('Send', 'إرسال') }} />
        </div>
      ) : <p className="pp-comments__locked"><Icon name="lock" size={14} /> {post.comments_mode === 'none' ? tt('Comments are turned off for this post.', 'التعليقات مغلقة على هذا المنشور.') : tt('You can’t comment on this post.', 'لا يمكنك التعليق على هذا المنشور.')}</p>}

      {err && <Alert tt={tt} onRetry={() => load(1)}>{err}</Alert>}
      {items === null && <div className="pp-cm__skel">{[0, 1].map((i) => <div key={i}><span className="pp-skel" /><span className="pp-skel" /></div>)}</div>}
      {items && items.length === 0 && !err && <Empty icon="message-square" title={tt('No comments yet', 'لا توجد تعليقات بعد')} text={post.can.comment ? tt('Be the first to share your thoughts.', 'كن أول من يشارك رأيه.') : undefined} />}
      <ul className="pp-cm__list">
        {(items || []).map((c) => (
          <Comment key={c.id} c={c} postId={post.id} canComment={post.can.comment} me={user} dialogs={dialogs} notify={notify}
            onChange={(n) => setItems((p) => p.map((x) => (x.id === n.id ? n : x)))}
            onDeleted={(d) => { setItems((p) => p.filter((x) => x.id !== d.id)); onCount?.(-(1 + (d.replies_count || 0))); }} />
        ))}
      </ul>
      {more && <button type="button" className="pp-cm__viewreplies is-more" disabled={loadingMore} onClick={loadMore}>{loadingMore ? tt('Loading…', 'جارٍ التحميل…') : tt('View more comments', 'عرض المزيد من التعليقات')}</button>}
      {toast && <div className="pp-cm__toast" role="status">{toast}</div>}
      {dialogs.dialogs}
    </section>
  );
}
