import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  createObj, drawObj, dragHandle, handlesOf, hit, moveObj, normalizeBox, textLayout, worldBox, isFrame, fontCss, LINE_H, frameCorners,
} from './annot';

// tools that stay active after an object is drawn (everything else returns to "select")
const STICKY = new Set(['pen', 'highlight', 'whiteout', 'redact', 'pixel', 'eraser']);
const DRAW_TOOLS = new Set(['pen', 'rect', 'ellipse', 'line', 'arrow', 'highlight', 'whiteout', 'redact', 'pixel']);
const CURSOR = { select: 'default', text: 'text', eraser: 'cell' };

/**
 * One interactive annotation layer: a <canvas> that draws (optionally a base picture and) the objects, plus all pointer
 * handling — draw, select, move, resize, erase and in-place text editing.
 *
 *   objs / onChange(next, { commit, from })   controlled list (live while dragging, commit=true when a gesture ends)
 *   width,height  document units · scale  CSS px per unit
 */
export default function AnnotSurface({
  objs, onChange, width, height, scale, tool, style, selId, onSelect, onToolChange,
  drawBase, baseKey, env, editable = true, onActivate, autoEditId, onAutoEdit, children,
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const objsRef = useRef(objs);
  objsRef.current = objs;
  const g = useRef(null);
  const [editing, setEditing] = useState(null); // id of the text object being edited
  const editFrom = useRef(null);
  const editNew = useRef(false);
  const editStart = useRef(0);
  const taRef = useRef(null);
  const [tick, setTick] = useState(0);
  const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);

  const redraw = useCallback(() => setTick((t) => t + 1), []);

  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const pw = Math.max(1, Math.round(width * scale * dpr));
    const ph = Math.max(1, Math.round(height * scale * dpr));
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    if (drawBase) drawBase(ctx);
    const e = { ...env, onImage: redraw };
    objs.forEach((o) => { if (o.id !== editing) drawObj(ctx, o, e); });
    // selection chrome (never exported)
    const sel = editable && tool === 'select' && selId && editing !== selId ? objs.find((o) => o.id === selId) : null;
    if (sel) {
      const px = 1 / scale;
      ctx.save();
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = '#3b82f6';
      ctx.setLineDash([6 * px, 4 * px]);
      if (isFrame(sel)) {
        const q = frameCorners(sel);
        ctx.beginPath();
        ctx.moveTo(q[0][0], q[0][1]);
        q.slice(1).forEach((p) => ctx.lineTo(p[0], p[1]));
        ctx.closePath();
        ctx.stroke();
      } else {
        const b = worldBox(sel);
        ctx.strokeRect(b.x, b.y, b.w, b.h);
      }
      ctx.setLineDash([]);
      handlesOf(sel).forEach((h) => {
        const s = 9 * px;
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2 * px;
        ctx.beginPath();
        ctx.rect(h.x - s / 2, h.y - s / 2, s, s);
        ctx.fill();
        ctx.stroke();
      });
      ctx.restore();
    }
  }, [objs, selId, scale, width, height, editing, tick, baseKey, tool, dpr, drawBase, env, editable, redraw]);

  const point = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  const emit = (next, meta) => onChange(next, meta);

  const finishEdit = useCallback(() => {
    if (!editing) return;
    const id = editing;
    setEditing(null);
    const cur = objsRef.current;
    const o = cur.find((x) => x.id === id);
    if (!o) return;
    if (!o.text.trim()) {
      // an empty text box is dropped; for an existing one that was emptied it is a (recorded) delete
      emit(cur.filter((x) => x.id !== id), { commit: !editNew.current, from: editFrom.current });
    } else if (editNew.current || o.text !== editFrom.current?.find((x) => x.id === id)?.text) {
      emit(cur, { commit: true, from: editFrom.current });
    }
    onSelect?.(o.text.trim() ? id : null);
    if (onToolChange && tool === 'text') onToolChange('select');
  }, [editing, onSelect, onToolChange, tool]); // eslint-disable-line react-hooks/exhaustive-deps

  // leaving the text tool / changing the page while typing = finish
  useEffect(() => { if (editing && tool !== 'text' && tool !== 'select') finishEdit(); }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = (o, isNew, from) => {
    editFrom.current = from;
    editNew.current = isNew;
    editStart.current = Date.now();
    setEditing(o.id);
    onSelect?.(o.id);
  };

  // open a freshly inserted text object for typing (used by "Edit text")
  useEffect(() => {
    if (!autoEditId) return;
    const o = objsRef.current.find((x) => x.id === autoEditId);
    if (o && o.type === 'text') startEdit(o, false, objsRef.current);
    onAutoEdit?.();
  }, [autoEditId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDown = (e) => {
    if (!editable || (e.pointerType === 'mouse' && e.button !== 0)) return;
    onActivate?.();
    if (editing) return; // the textarea blur finishes the edit; this click only dismisses it
    const p = point(e);
    const cur = objsRef.current;
    const tol = 7 / scale;
    const topHit = () => { for (let i = cur.length - 1; i >= 0; i -= 1) if (hit(cur[i], p.x, p.y, tol)) return cur[i]; return null; };
    canvasRef.current.setPointerCapture?.(e.pointerId);

    if (tool === 'select') {
      const sel = cur.find((o) => o.id === selId);
      if (sel) {
        const h = handlesOf(sel).find((q) => Math.hypot(q.x - p.x, q.y - p.y) <= 11 / scale);
        if (h) { g.current = { mode: 'handle', id: h.id, start: normalizeBox(sel), from: cur, target: sel.id }; return; }
      }
      const o = topHit();
      if (o) { onSelect?.(o.id); g.current = { mode: 'move', start: o, p0: p, from: cur, target: o.id, moved: false }; } else { onSelect?.(null); g.current = null; }
      return;
    }
    if (tool === 'eraser') {
      g.current = { mode: 'erase', from: cur };
      onMove(e);
      return;
    }
    if (tool === 'text') {
      const o = [...cur].reverse().find((x) => x.type === 'text' && hit(x, p.x, p.y, tol));
      if (o) { startEdit(o, false, cur); return; }
      const n = createObj('text', { x: p.x, y: p.y - style.size * 0.6 }, style);
      emit([...cur, n], { commit: false });
      startEdit(n, true, cur);
      return;
    }
    if (DRAW_TOOLS.has(tool)) {
      const n = createObj(tool, p, style);
      emit([...cur, n], { commit: false });
      g.current = { mode: 'draw', id: n.id, from: cur, p0: p };
    }
  };

  const onMove = (e) => {
    const s = g.current;
    if (!s) return;
    const p = point(e);
    const cur = objsRef.current;
    if (s.mode === 'erase') {
      for (let i = cur.length - 1; i >= 0; i -= 1) {
        if (hit(cur[i], p.x, p.y, 7 / scale)) { emit(cur.filter((x) => x.id !== cur[i].id), { commit: false }); s.dirty = true; break; }
      }
      return;
    }
    if (s.mode === 'move') {
      const dx = p.x - s.p0.x; const dy = p.y - s.p0.y;
      if (!s.moved && Math.hypot(dx, dy) * scale < 3) return;
      s.moved = true;
      emit(cur.map((o) => (o.id === s.target ? moveObj(s.start, dx, dy) : o)), { commit: false });
    } else if (s.mode === 'handle') {
      emit(cur.map((o) => (o.id === s.target ? dragHandle(o, s.id, p.x, p.y, s.start) : o)), { commit: false });
    } else if (s.mode === 'draw') {
      emit(cur.map((o) => {
        if (o.id !== s.id) return o;
        if (o.type === 'pen') {
          const last = o.pts[o.pts.length - 1];
          if (Math.hypot(p.x - last[0], p.y - last[1]) * scale < 1.5) return o;
          return { ...o, pts: [...o.pts, [p.x, p.y]] };
        }
        let { x, y } = p;
        if (e.shiftKey) {
          const dx = x - o.x1; const dy = y - o.y1;
          if (o.type === 'line' || o.type === 'arrow') {
            const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
            const l = Math.hypot(dx, dy);
            x = o.x1 + Math.cos(a) * l; y = o.y1 + Math.sin(a) * l;
          } else { const m = Math.max(Math.abs(dx), Math.abs(dy)); x = o.x1 + Math.sign(dx || 1) * m; y = o.y1 + Math.sign(dy || 1) * m; }
        }
        return { ...o, x2: x, y2: y };
      }), { commit: false });
    }
  };

  const onUp = () => {
    const s = g.current;
    g.current = null;
    if (!s) return;
    const cur = objsRef.current;
    if (s.mode === 'erase') { if (s.dirty) emit(cur, { commit: true, from: s.from }); return; }
    if (s.mode === 'move') { if (s.moved) emit(cur, { commit: true, from: s.from }); return; }
    if (s.mode === 'handle') { emit(cur.map((o) => (o.id === s.target ? normalizeBox(o) : o)), { commit: true, from: s.from }); return; }
    if (s.mode === 'draw') {
      const o = cur.find((x) => x.id === s.id);
      if (!o) return;
      const tiny = o.type === 'pen' ? false : Math.hypot(o.x2 - o.x1, o.y2 - o.y1) * scale < 4;
      if (tiny) { emit(cur.filter((x) => x.id !== s.id), { commit: false }); return; }
      emit(cur.map((x) => (x.id === s.id ? normalizeBox(x) : x)), { commit: true, from: s.from });
      if (!STICKY.has(tool)) { onSelect?.(s.id); onToolChange?.('select'); }
    }
  };

  const onDouble = (e) => {
    if (!editable || tool !== 'select') return;
    const p = point(e);
    const o = [...objsRef.current].reverse().find((x) => x.type === 'text' && hit(x, p.x, p.y, 7 / scale));
    if (o) startEdit(o, false, objsRef.current);
  };

  const eo = editing ? objs.find((o) => o.id === editing) : null;
  const L = eo ? textLayout(eo) : null;
  const touch = editable && (tool !== 'select' || selId) ? 'none' : 'pan-x pan-y pinch-zoom';

  return (
    <div ref={wrapRef} className="ed__surface" style={{ width: width * scale, height: height * scale }}>
      <canvas
        ref={canvasRef}
        className="ed__canvas"
        style={{ width: width * scale, height: height * scale, cursor: editable ? (CURSOR[tool] || 'crosshair') : 'default', touchAction: touch }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={onDouble}
      />
      {children}
      {eo && (
        <textarea
          key={eo.id}
          ref={taRef}
          className="ed__textedit"
          autoFocus
          dir="auto"
          spellCheck={false}
          value={eo.text}
          placeholder="…"
          onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
          onChange={(e) => emit(objs.map((o) => (o.id === eo.id ? { ...o, text: e.target.value } : o)), { commit: false })}
          onBlur={() => {
            // the click that created the box ends with a focus change — keep the box open
            if (Date.now() - editStart.current < 150) { setTimeout(() => taRef.current?.focus(), 0); return; }
            finishEdit();
          }}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); } }}
          style={{
            left: eo.x * scale,
            top: eo.y * scale,
            width: Math.max(48, L.w * scale + 14),
            height: Math.max(eo.size * LINE_H * scale + 6, L.h * scale + 6),
            font: fontCss({ ...eo, size: eo.size * scale }),
            lineHeight: LINE_H,
            color: eo.color,
            opacity: eo.alpha ?? 1,
            transform: `rotate(${eo.rot || 0}deg)`,
          }}
        />
      )}
    </div>
  );
}
