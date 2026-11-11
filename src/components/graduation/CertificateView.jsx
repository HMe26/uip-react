import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { publicOrigin } from '../../config/siteUrl';
import { printPage } from '../../native';
import { SIGNATURE_H, SIGNATURE_PATH, SIGNATURE_W } from './sealSignature';

/**
 * The graduation certificate itself (toolbar + A4-landscape sheet), shared by the student,
 * faculty and university certificate pages so the three can never drift apart. The pages
 * keep their own data loading and pass in the loaded records plus `t` / `locale`.
 *
 * Design: white paper, one bottle-green ink. The side panel carries a guilloche rosette
 * (the interlaced line work used on banknotes and diplomas, which is also what makes a
 * certificate hard to forge) and a QR code that opens the public verification page.
 * Every size is in `cqw` (1% of the sheet width), so the sheet scales as one picture
 * on screen and prints at exactly 297 x 210 mm.
 */

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Amiri:wght@400;700&display=swap';

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** Hypotrochoid curves stacked with different gear ratios give the moire mesh of a guilloche. */
function guillocheLayers(size) {
  const specs = [
    { a: 120, b: 47, h: 90 },
    { a: 120, b: 53, h: 100 },
    { a: 120, b: 31, h: 70 },
  ];
  return specs.map(({ a, b, h }) => {
    const k = (a - b) / b;
    const scale = (size / 2) / ((a - b) + h);
    const turns = (2 * Math.PI * b) / gcd(a, b);
    const steps = b * 48;
    let d = '';
    for (let i = 0; i <= steps; i += 1) {
      const t = (turns * i) / steps;
      const x = ((a - b) * Math.cos(t) + h * Math.cos(k * t)) * scale + size / 2;
      const y = ((a - b) * Math.sin(t) - h * Math.sin(k * t)) * scale + size / 2;
      d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return `${d}Z`;
  });
}

let rosetteCache = null;
const rosette = () => {
  if (!rosetteCache) rosetteCache = guillocheLayers(400);
  return rosetteCache;
};

/** Scalloped outer edge of the seal: alternating radii around the circle. */
const SEAL_EDGE = (() => {
  const teeth = 44;
  let d = '';
  for (let i = 0; i < teeth * 2; i += 1) {
    const a = (Math.PI * i) / teeth;
    const r = i % 2 ? 93 : 98;
    d += `${i ? 'L' : 'M'}${(100 + r * Math.sin(a)).toFixed(2)} ${(100 - r * Math.cos(a)).toFixed(2)}`;
  }
  return `${d}Z`;
})();

/** The UIPE seal: scalloped edge, lettering around a ring, monogram and issue year in the centre. */
function UipSeal({ year, number }) {
  return (
    <svg className="cv-seal" viewBox="0 0 200 200" role="img" aria-label="UIPE">
      <defs>
        <path id="cv-seal-top" d="M30 100 A70 70 0 0 1 170 100" />
        <path id="cv-seal-bottom" d="M23 100 A77 77 0 0 0 177 100" />
        <path id="cv-seal-micro" d="M12.5 100 a87.5 87.5 0 1 1 175 0 a87.5 87.5 0 1 1 -175 0" />
        <g id="cv-seal-art">
          <path d={SEAL_EDGE} fill="none" strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="100" cy="100" r="86" fill="none" strokeWidth="1" />
          <circle cx="100" cy="100" r="56" fill="none" strokeWidth="1.4" />
          <circle cx="100" cy="100" r="52" fill="none" strokeWidth=".6" />
          <g stroke="none" fontFamily="'Inter','Cairo',system-ui,sans-serif" fontSize="10.5" fontWeight="600" letterSpacing="2.2">
            <text><textPath href="#cv-seal-top" startOffset="50%" textAnchor="middle">UIPE PLATFORM</textPath></text>
            <text><textPath href="#cv-seal-bottom" startOffset="50%" textAnchor="middle">VERIFIED CERTIFICATE</textPath></text>
          </g>
          <text stroke="none" fontFamily="'Inter',system-ui,sans-serif" fontSize="2.7" fontWeight="600">
            <textPath href="#cv-seal-micro" textLength={MICRO_LEN} lengthAdjust="spacing">{microLine(number)}</textPath>
          </text>
          <circle cx="31" cy="100" r="2.2" stroke="none" />
          <circle cx="169" cy="100" r="2.2" stroke="none" />
          <text x="100" y="93" stroke="none" textAnchor="middle" fontFamily="'Newsreader',Georgia,serif" fontSize="27" fontWeight="600" letterSpacing="1">UIPE</text>
          <path d="M72 131 H128" fill="none" strokeWidth=".7" />
          <text x="100" y="145" stroke="none" textAnchor="middle" fontFamily="'Inter',system-ui,sans-serif" fontSize="9.5" fontWeight="500" letterSpacing="1.5">{year}</text>
        </g>
        <mask id="cv-seal-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
          <use href="#cv-seal-art" fill="#fff" stroke="#fff" />
        </mask>
        <linearGradient id="cv-seal-ink" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#10286b" />
          <stop offset=".55" stopColor="#0b1f55" />
          <stop offset="1" stopColor="#0d3a4f" />
        </linearGradient>
        <linearGradient id="cv-seal-sheen" x1="0" y1="0" x2="1" y2=".35">
          <stop offset="0" stopColor="#2fa88a" stopOpacity="0" />
          <stop offset=".3" stopColor="#2fa88a" />
          <stop offset=".5" stopColor="#d4a93f" />
          <stop offset=".7" stopColor="#5b86e0" />
          <stop offset="1" stopColor="#5b86e0" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={SEAL_EDGE} fill="#f1f7f4" stroke="none" />
      <use href="#cv-seal-art" fill="#0d4036" stroke="#0d4036" />
      <g mask="url(#cv-seal-mask)">
        <rect className="cv-wm-sheen cv-seal-sheen" x="-120" y="-20" width="120" height="240" fill="url(#cv-seal-sheen)" />
      </g>
      <g className="cv-seal-sign" transform={`translate(${100 - (SIGNATURE_W * 0.96) / 2} ${113 - (SIGNATURE_H * 0.96) / 2}) rotate(-5 ${(SIGNATURE_W * 0.96) / 2} ${(SIGNATURE_H * 0.96) / 2}) scale(.96)`}>
        <path d={SIGNATURE_PATH} fill="#ffffff" opacity=".85" transform="translate(.45 .55)" />
        <path d={SIGNATURE_PATH} fill="url(#cv-seal-ink)" fillRule="evenodd" />
      </g>
    </svg>
  );
}

/** Bottom of the side panel: the rosette fades into solid bottle green, and the green then warms
 *  into rose towards the QR code. Built from flat translucent layers instead of CSS gradients
 *  with alpha, because PDF viewers draw those unreliably (stray pink/grey bands), while flat
 *  fills print the same everywhere. Layers overlap (each runs to the bottom edge) so there are
 *  no hairline seams, and each one is sized so the stacked opacity follows a smooth ramp. */
const ROSE = '#d94f8c';
const rampLayers = (from, to, steps, max) => {
  const out = [];
  let prev = 0;
  for (let i = 1; i <= steps; i += 1) {
    const target = max * (i / steps);
    out.push({ y: from + (to - from) * ((i - 1) / steps), a: (target - prev) / (1 - prev) });
    prev = target;
  }
  return out;
};
const GREEN_LAYERS = rampLayers(0, 46, 24, 1);
const ROSE_LAYERS = rampLayers(40, 100, 30, 0.86);

function PanelFade() {
  return (
    <svg className="cv-fade" viewBox="0 0 10 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {GREEN_LAYERS.map(({ y, a }) => (
        <rect key={`g${y}`} x="-1" y={y} width="12" height={101 - y} fill="#0d4036" fillOpacity={a.toFixed(4)} />
      ))}
      {ROSE_LAYERS.map(({ y, a }) => (
        <rect key={`r${y}`} x="-1" y={y} width="12" height={101 - y} fill={ROSE} fillOpacity={a.toFixed(4)} />
      ))}
    </svg>
  );
}

/** Fine guilloche border around the white side of the sheet: two interlaced sine bands laid in
 *  a ring, between two hairlines. Same spirit as the rosette on the panel, and just as
 *  awkward to redraw cleanly. Coordinates are in tenths of cqw (the sheet area is 73 x 70.7cqw). */
function GuillocheFrame() {
  const wave = (ph) => {
    let d = '';
    for (let x = 0; x <= 24; x += 1) {
      const y = 7 + 4.6 * Math.sin(((x / 24) * 2 + ph) * Math.PI);
      d += `${x ? 'L' : 'M'}${x} ${y.toFixed(2)}`;
    }
    return d;
  };
  const tile = (
    <>
      <path d={wave(0)} />
      <path d={wave(0.5)} />
      <path d={wave(0.25)} strokeOpacity=".55" />
    </>
  );
  return (
    <svg className="cv-frame" viewBox="0 0 730 707" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="cv-frame-h" width="24" height="14" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="#0d4036" strokeWidth=".55" strokeOpacity=".75">{tile}</g>
        </pattern>
        <pattern id="cv-frame-v" width="24" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(90)">
          <g fill="none" stroke="#0d4036" strokeWidth=".55" strokeOpacity=".75">{tile}</g>
        </pattern>
      </defs>
      <g fill="none" stroke="#0d4036">
        <rect x="14" y="14" width="702" height="679" strokeWidth="1.1" strokeOpacity=".8" />
        <rect x="42" y="42" width="646" height="623" strokeWidth=".6" strokeOpacity=".7" />
      </g>
      <rect x="14" y="14" width="702" height="28" fill="none" />
      <rect x="42" y="14" width="646" height="28" fill="url(#cv-frame-h)" />
      <rect x="42" y="665" width="646" height="28" fill="url(#cv-frame-h)" />
      <rect x="14" y="42" width="28" height="623" fill="url(#cv-frame-v)" />
      <rect x="688" y="42" width="28" height="623" fill="url(#cv-frame-v)" />
      <g fill="#0d4036" fillOpacity=".8">
        <circle cx="28" cy="28" r="3" /><circle cx="702" cy="28" r="3" />
        <circle cx="28" cy="679" r="3" /><circle cx="702" cy="679" r="3" />
      </g>
    </svg>
  );
}

/** Microtext: the certificate number repeated around a ring. It prints as a fine line and only
 *  resolves under magnification, and it is different on every certificate, so a copied seal
 *  from another certificate never matches its own number. */
const microLine = (number) => {
  const unit = `${number || 'UIPE'} • UIPE VERIFIED • `;
  return unit.repeat(Math.max(2, Math.ceil(230 / unit.length)));
};
const MICRO_LEN = 2 * Math.PI * 87.5;

/** Big, faint copy of the seal that sits behind the text as a watermark. A sheen of
 *  holographic colour sweeps across it on screen (clipped to the seal's own lines through an
 *  SVG mask); in print and under reduced motion the sheen stops and rests mid-seal. */
function UipWatermark({ year, number }) {
  return (
    <svg className="cv-wm" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs>
        <path id="cv-wm-top" d="M30 100 A70 70 0 0 1 170 100" />
        <path id="cv-wm-bottom" d="M23 100 A77 77 0 0 0 177 100" />
        <path id="cv-wm-micro" d="M12.5 100 a87.5 87.5 0 1 1 175 0 a87.5 87.5 0 1 1 -175 0" />
        <g id="cv-wm-art">
          <path d={SEAL_EDGE} fill="none" strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="100" cy="100" r="86" fill="none" strokeWidth="1" />
          <circle cx="100" cy="100" r="56" fill="none" strokeWidth="1.4" />
          <circle cx="100" cy="100" r="52" fill="none" strokeWidth=".6" />
          <text stroke="none" fontFamily="'Inter','Cairo',system-ui,sans-serif" fontSize="10.5" fontWeight="600" letterSpacing="2.2">
            <textPath href="#cv-wm-top" startOffset="50%" textAnchor="middle">UIPE PLATFORM</textPath>
          </text>
          <text stroke="none" fontFamily="'Inter','Cairo',system-ui,sans-serif" fontSize="10.5" fontWeight="600" letterSpacing="2.2">
            <textPath href="#cv-wm-bottom" startOffset="50%" textAnchor="middle">VERIFIED CERTIFICATE</textPath>
          </text>
          <text stroke="none" fontFamily="'Inter',system-ui,sans-serif" fontSize="2.7" fontWeight="600">
            <textPath href="#cv-wm-micro" textLength={MICRO_LEN} lengthAdjust="spacing">{microLine(number)}</textPath>
          </text>
          <text x="100" y="109" stroke="none" textAnchor="middle" fontFamily="'Newsreader',Georgia,serif" fontSize="34" fontWeight="600" letterSpacing="1">UIPE</text>
          <path d="M78 118 H122" fill="none" strokeWidth=".8" />
          <text x="100" y="134" stroke="none" textAnchor="middle" fontFamily="'Inter',system-ui,sans-serif" fontSize="11" fontWeight="500" letterSpacing="1.5">{year}</text>
        </g>
        <mask id="cv-wm-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
          <use href="#cv-wm-art" fill="#fff" stroke="#fff" />
        </mask>
        <linearGradient id="cv-wm-sheen" x1="0" y1="0" x2="1" y2=".35">
          <stop offset="0" stopColor="#2fa88a" stopOpacity="0" />
          <stop offset=".3" stopColor="#2fa88a" stopOpacity=".6" />
          <stop offset=".5" stopColor="#d4a93f" stopOpacity=".85" />
          <stop offset=".7" stopColor="#5b86e0" stopOpacity=".6" />
          <stop offset="1" stopColor="#5b86e0" stopOpacity="0" />
        </linearGradient>
      </defs>
      <use href="#cv-wm-art" fill="#0d4036" stroke="#0d4036" opacity=".085" />
      <g mask="url(#cv-wm-mask)">
        <rect className="cv-wm-sheen" x="-120" y="-20" width="120" height="240" fill="url(#cv-wm-sheen)" />
      </g>
    </svg>
  );
}

const css = `
.cv-page{margin:0;background:#eceeed;color:#0e1b17;min-height:100vh;font-family:'Inter','Cairo',system-ui,sans-serif}
.cv-toolbar{padding:14px 24px;background:#fff;border-bottom:1px solid #d9dedc;display:flex;gap:10px}
.cv-print{padding:9px 20px;font:600 13px/1 'Inter','Cairo',system-ui,sans-serif;cursor:pointer;border-radius:6px;border:1px solid #0d4036;background:#0d4036;color:#fff}
.cv-print:hover{background:#0a342c}
.cv-print:focus-visible{outline:3px solid #7cc4ad;outline-offset:2px}
.cv-wrap{padding:32px 16px}
.cv-sheet{container-type:inline-size;width:min(1123px,100%);aspect-ratio:297/210;margin:0 auto;background:#fff;display:grid;grid-template-columns:27% 1fr;overflow:hidden;box-shadow:0 1px 2px rgba(14,27,23,.12),0 12px 40px rgba(14,27,23,.14);font-variant-numeric:tabular-nums}
.cv-panel{position:relative;background:#0d4036;color:#e3f0eb;padding:3.2cqw 2.6cqw;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden}
.cv-rosette{position:absolute;width:38cqw;height:38cqw;inset-inline-start:-5.5cqw;top:12cqw;pointer-events:none}
.cv-fade{position:absolute;inset-inline:0;bottom:0;width:100%;height:52%;pointer-events:none}
.cv-org,.cv-verify{position:relative;z-index:1}
.cv-org-name{font:500 2.15cqw/1.25 'Newsreader','Amiri',Georgia,serif;color:#fff;margin:0;text-wrap:balance}
.cv-org-sub{font:400 1.15cqw/1.4 'Inter','Cairo',system-ui,sans-serif;color:#a5cbbd;margin:.7cqw 0 0}
.cv-qr{width:9.6cqw;padding:.9cqw;background:#fff;border-radius:.5cqw;box-sizing:border-box}
.cv-qr svg{display:block;width:100%;height:auto}
.cv-verify-hint{font:400 1.1cqw/1.4 'Inter','Cairo',system-ui,sans-serif;color:#ffeaf3;margin:.9cqw 0 1.5cqw}
.cv-verify-label{font:400 1.05cqw/1.3 'Inter','Cairo',system-ui,sans-serif;color:#ffdcea;margin:0}
.cv-verify-url{font:400 .95cqw/1.3 'Inter','Cairo',system-ui,sans-serif;color:#ffd6e6;margin:-.9cqw 0 1.3cqw;overflow-wrap:anywhere;direction:ltr;text-align:start}
.cv-verify-code{font:600 1.15cqw/1.3 'Inter','Cairo',system-ui,sans-serif;color:#fff;letter-spacing:.12em;margin:.25cqw 0 0;direction:ltr;text-align:start}
.cv-verify-gap{margin-top:1cqw}
.cv-verify-no{font:600 1.35cqw/1.3 'Inter','Cairo',system-ui,sans-serif;color:#fff;margin:.25cqw 0 0;overflow-wrap:anywhere}
.cv-main{position:relative;padding:5.4cqw 6.2cqw 6cqw;display:flex;flex-direction:column;min-width:0}
.cv-main>*{position:relative;z-index:1}
.cv-main>.cv-frame{position:absolute;z-index:0;inset:0;width:100%;height:100%;pointer-events:none}
.cv-main>.cv-wm{position:absolute;z-index:0;width:35cqw;height:35cqw;inset-inline-end:4.6cqw;top:43%;margin-top:-17.5cqw;transform:rotate(-12deg);pointer-events:none;direction:ltr}
.cv-wm-sheen{animation:cv-wm-sweep 7s ease-in-out infinite}
@keyframes cv-wm-sweep{0%,12%{transform:translateX(0)}88%,100%{transform:translateX(320px)}}
@media (prefers-reduced-motion:reduce){.cv-wm-sheen{animation:none;transform:translateX(130px)}}
.cv-title{font:500 2.7cqw/1.2 'Newsreader','Amiri',Georgia,serif;color:#0d4036;margin:0 0 4.2cqw}
.cv-lead{font:400 1.5cqw/1.4 'Inter','Cairo',system-ui,sans-serif;color:#5c6b66;margin:auto 0 0}
.cv-name{font:500 6.6cqw/1.1 'Newsreader','Amiri',Georgia,serif;color:#0e1b17;margin:1cqw 0 1.8cqw;text-wrap:balance}
.cv-name.is-fit{white-space:nowrap;text-wrap:nowrap}
.cv-body{font:400 1.95cqw/1.7 'Newsreader','Amiri',Georgia,serif;color:#26332f;margin:0 0 auto;max-width:52cqw}
.cv-body strong{font-weight:600;color:#0e1b17}
.cv-meta{margin:3cqw 0 0;padding:1.5cqw 0 0;border-top:1px solid #d5e0db;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2.4cqw}
.cv-meta div{min-width:0}
.cv-meta dt{font:400 1.1cqw/1.3 'Inter','Cairo',system-ui,sans-serif;color:#5c6b66;margin:0}
.cv-meta dd{font:500 1.75cqw/1.3 'Newsreader','Amiri',Georgia,serif;color:#0e1b17;margin:.4cqw 0 0}
.cv-sign{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:3cqw;margin-top:2.6cqw}
.cv-seal{display:block;width:10.5cqw;height:10.5cqw}
.cv-sig{position:relative;min-width:0}
.cv-sig-line{border-top:1px solid #0e1b17;padding-top:.8cqw}
.cv-sig-art{position:absolute;inset-inline:0;bottom:calc(100% - .15cqw);height:8cqw;pointer-events:none}
.cv-sig-img{position:absolute;inset-inline-start:1cqw;bottom:.2cqw;max-width:62%;max-height:6.2cqw;object-fit:contain;mix-blend-mode:multiply;z-index:1}
.cv-sig-stamp{position:absolute;inset-inline-end:.5cqw;bottom:-1cqw;width:8.4cqw;height:8.4cqw;object-fit:contain;mix-blend-mode:multiply;opacity:.9;transform:rotate(-8deg)}
.cv-sig-line b{display:block;font:600 1.4cqw/1.3 'Newsreader','Amiri',Georgia,serif}
.cv-sig-line span{display:block;font:400 1.05cqw/1.4 'Inter','Cairo',system-ui,sans-serif;color:#5c6b66;margin-top:.2cqw}
.cv-sheet[dir=rtl] :not(svg):not(svg *){letter-spacing:0}
.cv-seal,.cv-wm{direction:ltr}
@media (max-width:640px){.cv-wrap{padding:16px 8px}.cv-toolbar{padding:12px 16px}}
@media print{
  .cv-toolbar{display:none}
  .cv-page{background:#fff;min-height:0}
  .cv-wrap{padding:0}
  .cv-sheet{width:297mm;height:210mm;aspect-ratio:auto;margin:0;box-shadow:none;break-inside:avoid}
  .cv-sheet,.cv-sheet *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .cv-wm-sheen{animation:none;transform:translateX(130px)}
  @page{size:A4 landscape;margin:0}
}
`;

/** Images uploaded by the university (signature, stamp, dean's signature). Only plain http(s),
 *  same-site paths and PNG/JPEG/WebP data URLs are accepted, anything else is dropped. */
const safeImg = (u) => {
  const v = String(u || '').trim();
  return /^(https?:\/\/|\/(?!\/)|data:image\/(png|jpeg|webp);base64,)/i.test(v) ? v : '';
};
const hideBroken = (e) => { e.currentTarget.style.display = 'none'; };

export default function CertificateView({ student, graduation, university, t, locale }) {
  const ar = locale === 'ar';
  const dir = ar ? 'rtl' : 'ltr';
  const [qr, setQr] = useState('');

  // The page text is bilingual; the display serif and Arabic naskh are loaded on demand.
  useEffect(() => {
    if (document.getElementById('cv-fonts')) return;
    const link = document.createElement('link');
    link.id = 'cv-fonts';
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    document.head.appendChild(link);
  }, []);

  const pick = (en, arText) => (ar ? (arText || en) : (en || arText)) || '';
  const universityName = university
    ? pick(university.official_name_en, university.official_name_ar)
    : t('The University');
  const degreeTitle = pick(graduation.degree_title_en, graduation.degree_title_ar);
  const facultyName = pick(graduation.faculty_name_en, graduation.faculty_name_ar);
  const departmentName = pick(graduation.department_name_en, graduation.department_name_ar);
  const number = String(graduation.certificate_number || '');
  const securityCodeRaw = String(graduation.security_code || '');
  const verifyUrl = `${publicOrigin()}/verify-certificate?number=${encodeURIComponent(number)}${securityCodeRaw ? `&code=${encodeURIComponent(securityCodeRaw)}` : ''}`;
  const fmtDate = (v) => {
    if (!v) return '—';
    const d = new Date(v);
    return ar
      ? d.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' })
      : d.toLocaleDateString('en-GB');
  };
  // Follow the certificate language: name_en in English mode, name_ar in Arabic mode; full_name is only the fallback.
  const fullName = (ar ? student.name_ar : student.name_en) || student.full_name || student.name_en || student.name_ar || '';
  // One line whenever it can fit: shrink with the name's length instead of wrapping early.
  const nameLen = [...fullName].length || 1;
  const nameFit = nameLen <= 42;
  const nameSize = Math.max(2.9, Math.min(6.6, 58 / (nameLen * 0.52)));
  const signerName = pick(graduation.signatory_name_en, graduation.signatory_name_ar)
    || (university ? pick(university.dean_name_en, university.dean_name_ar) : '');
  const universitySignature = safeImg(university && university.signature_url);
  const universityStamp = safeImg(university && university.stamp_url);
  const deanSignature = safeImg(graduation.signatory_signature_url || (university && university.dean_signature_url));
  const signerTitle = pick(graduation.signatory_title_en, graduation.signatory_title_ar)
    || (university ? pick(university.dean_title_en, university.dean_title_ar) : '')
    || t('Dean / Registrar');
  const securityCode = String(graduation.security_code || '');
  const verifyHost = (() => { try { return `${new URL(verifyUrl).host}/verify-certificate`; } catch { return ''; } })();
  const sealYear = new Date(graduation.approved_at || graduation.graduation_date || Date.now()).getFullYear() || new Date().getFullYear();
  const hasGpa = graduation.final_gpa !== null && graduation.final_gpa !== undefined && graduation.final_gpa !== '';

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(verifyUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0d4036', light: '#ffffff' } })
      .then((svg) => { if (!cancelled) setQr(svg); })
      .catch(() => { if (!cancelled) setQr(''); });
    return () => { cancelled = true; };
  }, [verifyUrl]);

  const layers = useMemo(() => rosette(), []);

  return (
    <div className="cv-page" dir={dir}>
      <style>{css}</style>

      <div className="cv-toolbar">
        <button type="button" className="cv-print" onClick={() => printPage({ name: `Certificate-${number}`, landscape: true })}>{t('🖨 Print Certificate')}</button>
      </div>

      <div className="cv-wrap">
        <article className="cv-sheet" dir={dir} aria-label={t('Certificate of Graduation')}>
          <aside className="cv-panel">
            <svg className="cv-rosette" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
              <g fill="none" stroke="#6fc2a8" strokeOpacity=".5" strokeWidth=".45">
                {layers.map((d, i) => <path key={i} d={d} />)}
              </g>
              <circle cx="200" cy="200" r="196" fill="none" stroke="#6fc2a8" strokeOpacity=".6" strokeWidth=".9" />
              <circle cx="200" cy="200" r="190" fill="none" stroke="#6fc2a8" strokeOpacity=".4" strokeWidth=".45" />
            </svg>

            <PanelFade />

            <div className="cv-org">
              <p className="cv-org-name">{universityName}</p>
              {facultyName && <p className="cv-org-sub">{facultyName}</p>}
            </div>

            <div className="cv-verify">
              {qr && <div className="cv-qr" dangerouslySetInnerHTML={{ __html: qr }} />}
              <p className="cv-verify-hint">{t('Scan to verify this certificate')}</p>
              {verifyHost && <p className="cv-verify-url">{verifyHost}</p>}
              <p className="cv-verify-label">{t('Certificate No.')}</p>
              <p className="cv-verify-no" dir="ltr">{number}</p>
              {securityCode && (
                <>
                  <p className="cv-verify-label cv-verify-gap">{t('Security Code')}</p>
                  <p className="cv-verify-code">{securityCode}</p>
                </>
              )}
            </div>
          </aside>

          <section className="cv-main">
            <GuillocheFrame />
            <UipWatermark year={sealYear} number={number} />
            <h1 className="cv-title">{t('Certificate of Graduation')}</h1>

            <p className="cv-lead">{ar ? `تشهد إدارة ${universityName} بأن الطالب/ة` : t('This is to certify that')}</p>
            <p className={`cv-name${nameFit ? ' is-fit' : ''}`} style={{ fontSize: `${nameSize}cqw` }}>{fullName}</p>

            <p className="cv-body">
              {degreeTitle ? (
                <>
                  {t('has successfully fulfilled all prescribed academic requirements and has accordingly been conferred the degree of')}{' '}
                  <strong>{degreeTitle}</strong>
                  {departmentName ? <>{ar ? '، ' : ', '}{departmentName}</> : null}.
                </>
              ) : t('has successfully fulfilled all prescribed graduation requirements.')}
            </p>

            <dl className="cv-meta">
              <div><dt>{t('Graduation Date')}</dt><dd>{fmtDate(graduation.graduation_date)}</dd></div>
              {hasGpa && <div><dt>{t('Final GPA')}</dt><dd>{graduation.final_gpa}</dd></div>}
              <div><dt>{t('Issue Date')}</dt><dd>{fmtDate(graduation.approved_at)}</dd></div>
            </dl>

            <div className="cv-sign">
              <div className="cv-sig">
                {(universitySignature || universityStamp) && (
                  <div className="cv-sig-art" aria-hidden="true">
                    {universityStamp && <img className="cv-sig-stamp" src={universityStamp} alt="" onError={hideBroken} />}
                    {universitySignature && <img className="cv-sig-img" src={universitySignature} alt="" onError={hideBroken} />}
                  </div>
                )}
                <div className="cv-sig-line"><b>{universityName}</b><span>{t('University Seal & Signature')}</span></div>
              </div>
              <UipSeal year={sealYear} number={number} />
              <div className="cv-sig">
                {deanSignature && (
                  <div className="cv-sig-art" aria-hidden="true">
                    <img className="cv-sig-img" src={deanSignature} alt="" onError={hideBroken} />
                  </div>
                )}
                <div className="cv-sig-line"><b>{signerName || signerTitle}</b><span>{signerName ? signerTitle : t('Authorized Academic Signature')}</span></div>
              </div>
            </div>
          </section>
        </article>
      </div>
    </div>
  );
}
