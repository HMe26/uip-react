import { scheduleCursorTheme } from '../utils/cursorTheme';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext(null);

/**
 * Three looks for the whole platform (every portal, landing and auth pages):
 *
 *   classic  the default — indigo accent on a cool grey-blue canvas
 *   light    clean white, neutral greys
 *   dark     deep navy
 *
 * `mode` is the single source of truth. For the code that still thinks in
 * (theme, palette) pairs it is mapped onto the <html> attributes like this:
 *   classic → data-theme="light" data-palette="insight"
 *   light   → data-theme="light" data-palette="white"
 *   dark    → data-theme="dark"  data-palette = 'white' if you came from Light, else 'insight' (Classic dark)
 * public/theme-boot.js applies the same attributes before first paint.
 *
 * `theme` ('light' | 'dark') and `palette` stay exported so existing callers
 * (settings pages syncing the account theme, toggle buttons…) keep working.
 */
export const THEME_MODES = ['light', 'classic', 'dark'];

const MODE_KEY = 'uip_mode';
const LAST_LIGHT_KEY = 'uip_last_light';
const LEGACY_THEME_KEY = 'uip_theme'; // still written so older readers keep working

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

function readMode() {
  const saved = store.get(MODE_KEY);
  if (THEME_MODES.includes(saved)) return saved;
  // First visit with the new system: keep an explicit dark choice, everyone else gets Classic.
  return store.get(LEGACY_THEME_KEY) === 'dark' ? 'dark' : 'classic';
}
const readLastLight = () => (store.get(LAST_LIGHT_KEY) === 'light' ? 'light' : 'classic');

export const themeOf = (mode) => (mode === 'dark' ? 'dark' : 'light');
// Dark is built on whichever light look the user was in: from Light -> the neutral dark twin
// (data-palette="white" + data-theme="dark"), from Classic -> the classic dark.
export const paletteOf = (mode, lastLight = 'classic') => {
  if (mode === 'dark') return lastLight === 'light' ? 'white' : 'insight';
  return mode === 'light' ? 'white' : 'insight';
};

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(readMode);
  const [lastLight, setLastLight] = useState(readLastLight);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', themeOf(mode));
    root.setAttribute('data-palette', paletteOf(mode, lastLight));
    root.setAttribute('data-mode', mode);
    store.set(MODE_KEY, mode);
    store.set(LEGACY_THEME_KEY, themeOf(mode));
    scheduleCursorTheme(); // themed mouse cursors follow the active look
  }, [mode, lastLight]);

  useEffect(() => { store.set(LAST_LIGHT_KEY, lastLight); }, [lastLight]);

  const setMode = useCallback((next) => {
    if (!THEME_MODES.includes(next)) return;
    setModeState(next);
    if (next !== 'dark') setLastLight(next);
  }, []);

  // Legacy API ------------------------------------------------------------
  const setTheme = useCallback((t) => setMode(t === 'dark' ? 'dark' : lastLight), [setMode, lastLight]);
  const setPalette = useCallback((p) => {
    const light = p === 'insight' ? 'classic' : 'light';
    if (mode === 'dark') setLastLight(light); // picking a colour while dark only changes the light look
    else setMode(light);
  }, [mode, setMode]);
  const toggleTheme = useCallback(() => setMode(mode === 'dark' ? lastLight : 'dark'), [mode, lastLight, setMode]);

  const value = useMemo(() => ({
    mode, setMode, lastLight,
    theme: themeOf(mode), setTheme, toggleTheme,
    palette: paletteOf(mode, lastLight), setPalette,
  }), [mode, setMode, lastLight, setTheme, toggleTheme, setPalette]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
