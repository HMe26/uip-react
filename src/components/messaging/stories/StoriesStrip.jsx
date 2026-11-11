import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../../api/client';
import Icon from '../../Icon';
import { useLanguage } from '../../../context/LanguageContext';
import Face from './Face';
import StoryViewer from './StoryViewer';
import StoryComposer from './StoryComposer';
import { API } from './storyUtils';

const POLL_MS = 60000;

/**
 * Stories row shown at the top of the conversation list: "My status" first, then everyone who has an active story
 * (ring = has new ones). Owns the feed, the full-screen viewer and the composer, so the chat code only renders <StoriesStrip />.
 */
export default function StoriesStrip() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const t = (en, a) => (ar ? a : en);

  const [feed, setFeed] = useState(null);       // { me, groups, reactions, limits }
  const [error, setError] = useState('');
  const [viewer, setViewer] = useState(null);   // { queue, gi }
  const [composer, setComposer] = useState(false);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await api.get(API);
      if (!aliveRef.current) return;
      setFeed(res.data);
      setError('');
    } catch (err) {
      if (aliveRef.current) setError(errorMessage(err));
    }
  }, []);

  // Refs so opening/closing the viewer doesn't tear down the timer (and doesn't trigger an extra feed request).
  const busyRef = useRef(false);
  busyRef.current = Boolean(viewer || composer);

  useEffect(() => {
    aliveRef.current = true;
    load();
    const id = setInterval(() => { if (!document.hidden && !busyRef.current) load(); }, POLL_MS);
    const onVis = () => { if (!document.hidden && !busyRef.current) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { aliveRef.current = false; clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  if (!feed) {
    // Skeleton while the first load runs; a failed first load just hides the row (chat keeps working).
    return error ? null : (
      <div className="st-strip st-strip--skeleton" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => <span key={i} className="st-tile"><i className="st-skel" /><em /></span>)}
      </div>
    );
  }

  const mine = feed.groups.find((g) => g.is_mine) || null;
  const others = feed.groups.filter((g) => !g.is_mine);

  const open = (group) => {
    const idx = feed.groups.indexOf(group);
    // Play this person, then keep going through the rest (skip my own and muted ones, like WhatsApp).
    const queue = [group, ...feed.groups.slice(idx + 1).filter((g) => !g.is_mine && !g.muted)];
    setViewer({ queue, gi: 0 });
  };

  const patchStory = (id, patch) => setFeed((f) => f && ({
    ...f,
    groups: f.groups.map((g) => {
      const stories = g.stories.map((s) => (s.id === id ? { ...s, ...patch } : s));
      const has_unseen = !g.is_mine && stories.some((s) => !s.seen);
      return { ...g, stories, has_unseen };
    }),
  }));

  return (
    <>
      <section className="st-strip" aria-label={t('Stories', 'الاستوري')}>
        <button type="button" className="st-tile st-tile--me" onClick={() => (mine ? open(mine) : setComposer(true))}
          aria-label={mine ? t('Open my status', 'افتح الاستوري بتاعتي') : t('Add status', 'أضف استوري')}>
          <span className={`st-ring${mine ? ' is-mine' : ' is-empty'}`}>
            <Face name={feed.me?.full_name} src={feed.me?.avatar_path} />
            {!mine && <span className="st-plus"><Icon name="plus" size={12} /></span>}
          </span>
          <em>{t('My status', 'استوريتي')}</em>
        </button>
        {mine && (
          <button type="button" className="st-tile st-tile--add" onClick={() => setComposer(true)} aria-label={t('Add status', 'أضف استوري')}>
            <span className="st-ring is-empty st-ring--add"><Icon name="plus" size={20} /></span>
            <em>{t('Add', 'إضافة')}</em>
          </button>
        )}
        {others.map((g) => (
          <button type="button" key={g.user_id} className={`st-tile${g.muted ? ' is-muted' : ''}`} onClick={() => open(g)} title={g.full_name}>
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

      {viewer && (
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
      {composer && (
        <StoryComposer
          limits={feed.limits}
          onClose={() => setComposer(false)}
          onPosted={() => { setComposer(false); load(); }}
        />
      )}
    </>
  );
}
