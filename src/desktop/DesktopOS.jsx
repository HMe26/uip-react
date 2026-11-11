import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { usePrivateParams } from '../lib/privateParams';
import Icon from '../components/Icon';
import { errorMessage } from '../api/client';
import { drive } from '../lib/driveApi';
import { onDriveChanged } from '../lib/driveEvents';
import { isRealtimeConnected } from '../lib/realtime';
import CloudTray from './CloudTray';
import DeleteProgressHost from '../components/DeleteProgress';
import { NotifFlyout, NotifToasts, NotifTray } from './NotificationCenter';
import { useDesktopNotifications } from './notifications';
import { lockScroll } from '../lib/scrollLock';
import { roleHome } from '../config/roleHome';
import AiAssistantWidget from '../components/ai-assistant/AiAssistantWidget';
import { OPEN_AI_EVENT } from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { usePageMeta } from '../context/PageMetaContext';
import { useTheme } from '../context/ThemeContext';
import { APPS, ExplorerApp, PINNED, SettingsApp, ShortcutsApp, TaskManagerApp } from './apps';
import { AppGlyph, BinGlyph, PcGlyph, Tile, UipMark } from './OsIcons';
import { Dock, MenuBar } from './macShell';
import { DESK_ICONS, DOCK_ICONS, hiddenList, idList, iconPosKey, loadIconPos, loadPrefs, saveIconPos, savePrefs } from './prefs';
import { useSharedClip } from '../lib/driveClipboard';
import { globalActionFor, keyOf } from './shortcuts';
import { isSystemNode, useDesktopSync } from './sync';
import { desktopApi, readLockCache, readLockedFlag, writeLockedFlag, readUnlockedFlag, writeUnlockedFlag, readHeldFlag, writeHeldFlag } from './desktopApi';
import { BatteryGlyph, CalendarFlyout, QuickSettings, WifiGlyph, useBattery, useOnline } from './flyouts';
import { addRecent, clearRecents, loadRecents, removeRecent, RECENTS_EVENT } from './recents';
import ResetUndoBar from './ResetUndoBar';
import { Clock, ContextMenu, IdleWarning, NodeGlyph, OsDialog, RunDialog, StartMenu, TaskView } from './shell';
import LockScreen, { SleepScreen } from './LockScreen';
import { readSec, useDesktopSecurity } from './security';
import { wallpaperById, wallpaperCss } from './wallpapers';
import { MAX_DESKS, areaW, chromeH, initialWm, layoutInset, winTitle, wmReducer } from './wm';
import NavSidebar, { NAV_W } from './NavSidebar';
import { restoreWm, saveWm } from './wmPersist';
import WidgetLayer from './Widgets';
import { clearDropMark, dropOnWindowAt, hasDriveIds, markDropTarget, readDragNodes } from '../lib/driveDnd';
import { useDesktopWidgets } from './widgetsStore';
import { opensInEditor } from '../lib/driveFileKinds';
import WindowFrame from './Window';
import { useIsMobileOS } from './useIsMobileOS';
import { VM_APPS, VM_BY_ID, VM_DESKTOP, VM_DOCK, VM_BY_KEY, deskIconKey, isVmApp, resolveTarget, vmId } from '../virtual/catalog';
import { readVirtualCache, takeVirtualOpen, useVirtualMode } from '../virtual/virtualMode';

// Heavy parts load on demand: the file viewer + office editors only when a file is opened, the phone UI only on phones.
/** Laptop screens: a window that would cover most of the screen anyway opens maximized (page layout = real width, more room).
 *  Big monitors keep floating windows. */
const fitsMaximized = (size) => {
  const w = window.innerWidth; const h = window.innerHeight;
  if (w < 720) return true;
  if (w >= 1500) return false;
  return (size?.w || 0) >= w * 0.66 || (size?.h || 0) >= (h - 112) * 0.86;
};
const ViewerWindow = lazy(() => import('./FileWindows').then((m) => ({ default: m.ViewerWindow })));
const EditorWindow = lazy(() => import('./FileWindows').then((m) => ({ default: m.EditorWindow })));
const NewFileDialog = lazy(() => import('../components/NewFileDialog'));
const MobileShell = lazy(() => import('./MobileShell'));
const WinFallback = <div className="os-app-msg"><span className="mp-spin" /></div>;
import SnapAssist from './SnapAssist';
import { CalendarApp, NotesApp } from './miniApps';
import SciCalc from './SciCalc';
const TerminalApp = lazy(() => import('./TerminalApp'));
const VsCodeApp = lazy(() => import('./VsCodeApp'));
const BrowserApp = lazy(() => import('./BrowserApp'));
const VirtualApp = lazy(() => import('../virtual/VirtualApp'));
import './desktop.css';
import './mac.css';
import './extras.css';

const EMPTY_POS = {};
const CELL = { s: { w: 78, h: 88, g: 34 }, m: { w: 94, h: 104, g: 48 }, l: { w: 114, h: 126, g: 64 } };
const PAD_X = 10; const PAD_Y = 14; const GAP = 2; // must match the old grid padding / gap
const BOTTOM_PAD = 0; const ROW_SLACK = 36; // the last row may overhang a little (a cell has empty padding), so a nearly-fitting row is not wasted
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* Icons sit at FREE pixel positions: { x, y } = distance from the desktop's inline-end edge (left in Arabic, right in English) and from the top.
   (Old saved layouts used grid cells { c, r }; they are converted on load.) */
const OVERLAP = 10; // icons may touch, but not sit on top of each other
const collides = (a, b, cell) => Math.abs(a.x - b.x) < cell.w - OVERLAP && Math.abs(a.y - b.y) < cell.h - OVERLAP;
const bounds = (cell, size) => ({ maxX: size.w ? Math.max(0, size.w - cell.w) : 100000, maxY: size.h ? Math.max(0, size.h - cell.h) : 100000 });
const legacyPx = (p, cell) => ({ x: PAD_X + p.c * (cell.w + GAP), y: PAD_Y + p.r * (cell.h + GAP) });

/** Position of every icon: remembered ones first (kept on screen), new ones fill the first free grid slot, column by column. */
function layoutIcons(keys, saved, cell, size, rows, cols) {
  const { maxX, maxY } = bounds(cell, size);
  const out = {}; const placed = [];
  keys.forEach((k) => {
    const p = saved[k];
    if (!p) return;
    const q = p.x !== undefined ? p : legacyPx(p, cell);
    out[k] = { x: clamp(q.x, 0, maxX), y: clamp(q.y, 0, maxY) }; placed.push(out[k]);
  });
  keys.forEach((k) => {
    if (out[k]) return;
    let spot = null;
    for (let c = 0; c < cols && !spot; c += 1) {
      for (let r = 0; r < rows && !spot; r += 1) {
        const q = legacyPx({ c, r }, cell);
        if (!placed.some((o) => collides(o, q, cell))) spot = q;
      }
    }
    out[k] = spot || { x: PAD_X, y: PAD_Y }; placed.push(out[k]);
  });
  return out;
}
/** Nearest free spot to (x, y): the spot itself if nothing is there, otherwise the closest non-overlapping one. */
function nearestFree(x, y, taken, cell, size) {
  const { maxX, maxY } = bounds(cell, size);
  const at = (px, py) => ({ x: clamp(Math.round(px), 0, maxX), y: clamp(Math.round(py), 0, maxY) });
  const first = at(x, y);
  if (!taken.some((o) => collides(o, first, cell))) return first;
  let best = null; let bestD = Infinity;
  for (let d = 8; d <= 900 && !best; d += 8) {
    for (let a = -d; a <= d; a += 8) {
      [[a, -d], [a, d], [-d, a], [d, a]].forEach(([dx, dy]) => {
        const q = at(first.x + dx, first.y + dy);
        if (taken.some((o) => collides(o, q, cell))) return;
        const dist = (q.x - x) ** 2 + (q.y - y) ** 2;
        if (dist < bestD) { best = q; bestD = dist; }
      });
    }
  }
  return best || first;
}
/** Where a dragged group lands when moved by (dx, dy) PIXELS (already converted to the x axis of `layout`): it keeps its shape, stays on screen, and an icon that would land on another one slides to the nearest free spot. */
function planMove(group, layout, dx, dy, cell, size) {
  const pts = group.map((k) => layout[k]).filter(Boolean);
  if (!pts.length) return {};
  const { maxX, maxY } = bounds(cell, size);
  const mx = clamp(dx, -Math.min(...pts.map((p) => p.x)), Math.max(-Math.min(...pts.map((p) => p.x)), maxX - Math.max(...pts.map((p) => p.x))));
  const my = clamp(dy, -Math.min(...pts.map((p) => p.y)), Math.max(-Math.min(...pts.map((p) => p.y)), maxY - Math.max(...pts.map((p) => p.y))));
  const inGroup = new Set(group);
  const taken = Object.keys(layout).filter((k) => !inGroup.has(k)).map((k) => layout[k]);
  const out = {};
  group.forEach((k) => {
    const p = layout[k];
    if (!p) return;
    const t = nearestFree(p.x + mx, p.y + my, taken, cell, size);
    taken.push(t); out[k] = t;
  });
  return out;
}

const RUN_ALIASES = {
  ai: 'ai', assistant: 'ai',
  explorer: 'explorer', 'this pc': 'explorer', thispc: 'explorer', pc: 'explorer', 'جهازي': 'explorer',
  settings: 'settings', control: 'settings', 'الإعدادات': 'settings',
  personalize: 'personalize', 'التخصيص': 'personalize',
  taskmgr: 'taskmgr', 'task manager': 'taskmgr', 'مدير المهام': 'taskmgr',
  bin: 'bin', recycle: 'bin', trash: 'bin', 'سلة المحذوفات': 'bin',
  notes: 'notes', note: 'notes', 'الملاحظات': 'notes', calendar: 'calendar', 'التقويم': 'calendar', calc: 'calculator', calculator: 'calculator', 'الآلة الحاسبة': 'calculator',
  terminal: 'terminal', term: 'terminal', cmd: 'terminal', shell: 'terminal', bash: 'terminal', 'الترمينال': 'terminal', uip: 'terminal', 'uip terminal': 'terminal', 'ترمينال uip': 'terminal', 'ترمينال': 'terminal',
  vscode: 'vscode', code: 'vscode', 'vs code': 'vscode', 'visual studio code': 'vscode', 'محرر الأكواد': 'vscode', 'فيجوال ستوديو': 'vscode',
  browser: 'browser', web: 'browser', internet: 'browser', chrome: 'browser', google: 'browser', search: 'browser', 'المتصفح': 'browser', 'متصفح': 'browser', 'بحث': 'browser', 'جوجل': 'browser',
  shortcuts: 'shortcuts', help: 'shortcuts', 'الاختصارات': 'shortcuts',
  cloud: 'cloud', backup: 'cloud', storage: 'cloud', 'النسخ الاحتياطي': 'cloud', 'التخزين': 'cloud',
  lock: 'lock', 'قفل': 'lock', portal: 'portal', exit: 'portal', 'البوابة': 'portal',
  logout: 'logout', signout: 'logout', 'sign out': 'logout', 'log out': 'logout', 'تسجيل الخروج': 'logout', 'خروج من الحساب': 'logout',
  sleep: 'sleep', 'سكون': 'sleep', security: 'security', devices: 'security', 'الأمان': 'security', 'الأجهزة': 'security',
};

/** The student's real "Desktop" folder on My PC (created on first use) + recycle-bin state + usage. */
function useDesktopFolder() {
  const [st, setSt] = useState({ id: null, items: [], binFull: false, usage: null, error: '', ready: false });
  const idRef = useRef(null);
  const binRef = useRef(null); // last known "recycle bin has items"; the background poll reuses it instead of asking again
  const reload = useCallback(async (arg) => {
    const poll = !!(arg && arg.poll === true);
    const attempt = async () => {
      if (!idRef.current) {
        const root = await drive.list(null);
        let f = (root.data.items || []).find((n) => n.type === 'folder' && n.name === 'Desktop');
        if (!f) f = (await drive.createFolder(null, 'Desktop')).data;
        idRef.current = f.id;
        return { listing: await drive.list(f.id), usage: root.data.usage };
      }
      const listing = await drive.list(idRef.current);
      return { listing, usage: listing.data.usage };
    };
    try {
      let out;
      try { out = await attempt(); } catch (e) { idRef.current = null; out = await attempt(); }
      let binFull = false;
      if (poll && binRef.current !== null) binFull = binRef.current; // background poll: 2 requests instead of 3
      else { try { binFull = ((await drive.trashList()).data || []).length > 0; } catch { binFull = binRef.current ?? false; } }
      binRef.current = binFull;
      const items = out.listing.data.items || [];
      // the 45 s poll usually finds nothing new: keep the old state object so the whole desktop does not re-render
      setSt((prev) => {
        const same = prev.ready && !prev.error && prev.id === idRef.current && prev.binFull === binFull && prev.items.length === items.length
          && prev.items.every((n, i) => n.id === items[i].id && n.name === items[i].name && n.updated_at === items[i].updated_at && n.size_bytes === items[i].size_bytes)
          && JSON.stringify(prev.usage) === JSON.stringify(out.usage);
        return same ? prev : { id: idRef.current, items, binFull, usage: out.usage, error: '', ready: true };
      });
    } catch (err) {
      setSt((s) => ({ ...s, error: errorMessage(err), ready: true }));
    }
  }, []);
  // with the realtime socket connected the server pushes changes: the poll is only a safety net (3 min); without it, 45 s as before
  useEffect(() => { reload(); let last = Date.now(); const h = setInterval(() => { if (document.visibilityState === 'hidden') return; if (Date.now() - last < (isRealtimeConnected() ? 180000 : 45000) - 2000) return; last = Date.now(); reload({ poll: true }); }, 15000); return () => clearInterval(h); }, [reload]);
  // optimistic: drop items from the list right away (e.g. after "Move to…"); the next reload brings back anything that failed
  const hideLocal = useCallback((ids) => { const gone = new Set(ids); setSt((x) => ({ ...x, items: x.items.filter((n) => !gone.has(n.id)) })); }, []);
  return [st, reload, hideLocal];
}

const cellStyle = (p, cell) => ({ insetInlineEnd: p.x, top: p.y, width: cell.w, height: cell.h });

export default function DesktopOS() {
  const { locale, setLocale, toggleLocale } = useLanguage();
  const ar = locale === 'ar';
  const dir = ar ? 'rtl' : 'ltr';
  const tt = useCallback((en, a) => (ar ? a : en), [ar]);
  const { theme, mode, setMode, toggleTheme } = useTheme();
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const [, setParams] = usePrivateParams();
  usePageMeta(ar ? 'جهازي' : 'My PC', '');

  const uidRef = useRef(user?.id); uidRef.current = user?.id;
  const [prefs, setPrefsState] = useState(() => loadPrefs(user?.id));
  const setPrefs = useCallback((patch) => setPrefsState((p) => { const n = { ...p, ...patch }; savePrefs(n, uidRef.current); return n; }), []);
  const [wm, rawDispatch] = useReducer(wmReducer, user?.id, (uid) => {
    // windows of the platform's pages are only restored while the virtual mode is on
    const known = readVirtualCache(uid) === true ? APPS : Object.fromEntries(Object.entries(APPS).filter(([k]) => !isVmApp(k)));
    return restoreWm(uid, known) || initialWm;
  });
  // remember the open windows so a refresh / crash / closed tab brings them back (editors restore their unsaved edits themselves)
  useEffect(() => { const t = setTimeout(() => saveWm(uidRef.current, wm), 400); return () => clearTimeout(t); }, [wm]);
  // a window may veto its own close (unsaved edits in the code editor / image editor): guards register here
  const guards = useRef(new Map());
  const dispatch = useCallback((a) => {
    if (a.type === 'close' && !a.force) {
      const g = guards.current.get(a.id)?.(); // false = stay · Promise<boolean> = the "Save changes?" dialog decides
      if (g === false) return;
      if (g && typeof g.then === 'function') { g.then((ok) => { if (ok !== false) rawDispatch({ ...a, force: true }); }); return; }
    }
    rawDispatch(a);
  }, []);
  const guardFns = useRef(new Map()); // one stable registrar per window id (effects depend on its identity)
  const guardFor = useCallback((id) => {
    if (!guardFns.current.has(id)) guardFns.current.set(id, (fn) => { if (fn) guards.current.set(id, fn); else guards.current.delete(id); });
    return guardFns.current.get(id);
  }, []);
  const [desk, reloadDesk, hideLocal] = useDesktopFolder();
  const widgets = useDesktopWidgets(user?.id); // sticky notes + clock / calendar / to-do widgets (synced to the account)
  const [newWidgetId, setNewWidgetId] = useState(null);
  const [extOver, setExtOver] = useState(null); // desktop folder icon hovered by a file dragged in from a window
  const vmode = useVirtualMode();
  const virtual = vmode.enabled; // the student works on the whole platform from inside this desktop (see ../virtual)
  const mobile = useIsMobileOS(); // phone-sized screen -> <MobileShell> (a purpose-built phone UI) instead of the windowed desktop
  // navigation sidebar: open by default on wide screens, pinned beside the windows (or floating over them); remembered per account
  const [wide, setWide] = useState(() => window.innerWidth >= 1100);
  useEffect(() => { const h = () => setWide(window.innerWidth >= 1100); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, []);
  const navOpen = !mobile && (prefs.navOpen ?? wide);
  const navPinned = wide && prefs.navPin !== false;
  layoutInset.w = navOpen && navPinned ? NAV_W : 0; // the window manager sizes / clamps windows to what the sidebar leaves
  const navRef = useRef({}); navRef.current = { open: navOpen, pinned: navPinned };
  const toggleNav = useCallback(() => setPrefs({ navOpen: !navRef.current.open }), [setPrefs]);
  const closeNav = useCallback(() => setPrefs({ navOpen: false }), [setPrefs]);
  const [overlay, setOverlay] = useState(null); // 'start' | 'run' | 'taskview' | 'qs' | 'cal' | 'notif'
  const battery = useBattery();
  const online = useOnline();
  const [fs, setFs] = useState(() => !!document.fullscreenElement);
  // A maximized window now fills everything below the menu bar; the Dock auto-hides and slides up when the pointer touches the bottom edge.
  const [dockPeek, setDockPeek] = useState(false);
  useEffect(() => { const h = () => setFs(!!document.fullscreenElement); document.addEventListener('fullscreenchange', h); return () => document.removeEventListener('fullscreenchange', h); }, []);
  // A new device / tab starts LOCKED when a lock password is set (or not yet known); a reload in the same tab keeps its state.
  const bootLock = useRef(false);
  const unverified = useRef(false); // started unlocked only because of the local "no password" cache: the server still has to confirm it
  const [locked, setLockedRaw] = useState(() => {
    const uid = user?.id;
    if (readHeldFlag(uid)) return true; // the screen was locked in this tab (manual / idle / sleep / remote / boot): a reload (even a hard one) keeps it locked
    if (readSec(uid).lockOnStart === false) return false; // the person chose not to start locked
    if (readUnlockedFlag(uid)) return readLockedFlag(uid);
    // FAIL CLOSED: a new tab / device starts locked, and a stale "no password" cache no longer opens the desktop —
    // only the server's answer (see the effect below) may unlock it without a password.
    bootLock.current = true; writeHeldFlag(uid, true); return true;
  });
  const lockOnRef = useRef(null);
  const setLocked = useCallback((v) => { bootLock.current = false; unverified.current = false; writeHeldFlag(uidRef.current, !!v); setLockedRaw(v); writeLockedFlag(uidRef.current, !!v && lockOnRef.current === true); writeUnlockedFlag(uidRef.current, !v); }, []);
  const [booting, setBooting] = useState(true);
  const [menu, setMenu] = useState(null);
  const [dlg, setDlg] = useState(null);
  const [assist, setAssist] = useState(null); // Snap Assist: { zones, skip }
  const [toast, setToast] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [dropping, setDropping] = useState(false);
  const [clip, setClip] = useSharedClip(); // copy / cut clipboard (shared with the Explorer window)
  const [box, setBox] = useState(null); // rubber-band selection rectangle, in desktop coordinates
  const [drag, setDrag] = useState(null); // { keys, dx, dy, over } while icons are being dragged
  const [deskSize, setDeskSize] = useState({ w: 0, h: 0 });
  const iconEls = useRef({});
  const suppressClick = useRef(false);
  const deskRef = useRef(null);
  const dlgResolve = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => lockScroll(), []);
  useEffect(() => { document.documentElement.classList.add('os-active'); return () => document.documentElement.classList.remove('os-active'); }, []);
  useEffect(() => { const h = setTimeout(() => setBooting(false), 950); return () => clearTimeout(h); }, []);

  const flash = useCallback((msg, tone = 'ok') => {
    setToast({ msg, tone });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), tone === 'error' ? 5000 : 2400);
  }, []);

  // ---- dialogs (promise based) -------------------------------------------------------------------------
  const ask = useCallback((cfg) => new Promise((resolve) => { dlgResolve.current = resolve; setDlg(cfg); }), []);
  const finishDlg = useCallback((v) => { setDlg(null); dlgResolve.current?.(v); dlgResolve.current = null; }, []);

  // ---- windows -----------------------------------------------------------------------------------------
  const openApp = useCallback((app, props, extra = {}) => {
    const def = APPS[app];
    dispatch({ type: 'open', app, singleton: def.singleton, size: def.size, props, ...extra, maximized: extra.maximized ?? fitsMaximized(def.size), area: { aw: areaW(), ah: window.innerHeight - chromeH() } });
    setOverlay(null);
  }, [dispatch]);
  const openExplorer = useCallback((params = {}) => { setParams(params); openApp('explorer'); }, [openApp, setParams]);
  // ---- virtual mode: a portal URL (/student/courses, /student/my-exams/5…) shown as a window of this desktop ----------------------
  const openVirtualPath = useCallback((path, extra = {}) => {
    const t = resolveTarget(path);
    if (t.kind === 'explorer') { openExplorer({}); return true; }
    if (t.kind !== 'app') return false;
    const a = t.app;
    openApp(a.id, { go: path, nonce: Date.now() }, { maximized: prefs.openMax !== false, ...extra });
    return true;
  }, [openApp, openExplorer, prefs.openMax]);
  const openVirtualPathRef = useRef(openVirtualPath); openVirtualPathRef.current = openVirtualPath;
  // a portal page that was redirected here (a notification link, a bookmark, "back to exams" after an exam…) opens as a window, once
  useEffect(() => {
    if (!virtual) return;
    const p = takeVirtualOpen();
    if (p) openVirtualPathRef.current(p);
  }, [virtual]);
  // Save Center toasts ("Set up cloud backup") open Settings ▸ Storage & backup in this desktop
  useEffect(() => {
    const h = (e) => { if (e.detail) e.detail.handled = true; openApp('settings', { tab: 'cloud' }); };
    window.addEventListener('uip-open-cloud-settings', h);
    return () => window.removeEventListener('uip-open-cloud-settings', h);
  }, [openApp]);

  const sleepRef = useRef(null);
  // Lock icon in the Dock: asks first (Enter locks, Esc stays). Menus / shortcuts / auto-lock still lock straight away.
  const confirmLock = useCallback(() => {
    setOverlay(null);
    ask({ kind: 'confirm', title: tt('Lock the screen?', 'قفل الشاشة؟'), text: tt('The desktop will be covered by the lock screen. Your windows and files stay exactly as they are.', 'سطح المكتب هيتغطى بشاشة القفل. نوافذك وملفاتك هتفضل زي ما هي.'), action: tt('Lock', 'قفل'), icon: 'lock' })
      .then((ok) => { if (ok) setLocked(true); });
  }, [ask, setLocked, tt]);

  const runCommand = useCallback((id) => {
    switch (id) {
      case 'explorer': openExplorer({}); break;
      case 'bin': openExplorer({ view: 'trash' }); break;
      case 'settings': openApp('settings'); break;
      case 'cloud': openApp('settings', { tab: 'cloud' }); break;
      case 'personalize': openApp('settings', { tab: 'personalize' }); break;
      case 'taskmgr': openApp('taskmgr'); break;
      case 'shortcuts': openApp('shortcuts'); break;
      case 'notes': case 'calendar': case 'calculator': case 'terminal': case 'vscode': case 'browser': openApp(id); break;
      case 'ai': setOverlay(null); window.dispatchEvent(new Event(OPEN_AI_EVENT)); break;
      case 'run': setOverlay('run'); break;
      case 'lock': setOverlay(null); setLocked(true); break;
      case 'sleep': setOverlay(null); sleepRef.current?.(); break;
      case 'security': openApp('settings', { tab: 'security' }); break;
      case 'portal': // leaving the desktop asks first: Enter (or the Exit button) confirms, Esc / Cancel stays
        setOverlay(null);
        if (virtual) { // UIPE OS is pinned: "the portal" IS this desktop, so this opens the platform's home window instead of leaving
          if (VM_BY_KEY.dashboard) openVirtualPath(VM_BY_KEY.dashboard.route);
          break;
        }
        ask({ kind: 'confirm', title: tt('Exit to the UIPE portal?', 'الخروج إلى بوابة UIPE؟'), text: tt('You will leave the desktop and go back to the portal. Your files stay saved.', 'هتخرج من سطح المكتب وترجع للبوابة. ملفاتك فاضلة محفوظة.'), action: tt('Exit', 'خروج'), icon: 'logout' })
          .then((ok) => { if (ok) navigate(roleHome(user?.role)); });
        break;
      case 'logout': // sign out of the ACCOUNT (not just the desktop): keep the data on this device, or erase it first (shared computers)
        setOverlay(null);
        // an exam in progress keeps its answers in this browser until they are sent: erasing the device's data is locked meanwhile
        desktopApi.resetStatus().catch(() => null).then((st) => ask({
          kind: 'choice', icon: 'logout', danger: true, focus: st?.exam_active ? 0 : 1,
          title: tt('Sign out of your account?', 'تسجيل الخروج من حسابك؟'),
          text: st?.exam_active
            ? tt('An exam is in progress, so erasing this device\'s data is locked (your answers are still being saved here). Submit the exam first.', 'فيه امتحان شغّال، فمسح بيانات الجهاز مقفول (إجاباتك لسه بتتحفظ هنا). سلّم الامتحان الأول.')
            : tt('If someone else may use this device after you, erase your data from it so they cannot find your saved settings, drafts or cached files.', 'لو حد ممكن يستخدم الجهاز بعدك، امسح بياناتك منه عشان ميلاقيش إعداداتك ولا مسوداتك ولا ملفاتك المخزّنة.'),
          choices: [
            ...(st?.exam_active ? [] : [{ id: 'wipe', danger: true, icon: 'trash', label: tt('Sign out and erase my data', 'خروج ومسح بياناتي من الجهاز'), hint: tt('Clears drafts, cached files, settings and recent items saved on this device. Your files in your account stay safe.', 'بيمسح المسودات والملفات المؤقتة والإعدادات والمفتوحات الأخيرة المحفوظة على الجهاز ده. ملفاتك في حسابك فاضلة سليمة.') }]),
            { id: 'keep', icon: 'logout', label: tt('Sign out only', 'خروج فقط'), hint: tt('Leaves the data on this device as it is — fine for your own device.', 'بيسيب بيانات الجهاز زي ما هي — مناسب لجهازك الشخصي.') },
          ],
          note: tt('Passwords saved by the browser itself can only be removed from the browser settings.', 'الباسوردات اللي المتصفح نفسه حافظها بتتمسح من إعدادات المتصفح بس.'),
        })).then((v) => { if (v === 'wipe') logout({ wipe: true }); else if (v === 'keep') logout(); });
        break;
      default:
        if (isVmApp(id)) openVirtualPath(VM_BY_ID[id].route);
        break;
    }
  }, [ask, flash, logout, navigate, openApp, openExplorer, openVirtualPath, setLocked, tt, user?.role, virtual, vmode]);

  // images / PDFs / media / ZIPs open in a Viewer window, text & code in a Code-editor window (one window per file)
  const openFileWin = useCallback((p) => {
    if (p.kind === 'vscode') { openApp('vscode', { req: { folder: p.folder, nonce: Date.now() } }, { maximized: prefs.openMax !== false }); return; }
    if (p.kind === 'browser') { openApp('browser', { req: { url: p.url, nonce: Date.now() } }, { maximized: prefs.openMax !== false }); return; }
    if (p.kind === 'viewer') {
      const f = p.files.find((x) => x.id === p.startId);
      if (f) addRecent(uidRef.current, { id: f.driveId ?? f.id, name: f.original_name, type: 'file', size_bytes: f.size_bytes });
      openApp('viewer', { files: p.files, startId: p.startId }, { title: f?.original_name, key: `v:${p.startId}`, maximized: prefs.openMax !== false });
    } else {
      const en = p.editor.node;
      addRecent(uidRef.current, { id: en.id, name: en.name, type: p.editor.kind === 'folder' ? 'folder' : 'file', how: p.editor.kind === 'folder' ? 'editor-folder' : undefined, size_bytes: en.size_bytes });
      openApp('editor', { editor: p.editor }, { title: p.editor.node.name, key: `e:${p.editor.node.id}`, maximized: prefs.openMax !== false });
    }
  }, [openApp, prefs.openMax]);
  const openNode = useCallback((n) => {
    if (n.type === 'folder') { addRecent(uidRef.current, { id: n.id, name: n.name, type: 'folder' }); openExplorer({ folder: String(n.id) }); return; }
    if (opensInEditor(n.name)) { openFileWin({ kind: 'editor', editor: { kind: 'text', node: n } }); return; }
    const toFile = (x) => ({ id: x.id, original_name: x.name, url: `drive:${x.id}`, size_bytes: x.size_bytes, size_human: x.size_human, version: 1, driveId: x.id });
    const sibs = desk.items.filter((x) => x.type === 'file' && !isSystemNode(x) && !opensInEditor(x.name));
    openFileWin({ kind: 'viewer', startId: n.id, files: (sibs.some((x) => x.id === n.id) ? sibs : [n]).map(toFile) });
  }, [desk.items, openExplorer, openFileWin]);

  // "Recent" in Spotlight: the last files / folders opened (kept per account, refreshed whenever one is opened)
  const [recents, setRecents] = useState(() => loadRecents(user?.id));
  useEffect(() => {
    const h = () => setRecents(loadRecents(uidRef.current));
    h();
    window.addEventListener(RECENTS_EVENT, h);
    return () => window.removeEventListener(RECENTS_EVENT, h);
  }, [user?.id]);
  const openRecent = useCallback((r) => {
    setOverlay(null);
    if (r.how === 'editor-folder') openFileWin({ kind: 'editor', editor: { kind: 'folder', node: { id: r.id, name: r.name, type: 'folder' } } });
    else openNode({ id: r.id, name: r.name, type: r.type, size_bytes: r.size_bytes });
  }, [openFileWin, openNode]);

  // a viewer / editor window saved something in My PC -> refresh the desktop icons
  useEffect(() => onDriveChanged(() => reloadDesk()), [reloadDesk]);

  // F5 / right-click > Refresh: re-read the Desktop folder, the Recycle Bin state AND every open Explorer window (they listen to the same event),
  // instead of silently re-fetching one list. The event makes the desktop reload itself, so reloadDesk is not called twice.
  const refreshAll = useCallback(() => {
    window.dispatchEvent(new Event('uip-drive-changed'));
    flash(tt('Refreshed.', 'تم التحديث.'));
  }, [flash, tt]);

  // right-click > New > Word / Excel / PowerPoint / PDF …: <NewFileDialog> saves the file on the Desktop; once the icons reload, open it in its editor window
  const pendingOpen = useRef(null);
  const newDoc = useCallback((type) => { setOverlay(null); setDlg({ kind: 'newfile', type }); }, []);
  useEffect(() => {
    if (pendingOpen.current == null) return;
    const n = desk.items.find((x) => x.id === pendingOpen.current);
    if (!n) return;
    pendingOpen.current = null;
    openNode(n);
  }, [desk.items, openNode]);

  // after the Explorer window loses focus / closes, pick up any changes it made to the Desktop folder
  const explorerWin = wm.list.find((w) => w.app === 'explorer');
  const explorerLive = !!explorerWin && !explorerWin.min && wm.active === explorerWin.id;
  const wasLive = useRef(false);
  useEffect(() => { if (wasLive.current && !explorerLive) reloadDesk(); wasLive.current = explorerLive; }, [explorerLive, reloadDesk]);

  // keep keyboard focus on the active window (and give it back when an overlay closes)
  useEffect(() => {
    if (overlay || locked || dlg) return;
    const el = wm.active ? document.getElementById(`os-${wm.active}`) : null;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    else if (!wm.active && document.activeElement === document.body) deskRef.current?.focus({ preventScroll: true });
  }, [wm.active, overlay, locked, dlg]);

  // ---- taskbar model -----------------------------------------------------------------------------------
  // pinned apps (one button each) + every other open window (one button per window, e.g. each opened file)
  const hiddenDock = hiddenList(prefs.hiddenDock);
  const hiddenIcons = hiddenList(prefs.hiddenIcons);
  // virtual mode: the platform's main apps are pinned right after This PC
  const pinned = useMemo(() => (virtual ? ['explorer', ...VM_DOCK.filter((k) => VM_BY_KEY[k]).map(vmId), ...PINNED.filter((k) => k !== 'explorer')] : PINNED), [virtual]);
  const taskItems = useMemo(() => [
    // a Dock app the person removed stays out of the Dock, except while one of its windows is open (so that window can still be reached)
    ...pinned.filter((app) => !hiddenDock.includes(app) || wm.list.some((w) => w.app === app)).map((app) => ({ key: app, app })),
    ...wm.list.filter((w) => !pinned.includes(w.app)).map((w) => ({ key: w.id, app: w.app, winId: w.id })),
  ], [wm.list, hiddenDock, pinned]);
  const winOf = useCallback((it) => (it.winId ? wm.list.find((x) => x.id === it.winId) : wm.list.find((x) => x.app === it.app)), [wm.list]);
  const taskClick = useCallback((it) => {
    const w = winOf(it);
    if (!w) { it.app === 'explorer' ? openExplorer({}) : openApp(it.app); return; }
    if (w.min || wm.active !== w.id) dispatch({ type: 'focus', id: w.id });
    else dispatch({ type: 'minimize', id: w.id });
    setOverlay(null);
  }, [winOf, wm.active, openApp, openExplorer, dispatch]);

  // ---- desktop shortcuts: an icon that points at a folder / project / file anywhere in My PC (the item itself never moves) ----------
  const shortcutIds = idList(prefs.shortcuts);
  const shortcutsRef = useRef(shortcutIds); shortcutsRef.current = shortcutIds;
  const [lnkNodes, setLnkNodes] = useState({});
  useEffect(() => {
    let dead = false;
    const run = async () => {
      const ids = shortcutsRef.current;
      if (!ids.length) { setLnkNodes((m) => (Object.keys(m).length ? {} : m)); return; }
      try {
        const d = (await drive.resolve(ids)).data || {};
        if (dead) return;
        const map = {}; (d.items || []).forEach((n) => { map[n.id] = n; });
        setLnkNodes(map);
        if (d.gone?.length) setPrefs({ shortcuts: shortcutsRef.current.filter((id) => !d.gone.includes(id)) }); // deleted for good: drop the shortcut
      } catch { /* offline: keep what is shown */ }
    };
    run();
    const off = onDriveChanged(run);
    return () => { dead = true; off(); };
  }, [shortcutIds, setPrefs]);
  const addShortcuts = useCallback((ids) => {
    const cur = shortcutsRef.current;
    const next = [...new Set([...cur, ...ids.filter(Number.isInteger)])].slice(0, 100);
    if (next.length === cur.length) { flash(tt('Already on the desktop.', 'موجود بالفعل على سطح المكتب.')); return; }
    setPrefs({ shortcuts: next });
    flash(tt('Shortcut added to the desktop.', 'تمت إضافة اختصار على سطح المكتب.'));
  }, [flash, setPrefs, tt]);
  const removeShortcuts = useCallback((ids) => {
    setPrefs({ shortcuts: shortcutsRef.current.filter((id) => !ids.includes(id)) });
    setSel(new Set());
    flash(tt('Shortcut removed — the original was not touched.', 'تم حذف الاختصار — الأصل ما اتأثرش.'));
  }, [flash, setPrefs, tt]);
  useEffect(() => { const h = (e) => addShortcuts((e.detail?.ids || []).map(Number)); window.addEventListener('uip-desktop-shortcut', h); return () => window.removeEventListener('uip-desktop-shortcut', h); }, [addShortcuts]);

  // ---- desktop icons -----------------------------------------------------------------------------------
  const sysIcons = useMemo(() => [
    { key: 'sys:explorer', sys: true, label: tt('This PC', 'جهازي'), glyph: 'explorer', run: () => openExplorer({}) },
    { key: 'sys:bin', sys: true, label: tt('Recycle Bin', 'سلة المحذوفات'), glyph: 'bin', run: () => openExplorer({ view: 'trash' }) },
    { key: 'sys:portal', sys: true, label: tt('UIPE Portal', 'بوابة UIPE'), glyph: 'portal', run: () => runCommand('portal') },
    { key: 'sys:logout', sys: true, label: tt('Sign out', 'تسجيل الخروج'), glyph: 'logout', run: () => runCommand('logout') },
    { key: 'sys:settings', sys: true, label: tt('Settings', 'الإعدادات'), glyph: 'settings', run: () => runCommand('settings') },
    { key: 'sys:shortcuts', sys: true, label: tt('Shortcuts', 'الاختصارات'), glyph: 'shortcuts', run: () => runCommand('shortcuts') },
    // virtual mode: the platform's main pages sit on the desktop like installed apps
    ...(virtual ? VM_DESKTOP.filter((k) => VM_BY_KEY[k]).map((k) => ({ key: deskIconKey(k), sys: true, label: ar ? VM_BY_KEY[k].ar : VM_BY_KEY[k].en, glyph: vmId(k), run: () => runCommand(vmId(k)) })) : []),
  ], [tt, ar, virtual, openExplorer, runCommand]);
  const deskItems = useMemo(() => desk.items.filter((n) => !isSystemNode(n)), [desk.items]); // hide the hidden settings files
  // shortcut icons carry `lnk` (NOT `node`): copy / cut / delete / drag-to-folder act on real desktop files only, never on the original
  const openShortcut = useCallback((n) => {
    if (n.type === 'folder' && n.kind === 'project') openFileWin({ kind: 'editor', editor: { kind: 'folder', node: { id: n.id, name: n.name, type: 'folder' } } });
    else openNode(n);
  }, [openFileWin, openNode]);
  const lnkIcons = useMemo(() => shortcutIds.map((id) => lnkNodes[id]).filter(Boolean).map((n) => ({ key: `lnk:${n.id}`, lnk: n, label: n.name, run: () => openShortcut(n) })), [shortcutIds, lnkNodes, openShortcut]);
  const icons = useMemo(() => [...sysIcons.filter((i) => !hiddenIcons.includes(i.key)), ...deskItems.map((n) => ({ key: `n:${n.id}`, node: n, label: n.name, run: () => openNode(n) })), ...lnkIcons], [sysIcons, hiddenIcons, deskItems, openNode, lnkIcons]);
  const selNodes = icons.filter((i) => sel.has(i.key) && i.node).map((i) => i.node);

  // ---- icon grid + remembered positions ----------------------------------------------------------------
  const cell = CELL[prefs.iconSize] || CELL.m;
  const posKey = iconPosKey(user?.id);
  const [store, setStore] = useState(() => ({ key: posKey, map: loadIconPos(posKey) }));
  useEffect(() => { if (store.key !== posKey) setStore({ key: posKey, map: loadIconPos(posKey) }); }, [posKey, store.key]);
  const saved = store.key === posKey ? store.map : EMPTY_POS;
  const commitPos = useCallback((map) => { setStore({ key: posKey, map }); saveIconPos(posKey, map); }, [posKey]);
  useEffect(() => {
    const el = deskRef.current;
    if (!el) return undefined;
    const measure = () => setDeskSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [mobile]);
  const rows = Math.max(1, Math.floor((deskSize.h - PAD_Y - BOTTOM_PAD + GAP + ROW_SLACK) / (cell.h + GAP)));
  const cols = Math.max(1, Math.floor((deskSize.w - 2 * PAD_X + GAP) / (cell.w + GAP)));
  const layout = useMemo(() => layoutIcons(icons.map((i) => i.key), saved, cell, deskSize, rows, cols), [icons, saved, cell, deskSize, rows, cols]);
  // settings (+ lock password status) follow the student to every device — stored on the server, see ./sync.js
  const { synced, lockEnabled, setLockEnabled } = useDesktopSync({
    uid: user?.id,
    state: useMemo(() => ({ prefs, icons: saved, mode, locale }), [prefs, saved, mode, locale]),
    apply: useCallback((n) => {
      setPrefsState(n.prefs); savePrefs(n.prefs, user?.id);
      commitPos(n.icons);
      if (n.mode && n.mode !== mode) setMode(n.mode);
      if (n.locale && n.locale !== locale) setLocale(n.locale);
    }, [commitPos, mode, locale, setMode, setLocale, user?.id]),
  });
  lockOnRef.current = lockEnabled;
  // Security & devices: auto-lock, sleep, lock-on-leave, remote lock, sign-out countdown (see ./security.js)
  const onSecLock = useCallback((reason) => {
    setOverlay(null); setLocked(true);
    if (reason === 'remote') flash(tt('This device was locked from another device.', 'الجهاز ده اتقفل من جهاز تاني.'), 'ok');
  }, [setLocked, flash, tt]);
  const { sec, applySec, asleep, sleep, wake, idleLeft, stay } = useDesktopSecurity({ uid: user?.id, locked, onLock: onSecLock });
  // Notification center: finished uploads + server notifications (a message from a doctor …). Quiet while locked / asleep.
  const nc = useDesktopNotifications({ uid: user?.id, ar, tt, quiet: locked || asleep });
  // Opening a notification marks it read, then follows its link. Links go to portal pages, so leaving the desktop asks first (same dialog as "Exit").
  const openNotif = useCallback((it) => {
    const link = it.link || null;
    if (it.serverId != null) nc.markRead({ src: 'server', id: it.serverId, read: false });
    else if (it.localId) nc.markRead({ src: 'local', id: it.localId, read: false });
    else nc.markRead(it);
    setOverlay(null);
    if (!link) { if (it.src === 'local' || it.localId) openApp('explorer'); return; } // an upload entry → the file explorer
    if (/^(https?:)?\/\//i.test(link)) { window.open(link, '_blank', 'noopener,noreferrer'); return; }
    if (/^\/[a-z-]+\/my-pc(\/|$)/.test(link)) { navigate(link); return; }
    if (virtual && openVirtualPath(link)) return; // virtual mode: the page opens as a window, the desktop is not left
    ask({ kind: 'confirm', title: tt('Open this in the portal?', 'فتح ده في البوابة؟'), text: tt('You will leave the desktop and go to the portal page. Your files stay saved.', 'هتخرج من سطح المكتب وتروح لصفحة في البوابة. ملفاتك فاضلة محفوظة.'), action: tt('Open', 'فتح'), icon: 'logout' })
      .then((ok) => { if (ok) navigate(link); });
  }, [ask, navigate, nc, openApp, openVirtualPath, tt, virtual]);
  const notifAll = useCallback(() => {
    setOverlay(null);
    if (virtual && openVirtualPath(`/${roleHome(user?.role).split('/')[1]}/notifications`)) return;
    ask({ kind: 'confirm', title: tt('Open all notifications?', 'فتح كل الإشعارات؟'), text: tt('You will leave the desktop and go to the Notifications page. Your files stay saved.', 'هتخرج من سطح المكتب وتروح لصفحة الإشعارات. ملفاتك فاضلة محفوظة.'), action: tt('Open', 'فتح'), icon: 'logout' })
      .then((ok) => { if (ok) navigate(`/${roleHome(user?.role).split('/')[1]}/notifications`); });
  }, [ask, navigate, openVirtualPath, tt, user?.role, virtual]);
  sleepRef.current = sleep;
  const secRef = useRef(sec); secRef.current = sec;
  const onWake = useCallback(() => { wake(); if (secRef.current.lockAfterSleep && lockOnRef.current === true) setLocked(true); }, [wake, setLocked]);
  useEffect(() => {
    const startLocked = sec.lockOnStart !== false;
    if ((lockEnabled === false || !startLocked) && bootLock.current && (synced || !startLocked)) { bootLock.current = false; setLockedRaw(false); writeHeldFlag(uidRef.current, false); writeUnlockedFlag(uidRef.current, true); } // no password set / chose not to start locked: nothing to ask on a new device
    else if (lockEnabled === true && startLocked && (unverified.current || !readUnlockedFlag(uidRef.current))) { unverified.current = false; setLockedRaw(true); writeHeldFlag(uidRef.current, true); writeUnlockedFlag(uidRef.current, false); } // a password exists (set on another device, or the local cache was stale): ask for it
    if (synced) unverified.current = false;
  }, [lockEnabled, sec.lockOnStart, synced]);
  // remember where every icon sits (new ones get the first free cell, deleted ones are forgotten)
  useEffect(() => {
    if (!synced || !desk.ready || desk.error || store.key !== posKey || !deskSize.h) return;
    const keys = icons.map((i) => i.key);
    if (!keys.some((k) => saved[k]?.x === undefined) && !Object.keys(saved).some((k) => !keys.includes(k))) return; // also migrates old grid-cell layouts to pixels
    const next = {};
    keys.forEach((k) => { next[k] = saved[k]?.x !== undefined ? saved[k] : layout[k]; });
    commitPos(next);
  }, [synced, desk.ready, desk.error, store.key, posKey, deskSize.h, icons, saved, layout, commitPos]);
  const live = useRef({}); // latest values for the pointer handlers below
  const selRef = useRef(sel);
  selRef.current = sel;
  live.current = { layout, rows, cols, cell, ar, icons, commitPos, prefs, deskSize };

  const newFolder = useCallback(async () => {
    const v = await ask({ kind: 'prompt', title: tt('New folder', 'مجلد جديد'), label: tt('Folder name', 'اسم المجلد'), value: tt('New folder', 'مجلد جديد'), selectAll: true, action: tt('Create', 'إنشاء') });
    if (!v || !desk.id) return;
    try { await drive.createFolder(desk.id, v); reloadDesk(); } catch (e) { flash(errorMessage(e), 'error'); }
  }, [ask, desk.id, flash, reloadDesk, tt]);
  const newFile = useCallback(async () => {
    const v = await ask({ kind: 'prompt', title: tt('New text file', 'ملف نصي جديد'), label: tt('File name', 'اسم الملف'), value: 'untitled.txt', action: tt('Create', 'إنشاء') });
    if (!v || !desk.id) return;
    try { await drive.createFile(desk.id, v); reloadDesk(); } catch (e) { flash(errorMessage(e), 'error'); }
  }, [ask, desk.id, flash, reloadDesk, tt]);
  const renameNode = useCallback(async (n) => {
    const v = await ask({ kind: 'prompt', title: tt('Rename', 'إعادة تسمية'), label: tt('New name', 'الاسم الجديد'), value: n.name, selectAll: n.type === 'folder', action: tt('Rename', 'تسمية') });
    if (!v || v === n.name) return;
    try { await drive.rename(n.id, v); reloadDesk(); } catch (e) { flash(errorMessage(e), 'error'); }
  }, [ask, flash, reloadDesk, tt]);
  const trashNodes = useCallback(async (nodes) => {
    if (!nodes.length) return;
    try { await drive.trash(nodes.map((n) => n.id)); setSel(new Set()); flash(tt('Moved to the Recycle Bin.', 'تم النقل إلى سلة المحذوفات.')); reloadDesk(); } catch (e) { flash(errorMessage(e), 'error'); }
  }, [flash, reloadDesk, tt]);

  // ---- copy / cut / paste -------------------------------------------------------------------------------
  const copyNodes = useCallback((nodes, mode) => {
    if (!nodes.length) return;
    setClip({ ids: nodes.map((n) => n.id), mode });
    flash(mode === 'cut' ? tt('Cut — paste where you want.', 'تم القص — الصق في المكان المطلوب.') : tt('Copied to clipboard.', 'تم النسخ للحافظة.'));
  }, [flash, setClip, tt]);
  const pasteInto = useCallback(async (targetId) => {
    const cur = clip;
    if (!cur?.ids?.length || !targetId) return;
    const here = new Set(desk.items.map((n) => n.id));
    if (cur.mode === 'cut' && targetId === desk.id && cur.ids.every((id) => here.has(id))) { setClip(null); return; } // already on the desktop
    try {
      if (cur.mode === 'cut') { await drive.move(cur.ids, targetId); setClip(null); } else { await drive.copy(cur.ids, targetId); }
      flash(cur.mode === 'cut' ? tt('Moved.', 'تم النقل.') : tt('Pasted.', 'تم اللصق.'));
    } catch (e) { flash(errorMessage(e), 'error'); }
    reloadDesk();
  }, [clip, desk.id, desk.items, flash, reloadDesk, setClip, tt]);

  // ---- dragging icons (move on the desktop, or drop on a folder / the Recycle Bin) -----------------------
  const onIconPointerDown = (e, ic) => {
    if (e.button !== 0 || !e.isPrimary) return;
    e.stopPropagation();
    deskRef.current?.focus({ preventScroll: true });
    const additive = e.ctrlKey || e.metaKey;
    if (!additive && !selRef.current.has(ic.key)) setSel(new Set([ic.key]));
    const group = selRef.current.has(ic.key) ? [...selRef.current] : additive ? [...selRef.current, ic.key] : [ic.key];
    const sx = e.clientX; const sy = e.clientY;
    let started = false; let dx = 0; let dy = 0; let over = null;
    const overOf = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-ikey]');
      const k = el?.getAttribute('data-ikey');
      if (!k || group.includes(k)) return null;
      const t = live.current.icons.find((i) => i.key === k);
      return t && (t.key === 'sys:bin' || t.node?.type === 'folder') ? k : null;
    };
    const move = (ev) => {
      dx = ev.clientX - sx; dy = ev.clientY - sy;
      if (!started) {
        if (Math.hypot(dx, dy) < 5) return;
        started = true;
        setMenu(null);
        document.body.classList.add('os-dragging');
        setSel(new Set(group));
      }
      over = overOf(ev);
      if (over) clearDropMark(); else markDropTarget(ev.clientX, ev.clientY); // a window that accepts the file (explorer / code editor) lights up
      setDrag({ keys: group, dx, dy, over });
    };
    const end = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      document.body.classList.remove('os-dragging');
      clearDropMark();
      if (!started) return;
      suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 0);
      setDrag(null);
      if (ev.type === 'pointercancel') return;
      const L = live.current;
      const nodes = group.map((k) => L.icons.find((i) => i.key === k)?.node).filter(Boolean);
      const target = over ? L.icons.find((i) => i.key === over) : null;
      if (target?.key === 'sys:bin' && group.some((k) => k.startsWith('lnk:'))) removeShortcuts(group.filter((k) => k.startsWith('lnk:')).map((k) => Number(k.slice(4)))); // a shortcut dropped on the bin: only the shortcut goes
      if (target?.key === 'sys:bin') { // dropping on the Recycle Bin: files go in it, built-in icons are removed from the desktop (restorable from Settings)
        if (nodes.length) trashNodes(nodes);
        const sysKeys = group.filter((k) => k.startsWith('sys:') && k !== 'sys:bin');
        if (sysKeys.length) hideIcons(sysKeys);
        return;
      }
      if (target?.node && nodes.length) {
        drive.move(nodes.map((n) => n.id), target.node.id)
          .then(() => { flash(tt(`Moved into “${target.node.name}”.`, `تم النقل إلى «${target.node.name}».`)); setSel(new Set()); reloadDesk(); })
          .catch((err) => flash(errorMessage(err), 'error'));
        return;
      }
      // released over a window that takes files (explorer: move there · code editor: add to the project)
      if (nodes.length && ev.type === 'pointerup' && dropOnWindowAt(ev.clientX, ev.clientY, nodes.map((n) => ({ id: n.id, name: n.name, type: n.type, parent_id: n.parent_id ?? null })))) { setSel(new Set()); return; }
      // x counts from the inline-end edge: that is the LEFT edge in Arabic and the RIGHT edge in English, so a drag to the right adds to x only in Arabic
      const moved = planMove(group, L.layout, dx * (L.ar ? 1 : -1), dy, L.cell, L.deskSize);
      L.commitPos({ ...L.layout, ...moved });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  // ---- rubber-band selection ------------------------------------------------------------------------------
  const onDeskPointerDown = (e) => {
    if (e.target !== e.currentTarget || e.button !== 0 || !e.isPrimary) return;
    deskRef.current?.focus({ preventScroll: true });
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    const base = additive ? new Set(selRef.current) : new Set();
    if (!additive) setSel(new Set());
    const rect = deskRef.current.getBoundingClientRect();
    const sx = clamp(e.clientX, rect.left, rect.right); const sy = clamp(e.clientY, rect.top, rect.bottom);
    let started = false; let last = base;
    const move = (ev) => {
      const x = clamp(ev.clientX, rect.left, rect.right); const y = clamp(ev.clientY, rect.top, rect.bottom);
      if (!started) { if (Math.hypot(x - sx, y - sy) < 4) return; started = true; document.body.classList.add('os-dragging'); }
      const l = Math.min(sx, x); const t = Math.min(sy, y); const r = Math.max(sx, x); const b = Math.max(sy, y);
      setBox({ left: l - rect.left, top: t - rect.top, width: r - l, height: b - t });
      const next = new Set(base);
      Object.entries(iconEls.current).forEach(([k, el]) => {
        const q = el.getBoundingClientRect();
        if (q.left < r && q.right > l && q.top < b && q.bottom > t) next.add(k);
      });
      if (next.size !== last.size || [...next].some((k) => !last.has(k))) { last = next; setSel(next); }
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      document.body.classList.remove('os-dragging');
      setBox(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  // ---- remove / restore the built-in icons (desktop + Dock). Files on the desktop are real files: those go to the Recycle Bin instead. -----
  const removedCount = hiddenIcons.filter((k) => DESK_ICONS.some((d) => d[0] === k)).length + hiddenDock.filter((k) => DOCK_ICONS.some((d) => d[0] === k)).length;
  const nameOfIcon = (k) => { const d = DESK_ICONS.find((x) => x[0] === k) || DOCK_ICONS.find((x) => x[0] === k); return d ? (ar ? d[2] : d[1]) : k; };
  const hideIcons = useCallback(async (keys) => {
    const add = keys.filter((k) => k.startsWith('sys:'));
    if (!add.length) return;
    const names = add.map(nameOfIcon).join(ar ? '، ' : ', ');
    const ok = await ask({ kind: 'confirm', danger: true, icon: 'trash', action: tt('Remove', 'حذف'),
      title: add.length > 1 ? tt('Remove these main icons?', 'حذف الأيقونات الرئيسية دي؟') : tt('Remove a main icon?', 'حذف أيقونة رئيسية؟'),
      text: tt(`“${names}” is a main desktop icon. It will disappear from the desktop (your files are not affected). You can bring it back from Settings ▸ Personalization ▸ Icons.`, `«${names}» من أيقونات سطح المكتب الرئيسية. هتختفي من سطح المكتب (ملفاتك مش هتتأثر). تقدر ترجّعها من الإعدادات ▸ التخصيص ▸ الأيقونات.`) });
    if (!ok) return;
    setPrefs({ hiddenIcons: [...new Set([...hiddenList(live.current.prefs.hiddenIcons), ...add])] });
    setSel(new Set());
    flash(tt('Icon removed — bring it back from Settings ▸ Personalization ▸ Icons.', 'تم حذف الأيقونة — ترجّعها من الإعدادات ▸ التخصيص ▸ الأيقونات.'));
  }, [ask, ar, flash, setPrefs, tt]); // eslint-disable-line react-hooks/exhaustive-deps
  const hideDockIcon = useCallback(async (key, open) => {
    const ok = await ask({ kind: 'confirm', danger: true, icon: 'trash', action: tt('Remove', 'إزالة'), title: tt('Remove from the Dock?', 'إزالة من الـ Dock؟'),
      text: tt(`“${nameOfIcon(key)}” will disappear from the Dock. You can bring it back from Settings ▸ Personalization ▸ Icons.`, `«${nameOfIcon(key)}» هتختفي من الـ Dock. تقدر ترجّعها من الإعدادات ▸ التخصيص ▸ الأيقونات.`) });
    if (!ok) return;
    setPrefs({ hiddenDock: [...new Set([...hiddenList(live.current.prefs.hiddenDock), key])] });
    flash(open
      ? tt('Removed from the Dock — it disappears once its window is closed. Restore it from Settings ▸ Personalization ▸ Icons.', 'اتشالت من الـ Dock — هتختفي لما تقفل نافذتها. ترجّعها من الإعدادات ▸ التخصيص ▸ الأيقونات.')
      : tt('Removed from the Dock — bring it back from Settings ▸ Personalization ▸ Icons.', 'اتشالت من الـ Dock — ترجّعها من الإعدادات ▸ التخصيص ▸ الأيقونات.'));
  }, [ask, ar, flash, setPrefs, tt]); // eslint-disable-line react-hooks/exhaustive-deps
  const restoreIcons = useCallback(() => {
    setPrefs({ hiddenIcons: [], hiddenDock: [] });
    flash(tt('All icons restored.', 'تم استرجاع كل الأيقونات.'));
  }, [flash, setPrefs, tt]);
  const dockSpecialMenu = (key, e) => {
    e.preventDefault(); e.stopPropagation();
    setOverlay(null);
    const label = { launchpad: tt('Launchpad', 'لوحة التطبيقات'), lock: tt('Lock screen', 'قفل الشاشة'), portal: tt('UIPE Portal', 'بوابة UIPE'), logout: tt('Sign out', 'تسجيل الخروج'), bin: tt('Recycle Bin', 'سلة المحذوفات') }[key];
    const act = { launchpad: () => setOverlay('start'), lock: confirmLock, portal: () => runCommand('portal'), logout: () => runCommand('logout'), bin: () => runCommand('bin') }[key];
    setMenu({ x: e.clientX, y: e.clientY - 110, items: [{ label, icon: 'eye', onClick: act }, 'sep', { label: tt('Remove from Dock', 'إزالة من الـ Dock'), icon: 'trash', danger: true, onClick: () => hideDockIcon(key, false) }] });
  };

  const addWidget = (type, e) => {
    const r = deskRef.current?.getBoundingClientRect();
    const id = widgets.add(type, r ? { x: e.clientX - r.left - 20, y: e.clientY - r.top - 12 } : undefined);
    setNewWidgetId(type === 'note' ? id : null);
  };
  const removeWidget = async (it) => {
    const hasContent = (it.type === 'note' && (it.text || '').trim()) || (it.type === 'todo' && ((it.todos || []).length || (it.title || '').trim()));
    if (hasContent) {
      const ok = await ask({ kind: 'confirm', danger: true, icon: 'trash', action: tt('Remove', 'إزالة'),
        title: it.type === 'note' ? tt('Remove this note?', 'إزالة الملاحظة دي؟') : tt('Remove this list?', 'إزالة القائمة دي؟'),
        text: tt('Its content will be deleted and cannot be brought back.', 'محتواها هيتمسح ومش هتقدر ترجعه.') });
      if (!ok) return;
    }
    widgets.remove(it.id);
  };
  const deskMenu = (e) => {
    e.preventDefault();
    setOverlay(null);
    setMenu({
      x: e.clientX, y: e.clientY, items: [
        { label: tt('Refresh', 'تحديث'), icon: 'refresh', hint: 'F5', onClick: refreshAll },
        { label: tt('Auto-arrange icons', 'ترتيب الأيقونات تلقائيًا'), icon: 'layers', onClick: () => commitPos({}) },
        ...(removedCount ? [{ label: tt(`Restore removed icons (${removedCount})`, `استرجاع الأيقونات المحذوفة (${removedCount})`), icon: 'refresh', onClick: restoreIcons }] : []),
        'sep',
        { label: tt('New sticky note', 'ملاحظة لاصقة جديدة'), icon: 'note', onClick: () => addWidget('note', e) },
        { label: tt('Add clock', 'إضافة ساعة'), icon: 'clock', onClick: () => addWidget('clock', e) },
        { label: tt('Add calendar', 'إضافة تقويم'), icon: 'calendar', onClick: () => addWidget('calendar', e) },
        { label: tt('Add to-do list', 'إضافة قائمة مهام'), icon: 'check', onClick: () => addWidget('todo', e) },
        'sep',
        { label: tt('Paste', 'لصق'), icon: 'file-plus', hint: 'Ctrl+V', onClick: () => pasteInto(desk.id), disabled: !desk.id || !clip },
        'sep',
        { label: tt('New folder', 'مجلد جديد'), icon: 'folder-plus', hint: 'Ctrl+Shift+N', onClick: newFolder, disabled: !desk.id },
        { label: tt('New text file', 'ملف نصي جديد'), icon: 'file-plus', onClick: newFile, disabled: !desk.id },
        { label: tt('New Word document', 'مستند Word جديد'), icon: 'file-plus', onClick: () => newDoc('docx'), disabled: !desk.id },
        { label: tt('New Excel workbook', 'جدول Excel جديد'), icon: 'file-plus', onClick: () => newDoc('xlsx'), disabled: !desk.id },
        { label: tt('New PowerPoint presentation', 'عرض PowerPoint جديد'), icon: 'file-plus', onClick: () => newDoc('pptx'), disabled: !desk.id },
        { label: tt('New PDF / other file…', 'ملف PDF / نوع آخر…'), icon: 'file-plus', onClick: () => newDoc('pdf'), disabled: !desk.id },
        'sep',
        { label: tt('Open This PC', 'فتح جهازي'), icon: 'monitor', hint: 'Alt+E', onClick: () => runCommand('explorer') },
        { label: tt('Open UIPE Terminal', 'فتح ترمينال UIPE'), icon: 'terminal', hint: 'Alt+T', onClick: () => runCommand('terminal') },
        { label: tt('Personalize', 'تخصيص'), icon: 'palette', hint: 'Alt+P', onClick: () => runCommand('personalize') },
        { label: tt('Keyboard shortcuts', 'اختصارات الكيبورد'), icon: 'key', hint: 'F1', onClick: () => runCommand('shortcuts') },
      ],
    });
  };
  const iconMenu = (e, ic) => {
    e.preventDefault(); e.stopPropagation();
    setOverlay(null);
    if (!sel.has(ic.key)) setSel(new Set([ic.key]));
    const items = [{ label: tt('Open', 'فتح'), icon: 'eye', hint: 'Enter', onClick: ic.run }];
    if (ic.lnk) {
      const n = ic.lnk;
      items.push('sep',
        { label: tt('Show in My PC', 'إظهار في جهازي'), icon: 'folder', onClick: () => openExplorer(n.parent_id ? { folder: String(n.parent_id) } : {}) },
        { label: tt('Remove shortcut', 'حذف الاختصار'), icon: 'trash', danger: true, onClick: () => removeShortcuts([n.id]) });
    } else if (ic.sys) {
      const group = sel.has(ic.key) ? [...sel].filter((k) => k.startsWith('sys:')) : [ic.key];
      items.push('sep', { label: group.length > 1 ? tt(`Remove ${group.length} icons from the desktop`, `حذف ${group.length} أيقونات من سطح المكتب`) : tt('Remove from the desktop', 'حذف من سطح المكتب'), icon: 'trash', hint: 'Del', danger: true, onClick: () => hideIcons(group) });
    } else {
      const many = selNodes.length > 1 && sel.has(ic.key) ? selNodes : [ic.node];
      items.push('sep',
        { label: tt('Copy', 'نسخ'), icon: 'copy', hint: 'Ctrl+C', onClick: () => copyNodes(many, 'copy') },
        { label: tt('Cut', 'قص'), icon: 'ed-crop', hint: 'Ctrl+X', onClick: () => copyNodes(many, 'cut') });
      if (ic.node.type === 'folder' && clip) items.push({ label: tt('Paste into folder', 'لصق داخل المجلد'), icon: 'file-plus', onClick: () => pasteInto(ic.node.id) });
      items.push('sep', { label: tt('Rename', 'إعادة تسمية'), icon: 'edit', hint: 'F2', disabled: many.length > 1, onClick: () => renameNode(ic.node) },
        { label: tt('Delete', 'حذف'), icon: 'trash', hint: 'Del', danger: true, onClick: () => trashNodes(many) });
    }
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const clickIcon = (e, ic) => {
    e.stopPropagation();
    if (suppressClick.current) return; // the click that ends a drag
    deskRef.current?.focus({ preventScroll: true });
    setSel((s) => {
      if (e.ctrlKey || e.metaKey) { const n = new Set(s); n.has(ic.key) ? n.delete(ic.key) : n.add(ic.key); return n; }
      return new Set([ic.key]);
    });
  };

  const onDeskKey = (e) => {
    if (e.target !== deskRef.current && e.target !== document.body && !e.target.closest?.('.os-icon')) return;
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    const keys = icons.map((i) => i.key);
    const cur = icons.filter((i) => sel.has(i.key));
    const pk = keyOf(e); // physical key, so it works on the Arabic layout too
    if (mod && e.shiftKey && pk === 'N') { e.preventDefault(); newFolder(); }
    else if (mod && pk === 'A') { e.preventDefault(); setSel(new Set(keys)); }
    else if (mod && pk === 'C' && selNodes.length) { e.preventDefault(); copyNodes(selNodes, 'copy'); }
    else if (mod && pk === 'X' && selNodes.length) { e.preventDefault(); copyNodes(selNodes, 'cut'); }
    else if (mod && pk === 'V' && clip && desk.id) { e.preventDefault(); pasteInto(desk.id); }
    else if (k === 'Enter' && cur.length) { e.preventDefault(); cur.forEach((i) => i.run()); }
    else if (k === 'F2' && cur.length === 1 && cur[0].node) { e.preventDefault(); renameNode(cur[0].node); }
    else if (k === 'Delete' && (selNodes.length || cur.some((i) => i.sys || i.lnk))) { e.preventDefault(); if (selNodes.length) trashNodes(selNodes); hideIcons(cur.filter((i) => i.sys).map((i) => i.key)); const lk = cur.filter((i) => i.lnk).map((i) => i.lnk.id); if (lk.length) removeShortcuts(lk); }
    else if (k === 'F5') { e.preventDefault(); refreshAll(); }
    else if (k === 'Escape') setSel(new Set());
    else if (k.startsWith('Arrow')) {
      e.preventDefault();
      const here = cur.length ? layout[cur[cur.length - 1].key] : null;
      if (!here) { setSel(new Set(keys.slice(0, 1))); return; }
      const [vc, vr] = { ArrowDown: [0, 1], ArrowUp: [0, -1], ArrowRight: [1, 0], ArrowLeft: [-1, 0] }[k]; // screen directions
      const sx = (p) => (ar ? p.x : deskSize.w - p.x - cell.w); // screen-left of an icon
      let best = null; let bestScore = Infinity;
      icons.forEach((i) => {
        const p = layout[i.key];
        const dX = sx(p) - sx(here); const dY = p.y - here.y;
        const along = dX * vc + dY * vr; // distance in the arrow's direction
        const across = Math.abs(dX * vr) + Math.abs(dY * vc);
        if (along <= 4) return;
        const score = along + across * 3;
        if (score < bestScore) { best = i.key; bestScore = score; }
      });
      if (best) setSel(new Set([best]));
    }
  };

  // A file dragged out of an explorer window: onto the desktop = move it to the desktop folder; onto a desktop folder icon = into that folder.
  const iconUnder = (e) => { const k = e.target?.closest?.('[data-ikey]')?.getAttribute('data-ikey'); const ic = k ? icons.find((i) => i.key === k) : null; return ic?.node?.type === 'folder' ? ic : null; };
  const onDragOverDesk = (e) => {
    if (hasDriveIds(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const ic = iconUnder(e); setExtOver(ic ? ic.key : null); setDropping(!ic); return; }
    if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDropping(true); }
  };
  const dropDriveNodes = async (e) => {
    const nodes = readDragNodes(e.dataTransfer);
    const ic = iconUnder(e);
    const targetId = ic ? ic.node.id : desk.id;
    const inDesk = new Set((desk.items || []).map((n) => n.id));
    const ids = nodes.map((n) => n.id).filter((id) => id !== targetId && (ic || !inDesk.has(id)));
    if (!ids.length || !targetId) return;
    try {
      await drive.move(ids, targetId);
      flash(ic ? tt(`Moved into “${ic.node.name}”.`, `تم النقل إلى «${ic.node.name}».`) : tt('Moved to the desktop.', 'تم النقل إلى سطح المكتب.'));
      window.dispatchEvent(new Event('uip-drive-changed'));
    } catch (err) { flash(errorMessage(err), 'error'); }
    reloadDesk();
  };
  const onDrop = async (e) => {
    e.preventDefault(); setDropping(false); setExtOver(null);
    if (hasDriveIds(e.dataTransfer)) { dropDriveNodes(e); return; }
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length || !desk.id) return;
    flash(tt(`Uploading ${files.length} file(s)…`, `جارٍ رفع ${files.length} ملف…`));
    let bad = 0;
    for (const f of files) { try { await drive.upload(desk.id, f, null); } catch { bad += 1; } } // eslint-disable-line no-await-in-loop
    flash(bad ? tt(`${bad} file(s) could not be uploaded (folders are not supported on the desktop).`, `${bad} ملف مترفعش (المجلدات مش مدعومة على سطح المكتب).`) : tt('Files added to the desktop.', 'تمت إضافة الملفات لسطح المكتب.'), bad ? 'error' : 'ok');
    reloadDesk();
  };

  // ---- keyboard shortcuts ------------------------------------------------------------------------------
  const S = useRef({});
  S.current = { wm, overlay, locked, asleep, dlg, taskItems, taskClick, runCommand, refreshAll, deskKey: onDeskKey, nav: navRef.current, toggleNav, closeNav };
  useEffect(() => {
    const onKey = (e) => {
      const s = S.current;
      if (e.defaultPrevented || s.locked || s.asleep || s.dlg) return;
      // F5 / Ctrl+R: "refresh" belongs to the desktop. Without this, any focus outside the icons (a window, the dock, the menu bar)
      // let the browser reload the whole page, losing the session state. Editors keep their unsaved-edit drafts, but we do not gamble on it.
      const inTerm = !!e.target?.closest?.('.os-term');
      if (!inTerm && (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && keyOf(e) === 'R'))) {
        e.preventDefault();
        s.refreshAll();
        return;
      }
      // Nothing is focused (after closing a window, clicking the Dock / menu bar / a widget …) and no window is active: the keys belong to the
      // desktop icons — Ctrl+C / X / V / A, Delete, F2, arrows. Before, they only worked while the desktop itself held focus, hence "sometimes".
      if ((e.target === document.body || e.target === document.documentElement) && !s.wm.active && !s.overlay) {
        const before = e.defaultPrevented;
        s.deskKey({ ...e, target: document.body, key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, preventDefault: () => e.preventDefault() });
        if (!before && e.defaultPrevented) return;
      }
      const id = globalActionFor(e);
      // the code workbench / viewer keep their own keys; only the window-level Alt combos pass through
      if (e.target?.closest?.('.zb, .st-fv, .mp-editor, .os-wgt, .os-term') && !/^(close|next|prev|desktop|taskview|nav|desk\w+|pin\d)$/.test(id || '')) return;
      if (!id) {
        if (e.key === 'Escape' && s.overlay) { e.preventDefault(); setOverlay(null); } else if (e.key === 'Escape' && s.nav.open && !s.nav.pinned) { e.preventDefault(); s.closeNav(); }
        return;
      }
      e.preventDefault();
      const act = s.wm.list.find((w) => w.id === s.wm.active);
      const onAct = (fn) => { if (act) fn(act); };
      switch (id) {
        case 'nav': s.toggleNav(); break;
        case 'start': setOverlay((o) => (o === 'start' ? null : 'start')); break;
        case 'run': setOverlay((o) => (o === 'run' ? null : 'run')); break;
        case 'taskview': setOverlay((o) => (o === 'taskview' ? null : 'taskview')); break;
        case 'lock': case 'sleep': case 'settings': case 'personalize': case 'explorer': case 'bin': case 'taskmgr': case 'notes': case 'calendar': case 'calculator': case 'terminal': s.runCommand(id); break;
        case 'help': s.runCommand('shortcuts'); break;
        case 'deskNext': dispatch({ type: 'deskStep', dir: 1 }); break;
        case 'deskPrev': dispatch({ type: 'deskStep', dir: -1 }); break;
        case 'deskNew': dispatch({ type: 'deskAdd' }); setOverlay(null); break;
        case 'deskSend': onAct((w) => { const n = ((s.wm.desk || 0) + 1) % Math.max(1, s.wm.desks); const to = n === 0 && s.wm.desks < MAX_DESKS ? s.wm.desks : n; dispatch({ type: 'moveToDesk', id: w.id, n: to }); dispatch({ type: 'deskGo', n: to }); }); break;
        case 'next': dispatch({ type: 'cycle', dir: 1 }); break;
        case 'prev': dispatch({ type: 'cycle', dir: -1 }); break;
        case 'close': onAct((w) => dispatch({ type: 'close', id: w.id })); break;
        case 'desktop': dispatch({ type: 'showDesktop' }); setOverlay(null); break;
        case 'restoreAll': dispatch({ type: 'restoreAll' }); break;
        case 'snapL': onAct((w) => dispatch({ type: 'snap', id: w.id, side: 'left' })); break;
        case 'snapR': onAct((w) => dispatch({ type: 'snap', id: w.id, side: 'right' })); break;
        case 'maximize': onAct((w) => dispatch({ type: 'snap', id: w.id, side: 'max' })); break;
        case 'down': onAct((w) => (w.max ? dispatch({ type: 'toggleMax', id: w.id }) : w.snap ? dispatch({ type: 'patch', id: w.id, patch: { snap: null } }) : dispatch({ type: 'minimize', id: w.id }))); break;
        default: {
          const m = /^pin(\d)$/.exec(id);
          if (m && s.taskItems[Number(m[1]) - 1]) s.taskClick(s.taskItems[Number(m[1]) - 1]);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const runText = (t) => { const id = RUN_ALIASES[t.toLowerCase()]; if (!id) return false; setOverlay(null); runCommand(id); return true; };
  const fullscreen = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => {}); };

  const sysApps = useMemo(() => [
    ...(can('ai.assistant_use') ? [{ id: 'ai', en: 'UIPE AI Assistant', ar: 'مساعد UIPE الذكي', glyph: 'ai' }] : []),
    { id: 'explorer', en: 'This PC', ar: 'جهازي', glyph: 'explorer' },
    { id: 'bin', en: 'Recycle Bin', ar: 'سلة المحذوفات', glyph: 'bin' },
    { id: 'settings', en: 'Settings', ar: 'الإعدادات', glyph: 'settings' },
    { id: 'personalize', en: 'Personalize', ar: 'التخصيص', glyph: 'personalize' },
    { id: 'notes', en: 'Notes', ar: 'الملاحظات', glyph: 'notes' },
    { id: 'calendar', en: 'Calendar', ar: 'التقويم', glyph: 'calendar' },
    { id: 'calculator', en: 'Calculator', ar: 'الآلة الحاسبة', glyph: 'calculator' },
    { id: 'terminal', en: 'UIPE Terminal', ar: 'ترمينال UIPE', glyph: 'terminal' },
    { id: 'vscode', en: 'VS Code', ar: 'VS Code', glyph: 'vscode' },
    { id: 'browser', en: 'Browser', ar: 'المتصفح', glyph: 'browser' },
    { id: 'taskmgr', en: 'Task Manager', ar: 'مدير المهام', glyph: 'taskmgr' },
    { id: 'shortcuts', en: 'Keyboard shortcuts', ar: 'اختصارات الكيبورد', glyph: 'shortcuts' },
    { id: 'run', en: 'Run', ar: 'تشغيل', glyph: 'run' },
    { id: 'lock', en: 'Lock', ar: 'قفل', glyph: 'lock' },
    { id: 'portal', en: 'UIPE Portal', ar: 'بوابة UIPE', glyph: 'portal' },
    { id: 'logout', en: 'Sign out', ar: 'تسجيل الخروج', glyph: 'logout' },
  ], [can]);
  // virtual mode: the platform's pages first (grouped like the sidebar), then the system apps under their own heading
  const startApps = useMemo(() => (virtual
    ? [...VM_APPS.filter((a) => !a.perm || can(a.perm)).map((a) => ({ id: a.id, en: a.en, ar: a.ar, glyph: a.id, group: a.group })), ...sysApps.map((a) => ({ ...a, group: { en: 'My PC & tools', ar: 'جهازي والأدوات' } }))]
    : sysApps), [virtual, sysApps, can]);

  const navApps = useMemo(() => startApps.filter((a) => !['run', 'lock', 'logout', 'portal'].includes(a.id)), [startApps]);
  const navWins = useMemo(() => wm.list.filter((w) => (w.d || 0) === (wm.desk || 0)).map((w) => ({ id: w.id, app: w.app, label: winTitle(w, APPS, ar), active: wm.active === w.id && !w.min, min: !!w.min })), [wm.list, wm.desk, wm.active, ar]);
  const navCollapsed = useMemo(() => (Array.isArray(prefs.navCollapsed) ? prefs.navCollapsed : []), [prefs.navCollapsed]);
  const toggleNavGroup = useCallback((k) => setPrefs({ navCollapsed: navCollapsed.includes(k) ? navCollapsed.filter((x) => x !== k) : [...navCollapsed, k] }), [navCollapsed, setPrefs]);

  const wp = prefs.wallpaper === 'custom' ? { dark: true } : wallpaperById(prefs.wallpaper);
  // A window body is rebuilt only when ITS inputs change. Without this every desktop re-render (toast, icon selection, a focus change, the battery…)
  // re-rendered every open window — the viewer, the code editor, Settings — which is what made the desktop feel heavy.
  const wmRef = useRef(wm); wmRef.current = wm;
  const liveWin = (id) => wmRef.current.list.find((x) => x.id === id);
  const bodyCache = useRef(new Map());
  const cached = (w, deps, make) => {
    const c = bodyCache.current.get(w.id);
    if (c && c.deps.length === deps.length && c.deps.every((d, i) => Object.is(d, deps[i]))) return c.el;
    const el = make();
    bodyCache.current.set(w.id, { deps, el });
    return el;
  };
  useEffect(() => { const live = new Set(wm.list.map((w) => w.id)); bodyCache.current.forEach((_, id) => { if (!live.has(id)) bodyCache.current.delete(id); }); }, [wm.list]);
  const bodyOf = (w) => {
    switch (w.app) {
      case 'explorer': return <ExplorerApp onOpenWindow={openFileWin} />;
      case 'viewer': return cached(w, [w.props, locale, openFileWin], () => <Suspense fallback={WinFallback}><ViewerWindow files={w.props.files} startId={w.props.startId} locale={locale} registerGuard={guardFor(w.id)} onClose={() => dispatch({ type: 'close', id: w.id, force: true })}
        onEditText={(f) => openFileWin({ kind: 'editor', editor: { kind: 'text', node: { id: f.driveId ?? f.id, name: f.original_name } } })} /></Suspense>);
      case 'editor': return cached(w, [w.props, locale], () => <Suspense fallback={WinFallback}><EditorWindow editor={w.props.editor} locale={locale} registerGuard={guardFor(w.id)} /></Suspense>);
      case 'settings': return <SettingsApp tab={w.props.tab} prefs={prefs} setPrefs={setPrefs} ar={ar} tt={tt} theme={theme} toggleTheme={toggleTheme} toggleLocale={toggleLocale} usage={desk.usage} user={user} lockEnabled={lockEnabled} onLockChanged={setLockEnabled}
        sec={sec} onSec={applySec} onLockNow={() => runCommand('lock')} onSleepNow={() => runCommand('sleep')} onSelfLogout={logout} />;
      case 'taskmgr': return <TaskManagerApp list={wm.list} ar={ar} tt={tt} usage={desk.usage} onEnd={(id) => dispatch({ type: 'close', id })} onFocus={(id) => dispatch({ type: 'focus', id })} />;
      case 'shortcuts': return <ShortcutsApp ar={ar} tt={tt} />;
      case 'notes': return <NotesApp uid={user?.id} tt={tt} ar={ar} />;
      case 'calendar': return <CalendarApp uid={user?.id} role={user?.role} tt={tt} ar={ar} onGo={(p) => { if (!(virtual && openVirtualPath(p))) navigate(p); }} />;
      case 'calculator': return <SciCalc tt={tt} />;
      case 'terminal': return <Suspense fallback={WinFallback}><TerminalApp tt={tt} /></Suspense>;
      case 'vscode': return <Suspense fallback={WinFallback}><VsCodeApp tt={tt} ar={ar} req={w.props.req} registerGuard={guardFor(w.id)} /></Suspense>;
      case 'browser': return <Suspense fallback={WinFallback}><BrowserApp tt={tt} ar={ar} req={w.props.req} /></Suspense>;
      default:
        if (isVmApp(w.app)) {
          // a platform page with its own private router (see ../virtual/VirtualApp). Rebuilt only when it is asked to show another page.
          return cached(w, [w.props.go, w.props.nonce, ar], () => (
            <Suspense fallback={WinFallback}>
              <VirtualApp
                appId={w.app} start={w.props.go} nonce={w.props.nonce} cur={w.props.cur} ar={ar}
                onLocation={(p) => { if (p !== liveWin(w.id)?.props?.cur) rawDispatch({ type: 'patch', id: w.id, patch: { props: { ...liveWin(w.id)?.props, cur: p } } }); }}
                onOpenPath={(p) => openVirtualPathRef.current(p)}
                onLeave={(p) => navigate(p)}
                onTab={(p) => window.open(p, '_blank', 'noopener,noreferrer')}
              />
            </Suspense>
          ));
        }
        return null;
    }
  };

  const brightness = Math.min(100, Math.max(40, Number(prefs.brightness) || 100));
  const activeWin = wm.list.find((w) => w.id === wm.active && !w.min && (w.d || 0) === (wm.desk || 0)) || null;
  const appName = activeWin ? (ar ? APPS[activeWin.app].ar : APPS[activeWin.app].en) : tt('This PC', 'جهازي');
  // a menu-bar menu opened: Spotlight / Mission Control / Start / flyouts and any right-click menu close, so only one thing is ever open
  const closeFloating = useCallback(() => { setOverlay(null); setMenu(null); }, []);
  const menus = [
    { id: 'sys', logo: true, items: [
      { label: tt('About UIPE Desktop', 'عن سطح مكتب UIPE'), onClick: () => runCommand('settings') },
      'sep',
      { label: tt('System Settings…', 'إعدادات النظام…'), onClick: () => runCommand('settings') },
      { label: tt('Personalize…', 'التخصيص…'), onClick: () => runCommand('personalize') },
      { label: tt('Task Manager', 'مدير المهام'), onClick: () => runCommand('taskmgr') },
      'sep',
      { label: tt('Lock Screen', 'قفل الشاشة'), hint: 'Alt+L', onClick: () => runCommand('lock') },
      { label: tt('Sleep', 'وضع السكون'), hint: 'Alt+Shift+S', onClick: () => runCommand('sleep') },
      { label: tt('Security & devices…', 'الأمان والأجهزة…'), onClick: () => runCommand('security') },
      { label: tt('Back to the portal…', 'الرجوع للبوابة…'), onClick: () => runCommand('portal') },
      { label: tt('Sign out…', 'تسجيل الخروج…'), onClick: () => runCommand('logout') },
    ] },
    { id: 'app', bold: true, label: appName, items: [
      { label: tt('Settings…', 'الإعدادات…'), onClick: () => runCommand('settings') },
      'sep',
      { label: tt('Minimize', 'تصغير'), disabled: !activeWin, onClick: () => activeWin && dispatch({ type: 'minimize', id: activeWin.id }) },
      { label: tt('Close window', 'إغلاق النافذة'), hint: 'Alt+W', disabled: !activeWin, onClick: () => activeWin && dispatch({ type: 'close', id: activeWin.id }) },
    ] },
    { id: 'file', label: tt('File', 'ملف'), hideSmall: true, items: [
      { label: tt('New Window', 'نافذة جديدة'), onClick: () => runCommand('explorer') },
      { label: tt('Recycle Bin', 'سلة المحذوفات'), onClick: () => runCommand('bin') },
      'sep',
      { label: tt('Close window', 'إغلاق النافذة'), hint: 'Alt+W', disabled: !activeWin, onClick: () => activeWin && dispatch({ type: 'close', id: activeWin.id }) },
    ] },
    { id: 'view', label: tt('View', 'عرض'), hideSmall: true, items: [
      { label: fs ? tt('Exit Full Screen', 'إنهاء ملء الشاشة') : tt('Enter Full Screen', 'ملء الشاشة'), onClick: fullscreen },
      { label: tt('Mission Control', 'عرض المهام'), hint: 'Alt+V', onClick: () => setOverlay('taskview') },
      { label: tt('Show Desktop', 'إظهار سطح المكتب'), hint: 'Alt+D', onClick: () => dispatch({ type: 'showDesktop' }) },
      'sep',
      { label: tt('Dark appearance', 'المظهر الداكن'), check: theme === 'dark', onClick: toggleTheme },
    ] },
    { id: 'window', label: tt('Window', 'نافذة'), hideSmall: true, items: [
      { label: tt('Zoom', 'تكبير'), disabled: !activeWin, onClick: () => activeWin && dispatch({ type: 'toggleMax', id: activeWin.id }) },
      { label: tt('Tile Left', 'تثبيت لليسار'), hint: 'Alt+←', disabled: !activeWin, onClick: () => activeWin && dispatch({ type: 'snap', id: activeWin.id, side: 'left' }) },
      { label: tt('Tile Right', 'تثبيت لليمين'), hint: 'Alt+→', disabled: !activeWin, onClick: () => activeWin && dispatch({ type: 'snap', id: activeWin.id, side: 'right' }) },
      'sep',
      { label: tt('Bring All to Front', 'إظهار الكل'), onClick: () => dispatch({ type: 'restoreAll' }) },
      'sep',
      { label: tt('New desktop', 'مساحة عمل جديدة'), hint: 'Ctrl+Alt+N', disabled: (wm.desks || 1) >= MAX_DESKS, onClick: () => dispatch({ type: 'deskAdd' }) },
      { label: tt('Next desktop', 'المساحة التالية'), hint: 'Ctrl+Alt+→', disabled: (wm.desks || 1) < 2, onClick: () => dispatch({ type: 'deskStep', dir: 1 }) },
      { label: tt('Previous desktop', 'المساحة السابقة'), hint: 'Ctrl+Alt+←', disabled: (wm.desks || 1) < 2, onClick: () => dispatch({ type: 'deskStep', dir: -1 }) },
      { label: tt('Move to next desktop', 'نقل للمساحة التالية'), hint: 'Ctrl+Alt+Shift+]', disabled: !activeWin, onClick: () => { if (!activeWin) return; const n = ((wm.desk || 0) + 1) % Math.max(1, wm.desks || 1); const to = n === 0 && (wm.desks || 1) < MAX_DESKS ? (wm.desks || 1) : n; dispatch({ type: 'moveToDesk', id: activeWin.id, n: to }); dispatch({ type: 'deskGo', n: to }); } },
      'sep',
      ...wm.list.map((w) => ({ label: `${(wm.desks || 1) > 1 ? `${(w.d || 0) + 1} · ` : ''}${winTitle(w, APPS, ar)}`, check: w.id === wm.active, onClick: () => dispatch({ type: 'focus', id: w.id }) })),
    ] },
    { id: 'help', label: tt('Help', 'مساعدة'), hideSmall: true, items: [
      { label: tt('Keyboard shortcuts', 'اختصارات الكيبورد'), onClick: () => runCommand('shortcuts') },
      { label: tt('Spotlight…', 'بحث سريع…'), hint: 'Alt+R', onClick: () => setOverlay('run') },
    ] },
  ];
  const tray = (
    <div className="os-tray">
      <button type="button" className="os-tray__lang" title={tt('Language', 'اللغة')} onClick={toggleLocale}><b>{ar ? 'ع' : 'EN'}</b></button>
      <button type="button" className={`os-tray__sys${overlay === 'qs' ? ' is-on' : ''}`} title={tt('Control Center', 'مركز التحكم')} aria-haspopup="dialog" aria-expanded={overlay === 'qs'} onClick={() => setOverlay((o) => (o === 'qs' ? null : 'qs'))}>
        <WifiGlyph on={online} size={18} />
        {battery && <BatteryGlyph level={battery.level} charging={battery.charging} size={23} />}
      </button>
      <NotifTray tt={tt} unread={nc.unread} on={overlay === 'notif'} onClick={() => setOverlay((o) => (o === 'notif' ? null : 'notif'))} />
      <CloudTray tt={tt} onOpen={() => openApp('settings', { tab: 'cloud' })} />
      <button type="button" className="os-tray__srch" title={tt('Spotlight (Alt+R)', 'بحث سريع (Alt+R)')} onClick={() => setOverlay((o) => (o === 'run' ? null : 'run'))}><Icon name="search" size={17} /></button>
      <button type="button" className={`os-tray__clock${overlay === 'cal' ? ' is-on' : ''}`} title={tt('Calendar', 'التقويم')} aria-haspopup="dialog" aria-expanded={overlay === 'cal'} onClick={() => setOverlay((o) => (o === 'cal' ? null : 'cal'))}><Clock ar={ar} bar /></button>
    </div>
  );
  // Dock = pinned apps + every other open window (one icon per opened file), then the Recycle Bin
  const dockItems = taskItems.map((it, i) => {
    const w = winOf(it);
    const label = w ? winTitle(w, APPS, ar) : (ar ? APPS[it.app].ar : APPS[it.app].en);
    return {
      key: it.key, app: it.app, label, running: !!w, active: !!w && wm.active === w.id && !w.min, onClick: () => taskClick(it),
      onMiddle: () => w && dispatch({ type: 'close', id: w.id }),
      onContext: (e) => {
        e.preventDefault(); e.stopPropagation();
        setMenu({ x: e.clientX, y: e.clientY - 110, items: [{ label, icon: 'eye', onClick: () => taskClick(it) }, ...(w ? [{ label: tt('Close window', 'إغلاق النافذة'), icon: 'x', hint: 'Alt+W', onClick: () => dispatch({ type: 'close', id: w.id }) }] : []), ...(pinned.includes(it.app) && it.key === it.app ? ['sep', { label: tt('Remove from Dock', 'إزالة من الـ Dock'), icon: 'trash', danger: true, onClick: () => hideDockIcon(it.app, !!w) }] : [])] });
      },
      i,
    };
  });

  const hotT = useRef(0);
  const wmax = wm.list.some((w) => w.id === wm.active && w.max && !w.min && (w.d || 0) === (wm.desk || 0));
  useEffect(() => {
    if (!wmax || !dockPeek) return undefined;
    const h = (e) => { if (e.clientY < window.innerHeight - 120) setDockPeek(false); };
    window.addEventListener('pointermove', h);
    return () => window.removeEventListener('pointermove', h);
  }, [wmax, dockPeek]);
  useEffect(() => { if (!wmax) setDockPeek(false); }, [wmax]);
  // The desktop owns the whole screen: hide the portal layout (sidebar / topbar / bottom bar) underneath so nothing of it shows below or around the PC.
  useEffect(() => {
    document.body.classList.add('os-active');
    return () => document.body.classList.remove('os-active');
  }, []);

  return createPortal(
    <div
      className={`os os--${theme === 'dark' ? 'dark' : 'light'}${wp.dark === false ? ' os--lightwp' : ''}${mobile ? ' os--mobile' : ''}${navOpen && navPinned ? ' os--nav' : ''}${wmax ? ' os--wmax' : ''}${prefs.fontScale === 'l' ? ' os--fs-l' : prefs.fontScale === 'xl' ? ' os--fs-xl' : ''}${prefs.reduceMotion ? ' os--rm' : ''}${prefs.highContrast ? ' os--hc' : ''}${wmax && dockPeek ? ' os--dockpeek' : ''}`} dir={dir}
      style={{ '--os-accent': prefs.accent, '--cell-w': `${cell.w}px`, '--cell-h': `${cell.h}px`, '--glyph': `${cell.g}px` }}
      onPointerDownCapture={(e) => {
        if (!e.target.closest('.os-ctx')) setMenu(null);
        if (overlay === 'start' && !e.target.closest('.os-start, .os-startbtn')) setOverlay(null);
        if (overlay === 'qs' && !e.target.closest('.os-fly, .os-tray__sys')) setOverlay(null);
        if (overlay === 'cal' && !e.target.closest('.os-fly, .os-tray__clock')) setOverlay(null);
        if (overlay === 'notif' && !e.target.closest('.os-fly, .os-tray__notif')) setOverlay(null);
      }}
    >
      {can('ai.assistant_use') && <AiAssistantWidget role={user?.role} user={user} />}
      {mobile ? (
        <Suspense fallback={null}>
        <MobileShell
          ar={ar} tt={tt} user={user} desk={desk} deskItems={deskItems} wm={wm} dispatch={dispatch} bodyOf={bodyOf}
          openNode={openNode} openExplorer={openExplorer} runCommand={runCommand} flash={flash} reloadDesk={reloadDesk} hideLocal={hideLocal} refreshAll={refreshAll}
          clip={clip} copyNodes={copyNodes} pasteInto={pasteInto} trashNodes={trashNodes} renameNode={renameNode} newFolder={newFolder} newFile={newFile} newDoc={newDoc}
          battery={battery} online={online} theme={theme} toggleTheme={toggleTheme} toggleLocale={toggleLocale}
          brightness={brightness} setBrightness={(v) => setPrefs({ brightness: v })} fullscreen={fullscreen} fs={fs}
          wallpaper={wallpaperCss(prefs)} lightWp={wp.dark === false}
          aiEnabled={can('ai.assistant_use')} nc={nc} onOpenNotif={openNotif} onAllNotif={notifAll} prefs={prefs} setPrefs={setPrefs}
          vmApps={virtual ? startApps.filter((x) => isVmApp(x.id)) : []}
          shortcuts={lnkIcons.map((i) => i.lnk)} onShortcutOpen={openShortcut} onShortcutRemove={(n) => removeShortcuts([n.id])}
          widgets={widgets.items} newWidgetId={newWidgetId} onWidgetChange={(id, patch) => widgets.update(id, patch)} onWidgetRemove={removeWidget}
          onWidgetAdd={(type) => { const id = widgets.add(type, { x: 20, y: 20 }); setNewWidgetId(type === 'note' ? id : null); }}
        />
        </Suspense>
      ) : (
      <>
      <div className="os-wall" style={{ background: wallpaperCss(prefs) }} />
      <div
        ref={deskRef} className={`os-desk${dropping ? ' is-drop' : ''}`} tabIndex={0} onKeyDown={onDeskKey}
        onPointerDown={onDeskPointerDown} onContextMenu={deskMenu}
        onDragOver={onDragOverDesk} onDragLeave={() => { setDropping(false); setExtOver(null); }} onDrop={onDrop}
      >
        {icons.map((ic) => {
          const p = layout[ic.key];
          const moving = drag?.keys.includes(ic.key);
          const cutting = clip?.mode === 'cut' && ic.node && clip.ids.includes(ic.node.id);
          return (
            <button
              key={ic.key} type="button" data-ikey={ic.key} ref={(el) => { if (el) iconEls.current[ic.key] = el; else delete iconEls.current[ic.key]; }}
              className={`os-icon${sel.has(ic.key) ? ' is-sel' : ''}${moving ? ' is-dragging' : ''}${drag?.over === ic.key || extOver === ic.key ? ' is-over' : ''}${cutting ? ' is-cut' : ''}`} title={ic.lnk ? `${ic.label} — ${tt('Shortcut', 'اختصار')}${ic.lnk.path ? ` (${ic.lnk.path})` : ''}` : ic.label}
              style={{ ...cellStyle(p, cell), ...(moving ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : null) }}
              onPointerDown={(e) => onIconPointerDown(e, ic)}
              onClick={(e) => clickIcon(e, ic)} onDoubleClick={(e) => { e.stopPropagation(); ic.run(); }} onContextMenu={(e) => iconMenu(e, ic)}
            >
              <span className="os-icon__g">
                {ic.node ? <NodeGlyph node={ic.node} size={cell.g} /> : ic.lnk ? <><NodeGlyph node={ic.lnk} size={cell.g} /><i className="os-icon__lnk" aria-hidden="true"><Icon name="external-link" size={Math.max(10, Math.round(cell.g / 4))} /></i></> : ic.glyph === 'explorer' ? <PcGlyph size={cell.g} /> : ic.glyph === 'bin' ? <BinGlyph size={cell.g} full={desk.binFull} /> : isVmApp(ic.glyph) ? <AppGlyph app={ic.glyph} size={cell.g} /> : <Tile kind={ic.glyph} size={cell.g} />}
              </span>
              <span className="os-icon__l" dir="auto">{ic.label}</span>
            </button>
          );
        })}
        {box && <div className="os-marquee" style={box} />}
      </div>
      <WidgetLayer
        items={widgets.items} ar={ar} focusId={newWidgetId} bounds={deskSize}
        onChange={(id, patch) => widgets.update(id, patch)} onRemove={removeWidget} onFront={widgets.front}
      />
      {desk.error && <button type="button" className="os-warn" onClick={reloadDesk}>{tt('Could not load the desktop folder — tap to retry.', 'مقدرتش أحمّل مجلد سطح المكتب — اضغط للمحاولة.')} <small dir="auto">{desk.error}</small></button>}

      <div className="os-wins">
        {wm.list.map((w) => (
          <WindowFrame key={w.id} off={(w.d || 0) !== (wm.desk || 0)} win={w} title={winTitle(w, APPS, ar)} active={wm.active === w.id} dir={dir} tt={tt} dispatch={dispatch} unified={w.app === 'explorer'} onAssist={setAssist} icon={<AppGlyph app={w.app} size={16} />}>
            {bodyOf(w)}
          </WindowFrame>
        ))}
        <SnapAssist assist={assist} list={wm.list.filter((w) => (w.d || 0) === (wm.desk || 0))} titleOf={(w) => winTitle(w, APPS, ar)} iconOf={(w) => <AppGlyph app={w.app} size={20} />} tt={tt} dispatch={dispatch} setAssist={setAssist} />
      </div>

      {overlay === 'taskview' && <TaskView list={wm.list} desk={wm.desk || 0} desks={wm.desks || 1} maxDesks={MAX_DESKS} onDesk={(n) => dispatch({ type: 'deskGo', n })} onAddDesk={() => dispatch({ type: 'deskAdd' })} onRemoveDesk={(n) => dispatch({ type: 'deskRemove', n })} onMove={(id, n) => dispatch({ type: 'moveToDesk', id, n })} ar={ar} tt={tt} onClose={() => setOverlay(null)} onPick={(id) => { dispatch({ type: 'focus', id }); setOverlay(null); }} onCloseWin={(id) => dispatch({ type: 'close', id })} />}
      {overlay === 'start' && (
        <StartMenu
          ar={ar} tt={tt} user={user} apps={startApps} desktopItems={deskItems} onClose={() => setOverlay(null)}
          onOpenApp={(a) => { setOverlay(null); runCommand(a.id); }} onOpenNode={(n) => { setOverlay(null); openNode(n); }}
          onFound={(n) => { setOverlay(null); if (n.type === 'folder') openExplorer({ folder: String(n.id) }); else openNode(n); }}
          onLock={() => runCommand('lock')} onPortal={() => runCommand('portal')} onLogout={() => runCommand('logout')}
        />
      )}
      {overlay === 'run' && <RunDialog ar={ar} tt={tt} onRun={runText} onClose={() => setOverlay(null)} recents={recents} onOpenRecent={openRecent} onRemoveRecent={(id) => removeRecent(uidRef.current, id)} onClearRecents={() => clearRecents(uidRef.current)} />}

      {overlay === 'qs' && (
        <QuickSettings
          tt={tt} ar={ar} theme={theme} online={online} battery={battery} brightness={brightness} setBrightness={(v) => setPrefs({ brightness: v })} fullscreen={fs} user={user}
          onTheme={toggleTheme} onLocale={toggleLocale} onFullscreen={fullscreen} onLock={() => runCommand('lock')} onSettings={() => runCommand('settings')}
        />
      )}
      {overlay === 'cal' && <CalendarFlyout tt={tt} ar={ar} />}
      {overlay === 'notif' && !mobile && <NotifFlyout tt={tt} ar={ar} nc={nc} onOpen={openNotif} onAll={notifAll} />}
      {!mobile && <NotifToasts toasts={nc.toasts} onOpen={openNotif} onClose={nc.dismissToast} tt={tt} />}

      {navOpen && !locked && !asleep && (
        <NavSidebar
          ar={ar} tt={tt} apps={navApps} wins={navWins} pinned={navPinned} collapsed={navCollapsed} onToggleGroup={toggleNavGroup}
          onOpenApp={(a) => runCommand(a.id)} onFocusWin={(id) => dispatch({ type: 'focus', id })} onCloseWin={(id) => dispatch({ type: 'close', id })}
          onTogglePin={() => setPrefs({ navPin: !navPinned })} onClose={closeNav}
          onDesktop={() => dispatch({ type: 'showDesktop' })} onSpotlight={() => setOverlay('run')}
        />
      )}
      <MenuBar ar={ar} tt={tt} menus={menus} tray={tray} onOpen={closeFloating}
        lead={mobile ? null : <button type="button" className="os-mb-nav" aria-pressed={navOpen} onClick={toggleNav} title={`${tt('Navigation sidebar', 'الشريط الجانبي للتنقل')} · Alt+A`} aria-label={tt('Navigation sidebar', 'الشريط الجانبي للتنقل')}><Icon name="panel-left" size={16} /></button>} closeKey={`${overlay || ''}${menu ? 'm' : ''}${dlg ? 'd' : ''}${locked || asleep ? 'l' : ''}`} />
      {wmax && !dockPeek && <div className="os-dockhot" onPointerEnter={() => { clearTimeout(hotT.current); hotT.current = setTimeout(() => setDockPeek(true), 280); }} onPointerLeave={() => clearTimeout(hotT.current)} aria-hidden="true" />}
      <Dock
        items={dockItems} tt={tt} mag={prefs.dockMag !== false && !prefs.reduceMotion} launchOn={overlay === 'start'} onLaunch={() => setOverlay((o) => (o === 'start' ? null : 'start'))}
        onBin={() => runCommand('bin')} binFull={desk.binFull} binLabel={tt('Recycle Bin', 'سلة المحذوفات')}
        onPortal={() => runCommand('portal')} portalLabel={tt('UIPE Portal', 'بوابة UIPE')}
        onLogout={() => runCommand('logout')} logoutLabel={tt('Sign out', 'تسجيل الخروج')}
        onLock={confirmLock} lockLabel={tt('Lock screen', 'قفل الشاشة')}
        hidden={hiddenDock} onSpecialMenu={dockSpecialMenu}
      />

      </>
      )}

      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {dlg && dlg.kind !== 'newfile' && <OsDialog key={dlg.title} dlg={dlg} tt={tt} onDone={finishDlg} />}
      {dlg?.kind === 'newfile' && desk.id && (
        <Suspense fallback={null}><NewFileDialog
          locale={locale} parentId={desk.id} initialType={dlg.type} onClose={() => setDlg(null)}
          onCreated={(node) => { pendingOpen.current = node.id; flash(tt('File created on the desktop.', 'تم إنشاء الملف على سطح المكتب.')); reloadDesk(); }}
        /></Suspense>
      )}
      <DeleteProgressHost />
      {toast && <div className={`os-toast${toast.tone === 'error' ? ' is-error' : ''}`} role="status">{toast.msg}</div>}
      {locked && <LockScreen ar={ar} tt={tt} user={user} lockEnabled={lockEnabled} hideDetails={sec.hideLockDetails} onUnlock={() => setLocked(false)} onLockEnabled={setLockEnabled} onPortal={() => navigate(roleHome(user?.role))} />}
      {!locked && !asleep && <ResetUndoBar tt={tt} uid={user?.id} />}
      {idleLeft !== null && !asleep && <IdleWarning tt={tt} left={idleLeft} onStay={stay} onSignOut={logout} />}
      {asleep && <SleepScreen ar={ar} tt={tt} dim={sec.sleepDimOnly} onWake={onWake} />}
      {brightness < 100 && <div className="os-dim" style={{ opacity: ((100 - brightness) / 100) * 0.7 }} aria-hidden="true" />}
      <div className={`os-boot${booting ? '' : ' is-done'}`} aria-hidden="true">
        <span className="os-boot__logo"><UipMark size={64} /></span>
        <span className="os-boot__name"><b>UIPE</b><em>NUB</em></span>
        <span className="os-boot__tag">{tt('Your workspace is getting ready', 'مساحة عملك بتتجهّز')}</span>
        <span className="os-boot__bar"><i /></span>
      </div>
    </div>,
    document.body,
  );
}
