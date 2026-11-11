import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../Icon';

/**
 * Floating menu (context menu, "Add" menu, theme picker). Positioned against the workbench root so it
 * works inside transformed modals. Closes on outside click / Escape / scroll; arrow keys move the focus.
 * items: [{ label, icon, onClick, danger, disabled, checked, swatch:[c1,c2,c3], hint }, { sep:true }]
 */
export default function Menu({ x, y, items, onClose, hostRef, title }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    const el = ref.current;
    const host = hostRef?.current;
    if (!el || !host) return;
    const hb = host.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(6, Math.min(x - hb.left, hb.width - w - 6));
    const top = Math.max(6, Math.min(y - hb.top, hb.height - h - 6));
    setPos({ left, top });
  }, [x, y, hostRef, items]);

  useEffect(() => {
    const first = ref.current?.querySelector('button:not(:disabled)');
    first?.focus({ preventScroll: true });
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('touchstart', down, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('touchstart', down, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const onKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const btns = [...ref.current.querySelectorAll('button:not(:disabled)')];
    const i = btns.indexOf(document.activeElement);
    const n = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
    btns[n]?.focus();
  };

  return (
    <div ref={ref} className="zb-menu" style={pos} role="menu" onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
      {title && <div className="zb-menu__title">{title}</div>}
      {items.map((it, i) => (it.sep ? <div key={`s${i}`} className="zb-menu__sep" /> : (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          className={`zb-menu__item${it.danger ? ' is-danger' : ''}${it.checked ? ' is-checked' : ''}`}
          disabled={it.disabled}
          onClick={() => { onClose(); it.onClick?.(); }}
        >
          {it.swatch
            ? <span className="zb-sw" style={{ background: it.swatch[0] }}><i style={{ background: it.swatch[1] }} /><i style={{ background: it.swatch[2] }} /></span>
            : <span className="zb-menu__ico">{it.icon && <Icon name={it.icon} size={15} />}</span>}
          <span className="zb-menu__label">{it.label}{it.hint && <small>{it.hint}</small>}</span>
          {it.checked && <Icon name="check" size={14} />}
        </button>
      )))}
    </div>
  );
}
