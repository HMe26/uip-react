import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import LandingNav from '../../components/LandingNav';
import SiteFooter from '../../components/SiteFooter';
import PostMedia from '../../components/posts/PostMedia';
import LinkCard from '../../components/posts/LinkCard';
import { PAvatar, REACTIONS, RichText } from '../../components/posts/shared';
import { postsApi } from '../../api/postsApi';
import { compact } from '../../lib/postMedia';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { roleHome } from '../../config/roleHome';
import { MY_PC_PREFIXES } from '../../config/myPc';
import { ago } from '../../components/feed/feedUi';
import '../../styles/css/posts.css';
import '../../styles/css/posts-pro.css';
import '../../styles/css/public-post.css';

/** Sets a <meta> tag for the lifetime of the page and restores the previous value on leave. */
const setMeta = (attr, key, value) => {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  const created = !el;
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
  const prev = el.getAttribute('content');
  el.setAttribute('content', value);
  return () => { if (created) el.remove(); else if (prev !== null) el.setAttribute('content', prev); };
};

/** Shown when a visitor tries to react / comment / follow: nudges to sign in or register. */
function Gate({ reason, onClose, t, isAr }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="pu-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pu-gate" role="dialog" aria-modal="true" dir={isAr ? 'rtl' : 'ltr'}>
        <button type="button" className="pu-gate__x" onClick={onClose} aria-label={t('Close', 'إغلاق')}><Icon name="x" size={18} /></button>
        <span className="pu-gate__ico"><Icon name="sparkles" size={26} /></span>
        <h3>{reason || t('Join the conversation', 'انضم للنقاش')}</h3>
        <p>{t('Create a free UIPE account or sign in to react, comment, follow authors and share your own work.', 'أنشئ حسابًا مجانيًا على UIPE أو سجّل الدخول عشان تتفاعل وتعلّق وتتابع الكتّاب وتشارك أعمالك.')}</p>
        <Link to="/auth/register" className="btn btn-primary pu-gate__btn">{t('Create an account', 'إنشاء حساب')}</Link>
        <Link to="/auth/login" className="btn pu-gate__btn pu-gate__btn--ghost">{t('Log in', 'تسجيل الدخول')}</Link>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="pu-card" aria-busy="true">
      <div className="pu-head"><span className="pp-skel pu-sk-av" /><div style={{ flex: 1 }}><span className="pp-skel pu-sk-line" style={{ width: '40%' }} /><span className="pp-skel pu-sk-line" style={{ width: '25%', marginTop: 8 }} /></div></div>
      <span className="pp-skel pu-sk-line" style={{ width: '90%', marginTop: 18 }} />
      <span className="pp-skel pu-sk-line" style={{ width: '75%', marginTop: 10 }} />
      <span className="pp-skel" style={{ display: 'block', height: 260, marginTop: 18, borderRadius: 12 }} />
    </div>
  );
}

function Unavailable({ t }) {
  return (
    <div className="pu-card pu-empty">
      <span className="pu-empty__ico"><Icon name="lock" size={30} /></span>
      <h2>{t('This post isn’t available', 'المنشور ده مش متاح')}</h2>
      <p>{t('It may have been deleted, or its author shared it with a limited audience only. Public posts can be opened by anyone with the link.', 'ممكن يكون اتحذف، أو صاحبه شاركه لجمهور محدد بس. المنشورات العامة بس هي اللي بتفتح لأي حد معاه الرابط.')}</p>
      <div className="pu-empty__row">
        <Link to="/" className="btn btn-primary">{t('Go to UIPE', 'الصفحة الرئيسية')}</Link>
        <Link to="/auth/login" className="btn pu-gate__btn--ghost">{t('Log in', 'تسجيل الدخول')}</Link>
      </div>
    </div>
  );
}

function PublicComments({ id, total, onGate, t, locale }) {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState(false);

  const load = useCallback(async (p) => {
    setBusy(true); setErr(false);
    try {
      const r = await postsApi.publicComments(id, p);
      setItems((prev) => (p === 1 ? r.items : [...prev, ...r.items.filter((n) => !prev.some((o) => o.id === n.id))]));
      setMore(!!r.meta?.has_more); setPage(p);
    } catch { setErr(true); } finally { setBusy(false); }
  }, [id]);
  useEffect(() => { load(1); }, [load]);

  return (
    <section className="pu-comments" aria-label={t('Comments', 'التعليقات')}>
      <h3>{t('Comments', 'التعليقات')}{total > 0 ? <span> {compact(total)}</span> : null}</h3>
      <button type="button" className="pu-compose" onClick={() => onGate(t('Sign in to comment', 'سجّل الدخول عشان تعلّق'))}>
        <span className="pu-compose__av"><Icon name="message" size={16} /></span>
        <span>{t('Write a comment…', 'اكتب تعليقًا…')}</span>
      </button>
      {items.map((c) => (
        <div key={c.id} className="pu-comment">
          <PAvatar user={c.author} size={34} />
          <div className="pu-comment__main">
            <div className="pu-comment__bubble">
              <strong>{c.author.full_name}{c.author.is_author && <em className="pu-badge">{t('Author', 'الكاتب')}</em>}</strong>
              <p dir="auto"><RichText text={c.body} /></p>
            </div>
            <small>{ago(c.created_at, locale)}{c.likes_count > 0 ? ` · 👍 ${compact(c.likes_count)}` : ''}{c.replies_count > 0 ? ` · ${compact(c.replies_count)} ${t('replies', 'رد')}` : ''}</small>
          </div>
        </div>
      ))}
      {busy && <span className="pp-skel" style={{ display: 'block', height: 48, borderRadius: 12 }} />}
      {err && <p className="pp-muted">{t('Could not load comments.', 'تعذّر تحميل التعليقات.')} <button type="button" className="pp-link" onClick={() => load(page)}>{t('Retry', 'إعادة المحاولة')}</button></p>}
      {!busy && !err && items.length === 0 && <p className="pp-muted pu-nocomments">{t('No comments yet.', 'مفيش تعليقات لسه.')}</p>}
      {more && !busy && <button type="button" className="pp-link" onClick={() => load(page + 1)}>{t('Show more comments', 'عرض المزيد من التعليقات')}</button>}
    </section>
  );
}

function Quoted({ post, t, locale }) {
  if (post.unavailable) return <div className="pu-quote"><p className="pp-muted">{t('The original post is not available.', 'المنشور الأصلي غير متاح.')}</p></div>;
  return (
    <div className="pu-quote">
      <div className="pu-head pu-head--sm">
        <PAvatar user={post.author} size={32} />
        <div className="pu-who"><strong>{post.author.full_name}</strong><span>{ago(post.published_at, locale)}</span></div>
      </div>
      {post.title && <h4 className="pu-title pu-title--sm">{post.title}</h4>}
      {post.body && <p className="pu-body" dir="auto"><RichText text={post.body} /></p>}
      <PostMedia media={post.media || []} canDownload={false} canRun={false} />
    </div>
  );
}

/**
 * /post/:id — the page a shared link opens. No sign-in: only visibility=public posts are served (the API answers 404 for anything else).
 * Facebook-style single post with read-only comments; every interaction opens a sign-in / create-account prompt.
 */
export default function PublicPost() {
  const { id } = useParams();
  const { locale } = useLanguage();
  const { status, user } = useAuth();
  const isAr = locale === 'ar';
  const t = (en, ar) => (isAr ? ar : en);
  const [post, setPost] = useState(null);
  const [state, setState] = useState('loading'); // loading | ok | missing | error
  const [gate, setGate] = useState(null);
  const [sensitiveOk, setSensitiveOk] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    setState('loading');
    postsApi.publicPost(id)
      .then((p) => { setPost(p); setState('ok'); })
      .catch((e) => setState(e?.status === 404 ? 'missing' : 'error'));
  }, [id]);
  useEffect(() => { setSensitiveOk(false); setExpanded(false); load(); }, [load]);

  // Page title + share-card meta (client-side: good for the tab and for link previews that run JS).
  useEffect(() => {
    if (state !== 'ok' || !post) return undefined;
    const text = (post.title || post.body || '').replace(/\s+/g, ' ').trim().slice(0, 140);
    const title = `${post.author.full_name}${text ? ` — ${text}` : ''} | UIPE`;
    const prevTitle = document.title;
    document.title = title;
    const undo = [setMeta('property', 'og:title', title), setMeta('property', 'og:type', 'article'), setMeta('name', 'description', text || title)];
    return () => { document.title = prevTitle; undo.forEach((u) => u()); };
  }, [state, post]);

  const openGate = useCallback((reason) => setGate(reason || ' '), []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  };
  const nativeShare = async () => {
    if (navigator.share) { try { await navigator.share({ url: window.location.href, title: post.title || post.author.full_name }); return; } catch { return; } }
    copy();
  };

  const authed = status === 'authenticated';
  const px = authed ? roleHome(user?.role).split('/')[1] : null;
  const feedLink = px && MY_PC_PREFIXES.includes(px) ? `/${px}/posts?post=${id}` : null;

  const c = post?.counts;
  const top = Object.entries(post?.reaction_breakdown || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const long = (post?.body || '').length > 600 && !expanded;
  const hiddenMedia = post?.is_sensitive && !sensitiveOk;

  return (
    <div className="lp2 lp2-page pu" dir={isAr ? 'rtl' : 'ltr'}>
      <LandingNav />
      <main className="pu-shell">
        {state === 'loading' && <Skeleton />}
        {state === 'missing' && <Unavailable t={t} />}
        {state === 'error' && (
          <div className="pu-card pu-empty">
            <span className="pu-empty__ico"><Icon name="alert-triangle" size={30} /></span>
            <h2>{t('Something went wrong', 'حصلت مشكلة')}</h2>
            <p>{t('We could not load this post. Check your connection and try again.', 'مقدرناش نحمّل المنشور. اتأكد من الإنترنت وجرّب تاني.')}</p>
            <div className="pu-empty__row"><button type="button" className="btn btn-primary" onClick={load}>{t('Try again', 'إعادة المحاولة')}</button></div>
          </div>
        )}

        {state === 'ok' && post && (
          <>
            <article className="pu-card">
              <header className="pu-head">
                <PAvatar user={post.author} size={46} />
                <div className="pu-who">
                  <strong>{post.author.full_name}</strong>
                  <span>
                    {post.author.role && <em>{post.author.role.replace(/_/g, ' ')} · </em>}
                    {ago(post.published_at, locale)}{post.edited_at ? ` · ${t('edited', 'معدّل')}` : ''} · <Icon name="globe" size={11} /> {t('Public', 'عام')}
                  </span>
                </div>
                <button type="button" className="btn btn-primary btn-sm pu-follow" onClick={() => openGate(t('Sign in to follow', 'سجّل الدخول عشان تتابع'))}>{t('Follow', 'متابعة')}</button>
              </header>

              {post.title && <h1 className="pu-title" dir="auto">{post.title}</h1>}
              {post.body && (
                <p className="pu-body" dir="auto">
                  <RichText text={long ? `${post.body.slice(0, 600)}…` : post.body} />
                  {long && <button type="button" className="pp-link" onClick={() => setExpanded(true)}> {t('See more', 'عرض المزيد')}</button>}
                </p>
              )}
              {post.link_url && <LinkCard url={post.link_url} />}
              {post.hashtags?.length > 0 && !post.body?.includes('#') && <div className="pp-tags">{post.hashtags.map((x) => <span key={x} className="pp-tag">#{x}</span>)}</div>}

              {hiddenMedia && post.media.length > 0 ? (
                <button type="button" className="pp-sensitive" onClick={() => setSensitiveOk(true)}><Icon name="eye-off" size={22} /><strong>{t('Sensitive content', 'محتوى حساس')}</strong><span>{t('Tap to view', 'اضغط للعرض')}</span></button>
              ) : <PostMedia media={post.media || []} canDownload={post.allow_download} canRun={post.allow_run !== false} />}

              {post.repost_of && <Quoted post={post.repost_of} t={t} locale={locale} />}

              {c && (c.reactions > 0 || c.comments > 0 || c.reposts > 0) && (
                <div className="pu-stats">
                  <span>{top.map(([k]) => REACTIONS[k]?.e).join('')} {c.reactions > 0 && compact(c.reactions)}</span>
                  <span>
                    {c.comments > 0 && <>{compact(c.comments)} {t('comments', 'تعليق')}</>}
                    {c.reposts > 0 && <>{c.comments > 0 ? ' · ' : ''}{compact(c.reposts)} {t('reposts', 'إعادة نشر')}</>}
                  </span>
                </div>
              )}

              <div className="pu-actions">
                <button type="button" className="pp-act" onClick={() => openGate(t('Sign in to react', 'سجّل الدخول عشان تتفاعل'))}><Icon name="thumbs-up" size={17} /> {t('Like', 'إعجاب')}</button>
                {post.comments_mode !== 'none' && <button type="button" className="pp-act" onClick={() => openGate(t('Sign in to comment', 'سجّل الدخول عشان تعلّق'))}><Icon name="message" size={17} /> {t('Comment', 'تعليق')}</button>}
                <button type="button" className="pp-act" onClick={nativeShare}><Icon name={copied ? 'check' : 'share'} size={17} /> {copied ? t('Link copied', 'تم نسخ الرابط') : t('Share', 'مشاركة')}</button>
              </div>

              {post.comments_mode === 'none'
                ? <p className="pp-muted pu-nocomments"><Icon name="lock" size={12} /> {t('The author turned comments off.', 'الكاتب قفل التعليقات.')}</p>
                : <PublicComments id={post.id} total={c?.comments || 0} onGate={openGate} t={t} locale={locale} />}
            </article>

            {!authed ? (
              <aside className="pu-join">
                <div>
                  <h2>{t('See more from UIPE', 'اكتشف المزيد على UIPE')}</h2>
                  <p>{t('Join the Universities Innovation Platform — share projects, follow researchers and join the conversation.', 'انضم لمنصة UIPE — شارك مشاريعك، تابع الباحثين، وشارك في النقاش.')}</p>
                </div>
                <div className="pu-join__btns">
                  <Link to="/auth/register" className="btn btn-primary">{t('Create an account', 'إنشاء حساب')}</Link>
                  <Link to="/auth/login" className="btn pu-gate__btn--ghost">{t('Log in', 'تسجيل الدخول')}</Link>
                </div>
              </aside>
            ) : feedLink && (
              <aside className="pu-join">
                <div><h2>{t('You’re signed in', 'انت مسجّل دخول')}</h2><p>{t('Open this post inside UIPE to react, comment and save it.', 'افتح المنشور جوه UIPE عشان تتفاعل وتعلّق وتحفظه.')}</p></div>
                <div className="pu-join__btns"><Link to={feedLink} className="btn btn-primary">{t('Open in UIPE', 'افتح داخل UIPE')}</Link></div>
              </aside>
            )}
          </>
        )}
      </main>
      <SiteFooter />
      {gate && <Gate reason={gate.trim()} onClose={() => setGate(null)} t={t} isAr={isAr} />}
    </div>
  );
}
