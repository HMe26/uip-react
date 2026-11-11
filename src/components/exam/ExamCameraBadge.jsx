import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';

const KEY = 'uip_exam_cam';
const EDGE = 6; // px kept between the badge and the screen edge

const read = () => {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return { pos: v && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null, small: !!v?.small };
  } catch { return { pos: null, small: false }; }
};
const write = (pos, small) => { try { sessionStorage.setItem(KEY, JSON.stringify({ x: pos?.x, y: pos?.y, small })); } catch { /* ignore */ } };

/**
 * Live camera preview shown while an exam runs. The student can drag it anywhere (mouse, touch or arrow
 * keys) and shrink it to a small bubble when it covers a question. The <video> is never unmounted or
 * hidden — snapshots are taken from it — it is only made smaller.
 * Position / size are kept in sessionStorage because the exam screens swap between question and review views.
 */
export default function ExamCameraBadge({ videoRef }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const boxRef = useRef(null);
  const drag = useRef(null);
  const [{ pos: initPos, small: initSmall }] = useState(read);
  const [pos, setPos] = useState(initPos); // null = CSS default corner
  const [small, setSmall] = useState(initSmall);
  const [dragging, setDragging] = useState(false);

  const clamp = useCallback((x, y) => {
    const el = boxRef.current;
    const w = el?.offsetWidth || 112;
    const h = el?.offsetHeight || 84;
    return {
      x: Math.min(Math.max(EDGE, x), Math.max(EDGE, window.innerWidth - w - EDGE)),
      y: Math.min(Math.max(EDGE, y), Math.max(EDGE, window.innerHeight - h - EDGE)),
    };
  }, []);

  // Keep it on screen when the window is resized / rotated or when it changes size.
  useEffect(() => {
    const fit = () => setPos((p) => (p ? clamp(p.x, p.y) : p));
    fit();
    const settle = setTimeout(fit, 260); // again once the shrink / grow transition has finished
    window.addEventListener('resize', fit);
    return () => { clearTimeout(settle); window.removeEventListener('resize', fit); };
  }, [clamp, small]);

  useEffect(() => { write(pos, small); }, [pos, small]);

  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest('button')) return; // the toggle button is not a drag handle
    const r = boxRef.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false, sx: e.clientX, sy: e.clientY };
    boxRef.current.setPointerCapture?.(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return; // ignore tiny jitters
    d.moved = true;
    setPos(clamp(e.clientX - d.dx, e.clientY - d.dy));
  };
  const endDrag = (e) => {
    if (!drag.current) return;
    boxRef.current?.releasePointerCapture?.(e.pointerId);
    drag.current = null;
    setDragging(false);
  };

  const onKeyDown = (e) => {
    const step = e.shiftKey ? 48 : 16;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    const r = boxRef.current.getBoundingClientRect();
    setPos(clamp((pos?.x ?? r.left) + d[0], (pos?.y ?? r.top) + d[1]));
  };

  const style = pos ? { left: pos.x, top: pos.y, insetInlineEnd: 'auto', insetBlockEnd: 'auto' } : undefined;
  const L = {
    shrink: ar ? 'تصغير الكاميرا' : 'Shrink camera',
    grow: ar ? 'تكبير الكاميرا' : 'Enlarge camera',
    drag: ar ? 'اسحب لتحريك الكاميرا' : 'Drag to move the camera',
  };

  return (
    <div
      ref={boxRef}
      className={`ex-cam-badge${small ? ' is-small' : ''}${dragging ? ' is-dragging' : ''}`}
      style={style}
      role="group" aria-label={L.drag} title={L.drag}
      tabIndex={0}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => setSmall((v) => !v)}
    >
      <span className="ex-cam-badge__dot" aria-hidden="true" />
      <video ref={videoRef} muted playsInline autoPlay aria-hidden="true" />
      <button
        type="button" className="ex-cam-badge__btn"
        aria-label={small ? L.grow : L.shrink} title={small ? L.grow : L.shrink}
        onClick={() => setSmall((v) => !v)}
      >
        <Icon name={small ? 'expand' : 'collapse'} size={13} />
      </button>
    </div>
  );
}
