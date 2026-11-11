import { useEffect, useRef, useState } from 'react';
import SxIcon from './SheetIcons';
import { rangeLabel } from '../../lib/sheet/print.js';

/** Excel-style "File" backstage: Info / Save / Save a copy / Print / Keyboard shortcuts / Close. */
export default function SheetFileMenu({ A, tt, fileName, dirty, onClose }) {
  const [page, setPage] = useState('info');
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector('[data-autofocus]')?.focus({ preventScroll: true }); }, []);
  const key = (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
  const go = (fn) => () => { onClose(); fn(); };
  const used = A.sheet.maxRow >= 0 ? rangeLabel({ r1: 0, c1: 0, r2: Math.max(A.sheet.maxRow, 0), c2: Math.max(A.sheet.maxCol, 0) }) : '—';
  const Nav = ({ id, icon, sicon, label, onClick, hint }) => (
    <button type="button" className={`sxf__n${page === id ? ' is-on' : ''}`} onClick={onClick || (() => setPage(id))} data-autofocus={id === 'info' ? '' : undefined}>
      <SxIcon name={sicon} size={18} /><span>{label}</span>{hint && <kbd>{hint}</kbd>}
    </button>
  );
  return (
    <div className="sxf" role="dialog" aria-modal="true" aria-label={tt('File', 'ملف')} ref={ref} onKeyDown={key}>
      <nav className="sxf__nav">
        <button type="button" className="sxf__back" onClick={onClose} aria-label={tt('Back', 'رجوع')}><SxIcon name="back" size={20} /></button>
        <Nav id="info" sicon="info" label={tt('Info', 'معلومات')} />
        <Nav id="save" sicon="save" label={tt('Save', 'حفظ')} hint="Ctrl+S" onClick={go(A.file.save)} />
        <Nav id="copy" sicon="download" label={tt('Save a Copy', 'حفظ نسخة')} hint="Ctrl+Shift+S" onClick={() => setPage('copy')} />
        <Nav id="print" sicon="print" label={tt('Print', 'طباعة')} hint="Ctrl+P" onClick={() => setPage('print')} />
        <Nav id="keys" sicon="keyboard" label={tt('Keyboard Shortcuts', 'اختصارات الكيبورد')} hint="F1" onClick={go(() => A.openDialog('shortcuts'))} />
        <span className="sx__sp" />
        <Nav id="close" sicon="close" label={tt('Close', 'إغلاق')} onClick={go(A.file.close)} />
      </nav>
      <div className="sxf__pg">
        {page === 'info' && (
          <>
            <h2 dir="auto">{fileName}</h2>
            <dl className="sxf__dl">
              <dt>{tt('Status', 'الحالة')}</dt><dd>{dirty ? tt('Unsaved changes', 'فيه تعديلات غير محفوظة') : tt('All changes saved', 'كل التعديلات محفوظة')}</dd>
              <dt>{tt('Sheets', 'الأوراق')}</dt><dd>{A.wb.sheets.length} — {A.wb.sheets.map((s) => s.name).join(', ')}</dd>
              <dt>{tt('Used range', 'النطاق المستخدم')}</dt><dd dir="ltr">{A.sheet.name}!{used}</dd>
            </dl>
            <div className="sxf__cta"><button type="button" className="sxd__btn is-primary" onClick={go(A.file.save)}>{tt('Save', 'حفظ')}</button></div>
          </>
        )}
        {page === 'copy' && (
          <>
            <h2>{tt('Save a Copy', 'حفظ نسخة')}</h2>
            <p className="sxd__hint">{tt('Downloads a copy to this device. The file stored in My PC is not changed.', 'بينزّل نسخة على الجهاز. الملف المخزّن في جهازي مش بيتغيّر.')}</p>
            <button type="button" className="sxf__card" onClick={go(() => A.file.exportAs('xlsx'))}><SxIcon name="xlsx" size={28} /><span><b>Excel Workbook (.xlsx)</b><small>{tt('Keeps formulas, formatting and all sheets', 'بيحافظ على الصيغ والتنسيق وكل الأوراق')}</small></span></button>
            <button type="button" className="sxf__card" onClick={go(() => A.file.exportAs('csv'))}><SxIcon name="csv" size={28} /><span><b>CSV (.csv)</b><small>{tt('Values of the current sheet only', 'قيم الورقة الحالية فقط')}</small></span></button>
          </>
        )}
        {page === 'print' && (
          <>
            <h2>{tt('Print', 'طباعة')}</h2>
            <div className="sxf__opts">
              <div className="sxd__seg" role="radiogroup" aria-label={tt('Orientation', 'الاتجاه')}>
                <button type="button" role="radio" aria-checked={!A.view.land} className={!A.view.land ? 'is-on' : ''} onClick={() => A.setView({ land: false })}>{tt('Portrait', 'طولي')}</button>
                <button type="button" role="radio" aria-checked={!!A.view.land} className={A.view.land ? 'is-on' : ''} onClick={() => A.setView({ land: true })}>{tt('Landscape', 'عرضي')}</button>
              </div>
              <label className="sxd__chk"><input type="checkbox" checked={!!A.view.pgrid} onChange={() => A.setView({ pgrid: !A.view.pgrid })} />{tt('Print gridlines', 'طباعة خطوط الشبكة')}</label>
              {(A.sel.r1 !== A.sel.r2 || A.sel.c1 !== A.sel.c2) && <label className="sxd__chk"><input type="checkbox" checked={!!A.view.psel} onChange={() => A.setView({ psel: !A.view.psel })} />{tt('Print the selection only', 'اطبع التحديد فقط')} <span dir="ltr">({rangeLabel(A.sel)})</span></label>}
            </div>
            <div className="sxf__cta"><button type="button" className="sxd__btn is-primary" onClick={go(A.print)}><SxIcon name="print" size={16} /> {tt('Print', 'طباعة')}</button></div>
          </>
        )}
      </div>
    </div>
  );
}
