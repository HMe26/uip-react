import { useState } from 'react';
import { B, Grp, Pop, ColorBtn, NumField, keep } from './ribbonParts';
import { FONTS, SIZES, PAGE_SIZES, MARGIN_PRESETS, SYMBOLS, STYLES, twToCm, cmToTw } from './docxEdit';

const LINES = [1, 1.15, 1.5, 2, 2.5, 3];
const LIST_TYPES = [['1', '1. 2. 3.'], ['a', 'a. b. c.'], ['A', 'A. B. C.'], ['i', 'i. ii. iii.'], ['I', 'I. II. III.']];

/** Word ribbon. S = state from DocxView, A = actions. Same look as the PowerPoint ribbon (.pxr*). */
export default function DocxRibbon({ tt, S, A }) {
  const { tab, fmt, pg, zoom } = S; const f = fmt || {}; const has = !!f.has;
  const [grid, setGrid] = useState([0, 0]);
  const tabs = [['home', tt('Home', 'الرئيسية')], ['insert', tt('Insert', 'إدراج')], ['layout', tt('Layout', 'تخطيط')], ['view', tt('View', 'عرض')]];
  if (S.inTable) tabs.push(['table', tt('Table', 'الجدول')]);
  if (S.imgSel) tabs.push(['picture', tt('Picture', 'الصورة')]);
  const cur = tabs.some(([k]) => k === tab) ? tab : 'home';
  const sizeVal = f.size || '';
  const cm = (v) => twToCm(v);
  const margin = (k) => <NumField key={k} value={pg ? cm(pg[k]) : ''} step={0.1} min={0} width={54} title={{ top: tt('Top (cm)', 'أعلى (سم)'), bottom: tt('Bottom (cm)', 'أسفل (سم)'), left: tt('Left (cm)', 'يسار (سم)'), right: tt('Right (cm)', 'يمين (سم)') }[k]} onCommit={(v) => A.margins({ [k]: cmToTw(v) })} />;
  const sizeName = pg ? PAGE_SIZES.find((s) => s[1] === Math.min(pg.w, pg.h) && s[2] === Math.max(pg.w, pg.h))?.[0] || '' : '';

  return (
    <div className="pxr dxr" data-px-keep>
      <div className="pxr__tabs" role="tablist">
        <B icon="ed-undo" label={tt('Undo (Ctrl+Z)', 'تراجع (Ctrl+Z)')} onClick={A.undo} disabled={!S.canUndo} />
        <B icon="ed-redo" label={tt('Redo (Ctrl+Y)', 'إعادة (Ctrl+Y)')} onClick={A.redo} disabled={!S.canRedo} />
        <B icon="ed-print" label={tt('Print (Ctrl+P)', 'طباعة (Ctrl+P)')} onClick={A.print} />
        <span className="ed__sep" />
        {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={cur === k} className={`${cur === k ? 'is-on' : ''}${k === 'table' || k === 'picture' ? ' pxr__ctx' : ''}`} onMouseDown={keep} onClick={() => A.setTab(k)}>{l}</button>)}
      </div>
      <div className="pxr__body">
        {cur === 'home' && <>
          <Grp title={tt('Clipboard', 'الحافظة')}>
            <B icon="ed-paste" label={tt('Paste (Ctrl+V)', 'لصق (Ctrl+V)')} onClick={A.paste} />
            <B icon="ed-cut" label={tt('Cut (Ctrl+X)', 'قص (Ctrl+X)')} onClick={A.cut} disabled={!has} />
            <B icon="copy" label={tt('Copy (Ctrl+C)', 'نسخ (Ctrl+C)')} onClick={A.copy} disabled={!has} />
          </Grp>
          <Grp title={tt('Font', 'الخط')}>
            <select className="pxr__sel" value={FONTS.includes(f.font) ? f.font : ''} disabled={!has} aria-label={tt('Font', 'الخط')} onChange={(e) => e.target.value && A.font(e.target.value)} style={{ width: 132 }}>
              <option value="">{f.font || tt('Font', 'الخط')}</option>{FONTS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <B icon="ed-minus" label={tt('Smaller', 'أصغر')} onClick={() => A.size(Math.max(1, (sizeVal || 11) - ((sizeVal || 11) > 12 ? 2 : 1)))} disabled={!has} />
            <NumField value={sizeVal} step={0.5} min={1} width={54} title={tt('Font size (pt)', 'حجم الخط (نقطة)')} onCommit={A.size} />
            <B icon="plus" label={tt('Larger', 'أكبر')} onClick={() => A.size((sizeVal || 11) + ((sizeVal || 11) >= 12 ? 2 : 1))} disabled={!has} />
            <Pop icon="ed-type" label={tt('Common sizes', 'أحجام شائعة')}>
              {(close) => <div className="pxr__list">{SIZES.map((s) => <button key={s} type="button" className={sizeVal === s ? 'is-on' : ''} onClick={() => { A.size(s); close(); }}>{s}</button>)}</div>}
            </Pop>
            <B icon="ed-bold" label={tt('Bold (Ctrl+B)', 'عريض (Ctrl+B)')} on={!!f.b} onClick={() => A.toggle('bold')} disabled={!has} />
            <B icon="ed-italic" label={tt('Italic (Ctrl+I)', 'مائل (Ctrl+I)')} on={!!f.i} onClick={() => A.toggle('italic')} disabled={!has} />
            <B icon="ed-underline" label={tt('Underline (Ctrl+U)', 'تسطير (Ctrl+U)')} on={!!f.u} onClick={() => A.toggle('underline')} disabled={!has} />
            <B icon="ed-strike" label={tt('Strikethrough', 'يتوسطه خط')} on={!!f.st} onClick={() => A.toggle('strikeThrough')} disabled={!has} />
            <B icon="ed-sub" label={tt('Subscript', 'منخفض')} on={!!f.sub} onClick={() => A.toggle('subscript')} disabled={!has} />
            <B icon="ed-sup" label={tt('Superscript', 'مرتفع')} on={!!f.sup} onClick={() => A.toggle('superscript')} disabled={!has} />
            <ColorBtn icon="ed-font-color" label={tt('Text colour', 'لون النص')} color={f.color} onPick={(c) => A.color(c)} />
            <ColorBtn icon="ed-highlight" label={tt('Highlight', 'تظليل')} color={f.hl} onPick={(c) => A.highlight(c)} noneLabel={tt('No highlight', 'بدون تظليل')} />
            <B icon="ed-clear" label={tt('Clear formatting', 'مسح التنسيق')} onClick={A.clear} disabled={!has} />
          </Grp>
          <Grp title={tt('Paragraph', 'الفقرة')}>
            <B icon="ed-list" label={tt('Bullets', 'نقاط')} on={f.list === 'ul'} onClick={() => A.list('ul')} disabled={!has} />
            <B icon="ed-numbered" label={tt('Numbering', 'ترقيم')} on={f.list === 'ol'} onClick={() => A.list('ol')} disabled={!has} />
            <Pop icon="ed-list-ordered" label={tt('Numbering style', 'نمط الترقيم')}>
              {(close) => <div className="pxr__list">{LIST_TYPES.map(([t, l]) => <button key={t} type="button" onClick={() => { A.list('ol', t); close(); }}>{l}</button>)}</div>}
            </Pop>
            <B icon="ed-outdent" label={tt('Decrease indent', 'تقليل المسافة البادئة')} onClick={() => A.indent(-1)} disabled={!has} />
            <B icon="ed-indent" label={tt('Increase indent', 'زيادة المسافة البادئة')} onClick={() => A.indent(1)} disabled={!has} />
            <B icon="ed-align-left" label={tt('Align left', 'محاذاة لليسار')} on={f.align === 'left'} onClick={() => A.align('left')} disabled={!has} />
            <B icon="ed-align-center" label={tt('Centre', 'توسيط')} on={f.align === 'center'} onClick={() => A.align('center')} disabled={!has} />
            <B icon="ed-align-right" label={tt('Align right', 'محاذاة لليمين')} on={f.align === 'right'} onClick={() => A.align('right')} disabled={!has} />
            <B icon="ed-justify" label={tt('Justify', 'ضبط')} on={f.align === 'justify'} onClick={() => A.align('justify')} disabled={!has} />
            <B icon="ed-rtl" label={tt('Right-to-left', 'من اليمين لليسار')} on={!!f.rtl} onClick={() => A.dir('rtl')} disabled={!has} />
            <B icon="ed-ltr" label={tt('Left-to-right', 'من اليسار لليمين')} on={has && !f.rtl} onClick={() => A.dir('ltr')} disabled={!has} />
            <Pop icon="ed-line-spacing" label={tt('Line spacing', 'تباعد الأسطر')}>
              {(close) => <div className="pxr__list">{LINES.map((v) => <button key={v} type="button" className={f.line === v ? 'is-on' : ''} onClick={() => { A.spacing('line', v); close(); }}>{v}</button>)}</div>}
            </Pop>
          </Grp>
          <Grp title={tt('Styles', 'الأنماط')}>
            <select className="pxr__sel" value={f.style || 'p'} disabled={!has} aria-label={tt('Style', 'النمط')} onChange={(e) => A.style(e.target.value)} style={{ width: 128 }}>
              {STYLES.map(([id, en, ar]) => <option key={id} value={id}>{tt(en, ar)}</option>)}
            </select>
          </Grp>
          <Grp title={tt('Editing', 'تحرير')}>
            <B icon="ed-find" label={tt('Find (Ctrl+F)', 'بحث (Ctrl+F)')} onClick={() => A.openFind(false)} />
            <B icon="edit" label={tt('Replace (Ctrl+H)', 'استبدال (Ctrl+H)')} onClick={() => A.openFind(true)} />
          </Grp>
        </>}

        {cur === 'insert' && <>
          <Grp title={tt('Pages', 'الصفحات')}>
            <B icon="ed-page-break" label={tt('Page break', 'فاصل صفحة')} onClick={A.pageBreak} disabled={f.root !== 'body'} />
          </Grp>
          <Grp title={tt('Table', 'جدول')}>
            <Pop icon="ed-table" label={tt('Insert table', 'إدراج جدول')}>
              {(close) => (
                <div className="dxr__grid" onMouseLeave={() => setGrid([0, 0])}>
                  <div className="dxr__gcells">{Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => (
                    <button key={`${r}-${c}`} type="button" className={r < grid[0] && c < grid[1] ? 'is-on' : ''} aria-label={`${r + 1}×${c + 1}`} onMouseEnter={() => setGrid([r + 1, c + 1])} onClick={() => { A.table(r + 1, c + 1); close(); }} />
                  )))}</div>
                  <small>{grid[0] ? `${grid[0]} × ${grid[1]}` : tt('Rows × columns', 'صفوف × أعمدة')}</small>
                </div>
              )}
            </Pop>
          </Grp>
          <Grp title={tt('Illustrations', 'رسومات')}>
            <B icon="ed-image-plus" label={tt('Picture', 'صورة')} onClick={A.image} />
          </Grp>
          <Grp title={tt('Links', 'روابط')}>
            <B icon="link" label={tt('Link (Ctrl+K)', 'رابط (Ctrl+K)')} on={!!f.link} onClick={A.link} disabled={!has} />
            <B icon="ed-clear" label={tt('Remove link', 'إزالة الرابط')} onClick={A.unlink} disabled={!f.link} />
          </Grp>
          <Grp title={tt('Header & footer', 'الرأس والتذييل')}>
            <B icon="ed-header" label={tt('Edit header', 'تعديل رأس الصفحة')} onClick={() => A.band('hdr')} />
            <B icon="ed-footer" label={tt('Edit footer', 'تعديل تذييل الصفحة')} onClick={() => A.band('ftr')} />
            <B icon="ed-hash" label={tt('Page number', 'رقم الصفحة')} onClick={() => A.field('PAGE')} disabled={!has} />
            <B icon="ed-page-plus" label={tt('Number of pages', 'عدد الصفحات')} onClick={() => A.field('NUMPAGES')} disabled={!has} />
            <B icon="trash" label={tt('Remove header', 'حذف الرأس')} onClick={() => A.delBand('hdr')} />
            <B icon="trash" label={tt('Remove footer', 'حذف التذييل')} onClick={() => A.delBand('ftr')} />
          </Grp>
          <Grp title={tt('Symbols', 'رموز')}>
            <Pop icon="ed-symbol" label={tt('Symbol', 'رمز')}>
              {(close) => <div className="dxr__sym">{SYMBOLS.map((s) => <button key={s} type="button" onClick={() => { A.symbol(s); close(); }}>{s}</button>)}</div>}
            </Pop>
          </Grp>
        </>}

        {cur === 'layout' && <>
          <Grp title={tt('Page setup', 'إعداد الصفحة')}>
            <select className="pxr__sel" value={sizeName} aria-label={tt('Paper size', 'حجم الورق')} onChange={(e) => A.pageSize(e.target.value)} style={{ width: 96 }}>
              {!sizeName && <option value="">{tt('Custom', 'مخصص')}</option>}{PAGE_SIZES.map(([n]) => <option key={n} value={n}>{n}</option>)}
            </select>
            <B icon="ed-portrait" label={tt('Portrait', 'طولي')} on={!!pg && pg.h >= pg.w} onClick={() => A.orient(false)} />
            <B icon="ed-landscape" label={tt('Landscape', 'عرضي')} on={!!pg && pg.w > pg.h} onClick={() => A.orient(true)} />
          </Grp>
          <Grp title={tt('Margins', 'الهوامش')}>
            <Pop icon="ed-margins" label={tt('Margin presets', 'هوامش جاهزة')}>
              {(close) => <div className="pxr__list">{MARGIN_PRESETS.map(([k, m]) => <button key={k} type="button" onClick={() => { A.margins(m); close(); }}>{{ normal: tt('Normal', 'عادي'), narrow: tt('Narrow', 'ضيق'), moderate: tt('Moderate', 'متوسط'), wide: tt('Wide', 'واسع') }[k]}</button>)}</div>}
            </Pop>
            {['top', 'bottom', 'left', 'right'].map(margin)}
          </Grp>
          <Grp title={tt('Spacing', 'التباعد')}>
            <NumField value={f.before ?? ''} step={1} min={0} width={54} title={tt('Space before (pt)', 'مسافة قبل (نقطة)')} onCommit={(v) => A.spacing('before', v)} />
            <NumField value={f.after ?? ''} step={1} min={0} width={54} title={tt('Space after (pt)', 'مسافة بعد (نقطة)')} onCommit={(v) => A.spacing('after', v)} />
            <NumField value={f.line ?? ''} step={0.05} min={0.5} width={54} title={tt('Line spacing', 'تباعد الأسطر')} onCommit={(v) => A.spacing('line', v)} />
          </Grp>
        </>}

        {cur === 'view' && <>
          <Grp title={tt('Zoom', 'التكبير')}>
            <B icon="ed-minus" label={tt('Zoom out', 'تصغير')} onClick={() => A.setZoom(Math.max(0.3, Math.round((zoom - 0.1) * 10) / 10))} />
            <select className="pxr__sel" value={String(Math.round(zoom * 100))} aria-label={tt('Zoom', 'تكبير')} onChange={(e) => A.setZoom(Number(e.target.value) / 100)} style={{ width: 80 }}>
              {![50, 75, 100, 125, 150, 200].includes(Math.round(zoom * 100)) && <option value={Math.round(zoom * 100)}>{Math.round(zoom * 100)}%</option>}
              {[50, 75, 100, 125, 150, 200].map((z) => <option key={z} value={z}>{z}%</option>)}
            </select>
            <B icon="plus" label={tt('Zoom in', 'تكبير')} onClick={() => A.setZoom(Math.min(2.5, Math.round((zoom + 0.1) * 10) / 10))} />
            <B icon="ed-fit" label={tt('Fit width', 'ملاءمة العرض')} onClick={A.fit} />
          </Grp>
          <Grp title={tt('Output', 'إخراج')}>
            <B icon="ed-print" label={tt('Print (Ctrl+P)', 'طباعة (Ctrl+P)')} onClick={A.print} />
          </Grp>
        </>}

        {cur === 'table' && <>
          <Grp title={tt('Rows', 'الصفوف')}>
            <B icon="ed-row-plus" label={tt('Insert row below', 'إضافة صف أسفل')} onClick={() => A.tRow(true)} />
            <B icon="ed-row-plus" label={tt('Insert row above', 'إضافة صف أعلى')} onClick={() => A.tRow(false)} className="dxr__flipv" />
            <B icon="ed-row-minus" label={tt('Delete row', 'حذف الصف')} onClick={A.tDelRow} />
          </Grp>
          <Grp title={tt('Columns', 'الأعمدة')}>
            <B icon="ed-col-plus" label={tt('Insert column after', 'إضافة عمود بعد')} onClick={() => A.tCol(true)} />
            <B icon="ed-col-plus" label={tt('Insert column before', 'إضافة عمود قبل')} onClick={() => A.tCol(false)} className="dxr__fliph" />
            <B icon="ed-col-minus" label={tt('Delete column', 'حذف العمود')} onClick={A.tDelCol} />
          </Grp>
          <Grp title={tt('Cells', 'الخلايا')}>
            <B icon="ed-merge" label={tt('Merge with the next cell', 'دمج مع الخلية التالية')} onClick={A.tMerge} />
            <B icon="ed-split" label={tt('Split merged cell', 'فصل الخلية المدمجة')} onClick={A.tSplit} />
            <ColorBtn icon="ed-fill" label={tt('Cell shading', 'تظليل الخلية')} onPick={(c) => A.tShade(c)} noneLabel={tt('No shading', 'بدون تظليل')} />
            <B icon="ed-valign-top" label={tt('Align top', 'محاذاة للأعلى')} onClick={() => A.tValign('top')} />
            <B icon="ed-valign-mid" label={tt('Align middle', 'محاذاة للوسط')} onClick={() => A.tValign('middle')} />
            <B icon="ed-valign-bottom" label={tt('Align bottom', 'محاذاة للأسفل')} onClick={() => A.tValign('bottom')} />
          </Grp>
          <Grp title={tt('Table', 'الجدول')}>
            <B icon="ed-outline" label={tt('Show / hide borders', 'إظهار / إخفاء الحدود')} onClick={A.tBorders} />
            <B icon="ed-table-del" label={tt('Delete table', 'حذف الجدول')} onClick={A.tDel} />
          </Grp>
        </>}

        {cur === 'picture' && S.imgSel && <>
          <Grp title={tt('Size', 'الحجم')}>
            <NumField value={S.imgSel.w} step={10} min={10} width={64} title={tt('Width (px)', 'العرض (بكسل)')} onCommit={A.imgWidth} />
            <B icon="ed-minus" label={tt('Smaller', 'أصغر')} onClick={() => A.imgWidth(S.imgSel.w * 0.9)} />
            <B icon="plus" label={tt('Larger', 'أكبر')} onClick={() => A.imgWidth(S.imgSel.w * 1.1)} />
          </Grp>
          <Grp title={tt('Position', 'الموضع')}>
            <B icon="ed-align-left" label={tt('Align left', 'محاذاة لليسار')} onClick={() => A.align('left')} />
            <B icon="ed-align-center" label={tt('Centre', 'توسيط')} onClick={() => A.align('center')} />
            <B icon="ed-align-right" label={tt('Align right', 'محاذاة لليمين')} onClick={() => A.align('right')} />
          </Grp>
          <Grp title={tt('Picture', 'الصورة')}><B icon="trash" label={tt('Delete picture', 'حذف الصورة')} onClick={A.imgDel} /></Grp>
        </>}
      </div>
    </div>
  );
}
