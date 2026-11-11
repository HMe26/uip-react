import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Where a university uploads the images that are stamped on its certificates: the university's
 * signature, its round stamp, and the dean's signature. The certificate page (CertificateView)
 * picks them up from `university.signature_url`, `university.stamp_url` and
 * `university.dean_signature_url`, so nothing else has to be done per certificate.
 *
 * The component is storage-agnostic: it prepares the image in the browser (drops the paper
 * background of a photo or scan, trims the empty margin, limits the size, re-encodes as PNG)
 * and hands the result to `onUpload(kind, blob)`, which must return `{ url }`.
 *
 * Props
 *   value        { signature_url, stamp_url, dean_signature_url,
 *                  dean_name_en, dean_name_ar, dean_title_en, dean_title_ar }
 *   onUpload     async (kind, blob, file) => ({ url })     kind: 'signature' | 'stamp' | 'dean_signature'
 *   onRemove     async (kind) => void
 *   onSaveDean   async ({ dean_name_en, dean_name_ar, dean_title_en, dean_title_ar }) => void   (optional)
 *   t            translate function (defaults to identity)
 *   locale       'en' | 'ar'
 */

const MAX_BYTES = 8 * 1024 * 1024;
const OUT_MAX_SIDE = 900;
const WORK_MAX_SIDE = 1800;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Smooth 0..1 step between two edges. */
const smooth = (a, b, x) => {
  const v = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return v * v * (3 - 2 * v);
};

const loadBitmap = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
  img.src = url;
});

/**
 * Turns a photo/scan of a signature or stamp into a transparent PNG.
 * Paper colour is estimated from the brightest pixels; everything close to it becomes
 * transparent, ink keeps its own colour. Images that already have transparency are left alone.
 */
export async function prepareBrandingImage(file, { removeBackground = true } = {}) {
  if (!TYPES.includes(file.type)) throw new Error('type');
  if (file.size > MAX_BYTES) throw new Error('size');

  const img = await loadBitmap(file);
  const k = Math.min(1, WORK_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;

  let hasAlpha = false;
  for (let i = 3; i < px.length; i += 4 * 97) if (px[i] < 250) { hasAlpha = true; break; }

  if (removeBackground && !hasAlpha) {
    // Paper colour: average of the brightest 25% of a pixel sample.
    const sample = [];
    const step = Math.max(1, Math.floor((w * h) / 20000));
    for (let p = 0; p < w * h; p += step) {
      const i = p * 4;
      sample.push([px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11, px[i], px[i + 1], px[i + 2]]);
    }
    sample.sort((a, b) => b[0] - a[0]);
    const top = sample.slice(0, Math.max(1, Math.floor(sample.length * 0.25)));
    const paper = [1, 2, 3].map((c) => top.reduce((s, v) => s + v[c], 0) / top.length);
    for (let i = 0; i < px.length; i += 4) {
      const d = Math.hypot(px[i] - paper[0], px[i + 1] - paper[1], px[i + 2] - paper[2]);
      const a = Math.round(255 * smooth(30, 90, d));
      px[i + 3] = a;
      if (a === 0) { px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; } // smaller PNG: no colour data under transparency
    }
    ctx.putImageData(data, 0, 0);
  }

  // Trim the transparent margin.
  let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (px[(y * w + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('empty');
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const s = Math.min(1, OUT_MAX_SIDE / Math.max(cw, ch));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(cw * s));
  out.height = Math.max(1, Math.round(ch * s));
  const octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(canvas, x0, y0, cw, ch, 0, 0, out.width, out.height);
  const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('encode');
  return blob;
}

const SLOTS = [
  { kind: 'signature', field: 'signature_url', en: 'University signature', ar: 'توقيع الجامعة', hintEn: 'Placed above the "University Seal & Signature" line.', hintAr: 'يظهر فوق خط «ختم وتوقيع الجامعة».' },
  { kind: 'stamp', field: 'stamp_url', en: 'University stamp', ar: 'ختم الجامعة', hintEn: 'Round or square stamp, overlaps the signature slightly like a real one.', hintAr: 'ختم دائري أو مربع، يتداخل مع التوقيع قليلًا كالحقيقي.' },
  { kind: 'dean_signature', field: 'dean_signature_url', en: "Dean's signature", ar: 'توقيع العميد', hintEn: 'Placed above the dean / registrar line.', hintAr: 'يظهر فوق خط العميد / المسجّل.' },
];

const css = `
.ub{font-family:'Inter','Cairo',system-ui,sans-serif;color:#0e1b17;max-width:980px}
.ub h2{font:600 18px/1.3 'Inter','Cairo',system-ui,sans-serif;margin:0 0 4px}
.ub-lead{margin:0 0 18px;color:#5c6b66;font-size:14px;line-height:1.5}
.ub-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
.ub-card{border:1px solid #d9dedc;border-radius:10px;background:#fff;padding:14px;display:flex;flex-direction:column;gap:10px}
.ub-card h3{margin:0;font:600 14px/1.3 'Inter','Cairo',system-ui,sans-serif}
.ub-hint{margin:0;color:#5c6b66;font-size:12px;line-height:1.4}
.ub-drop{position:relative;height:130px;border:1.5px dashed #9db3ab;border-radius:8px;background:#fff;display:flex;align-items:center;justify-content:center;text-align:center;font-size:13px;color:#5c6b66;cursor:pointer;overflow:hidden;padding:8px;box-sizing:border-box}
.ub-drop:hover,.ub-drop.is-over{border-color:#0d4036;background:#f1f7f4}
.ub-drop:focus-within{outline:3px solid #7cc4ad;outline-offset:2px}
.ub-drop input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}
.ub-drop img{max-width:100%;max-height:100%;object-fit:contain;mix-blend-mode:multiply}
.ub-paper{background:#fff;background-image:linear-gradient(#0000 0 0),repeating-conic-gradient(#f0f2f1 0 25%,#fff 0 50%);background-size:auto,14px 14px}
.ub-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ub-check{display:flex;gap:6px;align-items:center;font-size:12px;color:#26332f}
.ub-btn{padding:7px 14px;font:600 12px/1 'Inter','Cairo',system-ui,sans-serif;border-radius:6px;border:1px solid #0d4036;background:#0d4036;color:#fff;cursor:pointer}
.ub-btn.is-ghost{background:#fff;color:#0d4036}
.ub-btn:disabled{opacity:.55;cursor:default}
.ub-err{color:#b3261e;font-size:12px;margin:0}
.ub-ok{color:#0d6b4f;font-size:12px;margin:0}
.ub-dean{margin-top:18px;border:1px solid #d9dedc;border-radius:10px;background:#fff;padding:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.ub-dean label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#5c6b66}
.ub-dean input{padding:8px 10px;border:1px solid #c5cfcb;border-radius:6px;font:14px 'Inter','Cairo',system-ui,sans-serif;color:#0e1b17}
.ub-dean input:focus-visible{outline:3px solid #7cc4ad;outline-offset:1px}
`;

const ERRORS = {
  type: ['Use a PNG, JPG or WebP image.', 'استخدم صورة بصيغة PNG أو JPG أو WebP.'],
  size: ['The image is larger than 8 MB.', 'حجم الصورة أكبر من 8 ميجابايت.'],
  empty: ['No signature or stamp was found in the image. Try a clearer photo on white paper.', 'لم نجد توقيعًا أو ختمًا في الصورة. جرّب صورة أوضح على ورقة بيضاء.'],
  unreadable: ['This file could not be read as an image.', 'تعذّرت قراءة هذا الملف كصورة.'],
  upload: ['Upload failed, please try again.', 'فشل الرفع، حاول مرة أخرى.'],
};

function Slot({ slot, url, onUpload, onRemove, ar, t }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [removeBg, setRemoveBg] = useState(true);
  const [over, setOver] = useState(false);
  const [pending, setPending] = useState(null); // { blob, preview }
  const lastFile = useRef(null);

  useEffect(() => () => { if (pending) URL.revokeObjectURL(pending.preview); }, [pending]);

  const prepare = useCallback(async (file, bg) => {
    setError(''); setDone(false); setBusy(true);
    try {
      const blob = await prepareBrandingImage(file, { removeBackground: bg });
      setPending({ blob, preview: URL.createObjectURL(blob) });
    } catch (e) {
      const key = ERRORS[e.message] ? e.message : 'unreadable';
      setError(ERRORS[key][ar ? 1 : 0]);
      setPending(null);
    } finally { setBusy(false); }
  }, [ar]);

  const pick = (file) => { if (!file) return; lastFile.current = file; prepare(file, removeBg); };

  const save = async () => {
    if (!pending) return;
    setBusy(true); setError('');
    try {
      await onUpload(slot.kind, pending.blob, lastFile.current);
      setPending(null); setDone(true);
    } catch (e) { setError(ERRORS.upload[ar ? 1 : 0]); } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true); setError(''); setDone(false);
    try { await onRemove(slot.kind); } catch (e) { setError(ERRORS.upload[ar ? 1 : 0]); } finally { setBusy(false); }
  };

  const shown = pending ? pending.preview : url;
  return (
    <section className="ub-card" aria-label={ar ? slot.ar : slot.en}>
      <h3>{t(ar ? slot.ar : slot.en)}</h3>
      <p className="ub-hint">{ar ? slot.hintAr : slot.hintEn}</p>
      <div
        className={`ub-drop${over ? ' is-over' : ''}${shown ? ' ub-paper' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files && e.dataTransfer.files[0]); }}
      >
        {shown ? <img src={shown} alt="" /> : <span>{ar ? 'اسحب الصورة هنا أو اضغط للاختيار' : 'Drop an image here or click to choose'}</span>}
        <input type="file" accept={TYPES.join(',')} aria-label={ar ? slot.ar : slot.en} onChange={(e) => { pick(e.target.files && e.target.files[0]); e.target.value = ''; }} />
      </div>
      <label className="ub-check">
        <input
          type="checkbox"
          checked={removeBg}
          onChange={(e) => { setRemoveBg(e.target.checked); if (lastFile.current && pending) prepare(lastFile.current, e.target.checked); }}
        />
        {ar ? 'إزالة خلفية الورق تلقائيًا' : 'Remove the paper background automatically'}
      </label>
      <div className="ub-row">
        {pending && <button type="button" className="ub-btn" onClick={save} disabled={busy}>{ar ? 'حفظ' : 'Save'}</button>}
        {pending && <button type="button" className="ub-btn is-ghost" onClick={() => setPending(null)} disabled={busy}>{ar ? 'إلغاء' : 'Cancel'}</button>}
        {!pending && url && <button type="button" className="ub-btn is-ghost" onClick={remove} disabled={busy}>{ar ? 'حذف' : 'Remove'}</button>}
      </div>
      {busy && <p className="ub-hint" role="status">{ar ? 'جارٍ المعالجة…' : 'Working…'}</p>}
      {error && <p className="ub-err" role="alert">{error}</p>}
      {done && !error && <p className="ub-ok" role="status">{ar ? 'تم الحفظ، وستظهر على الشهادات تلقائيًا.' : 'Saved. It now appears on your certificates automatically.'}</p>}
    </section>
  );
}

export default function UniversityBrandingUploader({ value = {}, onUpload, onRemove, onSaveDean, t = (x) => x, locale = 'en' }) {
  const ar = locale === 'ar';
  const [dean, setDean] = useState({
    dean_name_en: value.dean_name_en || '', dean_name_ar: value.dean_name_ar || '',
    dean_title_en: value.dean_title_en || '', dean_title_ar: value.dean_title_ar || '',
  });
  const [saved, setSaved] = useState(false);
  const set = (k) => (e) => { setSaved(false); setDean((d) => ({ ...d, [k]: e.target.value })); };

  return (
    <div className="ub" dir={ar ? 'rtl' : 'ltr'}>
      <style>{css}</style>
      <h2>{ar ? 'توقيعات وأختام الجامعة' : 'University signatures and stamps'}</h2>
      <p className="ub-lead">
        {ar
          ? 'ارفع صورة التوقيع أو الختم (يفضّل ورقة بيضاء وإضاءة جيدة). تُضاف تلقائيًا على كل شهادات جامعتك، ولا تحتاج لتعديل أي شهادة.'
          : 'Upload a photo or scan of the signature or stamp (white paper and good light work best). It is added automatically to every certificate of your university; no certificate needs editing.'}
      </p>
      <div className="ub-grid">
        {SLOTS.map((slot) => (
          <Slot key={slot.kind} slot={slot} url={value[slot.field]} onUpload={onUpload} onRemove={onRemove} ar={ar} t={t} />
        ))}
      </div>
      {onSaveDean && (
        <div className="ub-dean">
          <label>{ar ? 'اسم العميد (EN)' : 'Dean name (EN)'}<input value={dean.dean_name_en} onChange={set('dean_name_en')} dir="ltr" /></label>
          <label>{ar ? 'اسم العميد (AR)' : 'Dean name (AR)'}<input value={dean.dean_name_ar} onChange={set('dean_name_ar')} dir="rtl" /></label>
          <label>{ar ? 'المنصب (EN)' : 'Title (EN)'}<input value={dean.dean_title_en} onChange={set('dean_title_en')} dir="ltr" /></label>
          <label>{ar ? 'المنصب (AR)' : 'Title (AR)'}<input value={dean.dean_title_ar} onChange={set('dean_title_ar')} dir="rtl" /></label>
          <div className="ub-row" style={{ gridColumn: '1 / -1' }}>
            <button type="button" className="ub-btn" onClick={async () => { await onSaveDean(dean); setSaved(true); }}>{ar ? 'حفظ بيانات العميد' : 'Save dean details'}</button>
            {saved && <span className="ub-ok" role="status">{ar ? 'تم الحفظ' : 'Saved'}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
