/**
 * Hero artwork for the auth screens — a mortarboard resting on a stack of
 * books with three floating "product" tiles (analytics / document / search)
 * orbiting it. Pure inline SVG (no bitmap, no external request) so it stays
 * crisp at any size and recolours with the light/dark tokens defined on
 * `.auth-shell` in styles/css/pages/auth.css (`--a-art-*`).
 */
export default function AuthIllustration() {
  return (
    <svg
      className="auth-art"
      viewBox="0 0 420 400"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="uipArtGlow" cx="50%" cy="55%" r="50%">
          <stop offset="0%" stopColor="var(--a-art-glow)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--a-art-glow)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="uipArtBoard" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--a-art-board-1)" />
          <stop offset="100%" stopColor="var(--a-art-board-2)" />
        </linearGradient>
        <linearGradient id="uipArtGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFD37A" />
          <stop offset="100%" stopColor="#F0A92E" />
        </linearGradient>
      </defs>

      {/* ambient glow + orbit */}
      <ellipse className="auth-art__glow" cx="210" cy="230" rx="190" ry="150" fill="url(#uipArtGlow)" />
      <ellipse className="auth-art__orbit" cx="210" cy="215" rx="170" ry="62" fill="none" stroke="var(--a-art-orbit)" strokeWidth="1.2" strokeDasharray="3 7" />

      {/* ripples spreading out from the books */}
      <ellipse className="auth-art__ripple" cx="210" cy="312" rx="100" ry="22" fill="none" stroke="var(--a-art-orbit)" strokeWidth="1.4" />
      <ellipse className="auth-art__ripple auth-art__ripple--2" cx="210" cy="312" rx="100" ry="22" fill="none" stroke="var(--a-art-orbit)" strokeWidth="1.4" />

      {/* book 1 (bottom) */}
      <g>
        <polygon points="120,270 210,300 210,326 120,296" fill="var(--a-art-page)" />
        <polygon points="210,300 300,270 300,296 210,326" fill="var(--a-art-cover-2)" />
        <polygon points="210,240 300,270 210,300 120,270" fill="var(--a-art-cover-1)" />
        <path d="M128 281 L206 307 M128 287 L206 313" stroke="var(--a-art-page-line)" strokeWidth="1" fill="none" />
      </g>
      {/* book 2 */}
      <g>
        <polygon points="140,238 210,261 210,281 140,258" fill="var(--a-art-page)" />
        <polygon points="210,261 280,238 280,258 210,281" fill="var(--a-art-cover-3)" />
        <polygon points="210,215 280,238 210,261 140,238" fill="var(--a-art-cover-2)" />
      </g>

      {/* pages / ideas rising from the books */}
      <g className="auth-art__rise-layer">
        <rect className="auth-art__rise auth-art__rise--1" x="168" y="236" width="9" height="12" rx="2" fill="var(--a-art-page)" stroke="var(--a-art-page-line)" />
        <rect className="auth-art__rise auth-art__rise--2" x="236" y="232" width="9" height="12" rx="2" fill="var(--a-art-page)" stroke="var(--a-art-page-line)" />
        <circle className="auth-art__rise auth-art__rise--3" cx="205" cy="240" r="3.5" fill="var(--a-art-icon)" />
        <circle className="auth-art__rise auth-art__rise--4" cx="264" cy="246" r="2.5" fill="#F0A92E" />
        <circle className="auth-art__rise auth-art__rise--5" cx="152" cy="250" r="2.5" fill="#F0A92E" />
      </g>

      {/* cap: skull + board (bobs gently, tassel swings) */}
      <g className="auth-art__cap">
      <path d="M160 138 L160 172 Q210 202 260 172 L260 138 Z" fill="var(--a-art-cap-side)" />
      <polygon points="210,80 322,122 210,164 98,122" fill="url(#uipArtBoard)" />
      <polygon points="210,80 322,122 210,164 98,122" fill="none" stroke="var(--a-art-edge)" strokeWidth="1.2" />
      <polygon points="98,122 210,164 210,172 98,130" fill="var(--a-art-cap-side)" />
      <polygon points="210,164 322,122 322,130 210,172" fill="var(--a-art-cover-3)" />
      <circle cx="210" cy="122" r="6" fill="url(#uipArtGold)" />

      {/* tassel */}
      <path d="M210 122 Q262 128 304 134" fill="none" stroke="url(#uipArtGold)" strokeWidth="3.2" strokeLinecap="round" />
      <g className="auth-art__tassel">
        <path d="M304 134 L304 200" fill="none" stroke="#F5BC52" strokeWidth="3.2" strokeLinecap="round" />
        <path d="M296 198 h16 l4 30 h-24 z" fill="url(#uipArtGold)" />
        <path d="M298 206 v20 M304 206 v22 M310 206 v20" stroke="#C98716" strokeWidth="1" opacity="0.55" />
      </g>
      </g>

      {/* floating tiles */}
      <g className="auth-art__tile auth-art__tile--a">
        <rect x="40" y="70" width="64" height="64" rx="18" fill="var(--a-art-tile)" stroke="var(--a-art-tile-line)" />
        <path d="M58 116 V100 M72 116 V88 M86 116 V96" stroke="var(--a-art-icon)" strokeWidth="6" strokeLinecap="round" />
      </g>
      <g className="auth-art__tile auth-art__tile--b">
        <rect x="316" y="40" width="64" height="64" rx="18" fill="var(--a-art-tile)" stroke="var(--a-art-tile-line)" />
        <path d="M338 58 h14 l8 8 v22 a3 3 0 0 1 -3 3 h-19 a3 3 0 0 1 -3 -3 v-27 a3 3 0 0 1 3 -3 z" fill="var(--a-art-icon)" />
        <path d="M341 74 h14 M341 81 h14" stroke="var(--a-art-tile)" strokeWidth="2.6" strokeLinecap="round" />
      </g>
      <g className="auth-art__tile auth-art__tile--c">
        <rect x="320" y="236" width="64" height="64" rx="18" fill="var(--a-art-icon)" />
        <circle cx="349" cy="264" r="10" fill="none" stroke="#fff" strokeWidth="4" />
        <path d="M357 272 l9 9" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" />
      </g>

      {/* satellites travelling along the dotted orbit */}
      <g className="auth-art__orbiter">
        <circle r="5" fill="var(--a-art-icon)">
          <animateMotion dur="16s" repeatCount="indefinite" path="M40 215 a170 62 0 1 0 340 0 a170 62 0 1 0 -340 0" />
        </circle>
        <circle r="3.5" fill="#F0A92E">
          <animateMotion dur="16s" begin="-8s" repeatCount="indefinite" path="M40 215 a170 62 0 1 0 340 0 a170 62 0 1 0 -340 0" />
        </circle>
        <circle r="2.5" fill="var(--a-art-icon)" opacity="0.7">
          <animateMotion dur="16s" begin="-12s" repeatCount="indefinite" path="M40 215 a170 62 0 1 0 340 0 a170 62 0 1 0 -340 0" />
        </circle>
      </g>

      {/* twinkling sparkles */}
      <path className="auth-art__star auth-art__star--1" d="M70 186 l3 11 11 3 -11 3 -3 11 -3 -11 -11 -3 11 -3 z" fill="var(--a-art-icon)" />
      <path className="auth-art__star auth-art__star--2" d="M372 156 l2.5 9 9 2.5 -9 2.5 -2.5 9 -2.5 -9 -9 -2.5 9 -2.5 z" fill="#F0A92E" />
      <path className="auth-art__star auth-art__star--3" d="M150 38 l2.5 9 9 2.5 -9 2.5 -2.5 9 -2.5 -9 -9 -2.5 9 -2.5 z" fill="var(--a-art-icon)" />
      <path className="auth-art__star auth-art__star--4" d="M262 20 l2 7 7 2 -7 2 -2 7 -2 -7 -7 -2 7 -2 z" fill="#F0A92E" />
      <circle className="auth-art__star auth-art__star--5" cx="46" cy="270" r="3" fill="var(--a-art-icon)" />
      <circle className="auth-art__star auth-art__star--6" cx="392" cy="214" r="3" fill="var(--a-art-icon)" />
    </svg>
  );
}
