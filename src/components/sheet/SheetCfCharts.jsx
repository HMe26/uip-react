import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from './SheetDialogs.jsx';
import SxIcon from './SheetIcons';
import { HILITE, SCALES, BARS, describe } from '../../lib/sheet/cf.js';
import { CHART_TYPES, PALETTE } from '../../lib/sheet/chart.js';
import { uniqueValues, BLANK } from '../../lib/sheet/filter.js';
import { parseRange, rangeStr } from '../../lib/sheet/addr.js';

const Btn = ({ primary, ...p }) => <button type="button" className={`sxd__btn${primary ? ' is-primary' : ''}`} {...p} />;
const OPS = [['gt', '>'], ['lt', '<'], ['ge', '≥'], ['le', '≤'], ['eq', '='], ['ne', '≠'], ['btw', 'between'], ['nbtw', 'not between']];

/* ------------------------------------------------------------------ New / edit rule */
export function CfRuleDialog({ d, A, tt, onClose }) {
  const old = d.rule || null;
  const [kind, setKind] = useState(old?.kind || d.kind || 'cell');
  const [p, setP] = useState(() => ({ op: 'gt', v1: '', v2: '', tmode: 'contains', text: '', n: 10, bottom: false, pct: false, below: false, expr: '', scaleId: 'gyr', barId: 'blue', ...(d.preset || {}), ...(old || {}) }));
  const [fmt, setFmt] = useState(old?.fmt || HILITE[0].fmt);
  const [rng, setRng] = useState(old ? rangeStr(old.rng) : rangeStr(A.range()));
  const [err, setErr] = useState('');
  const set = (k, v) => { setP((x) => ({ ...x, [k]: v })); setErr(''); };
  const needsFmt = !['scale', 'bar'].includes(kind);
  const ok = () => {
    const g = parseRange(rng.replace(/\$/g, '')); if (!g) { setErr(tt('The range is not valid.', 'النطاق غير صالح.')); return; }
    const r = { kind, rng: g };
    if (kind === 'cell') { if (String(p.v1).trim() === '') { setErr(tt('Enter a value.', 'اكتب قيمة.')); return; } Object.assign(r, { op: p.op, v1: p.v1, v2: p.v2 }); }
    if (kind === 'text') { if (!p.text) { setErr(tt('Enter the text.', 'اكتب النص.')); return; } Object.assign(r, { tmode: p.tmode, text: p.text }); }
    if (kind === 'top') Object.assign(r, { n: Math.max(1, Math.round(+p.n) || 10), bottom: !!p.bottom, pct: !!p.pct });
    if (kind === 'avg') r.below = !!p.below;
    if (kind === 'expr') { if (!String(p.expr).trim()) { setErr(tt('Enter a formula.', 'اكتب صيغة.')); return; } r.expr = p.expr; }
    if (kind === 'scale') r.colors = (SCALES.find((s) => s.id === p.scaleId) || SCALES[0]).colors;
    if (kind === 'bar') r.color = (BARS.find((s) => s.id === p.barId) || BARS[0]).color;
    if (needsFmt) r.fmt = { ...fmt };
    A.cfSave(r, old?.id); onClose();
  };
  const KINDS = [['cell', tt('Cell value', 'قيمة الخلية')], ['text', tt('Specific text', 'نص محدد')], ['dup', tt('Duplicate values', 'القيم المكررة')], ['uniq', tt('Unique values', 'القيم الفريدة')], ['top', tt('Top / Bottom', 'الأعلى / الأدنى')], ['avg', tt('Above / Below average', 'أعلى / أقل من المتوسط')], ['expr', tt('Use a formula', 'استخدام صيغة')], ['scale', tt('Color scale', 'تدرج لوني')], ['bar', tt('Data bar', 'شريط بيانات')]];
  return (
    <Dialog title={old ? tt('Edit Formatting Rule', 'تعديل قاعدة التنسيق') : tt('New Formatting Rule', 'قاعدة تنسيق جديدة')} tt={tt} onClose={onClose} onEnter={ok}
      footer={<><Btn onClick={onClose}>{tt('Cancel', 'إلغاء')}</Btn><Btn primary onClick={ok}>{tt('OK', 'موافق')}</Btn></>}>
      <label className="sxd__lbl">{tt('Rule type', 'نوع القاعدة')}
        <select className="sxd__in" value={kind} onChange={(e) => { setKind(e.target.value); setErr(''); }} data-autofocus>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </label>
      <label className="sxd__lbl">{tt('Applies to', 'تنطبق على')}
        <input className="sxd__in" value={rng} onChange={(e) => { setRng(e.target.value); setErr(''); }} dir="ltr" spellCheck={false} />
      </label>
      {kind === 'cell' && (
        <div className="sxd__fl">
          <select className="sxd__in sxd__in--s" value={p.op} onChange={(e) => set('op', e.target.value)}>{OPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input className="sxd__in" value={p.v1} onChange={(e) => set('v1', e.target.value)} dir="auto" placeholder={tt('Value', 'القيمة')} />
          {(p.op === 'btw' || p.op === 'nbtw') && <input className="sxd__in" value={p.v2} onChange={(e) => set('v2', e.target.value)} dir="auto" placeholder={tt('and', 'و')} />}
        </div>
      )}
      {kind === 'text' && (
        <div className="sxd__fl">
          <select className="sxd__in sxd__in--s" value={p.tmode} onChange={(e) => set('tmode', e.target.value)}>
            <option value="contains">{tt('Contains', 'يحتوي')}</option><option value="notcontains">{tt('Does not contain', 'لا يحتوي')}</option><option value="begins">{tt('Begins with', 'يبدأ بـ')}</option><option value="ends">{tt('Ends with', 'ينتهي بـ')}</option>
          </select>
          <input className="sxd__in" value={p.text} onChange={(e) => set('text', e.target.value)} dir="auto" />
        </div>
      )}
      {kind === 'top' && (
        <div className="sxd__fl">
          <select className="sxd__in sxd__in--s" value={p.bottom ? 'b' : 't'} onChange={(e) => set('bottom', e.target.value === 'b')}><option value="t">{tt('Top', 'الأعلى')}</option><option value="b">{tt('Bottom', 'الأدنى')}</option></select>
          <input className="sxd__in sxd__in--s" type="number" min="1" value={p.n} onChange={(e) => set('n', e.target.value)} />
          <label className="sxd__chk"><input type="checkbox" checked={!!p.pct} onChange={(e) => set('pct', e.target.checked)} /> %</label>
        </div>
      )}
      {kind === 'avg' && <select className="sxd__in" value={p.below ? 'b' : 'a'} onChange={(e) => set('below', e.target.value === 'b')}><option value="a">{tt('Above average', 'أعلى من المتوسط')}</option><option value="b">{tt('Below average', 'أقل من المتوسط')}</option></select>}
      {kind === 'expr' && <label className="sxd__lbl">{tt('Formula (relative to the first cell)', 'الصيغة (نسبةً لأول خلية)')}<input className="sxd__in" value={p.expr} onChange={(e) => set('expr', e.target.value)} dir="ltr" placeholder="=$B2>100" spellCheck={false} /></label>}
      {kind === 'scale' && <div className="sxd__sc">{SCALES.map((s) => <button type="button" key={s.id} title={tt(s.en, s.ar)} className={p.scaleId === s.id ? 'is-on' : ''} onClick={() => set('scaleId', s.id)} style={{ background: `linear-gradient(90deg,${s.colors.join(',')})` }} />)}</div>}
      {kind === 'bar' && <div className="sxd__sc">{BARS.map((s) => <button type="button" key={s.id} title={tt(s.en, s.ar)} className={p.barId === s.id ? 'is-on' : ''} onClick={() => set('barId', s.id)} style={{ background: `linear-gradient(90deg,${s.color},#fff)` }} />)}</div>}
      {needsFmt && (
        <>
          <label className="sxd__lbl">{tt('Format', 'التنسيق')}
            <select className="sxd__in" value={HILITE.findIndex((h) => JSON.stringify(h.fmt) === JSON.stringify(fmt))} onChange={(e) => { const h = HILITE[+e.target.value]; if (h) setFmt({ ...h.fmt }); }}>
              {HILITE.map((h, i) => <option key={h.id} value={i}>{tt(h.en, h.ar)}</option>)}<option value={-1} disabled>{tt('Custom', 'مخصص')}</option>
            </select>
          </label>
          <div className="sxd__fl">
            <label className="sxd__chk">{tt('Fill', 'تعبئة')} <input type="color" value={fmt.bg || '#ffffff'} onChange={(e) => setFmt((f) => ({ ...f, bg: e.target.value }))} /></label>
            <label className="sxd__chk">{tt('Text', 'نص')} <input type="color" value={fmt.color || '#000000'} onChange={(e) => setFmt((f) => ({ ...f, color: e.target.value }))} /></label>
            <label className="sxd__chk"><input type="checkbox" checked={!!fmt.b} onChange={(e) => setFmt((f) => ({ ...f, b: e.target.checked ? 1 : 0 }))} /> {tt('Bold', 'غامق')}</label>
            <button type="button" className="sxd__btn" onClick={() => setFmt((f) => ({ ...f, bg: undefined }))}>{tt('No fill', 'بدون تعبئة')}</button>
          </div>
          <div className="sxd__prev"><span className="sxd__sample" style={{ background: fmt.bg || 'transparent', color: fmt.color || 'inherit', fontWeight: fmt.b ? 700 : 400 }}>AaBbCc 123</span></div>
        </>
      )}
      {err && <p className="sxd__err" role="alert">{err}</p>}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ Manage rules */
export function ManageRulesDialog({ A, tt, onClose }) {
  const rules = A.sheet.cf;
  return (
    <Dialog title={tt('Conditional Formatting Rules', 'قواعد التنسيق الشرطي')} tt={tt} onClose={onClose} wide
      footer={<><Btn onClick={() => A.openDialog('cfrule', {})}>{tt('New Rule…', 'قاعدة جديدة…')}</Btn><Btn primary onClick={onClose}>{tt('Close', 'إغلاق')}</Btn></>}>
      {rules.length === 0 && <p className="sxd__hint">{tt('There are no rules on this sheet.', 'مفيش قواعد في الورقة دي.')}</p>}
      <div className="sxd__rules">
        {rules.map((r, i) => (
          <div className="sxd__rule" key={r.id}>
            <span className="sxd__rp" style={r.kind === 'scale' ? { background: `linear-gradient(90deg,${r.colors.join(',')})` } : r.kind === 'bar' ? { background: `linear-gradient(90deg,${r.color},#fff)` } : { background: r.fmt?.bg || 'transparent', color: r.fmt?.color || 'inherit', fontWeight: r.fmt?.b ? 700 : 400 }}>Aa</span>
            <span className="sxd__rd">{describe(r, tt)}</span>
            <span className="sxd__rr" dir="ltr">{rangeStr(r.rng)}</span>
            <button type="button" className="sxd__ib" title={tt('Move up', 'تحريك لأعلى')} disabled={i === 0} onClick={() => A.cfMove(r.id, -1)}>↑</button>
            <button type="button" className="sxd__ib" title={tt('Move down', 'تحريك لأسفل')} disabled={i === rules.length - 1} onClick={() => A.cfMove(r.id, 1)}>↓</button>
            <button type="button" className="sxd__ib" title={tt('Edit', 'تعديل')} onClick={() => A.openDialog('cfrule', { rule: r })}>✎</button>
            <button type="button" className="sxd__ib" title={tt('Delete', 'حذف')} onClick={() => A.cfDelete(r.id)}>✕</button>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ Chart dialog */
export function ChartDialog({ d, A, tt, onClose }) {
  const old = d.chart || null;
  const [type, setType] = useState(old?.type || d.ctype || 'col');
  const [rng, setRng] = useState(old ? rangeStr(old.rng) : rangeStr(d.rng || A.range()));
  const [byRow, setByRow] = useState(old?.byRow === true ? 'r' : old?.byRow === false ? 'c' : 'a');
  const [hdr, setHdr] = useState(old?.hdr === true ? 'y' : old?.hdr === false ? 'n' : 'a');
  const [lab, setLab] = useState(old?.lab === true ? 'y' : old?.lab === false ? 'n' : 'a');
  const [title, setTitle] = useState(old ? old.title : '');
  const [legend, setLegend] = useState(old ? old.legend !== false : true);
  const [err, setErr] = useState('');
  const tri = (v) => (v === 'y' ? true : v === 'n' ? false : null);
  const ok = () => {
    const g = parseRange(rng.replace(/\$/g, '')); if (!g) { setErr(tt('The range is not valid.', 'النطاق غير صالح.')); return; }
    A.chartSave({ type, rng: g, byRow: byRow === 'a' ? null : byRow === 'r', hdr: tri(hdr), lab: tri(lab), title: title.trim(), legend }, old?.id); onClose();
  };
  const Sel3 = ({ v, on, a, y, n }) => <select className="sxd__in sxd__in--s" value={v} onChange={(e) => on(e.target.value)}><option value="a">{a}</option><option value="y">{y}</option><option value="n">{n}</option></select>;
  return (
    <Dialog title={old ? tt('Chart Settings', 'إعدادات الرسم البياني') : tt('Insert Chart', 'إدراج رسم بياني')} tt={tt} onClose={onClose} onEnter={ok}
      footer={<><Btn onClick={onClose}>{tt('Cancel', 'إلغاء')}</Btn><Btn primary onClick={ok}>{old ? tt('OK', 'موافق') : tt('Insert', 'إدراج')}</Btn></>}>
      <div className="sxd__ctypes" role="radiogroup" aria-label={tt('Chart type', 'نوع الرسم')}>
        {CHART_TYPES.map((t) => <button type="button" key={t.id} role="radio" aria-checked={type === t.id} className={type === t.id ? 'is-on' : ''} onClick={() => setType(t.id)}><ChartGlyph type={t.id} /><span>{tt(t.en, t.ar)}</span></button>)}
      </div>
      <label className="sxd__lbl">{tt('Data range', 'نطاق البيانات')}<input data-autofocus className="sxd__in" value={rng} onChange={(e) => { setRng(e.target.value); setErr(''); }} dir="ltr" spellCheck={false} /></label>
      <div className="sxd__fl">
        <label className="sxd__lbl">{tt('Series in', 'السلاسل في')}<Sel3 v={byRow} on={setByRow} a={tt('Auto', 'تلقائي')} y={tt('Rows', 'صفوف')} n={tt('Columns', 'أعمدة')} /></label>
        <label className="sxd__lbl">{tt('First row is header', 'الصف الأول عناوين')}<Sel3 v={hdr} on={setHdr} a={tt('Auto', 'تلقائي')} y={tt('Yes', 'نعم')} n={tt('No', 'لا')} /></label>
        <label className="sxd__lbl">{tt('First column is labels', 'العمود الأول تسميات')}<Sel3 v={lab} on={setLab} a={tt('Auto', 'تلقائي')} y={tt('Yes', 'نعم')} n={tt('No', 'لا')} /></label>
      </div>
      <label className="sxd__lbl">{tt('Chart title', 'عنوان الرسم')}<input className="sxd__in" value={title} onChange={(e) => setTitle(e.target.value)} dir="auto" /></label>
      <label className="sxd__chk"><input type="checkbox" checked={legend} onChange={(e) => setLegend(e.target.checked)} /> {tt('Show legend', 'إظهار مفتاح الرسم')}</label>
      {err && <p className="sxd__err" role="alert">{err}</p>}
    </Dialog>
  );
}

export function ChartGlyph({ type, size = 30 }) {
  const c = PALETTE;
  const P = {
    col: <><rect x="4" y="14" width="5" height="12" fill={c[0]} /><rect x="12" y="6" width="5" height="20" fill={c[0]} /><rect x="20" y="10" width="5" height="16" fill={c[1]} /></>,
    bar: <><rect x="4" y="4" width="12" height="5" fill={c[0]} /><rect x="4" y="12" width="20" height="5" fill={c[0]} /><rect x="4" y="20" width="16" height="5" fill={c[1]} /></>,
    line: <polyline points="3,22 10,12 17,17 26,6" fill="none" stroke={c[0]} strokeWidth="2.4" strokeLinejoin="round" />,
    area: <polygon points="3,26 3,16 10,10 17,15 26,6 26,26" fill={c[0]} opacity=".75" />,
    pie: <><circle cx="15" cy="15" r="11" fill={c[0]} /><path d="M15 15V4a11 11 0 0 1 10.4 7.4Z" fill={c[1]} /><path d="M15 15l10.4-3.6A11 11 0 0 1 20 25Z" fill={c[3]} /></>,
    donut: <><circle cx="15" cy="15" r="9" fill="none" stroke={c[0]} strokeWidth="6" /><circle cx="15" cy="15" r="9" fill="none" stroke={c[1]} strokeWidth="6" strokeDasharray="14 60" /></>,
    scatter: <><circle cx="7" cy="21" r="2.2" fill={c[0]} /><circle cx="13" cy="12" r="2.2" fill={c[0]} /><circle cx="19" cy="17" r="2.2" fill={c[1]} /><circle cx="24" cy="7" r="2.2" fill={c[0]} /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true">{P[type] || P.col}</svg>;
}

/* ------------------------------------------------------------------ AutoFilter drop-down */
export function FilterMenu({ A, tt, c, pos, onClose }) {
  const { wb, sheet } = A; const f = sheet.filter;
  const vals = useMemo(() => uniqueValues(wb, sheet, f, c), [wb, sheet, f, c, wb.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = f.cols[c]?.allow ? new Set(f.cols[c].allow) : null;
  const [on, setOn] = useState(() => new Set(cur || vals.map((v) => v.t)));
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    window.addEventListener('pointerdown', down, true); return () => window.removeEventListener('pointerdown', down, true);
  }, [onClose]);
  useEffect(() => { ref.current?.querySelector('input[type=search]')?.focus(); }, []);
  const shown = vals.filter((v) => (v.t === BLANK ? tt('(Blanks)', '(فارغ)') : v.t).toLowerCase().includes(q.toLowerCase()));
  const allOn = shown.length > 0 && shown.every((v) => on.has(v.t));
  const toggle = (t) => setOn((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const toggleAll = () => setOn((s) => { const n = new Set(s); shown.forEach((v) => (allOn ? n.delete(v.t) : n.add(v.t))); return n; });
  const apply = () => { const everything = vals.every((v) => on.has(v.t)); A.filterSet(c, everything ? null : vals.filter((v) => on.has(v.t)).map((v) => v.t)); onClose(); };
  const W = 250; const left = Math.max(4, Math.min(pos.x, (pos.vw || 1200) - W - 4)); const top = pos.y;
  return (
    <div className="sx__fmenu" ref={ref} style={{ left, top }} role="dialog" aria-label={tt('Filter', 'تصفية')} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); else if (e.key === 'Enter') apply(); }}>
      <button type="button" className="sx__it" onClick={() => { A.filterSort(c, true); onClose(); }}><span className="sx__iti"><SxIcon name="sortaz" size={16} /></span><span className="sx__itl">{tt('Sort A to Z', 'ترتيب تصاعدي')}</span></button>
      <button type="button" className="sx__it" onClick={() => { A.filterSort(c, false); onClose(); }}><span className="sx__iti"><SxIcon name="sortza" size={16} /></span><span className="sx__itl">{tt('Sort Z to A', 'ترتيب تنازلي')}</span></button>
      <button type="button" className="sx__it" disabled={!cur} onClick={() => { A.filterSet(c, null); onClose(); }}><span className="sx__iti"><SxIcon name="filter" size={16} /></span><span className="sx__itl">{tt('Clear filter', 'مسح التصفية')}</span></button>
      <div className="sx__msep" role="separator" />
      <input type="search" className="sxd__in sx__fq" placeholder={tt('Search', 'بحث')} value={q} onChange={(e) => setQ(e.target.value)} dir="auto" />
      <div className="sx__fl" role="listbox" aria-multiselectable="true">
        <label className="sxd__chk"><input type="checkbox" checked={allOn} onChange={toggleAll} /> {tt('(Select All)', '(تحديد الكل)')}</label>
        {shown.map((v) => <label className="sxd__chk" key={v.t}><input type="checkbox" checked={on.has(v.t)} onChange={() => toggle(v.t)} /> <span>{v.t === BLANK ? tt('(Blanks)', '(فارغ)') : v.t}</span><i>{v.n}</i></label>)}
        {shown.length === 0 && <p className="sxd__hint">{tt('No matches', 'لا نتائج')}</p>}
      </div>
      <div className="sx__ff"><Btn onClick={onClose}>{tt('Cancel', 'إلغاء')}</Btn><Btn primary onClick={apply} disabled={on.size === 0}>{tt('OK', 'موافق')}</Btn></div>
    </div>
  );
}
