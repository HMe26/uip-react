import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon';

const GROUPS = [
  { id: 'browser', en: 'Runs in the browser', ar: 'بيشتغل في المتصفح' },
  { id: 'sandbox', en: 'Server & terminal (sandbox)', ar: 'سيرفر وتيرمنال (sandbox)' },
  { id: 'unsupported', en: 'Needs a server', ar: 'محتاج سيرفر' },
];
const groupOf = (a) => (a.kind === 'sandbox' ? 'sandbox' : a.kind === 'unsupported' ? 'unsupported' : 'browser');
const iconOf = (a) => (a.kind === 'sandbox' ? 'terminal' : a.kind === 'unsupported' ? 'lock' : a.kind === 'python' ? 'play' : 'globe');

/** "React (Vite) — my-app" → { title: "React (Vite)", dir: "my-app" } (the folder is shown as a quiet second line). */
export function splitLabel(a) {
  const dir = (a.root || '').replace(/\/$/, '');
  let title = a.label || '';
  if (dir && title.endsWith(` — ${dir}`)) title = title.slice(0, -(dir.length + 3));
  return { title, dir };
}

/**
 * What to run: a themed dropdown (never the bright native <select>), grouped by where it runs, searchable when the list is
 * long (a repo with many .java / .py files lists each one), opening upward or downward — whichever has room.
 */
export function AppPicker({ tt, apps, app, onSelect }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [place, setPlace] = useState({ up: true, max: 320 });
  const wrap = useRef(null);
  const btn = useRef(null);
  const listRef = useRef(null);
  const searchable = apps.length > 6;

  const flat = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rank = (a) => (a.current ? 0 : String(a.id).startsWith('lang:') ? 2 : 1); // active file first, loose single files last
    return GROUPS.flatMap((g) => apps
      .filter((a) => groupOf(a) === g.id && (!needle || `${a.label} ${a.entry || ''}`.toLowerCase().includes(needle)))
      .map((a, i) => ({ a, i, r: rank(a) }))
      .sort((x, y) => x.r - y.r || x.i - y.i)
      .map(({ a }, k) => ({ a, g, first: k === 0 })));
  }, [apps, q]);

  const show = () => {
    const r = btn.current?.getBoundingClientRect();
    if (r) {
      const above = r.top - 12; const below = window.innerHeight - r.bottom - 12;
      const up = above >= below || above > 300;
      setPlace({ up, max: Math.max(160, Math.min(380, up ? above : below)) });
    }
    setQ(''); setHi(Math.max(0, apps.findIndex((a) => a.id === app?.id))); setOpen(true);
  };
  const close = () => { setOpen(false); btn.current?.focus({ preventScroll: true }); };
  const pick = (a) => { setOpen(false); if (a.id !== app?.id) onSelect(a.id); };

  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [open]);
  useEffect(() => { if (open) listRef.current?.querySelector('.is-hi')?.scrollIntoView({ block: 'nearest' }); }, [open, hi, flat.length]);

  const onKey = (e) => {
    if (!open) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show(); } return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(flat.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (flat[hi]) pick(flat[hi].a); }
  };

  const cur = app ? splitLabel(app) : null;
  if (apps.length <= 1) {
    return (
      <div className="zb-pick is-single">
        <span className="zb-pick__btn" title={app?.label}>
          {app && <Icon name={iconOf(app)} size={14} />}
          <span className="zb-pick__t">{cur?.title || tt('Nothing to run', 'مفيش حاجة تتشغل')}{cur?.dir && <small>{cur.dir}</small>}</span>
        </span>
      </div>
    );
  }
  return (
    <div ref={wrap} className={`zb-pick${open ? ' is-open' : ''}`} onKeyDown={onKey}>
      <button ref={btn} type="button" className="zb-pick__btn" aria-haspopup="listbox" aria-expanded={open} title={app?.label} aria-label={tt('What to run', 'اختر ما تريد تشغيله')} onClick={() => (open ? close() : show())}>
        {app && <Icon name={iconOf(app)} size={14} />}
        <span className="zb-pick__t">{cur?.title || tt('Choose what to run', 'اختر ما تريد تشغيله')}{cur?.dir && <small>{cur.dir}</small>}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      {open && (
        <div className={`zb-pick__pop ${place.up ? 'is-up' : 'is-down'}`} style={{ maxHeight: place.max }}>
          {searchable && (
            <label className="zb-pick__q">
              <Icon name="search" size={14} />
              <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} placeholder={tt('Search files & projects…', 'ابحث في الملفات والمشاريع…')} spellCheck={false} />
            </label>
          )}
          <div className="zb-pick__list" ref={listRef} role="listbox" tabIndex={-1}>
            {flat.length === 0 && <div className="zb-pick__none">{tt('Nothing matches.', 'مفيش نتيجة.')}</div>}
            {flat.map(({ a, g, first }, idx) => {
              const s = splitLabel(a);
              return (
                <div key={a.id}>
                  {first && <div className="zb-pick__g">{tt(g.en, g.ar)}<b>{flat.filter((x) => x.g.id === g.id).length}</b></div>}
                  <button
                    type="button" role="option" aria-selected={a.id === app?.id} title={a.label}
                    className={`zb-pick__o${a.id === app?.id ? ' is-on' : ''}${idx === hi ? ' is-hi' : ''}`}
                    onMouseEnter={() => setHi(idx)} onClick={() => pick(a)}
                  >
                    <Icon name={iconOf(a)} size={14} />
                    <span className="zb-pick__ot"><b>{s.title}</b>{s.dir && <small>{s.dir}</small>}</span>
                    {a.kind === 'unsupported' && <em>{tt('server', 'سيرفر')}</em>}
                    {a.id === app?.id && <Icon name="check" size={14} />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** The browser run and the sandbox run of the SAME project (sbx-web:dir ↔ web:dir …) as one switch, so the terminal / server is one tap away. */
export function ModeSwitch({ tt, apps, app, onSelect }) {
  if (!app) return null;
  const twinId = String(app.id).startsWith('sbx-') ? String(app.id).slice(4) : `sbx-${app.id}`;
  const twin = apps.find((a) => a.id === twinId);
  if (!twin) return null;
  const server = app.kind === 'sandbox';
  return (
    <div className="zb-seg" role="group" aria-label={tt('Where to run', 'مكان التشغيل')}>
      <button type="button" className={`zb-seg__b${!server ? ' is-on' : ''}`} onClick={() => server && onSelect(twin.id)} title={tt('Run inside the browser', 'شغّل جوه المتصفح')}><Icon name="globe" size={13} /><span>{tt('Browser', 'المتصفح')}</span></button>
      <button type="button" className={`zb-seg__b${server ? ' is-on' : ''}`} onClick={() => !server && onSelect(twin.id)} title={tt('Run on the sandbox server with a real terminal', 'شغّل على سيرفر الـ sandbox بتيرمنال حقيقي')}><Icon name="terminal" size={13} /><span>{tt('Server', 'السيرفر')}</span></button>
    </div>
  );
}
