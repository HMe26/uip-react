import { useEffect, useMemo, useRef, useState } from 'react';
import SxIcon from './SheetIcons';
import { NUM_FORMATS, fmtText } from '../../lib/sheet/format.js';
import { SWATCH_THEME, SWATCH_STD, FN_CATS } from '../../lib/sheet/presets.js';
import { SHORTCUTS, SHORTCUT_GROUPS } from '../../lib/sheet/keys.js';
import { FUNCS } from '../../lib/sheet/funcs.js';

/** Modal that lives inside the editor (so it takes the sheet theme), closes with Esc, confirms with Enter. */
export function Dialog({ title, onClose, children, footer, wide, tt, onEnter }) {
  const ref = useRef(null);
  useEffect(() => { const f = ref.current?.querySelector('[data-autofocus]'); (f || ref.current)?.focus?.({ preventScroll: true }); }, []);
  const key = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onClose(); } else if (e.key === 'Enter' && onEnter && !/^(TEXTAREA|BUTTON)$/.test(e.target.tagName) && !e.target.closest?.('[role="listbox"]')) { e.preventDefault(); onEnter(); }
  };
  return (
    <div className="sxd__back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`sxd${wide ? ' sxd--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1} onKeyDown={key}>
        <div className="sxd__h"><strong>{title}</strong><button type="button" className="sxd__x" aria-label={tt('Close', 'إغلاق')} onClick={onClose}><SxIcon name="close" size={16} /></button></div>
        <div className="sxd__b">{children}</div>
        {footer && <div className="sxd__f">{footer}</div>}
      </div>
    </div>
  );
}
const Btn = ({ primary, ...p }) => <button type="button" className={`sxd__btn${primary ? ' is-primary' : ''}`} {...p} />;

/** Replacement for window.prompt (blocked or ugly in embedded windows). */
export function PromptDialog({ d, tt, onClose }) {
  const [v, setV] = useState(d.value ?? ''); const [err, setErr] = useState('');
  const ok = () => { const r = d.onOk(v); if (typeof r === 'string') { setErr(r); return; } if (r !== false) onClose(); };
  return (
    <Dialog title={d.title} tt={tt} onClose={onClose} onEnter={ok}
      footer={<><Btn onClick={onClose}>{tt('Cancel', 'إلغاء')}</Btn><Btn primary onClick={ok}>{d.okLabel || tt('OK', 'موافق')}</Btn></>}>
      <label className="sxd__lbl">{d.label}
        <input data-autofocus className="sxd__in" value={v} onChange={(e) => { setV(e.target.value); setErr(''); }} onFocus={(e) => e.target.select()} dir="auto" spellCheck={false} />
      </label>
      {d.hint && <p className="sxd__hint">{d.hint}</p>}
      {d.names && d.names.length > 0 && (
        <div className="sxd__names" role="listbox" aria-label={tt('Names', 'الأسماء')}>
          {d.names.map((n) => <button type="button" key={n.name} role="option" aria-selected={false} onClick={() => setV(n.name)} onDoubleClick={() => { d.onOk(n.name); onClose(); }}>{n.name}<span>{n.ref}</span></button>)}
        </div>
      )}
      {err && <p className="sxd__err" role="alert">{err}</p>}
    </Dialog>
  );
}

export function ConfirmDialog({ d, tt, onClose }) {
  return (
    <Dialog title={d.title} tt={tt} onClose={onClose} onEnter={() => { d.onOk(); onClose(); }}
      footer={<><Btn onClick={onClose}>{tt('Cancel', 'إلغاء')}</Btn><Btn primary data-autofocus onClick={() => { d.onOk(); onClose(); }}>{d.okLabel || tt('OK', 'موافق')}</Btn></>}>
      <p className="sxd__p">{d.label}</p>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- keyboard shortcuts (F1) */
export function ShortcutsDialog({ tt, rtl, onClose }) {
  const [q, setQ] = useState('');
  const rows = SHORTCUTS.filter((s) => !q || `${s.keys} ${s.en} ${s.ar}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Dialog title={tt('Keyboard shortcuts', 'اختصارات الكيبورد')} tt={tt} onClose={onClose} wide footer={<Btn primary onClick={onClose}>{tt('Close', 'إغلاق')}</Btn>}>
      <input data-autofocus className="sxd__in" placeholder={tt('Search shortcuts…', 'ابحث في الاختصارات…')} value={q} onChange={(e) => setQ(e.target.value)} dir="auto" />
      <p className="sxd__hint">{tt('These work on any keyboard layout (including Arabic) and never reach the browser — Ctrl+S saves the sheet, Ctrl+P prints it. Ctrl+N / T / W belong to the browser itself and cannot be intercepted.', 'بتشتغل على أي لغة كيبورد (بما فيها العربي) ومش بتوصل للمتصفح — Ctrl+S بيحفظ الشيت وCtrl+P بيطبعه. اختصارات Ctrl+N / T / W ملك المتصفح نفسه ومفيش موقع يقدر يمسكها.')}</p>
      <div className="sxd__sc">
        {SHORTCUT_GROUPS.map((g) => {
          const list = rows.filter((s) => s.g === g.id); if (!list.length) return null;
          return (
            <section key={g.id}>
              <h4>{tt(g.en, g.ar)}</h4>
              {list.map((s) => <div className="sxd__sr" key={s.keys + s.en}><span>{tt(s.en, s.ar)}</span><kbd dir="ltr">{s.keys}</kbd></div>)}
            </section>
          );
        })}
        {!rows.length && <p className="sxd__hint">{tt('Nothing found.', 'مفيش نتائج.')}</p>}
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- Insert function */
export function InsertFnDialog({ tt, onPick, onClose }) {
  const [q, setQ] = useState(''); const [cat, setCat] = useState('all'); const [hi, setHi] = useState(null);
  const all = useMemo(() => FN_CATS.flatMap((c) => c.list.split(' ').filter((n) => FUNCS[n]).map((n) => ({ n, c: c.id }))), []);
  const list = all.filter((f) => (cat === 'all' || f.c === cat) && (!q || f.n.includes(q.toUpperCase())));
  const sel = hi || list[0]?.n;
  return (
    <Dialog title={tt('Insert Function', 'إدراج دالة')} tt={tt} onClose={onClose} onEnter={() => sel && onPick(sel)}
      footer={<><Btn onClick={onClose}>{tt('Cancel', 'إلغاء')}</Btn><Btn primary disabled={!sel} onClick={() => sel && onPick(sel)}>{tt('OK', 'موافق')}</Btn></>}>
      <label className="sxd__lbl">{tt('Search for a function', 'ابحث عن دالة')}
        <input data-autofocus className="sxd__in" value={q} onChange={(e) => { setQ(e.target.value); setHi(null); }} spellCheck={false} dir="ltr" placeholder="SUM, VLOOKUP, IF…" />
      </label>
      <label className="sxd__lbl">{tt('Category', 'الفئة')}
        <select className="sxd__in" value={cat} onChange={(e) => { setCat(e.target.value); setHi(null); }}>
          <option value="all">{tt('All', 'الكل')}</option>
          {FN_CATS.map((c) => <option key={c.id} value={c.id}>{tt(c.en, c.ar)}</option>)}
        </select>
      </label>
      <div className="sxd__fl" role="listbox" aria-label={tt('Functions', 'الدوال')} dir="ltr">
        {list.map((f) => <button type="button" role="option" key={f.n} aria-selected={f.n === sel} className={f.n === sel ? 'is-on' : ''} onClick={() => setHi(f.n)} onDoubleClick={() => onPick(f.n)}>{f.n}</button>)}
        {!list.length && <p className="sxd__hint">{tt('No function matches.', 'مفيش دالة مطابقة.')}</p>}
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- Format Cells (Ctrl+1) */
const DATES = ['yyyy-mm-dd', 'dd/mm/yyyy', 'mm/dd/yyyy', 'd-mmm-yy', 'dd mmmm yyyy', 'dddd, mmmm d, yyyy'];
const TIMES = ['h:mm:ss', 'h:mm AM/PM', 'hh:mm', 'hh:mm:ss', 'd/m/yyyy h:mm'];
const SYMS = ['$', '€', '£', '¥', 'EGP', 'SAR', 'AED', 'KWD'];
const NUMCATS = [
  ['General', 'General', 'عام'], ['Number', 'Number', 'رقم'], ['Currency', 'Currency', 'عملة'], ['Accounting', 'Accounting', 'محاسبي'], ['Date', 'Date', 'تاريخ'], ['Time', 'Time', 'وقت'],
  ['Percentage', 'Percentage', 'نسبة مئوية'], ['Scientific', 'Scientific', 'علمي'], ['Text', 'Text', 'نص'], ['Custom', 'Custom', 'مخصص'],
];
const zeros = (n) => (n > 0 ? `.${'0'.repeat(n)}` : '');
function detect(nf) {
  const code = nf || 'General';
  if (code === 'General') return { cat: 'General' };
  if (code === '@') return { cat: 'Text' };
  if (DATES.includes(code)) return { cat: 'Date', code };
  if (TIMES.includes(code)) return { cat: 'Time', code };
  let m = /^0(\.(0+))?E\+00$/.exec(code); if (m) return { cat: 'Scientific', dec: m[2] ? m[2].length : 0 };
  m = /^0(\.(0+))?%$/.exec(code); if (m) return { cat: 'Percentage', dec: m[2] ? m[2].length : 0 };
  m = /^(#,##)?0(\.(0+))?$/.exec(code); if (m) return { cat: 'Number', dec: m[3] ? m[3].length : 0, thou: !!m[1] };
  m = /^"([^"]+)"#,##0(\.(0+))?$/.exec(code); if (m) return { cat: 'Currency', sym: m[1], dec: m[3] ? m[3].length : 0 };
  if (code.startsWith('_(')) return { cat: 'Accounting' };
  return { cat: 'Custom', code };
}
const codeFor = (n) => {
  switch (n.cat) {
    case 'General': return 'General';
    case 'Number': return `${n.thou ? '#,##0' : '0'}${zeros(n.dec)}`;
    case 'Currency': return `"${n.sym}"#,##0${zeros(n.dec)}`;
    case 'Accounting': return NUM_FORMATS.find((f) => f.id === 'accounting').code;
    case 'Date': return n.code || DATES[0];
    case 'Time': return n.code || TIMES[0];
    case 'Percentage': return `0${zeros(n.dec)}%`;
    case 'Scientific': return `0${zeros(n.dec)}E+00`;
    case 'Text': return '@';
    default: return n.code || 'General';
  }
};

function ColorField({ value, onChange, none, tt }) {
  return (
    <div className="sxd__col">
      <button type="button" className={`sxd__sw sxd__sw--none${!value ? ' is-on' : ''}`} title={none} aria-label={none} onClick={() => onChange(null)}>∅</button>
      {[...SWATCH_THEME.flat(), ...SWATCH_STD].map((c) => <button key={c} type="button" className={`sxd__sw${value === c ? ' is-on' : ''}`} style={{ background: c }} aria-label={c} title={c} onClick={() => onChange(c)} />)}
      <label className="sxd__more">{tt('More…', 'المزيد…')}<input type="color" value={value || '#000000'} onChange={(e) => onChange(e.target.value)} /></label>
    </div>
  );
}

export function FormatCellsDialog({ A, tt, tab: tab0 = 'number', onClose }) {
  const st = A.activeStyle || {};
  const [tab, setTab] = useState(tab0);
  const [num, setNum] = useState(() => { const d = detect(st.nf); return { dec: 2, thou: false, sym: '$', ...d }; });
  const [al, setAl] = useState(st.al || 'general'); const [va, setVa] = useState(st.va || 'bottom'); const [wrap, setWrap] = useState(!!st.wrap); const [ind, setInd] = useState(st.ind || 0);
  const [merge, setMerge] = useState(false);
  const [font, setFont] = useState(st.font || 'Calibri'); const [fs, setFs] = useState(st.fs || 10.5);
  const [fb, setFb] = useState(!!st.b); const [fi, setFi] = useState(!!st.i); const [fu, setFu] = useState(!!st.u); const [fst, setFst] = useState(!!st.st); const [color, setColor] = useState(st.color || null);
  const [bg, setBg] = useState(st.bg || null);
  const [bpre, setBpre] = useState(null); const [bstyle, setBstyle] = useState('thin'); const [bcol, setBcol] = useState('#000000');
  const code = codeFor(num);
  const v = A.wb.getValue(A.sheet, A.sel.ar, A.sel.ac);
  const sample = useMemo(() => { try { return v === null || v === undefined ? fmtText(1234.5678, code) : fmtText(v, code); } catch { return ''; } }, [v, code]);
  const apply = () => {
    const patch = {
      nf: code === 'General' ? null : code, al: al === 'general' ? null : al, va: va === 'bottom' ? null : va, wrap: wrap ? 1 : null, ind: ind || null,
      font: font === 'Calibri' ? null : font, fs: +fs === 10.5 ? null : +fs, b: fb ? 1 : null, i: fi ? 1 : null, u: fu ? 1 : null, st: fst ? 1 : null, color, bg,
    };
    A.style(patch);
    if (merge) A.merge(true);
    if (bpre) A.borders(bpre, bstyle, bcol);
    onClose();
  };
  const TABS = [['number', 'Number', 'الرقم'], ['align', 'Alignment', 'المحاذاة'], ['font', 'Font', 'الخط'], ['border', 'Border', 'الحدود'], ['fill', 'Fill', 'التعبئة']];
  const Seg = ({ value, set, items }) => <div className="sxd__seg" role="radiogroup">{items.map(([id, en, ar]) => <button type="button" role="radio" aria-checked={value === id} key={id} className={value === id ? 'is-on' : ''} onClick={() => set(id)}>{tt(en, ar)}</button>)}</div>;
  return (
    <Dialog title={tt('Format Cells', 'تنسيق الخلايا')} tt={tt} onClose={onClose} wide onEnter={apply}
      footer={<><Btn onClick={onClose}>{tt('Cancel', 'إلغاء')}</Btn><Btn primary onClick={apply}>{tt('OK', 'موافق')}</Btn></>}>
      <div className="sxd__tabs" role="tablist">{TABS.map(([id, en, ar]) => <button type="button" role="tab" aria-selected={tab === id} key={id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>{tt(en, ar)}</button>)}</div>
      {tab === 'number' && (
        <div className="sxd__nf">
          <div className="sxd__cats" role="listbox" aria-label={tt('Category', 'الفئة')}>
            {NUMCATS.map(([id, en, ar]) => <button type="button" role="option" aria-selected={num.cat === id} key={id} className={num.cat === id ? 'is-on' : ''} data-autofocus={num.cat === id ? '' : undefined}
              onClick={() => setNum((n) => ({ ...n, cat: id, code: id === 'Custom' ? codeFor(n) : id === 'Date' ? DATES[0] : id === 'Time' ? TIMES[0] : n.code }))}>{tt(en, ar)}</button>)}
          </div>
          <div className="sxd__nfp">
            <div className="sxd__sample"><small>{tt('Sample', 'عيّنة')}</small><b dir="auto">{sample}</b></div>
            {['Number', 'Currency', 'Percentage', 'Scientific'].includes(num.cat) && (
              <label className="sxd__lbl sxd__lbl--row">{tt('Decimal places', 'عدد الكسور')}<input type="number" min="0" max="15" className="sxd__in sxd__in--s" value={num.dec} onChange={(e) => setNum({ ...num, dec: Math.max(0, Math.min(15, +e.target.value || 0)) })} /></label>
            )}
            {num.cat === 'Number' && <label className="sxd__chk"><input type="checkbox" checked={num.thou} onChange={(e) => setNum({ ...num, thou: e.target.checked })} />{tt('Use 1000 separator (,)', 'استخدم فاصل الآلاف (,)')}</label>}
            {num.cat === 'Currency' && <label className="sxd__lbl sxd__lbl--row">{tt('Symbol', 'الرمز')}<select className="sxd__in sxd__in--s" value={num.sym} onChange={(e) => setNum({ ...num, sym: e.target.value })}>{SYMS.map((s) => <option key={s}>{s}</option>)}</select></label>}
            {(num.cat === 'Date' || num.cat === 'Time') && (
              <div className="sxd__fl" role="listbox" dir="ltr">{(num.cat === 'Date' ? DATES : TIMES).map((c) => { let ex = ''; try { ex = fmtText(v === null || typeof v !== 'number' ? 45000.75 : v, c); } catch { /* */ } return <button type="button" role="option" aria-selected={num.code === c} key={c} className={num.code === c ? 'is-on' : ''} onClick={() => setNum({ ...num, code: c })}>{ex}<span>{c}</span></button>; })}</div>
            )}
            {num.cat === 'Custom' && <label className="sxd__lbl">{tt('Format code', 'كود التنسيق')}<input className="sxd__in" dir="ltr" spellCheck={false} value={num.code || ''} onChange={(e) => setNum({ ...num, code: e.target.value })} placeholder="#,##0.00;[Red]-#,##0.00" /></label>}
            {num.cat === 'General' && <p className="sxd__hint">{tt('General cells have no specific number format.', 'الخلايا العامة مالهاش تنسيق أرقام محدد.')}</p>}
            {num.cat === 'Text' && <p className="sxd__hint">{tt('Cells are treated as text, even when a number is entered.', 'الخلايا بتتعامل كنص حتى لو اتكتب فيها رقم.')}</p>}
            {num.cat === 'Accounting' && <p className="sxd__hint">{tt('Lines up currency symbols and decimal points in a column.', 'بيحاذي رموز العملة والفواصل العشرية في العمود.')}</p>}
          </div>
        </div>
      )}
      {tab === 'align' && (
        <div className="sxd__grid2">
          <div><span className="sxd__cap">{tt('Horizontal', 'أفقي')}</span><Seg value={al} set={setAl} items={[['general', 'General', 'عام'], ['left', 'Left', 'يسار'], ['center', 'Center', 'وسط'], ['right', 'Right', 'يمين']]} /></div>
          <div><span className="sxd__cap">{tt('Vertical', 'رأسي')}</span><Seg value={va} set={setVa} items={[['top', 'Top', 'أعلى'], ['center', 'Center', 'وسط'], ['bottom', 'Bottom', 'أسفل']]} /></div>
          <label className="sxd__lbl sxd__lbl--row">{tt('Indent', 'المسافة البادئة')}<input type="number" min="0" max="15" className="sxd__in sxd__in--s" value={ind} onChange={(e) => setInd(Math.max(0, Math.min(15, +e.target.value || 0)))} /></label>
          <div>
            <label className="sxd__chk"><input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />{tt('Wrap text', 'التفاف النص')}</label>
            <label className="sxd__chk"><input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />{tt('Merge cells', 'دمج الخلايا')}</label>
          </div>
        </div>
      )}
      {tab === 'font' && (
        <div className="sxd__grid2">
          <label className="sxd__lbl">{tt('Font', 'الخط')}<select className="sxd__in" value={font} onChange={(e) => setFont(e.target.value)}>{A.fonts.map((f) => <option key={f}>{f}</option>)}</select></label>
          <label className="sxd__lbl">{tt('Size', 'الحجم')}<input type="number" min="6" max="200" step="0.5" className="sxd__in" value={fs} onChange={(e) => setFs(e.target.value)} /></label>
          <div className="sxd__eff"><label className="sxd__chk"><input type="checkbox" checked={fb} onChange={(e) => setFb(e.target.checked)} />{tt('Bold', 'غامق')}</label><label className="sxd__chk"><input type="checkbox" checked={fi} onChange={(e) => setFi(e.target.checked)} />{tt('Italic', 'مائل')}</label><label className="sxd__chk"><input type="checkbox" checked={fu} onChange={(e) => setFu(e.target.checked)} />{tt('Underline', 'تسطير')}</label><label className="sxd__chk"><input type="checkbox" checked={fst} onChange={(e) => setFst(e.target.checked)} />{tt('Strikethrough', 'يتوسطه خط')}</label></div>
          <div className="sxd__prev" style={{ fontFamily: `"${font}", Calibri, sans-serif`, fontSize: `${Math.min(36, +fs || 11)}px`, fontWeight: fb ? 700 : 400, fontStyle: fi ? 'italic' : 'normal', textDecoration: `${fu ? 'underline ' : ''}${fst ? 'line-through' : ''}`, color: color || undefined, background: bg || undefined }}>AaBbCc أبجد</div>
          <div className="sxd__wide"><span className="sxd__cap">{tt('Font color', 'لون الخط')}</span><ColorField value={color} onChange={setColor} none={tt('Automatic', 'تلقائي')} tt={tt} /></div>
        </div>
      )}
      {tab === 'border' && (
        <div className="sxd__grid2">
          <div className="sxd__wide"><span className="sxd__cap">{tt('Presets', 'إعدادات جاهزة')}</span>
            <div className="sxd__seg sxd__seg--wrap" role="radiogroup">
              {[['none', 'None', 'بدون'], ['outer', 'Outline', 'خارجية'], ['inner', 'Inside', 'داخلية'], ['all', 'All', 'الكل'], ['top', 'Top', 'علوي'], ['bottom', 'Bottom', 'سفلي'], ['left', 'Left', 'يسار'], ['right', 'Right', 'يمين']].map(([id, en, ar]) => <button type="button" role="radio" aria-checked={bpre === id} key={id} className={bpre === id ? 'is-on' : ''} onClick={() => setBpre(bpre === id ? null : id)}>{tt(en, ar)}</button>)}
            </div>
          </div>
          <div><span className="sxd__cap">{tt('Line', 'الخط')}</span><Seg value={bstyle} set={setBstyle} items={[['thin', 'Thin', 'رفيع'], ['medium', 'Medium', 'متوسط'], ['thick', 'Thick', 'سميك']]} /></div>
          <div className="sxd__wide"><span className="sxd__cap">{tt('Color', 'اللون')}</span><ColorField value={bcol} onChange={(c) => setBcol(c || '#000000')} none={tt('Black', 'أسود')} tt={tt} /></div>
          {!bpre && <p className="sxd__hint sxd__wide">{tt('Pick a preset to change the borders of the selection.', 'اختار إعداد جاهز علشان تغيّر حدود التحديد.')}</p>}
        </div>
      )}
      {tab === 'fill' && (
        <div className="sxd__grid2">
          <div className="sxd__wide"><span className="sxd__cap">{tt('Background color', 'لون الخلفية')}</span><ColorField value={bg} onChange={setBg} none={tt('No fill', 'بدون تعبئة')} tt={tt} /></div>
          <div className="sxd__prev sxd__wide" style={{ background: bg || undefined, color: color || undefined }}>{tt('Sample', 'عيّنة')}</div>
        </div>
      )}
    </Dialog>
  );
}
