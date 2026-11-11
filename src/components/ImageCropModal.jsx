import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../context/LanguageContext';

/**
 * Pick-then-crop dialog: shows the chosen image in a fixed-aspect frame the user
 * can drag and zoom, with a live preview of exactly what will be saved, and only
 * uploads (via onConfirm) once they press "Apply".
 *
 * Props:
 *   file        File (jpg/png/webp)            — required
 *   aspect      width/height of the output     — e.g. 4 for covers, 1 for avatars
 *   outWidth    output width in px             — height = outWidth / aspect
 *   round       show a circular frame (avatars)
 *   title       dialog title
 *   onCancel()  / onConfirm(File)  — File is a JPEG named after the original
 */
export default function ImageCropModal({ file, aspect = 1, outWidth = 800, round = false, title, onCancel, onConfirm }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const tx = ar
    ? { apply: 'تطبيق ورفع', cancel: 'إلغاء', zoom: 'تكبير', hint: 'اسحب الصورة لتحريكها واستخدم شريط التكبير لاختيار الجزء المناسب.', preview: 'المعاينة', working: 'جارٍ المعالجة…', fail: 'تعذّر قراءة الصورة.' }
    : { apply: 'Apply & upload', cancel: 'Cancel', zoom: 'Zoom', hint: 'Drag the image to reposition it and use the slider to zoom.', preview: 'Preview', working: 'Processing…', fail: 'Could not read this image.' };

  const [src, setSrc] = useState(null);
  const [img, setImg] = useState(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const drag = useRef(null);

  const vw = Math.min(560, (typeof window !== 'undefined' ? window.innerWidth : 600) - 64);
  const vh = vw / aspect;

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    const im = new Image();
    im.onload = () => setImg(im);
    im.onerror = () => setFailed(true);
    im.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const base = img ? Math.max(vw / img.naturalWidth, vh / img.naturalHeight) : 1;
  const scale = base * zoom;
  const clamp = (p, s = scale) => img ? ({
    x: Math.min(0, Math.max(vw - img.naturalWidth * s, p.x)),
    y: Math.min(0, Math.max(vh - img.naturalHeight * s, p.y)),
  }) : p;

  // center on first load
  useEffect(() => {
    if (!img) return;
    setPos({ x: (vw - img.naturalWidth * base) / 2, y: (vh - img.naturalHeight * base) / 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img]);

  const onZoom = (z) => {
    if (!img) return;
    const s2 = base * z;
    // keep the frame center fixed while zooming
    const cx = (vw / 2 - pos.x) / scale;
    const cy = (vh / 2 - pos.y) / scale;
    setZoom(z);
    setPos(clamp({ x: vw / 2 - cx * s2, y: vh / 2 - cy * s2 }, s2));
  };

  const onDown = (e) => { drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const onMove = (e) => {
    if (!drag.current) return;
    setPos(clamp({ x: drag.current.ox + e.clientX - drag.current.sx, y: drag.current.oy + e.clientY - drag.current.sy }));
  };
  const onUp = () => { drag.current = null; };

  const crop = useMemo(() => img ? ({ sx: -pos.x / scale, sy: -pos.y / scale, sw: vw / scale, sh: vh / scale }) : null, [img, pos, scale, vw, vh]);

  // live preview canvas
  const previewRef = useRef(null);
  useEffect(() => {
    if (!img || !crop || !previewRef.current) return;
    const c = previewRef.current;
    const pw = 220; c.width = pw; c.height = Math.round(pw / aspect);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, c.width, c.height);
  }, [img, crop, aspect]);

  const apply = async () => {
    if (!img || !crop) return;
    setBusy(true);
    const w = Math.min(outWidth, Math.round(crop.sw));   // never upscale
    const outW = Math.max(64, Math.min(outWidth, Math.round(crop.sw) || outWidth));
    const c = document.createElement('canvas');
    c.width = outW; c.height = Math.round(outW / aspect);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, c.width, c.height);
    void w;
    c.toBlob((blob) => {
      setBusy(false);
      if (!blob) { setFailed(true); return; }
      const name = (file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg';
      onConfirm(new File([blob], name, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  };

  const overlay = { position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(8,8,16,.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, backdropFilter: 'blur(3px)' };
  const box = { width: 'min(640px, 100%)', maxHeight: '94vh', overflow: 'auto', background: 'var(--bg-surface, #fff)', color: 'var(--text-primary, #111)', borderRadius: 18, padding: 22, boxShadow: '0 30px 80px rgba(0,0,0,.4)', border: '1px solid var(--border-subtle, #eee)' };

  return createPortal(
    <div style={overlay} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div style={box}>
        <h3 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 800 }}>{title}</h3>
        <p style={{ margin: '0 0 14px', fontSize: 12.5, opacity: .7 }}>{tx.hint}</p>

        {failed ? <p style={{ color: 'var(--color-danger, #d33)' }}>{tx.fail}</p> : (
          <>
            <div
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
              style={{ position: 'relative', width: vw, height: vh, margin: '0 auto', overflow: 'hidden', borderRadius: round ? '50%' : 12, background: '#222', cursor: 'grab', touchAction: 'none', userSelect: 'none', outline: '2px solid var(--color-primary, #6A3DF0)', outlineOffset: 2 }}
            >
              {img && src && (
                <img src={src} alt="" draggable={false}
                  style={{ position: 'absolute', left: pos.x, top: pos.y, width: img.naturalWidth * scale, height: img.naturalHeight * scale, maxWidth: 'none', pointerEvents: 'none' }} />
              )}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px auto 0', width: vw, fontSize: 13, fontWeight: 600 }}>
              {tx.zoom}
              <input type="range" min="1" max="4" step="0.01" value={zoom} onChange={(e) => onZoom(parseFloat(e.target.value))} style={{ flex: 1 }} />
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px auto 0', width: vw }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, opacity: .7 }}>{tx.preview}</span>
              <canvas ref={previewRef} style={{ width: round ? 64 : 160, height: round ? 64 : 160 / aspect, borderRadius: round ? '50%' : 8, border: '1px solid var(--border-subtle, #ddd)', background: '#eee' }} />
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>{tx.cancel}</button>
          {!failed && <button type="button" className="btn btn-primary" onClick={apply} disabled={busy || !img}>{busy ? tx.working : tx.apply}</button>}
        </div>
      </div>
    </div>,
    document.body
  );
}
