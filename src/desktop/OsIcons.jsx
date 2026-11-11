import { memo, useId } from 'react';
import Icon from '../components/Icon';
import { VM_BY_ID, isVmApp } from '../virtual/catalog';

/** Big colourful desktop / start-menu glyphs. Folder / PC / bin are hand-drawn SVG, the rest use the shared Icon set on a gradient tile. */
let uid = 0;
const gid = () => `osg${(uid += 1)}`;

/** memo + stable ids (useId): a folder full of icons no longer rebuilds every gradient on each render. */
export const FolderGlyph = memo(function FolderGlyph({ size = 48, project = false }) {
  const u = useId().replace(/:/g, ''); const a = `${u}a`; const b = `${u}b`; const c = `${u}c`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={a} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4fb4f2" /><stop offset="1" stopColor="#2f8fe0" /></linearGradient>
        <linearGradient id={b} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8fd6fb" /><stop offset="1" stopColor="#4cb2f3" /></linearGradient>
        <linearGradient id={c} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
      </defs>
      <path d="M5 13.5A4.5 4.5 0 0 1 9.5 9h13.2c1.3 0 2.5.6 3.4 1.5l2.2 2.5h25.2A4.5 4.5 0 0 1 58 17.5v31A4.5 4.5 0 0 1 53.5 53h-44A4.5 4.5 0 0 1 5 48.5Z" fill={`url(#${a})`} />
      <path d="M5 23.5A4.5 4.5 0 0 1 9.5 19h45a4.5 4.5 0 0 1 4.5 4.5v25a4.5 4.5 0 0 1-4.5 4.5h-45A4.5 4.5 0 0 1 5 48.5Z" fill={`url(#${b})`} />
      <path d="M9.5 19h45a4.5 4.5 0 0 1 4.5 4.5V26H5v-2.5A4.5 4.5 0 0 1 9.5 19Z" fill={`url(#${c})`} opacity=".7" />
      {project && <path d="m24 32 5 5-5 5M33 42h7" fill="none" stroke="#0b4a85" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
});

export function PcGlyph({ size = 48 }) {
  const a = gid(); const b = gid();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={a} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#38bdf8" /><stop offset="1" stopColor="#6366f1" /></linearGradient>
        <linearGradient id={b} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e2e8f0" /><stop offset="1" stopColor="#94a3b8" /></linearGradient>
      </defs>
      <rect x="6" y="9" width="52" height="35" rx="5" fill={`url(#${b})`} />
      <rect x="9" y="12" width="46" height="29" rx="2.5" fill={`url(#${a})`} />
      <path d="M9 34c10-8 20 2 46-9v16H9Z" fill="#fff" opacity=".18" />
      <path d="M26 44h12l2 8H24Z" fill="#94a3b8" />
      <rect x="18" y="51" width="28" height="4" rx="2" fill={`url(#${b})`} />
    </svg>
  );
}

export function BinGlyph({ size = 48, full = false }) {
  const a = gid();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs><linearGradient id={a} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e2e8f0" /><stop offset="1" stopColor="#94a3b8" /></linearGradient></defs>
      {full && <path d="M20 14l8-5 6 6 7-5 6 8Z" fill="#fff" opacity=".9" />}
      <rect x="12" y="14" width="40" height="6" rx="3" fill={`url(#${a})`} />
      <rect x="25" y="9" width="14" height="6" rx="3" fill="#94a3b8" />
      <path d="M16 22h32l-2.4 29a4 4 0 0 1-4 3.6H22.4a4 4 0 0 1-4-3.6Z" fill={`url(#${a})`} opacity=".92" />
      <path d="M26 28v20M32 28v20M38 28v20" stroke="#64748b" strokeWidth="2.4" strokeLinecap="round" opacity=".7" />
    </svg>
  );
}

/** mix a hex colour toward white (t>0) or black (t<0) */
function shade(hex, t) {
  const h = String(hex).replace('#', ''); const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h.padEnd(6, '0').slice(0, 6), 16);
  const f = (v) => Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t));
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(f);
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Modern file icon: a rounded sheet tinted with the file-type colour (soft gradient + glossy fold) and a bold type badge. */
export const FileGlyph = memo(function FileGlyph({ size = 48, label = '', color = '#64748b' }) {
  const u = useId().replace(/:/g, ''); const a = `${u}a`; const b = `${u}b`; const c = `${u}c`;
  const text = String(label).slice(0, 4).toUpperCase() || 'FILE';
  const fs = text.length >= 4 ? 8.6 : text.length === 3 ? 10.5 : 12.5;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={a} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor={shade(color, 0.86)} /></linearGradient>
        <linearGradient id={b} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={shade(color, 0.22)} /><stop offset="1" stopColor={shade(color, -0.18)} /></linearGradient>
        <linearGradient id={c} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".95" /><stop offset="1" stopColor={shade(color, 0.55)} /></linearGradient>
      </defs>
      <g>
        <path d="M17 4h21.5L55 20.5V52a8 8 0 0 1-8 8H17a8 8 0 0 1-8-8V12a8 8 0 0 1 8-8Z" fill={`url(#${a})`} />
        <path d="M17 4.6h21.2l16.2 16.2V52a7.4 7.4 0 0 1-7.4 7.4H17A7.4 7.4 0 0 1 9.6 52V12A7.4 7.4 0 0 1 17 4.6Z" fill="none" stroke={shade(color, 0.5)} strokeWidth="1" opacity=".7" />
        <path d="M38.5 4v11a5.5 5.5 0 0 0 5.5 5.5h11Z" fill={`url(#${c})`} />
        <path d="M38.5 4v11a5.5 5.5 0 0 0 5.5 5.5h11" fill="none" stroke={shade(color, 0.3)} strokeWidth=".8" opacity=".6" />
        <path d="M16 27h22M16 32h14" stroke={shade(color, 0.55)} strokeWidth="2.6" strokeLinecap="round" opacity=".75" />
        <rect x="5" y="37" width="40" height="17" rx="5" fill={`url(#${b})`} />
        <rect x="5" y="37" width="40" height="8" rx="4" fill="#fff" opacity=".16" />
        <text x="25" y="49.6" textAnchor="middle" fontSize={fs} fontWeight="800" letterSpacing=".3" fill="#fff" fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif">{text}</text>
      </g>
    </svg>
  );
});

const TILES = {
  settings: ['#a1a6b0', '#6b7280', 'settings'],
  taskmgr: ['#4ade80', '#16a34a', 'pulse'],
  shortcuts: ['#fbbf24', '#f97316', 'key'],
  notes: ['#fde047', '#f59e0b', 'note'],
  calendar: ['#fb7185', '#e11d48', 'calendar'],
  calculator: ['#9ca3af', '#374151', 'grid'],
  portal: ['#818cf8', '#4f46e5', 'home'],
  personalize: ['#f472b6', '#a855f7', 'palette'],
  run: ['#5ac8fa', '#2563eb', 'terminal'],
  terminal: ['#3b4252', '#0d1117', 'terminal'],
  vscode: ['#38bdf8', '#1d4ed8', 'terminal'],
  browser: ['#34d399', '#0e7490', 'globe'],
  lock: ['#6b7280', '#1f2937', 'lock'],
  logout: ['#fb7185', '#e11d48', 'logout'],
  search: ['#5ac8fa', '#6366f1', 'search'],
  ai: ['#c084fc', '#6366f1', 'sparkles'],
  viewer: ['#38bdf8', '#2563eb', 'eye'],
  editor: ['#818cf8', '#7c3aed', 'terminal'],
};

/** macOS-style app icon: squircle, soft top-down gradient, glossy rim. */
export function Tile({ kind, size = 48 }) {
  const [c1, c2, icon] = TILES[kind] || TILES.settings;
  return (
    <span className="os-tile" style={{ width: size, height: size, background: `linear-gradient(180deg, ${c1}, ${c2})`, borderRadius: Math.round(size * 0.225) }}>
      <Icon name={icon} size={Math.round(size * 0.54)} />
    </span>
  );
}

/** "This PC" app icon (Finder-like role): blue squircle with a white folder. */
export function ExplorerTile({ size = 48 }) {
  const a = gid();
  return (
    <span className="os-tile os-tile--explorer" style={{ width: size, height: size, borderRadius: Math.round(size * 0.225) }}>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 64 64" aria-hidden="true">
        <defs><linearGradient id={a} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#dbeafe" /></linearGradient></defs>
        <path d="M6 15a5 5 0 0 1 5-5h13c1.4 0 2.7.6 3.6 1.6l2.6 2.9H53a5 5 0 0 1 5 5v27a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5Z" fill={`url(#${a})`} opacity=".72" />
        <path d="M6 25a5 5 0 0 1 5-5h42a5 5 0 0 1 5 5v22a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5Z" fill={`url(#${a})`} />
      </svg>
    </span>
  );
}

/** Launchpad icon: a rounded grid of colourful dots on a soft grey squircle. */
export function LaunchpadGlyph({ size = 48 }) {
  const dots = ['#ff5f57', '#febc2e', '#28c840', '#0a84ff', '#bf5af2', '#ff9f0a', '#30d0c6', '#ff375f', '#5e5ce6'];
  return (
    <span className="os-tile os-tile--launch" style={{ width: size, height: size, borderRadius: Math.round(size * 0.225) }}>
      <span className="os-launchdots" style={{ gap: size * 0.07, width: size * 0.62, height: size * 0.62 }}>
        {dots.map((c) => <i key={c} style={{ background: c, borderRadius: size * 0.09 }} />)}
      </span>
    </span>
  );
}

/** UIPE monogram used for the menu-bar logo and the start-up screen. */
export function UipMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 2.2c-.7 0-1.4.2-2 .6L4.6 6.1A3.9 3.9 0 0 0 2.7 9.5v5a3.9 3.9 0 0 0 1.9 3.4l5.4 3.3a4 4 0 0 0 4 0l5.4-3.3a3.9 3.9 0 0 0 1.9-3.4v-5a3.9 3.9 0 0 0-1.9-3.4L14 2.8c-.6-.4-1.3-.6-2-.6Zm-3 6.6h1.7v4.1c0 1.1.6 1.7 1.5 1.7s1.5-.6 1.5-1.7V8.8H15.4v4.2c0 2-1.3 3.2-3.2 3.2S9 15 9 13Z" />
    </svg>
  );
}

/** Icon of a platform app of the virtual mode (courses, exams…): same squircle as the system apps, tinted by its group. */
export function VmTile({ app, size = 48 }) {
  const a = VM_BY_ID[app];
  const [c1, c2] = a?.colors || ['#60a5fa', '#2563eb'];
  return (
    <span className="os-tile vm-tile" style={{ width: size, height: size, background: `linear-gradient(180deg, ${c1}, ${c2})`, borderRadius: Math.round(size * 0.225) }}>
      <Icon name={a?.icon || 'grid'} size={Math.round(size * 0.54)} />
    </span>
  );
}

/** One glyph for an app id (Launchpad / Dock / Mission Control). */
export function AppGlyph({ app, size = 48, full }) {
  if (isVmApp(app)) return <VmTile app={app} size={size} />;
  if (app === 'explorer') return <ExplorerTile size={size} />;
  if (app === 'bin') return <BinGlyph size={size} full={full} />;
  if (app === 'launchpad') return <LaunchpadGlyph size={size} />;
  return <Tile kind={app} size={size} />;
}
