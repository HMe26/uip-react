import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import MsgIcon from './msgIcons';
import { Avatar } from './ConversationRail';
import { Modal } from './modals';
import { fmtTime } from './format';
import { parseServerDate } from '../../utils/serverDate';
import { useLanguage } from '../../context/LanguageContext';

/**
 * Pinned messages, WhatsApp-style and a bit better:
 *   PinDurationModal      – "Choose how long your pin lasts": 24 hours · 7 days · 30 days · Until I unpin (forever)
 *   PinnedBar             – bar under the header: segmented indicator, preview, "n of N", time left, jump / list / unpin
 *   PinnedMessagesModal   – full list with time left and an unpin button per message
 * Expiry is decided by the server (`pinned_until`, null = forever); the time left here is display only.
 */

export const PIN_DURATIONS = [
  { key: '24h', en: '24 hours', ar: '٢٤ ساعة', hintEn: 'Good for today’s plans', hintAr: 'مناسبة لخطط اليوم' },
  { key: '7d', en: '7 days', ar: '٧ أيام', hintEn: 'A week of reminders', hintAr: 'تذكير لمدة أسبوع' },
  { key: '30d', en: '30 days', ar: '٣٠ يومًا', hintEn: 'For things that stay relevant', hintAr: 'لحاجات هتفضل مهمة' },
  { key: 'forever', en: 'Until I unpin', ar: 'للأبد حتى ألغي التثبيت', hintEn: 'Never expires', hintAr: 'لا تنتهي أبدًا', icon: 'infinity' },
];
const LAST_KEY = 'uip_pin_duration';
const readLast = () => {
  try { const v = localStorage.getItem(LAST_KEY); return PIN_DURATIONS.some((d) => d.key === v) ? v : '7d'; } catch { return '7d'; }
};

const useT = () => {
  const { locale } = useLanguage();
  return (en, ar) => (locale === 'ar' ? ar : en);
};

/** "6 days left" / "5 h left" / "12 min left" — null for pins that never expire. */
export function pinTimeLeft(until, t, now = Date.now()) {
  if (!until) return null;
  const ms = parseServerDate(until).getTime() - now;
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return t('Expiring…', 'تنتهي الآن');
  const min = Math.ceil(ms / 60000);
  if (min < 60) return t(`${min} min left`, `باقي ${min} د`);
  const h = Math.ceil(ms / 3600000);
  if (h < 24) return t(`${h} h left`, `باقي ${h} س`);
  const d = Math.ceil(ms / 86400000);
  return d === 1 ? t('1 day left', 'باقي يوم') : t(`${d} days left`, `باقي ${d} أيام`);
}

/** One-line preview of a message (text, or a label for media / polls). */
export function pinPreview(m, t) {
  if (m.body && String(m.body).trim()) return String(m.body).replace(/\s+/g, ' ').trim();
  const a = (m.attachments || [])[0];
  if (a) {
    if (a.kind === 'image') return t('Photo', 'صورة');
    if (a.kind === 'video') return t('Video', 'فيديو');
    if (a.kind === 'audio') return t('Voice message', 'رسالة صوتية');
    return a.original_name || t('File', 'ملف');
  }
  if (m.message_type === 'poll') return t('Poll', 'استطلاع');
  if (m.message_type === 'location') return t('Location', 'موقع');
  return t('Message', 'رسالة');
}

/* ------------------------------------------------------------------ duration picker */
export function PinDurationModal({ message, busy, onClose, onConfirm }) {
  const t = useT();
  const [choice, setChoice] = useState(readLast);
  const backdropRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const confirm = () => {
    try { localStorage.setItem(LAST_KEY, choice); } catch { /* remembering is optional */ }
    onConfirm(choice);
  };

  return (
    <div className="msg-modal-backdrop" ref={backdropRef} onClick={(e) => e.target === backdropRef.current && onClose()}>
      <div className="pin-dlg" role="dialog" aria-modal="true" aria-labelledby="pin-dlg-title">
        <div className="pin-dlg__icon"><MsgIcon name="pin" size={22} /></div>
        <h3 id="pin-dlg-title">{t('Choose how long your pin lasts', 'اختر مدة التثبيت')}</h3>
        <p className="pin-dlg__sub">{t('You can unpin at any time.', 'تقدر تلغي التثبيت في أي وقت.')}</p>

        {message && (
          <div className="pin-dlg__msg">
            <strong>{message.sender_name}</strong>
            <span>{pinPreview(message, t)}</span>
          </div>
        )}

        <div className="pin-dlg__opts" role="radiogroup">
          {PIN_DURATIONS.map((d) => (
            <button
              type="button" role="radio" aria-checked={choice === d.key} key={d.key}
              className={`pin-opt${choice === d.key ? ' is-on' : ''}`} onClick={() => setChoice(d.key)}
              onDoubleClick={confirm}
            >
              <span className="pin-opt__radio" />
              <span className="pin-opt__text">
                <strong>{t(d.en, d.ar)}</strong>
                <small>{t(d.hintEn, d.hintAr)}</small>
              </span>
              {d.icon && <Icon name={d.icon} size={18} className="pin-opt__ico" />}
            </button>
          ))}
        </div>

        <div className="pin-dlg__foot">
          <button type="button" className="pin-btn pin-btn--ghost" onClick={onClose} disabled={busy}>{t('Cancel', 'إلغاء')}</button>
          <button type="button" className="pin-btn pin-btn--solid" onClick={confirm} disabled={busy}>
            <MsgIcon name="pin" size={14} /> {t('Pin', 'تثبيت')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ bar under the header */
export function PinnedBar({ pinned, onGo, onOpenList, onUnpin }) {
  const t = useT();
  const [idx, setIdx] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const count = pinned.length;

  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(h);
  }, []);
  useEffect(() => { if (idx >= count) setIdx(0); }, [count, idx]);
  if (count === 0) return null;

  const cur = pinned[Math.min(idx, count - 1)];
  const left = pinTimeLeft(cur.pinned_until, t, now);
  // like WhatsApp: tapping jumps to the message, and the bar moves on to the next pin
  const go = () => { onGo(cur.id); if (count > 1) setIdx((i) => (i + 1) % count); };

  return (
    <div className="pinbar" role="region" aria-label={t('Pinned messages', 'الرسائل المثبّتة')}>
      <div className="pinbar__seg" aria-hidden="true">
        {pinned.slice(0, 4).map((p, i) => <i key={p.id} className={i === idx % 4 ? 'is-on' : ''} />)}
      </div>
      <button type="button" className="pinbar__main" onClick={go}>
        <span className="pinbar__label">
          <MsgIcon name="pin" size={12} />
          <span className="pinbar__lt">{count > 1 ? t(`Pinned message ${idx + 1} of ${count}`, `رسالة مثبّتة ${idx + 1} من ${count}`) : t('Pinned message', 'رسالة مثبّتة')}</span>
          {count > 1 && <span className="pinbar__n">{idx + 1}/{count}</span>}
          {left ? <em>{left}</em> : <em className="is-forever"><Icon name="infinity" size={11} /> {t('Always', 'دائمة')}</em>}
        </span>
        <span className="pinbar__text"><b>{cur.sender_name}:</b> {pinPreview(cur, t)}</span>
      </button>
      <div className="pinbar__actions">
        <button type="button" className="pinbar__btn" onClick={onOpenList} title={t('All pinned messages', 'كل المثبّتات')} aria-label={t('All pinned messages', 'كل المثبّتات')}>
          <Icon name="list-checks" size={16} />{count > 1 && <span>{count}</span>}
        </button>
        <button type="button" className="pinbar__btn" onClick={() => onUnpin(cur)} title={t('Unpin', 'إلغاء التثبيت')} aria-label={t('Unpin', 'إلغاء التثبيت')}>
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ full list */
export function PinnedMessagesModal({ pinned, onClose, onGoToMessage, onUnpin }) {
  const t = useT();
  const now = Date.now();
  return (
    <Modal title={`${t('Pinned messages', 'الرسائل المثبّتة')}${pinned.length ? ` (${pinned.length})` : ''}`} onClose={onClose}>
      {pinned.length === 0 ? (
        <div className="pin-empty">
          <span><MsgIcon name="pin" size={22} /></span>
          <strong>{t('No pinned messages yet', 'لا توجد رسائل مثبّتة بعد')}</strong>
          <small>{t('Pin an important message to keep it one tap away.', 'ثبّت رسالة مهمة عشان توصلها بضغطة واحدة.')}</small>
        </div>
      ) : (
        <ul className="pin-list">
          {pinned.map((m) => {
            const left = pinTimeLeft(m.pinned_until, t, now);
            return (
              <li key={m.id} className="pin-item">
                <button type="button" className="pin-item__main" onClick={() => onGoToMessage(m.id)}>
                  <Avatar name={m.sender_name} size="sm" src={m.sender_avatar} />
                  <span className="pin-item__body">
                    <span className="pin-item__top">
                      <strong>{m.sender_name}</strong>
                      <time>{fmtTime(m.created_at)}</time>
                    </span>
                    <span className="pin-item__text">{pinPreview(m, t)}</span>
                    <span className="pin-item__meta">
                      <span className={`pin-chip${left ? '' : ' is-forever'}`}>
                        <Icon name={left ? 'clock' : 'infinity'} size={11} /> {left || t('Until unpinned', 'حتى إلغاء التثبيت')}
                      </span>
                      {m.pinned_by_name && <span>{t('by', 'بواسطة')} {m.pinned_by_name}</span>}
                    </span>
                  </span>
                </button>
                <button type="button" className="pin-item__un" onClick={() => onUnpin(m)} title={t('Unpin', 'إلغاء التثبيت')} aria-label={t('Unpin', 'إلغاء التثبيت')}>
                  <Icon name="x" size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
