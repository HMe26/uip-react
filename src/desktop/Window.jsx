import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SNAP_LAYOUTS, SNAP_RECTS, snapStyle } from './snapLayouts';
import { MENUBAR_H, MIN_H, MIN_W, areaW, chromeH } from './wm';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const area = () => ({ aw: areaW(), ah: window.innerHeight - chromeH() });
const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** macOS traffic-light glyphs: only visible while the pointer is over the group of three. */
const Glyph = {
  close: <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M1 1l6 6M7 1 1 7" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" /></svg>,
  min: <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M.8 4h6.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  max: <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M1 7V3.2L4.8 7H1ZM7 1v3.8L3.2 1H7Z" fill="currentColor" /></svg>,
  restore: <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M3.9 7.2V3.9H.6l3.3 3.3ZM4.1.8v3.3h3.3L4.1.8Z" fill="currentColor" /></svg>,
};

/** A draggable / resizable / snappable window frame. Drag and resize move the DOM node directly and commit once on release. */
function WindowFrame({ win, title, active, dir, icon, tt, dispatch, unified, onAssist, off, children }) {
  const ref = useRef(null);
  const [preview, setPreview] = useState(null);
  const [fly, setFly] = useState(null); // { x, y } of the snap-layouts flyout, relative to the windows area
  const maxBtn = useRef(null); const openT = useRef(0); const closeT = useRef(0);
  const flyOpen = () => {
    clearTimeout(closeT.current);
    if (fly) return;
    openT.current = setTimeout(() => {
      const b = maxBtn.current?.getBoundingClientRect(); const host = ref.current?.parentElement?.getBoundingClientRect();
      if (!b || !host) return;
      const W = 236; const x = Math.max(6, Math.min(host.width - W - 6, b.left + b.width / 2 - host.left - W / 2));
      setFly({ x, y: b.bottom - host.top + 4 });
    }, 320);
  };
  const flyClose = () => { clearTimeout(openT.current); clearTimeout(closeT.current); closeT.current = setTimeout(() => setFly(null), 200); };
  const flyKeep = () => clearTimeout(closeT.current);
  useEffect(() => () => { clearTimeout(openT.current); clearTimeout(closeT.current); }, []);
  useEffect(() => { if (!fly) return undefined; const k = (e) => { if (e.key === 'Escape') setFly(null); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [fly]);
  const cls = ['os-win', unified && 'os-win--unified', active && 'is-active', win.min && 'is-min', off && 'is-off', win.max && 'is-max', win.snap && `is-snap-${win.snap}`].filter(Boolean).join(' ');
  const free = !win.max && !win.snap;
  const snapBox = win.snap && !win.max ? snapStyle(win.snap) : null;

  // pointermove fires faster than the screen refreshes (and 2-4x more on high-rate mice): do the work once per frame with the latest event
  const track = (onMoveRaw, onUp, cursor) => {
    document.body.classList.add('os-dragging');
    if (cursor) document.body.style.cursor = cursor;
    let raf = 0; let last = null;
    const onMove = (ev) => { last = ev; if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (last) onMoveRaw(last); }); };
    const up = (ev) => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; if (last) onMoveRaw(last); }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('os-dragging');
      document.body.style.cursor = '';
      onUp(ev);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const startDrag = (e) => {
    if (e.button !== 0 || e.target.closest('.os-win__ctl')) return;
    const node = ref.current;
    const sx = e.clientX; const sy = e.clientY;
    const box = node.getBoundingClientRect();
    let cur = { x: win.x, y: win.y, w: win.w, h: win.h };
    let offX = sx - win.x; let offY = sy - win.y;
    let base = { x: win.x, y: win.y }; // where left/top currently are; the move itself is a GPU transform (no layout, no repaint of the content)
    let moved = false; let side = null;
    const wasFree = free;
    const onMove = (ev) => {
      if (!moved) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        moved = true;
        if (!wasFree) { // dragging a maximized / snapped window pulls it back to its normal size under the cursor
          const ratio = clamp((sx - box.left) / box.width, 0, 1);
          cur = { ...cur, x: Math.round(ev.clientX - cur.w * ratio), y: 0 };
          offX = ev.clientX - cur.x; offY = ev.clientY - cur.y;
          dispatch({ type: 'rect', id: win.id, rect: cur });
          node.style.left = `${cur.x}px`; node.style.top = `${cur.y}px`; base = { x: cur.x, y: cur.y };
        }
        node.classList.add('is-moving');
      }
      const { aw, ah } = area();
      cur = { ...cur, x: Math.round(clamp(ev.clientX - offX, -cur.w + 140, aw - 140)), y: Math.round(clamp(ev.clientY - offY, 0, ah - 36)) };
      node.style.transform = `translate3d(${cur.x - base.x}px, ${cur.y - base.y}px, 0)`;
      side = ev.clientY <= MENUBAR_H + 2 ? 'max' : ev.clientX <= 2 ? 'left' : ev.clientX >= aw - 3 ? 'right' : null;
      setPreview((p) => (p === side ? p : side));
    };
    track(onMove, () => {
      setPreview(null);
      node.classList.remove('is-moving');
      if (!moved) return;
      node.style.left = `${cur.x}px`; node.style.top = `${cur.y}px`; node.style.transform = ''; // same frame: no jump when React commits the same values
      dispatch({ type: 'rect', id: win.id, rect: cur });
      if (side) {
        dispatch({ type: 'snap', id: win.id, side });
        if (onAssist && (side === 'left' || side === 'right')) onAssist({ zones: [side === 'left' ? 'right' : 'left'], skip: [win.id] });
      }
    });
  };

  const startResize = (h) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const node = ref.current;
    const sx = e.clientX; const sy = e.clientY;
    const r0 = { x: win.x, y: win.y, w: win.w, h: win.h };
    let cur = r0;
    node.classList.add('is-moving');
    const onMove = (ev) => {
      const { aw, ah } = area();
      const dx = ev.clientX - sx; const dy = ev.clientY - sy;
      let { x, y, w, h: hh } = r0;
      if (h.includes('e')) w = clamp(r0.w + dx, MIN_W, aw - r0.x);
      if (h.includes('s')) hh = clamp(r0.h + dy, MIN_H, ah - r0.y);
      if (h.includes('w')) { w = clamp(r0.w - dx, MIN_W, r0.x + r0.w); x = r0.x + r0.w - w; }
      if (h.includes('n')) { hh = clamp(r0.h - dy, MIN_H, r0.y + r0.h); y = r0.y + r0.h - hh; }
      cur = { x, y, w, h: hh };
      Object.assign(node.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${hh}px` });
    };
    track(onMove, () => { node.classList.remove('is-moving'); dispatch({ type: 'rect', id: win.id, rect: cur }); }, getComputedStyle(e.currentTarget).cursor);
  };

  return (
    <>
      <div
        ref={ref} id={`os-${win.id}`} data-app={win.app} className={cls} tabIndex={-1} role="dialog" aria-label={title}
        style={free ? { left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z } : { ...(snapBox || {}), zIndex: win.z }}
        onPointerDownCapture={() => { if (!active) dispatch({ type: 'focus', id: win.id }); }}
        onPointerDown={unified ? (e) => { if (e.target.closest('[data-os-drag]') && !e.target.closest('button, input, a, label, select')) startDrag(e); } : undefined}
        onDoubleClick={unified ? (e) => { if (e.target.closest('[data-os-drag]') && !e.target.closest('button, input, a, label, select')) dispatch({ type: 'toggleMax', id: win.id }); } : undefined}
      >
        <div className="os-win__bar" onPointerDown={startDrag} onDoubleClick={(e) => { if (!e.target.closest('.os-win__ctl')) dispatch({ type: 'toggleMax', id: win.id }); }}>
          <span className="os-win__ctl" role="group" aria-label={tt('Window controls', 'أزرار النافذة')}>
            <button type="button" tabIndex={-1} className="is-close" title={tt('Close', 'إغلاق')} aria-label={tt('Close', 'إغلاق')} onClick={() => dispatch({ type: 'close', id: win.id })}>{Glyph.close}</button>
            <button type="button" tabIndex={-1} className="is-min" title={tt('Minimize', 'تصغير')} aria-label={tt('Minimize', 'تصغير')} onClick={() => dispatch({ type: 'minimize', id: win.id })}>{Glyph.min}</button>
            <button ref={maxBtn} type="button" tabIndex={-1} className="is-max" onPointerEnter={(e) => { if (e.pointerType === 'mouse') flyOpen(); }} onPointerLeave={flyClose} title={win.max || win.snap ? tt('Restore', 'استرجاع') : tt('Zoom', 'تكبير')} aria-label={tt('Maximize', 'تكبير')} onClick={() => { setFly(null); if (win.snap) dispatch({ type: 'snap', id: win.id, side: 'max' }); else dispatch({ type: 'toggleMax', id: win.id }); }}>{win.max ? Glyph.restore : Glyph.max}</button>
          </span>
          <span className="os-win__ttl"><span className="os-win__ico">{icon}</span><span className="os-win__title" dir="auto">{title}</span></span>
        </div>
        <div className="os-win__body" dir={dir}>{children}</div>
        {free && HANDLES.map((h) => <i key={h} className={`os-rz os-rz--${h}`} onPointerDown={startResize(h)} />)}
      </div>
      {fly && ref.current?.parentElement && createPortal(
        <div className="os-snapfly" style={{ left: fly.x, top: fly.y }} onPointerEnter={flyKeep} onPointerLeave={flyClose} onPointerDown={(e) => e.stopPropagation()} role="menu" aria-label={tt('Snap layouts', 'تقسيم الشاشة')}>
          {SNAP_LAYOUTS.map((zones, li) => (
            <div key={li} className="os-snapfly__l">
              {zones.map((z) => {
                const r = SNAP_RECTS[z];
                return <button key={z} type="button" role="menuitem" className={win.snap === z ? 'is-on' : ''} title={tt('Snap here', 'ضع النافذة هنا')} style={{ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `calc(${r[2] * 100}% - 3px)`, height: `calc(${r[3] * 100}% - 3px)` }}
                  onClick={() => { setFly(null); dispatch({ type: 'focus', id: win.id }); dispatch({ type: 'snap', id: win.id, side: z }); if (onAssist) onAssist({ zones: zones.filter((o) => o !== z), skip: [win.id] }); }} />;
              })}
            </div>
          ))}
        </div>, ref.current.parentElement)}
      {preview && <div className={`os-snap-preview is-${preview}`} />}
    </>
  );
}

export default memo(WindowFrame);
