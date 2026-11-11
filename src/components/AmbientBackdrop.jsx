import { memo, useState } from 'react';

// Light "ambient" backdrop for the whole platform (dashboard shells, public + error pages).
// It is the quiet cousin of LandingBackdrop: a couple of soft colour glows and a few small
// shapes that slowly drift upward. Everything is decorative (aria-hidden), pointer-events: none,
// and animates transform/opacity only. Styles + motion rules live in styles/css/ambient.css,
// which also switches it off for reduced-motion, slow screens, data-saver and the Android app.
//
// k = kind, x = horizontal %, s = size px, d = one full rise in seconds, delay = negative start offset,
// c = colour slot, m = still shown on phones (the rest are hidden below 768px).
const SHAPES = [
  { k: 'ring', x: 6, s: 22, d: 34, delay: -6, c: 1, m: 1 },
  { k: 'plus', x: 17, s: 16, d: 30, delay: -19, c: 4 },
  { k: 'dot', x: 29, s: 9, d: 26, delay: -11, c: 3, m: 1 },
  { k: 'square', x: 41, s: 18, d: 38, delay: -27, c: 2 },
  { k: 'ring', x: 55, s: 14, d: 32, delay: -15, c: 5, m: 1 },
  { k: 'plus', x: 67, s: 20, d: 36, delay: -3, c: 1 },
  { k: 'dot', x: 79, s: 10, d: 28, delay: -22, c: 4, m: 1 },
  { k: 'square', x: 91, s: 14, d: 33, delay: -9, c: 3 },
];

// Weak devices get no backdrop at all (no DOM, no animation): data-saver, <= 2 GB RAM, <= 2 cores.
function isLowEnd() {
  try {
    const n = typeof navigator !== 'undefined' ? navigator : {};
    if (n.connection?.saveData) return true;
    if (n.deviceMemory && n.deviceMemory <= 2) return true;
    if (n.hardwareConcurrency && n.hardwareConcurrency <= 2) return true;
  } catch { /* ignore */ }
  return false;
}

function AmbientBackdrop({ className = '' }) {
  const [off] = useState(isLowEnd);
  if (off) return null;
  return (
    <div className={`ambient-bg${className ? ` ${className}` : ''}`} aria-hidden="true">
      <span className="ambient-bg__orb ambient-bg__orb--1" />
      <span className="ambient-bg__orb ambient-bg__orb--2" />
      <span className="ambient-bg__grid" />
      {SHAPES.map((sh, i) => (
        <span
          key={i}
          className={`ambient-bg__shape ambient-bg__shape--${sh.k}${sh.m ? ' is-keep' : ''}`}
          style={{ left: `${sh.x}%`, '--s': `${sh.s}px`, '--d': `${sh.d}s`, '--delay': `${sh.delay}s`, '--c': `var(--amb-${sh.c})` }}
        />
      ))}
    </div>
  );
}

export default memo(AmbientBackdrop);
