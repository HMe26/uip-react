import '../../styles/css/editor.css';
import { useEffect, useRef, useState } from 'react';
import SheetGrid from '../editor/SheetGrid';
import useDocHistory from '../editor/useDocHistory';
import { MAX_CELLS, normalize, toCsvText } from '../../lib/officeFmt/xlsx';
import { parseCsv } from '../../lib/exporter';

export const isGridExt = (p) => /\.(csv|tsv)$/i.test(p || '');
export const gridTooBig = (text) => text.length > 6_000_000;

/** Spreadsheet view of a CSV / TSV tab inside the ZIP workbench. Edits are written back as text on every change. */
export default function CsvGrid({ path, text, onText, tt, rtl }) {
  const tsv = /\.tsv$/i.test(path);
  const h = useDocHistory(null);
  const [ready, setReady] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    const rows = tsv ? text.replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.split('\t')).filter((r, i, a) => !(i === a.length - 1 && r.length === 1 && r[0] === '')) : parseCsv(text);
    h.reset(rows.length ? normalize(rows) : [['']]); setReady(true); first.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  useEffect(() => {
    if (!ready || !h.value) return;
    if (first.current) { first.current = false; return; }
    onText(toCsvText(h.value, tsv ? '\t' : ','));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h.value]);
  if (!ready || !h.value) return null;
  if (h.value.length * h.value[0].length > MAX_CELLS) return <div className="zb--center"><p>{tt('This file is too large for the grid view — use the text view.', 'الملف كبير على عرض الجدول — استخدم عرض النص.')}</p></div>;
  return <div className="ed zb-grid"><SheetGrid cells={h.value} onChange={h.set} tt={tt} rtl={rtl} undo={h.undo} redo={h.redo} canUndo={h.canUndo} canRedo={h.canRedo} /></div>;
}
