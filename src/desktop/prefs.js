import { VM_DESK_ICONS, VM_DOCK_ICONS } from '../virtual/catalog';
const prefsKey = (uid) => `uip_desktop_prefs_v1_${uid ?? 'anon'}`; // per account: another student on the same browser never inherits it
export const DEFAULT_PREFS = { wallpaper: 'sequoia', customWallpaper: null, accent: '#0a84ff', iconSize: 'm', dockMag: true, openMax: true, brightness: 100, hiddenIcons: [], hiddenDock: [], shortcuts: [], fontScale: 'm', reduceMotion: false, highContrast: false, mHome: 'pages', mClock: 'ios', mIcon: 'm', mLabels: true, mIsland: true, mLibrary: true, mStorage: true, mDock: 'glass', mHaptics: true };
/** macOS accent palette (blue, purple, pink, red, orange, yellow, green, graphite) + the old UIPE indigo. */
export const ACCENTS = ['#0a84ff', '#bf5af2', '#ff375f', '#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#8e8e93', '#6366f1'];

/** Someone who never changed the old defaults (Aurora + indigo) gets the new macOS look; any real choice is kept. */
export function migratePrefs(p) {
  if (p && p.wallpaper === 'aurora' && (!p.accent || p.accent === '#6366f1') && !p.customWallpaper) return { ...p, wallpaper: DEFAULT_PREFS.wallpaper, accent: DEFAULT_PREFS.accent };
  return p;
}
/** Icons the person can remove from the desktop / the Dock and bring back from Settings ▸ Personalization ▸ Icons. */
export const DESK_ICONS = [
  ['sys:explorer', 'This PC', 'جهازي', 'explorer'], ['sys:bin', 'Recycle Bin', 'سلة المحذوفات', 'bin'], ['sys:portal', 'UIPE Portal', 'بوابة UIPE', 'portal'],
  ['sys:logout', 'Sign out', 'تسجيل الخروج', 'logout'],
  ['sys:settings', 'Settings', 'الإعدادات', 'settings'], ['sys:shortcuts', 'Shortcuts', 'الاختصارات', 'shortcuts'],
  ...VM_DESK_ICONS, // the platform's pages (only listed in Settings while the virtual mode is on)
];
export const DOCK_ICONS = [
  ['launchpad', 'Launchpad', 'لوحة التطبيقات', 'launchpad'], ['explorer', 'This PC', 'جهازي', 'explorer'], ['settings', 'Settings', 'الإعدادات', 'settings'],
  ['shortcuts', 'Keyboard shortcuts', 'اختصارات الكيبورد', 'shortcuts'], ['notes', 'Notes', 'الملاحظات', 'notes'], ['calendar', 'Calendar', 'التقويم', 'calendar'], ['calculator', 'Calculator', 'الآلة الحاسبة', 'calculator'], ['terminal', 'UIPE Terminal', 'ترمينال UIPE', 'terminal'], ['vscode', 'VS Code', 'VS Code', 'vscode'], ['browser', 'Browser', 'المتصفح', 'browser'], ['lock', 'Lock screen', 'قفل الشاشة', 'lock'], ['portal', 'UIPE Portal', 'بوابة UIPE', 'portal'], ['logout', 'Sign out', 'تسجيل الخروج', 'logout'], ['bin', 'Recycle Bin', 'سلة المحذوفات', 'bin'],
  ...VM_DOCK_ICONS,
];
export const NO_ICONS = []; // one shared empty list, so memo dependencies do not change on every render
/** ids of My PC items the person put on the desktop as shortcuts (the items themselves stay where they are). */
export const idList = (v) => (Array.isArray(v) && v.every((x) => Number.isInteger(x)) ? v : NO_ICONS);
export const hiddenList = (v) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : NO_ICONS); // same array back (stable identity for useMemo)

export function loadPrefs(uid) {
  try { return migratePrefs({ ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(prefsKey(uid)) || '{}') || {}) }); } catch { return { ...DEFAULT_PREFS }; }
}
export function savePrefs(p, uid) {
  try { localStorage.setItem(prefsKey(uid), JSON.stringify(p)); return true; } catch { return false; }
}

/** Where each desktop icon sits: { [iconKey]: { x, y } } in pixels from the inline-end edge / the top — per user. (Older versions stored grid cells { c, r }.) */
export const iconPosKey = (uid) => `uip_desktop_icons_v1_${uid ?? 'anon'}`;
export function loadIconPos(key) {
  try {
    const o = JSON.parse(localStorage.getItem(key) || '{}') || {};
    const out = {};
    Object.keys(o).forEach((k) => {
      const p = o[k];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0) out[k] = { x: Math.round(p.x), y: Math.round(p.y) }; // free pixel position
      else if (p && Number.isInteger(p.c) && Number.isInteger(p.r) && p.c >= 0 && p.r >= 0) out[k] = { c: p.c, r: p.r }; // old grid cell (converted by DesktopOS)
    });
    return out;
  } catch { return {}; }
}
export function saveIconPos(key, map) {
  try { localStorage.setItem(key, JSON.stringify(map)); return true; } catch { return false; }
}
