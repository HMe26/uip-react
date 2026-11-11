import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import Icon from './Icon';
import '../styles/css/share-qr.css';

/**
 * Inline QR panel for a share link: scan with a phone camera to open the link.
 * The QR encodes the exact same URL as "Copy link", so every access rule
 * (expiry, password, one-person, one-time…) still applies to whoever scans it.
 *
 * "Print / PDF" opens an in-page preview of a ready-to-print A4 card (title + QR + link) with
 * Print, Download PDF and Download PNG — no pop-up window.
 */

// A4 @ 150 dpi
const PW = 1240;
const PH = 1754;

const safeFile = (name) => String(name || 'share').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'share';

/** Wraps text to `maxW`; a single over-long token (e.g. a URL) is broken per character. */
function wrapLines(ctx, text, maxW, maxLines) {
  const out = [];
  let line = '';
  const push = () => { if (line) out.push(line); line = ''; };
  const tokens = String(text).split(/(\s+)/).filter((t) => t !== '');
  for (const tok of tokens) {
    if (ctx.measureText(line + tok).width <= maxW) { line += tok; continue; }
    push();
    if (/^\s+$/.test(tok)) continue;
    if (ctx.measureText(tok).width <= maxW) { line = tok; continue; }
    for (const ch of tok) {
      if (ctx.measureText(line + ch).width > maxW) push();
      line += ch;
    }
  }
  push();
  if (out.length > maxLines) {
    const kept = out.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return out;
}

/** Draws the printable card with the browser's own text engine, so Arabic shapes and joins correctly. */
async function buildPoster({ qrPng, name, url, ar }) {
  try { await document.fonts?.ready; } catch { /* fonts API missing — fall back */ }
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const cv = document.createElement('canvas');
  cv.width = PW; cv.height = PH;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, PW, PH);

  // header band
  const grad = ctx.createLinearGradient(0, 0, PW, 0);
  grad.addColorStop(0, '#4f5bff'); grad.addColorStop(1, '#7a5cff');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, PW, 190);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'ltr';
  ctx.fillStyle = '#ffffff'; ctx.font = `800 78px ${family}`;
  ctx.fillText('UIPE', PW / 2, 84);
  ctx.globalAlpha = 0.85; ctx.font = `500 26px ${family}`;
  ctx.fillText('Unified Integrated Platform Ecosystem', PW / 2, 142);
  ctx.globalAlpha = 1;

  // title
  ctx.direction = ar ? 'rtl' : 'ltr';
  ctx.fillStyle = '#111827'; ctx.font = `800 62px ${family}`;
  const titleLines = wrapLines(ctx, name || (ar ? 'رابط مشاركة' : 'Shared link'), PW - 220, 2);
  let y = 330;
  titleLines.forEach((l) => { ctx.fillText(l, PW / 2, y); y += 84; });

  ctx.fillStyle = '#4b5563'; ctx.font = `500 36px ${family}`;
  ctx.fillText(ar ? 'امسح الكود بكاميرا الموبايل لفتح الرابط' : 'Scan with your phone camera to open', PW / 2, y + 14);

  // QR in a rounded frame
  const frame = 860; const pad = 50; const qr = frame - pad * 2;
  const fx = (PW - frame) / 2; const fy = y + 90;
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 4;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(fx, fy, frame, frame, 36); else ctx.rect(fx, fy, frame, frame);
  ctx.fill(); ctx.stroke();
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = qrPng; });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, fx + pad, fy + pad, qr, qr);

  // link
  ctx.direction = 'ltr'; ctx.fillStyle = '#1f2937'; ctx.font = `600 30px ${family}`;
  const urlLines = wrapLines(ctx, url, PW - 260, 3);
  let uy = fy + frame + 70;
  urlLines.forEach((l) => { ctx.fillText(l, PW / 2, uy); uy += 44; });

  // footer
  ctx.direction = ar ? 'rtl' : 'ltr'; ctx.fillStyle = '#6b7280'; ctx.font = `500 28px ${family}`;
  ctx.fillText(ar ? 'نفس قواعد الرابط بتتطبق: المدة، الباسورد، ومين يقدر يفتح.' : 'The same link rules apply: expiry, password and who can open it.', PW / 2, PH - 70);

  return { dataUrl: cv.toDataURL('image/png'), qr: { x: fx + pad, y: fy + pad, s: qr } };
}

const saveHref = (href, fileName) => {
  const a = document.createElement('a');
  a.href = href; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
};

function QrPrintDialog({ url, name, ar, qrPng, onClose, onToast }) {
  const tt = (en, a) => (ar ? a : en);
  const [poster, setPoster] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState('');
  const base = `qr-${safeFile(name)}`;
  const btnRef = useRef(null);

  useEffect(() => {
    let off = false;
    buildPoster({ qrPng, name, url, ar }).then((p) => { if (!off) setPoster(p); }).catch(() => { if (!off) setFailed(true); });
    return () => { off = true; };
  }, [qrPng, name, url, ar]);

  // Esc closes only this preview, not the share dialog underneath it
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    btnRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const printIt = () => {
    if (!poster) return;
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
    f.style.cssText = 'position:fixed;inset-inline-end:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(f);
    const cleanup = () => { try { f.remove(); } catch { /* already gone */ } };
    const d = f.contentDocument;
    d.open();
    d.write('<!doctype html><html><head><meta charset="utf-8"><title>QR</title><style>@page{size:A4;margin:0}html,body{margin:0;padding:0;background:#fff}img{display:block;width:210mm;height:297mm}</style></head><body><img alt=""></body></html>');
    d.close();
    const im = d.querySelector('img');
    im.onload = () => {
      const w = f.contentWindow;
      w.addEventListener('afterprint', () => setTimeout(cleanup, 500));
      w.focus(); w.print();
      setTimeout(cleanup, 120000);
    };
    im.onerror = () => { cleanup(); onToast?.(tt('Could not prepare the print.', 'تعذّر تجهيز الطباعة.'), 'error'); };
    im.src = poster.dataUrl;
  };

  const pdf = async () => {
    if (!poster || busy) return;
    setBusy('pdf');
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
      const k = 210 / PW;
      doc.setProperties({ title: name || 'QR' });
      doc.addImage(poster.dataUrl, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
      doc.link(poster.qr.x * k, poster.qr.y * k, poster.qr.s * k, poster.qr.s * k, { url }); // the QR is clickable inside the PDF too
      doc.save(`${base}.pdf`);
    } catch {
      onToast?.(tt('Could not create the PDF.', 'تعذّر إنشاء ملف الـ PDF.'), 'error');
    } finally { setBusy(''); }
  };

  const png = () => { if (poster) saveHref(poster.dataUrl, `${base}-card.png`); };

  return createPortal(
    <div className="mp-qrp-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mp-qrp" role="dialog" aria-modal="true" aria-label={tt('Print or save the QR', 'طباعة أو حفظ الـ QR')}>
        <div className="mp-qrp__head">
          <h3>{tt('Print or save the QR', 'طباعة أو حفظ الـ QR')}</h3>
          <button type="button" className="mp-qrp__x" onClick={onClose} aria-label={tt('Close', 'إغلاق')}><Icon name="x" size={16} /></button>
        </div>
        <div className="mp-qrp__stage">
          {poster ? <img src={poster.dataUrl} alt={tt('Preview of the printable card', 'معاينة الكارت المطبوع')} /> : <span className="mp-qrp__ph">{failed ? tt('Could not build the preview.', 'تعذّر إنشاء المعاينة.') : tt('Preparing…', 'جارِ التجهيز…')}</span>}
        </div>
        <div className="mp-qrp__btns">
          <button ref={btnRef} type="button" className="btn btn-primary" onClick={printIt} disabled={!poster}><Icon name="ed-print" size={15} /><span>{tt('Print', 'طباعة')}</span></button>
          <button type="button" className="btn btn-ghost" onClick={pdf} disabled={!poster || busy === 'pdf'}><Icon name="file" size={15} /><span>{busy === 'pdf' ? tt('Creating…', 'جارِ الإنشاء…') : tt('Download PDF', 'تنزيل PDF')}</span></button>
          <button type="button" className="btn btn-ghost" onClick={png} disabled={!poster}><Icon name="image" size={15} /><span>{tt('Download image', 'تنزيل كصورة')}</span></button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function ShareQr({ url, name, ar, onToast }) {
  const tt = (en, a) => (ar ? a : en);
  const [png, setPng] = useState('');
  const [err, setErr] = useState(false);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    let off = false;
    setErr(false);
    QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 640, color: { dark: '#000000', light: '#ffffff' } })
      .then((d) => { if (!off) setPng(d); })
      .catch(() => { if (!off) setErr(true); });
    return () => { off = true; };
  }, [url]);

  const fileName = `qr-${safeFile(name)}.png`;

  const download = () => { if (png) saveHref(png, fileName); };

  const copyImage = async () => {
    try {
      if (!png || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('unsupported');
      const blob = await (await fetch(png)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      onToast?.(tt('QR image copied.', 'تم نسخ صورة الـ QR.'));
    } catch {
      onToast?.(tt('Could not copy the image — use Download instead.', 'تعذّر نسخ الصورة — استخدم تنزيل بدلًا منها.'), 'error');
    }
  };

  const closePrint = useCallback(() => setPrinting(false), []);

  return (
    <div className="mp-qr" role="group" aria-label={tt('Share by QR code', 'مشاركة بكود QR')}>
      <div className="mp-qr__img">
        {png ? <img src={png} alt={tt('QR code for the share link', 'كود QR لرابط المشاركة')} width={176} height={176} /> : <span className="mp-qr__ph">{err ? tt('Could not build the QR.', 'تعذّر إنشاء الـ QR.') : tt('Loading…', 'جارِ التحميل…')}</span>}
      </div>
      <div className="mp-qr__side">
        <strong>{tt('Scan to open', 'امسح لفتح الرابط')}</strong>
        <small>{tt('Point a phone camera at the code. The same link rules apply (expiry, password, who can open).', 'وجّه كاميرا الموبايل على الكود. نفس قواعد الرابط بتتطبق (المدة، الباسورد، مين يقدر يفتح).')}</small>
        <div className="mp-qr__btns">
          <button type="button" className="mp-qr__btn" onClick={download} disabled={!png}><Icon name="download" size={14} /><span>{tt('Download', 'تنزيل')}</span></button>
          <button type="button" className="mp-qr__btn" onClick={copyImage} disabled={!png}><Icon name="copy" size={14} /><span>{tt('Copy image', 'نسخ الصورة')}</span></button>
          <button type="button" className="mp-qr__btn" onClick={() => setPrinting(true)} disabled={!png}><Icon name="ed-print" size={14} /><span>{tt('Print / PDF', 'طباعة / PDF')}</span></button>
        </div>
      </div>
      {printing && png && <QrPrintDialog url={url} name={name} ar={ar} qrPng={png} onClose={closePrint} onToast={onToast} />}
    </div>
  );
}
