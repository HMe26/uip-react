import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { loadAttachmentBlob } from '../../lib/chatMedia';
import { createPortal } from 'react-dom';
import { api } from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import { parseServerDate } from '../../utils/serverDate';
import { Avatar } from './ConversationRail';
import EmojiPicker from './EmojiPicker';
import '../../styles/css/message-menu.css';

/**
 * Message context menu (right-click on laptop / long-press on phone) — the WhatsApp menu, plus:
 *  - phone: a bottom sheet (big touch targets, swipe-down to close, dimmed backdrop) instead of a tiny popover
 *  - the message stays highlighted while the menu is open
 *  - reaction bar marks the emoji you already used (tap again = remove) and "+" opens the full emoji picker
 *  - "Copy" copies only the text you selected inside the bubble, if any
 *  - full keyboard support (↑ ↓ Home End Enter Esc) + ARIA menu roles
 *  - Message info with live Read / Delivered times (refreshes by itself) and a per-person list in groups
 *  - delete dialog that only offers "for everyone" while that is still allowed
 *  - starred messages list, favourite stickers, copy sticker as image, save as
 */

const BASE = '/api/v1/messaging';
const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function useT() {
  const { locale } = useLanguage();
  return (en, ar) => (locale === 'ar' ? ar : en);
}

/* ------------------------------------------------------------------ icons */
const I = {
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" /></>,
  reply: <path d="M9 17 4 12l5-5M4 12h11a4 4 0 0 1 4 4v1" />,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>,
  forward: <path d="m15 17 5-5-5-5M4 18v-2a4 4 0 0 1 4-4h12" />,
  pin: <><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></>,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" />,
  heart: <path d="M20.8 5.6a5.2 5.2 0 0 0-7.4 0L12 7l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 21.8l8.8-8.8a5.2 5.2 0 0 0 0-7.4Z" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5-5-8 8" /></>,
  edit: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />,
  select: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m8 12 3 3 5-6" /></>,
  save: <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />,
  report: <><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17v.01" /></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /><path d="M10 11v5M14 11v5" /></>,
  back: <path d="M19 12H5m6-6-6 6 6 6" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  plus: <path d="M12 5v14M5 12h14" />,
  jump: <path d="M7 17 17 7M8 7h9v9" />,
};
export function MIcon({ name, size = 18, filled = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {I[name]}
    </svg>
  );
}

function DoubleTick({ read, size = 17 }) {
  return (
    <svg className={`mm-tick${read ? ' is-read' : ''}`} width={size} height={Math.round(size * 0.65)} viewBox="0 0 17 11" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 5.8 4.2 9 10.2 1.6" />
      <path d="M6.6 8.4 7.2 9 13.2 1.6" />
    </svg>
  );
}

/* ------------------------------------------------------------- utilities */
let toastTimer = 0;
export function menuToast(text) {
  const host = document.querySelector('.app-shell') || document.body;
  let el = document.getElementById('mm-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mm-toast';
    el.className = 'mm-toast';
    el.setAttribute('role', 'status');
    host.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 1800);
}

/** Clipboard accepts PNG only, so GIF / WebP / SVG stickers are redrawn on a canvas first. */
export async function copyImageToClipboard(url) {
  const blob = await loadAttachmentBlob(url);
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  canvas.getContext('2d').drawImage(bmp, 0, 0);
  const png = await new Promise((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error('png'))), 'image/png'));
  await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': png })]);
}

export async function downloadFromUrl(url, filename) {
  const blob = await loadAttachmentBlob(url);
  const a = document.createElement('a');
  const obj = URL.createObjectURL(blob);
  a.href = obj; a.download = filename || 'sticker';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(obj), 4000);
}

/** "Yesterday at 12:05 pm" / "اليوم الساعة 12:05 م" */
export function fmtFull(iso, t, locale) {
  if (!iso) return '';
  const d = parseServerDate(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString(locale === 'ar' ? 'ar-EG' : undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return t(`Today at ${time}`, `اليوم الساعة ${time}`);
  if (d.toDateString() === yest.toDateString()) return t(`Yesterday at ${time}`, `أمس الساعة ${time}`);
  const day = d.toLocaleDateString(locale === 'ar' ? 'ar-EG' : undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  return t(`${day} at ${time}`, `${day} الساعة ${time}`);
}

// favourite stickers (per user) — loaded once, kept in memory
let favUrls = null;
let favPromise = null;
export function loadFavourites(force = false) {
  if (favUrls && !force) return Promise.resolve(favUrls);
  if (!favPromise || force) {
    favPromise = api.get(BASE + '/favourites/stickers')
      .then((r) => { favUrls = new Set((r.data || []).map((x) => x.url)); return favUrls; })
      .catch(() => { favUrls = favUrls || new Set(); return favUrls; })
      .finally(() => { favPromise = null; });
  }
  return favPromise;
}
export function setFavLocal(url, on) {
  favUrls = favUrls || new Set();
  if (on) favUrls.add(url); else favUrls.delete(url);
}

/* ----------------------------------------------------------- context menu */
/**
 * props:
 *  m, at {x,y} (desktop point or button rect), touch, selectedText, myUserId
 *  caps: { info, copy, edit, saveAs, favourite, copyImage, report, canDeleteAll, pinned, starred, isFav, mineReaction }
 *  on: { react, info, reply, copy, forward, pin, star, favourite, copyImage, edit, select, saveAs, report, del }
 */
export function MessageContextMenu({ m, at, touch, caps, on, onClose, rowEl }) {
  const t = useT();
  const { locale } = useLanguage();
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [drag, setDrag] = useState(0);
  const dragRef = useRef({ y0: 0, on: false });
  const openedAt = useRef(Date.now()); // the finger that long-pressed is still lifting: ignore the synthetic tap/mousedown it produces
  const host = document.querySelector('.app-shell') || document.body;

  const items = useMemo(() => {
    const list = [];
    const add = (key, icon, en, ar, fn, opts = {}) => list.push({ key, icon, label: t(en, ar), fn, ...opts });
    if (caps.info) add('info', 'info', 'Message info', 'معلومات الرسالة', on.info);
    add('reply', 'reply', 'Reply', 'رد', on.reply);
    if (caps.copy) add('copy', 'copy', caps.selected ? 'Copy selection' : 'Copy', caps.selected ? 'نسخ المحدد' : 'نسخ', on.copy);
    add('forward', 'forward', 'Forward', 'إعادة توجيه', on.forward);
    add('pin', 'pin', caps.pinned ? 'Unpin' : 'Pin', caps.pinned ? 'إلغاء التثبيت' : 'تثبيت', on.pin);
    add('star', 'star', caps.starred ? 'Unstar' : 'Star', caps.starred ? 'إزالة النجمة' : 'تمييز بنجمة', on.star, { filled: caps.starred });
    if (caps.favourite) add('fav', 'heart', caps.isFav ? 'Remove from Favourites' : 'Add to Favourites', caps.isFav ? 'إزالة من المفضلة' : 'إضافة للمفضلة', on.favourite, { filled: caps.isFav });
    if (caps.copyImage) add('copyimg', 'image', m.message_type === 'gif' ? 'Copy GIF image' : 'Copy sticker image', m.message_type === 'gif' ? 'نسخ صورة الـ GIF' : 'نسخ صورة الملصق', on.copyImage);
    if (caps.edit) add('edit', 'edit', 'Edit', 'تعديل', on.edit);
    if (on.select) add('select', 'select', 'Select', 'تحديد', on.select, { sep: true });
    if (caps.saveAs) add('save', 'save', 'Save as…', 'حفظ باسم…', on.saveAs);
    if (caps.report) add('report', 'report', 'Report', 'إبلاغ', on.report, { danger: true, sep: true });
    add('del', 'trash', 'Delete', 'حذف', on.del, { danger: true, sep: !caps.report });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, caps, locale]);

  // Place the popover at the pointer, keep it inside the viewport, flip upward when there is no room below.
  useLayoutEffect(() => {
    if (touch) { setPos({}); return; }
    const p = panelRef.current?.getBoundingClientRect();
    if (!p) return;
    const M = 8;
    const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
    let left = at.x;
    if (rtl) left = at.x - p.width;
    left = Math.max(M, Math.min(left, window.innerWidth - p.width - M));
    let top = at.y;
    if (top + p.height > window.innerHeight - M) top = Math.max(M, at.y - p.height);
    if (top + p.height > window.innerHeight - M) top = Math.max(M, window.innerHeight - p.height - M);
    setPos({ left, top });
  }, [at, touch, emojiOpen, items.length]);

  // highlight the message while the menu is open
  useEffect(() => {
    if (!rowEl) return undefined;
    rowEl.classList.add('msg-row--menu');
    return () => rowEl.classList.remove('msg-row--menu');
  }, [rowEl]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (emojiOpen) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % items.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i <= 0 ? items.length - 1 : i - 1)); }
      else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
      else if (e.key === 'End') { e.preventDefault(); setActive(items.length - 1); }
      else if ((e.key === 'Enter' || e.key === ' ') && active >= 0) { e.preventDefault(); run(items[active]); }
    };
    const onDown = (e) => { if (Date.now() - openedAt.current < 450) return; if (!panelRef.current?.contains(e.target)) onClose(); };
    const onAway = () => onClose();
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('resize', onAway);
    window.addEventListener('blur', onAway);
    const thread = document.querySelector('.msg-thread__scroll');
    if (!touch && thread) thread.addEventListener('scroll', onAway, { passive: true });
    if (touch) document.body.classList.add('mm-lock');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('resize', onAway);
      window.removeEventListener('blur', onAway);
      if (!touch && thread) thread.removeEventListener('scroll', onAway);
      document.body.classList.remove('mm-lock');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, active, emojiOpen, touch]);

  useEffect(() => { panelRef.current?.focus({ preventScroll: true }); }, []);

  const run = useCallback((it) => { if (!it) return; onClose(); setTimeout(() => it.fn?.(), 0); }, [onClose]);
  const react = (emoji) => { onClose(); setTimeout(() => on.react(emoji), 0); };

  // swipe the sheet down to close (phone)
  const dStart = (e) => { dragRef.current = { y0: e.touches[0].clientY, on: true }; };
  const dMove = (e) => { if (dragRef.current.on) setDrag(Math.max(0, e.touches[0].clientY - dragRef.current.y0)); };
  const dEnd = () => { dragRef.current.on = false; if (drag > 90) onClose(); else setDrag(0); };

  const preview = (m.body || (m.message_type === 'sticker' ? t('Sticker', 'ملصق') : m.message_type === 'gif' ? 'GIF' : m.attachments?.length ? t('Attachment', 'مرفق') : '')).slice(0, 90);

  const bar = (
    <div className="mm-react" role="group" aria-label={t('Reactions', 'التفاعلات')}>
      {QUICK.map((e) => (
        <button key={e} type="button" className={`mm-react__btn${caps.mineReaction === e ? ' is-mine' : ''}`} onClick={() => react(e)} aria-pressed={caps.mineReaction === e}>{e}</button>
      ))}
      <button type="button" className={`mm-react__btn mm-react__more${emojiOpen ? ' is-mine' : ''}`} onClick={() => setEmojiOpen((o) => !o)} aria-label={t('More reactions', 'تفاعلات أخرى')} aria-expanded={emojiOpen}>
        <MIcon name="plus" size={17} />
      </button>
    </div>
  );

  const list = emojiOpen ? (
    <div className="mm-emoji"><EmojiPicker onPick={(e) => react(e)} /></div>
  ) : (
    <ul className="mm-list" role="menu" aria-label={t('Message actions', 'إجراءات الرسالة')}>
      {items.map((it, i) => (
        <li key={it.key} role="none" className={it.sep ? 'mm-sep' : undefined}>
          <button type="button" role="menuitem" tabIndex={-1}
            className={`mm-item${it.danger ? ' is-danger' : ''}${active === i ? ' is-active' : ''}`}
            onMouseEnter={() => setActive(i)} onClick={() => run(it)}>
            <MIcon name={it.icon} size={touch ? 21 : 18} filled={it.filled} />
            <span>{it.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return createPortal(
    <div className={`mm-root${touch ? ' is-touch' : ''}`}>
      <div className="mm-backdrop" onClick={() => { if (Date.now() - openedAt.current > 450) onClose(); }} onContextMenu={(e) => { e.preventDefault(); if (Date.now() - openedAt.current > 450) onClose(); }} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`mm-panel${touch ? ' mm-sheet' : ''}`}
        style={touch ? { transform: drag ? `translateY(${drag}px)` : undefined } : { left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {touch && (
          <div className="mm-grab" onTouchStart={dStart} onTouchMove={dMove} onTouchEnd={dEnd}><i /></div>
        )}
        {touch && preview ? <div className="mm-preview" dir="auto">{preview}</div> : null}
        {bar}
        {list}
      </div>
    </div>,
    host
  );
}

/* ----------------------------------------------------------- delete dialog */
export function DeleteMessageDialog({ canAll, onClose, onChoose }) {
  const t = useT();
  const host = document.querySelector('.app-shell') || document.body;
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [busy, onClose]);
  const go = async (mode) => { setBusy(true); try { await onChoose(mode); } finally { setBusy(false); onClose(); } };
  return createPortal(
    <div className="mm-dlg-back" onClick={() => !busy && onClose()}>
      <div className="mm-dlg" role="alertdialog" aria-modal="true" aria-label={t('Delete message?', 'حذف الرسالة؟')} onClick={(e) => e.stopPropagation()}>
        <h3>{t('Delete message?', 'حذف الرسالة؟')}</h3>
        {!canAll && <p>{t('It can only be deleted for you now — the time limit for deleting for everyone has passed.', 'تقدر تحذفها عندك بس — انتهى وقت الحذف للجميع.')}</p>}
        {canAll && <button type="button" className="mm-dlg__btn is-danger" disabled={busy} onClick={() => go('for-everyone')}>{t('Delete for everyone', 'حذف للجميع')}</button>}
        <button type="button" className="mm-dlg__btn is-green" disabled={busy} onClick={() => go('for-me')} autoFocus={!canAll}>{t('Delete for me', 'حذف عندي')}</button>
        <button type="button" className="mm-dlg__cancel" disabled={busy} onClick={onClose}>{t('Cancel', 'إلغاء')}</button>
      </div>
    </div>,
    host
  );
}

/* ------------------------------------------------------------ message info */
export function MessageInfoPanel({ m, onClose, preview }) {
  const t = useT();
  const { locale } = useLanguage();
  const host = document.querySelector('.app-shell') || document.body;
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    const load = () => api.get(BASE + '/messages/' + m.id + '/info')
      .then((r) => { if (alive) { setData(r.data); setErr(''); } })
      .catch((e) => { if (alive) setErr(e?.message || t('Could not load message info.', 'تعذّر تحميل معلومات الرسالة.')); });
    load();
    const h = setInterval(load, 5000); // read / delivered ticks appear live while the panel is open
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => { alive = false; clearInterval(h); document.removeEventListener('keydown', k); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id]);

  const rec = data?.recipients || [];
  const read = rec.filter((r) => r.status === 'read');
  const delivered = rec.filter((r) => r.status === 'delivered');
  const waiting = rec.filter((r) => r.status === 'sent');
  const isGroup = !!data?.is_group;
  const one = rec[0];

  const Row = ({ r, kind }) => (
    <li className="mm-info__person">
      <Avatar name={r.full_name} size="sm" src={r.avatar_path || null} />
      <div className="mm-info__who">
        <strong>{r.full_name}</strong>
        <span>{kind === 'read' ? fmtFull(r.read_at, t, locale) : kind === 'delivered' ? fmtFull(r.delivered_at, t, locale) : t('Not delivered yet', 'لم تصل بعد')}</span>
      </div>
      {kind !== 'sent' && <DoubleTick read={kind === 'read'} />}
    </li>
  );

  return createPortal(
    <div className="mm-info-back mm-info-back--card" onClick={onClose}>
      <section className="mm-info mm-info--card" role="dialog" aria-modal="true" aria-label={t('Message info', 'معلومات الرسالة')} onClick={(e) => e.stopPropagation()}>
        <header className="mm-info__head">
          <button type="button" className="mm-iconbtn" onClick={onClose} aria-label={t('Back', 'رجوع')}><MIcon name="back" size={20} /></button>
          <h3>{t('Message info', 'معلومات الرسالة')}</h3>
        </header>
        <div className="mm-info__stage">
          <div className="mm-info__bubble" dir="auto">{preview}</div>
        </div>

        {err && <p className="mm-info__err">{err}</p>}
        {!data && !err && <p className="mm-info__muted">{t('Loading…', 'جارٍ التحميل…')}</p>}

        {data && !isGroup && one && (
          <ul className="mm-info__block">
            <li className="mm-info__line">
              <div className="mm-info__ico"><DoubleTick read /></div>
              <div><strong>{t('Read', 'تمت القراءة')}</strong><span>{one.read_at ? fmtFull(one.read_at, t, locale) : '—'}</span></div>
            </li>
            <li className="mm-info__line">
              <div className="mm-info__ico"><DoubleTick /></div>
              <div><strong>{t('Delivered', 'تم التسليم')}</strong><span>{one.delivered_at ? fmtFull(one.delivered_at, t, locale) : '—'}</span></div>
            </li>
          </ul>
        )}

        {data && isGroup && (
          <div className="mm-info__groups">
            {read.length > 0 && <><h4>{t(`Read by ${read.length}`, `قرأها ${read.length}`)}</h4><ul>{read.map((r) => <Row key={r.user_id} r={r} kind="read" />)}</ul></>}
            {delivered.length > 0 && <><h4>{t(`Delivered to ${delivered.length}`, `وصلت إلى ${delivered.length}`)}</h4><ul>{delivered.map((r) => <Row key={r.user_id} r={r} kind="delivered" />)}</ul></>}
            {waiting.length > 0 && <><h4>{t(`Remaining ${waiting.length}`, `المتبقّون ${waiting.length}`)}</h4><ul>{waiting.map((r) => <Row key={r.user_id} r={r} kind="sent" />)}</ul></>}
          </div>
        )}

        {data && (
          <dl className="mm-info__meta">
            <div><dt>{t('Sent', 'أُرسلت')}</dt><dd>{fmtFull(data.sent_at, t, locale)}</dd></div>
            {data.edited_at && <div><dt>{t('Edited', 'عُدّلت')}</dt><dd>{fmtFull(data.edited_at, t, locale)}</dd></div>}
          </dl>
        )}
        {data?.read_receipts_off && <p className="mm-info__muted">{t('Read receipts are off, so read times are hidden. Turn them on in chat privacy.', 'إشعارات القراءة مقفولة فمواعيد القراءة مخفية. فعّلها من خصوصية الشات.')}</p>}
        {data && !data.read_receipts_off && rec.some((r) => r.status === 'delivered') && !isGroup && <p className="mm-info__muted">{t('If the other person turned read receipts off, you only see Delivered.', 'لو الطرف التاني قافل إشعارات القراءة هتشوف "تم التسليم" بس.')}</p>}
      </section>
    </div>,
    host
  );
}

/* --------------------------------------------------------- starred messages */
export function StarredMessagesModal({ conversationId, onClose, onJump, onUnstar }) {
  const t = useT();
  const host = document.querySelector('.app-shell') || document.body;
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api.get(BASE + '/starred?conversation_id=' + conversationId).then((r) => setRows(r.data || [])).catch(() => setRows([]));
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [conversationId, onClose]);
  const { locale } = useLanguage();
  return createPortal(
    <div className="mm-info-back" onClick={onClose}>
      <section className="mm-info mm-starred" role="dialog" aria-modal="true" aria-label={t('Starred messages', 'الرسائل المميّزة')} onClick={(e) => e.stopPropagation()}>
        <header className="mm-info__head">
          <button type="button" className="mm-iconbtn" onClick={onClose} aria-label={t('Close', 'إغلاق')}><MIcon name="back" size={20} /></button>
          <h3>{t('Starred messages', 'الرسائل المميّزة')}</h3>
        </header>
        {rows === null && <p className="mm-info__muted">{t('Loading…', 'جارٍ التحميل…')}</p>}
        {rows && rows.length === 0 && (
          <div className="mm-empty"><MIcon name="star" size={34} /><p>{t('No starred messages. Right-click (or long-press) a message and choose Star.', 'لا توجد رسائل مميّزة. اضغط كليك يمين (أو ضغطة طويلة) على رسالة واختر "تمييز بنجمة".')}</p></div>
        )}
        <ul className="mm-starred__list">
          {(rows || []).map((r) => (
            <li key={r.id} className="mm-starred__row">
              <div className="mm-starred__main" onClick={() => { onClose(); onJump(r.id); }} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && (onClose(), onJump(r.id))}>
                <div className="mm-starred__top"><strong>{r.is_mine ? t('You', 'أنت') : r.sender_name}</strong><span>{fmtFull(r.created_at, t, locale)}</span></div>
                <p dir="auto">{r.body || (r.message_type === 'sticker' ? t('Sticker', 'ملصق') : r.message_type === 'gif' ? 'GIF' : t('Attachment', 'مرفق'))}</p>
              </div>
              <button type="button" className="mm-iconbtn" title={t('Unstar', 'إزالة النجمة')} aria-label={t('Unstar', 'إزالة النجمة')}
                onClick={async () => { await onUnstar(r); setRows((p) => p.filter((x) => x.id !== r.id)); }}>
                <MIcon name="star" size={18} filled />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>,
    host
  );
}
