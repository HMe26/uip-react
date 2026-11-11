import { useEffect, useRef, useState } from 'react';
import '../../styles/css/chat-picker.css';
import AttachSheet from './AttachSheet';
import { hasDeviceGallery } from '../../lib/deviceGallery';

/**
 * WhatsApp-style attachment menu: Document / Photos & videos / Camera / Audio / Poll / Location / New sticker.
 * Desktop: a compact popover list above the composer. Phones: a bottom sheet with big round icons.
 * Only offers what the conversation allows (`can…` flags); new actions are optional so other callers keep working.
 */
const svg = (d) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const ICONS = {
  doc: svg(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>),
  media: svg(<><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5-5-8 8" /></>),
  camera: svg(<><path d="M4 8h3l2-2h6l2 2h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>),
  audio: svg(<><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="3" y="14" width="4" height="6" rx="1.5" /><rect x="17" y="14" width="4" height="6" rx="1.5" /></>),
  poll: svg(<><path d="M5 20V10M12 20V4M19 20v-7" /></>),
  pin: svg(<><path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>),
  sticker: svg(<><path d="M20 12.5V7a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h5.5z" /><path d="M20 12.5a7.5 7.5 0 0 1-7.5 7.5v-3a4.5 4.5 0 0 1 4.5-4.5z" /></>),
};

function Item({ color, icon, label, onClick, delay }) {
  return (
    <button type="button" role="menuitem" className="att-item" style={{ '--att-c': color, '--att-d': `${delay}ms` }} onClick={onClick}>
      <span className="att-item__icon" aria-hidden="true">{icon}</span>
      <span className="att-item__label">{label}</span>
    </button>
  );
}

export default function AttachMenu({
  ar, canFiles, canMedia, canPoll, canLocation, canAudio, canSticker,
  onPickFiles, onPickMedia, onPickCamera, onPickAudio, onPoll, onLocation, onNewSticker, onGalleryFiles, title,
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  // phones get the WhatsApp-style bottom sheet (actions + gallery); desktop keeps the compact popover
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 760px)').matches);
  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 760px)');
    if (!mq) return undefined;
    const on = () => setPhone(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  useEffect(() => {
    if (!open || phone) return undefined;
    const away = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away, { passive: true });
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('touchstart', away); document.removeEventListener('keydown', esc); };
  }, [open, phone]);

  // phone browser: no gallery access for websites, so the paperclip opens the system photo picker straight away
  // (albums + multi-select) and the "+" button keeps the other actions
  const direct = phone && !!canMedia && !hasDeviceGallery();
  const run = (fn) => () => { setOpen(false); fn?.(); };
  const items = [
    canFiles && { k: 'doc', color: '#7f66ff', icon: ICONS.doc, label: ar ? 'مستند' : 'Document', fn: onPickFiles },
    canMedia && { k: 'media', color: '#1d8bf1', icon: ICONS.media, label: ar ? 'صور وفيديو' : 'Photos & videos', fn: onPickMedia },
    canMedia && { k: 'camera', color: '#e53e6b', icon: ICONS.camera, label: ar ? 'الكاميرا' : 'Camera', fn: onPickCamera },
    canAudio && onPickAudio && { k: 'audio', color: '#f2672a', icon: ICONS.audio, label: ar ? 'صوت' : 'Audio', fn: onPickAudio },
    canPoll && { k: 'poll', color: '#f5a60b', icon: ICONS.poll, label: ar ? 'استطلاع' : 'Poll', fn: onPoll },
    canLocation && { k: 'loc', color: '#0ea5a4', icon: ICONS.pin, label: ar ? 'الموقع' : 'Location', fn: onLocation },
    canSticker && onNewSticker && { k: 'stk', color: '#19b57a', icon: ICONS.sticker, label: ar ? 'ستيكر جديد' : 'New sticker', fn: onNewSticker, divider: true },
  ].filter(Boolean);

  return (
    <div className="att-wrap" ref={wrap}>
      {direct && (
        <button type="button" className="msg-icon-btn" title={ar ? 'صور وفيديو' : 'Photos & videos'} aria-label={ar ? 'صور وفيديو' : 'Photos & videos'} onClick={() => onPickMedia?.()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21 11-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8L13.2 3.2a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" /></svg>
        </button>
      )}
      <button type="button" className={`msg-icon-btn${open ? ' is-active' : ''}`} title={title} aria-label={title} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(45deg)' : 'none', transition: 'transform .18s' }}><path d="M12 5v14M5 12h14" /></svg>
      </button>
      {open && phone && (
        <AttachSheet
          ar={ar}
          canMedia={!!canMedia && !direct}
          actions={items.filter((it) => it.k !== 'media' && (direct || it.k !== 'camera')).map((it) => ({ k: it.k, color: it.color, icon: it.icon, label: it.label, run: run(it.fn) }))}
          onClose={() => setOpen(false)}
          onCamera={run(onPickCamera)}
          onSystemPicker={run(onPickMedia)}
          onGalleryFiles={(files, opts) => { setOpen(false); onGalleryFiles?.(files, opts); }}
        />
      )}
      {open && !phone && (
        <>
          <div className="att-scrim" aria-hidden="true" />
          <div className="att-menu" role="menu">
            {items.map((it, i) => (
              <span key={it.k} className={`att-slot${it.divider ? ' has-divider' : ''}`}>
                <Item color={it.color} icon={it.icon} label={it.label} delay={i * 22} onClick={run(it.fn)} />
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
