import { memo, useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon';
import { newId } from './widgetsStore';
import './widgets.css';

export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'purple'];
const MIN = { note: [150, 110], todo: [190, 150] };
const RESIZABLE = new Set(['note', 'todo']);

/** Pointer-drag helper: calls move(dx, dy) while dragging, done(dx, dy) on release. */
function track(e, move, done) {
  const sx = e.clientX; const sy = e.clientY;
  const mv = (ev) => move(ev.clientX - sx, ev.clientY - sy);
  const up = (ev) => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); done(ev.clientX - sx, ev.clientY - sy); };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}

function ClockBody({ it, ar, onChange }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const h = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(h); }, []);
  const loc = ar ? 'ar-EG' : 'en-US';
  return (
    <div className="wg-clock" onDoubleClick={() => onChange({ h24: !it.h24 })} title={ar ? 'دبل كليك لتغيير 12/24 ساعة' : 'Double-click to switch 12/24 h'}>
      <div className="wg-clock__t" dir="ltr">{now.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', hour12: !it.h24 })}</div>
      <div className="wg-clock__d">{now.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    </div>
  );
}

function CalendarBody({ ar }) {
  const [off, setOff] = useState(0);
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth() + off, 1);
  const loc = ar ? 'ar-EG' : 'en-US';
  const start = ar ? 6 : 0; // Saturday-first in Arabic, Sunday-first otherwise
  const lead = (first.getDay() - start + 7) % 7;
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const dayNames = Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + ((start + i) % 7)).toLocaleDateString(loc, { weekday: 'narrow' }));
  const isToday = (d) => d && off === 0 && d === today.getDate();
  return (
    <div className="wg-cal">
      <div className="wg-cal__bar">
        <button type="button" onClick={() => setOff((o) => o - 1)} aria-label={ar ? 'الشهر السابق' : 'Previous month'}><Icon name={ar ? 'chevron-right' : 'chevron-left'} size={14} /></button>
        <button type="button" className="wg-cal__m" onClick={() => setOff(0)}>{first.toLocaleDateString(loc, { month: 'long', year: 'numeric' })}</button>
        <button type="button" onClick={() => setOff((o) => o + 1)} aria-label={ar ? 'الشهر التالي' : 'Next month'}><Icon name={ar ? 'chevron-left' : 'chevron-right'} size={14} /></button>
      </div>
      <div className="wg-cal__g" dir={ar ? 'rtl' : 'ltr'}>
        {dayNames.map((d, i) => <span key={`h${i}`} className="wg-cal__h">{d}</span>)}
        {cells.map((d, i) => <span key={i} className={`wg-cal__c${isToday(d) ? ' is-today' : ''}`}>{d ? d.toLocaleString(loc) : ''}</span>)}
      </div>
    </div>
  );
}

function TodoBody({ it, ar, onChange }) {
  const [draft, setDraft] = useState('');
  const todos = it.todos || [];
  const done = todos.filter((t) => t.done).length;
  const addTodo = () => { const t = draft.trim(); if (!t || todos.length >= 50) return; onChange({ todos: [...todos, { id: newId(), t: t.slice(0, 200), done: false }] }); setDraft(''); };
  return (
    <div className="wg-todo">
      <input className="wg-todo__title" dir="auto" value={it.title || ''} maxLength={60} placeholder={ar ? 'قائمة المهام' : 'To-do'} onChange={(e) => onChange({ title: e.target.value })} />
      {todos.length > 0 && <div className="wg-todo__count">{done}/{todos.length}</div>}
      <ul className="wg-todo__list">
        {todos.map((t) => (
          <li key={t.id} className={t.done ? 'is-done' : ''}>
            <input type="checkbox" checked={t.done} onChange={() => onChange({ todos: todos.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)) })} aria-label={t.t} />
            <span dir="auto">{t.t}</span>
            <button type="button" onClick={() => onChange({ todos: todos.filter((x) => x.id !== t.id) })} aria-label={ar ? 'حذف' : 'Delete'}><Icon name="x" size={12} /></button>
          </li>
        ))}
      </ul>
      <input className="wg-todo__add" dir="auto" value={draft} maxLength={200} placeholder={ar ? 'أضف مهمة ثم Enter…' : 'Add a task, press Enter…'} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTodo(); } }} />
    </div>
  );
}

const Item = memo(function Item({ it, pos, size, ar, focus, bounds, onChange, onRemove, onFront, onMove, onResize }) {
  const taRef = useRef(null);
  useEffect(() => { if (!focus) return undefined; const h = setTimeout(() => taRef.current?.focus(), 80); return () => clearTimeout(h); }, [focus]); // after the context menu closes and gives focus back
  const barDown = (e) => {
    if (e.button !== 0 || e.target.closest('button, input')) return;
    e.preventDefault();
    onFront(it.id);
    const x0 = it.x; const y0 = it.y;
    const clampXY = (dx, dy) => ({
      x: Math.max(0, Math.min(Math.max(0, bounds.w - 80), x0 + dx)),
      y: Math.max(0, Math.min(Math.max(0, bounds.h - 34), y0 + dy)),
    });
    track(e, (dx, dy) => onMove(it.id, clampXY(dx, dy), false), (dx, dy) => onMove(it.id, clampXY(dx, dy), true));
  };
  const resizeDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    onFront(it.id);
    const [mw, mh] = MIN[it.type];
    const calc = (dx, dy) => ({ w: Math.max(mw, Math.min(900, Math.round(it.w + dx))), h: Math.max(mh, Math.min(900, Math.round(it.h + dy))) });
    track(e, (dx, dy) => onResize(it.id, calc(dx, dy), false), (dx, dy) => onResize(it.id, calc(dx, dy), true));
  };
  const color = it.color || 'yellow';
  return (
    <div
      className={`os-wgt os-wgt--${it.type}${it.type === 'note' ? ` is-${color}` : ''}`} data-wgt={it.id}
      style={{ left: pos.x, top: pos.y, width: size.w, height: it.type === 'clock' || it.type === 'calendar' ? 'auto' : size.h, zIndex: it.z || 1 }}
      onPointerDown={() => onFront(it.id)} onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="os-wgt__bar" onPointerDown={barDown}>
        {it.type === 'note' && (
          <span className="os-wgt__dots">
            {NOTE_COLORS.map((c) => <button key={c} type="button" className={`os-wgt__dot is-${c}${c === color ? ' is-on' : ''}`} onClick={() => onChange(it.id, { color: c })} aria-label={c} />)}
          </span>
        )}
        <button type="button" className="os-wgt__x" onClick={() => onRemove(it)} aria-label={ar ? 'إزالة' : 'Remove'} title={ar ? 'إزالة' : 'Remove'}><Icon name="x" size={12} /></button>
      </div>
      <div className="os-wgt__body">
        {it.type === 'note' && (
          <textarea
            ref={taRef} dir="auto" value={it.text || ''} maxLength={5000} spellCheck={false}
            placeholder={ar ? 'اكتب ملاحظتك هنا…' : 'Write a note…'} onChange={(e) => onChange(it.id, { text: e.target.value })}
          />
        )}
        {it.type === 'clock' && <ClockBody it={it} ar={ar} onChange={(p) => onChange(it.id, p)} />}
        {it.type === 'calendar' && <CalendarBody ar={ar} />}
        {it.type === 'todo' && <TodoBody it={it} ar={ar} onChange={(p) => onChange(it.id, p)} />}
      </div>
      {RESIZABLE.has(it.type) && <span className="os-wgt__rs" onPointerDown={resizeDown} />}
    </div>
  );
});

/** The layer of sticky notes / widgets above the wallpaper and the icons, below the windows. */
export default function WidgetLayer({ items, ar, focusId, bounds, onChange, onRemove, onFront }) {
  const [live, setLive] = useState(null); // { id, x?, y?, w?, h? } while dragging / resizing (committed on release)
  const onMove = (id, p, end) => { if (end) { setLive(null); onChange(id, p); } else setLive({ id, ...p }); };
  const onResize = (id, p, end) => { if (end) { setLive(null); onChange(id, p); } else setLive({ id, ...p }); };
  const cx = (v, max) => Math.max(0, Math.min(v, Math.max(0, max - 80)));
  return (
    <div className="os-widgets" dir="ltr">
      {items.map((it) => {
        const l = live && live.id === it.id ? live : null;
        const pos = { x: cx(l?.x ?? it.x, bounds.w), y: Math.max(0, Math.min(l?.y ?? it.y, Math.max(0, bounds.h - 34))) };
        const size = { w: l?.w ?? it.w, h: l?.h ?? it.h };
        return <Item key={it.id} it={it} pos={pos} size={size} ar={ar} focus={focusId === it.id} bounds={bounds} onChange={onChange} onRemove={onRemove} onFront={onFront} onMove={onMove} onResize={onResize} />;
      })}
    </div>
  );
}

function MobileItem({ it, ar, focus, onChange, onRemove }) {
  const box = useRef(null); const ta = useRef(null);
  useEffect(() => {
    if (!focus) return undefined;
    const h = setTimeout(() => { box.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); ta.current?.focus({ preventScroll: true }); }, 350); // after the "New" sheet has closed
    return () => clearTimeout(h);
  }, [focus]);
  const color = it.color || 'yellow';
  const ch = (patch) => onChange(it.id, patch);
  return (
    <div ref={box} className={`os-wgt os-wgt--${it.type}${it.type === 'note' ? ` is-${color}` : ''}`}>
      <div className="os-wgt__bar">
        {it.type === 'note' && (
          <span className="os-wgt__dots">
            {NOTE_COLORS.map((c) => <button key={c} type="button" className={`os-wgt__dot is-${c}${c === color ? ' is-on' : ''}`} onClick={() => ch({ color: c })} aria-label={c} />)}
          </span>
        )}
        <button type="button" className="os-wgt__x" onClick={() => onRemove(it)} aria-label={ar ? 'إزالة' : 'Remove'}><Icon name="x" size={12} /></button>
      </div>
      <div className="os-wgt__body">
        {it.type === 'note' && <textarea ref={ta} dir="auto" value={it.text || ''} maxLength={5000} spellCheck={false} placeholder={ar ? 'اكتب ملاحظتك هنا…' : 'Write a note…'} onChange={(e) => ch({ text: e.target.value })} />}
        {it.type === 'clock' && <ClockBody it={it} ar={ar} onChange={ch} />}
        {it.type === 'calendar' && <CalendarBody ar={ar} />}
        {it.type === 'todo' && <TodoBody it={it} ar={ar} onChange={ch} />}
      </div>
    </div>
  );
}

/** Phone home screen: the same notes / widgets as a stack of cards (no free dragging on a phone). */
export function MobileWidgets({ items, ar, focusId, onChange, onRemove }) {
  if (!items.length) return null;
  const ordered = items.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x) || (a.z || 0) - (b.z || 0));
  return (
    <section className="mos-wgts" aria-label={ar ? 'الويدجت والملاحظات' : 'Widgets and notes'}>
      {ordered.map((it) => <MobileItem key={it.id} it={it} ar={ar} focus={focusId === it.id} onChange={onChange} onRemove={onRemove} />)}
    </section>
  );
}
