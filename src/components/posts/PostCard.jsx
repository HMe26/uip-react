import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { postsApi } from '../../api/postsApi';
import { errorMessage } from '../../api/client';
import { ago } from '../feed/feedUi';
import { compact } from '../../lib/postMedia';
import { Alert, REACTIONS, REPORT_REASONS, RichText, VIS, useTt } from './shared';
import PostMedia from './PostMedia';
import UserAvatar, { useProfilePath } from './UserAvatar';
import { useNavigate } from 'react-router-dom';
import LinkCard from './LinkCard';
import SaveDialog from './SaveDialog';
import ShareDialog from './ShareDialog';
import InsightsDialog from './InsightsDialog';
import RepostDialog from './RepostDialog';
import { useDialogs } from './Dialogs';
import { useAuth } from '../../context/AuthContext';
import usePostsRealtime, { isOwnEcho, markLocalWrite } from '../../lib/usePostsRealtime';

const Comments = lazy(() => import('./Comments'));
const BODY_CLAMP = 420;

function ReportBox({ post, onDone, tt }) {
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  const [err, setErr] = useState('');
  const send = async (e) => { e.preventDefault(); try { await postsApi.report(post.id, reason, details || undefined); onDone(); } catch (x) { setErr(errorMessage(x)); } };
  return (
    <form className="pp-panel" onSubmit={send}>
      <strong>{tt('Why are you reporting this post?', 'سبب الإبلاغ عن المنشور')}</strong>
      <div className="pp-chips">{Object.entries(REPORT_REASONS).map(([k, [en, ar]]) => <button type="button" key={k} className={`pp-chip${reason === k ? ' is-on' : ''}`} onClick={() => setReason(k)}>{tt(en, ar)}</button>)}</div>
      <textarea className="pp-input" rows={2} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} placeholder={tt('Details (optional)', 'تفاصيل (اختياري)')} />
      {err && <small className="pp-err">{err}</small>}
      <div className="pp-row"><button className="pp-btn is-primary">{tt('Send report', 'إرسال البلاغ')}</button><button type="button" className="pp-btn" onClick={onDone}>{tt('Cancel', 'إلغاء')}</button></div>
    </form>
  );
}

/** One post: header, text, attachments, reactions, comments, repost / share / save, and the author / reader menu. */
export default function PostCard({ post: initial, onChange, onRemoved, onTag, onEdit, onOpenAuthor, onSavedRemoved, compactView = false }) {
  const { tt, locale } = useTt();
  const [post, setPost] = useState(initial);
  const [panel, setPanel] = useState(null); // comments | report | repost
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [sensitiveOk, setSensitiveOk] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [repostOpen, setRepostOpen] = useState(false);
  const dialogs = useDialogs();
  const nav = useNavigate();
  const profilePath = useProfilePath();
  const [insights, setInsights] = useState(null); // null | 'reactions' | 'shares' | 'reposts' | 'views'
  const ref = useRef(null);
  useEffect(() => setPost(initial), [initial]);

  const patch = (p) => setPost((cur) => { const n = { ...cur, ...p }; onChange?.(n); return n; });
  const bumpCount = (k, d) => patch({ counts: post.counts ? { ...post.counts, [k]: Math.max(0, (post.counts[k] || 0) + d) } : post.counts });
  const run = async (fn) => { setErr(''); setNote(''); markLocalWrite(); try { await fn(); } catch (e) { setErr(errorMessage(e)); } };

  // Realtime: someone reacted / commented / saved / edited this post → re-fetch it (counts, my state, text) a moment later
  const { user: me } = useAuth();
  const rtTimer = useRef(0);
  usePostsRealtime(post.id, (d) => {
    if (d.kind === 'removed') { onRemoved?.(post); return; }
    if (isOwnEcho(d, me?.id)) return;
    if (d.kind === 'resync') { const r = ref.current?.getBoundingClientRect(); if (!r || r.bottom < -300 || r.top > window.innerHeight + 300) return; }
    clearTimeout(rtTimer.current);
    rtTimer.current = setTimeout(async () => {
      try { const n = await postsApi.one(post.id); if (n) patch(n); } catch (e) { if (e?.status === 404) onRemoved?.(post); }
    }, 200 + Math.random() * 600);
  }, !compactView);
  useEffect(() => () => clearTimeout(rtTimer.current), []);

  // dwell tracking: report a view once the card has been mostly visible for 2s (feeds the ranking), and again on leave with the real dwell
  useEffect(() => {
    if (post.status !== 'published' || !ref.current) return undefined;
    let t0 = 0; let sent = false;
    const flush = () => { if (t0) { const ms = Date.now() - t0; t0 = 0; if (ms >= 2000 && !sent) { sent = true; postsApi.view(post.id, ms).catch(() => {}); } } };
    const io = new IntersectionObserver(([e]) => { if (e.intersectionRatio >= 0.6) { if (!t0) t0 = Date.now(); } else flush(); }, { threshold: [0, 0.6] });
    io.observe(ref.current);
    return () => { flush(); io.disconnect(); };
  }, [post.id, post.status]);

  const react = (type) => run(async () => {
    setPicker(false);
    const next = post.my_reaction === type ? null : type;
    const r = await postsApi.react(post.id, next);
    patch({ my_reaction: r.my_reaction, reaction_breakdown: r.breakdown, counts: post.counts ? { ...post.counts, reactions: r.reactions_count } : post.counts });
  });
  const saveDone = (r) => {
    setSaveOpen(false);
    patch({ saved: r.saved, saved_collection_id: r.collection_id ?? null, counts: post.counts ? { ...post.counts, saves: r.saves_count } : post.counts });
    setNote(!r.saved ? tt('Removed from saved.', 'تم إلغاء الحفظ.') : r.moved ? tt('Moved.', 'تم النقل.') : r.folder ? tt(`Saved to “${r.folder}”.`, `تم الحفظ في «${r.folder}».`) : tt('Saved.', 'تم الحفظ.'));
    if (!r.saved && onSavedRemoved) onSavedRemoved(post);
  };
  const repostWhy = () => (post.visibility !== 'public' ? tt('Only public posts can be reposted.', 'يمكن إعادة نشر المنشورات العامة فقط.')
    : post.author.is_me ? tt('You can’t repost your own post.', 'لا يمكنك إعادة نشر منشورك.')
    : tt('The author turned reposting off for this post.', 'قام صاحب المنشور بإيقاف إعادة النشر.'));
  const shared = (kind) => bumpCount(kind === 'repost' ? 'reposts' : 'shares', 1);
  const repostDone = () => { bumpCount('reposts', 1); setNote(tt('Reposted to your profile', 'تمت إعادة النشر')); };
  const follow = () => run(async () => { const r = post.author.is_following ? await postsApi.unfollow(post.author.id) : await postsApi.follow(post.author.id); patch({ author: { ...post.author, is_following: r?.following ?? !post.author.is_following } }); });
  const del = async () => {
    setMenu(false);
    const ok = await dialogs.confirm({
      title: tt('Delete post?', 'حذف المنشور؟'),
      message: tt('This post, its comments and reactions will be permanently deleted. This can’t be undone.', 'سيتم حذف المنشور وتعليقاته وتفاعلاته نهائيًا ولا يمكن التراجع عن ذلك.'),
      confirmLabel: tt('Delete', 'حذف'),
      run: () => postsApi.remove(post.id),
    });
    if (ok) onRemoved?.(post);
  };
  const pin = () => run(async () => { await (post.is_pinned ? postsApi.unpin(post.id) : postsApi.pin(post.id)); patch({ is_pinned: !post.is_pinned }); setMenu(false); });
  const archive = () => run(async () => { await postsApi.archive(post.id); onRemoved?.(post); });
  const publish = () => run(async () => { const n = await postsApi.publish(post.id); patch(n && n.id ? n : { status: 'published' }); });
  const hide = () => run(async () => { await postsApi.hide(post.id, 'not_interested'); onRemoved?.(post); });
  const mute = () => run(async () => { await postsApi.mute(post.author.id); onRemoved?.(post); });

  const c = post.counts;
  const vis = VIS[post.visibility] || VIS.public;
  const long = (post.body || '').length > BODY_CLAMP && !expanded;
  const top = Object.entries(post.reaction_breakdown || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const hiddenMedia = post.is_sensitive && !sensitiveOk && !post.author.is_me;
  const my = post.my_reaction ? REACTIONS[post.my_reaction] : null;

  return (
    <article ref={ref} className={`pp-post${post.subtype ? ` pp-post--${post.subtype}` : ''}${post.is_pinned ? ' is-pinned' : ''}${post.status !== 'published' ? ' is-draft' : ''}`}>
      <header className="pp-post__head">
        <UserAvatar user={post.author} size={40} />
        <div className="pp-post__who">
          <strong><button type="button" className="pp-namelink" onClick={() => (onOpenAuthor ? onOpenAuthor(post.author) : nav(profilePath(post.author.id)))}>{post.author.full_name}</button>
            {post.subtype && <span className="pp-subtype"> {post.subtype === 'profile_photo' ? tt('updated their profile picture', 'غيّر صورته الشخصية') : tt('updated their cover photo', 'غيّر صورة الغلاف')}</span>}</strong>
          <span>
            {post.author.role && <em>{post.author.role.replace(/_/g, ' ')} · </em>}
            {ago(post.published_at || post.created_at, locale)}{post.edited_at ? ` · ${tt('edited', 'معدّل')}` : ''} · <Icon name={vis.icon} size={11} /> {tt(vis.en, vis.ar)}
          </span>
        </div>
        {post.is_pinned && <span className="pp-chip"><Icon name="pin" size={11} /> {tt('Pinned', 'مثبت')}</span>}
        {post.status !== 'published' && <span className="pp-chip is-warn">{{ draft: tt('Draft', 'مسودة'), scheduled: tt('Scheduled', 'مجدول'), pending: tt('Awaiting approval', 'بانتظار الموافقة'), archived: tt('Archived', 'مؤرشف'), removed: tt('Removed', 'محذوف') }[post.status] || post.status}</span>}
        {!post.author.is_me && !compactView && <button type="button" className={`pp-btn${post.author.is_following ? '' : ' is-primary'}`} onClick={follow}>{post.author.is_following ? tt('Following', 'تتابعه') : tt('Follow', 'متابعة')}</button>}
        <div className="pp-menu">
          <button type="button" className="pp-icon" aria-label={tt('More', 'المزيد')} aria-expanded={menu} onClick={() => setMenu((m) => !m)}><Icon name="more-horizontal" size={18} /></button>
          {menu && (
            <div className="pp-menu__list" onMouseLeave={() => setMenu(false)}>
              {post.can.edit && <button type="button" onClick={() => { setMenu(false); onEdit?.(post); }}><Icon name="edit" size={14} /> {tt('Edit', 'تعديل')}</button>}
              {post.can.pin && <button type="button" onClick={pin}><Icon name="pin" size={14} /> {post.is_pinned ? tt('Unpin', 'إلغاء التثبيت') : tt('Pin to profile', 'تثبيت')}</button>}
              {post.can.edit && post.status === 'published' && <button type="button" onClick={() => { setMenu(false); archive(); }}><Icon name="archive" size={14} /> {tt('Archive', 'أرشفة')}</button>}
              {!post.author.is_me && <button type="button" onClick={() => { setMenu(false); hide(); }}><Icon name="eye-off" size={14} /> {tt('Not interested', 'غير مهتم')}</button>}
              {!post.author.is_me && <button type="button" onClick={() => { setMenu(false); mute(); }}><Icon name="user-x" size={14} /> {tt('Mute this author', 'كتم الكاتب')}</button>}
              {post.can.report && <button type="button" onClick={() => { setMenu(false); setPanel('report'); }}><Icon name="flag" size={14} /> {tt('Report', 'إبلاغ')}</button>}
              {post.can.delete && <button type="button" className="is-danger" onClick={() => { setMenu(false); del(); }}><Icon name="trash" size={14} /> {tt('Delete', 'حذف')}</button>}
            </div>
          )}
        </div>
      </header>

      {post.title && <h2 className="pp-post__title">{post.title}</h2>}
      {post.body && (
        <p className="pp-post__body" dir="auto">
          <RichText text={long ? `${post.body.slice(0, BODY_CLAMP)}…` : post.body} onTag={onTag} />
          {long && <button type="button" className="pp-link" onClick={() => setExpanded(true)}>{tt('See more', 'عرض المزيد')}</button>}
        </p>
      )}
      {post.link_url && <LinkCard url={post.link_url} />}
      {post.hashtags?.length > 0 && !post.body?.includes('#') && <div className="pp-tags">{post.hashtags.map((t) => <button key={t} type="button" className="pp-tag" onClick={() => onTag?.(t)}>#{t}</button>)}</div>}

      {hiddenMedia && post.media.length > 0 ? (
        <button type="button" className="pp-sensitive" onClick={() => setSensitiveOk(true)}><Icon name="eye-off" size={22} /><strong>{tt('Sensitive content', 'محتوى حساس')}</strong><span>{tt('Tap to view', 'اضغط للعرض')}</span></button>
      ) : <PostMedia media={post.media} canDownload={post.can.download} canRun={post.can.run !== false} post={post} onPostChange={(n) => { if (n) patch(n); }} />}

      {post.repost_of && (
        <div className="pp-quote">
          {post.repost_of.unavailable ? <p className="pp-muted">{tt('The original post is not available.', 'المنشور الأصلي غير متاح.')}</p>
            : <PostCard post={post.repost_of} compactView onTag={onTag} onOpenAuthor={onOpenAuthor} />}
        </div>
      )}

      {c && (c.reactions > 0 || c.comments > 0 || c.reposts > 0 || c.shares > 0 || (post.author.is_me && (c.views > 0 || c.saves > 0))) && (
        <div className="pp-stats">
          {c.reactions > 0
            ? <button type="button" className="pp-stats__b pp-stats__react" onClick={() => setInsights('reactions')} title={tt('Who reacted', 'مين تفاعل')}>
              <span className="pp-stats__emo">{top.map(([k]) => <i key={k}>{REACTIONS[k]?.e}</i>)}</span><b>{compact(c.reactions)}</b></button>
            : <span />}
          <span className="pp-stats__right">
            {c.comments > 0 && <button type="button" className="pp-stats__b" onClick={() => setPanel('comments')}>{compact(c.comments)} {tt('comments', 'تعليق')}</button>}
            {c.reposts > 0 && <button type="button" className="pp-stats__b" onClick={() => setInsights('reposts')}>{compact(c.reposts)} {tt('reposts', 'إعادة نشر')}</button>}
            {c.shares > 0 && <button type="button" className="pp-stats__b" onClick={() => setInsights('shares')}>{compact(c.shares)} {tt('shares', 'مشاركة')}</button>}
            {post.author.is_me && c.saves > 0 && <button type="button" className="pp-stats__b" onClick={() => setInsights('saves')}>{compact(c.saves)} {tt('saves', 'حفظ')}</button>}
            {post.author.is_me && c.views > 0 && <button type="button" className="pp-stats__b" onClick={() => setInsights('views')}><Icon name="eye" size={13} /> {compact(c.views)} {tt('views', 'مشاهدة')}</button>}
          </span>
        </div>
      )}

      {post.status === 'published' && !compactView && (
        <div className="pp-actions">
          <div className="pp-react" onMouseEnter={() => setPicker(true)} onMouseLeave={() => setPicker(false)}>
            {picker && <div className="pp-react__pick">{Object.entries(REACTIONS).map(([k, r]) => <button key={k} type="button" title={tt(r.en, r.ar)} onClick={() => react(k)}>{r.e}</button>)}</div>}
            <button type="button" className={`pp-act${my ? ' is-on' : ''}`} onClick={() => react(my ? post.my_reaction : 'like')} aria-pressed={!!my}>
              {my ? <span>{my.e}</span> : <Icon name="thumbs-up" size={16} />} {my ? tt(my.en, my.ar) : tt('Like', 'إعجاب')}
            </button>
          </div>
          <button type="button" className={`pp-act${panel === 'comments' ? ' is-on' : ''}`} onClick={() => setPanel((p) => (p === 'comments' ? null : 'comments'))}><Icon name="message-square" size={16} /> {tt('Comment', 'تعليق')}</button>
          <button type="button" className={`pp-act${post.can.repost ? '' : ' is-disabled'}`} aria-disabled={!post.can.repost} title={post.can.repost ? undefined : repostWhy()}
            onClick={() => (post.can.repost ? setRepostOpen(true) : setNote(repostWhy()))}><Icon name="refresh" size={16} /> {tt('Repost', 'إعادة نشر')}</button>
          <button type="button" className="pp-act" onClick={() => setShareOpen(true)}><Icon name="share" size={16} /> {tt('Share', 'مشاركة')}</button>
          <button type="button" className={`pp-act pp-act--end pp-act--save${post.saved ? ' is-on' : ''}`} onClick={() => setSaveOpen(true)} aria-pressed={post.saved} title={post.saved ? tt('Unsave', 'إلغاء الحفظ') : tt('Save', 'حفظ')} aria-label={post.saved ? tt('Unsave', 'إلغاء الحفظ') : tt('Save', 'حفظ')}><Icon name="bookmark" size={16} />{post.saved && <span>{tt('Saved', 'محفوظ')}</span>}</button>
        </div>
      )}
      {(post.status === 'draft' || post.status === 'scheduled') && post.author.is_me && (
        <div className="pp-row"><button type="button" className="pp-btn is-primary" onClick={publish}>{tt('Publish now', 'نشر الآن')}</button>
          {post.scheduled_at && <small className="pp-muted"><Icon name="clock" size={12} /> {post.scheduled_at}</small>}</div>
      )}

      {insights && <InsightsDialog post={post} tab={insights} onClose={() => setInsights(null)} onOpenComments={() => setPanel('comments')} onOpenAuthor={onOpenAuthor || ((a) => nav(profilePath(a.id)))} />}
      {repostOpen && <RepostDialog post={post} onClose={() => setRepostOpen(false)} onDone={repostDone} />}
      {dialogs.dialogs}
      {shareOpen && <ShareDialog post={post} onClose={() => setShareOpen(false)} onShared={shared} />}
      {saveOpen && <SaveDialog post={post} onClose={() => setSaveOpen(false)} onDone={saveDone} />}
      {note && <small className="pp-ok">{note}</small>}
      {err && <Alert tt={tt}>{err}</Alert>}
      {panel === 'report' && <ReportBox post={post} tt={tt} onDone={() => { setPanel(null); setNote(tt('Thanks — your report was sent.', 'شكرًا — تم إرسال البلاغ.')); }} />}
      {panel === 'comments' && <Suspense fallback={<div className="pp-skel" style={{ height: 60 }} />}><Comments post={post} onCount={(d) => bumpCount('comments', d)} /></Suspense>}
    </article>
  );
}
