import { useCallback, useEffect, useRef, useState } from 'react';
import EmojiPicker from './EmojiPicker';
import StickerMedia from './StickerMedia';
import { setFavLocal } from './MessageMenu';
import {
  cachedFavourites, cachedMyStickers, cachedPacks, deleteMySticker, getRecentGifs, getRecentStickers, loadFavouriteItems, loadMyStickers, loadPack, loadPacks, forgetRecentSticker, removeFromPack, removeFavouriteSticker, cachedMediaPolicy, loadMediaPolicy,
  pushRecentGif, pushRecentSticker, searchGifs,
} from '../../lib/stickerStore';

/**
 * WhatsApp-style picker: Emoji | GIF | Stickers (segmented control at the bottom).
 *  - emoji: inserts into the composer (stays open so several can be added)
 *  - GIF:   Giphy search/trending through the API, recents
 *  - stickers: recents, favourites, "my stickers" + a Create tile that opens the sticker maker
 * Sending is delegated: onSendSticker(sticker), onSendGif(gif), onNewSticker().
 */
const Icon = ({ d, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const I = {
  smile: <><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.2 4.2 0 0 0 7 0" /><path d="M9 9.5h.01M15 9.5h.01" /></>,
  sticker: <><path d="M20 12.5V7a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h5.5z" /><path d="M20 12.5a7.5 7.5 0 0 1-7.5 7.5v-3a4.5 4.5 0 0 1 4.5-4.5z" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  trend: <path d="m3 17 6-6 4 4 8-8M15 7h6v6" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  x: <path d="M6 6l12 12M18 6 6 18" />,
};

function StickerGrid({ items, ar, onPick, onRemove, empty, lead }) {
  return (
    <div className="stk-grid">
      {lead}
      {items.map((s) => (
        <div key={s.key} className="stk-cell">
          <button type="button" className="stk-pick" onClick={() => onPick(s)} title={ar ? 'إرسال' : 'Send'}>
            <StickerMedia url={s.url} kind={s.kind} hover className="stk-thumb" />
          </button>
          {onRemove && (
            <button type="button" className="stk-remove" onClick={() => onRemove(s)} title={ar ? 'حذف' : 'Delete'} aria-label={ar ? 'حذف' : 'Delete'}><Icon d={I.x} size={12} /></button>
          )}
        </div>
      ))}
      {!items.length && empty && <p className="stk-empty">{empty}</p>}
    </div>
  );
}

function StickerPane({ ar, canSend, canCreate = true, onSend, onNew, onChanged }) {
  const [tab, setTab] = useState(() => (getRecentStickers().length ? 'recent' : 'mine'));
  const [mine, setMine] = useState(cachedMyStickers() || []);
  const [favs, setFavs] = useState(cachedFavourites()?.stickers || []);
  const [recent, setRecent] = useState(getRecentStickers);
  const [loading, setLoading] = useState(!cachedMyStickers());
  const [packs, setPacks] = useState(cachedPacks() || []);
  const [packItems, setPackItems] = useState({}); // pack id -> stickers

  useEffect(() => {
    let dead = false;
    Promise.allSettled([loadMyStickers(true), loadFavouriteItems(true), loadPacks(true)]).then(([a, b, c]) => {
      if (dead) return;
      if (a.status === 'fulfilled') setMine(a.value);
      if (b.status === 'fulfilled') setFavs(b.value.stickers);
      if (c.status === 'fulfilled') { setPacks(c.value); setPackItems({}); }
      setLoading(false);
    });
    return () => { dead = true; };
  }, [onChanged]);

  useEffect(() => {
    if (!tab.startsWith('pack:')) return undefined;
    const id = Number(tab.slice(5));
    if (packItems[id]) return undefined;
    let dead = false;
    loadPack(id).then((p) => { if (!dead) setPackItems((m) => ({ ...m, [id]: p.items })); }).catch(() => { if (!dead) setTab('mine'); });
    return () => { dead = true; };
  }, [tab, packItems]);

  const send = (s) => {
    if (!canSend) return;
    pushRecentSticker(s);
    setRecent(getRecentStickers());
    onSend(s);
  };
  const remove = async (s) => {
    if (!s.libId) return;
    try { await deleteMySticker(s.libId); setMine((m) => m.filter((x) => x.libId !== s.libId)); setRecent(getRecentStickers()); } catch { /* the list refreshes next time */ }
  };

  // Recent: only clears it from the recents list (the sticker itself is untouched).
  const forget = (s) => { forgetRecentSticker(s.key); setRecent(getRecentStickers()); };
  // Favourites: un-favourites the sticker (also stops the message menu showing it as favourite after a refresh).
  const unfav = async (s) => {
    try { await removeFavouriteSticker(s.key); setFavLocal(s.url, false); setFavs((f) => f.filter((x) => x.key !== s.key)); } catch { /* the list refreshes next time */ }
  };
  // Pack: takes the sticker out of that pack (it stays in "My stickers").
  const removeFromCurrentPack = async (s) => {
    const id = Number(tab.slice(5));
    if (!s.libId) return;
    try {
      const list = await removeFromPack(id, s.libId);
      setPacks(list);
      setPackItems((m) => ({ ...m, [id]: (m[id] || []).filter((x) => x.libId !== s.libId) }));
    } catch { /* the list refreshes next time */ }
  };

  const createTile = !canCreate ? null : (
    <button type="button" className="stk-create" onClick={onNew}>
      <Icon d={I.plus} size={22} />
      <span>{ar ? 'إنشاء' : 'Create'}</span>
    </button>
  );
  const tabs = [
    { id: 'recent', icon: I.clock, label: ar ? 'الأحدث' : 'Recent' },
    { id: 'favs', icon: I.star, label: ar ? 'المفضلة' : 'Favourites' },
    { id: 'mine', icon: I.user, label: ar ? 'ستيكراتي' : 'My stickers' },
  ];
  return (
    <>
      <div className="cp-tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={`cp-tab${tab === x.id ? ' is-on' : ''}`} onClick={() => setTab(x.id)} title={x.label}>
            <Icon d={x.icon} />
          </button>
        ))}
        <span className="cp-tabs__fill" />
      </div>
      {packs.length > 0 && (
        <div className="stk-packs" role="tablist" aria-label={ar ? 'باكاتي' : 'My packs'}>
          {packs.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={tab === `pack:${p.id}`} className={`stk-pack-chip${tab === `pack:${p.id}` ? ' is-on' : ''}`} onClick={() => setTab(`pack:${p.id}`)}>
              <span className="stk-pack-chip__ic">{p.cover ? <StickerMedia url={p.cover.url} kind={p.cover.kind} className="stk-thumb" /> : null}</span>
              <span className="stk-pack-chip__t" dir="auto">{p.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="cp-body">
        {!canSend && <p className="cp-note">{ar ? 'الستيكرات متوقفة في هذه المحادثة.' : 'Stickers are turned off in this conversation.'}</p>}
        {tab.startsWith('pack:') && (packItems[Number(tab.slice(5))]
          ? <StickerGrid items={packItems[Number(tab.slice(5))]} ar={ar} onPick={send} onRemove={removeFromCurrentPack} empty={ar ? 'الباك فاضية' : 'This pack is empty'} />
          : <div className="cp-loading"><span className="cp-spin" /></div>)}
        {tab === 'recent' && <StickerGrid items={recent} ar={ar} onPick={send} onRemove={forget} lead={createTile} empty={ar ? 'الستيكرات اللي بتستخدمها هتظهر هنا' : 'Stickers you use show up here'} />}
        {tab === 'favs' && <StickerGrid items={favs} ar={ar} onPick={send} onRemove={unfav} lead={createTile} empty={ar ? 'اضغط على أي ستيكر في الشات وأضفه للمفضلة' : 'Tap any sticker in a chat to add it to Favourites'} />}
        {tab === 'mine' && (loading && !mine.length
          ? <div className="cp-loading"><span className="cp-spin" /></div>
          : <StickerGrid items={mine} ar={ar} onPick={send} onRemove={remove} lead={createTile} empty={ar ? 'اعمل أول ستيكر من صورة أو فيديو' : 'Make your first sticker from a photo or video'} />)}
      </div>
    </>
  );
}

/** Grid thumbnail: a light still frame; the animated GIF is only fetched while the pointer is over it. */
function GifThumb({ g, onClick }) {
  const [play, setPlay] = useState(false);
  const still = g.still && g.still !== g.preview ? g.still : null;
  return (
    <button type="button" className="gif-item" onClick={() => onClick(g)} title={g.title || 'GIF'}
      onMouseEnter={still ? () => setPlay(true) : undefined} onMouseLeave={still ? () => setPlay(false) : undefined}
      onFocus={still ? () => setPlay(true) : undefined} onBlur={still ? () => setPlay(false) : undefined}>
      <img src={still && !play ? still : (g.preview || g.url)} alt={g.title || 'GIF'} loading="lazy" decoding="async" fetchpriority="low"
        style={g.w && g.h ? { aspectRatio: `${g.w} / ${g.h}` } : undefined} />
    </button>
  );
}

function GifPane({ ar, canSend, canSearch = true, canTrending = true, onSend }) {
  const [tab, setTab] = useState(() => (getRecentGifs().length || !canTrending ? 'recent' : 'trending'));
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [next, setNext] = useState(null);
  const [state, setState] = useState({ loading: false, configured: true, error: false });
  const [recent, setRecent] = useState(getRecentGifs);
  const [favs, setFavs] = useState(cachedFavourites()?.gifs || []);
  const bodyRef = useRef(null);
  const seq = useRef(0);

  useEffect(() => { loadFavouriteItems().then((f) => setFavs(f.gifs)).catch(() => {}); }, []);

  const load = useCallback(async (term, offset) => {
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const r = await searchGifs(term, offset);
      if (my !== seq.current) return;
      setItems((cur) => (offset ? [...cur, ...r.items] : r.items));
      setNext(r.next);
      setState({ loading: false, configured: r.configured !== false, error: !!r.error });
    } catch {
      if (my === seq.current) setState({ loading: false, configured: true, error: true });
    }
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (!term && (tab !== 'trending' || !canTrending)) return undefined;
    const h = setTimeout(() => load(term, 0), term ? 320 : 0);
    return () => clearTimeout(h);
  }, [q, tab, load, canTrending]);

  const onScroll = (e) => {
    const el = e.currentTarget;
    if (next != null && !state.loading && el.scrollTop + el.clientHeight > el.scrollHeight - 160) load(q.trim(), next);
  };
  const send = (g) => {
    if (!canSend) return;
    pushRecentGif(g);
    setRecent(getRecentGifs());
    onSend(g);
  };

  const searching = q.trim() !== '' || (tab === 'trending' && canTrending);
  const list = searching ? items : (tab === 'favs' ? favs : recent);
  // two balanced columns (masonry-like) — GIFs have different heights
  const cols = [[], []];
  const heights = [0, 0];
  list.forEach((g) => { const c = heights[0] <= heights[1] ? 0 : 1; cols[c].push(g); heights[c] += (g.h && g.w) ? g.h / g.w : 1; });

  const tabs = [
    { id: 'recent', icon: I.clock, label: ar ? 'الأحدث' : 'Recent' },
    { id: 'favs', icon: I.star, label: ar ? 'المفضلة' : 'Favourites' },
    ...(canTrending ? [{ id: 'trending', icon: I.trend, label: ar ? 'الأكثر رواجًا' : 'Trending' }] : []),
  ];
  return (
    <>
      {canSearch && (
        <div className="emo-search">
          <Icon d={I.search} size={18} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} dir="auto" placeholder={ar ? 'ابحث في GIF (ضحك، تصفيق…)' : 'Search GIFs (laugh, clap…)'} />
        </div>
      )}
      <div className="cp-tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id && q.trim() === ''} className={`cp-tab${tab === x.id && q.trim() === '' ? ' is-on' : ''}`} onClick={() => { setTab(x.id); setQ(''); }} title={x.label}>
            <Icon d={x.icon} />
          </button>
        ))}
        <span className="cp-tabs__fill" />
      </div>
      <div className="cp-body" ref={bodyRef} onScroll={onScroll}>
        {!canSend && <p className="cp-note">{ar ? 'الـ GIF متوقفة في هذه المحادثة.' : 'GIFs are turned off in this conversation.'}</p>}
        {searching && !state.configured ? (
          <p className="stk-empty">{ar ? 'بحث GIF غير مفعّل بعد. الأدمن يضيف مفتاح Giphy من: وسائط الشات.' : 'GIF search is not set up yet. An admin can add the Giphy key under Chat Media.'}</p>
        ) : (
          <div className="gif-cols">
            {cols.map((col, ci) => (
              <div key={ci} className="gif-col">
                {col.map((g) => (
                  <GifThumb key={g.url} g={g} onClick={send} />
                ))}
              </div>
            ))}
          </div>
        )}
        {state.loading && <div className="cp-loading"><span className="cp-spin" /></div>}
        {!state.loading && state.configured && !list.length && (
          <p className="stk-empty">{state.error ? (ar ? 'تعذّر تحميل الـ GIF.' : 'Could not load GIFs.') : (searching ? (ar ? 'مفيش نتائج' : 'No GIFs found') : (ar ? 'الـ GIF اللي بتبعتها هتظهر هنا' : 'GIFs you send show up here'))}</p>
        )}
      </div>
    </>
  );
}

export default function ChatPicker({ ar, onPickEmoji, onSendSticker, onSendGif, onNewSticker, canSticker = true, canGif = true, onClose, initialMode = 'emoji', refreshKey }) {
  const [mode, setMode] = useState(initialMode);
  // Admin → Chat Media decides which tabs exist for this person's portal (the server enforces it too).
  const [policy, setPolicy] = useState(cachedMediaPolicy);
  useEffect(() => { let dead = false; loadMediaPolicy().then((p) => { if (!dead) setPolicy(p); }); return () => { dead = true; }; }, []);
  const gifsOn = policy.gifs?.enabled !== false;
  const stickersOn = policy.stickers?.enabled !== false;
  const modes = [
    { id: 'emoji', icon: I.smile, label: ar ? 'إيموجي' : 'Emoji' },
    ...(gifsOn ? [{ id: 'gif', label: 'GIF' }] : []),
    ...(stickersOn ? [{ id: 'sticker', icon: I.sticker, label: ar ? 'ستيكر' : 'Stickers' }] : []),
  ];
  useEffect(() => { if (!modes.some((m) => m.id === mode)) setMode('emoji'); }, [mode, gifsOn, stickersOn]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="cp" role="dialog" aria-label={ar ? 'إيموجي وستيكرات' : 'Emoji, GIFs and stickers'}>
      <div className="cp-main">
        {mode === 'emoji' && <EmojiPicker ar={ar} top autoFocus onPick={onPickEmoji} />}
        {mode === 'gif' && gifsOn && <GifPane ar={ar} canSend={canGif} canSearch={policy.gifs?.search !== false} canTrending={policy.gifs?.trending !== false} onSend={(g) => { onSendGif(g); onClose?.(); }} />}
        {mode === 'sticker' && stickersOn && <StickerPane ar={ar} canSend={canSticker} canCreate={policy.stickers?.can_create !== false} onSend={(s) => { onSendSticker(s); onClose?.(); }} onNew={onNewSticker} onChanged={refreshKey} />}
      </div>
      <div className="cp-switch" role="tablist" aria-label={ar ? 'نوع المحتوى' : 'Content type'}>
        {modes.map((m) => (
          <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} className={`cp-switch__btn${mode === m.id ? ' is-on' : ''}`} onClick={() => setMode(m.id)} title={m.label}>
            {m.icon ? <Icon d={m.icon} size={20} /> : <span className="cp-switch__gif">GIF</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
