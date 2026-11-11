const blob = (x, y, c, r = 55) => `radial-gradient(${r}% ${r}% at ${x}% ${y}%, ${c}, transparent 62%)`;

/** Flowing, macOS-style artwork drawn as SVG (soft blurred ribbons / hills) and used as a CSS background. */
const art = (defs, body, base) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice"><defs>${defs}<filter id="fb" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="38"/></filter><filter id="fs" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="6"/></filter></defs>${body}</svg>`;
  return `center / cover no-repeat url("data:image/svg+xml,${encodeURIComponent(svg)}"), ${base}`;
};
const lg = (id, a, b, c = '') => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/>${c ? `<stop offset=".55" stop-color="${c}"/>` : ''}<stop offset="1" stop-color="${b}"/></linearGradient>`;

const SEQUOIA = art(
  lg('a', '#5eead4', '#6366f1') + lg('b', '#a78bfa', '#22d3ee') + lg('c', '#0ea5e9', '#7c3aed') + '<radialGradient id="g" cx=".15" cy=".05" r=".8"><stop offset="0" stop-color="#7dd3fc" stop-opacity=".55"/><stop offset="1" stop-color="#7dd3fc" stop-opacity="0"/></radialGradient>',
  '<rect width="1600" height="1000" fill="url(#g)"/><g filter="url(#fb)" opacity=".9"><path d="M-100 620C200 380 420 760 760 560S1250 240 1750 420V1100H-100Z" fill="url(#c)" opacity=".75"/><path d="M-100 760C260 560 560 900 900 720S1380 520 1750 640V1100H-100Z" fill="url(#b)" opacity=".7"/></g><g filter="url(#fs)" opacity=".55"><path d="M-50 700C260 520 520 840 860 650S1340 470 1700 560" fill="none" stroke="#e0f2fe" stroke-width="3"/><path d="M-50 560C300 340 560 700 900 500S1320 300 1700 380" fill="none" stroke="#c4b5fd" stroke-width="2"/></g>',
  'linear-gradient(160deg, #04121f, #0b1f3a 45%, #1b1647)');

const SONOMA = art(
  lg('a', '#fda4af', '#c4b5fd') + lg('h1', '#b8a9e9', '#8e9bdc') + lg('h2', '#7c8fd4', '#5a76b8') + lg('h3', '#8fbf7a', '#4f8a53') + lg('h4', '#5f9b57', '#2f6a47') + '<radialGradient id="sun" cx=".78" cy=".18" r=".5"><stop offset="0" stop-color="#fff7d6" stop-opacity=".95"/><stop offset="1" stop-color="#ffd8a8" stop-opacity="0"/></radialGradient>',
  '<rect width="1600" height="1000" fill="url(#sun)"/><path d="M-50 560C250 430 520 560 820 470S1330 380 1700 500V1100H-50Z" fill="url(#h1)" opacity=".85"/><path d="M-50 650C300 520 560 690 900 590S1380 520 1700 600V1100H-50Z" fill="url(#h2)" opacity=".9"/><path d="M-50 770C260 660 600 820 940 730S1400 650 1700 740V1100H-50Z" fill="url(#h3)"/><path d="M-50 880C320 790 640 930 1000 860S1420 800 1700 870V1100H-50Z" fill="url(#h4)"/>',
  'linear-gradient(180deg, #ffd9b8 0%, #f9d5e5 38%, #c9d4ff 70%, #b7c6f5 100%)');

const BIGSUR = art(
  lg('a', '#ff5e9c', '#ff9a4d') + lg('b', '#7c3aed', '#3b82f6') + lg('c', '#f43f5e', '#a855f7') + lg('d', '#fb923c', '#ec4899'),
  '<g filter="url(#fb)"><path d="M-100 700C220 420 520 900 860 640S1320 300 1750 520V1100H-100Z" fill="url(#b)" opacity=".85"/><path d="M-100 540C260 280 560 640 900 420S1360 140 1750 340V1100H-100Z" fill="url(#c)" opacity=".8"/><path d="M-100 820C300 620 640 980 980 800S1400 640 1750 760V1100H-100Z" fill="url(#d)" opacity=".85"/></g><g filter="url(#fs)" opacity=".35"><path d="M-50 660C300 400 600 840 940 600S1380 280 1700 450" fill="none" stroke="#fff" stroke-width="2"/></g>',
  'linear-gradient(160deg, #1a0b3b, #3b0f5c 55%, #5b1a4f)');

const MONTEREY = art(
  lg('a', '#f9a8d4', '#a78bfa') + lg('b', '#93c5fd', '#c4b5fd') + lg('c', '#fda4af', '#f0abfc') + lg('d', '#7dd3fc', '#818cf8'),
  '<g filter="url(#fb)" opacity=".95"><path d="M-100 360C300 140 520 520 860 380S1300 120 1750 300V700C1300 560 1100 880 760 760S240 560-100 760Z" fill="url(#a)" opacity=".8"/><path d="M-100 700C260 520 560 900 900 720S1380 520 1750 700V1100H-100Z" fill="url(#d)" opacity=".8"/><path d="M200 -100C520 120 480 420 820 360S1300 160 1500 -100Z" fill="url(#c)" opacity=".7"/></g>',
  'linear-gradient(160deg, #fdf2f8, #ede9fe 50%, #e0f2fe)');

const TAHOE = art(
  lg('a', '#38bdf8', '#2563eb') + lg('b', '#22d3ee', '#6366f1') + lg('c', '#1e40af', '#0ea5e9') + '<radialGradient id="g" cx=".5" cy="0" r=".9"><stop offset="0" stop-color="#bae6fd" stop-opacity=".7"/><stop offset="1" stop-color="#bae6fd" stop-opacity="0"/></radialGradient>',
  '<rect width="1600" height="1000" fill="url(#g)"/><g filter="url(#fb)"><path d="M-100 540C260 300 560 700 900 500S1340 220 1750 420V1100H-100Z" fill="url(#a)" opacity=".7"/><path d="M-100 760C300 560 620 920 960 740S1380 560 1750 700V1100H-100Z" fill="url(#c)" opacity=".85"/><path d="M300 -100C600 160 760 360 1000 300S1400 100 1700 -100Z" fill="url(#b)" opacity=".6"/></g>',
  'linear-gradient(170deg, #cfe8ff, #7cb7ff 55%, #2f5fd0)');

export const WALLPAPERS = [
  { id: 'sequoia', en: 'Sequoia', ar: 'سيكويا', dark: true, css: SEQUOIA },
  { id: 'sonoma', en: 'Sonoma', ar: 'سونوما', dark: false, css: SONOMA },
  { id: 'bigsur', en: 'Big Sur', ar: 'بيج سور', dark: true, css: BIGSUR },
  { id: 'monterey', en: 'Monterey', ar: 'مونتيري', dark: false, css: MONTEREY },
  { id: 'tahoe', en: 'Tahoe', ar: 'تاهو', dark: false, css: TAHOE },
  { id: 'aurora', en: 'Aurora', ar: 'الشفق', dark: true, css: `${blob(18, 12, '#7c5cffcc')}, ${blob(86, 18, '#22d3eeaa')}, ${blob(70, 98, '#f472b6aa', 65)}, linear-gradient(135deg, #0b1026, #1e1b4b 55%, #0a1d3b)` },
  { id: 'ocean', en: 'Deep ocean', ar: 'المحيط', dark: true, css: `${blob(15, 90, '#06b6d4aa', 70)}, ${blob(90, 10, '#3b82f6aa')}, linear-gradient(160deg, #020617, #0c2a4d 60%, #0b4a6f)` },
  { id: 'dusk', en: 'Dusk', ar: 'الغروب', dark: true, css: `${blob(80, 90, '#fb923cbb', 60)}, ${blob(20, 20, '#a855f7aa')}, linear-gradient(160deg, #1b1034, #3b1d5a 55%, #7a2e57)` },
  { id: 'forest', en: 'Forest', ar: 'الغابة', dark: true, css: `${blob(20, 15, '#34d39988')}, ${blob(85, 85, '#a3e63566', 60)}, linear-gradient(150deg, #04140f, #0b3b2c 60%, #14532d)` },
  { id: 'graphite', en: 'Graphite', ar: 'الجرافيت', dark: true, css: `${blob(50, 0, '#94a3b855', 70)}, linear-gradient(160deg, #0f1115, #1c2027 60%, #14171c)` },
  { id: 'grid', en: 'Blueprint', ar: 'المخطط', dark: true, css: `repeating-linear-gradient(0deg, #ffffff10 0 1px, transparent 1px 44px), repeating-linear-gradient(90deg, #ffffff10 0 1px, transparent 1px 44px), ${blob(50, 40, '#3b82f666', 70)}, linear-gradient(160deg, #0a1330, #10204d)` },
  { id: 'sand', en: 'Sand', ar: 'الرمال', dark: false, css: `${blob(15, 15, '#fde68acc')}, ${blob(90, 90, '#fdba74aa', 60)}, linear-gradient(150deg, #fff7ed, #fde9c9 60%, #f8d3a6)` },
  { id: 'sky', en: 'Sky', ar: 'السماء', dark: false, css: `${blob(85, 10, '#ffffffcc')}, ${blob(10, 90, '#a5b4fcaa', 70)}, linear-gradient(160deg, #e0f2fe, #bfdbfe 55%, #c7d2fe)` },
  { id: 'rose', en: 'Rose', ar: 'الورد', dark: false, css: `${blob(20, 20, '#fbcfe8cc')}, ${blob(85, 80, '#ddd6feaa', 65)}, linear-gradient(150deg, #fff1f2, #ffe4e6 55%, #f5d0fe)` },
];

export const wallpaperById = (id) => WALLPAPERS.find((w) => w.id === id) || WALLPAPERS[0];

/** CSS `background` for the current prefs. */
export function wallpaperCss(prefs) {
  if (prefs.wallpaper === 'custom' && prefs.customWallpaper) return `center / cover no-repeat url("${prefs.customWallpaper}")`;
  return wallpaperById(prefs.wallpaper).css;
}

/** Downscale an uploaded image to a ≤1920px JPEG data URL so it fits in localStorage. */
export function imageToWallpaper(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Synced to the server through the encrypted channel + the Vercel proxy (4.5 MB body limit incl. ~1.8x overhead):
      // keep the data URL under ~1.2 M chars by lowering quality, then size, until it fits.
      const MAX_CHARS = 1_200_000;
      let side = 1920; let q = 0.82; let out = '';
      for (let i = 0; i < 8; i += 1) {
        const k = Math.min(1, side / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        out = c.toDataURL('image/jpeg', q);
        if (out.length <= MAX_CHARS) break;
        if (q > 0.6) q -= 0.12; else side = Math.round(side * 0.8);
      }
      URL.revokeObjectURL(url);
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}
