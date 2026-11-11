/**
 * Keyboard layer of the spreadsheet editor.
 *
 * Why this exists: a browser shortcut is decided by the *character* a key produces (`e.key`). On an Arabic (or any non-Latin)
 * layout Ctrl+S produces `س`, so code that compares `e.key === 's'` never matches, never calls preventDefault(), and the browser
 * opens its own "Save page as…" dialog. `base()` resolves the logical key: the Latin letter when the layout has one (so AZERTY /
 * Dvorak keep working), otherwise the physical key (`e.code`), which is the same on every layout.
 */

const CODE_KEYS = {
  Semicolon: ';', Backquote: '`', Minus: '-', Equal: '=', NumpadAdd: '+', NumpadSubtract: '-', NumpadDecimal: '.', Space: ' ',
  Comma: ',', Period: '.', Slash: '/', BracketLeft: '[', BracketRight: ']', Quote: "'", Backslash: '\\',
};

/** Logical key of a keyboard event, independent of the active keyboard layout: 'a'..'z', '0'..'9', ';', '`', 'F5', 'PageDown', 'Enter' ... */
export function base(e) {
  const k = e.key || '';
  if (k.length === 1 && /[a-z]/i.test(k)) return k.toLowerCase();
  const c = e.code || '';
  if (/^Key[A-Z]$/.test(c)) return c[3].toLowerCase();
  if (/^Digit\d$/.test(c)) return c[5];
  if (/^Numpad\d$/.test(c)) return c[6];
  if (CODE_KEYS[c]) return CODE_KEYS[c];
  if (k.length === 1) return k;
  return k;
}

/** { k, ctrl, shift, alt } — `ctrl` also covers ⌘ on macOS. */
export function chord(e) {
  return { k: base(e), ctrl: !!(e.ctrlKey || e.metaKey), shift: !!e.shiftKey, alt: !!e.altKey };
}

/** True while the event comes from something the user is typing into (cell editor, formula bar, find box, any other input). */
export const isTextField = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

/**
 * Combos the browser owns even though a spreadsheet wants them. While the sheet is the active surface they are always
 * swallowed — pressing Ctrl+S must never reach the browser's "Save page as…", Ctrl+P its page print dialog, Ctrl+U "view source", etc.
 * Developer-tool combos (F12, Ctrl+Shift+I / J / C, Ctrl+Shift+R) are deliberately left alone, and Ctrl+N / T / W / Q / Tab are reserved by the
 * browser itself — no web page can intercept those.
 */
const CTRL_PLAIN = /^[a-z0-9;`=+\-]$/; // Ctrl + letter / digit / ; ` = + -
const CTRL_SHIFT = new Set(['s', 'p', 'z', '1', '2', '3', '4', '5', '6', '7', '9', '0', ';', '`', '-', '=', '+']);
const KEYS_PLAIN = new Set(['F1', 'F3', 'F5', 'F9']);
export function browserOwned(c) {
  if (c.alt) return false;
  if (!c.ctrl) return KEYS_PLAIN.has(c.k) || (c.shift && (c.k === 'F3' || c.k === 'F11'));
  if (c.k === 'v') return false; // paste is a native event the grid listens to
  if (c.shift) return CTRL_SHIFT.has(c.k);
  return CTRL_PLAIN.test(c.k) || c.k === 'F1' || c.k === 'F4' || c.k === 'PageUp' || c.k === 'PageDown';
}

/** Cheat-sheet (Help ▸ Keyboard shortcuts, F1). */
export const SHORTCUT_GROUPS = [
  { id: 'file', en: 'File', ar: 'الملف' },
  { id: 'move', en: 'Move & select', ar: 'التنقل والتحديد' },
  { id: 'edit', en: 'Edit', ar: 'التحرير' },
  { id: 'format', en: 'Format', ar: 'التنسيق' },
  { id: 'rows', en: 'Rows, columns & sheets', ar: 'الصفوف والأعمدة والأوراق' },
];

export const SHORTCUTS = [
  { g: 'file', keys: 'Ctrl+S', en: 'Save', ar: 'حفظ' },
  { g: 'file', keys: 'Ctrl+Shift+S / F12', en: 'Save a copy (download)', ar: 'حفظ نسخة (تنزيل)' },
  { g: 'file', keys: 'Ctrl+P', en: 'Print', ar: 'طباعة' },
  { g: 'file', keys: 'Ctrl+F1', en: 'Collapse / expand the ribbon', ar: 'طيّ / فرد الشريط' },
  { g: 'file', keys: 'F1', en: 'This list', ar: 'هذه القائمة' },

  { g: 'move', keys: '← ↑ → ↓', en: 'Move one cell', ar: 'تحريك خلية' },
  { g: 'move', keys: 'Ctrl+← ↑ → ↓', en: 'Jump to the edge of the data', ar: 'القفز لحافة البيانات' },
  { g: 'move', keys: 'Shift+Arrows', en: 'Extend the selection', ar: 'توسيع التحديد' },
  { g: 'move', keys: 'Ctrl+Shift+Arrows', en: 'Extend to the edge of the data', ar: 'توسيع التحديد لحافة البيانات' },
  { g: 'move', keys: 'Tab / Shift+Tab', en: 'Next / previous cell', ar: 'الخلية التالية / السابقة' },
  { g: 'move', keys: 'Enter / Shift+Enter', en: 'Down / up (cycles inside a selection)', ar: 'لأسفل / لأعلى' },
  { g: 'move', keys: 'Home / Ctrl+Home', en: 'Start of the row / A1', ar: 'بداية الصف / A1' },
  { g: 'move', keys: 'Ctrl+End', en: 'Last used cell', ar: 'آخر خلية مستخدمة' },
  { g: 'move', keys: 'PageUp / PageDown', en: 'One screen up / down', ar: 'شاشة لأعلى / لأسفل' },
  { g: 'move', keys: 'Alt+PageUp / PageDown', en: 'One screen left / right', ar: 'شاشة لليسار / لليمين' },
  { g: 'move', keys: 'Ctrl+A', en: 'Select the data, again for the whole sheet', ar: 'تحديد البيانات، ثم الورقة كلها' },
  { g: 'move', keys: 'Ctrl+Space / Shift+Space', en: 'Select column / row', ar: 'تحديد العمود / الصف' },
  { g: 'move', keys: 'Ctrl+G / F5', en: 'Go to…', ar: 'اذهب إلى…' },
  { g: 'move', keys: 'Ctrl+F / Ctrl+H', en: 'Find / Replace', ar: 'بحث / استبدال' },
  { g: 'move', keys: 'Ctrl+PageUp / PageDown', en: 'Previous / next sheet', ar: 'الورقة السابقة / التالية' },

  { g: 'edit', keys: 'F2', en: 'Edit the cell', ar: 'تحرير الخلية' },
  { g: 'edit', keys: 'F4', en: 'Cycle $ in a reference (while editing)', ar: 'تبديل $ في المرجع (أثناء التحرير)' },
  { g: 'edit', keys: 'Alt+Enter', en: 'New line inside a cell', ar: 'سطر جديد داخل الخلية' },
  { g: 'edit', keys: 'Ctrl+Enter', en: 'Fill the selection with the entry', ar: 'تعبئة التحديد بالمُدخل' },
  { g: 'edit', keys: 'Esc', en: 'Cancel the edit', ar: 'إلغاء التحرير' },
  { g: 'edit', keys: 'Ctrl+Z / Ctrl+Y', en: 'Undo / Redo', ar: 'تراجع / إعادة' },
  { g: 'edit', keys: 'Ctrl+C / X / V', en: 'Copy / Cut / Paste', ar: 'نسخ / قص / لصق' },
  { g: 'edit', keys: 'Ctrl+D / Ctrl+R', en: 'Fill down / right', ar: 'تعبئة لأسفل / لليمين' },
  { g: 'edit', keys: 'Alt+=', en: 'AutoSum', ar: 'جمع تلقائي' },
  { g: 'edit', keys: 'Ctrl+; / Ctrl+Shift+;', en: 'Insert today’s date / the time', ar: 'إدراج تاريخ اليوم / الوقت' },
  { g: 'edit', keys: "Ctrl+`", en: 'Show formulas', ar: 'إظهار الصيغ' },
  { g: 'edit', keys: 'Delete', en: 'Clear contents', ar: 'مسح المحتوى' },
  { g: 'edit', keys: 'F9', en: 'Recalculate', ar: 'إعادة الحساب' },
  { g: 'edit', keys: 'Shift+F3', en: 'Insert function…', ar: 'إدراج دالة…' },

  { g: 'format', keys: 'Ctrl+1', en: 'Format Cells…', ar: 'تنسيق الخلايا…' },
  { g: 'format', keys: 'Ctrl+B / I / U', en: 'Bold / Italic / Underline', ar: 'غامق / مائل / تسطير' },
  { g: 'format', keys: 'Ctrl+5', en: 'Strikethrough', ar: 'يتوسطه خط' },
  { g: 'format', keys: 'Ctrl+Shift+1 / 4 / 5', en: 'Number / Currency / Percent', ar: 'رقم / عملة / نسبة' },
  { g: 'format', keys: 'Ctrl+Shift+3 / 2', en: 'Date / Time', ar: 'تاريخ / وقت' },
  { g: 'format', keys: 'Ctrl+Shift+6 / `', en: 'Scientific / General', ar: 'علمي / عام' },
  { g: 'format', keys: 'Ctrl+Shift+7', en: 'Outline border', ar: 'حدود خارجية' },
  { g: 'format', keys: 'Ctrl+Shift+-', en: 'Remove borders', ar: 'إزالة الحدود' },
  { g: 'format', keys: 'Ctrl+L', en: 'Format as table', ar: 'تنسيق كجدول' },
  { g: 'format', keys: 'Ctrl+Shift+L', en: 'Turn filter on / off', ar: 'تشغيل / إيقاف التصفية' },

  { g: 'rows', keys: 'Ctrl++ / Ctrl+-', en: 'Insert / delete', ar: 'إدراج / حذف' },
  { g: 'rows', keys: 'Ctrl+9 / Ctrl+0', en: 'Hide rows / columns', ar: 'إخفاء الصفوف / الأعمدة' },
  { g: 'rows', keys: 'Ctrl+Shift+9 / 0', en: 'Unhide rows / columns', ar: 'إظهار الصفوف / الأعمدة' },
  { g: 'rows', keys: 'Shift+F11', en: 'New sheet', ar: 'ورقة جديدة' },
  { g: 'rows', keys: 'Ctrl+scroll', en: 'Zoom', ar: 'تكبير / تصغير' },
];
