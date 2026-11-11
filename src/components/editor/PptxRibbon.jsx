import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import { Btn } from './EditorUI';
import { SHAPE_MENU, geomPath } from './pptxGeom';

const keep = (e) => { if (!/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) e.preventDefault(); }; // keep the text selection while clicking the ribbon
const FONTS = ['Arial', 'Calibri', 'Cambria', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Tahoma', 'Segoe UI', 'Impact', 'Comic Sans MS', 'Trebuchet MS', 'Cairo', 'Noto Naskh Arabic'];
const STD = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];
const THEME_KEYS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
const ZOOMS = [[0.5, '50%'], [0.75, '75%'], [1, 'Fit'], [1.5, '150%'], [2, '200%'], [3, '300%']];
const cm = (v) => Math.round((v / 360000) * 100) / 100;

function B({ icon, label, onClick, on, disabled, children, className }) {
  return <Btn icon={icon} title={label} onClick={onClick} active={on} disabled={disabled} className={`pxr__b ${className || ''}`} onMouseDown={keep}>{children}</Btn>;
}
const Grp = ({ title, children }) => <div className="pxr__g"><div className="pxr__row">{children}</div><span className="pxr__lbl">{title}</span></div>;

/** A dropdown panel rendered inside the editor frame (the ribbon scrolls, so it cannot host the panel itself). */
function Pop({ icon, label, text, children, extra }) {
  const [open, setOpen] = useState(false); const [pos, setPos] = useState(null); const btn = useRef(null); const panel = useRef(null);
  const toggle = () => {
    if (!open) { const ed = btn.current.closest('.ed'); const r = btn.current.getBoundingClientRect(); const er = ed.getBoundingClientRect(); setPos({ ed, left: Math.max(4, Math.min(r.left - er.left, er.width - 280)), top: r.bottom - er.top + 4 }); }
    setOpen(!open);
  };
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (!panel.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', h); return () => document.removeEventListener('pointerdown', h);
  }, [open]);
  return (
    <span ref={btn} className="pxr__pw">
      <Btn icon={icon} title={label} active={open} onClick={toggle} className="pxr__b" onMouseDown={keep}>{text && <span>{text}</span>}{extra}<Icon name="chevron-down" size={11} /></Btn>
      {open && pos && createPortal(<div ref={panel} className="pxr__pop" data-px-keep style={{ left: pos.left, top: pos.top }} onMouseDown={keep}>{children(() => setOpen(false))}</div>, pos.ed)}
    </span>
  );
}
function ColorBtn({ icon, label, color, onPick, theme, noneLabel }) {
  const th = THEME_KEYS.map((k) => theme?.[k]).filter(Boolean);
  const sw = (c, close) => <button key={c} type="button" className="pxr__sw" style={{ background: c }} title={c} onClick={() => { onPick(c); close(); }} />;
  return (
    <Pop icon={icon} label={label} extra={<i className="pxr__cur" style={{ background: color || 'transparent' }} />}>
      {(close) => (
        <div className="pxr__pal">
          {th.length > 0 && <><small>Theme</small><div className="pxr__sws">{th.map((c) => sw(c, close))}</div></>}
          <small>Standard</small><div className="pxr__sws">{STD.map((c) => sw(c, close))}</div>
          {noneLabel && <button type="button" className="pxr__none" onClick={() => { onPick(null); close(); }}>{noneLabel}</button>}
          <label className="pxr__custom"><span>Custom</span><input type="color" value={/^#[0-9a-f]{6}$/i.test(color || '') ? color : '#000000'} onChange={(e) => onPick(e.target.value)} /></label>
        </div>
      )}
    </Pop>
  );
}
function NumField({ value, onCommit, step = 0.1, min, width = 58, title }) {
  return <input key={String(value)} className="pxr__num" type="number" step={step} min={min} defaultValue={value ?? ''} title={title} aria-label={title} style={{ width }}
    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); }} onBlur={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v) && v !== value) onCommit(v); }} />;
}
function ShapeIcon({ prst }) {
  return <svg viewBox="0 0 100 70" width="30" height="21" aria-hidden="true"><path d={geomPath(prst, 100, 70)} fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" /></svg>;
}

export default function Ribbon({ tt, S, A }) {
  const { tab, sel, fmt, isTable, theme, hasSel } = S; const f = fmt || {}; const ptSize = f.sz ? f.sz / 100 : '';
  const fileRef = useRef(null); const [grid, setGrid] = useState([0, 0]);
  const tabs = [['home', tt('Home', 'الرئيسية')], ['insert', tt('Insert', 'إدراج')], ['format', tt('Format', 'تنسيق')], ['design', tt('Design', 'تصميم')], ['view', tt('View', 'عرض')]];
  const line = sel?.line;
  return (
    <div className="pxr" data-px-keep>
      <div className="pxr__tabs" role="tablist">
        <B icon="ed-undo" label={tt('Undo (Ctrl+Z)', 'تراجع (Ctrl+Z)')} onClick={A.undo} disabled={!S.canUndo} />
        <B icon="ed-redo" label={tt('Redo (Ctrl+Y)', 'إعادة (Ctrl+Y)')} onClick={A.redo} disabled={!S.canRedo} />
        <span className="ed__sep" />
        {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onMouseDown={keep} onClick={() => A.setTab(k)}>{l}</button>)}
      </div>
      <div className="pxr__body">
        {tab === 'home' && <>
          <Grp title={tt('Clipboard', 'الحافظة')}>
            <B icon="ed-paste" label={tt('Paste (Ctrl+V)', 'لصق (Ctrl+V)')} onClick={A.paste} disabled={!S.canPaste} />
            <B icon="ed-cut" label={tt('Cut (Ctrl+X)', 'قص (Ctrl+X)')} onClick={A.cut} disabled={!hasSel} />
            <B icon="copy" label={tt('Copy (Ctrl+C)', 'نسخ (Ctrl+C)')} onClick={A.copy} disabled={!hasSel} />
            <B icon="layers" label={tt('Duplicate (Ctrl+D)', 'تكرار (Ctrl+D)')} onClick={A.dup} disabled={!hasSel} />
          </Grp>
          <Grp title={tt('Slides', 'الشرائح')}>
            <B icon="ed-slide-add" label={tt('New slide', 'شريحة جديدة')} onClick={() => A.newSlide(null)} />
            <Pop icon="chevron-down" label={tt('Choose a layout', 'اختر تخطيطًا')}>
              {(close) => <div className="pxr__list">{S.layouts.map((l) => <button key={l.path} type="button" onClick={() => { A.newSlide(l.path); close(); }}>{l.name}</button>)}</div>}
            </Pop>
            <B icon="copy" label={tt('Duplicate slide', 'تكرار الشريحة')} onClick={A.dupSlide} />
            <B icon="trash" label={tt('Delete slide', 'حذف الشريحة')} onClick={A.delSlide} disabled={S.slideCount < 2} />
            <B icon="arrow-up" label={tt('Move slide up', 'تحريك الشريحة لأعلى')} onClick={() => A.moveSlide(-1)} disabled={S.cur === 0} />
            <B icon="arrow-down" label={tt('Move slide down', 'تحريك الشريحة لأسفل')} onClick={() => A.moveSlide(1)} disabled={S.cur >= S.slideCount - 1} />
          </Grp>
          <Grp title={tt('Font', 'الخط')}>
            <select className="pxr__sel" value={f.font || ''} disabled={!hasSel} aria-label={tt('Font', 'الخط')} onChange={(e) => A.char({ font: e.target.value })} style={{ width: 128 }}>
              <option value="">{f.font || tt('Font', 'الخط')}</option>{FONTS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <B icon="ed-minus" label={tt('Smaller', 'أصغر')} onClick={() => A.size((ptSize || 18) - ((ptSize || 18) > 20 ? 2 : 1))} disabled={!hasSel} />
            <NumField value={ptSize} step={1} min={1} width={52} title={tt('Font size (pt)', 'حجم الخط')} onCommit={(v) => A.size(v)} />
            <B icon="plus" label={tt('Larger', 'أكبر')} onClick={() => A.size((ptSize || 18) + ((ptSize || 18) >= 20 ? 2 : 1))} disabled={!hasSel} />
            <B icon="ed-bold" label={tt('Bold (Ctrl+B)', 'عريض (Ctrl+B)')} on={!!f.b} onClick={() => A.char({ b: !f.b })} disabled={!hasSel} />
            <B icon="ed-italic" label={tt('Italic (Ctrl+I)', 'مائل (Ctrl+I)')} on={!!f.i} onClick={() => A.char({ i: !f.i })} disabled={!hasSel} />
            <B icon="ed-underline" label={tt('Underline (Ctrl+U)', 'تسطير (Ctrl+U)')} on={!!f.u} onClick={() => A.char({ u: !f.u })} disabled={!hasSel} />
            <B icon="ed-strike" label={tt('Strikethrough', 'يتوسطه خط')} on={!!f.st} onClick={() => A.char({ st: !f.st })} disabled={!hasSel} />
            <ColorBtn icon="ed-font-color" label={tt('Text color', 'لون النص')} color={f.color} theme={theme} onPick={(c) => A.char({ color: c })} />
          </Grp>
          <Grp title={tt('Paragraph', 'الفقرة')}>
            <B icon="ed-align-left" label={tt('Align left', 'محاذاة لليسار')} on={f.algn === 'l'} onClick={() => A.para({ algn: 'l' })} disabled={!hasSel} />
            <B icon="ed-align-center" label={tt('Center', 'توسيط')} on={f.algn === 'ctr'} onClick={() => A.para({ algn: 'ctr' })} disabled={!hasSel} />
            <B icon="ed-align-right" label={tt('Align right', 'محاذاة لليمين')} on={f.algn === 'r'} onClick={() => A.para({ algn: 'r' })} disabled={!hasSel} />
            <B icon="ed-justify" label={tt('Justify', 'ضبط')} on={f.algn === 'just'} onClick={() => A.para({ algn: 'just' })} disabled={!hasSel} />
            <B icon="ed-list" label={tt('Bullets', 'نقاط')} on={f.bullet === '•'} onClick={() => A.para({ bullet: f.bullet === '•' ? 'none' : 'dot' })} disabled={!hasSel} />
            <B icon="ed-numbered" label={tt('Numbering', 'ترقيم')} on={f.bullet === '#'} onClick={() => A.para({ bullet: f.bullet === '#' ? 'none' : 'num' })} disabled={!hasSel} />
            <B icon="ed-rtl" label={tt('Right-to-left', 'من اليمين لليسار')} on={!!f.rtl} onClick={() => A.para({ rtl: !f.rtl, algn: !f.rtl ? 'r' : 'l' })} disabled={!hasSel} />
            <B icon="ed-valign-top" label={tt('Align top', 'محاذاة للأعلى')} on={f.anchor === 't'} onClick={() => A.para({ anchor: 't' })} disabled={!hasSel} />
            <B icon="ed-valign-mid" label={tt('Align middle', 'محاذاة للوسط')} on={f.anchor === 'ctr'} onClick={() => A.para({ anchor: 'ctr' })} disabled={!hasSel} />
            <B icon="ed-valign-bottom" label={tt('Align bottom', 'محاذاة للأسفل')} on={f.anchor === 'b'} onClick={() => A.para({ anchor: 'b' })} disabled={!hasSel} />
            <Pop icon="ed-line-spacing" label={tt('Line spacing', 'تباعد الأسطر')}>
              {(close) => <div className="pxr__list">{[100, 115, 150, 200].map((v) => <button key={v} type="button" className={f.lnSpc === v ? 'is-on' : ''} onClick={() => { A.para({ lnSpc: v }); close(); }}>{v / 100}</button>)}</div>}
            </Pop>
          </Grp>
        </>}
        {tab === 'insert' && <>
          <Grp title={tt('Text', 'نص')}><B icon="ed-type" label={tt('Text box', 'مربع نص')} onClick={A.addText}><span>{tt('Text box', 'مربع نص')}</span></B></Grp>
          <Grp title={tt('Illustrations', 'رسومات')}>
            <Pop icon="ed-square" label={tt('Shapes', 'أشكال')} text={tt('Shapes', 'أشكال')}>
              {(close) => <div className="pxr__shapes">{SHAPE_MENU.map(([g, en, ar]) => <button key={g} type="button" title={tt(en, ar)} onClick={() => { A.addShape(g); close(); }}><ShapeIcon prst={g} /></button>)}</div>}
            </Pop>
            <B icon="ed-line" label={tt('Line', 'خط')} onClick={() => A.addShape('line')} />
            <B icon="ed-arrow" label={tt('Arrow', 'سهم')} onClick={() => A.addShape('arrow')} />
            <B icon="ed-image-plus" label={tt('Picture', 'صورة')} onClick={() => fileRef.current?.click()}><span>{tt('Picture', 'صورة')}</span></B>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const fl = e.target.files?.[0]; e.target.value = ''; if (fl) A.addImage(fl); }} />
          </Grp>
          <Grp title={tt('Tables', 'جداول')}>
            <Pop icon="ed-table" label={tt('Table', 'جدول')} text={tt('Table', 'جدول')}>
              {(close) => (
                <div className="pxr__tgrid" onMouseLeave={() => setGrid([0, 0])}>
                  <div className="pxr__tg" style={{ gridTemplateColumns: 'repeat(8, 22px)' }}>
                    {Array.from({ length: 48 }, (_, i) => { const r = Math.floor(i / 8) + 1; const c = (i % 8) + 1; return <i key={i} className={r <= grid[0] && c <= grid[1] ? 'is-on' : ''} onMouseEnter={() => setGrid([r, c])} onClick={() => { A.addTable(r, c); close(); }} />; })}
                  </div>
                  <small>{grid[0] ? `${grid[0]} × ${grid[1]}` : tt('Pick a size', 'اختر الحجم')}</small>
                </div>
              )}
            </Pop>
          </Grp>
        </>}
        {tab === 'format' && <>
          <Grp title={tt('Shape style', 'نمط الشكل')}>
            <ColorBtn icon="ed-fill" label={tt('Fill', 'تعبئة')} color={sel?.fill} theme={theme} onPick={A.fill} noneLabel={tt('No fill', 'بدون تعبئة')} />
            <ColorBtn icon="ed-outline" label={tt('Outline', 'حد')} color={line?.color} theme={theme} onPick={(c) => A.line({ color: c })} noneLabel={tt('No outline', 'بدون حد')} />
            <select className="pxr__sel" aria-label={tt('Outline weight', 'سُمك الحد')} disabled={!hasSel} value={line ? String(Math.round(line.w / 12700 * 2) / 2) : ''} onChange={(e) => A.line({ w: parseFloat(e.target.value) * 12700, ...(line ? {} : { color: '#404040' }) })} style={{ width: 70 }}>
              <option value="">{tt('Weight', 'السُمك')}</option>{[0.5, 1, 2, 3, 4.5, 6, 9].map((v) => <option key={v} value={v}>{v} pt</option>)}
            </select>
            <select className="pxr__sel" aria-label={tt('Dash', 'نمط الخط')} disabled={!hasSel} value={line?.dash || 'solid'} onChange={(e) => A.line({ dash: e.target.value })} style={{ width: 82 }}>
              {[['solid', tt('Solid', 'متصل')], ['dash', tt('Dashed', 'متقطع')], ['sysDot', tt('Dotted', 'منقط')]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <B icon="ed-arrow" label={tt('Arrow head', 'رأس سهم')} on={!!line?.tail} onClick={() => A.line({ tail: line?.tail ? null : 'triangle' })} disabled={!hasSel || !sel?.isLine} />
          </Grp>
          <Grp title={tt('Arrange', 'ترتيب')}>
            <B icon="ed-front" label={tt('Bring to front', 'إحضار للأمام')} onClick={() => A.order('front')} disabled={!hasSel} />
            <B icon="chevron-up" label={tt('Bring forward', 'تقديم')} onClick={() => A.order('forward')} disabled={!hasSel} />
            <B icon="chevron-down" label={tt('Send backward', 'تأخير')} onClick={() => A.order('backward')} disabled={!hasSel} />
            <B icon="ed-back" label={tt('Send to back', 'إرسال للخلف')} onClick={() => A.order('back')} disabled={!hasSel} />
            <Pop icon="ed-align-left" label={tt('Align to slide', 'محاذاة للشريحة')}>
              {(close) => <div className="pxr__list">{[['left', tt('Left', 'يسار')], ['center', tt('Center', 'توسيط أفقي')], ['right', tt('Right', 'يمين')], ['top', tt('Top', 'أعلى')], ['middle', tt('Middle', 'توسيط رأسي')], ['bottom', tt('Bottom', 'أسفل')]].map(([k, l]) => <button key={k} type="button" disabled={!hasSel} onClick={() => { A.align(k); close(); }}>{l}</button>)}</div>}
            </Pop>
            <B icon="ed-rotate-ccw" label={tt('Rotate left 90°', 'تدوير 90° لليسار')} onClick={() => A.rotate(-90)} disabled={!hasSel} />
            <B icon="ed-rotate-cw" label={tt('Rotate right 90°', 'تدوير 90° لليمين')} onClick={() => A.rotate(90)} disabled={!hasSel} />
            <B icon="ed-flip-h" label={tt('Flip horizontal', 'قلب أفقي')} onClick={() => A.flip('flipH')} disabled={!hasSel} />
            <B icon="ed-flip-v" label={tt('Flip vertical', 'قلب رأسي')} onClick={() => A.flip('flipV')} disabled={!hasSel} />
          </Grp>
          <Grp title={tt('Size & position (cm)', 'الحجم والموضع (سم)')}>
            {[['x', 'X'], ['y', 'Y'], ['w', 'W'], ['h', 'H']].map(([k, l]) => <label key={k} className="pxr__fld"><span>{l}</span><NumField value={sel ? cm(sel[k]) : ''} min={k === 'w' || k === 'h' ? 0 : undefined} title={l} onCommit={(v) => A.box({ [k]: v * 360000 })} /></label>)}
            <label className="pxr__fld"><span>°</span><NumField value={sel ? Math.round(sel.rot || 0) : ''} step={1} width={52} title={tt('Rotation', 'التدوير')} onCommit={(v) => A.box({ rot: v })} /></label>
          </Grp>
          {isTable && <Grp title={tt('Table', 'الجدول')}>
            <B icon="ed-row-plus" label={tt('Insert row below', 'إضافة صف')} onClick={() => A.table('addRow')} />
            <B icon="ed-col-plus" label={tt('Insert column after', 'إضافة عمود')} onClick={() => A.table('addCol')} />
            <B icon="ed-minus" label={tt('Delete row', 'حذف الصف')} onClick={() => A.table('delRow')}><span>{tt('Row', 'صف')}</span></B>
            <B icon="ed-minus" label={tt('Delete column', 'حذف العمود')} onClick={() => A.table('delCol')}><span>{tt('Col', 'عمود')}</span></B>
            <ColorBtn icon="ed-fill" label={tt('Cell fill', 'تعبئة الخلية')} color={null} theme={theme} onPick={A.cellFill} noneLabel={tt('No fill', 'بدون تعبئة')} />
          </Grp>}
        </>}
        {tab === 'design' && <Grp title={tt('Background', 'الخلفية')}>
          <ColorBtn icon="palette" label={tt('Slide background', 'خلفية الشريحة')} color={S.bg} theme={theme} onPick={(c) => A.bg(c, false)} noneLabel={tt('Use the layout background', 'خلفية التخطيط')} />
          <B icon="layers" label={tt('Apply this background to every slide', 'تطبيق الخلفية على كل الشرائح')} onClick={() => A.bg(S.bg, true)} disabled={!S.bg}><span>{tt('Apply to all', 'تطبيق على الكل')}</span></B>
        </Grp>}
        {tab === 'view' && <>
          <Grp title={tt('Zoom', 'التكبير')}>
            <select className="pxr__sel" aria-label={tt('Zoom', 'التكبير')} value={S.zoom} onChange={(e) => A.zoom(parseFloat(e.target.value))} style={{ width: 82 }}>{ZOOMS.map(([v, l]) => <option key={v} value={v}>{l === 'Fit' ? tt('Fit', 'ملاءمة') : l}</option>)}</select>
          </Grp>
          <Grp title={tt('Show', 'إظهار')}><B icon="ed-notes" label={tt('Speaker notes', 'ملاحظات المتحدث')} on={S.notesOpen} onClick={A.toggleNotes}><span>{tt('Notes', 'ملاحظات')}</span></B></Grp>
          <Grp title={tt('Slide show', 'عرض الشرائح')}>
            <B icon="play" label={tt('From beginning', 'من البداية')} onClick={() => A.present(true)}><span>{tt('From start', 'من البداية')}</span></B>
            <B icon="play" label={tt('From current slide', 'من الشريحة الحالية')} onClick={() => A.present(false)}><span>{tt('Current', 'الحالية')}</span></B>
          </Grp>
        </>}
      </div>
    </div>
  );
}
