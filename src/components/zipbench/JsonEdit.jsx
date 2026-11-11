import { useCallback, useRef, useState } from 'react';
import JsonViewer from '../admin/JsonViewer';

/** Keeps the file's own indentation (tabs / 2 / 4 spaces) and trailing newline when the visual editor writes it back. */
function serialize(v, original) {
  const m = /\n([ \t]+)\S/.exec(original);
  const indent = m ? (m[1][0] === '\t' ? '\t' : m[1].length) : 2;
  return JSON.stringify(v, null, indent) + (/\n$/.test(original) ? '\n' : '');
}

/** Visual (tree / graph / outline) editor for a .json tab of the ZIP workbench. Edits are written back as text on every change.
 *  The theme is the workbench's own (shared with the code editor); the "Code" tab hands over to the real, editable code editor (`onCode`). */
export default function JsonEdit({ path, text, onText, tt, theme, onTheme, onCode }) {
  const [value, setValue] = useState(() => JSON.parse(text));
  const base = useRef(text);
  const onChange = useCallback((next) => { setValue(next); onText(serialize(next, base.current)); }, [onText]);
  return (
    <div className="zb-json">
      <JsonViewer value={value} filename={path.split('/').pop()} onChange={onChange} theme={theme} onTheme={onTheme} onCode={onCode}
        labels={{ tree: tt('Tree', 'شجرة'), outline: tt('Outline', 'هيكل'), code: tt('Code', 'كود'), search: tt('Search keys & values…', 'ابحث في المفاتيح والقيم…'), expand: tt('Expand all', 'فتح الكل'), collapse: tt('Collapse all', 'طي الكل'), copy: tt('Copy', 'نسخ'), download: tt('Download', 'تنزيل'), add: tt('Add', 'إضافة'), remove: tt('Delete', 'حذف'), cancel: tt('Cancel', 'إلغاء'), editHint: tt('Double-click a value to edit it', 'اضغط مرتين على قيمة لتعديلها'), theme: tt('Theme', 'الثيم'), dark: tt('Dark', 'داكن'), light: tt('Light', 'فاتح'), full: tt('Full screen', 'ملء الشاشة'), exit: tt('Exit full screen', 'إنهاء ملء الشاشة'), nodes: tt('nodes', 'عقدة'), lines: tt('lines', 'سطر'), path: tt('Click a node to see its path', 'اضغط على عقدة لعرض مسارها'), matches: tt('matches', 'نتيجة'), wrap: tt('Wrap', 'التفاف') }} />
    </div>
  );
}
