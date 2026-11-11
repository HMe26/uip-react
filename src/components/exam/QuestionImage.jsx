import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../../context/LanguageContext';

/**
 * صورة السؤال التوضيحية (رسم / دايجرام ...). `url` هو image_url الراجع من الـ API.
 *
 * الوضع الافتراضي: بتتفتح بحجمها الكامل في تاب جديد بالضغط عليها.
 * `inline` (بيستخدمه الطالب وهو في الامتحان): من غير ما يفتح أي تاب أو نافذة —
 * الضغط بيفتح عارض داخل نفس الصفحة بزراير تكبير/تصغير/إعادة ضبط، زووم بعجلة
 * الماوس، سحب للتحريك، ودبل كليك. Esc أو X أو الضغط على الخلفية لقفل العارض فقط.
 */
export default function QuestionImage({ url, alt = '', maxHeight = 320, style, inline = false }) {
  const [open, setOpen] = useState(false);
  const { locale } = useLanguage();
  if (!url) return null;

  const imgStyle = { display: 'block', maxWidth: '100%', maxHeight, borderRadius: 10, border: '1px solid var(--border-subtle, var(--glass-border))', background: '#fff' };

  if (!inline) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', margin: '4px 0 8px', ...style }}>
        <img src={url} alt={alt} loading="lazy" style={imgStyle} />
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={alt || (locale === 'ar' ? 'تكبير الصورة' : 'Enlarge image')}
        style={{ display: 'inline-block', margin: '4px 0 8px', padding: 0, border: 0, background: 'none', cursor: 'zoom-in', ...style }}
      >
        <img src={url} alt={alt} loading="lazy" draggable={false} onDragStart={(e) => e.preventDefault()} style={imgStyle} />
      </button>
      {open && <ImageViewer url={url} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 6;
const STEP = 1.25;
const clamp = (v) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

function ImageViewer({ url, alt, onClose }) {
  const ar = useLanguage().locale === 'ar';
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);

  const zoomIn = useCallback(() => setScale((s) => clamp(s * STEP)), []);
  const zoomOut = useCallback(() => setScale((s) => clamp(s / STEP)), []);
  const reset = useCallback(() => { setScale(1); setPos({ x: 0, y: 0 }); }, []);

  useEffect(() => {
    const onKey = (e) => {
      // No stopPropagation on Esc: the exam page must still see it (it records
      // the press so a fullscreen exit caused by Esc is never a violation).
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut(); }
      else if (e.key === '0') { e.preventDefault(); reset(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose, zoomIn, zoomOut, reset]);

  const onWheel = (e) => setScale((s) => clamp(e.deltaY < 0 ? s * 1.1 : s / 1.1));
  const onPointerDown = (e) => {
    drag.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    setPos({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) });
  };
  const onPointerUp = () => { drag.current = null; setDragging(false); };

  const btn = { minWidth: 40, height: 40, padding: '0 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,.35)', background: 'rgba(255,255,255,.12)', color: '#fff', fontSize: 20, fontWeight: 700, cursor: 'pointer' };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'fixed', inset: 0, zIndex: 9990, background: 'rgba(8,10,20,.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', userSelect: 'none', WebkitUserSelect: 'none' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        dir="ltr"
        style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 2, display: 'flex', gap: 8, alignItems: 'center', padding: 8, borderRadius: 14, background: 'rgba(15,18,32,.85)' }}
      >
        <button type="button" style={btn} onClick={zoomOut} aria-label={ar ? 'تصغير' : 'Zoom out'}>−</button>
        <span style={{ color: '#fff', minWidth: 52, textAlign: 'center', fontWeight: 700, fontSize: 14 }}>{Math.round(scale * 100)}%</span>
        <button type="button" style={btn} onClick={zoomIn} aria-label={ar ? 'تكبير' : 'Zoom in'}>+</button>
        <button type="button" style={{ ...btn, fontSize: 14 }} onClick={reset}>100%</button>
        <button type="button" style={btn} onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}>✕</button>
      </div>
      <div
        onClick={(e) => e.stopPropagation()}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => (scale === 1 ? setScale(2.5) : reset())}
        style={{ touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab' }}
      >
        <img
          src={url}
          alt={alt}
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          style={{ display: 'block', maxWidth: '92vw', maxHeight: '84vh', background: '#fff', borderRadius: 8, transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`, transition: dragging ? 'none' : 'transform .08s ease-out', pointerEvents: 'none' }}
        />
      </div>
    </div>,
    document.body,
  );
}
