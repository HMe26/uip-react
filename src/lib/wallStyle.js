import { useEffect, useState } from 'react';

/**
 * How a personal chat-background photo is laid out: fit = 'cover' (fill the chat, crop the edges) | 'contain' (the WHOLE photo) |
 * 'width' (whole width, scroll-free height); x / y = which part stays in view (0-100, like CSS background-position);
 * bg = colour behind the photo when it does not fill the chat ('' = the theme's own canvas).
 * Saved per photo id in this browser (the photo itself lives with the account).
 */
const KEY = 'uip.wallstyle.v1';
const EVT = 'uip-wallstyle';
export const WALL_FITS = ['cover', 'contain', 'width'];
export const DEFAULT_WALL_STYLE = { fit: 'cover', x: 50, y: 50, bg: '' };

const readAll = () => { try { const o = JSON.parse(localStorage.getItem(KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
const clamp = (n) => Math.min(100, Math.max(0, Number.isFinite(+n) ? +n : 50));

export const cleanWallStyle = (s) => ({
  fit: WALL_FITS.includes(s?.fit) ? s.fit : 'cover',
  x: clamp(s?.x ?? 50),
  y: clamp(s?.y ?? 50),
  bg: typeof s?.bg === 'string' && /^#[0-9a-f]{3,8}$/i.test(s.bg) ? s.bg : '',
});

export const getWallStyle = (id) => (id ? cleanWallStyle(readAll()[id]) : DEFAULT_WALL_STYLE);

export function setWallStyle(id, style) {
  if (!id) return;
  try {
    const all = readAll();
    all[id] = cleanWallStyle(style);
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* not remembered */ }
  try { window.dispatchEvent(new Event(EVT)); } catch { /* ignore */ }
}

export function useWallStyle(id) {
  const [style, setStyle] = useState(() => getWallStyle(id));
  useEffect(() => {
    const sync = () => setStyle(getWallStyle(id));
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(EVT, sync); window.removeEventListener('storage', sync); };
  }, [id]);
  return style;
}

/** CSS custom properties read by the `data-wall="custom"` rules. */
export const wallStyleVars = (style) => {
  const s = cleanWallStyle(style);
  return {
    '--msg-wall-size': s.fit === 'contain' ? 'contain' : s.fit === 'width' ? '100% auto' : 'cover',
    '--msg-wall-pos': `${s.x}% ${s.y}%`,
    '--msg-wall-bgc': s.bg || 'var(--bg-canvas)',
  };
};
