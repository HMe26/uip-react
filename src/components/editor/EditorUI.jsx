import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { FONTS, kindOf } from './annot';

export const TOOLS = [
  { id: 'select', icon: 'ed-cursor', en: 'Select', ar: 'تحديد' },
  { id: 'edittext', icon: 'ed-edit-text', en: 'Edit text', ar: 'تعديل النص' },
  { id: 'text', icon: 'ed-type', en: 'Add text', ar: 'إضافة نص' },
  { id: 'pen', icon: 'ed-pen', en: 'Draw', ar: 'رسم' },
  { id: 'highlight', icon: 'ed-highlighter', en: 'Highlight', ar: 'تظليل' },
  { id: 'line', icon: 'ed-line', en: 'Line', ar: 'خط' },
  { id: 'arrow', icon: 'ed-arrow', en: 'Arrow', ar: 'سهم' },
  { id: 'rect', icon: 'ed-square', en: 'Rectangle', ar: 'مستطيل' },
  { id: 'ellipse', icon: 'ed-circle', en: 'Ellipse', ar: 'دائرة' },
  { id: 'whiteout', icon: 'ed-whiteout', en: 'White-out', ar: 'تغطية بيضاء' },
  { id: 'redact', icon: 'ed-redact', en: 'Redact', ar: 'حجب أسود' },
  { id: 'pixel', icon: 'ed-pixel', en: 'Pixelate', ar: 'تمويه' },
  { id: 'eraser', icon: 'ed-eraser', en: 'Erase', ar: 'ممحاة' },
];

const SWATCHES = ['#e5484d', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff', '#111827'];
const HL_SWATCHES = ['#ffe14d', '#86efac', '#f9a8d4', '#93c5fd', '#fdba74'];

export function Btn({ icon, label, onClick, disabled, active, primary, title, size = 17, className = '', children, ...rest }) {
  return (
    <button
      type="button"
      className={`ed__btn${active ? ' is-on' : ''}${primary ? ' ed__btn--primary' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title || label}
      aria-label={title || label}
      aria-pressed={active === undefined ? undefined : !!active}
      {...rest}
    >
      {icon && <Icon name={icon} size={size} />}
      {label && <span>{label}</span>}
      {children}
    </button>
  );
}

export function Toolbar({ tools, tool, setTool, tt, children }) {
  return (
    <div className="ed__tools" role="toolbar">
      {TOOLS.filter((x) => tools.includes(x.id)).map((x) => (
        <button
          key={x.id}
          type="button"
          className={`ed__tool${tool === x.id ? ' is-on' : ''}`}
          onClick={() => setTool(x.id)}
          title={tt(x.en, x.ar)}
          aria-label={tt(x.en, x.ar)}
          aria-pressed={tool === x.id}
        >
          <Icon name={x.icon} size={18} />
          <span>{tt(x.en, x.ar)}</span>
        </button>
      ))}
      {children}
    </div>
  );
}

export function Section({ title, children }) {
  return (
    <section className="ed__sec">
      {title && <h4>{title}</h4>}
      {children}
    </section>
  );
}

export function Range({ label, value, min, max, step = 1, onChange, unit = '' }) {
  return (
    <label className="ed__range">
      <span className="ed__range-top"><span>{label}</span><b>{Math.round(value * 100) / 100}{unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Colors({ value, onChange, swatches = SWATCHES, tt }) {
  return (
    <div className="ed__colors">
      {swatches.map((c) => (
        <button key={c} type="button" className={`ed__sw${value?.toLowerCase() === c ? ' is-on' : ''}`} style={{ background: c }} onClick={() => onChange(c)} aria-label={c} />
      ))}
      <label className="ed__sw ed__sw--pick" title={tt('Custom colour', 'لون مخصص')}>
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

const KIND_OF_TOOL = { text: 'text', pen: 'pen', line: 'line', arrow: 'arrow', rect: 'rect', ellipse: 'ellipse', highlight: 'highlight', pixel: 'pixel', whiteout: 'none', redact: 'none' };

/** Properties of the selected object (or of the active tool), plus duplicate / order / delete. */
export function PropsPanel({ tool, style, setStyle, sel, updateSel, actions, tt }) {
  const kind = sel ? kindOf(sel) : KIND_OF_TOOL[tool] || 'none';
  const hl = kind === 'highlight';
  const get = (f) => {
    if (sel) {
      if (f === 'color') return sel.hl || sel.cover ? sel.fill : sel.color;
      return sel[f];
    }
    if (f === 'color') return hl ? style.hl : style.color;
    if (f === 'alpha') return hl ? style.hlAlpha : style.alpha;
    return style[f];
  };
  const set = (patch) => {
    if (sel) updateSel(patch);
    const d = {};
    if ('color' in patch) d[hl ? 'hl' : 'color'] = patch.color;
    if ('alpha' in patch) d[hl ? 'hlAlpha' : 'alpha'] = patch.alpha;
    if ('fill' in patch) { d.fill = patch.fill; if (patch.fill) d.fillColor = patch.fill; }
    ['width', 'size', 'font', 'bold', 'italic', 'block'].forEach((k) => { if (k in patch) d[k] = patch[k]; });
    if (Object.keys(d).length) setStyle((s) => ({ ...s, ...d }));
  };
  const has = (...k) => k.includes(kind);
  const colorLabel = has('rect', 'ellipse') ? tt('Outline', 'لون الإطار') : tt('Colour', 'اللون');

  return (
    <div className="ed__props">
      {kind === 'none' && !sel && <p className="ed__hint">{tool === 'edittext' ? tt('Click any line of text on the page to edit it. The original is covered and your new text takes its place.', 'اضغط على أي سطر نص في الصفحة عشان تعدّله. الأصل بيتغطى ونصك الجديد بياخد مكانه.') : tt('Pick a tool, then click or drag on the page. Select an object to change it.', 'اختار أداة وبعدين اضغط أو اسحب على الصفحة. اختار أي عنصر عشان تعدّله.')}</p>}

      {has('text', 'pen', 'line', 'arrow', 'rect', 'ellipse') && (
        <Section title={colorLabel}><Colors value={get('color')} onChange={(c) => set({ color: c })} tt={tt} /></Section>
      )}
      {has('highlight') && (
        <Section title={tt('Highlight colour', 'لون التظليل')}><Colors value={get('color')} onChange={(c) => set({ color: c })} swatches={HL_SWATCHES} tt={tt} /></Section>
      )}
      {has('cover') && sel && (
        <Section title={tt('Colour', 'اللون')}><Colors value={get('color')} onChange={(c) => set({ color: c })} swatches={['#ffffff', '#000000', '#f1f5f9', '#fde68a']} tt={tt} /></Section>
      )}
      {has('text') && (
        <Section title={tt('Text', 'النص')}>
          <Range label={tt('Size', 'الحجم')} value={get('size') ?? 28} min={6} max={160} onChange={(v) => set({ size: v })} />
          <select className="ed__select" value={get('font') || 'Arial'} onChange={(e) => set({ font: e.target.value })} aria-label={tt('Font', 'الخط')}>
            {FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <div className="ed__seg">
            <button type="button" className={get('bold') ? 'is-on' : ''} onClick={() => set({ bold: !get('bold') })} style={{ fontWeight: 800 }}>B</button>
            <button type="button" className={get('italic') ? 'is-on' : ''} onClick={() => set({ italic: !get('italic') })} style={{ fontStyle: 'italic' }}>I</button>
          </div>
        </Section>
      )}
      {has('pen', 'line', 'arrow', 'rect', 'ellipse') && (
        <Section title={tt('Stroke', 'السُمك')}>
          <Range label={tt('Width', 'العرض')} value={get('width') ?? 4} min={1} max={40} onChange={(v) => set({ width: v })} />
        </Section>
      )}
      {has('rect', 'ellipse') && (
        <Section title={tt('Fill', 'التعبئة')}>
          <div className="ed__seg">
            <button type="button" className={!get('fill') ? 'is-on' : ''} onClick={() => set({ fill: null })}>{tt('None', 'بدون')}</button>
            <button type="button" className={get('fill') ? 'is-on' : ''} onClick={() => set({ fill: get('fill') || style.fillColor })}>{tt('Solid', 'ملوّن')}</button>
          </div>
          {get('fill') && <Colors value={get('fill')} onChange={(c) => set({ fill: c })} tt={tt} />}
        </Section>
      )}
      {has('pixel') && (
        <Section title={tt('Pixelate', 'التمويه')}>
          <Range label={tt('Block size', 'حجم المربعات')} value={get('block') ?? 14} min={4} max={60} onChange={(v) => set({ block: v })} />
        </Section>
      )}
      {has('text', 'pen', 'line', 'arrow', 'rect', 'ellipse', 'highlight', 'image') && (
        <Section>
          <Range label={tt('Opacity', 'الشفافية')} value={Math.round((get('alpha') ?? 1) * 100)} min={5} max={100} unit="%" onChange={(v) => set({ alpha: v / 100 })} />
        </Section>
      )}

      {sel && (
        <Section title={tt('Object', 'العنصر')}>
          <div className="ed__row">
            <Btn icon="copy" label={tt('Duplicate', 'تكرار')} onClick={actions.dup} />
            <Btn icon="ed-front" label={tt('Front', 'للأمام')} onClick={actions.front} />
            <Btn icon="ed-back" label={tt('Back', 'للخلف')} onClick={actions.back} />
            <Btn icon="trash" label={tt('Delete', 'حذف')} onClick={actions.del} className="ed__btn--danger" />
          </div>
        </Section>
      )}
    </div>
  );
}

/** Modal pad: draw a signature → transparent PNG (trimmed). */
export function SignaturePad({ tt, onDone, onCancel }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const [ink, setInk] = useState('#111827');
  const [empty, setEmpty] = useState(true);
  const last = useRef(null);

  useEffect(() => {
    const c = ref.current;
    const r = c.getBoundingClientRect();
    c.width = Math.round(r.width * 2);
    c.height = Math.round(r.height * 2);
  }, []);

  const pos = (e) => { const r = ref.current.getBoundingClientRect(); return [(e.clientX - r.left) * 2, (e.clientY - r.top) * 2]; };
  const down = (e) => { e.currentTarget.setPointerCapture?.(e.pointerId); drawing.current = true; last.current = pos(e); setEmpty(false); };
  const move = (e) => {
    if (!drawing.current) return;
    const ctx = ref.current.getContext('2d');
    const p = pos(e);
    ctx.strokeStyle = ink; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(last.current[0], last.current[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
    last.current = p;
  };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); setEmpty(true); };
  const use = () => {
    const c = ref.current;
    const ctx = c.getContext('2d');
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let x0 = width; let y0 = height; let x1 = 0; let y1 = 0;
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (data[(y * width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 <= x0 || y1 <= y0) return;
    const pad = 6;
    const out = document.createElement('canvas');
    out.width = x1 - x0 + pad * 2; out.height = y1 - y0 + pad * 2;
    out.getContext('2d').drawImage(c, x0, y0, x1 - x0, y1 - y0, pad, pad, x1 - x0, y1 - y0);
    onDone(out.toDataURL('image/png'), out.width, out.height);
  };

  return (
    <div className="ed__modal" role="dialog" aria-modal="true" aria-label={tt('Signature', 'التوقيع')} onPointerDown={(e) => e.stopPropagation()}>
      <div className="ed__modal-card">
        <h3>{tt('Draw your signature', 'ارسم توقيعك')}</h3>
        <canvas ref={ref} className="ed__sigpad" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        <div className="ed__row" style={{ justifyContent: 'space-between' }}>
          <div className="ed__colors">
            {['#111827', '#1d4ed8', '#b91c1c'].map((c) => (
              <button key={c} type="button" className={`ed__sw${ink === c ? ' is-on' : ''}`} style={{ background: c }} onClick={() => setInk(c)} aria-label={c} />
            ))}
          </div>
          <div className="ed__row">
            <Btn label={tt('Clear', 'مسح')} onClick={clear} />
            <Btn label={tt('Cancel', 'إلغاء')} onClick={onCancel} />
            <Btn label={tt('Add', 'إضافة')} onClick={use} disabled={empty} primary />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Global shortcuts while an editor is open (ignored while typing in a field). */
export function useEditorKeys(h) {
  const ref = useRef(h);
  ref.current = h;
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const k = ref.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') { e.preventDefault(); (e.shiftKey ? k.redo : k.undo)?.(); return; }
      if (mod && key === 'y') { e.preventDefault(); k.redo?.(); return; }
      if (mod && key === 's') { e.preventDefault(); k.save?.(); return; }
      if (mod && key === 'd') { e.preventDefault(); k.dup?.(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { if (k.hasSel?.()) { e.preventDefault(); k.del?.(); } return; }
      if (e.key === 'Escape') { k.esc?.(); return; }
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d && k.hasSel?.()) { e.preventDefault(); k.nudge?.(d[0], d[1]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
