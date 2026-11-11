import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import { Btn } from './EditorUI';
import '../../styles/css/pptx.css';

/** Ribbon building blocks shared by the Word ribbon (same look as the PowerPoint ribbon: styles/css/pptx.css .pxr*). */
const STD = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];
const THEME_KEYS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
export const keep = (e) => { if (!/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) e.preventDefault(); }; // keep the text selection while clicking the ribbon
const FONTS = ['Arial', 'Calibri', 'Cambria', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Tahoma', 'Segoe UI', 'Impact', 'Comic Sans MS', 'Trebuchet MS', 'Cairo', 'Noto Naskh Arabic'];
const ZOOMS = [[0.5, '50%'], [0.75, '75%'], [1, 'Fit'], [1.5, '150%'], [2, '200%'], [3, '300%']];
const cm = (v) => Math.round((v / 360000) * 100) / 100;

export function B({ icon, label, onClick, on, disabled, children, className }) {
  return <Btn icon={icon} title={label} onClick={onClick} active={on} disabled={disabled} className={`pxr__b ${className || ''}`} onMouseDown={keep}>{children}</Btn>;
}
export const Grp = ({ title, children }) => <div className="pxr__g"><div className="pxr__row">{children}</div><span className="pxr__lbl">{title}</span></div>;

/** A dropdown panel rendered inside the editor frame (the ribbon scrolls, so it cannot host the panel itself). */
export function Pop({ icon, label, text, children, extra }) {
  const [open, setOpen] = useState(false); const [pos, setPos] = useState(null); const btn = useRef(null); const panel = useRef(null);
  const toggle = () => {
    if (!open) { const ed = btn.current.closest('.ed'); const r = btn.current.getBoundingClientRect(); const er = ed.getBoundingClientRect(); setPos({ ed, left: Math.max(4, Math.min(r.left - er.left, er.width - 280)), top: r.bottom - er.top + 4 }); }
    setOpen(!open);
  };
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (!panel.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', h); return () => document.removeEventListener('pointerdown', h);
  }, [open]);
  return (
    <span ref={btn} className="pxr__pw">
      <Btn icon={icon} title={label} active={open} onClick={toggle} className="pxr__b" onMouseDown={keep}>{text && <span>{text}</span>}{extra}<Icon name="chevron-down" size={11} /></Btn>
      {open && pos && createPortal(<div ref={panel} className="pxr__pop" data-px-keep style={{ left: pos.left, top: pos.top }} onMouseDown={keep}>{children(() => setOpen(false))}</div>, pos.ed)}
    </span>
  );
}
export function ColorBtn({ icon, label, color, onPick, theme, noneLabel }) {
  const th = THEME_KEYS.map((k) => theme?.[k]).filter(Boolean);
  const sw = (c, close) => <button key={c} type="button" className="pxr__sw" style={{ background: c }} title={c} onClick={() => { onPick(c); close(); }} />;
  return (
    <Pop icon={icon} label={label} extra={<i className="pxr__cur" style={{ background: color || 'transparent' }} />}>
      {(close) => (
        <div className="pxr__pal">
          {th.length > 0 && <><small>Theme</small><div className="pxr__sws">{th.map((c) => sw(c, close))}</div></>}
          <small>Standard</small><div className="pxr__sws">{STD.map((c) => sw(c, close))}</div>
          {noneLabel && <button type="button" className="pxr__none" onClick={() => { onPick(null); close(); }}>{noneLabel}</button>}
          <label className="pxr__custom"><span>Custom</span><input type="color" value={/^#[0-9a-f]{6}$/i.test(color || '') ? color : '#000000'} onChange={(e) => onPick(e.target.value)} /></label>
        </div>
      )}
    </Pop>
  );
}
export function NumField({ value, onCommit, step = 0.1, min, width = 58, title }) {
  return <input key={String(value)} className="pxr__num" type="number" step={step} min={min} defaultValue={value ?? ''} title={title} aria-label={title} style={{ width }}
    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); }} onBlur={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v) && v !== value) onCommit(v); }} />;
}
