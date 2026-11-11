import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import EmojiPicker from '../messaging/EmojiPicker';
import { useTt } from './shared';
import '../../styles/css/chat-picker.css';

/** Inserts `emoji` at the caret of `el` (a textarea/input) and returns the new value, or null when it would pass `max`. */
export function insertAtCaret(el, value, emoji, max) {
  const a = el ? el.selectionStart ?? value.length : value.length;
  const b = el ? el.selectionEnd ?? value.length : value.length;
  const next = value.slice(0, a) + emoji + value.slice(b);
  if (max && next.length > max) return null;
  if (el) requestAnimationFrame(() => { el.focus(); const p = a + emoji.length; try { el.setSelectionRange(p, p); } catch { /* ignore */ } });
  return next;
}

const SmileIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.2 4.2 0 0 0 7 0" /><path d="M9 9.5h.01M15 9.5h.01" />
  </svg>
);

const POP_W = 340;
const POP_H = 340;
const GAP = 8;
const EDGE = 8;

/**
 * Emoji button + popover for the posts area (composer, comments, replies, bio) — same EmojiPicker the chat uses.
 * `onPick(emoji)` decides where it goes (usually insertAtCaret on the field's ref).
 *
 * The popover is rendered in a portal on <body> with position:fixed. The composer / cards use overflow:hidden|auto,
 * which used to clip an absolutely positioned popover (it looked like the button did nothing).
 */
export default function EmojiButton({ onPick, className = 'pp-icon', size = 18, up = false, disabled = false }) {
  const { tt, locale } = useTt();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const pop = useRef(null);
  const close = useCallback(() => setOpen(false), []);

  const place = useCallback(() => {
    const el = btn.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(POP_W, vw - EDGE * 2);
    const height = Math.min(POP_H, vh - EDGE * 2);
    const above = r.top - GAP - EDGE;
    const below = vh - r.bottom - GAP - EDGE;
    const wantUp = up ? above >= height || above >= below : !(below >= height || below >= above);
    const top = wantUp ? Math.max(EDGE, r.top - GAP - height) : Math.min(r.bottom + GAP, vh - EDGE - height);
    const rtl = getComputedStyle(el).direction === 'rtl';
    const left = Math.min(Math.max(EDGE, rtl ? r.left : r.right - width), vw - width - EDGE);
    setPos({ top, left, width, height });
  }, [up]);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return undefined; }
    place();
    const again = (e) => { if (pop.current && e?.target instanceof Node && pop.current.contains(e.target)) return; place(); };
    window.addEventListener('resize', again);
    window.addEventListener('scroll', again, true);
    return () => { window.removeEventListener('resize', again); window.removeEventListener('scroll', again, true); };
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => {
      if (btn.current?.contains(e.target) || pop.current?.contains(e.target)) return;
      close();
    };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true); };
  }, [open, close]);

  return (
    <span className="pp-emo">
      <button type="button" ref={btn} className={`${className}${open ? ' is-on' : ''}`} disabled={disabled} aria-expanded={open} aria-haspopup="dialog"
        title={tt('Emoji', 'إيموجي')} aria-label={tt('Emoji', 'إيموجي')} onClick={() => setOpen((o) => !o)}>
        <SmileIcon size={size} />
      </button>
      {open && pos && createPortal(
        <div ref={pop} className="pp-emo__pop" role="dialog" aria-label={tt('Emoji', 'إيموجي')}
          style={{ top: pos.top, left: pos.left, width: pos.width, height: pos.height }}>
          <EmojiPicker ar={(locale || document.documentElement.lang) === 'ar'} top autoFocus onPick={onPick} onClose={close} />
        </div>,
        document.body,
      )}
    </span>
  );
}
