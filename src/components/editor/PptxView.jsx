import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { unzipSync, zipSync } from 'fflate';
import OfficeShell from './OfficeShell';
import { Btn } from './EditorUI';
import useDocHistory from './useDocHistory';
import Slide from './PptxSlide';
import Stage from './PptxStage';
import Ribbon from './PptxRibbon';
import { createSession, loadDeck } from '../../lib/officeFmt/pptx';
import * as E from '../../lib/officeFmt/pptxEdit';
import '../../styles/css/office.css';
import '../../styles/css/pptx.css';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const unzip = async (blob) => unzipSync(new Uint8Array(await blob.arrayBuffer()));
const zip = (files) => { const o = {}; Object.keys(files).forEach((k) => { o[k] = /^ppt\/media\//.test(k) ? [files[k], { level: 0 }] : files[k]; }); return new Blob([zipSync(o, { level: 6 })], { type: PPTX_MIME }); };

/** Read-only preview of every slide (used by the file viewer). */
export function PptxPreview({ blob, tt }) {
  const [s, setS] = useState({ status: 'loading' });
  useEffect(() => {
    let dead = false; const session = createSession();
    unzip(blob).then((files) => { if (!dead) setS({ status: 'ok', deck: loadDeck(files, session) }); }).catch((e) => { if (!dead) setS({ status: 'error', msg: e?.message || String(e) }); });
    return () => { dead = true; session.revoke(); };
  }, [blob]);
  if (s.status === 'loading') return <p className="st-fv__empty">{tt('Loading…', 'جارٍ التحميل…')}</p>;
  if (s.status === 'error') return <p className="st-fv__empty">{s.msg}</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
      {s.deck.slides.map((sl) => <div key={sl.index} style={{ width: 'min(900px, 100%)' }}><Slide slide={sl} deck={s.deck} /></div>)}
    </div>
  );
}

function Present({ deck, start, onClose }) {
  const [i, setI] = useState(start); const root = useRef(null); const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const n = deck.slides.length;
  useEffect(() => {
    const el = root.current; el.focus(); try { el.requestFullscreen?.(); } catch { /* optional */ }
    const fs = () => { if (!document.fullscreenElement) onClose(); }; const rs = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    document.addEventListener('fullscreenchange', fs); window.addEventListener('resize', rs);
    return () => { document.removeEventListener('fullscreenchange', fs); window.removeEventListener('resize', rs); if (document.fullscreenElement) document.exitFullscreen?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const go = (d) => setI((c) => Math.max(0, Math.min(n - 1, c + d)));
  const w = Math.min(vp.w, (vp.h * deck.cx) / deck.cy);
  return createPortal(
    <div ref={root} className="px__present" tabIndex={0} onClick={() => go(1)}
      onKeyDown={(e) => { if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); go(1); } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(-1); } else if (e.key === 'Home') setI(0); else if (e.key === 'End') setI(n - 1); else if (e.key === 'Escape') onClose(); }}>
      <Slide slide={deck.slides[i]} deck={deck} wide={`${w}px`} />
      <span className="px__present-n">{i + 1} / {n}</span>
    </div>, document.body);
}

function Notes({ files, path, tt, onCommit }) {
  const text = useMemo(() => (path ? E.readNotes(files, path).text : ''), [files, path]);
  const [v, setV] = useState(text);
  useEffect(() => { setV(text); }, [text, path]);
  return <textarea className="px__notes" dir="auto" value={v} placeholder={tt('Click to add speaker notes', 'اضغط لإضافة ملاحظات المتحدث')} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.stopPropagation()} onBlur={() => { if (v !== text) onCommit(v); }} />;
}

const toPng = (src, w, h) => new Promise((res, rej) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(src, 0, 0); c.toBlob((b) => (b ? res(b) : rej(new Error('Could not convert the image.'))), 'image/png'); });

/** PowerPoint editor: slide panel, ribbon, interactive stage, notes and slide show. Edits go straight to the package XML (see lib/officeFmt/pptxEdit). */
export default function PptxView({ blob, fileName, tt, rtl, guardRef, onSave, onClose, draftKey, startDirty = false }) {
  const h = useDocHistory(null, startDirty); const session = useMemo(() => createSession(), []);
  const [status, setStatus] = useState({ s: 'loading' });
  const [cur, setCur] = useState(0); const [sel, setSel] = useState(null); const [editing, setEditing] = useState(null); const [cell, setCell] = useState(null);
  const [tab, setTab] = useState('home'); const [zoom, setZoom] = useState(1); const [notesOpen, setNotesOpen] = useState(false);
  const [live, setLive] = useState(null); const [toast, setToast] = useState(''); const [present, setPresent] = useState(null); const [canPaste, setCanPaste] = useState(false);
  const editorApi = useRef(null); const clip = useRef(null); const pasteN = useRef(0); const fr = useRef(null); const last = useRef({ key: null, t: 0 }); const pathRef = useRef(null);
  const [overIdx, setOverIdx] = useState(null);

  useEffect(() => {
    let dead = false;
    unzip(blob).then((files) => { if (dead) return; h.reset({ files }); setStatus({ s: 'ok' }); }).catch((e) => { if (!dead) setStatus({ s: 'error', msg: e?.message || String(e) }); });
    return () => { dead = true; session.revoke(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);
  fr.current = h.value?.files;
  const deckRes = useMemo(() => { if (!h.value) return null; try { return { deck: loadDeck(h.value.files, session) }; } catch (e) { return { err: e?.message || String(e) }; } }, [h.value, session]);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(''), 4500); return () => clearTimeout(t); }, [toast]);
  const onFmt = useCallback((v) => setLive((p) => (JSON.stringify(p) === JSON.stringify(v) ? p : v)), []);

  const deck = deckRes?.deck; const n = deck ? deck.slides.length : 0; const ci = Math.min(cur, Math.max(0, n - 1));
  const slide = deck ? deck.slides[ci] : null; const path = slide?.path; pathRef.current = path;
  const selShape = slide && sel != null ? slide.shapes.find((s) => s.xi === sel) || null : null;

  const exec = (fn, key) => {
    try {
      const r = fn(fr.current); const now = Date.now(); const merge = !!key && last.current.key === key && now - last.current.t < 1000;
      last.current = { key, t: now }; fr.current = r.files; h.set({ files: r.files }, merge); return r;
    } catch (e) { setToast(e?.message || String(e)); return null; }
  };
  /** Fold any text still open in the editor into the files before running another operation. */
  const pre = (files) => { const c = editorApi.current?.commit(); return c ? E.setParas(files, pathRef.current, c.target, c.paras).files : files; };
  const endEdit = () => { const c = editorApi.current?.commit(); setEditing(null); setLive(null); if (c) exec((f) => E.setParas(f, pathRef.current, c.target, c.paras)); };
  const goto = (i) => { endEdit(); setSel(null); setCell(null); setCur(Math.max(0, Math.min(n - 1, i))); };
  const target = () => (editing ? { xi: editing.xi, ...(editing.r !== undefined ? { r: editing.r, c: editing.c } : {}) } : selShape?.kind === 'table' ? { xi: selShape.xi, ...(cell ? { r: cell.r, c: cell.c } : {}) } : { xi: sel });
  const selectNew = (r, edit) => { if (!r) return; setSel(r.xi); setCell(null); setEditing(edit ? { xi: r.xi, selectAll: true } : null); };

  const A = {
    undo: () => { endEdit(); h.undo(); }, redo: () => { endEdit(); h.redo(); }, setTab,
    rect: (xi, r, merge) => { exec((f) => E.setRect(pre(f), path, xi, r), merge ? 'nudge' : null); },
    box: (r) => { if (selShape) exec((f) => E.setRect(pre(f), path, sel, r), `box${Object.keys(r)}`); },
    endEdit, go: (d) => goto(ci + d),
    del: () => { if (!selShape) return; setEditing(null); exec((f) => E.deleteShape(f, path, sel)); setSel(null); setCell(null); },
    dup: () => { if (selShape) selectNew(exec((f) => E.duplicateShape(pre(f), path, sel, selShape))); },
    copy: () => { if (!selShape) return; try { clip.current = E.copyShape(pre(fr.current), path, sel, selShape); pasteN.current = 0; setCanPaste(true); } catch (e) { setToast(e.message); } },
    cut: () => { A.copy(); A.del(); },
    paste: () => { if (!clip.current) return; pasteN.current += 1; selectNew(exec((f) => E.pasteShape(pre(f), path, clip.current, pasteN.current))); },
    char: (p) => {
      const api = editorApi.current;
      if (api) {
        if ('b' in p) api.run('bold'); else if ('i' in p) api.run('italic'); else if ('u' in p) api.run('underline'); else if ('st' in p) api.run('strikeThrough');
        else if (p.color) api.run('foreColor', p.color); else if (p.font) api.run('fontName', p.font);
        return;
      }
      if (selShape) exec((f) => E.formatText(f, path, target(), p), `fmt${Object.keys(p)}`);
    },
    size: (pt) => { const v = Math.max(1, Math.min(400, pt)) * 100; if (editorApi.current) editorApi.current.run('size', v); else if (selShape) exec((f) => E.formatText(f, path, target(), { sz: v }), 'size'); },
    para: (o) => { if (!selShape && !editing) return; const t = target(); exec((f) => E.formatParas(pre(f), path, t, o), `para${Object.keys(o)}`); if (editing) { setEditing(null); setLive(null); } },
    fill: (c) => { if (selShape) exec((f) => E.setFill(pre(f), path, sel, c), 'fill'); },
    line: (o) => { if (selShape) exec((f) => E.setLine(pre(f), path, sel, o), `line${Object.keys(o)}`); },
    order: (d) => { if (selShape) { const r = exec((f) => E.reorder(pre(f), path, sel, d)); if (r) setSel(r.xi); } },
    align: (k) => {
      if (!selShape) return; const { cx, cy } = deck; const s = selShape; const m = { left: { x: 0 }, center: { x: (cx - s.w) / 2 }, right: { x: cx - s.w }, top: { y: 0 }, middle: { y: (cy - s.h) / 2 }, bottom: { y: cy - s.h } }[k];
      exec((f) => E.setRect(pre(f), path, sel, m));
    },
    rotate: (d) => { if (selShape) exec((f) => E.setRect(pre(f), path, sel, { rot: (selShape.rot || 0) + d })); },
    flip: (k) => { if (selShape) exec((f) => E.setRect(pre(f), path, sel, { [k]: !selShape[k] })); },
    addText: () => { selectNew(exec((f) => E.addTextBox(pre(f), path)), true); },
    addShape: (g) => { selectNew(exec((f) => E.addShape(pre(f), path, g, { fill: deck.theme.accent1 || '#4472C4', line: deck.theme.accent1 ? '#1F3864' : '#2F528F' }))); },
    addTable: (r, c) => { selectNew(exec((f) => E.addTable(pre(f), path, r, c, (deck.theme.accent1 || '#4472C4').slice(1)))); },
    addImage: async (file) => {
      try {
        const bmp = await createImageBitmap(file); const t = file.type; let ext = t === 'image/png' ? 'png' : t === 'image/jpeg' ? 'jpg' : t === 'image/gif' ? 'gif' : null; let data = file;
        if (!ext) { data = await toPng(bmp, bmp.width, bmp.height); ext = 'png'; }
        const bytes = new Uint8Array(await data.arrayBuffer());
        selectNew(exec((f) => E.addImage(pre(f), pathRef.current, { bytes, ext, w: bmp.width, h: bmp.height, name: file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Picture' })));
      } catch (e) { setToast(e?.message || tt('Could not read that image.', 'مش قادر أقرأ الصورة دي.')); }
    },
    table: (op) => {
      if (selShape?.kind !== 'table') return; const r = cell?.r ?? 0; const c = cell?.c ?? 0;
      if (exec((f) => E.tableOp(pre(f), path, sel, op, r, c), null) && (op === 'delRow' || op === 'delCol')) setCell(null);
    },
    cellFill: (c) => { if (selShape?.kind === 'table' && cell) exec((f) => E.setCellFill(pre(f), path, sel, cell.r, cell.c, c), 'cellfill'); else setToast(tt('Click a table cell first.', 'اضغط على خلية في الجدول الأول.')); },
    bg: (c, all) => { exec((f) => { let o = pre(f); (all ? deck.slides.map((s) => s.path) : [path]).forEach((p) => { o = E.setBackground(o, p, c).files; }); return { files: o }; }, all ? null : 'bg'); },
    newSlide: (lp) => { const l = lp || slide.layoutPath || deck.layouts[0]?.path; if (!l) return; endEdit(); const r = exec((f) => E.addSlide(pre(f), { layoutPath: l, after: ci })); if (r) { setCur(r.index); setSel(null); } },
    dupSlide: () => { endEdit(); const r = exec((f) => E.duplicateSlide(pre(f), ci)); if (r) { setCur(r.index); setSel(null); } },
    delSlide: () => { endEdit(); if (exec((f) => E.deleteSlide(pre(f), ci))) { setCur(Math.min(ci, n - 2)); setSel(null); } },
    moveSlide: (d) => A.moveTo(ci, ci + d),
    moveTo: (from, to) => { if (from === to || to < 0 || to >= n) return; endEdit(); if (exec((f) => E.moveSlide(pre(f), from, to))) { setCur(to); setSel(null); } },
    notes: (t) => { exec((f) => ({ files: E.setNotes(pre(f), path, t) })); },
    zoom: setZoom, toggleNotes: () => setNotesOpen((v) => !v), present: (fromStart) => { endEdit(); setPresent(fromStart ? 0 : ci); },
  };

  const modelFmt = useMemo(() => {
    if (!selShape) return null;
    const tx = selShape.kind === 'table' ? selShape.rows[cell?.r ?? 0]?.cells[cell?.c ?? 0]?.text : selShape.text; const p = tx?.paras[0]; const r = p?.runs.find((x) => x.t !== '\n') || {}; const e = p?.end || {};
    return { font: r.font || e.font || null, sz: r.sz || e.sz || p?.sz || null, b: r.b ?? e.b ?? false, i: r.i ?? e.i ?? false, u: !!r.u, st: !!r.st, color: r.color || e.color || null, algn: p?.algn || 'l', bullet: p?.bullet || '', rtl: !!p?.rtl, anchor: tx?.anchor || 't', lnSpc: p?.lnSpc || null };
  }, [selShape, cell]);
  const fmt = editing && live && modelFmt ? { ...modelFmt, ...live } : modelFmt;

  const build = useCallback(async () => { let f = fr.current; const c = editorApi.current?.commit(); if (c) f = E.setParas(f, pathRef.current, c.target, c.paras).files; return zip(f); }, []);
  if (status.s === 'loading' || (status.s === 'ok' && !deckRes)) return <div className="ed ed--center"><span className="st-fv-spinner" /><p className="ed__hint">{tt('Opening the presentation…', 'جارٍ فتح العرض…')}</p></div>;
  if (status.s === 'error' || deckRes.err) return <div className="ed ed--center"><p className="ed__err">{status.msg || deckRes.err}</p><Btn label={tt('Close', 'إغلاق')} onClick={onClose} /></div>;

  const S = { tab, sel: selShape, fmt, hasSel: !!selShape, isTable: selShape?.kind === 'table', theme: deck.theme, canUndo: h.canUndo, canRedo: h.canRedo, canPaste, layouts: deck.layouts, slideCount: n, cur: ci, zoom, notesOpen, bg: slide.hasBg && /^#/.test(slide.bg) ? slide.bg : null };
  const onRootKey = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.target.closest?.('[contenteditable="true"], input, textarea, select')) return;
    const k = e.key.toLowerCase(); if (k === 'z' && !e.shiftKey) { e.preventDefault(); A.undo(); } else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); A.redo(); }
  };
  const statusBar = (
    <div className="px__status"><span>{tt('Slide', 'شريحة')} {ci + 1} / {n}</span>{selShape && <span>{selShape.name || selShape.kind}</span>}<span className="ed__sp" />
      <span>{tt('Click a selected object again to edit its text · Arrows nudge · Shift = faster', 'اضغط على العنصر المحدد مرة تانية لتعديل النص · الأسهم للتحريك · Shift أسرع')}</span></div>
  );
  return (
    <OfficeShell fileName={fileName} tt={tt} guardRef={guardRef} onSave={onSave} onClose={onClose} dirty={h.dirty} build={build} onSaved={h.markSaved} draftKey={draftKey} draftToken={h.value} tools={<Ribbon tt={tt} S={S} A={A} />} status={statusBar}>
      <div className="px" onKeyDown={onRootKey}>
        <div className="px__thumbs">{deck.slides.map((sl, i) => (
          <div key={sl.path || i} className={`px__tw${overIdx === i ? ' is-over' : ''}`} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { e.preventDefault(); setOverIdx(i); }} onDragLeave={() => setOverIdx(null)} onDrop={(e) => { e.preventDefault(); setOverIdx(null); A.moveTo(parseInt(e.dataTransfer.getData('text/plain'), 10), i); }}>
            <button type="button" className={`px__thumb${i === ci ? ' is-on' : ''}`} onClick={() => goto(i)} aria-label={`${tt('Slide', 'شريحة')} ${i + 1}`}><Slide slide={sl} deck={deck} /><b>{i + 1}</b></button>
          </div>
        ))}</div>
        <div className="px__main">
          <Stage deck={deck} slide={slide} sel={sel} setSel={setSel} editing={editing} setEditing={setEditing} cell={cell} setCell={setCell} zoom={zoom} A={A} editorApi={editorApi} onFmt={onFmt} tt={tt} />
          {notesOpen && <Notes files={h.value.files} path={path} tt={tt} onCommit={A.notes} />}
        </div>
        {toast && <div className="px__toast" role="alert">{toast}</div>}
      </div>
      {present !== null && <Present deck={deck} start={present} onClose={() => setPresent(null)} />}
    </OfficeShell>
  );
}
