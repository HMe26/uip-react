import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import Face from '../messaging/stories/Face';
import StoryViewer from '../messaging/stories/StoryViewer';
import StoryComposer from '../messaging/stories/StoryComposer';
import { API } from '../messaging/stories/storyUtils';
import '../../styles/css/posts-profile.css';

/**
 * Stories on the posts pages. ONE feed + ONE full-screen viewer / composer (the same ones the messenger uses), shared through a context so
 *   - <PostStoriesBar /> shows the row at the top of the page ("My status" first, then everybody who has an active story),
 *   - any avatar (<UserAvatar />) can ask "does this person have a story?" and open it.
 * The server decides who is in the feed (audience: contacts / everyone / selected / except) — this file only shows what it returns.
 */
const Ctx = createContext(null);
export const useStoryHub = () => useContext(Ctx);
const POLL_MS = 60000;

export function StoryHubProvider({ children }) {
  const [feed, setFeed] = useState(null);       // { me, groups, reactions, limits }
  const [failed, setFailed] = useState(false);
  const [viewer, setViewer] = useState(null);   // { queue, gi }
  const [composer, setComposer] = useState(false);
  const alive = useRef(true);
  const busy = useRef(false);
  busy.current = Boolean(viewer || composer);

  const load = useCallback(async () => {
    try {
      const res = await api.get(API);
      if (!alive.current) return;
      setFeed(res.data); setFailed(false);
    } catch {
      // no messaging permission / offline: the bar simply stays hidden and avatars behave like plain photos
      if (alive.current) setFailed(true);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    const id = setInterval(() => { if (!document.hidden && !busy.current) load(); }, POLL_MS);
    const onVis = () => { if (!document.hidden && !busy.current) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive.current = false; clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  const groupFor = useCallback((userId) => {
    if (!feed || userId == null) return null;
    return feed.groups.find((g) => Number(g.user_id) === Number(userId)) || null;
  }, [feed]);

  /** `rest`: keep playing the next people after this one (the bar does that, a tapped avatar only plays that person). */
  const open = useCallback((group, rest = false) => {
    if (!feed || !group) return;
    const idx = feed.groups.indexOf(group);
    const queue = rest ? [group, ...feed.groups.slice(idx + 1).filter((g) => !g.is_mine && !g.muted)] : [group];
    setViewer({ queue, gi: 0 });
  }, [feed]);

  const openFor = useCallback((userId) => { const g = groupFor(userId); if (g) open(g, false); return !!g; }, [groupFor, open]);

  const patchStory = (id, patch) => setFeed((f) => f && ({
    ...f,
    groups: f.groups.map((g) => {
      const stories = g.stories.map((s) => (s.id === id ? { ...s, ...patch } : s));
      const has_unseen = !g.is_mine && stories.some((s) => !s.seen);
      return { ...g, stories, has_unseen };
    }),
  }));

  const value = useMemo(() => ({
    feed, failed, groupFor, open, openFor, refresh: load, addStory: () => setComposer(true),
  }), [feed, failed, groupFor, open, openFor, load]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {viewer && feed && (
        <StoryViewer
          queue={viewer.queue}
          startGi={viewer.gi}
          reactions={feed.reactions}
          onClose={() => { setViewer(null); load(); }}
          onSeen={(id) => patchStory(id, { seen: true })}
          onReacted={(id, emoji) => patchStory(id, { my_reaction: emoji })}
          onDeleted={() => load()}
          onMute={() => load()}
          onAdd={() => { setViewer(null); setComposer(true); }}
        />
      )}
      {composer && feed && (
        <StoryComposer limits={feed.limits} onClose={() => setComposer(false)} onPosted={() => { setComposer(false); load(); }} />
      )}
    </Ctx.Provider>
  );
}

/** The stories row at the top of the posts page (WhatsApp / Facebook style): my status, then everyone with an active story. */
export function PostStoriesBar() {
  const hub = useStoryHub();
  const { locale } = useLanguage();
  const t = (en, ar) => (locale === 'ar' ? ar : en);
  if (!hub || hub.failed) return null;
  const { feed } = hub;
  if (!feed) {
    return (
      <div className="pp-stories st-strip st-strip--skeleton" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => <span key={i} className="st-tile"><i className="st-skel" /><em /></span>)}
      </div>
    );
  }
  const mine = feed.groups.find((g) => g.is_mine) || null;
  const others = feed.groups.filter((g) => !g.is_mine);
  return (
    <section className="pp-stories st-strip" aria-label={t('Stories', 'الاستوري')}>
      <button type="button" className="st-tile st-tile--me" onClick={() => (mine ? hub.open(mine, false) : hub.addStory())}
        aria-label={mine ? t('Open my status', 'افتح الاستوري بتاعتي') : t('Add status', 'أضف استوري')}>
        <span className={`st-ring${mine ? ' is-mine' : ' is-empty'}`}>
          <Face name={feed.me?.full_name} src={feed.me?.avatar_path} />
          {!mine && <span className="st-plus"><Icon name="plus" size={12} /></span>}
        </span>
        <em>{t('My status', 'استوريتي')}</em>
      </button>
      {mine && (
        <button type="button" className="st-tile st-tile--add" onClick={() => hub.addStory()} aria-label={t('Add status', 'أضف استوري')}>
          <span className="st-ring is-empty st-ring--add"><Icon name="plus" size={20} /></span>
          <em>{t('Add', 'إضافة')}</em>
        </button>
      )}
      {others.map((g) => (
        <button type="button" key={g.user_id} className={`st-tile${g.muted ? ' is-muted' : ''}`} onClick={() => hub.open(g, true)} title={g.full_name}>
          <span className={`st-ring${g.has_unseen ? ' is-new' : ' is-seen'}`}>
            <Face name={g.full_name} src={g.avatar_path} />
          </span>
          <em>{g.full_name}</em>
        </button>
      ))}
      {others.length === 0 && !mine && (
        <p className="st-hint">{t('Share a photo, video or text that disappears after a while.', 'شارك صورة أو فيديو أو نص بيختفي بعد مدة.')}</p>
      )}
    </section>
  );
}
