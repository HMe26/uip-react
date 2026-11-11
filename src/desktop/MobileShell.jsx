import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon';
import { drive } from '../lib/driveApi';
import { errorMessage } from '../api/client';
import { useBackLayer } from '../lib/backStack';
import { AppGlyph } from './OsIcons';
import { BatteryGlyph, WifiGlyph } from './flyouts';
import { NotifList } from './NotificationCenter';
import { Clock, NodeGlyph } from './shell';
import { APPS } from './apps';
import { winTitle } from './wm';
import { MobileWidgets } from './Widgets';
import NavSidebar from './NavSidebar';
import { useVirtualMode } from '../virtual/virtualMode';
import { isVmApp } from '../virtual/catalog';
import PhoneClock from './MobileClock';
import MobilePrefs, { MOBILE_DEFAULTS } from './MobilePrefs';
import ContentMatches from '../components/ContentMatches';
import { useContentSearch } from '../lib/useContentSearch';
import './mobile.css';

export { useIsMobileOS } from './useIsMobileOS';

/* ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
   UIPE Mobile — a purpose-built phone interface for My PC (not a squeezed desktop):
   status bar · home screen (widget, search, app + file grid) · dock · full-screen apps with their own app bar ·
   gesture bar (tap / swipe up = home, long swipe = app switcher) · bottom sheets (new, item actions, move, control centre, search) ·
   long-press + multi-select instead of right-click / drag. All data / actions come from <DesktopOS> (same drive API, same windows).
   ────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

const GLYPH_SIZES = { s: 46, m: 56, l: 66 };
const buzz = (on, ms = 8) => { if (on) navigator.vibrate?.(ms); };

/** Tap + long-press (touch friendly; the native context menu is suppressed). */
function usePress(onTap, onLong) {
  const timer = useRef(null); const start = useRef(null); const fired = useRef(false);
  const clear = () => { clearTimeout(timer.current); timer.current = null; };
  return {
    onPointerDown: (e) => {
      if (e.button) return;
      fired.current = false; start.current = { x: e.clientX, y: e.clientY }; clear();
      if (onLong) timer.current = setTimeout(() => { fired.current = true; navigator.vibrate?.(12); onLong(e); }, 430);
    },
    onPointerMove: (e) => { if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 9) clear(); },
    onPointerUp: clear, onPointerCancel: clear, onPointerLeave: clear,
    onContextMenu: (e) => { e.preventDefault(); },
    onClick: (e) => { if (fired.current) { fired.current = false; return; } onTap?.(e); },
  };
}

function HomeIcon({ label, glyph, onTap, onLong, checked, selecting, cut }) {
  const press = usePress(onTap, onLong);
  return (
    <button type="button" className={`mos-ic${checked ? ' is-sel' : ''}${cut ? ' is-cut' : ''}`} {...press}>
      <span className="mos-ic__g">{glyph}</span>
      <span className="mos-ic__l" dir="auto">{label}</span>
      {selecting && <i className="mos-ic__chk" aria-hidden="true">{checked && <Icon name="check" size={13} />}</i>}
    </button>
  );
}

/** Bottom sheet: dim backdrop, grab handle (drag down to dismiss), Android / browser Back closes it. */
function Sheet({ title, onClose, tall, children }) {
  useBackLayer(true, onClose);
  const [dy, setDy] = useState(0); const drag = useRef(null);
  const down = (e) => { drag.current = { y: e.clientY }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const move = (e) => { if (drag.current) setDy(Math.max(0, e.clientY - drag.current.y)); };
  const up = () => { const d = dy; drag.current = null; if (d > 90) onClose(); else setDy(0); };
  return (
    <div className="mos-sheetwrap">
      <div className="mos-scrim" onPointerDown={onClose} />
      <div className={`mos-sheet${tall ? ' is-tall' : ''}`} role="dialog" aria-modal="true" aria-label={title || undefined} style={dy ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined}>
        <div className="mos-sheet__grab" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}><i /></div>
        {title && <h3 className="mos-sheet__t" dir="auto">{title}</h3>}
        <div className="mos-sheet__body">{children}</div>
      </div>
    </div>
  );
}

const Row = ({ icon, label, sub, danger, disabled, onClick, right }) => (
  <button type="button" className={`mos-row${danger ? ' is-danger' : ''}`} disabled={disabled} onClick={onClick}>
    <span className="mos-row__ic">{typeof icon === 'string' ? <Icon name={icon} size={19} /> : icon}</span>
    <span className="mos-row__tx"><b dir="auto">{label}</b>{sub && <small dir="auto">{sub}</small>}</span>
    {right}
  </button>
);

/** App switcher: one card per open app / file; swipe a card up (or tap ✕) to close it. */
function Switcher({ list, ar, tt, activeId, onPick, onClose, onCloseAll, onDone }) {
  useBackLayer(true, onDone);
  const [drag, setDrag] = useState(null);
  const st = useRef(null);
  const down = (e, id) => { st.current = { id, y: e.clientY, x: e.clientX, mode: null }; };
  const move = (e) => {
    const s = st.current; if (!s) return;
    const dy = e.clientY - s.y; const dx = e.clientX - s.x;
    if (!s.mode && (Math.abs(dy) > 10 || Math.abs(dx) > 10)) s.mode = Math.abs(dy) > Math.abs(dx) && dy < 0 ? 'v' : 'h';
    if (s.mode === 'v') { e.currentTarget.setPointerCapture?.(e.pointerId); setDrag({ id: s.id, dy: Math.min(0, dy) }); }
  };
  const up = () => {
    const s = st.current; st.current = null;
    if (s?.mode === 'v' && drag && drag.dy < -90) onClose(s.id);
    setDrag(null);
    return s;
  };
  return (
    <div className="mos-switch" role="dialog" aria-label={tt('Open apps', 'التطبيقات المفتوحة')}>
      <div className="mos-switch__top">
        <strong>{tt('Open apps', 'التطبيقات المفتوحة')}</strong>
        {list.length > 0 && <button type="button" onClick={onCloseAll}>{tt('Close all', 'إغلاق الكل')}</button>}
      </div>
      {list.length === 0 ? <p className="mos-switch__none">{tt('No apps are open.', 'مفيش تطبيقات مفتوحة.')}</p> : (
        <div className="mos-switch__rail">
          {list.map((w) => {
            const d = drag?.id === w.id ? drag.dy : 0;
            return (
              <div key={w.id} className={`mos-card${w.id === activeId ? ' is-active' : ''}`} style={d ? { transform: `translateY(${d}px)`, opacity: 1 + d / 260, transition: 'none' } : undefined}
                onPointerDown={(e) => down(e, w.id)} onPointerMove={move} onPointerUp={() => { const s = up(); if (!s?.mode) onPick(w.id); }} onPointerCancel={up}>
                <div className="mos-card__bar">
                  <AppGlyph app={w.app} size={22} />
                  <span dir="auto">{winTitle(w, APPS, ar)}</span>
                  <button type="button" aria-label={tt('Close', 'إغلاق')} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onClose(w.id); }}><Icon name="x" size={16} /></button>
                </div>
                <div className="mos-card__body"><AppGlyph app={w.app} size={72} /><small dir="auto">{w.app === 'viewer' || w.app === 'editor' ? (ar ? APPS[w.app].ar : APPS[w.app].en) : ''}</small></div>
              </div>
            );
          })}
        </div>
      )}
      <button type="button" className="mos-switch__home" onClick={onDone}>{tt('Home', 'الرئيسية')}</button>
    </div>
  );
}

export default function MobileShell(p) {
  const {
    ar, tt, user, desk, deskItems, wm, dispatch, bodyOf, openNode, openExplorer, runCommand, flash, reloadDesk, hideLocal, refreshAll,
    clip, copyNodes, pasteInto, trashNodes, renameNode, newFolder, newFile, newDoc, battery, online, theme, toggleTheme, toggleLocale,
    brightness, setBrightness, fullscreen, fs, wallpaper, lightWp,
    shortcuts = [], onShortcutOpen, onShortcutRemove,
    widgets = [], newWidgetId = null, onWidgetAdd, onWidgetChange, onWidgetRemove,
    nc = null, onOpenNotif, onAllNotif, aiEnabled = false, prefs = null, setPrefs = () => {},
    vmApps = [], // virtual mode: the platform's pages ([{ id, en, ar, group }]) — they are apps of this phone too
  } = p;

  const vm = useVirtualMode(); // UIPE OS: the whole platform as apps of this phone
  const pv = (k) => (prefs && prefs[k] !== undefined ? prefs[k] : MOBILE_DEFAULTS[k]);
  const pages = pv('mHome') === 'pages';
  const gs = GLYPH_SIZES[pv('mIcon')] || 56;
  const haptics = !!pv('mHaptics');
  const island = !!pv('mIsland');
  const [vmErr, setVmErr] = useState('');
  const showPlatform = vm.supported && (vm.available || vm.enabled);
  const [navCollapsed, setNavCollapsed] = useState([]);
  const [sheet, setSheet] = useState(null); // { type: 'new' | 'item' | 'move' | 'cc' | 'search' | 'desk', node?, nodes? }
  const [switcher, setSwitcher] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selIds, setSelIds] = useState(() => new Set());
  const fileRef = useRef(null);
  const closeSheet = useCallback(() => setSheet(null), []);

  // ---- which app is on screen ------------------------------------------------------------------------------
  const cur = wm.list.find((w) => w.id === wm.active && !w.min) || null;
  const goHome = useCallback(() => { setSwitcher(false); wm.list.filter((w) => !w.min).forEach((w) => dispatch({ type: 'minimize', id: w.id })); }, [wm.list, dispatch]);
  const back = useCallback(() => {
    if (!cur) return;
    if (cur.app === 'viewer' || cur.app === 'editor') dispatch({ type: 'close', id: cur.id }); // a file opened from another app: back = return to it
    else goHome();
  }, [cur, dispatch, goHome]);
  // Platform pages are whole pages with their own polling / realtime listeners: keeping ALL of them alive behind the one on screen is what made the phone crawl.
  // Only the two most recently used stay mounted (instant switch back); older ones are released and rebuilt on their last page when opened again.
  const warm = useMemo(() => new Set(wm.list.filter((w) => isVmApp(w.app)).sort((a, b) => b.z - a.z).slice(0, 2).map((w) => w.id)), [wm.list]);
  useBackLayer(!!cur && !switcher && !sheet, back);
  useBackLayer(selecting && !cur && !sheet, () => { setSelecting(false); setSelIds(new Set()); });
  useEffect(() => { if (cur) { setSelecting(false); setSelIds(new Set()); } }, [cur?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- home content ---------------------------------------------------------------------------------------
  const sysApps = useMemo(() => [
    ...(aiEnabled ? [{ key: 'ai', app: 'ai', label: tt('UIPE AI Assistant', 'مساعد UIPE الذكي'), run: () => runCommand('ai') }] : []),
    { key: 'explorer', app: 'explorer', label: tt('This PC', 'جهازي'), run: () => openExplorer({}) },
    { key: 'bin', app: 'bin', label: tt('Recycle Bin', 'سلة المحذوفات'), run: () => openExplorer({ view: 'trash' }) },
    { key: 'settings', app: 'settings', label: tt('Settings', 'الإعدادات'), run: () => runCommand('settings') },
    { key: 'personalize', app: 'personalize', label: tt('Personalize', 'التخصيص'), run: () => runCommand('personalize') },
    { key: 'notes', app: 'notes', label: tt('Notes', 'الملاحظات'), run: () => runCommand('notes') },
    { key: 'calendar', app: 'calendar', label: tt('Calendar', 'التقويم'), run: () => runCommand('calendar') },
    { key: 'calculator', app: 'calculator', label: tt('Calculator', 'الآلة الحاسبة'), run: () => runCommand('calculator') },
    { key: 'terminal', app: 'terminal', label: tt('UIPE Terminal', 'ترمينال UIPE'), run: () => runCommand('terminal') },
    { key: 'vscode', app: 'vscode', label: tt('VS Code', 'VS Code'), run: () => runCommand('vscode') },
    { key: 'browser', app: 'browser', label: tt('Browser', 'المتصفح'), run: () => runCommand('browser') },
    { key: 'taskmgr', app: 'taskmgr', label: tt('Task Manager', 'مدير المهام'), run: () => runCommand('taskmgr') },
    { key: 'portal', app: 'portal', label: tt('UIPE Portal', 'بوابة UIPE'), run: () => runCommand('portal') },
  ], [tt, openExplorer, runCommand, aiEnabled]);
  // platform pages as phone apps, grouped like the portal's sidebar; the Dock keeps the four you reach for most
  const vmItems = useMemo(() => vmApps.map((a) => ({ key: a.id, app: a.id, label: ar ? a.ar : a.en, group: a.group, run: () => runCommand(a.id) })), [vmApps, ar, runCommand]);
  const vmGroups = useMemo(() => {
    const m = new Map();
    vmItems.forEach((a) => { const k = a.group?.en || 'Apps'; if (!m.has(k)) m.set(k, { k, title: ar ? (a.group?.ar || k) : k, items: [] }); m.get(k).items.push(a); });
    return [...m.values()];
  }, [vmItems, ar]);
  const navApps = useMemo(() => [
    ...vmApps.map((a) => ({ id: a.id, en: a.en, ar: a.ar, glyph: a.id, group: a.group })),
    ...sysApps.filter((a) => a.key !== 'portal').map((a) => ({ id: a.key, en: a.label, ar: a.label, glyph: a.app, group: { en: 'My PC & tools', ar: 'جهازي والأدوات' } })),
  ], [vmApps, sysApps]);
  const navWins = useMemo(() => wm.list.map((w) => ({ id: w.id, app: w.app, label: winTitle(w, APPS, ar), active: wm.active === w.id && !w.min, min: !!w.min })), [wm.list, wm.active, ar]);
  const runNavApp = useCallback((a) => { const it = [...vmItems, ...sysApps].find((x) => x.key === a.id); if (it) it.run(); }, [vmItems, sysApps]);
  const toggleNavGroup = useCallback((k) => setNavCollapsed((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k])), []);
  const switchPlatform = useCallback(async (on) => {
    setVmErr('');
    try { await vm.setEnabled(on); setSheet(on ? { type: 'nav' } : null); } catch (e) { setVmErr(e?.message || tt('Could not change the mode. Try again.', 'مقدرناش نغيّر الوضع. جرّب تاني.')); }
  }, [vm, tt]);
  const openPlatform = () => { setVmErr(''); setSheet({ type: vm.enabled ? 'nav' : 'uipos' }); };
  // ---- Dynamic Island: a pill that grows when a notification arrives (or when tapped) ----------------------------
  const [islandOpen, setIslandOpen] = useState(false);
  const lastUnread = useRef(nc?.unread || 0);
  const islandTimer = useRef(null);
  const popIsland = useCallback((ms = 3200) => { setIslandOpen(true); clearTimeout(islandTimer.current); islandTimer.current = setTimeout(() => setIslandOpen(false), ms); }, []);
  useEffect(() => { const u = nc?.unread || 0; if (u > lastUnread.current && island) { popIsland(); buzz(haptics, 14); } lastUnread.current = u; }, [nc?.unread, island, haptics, popIsland]);
  useEffect(() => () => clearTimeout(islandTimer.current), []);
  const files = useMemo(() => [...deskItems].sort((a, b) => (a.type === b.type ? String(a.name).localeCompare(String(b.name), undefined, { numeric: true }) : a.type === 'folder' ? -1 : 1)), [deskItems]);
  const folders = useMemo(() => files.filter((n) => n.type === 'folder'), [files]);
  const nodesOf = useCallback((ids) => files.filter((n) => ids.has(n.id)), [files]);
  const selNodes = useMemo(() => nodesOf(selIds), [nodesOf, selIds]);
  const usage = desk.usage;
  const dockApps = vmItems.length
    ? [...['vm:dashboard', 'vm:courses', 'vm:messages'].map((id) => vmItems.find((a) => a.key === id)).filter(Boolean), sysApps.find((a) => a.key === 'ai') || sysApps.find((a) => a.key === 'explorer')].filter(Boolean)
    : sysApps.filter((a) => ['ai', 'explorer', 'settings', 'portal'].includes(a.key));

  const toggleSel = (id) => setSelIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); if (!n.size) setSelecting(false); return n; });
  const endSelect = () => { setSelecting(false); setSelIds(new Set()); };

  // ---- actions (all optimistic, like the desktop) -----------------------------------------------------------
  const moveNodes = useCallback(async (nodes, folder) => {
    if (!nodes.length || !folder) return;
    hideLocal(nodes.map((n) => n.id));
    flash(tt(`Moved into “${folder.name}”.`, `تم النقل إلى «${folder.name}».`));
    try { await drive.move(nodes.map((n) => n.id), folder.id); window.dispatchEvent(new Event('uip-drive-changed')); } catch (e) { flash(errorMessage(e), 'error'); reloadDesk(); }
  }, [flash, hideLocal, reloadDesk, tt]);
  const upload = useCallback(async (list) => {
    const fl = [...(list || [])];
    if (!fl.length || !desk.id) return;
    flash(tt(`Uploading ${fl.length} file(s)…`, `جارٍ رفع ${fl.length} ملف…`));
    let bad = 0;
    for (const f of fl) { try { await drive.upload(desk.id, f, null); } catch { bad += 1; } } // eslint-disable-line no-await-in-loop
    flash(bad ? tt(`${bad} file(s) could not be uploaded.`, `${bad} ملف مترفعش.`) : tt('Files added.', 'تمت إضافة الملفات.'), bad ? 'error' : 'ok');
    window.dispatchEvent(new Event('uip-drive-changed'));
  }, [desk.id, flash, tt]);
  const tapNode = (n) => { if (selecting) toggleSel(n.id); else openNode(n); };
  const longNode = (n) => { if (selecting) { toggleSel(n.id); return; } setSheet({ type: 'item', node: n }); };
  const after = (fn) => () => { setSheet(null); fn(); };

  // ---- gesture bar: tap / swipe up = home · long swipe up = app switcher -------------------------------------
  const gest = useRef(null);
  const gDown = (e) => { gest.current = { y: e.clientY }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const gUp = (e) => {
    const g = gest.current; gest.current = null; if (!g) return;
    const dy = g.y - e.clientY;
    if (dy > 150) setSwitcher(true);
    else if (dy > 36 || Math.abs(dy) < 6) { if (switcher) setSwitcher(false); else if (cur) goHome(); else if (dy > 36 && wm.list.length) setSwitcher(true); }
  };

  const ccTiles = [
    { icon: theme === 'dark' ? 'moon' : 'sun', label: tt('Dark mode', 'المظهر الداكن'), on: theme === 'dark', run: toggleTheme },
    { icon: 'globe', label: ar ? 'English' : 'العربية', on: false, run: toggleLocale },
    { icon: 'expand', label: tt('Full screen', 'ملء الشاشة'), on: fs, run: fullscreen },
    { icon: 'refresh', label: tt('Refresh', 'تحديث'), on: false, run: () => { setSheet(null); refreshAll(); } },
    { icon: 'lock', label: tt('Lock', 'قفل'), on: false, run: () => { setSheet(null); runCommand('lock'); } },
    { icon: 'moon', label: tt('Sleep', 'سكون'), on: false, run: () => { setSheet(null); runCommand('sleep'); } },
  ];

  // ---- the "Today" block: clock, storage, platform entry, widgets ------------------------------------------------
  const storageEl = pv('mStorage') && (
    <div className="mos-widget__st mos-widget__st--solo">
      <div className="mos-bar"><i style={{ width: `${Math.min(100, usage?.percent || 0)}%` }} /></div>
      <small dir="auto">{usage ? tt(`${usage.used_human} of ${usage.quota_human} used`, `${usage.used_human} من ${usage.quota_human}`) : tt('Your files', 'ملفاتك')}</small>
    </div>
  );
  const clockKind = pv('mClock');
  const todayBlock = (clockKind === 'digital' && !pages) ? (
    <section className="mos-widget">
      <Clock ar={ar} big />
      {pv('mStorage') && <div className="mos-widget__st"><div className="mos-bar"><i style={{ width: `${Math.min(100, usage?.percent || 0)}%` }} /></div><small dir="auto">{usage ? tt(`${usage.used_human} of ${usage.quota_human} used`, `${usage.used_human} من ${usage.quota_human}`) : tt('Your files', 'ملفاتك')}</small></div>}
    </section>
  ) : (
    <>
      <PhoneClock ar={ar} kind={clockKind} />
      {storageEl && <section className="mos-widget mos-widget--slim">{storageEl}</section>}
    </>
  );
  const searchRow = (
    <div className="mos-searchrow">
      <button type="button" className="mos-search" onClick={() => setSheet({ type: 'search' })}>
        <Icon name="search" size={18} /><span>{tt('Search apps and files', 'ابحث في التطبيقات والملفات')}</span>
      </button>
      {showPlatform && (
        <button type="button" className={`mos-platbtn${vm.enabled ? ' is-on' : ''}`} onClick={openPlatform} aria-label={vm.enabled ? tt('Platform pages', 'صفحات المنصة') : tt('Enter UIPE OS', 'الدخول إلى UIPE OS')}>
          <Icon name="grid" size={20} />
        </button>
      )}
    </div>
  );
  const uiposCard = showPlatform && !vm.enabled && (
    <button type="button" className="mos-uipos" onClick={openPlatform}>
      <span className="mos-uipos__ic"><Icon name="grid" size={22} /></span>
      <span className="mos-uipos__tx"><b>{tt('Enter UIPE OS', 'ادخل UIPE OS')}</b><small>{tt('Courses, exams, grades and messages as apps on this phone', 'المواد والامتحانات والدرجات والرسائل كتطبيقات جوه الموبايل')}</small></span>
      <Icon name={ar ? 'chevron-left' : 'chevron-right'} size={18} />
    </button>
  );

  // ---- swipe pages (iPhone style) ---------------------------------------------------------------------------
  const pagerRef = useRef(null); const todayRef = useRef(null);
  const [dim, setDim] = useState({ w: 390, h: 560, t: 0 });
  const [pg, setPg] = useState(0);
  useEffect(() => {
    if (!pages) return undefined;
    const upd = () => setDim({ w: pagerRef.current?.clientWidth || 390, h: pagerRef.current?.clientHeight || 560, t: todayRef.current?.offsetHeight || 0 });
    upd();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(upd) : null;
    if (ro) { if (pagerRef.current) ro.observe(pagerRef.current); if (todayRef.current) ro.observe(todayRef.current); }
    window.addEventListener('resize', upd);
    return () => { ro?.disconnect(); window.removeEventListener('resize', upd); };
  }, [pages, selecting, clockKind, widgets.length, showPlatform, vm.enabled, pv('mStorage')]); // eslint-disable-line react-hooks/exhaustive-deps
  const cols = dim.w < 340 ? 3 : 4;
  const rowH = gs + (pv('mLabels') ? 40 : 10) + 14;
  const rowsAll = Math.max(1, Math.floor((dim.h - 8) / rowH));
  const rowsLeft0 = Math.max(0, rowsAll - Math.ceil((dim.t + 14) / rowH));
  const pageItems = useMemo(() => {
    if (!pages) return [];
    const out = [];
    vmItems.forEach((a) => out.push({ key: a.key, label: a.label, glyph: <AppGlyph app={a.app} size={gs} />, onTap: a.run }));
    sysApps.forEach((a) => out.push({ key: a.key, label: a.label, glyph: <AppGlyph app={a.app} size={gs} full={a.key === 'bin' ? desk.binFull : undefined} />, onTap: a.run }));
    if (!selecting) shortcuts.forEach((n) => out.push({ key: `lnk${n.id}`, label: n.name, glyph: <span className="mos-lnk"><NodeGlyph node={n} size={gs} /><i aria-hidden="true"><Icon name="external-link" size={13} /></i></span>, onTap: () => onShortcutOpen?.(n), onLong: () => setSheet({ type: 'lnk', node: n }) }));
    files.forEach((n) => out.push({ key: `f${n.id}`, label: n.name, glyph: <NodeGlyph node={n} size={gs} />, node: n }));
    return out;
  }, [pages, vmItems, sysApps, shortcuts, files, gs, desk.binFull, selecting, onShortcutOpen]);
  const pageData = useMemo(() => {
    const cap0 = rowsLeft0 * cols; const capN = rowsAll * cols; const res = [pageItems.slice(0, cap0)];
    for (let i = cap0; i < pageItems.length; i += capN) res.push(pageItems.slice(i, i + capN));
    return res;
  }, [pageItems, rowsLeft0, rowsAll, cols]);
  const libOn = pv('mLibrary') && !selecting;
  const pageCount = pageData.length + (libOn ? 1 : 0);
  const rtl = !!ar;
  const goPage = (i) => { const el = pagerRef.current; if (!el) return; el.scrollTo({ left: (rtl ? -1 : 1) * i * el.clientWidth, behavior: 'smooth' }); };
  const lastPg = useRef(0); const raf = useRef(0);
  const onPagerScroll = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => { const el = pagerRef.current; if (!el) return; const i = Math.round(Math.abs(el.scrollLeft) / Math.max(1, el.clientWidth)); if (i !== lastPg.current) { lastPg.current = i; buzz(haptics, 6); setPg(i); } });
  };
  const libGroups = useMemo(() => {
    if (!pages) return [];
    const g = vmGroups.map((x) => ({ k: x.k, title: x.title, items: x.items.map((a) => ({ key: a.key, label: a.label, glyph: (z) => <AppGlyph app={a.app} size={z} />, onTap: a.run })) }));
    g.push({ k: 'sys', title: tt('My PC & tools', 'جهازي والأدوات'), items: sysApps.map((a) => ({ key: a.key, label: a.label, glyph: (z) => <AppGlyph app={a.app} size={z} full={a.key === 'bin' ? desk.binFull : undefined} />, onTap: a.run })) });
    if (files.length) g.push({ k: 'files', title: tt('Files', 'الملفات'), items: files.slice(0, 40).map((n) => ({ key: `f${n.id}`, label: n.name, glyph: (z) => <NodeGlyph node={n} size={z} />, onTap: () => openNode(n) })) });
    return g;
  }, [pages, vmGroups, sysApps, files, desk.binFull, tt, openNode]);

  const pagesMain = (
    <main className="mos-home mos-home--pages" aria-hidden={!!cur} {...(!cur ? { onContextMenu: (e) => e.preventDefault() } : null)} style={{ '--mos-cols': cols, '--mos-gs': `${gs}px` }}>
      {selecting && (
        <div className="mos-selbar mos-selbar--top">
          <button type="button" onClick={endSelect} aria-label={tt('Cancel', 'إلغاء')}><Icon name="x" size={20} /></button>
          <strong>{tt(`${selIds.size} selected`, `${selIds.size} محدد`)}</strong>
          <button type="button" onClick={() => setSelIds(new Set(files.map((n) => n.id)))}>{tt('All', 'الكل')}</button>
        </div>
      )}
      <div className="mos-pager" ref={pagerRef} onScroll={onPagerScroll}>
        {pageData.map((items, pi) => (
          <section key={pi} className="mos-page" aria-label={tt(`Page ${pi + 1}`, `صفحة ${pi + 1}`)}>
            {pi === 0 && !selecting && (
              <div className="mos-today" ref={todayRef}>
                {todayBlock}
                {uiposCard}
                <MobileWidgets items={widgets} ar={ar} focusId={newWidgetId} onChange={onWidgetChange} onRemove={onWidgetRemove} />
              </div>
            )}
            <div className="mos-page__grid">
              {items.map((it) => it.node ? (
                <HomeIcon key={it.key} label={it.label} glyph={it.glyph} selecting={selecting} checked={selIds.has(it.node.id)} cut={clip?.mode === 'cut' && clip.ids.includes(it.node.id)} onTap={() => tapNode(it.node)} onLong={() => longNode(it.node)} />
              ) : <HomeIcon key={it.key} label={it.label} glyph={it.glyph} onTap={it.onTap} onLong={it.onLong} />)}
            </div>
            {pi === 0 && desk.ready && !files.length && !selecting && <p className="mos-empty">{tt('Your desktop is empty. Tap + to add a file or folder.', 'سطح المكتب فاضي. اضغط + لإضافة ملف أو مجلد.')}</p>}
            {pi === 0 && desk.error && <button type="button" className="mos-warn" onClick={reloadDesk}>{tt('Could not load your files — tap to retry.', 'مقدرتش أحمّل ملفاتك — اضغط للمحاولة.')}</button>}
          </section>
        ))}
        {libOn && (
          <section className="mos-page mos-page--lib" aria-label={tt('App Library', 'مكتبة التطبيقات')}>
            <button type="button" className="mos-lib__search" onClick={() => setSheet({ type: 'search' })}><Icon name="search" size={17} /><span>{tt('App Library', 'مكتبة التطبيقات')}</span></button>
            <div className="mos-lib">
              {libGroups.map((g) => {
                const big = g.items.length > 4; const shown = big ? g.items.slice(0, 3) : g.items;
                return (
                  <div key={g.k} className="mos-lib__card">
                    <div className="mos-lib__grid">
                      {shown.map((it) => <button key={it.key} type="button" className="mos-lib__ic" onClick={it.onTap} aria-label={it.label}>{it.glyph(34)}</button>)}
                      {big && (
                        <button type="button" className="mos-lib__more" onClick={() => setSheet({ type: 'libgroup', g })} aria-label={tt(`${g.title}: all`, `${g.title}: الكل`)}>
                          {g.items.slice(3, 7).map((it) => <i key={it.key}>{it.glyph(15)}</i>)}
                        </button>
                      )}
                    </div>
                    <h5 dir="auto" onClick={() => setSheet({ type: 'libgroup', g })}>{g.title}</h5>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
      {!selecting && (
        <div className="mos-pagebar">
          {pageCount > 1 && (
            <div className="mos-dots" role="tablist" aria-label={tt('Pages', 'الصفحات')}>
              {Array.from({ length: pageCount }, (_, i) => (
                <button key={i} type="button" role="tab" aria-selected={pg === i} className={pg === i ? 'is-on' : ''} onClick={() => goPage(i)} aria-label={tt(`Page ${i + 1}`, `صفحة ${i + 1}`)} />
              ))}
            </div>
          )}
          {searchRow}
        </div>
      )}
      <div className="mos-home__pad mos-home__pad--pages" />
    </main>
  );

  return (
    <div className={`mos${cur ? ' has-app' : ''}${lightWp ? ' is-lightwp' : ''}${island ? ' has-island' : ''}${pages ? ' is-pages' : ''}${pv('mLabels') ? '' : ' no-labels'}${pv('mDock') === 'solid' ? ' dock-solid' : ''}`}>
      <div className="os-wall" style={{ background: wallpaper }} />

      {/* ── status bar ── */}
      <header className="mos-status" onClick={() => setSheet({ type: 'cc' })} role="button" tabIndex={0} aria-label={tt('Control centre', 'مركز التحكم')}>
        <Clock ar={ar} />
        {island && (
          <button type="button" className={`mos-island${islandOpen ? ' is-open' : ''}${nc?.unread ? ' has-unread' : ''}`} aria-label={tt('Notifications', 'الإشعارات')}
            onClick={(e) => { e.stopPropagation(); if (islandOpen && nc?.unread) { setIslandOpen(false); setSheet({ type: 'notif' }); } else popIsland(); }}>
            <i className="mos-island__cam" aria-hidden="true" />
            <span className="mos-island__tx">{nc?.unread ? tt(`${nc.unread} new`, `${nc.unread} إشعار جديد`) : tt('No new notifications', 'مفيش إشعارات جديدة')}</span>
            <Icon name="bell" size={14} />
          </button>
        )}
        <span className="mos-status__sp" />
        {nc && (
          <button type="button" className="mos-status__bell" aria-label={tt('Notifications', 'الإشعارات')} onClick={(e) => { e.stopPropagation(); setSheet({ type: 'notif' }); }}>
            <Icon name="bell" size={16} />{nc.unread > 0 && <b>{nc.unread > 99 ? '99+' : nc.unread}</b>}
          </button>
        )}
        <b className="mos-status__lang">{ar ? 'ع' : 'EN'}</b>
        <WifiGlyph on={online} size={15} />
        {battery && <span className="mos-status__bat"><BatteryGlyph level={battery.level} charging={battery.charging} size={18} /><small>{battery.level}%</small></span>}
      </header>

      {/* ── home ── */}
      {pages ? pagesMain : (
      <main className="mos-home" aria-hidden={!!cur} {...(!cur ? { onContextMenu: (e) => e.preventDefault() } : null)}>
        {selecting ? (
          <div className="mos-selbar">
            <button type="button" onClick={endSelect} aria-label={tt('Cancel', 'إلغاء')}><Icon name="x" size={20} /></button>
            <strong>{tt(`${selIds.size} selected`, `${selIds.size} محدد`)}</strong>
            <button type="button" onClick={() => setSelIds(new Set(files.map((n) => n.id)))}>{tt('All', 'الكل')}</button>
          </div>
        ) : (
          <>
            {todayBlock}
            {searchRow}
            {uiposCard}
            <MobileWidgets items={widgets} ar={ar} focusId={newWidgetId} onChange={onWidgetChange} onRemove={onWidgetRemove} />
          </>
        )}

        {!selecting && vmGroups.map((g) => (
          <section key={g.k} className="mos-sec" aria-label={g.title}>
            <h3 className="mos-sec__t" dir="auto">{g.title}</h3>
            <div className="mos-grid">
              {g.items.map((a) => <HomeIcon key={a.key} label={a.label} glyph={<AppGlyph app={a.app} size={gs} />} onTap={a.run} />)}
            </div>
          </section>
        ))}
        {!selecting && vmGroups.length > 0 && <h3 className="mos-sec__t" dir="auto">{tt('My PC & tools', 'جهازي والأدوات')}</h3>}
        <div className="mos-grid" onPointerDown={() => {}}>
          {!selecting && sysApps.map((a) => (
            <HomeIcon key={a.key} label={a.label} glyph={<AppGlyph app={a.app} size={gs} full={a.key === 'bin' ? desk.binFull : undefined} />} onTap={a.run} />
          ))}
          {!selecting && shortcuts.map((n) => (
            <HomeIcon key={`lnk${n.id}`} label={n.name} glyph={<span className="mos-lnk"><NodeGlyph node={n} size={gs} /><i aria-hidden="true"><Icon name="external-link" size={13} /></i></span>} onTap={() => onShortcutOpen?.(n)} onLong={() => setSheet({ type: 'lnk', node: n })} />
          ))}
          {files.map((n) => (
            <HomeIcon
              key={n.id} label={n.name} glyph={<NodeGlyph node={n} size={gs} />} selecting={selecting} checked={selIds.has(n.id)}
              cut={clip?.mode === 'cut' && clip.ids.includes(n.id)} onTap={() => tapNode(n)} onLong={() => longNode(n)}
            />
          ))}
        </div>
        {desk.ready && !files.length && !selecting && (
          <p className="mos-empty">{tt('Your desktop is empty. Tap + to add a file or folder.', 'سطح المكتب فاضي. اضغط + لإضافة ملف أو مجلد.')}</p>
        )}
        {desk.error && <button type="button" className="mos-warn" onClick={reloadDesk}>{tt('Could not load your files — tap to retry.', 'مقدرتش أحمّل ملفاتك — اضغط للمحاولة.')}</button>}
        <div className="mos-home__pad" />
      </main>
      )}

      {/* ── dock + add button (home only) ── */}
      {!cur && !selecting && (
        <>
          <button type="button" className="mos-fab" aria-label={tt('New', 'جديد')} onClick={() => setSheet({ type: 'new' })} disabled={!desk.id}><Icon name="plus" size={26} /></button>
          <nav className="mos-dock" aria-label={tt('Dock', 'الدوك')}>
            {dockApps.map((a) => {
              const running = wm.list.some((w) => w.app === a.app);
              return (
                <button key={a.key} type="button" className="mos-dock__it" onClick={a.run} aria-label={a.label}>
                  <AppGlyph app={a.app} size={46} full={a.key === 'bin' ? desk.binFull : undefined} />
                  {running && <i className="mos-dock__dot" />}
                </button>
              );
            })}
            <button type="button" className="mos-dock__it mos-dock__sw" onClick={() => setSwitcher(true)} aria-label={tt('Open apps', 'التطبيقات المفتوحة')}>
              <span className="mos-dock__sq"><Icon name="layers" size={22} />{wm.list.length > 0 && <b>{wm.list.length}</b>}</span>
            </button>
          </nav>
        </>
      )}

      {/* ── selection action bar ── */}
      {selecting && !cur && (
        <nav className="mos-actbar" aria-label={tt('Selection actions', 'إجراءات التحديد')}>
          <button type="button" disabled={!selNodes.length} onClick={() => { copyNodes(selNodes, 'copy'); endSelect(); }}><Icon name="copy" size={20} /><span>{tt('Copy', 'نسخ')}</span></button>
          <button type="button" disabled={!selNodes.length} onClick={() => { copyNodes(selNodes, 'cut'); endSelect(); }}><Icon name="cut" size={20} /><span>{tt('Cut', 'قص')}</span></button>
          <button type="button" disabled={!selNodes.length} onClick={() => setSheet({ type: 'move', nodes: selNodes })}><Icon name="folder-up" size={20} /><span>{tt('Move', 'نقل')}</span></button>
          <button type="button" disabled={selNodes.length !== 1} onClick={() => renameNode(selNodes[0])}><Icon name="edit" size={20} /><span>{tt('Rename', 'تسمية')}</span></button>
          <button type="button" className="is-danger" disabled={!selNodes.length} onClick={() => { trashNodes(selNodes); endSelect(); }}><Icon name="trash" size={20} /><span>{tt('Delete', 'حذف')}</span></button>
        </nav>
      )}

      {/* ── apps: one full-screen layer per open window; only the active one is visible, the others keep their state ── */}
      {wm.list.map((w) => {
        const on = !!cur && cur.id === w.id;
        if (!on && isVmApp(w.app) && !warm.has(w.id)) return null;
        const media = w.app === 'viewer' || w.app === 'editor';
        return (
          <section key={w.id} className={`mos-app${on ? ' is-on' : ''}${media ? ' mos-app--media' : ''}`} hidden={!on} aria-hidden={!on}>
            <div className="mos-app__bar">
              <button type="button" className="mos-app__btn" onClick={back} aria-label={tt('Back', 'رجوع')}><Icon name={ar ? 'chevron-right' : 'chevron-left'} size={22} /></button>
              <span className="mos-app__ic"><AppGlyph app={w.app} size={22} /></span>
              <strong className="mos-app__t" dir="auto">{winTitle(w, APPS, ar)}</strong>
              <button type="button" className="mos-app__btn" onClick={() => setSwitcher(true)} aria-label={tt('Open apps', 'التطبيقات المفتوحة')}><Icon name="layers" size={19} /></button>
              <button type="button" className="mos-app__btn" onClick={() => dispatch({ type: 'close', id: w.id })} aria-label={tt('Close', 'إغلاق')}><Icon name="x" size={20} /></button>
            </div>
            <div className="os-win__body mos-app__body">{bodyOf(w)}</div>
          </section>
        );
      })}

      {/* ── gesture bar ── */}
      <div className="mos-gest" onPointerDown={gDown} onPointerUp={gUp} onPointerCancel={() => { gest.current = null; }} role="button" tabIndex={0} aria-label={tt('Home', 'الرئيسية')}><i /></div>

      {switcher && (
        <Switcher
          list={[...wm.list].sort((a, b) => b.z - a.z)} ar={ar} tt={tt} activeId={cur?.id}
          onPick={(id) => { setSwitcher(false); dispatch({ type: 'focus', id }); }}
          onClose={(id) => dispatch({ type: 'close', id })}
          onCloseAll={() => wm.list.forEach((w) => dispatch({ type: 'close', id: w.id }))}
          onDone={() => { setSwitcher(false); }}
        />
      )}

      <input ref={fileRef} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />

      {/* ── sheets ── */}
      {sheet?.type === 'new' && (
        <Sheet title={tt('New', 'جديد')} onClose={closeSheet}>
          <Row icon="note" label={tt('Sticky note', 'ملاحظة لاصقة')} onClick={after(() => onWidgetAdd?.('note'))} />
          <Row icon="check" label={tt('To-do list', 'قائمة مهام')} onClick={after(() => onWidgetAdd?.('todo'))} />
          <Row icon="calendar" label={tt('Calendar widget', 'ويدجت تقويم')} onClick={after(() => onWidgetAdd?.('calendar'))} />
          <Row icon="clock" label={tt('Clock widget', 'ويدجت ساعة')} onClick={after(() => onWidgetAdd?.('clock'))} />
          <Row icon="file-up" label={tt('Upload from this device', 'رفع من الجهاز')} sub={tt('Files, photos, videos', 'ملفات، صور، فيديوهات')} onClick={after(() => fileRef.current?.click())} />
          <Row icon="folder-plus" label={tt('New folder', 'مجلد جديد')} onClick={after(newFolder)} />
          <Row icon="file-plus" label={tt('Text file', 'ملف نصي')} onClick={after(newFile)} />
          <Row icon="file-plus" label={tt('Word document', 'مستند Word')} onClick={after(() => newDoc('docx'))} />
          <Row icon="file-plus" label={tt('Excel workbook', 'جدول Excel')} onClick={after(() => newDoc('xlsx'))} />
          <Row icon="file-plus" label={tt('PowerPoint presentation', 'عرض PowerPoint')} onClick={after(() => newDoc('pptx'))} />
          <Row icon="file-plus" label={tt('PDF / other file…', 'ملف PDF / نوع آخر…')} onClick={after(() => newDoc('pdf'))} />
          {clip && <Row icon="paste" label={tt('Paste here', 'لصق هنا')} onClick={after(() => pasteInto(desk.id))} />}
        </Sheet>
      )}

      {sheet?.type === 'lnk' && (
        <Sheet title={sheet.node.name} onClose={closeSheet}>
          <div className="mos-sheet__head"><NodeGlyph node={sheet.node} size={44} /><div><b dir="auto">{sheet.node.name}</b><small dir="auto">{tt('Shortcut', 'اختصار')}{sheet.node.path ? ` · ${sheet.node.path}` : ''}</small></div></div>
          <Row icon="eye" label={tt('Open', 'فتح')} onClick={after(() => onShortcutOpen?.(sheet.node))} />
          <Row icon="trash" danger label={tt('Remove shortcut', 'حذف الاختصار')} sub={tt('The original is not deleted', 'الأصل مش بيتحذف')} onClick={after(() => onShortcutRemove?.(sheet.node))} />
        </Sheet>
      )}

      {sheet?.type === 'item' && (() => {
        const n = sheet.node; const isFolder = n.type === 'folder';
        return (
          <Sheet title={n.name} onClose={closeSheet}>
            <div className="mos-sheet__head"><NodeGlyph node={n} size={44} /><div><b dir="auto">{n.name}</b><small>{isFolder ? tt('Folder', 'مجلد') : (n.size_human || '')}</small></div></div>
            <Row icon="eye" label={tt('Open', 'فتح')} onClick={after(() => openNode(n))} />
            <Row icon="check-circle" label={tt('Select', 'تحديد')} onClick={() => { setSheet(null); setSelecting(true); setSelIds(new Set([n.id])); }} />
            <Row icon="copy" label={tt('Copy', 'نسخ')} onClick={after(() => copyNodes([n], 'copy'))} />
            <Row icon="cut" label={tt('Cut', 'قص')} onClick={after(() => copyNodes([n], 'cut'))} />
            {isFolder && clip && <Row icon="paste" label={tt('Paste into folder', 'لصق داخل المجلد')} onClick={after(() => pasteInto(n.id))} />}
            <Row icon="folder-up" label={tt('Move to…', 'نقل إلى…')} onClick={() => setSheet({ type: 'move', nodes: [n] })} />
            <Row icon="edit" label={tt('Rename', 'إعادة تسمية')} onClick={after(() => renameNode(n))} />
            <Row icon="trash" danger label={tt('Delete', 'حذف')} onClick={after(() => trashNodes([n]))} />
          </Sheet>
        );
      })()}

      {sheet?.type === 'move' && (
        <Sheet title={tt('Move to…', 'نقل إلى…')} onClose={closeSheet}>
          {folders.filter((f) => !sheet.nodes.some((n) => n.id === f.id)).map((f) => (
            <Row key={f.id} icon={<NodeGlyph node={f} size={30} />} label={f.name} onClick={() => { const ns = sheet.nodes; setSheet(null); endSelect(); moveNodes(ns, f); }} />
          ))}
          {!folders.filter((f) => !sheet.nodes.some((n) => n.id === f.id)).length && <p className="mos-sheet__none">{tt('There are no folders on the desktop yet. Create one first.', 'مفيش مجلدات على سطح المكتب. اعمل مجلد الأول.')}</p>}
          <Row icon="folder-plus" label={tt('New folder', 'مجلد جديد')} onClick={after(newFolder)} />
        </Sheet>
      )}

      {sheet?.type === 'notif' && nc && (
        <Sheet title={tt('Notifications', 'الإشعارات')} tall onClose={closeSheet}>
          <div className="mos-nc__head"><button type="button" disabled={!nc.unread} onClick={nc.markAllRead}>{tt('Mark all read', 'تعيين الكل كمقروء')}</button></div>
          <NotifList tt={tt} ar={ar} items={nc.items} unread={nc.unread} loading={nc.loading} onOpen={(it) => { setSheet(null); onOpenNotif?.(it); }} onRemove={nc.removeLocal} />
          <Row icon="arrow-right" label={tt('Open all notifications', 'فتح كل الإشعارات')} onClick={after(() => onAllNotif?.())} />
        </Sheet>
      )}

      {sheet?.type === 'cc' && (
        <Sheet title={user?.name ? `${user.name}` : tt('Control centre', 'مركز التحكم')} onClose={closeSheet}>
          <div className="mos-cc">
            {ccTiles.map((t) => (
              <button key={t.label} type="button" className={`mos-cc__t${t.on ? ' is-on' : ''}`} onClick={t.run}><Icon name={t.icon} size={22} /><span>{t.label}</span></button>
            ))}
          </div>
          <label className="mos-cc__br">
            <Icon name="sun" size={18} />
            <input type="range" min="40" max="100" value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} aria-label={tt('Brightness', 'السطوع')} />
          </label>
          <Row icon="palette" label={tt('Phone look', 'مظهر الهاتف')} sub={tt('Layout, clock, icons, Dynamic Island', 'الشكل، الساعة، الأيقونات، الجزيرة')} onClick={() => setSheet({ type: 'phoneset' })} />
          {showPlatform && <Row icon="grid" label={vm.enabled ? tt('Platform pages', 'صفحات المنصة') : tt('Enter UIPE OS', 'ادخل UIPE OS')} sub={vm.enabled ? undefined : tt('The whole platform inside My PC', 'المنصة كلها جوه جهازي')} onClick={() => setSheet({ type: vm.enabled ? 'nav' : 'uipos' })} />}
          <Row icon="settings" label={tt('Settings', 'الإعدادات')} onClick={after(() => runCommand('settings'))} />
          <Row icon="home" label={tt('Back to the portal', 'الرجوع للبوابة')} onClick={after(() => runCommand('portal'))} />
          <Row icon="logout" label={tt('Sign out', 'تسجيل الخروج')} onClick={after(() => runCommand('logout'))} />
        </Sheet>
      )}

      {sheet?.type === 'phoneset' && (
        <Sheet tall title={tt('Phone look', 'مظهر الهاتف')} onClose={closeSheet}>
          <MobilePrefs prefs={prefs} setPrefs={setPrefs} tt={tt} ar={ar} />
        </Sheet>
      )}

      {sheet?.type === 'libgroup' && (
        <Sheet tall title={sheet.g.title} onClose={closeSheet}>
          <div className="mos-grid mos-grid--sheet">
            {sheet.g.items.map((it) => <HomeIcon key={it.key} label={it.label} glyph={it.glyph(gs)} onTap={() => { setSheet(null); it.onTap(); }} />)}
          </div>
        </Sheet>
      )}

      {sheet?.type === 'nav' && (
        <Sheet tall onClose={closeSheet}>
          <NavSidebar
            variant="sheet" ar={ar} tt={tt} apps={navApps} wins={navWins} pinned={false} collapsed={navCollapsed} onToggleGroup={toggleNavGroup}
            onOpenApp={runNavApp} onFocusWin={(id) => dispatch({ type: 'focus', id })} onCloseWin={(id) => dispatch({ type: 'close', id })}
            onClose={closeSheet} onDesktop={goHome} onSpotlight={() => setTimeout(() => setSheet({ type: 'search' }), 0)}
          />
        </Sheet>
      )}

      {sheet?.type === 'uipos' && (
        <Sheet onClose={closeSheet}>
          <div className="mos-uiposhero">
            <span className="mos-uiposhero__ic"><Icon name="grid" size={30} /></span>
            <h3 dir="auto">{tt('UIPE OS — the platform inside My PC', 'UIPE OS — المنصة جوه جهازي')}</h3>
            <p dir="auto">{tt('Every page of the platform becomes an app on this phone, next to your files: courses, exams, grades, messages and projects.', 'كل صفحات المنصة بتبقى تطبيقات على الموبايل جنب ملفاتك: المواد والامتحانات والدرجات والرسائل والمشاريع.')}</p>
            <ul>
              <li><Icon name="check-circle" size={15} />{tt('One list to reach any page', 'قائمة واحدة توصّلك لأي صفحة')}</li>
              <li><Icon name="check-circle" size={15} />{tt('Follows you to every device', 'بتتابعك على أي جهاز')}</li>
              <li><Icon name="check-circle" size={15} />{tt('Switch back any time from Control centre', 'ترجع للعادي في أي وقت من مركز التحكم')}</li>
            </ul>
            {vmErr && <p className="mos-uiposhero__err" role="alert">{vmErr}</p>}
            <button type="button" className="mos-uiposhero__go" disabled={vm.busy || !vm.available} onClick={() => switchPlatform(true)}>
              {vm.busy ? tt('Please wait…', 'ثانية واحدة…') : tt('Enter UIPE OS', 'ادخل UIPE OS')}
            </button>
          </div>
        </Sheet>
      )}

      {sheet?.type === 'search' && (
        <SearchSheet
          tt={tt} ar={ar} apps={[...vmItems, ...sysApps]} files={files} onClose={closeSheet}
          onApp={(a) => { setSheet(null); a.run(); }} onNode={(n) => { setSheet(null); openNode(n); }}
        />
      )}
    </div>
  );
}

function SearchSheet({ tt, ar, apps, files, onClose, onApp, onNode }) {
  const [q, setQ] = useState(''); const [found, setFound] = useState([]);
  const t = q.trim().toLowerCase();
  const content = useContentSearch(q);
  useEffect(() => {
    if (t.length < 2) { setFound([]); return undefined; }
    let dead = false;
    const h = setTimeout(async () => { try { const r = await drive.search(q.trim()); if (!dead) setFound((r.data || []).slice(0, 20)); } catch { if (!dead) setFound([]); } }, 260);
    return () => { dead = true; clearTimeout(h); };
  }, [q, t.length]);
  const appHits = apps.filter((a) => !t || a.label.toLowerCase().includes(t));
  const localHits = t ? files.filter((n) => n.name.toLowerCase().includes(t)) : files.slice(0, 8);
  const seen = new Set(localHits.map((n) => n.id));
  const deepHits = found.filter((n) => !seen.has(n.id));
  return (
    <Sheet tall onClose={onClose}>
      <div className="mos-sfield"><Icon name="search" size={18} /><input autoFocus value={q} dir="auto" placeholder={tt('Search apps and files', 'ابحث في التطبيقات والملفات')} onChange={(e) => setQ(e.target.value)} spellCheck={false} autoComplete="off" />{q && <button type="button" onClick={() => setQ('')} aria-label={tt('Clear', 'مسح')}><Icon name="x" size={16} /></button>}</div>
      {appHits.length > 0 && <h4 className="mos-sheet__h">{tt('Apps', 'التطبيقات')}</h4>}
      {appHits.map((a) => <Row key={a.key} icon={<AppGlyph app={a.app} size={32} />} label={a.label} onClick={() => onApp(a)} />)}
      {localHits.length > 0 && <h4 className="mos-sheet__h">{t ? tt('On the desktop', 'على سطح المكتب') : tt('Recent on the desktop', 'على سطح المكتب')}</h4>}
      {localHits.map((n) => <Row key={n.id} icon={<NodeGlyph node={n} size={32} />} label={n.name} onClick={() => onNode(n)} />)}
      {deepHits.length > 0 && <h4 className="mos-sheet__h">{tt('In My PC', 'في جهازي')}</h4>}
      {deepHits.map((n) => <Row key={n.id} icon={<NodeGlyph node={n} size={32} />} label={n.name} sub={n.path} onClick={() => onNode(n)} />)}
      <ContentMatches res={content} tt={tt} compact max={10} onOpen={onNode} />
      {t && !appHits.length && !localHits.length && !deepHits.length && !content.items.length && !content.loading && <p className="mos-sheet__none">{tt('No results', 'مفيش نتايج')}</p>}
    </Sheet>
  );
}
