import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OfficeShell from '../editor/OfficeShell';
import SheetApp from './SheetApp';
import { autoFitAll } from '../../lib/sheet/autofit.js';
import { Ctl } from '../../lib/sheet/ctl.js';
import { csvToWorkbook, deserializeWb, readXlsx, serializeWb, workbookToCsv, writeXlsx } from '../../lib/sheet/xlsxio.js';

const DRAFT_MIME = 'application/x-uip-sheets2+json';
export const MAX_BYTES = 40 * 1024 * 1024;

/** Blob (.xlsx / .csv / .tsv / local draft) -> Workbook. */
async function readAny(blob, ext) {
  if (blob?.type === DRAFT_MIME) return deserializeWb(await blob.text());
  if (ext === 'csv' || ext === 'tsv') return csvToWorkbook(await blob.text(), ext === 'tsv' ? '\t' : ',');
  if (blob.size > MAX_BYTES) throw new Error('too large');
  return readXlsx(new Uint8Array(await blob.arrayBuffer()));
}
export async function openWorkbook(blob, ext) {
  const wb = await readAny(blob, ext);
  wb.sheets.forEach((s) => autoFitAll(wb, s)); // columns without their own width fit their content, like double-clicking the header edge
  return wb;
}
export function workbookBlob(wb, ext) {
  if (ext === 'csv' || ext === 'tsv') return new Blob(['\uFEFF', workbookToCsv(wb, ext === 'tsv' ? '\t' : ',')], { type: ext === 'tsv' ? 'text/tab-separated-values' : 'text/csv' });
  return new Blob([writeXlsx(wb)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Read-only viewer (FileViewer / ProtectedFile): all sheets, formatting, formulas evaluated. */
export function SheetPreview({ blob, ext, tt, rtl }) {
  const [state, setState] = useState({ ctl: null, err: '' });
  useEffect(() => { let dead = false; openWorkbook(blob, ext).then((wb) => !dead && setState({ ctl: new Ctl(wb), err: '' })).catch((e) => !dead && setState({ ctl: null, err: e?.message || String(e) })); return () => { dead = true; }; }, [blob, ext]);
  if (state.err) return <p className="st-fv__empty">{state.err}</p>;
  if (!state.ctl) return <p className="st-fv__empty">{tt('Loading…', 'جارٍ التحميل…')}</p>;
  return <div className="ed sx-preview"><SheetApp ctl={state.ctl} readOnly tt={tt} rtl={rtl} /></div>;
}

/** Full editor opened from FileViewer: formulas, formats, undo, autosave drafts, Save / Download. */
export default function SheetEditor({ blob, fileName, ext, tt, rtl, guardRef, onSave, onClose, draftKey, startDirty = false }) {
  const [state, setState] = useState({ status: 'loading' });
  const [, tick] = useState(0);
  const saveKeyRef = useRef(null);
  const actionsRef = useRef({});
  useEffect(() => {
    let dead = false;
    openWorkbook(blob, ext).then((wb) => { if (dead) return; const ctl = new Ctl(wb); if (startDirty) ctl.rev = 1; setState({ status: 'ready', ctl }); }).catch((e) => !dead && setState({ status: 'error', msg: e?.message || String(e) }));
    return () => { dead = true; };
  }, [blob, ext]); // eslint-disable-line react-hooks/exhaustive-deps
  const ctl = state.ctl;
  useEffect(() => (ctl ? ctl.on(() => tick((n) => n + 1)) : undefined), [ctl]);
  const build = useCallback(async () => workbookBlob(ctl.wb, ext), [ctl, ext]);
  useEffect(() => {
    if (!ctl) return;
    actionsRef.current.exportAs = (x, six = 0) => {
      const base = String(fileName).replace(/\.[^.]+$/, '');
      const blob = x === 'csv' ? new Blob(['\uFEFF', workbookToCsv(ctl.wb, ',', six)], { type: 'text/csv' }) : workbookBlob(ctl.wb, 'xlsx');
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${base}.${x}`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    };
  }, [ctl, fileName]);
  const draftBuild = useCallback(() => new Blob([serializeWb(ctl.wb)], { type: DRAFT_MIME }), [ctl]);
  const note = useMemo(() => (ext === 'xlsx' ? null : tt('CSV / TSV files keep values only — formulas are saved as their results and formatting is not stored. Use Save as .xlsx to keep them.', 'ملفات CSV / TSV بتحفظ القيم بس — الصيغ بتتحفظ كنتائج والتنسيق مش بيتخزن.')), [ext, tt]);
  if (state.status === 'loading') return <div className="ed ed--center"><span className="st-fv-spinner" /><p className="ed__hint">{tt('Opening the sheet…', 'جارٍ فتح الجدول…')}</p></div>;
  if (state.status === 'error') return <div className="ed ed--center"><p className="ed__err">{state.msg}</p><button type="button" className="ed__btn" onClick={onClose}>{tt('Close', 'إغلاق')}</button></div>;
  return (
    <OfficeShell className="ed--sheet" actionsRef={actionsRef} saveKeyRef={saveKeyRef} fileName={fileName} tt={tt} guardRef={guardRef} onSave={onSave} onClose={onClose} dirty={ctl.dirty} build={build} onSaved={() => ctl.markSaved()} draftKey={draftKey} draftToken={ctl.rev} draftBuild={draftBuild}
      status={note ? <p className="ed__hint ed__hint--note xg__note">{note}</p> : null}>
      <SheetApp ctl={ctl} tt={tt} rtl={rtl} saveKeyRef={saveKeyRef} actionsRef={actionsRef} fileName={fileName} />
    </OfficeShell>
  );
}
