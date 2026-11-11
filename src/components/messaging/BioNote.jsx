import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import EmojiPicker from './EmojiPicker';
import { useLanguage } from '../../context/LanguageContext';
import '../../styles/css/messaging-bio.css';

/**
 * Bio notes: a short line (emoji welcome) shown in a speech bubble hanging under the chat header, pointing at the
 * contact's photo, in the design its owner picked.
 *   BioBubble      – the bubble itself (header, contact info, live preview)
 *   HeaderBio      – WhatsApp-style note: a bubble hanging right under the chat header beside the contact's photo (two small
 *                    dots lead up to the photo); it comes and goes, tap to tuck it away (your own note: tap to edit)
 *   BioEditor      – text + emoji picker + quick statuses + counter + design picker + live preview + save
 * Style ids must match ChatSettingsService::BIO_STYLES on the server.
 */

export const BIO_STYLES = [
  { id: 'classic', en: 'Classic', ar: 'كلاسيك' },
  { id: 'mint', en: 'Mint', ar: 'نعناع' },
  { id: 'sunset', en: 'Sunset', ar: 'غروب' },
  { id: 'ocean', en: 'Ocean', ar: 'محيط' },
  { id: 'lavender', en: 'Lavender', ar: 'لافندر' },
  { id: 'night', en: 'Night', ar: 'ليل' },
  { id: 'glass', en: 'Glass', ar: 'زجاج' },
  { id: 'spark', en: 'Spark', ar: 'لمعان' },
];
export const bioStyleId = (id) => (BIO_STYLES.some((s) => s.id === id) ? id : 'classic');
const cpLen = (s) => Array.from(s || '').length;
// a note that is only a few emoji (no letters / digits) is shown larger and compact
const isEmojiOnly = (s) => { const x = String(s || '').replace(/\s/g, ''); return !!x && cpLen(x) <= 6 && !/[\p{L}\p{N}]/u.test(x); };

const PRESETS = [
  { en: '📚 Studying', ar: '📚 بذاكر' },
  { en: '🎯 Focused', ar: '🎯 مركّز' },
  { en: '☕ Available', ar: '☕ متاح' },
  { en: '🌙 Busy', ar: '🌙 مشغول' },
  { en: '✈️ Away', ar: '✈️ مسافر' },
  { en: '💻 Coding', ar: '💻 بكتب كود' },
];

const useT = () => {
  const { locale } = useLanguage();
  return (en, ar) => (locale === 'ar' ? ar : en);
};

export function BioBubble({ text, styleId, className = '', tail = true, children, ...rest }) {
  return (
    <div className={`bio-b bio-b--${bioStyleId(styleId)}${tail ? ' has-tail' : ''} ${className}`} {...rest}>
      <span className="bio-b__text" dir="auto">{text}</span>
      {children}
    </div>
  );
}


export function HeaderBio({ conversationId, text, styleId, own, onEdit }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  const [pos, setPos] = useState({ start: 52, size: 40, inHdr: false, hStart: 0, hMax: 0, hTop: 0 }); // where the contact's photo sits (distance from the inline-start edge)
  const boxRef = useRef(null);

  // The note comes and goes: it fades in, stays long enough to read, fades out, and returns after a pause.
  useEffect(() => {
    if (!text) { setShown(false); return undefined; }
    const visibleMs = Math.min(12000, 5000 + cpLen(text) * 70);
    const hiddenMs = 20000;
    let timer;
    let cancelled = false;
    const step = (visible) => {
      if (cancelled) return;
      setShown(visible);
      timer = setTimeout(() => step(!visible), visible ? visibleMs : hiddenMs);
    };
    timer = setTimeout(() => step(true), 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [conversationId, text, styleId]);

  // line the bubble up under the photo, whatever the screen size / language direction
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const measure = () => {
      const av = box.parentElement?.querySelector('.msg-thread__peer .msg-avatar');
      if (!av) return;
      const b = box.getBoundingClientRect();
      const r = av.getBoundingClientRect();
      if (!b.width || !r.width) return;
      const rtl = getComputedStyle(box).direction === 'rtl';
      const start = Math.round(rtl ? b.right - r.right : r.left - b.left);
      const size = Math.round(r.width);
      // free space in the header between the name and the header buttons: the note lives there when it is wide enough
      let inHdr = false; let hStart = 0; let hMax = 0; let hTop = 0;
      const hdr = box.previousElementSibling;
      const meta = hdr?.querySelector('.msg-thread__peer-meta');
      const acts = hdr?.querySelector('.msg-thread__header-actions');
      if (hdr && meta && acts) {
        const m = meta.getBoundingClientRect();
        const a = acts.getBoundingClientRect();
        const h = hdr.getBoundingClientRect();
        // the name block stretches (flex:1), so measure the text itself: the furthest inline-end edge of its lines
        let textEnd = null;
        Array.from(meta.children).forEach((c) => {
          const rg = document.createRange();
          rg.selectNodeContents(c);
          const q = rg.getBoundingClientRect();
          if (!q.width) return;
          const e = rtl ? q.left : q.right;
          textEnd = textEnd == null ? e : (rtl ? Math.min(textEnd, e) : Math.max(textEnd, e));
        });
        if (textEnd == null) textEnd = rtl ? m.right : m.left;
        const gapStart = textEnd;
        const gapEnd = rtl ? a.right : a.left;
        const avail = Math.round(rtl ? gapStart - gapEnd : gapEnd - gapStart) - 28;
        if (avail >= 150) {
          inHdr = true;
          hStart = Math.round(rtl ? b.right - gapStart : gapStart - b.left) + 14;
          hMax = Math.min(avail, 340);
          hTop = Math.round(h.top + h.height / 2 - b.top);
        }
      }
      setPos((p) => (p.start === start && p.size === size && p.inHdr === inHdr && p.hStart === hStart && p.hMax === hMax && p.hTop === hTop ? p : { start, size, inHdr, hStart, hMax, hTop }));
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(box);
    return () => { window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, [conversationId, shown, text]);

  if (!text) return null;
  const editable = !!(own && onEdit);
  const act = editable ? () => onEdit() : () => setShown(false);
  return (
    <div className={`bio-float${pos.inHdr ? ' is-inhdr' : ''}`} ref={boxRef}
      style={{ '--bio-start': `${pos.start}px`, '--bio-av': `${pos.size}px`, ...(pos.inHdr ? { '--bio-hstart': `${pos.hStart}px`, '--bio-hmax': `${pos.hMax}px`, '--bio-htop': `${pos.hTop}px` } : {}) }}>
      <div className={`bio-hdr${shown ? ' is-in' : ''}`} role="note" aria-hidden={!shown} aria-label={t('Bio', 'البايو')}>
        <div className="bio-hdr__row">
          <BioBubble text={text} styleId={styleId} tail={false} className={`bio-hdr__bubble${isEmojiOnly(text) ? ' is-emoji' : ''}`}
            onClick={act} title={editable ? t('Tap to edit', 'اضغط للتعديل') : t('Tap to hide', 'اضغط للإخفاء')}
            {...(editable ? { role: 'button', tabIndex: shown ? 0 : -1, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(); } } } : {})}>
            {editable ? (
              <svg className="bio-b__pen" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
            ) : null}
            <i className="bio-dot bio-dot--a" aria-hidden="true" />
            <i className="bio-dot bio-dot--b" aria-hidden="true" />
          </BioBubble>
        </div>
      </div>
    </div>
  );
}

export function BioStylePicker({ value, onChange, sample }) {
  const t = useT();
  const { locale } = useLanguage();
  return (
    <div className="bio-picker" role="radiogroup" aria-label={t('Bio design', 'تصميم البايو')}>
      {BIO_STYLES.map((s) => (
        <button key={s.id} type="button" role="radio" aria-checked={value === s.id}
          className={`bio-picker__item${value === s.id ? ' is-on' : ''}`} onClick={() => onChange(s.id)}>
          <BioBubble text={sample} styleId={s.id} className="bio-b--mini" tail={false} />
          <span>{locale === 'ar' ? s.ar : s.en}</span>
        </button>
      ))}
    </div>
  );
}

export function BioEditor({ settings, save }) {
  const t = useT();
  const { locale } = useLanguage();
  const max = settings.bio_max || 190;
  const [text, setText] = useState(settings.bio || '');
  const [style, setStyle] = useState(bioStyleId(settings.bio_style));
  const [emoji, setEmoji] = useState(false);
  const [busy, setBusy] = useState(false);
  const taRef = useRef(null);
  const loaded = useRef({ bio: settings.bio, style: settings.bio_style });

  // the saved bio / design arrive after the first render: adopt them unless the person already edited
  useEffect(() => {
    if (settings.bio !== loaded.current.bio && text === (loaded.current.bio || '')) setText(settings.bio || '');
    if (settings.bio_style !== loaded.current.style && style === bioStyleId(loaded.current.style)) setStyle(bioStyleId(settings.bio_style));
    loaded.current = { bio: settings.bio, style: settings.bio_style };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.bio, settings.bio_style]);

  const dirty = text.trim() !== (settings.bio || '') || style !== bioStyleId(settings.bio_style);
  const len = cpLen(text);
  const onChange = (e) => { const v = e.target.value.replace(/\s*\n+\s*/g, ' '); if (cpLen(v) <= max) setText(v); };
  const insert = (e) => {
    const el = taRef.current;
    const a = el ? el.selectionStart : text.length;
    const b = el ? el.selectionEnd : text.length;
    const next = text.slice(0, a) + e + text.slice(b);
    if (cpLen(next) > max) return;
    setText(next);
    requestAnimationFrame(() => { if (el) { el.focus(); const pos = a + e.length; el.setSelectionRange(pos, pos); } });
  };
  const submit = async () => {
    setBusy(true);
    try { await save({ bio: text.trim(), bio_style: style }); } finally { setBusy(false); }
  };
  const sample = text.trim() || t('Your note shows here ✨', 'ملاحظتك هتظهر هنا ✨');

  return (
    <div className="bio-ed">
      <div className="bio-ed__preview" aria-live="polite">
        <span className="bio-ed__label">{t('Preview', 'معاينة')}</span>
        <BioBubble text={sample} styleId={style} />
      </div>

      <div className="bio-ed__field">
        <textarea ref={taRef} className="msg-input" rows={2} value={text} onChange={onChange}
          placeholder={t('e.g. Software engineering student 🚀 always learning', 'مثال: طالب هندسة برمجيات 🚀 دايمًا بتعلم')} dir="auto" />
        <button type="button" className={`bio-ed__emoji${emoji ? ' is-on' : ''}`} onClick={() => setEmoji((o) => !o)} aria-expanded={emoji} aria-label={t('Emoji', 'إيموجي')}>😊</button>
      </div>
      {emoji && <div className="bio-ed__picker"><EmojiPicker ar={locale === 'ar'} onClose={() => setEmoji(false)} onPick={insert} /></div>}

      <div className="bio-ed__presets">
        {PRESETS.map((p) => (
          <button key={p.en} type="button" className="bio-ed__chip" onClick={() => setText(locale === 'ar' ? p.ar : p.en)}>{locale === 'ar' ? p.ar : p.en}</button>
        ))}
      </div>

      <h4 className="bio-ed__h">{t('Choose a design', 'اختار التصميم')}</h4>
      <BioStylePicker value={style} onChange={setStyle} sample={text.trim() || '✨'} />

      <div className="bio-ed__foot">
        <span className={`cs-count${len >= max ? ' is-max' : ''}`}>{len}/{max}</span>
        {text && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setText('')}>{t('Clear', 'مسح')}</button>}
        <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || busy} onClick={submit}>{busy ? t('Saving…', 'جارٍ الحفظ…') : t('Save', 'حفظ')}</button>
      </div>
    </div>
  );
}
