import { THEMES as CODE } from '../../components/zipbench/themePalettes.js';

/**
 * Sheet colour themes = the 6 original Excel themes (green / blue / violet / orange / gray / dark, with coloured header row + banded rows)
 * + every palette of the code editor (Dark+, Midnight, Dracula, Emerald, Nord, Monokai, Solarized ...), so both editors look alike.
 * Canvas colours (bg .. corner, hdBg / hdFg / band) are used by draw.js; `vars` become the --sx-* CSS variables of the chrome.
 */
const chrome = (o) => ({ '--sx-bg': o.bg, '--sx-panel': o.panel, '--sx-line': o.line, '--sx-text': o.text, '--sx-muted': o.muted, '--sx-accent': o.accent, '--sx-accent-soft': o.soft, '--sx-hover': o.hover, '--sx-pop': o.pop, colorScheme: o.dark ? 'dark' : 'light' });

const excel = (id, en, ar, accent, soft, hdBg, band, head, headOn, headOnFg) => ({
  id, en, ar, group: 'excel', dark: false, swatch: [hdBg, '#ffffff', accent],
  bg: '#ffffff', fg: '#1f2937', grid: '#d9dde3', head, headFg: '#4b5563', headOn, headOnFg, accent, sel: `${accent}22`, corner: head, hdBg, hdFg: '#ffffff', band,
  vars: chrome({ bg: '#ffffff', panel: '#f3f4f6', line: '#d6d9de', text: '#1f2937', muted: '#5f6773', accent, soft, hover: 'rgba(0,0,0,.07)', pop: '#ffffff' }),
});

const list = [
  { id: 'dark', en: 'Dark', ar: 'داكن', group: 'excel', dark: true, swatch: ['#1b2540', '#0c111c', '#6ea8ff'], bg: '#0c111c', fg: '#e6ecff', grid: '#1c2438', head: '#171e30', headFg: '#9aa7c7', headOn: '#26324f', headOnFg: '#ffffff', accent: '#6ea8ff', sel: 'rgba(110,168,255,.14)', corner: '#1a2236', hdBg: '#1b2540', hdFg: '#cfe0ff', band: '#101728',
    vars: chrome({ bg: '#0c111c', panel: '#151b2b', line: 'rgba(255,255,255,.1)', text: '#e6ecff', muted: '#9aa7c7', accent: '#6ea8ff', soft: 'rgba(110,168,255,.18)', hover: 'rgba(255,255,255,.08)', pop: '#1b2236', dark: true }) },
  excel('excel', 'Excel green', 'أخضر Excel', '#217346', '#d3f0e0', '#217346', '#eaf5ee', '#f0f3f1', '#c7e6d1', '#14532d'),
  excel('blue', 'Ocean blue', 'أزرق', '#2563eb', '#dbe7fb', '#1f4e9c', '#eaf1fb', '#eff3fa', '#c9dbf7', '#1e3a8a'),
  excel('violet', 'Violet', 'بنفسجي', '#7c3aed', '#e7defb', '#6d28d9', '#f1ecfd', '#f4f1fb', '#ddd0f7', '#4c1d95'),
  excel('orange', 'Sunset', 'برتقالي', '#ea580c', '#fbe3d2', '#c2410c', '#fdf0e7', '#fbf3ee', '#f9d9c3', '#7c2d12'),
  excel('slate', 'Classic gray', 'رمادي كلاسيك', '#4b5563', '#e1e4e8', '#374151', '#f3f4f6', '#f1f2f4', '#d6d9de', '#111827'),
  ...CODE.map((c) => {
    const u = c.ui;
    return {
      id: `code-${c.id}`, en: c.name, ar: c.name, group: 'code', dark: !!c.dark, swatch: [u.bg, u.accent, c.ed.keyword],
      bg: u.bg, fg: u.text, grid: u.line, head: u.side, headFg: u.muted, headOn: u.sel, headOnFg: u.strong, accent: u.accent, sel: u.accentSoft, corner: u.bar,
      vars: chrome({ bg: u.bg, panel: u.side, line: u.line, text: u.text, muted: u.muted, accent: u.accent, soft: u.accentSoft, hover: u.hover, pop: u.menu, dark: c.dark }),
    };
  }),
];

export const THEME_LIST = list;
export const THEMES = Object.fromEntries(list.map((t) => [t.id, t]));
export const themeOf = (id) => THEMES[id] || THEMES.excel;
const KEY = 'uip.sheet.theme4';
export function loadThemeId(readOnly) {
  try {
    const t = localStorage.getItem(KEY); if (THEMES[t]) return t;
    const zb = localStorage.getItem('zb-theme'); if (zb && THEMES[`code-${zb}`]) return `code-${zb}`; // same look as the code editor the user picked
    if (readOnly) return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'excel';
  } catch { /* storage unavailable */ }
  return 'excel';
}
export const saveThemeId = (id) => { try { localStorage.setItem(KEY, id); } catch { /* storage unavailable */ } };
