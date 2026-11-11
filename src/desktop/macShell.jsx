import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon';
import { AppGlyph, UipMark } from './OsIcons';

/**
 * macOS-style shell furniture: the translucent MENU BAR on top and the floating DOCK (with magnification) at the bottom.
 * Everything here is presentational — DesktopOS owns the state and passes plain callbacks.
 */

/** Menu bar. menus: [{ id, label, bold?, logo?, items: ({ label, hint, onClick, disabled, check } | 'sep')[] }]; `tray` is the right-hand status area. */
export function MenuBar({ ar, tt, menus, tray, lead, onOpen, closeKey }) {
  const [open, setOpen] = useState(null); // menu id
  const root = useRef(null);
  const menusRef = useRef(null);
  const close = useCallback(() => setOpen(null), []);
  const onOpenRef = useRef(onOpen); onOpenRef.current = onOpen;

  // opening a menu dismisses whatever else is open (Spotlight, Mission Control, a flyout, a right-click menu)
  useEffect(() => { if (open) onOpenRef.current?.(); }, [open]);
  // ...and the other way round: when something else opens (closeKey turns non-empty), the menu goes away
  useEffect(() => { if (closeKey) setOpen(null); }, [closeKey]);

  useEffect(() => {
    if (!open) return undefined;
    // only a press ON the menu titles / the dropdown keeps it open (the tray on the same bar counts as "outside")
    const down = (e) => { if (!menusRef.current?.contains(e.target)) close(); };
    const blur = () => close(); // focus moved into an iframe (PDF / media viewer) or another tab
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const ids = menus.map((m) => m.id);
      const i = ids.indexOf(open);
      const dir = (e.key === 'ArrowRight' ? 1 : -1) * (ar ? -1 : 1);
      e.preventDefault();
      setOpen(ids[(i + dir + ids.length) % ids.length]);
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', blur); };
  }, [open, close, menus, ar]);

  return (
    <header ref={root} className="os-menubar" onContextMenu={(e) => e.preventDefault()}>
      {lead}
      <nav ref={menusRef} className="os-menubar__menus" aria-label={tt('Menu bar', 'شريط القوائم')}>
        {menus.map((m) => (
          <div key={m.id} className={`os-mb${m.logo ? ' os-mb--logo' : ''}${m.bold ? ' os-mb--bold' : ''}${m.hideSmall ? ' os-mb--opt' : ''}`}>
            <button
              type="button" className={open === m.id ? 'is-on' : ''} aria-haspopup="menu" aria-expanded={open === m.id}
              onClick={() => setOpen((o) => (o === m.id ? null : m.id))}
              onPointerEnter={() => { if (open && open !== m.id) setOpen(m.id); }}
            >
              {m.logo ? <UipMark size={15} /> : m.label}
            </button>
            {open === m.id && (
              <ul className="os-menu" role="menu">
                {m.items.map((it, i) => (it === 'sep'
                  ? <li key={`s${i}`} className="os-menu__sep" role="separator" />
                  : (
                    <li key={`${it.label}${i}`} role="none">
                      <button type="button" role="menuitem" disabled={it.disabled} onClick={() => { close(); it.onClick?.(); }}>
                        <span className="os-menu__tick">{it.check && <Icon name="check" size={12} />}</span>
                        <span className="os-menu__lbl" dir="auto">{it.label}</span>
                        {it.hint && <kbd>{it.hint}</kbd>}
                      </button>
                    </li>
                  )))}
              </ul>
            )}
          </div>
        ))}
      </nav>
      {tray}
    </header>
  );
}

const MAX_SCALE = 1.62;

/** The Dock. items: [{ key, app, label, running, active, onClick, onContext }]. */
export function Dock({ items, tt, mag, launchOn, onLaunch, onBin, binFull, binLabel, binOn, onPortal, portalLabel, onLogout, logoutLabel, onLock, lockLabel, hidden = [], onSpecialMenu }) {
  const root = useRef(null);
  const rail = useRef(null);
  const centers = useRef([]);
  const raf = useRef(0);
  const [bounce, setBounce] = useState(null);
  const [base, setBase] = useState(() => (typeof window !== 'undefined' && window.innerWidth < 560 ? 40 : 52));
  useEffect(() => {
    const h = () => setBase(window.innerWidth < 560 ? 40 : 52);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const hiddenSig = hidden.join('|');
  // an icon was removed / restored: drop any stale magnification so the rail re-measures cleanly
  useEffect(() => { reset(); }, [hiddenSig, items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!bounce) return undefined; const h = setTimeout(() => setBounce(null), 1300); return () => clearTimeout(h); }, [bounce]);

  const cells = () => [...(rail.current?.querySelectorAll('[data-dk]') || [])];
  const measure = () => {
    const r = rail.current; if (!r) return;
    centers.current = cells().map((el) => el.offsetLeft + el.offsetWidth / 2 - r.offsetWidth / 2);
  };
  const reset = () => {
    cancelAnimationFrame(raf.current);
    root.current?.classList.remove('is-mag');
    root.current?.style.removeProperty('--extra');
    cells().forEach((el) => { el.style.transform = ''; el.style.setProperty('--s', 1); const g = el.querySelector('.os-dock__g'); if (g) g.style.transform = ''; });
  };
  const apply = (x) => {
    const r = rail.current; if (!r) return;
    const rr = r.getBoundingClientRect();
    const mid = rr.left + rr.width / 2;
    const range = base * 2.7;
    const sc = centers.current.map((c) => {
      const d = Math.abs(x - mid - c);
      return d >= range ? 1 : 1 + (MAX_SCALE - 1) * (0.5 + 0.5 * Math.cos((Math.PI * d) / range));
    });
    const extra = sc.map((s) => (s - 1) * (base + 8));
    const total = extra.reduce((a, b) => a + b, 0);
    const els = cells();
    // accumulate left -> right in SCREEN order (the DOM order is reversed in RTL)
    const order = sc.map((_, i) => i).sort((a, b) => centers.current[a] - centers.current[b]);
    const offs = []; let acc = 0;
    order.forEach((i) => { offs[i] = acc + extra[i] / 2 - total / 2; acc += extra[i]; });
    root.current.classList.add('is-mag');
    root.current.style.setProperty('--extra', `${total}px`);
    els.forEach((el, i) => {
      el.style.transform = `translateX(${offs[i].toFixed(1)}px)`;
      el.style.setProperty('--s', sc[i].toFixed(3));
      const g = el.querySelector('.os-dock__g'); if (g) g.style.transform = `scale(${sc[i].toFixed(3)})`;
    });
  };
  const onMove = (e) => {
    if (!mag || e.pointerType !== 'mouse') return;
    const x = e.clientX;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => apply(x));
  };

  const click = (it, e) => { if (!it.running) setBounce(it.key); it.onClick(e); };

  return (
    <div ref={root} className="os-dock" style={{ '--base': `${base}px` }} onPointerEnter={() => { if (mag) measure(); }} onPointerMove={onMove} onPointerLeave={reset} onContextMenu={(e) => e.preventDefault()}>
      <div ref={rail} className="os-dock__rail" role="toolbar" aria-label="Dock">
        {!hidden.includes('launchpad') && (
          <button type="button" data-dk className={`os-dock__it os-startbtn${launchOn ? ' is-on' : ''}`} style={{ width: base + 8, height: base }} onClick={onLaunch} onContextMenu={(e) => onSpecialMenu?.('launchpad', e)} aria-label={tt('Launchpad (Alt+S)', 'لوحة التطبيقات (Alt+S)')}>
            <span className="os-dock__g" style={{ width: base, height: base }}><AppGlyph app="launchpad" size={base} /></span>
            <span className="os-dock__tip">{tt('Launchpad', 'لوحة التطبيقات')}</span>
          </button>
        )}
        {items.map((it, i) => (
          <button
            key={it.key} type="button" data-dk style={{ width: base + 8, height: base }}
            className={`os-dock__it${it.running ? ' is-run' : ''}${it.active ? ' is-front' : ''}`}
            onClick={(e) => click(it, e)} onContextMenu={it.onContext}
            onAuxClick={(e) => { if (e.button === 1) it.onMiddle?.(); }}
            aria-label={it.label}
          >
            <span className={`os-dock__g${bounce === it.key ? ' is-bounce' : ''}`} style={{ width: base, height: base }}><AppGlyph app={it.app} size={base} /></span>
            <i className="os-dock__dot" />
            <span className="os-dock__tip" dir="auto">{it.label}{i < 9 ? <small>⌥{i + 1}</small> : null}</span>
          </button>
        ))}
        {(items.length > 0 || !hidden.includes('launchpad')) && (!hidden.includes('lock') || !hidden.includes('portal') || !hidden.includes('bin') || (onLogout && !hidden.includes('logout'))) && <i data-dk className="os-dock__sep" aria-hidden="true" />}
        {onLock && !hidden.includes('lock') && (
          <button type="button" data-dk className="os-dock__it" style={{ width: base + 8, height: base }} onClick={onLock} onContextMenu={(e) => onSpecialMenu?.('lock', e)} aria-label={lockLabel}>
            <span className="os-dock__g" style={{ width: base, height: base }}><AppGlyph app="lock" size={base} /></span>
            <i className="os-dock__dot" />
            <span className="os-dock__tip" dir="auto">{lockLabel}</span>
          </button>
        )}
        {onPortal && !hidden.includes('portal') && (
          <button type="button" data-dk className="os-dock__it" style={{ width: base + 8, height: base }} onClick={onPortal} onContextMenu={(e) => onSpecialMenu?.('portal', e)} aria-label={portalLabel}>
            <span className="os-dock__g" style={{ width: base, height: base }}><AppGlyph app="portal" size={base} /></span>
            <i className="os-dock__dot" />
            <span className="os-dock__tip" dir="auto">{portalLabel}</span>
          </button>
        )}
        {onLogout && !hidden.includes('logout') && (
          <button type="button" data-dk className="os-dock__it" style={{ width: base + 8, height: base }} onClick={onLogout} onContextMenu={(e) => onSpecialMenu?.('logout', e)} aria-label={logoutLabel}>
            <span className="os-dock__g" style={{ width: base, height: base }}><AppGlyph app="logout" size={base} /></span>
            <i className="os-dock__dot" />
            <span className="os-dock__tip" dir="auto">{logoutLabel}</span>
          </button>
        )}
        {!hidden.includes('bin') && (
          <button type="button" data-dk className={`os-dock__it${binOn ? ' is-run' : ''}`} style={{ width: base + 8, height: base }} onClick={onBin} onContextMenu={(e) => onSpecialMenu?.('bin', e)} aria-label={binLabel}>
            <span className="os-dock__g" style={{ width: base, height: base }}><AppGlyph app="bin" size={base} full={binFull} /></span>
            <i className="os-dock__dot" />
            <span className="os-dock__tip" dir="auto">{binLabel}</span>
          </button>
        )}
      </div>
    </div>
  );
}
