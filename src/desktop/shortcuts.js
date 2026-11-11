/**
 * Keyboard shortcuts of the UIPE desktop.
 *
 * Browsers own a few combos (Win+key, Alt+Tab, Alt+F4, Ctrl+W/T/N…) and never hand them to a page, so every
 * "Windows" shortcut has a browser-safe twin on Alt. Keys are matched by `event.code` (physical key), so they
 * keep working on the Arabic keyboard layout.
 */
const CODE_MAP = {
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Slash: '/', Period: '.', Comma: ',',
  Space: 'Space', Escape: 'Esc', Minus: '-', Equal: '=',
};

export function keyOf(e) {
  const c = e.code || '';
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^Numpad\d$/.test(c)) return c.slice(6);
  if (CODE_MAP[c]) return CODE_MAP[c];
  if (c) return c;
  return String(e.key || '');
}

export function comboOf(e) {
  const k = keyOf(e);
  if (['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'].includes(k)) return '';
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta', k].filter(Boolean).join('+');
}

const pin = (n) => ({ id: `pin${n}`, keys: [`Alt+${n}`], group: 'taskbar', en: `Open / switch to Dock app ${n}`, ar: `فتح / تبديل لتطبيق رقم ${n} في الـ Dock` });

export const GROUPS = [
  { id: 'system', en: 'System', ar: 'النظام' },
  { id: 'windows', en: 'Windows', ar: 'النوافذ' },
  { id: 'apps', en: 'Apps', ar: 'التطبيقات' },
  { id: 'taskbar', en: 'Dock', ar: 'الـ Dock' },
  { id: 'desktop', en: 'Desktop icons', ar: 'أيقونات سطح المكتب' },
  { id: 'explorer', en: 'File explorer (inside the window)', ar: 'مستكشف الملفات (داخل النافذة)' },
];

/** Global shortcuts — the ones DesktopOS actually listens to. `win` = the native macOS combo it stands in for. */
export const SHORTCUTS = [
  { id: 'start', keys: ['Alt+S'], win: '⌘Space', group: 'system', en: 'Launchpad & search', ar: 'لوحة التطبيقات والبحث' },
  { id: 'nav', keys: ['Alt+A'], win: '', group: 'system', en: 'Open / close the navigation sidebar', ar: 'فتح / غلق الشريط الجانبي للتنقل' },
  { id: 'run', keys: ['Alt+R'], win: '⌘Space', group: 'system', en: 'Spotlight…', ar: 'بحث سريع…' },
  { id: 'lock', keys: ['Alt+L'], win: '⌃⌘Q', group: 'system', en: 'Lock screen', ar: 'قفل الشاشة' },
  { id: 'sleep', keys: ['Alt+Shift+S'], win: '⌥⌘⏏', group: 'system', en: 'Sleep (dark screen)', ar: 'وضع السكون (شاشة سودا)' },
  { id: 'settings', keys: ['Alt+I'], win: '⌘,', group: 'apps', en: 'Settings', ar: 'الإعدادات' },
  { id: 'personalize', keys: ['Alt+P'], win: '', group: 'apps', en: 'Personalization (wallpaper & colors)', ar: 'التخصيص (الخلفية والألوان)' },
  { id: 'explorer', keys: ['Alt+E'], win: '⌘N', group: 'apps', en: 'Open This PC (file explorer)', ar: 'فتح جهازي (مستكشف الملفات)' },
  { id: 'bin', keys: ['Alt+B'], win: '', group: 'apps', en: 'Open Recycle Bin', ar: 'فتح سلة المحذوفات' },
  { id: 'taskmgr', keys: ['Ctrl+Shift+Esc', 'Alt+M'], win: '⌥⌘Esc', group: 'apps', en: 'Task Manager', ar: 'مدير المهام' },
  { id: 'notes', keys: ['Alt+N'], win: '', group: 'apps', en: 'Notes', ar: 'الملاحظات' },
  { id: 'calendar', keys: ['Alt+C'], win: '', group: 'apps', en: 'Calendar', ar: 'التقويم' },
  { id: 'calculator', keys: ['Alt+Q'], win: '', group: 'apps', en: 'Calculator', ar: 'الآلة الحاسبة' },
  { id: 'terminal', keys: ['Alt+T'], win: '⌃⌥T', group: 'apps', en: 'UIPE Terminal', ar: 'ترمينال UIPE' },
  { id: 'help', keys: ['F1', 'Alt+K'], win: 'F1', group: 'apps', en: 'Keyboard shortcuts cheat-sheet', ar: 'قائمة اختصارات الكيبورد' },
  { id: 'taskview', keys: ['Alt+V'], win: '⌃↑', group: 'windows', en: 'Mission Control (all windows)', ar: 'عرض المهام (كل النوافذ)' },
  { id: 'deskNext', keys: ['Ctrl+Alt+ArrowRight'], win: '⌃→', group: 'windows', en: 'Next desktop (Space)', ar: 'المساحة التالية' },
  { id: 'deskPrev', keys: ['Ctrl+Alt+ArrowLeft'], win: '⌃←', group: 'windows', en: 'Previous desktop (Space)', ar: 'المساحة السابقة' },
  { id: 'deskNew', keys: ['Ctrl+Alt+N'], win: '', group: 'windows', en: 'New desktop (Space)', ar: 'مساحة عمل جديدة' },
  { id: 'deskSend', keys: ['Ctrl+Alt+Shift+]'], win: '', group: 'windows', en: 'Send window to the next desktop', ar: 'نقل النافذة للمساحة التالية' },
  { id: 'next', keys: ['Alt+]'], win: '⌘Tab', group: 'windows', en: 'Next window', ar: 'النافذة التالية' },
  { id: 'prev', keys: ['Alt+['], win: '⌘⇧Tab', group: 'windows', en: 'Previous window', ar: 'النافذة السابقة' },
  { id: 'close', keys: ['Alt+W'], win: '⌘W', group: 'windows', en: 'Close active window', ar: 'إغلاق النافذة الحالية' },
  { id: 'desktop', keys: ['Alt+D'], win: 'F11', group: 'windows', en: 'Show desktop / restore windows', ar: 'إظهار سطح المكتب / إرجاع النوافذ' },
  { id: 'restoreAll', keys: ['Alt+Shift+M'], win: '', group: 'windows', en: 'Restore minimized windows', ar: 'إرجاع النوافذ المصغّرة' },
  { id: 'snapL', keys: ['Alt+Shift+ArrowLeft'], win: '⌃⌥←', group: 'windows', en: 'Snap window to the left half', ar: 'تثبيت النافذة على النصف الأيسر' },
  { id: 'snapR', keys: ['Alt+Shift+ArrowRight'], win: '⌃⌥→', group: 'windows', en: 'Snap window to the right half', ar: 'تثبيت النافذة على النصف الأيمن' },
  { id: 'maximize', keys: ['Alt+Shift+ArrowUp'], win: '⌃⌥F', group: 'windows', en: 'Maximize window', ar: 'تكبير النافذة' },
  { id: 'down', keys: ['Alt+Shift+ArrowDown'], win: '⌘M', group: 'windows', en: 'Restore, then minimize', ar: 'استرجاع ثم تصغير' },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(pin),
  { id: 'dsel', keys: ['Ctrl+A'], group: 'desktop', en: 'Select all icons', ar: 'تحديد كل الأيقونات' },
  { id: 'dopen', keys: ['Enter'], group: 'desktop', en: 'Open selected icon', ar: 'فتح الأيقونة المحددة' },
  { id: 'dren', keys: ['F2'], group: 'desktop', en: 'Rename selected icon', ar: 'إعادة تسمية الأيقونة' },
  { id: 'ddel', keys: ['Delete'], group: 'desktop', en: 'Move selected icons to Recycle Bin', ar: 'نقل الأيقونات لسلة المحذوفات' },
  { id: 'dcopy', keys: ['Ctrl+C'], group: 'desktop', en: 'Copy selected icons', ar: 'نسخ الأيقونات المحددة' },
  { id: 'dcut', keys: ['Ctrl+X'], group: 'desktop', en: 'Cut selected icons', ar: 'قص الأيقونات المحددة' },
  { id: 'dpaste', keys: ['Ctrl+V'], group: 'desktop', en: 'Paste onto the desktop', ar: 'لصق على سطح المكتب' },
  { id: 'dnew', keys: ['Ctrl+Shift+N'], group: 'desktop', en: 'New folder on the desktop', ar: 'مجلد جديد على سطح المكتب' },
  { id: 'drefresh', keys: ['F5'], group: 'desktop', en: 'Refresh desktop', ar: 'تحديث سطح المكتب' },
  { id: 'darrows', keys: ['Arrows'], group: 'desktop', en: 'Move between icons', ar: 'التنقل بين الأيقونات' },
  { id: 'ddrag', keys: ['Drag'], group: 'desktop', en: 'Drag icons to place them · drag on empty space to select · drop on a folder / Recycle Bin', ar: 'اسحب الأيقونات لتغيير مكانها · اسحب على فراغ للتحديد · أفلت على مجلد أو السلة' },
];

/** Shown only in the cheat-sheet: handled inside the Explorer window itself. */
export const EXPLORER_SHORTCUTS = [
  { keys: ['Ctrl+C / Ctrl+X / Ctrl+V'], en: 'Copy / cut / paste', ar: 'نسخ / قص / لصق' },
  { keys: ['Ctrl+A'], en: 'Select all', ar: 'تحديد الكل' },
  { keys: ['Delete'], en: 'Move to Recycle Bin', ar: 'نقل لسلة المحذوفات' },
  { keys: ['F2'], en: 'Rename', ar: 'إعادة تسمية' },
  { keys: ['Enter'], en: 'Open', ar: 'فتح' },
  { keys: ['Backspace'], en: 'Up one folder', ar: 'مجلد أعلى' },
  { keys: ['Space'], en: 'Toggle selection of focused item', ar: 'تحديد/إلغاء تحديد العنصر' },
  { keys: ['Esc'], en: 'Clear selection', ar: 'إلغاء التحديد' },
];

const TABLE = new Map();
SHORTCUTS.forEach((s) => s.keys.forEach((k) => TABLE.set(k, s.id)));

/** Action id for a keyboard event, or null. Plain-key (desktop-icon) actions are excluded here. */
export function globalActionFor(e) {
  const c = comboOf(e);
  if (!c) return null;
  const id = TABLE.get(c);
  if (!id) return null;
  return SHORTCUTS.find((s) => s.id === id)?.group === 'desktop' ? null : id; // desktop-icon keys are handled by the desktop itself
}

export const fmtKeys = (k) => k.replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('ArrowUp', '↑').replace('ArrowDown', '↓');
