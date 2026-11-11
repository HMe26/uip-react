import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import SxIcon from './SheetIcons';
import { NUM_FORMATS } from '../../lib/sheet/format.js';
import { THEME_LIST } from '../../lib/sheet/themes.js';
import { FUNCS } from '../../lib/sheet/funcs.js';
import { HILITE, SCALES, BARS } from '../../lib/sheet/cf.js';
import { CHART_TYPES } from '../../lib/sheet/chart.js';
import { ChartGlyph } from './SheetCfCharts';
import { CELL_STYLES, TABLE_STYLES, SWATCH_THEME, SWATCH_STD, FN_CATS } from '../../lib/sheet/presets.js';

export const FONTS = ['Calibri', 'Arial', 'Times New Roman', 'Courier New', 'Tahoma', 'Verdana', 'Segoe UI', 'Georgia', 'Cairo', 'Noto Sans Arabic'];
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

/* ---------------------------------------------------------------- primitives */
function useOutside(ref, close) {
  useEffect(() => { const h = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); }; window.addEventListener('pointerdown', h, true); return () => window.removeEventListener('pointerdown', h, true); }, [ref, close]);
}
const Glyph = ({ icon, sicon, size = 18 }) => (sicon ? <SxIcon name={sicon} size={size} /> : icon ? <Icon name={icon} size={size} /> : null);

/** Small button: icon and/or label. */
const SB = ({ icon, sicon, label, title, on, onClick, disabled, size = 17, className = '', children }) => (
  <button type="button" className={`sx__rb${on ? ' is-on' : ''}${label ? ' has-l' : ''} ${className}`} title={title || label} aria-label={title || label} aria-pressed={on === undefined ? undefined : !!on} disabled={disabled} onClick={onClick}>
    <Glyph icon={icon} sicon={sicon} size={size} />{label && <span>{label}</span>}{children}
  </button>
);
/** Large button: icon on top, label below (Excel's big commands). */
const LB = ({ icon, sicon, label, title, on, onClick, disabled, caret, className = '' }) => (
  <button type="button" className={`sx__lb${on ? ' is-on' : ''} ${className}`} title={title || label} aria-label={title || label} aria-pressed={on === undefined ? undefined : !!on} disabled={disabled} onClick={onClick}>
    <Glyph icon={icon} sicon={sicon} size={26} /><span>{label}{caret ? <SxIcon name="chevron" size={10} className="sx__car" /> : null}</span>
  </button>
);

/** Dropdown: `trigger` is rendered by the caller (so it can be a large or a small button). */
function Drop({ trigger, children, wide, cls = '', align }) {
  const [open, setOpen] = useState(false); const ref = useRef(null); const popRef = useRef(null); const [flip, setFlip] = useState(false);
  useOutside(ref, () => setOpen(false));
  useLayoutEffect(() => {
    if (!open) { setFlip(false); return; }
    const p = popRef.current; const root = ref.current?.closest('.sx'); if (!p || !root) return;
    const pr = p.getBoundingClientRect(); const rr = root.getBoundingClientRect();
    if (pr.right > rr.right - 4) setFlip(true);
  }, [open]);
  useEffect(() => { if (!open) return undefined; const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }; window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true); }, [open]);
  return (
    <div className={`sx__drop ${cls}`} ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && <div ref={popRef} className={`sx__pop${wide ? ' sx__pop--wide' : ''}${flip || align === 'end' ? ' is-end' : ''}`} role="menu" onClick={(e) => { if (!e.target.closest('input,label.sx__swn')) setOpen(false); }}>{children}</div>}
    </div>
  );
}
const DropL = ({ icon, sicon, label, title, disabled, wide, children, large }) => (
  <Drop wide={wide} trigger={({ open, toggle }) => (large
    ? <LB icon={icon} sicon={sicon} label={label} title={title} caret on={open} onClick={toggle} disabled={disabled} />
    : <SB icon={icon} sicon={sicon} label={label} title={title} on={open || undefined} onClick={toggle} disabled={disabled}><SxIcon name="chevron" size={10} className="sx__car" /></SB>)}>{children}</Drop>
);
const Item = ({ children, onClick, disabled, icon, sicon, hint, on }) => (
  <button type="button" role="menuitem" className={`sx__it${on ? ' is-on' : ''}`} disabled={disabled} onClick={onClick}>
    <span className="sx__iti">{(icon || sicon) && <Glyph icon={icon} sicon={sicon} size={16} />}</span><span className="sx__itl">{children}</span>{hint && <kbd>{hint}</kbd>}{on && <b>✓</b>}
  </button>
);
const Sep = () => <div className="sx__msep" role="separator" />;
const Head = ({ children }) => <div className="sx__thh">{children}</div>;

function Colors({ value, onPick, tt, none }) {
  return (
    <div className="sx__sw">
      {none && <button type="button" className="sx__swn" onClick={() => onPick(null)}>{none}</button>}
      <div className="sx__thh">{tt('Theme colors', 'ألوان السمة')}</div>
      <div className="sx__swg">{SWATCH_THEME.flat().map((c, i) => <button key={`${c}${i}`} type="button" className={`sx__swc${value === c ? ' is-on' : ''}`} style={{ background: c }} title={c} aria-label={c} onClick={() => onPick(c)} />)}</div>
      <div className="sx__thh">{tt('Standard colors', 'ألوان قياسية')}</div>
      <div className="sx__swg">{SWATCH_STD.map((c) => <button key={c} type="button" className={`sx__swc${value === c ? ' is-on' : ''}`} style={{ background: c }} title={c} aria-label={c} onClick={() => onPick(c)} />)}</div>
      <label className="sx__swn">{tt('More colors…', 'ألوان أخرى…')}<input type="color" value={value || '#000000'} onChange={(e) => onPick(e.target.value)} /></label>
    </div>
  );
}

/** Themed dropdown (font / size / number format): keyboard friendly, fonts previewed in their own face. */
function Pick({ value, label, options, onPick, aria, cls = '', preview }) {
  const [open, setOpen] = useState(false); const [hi, setHi] = useState(0); const ref = useRef(null); const listRef = useRef(null);
  useOutside(ref, () => setOpen(false));
  const idx = options.findIndex((o) => o.value === value);
  useEffect(() => { if (open) { setHi(Math.max(0, idx)); requestAnimationFrame(() => listRef.current?.querySelector('.is-on')?.scrollIntoView?.({ block: 'nearest' })); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) listRef.current?.children[hi]?.scrollIntoView?.({ block: 'nearest' }); }, [hi, open]);
  const choose = (o) => { setOpen(false); onPick(o.value); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setHi((h) => Math.min(options.length - 1, h + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); if (!open) setOpen(true); else setHi((h) => Math.max(0, h - 1)); } else if (e.key === 'Enter' && open) { e.preventDefault(); choose(options[hi]); } else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
  };
  return (
    <div className={`sx__pick ${cls}`} ref={ref} onKeyDown={onKey}>
      <button type="button" className="sx__pickb" aria-label={aria} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span style={preview ? { fontFamily: `"${label}", Calibri, sans-serif` } : undefined}>{label}</span><SxIcon name="chevron" size={11} />
      </button>
      {open && (
        <div className="sx__pickl" role="listbox" ref={listRef}>
          {options.map((o, i) => (
            <button key={String(o.value)} type="button" role="option" aria-selected={i === idx} className={`sx__pico${i === idx ? ' is-on' : ''}${i === hi ? ' is-hi' : ''}`} style={preview ? { fontFamily: `"${o.label}", Calibri, sans-serif` } : undefined} onMouseEnter={() => setHi(i)} onClick={() => choose(o)}>
              <span>{o.label}</span>{i === idx && <b aria-hidden="true">✓</b>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One ribbon group: content + caption underneath (like Excel). */
const Grp = ({ label, children, cls = '' }) => (
  <div className={`sx__grp ${cls}`} role="group" aria-label={label}><div className="sx__gb">{children}</div><div className="sx__gl">{label}</div></div>
);
const Col = ({ children }) => <div className="sx__col">{children}</div>;
const Row = ({ children }) => <div className="sx__row">{children}</div>;

const decimals = (nf, d) => {
  const code = !nf || nf === 'General' ? '0' : nf; const m = /^(.*?)(0)(\.(0*))?(.*)$/.exec(code.split(';')[0]); if (!m) return nf;
  const cur = m[4] ? m[4].length : 0; const next = Math.max(0, Math.min(15, cur + d)); if (!nf || nf === 'General') { if (d < 0) return nf; }
  return `${m[1]}0${next ? `.${'0'.repeat(next)}` : ''}${m[5]}`;
};

/* ---------------------------------------------------------------- galleries */
function CfMenu({ A, tt }) {
  const dlg = (kind, preset) => () => A.openDialog('cfrule', { kind, preset });
  const hl = HILITE[0].fmt;
  return (
    <div className="sx__cfm">
      <Head>{tt('Highlight Cells Rules', 'قواعد تمييز الخلايا')}</Head>
      <Item onClick={dlg('cell', { op: 'gt' })}>{tt('Greater Than…', 'أكبر من…')}</Item>
      <Item onClick={dlg('cell', { op: 'lt' })}>{tt('Less Than…', 'أصغر من…')}</Item>
      <Item onClick={dlg('cell', { op: 'btw' })}>{tt('Between…', 'بين…')}</Item>
      <Item onClick={dlg('cell', { op: 'eq' })}>{tt('Equal To…', 'يساوي…')}</Item>
      <Item onClick={dlg('text', { tmode: 'contains' })}>{tt('Text that Contains…', 'نص يحتوي على…')}</Item>
      <Item onClick={() => A.cfPreset('dup', {}, hl)}>{tt('Duplicate Values', 'القيم المكررة')}</Item>
      <Sep />
      <Head>{tt('Top / Bottom Rules', 'قواعد الأعلى / الأدنى')}</Head>
      <Item onClick={dlg('top', { bottom: false, n: 10 })}>{tt('Top 10 Items…', 'أعلى 10 عناصر…')}</Item>
      <Item onClick={dlg('top', { bottom: true, n: 10 })}>{tt('Bottom 10 Items…', 'أدنى 10 عناصر…')}</Item>
      <Item onClick={() => A.cfPreset('avg', { below: false }, HILITE[2].fmt)}>{tt('Above Average', 'أعلى من المتوسط')}</Item>
      <Item onClick={() => A.cfPreset('avg', { below: true }, hl)}>{tt('Below Average', 'أقل من المتوسط')}</Item>
      <Sep />
      <Head>{tt('Data Bars', 'أشرطة البيانات')}</Head>
      <div className="sx__galg">{BARS.map((b) => <button type="button" key={b.id} className="sx__tile sx__tile--cf" title={tt(b.en, b.ar)} onClick={() => A.cfPreset('bar', { color: b.color })} style={{ background: `linear-gradient(90deg,${b.color} 65%,#fff 65%)` }} />)}</div>
      <Head>{tt('Color Scales', 'التدرجات اللونية')}</Head>
      <div className="sx__galg">{SCALES.map((c) => <button type="button" key={c.id} className="sx__tile sx__tile--cf" title={tt(c.en, c.ar)} onClick={() => A.cfPreset('scale', { colors: c.colors })} style={{ background: `linear-gradient(180deg,${c.colors.join(',')})` }} />)}</div>
      <Sep />
      <Item onClick={dlg('cell', {})}>{tt('New Rule…', 'قاعدة جديدة…')}</Item>
      <Item onClick={() => A.cfClear('sel')}>{tt('Clear Rules from Selected Cells', 'مسح القواعد من الخلايا المحددة')}</Item>
      <Item onClick={() => A.cfClear('sheet')}>{tt('Clear Rules from Entire Sheet', 'مسح القواعد من الورقة كلها')}</Item>
      <Item onClick={() => A.openDialog('cfmanage')}>{tt('Manage Rules…', 'إدارة القواعد…')}</Item>
    </div>
  );
}
function ChartMenu({ A, tt }) {
  return <div>{CHART_TYPES.map((t) => <button type="button" role="menuitem" key={t.id} className="sx__it" onClick={() => A.chartInsert(t.id)}><span className="sx__iti"><ChartGlyph type={t.id} size={20} /></span><span className="sx__itl">{tt(t.en, t.ar)}</span></button>)}</div>;
}
const FilterItems = ({ A, tt }) => (
  <>
    <Item sicon="filter" on={!!A.sheet.filter} onClick={A.filterToggle} hint="Ctrl+Shift+L">{tt('Filter', 'تصفية')}</Item>
    <Item onClick={A.filterClearAll} disabled={!A.sheet.filter}>{tt('Clear', 'مسح')}</Item>
    <Item onClick={A.filterReapply} disabled={!A.sheet.filter}>{tt('Reapply', 'إعادة تطبيق')}</Item>
  </>
);
function StyleGallery({ A, tt }) {
  return (
    <div className="sx__gal">
      <Head>{tt('Good, Bad and Neutral', 'جيد وسيئ ومحايد')}</Head>
      <div className="sx__galg">{CELL_STYLES.slice(0, 4).map((s) => <Tile key={s.id} s={s} A={A} tt={tt} />)}</div>
      <Head>{tt('Data and Model', 'البيانات والنموذج')}</Head>
      <div className="sx__galg">{CELL_STYLES.slice(4, 10).map((s) => <Tile key={s.id} s={s} A={A} tt={tt} />)}</div>
      <Head>{tt('Titles and Headings', 'العناوين')}</Head>
      <div className="sx__galg">{CELL_STYLES.slice(10, 15).map((s) => <Tile key={s.id} s={s} A={A} tt={tt} />)}</div>
      <Head>{tt('Number Format', 'تنسيق الأرقام')}</Head>
      <div className="sx__galg">{CELL_STYLES.slice(15).map((s) => <Tile key={s.id} s={s} A={A} tt={tt} />)}</div>
    </div>
  );
}
const Tile = ({ s, A, tt }) => {
  const p = s.patch;
  return <button type="button" className="sx__tile" onClick={() => A.cellStyle(s)} style={{ background: p.bg || undefined, color: p.color || undefined, fontWeight: p.b ? 700 : undefined, fontStyle: p.i ? 'italic' : undefined, fontSize: p.fs ? Math.min(15, p.fs) : undefined, borderBottom: p.bd?.b ? `2px solid ${p.bd.b[1]}` : undefined }}>{tt(s.en, s.ar)}</button>;
};
function TableGallery({ A, tt }) {
  return (
    <div className="sx__gal">
      <Head>{tt('Table styles', 'أنماط الجدول')}</Head>
      <div className="sx__galt">
        {TABLE_STYLES.map((t) => (
          <button type="button" key={t.id} className="sx__tbl" title={tt(t.en, t.ar)} aria-label={tt(t.en, t.ar)} onClick={() => A.tableStyle(t)}>
            <i style={{ background: t.head || '#ffffff', borderBottom: `2px solid ${t.line}` }} /><i style={{ background: '#fff' }} /><i style={{ background: t.band || '#fff' }} /><i style={{ background: '#fff' }} />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the ribbon */
export default function SheetRibbon({ A, tt, state, collapsed, setCollapsed, tab, setTab }) {
  const { ast, canUndo, canRedo } = state;
  const [lastFill, setLastFill] = useState('#ffff00'); const [lastFont, setLastFont] = useState('#ff0000');
  const nf = ast.nf || 'General';
  const cur = NUM_FORMATS.find((f) => f.code === nf);
  const sz = ast.fs || 10.5;
  const TABS = [['home', 'Home', 'الرئيسية'], ['insert', 'Insert', 'إدراج'], ['layout', 'Page Layout', 'تخطيط الصفحة'], ['formulas', 'Formulas', 'الصيغ'], ['data', 'Data', 'البيانات'], ['view', 'View', 'عرض'], ['help', 'Help', 'مساعدة']];
  const hasSel = A.sel.r1 !== A.sel.r2 || A.sel.c1 !== A.sel.c2;

  const home = (
    <>
      <Grp label={tt('Clipboard', 'الحافظة')}>
        <div className="sx__split">
          <LB sicon="paste" label={tt('Paste', 'لصق')} title={`${tt('Paste', 'لصق')} (Ctrl+V)`} onClick={() => A.paste('all')} />
          <DropL title={tt('Paste options', 'خيارات اللصق')} sicon={null}>
            <Item onClick={() => A.paste('all')}>{tt('Paste', 'لصق')}</Item><Item onClick={() => A.paste('values')}>{tt('Values', 'القيم')}</Item><Item onClick={() => A.paste('formulas')}>{tt('Formulas', 'الصيغ')}</Item><Item onClick={() => A.paste('formats')}>{tt('Formatting', 'التنسيق')}</Item>
          </DropL>
        </div>
        <Col>
          <SB sicon="cut" label={tt('Cut', 'قص')} title={`${tt('Cut', 'قص')} (Ctrl+X)`} onClick={() => A.copy(true)} />
          <SB sicon="copy" label={tt('Copy', 'نسخ')} title={`${tt('Copy', 'نسخ')} (Ctrl+C)`} onClick={() => A.copy(false)} />
          <SB sicon="painter" label={tt('Format Painter', 'ناسخ التنسيق')} on={A.painter} onClick={A.togglePainter} />
        </Col>
      </Grp>
      <Grp label={tt('Font', 'الخط')}>
        <Col>
          <Row>
            <Pick cls="sx__pick--f" aria={tt('Font', 'الخط')} preview value={ast.font || 'Calibri'} label={ast.font || 'Calibri'} options={FONTS.map((f) => ({ value: f, label: f }))} onPick={(v) => A.style({ font: v === 'Calibri' ? null : v })} />
            <Pick cls="sx__pick--s" aria={tt('Font size', 'حجم الخط')} value={sz} label={String(sz)} options={SIZES.map((x) => ({ value: x, label: String(x) }))} onPick={(v) => A.style({ fs: +v === 10.5 ? null : +v })} />
            <SB sicon="growfont" title={tt('Increase font size', 'تكبير الخط')} onClick={() => A.style({ fs: Math.min(72, (ast.fs || 10.5) + 1) })} />
            <SB sicon="shrinkfont" title={tt('Decrease font size', 'تصغير الخط')} onClick={() => A.style({ fs: Math.max(6, (ast.fs || 10.5) - 1) })} />
          </Row>
          <Row>
            <SB icon="ed-bold" title={tt('Bold (Ctrl+B)', 'غامق (Ctrl+B)')} on={!!ast.b} onClick={() => A.toggle('b')} />
            <SB icon="ed-italic" title={tt('Italic (Ctrl+I)', 'مائل (Ctrl+I)')} on={!!ast.i} onClick={() => A.toggle('i')} />
            <SB icon="ed-underline" title={tt('Underline (Ctrl+U)', 'تسطير (Ctrl+U)')} on={!!ast.u} onClick={() => A.toggle('u')} />
            <SB icon="ed-strike" title={tt('Strikethrough (Ctrl+5)', 'يتوسطه خط (Ctrl+5)')} on={!!ast.st} onClick={() => A.toggle('st')} />
            <span className="sx__vsep" />
            <Drop trigger={({ open, toggle }) => <SB icon="ed-outline" title={tt('Borders', 'الحدود')} on={open || undefined} onClick={toggle}><SxIcon name="chevron" size={10} className="sx__car" /></SB>}>
              <Item onClick={() => A.borders('bottom')}>{tt('Bottom Border', 'حد سفلي')}</Item><Item onClick={() => A.borders('top')}>{tt('Top Border', 'حد علوي')}</Item><Item onClick={() => A.borders('left')}>{tt('Left Border', 'حد أيسر')}</Item><Item onClick={() => A.borders('right')}>{tt('Right Border', 'حد أيمن')}</Item><Sep />
              <Item onClick={() => A.borders('none')}>{tt('No Border', 'بدون حدود')}</Item><Item onClick={() => A.borders('all')}>{tt('All Borders', 'كل الحدود')}</Item><Item onClick={() => A.borders('outer')} hint="Ctrl+Shift+7">{tt('Outside Borders', 'حدود خارجية')}</Item><Item onClick={() => A.borders('thickBox')}>{tt('Thick Outside Borders', 'حدود خارجية سميكة')}</Item><Item onClick={() => A.borders('inner')}>{tt('Inside Borders', 'حدود داخلية')}</Item><Sep />
              <Item onClick={() => A.openDialog('format', { tab: 'border' })}>{tt('More Borders…', 'المزيد من الحدود…')}</Item>
            </Drop>
            <div className="sx__split sx__split--c">
              <SB icon="ed-fill" title={tt('Fill color', 'لون التعبئة')} onClick={() => A.style({ bg: lastFill })}><i className="sx__cbar" style={{ background: lastFill }} /></SB>
              <DropL title={tt('Fill color options', 'خيارات لون التعبئة')}><Colors value={ast.bg} tt={tt} none={tt('No Fill', 'بدون تعبئة')} onPick={(c) => { if (c) setLastFill(c); A.style({ bg: c }); }} /></DropL>
            </div>
            <div className="sx__split sx__split--c">
              <SB icon="ed-font-color" title={tt('Font color', 'لون الخط')} onClick={() => A.style({ color: lastFont })}><i className="sx__cbar" style={{ background: lastFont }} /></SB>
              <DropL title={tt('Font color options', 'خيارات لون الخط')}><Colors value={ast.color} tt={tt} none={tt('Automatic', 'تلقائي')} onPick={(c) => { if (c) setLastFont(c); A.style({ color: c }); }} /></DropL>
            </div>
          </Row>
        </Col>
        <button type="button" className="sx__dlg" title={tt('Format Cells (Ctrl+1)', 'تنسيق الخلايا (Ctrl+1)')} aria-label={tt('Format Cells', 'تنسيق الخلايا')} onClick={() => A.openDialog('format', { tab: 'font' })} />
      </Grp>
      <Grp label={tt('Alignment', 'المحاذاة')}>
        <Col>
          <Row>
            <SB icon="ed-valign-top" title={tt('Top align', 'محاذاة علوية')} on={ast.va === 'top'} onClick={() => A.style({ va: ast.va === 'top' ? null : 'top' })} />
            <SB icon="ed-valign-mid" title={tt('Middle align', 'محاذاة وسطية')} on={ast.va === 'center'} onClick={() => A.style({ va: ast.va === 'center' ? null : 'center' })} />
            <SB icon="ed-valign-bottom" title={tt('Bottom align', 'محاذاة سفلية')} on={!ast.va || ast.va === 'bottom'} onClick={() => A.style({ va: null })} />
            <span className="sx__vsep" />
            <SB sicon="wrap" label={tt('Wrap Text', 'التفاف النص')} on={!!ast.wrap} onClick={() => A.toggle('wrap')} />
          </Row>
          <Row>
            <SB icon="ed-align-left" title={tt('Align left', 'محاذاة لليسار')} on={ast.al === 'left'} onClick={() => A.style({ al: ast.al === 'left' ? null : 'left' })} />
            <SB icon="ed-align-center" title={tt('Center', 'توسيط')} on={ast.al === 'center'} onClick={() => A.style({ al: ast.al === 'center' ? null : 'center' })} />
            <SB icon="ed-align-right" title={tt('Align right', 'محاذاة لليمين')} on={ast.al === 'right'} onClick={() => A.style({ al: ast.al === 'right' ? null : 'right' })} />
            <span className="sx__vsep" />
            <SB icon="ed-outdent" title={tt('Decrease indent', 'تقليل المسافة البادئة')} onClick={() => A.style({ ind: Math.max(0, (ast.ind || 0) - 1) || null })} />
            <SB icon="ed-indent" title={tt('Increase indent', 'زيادة المسافة البادئة')} onClick={() => A.style({ ind: (ast.ind || 0) + 1, al: ast.al || 'left' })} />
            <DropL icon="ed-merge" label={tt('Merge & Center', 'دمج وتوسيط')}>
              <Item onClick={() => { A.merge(true); A.style({ al: 'center' }); }} icon="ed-merge">{tt('Merge & Center', 'دمج وتوسيط')}</Item><Item onClick={() => A.merge(true)}>{tt('Merge Cells', 'دمج الخلايا')}</Item><Item onClick={() => A.merge(false)} icon="ed-split">{tt('Unmerge Cells', 'إلغاء دمج الخلايا')}</Item>
            </DropL>
          </Row>
        </Col>
        <button type="button" className="sx__dlg" title={tt('Format Cells (Ctrl+1)', 'تنسيق الخلايا (Ctrl+1)')} aria-label={tt('Format Cells', 'تنسيق الخلايا')} onClick={() => A.openDialog('format', { tab: 'align' })} />
      </Grp>
      <Grp label={tt('Number', 'الرقم')}>
        <Col>
          <Row>
            <Pick cls="sx__pick--n" aria={tt('Number format', 'تنسيق الرقم')} value={cur ? cur.id : 'custom'} label={cur ? tt(cur.en, cur.ar) : nf} options={[...(cur ? [] : [{ value: 'custom', label: nf }]), ...NUM_FORMATS.map((f) => ({ value: f.id, label: tt(f.en, f.ar) }))]} onPick={(v) => { const f = NUM_FORMATS.find((x) => x.id === v); if (f) A.style({ nf: f.code === 'General' ? null : f.code }); }} />
          </Row>
          <Row>
            <SB label="$" title={`${tt('Currency', 'عملة')} (Ctrl+Shift+4)`} onClick={() => A.style({ nf: '"$"#,##0.00' })} />
            <SB label="%" title={`${tt('Percent', 'نسبة مئوية')} (Ctrl+Shift+5)`} onClick={() => A.style({ nf: '0%' })} />
            <SB label="," title={tt('Comma style', 'نمط الفاصلة')} onClick={() => A.style({ nf: '#,##0.00' })} />
            <SB label=".0→" title={tt('Increase decimals', 'زيادة الكسور العشرية')} onClick={() => A.style({ nf: decimals(ast.nf, 1) })} />
            <SB label="←.0" title={tt('Decrease decimals', 'تقليل الكسور العشرية')} onClick={() => A.style({ nf: decimals(ast.nf, -1) })} />
          </Row>
        </Col>
        <button type="button" className="sx__dlg" title={tt('Format Cells (Ctrl+1)', 'تنسيق الخلايا (Ctrl+1)')} aria-label={tt('Format Cells', 'تنسيق الخلايا')} onClick={() => A.openDialog('format', { tab: 'number' })} />
      </Grp>
      <Grp label={tt('Styles', 'الأنماط')}>
        <DropL large sicon="cf" label={tt('Conditional Formatting', 'تنسيق شرطي')} wide><CfMenu A={A} tt={tt} /></DropL>
        <DropL large sicon="table" label={tt('Format as Table', 'تنسيق كجدول')} wide><TableGallery A={A} tt={tt} /></DropL>
        <DropL large sicon="styles" label={tt('Cell Styles', 'أنماط الخلايا')} wide><StyleGallery A={A} tt={tt} /></DropL>
      </Grp>
      <Grp label={tt('Cells', 'الخلايا')}>
        <Col>
          <DropL icon="ed-row-plus" label={tt('Insert', 'إدراج')}><Item icon="ed-row-plus" onClick={A.insertRows}>{tt('Insert Sheet Rows', 'إدراج صفوف')}</Item><Item icon="ed-col-plus" onClick={A.insertCols}>{tt('Insert Sheet Columns', 'إدراج أعمدة')}</Item><Item sicon="sheetplus" onClick={A.newSheet}>{tt('Insert Sheet', 'إدراج ورقة')}</Item></DropL>
          <DropL icon="ed-row-minus" label={tt('Delete', 'حذف')}><Item icon="ed-row-minus" onClick={A.deleteRows}>{tt('Delete Sheet Rows', 'حذف صفوف')}</Item><Item icon="ed-col-minus" onClick={A.deleteCols}>{tt('Delete Sheet Columns', 'حذف أعمدة')}</Item><Item onClick={A.deleteSheet} disabled={A.wb.sheets.length < 2}>{tt('Delete Sheet', 'حذف الورقة')}</Item></DropL>
          <DropL icon="ed-sliders" label={tt('Format', 'تنسيق')}>
            <Head>{tt('Cell Size', 'حجم الخلية')}</Head>
            <Item onClick={A.askRowH}>{tt('Row Height…', 'ارتفاع الصف…')}</Item><Item onClick={() => A.autofit('r', A.sel.r1)}>{tt('AutoFit Row Height', 'ضبط ارتفاع الصف تلقائيًا')}</Item>
            <Item onClick={A.askColW}>{tt('Column Width…', 'عرض العمود…')}</Item><Item onClick={() => A.autofit('c', A.sel.c1)}>{tt('AutoFit Column Width', 'ضبط عرض العمود تلقائيًا')}</Item><Sep />
            <Item onClick={() => A.hide('r', true)} hint="Ctrl+9">{tt('Hide Rows', 'إخفاء الصفوف')}</Item><Item onClick={() => A.hide('c', true)} hint="Ctrl+0">{tt('Hide Columns', 'إخفاء الأعمدة')}</Item><Item onClick={A.unhideAll}>{tt('Unhide All', 'إظهار الكل')}</Item><Sep />
            <Item onClick={A.renameSheet}>{tt('Rename Sheet…', 'إعادة تسمية الورقة…')}</Item><Item onClick={() => A.openDialog('format')} hint="Ctrl+1">{tt('Format Cells…', 'تنسيق الخلايا…')}</Item>
          </DropL>
        </Col>
      </Grp>
      <Grp label={tt('Editing', 'التحرير')}>
        <Col>
          <Drop trigger={({ open, toggle }) => <div className="sx__split sx__split--h"><SB sicon="sum" label={tt('AutoSum', 'جمع تلقائي')} title="AutoSum (Alt+=)" onClick={() => A.autoFn('SUM')} /><SB title={tt('AutoSum options', 'خيارات الجمع')} on={open || undefined} onClick={toggle}><SxIcon name="chevron" size={10} className="sx__car" /></SB></div>}>
            <Item onClick={() => A.autoFn('SUM')} hint="Alt+=">{tt('Sum', 'المجموع')}</Item><Item onClick={() => A.autoFn('AVERAGE')}>{tt('Average', 'المتوسط')}</Item><Item onClick={() => A.autoFn('COUNT')}>{tt('Count Numbers', 'عدّ الأرقام')}</Item><Item onClick={() => A.autoFn('MAX')}>{tt('Max', 'الأكبر')}</Item><Item onClick={() => A.autoFn('MIN')}>{tt('Min', 'الأصغر')}</Item><Sep />
            <Item onClick={() => A.openDialog('insertfn')}>{tt('More Functions…', 'دوال أخرى…')}</Item>
          </Drop>
          <DropL sicon="filldown" label={tt('Fill', 'تعبئة')}><Item sicon="filldown" onClick={A.fillDown} hint="Ctrl+D">{tt('Down', 'لأسفل')}</Item><Item sicon="fillright" onClick={A.fillRight} hint="Ctrl+R">{tt('Right', 'لليمين')}</Item></DropL>
          <DropL icon="ed-clear" label={tt('Clear', 'مسح')}><Item onClick={() => A.clear('all')}>{tt('Clear All', 'مسح الكل')}</Item><Item onClick={() => A.clear('formats')}>{tt('Clear Formats', 'مسح التنسيقات')}</Item><Item onClick={() => A.clear('contents')} hint="Del">{tt('Clear Contents', 'مسح المحتويات')}</Item></DropL>
        </Col>
        <DropL large sicon="sortaz" label={tt('Sort & Filter', 'ترتيب وتصفية')}><Item sicon="sortaz" onClick={() => A.sort(true)}>{tt('Sort A to Z', 'ترتيب تصاعدي')}</Item><Item sicon="sortza" onClick={() => A.sort(false)}>{tt('Sort Z to A', 'ترتيب تنازلي')}</Item><Sep /><FilterItems A={A} tt={tt} /></DropL>
        <DropL large icon="ed-find" label={tt('Find & Select', 'بحث وتحديد')}><Item icon="ed-find" onClick={() => A.openFind(false)} hint="Ctrl+F">{tt('Find…', 'بحث…')}</Item><Item onClick={() => A.openFind(true)} hint="Ctrl+H">{tt('Replace…', 'استبدال…')}</Item><Item sicon="goto" onClick={() => A.openDialog('goto')} hint="Ctrl+G">{tt('Go To…', 'اذهب إلى…')}</Item><Sep /><Item onClick={A.selectAll} hint="Ctrl+A">{tt('Select All', 'تحديد الكل')}</Item></DropL>
      </Grp>
    </>
  );

  const insert = (
    <>
      <Grp label={tt('Tables', 'الجداول')}><DropL large sicon="table" label={tt('Table', 'جدول')} wide><TableGallery A={A} tt={tt} /></DropL></Grp>
      <Grp label={tt('Charts', 'الرسوم البيانية')}><DropL large sicon="chart" label={tt('Chart', 'رسم بياني')}><ChartMenu A={A} tt={tt} /></DropL></Grp>
      <Grp label={tt('Sheet', 'الورقة')}>
        <LB sicon="sheetplus" label={tt('New Sheet', 'ورقة جديدة')} title="Shift+F11" onClick={A.newSheet} />
        <LB icon="ed-row-plus" label={tt('Rows', 'صفوف')} onClick={A.insertRows} />
        <LB icon="ed-col-plus" label={tt('Columns', 'أعمدة')} onClick={A.insertCols} />
      </Grp>
      <Grp label={tt('Functions', 'الدوال')}>
        <LB sicon="fx" label={tt('Insert Function', 'إدراج دالة')} title="Shift+F3" onClick={() => A.openDialog('insertfn')} />
        <LB sicon="sum" label={tt('AutoSum', 'جمع تلقائي')} title="Alt+=" onClick={() => A.autoFn('SUM')} />
      </Grp>
      <Grp label={tt('Date & Time', 'التاريخ والوقت')}>
        <LB sicon="calendar" label={tt('Today', 'تاريخ اليوم')} title="Ctrl+;" onClick={() => A.stamp(false)} />
        <LB sicon="clock" label={tt('Time', 'الوقت')} title="Ctrl+Shift+;" onClick={() => A.stamp(true)} />
      </Grp>
      <Grp label={tt('Names', 'الأسماء')}><LB sicon="names" label={tt('Define Name', 'تعريف اسم')} onClick={A.askName} /></Grp>
    </>
  );

  const layout = (
    <>
      <Grp label={tt('Themes', 'السمات')}>
        <Drop wide trigger={({ open, toggle }) => <LB icon="palette" label={tt('Theme', 'السمة')} caret on={open} onClick={toggle} />}>
          <div className="sx__themes">{['excel', 'code'].map((g) => <div key={g}><Head>{g === 'excel' ? tt('Excel styles', 'ستايلات إكسل') : tt('Code editor themes', 'ثيمات محرر الأكواد')}</Head>{THEME_LIST.filter((t) => t.group === g).map((t) => <button key={t.id} type="button" className={`sx__it sx__th${A.theme === t.id ? ' is-on' : ''}`} onClick={() => A.setTheme(t.id)}><span className="sx__sws">{t.swatch.map((c, i) => <i key={i} style={{ background: c }} />)}</span>{tt(t.en, t.ar)}{A.theme === t.id && <b>✓</b>}</button>)}</div>)}</div>
        </Drop>
      </Grp>
      <Grp label={tt('Page Setup', 'إعداد الصفحة')}>
        <DropL large sicon={A.view.land ? 'landscape' : 'portrait'} label={tt('Orientation', 'الاتجاه')}><Item sicon="portrait" on={!A.view.land} onClick={() => A.setView({ land: false })}>{tt('Portrait', 'طولي')}</Item><Item sicon="landscape" on={!!A.view.land} onClick={() => A.setView({ land: true })}>{tt('Landscape', 'عرضي')}</Item></DropL>
        <LB sicon="print" label={tt('Print', 'طباعة')} title="Ctrl+P" onClick={A.print} />
      </Grp>
      <Grp label={tt('Sheet Options', 'خيارات الورقة')}>
        <Col>
          <label className="sx__chk"><input type="checkbox" checked={A.view.grid} onChange={() => A.setView({ grid: !A.view.grid })} />{tt('View gridlines', 'عرض خطوط الشبكة')}</label>
          <label className="sx__chk"><input type="checkbox" checked={A.view.head} onChange={() => A.setView({ head: !A.view.head })} />{tt('View headings', 'عرض العناوين')}</label>
          <label className="sx__chk"><input type="checkbox" checked={!!A.view.pgrid} onChange={() => A.setView({ pgrid: !A.view.pgrid })} />{tt('Print gridlines', 'طباعة خطوط الشبكة')}</label>
        </Col>
      </Grp>
    </>
  );

  const formulas = (
    <>
      <Grp label={tt('Function Library', 'مكتبة الدوال')}>
        <LB sicon="fx" label={tt('Insert Function', 'إدراج دالة')} title="Shift+F3" onClick={() => A.openDialog('insertfn')} />
        <DropL large sicon="sum" label={tt('AutoSum', 'جمع تلقائي')}><Item onClick={() => A.autoFn('SUM')} hint="Alt+=">{tt('Sum', 'المجموع')}</Item><Item onClick={() => A.autoFn('AVERAGE')}>{tt('Average', 'المتوسط')}</Item><Item onClick={() => A.autoFn('COUNT')}>{tt('Count Numbers', 'عدّ الأرقام')}</Item><Item onClick={() => A.autoFn('MAX')}>{tt('Max', 'الأكبر')}</Item><Item onClick={() => A.autoFn('MIN')}>{tt('Min', 'الأصغر')}</Item></DropL>
        <div className="sx__cats2">
          {FN_CATS.map((c) => (
            <DropL key={c.id} label={tt(c.en, c.ar)}>
              <div className="sx__fnl">{c.list.split(' ').filter((n) => FUNCS[n]).map((n) => <Item key={n} onClick={() => A.insertFn(n)}>{n}</Item>)}</div>
            </DropL>
          ))}
        </div>
      </Grp>
      <Grp label={tt('Defined Names', 'الأسماء المعرّفة')}>
        <LB sicon="names" label={tt('Define Name', 'تعريف اسم')} onClick={A.askName} />
        <LB sicon="goto" label={tt('Go To', 'اذهب إلى')} title="Ctrl+G" onClick={() => A.openDialog('goto')} />
      </Grp>
      <Grp label={tt('Formula Auditing', 'تدقيق الصيغ')}><LB sicon="eye" label={tt('Show Formulas', 'إظهار الصيغ')} title="Ctrl+`" on={A.view.showF} onClick={() => A.setView({ showF: !A.view.showF })} /></Grp>
      <Grp label={tt('Calculation', 'الحساب')}><LB sicon="recalc" label={tt('Calculate Now', 'احسب الآن')} title="F9" onClick={A.recalc} /></Grp>
    </>
  );

  const data = (
    <>
      <Grp label={tt('Sort', 'ترتيب')}>
        <LB sicon="sortaz" label={tt('Sort A to Z', 'تصاعدي')} onClick={() => A.sort(true)} />
        <LB sicon="sortza" label={tt('Sort Z to A', 'تنازلي')} onClick={() => A.sort(false)} />
      </Grp>
      <Grp label={tt('Filter', 'التصفية')}>
        <LB sicon="filter" label={tt('Filter', 'تصفية')} title="Ctrl+Shift+L" on={!!A.sheet.filter} onClick={A.filterToggle} />
        <LB label={tt('Clear', 'مسح')} onClick={A.filterClearAll} disabled={!A.sheet.filter} sicon="close" />
        <LB label={tt('Reapply', 'إعادة تطبيق')} onClick={A.filterReapply} disabled={!A.sheet.filter} sicon="recalc" />
      </Grp>
      <Grp label={tt('Data Tools', 'أدوات البيانات')}>
        <LB sicon="filldown" label={tt('Fill Down', 'تعبئة لأسفل')} title="Ctrl+D" onClick={A.fillDown} disabled={!hasSel} />
        <LB sicon="fillright" label={tt('Fill Right', 'تعبئة لليمين')} title="Ctrl+R" onClick={A.fillRight} disabled={!hasSel} />
        <LB icon="ed-find" label={tt('Find & Replace', 'بحث واستبدال')} title="Ctrl+H" onClick={() => A.openFind(true)} />
      </Grp>
      <Grp label={tt('Outline', 'المخطط التفصيلي')}>
        <LB sicon="hide" label={tt('Hide', 'إخفاء')} onClick={A.hideSmart} />
        <LB sicon="eye" label={tt('Unhide All', 'إظهار الكل')} onClick={A.unhideAll} />
      </Grp>
    </>
  );

  const view = (
    <>
      <Grp label={tt('Workbook Views', 'طرق عرض المصنف')}><LB sicon="grid" label={tt('Normal', 'عادي')} on onClick={() => {}} /></Grp>
      <Grp label={tt('Show', 'إظهار')}>
        <Col>
          <label className="sx__chk"><input type="checkbox" checked={A.view.bar} onChange={() => A.setView({ bar: !A.view.bar })} />{tt('Formula Bar', 'شريط الصيغة')}</label>
          <label className="sx__chk"><input type="checkbox" checked={A.view.grid} onChange={() => A.setView({ grid: !A.view.grid })} />{tt('Gridlines', 'خطوط الشبكة')}</label>
          <label className="sx__chk"><input type="checkbox" checked={A.view.head} onChange={() => A.setView({ head: !A.view.head })} />{tt('Headings', 'العناوين')}</label>
        </Col>
        <Col><label className="sx__chk"><input type="checkbox" checked={A.view.band} onChange={() => A.setView({ band: !A.view.band })} />{tt('Banded rows', 'صفوف متبادلة')}</label></Col>
      </Grp>
      <Grp label={tt('Zoom', 'التكبير')}>
        <LB sicon="zoom" label="100%" onClick={() => A.zoomTo(1)} />
        <LB sicon="zoomin" label={tt('Zoom In', 'تكبير')} onClick={() => A.zoomBy(0.1)} />
        <LB sicon="zoomout" label={tt('Zoom Out', 'تصغير')} onClick={() => A.zoomBy(-0.1)} />
        <LB sicon="grid" label={tt('Zoom to Selection', 'ملاءمة التحديد')} onClick={A.zoomSel} disabled={!hasSel} />
      </Grp>
      <Grp label={tt('Window', 'النافذة')}>
        <DropL large sicon="freeze" label={tt('Freeze Panes', 'تجميد الأجزاء')}>
          <Item onClick={() => A.freeze(A.sel.ar, A.sel.ac)}>{tt('Freeze Panes', 'تجميد الأجزاء')}</Item><Item onClick={() => A.freeze(1, 0)}>{tt('Freeze Top Row', 'تجميد الصف العلوي')}</Item><Item onClick={() => A.freeze(0, 1)}>{tt('Freeze First Column', 'تجميد العمود الأول')}</Item><Item onClick={() => A.freeze(0, 0)}>{tt('Unfreeze Panes', 'إلغاء التجميد')}</Item>
        </DropL>
      </Grp>
    </>
  );

  const help = (
    <Grp label={tt('Help', 'مساعدة')}>
      <LB sicon="keyboard" label={tt('Keyboard Shortcuts', 'اختصارات الكيبورد')} title="F1" onClick={() => A.openDialog('shortcuts')} />
    </Grp>
  );

  const body = { home, insert, layout, formulas, data, view, help }[tab] || home;

  return (
    <div className={`sx__rib${collapsed ? ' is-collapsed' : ''}`}>
      <div className="sx__tabsrow" role="tablist" aria-label={tt('Ribbon', 'الشريط')}>
        <button type="button" className="sx__filetab" onClick={() => A.openFileMenu()} aria-haspopup="dialog">{tt('File', 'ملف')}</button>
        {TABS.map(([id, en, ar]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id && !collapsed} className={tab === id && !collapsed ? 'is-on' : ''}
            onClick={() => { if (collapsed) { setTab(id); setCollapsed(false); } else setTab(id); }} onDoubleClick={() => setCollapsed(!collapsed)}>{tt(en, ar)}</button>
        ))}
        <span className="sx__sp" />
        <SB sicon="save" title={`${tt('Save', 'حفظ')} (Ctrl+S)`} onClick={A.file.save} />
        <SB icon="ed-undo" title={tt('Undo (Ctrl+Z)', 'تراجع (Ctrl+Z)')} onClick={A.undo} disabled={!canUndo} />
        <SB icon="ed-redo" title={tt('Redo (Ctrl+Y)', 'إعادة (Ctrl+Y)')} onClick={A.redo} disabled={!canRedo} />
        <SB sicon="chevron" title={collapsed ? tt('Expand the ribbon (Ctrl+F1)', 'فرد الشريط (Ctrl+F1)') : tt('Collapse the ribbon (Ctrl+F1)', 'طيّ الشريط (Ctrl+F1)')} onClick={() => setCollapsed(!collapsed)} className={collapsed ? '' : 'sx__flip'} />
      </div>
      {!collapsed && <div className="sx__tools" role="tabpanel">{body}</div>}
    </div>
  );
}
