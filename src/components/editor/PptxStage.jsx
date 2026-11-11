import { useEffect, useRef, useState } from 'react';
import Slide from './PptxSlide';

const MIN = 91440;
const canEditText = (s) => s && ((s.kind === 'shape' && !s.isLine) || s.kind === 'table');

/** The big editable slide: selection, drag / resize / rotate with snapping, keyboard, and zoom-to-fit. */
export default function PptxStage({ deck, slide, sel, setSel, editing, setEditing, cell, setCell, zoom, A, editorApi, onFmt, tt }) {
  const stageRef = useRef(null); const slideRef = useRef(null); const apiRef = useRef(A); apiRef.current = A;
  const [box, setBox] = useState({ w: 800, h: 500 }); const [drag, setDrag] = useState(null); const [guides, setGuides] = useState(null);
  const cellHit = useRef(null); const { cx, cy } = deck;
  useEffect(() => {
    const el = stageRef.current; if (!el) return undefined;
    const upd = () => setBox({ w: Math.max(160, el.clientWidth - 40), h: Math.max(120, el.clientHeight - 40) });
    upd(); const ro = new ResizeObserver(upd); ro.observe(el); return () => ro.disconnect();
  }, []);
  const fitW = Math.max(160, Math.min(box.w, (box.h * cx) / cy));
  const selShape = sel != null ? slide.shapes.find((s) => s.xi === sel) : null;
  const k = () => (slideRef.current ? slideRef.current.getBoundingClientRect().width / cx : 1);
  const focusStage = () => stageRef.current?.focus({ preventScroll: true });

  const track = (onMove, onUp) => {
    const mv = (e) => onMove(e);
    const up = (e) => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); onUp(e); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };

  const onShapeDown = (e, s, edge) => {
    if (e.button > 0 && e.pointerType === 'mouse') return;
    if (e.target.closest?.('.px__rt')) return;
    e.stopPropagation();
    const same = editing && editing.xi === s.xi;
    if (editing && (!same || edge)) apiRef.current.endEdit();
    const hit = cellHit.current; cellHit.current = null;
    const wasSel = sel === s.xi; const wasCell = cell && hit && cell.xi === s.xi && cell.r === hit.r && cell.c === hit.c;
    setSel(s.xi); setCell(hit ? { xi: s.xi, r: hit.r, c: hit.c } : null);
    if (!same) focusStage();
    if (s.grouped || same || (s.kind === 'table' && !edge)) {
      if (s.kind === 'table' && !edge && !same && wasSel && wasCell) track(() => {}, () => setEditing({ xi: s.xi, r: hit.r, c: hit.c }));
      return;
    }
    const r0 = { x: s.x, y: s.y, w: s.w, h: s.h }; const o = { sx: e.clientX, sy: e.clientY, moved: false, last: null };
    track((ev) => {
      const kk = k(); let dx = (ev.clientX - o.sx) / kk; let dy = (ev.clientY - o.sy) / kk;
      if (!o.moved && Math.hypot(ev.clientX - o.sx, ev.clientY - o.sy) < 4) return;
      o.moved = true;
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      let nx = r0.x + dx; let ny = r0.y + dy; const g = { x: [], y: [] };
      if (!s.rot && !ev.altKey) {
        const thr = 6 / kk; const others = slide.shapes.filter((t) => t.xi !== s.xi && !t.rot);
        const snap = (pos, size, cands) => {
          let best = null;
          [pos, pos + size / 2, pos + size].forEach((edge, ei) => cands.forEach((c) => { const d = c - edge; if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: c, ei }; }));
          return best;
        };
        const bx = snap(nx, r0.w, [0, cx / 2, cx, ...others.flatMap((t) => [t.x, t.x + t.w / 2, t.x + t.w])]);
        const by = snap(ny, r0.h, [0, cy / 2, cy, ...others.flatMap((t) => [t.y, t.y + t.h / 2, t.y + t.h])]);
        if (bx) { nx += bx.d; g.x.push(bx.line); } if (by) { ny += by.d; g.y.push(by.line); }
      }
      o.last = { xi: s.xi, x: nx, y: ny }; setDrag(o.last); setGuides(g.x.length || g.y.length ? g : null);
    }, () => {
      setDrag(null); setGuides(null);
      if (o.moved && o.last) apiRef.current.rect(s.xi, { x: o.last.x, y: o.last.y });
      else if (wasSel && !edge && canEditText(s)) setEditing({ xi: s.xi });
    });
  };
  const onCellDown = (e, s, r, c) => { cellHit.current = { r, c }; };
  const onHandleDown = (e, s, h) => {
    e.stopPropagation(); e.preventDefault(); if (editing) apiRef.current.endEdit();
    const kk = k(); const th = ((s.rot || 0) * Math.PI) / 180; const c0 = { x: s.x + s.w / 2, y: s.y + s.h / 2 }; const o = { last: null };
    const sx0 = e.clientX; const sy0 = e.clientY; const sr = slideRef.current.getBoundingClientRect();
    track((ev) => {
      if (h === 'rot') {
        let a = (Math.atan2(ev.clientY - (sr.top + c0.y * kk), ev.clientX - (sr.left + c0.x * kk)) * 180) / Math.PI + 90;
        if (ev.shiftKey) a = Math.round(a / 15) * 15;
        o.last = { xi: s.xi, rot: ((a % 360) + 360) % 360 }; setDrag(o.last); return;
      }
      const sx = h.includes('e') ? 1 : h.includes('w') ? -1 : 0; const sy = h.includes('s') ? 1 : h.includes('n') ? -1 : 0;
      const ddx = (ev.clientX - sx0) / kk; const ddy = (ev.clientY - sy0) / kk;
      const lx = ddx * Math.cos(th) + ddy * Math.sin(th); const ly = -ddx * Math.sin(th) + ddy * Math.cos(th);
      const minW = s.isLine && !s.w ? 0 : MIN; const minH = s.isLine && !s.h ? 0 : MIN;
      let nw = sx ? Math.max(minW, s.w + sx * lx) : s.w; let nh = sy ? Math.max(minH, s.h + sy * ly) : s.h;
      if (ev.shiftKey && sx && sy && s.w && s.h) { const f = Math.max(nw / s.w, nh / s.h); nw = s.w * f; nh = s.h * f; }
      const dw = nw - s.w; const dh = nh - s.h; const px = (sx * dw) / 2; const py = (sy * dh) / 2;
      const ncx = c0.x + px * Math.cos(th) - py * Math.sin(th); const ncy = c0.y + px * Math.sin(th) + py * Math.cos(th);
      o.last = { xi: s.xi, x: ncx - nw / 2, y: ncy - nh / 2, w: nw, h: nh }; setDrag(o.last);
    }, () => { setDrag(null); if (o.last) { const { xi, ...r } = o.last; apiRef.current.rect(xi, r); } });
  };
  const onSlideDown = (e) => {
    if (e.target.closest?.('.px__sh, .px__sel')) return;
    if (editing) apiRef.current.endEdit();
    setSel(null); setCell(null); focusStage();
  };
  const onKeyDown = (e) => {
    if (editing || e.target.closest?.('input, select, textarea')) return;
    const mod = e.ctrlKey || e.metaKey; const key = e.key.toLowerCase(); const a = apiRef.current;
    if (mod && key === 'c') { e.preventDefault(); a.copy(); } else if (mod && key === 'x') { e.preventDefault(); a.cut(); }
    else if (mod && key === 'v') { e.preventDefault(); a.paste(); } else if (mod && key === 'd') { e.preventDefault(); a.dup(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (selShape) { e.preventDefault(); a.del(); } }
    else if (e.key.startsWith('Arrow') && selShape && !selShape.grouped) {
      e.preventDefault(); const st = e.shiftKey ? 360000 : 36000;
      a.rect(selShape.xi, { x: selShape.x + (e.key === 'ArrowRight' ? st : e.key === 'ArrowLeft' ? -st : 0), y: selShape.y + (e.key === 'ArrowDown' ? st : e.key === 'ArrowUp' ? -st : 0) }, true);
    } else if ((e.key === 'Enter' || e.key === 'F2') && canEditText(selShape)) { e.preventDefault(); setEditing(selShape.kind === 'table' ? { xi: selShape.xi, r: cell?.r ?? 0, c: cell?.c ?? 0 } : { xi: selShape.xi }); }
    else if (e.key === 'Escape') { setSel(null); setCell(null); }
    else if (e.key === 'Tab') { e.preventDefault(); const l = slide.shapes; if (l.length) { const i = l.findIndex((s) => s.xi === sel); setSel(l[(i + (e.shiftKey ? -1 : 1) + l.length) % l.length].xi); } }
    else if (e.key === 'PageDown') { e.preventDefault(); a.go(1); } else if (e.key === 'PageUp') { e.preventDefault(); a.go(-1); }
  };
  const ed = { tt, sel, editing, cell, drag, guides, slideRef, editorApi, onShapeDown, onCellDown, onHandleDown, onSlideDown, onEndEdit: () => apiRef.current.endEdit(), onFmt };
  return (
    <div className="px__stage" ref={stageRef} tabIndex={0} onKeyDown={onKeyDown} aria-label={tt('Slide', 'الشريحة')}>
      <div className="px__fit"><Slide slide={slide} deck={deck} wide={`${fitW * zoom}px`} ed={ed} /></div>
    </div>
  );
}
