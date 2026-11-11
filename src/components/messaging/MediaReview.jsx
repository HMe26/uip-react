import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isEditableMedia } from './MediaEditorModal';
import '../../styles/css/attach-sheet.css';

/**
 * Review screen for SEVERAL photos / videos picked together (WhatsApp style): big preview, a strip of every pick,
 * edit (crop / draw / trim - the existing MediaEditorModal) and remove per item, one caption, one Send for all.
 * A single pick still goes straight to the editor. Nothing is uploaded here: Send hands the pending files to the
 * normal upload flow, which shows the bubble at once and shrinks / uploads them in parallel.
 */
const ico = (d, s = 22) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const I = {
  close: ico(<path d="M6 6l12 12M18 6 6 18" />),
  edit: ico(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>),
  trash: ico(<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>),
  plus: ico(<path d="M12 5v14M5 12h14" />, 24),
  send: ico(<path d="m4 12 16-8-6 16-2.5-6.5z" />, 22),
  play: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" /></svg>,
};

export default function MediaReview({ ar, files, caption, setCaption, canHd, hd, setHd, paused, onClose, onRemove, onEdit, onAddMore, onSend }) {
  const t = (en, a) => (ar ? a : en);
  const media = files.map((pf, i) => ({ pf, i })).filter(({ pf }) => /^(image|video)\//.test(pf.file.type || '') && pf.previewUrl);
  const [cur, setCur] = useState(0);
  const idx = Math.min(cur, Math.max(0, media.length - 1));
  const item = media[idx];
  const strip = useRef(null);
  const touch = useRef(null);

  useEffect(() => { if (cur > media.length - 1) setCur(Math.max(0, media.length - 1)); }, [media.length, cur]);
  useEffect(() => { // keep the picked thumbnail in view
    const el = strip.current?.children?.[idx];
    el?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [idx]);
  useEffect(() => {
    const key = (e) => {
      if (paused || e.target instanceof HTMLInputElement) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setCur((c) => Math.min(media.length - 1, c + (ar ? -1 : 1)));
      else if (e.key === 'ArrowLeft') setCur((c) => Math.min(media.length - 1, c + (ar ? 1 : -1)));
    };
    document.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = prev; };
  }, [onClose, media.length, ar, paused]);
  useEffect(() => { if (!media.length) onClose(); }, [media.length, onClose]);

  if (!item) return null;
  const isVid = (item.pf.file.type || '').startsWith('video/');
  const go = (d) => setCur((c) => Math.max(0, Math.min(media.length - 1, c + d)));
  const swipeEnd = (e) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current;
    touch.current = null;
    if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
  };

  return createPortal(
    <div className="mr-overlay" dir={ar ? 'rtl' : 'ltr'} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <header className="mr-top">
        <button type="button" className="mr-ib" onClick={onClose} aria-label={t('Close', 'إغلاق')}>{I.close}</button>
        <span className="mr-count">{idx + 1} / {media.length}</span>
        <span className="mr-fill" />
        {canHd && <button type="button" className={`ags-hd mr-hd${hd ? ' is-on' : ''}`} aria-pressed={hd} onClick={() => setHd(!hd)}>HD</button>}
        {isEditableMedia(item.pf.file) && (
          <button type="button" className="mr-ib" onClick={() => onEdit(item.i)} aria-label={t('Edit', 'تعديل')} title={t('Edit', 'تعديل')}>{I.edit}</button>
        )}
        <button type="button" className="mr-ib" onClick={() => onRemove(item.i)} aria-label={t('Remove', 'حذف')} title={t('Remove', 'حذف')}>{I.trash}</button>
      </header>

      <div className="mr-stage" onTouchStart={(e) => { touch.current = e.touches[0].clientX; }} onTouchEnd={swipeEnd}>
        {isVid
          ? <video key={item.pf.previewUrl} src={item.pf.previewUrl} controls playsInline preload="metadata" />
          : <img key={item.pf.previewUrl} src={item.pf.previewUrl} alt="" draggable="false" />}
      </div>

      <footer className="mr-bottom">
        <div className="mr-strip" ref={strip}>
          {media.map(({ pf, i }, k) => (
            <button key={`${pf.file.name}-${pf.file.size}-${i}`} type="button" className={`mr-th${k === idx ? ' is-cur' : ''}`} onClick={() => setCur(k)} aria-label={`${k + 1}`}>
              {(pf.file.type || '').startsWith('video/')
                ? <><video src={pf.previewUrl} preload="metadata" muted playsInline /><span className="mr-th__play">{I.play}</span></>
                : <img src={pf.previewUrl} alt="" draggable="false" />}
            </button>
          ))}
          <button type="button" className="mr-th mr-th--add" onClick={onAddMore} aria-label={t('Add more', 'إضافة المزيد')}>{I.plus}</button>
        </div>
        <div className="mr-send">
          <input
            className="mr-cap"
            dir="auto"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
            placeholder={t('Add a caption…', 'أضف تعليق…')}
            enterKeyHint="send"
          />
          <button type="button" className="mr-go" onClick={onSend} aria-label={t('Send', 'إرسال')}>
            <span className="mr-go__ico">{I.send}</span>
            <span className="mr-go__n">{media.length}</span>
          </button>
        </div>
      </footer>
    </div>,
    document.body,
  );
}
