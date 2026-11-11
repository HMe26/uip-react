import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';

/**
 * Drag handle on the inner edge of a side pane of the messenger: the conversation list (`side="rail"`) or the
 * conversation-info panel (`side="info"`).
 *  - drag with mouse / touch / pen, or focus it and use the arrow keys (Shift = bigger steps), Home / End
 *  - double-click (or Enter) resets to the default width
 *  - the width is clamped so the chat itself never gets squeezed below a usable size
 *  - remembered per browser
 * It only drives a custom property on `.msg-app` (--msg-info-w / --msg-rail-w); all layout stays in CSS.
 */
export const INFO_W_KEY = 'uip_msg_info_w';
export const RAIL_W_KEY = 'uip_msg_rail_w';
export const INFO_W_MIN = 280;
export const INFO_W_MAX = 560;
export const INFO_W_DEFAULT = 340;
export const RAIL_W_MIN = 230;
export const RAIL_W_MAX = 480;
const THREAD_MIN = 380; // never let the chat column get narrower than this
const OVERLAY_BELOW = 1480; // below this width the info panel floats over the chat instead of taking a column

const SIDES = {
  info: { sel: '.msg-info', min: INFO_W_MIN, max: INFO_W_MAX, def: INFO_W_DEFAULT, outerIsInlineEnd: true },
  rail: { sel: '.msg-rail', min: RAIL_W_MIN, max: RAIL_W_MAX, def: null, outerIsInlineEnd: false },
};

const readW = (key, min, max) => {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  } catch { return null; }
};
export const readInfoWidth = () => readW(INFO_W_KEY, INFO_W_MIN, INFO_W_MAX);
export const readRailWidth = () => readW(RAIL_W_KEY, RAIL_W_MIN, RAIL_W_MAX);

export default function InfoResizer({ appRef, width, onWidth, side = 'info' }) {
  const cfg = SIDES[side] || SIDES.info;
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [drag, setDrag] = useState(false);
  const [live, setLive] = useState(null); // px shown in the tooltip while dragging
  const edge = useRef(0);
  const raf = useRef(0);
  const label = side === 'rail'
    ? (ar ? 'تغيير عرض قائمة المحادثات' : 'Resize conversation list')
    : (ar ? 'تغيير عرض معلومات المحادثة' : 'Resize conversation info');

  const limit = useCallback(() => {
    const app = appRef.current;
    if (!app) return cfg.max;
    const total = app.clientWidth;
    let room;
    if (side === 'info') {
      const railW = app.classList.contains('rail-collapsed') ? 0 : (app.querySelector(':scope > .msg-rail')?.offsetWidth || 0);
      room = total < OVERLAY_BELOW ? total * 0.92 : total - railW - THREAD_MIN - 32;
    } else {
      const infoOpen = app.classList.contains('has-info') && total >= OVERLAY_BELOW;
      const infoW = infoOpen ? (app.querySelector(':scope > .msg-info')?.offsetWidth || 0) + 16 : 0;
      room = total - infoW - THREAD_MIN - 16;
    }
    return Math.max(cfg.min, Math.min(cfg.max, Math.floor(room)));
  }, [appRef, cfg, side]);

  const clamp = useCallback((w) => Math.round(Math.max(cfg.min, Math.min(limit(), w))), [limit, cfg]);
  const commit = useCallback((w, persist) => { onWidth(clamp(w), persist); }, [clamp, onWidth]);
  const reset = useCallback(() => {
    if (cfg.def == null) onWidth(null, true); // rail: back to the responsive CSS default
    else commit(cfg.def, true);
  }, [cfg, commit, onWidth]);

  const panelEl = () => appRef.current?.querySelector(`:scope > ${cfg.sel}`);
  const isRtl = () => getComputedStyle(appRef.current || document.body).direction === 'rtl';

  const onDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    const panel = panelEl();
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    // the pane's outer edge stays put; the inner edge follows the pointer
    edge.current = (cfg.outerIsInlineEnd !== isRtl()) ? r.right : r.left;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag(true);
    e.preventDefault();
  };
  const onMove = (e) => {
    if (!drag) return;
    const x = e.clientX;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const w = clamp(Math.abs(x - edge.current));
      setLive(w);
      onWidth(w, false);
    });
  };
  const onUp = (e) => {
    if (!drag) return;
    setDrag(false);
    setLive(null);
    cancelAnimationFrame(raf.current);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    commit(Math.abs(e.clientX - edge.current), true);
  };
  const onKey = (e) => {
    const step = e.shiftKey ? 48 : 16;
    const cur = width ?? panelEl()?.offsetWidth ?? cfg.min;
    // arrow that moves the pane's inner edge away from its outer edge widens it
    const toward = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0; // screen direction
    if (toward) {
      e.preventDefault();
      const innerIsRight = (cfg.outerIsInlineEnd !== isRtl()) ? false : true; // outer = left -> inner = right
      commit(cur + (toward === (innerIsRight ? 1 : -1) ? step : -step), true);
      return;
    }
    if (e.key === 'Home') { e.preventDefault(); commit(cfg.min, true); }
    else if (e.key === 'End') { e.preventDefault(); commit(cfg.max, true); }
    else if (e.key === 'Enter') { e.preventDefault(); reset(); }
  };

  // keep the width valid when the window shrinks
  useEffect(() => {
    const fix = () => { if (width == null) return; const v = clamp(width); if (v !== width) onWidth(v, false); };
    window.addEventListener('resize', fix);
    return () => { window.removeEventListener('resize', fix); cancelAnimationFrame(raf.current); };
  }, [clamp, width, onWidth]);

  useEffect(() => {
    if (!drag) return undefined;
    document.body.classList.add('msg-resizing');
    return () => document.body.classList.remove('msg-resizing');
  }, [drag]);

  return (
    <div
      className={`msg-info-resizer msg-info-resizer--${side}${drag ? ' is-drag' : ''}`}
      role="separator" aria-orientation="vertical" tabIndex={0} aria-label={label}
      aria-valuemin={cfg.min} aria-valuemax={cfg.max} aria-valuenow={width ?? undefined}
      title={ar ? 'اسحب للتوسيع أو التضييق · دبل كليك للرجوع للحجم الافتراضي' : 'Drag to resize · double-click to reset'}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onDoubleClick={reset}
      onKeyDown={onKey}
    >
      <span className="msg-info-resizer__grip" aria-hidden="true" />
      {drag && live != null && <span className="msg-info-resizer__tip" aria-hidden="true">{live}px</span>}
    </div>
  );
}
