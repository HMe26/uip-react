import { memo, useId, useLayoutEffect, useRef } from 'react';
import { DASH, geomPath } from './pptxGeom';
import { FONT_STACK, cqOf, format, formatSize, hasRange, htmlToParas, insertPlain, liveFormat, parasToHtml, selectAll } from './pptxRich';

const ALIGN = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' };
const EMPTY_TEXT = { paras: [{ algn: null, lvl: 0, bullet: '', rtl: false, sz: 1800, end: {}, mar: 0, runs: [], text: '' }], fs: 1, anchor: 'ctr', ins: [91440, 45720, 91440, 45720] };
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const pc = (v, d) => `${(v / d) * 100}%`;
const GHOST = { title: ['Click to add title', 'اضغط لإضافة عنوان'], ctrTitle: ['Click to add title', 'اضغط لإضافة عنوان'], subTitle: ['Click to add subtitle', 'اضغط لإضافة عنوان فرعي'], body: ['Click to add text', 'اضغط لإضافة نص'], obj: ['Click to add text', 'اضغط لإضافة نص'] };

function Para({ p, cx, fs, rtlDefault }) {
  const cq = (sz) => cqOf(sz * fs, cx);
  const hang = (p.mar || (p.bullet ? 342900 : 0)) / cx * 100;
  return (
    <div className="px__p" dir={p.rtl ? 'rtl' : 'ltr'} style={{ fontSize: cq(p.sz), textAlign: ALIGN[p.algn] || (p.rtl || rtlDefault ? 'right' : 'left'), paddingInlineStart: `${hang + p.lvl * 3}cqw`, minHeight: '1.15em', lineHeight: p.lnSpc ? (p.lnSpc / 100) * 1.2 : 1.2, position: 'relative' }}>
      {p.bullet && <span style={{ position: 'absolute', insetInlineStart: `${p.lvl * 3 + Math.max(0, hang - 2.2)}cqw` }}>{p.bullet === '#' ? '•' : p.bullet}</span>}
      {p.runs.map((r, i) => (r.t === '\n' ? <br key={i} /> : (
        <span key={i} style={{ fontSize: r.sz ? cq(r.sz) : undefined, fontWeight: r.b === true ? 700 : r.b === false ? 400 : undefined, fontStyle: r.i === true ? 'italic' : r.i === false ? 'normal' : undefined, textDecoration: [r.u && 'underline', r.st && 'line-through'].filter(Boolean).join(' ') || undefined, color: r.color || undefined, fontFamily: r.font && !r.font.startsWith('+') ? `'${r.font}', ${FONT_STACK}` : undefined }}>{r.t}</span>
      )))}
    </div>
  );
}
const TextBlock = ({ text, cx }) => text.paras.map((p, i) => <Para key={i} p={p} cx={cx} fs={text.fs || 1} />);

/** The in-place rich text editor. Its DOM is owned by the browser while editing (React never re-renders its children). */
function RichEditor({ text, cx, selectAllOnOpen, target, ed }) {
  const ref = useRef(null); const dirty = useRef(false); const range = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current; el.innerHTML = parasToHtml(text, cx); el.focus();
    if (selectAllOnOpen) selectAll(el); else { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
    const report = () => ed.onFmt?.(liveFormat(el, cx));
    const api = {
      root: el, target, cx,
      commit: () => { if (!dirty.current) return null; dirty.current = false; return { target, paras: htmlToParas(el, cx) }; },
      restore: () => { el.focus(); if (range.current) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(range.current); } },
      run: (name, value) => { api.restore(); const ok = name === 'size' ? formatSize(el, value, cx) : format(el, name, value); if (ok) { dirty.current = true; report(); } return ok; },
      hasRange: () => hasRange(el),
    };
    ed.editorApi.current = api;
    const onSel = () => { const s = window.getSelection(); if (s && s.rangeCount && el.contains(s.anchorNode)) { range.current = s.getRangeAt(0).cloneRange(); report(); } };
    document.addEventListener('selectionchange', onSel); onSel();
    return () => { document.removeEventListener('selectionchange', onSel); if (ed.editorApi.current === api) ed.editorApi.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} className="px__rt" contentEditable suppressContentEditableWarning spellCheck={false} role="textbox" aria-multiline="true"
      onInput={() => { dirty.current = true; }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); ed.onEndEdit(); } if (e.key === 'Tab') e.preventDefault(); }}
      onPaste={(e) => { e.preventDefault(); insertPlain(e.clipboardData.getData('text/plain')); dirty.current = true; }}
      onDrop={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => { const nx = e.relatedTarget; if (nx && nx.closest && nx.closest('[data-px-keep]')) return; ed.onEndEdit(); }} />
  );
}

function Geo({ s, g, uid, hit }) {
  const w = Math.max(g.w, 1); const h = Math.max(g.h, 1); const ln = s.line;
  const d = geomPath(s.geom, w, h); const gid = `${uid}g${s.xi}`; const mid = `${uid}m${s.xi}`;
  const fill = s.grad ? `url(#${gid})` : s.fill || 'none';
  const lw = ln ? ln.w : 0; const dash = ln?.dash && DASH[ln.dash] ? DASH[ln.dash].map((v) => v * lw).join(' ') : undefined;
  const a = ((s.grad?.angle || 0) * Math.PI) / 180;
  return (
    <svg className="px__geo" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ transform: `scale(${g.flipH ? -1 : 1}, ${g.flipV ? -1 : 1})` }} aria-hidden="true">
      <defs>
        {s.grad && <linearGradient id={gid} x1={0.5 - Math.cos(a) / 2} y1={0.5 - Math.sin(a) / 2} x2={0.5 + Math.cos(a) / 2} y2={0.5 + Math.sin(a) / 2}>{s.grad.stops.map((t, i) => <stop key={i} offset={`${t.pos}%`} stopColor={t.c} />)}</linearGradient>}
        {ln && (ln.tail || ln.head) && <marker id={mid} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill={ln.color} /></marker>}
      </defs>
      <path d={d} fill={s.isLine ? 'none' : fill} stroke={ln ? ln.color : 'none'} strokeWidth={lw} strokeDasharray={dash} strokeLinejoin="round" markerEnd={ln?.tail ? `url(#${mid})` : undefined} markerStart={ln?.head ? `url(#${mid})` : undefined} />
      {s.isLine && <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(lw, hit)} style={{ pointerEvents: 'stroke' }} />}
    </svg>
  );
}

function Overlay({ s, ed }) {
  const g = { ...s, ...(ed.drag?.xi === s.xi ? ed.drag : null) }; const editing = ed.editing && ed.editing.xi === s.xi;
  const { cx, cy } = ed.size;
  return (
    <div className={`px__sel${editing ? ' is-editing' : ''}`} style={{ left: pc(g.x, cx), top: pc(g.y, cy), width: pc(g.w, cx), height: pc(g.h, cy), transform: g.rot ? `rotate(${g.rot}deg)` : undefined }}>
      {['t', 'b', 'l', 'r'].map((e) => <i key={e} className={`px__edge px__edge--${e}`} onPointerDown={(ev) => ed.onShapeDown(ev, s, true)} />)}
      {!s.grouped && !editing && <>
        {HANDLES.map((h) => <b key={h} className={`px__h px__h--${h}`} onPointerDown={(ev) => ed.onHandleDown(ev, s, h)} />)}
        <u className="px__rot" onPointerDown={(ev) => ed.onHandleDown(ev, s, 'rot')} />
      </>}
    </div>
  );
}

const same = (a, b) => a.slide === b.slide && a.deck.cx === b.deck.cx && a.deck.cy === b.deck.cy && a.wide === b.wide && a.ed === b.ed;
const Slide = memo(function Slide({ slide, deck, wide, ed }) {
  const { cx, cy } = deck; const uid = useId().replace(/:/g, '');
  const tt = ed?.tt || ((a) => a);
  const isEdit = (xi, r, c) => ed?.editing && ed.editing.xi === xi && ed.editing.r === r && ed.editing.c === c;
  const body = (s, i) => {
    const g = ed?.drag?.xi === s.xi ? { ...s, ...ed.drag } : s;
    const box = { left: pc(g.x, cx), top: pc(g.y, cy), width: pc(g.w, cx), height: pc(g.h, cy), transform: g.rot ? `rotate(${g.rot}deg)` : undefined };
    const down = ed ? (e) => ed.onShapeDown(e, s) : undefined;
    if (s.kind === 'pic') {
      const c = s.crop; const sw = c ? 1 - c.l - c.r : 1; const sh = c ? 1 - c.t - c.b : 1;
      return (
        <div key={i} className="px__sh px__pic" style={{ ...box, transform: `${box.transform || ''} scale(${g.flipH ? -1 : 1}, ${g.flipV ? -1 : 1})` }} onPointerDown={down} data-xi={s.xi}>
          <img src={s.url} alt={s.alt} draggable={false} style={c ? { position: 'absolute', width: `${100 / sw}%`, height: `${100 / sh}%`, left: `${(-c.l / sw) * 100}%`, top: `${(-c.t / sh) * 100}%` } : undefined} />
        </div>
      );
    }
    if (s.kind === 'table') {
      const tot = s.cols.reduce((a, b) => a + b, 0) || 1;
      return (
        <div key={i} className="px__sh px__tbl" style={box} onPointerDown={down} data-xi={s.xi}>
          <table><colgroup>{s.cols.map((w, c) => <col key={c} style={{ width: pc(w, tot) }} />)}</colgroup>
            <tbody>{s.rows.map((r, ri) => (
              <tr key={ri} style={{ height: pc(r.h, s.h || 1) }}>{r.cells.map((c, ci) => (c.skip ? null : (
                <td key={ci} colSpan={c.span} rowSpan={c.rspan} className={ed?.cell && ed.cell.xi === s.xi && ed.cell.r === ri && ed.cell.c === ci ? 'is-cell' : undefined}
                  style={{ background: c.fill || (s.firstRow && ri === 0 ? s.accent : undefined), color: s.firstRow && ri === 0 && !c.fill ? '#fff' : undefined, fontWeight: s.firstRow && ri === 0 ? 700 : undefined }}
                  onPointerDown={ed ? (e) => ed.onCellDown(e, s, ri, ci) : undefined}>
                  {isEdit(s.xi, ri, ci) ? <RichEditor text={c.text} cx={cx} selectAllOnOpen={ed.editing.selectAll} target={{ xi: s.xi, r: ri, c: ci }} ed={ed} /> : <TextBlock text={c.text} cx={cx} />}
                </td>)))}
              </tr>))}</tbody></table>
        </div>
      );
    }
    const editing = isEdit(s.xi, undefined, undefined); const text = s.text || (editing ? EMPTY_TEXT : null);
    const empty = !text || !text.paras.some((p) => p.text.trim());
    const ghost = ed && !editing && s.ph && empty ? GHOST[s.ph.type] : null;
    const ins = (text || EMPTY_TEXT).ins;
    return (
      <div key={i} className={`px__sh px__shape${s.isLine ? ' is-line' : ''}`} style={box} onPointerDown={down} data-xi={s.xi}>
        {(s.fill || s.grad || s.line || s.isLine) && <Geo s={s} g={g} uid={uid} hit={cx * 0.014} />}
        {text && (
          <div className="px__tb" style={{ justifyContent: { t: 'flex-start', ctr: 'center', b: 'flex-end' }[text.anchor] || 'flex-start', padding: `${(ins[1] / cx) * 100}cqw ${(ins[2] / cx) * 100}cqw ${(ins[3] / cx) * 100}cqw ${(ins[0] / cx) * 100}cqw` }}>
            {editing ? <RichEditor text={text} cx={cx} selectAllOnOpen={ed.editing.selectAll} target={{ xi: s.xi }} ed={ed} /> : <TextBlock text={text} cx={cx} />}
            {ghost && <span className="px__ghost" style={{ fontSize: cqOf(text.paras[0]?.sz || 1800, cx) }}>{tt(...ghost)}</span>}
          </div>
        )}
      </div>
    );
  };
  const selShape = ed && ed.sel != null ? slide.shapes.find((s) => s.xi === ed.sel) : null;
  return (
    <div className={`px__wrap${ed ? ' px--ed' : ''}`} style={{ width: wide || '100%' }}>
      <div className="px__slide" ref={ed?.slideRef} style={{ width: '100%', aspectRatio: `${cx} / ${cy}`, containerType: 'inline-size', background: slide.bg, color: slide.fg, fontFamily: FONT_STACK }} onPointerDown={ed ? ed.onSlideDown : undefined}>
        {slide.shapes.map(body)}
        {ed?.guides && <>{ed.guides.x.map((v) => <i key={`x${v}`} className="px__guide px__guide--v" style={{ left: pc(v, cx) }} />)}{ed.guides.y.map((v) => <i key={`y${v}`} className="px__guide px__guide--h" style={{ top: pc(v, cy) }} />)}</>}
      </div>
      {selShape && <Overlay s={selShape} ed={{ ...ed, size: { cx, cy } }} />}
    </div>
  );
}, same);
export default Slide;
