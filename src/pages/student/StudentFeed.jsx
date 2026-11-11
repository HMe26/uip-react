import { useEffect, useState, useCallback } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { Avatar, Attachments, DateTile, Empty, FeedAlert, Pager, SearchBox, Skeletons, ago, fmtWhen } from '../../components/feed/feedUi';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/student/feed';

const translations = { ...i18nCommon, ...i18nPage };
const TABS = [
  { key: 'all', en: 'All', ar: 'الكل' }, { key: 'events', en: 'Events', ar: 'فعاليات' },
  { key: 'pinned', en: 'Pinned', ar: 'مثبتة' }, { key: 'saved', en: 'Saved', ar: 'محفوظة' },
];

function Post({ post, locale, t, uid, h }) {
  const [panel, setPanel] = useState(null); // 'comments' | 'share' | 'report'
  const [busy, setBusy] = useState(false);
  const [v1, setV1] = useState(''); const [v2, setV2] = useState('');
  const isEvent = Number(post.is_event);
  const toggle = (k) => setPanel((p) => (p === k ? null : k));
  const run = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  return (
    <article className={`fd-post${Number(post.is_pinned) ? ' is-pinned' : ''}`}>
      <header className="fd-post__who">
        <Avatar name={post.author_name} />
        <div><strong>{post.author_name}</strong><span>{ago(post.created_at, locale)}</span></div>
        <div className="fd-flags">
          {Number(post.is_pinned) ? <span className="st-pill"><Icon name="pin" size={11} /> {t('Pinned')}</span> : null}
          {isEvent ? <span className="st-pill st-pill--outline"><Icon name="calendar" size={11} /> {t('Event')}</span> : null}
        </div>
      </header>

      <h2 className="fd-title">{post.title}</h2>
      {post.body && <p className="fd-body">{post.body}</p>}

      {isEvent ? (
        <div className="fd-ticket">
          <DateTile value={post.event_starts_at} locale={locale} />
          <div>
            <strong>{fmtWhen(post.event_starts_at, locale)}{post.event_ends_at ? ` – ${fmtWhen(post.event_ends_at, locale)}` : ''}</strong>
            {post.event_location && <span><Icon name="map-pin" size={13} /> {post.event_location}</span>}
          </div>
        </div>
      ) : null}

      <Attachments items={post.attachments} t={t} />

      <div className="fd-actions">
        <button type="button" disabled={busy} className={`fd-act is-like${post.is_liked ? ' is-on' : ''}`} aria-pressed={!!post.is_liked}
          onClick={() => run(() => h.like(post))}><Icon name="heart" size={16} /> {post.likes_count || 0}</button>
        <button type="button" className={`fd-act${panel === 'comments' ? ' is-on' : ''}`} onClick={() => toggle('comments')}><Icon name="message" size={16} /> {post.comments_count || 0}</button>
        <button type="button" className={`fd-act${panel === 'share' ? ' is-on' : ''}`} onClick={() => toggle('share')}><Icon name="share" size={16} /> {post.shares_count || 0}</button>
        <button type="button" disabled={busy} className={`fd-act${post.is_saved ? ' is-on' : ''}`} aria-pressed={!!post.is_saved}
          onClick={() => run(() => h.save(post))}><Icon name="bookmark" size={16} /> {post.saves_count || 0}</button>
        <button type="button" className="fd-act fd-act--end" title={t('Report')} aria-label={t('Report')} onClick={() => toggle('report')}><Icon name="alert-triangle" size={16} /></button>
      </div>

      {panel === 'share' && (
        <form className="fd-panel fd-row" onSubmit={async (e) => { e.preventDefault(); await h.share(post, v1, v2); setV1(''); setV2(''); setPanel(null); }}>
          <input className="fd-input" type="email" required placeholder={t("Recipient's email")} value={v1} onChange={(e) => setV1(e.target.value)} dir="ltr" />
          <input className="fd-input" placeholder={t('Note (optional)')} value={v2} onChange={(e) => setV2(e.target.value)} />
          <button className="btn btn-primary btn-sm">{t('Send')}</button>
        </form>
      )}
      {panel === 'report' && (
        <form className="fd-panel fd-row" onSubmit={async (e) => { e.preventDefault(); await h.report(post, v1); setV1(''); setPanel(null); }}>
          <input className="fd-input" required placeholder={t('Why are you reporting this post?')} value={v1} onChange={(e) => setV1(e.target.value)} />
          <button className="btn btn-primary btn-sm">{t('Report')}</button>
        </form>
      )}
      {panel === 'comments' && (
        <div className="fd-panel">
          {(post.comments || []).map((c) => (
            <div key={c.id} className="fd-comment">
              <Avatar name={c.user_name} size={30} />
              <div className="fd-comment__bubble">
                <b>{c.user_name}</b><small>{ago(c.created_at, locale)}</small>
                <p>{c.body}</p>
              </div>
              {Number(c.user_id) === Number(uid) && (
                <button type="button" className="fd-iconbtn" aria-label={t('Delete')}
                  onClick={() => { if (window.confirm(t('Delete this comment?'))) h.delComment(post, c); }}><Icon name="trash" size={14} /></button>
              )}
            </div>
          ))}
          <form className="fd-row" onSubmit={async (e) => { e.preventDefault(); if (!v1.trim()) return; await h.comment(post, v1); setV1(''); }}>
            <input className="fd-input" required maxLength={2000} placeholder={t('Write a comment...')} value={v1} onChange={(e) => setV1(e.target.value)} />
            <button className="btn btn-primary btn-sm">{t('Post')}</button>
          </form>
        </div>
      )}
    </article>
  );
}

export default function StudentFeed() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const { user } = useAuth();
  const ar = locale === 'ar';
  const [posts, setPosts] = useState([]);
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [type, setType] = useState('all');
  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    api.get('/api/v1/feed', { page, per_page: 10, type, q })
      .then((json) => {
        setPosts((json.data || []).map((p) => ({ ...p, attachments: json.meta?.attachments?.[p.id] || [], comments: json.meta?.comments?.[p.id] || [] })));
        setMeta(json.meta || {});
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [page, type, q]);
  useEffect(() => { load(); }, [load]);

  const pages = Math.max(1, Math.ceil((meta.total || 0) / (meta.perPage || 10)));
  const patch = (id, p) => setPosts((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const safe = (fn) => async (...a) => { setActionError(null); try { await fn(...a); } catch (err) { setActionError(errorMessage(err)); } };
  const refetchComments = async (post) => {
    const j = await api.get(`/api/v1/feed/${post.id}/comments`);
    patch(post.id, { comments: j.data || [], comments_count: (j.data || []).length });
  };
  const h = {
    like: safe(async (p) => { const j = await api.post(`/api/v1/feed/${p.id}/like`); patch(p.id, { is_liked: j.data.liked, likes_count: (p.likes_count || 0) + (j.data.liked ? 1 : -1) }); }),
    save: safe(async (p) => { const j = await api.post(`/api/v1/feed/${p.id}/save`); patch(p.id, { is_saved: j.data.saved, saves_count: (p.saves_count || 0) + (j.data.saved ? 1 : -1) }); }),
    comment: safe(async (p, body) => { await api.post(`/api/v1/feed/${p.id}/comments`, { body }); await refetchComments(p); }),
    delComment: safe(async (p, c) => { await api.del(`/api/v1/feed/comments/${c.id}`); await refetchComments(p); }),
    share: safe(async (p, email, note) => { await api.post(`/api/v1/feed/${p.id}/share`, { recipient_email: email, note }); patch(p.id, { shares_count: (p.shares_count || 0) + 1 }); }),
    report: safe(async (p, reason) => { await api.post(`/api/v1/feed/${p.id}/report`, { reason }); }),
  };

  return (
    <div className="fd-page">
      <div className="fd-head">
        <div className="fd-head__text">
          <h1>{t('University Feed')}</h1>
          <p>{ar ? 'آخر تحديثات وفعاليات جامعتك.' : "What's happening at your university."}</p>
        </div>
      </div>

      {meta.unaffiliated ? (
        <Empty icon="building" title={ar ? 'حسابك غير مرتبط بجامعة' : 'No university linked'} text={ar ? 'حسابك غير مرتبط بجامعة حاليًا، لذا لا يوجد موجز لعرضه.' : "Your account isn't linked to a university yet, so there's no feed to show."} />
      ) : (
        <>
          <div className="fd-toolbar">
            <div className="fd-toolbar__row">
              <div className="fd-tabs" role="tablist">
            {TABS.map((tab) => (
              <button key={tab.key} type="button" role="tab" aria-selected={type === tab.key} className={`fd-tab${type === tab.key ? ' is-active' : ''}`}
                onClick={() => { setType(tab.key); setPage(1); }}>{ar ? tab.ar : tab.en}</button>
            ))}
              </div>
              <SearchBox value={qInput} onChange={setQInput} onSubmit={() => { setQ(qInput.trim()); setPage(1); }} placeholder={t('Search the feed')} />
            </div>
          </div>
          {actionError && <FeedAlert>{actionError}</FeedAlert>}
          {error && <FeedAlert onRetry={load} locale={locale}>{error}</FeedAlert>}
          {loading && <Skeletons n={3} h={200} />}
          {!loading && !error && posts.length === 0 && (
            type === 'saved'
              ? <Empty icon="bookmark" title={ar ? 'لا توجد منشورات محفوظة' : 'Nothing saved yet'} text={ar ? 'المنشورات التي تحفظها ستظهر هنا.' : 'Posts you save will show up here.'} />
              : <Empty icon="inbox" title={t('No posts to show.')} text={ar ? 'سيظهر هنا ما تنشره جامعتك من تحديثات وفعاليات.' : 'Updates and events from your university will appear here.'} />
          )}
          {!loading && !error && posts.length > 0 && (
            <div className="fd-stack">{posts.map((p) => <Post key={p.id} post={p} locale={locale} t={t} uid={user?.id} h={h} />)}</div>
          )}
          {!loading && <Pager page={page} pages={pages} setPage={setPage} locale={locale} />}
        </>
      )}
    </div>
  );
}
