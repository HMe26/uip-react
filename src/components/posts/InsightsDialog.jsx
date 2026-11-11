import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import { postsApi } from '../../api/postsApi';
import { errorMessage } from '../../api/client';
import { ago } from '../feed/feedUi';
import { compact, fmtDuration } from '../../lib/postMedia';
import { PAvatar, REACTIONS, useTt } from './shared';

const PAGE = 30;
const CHANNEL = { link: ['Link', 'رابط', 'link'], chat: ['Chat', 'شات', 'message'], external: ['External app', 'تطبيق خارجي', 'external-link'] };

/** Loads a paged list; `load(page)` must resolve an array. Reset by changing `key`. */
function usePaged(load, key) {
  const [st, setSt] = useState({ items: [], page: 0, more: true, busy: true, err: '' });
  const go = useCallback(async (page) => {
    setSt((s) => ({ ...s, busy: true, err: '' }));
    try {
      const rows = await load(page);
      const list = Array.isArray(rows) ? rows : [];
      setSt((s) => ({ items: page === 1 ? list : [...s.items, ...list], page, more: list.length >= PAGE, busy: false, err: '' }));
    } catch (e) { setSt((s) => ({ ...s, busy: false, more: false, err: errorMessage(e) })); }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSt({ items: [], page: 0, more: true, busy: true, err: '' }); go(1); }, [go]);
  return { ...st, next: () => go(st.page + 1), retry: () => go(Math.max(1, st.page || 1)) };
}

function Row({ user, badge, children, aside, onOpen }) {
  return (
    <li className="pi-row">
      <button type="button" className="pi-row__av" onClick={() => onOpen?.(user)} aria-label={user.full_name}>
        <PAvatar user={user} size={44} />
        {badge && <span className="pi-row__badge">{badge}</span>}
      </button>
      <div className="pi-row__main"><strong>{user.full_name}</strong>{children}</div>
      {aside && <span className="pi-row__aside">{aside}</span>}
    </li>
  );
}

function List({ paged, empty, children, tt }) {
  const { items, busy, more, err, next, retry } = paged;
  return (
    <div className="pi-list-wrap">
      {err && <p className="pp-alert" role="alert"><Icon name="alert-triangle" size={16} /><span>{err}</span><button type="button" className="pp-btn" onClick={retry}>{tt('Retry', 'إعادة المحاولة')}</button></p>}
      {!err && !busy && items.length === 0 && <div className="pi-empty"><Icon name="users" size={30} /><span>{empty}</span></div>}
      {items.length > 0 && <ul className="pi-list">{items.map(children)}</ul>}
      {busy && <div className="pi-skels">{[0, 1, 2].map((k) => <span key={k} className="pp-skel" style={{ height: 56 }} />)}</div>}
      {!busy && more && items.length > 0 && <button type="button" className="pp-btn pi-more" onClick={next}>{tt('Show more', 'عرض المزيد')}</button>}
    </div>
  );
}

function Reactions({ post, onOpen, tt, locale }) {
  const [type, setType] = useState('');
  const bd = Object.entries(post.reaction_breakdown || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const total = post.counts?.reactions ?? bd.reduce((n, [, v]) => n + v, 0);
  const paged = usePaged((pg) => postsApi.reactors(post.id, type || undefined, pg), `r${post.id}${type}`);
  return (
    <>
      <div className="pi-chips" role="tablist">
        <button type="button" role="tab" aria-selected={!type} className={`pi-chip${!type ? ' is-on' : ''}`} onClick={() => setType('')}>{tt('All', 'الكل')} <b>{compact(total)}</b></button>
        {bd.map(([k, n]) => <button type="button" role="tab" aria-selected={type === k} key={k} className={`pi-chip${type === k ? ' is-on' : ''}`} onClick={() => setType(k)} title={tt(REACTIONS[k]?.en, REACTIONS[k]?.ar)}><span>{REACTIONS[k]?.e}</span> <b>{compact(n)}</b></button>)}
      </div>
      <List paged={paged} tt={tt} empty={tt('No reactions yet.', 'لا توجد تفاعلات بعد.')}>
        {(u) => <Row key={`${u.id}`} user={u} badge={REACTIONS[u.type]?.e} onOpen={onOpen} aside={ago(u.at, locale)}><small>{tt(REACTIONS[u.type]?.en || '', REACTIONS[u.type]?.ar || '')}</small></Row>}
      </List>
    </>
  );
}

function Shares({ post, kind, onOpen, tt, locale }) {
  const paged = usePaged((pg) => postsApi.sharers(post.id, kind, pg), `s${post.id}${kind}`);
  return (
    <List paged={paged} tt={tt} empty={kind === 'repost' ? tt('No reposts yet.', 'لا توجد إعادات نشر بعد.') : tt('No shares yet.', 'لا توجد مشاركات بعد.')}>
      {(u, i) => {
        const ch = CHANNEL[u.channel];
        return (
          <Row key={`${u.kind}${u.id}${i}`} user={u} onOpen={onOpen} aside={ago(u.at, locale)} badge={<Icon name={u.kind === 'repost' ? 'refresh' : (ch?.[2] || 'share')} size={11} />}>
            {u.kind === 'repost'
              ? <small>{tt('Reposted', 'أعاد النشر')}{u.body ? <> · <em dir="auto">“{u.body.length > 90 ? `${u.body.slice(0, 90)}…` : u.body}”</em></> : null}</small>
              : <small>{tt('Shared via', 'شارك عبر')} {ch ? tt(ch[0], ch[1]) : u.channel}</small>}
          </Row>
        );
      }}
    </List>
  );
}

function Viewers({ post, onOpen, tt, locale }) {
  const paged = usePaged((pg) => postsApi.viewers(post.id, pg), `v${post.id}`);
  return (
    <List paged={paged} tt={tt} empty={tt('Nobody viewed this post yet.', 'لم يشاهد أحد المنشور بعد.')}>
      {(u) => (
        <Row key={u.id} user={u} onOpen={onOpen} aside={ago(u.at, locale)}>
          <small>
            {u.views > 1 ? tt(`${u.views} views`, `${u.views} مرات`) : tt('1 view', 'مرة واحدة')}
            {u.dwell_ms >= 1000 ? <> · {tt('stayed', 'مكث')} <bdi dir="ltr">{fmtDuration(u.dwell_ms / 1000)}</bdi></> : null}
            {u.completed ? <> · <b className="pi-done"><Icon name="check" size={11} /> {tt('Finished it', 'أكمله')}</b></> : null}
          </small>
        </Row>
      )}
    </List>
  );
}

/**
 * "Who engaged with this post": reactions (filter by type), shares, reposts and — for the author — who viewed it.
 * Opened from the counters under a post. `tab` picks the starting tab.
 */
export default function InsightsDialog({ post, tab = 'reactions', onClose, onOpenComments, onOpenAuthor }) {
  const { tt, locale } = useTt();
  const mine = !!post.author?.is_me;
  const c = post.counts || {};
  const [cur, setCur] = useState(tab);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);

  const tiles = [
    { k: 'reactions', icon: 'thumbs-up', label: tt('Reactions', 'التفاعلات'), n: c.reactions || 0 },
    { k: 'comments', icon: 'message-square', label: tt('Comments', 'التعليقات'), n: c.comments || 0, action: () => { onClose(); onOpenComments?.(); } },
    { k: 'reposts', icon: 'refresh', label: tt('Reposts', 'إعادة النشر'), n: c.reposts || 0 },
    { k: 'shares', icon: 'share', label: tt('Shares', 'المشاركات'), n: c.shares || 0 },
    ...(mine ? [{ k: 'saves', icon: 'bookmark', label: tt('Saves', 'الحفظ'), n: c.saves || 0 }, { k: 'views', icon: 'eye', label: tt('Views', 'المشاهدات'), n: c.views || 0 }] : []),
  ];
  const open = (o) => { onClose(); onOpenAuthor?.(o); };

  return createPortal(
    <div className="sh-scrim pi-scrim" role="dialog" aria-modal="true" aria-label={tt('Post insights', 'تفاصيل التفاعل')} onClick={onClose}>
      <div className="sh-sheet pi-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sh-head">
          <h3>{tt('Post insights', 'تفاصيل التفاعل')}</h3>
          <button type="button" className="sh-x" onClick={onClose} aria-label={tt('Close', 'إغلاق')}><Icon name="x" size={18} /></button>
        </div>
        <div className="pi-tiles">
          {tiles.map((t) => (
            <button type="button" key={t.k} className={`pi-tile${cur === t.k ? ' is-on' : ''}`} disabled={t.k === 'saves'} onClick={() => (t.action ? t.action() : setCur(t.k))}>
              <Icon name={t.icon} size={17} /><b>{compact(t.n)}</b><span>{t.label}</span>
            </button>
          ))}
        </div>
        <div className="pi-body">
          {cur === 'reactions' && <Reactions post={post} onOpen={open} tt={tt} locale={locale} />}
          {cur === 'shares' && <Shares post={post} kind="share" onOpen={open} tt={tt} locale={locale} />}
          {cur === 'reposts' && <Shares post={post} kind="repost" onOpen={open} tt={tt} locale={locale} />}
          {cur === 'views' && mine && <Viewers post={post} onOpen={open} tt={tt} locale={locale} />}
          {cur === 'saves' && <div className="pi-empty"><Icon name="bookmark" size={30} /><span>{tt('Saves are private — only the number is shown.', 'الحفظ خاص — يظهر العدد فقط.')}</span></div>}
        </div>
      </div>
    </div>, document.body);
}
