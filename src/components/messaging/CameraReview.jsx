import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Review step shown right after a camera shot (photo or video):
 *   photo  → draw freehand (colours / sizes / undo), emoji + picture stickers (move, pinch to resize / rotate), text.
 *   video  → preview.
 *   both   → send options: normal · view once · timer (disappears N seconds after it is opened) — like WhatsApp.
 * onSend(file, { mode: null | 'once' | 'timer', seconds }) ; onBack() returns to the live camera.
 * Everything is drawn on one canvas in coordinates relative to the picture, so the exported JPEG matches what you see
 * at the picture's full resolution.
 */
const COLORS = ['#ffffff', '#111111', '#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];
const SIZES = [0.006, 0.012, 0.024];
const TIMERS = [3, 5, 10, 30];
const EMOJIS = ('😀 😂 🤣 😍 🥰 😘 😎 🤩 🥳 😜 🤪 😇 🙃 😴 🤔 🙄 😭 😡 🤯 😱 👍 👎 👏 🙏 💪 ✌️ 🤞 👌 ❤️ 🔥 ⭐ ✨ 💯 🎉 🎂 🎁 🌹 ☀️ 🌙 ⚡ 💥 💫 🍕 ☕ ⚽ 🚀 📌 ✅ ❌').split(' ');

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const FONT = '"Tajawal","Cairo","Segoe UI",system-ui,sans-serif';

function itemSize(ctx, it, W) {
  if (it.type === 'img') {
    const w = it.scale * W;
    return { w, h: w * (it.img.naturalHeight / it.img.naturalWidth) };
  }
  const px = it.scale * W;
  ctx.font = it.type === 'text' ? `800 ${px}px ${FONT}` : `${px}px ${FONT}`;
  return { w: ctx.measureText(it.text).width, h: px * 1.15 };
}

function paintAll(ctx, img, strokes, items, W, H, selectedId) {
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  strokes.forEach((s) => {
    ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = s.size * W;
    if (s.pts.length === 1) { ctx.beginPath(); ctx.arc(s.pts[0][0] * W, s.pts[0][1] * H, s.size * W / 2, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.beginPath();
    s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
    ctx.stroke();
  });
  items.forEach((it) => {
    ctx.save();
    ctx.translate(it.x * W, it.y * H); ctx.rotate(it.rot);
    const { w, h } = itemSize(ctx, it, W);
    if (it.type === 'img') ctx.drawImage(it.img, -w / 2, -h / 2, w, h);
    else {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (it.type === 'text') {
        ctx.lineWidth = Math.max(3, it.scale * W * 0.14); ctx.strokeStyle = it.color === '#111111' ? '#fff' : '#000'; ctx.lineJoin = 'round';
        ctx.strokeText(it.text, 0, 0);
      }
      ctx.fillStyle = it.type === 'text' ? it.color : '#000';
      ctx.fillText(it.text, 0, 0);
    }
    if (selectedId === it.id) { ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = Math.max(2, W * 0.004); ctx.setLineDash([W * 0.015, W * 0.01]); ctx.strokeRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12); ctx.setLineDash([]); }
    ctx.restore();
  });
}

export default function CameraReview({ ar, kind, file, allowViewOnce = false, onBack, onSend }) {
  const t = (en, a) => (ar ? a : en);
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const ptrs = useRef(new Map());
  const gesture = useRef(null);
  const idSeq = useRef(0);
  const [img, setImg] = useState(null);
  const [vidUrl, setVidUrl] = useState('');
  const [box, setBox] = useState({ w: 300, h: 300 });
  const [strokes, setStrokes] = useState([]);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [tool, setTool] = useState('move'); // move | draw
  const [color, setColor] = useState('#ffffff');
  const [size, setSize] = useState(SIZES[1]);
  const [panel, setPanel] = useState(null); // null | 'stickers' | 'text'
  const [txt, setTxt] = useState('');
  const [mode, setMode] = useState(null); // null | 'once' | 'timer'
  const [seconds, setSeconds] = useState(10);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (kind === 'video') { setVidUrl(url); return () => URL.revokeObjectURL(url); }
    const im = new Image();
    im.onload = () => setImg(im);
    im.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, kind]);

  // fit the picture into the free space (keeps pointer maths exact: canvas CSS size === drawn size)
  useEffect(() => {
    const el = boxRef.current; if (!el) return undefined;
    const fit = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dims = useMemo(() => {
    if (!img) return { w: 0, h: 0 };
    const r = img.naturalWidth / img.naturalHeight;
    let w = box.w; let h = w / r;
    if (h > box.h) { h = box.h; w = h * r; }
    return { w: Math.max(1, Math.floor(w)), h: Math.max(1, Math.floor(h)) };
  }, [img, box]);

  const redraw = useCallback(() => {
    const c = canvasRef.current; if (!c || !img || !dims.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(dims.w * dpr); c.height = Math.round(dims.h * dpr);
    paintAll(c.getContext('2d'), img, strokes, items, c.width, c.height, selected);
  }, [img, dims, strokes, items, selected]);
  useEffect(() => { redraw(); }, [redraw]);

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const hit = (p) => {
    const c = canvasRef.current; const ctx = c.getContext('2d'); const W = c.width; const H = c.height;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const it = items[i];
      const { w, h } = itemSize(ctx, it, W);
      const dx = p.x * W - it.x * W; const dy = p.y * H - it.y * H;
      const cos = Math.cos(-it.rot); const sin = Math.sin(-it.rot);
      const lx = dx * cos - dy * sin; const ly = dx * sin + dy * cos;
      if (Math.abs(lx) <= w / 2 + 14 && Math.abs(ly) <= h / 2 + 14) return it;
    }
    return null;
  };

  const onDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pos(e);
    if (ptrs.current.size === 2) { // pinch the selected item
      const sel = items.find((i) => i.id === selected);
      if (sel) {
        const [a, b] = [...ptrs.current.values()];
        gesture.current = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), a0: Math.atan2(b.y - a.y, b.x - a.x), s0: sel.scale, r0: sel.rot };
      }
      return;
    }
    if (tool === 'draw') {
      const s = { color, size, pts: [[p.x, p.y]] };
      gesture.current = { kind: 'draw' };
      setStrokes((prev) => [...prev, s]);
      return;
    }
    const it = hit(p);
    setSelected(it ? it.id : null);
    gesture.current = it ? { kind: 'drag', dx: it.x - p.x, dy: it.y - p.y, id: it.id } : null;
  };
  const onMove = (e) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current; if (!g) return;
    if (g.kind === 'pinch' && ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y); const ang = Math.atan2(b.y - a.y, b.x - a.x);
      setItems((prev) => prev.map((i) => (i.id === selected ? { ...i, scale: clamp(g.s0 * (d / (g.d0 || 1)), 0.04, 1.4), rot: g.r0 + (ang - g.a0) } : i)));
      return;
    }
    const p = pos(e);
    if (g.kind === 'draw') {
      setStrokes((prev) => { const n = prev.slice(); const last = n[n.length - 1]; n[n.length - 1] = { ...last, pts: [...last.pts, [p.x, p.y]] }; return n; });
    } else if (g.kind === 'drag') {
      setItems((prev) => prev.map((i) => (i.id === g.id ? { ...i, x: clamp(p.x + g.dx, 0, 1), y: clamp(p.y + g.dy, 0, 1) } : i)));
    }
  };
  const onUp = (e) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2 && gesture.current?.kind === 'pinch') gesture.current = null;
    if (!ptrs.current.size) gesture.current = null;
  };

  const addItem = (it) => { const id = ++idSeq.current; setItems((prev) => [...prev, { id, x: 0.5, y: 0.5, rot: 0, ...it }]); setSelected(id); setTool('move'); };
  const addEmoji = (em) => { addItem({ type: 'emoji', text: em, scale: 0.2 }); setPanel(null); };
  const addText = () => { const v = txt.trim(); if (!v) return; addItem({ type: 'text', text: v, color, scale: 0.075 }); setTxt(''); setPanel(null); };
  const addPicture = (f) => {
    if (!f) return;
    const url = URL.createObjectURL(f); const im = new Image();
    im.onload = () => { addItem({ type: 'img', img: im, scale: 0.4 }); setPanel(null); };
    im.src = url;
  };
  const scaleSel = (k) => setItems((prev) => prev.map((i) => (i.id === selected ? { ...i, scale: clamp(i.scale * k, 0.04, 1.4) } : i)));
  const rotSel = (d) => setItems((prev) => prev.map((i) => (i.id === selected ? { ...i, rot: i.rot + d } : i)));
  const delSel = () => { setItems((prev) => prev.filter((i) => i.id !== selected)); setSelected(null); };
  const undo = () => { if (strokes.length) setStrokes((p) => p.slice(0, -1)); else setItems((p) => p.slice(0, -1)); setSelected(null); };

  const finish = async () => {
    if (busy) return; setBusy(true);
    const opts = mode ? { mode, seconds: mode === 'timer' ? seconds : null } : { mode: null, seconds: null };
    try {
      if (kind === 'video' || (!strokes.length && !items.length)) { onSend(file, opts); return; } // untouched: send the original shot
      const W = Math.min(img.naturalWidth, 2560); const H = Math.round(W * (img.naturalHeight / img.naturalWidth));
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      paintAll(c.getContext('2d'), img, strokes, items, W, H, null);
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
      onSend(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }), opts);
    } finally { setBusy(false); }
  };

  const chip = (on) => ({ border: 0, borderRadius: 999, padding: '7px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: on ? '#fff' : '#374151', color: on ? '#111' : '#fff', flexShrink: 0 });
  const row = { display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, overflowX: 'auto', paddingBottom: 2 };
  const hasSel = selected != null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', minHeight: 0, color: '#fff' }}>
      <div ref={boxRef} style={{ flex: '1 1 0', minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', borderRadius: 12, overflow: 'hidden' }}>
        {kind === 'video'
          ? <video src={vidUrl} controls playsInline loop style={{ maxWidth: '100%', maxHeight: '100%' }} />
          : <canvas ref={canvasRef} style={{ width: dims.w, height: dims.h, touchAction: 'none', cursor: tool === 'draw' ? 'crosshair' : 'default' }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />}
      </div>

      {kind === 'photo' && (
        <>
          <div style={row}>
            <button type="button" style={chip(tool === 'draw')} onClick={() => { setTool(tool === 'draw' ? 'move' : 'draw'); setPanel(null); }}>✏️ {t('Draw', 'رسم')}</button>
            <button type="button" style={chip(panel === 'stickers')} onClick={() => setPanel(panel === 'stickers' ? null : 'stickers')}>😀 {t('Stickers', 'ستيكرز')}</button>
            <button type="button" style={chip(panel === 'text')} onClick={() => setPanel(panel === 'text' ? null : 'text')}>Aa {t('Text', 'نص')}</button>
            <button type="button" style={chip(false)} onClick={undo} disabled={!strokes.length && !items.length}>↩ {t('Undo', 'تراجع')}</button>
            {hasSel && (
              <>
                <button type="button" style={chip(false)} onClick={() => scaleSel(1.15)} aria-label="+">＋</button>
                <button type="button" style={chip(false)} onClick={() => scaleSel(1 / 1.15)} aria-label="-">－</button>
                <button type="button" style={chip(false)} onClick={() => rotSel(Math.PI / 12)} aria-label="rotate">⟳</button>
                <button type="button" style={{ ...chip(false), background: '#7f1d1d' }} onClick={delSel}>🗑</button>
              </>
            )}
          </div>
          {(tool === 'draw' || panel === 'text') && (
            <div style={row}>
              {COLORS.map((c) => (
                <button key={c} type="button" aria-label={c} onClick={() => setColor(c)}
                  style={{ width: 26, height: 26, borderRadius: '50%', border: color === c ? '3px solid #38bdf8' : '2px solid #6b7280', background: c, flexShrink: 0, cursor: 'pointer', padding: 0 }} />
              ))}
              {tool === 'draw' && SIZES.map((s) => (
                <button key={s} type="button" aria-label={`size ${s}`} onClick={() => setSize(s)} style={{ ...chip(size === s), padding: '6px 10px' }}>
                  <span style={{ display: 'inline-block', width: s * 900, height: s * 900, minWidth: 4, minHeight: 4, borderRadius: '50%', background: size === s ? '#111' : '#fff' }} />
                </button>
              ))}
            </div>
          )}
          {panel === 'text' && (
            <div style={row}>
              <input value={txt} onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addText(); }} autoFocus maxLength={80}
                placeholder={t('Type text…', 'اكتب النص…')} style={{ flex: 1, minWidth: 0, borderRadius: 10, border: '1px solid #4b5563', background: '#1f2937', color: '#fff', padding: '8px 10px', fontSize: 16 }} />
              <button type="button" style={chip(true)} onClick={addText}>{t('Add', 'إضافة')}</button>
            </div>
          )}
          {panel === 'stickers' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 110, overflowY: 'auto', flexShrink: 0 }}>
              <button type="button" style={chip(true)} onClick={() => fileRef.current?.click()}>🖼 {t('Your picture', 'صورة من جهازك')}</button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { addPicture(e.target.files?.[0]); e.target.value = ''; }} />
              {EMOJIS.map((em) => (
                <button key={em} type="button" onClick={() => addEmoji(em)} style={{ border: 0, background: 'transparent', fontSize: 26, cursor: 'pointer', padding: 2, lineHeight: 1 }}>{em}</button>
              ))}
            </div>
          )}
        </>
      )}

      {allowViewOnce && (
        <div style={row} role="radiogroup" aria-label={t('How it is opened', 'طريقة العرض')}>
          <button type="button" role="radio" aria-checked={!mode} style={chip(!mode)} onClick={() => setMode(null)}>{t('Normal', 'عادي')}</button>
          <button type="button" role="radio" aria-checked={mode === 'once'} style={chip(mode === 'once')} onClick={() => setMode('once')}>① {t('View once', 'مرة واحدة')}</button>
          <button type="button" role="radio" aria-checked={mode === 'timer'} style={chip(mode === 'timer')} onClick={() => setMode('timer')}>⏱ {t('Timer', 'تايمر')}</button>
          {mode === 'timer' && TIMERS.map((s) => (
            <button key={s} type="button" style={chip(seconds === s)} onClick={() => setSeconds(s)}>{s}{ar ? 'ث' : 's'}</button>
          ))}
        </div>
      )}
      {mode && (
        <div style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0, textAlign: 'center' }}>
          {mode === 'once'
            ? t('The receiver can open it once, then it is deleted from the server.', 'المستلم يفتحها مرة واحدة وبعدها بتتمسح من السيرفر.')
            : t(`After it is opened it disappears ${seconds}s later.`, `بعد ما تتفتح بتختفي بعد ${seconds} ثانية.`)}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
        <button type="button" style={{ ...chip(false), padding: '10px 18px' }} onClick={onBack}>{t('Retake', 'إعادة')}</button>
        <button type="button" disabled={busy || (kind === 'photo' && !img)} style={{ ...chip(true), padding: '10px 26px', background: '#e53e6b', color: '#fff' }} onClick={finish}>{busy ? '…' : t('Done', 'تم')}</button>
      </div>
    </div>
  );
}
