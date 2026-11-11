import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, errorMessage } from '../../../api/client';
import Icon from '../../Icon';
import { useLanguage } from '../../../context/LanguageContext';
import { useBackLayer } from '../../../lib/backStack';
import Face from './Face';
import { API, bgCss, ago, endsIn, slideMs, storyMediaUrl, when } from './storyUtils';

// bare U+2764 renders as a black text glyph; append the emoji variation selector so it shows as the coloured heart
const emo = (r) => (r ? String(r).replace(/\u2764(?!\uFE0F)/g, '\u2764\uFE0F') : r);
const startIndex = (g) => (g && !g.is_mine ? g.first_unseen || 0 : 0);

/**
 * Full-screen story player: progress bars, tap zones (prev/next), hold to pause, swipe down to close, keyboard,
 * reply + reactions for other people's stories, viewers list + delete for my own.
 */
export default function StoryViewer({ queue, startGi = 0, reactions = [], onClose, onSeen, onReacted, onDeleted, onMute, onAdd }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const t = (en, a) => (ar ? a : en);

  const [groups, setGroups] = useState(queue);
  const [gi, setGi] = useState(startGi);
  const [si, setSi] = useState(() => startIndex(queue[startGi]));
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [held, setHeld] = useState(false);
  const [away, setAway] = useState(false);          // tab hidden
  const [typing, setTyping] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState(null);         // null | { loading, error, viewers, count, hidden_count, receipts_off }
  const [confirmDel, setConfirmDel] = useState(false);
  const [person, setPerson] = useState(null);        // a viewer whose card is open
  const [opening, setOpening] = useState(false);
  const [pickReact, setPickReact] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [toast, setToast] = useState('');
  const [burst, setBurst] = useState(null);

  const group = groups[gi];
  const story = group?.stories[si];
  const mine = !!group?.is_mine;

  const pRef = useRef(0);
  const barRef = useRef(null);
  const videoRef = useRef(null);
  const nextRef = useRef(null);
  const seenSent = useRef(new Set());
  const toastTimer = useRef(null);
  const press = useRef({ x: 0, y: 0, t: 0, timer: null, held: false, down: false });

  const paused = held || away || typing || menu || !!sheet || confirmDel || pickReact;

  const say = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useBackLayer(true, onClose);

  // Lock page scroll behind the player.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const onVis = () => setAway(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const patchStory = useCallback((id, patch) => {
    setGroups((gs) => gs.map((g) => ({ ...g, stories: g.stories.map((s) => (s.id === id ? { ...s, ...patch } : s)) })));
  }, []);

  // ---- navigation
  const goNext = useCallback(() => {
    if (!group) return;
    if (si < group.stories.length - 1) setSi(si + 1);
    else if (gi < groups.length - 1) { setGi(gi + 1); setSi(startIndex(groups[gi + 1])); }
    else onClose();
  }, [group, si, gi, groups, onClose]);
  nextRef.current = goNext;

  const goPrev = useCallback(() => {
    if (pRef.current > 0.15) {                    // restart the current one first
      pRef.current = 0;
      if (videoRef.current) videoRef.current.currentTime = 0;
      return;
    }
    if (si > 0) setSi(si - 1);
    else if (gi > 0) { setGi(gi - 1); setSi(groups[gi - 1].stories.length - 1); }
  }, [si, gi, groups]);

  // ---- per-story reset + mark viewed
  useEffect(() => {
    if (!story) return;
    pRef.current = 0;
    if (barRef.current) barRef.current.style.transform = 'scaleX(0)';
    setReady(story.type === 'text');
    setFailed(false);
    setReply('');
    setPickReact(false);
    setMenu(false);
    setTyping(false);
    setBurst(null);
    setPerson(null);
    if (!mine && !seenSent.current.has(story.id)) {
      seenSent.current.add(story.id);
      api.post(`${API}/${story.id}/view`).catch(() => {});
      patchStory(story.id, { seen: true });
      onSeen?.(story.id);
    }
  }, [story?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- progress engine (drives the bar through a ref so React doesn't re-render 60 times a second)
  useEffect(() => {
    if (!story) return undefined;
    const v = videoRef.current;
    if (story.type === 'video' && v && !failed) {
      if (paused || !ready) v.pause();
      else v.play().catch(() => { v.muted = true; setSoundOn(false); v.play().catch(() => {}); });
    }
    if (!ready) return undefined;
    let raf;
    let last = performance.now();
    const total = failed ? 3000 : slideMs(story, v && v.duration ? Math.round(v.duration) : null);
    const tick = (now) => {
      const dt = now - last;
      last = now;
      if (!paused) {
        if (story.type === 'video' && v && v.duration && !failed) pRef.current = Math.min(1, v.currentTime / v.duration);
        else pRef.current = Math.min(1, pRef.current + dt / total);
        if (barRef.current) barRef.current.style.transform = `scaleX(${pRef.current})`;
        if (pRef.current >= 1) { nextRef.current?.(); return; }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [story?.id, paused, ready, failed]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- keyboard
  useEffect(() => {
    const onKey = (e) => {
      const inField = /^(INPUT|TEXTAREA)$/.test(e.target?.tagName || '');
      if (e.key === 'Escape') {
        if (person) setPerson(null);
        else if (sheet) setSheet(null);
        else if (confirmDel) setConfirmDel(false);
        else if (menu) setMenu(false);
        else if (pickReact) setPickReact(false);
        else if (typing) e.target?.blur?.();
        else onClose();
        return;
      }
      if (inField) return;
      const fwd = ar ? 'ArrowLeft' : 'ArrowRight';
      const back = ar ? 'ArrowRight' : 'ArrowLeft';
      if (e.key === fwd) goNext();
      else if (e.key === back) goPrev();
      else if (e.key === ' ') { e.preventDefault(); setHeld((h) => !h); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ar, goNext, goPrev, sheet, person, confirmDel, menu, pickReact, typing, onClose]);

  // ---- pointer: tap zones, hold to pause, swipe down to close
  const onDown = (e) => {
    const p = press.current;
    p.down = true; p.held = false; p.x = e.clientX; p.y = e.clientY; p.t = Date.now();
    clearTimeout(p.timer);
    p.timer = setTimeout(() => { p.held = true; setHeld(true); }, 220);
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* not supported */ }
  };
  const onMove = (e) => {
    const p = press.current;
    if (!p.down) return;
    const dy = e.clientY - p.y;
    const dx = e.clientX - p.x;
    if (dy > 110 && Math.abs(dx) < 70) { p.down = false; clearTimeout(p.timer); setHeld(false); onClose(); }
  };
  const onUp = (e) => {
    const p = press.current;
    if (!p.down) return;
    p.down = false;
    clearTimeout(p.timer);
    if (p.held) { setHeld(false); return; }
    const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    if (moved > 14) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    const startSide = rel < 0.32;                // the "back" zone sits on the reading-start side
    const backZone = ar ? rel > 0.68 : startSide;
    if (backZone) goPrev(); else goNext();
  };
  const onCancel = () => { const p = press.current; p.down = false; clearTimeout(p.timer); setHeld(false); };

  // ---- actions
  const sendReply = async () => {
    const body = reply.trim();
    if (!body || sending || !story) return;
    setSending(true);
    try {
      await api.post(`${API}/${story.id}/reply`, { body });
      setReply('');
      setTyping(false);
      document.activeElement?.blur?.();
      say(t('Reply sent', 'تم إرسال الرد'));
    } catch (err) {
      say(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const react = async (emoji) => {
    if (!story) return;
    const prev = story.my_reaction || null;
    const next = prev === emoji ? '' : emoji;
    setPickReact(false);
    patchStory(story.id, { my_reaction: next || null });
    onReacted?.(story.id, next || null);
    if (next) setBurst({ e: emoji, k: Date.now() });
    try {
      await api.post(`${API}/${story.id}/react`, { emoji: next });
    } catch (err) {
      patchStory(story.id, { my_reaction: prev });
      onReacted?.(story.id, prev);
      say(errorMessage(err));
    }
  };

  const openViewers = async () => {
    if (!story) return;
    setSheet({ loading: true });
    try {
      const res = await api.get(`${API}/${story.id}/viewers`);
      setSheet({ loading: false, ...res.data });
    } catch (err) {
      setSheet({ loading: false, error: errorMessage(err), viewers: [], count: 0, hidden_count: 0 });
    }
  };

  // open (or create) the one-to-one chat with a viewer, then let the Messages page show it
  const messageUser = async (v) => {
    if (opening) return;
    setOpening(true);
    try {
      const res = await api.post(`${API.replace(/\/stories$/, '')}/conversations/direct`, { recipient_id: v.id, body: '' });
      const id = res?.data?.conversation?.id;
      setSheet(null); setPerson(null);
      onClose();
      if (id) window.dispatchEvent(new CustomEvent('uip-open-conversation', { detail: { id } }));
    } catch (err) {
      say(errorMessage(err));
    } finally {
      setOpening(false);
    }
  };

  const toggleMute = async () => {
    if (!group) return;
    const muted = !group.muted;
    setMenu(false);
    try {
      if (muted) await api.post(`${API}/mute/${group.user_id}`); else await api.del(`${API}/mute/${group.user_id}`);
      setGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, muted } : g)));
      onMute?.(group.user_id, muted);
      say(muted ? t('Muted — their stories move to the end of the list', 'تم الكتم — استوريهاتهم هتروح آخر القايمة') : t('Unmuted', 'تم إلغاء الكتم'));
    } catch (err) {
      say(errorMessage(err));
    }
  };

  const doDelete = async () => {
    if (!story) return;
    setConfirmDel(false);
    try {
      await api.del(`${API}/${story.id}`);
      onDeleted?.(story.id);
      // Remove it from the local queue and move on.
      const g = groups[gi];
      if (g.stories.length > 1) {
        setGroups((gs) => gs.map((x, i) => (i === gi ? { ...x, stories: x.stories.filter((s) => s.id !== story.id) } : x)));
        setSi((i) => Math.min(i, g.stories.length - 2));
      } else {
        onClose();
      }
    } catch (err) {
      say(errorMessage(err));
    }
  };

  if (!story) return null;

  const bar = (i) => {
    if (i < si) return { transform: 'scaleX(1)' };
    if (i > si) return { transform: 'scaleX(0)' };
    return undefined;
  };
  const len = (story.body || '').length;
  const textSize = len < 40 ? 'xl' : len < 120 ? 'l' : len < 300 ? 'm' : 's';
  const src = storyMediaUrl(story);

  return createPortal(
    <div className="sv" role="dialog" aria-modal="true" aria-label={t('Story', 'استوري')} dir={ar ? 'rtl' : 'ltr'}>
      <button type="button" className="sv__backdrop" aria-label={t('Close', 'إغلاق')} onClick={onClose} />

      <button type="button" className="sv__nav sv__nav--prev" aria-label={t('Previous', 'السابق')} onClick={goPrev} hidden={gi === 0 && si === 0}>
        <Icon name={ar ? 'chevron-right' : 'chevron-left'} size={22} />
      </button>

      <div className="sv__card" style={story.type === 'text' ? { background: bgCss(story.bg) } : undefined}>
        <div
          className="sv__stage"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
          onContextMenu={(e) => e.preventDefault()}
        >
          {story.type === 'text' && (
            <div className={`sv__text sv-font-${story.font || 'sans'} is-${textSize}`}>{story.body}</div>
          )}
          {story.type === 'image' && !failed && (
            <img key={story.id} className="sv__media" src={src} alt={story.caption || ''} draggable="false"
              onLoad={() => setReady(true)} onError={() => { setFailed(true); setReady(true); }} />
          )}
          {story.type === 'video' && !failed && (
            <video key={story.id} ref={videoRef} className="sv__media" src={src} poster={storyMediaUrl(story, 'thumbnail') || undefined}
              playsInline preload="auto" muted={!soundOn}
              onLoadedData={() => setReady(true)} onCanPlay={() => setReady(true)}
              onEnded={() => nextRef.current?.()} onError={() => { setFailed(true); setReady(true); }} />
          )}
          {failed && story.type !== 'text' && (
            <div className="sv__failed"><Icon name="alert-triangle" size={28} /><span>{t('Could not load this story', 'تعذّر تحميل الاستوري')}</span></div>
          )}
          {!ready && !failed && <div className="sv__spinner" aria-hidden="true" />}
          {story.type !== 'text' && story.caption && <p className="sv__caption">{story.caption}</p>}
          {burst && <span key={burst.k} className="sv__burst" aria-hidden="true">{burst.e}</span>}
        </div>

        <div className="sv__top">
          <div className="sv__bars" aria-hidden="true">
            {group.stories.map((s, i) => (
              <span className="sv__bar" key={s.id}>
                <i ref={i === si ? barRef : null} style={bar(i)} />
              </span>
            ))}
          </div>
          <div className="sv__head">
            <Face name={group.full_name} src={group.avatar_path} className="sv__face" />
            <div className="sv__who">
              <strong>{mine ? t('My status', 'استوريتي') : group.full_name}</strong>
              <small>{ago(story.created_at, ar)}{mine ? ` · ${endsIn(story.expires_at, ar)}` : ''}</small>
            </div>
            <div className="sv__tools">
              {story.type === 'video' && (
                <button type="button" className="sv__btn" aria-label={soundOn ? t('Mute sound', 'كتم الصوت') : t('Sound on', 'تشغيل الصوت')}
                  onClick={() => setSoundOn((s) => !s)}><span aria-hidden="true">{soundOn ? '🔊' : '🔇'}</span></button>
              )}
              <div className="sv__menuwrap">
                <button type="button" className="sv__btn" aria-haspopup="menu" aria-expanded={menu} aria-label={t('More', 'المزيد')} onClick={() => setMenu((m) => !m)}>
                  <Icon name="more-vertical" size={20} />
                </button>
                {menu && (
                  <div className="sv__menu" role="menu">
                    {mine ? (
                      <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenu(false); setConfirmDel(true); }}>
                        <Icon name="trash" size={16} /> {t('Delete', 'حذف')}
                      </button>
                    ) : (
                      <button type="button" role="menuitem" onClick={toggleMute}>
                        <Icon name="eye-off" size={16} /> {group.muted ? t('Unmute', 'إلغاء الكتم') : t('Mute', 'كتم')}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <button type="button" className="sv__btn" aria-label={t('Close', 'إغلاق')} onClick={onClose}><Icon name="x" size={22} /></button>
            </div>
          </div>
        </div>

        <div className="sv__bottom">
          {mine ? (
            <div className="sv__mine">
              <button type="button" className="sv__views" onClick={openViewers}>
                <Icon name="eye" size={18} />
                <span>{story.views_count || 0}</span>
                {story.reactions_count > 0 && <span className="sv__views-react">{emo('❤')} {story.reactions_count}</span>}
                <small>{t('Viewers', 'المشاهدين')}</small>
              </button>
              <button type="button" className="sv__add" onClick={onAdd} aria-label={t('Add status', 'أضف استوري')}><Icon name="plus" size={20} /></button>
            </div>
          ) : story.allow_replies ? (
            <div className="sv__reply">
              {pickReact && (
                <div className="sv__reacts" role="group" aria-label={t('Reactions', 'التفاعلات')}>
                  {reactions.map((e) => (
                    <button type="button" key={e} className={story.my_reaction === e ? 'is-on' : ''} onClick={() => react(e)}>{e}</button>
                  ))}
                </div>
              )}
              <div className="sv__replybar">
                <input
                  type="text" value={reply} maxLength={1000} autoComplete="off" enterKeyHint="send"
                  placeholder={t('Reply…', 'اكتب رد…')}
                  onChange={(e) => setReply(e.target.value)}
                  onFocus={() => setTyping(true)} onBlur={() => setTyping(false)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendReply(); } }}
                />
                {reply.trim() ? (
                  <button type="button" className="sv__send" disabled={sending} onClick={sendReply} aria-label={t('Send', 'إرسال')}><Icon name="send" size={18} /></button>
                ) : (
                  <button type="button" className={`sv__heart${story.my_reaction ? ' is-on' : ''}`} onClick={() => setPickReact((p) => !p)} aria-label={t('React', 'تفاعل')} aria-expanded={pickReact}>
                    {story.my_reaction ? <span aria-hidden="true">{emo(story.my_reaction)}</span> : <Icon name="heart" size={20} />}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="sv__reply">
              <p className="sv__off">{t('Replies are turned off for this story', 'الرد مقفول على الاستوري دي')}</p>
              <button type="button" className={`sv__heart${story.my_reaction ? ' is-on' : ''}`} onClick={() => setPickReact((p) => !p)} aria-label={t('React', 'تفاعل')}>
                {story.my_reaction ? <span aria-hidden="true">{emo(story.my_reaction)}</span> : <Icon name="heart" size={20} />}
              </button>
              {pickReact && (
                <div className="sv__reacts sv__reacts--float" role="group">
                  {reactions.map((e) => <button type="button" key={e} className={story.my_reaction === e ? 'is-on' : ''} onClick={() => react(e)}>{e}</button>)}
                </div>
              )}
            </div>
          )}
        </div>

        {toast && <div className="sv__toast" role="status">{toast}</div>}

        {confirmDel && (
          <div className="sv__sheet-back" onClick={() => setConfirmDel(false)}>
            <div className="sv__sheet sv__sheet--confirm" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-label={t('Delete story', 'حذف الاستوري')}>
              <h3>{t('Delete this story?', 'حذف الاستوري دي؟')}</h3>
              <p>{t('It will disappear for everyone who can see it.', 'هتختفي عند كل اللي بيشوفوها.')}</p>
              <div className="sv__sheet-actions">
                <button type="button" className="sv__ghost" onClick={() => setConfirmDel(false)}>{t('Cancel', 'إلغاء')}</button>
                <button type="button" className="sv__danger" onClick={doDelete}>{t('Delete', 'حذف')}</button>
              </div>
            </div>
          </div>
        )}

        {sheet && (
          <div className="sv__sheet-back" onClick={() => { if (person) setPerson(null); else setSheet(null); }}>
            <div className="sv__sheet sv__sheet--viewers" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('Viewers', 'المشاهدين')}>
              <div className="sv__grab" aria-hidden="true" />
              <div className="sv__sheet-head">
                <h3>{t('Viewed by', 'تمت المشاهدة بواسطة')}{sheet.count != null ? ` ${sheet.count}` : ''}</h3>
                <div className="sv__sheet-tools">
                  <button type="button" className="sv__tool is-danger" onClick={() => { setSheet(null); setConfirmDel(true); }} aria-label={t('Delete this story', 'حذف الاستوري')} title={t('Delete this story', 'حذف الاستوري')}>
                    <Icon name="trash" size={19} />
                  </button>
                  <button type="button" className="sv__tool" onClick={() => setSheet(null)} aria-label={t('Close', 'إغلاق')}><Icon name="x" size={19} /></button>
                </div>
              </div>
              <div className="sv__sheet-body">
                {sheet.loading && <p className="sv__muted">{t('Loading…', 'جاري التحميل…')}</p>}
                {sheet.error && <p className="sv__muted">{sheet.error}</p>}
                {!sheet.loading && sheet.receipts_off && (
                  <p className="sv__muted">{t('Read receipts are off, so you only see the count. Turn them on in chat privacy to see who viewed.', 'إيصالات القراءة مقفولة فبتشوف العدد بس. افتحها من خصوصية الشات عشان تشوف مين شاف.')}</p>
                )}
                {!sheet.loading && !sheet.receipts_off && !sheet.error && sheet.viewers?.length === 0 && (
                  <p className="sv__muted">{sheet.count ? t('Some viewers keep their views private.', 'في ناس مخفيين مشاهدتهم.') : t('No views yet', 'لسه محدش شاف')}</p>
                )}
                {(sheet.viewers || []).map((v) => (
                  <div className="sv__viewer" key={v.id} role="button" tabIndex={0} onClick={() => setPerson(v)} onKeyDown={(e) => { if (e.key === 'Enter') setPerson(v); }}>
                    <span className="sv__vface">
                      <Face name={v.full_name} src={v.avatar_path} />
                      {v.reaction && <i className="sv__vbadge" aria-hidden="true">{emo(v.reaction)}</i>}
                    </span>
                    <div className="sv__vtext"><strong dir="auto">{v.full_name}</strong><small>{when(v.viewed_at, ar)}</small></div>
                    <button type="button" className="sv__vmsg" onClick={(e) => { e.stopPropagation(); messageUser(v); }} aria-label={t('Message', 'راسله')} title={t('Message', 'راسله')}>
                      <Icon name="message-square" size={19} />
                    </button>
                  </div>
                ))}
                {!sheet.loading && !sheet.receipts_off && sheet.hidden_count > 0 && sheet.viewers?.length > 0 && (
                  <p className="sv__muted">{t(`+ ${sheet.hidden_count} private`, `+ ${sheet.hidden_count} مخفيين`)}</p>
                )}
              </div>

              {person && (
                <div className="sv__person" role="dialog" aria-label={person.full_name}>
                  <button type="button" className="sv__tool sv__person-x" onClick={() => setPerson(null)} aria-label={t('Close', 'إغلاق')}><Icon name="x" size={19} /></button>
                  <span className="sv__pface"><Face name={person.full_name} src={person.avatar_path} /></span>
                  <strong dir="auto">{person.full_name}</strong>
                  <small>{t('Viewed', 'شاف')} · {when(person.viewed_at, ar)}</small>
                  {person.reaction && <span className="sv__preact">{t('Reacted', 'تفاعل')} {emo(person.reaction)}</span>}
                  <button type="button" className="sv__danger sv__pmsg" onClick={() => messageUser(person)} disabled={opening}>
                    <Icon name="message-square" size={17} /> {t('Send message', 'ابعت رسالة')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <button type="button" className="sv__nav sv__nav--next" aria-label={t('Next', 'التالي')} onClick={goNext}>
        <Icon name={ar ? 'chevron-left' : 'chevron-right'} size={22} />
      </button>
    </div>,
    document.body,
  );
}
