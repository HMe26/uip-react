import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../../Icon';
import './screenSharePip.css';

/**
 * Google-Meet-style presenter widgets, shown ONLY to the person who is presenting:
 *  - a slim "You're presenting" bar with a Stop button (top-centre of the stage), and
 *  - a small floating live preview of what is being shared: drag it anywhere, resize it from the corner, minimise it to a
 *    pill, and it snaps to the nearest corner on release.
 *
 * It is positioned inside `.meeting-room__stage` (position: relative). Dragging / resizing move the DOM node with a GPU
 * transform and commit to React ONCE on release, so a drag never re-renders the meeting room (that is what keeps it fast).
 * Minimised, the <video> is detached, so the preview costs no decoding at all.
 */
const MARGIN = 10;
const ASPECT = 16 / 9;
const MIN_W = 160;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Default width: ~22 % of the stage, between 180 and 320 px, never wider than the stage allows (phones). */
const defaultWidth = (host) => clamp(Math.round(host.width * 0.22), 180, Math.min(320, Math.max(MIN_W, host.width - MARGIN * 2)));

function ScreenSharePip({ stream, onStop, t, onPopOut, popped }) {
  const hostRef = useRef(null);   // the zero-size anchor; its parent is the stage we live in
  const boxRef = useRef(null);
  const videoRef = useRef(null);
  // x / y are the box's top-left inside the stage; null = not placed yet (bottom-end corner on first layout)
  const [rect, setRect] = useState({ x: null, y: null, w: 0 });
  const [mini, setMini] = useState(false);
  const [moving, setMoving] = useState(false);
  const rectRef = useRef(rect);
  rectRef.current = rect;

  const stageBox = useCallback(() => hostRef.current?.parentElement?.getBoundingClientRect() || { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 }, []);
  const sizeOf = useCallback((w) => ({ w, h: Math.round(w / ASPECT) + 34 }), []); // + title strip

  // first placement: bottom-right of the stage, above the dock
  useLayoutEffect(() => {
    const host = stageBox();
    const w = defaultWidth(host);
    const { h } = sizeOf(w);
    setRect({ w, x: Math.max(MARGIN, host.width - w - MARGIN), y: Math.max(MARGIN, host.height - h - MARGIN) });
  }, [stageBox, sizeOf]);

  // keep it inside the stage when the window / panels change size
  useEffect(() => {
    const stage = hostRef.current?.parentElement;
    if (!stage || typeof ResizeObserver === 'undefined') return undefined;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = rectRef.current;
        if (r.x == null) return;
        const host = stage.getBoundingClientRect();
        const w = clamp(r.w, MIN_W, Math.max(MIN_W, host.width - MARGIN * 2));
        const { h } = sizeOf(mini ? 0 : w);
        const bw = mini ? 150 : w;
        const bh = mini ? 40 : h;
        const x = clamp(r.x, MARGIN, Math.max(MARGIN, host.width - bw - MARGIN));
        const y = clamp(r.y, MARGIN, Math.max(MARGIN, host.height - bh - MARGIN));
        if (x !== r.x || y !== r.y || w !== r.w) setRect({ x, y, w });
      });
    });
    ro.observe(stage);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [mini, sizeOf]);

  // bind the live stream (detached while minimised = zero decode cost)
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    el.srcObject = mini ? null : stream || null;
    if (!mini && stream) el.play?.().catch(() => {});
    return () => { el.srcObject = null; };
  }, [stream, mini]);

  const snapToCorner = (x, y, bw, bh, host) => {
    const left = x + bw / 2 < host.width / 2;
    const top = y + bh / 2 < host.height / 2;
    return {
      x: left ? MARGIN : Math.max(MARGIN, host.width - bw - MARGIN),
      y: top ? MARGIN + 44 : Math.max(MARGIN, host.height - bh - MARGIN), // leave room for the "presenting" bar on top
    };
  };

  const drag = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('button')) return;
    const node = boxRef.current; if (!node) return;
    e.preventDefault();
    const host = stageBox();
    const start = { px: e.clientX, py: e.clientY, x: rectRef.current.x, y: rectRef.current.y };
    const bw = node.offsetWidth; const bh = node.offsetHeight;
    let cur = { x: start.x, y: start.y }; let raf = 0; let last = null; let moved = false;
    try { node.setPointerCapture(e.pointerId); } catch { /* not critical */ }
    setMoving(true);
    const apply = () => {
      raf = 0; if (!last) return;
      cur = {
        x: clamp(start.x + last.clientX - start.px, 0, Math.max(0, host.width - bw)),
        y: clamp(start.y + last.clientY - start.py, 0, Math.max(0, host.height - bh)),
      };
      node.style.transform = `translate3d(${cur.x - start.x}px, ${cur.y - start.y}px, 0)`;
    };
    const move = (ev) => { if (Math.hypot(ev.clientX - start.px, ev.clientY - start.py) > 3) moved = true; last = ev; if (!raf) raf = requestAnimationFrame(apply); };
    const up = () => {
      cancelAnimationFrame(raf); if (last) apply();
      node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', up);
      setMoving(false);
      if (!moved) { node.style.transform = ''; return; }
      const s = snapToCorner(cur.x, cur.y, bw, bh, host);
      node.style.transform = '';
      setRect((r) => ({ ...r, x: s.x, y: s.y }));
    };
    node.addEventListener('pointermove', move); node.addEventListener('pointerup', up); node.addEventListener('pointercancel', up);
  };

  const resize = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const node = boxRef.current; if (!node) return;
    e.preventDefault(); e.stopPropagation();
    const host = stageBox();
    const r0 = rectRef.current;
    const right = r0.x + r0.w; // the right edge stays put; the handle is on the bottom-left corner and the box grows toward the centre
    const maxW = Math.max(MIN_W, Math.min(right - MARGIN, (host.height - r0.y - MARGIN - 34) * ASPECT));
    let w = r0.w; let raf = 0; let last = null;
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch { /* not critical */ }
    setMoving(true);
    const apply = () => { raf = 0; if (!last) return; w = clamp(r0.w - (last.clientX - e.clientX), MIN_W, maxW); node.style.width = `${w}px`; node.style.left = `${right - w}px`; };
    const move = (ev) => { last = ev; if (!raf) raf = requestAnimationFrame(apply); };
    const up = () => {
      cancelAnimationFrame(raf); if (last) apply();
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      setMoving(false);
      setRect((r) => ({ ...r, w, x: right - w }));
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };

  const placed = rect.x != null;
  const style = placed
    ? { left: rect.x, top: rect.y, width: mini ? undefined : rect.w }
    : { visibility: 'hidden', left: 0, top: 0, width: rect.w || 240 };

  return (
    <>
      <i ref={hostRef} className="mshare-anchor" aria-hidden="true" />

      <div className="mshare-bar" role="status">
        <span className="mshare-bar__dot" aria-hidden="true" />
        <Icon name="screen-share" size={14} />
        <span className="mshare-bar__txt">{t('You are presenting your screen')}</span>
        {onPopOut && (
          <button type="button" className="mshare-bar__pop" onClick={onPopOut} title={popped ? t('Close floating window') : t('Open floating window')}>
            <Icon name="external-link" size={13} /> {t('Floating window')}
          </button>
        )}
        <button type="button" className="mshare-bar__stop" onClick={onStop}>
          <Icon name="stop" size={13} /> {t('Stop Sharing')}
        </button>
      </div>

      <div
        ref={boxRef}
        className={`mshare-pip${mini ? ' is-mini' : ''}${moving ? ' is-moving' : ''}`}
        style={style}
        role="group"
        aria-label={t('Your shared screen')}
      >
        <div className="mshare-pip__head" onPointerDown={drag} onDoubleClick={() => setMini((m) => !m)}>
          <span className="mshare-pip__ttl"><Icon name="screen-share" size={13} /> {mini ? t('Presenting') : t('Your screen')}</span>
          <button type="button" className="mshare-pip__btn" onClick={() => setMini((m) => !m)} title={mini ? t('Show preview') : t('Hide preview')} aria-label={mini ? t('Show preview') : t('Hide preview')}>
            <Icon name={mini ? 'maximize' : 'ed-minus'} size={13} />
          </button>
        </div>
        {!mini && (
          <div className="mshare-pip__view">
            <video ref={videoRef} className="mshare-pip__video" autoPlay muted playsInline disablePictureInPicture />
            <i className="mshare-pip__rz" onPointerDown={resize} aria-hidden="true" />
          </div>
        )}
      </div>
    </>
  );
}

export default memo(ScreenSharePip);
