// Animated hero backdrop shared by the public pages (Landing, Explore projects, Privacy policy):
// drifting colour orbs, a panning dot grid and floating geometric shapes. Purely decorative;
// styles + motion live in styles/css/landing-motion.css (scoped to .lp2--fx).
const SHAPES = [
  { k: 'ring', x: 8, s: 24, d: 34, delay: -6, c: 1 },
  { k: 'dot', x: 32, s: 10, d: 30, delay: -14, c: 3 },
  { k: 'plus', x: 62, s: 20, d: 36, delay: -22, c: 4 },
  { k: 'square', x: 88, s: 16, d: 32, delay: -9, c: 5 },
];

// Weak devices (data-saver, <= 2 GB RAM, <= 2 cores) get a static backdrop: no moving shapes.
function isLowEnd() {
  try {
    const n = typeof navigator !== 'undefined' ? navigator : {};
    return !!(n.connection?.saveData || (n.deviceMemory && n.deviceMemory <= 2) || (n.hardwareConcurrency && n.hardwareConcurrency <= 2));
  } catch { return false; }
}

export default function LandingBackdrop({ compact = false }) {
  return (
    <div className={`lp2-bg${compact ? ' lp2-bg--compact' : ''}`} aria-hidden="true">
      <span className="lp2-bg__orb lp2-bg__orb--1" />
      <span className="lp2-bg__orb lp2-bg__orb--2" />
      <span className="lp2-bg__grid" />
      {!isLowEnd() && SHAPES.map((sh, i) => (
        <span
          key={i}
          className={`lp2-bg__shape lp2-bg__shape--${sh.k}`}
          style={{ left: `${sh.x}%`, '--s': `${sh.s}px`, '--d': `${sh.d}s`, '--delay': `${sh.delay}s`, '--c': `var(--tone-${sh.c})` }}
        />
      ))}
    </div>
  );
}
