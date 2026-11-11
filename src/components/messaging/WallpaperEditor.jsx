import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../../context/LanguageContext';
import { cleanWallStyle, wallStyleVars, DEFAULT_WALL_STYLE } from '../../lib/wallStyle';

/**
 * Preview + adjust a chat-background photo BEFORE it is used: fill the chat (crop) / show the whole photo / fit the width,
 * drag to choose which part stays in view, pick the colour behind it. The frame has the same proportions as the real chat area.
 *   src      image URL (object URL of the picked file, or the saved photo)
 *   initial  starting style
 *   onSave(style)  onCancel()
 */
const SWATCHES = ['', '#000000', '#0b1020', '#1e293b', '#f1f5f9', '#ffffff'];

export default function WallpaperEditor({ src, initial, onSave, onCancel, busy = false }) {
  const { locale } = useLanguage();
  const t = (en, ar) => (locale === 'ar' ? ar : en);
  const [style, setStyle] = useState(() => cleanWallStyle(initial || DEFAULT_WALL_STYLE));
  const [nat, setNat] = useState(null); // natural size of the photo
  const drag = useRef(null);

  // frame with the chat area's real proportions (falls back to the window's)
  const frame = useMemo(() => {
    const el = typeof document !== 'undefined' ? document.querySelector('.msg-app .msg-thread') : null;
    const r = el ? el.getBoundingClientRect() : null;
    const aw = r && r.width > 80 ? r.width : window.innerWidth;
    const ah = r && r.height > 80 ? r.height : window.innerHeight;
    const maxW = Math.min(420, window.innerWidth - 48);
    const maxH = Math.max(220, Math.min(460, window.innerHeight - 330));
    const k = Math.min(maxW / aw, maxH / ah);
    return { w: Math.round(aw * k), h: Math.round(ah * k) };
  }, []);

  useEffect(() => {
    let alive = true;
    const i = new Image();
    i.onload = () => { if (alive) setNat({ w: i.naturalWidth, h: i.naturalHeight }); };
    i.src = src;
    return () => { alive = false; };
  }, [src]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const scale = () => {
    if (!nat) return 1;
    if (style.fit === 'contain') return Math.min(frame.w / nat.w, frame.h / nat.h);
    if (style.fit === 'width') return frame.w / nat.w;
    return Math.max(frame.w / nat.w, frame.h / nat.h);
  };
  const freeX = nat ? frame.w - nat.w * scale() : 0;
  const freeY = nat ? frame.h - nat.h * scale() : 0;
  const movable = Math.abs(freeX) > 1 || Math.abs(freeY) > 1;

  const onDown = (e) => {
    if (!movable) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: style.x, y: style.y };
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const nx = Math.abs(freeX) > 1 ? d.x + ((e.clientX - d.px) / freeX) * 100 : d.x;
    const ny = Math.abs(freeY) > 1 ? d.y + ((e.clientY - d.py) / freeY) * 100 : d.y;
    setStyle((s) => cleanWallStyle({ ...s, x: nx, y: ny }));
  };
  const onUp = () => { drag.current = null; };

  const fits = [
    ['cover', t('Fill', 'تغطية'), t('Fills the chat, edges may be cropped', 'تملا الشات وممكن الأطراف تتقص')],
    ['contain', t('Whole photo', 'الصورة كاملة'), t('Nothing is cropped', 'من غير أي قص')],
    ['width', t('Fit width', 'على العرض'), t('Full width, move up / down', 'العرض كامل وتحرّكها فوق/تحت')],
  ];

  const ui = (
    <div className="wpe" role="dialog" aria-modal="true" aria-label={t('Adjust background', 'ضبط الخلفية')} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div className="wpe__card">
        <h3 className="wpe__title">{t('Preview the background', 'معاينة الخلفية')}</h3>
        <div
          className={`wpe__frame${movable ? ' is-movable' : ''}`}
          style={{ width: frame.w, height: frame.h, ...wallStyleVars(style), '--msg-wall-img': `url("${src}")` }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        >
          <div className="wpe__bubbles" aria-hidden="true">
            <span className="wpe__b wpe__b--in">{t('Hi! 👋', 'أهلاً! 👋')}</span>
            <span className="wpe__b wpe__b--out">{t('This is how it will look', 'كده هتظهر الخلفية')}</span>
          </div>
          {!nat && <span className="wpe__loading">…</span>}
        </div>
        {movable && <p className="wpe__hint">{t('Drag the photo to choose which part stays in view.', 'اسحب الصورة عشان تختار الجزء اللي يفضل ظاهر.')}</p>}

        <div className="wpe__seg" role="radiogroup" aria-label={t('Photo fit', 'طريقة العرض')}>
          {fits.map(([id, label, tip]) => (
            <button key={id} type="button" role="radio" aria-checked={style.fit === id} title={tip}
              className={style.fit === id ? 'is-on' : ''} onClick={() => setStyle((s) => cleanWallStyle({ ...s, fit: id, x: 50, y: 50 }))}>
              {label}
            </button>
          ))}
        </div>

        {style.fit !== 'cover' && (
          <div className="wpe__bg">
            <span>{t('Behind the photo', 'لون الخلفية وراء الصورة')}</span>
            <div className="wpe__sw">
              {SWATCHES.map((c) => (
                <button key={c || 'theme'} type="button" aria-label={c || t('Theme', 'حسب الثيم')} aria-pressed={style.bg === c}
                  className={`wpe__dot${style.bg === c ? ' is-on' : ''}${c ? '' : ' is-theme'}`} style={c ? { background: c } : undefined}
                  onClick={() => setStyle((s) => cleanWallStyle({ ...s, bg: c }))} />
              ))}
              <input type="color" aria-label={t('Custom colour', 'لون مخصص')} value={style.bg || '#0b1020'} onChange={(e) => setStyle((s) => cleanWallStyle({ ...s, bg: e.target.value }))} />
            </div>
          </div>
        )}

        <div className="wpe__actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={busy}>{t('Cancel', 'إلغاء')}</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onSave(style)} disabled={busy || !nat}>
            {busy ? t('Saving…', 'جاري الحفظ…') : t('Use as background', 'استخدمها كخلفية')}
          </button>
        </div>
      </div>
    </div>
  );
  return createPortal(ui, document.body);
}
