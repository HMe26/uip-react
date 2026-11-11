import { memo, useMemo, useState } from 'react';
import Icon from '../components/Icon';
import { AppGlyph } from './OsIcons';
import './navSidebar.css';

/** Width of the pinned sidebar (keep in sync with --nav-w in navSidebar.css). */
export const NAV_W = 288;

/**
 * Navigation panel: every app / page of the platform in one list (grouped like the portal's sidebar), the windows that are open right
 * now, and a search box.
 *
 *   variant 'side'   desktop sidebar — pinned it sits beside the windows, unpinned it floats over them and closes after you pick something
 *   variant 'sheet'  phone — the same content, rendered inside a bottom sheet (no pin, always closes after a pick)
 *
 *   apps    [{ id, en, ar, glyph, group: { en, ar } }]
 *   wins    [{ id, app, label, active, min }]   windows of the current desktop
 */
function NavSidebar({ ar, tt, apps, wins, pinned, collapsed, variant = 'side', onToggleGroup, onOpenApp, onFocusWin, onCloseWin, onTogglePin, onClose, onDesktop, onSpotlight }) {
  const sheet = variant === 'sheet';
  const float = sheet || !pinned; // closes itself after a pick
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const runningApps = useMemo(() => new Set(wins.map((w) => w.app)), [wins]);

  const groups = useMemo(() => {
    const map = new Map();
    apps.forEach((a) => {
      if (needle && !`${a.en} ${a.ar}`.toLowerCase().includes(needle)) return;
      const key = a.group?.en || 'Apps';
      if (!map.has(key)) map.set(key, { key, title: ar ? (a.group?.ar || key) : key, items: [] });
      map.get(key).items.push(a);
    });
    return [...map.values()];
  }, [apps, needle, ar]);

  const total = apps.length;
  const activeApp = wins.find((w) => w.active)?.app;
  const done = () => { if (float) onClose(); };
  const pick = (a) => { onOpenApp(a); done(); };
  const label = (a) => (ar ? a.ar : a.en);

  const body = (
    <>
      <div className="os-nav__head">
        <span className="os-nav__mark" aria-hidden="true"><Icon name="grid" size={17} /></span>
        <div className="os-nav__title">
          <strong>{tt('Navigate', 'التنقل')}</strong>
          <small>{tt(`${total} pages & apps`, `${total} صفحة وتطبيق`)}</small>
        </div>
        {!sheet && (
          <button type="button" className={`os-nav__ib${pinned ? ' is-on' : ''}`} onClick={onTogglePin} aria-pressed={pinned}
            title={pinned ? tt('Unpin (float over windows)', 'إلغاء التثبيت (يطفو فوق النوافذ)') : tt('Pin (keep beside windows)', 'تثبيت (يفضل جنب النوافذ)')}><Icon name="pin" size={15} /></button>
        )}
        <button type="button" className="os-nav__ib" onClick={onClose} title={sheet ? tt('Close', 'إغلاق') : `${tt('Close', 'إغلاق')} · Alt+A`} aria-label={tt('Close', 'إغلاق')}><Icon name="x" size={16} /></button>
      </div>

      <label className="os-nav__search">
        <Icon name="search" size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tt('Find a page or app…', 'دوّر على صفحة أو تطبيق…')} dir="auto" enterKeyHint="go"
          onKeyDown={(e) => { if (e.key === 'Enter' && groups[0]?.items[0]) pick(groups[0].items[0]); }} />
        {q && <button type="button" onClick={() => setQ('')} aria-label={tt('Clear', 'مسح')}><Icon name="x" size={14} /></button>}
      </label>

      <div className="os-nav__scroll">
        {!needle && wins.length > 0 && (
          <section className="os-nav__sec">
            <h4 className="os-nav__h"><span>{tt('Open now', 'المفتوح دلوقتي')}</span><i>{wins.length}</i></h4>
            <div className="os-nav__card">
              {wins.map((w) => (
                <div key={w.id} className={`os-nav__row os-nav__row--win${w.active ? ' is-active' : ''}${w.min ? ' is-min' : ''}`}>
                  <button type="button" className="os-nav__go" onClick={() => { onFocusWin(w.id); done(); }} title={w.label}>
                    <span className="os-nav__ic"><AppGlyph app={w.app} size={28} /></span>
                    <span className="os-nav__lb" dir="auto">{w.label}</span>
                  </button>
                  <button type="button" className="os-nav__x" onClick={() => onCloseWin(w.id)} aria-label={tt('Close window', 'إغلاق النافذة')} title={tt('Close window', 'إغلاق النافذة')}><Icon name="x" size={13} /></button>
                </div>
              ))}
            </div>
          </section>
        )}

        {groups.map((g) => {
          const shut = !needle && collapsed.includes(g.key);
          return (
            <section key={g.key} className="os-nav__sec">
              <button type="button" className="os-nav__h os-nav__gh" aria-expanded={!shut} onClick={() => onToggleGroup(g.key)}>
                <span>{g.title}</span><i>{g.items.length}</i><Icon name="chevron-down" size={14} />
              </button>
              {!shut && (
                <div className="os-nav__card">
                  {g.items.map((a) => (
                    <div key={a.id} className={`os-nav__row${activeApp === a.id ? ' is-active' : ''}`}>
                      <button type="button" className="os-nav__go" onClick={() => pick(a)} title={label(a)}>
                        <span className="os-nav__ic"><AppGlyph app={a.glyph || a.id} size={28} /></span>
                        <span className="os-nav__lb" dir="auto">{label(a)}</span>
                        {runningApps.has(a.id) && <b className="os-nav__dot" title={tt('Open', 'مفتوح')} aria-label={tt('Open', 'مفتوح')} />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
        {needle && groups.length === 0 && <p className="os-nav__none"><Icon name="search" size={22} />{tt('Nothing matches', 'مفيش نتائج')}</p>}
      </div>

      <div className="os-nav__foot">
        <button type="button" onClick={() => { onDesktop(); done(); }}><Icon name="monitor" size={16} />{sheet ? tt('Home', 'الشاشة الرئيسية') : tt('Desktop', 'سطح المكتب')}</button>
        <button type="button" onClick={() => { onSpotlight(); done(); }}><Icon name="search" size={16} />{tt('Quick search', 'بحث سريع')}</button>
      </div>
    </>
  );

  if (sheet) return <div className="os-nav os-nav--sheet" dir={ar ? 'rtl' : 'ltr'} aria-label={tt('Navigation', 'التنقل')}>{body}</div>;

  return (
    <>
      {!pinned && <div className="os-nav__scrim" onPointerDown={onClose} aria-hidden="true" />}
      <aside className={`os-nav${pinned ? ' is-pinned' : ''}`} dir={ar ? 'rtl' : 'ltr'} aria-label={tt('Navigation', 'التنقل')}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        {body}
      </aside>
    </>
  );
}

export default memo(NavSidebar);
